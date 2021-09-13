// server.js -- the server side code to run the core game logic

// Copyright (C) 2021, Nicholas Carlini <nicholas@carlini.com>.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

function startserver(){}
/*HACK*/startserver(); 
var last_now = 0;
var sockets = [];
var objects;
var hud;
var object_ht;
var SERVER = 1;

var game_state = -1; // -1: no one playing, 0: game in action, 1: ending, 2: waiting to start

function shallow_stringify(o, first) {
    if (o === undefined || o == null) return o;
    if (o.length && o.map) return o.map(x=>shallow_stringify(x,first));
    if (!(o instanceof Object)) return o;
    if (!first && o.uid) return {uid: o.uid};
    var r = {}
    Object.keys(o).map(k => {
        r[k] = shallow_stringify(o[k]);
    });
    return r;
}

var local_time;
var clock_drift = 0; // I am the source of truth;

/* Now I'd personally never make a mistake that would cause the server to crash
 * But just in case a cosmic ray hits the server, and somehow doesn't cause
 * the machine to halt but instead causes a javascript exception (??), then
 * let's catch that error cleanly so that the clients know what happened.
 */
function handler(fn) {
    return (a,b,c) => {
        try {
            fn(a,b,c);
        } catch (err) {
            console.log("Server had crash");
            console.log(err); // DEBUGONLY
            clearInterval(loop_id);
            start_timer = undefined;
            
            sockets.map(x=>x.emit(CommandCrash));
            reset();
            game_state = -1;
        }
    };
}

function event_loop_inner() {
    var now = get_time()
    local_time = now;

    if (game_state == 0) {
        // 1. Do the update
        objects.map(x=>x.update(now-last_now));

        // 2. Now send it to the client... this takes some work

        object_ht = {}
        objects.map(o => object_ht[o.uid] = o);
        
        var date = get_time();

        var to_send = objects.map(x=> {
            // 2a. For every object, compute the "current state" as a shallow copy
            var state = JSON.parse(JSON.stringify(shallow_stringify(x, true)));

            // 2b. Load off the prior state from the last frame
            var prior = JSON.parse(x.last_state||"{}")

            // 2c. And the ncompare to see what's different from last time
            var delta = Object.keys(state).reduce((diff, key) => {
                if (JSON.stringify(state[key]) === JSON.stringify(prior[key])) return diff
                return {
                    ...diff,
                    [key]: state[key]
                }
            }, {})

            // 2d. There are some things we don't care about changing
            delete delta.position;
            delete delta.rotation;
            delete delta.last_state;

            // 2e. And some things we really do care about changing.
            if (Object.keys(delta).length) {
                delta.uid = state.uid // keep uid
            }

            // 2f. A bit of hacking, because we don't want quadratic blowup.
            state.last_state = 0;

            // 2g. And finally save this as the last state
            x.last_state = JSON.stringify(state);

            // 2h. (But return the delta.)
            return delta;
        }).filter(x=>Object.keys(x).length); // keep only objects that changed

        // 3. Tell everyone what happened this frame, with only the updates
        if (to_send.length) {  // but only if something happened
            sockets.map(x=> {
                x.emit(CommandUpdate, to_send);
            })
        }
        // 4. Finally purge dead objects
        objects = objects.filter(x=>!x.dead);
    } if (game_state == 1) {
        console.log("Game over. Clearing event loop");
        setTimeout(_=> {
            game_state = 2;
            start_timer = get_time()+3000;
        }, 6000);
        game_state = 1.5;
    } if (game_state == 2) {
        if (start_timer < last_now) {
            start_timer = /*HACK*/undefined;
            reset();
            game_state = 0;
            sockets.map(s=>s.emit(CommandInit, objects.map(x=>shallow_stringify(x, true))));
        } else {
            sockets.map(s=> {
                s.emit(CommandWaitToStart, start_timer-last_now);
            });
        }
    }
    last_now = now;
}

var event_loop = handler(event_loop_inner);

