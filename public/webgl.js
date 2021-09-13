// main.js -- the main init and game loop

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


function startclient(){}
/*HACK*/startclient(); 
var gl;

var objects;
var object_ht={};
var particles;
var camera;
var camera_position;
var camera_rotation;
var proj_mat;
var hud;
var last_now = 0;
var screenshake = 0;
var last_health = 0;
var mouse_target;

var program;
var locations;

var keys = {};
var game_state;
var game_winner;

var socket;

var abilities = {};

function seval(x) {
    socket.emit(CommandEval, x);
}

/* Main game setup.
 * When the game loads, hook the keybindings and start the game loop.
 */
function main_run() {
    setup_audio();
    setup_graphics();
    main_go();
    gQ.style.display="block";

    game_state = -2; // choose character
    qQ.style.display="none";
    setTimeout(_=>game_step(1),0);
    cU0.onclick = _=>choose(0);
    cU1.onclick = _=>choose(1);
    cU2.onclick = _=>choose(2);
    rQ0.onmouseover=_=>showability("",0,4000);
    rQ1.onmouseover=_=>showability("",1,4000);
    rQ2.onmouseover=_=>showability("",2,4000);
    rQ3.onmouseover=_=>showability("",3,4000);
    window.oncontextmenu= x=>x.preventDefault();
}

var player_type;
/* Do the finishing steps to make the game.
 * To see steps 1-4 look below, we're going to start from 5:
 * 5. Set up the sockets with the server
 * 6. Which then causes the server to send the CommandInit
 * 7. And then the client responds with a request to make a new character
 * 8. And the server responds by actually doing it
 */
function choose(type) {
    objects.map(x=>x.dead = true);
    player_type = type;
    play(sounds.rumble, 1);
    setup_socket();
    gQ.style.display="none";
}

var ping; // DEBUGONLY

/* Receive the update from the server for what should be where
 */
function do_update(object_updates, make_me) {
    packets.push(JSON.stringify(object_updates).length); // DEBUGONLY
    objects.map(o => object_ht[o.uid] = o);
    
    object_updates.map(update=> {
        var clientobj = object_ht[update.uid]
        if (clientobj) {
            Object.keys(update).map(k => {
                var value = fix_json(update[k])
                if (!(clientobj == me && value && value._function == linear_move_withtime.name && !value._force))
                    clientobj[k] = value;
            })
            objects.filter(x=>x==clientobj).length || (objects.push(clientobj),console.log("Pushed me!"));
        } else {
            var fixed = fix_json(update);
            fixed.setup && fixed.setup(); // TODO SPACE use ?.
            objects.push(fixed);
            if (make_me) {
                me = fixed;
                last_health = me.health;
                hud[hud.length-1].z += 1; // My health bar goes on top
            }
        }
    });
}

var qqtimer = null;
function showqq(text, time) {
    console.log("Show", text);
    qqtimer && clearTimeout(qqtimer);
    gQ.style.display="block"
    gQ.innerText=text
    qqtimer = setTimeout(_=>gQ.style.display="none", time);
}

function showability(prefix, which, t) {
    wQ.style.display="block"
    wQ.innerText = prefix+" " + ability_text[which] + "\n"+"Press " + (1+which) + " to use";
    setTimeout(_=>wQ.style.display="none", t);
}

/* Sockets!
 */