module.exports = {
    io: handler((socket) => {
	var player = {level: 0,
                      health: 0,
                      side: 1-Math.round(sum([...sockets.map(x=>x.player.side),0])/(sockets.length+1))};
        sockets.push(socket);

        function on(cmd, fn) {
            socket.on(cmd, handler(fn));
        }

        // Create a new player
        on(CommandNewMe, (type, keep_level) => {
            var old_level = player.level;
	    socket.player = player = new Player(player.side, type);
            player.movefn = stop_fn(base_location[player.side], IDENTITY);
            if (keep_level) player.level = old_level;
            objects.push(player);
            socket.emit(CommandRevive, player);
        });

        // Client side debugging. I don't know how to debug npm servers...
        on(CommandEval, str => {
            socket.emit(CommandResponse, /*HACK*/eval(str));
        });

        // Clean up this client.
	on("disconnect", _ => {
            sockets = sockets.filter(x=>x != socket);
            console.log("Dropped: ", "remaining:", objects.length);
            player && (player.health = -1e6);
            if (sockets.length == 0) {
                console.log("Clearing event loop");
                clearInterval(loop_id);
                game_state = -1;
                start_timer = /*HACK*/undefined;
            }
	});

        // Move my player to somewhere els
	on(CommandMove, movefn => {
            player.movefn = fix_json(movefn);
	});

        // PING PONG
	on(CommandPing, start_time => {
            socket.emit(CommandPong, start_time, get_time());
	});

        // Tons of damage
	on(CommandFire, (start, goal, kind) => {
            objects.push(new RangedAttack(NewVectorFromList(start),
                                          NewVectorFromList(goal),
                                          player,
                                          kind||0));
	});

        // Negative tons of damage
	on(CommandHeal, (who, amount) => {
            if (object_ht[who]) {
                object_ht[who].health = Math.min(object_ht[who].health+amount,
                                                 object_ht[who].maxhealth);
                objects.push(new HealAnimation(object_ht[who]));
            }
	});

        // Stop tons of damage
	on(CommandShield, (who, amount) => {
            if (object_ht[who]) {
                object_ht[who].shield += amount;
                // todo space do I need to allow stacking shields
                setTimeout(_=>object_ht[who] && (object_ht[who].shield = Math.max(object_ht[who].shield-amount,0)), 2000);
            }
	});

        // Teleport to a target location (assassin ult)
	on(CommandTP, where => {
            where = NewVectorFromList(where);
            setTimeout(_=>player.movefn = stop_fn(where, matrix_rotate_xy(where.angle(player.position)-Math.PI/2)), 200);
            sockets.map(s=>s.emit(CommandReplyTP, player.uid, where._xyz()));
        });

        // Stun a target player (tank ult)
	on(CommandStun, (who, duration) => {
            if (object_ht[who]) {
                player.cc_timer = object_ht[who].cc_timer = get_time() + duration;
                player.movefn = stop_fn(player.position, player.rotation);
                object_ht[who].movefn = linear_move_withtime(object_ht[who].position,
                                                             0,
                                                             object_ht[who].position.moveto(player.position,3),
                                                             3200/duration,
                                                             get_time(),
                                                             1);
                objects.push(new TractorBeam(player.position.add(mat_vector_product(player.rotation, NewVector(2, 1, 0))), object_ht[who], duration));
                objects.push(new TractorBeam(player.position.add(mat_vector_product(player.rotation, NewVector(-2, 1, 0))), object_ht[who], duration));
            }
            
	}); 

        // Divert all bullets away from a location (healer ult)
	on(CommandDivert, where => {
            dot(_=>
                objects.filter(x=>!x._diverted && x.side != player.side && x.position.distance_to(player.position) < 20 && (x instanceof AutoAttack || x instanceof RangedAttack)).map(x=> {
                    x.movefn = linear_move_withtime(x.position, x.rotation, x.position.add(NewVector(urandom()*50,urandom()*50,50)), 10, get_time());
                    x._diverted = 1;
                    objects.push(new TractorBeam(player.position, x, 300));
                }),
                4,
                500);
            
	});

        
        add_player(socket);

    })
};

var tick_rate = 40; // seems good enough
var start_timer;
function add_player(socket) {
    if (game_state == -1) {
        // no game is running
        if (start_timer === undefined) {
            // timer hasn't started
            console.log("Starting new game");
            start_timer = get_time()+800;
            game_state = 2;
            loop_id = setInterval(event_loop, 1000/tick_rate)
        }
    } if (game_state == 0) {
        // game is running, start it!
        socket.emit(CommandInit, objects.map(x=>shallow_stringify(x, true)))
    }
}


function init() {
    setup_utils();    
}

var loop_id;
function reset(leave_socket) {
    if (leave_socket) {
        sockets = [];
    }
    objects = [];
    hud = [];
    object_ht = {};

    objects.push(new Tower(0, NewVector(15,15,0), 0));
    objects.push(new Tower(1, NewVector(-15,-15,0), 0));
    objects.push(new Tower(0, NewVector(30,30,0), 1));
    objects.push(new Tower(1, NewVector(-30,-30,0), 1)); 
    
}

init();