function setup_socket() {
        
    socket = io({ upgrade: false, transports: ["websocket"] });
    
    setInterval(_=> {
        socket.emit(CommandPing, get_time())
    }, 1000)

    /* 
       It's important everyone is on the same time, so that we can synchronize things.
       To do this we're going to keep track of our time and server time ..
       ... and adjust when we've made errors.
     */
    socket.on(CommandPong, (send_time, server_time) => {
        var arrive_time = (send_time+get_time())/2
        clock_drift += server_time - arrive_time;
        ping = get_time() - send_time; // DEBUGONLY
    });

    socket.on(CommandReplyTP, make_tp)
    
    socket.on(CommandResponse, (x) => { // DEBUGONLY
        console.log("EVAL:", x); // DEBUGONLY
    }); // DEBUGONLY

    
    socket.on(CommandSound, x => play(sounds[x], .7));
    
    socket.on(CommandWaitToStart, time => {
        showqq("Game starting in " + (1+(0|time/1000)) + " seconds", 1000);
    });
    
    socket.on(CommandInit, objs => {
        reset(0);
        setup_game();
        choose_abilities();
        socket.emit(CommandNewMe, player_type, false);
        do_update(objs)
        /*
          Okay so this is going to be really ugly. 
          We just got the objects parsed, but maybe we have a list
          [obj1 [such that target=obj2], obj2]
          where the first object contains a pointer to obj2.
          Except we don't know what obj2 is when we're processing obj1.
          
          Now we *could* try to do some kind of toplogical sort, and hope that
          the graph is acyclic---which it's probably not.

          OR..... we could just update twice and know the objets will all be
          created in the first pass and the second time around will backpatch
          to the object references.
         */
        do_update(objs) 
        game_state = 0;
    })

    socket.on(CommandRevive, update => {
        do_update([update], 1);
        socket.emit(CommandMove, stop_fn(base_location[me.side],matrix_rotate_xy(2.3)));
    });

    socket.on(CommandUpdate, do_update);

    var errfn = _=> {
        alert("Lost connection; reloading.");
        document.location="";
    };

    socket.on(CommandWin, side => {
        showqq(side == me.side ? "Victory!" : "Defeat. :(", 3000)
        game_state = 1;
        game_winner = side;
    });
    
    socket.on("connect_failed", errfn);
    socket.on("connect_error", errfn);
    socket.on(CommandCrash, errfn);
    window.onresize=errfn;
}



var mouse_x;
var mouse_y;
var screen_x;
var screen_y;


function main_go() {

    window.onkeydown = e => (keys[e.key] === undefined) && (keys[e.key] = true);
    window.onkeyup = e => delete keys[e.key];
    
    screen_x = document.body.offsetWidth;
    screen_y = document.body.offsetHeight;

    cQ.onmousemove = (e => {
        mouse_y = e.clientY;
        mouse_x = e.clientX;
    });

    cQ.onmousedown = k => keys._ = true;
    
    reset(1);
    
}

/* Reset the level and start up a new camera.
 */
function reset(add) {
    camera = Camera();
    camera_position = ZERO;
    objects = [];
    particles = [];
    object_ht = {};
    is_dead = null;
    hud = []
    global_screen_color=[0,0,0]
    setup_game();
    
    backdrop = new Sprite(load(all_sprites[2], NewVector(1000, 1000, 1)),
                          NewVector(0,0,-1),
                          0, [1, 1, 1], 4);

    var points = range(90).map(_=> urandom_vector(32)._xyz()).flat();
    glitter = new Sprite([points, Array(90).fill([.3, .4, .4]).flat()], ZERO, IDENTITY, [.5,.05,.5], 2);
    glitter.type = gl.POINTS;
    range(90).map(x=>glitter.a_settings[x*3+1] = 1e6);
    glitter.rebuffer()

    // Spawn each of the players we can choose
    range(3*add).map(i => {
        var next = new Player(0, i);
        next.position = NewVector(15-i*15, 3, 0);
        next.setup();
        objects.push(me=next);
        next.update = _=>next.rotation = matrix_rotate_xy(get_time()/2000)
    });
    // But get rid of their health bars
    hud = [DamageEffect()];
    

    camera_rotation = matrix_rotate_yz(-.9);
                               
}

var GRAPHICS = 1;

class RunningAverage { // DEBUGONLY
    constructor(n) { // DEBUGONLY
        this.count = 0; // DEBUGONLY
        this.n = n; // DEBUGONLY
    } // DEBUGONLY
    update(val) { // DEBUGONLY
        this.count = this.count * (1 - 1./this.n) + val; // DEBUGONLY
        return Math.round(this.count/this.n*100)/100; // DEBUGONLY
    } // DEBUGONLY
} // DEBUGONLY

var fps = new RunningAverage(10); // DEBUGONLY
var actual_fps = new RunningAverage(10); // DEBUGONLY
var packets = []; // DEBUGONLY
var packets_size = 0; // DEBUGONLY
var packets_reset = 0; // DEBUGONLY
var running_sprites = new RunningAverage(10); // DEBUGONLY
var running_verts = new RunningAverage(10); // DEBUGONLY
var global_screen_color;
var me;

var minor_badness = 0; // DEBUGONLY
var total_badness = 0; // DEBUGONLY
var packet_size = 0; // DEBUGONLY

var frame = 0;
var dead_time = 0;
var backdrop;

var local_time = 0;
var last_level;

var paused = 0; // DEBUGONLY

/* Main game loop.
 * This is quite ugly in order to be nicely compressable, 
 * as we do all of the work right in this loop top-to-bottom.
 * (Insetad of just a simple update-render loop.)
 */
function game_step(now) {
    requestAnimationFrame(game_step);
    
    if (keys.p) { // DEBUGONLY
        paused = !paused; // DEBUGONLY
        delete keys.p // DEBUGONLY
    } // DEBUGONLY

    if (paused) return; // DEBUGONLY

    
    frame += 1;
    var dt = now-last_now;
    local_time += dt;

    var mouse_dx = (mouse_x/screen_x-.5);
    var mouse_dy = (.5-mouse_y/screen_y);

    
    objects.map(x=>x.update && x.update(dt));
    particles.map(x=>x.update(dt));
    hud.map(x=>x.update && x.update(dt));
    var camera_off = NewVector(4*(2*me.side-1),16*(1-2*me.side),20);
    if (game_state == 0) { // normal

        if (last_level != (0|me.level)) {
            last_level = 0|me.level;

            showability(last_level < 4 ? "New Ability:" : "Upgraded Ability:", last_level%4, 10000);
            socket.emit(CommandHeal, me.uid, 10)
            // Immediately we can use this ability
            abilities[last_level+1] && (abilities[last_level+1].q.a_normals[0] = 2);
        }
        if (me.health < last_health) {
            var amt = (last_health - me.health)/me.maxhealth*80;
            screenshake += amt**.5/400;
            play(sounds.bass, amt/10)
            last_health = me.health;
        }
        
        if (me.health <= 0) {
            camera_target = max_by(objects, x=>(2*me.side-1)*(x.position.x+x.position.y)+(x.side == me.side)*1e6-(x instanceof AutoAttack)*1e6).position;
            if (!me.fully_dead) {
                setTimeout(_=> {
                    // Yes, making the client responsible for reviving the player is awful.
                    // But it's just so much shorter and easier.
                    // Deal with it.
                    socket.emit(CommandNewMe, player_type, true);
                }, 10000)
                me.fully_dead = 1 // make sure to do this only once
                //range(10).map(i=>
                //              setTimeout(_=>showqq("Respawning in " + (10-i),1000),i*1000));
                var ll = 10+(last_level>>2);
                dot(i=>showqq("Respawning in " + (ll-i), 1000), ll, 1000);
            }

        } else {
            dead_time = 0;

            var mouse_position_3d = mat_vector_product(proj_mat||IDENTITY, NewVector(mouse_dx*2e5, mouse_dy*2e5, 1e5, 1e5)).add(camera_position);

            var realcamera_position= camera_position.subtract(mat_vector_product(camera_rotation, NewVector(0,1,0)));

            var goal = realcamera_position;
            while (goal.z > 0) {
                goal = goal.moveto(mouse_position_3d, .1);
            }

            goal.z = 0;
            mouse_target = goal;

            
            for (var x in abilities) {
                if (keys[x]) {
                    if (abilities[x].can_do(goal)) {
                        abilities[x].act(goal);
                    } else {
                        if (!sounds._nope.okayplay || sounds._nope.okayplay < last_now) {
                            sounds._nope.okayplay = last_now + 300;
                            play(sounds._nope, )
                            setTimeout(_=>play(sounds._nope, 1), 100);
                            
                        }
                    }
                    keys[x] = 0;
                }
            }
            
            if (keys._ && me.type != null) {
                if (!me.is_cc())  {
                    goal = ZERO.moveto(goal, 62); // no going out of bounds.
                    me.movefn = linear_move_withtime(me.position,
                                                     me.rotation,
                                                     goal,
                                                     8+2*me.type,
                                                     get_time());
                    particles.push(new GoTo(goal));
                    
                    socket.emit(CommandMove, me.movefn)
                }
                delete keys._;
            }
            

            camera_target = me.position;
        }

        camera_position = camera_position.add(camera_target.add(camera_off).subtract(camera_position).scalar_multiply(.05));
    } else if (game_state == 1) { // dead
        camera_position = camera_position.moveto(base_location[1-game_winner].moveto(ZERO,5).add(camera_off), 1)
    } else if (game_state == -2) { // setup
        camera_position = NewVector(0,22,22);
    }
        

    // EARTHQUAKE!
    camera_rotation = [matrix_rotate_xy((1-me.side)*Math.PI),
                       matrix_rotate_yz(-.9),
                       matrix_rotate_xy(urandom()*screenshake),
                       matrix_rotate_yz(urandom()*screenshake),
                       matrix_rotate_xz(urandom()*screenshake)].reduce(multiply)
    screenshake *= .92;
    global_screen_color = [1, 0, (screenshake**.7)*3];


    objects.map(x=>x.dead && x.client_die && !game_state && x.client_die());
    objects = objects.filter(x=>!x.dead);
    hud = hud.filter(x=>!x.dead);
    particles = particles.filter(x=>!x.dead);

    camera();
    
    if (packets_reset < +new Date()) { // DEBUGONLY
        packets_reset = 1000+(+new Date()); // DEBUGONLY
        packets_size = packets.reduce((a,b)=>a+b, 0); // DEBUGONLY
        packets = []; // DEBUGONLY
    } // DEBUGONLY

    document.getElementById("fps").innerText = "ms/frame: " + fps.update(performance.now()-now) + "\nFPS: " + actual_fps.update(1000./(now-last_now)) + "\nParticles: " + objects.length + "\nNetwork Traffic: " + (Math.round(packets_size/1024*100)/100) +"kbps" + "\nminor badness: " + Math.round(minor_badness*100)/100 + "\ntotal badness: "+(Math.round(total_badness*100)/100) + "\nping: " + ping + "ms"; // DEBUGONLY

    last_now = now;
}

function set_resolution(j) {
    cQ.height = (cQ.width = 3200>>(0|(GRAPHICS=clamp(j,0,6))/2))/window.innerWidth*window.innerHeight;
}

function setup() {
    // That PhD in computer security is really paying off here.
    console./*HACK*/log("Please don't cheat.");

    gl = cQ.getContext("webgl2"); // QQ
    set_resolution(2);
    main_run();
}

/* So this is where everything start. The logic goes like this
 * 1. Wait for window load. When that happens, then ...
 * 2. Go fetch the 'z' file, which holds the compressed object data
 * 3. And when that happens, then draw the load screen with the character select
 * 4. (Then go see the actual game setup above.)
 */
window.onload = _=>fetch("z").then(data=>
                data.arrayBuffer().then(x=>
                                        setup_sprites(Array.from(new Uint8Array(x)).map(y=>y.toString(2).padStart(8,0)).join(""))));
