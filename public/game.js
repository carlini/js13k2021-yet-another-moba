// game.js -- the logic for the game objects

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

var objid=0;
function UID() {
    return SERVER+":"+(objid++);
}

var base_location = [NewVector(35,35,0),
                     NewVector(-35,-35,0)];
                     

class ClientObject {
    constructor() {
        this.cc_timer = undefined;
        this.uid = UID();
        this.health = 1;
        this.maxhealth = 1;
        this.shield = 0;
        this.position = ZERO;
    }
    setup() {
        this.sprites = [];
    }
    render() {
        this.sprites.map(x=>x.position = this.position);
        this.sprites.map(x=>x.rotation = this.rotation);
        this.sprites.map(x=>x.render());
    }
    is_cc() {
        return this.cc_timer && this.cc_timer > get_time();
    }
    /* In order to save a lot of space on data transmission, don't recurse
     * into sub-objects that have a UID and are in the object hash table
     * (those have already been sent separately, and we can just look them
     * up on the client side)
     */
    toJSON() {
        var d = {};
        for (var k of Object.keys(this)) {
            if (this[k] && this[k].uid && object_ht[this[k].uid]) {
                d[k] = {uid: this[k].uid};
            } else {
                d[k] = this[k];
            }
        }
        return d;
    }
    update() {}

    damage(amount, who, who2) {
        if (this.shield > 0) {
            this.shield -= amount;
            this.health += Math.min(this.shield,0);
        } else {
            this.health -= amount;
        }
        if (who instanceof Player || this instanceof Player || who instanceof Tower) {
            if (!(this instanceof Tower)) this.enemy = who;
            objects.push(new Hit2(this.position, 12*amount, 1, .8, .05))
        }
        if (this.health <= 0) {
            if (who instanceof Player) {
                sockets.map(x=>(x.player == who) && x.emit(CommandSound, 0));
                who.level += .2;
            }
            objects.map(x=>(x.side != this.side) && (x.level += .1));
            range(3).map(_=> {
                setTimeout(_=>
                           objects.push(new (who instanceof Player ? Hit2 : Hit)((who2||this).position.add(urandom_vector(2)), 10, 1.5, 1, .05, null)),
                           Math.random()*500);
            });

        }
        this.dead = this.health<=0;
    }

    client_die() {
        objects.push(...this.sprites.map(x=> new Spinner(x, this.position, multiply(this.rotation, x.rotation))));
    }
}

class Spinner extends ClientObject{
    constructor(sprite, position, rotation) {
        super();
        this.sprites = [sprite];
        this.spins = urandom_vector();
        this.velocity = Z_DIR.add(urandom_vector())._normalize();
        this.position = position;
        this.rotation = rotation;
        setTimeout(_=>this.dead = true, 10000);

        range(6).map(_=> {
            setTimeout(_=>
                       objects.push(new Hit(this.position, 10, 1.5, 1, .05, null)),
                       Math.random()*1000);
        });

    }
    update(dt) {
        var speed = (1+this.velocity.vector_length()) * .002  * dt;
        this.position = this.position.add(this.velocity.scalar_multiply(dt*.01));
        this.rotation = multiply(this.rotation,
                                 [matrix_rotate_xy(this.spins.x*speed),
                                  matrix_rotate_yz(this.spins.y*speed),
                                  matrix_rotate_xz(this.spins.z*speed)].reduce(multiply));
    }
    client_die() {} // NO RECURSION!
}

class Marker extends Sprite {
    constructor(track, length, angle, life, up) {
        super(load(all_sprites[2], NewVector(.1+length, .01, .01), NewVector(length/2,0,0)), ZERO,
              multiply(matrix_rotate_xy(angle),
                       matrix_rotate_xz(up||0)),
              [1,0,0])
        this.track = track;
        this.uid = UID()
        this.life = 10;
    }
    update() {
        this.life -= 1
        this.dead = this.life<0;
        this.position = this.track.position;
    }
}

var COLOR = [[.7, 0, 0], [0, 1, 1], [1,1,1]];
var color = [[.7, .2, .0], [0, .2, .7]];
var color2 = [[.7, .4, .4], [.4, .4, .7]];

class Tower extends ClientObject {
    constructor(side, where, is_spawn) {
        super();
        this.args = [...arguments];
        this._constructor = Tower.name;
        where.z = 3;
        this.position = where;
        this.rotation = matrix_rotate_yz(Math.PI);
        this.side = side;
        this.last_minion = 0;
        this.uid = "Tower-"+UID() // DEBUGONLY
        this.is_spawn = is_spawn;
        this.enemy = undefined;
        this.last_shoot = 0;
        this.health = this.maxhealth = 80;
    }

    setup() {
        this.sprites = [new Sprite(load(all_sprites[5], NewVector(5,5,3)), 0, 0, COLOR[this.side]),
                        ...range(3).map(i=>
                                        new Sprite(load(all_sprites[1], NewVector(.4,.4,4.2), 0,
                                                         multiply(matrix_rotate_xy(2*Math.PI/3*i),
                                                                  matrix_rotate_yz(Math.PI/2))),
                                                   0, 0, COLOR[this.side]))]
;
        hud.push(new HealthBar(this));
    }

    damage(amount, who) {
        super.damage(amount, who);
        if (this.dead && this.is_spawn && SERVER) {
            console.log("OVER");
            game_state = 1;
            sockets.map(x=> x.emit(CommandWin, 1-this.side));
        }
    }
    
    update(dt) {
        this.rotation = multiply(this.rotation, matrix_rotate_xy(.0005*dt));
        if (!SERVER) return;
        this.dead = this.health<0;
        if ((0|((last_now%20000)/7000)) == 0 && last_now-this.last_minion > 1200 && this.is_spawn) {
            objects.push(new Minion(this.side, this.position.scalar_multiply(.99).add(urandom_vector())))
            this.last_minion = last_now;
        }

        if (this.enemy) {
            if (last_now-this.last_shoot > 2000 && SERVER) {
                objects.push(new AutoAttack(this.enemy, this.position.add(Z_DIR), 10));
                this.last_shoot = last_now;
            }

            if (this.enemy.dead || this.position.distance_to(this.enemy.position) > 12) {
                this.enemy = 0;
                return
            }
        } else {
            // Find all potential targets
            var best_target = max_by(objects, x=> {
                var dist = x.position.distance_to(this.position);
                var v = (x instanceof Player)*1e6;
                return -(dist + v);
                
            }, x=>x.side != this.side && (x instanceof Minion || x instanceof Player) && this.position.distance_to(x.position) < 12);

            if (best_target) {
                this.enemy = best_target;
                this.last_shoot = get_time()-1500;
                sockets.map(x=>(x.player == best_target) && x.emit(CommandSound, 1));
            }
        }
        
    }
}

class HealthBar extends Sprite {
    constructor(tracking) {
        super([[0,0,0], [.85,0,0]], ZERO, 0, 0, 3)
        this.type = gl.POINTS;
        this.tracking = tracking;
        this.dead = undefined;
        this.z = (tracking instanceof Player);
    }
    update(dt) {
        this.dead = this.tracking.dead;
        this.position = this.tracking.position;
        this.a_normals[1] = this.tracking instanceof Player ? 5.5 : 1.5;  // height
        this.a_normals[2] = this.tracking instanceof Player || this.tracking instanceof Tower ? 100 : 50;  // size
        this.a_colors[0] = this.tracking.side;
        this.a_colors[1] = 0.8 * this.a_colors[1] + 0.2 *
            (this.tracking.health)/Math.max(this.tracking.maxhealth,
                                            this.tracking.health+this.tracking.shield);
        this.a_colors[2] = 0.8 * this.a_colors[2] + 0.2 *
            (this.tracking.health+this.tracking.shield)/Math.max(this.tracking.maxhealth,
                                                                 this.tracking.health+this.tracking.shield);
        this.rebuffer();
    }
}

class Player extends ClientObject {
    constructor(side, type) {
        super()
        this.args = [...arguments];
        this._constructor = Player.name;
        this.position = base_location[this.side=side]||ZERO;
        this.rotation = IDENTITY;
        this.type = type
        this.level = 0;

        this.movefn = undefined;
        this.uid = "Player-"+UID() // DEBUGONLY
        this.maxhealth = this.health = 70 - type*22;
        this.size = (this.type==0)*2+1
    }

    setup() {
        hud.push(new HealthBar(this));
        this.sprites = [new Sprite(load(all_sprites[[8,7,0][this.type]], 5+(this.type==0)*2, NewVector(0, [0,0,1][this.type], 0), matrix_rotate_xy(Math.PI)),
                                   0, 0, COLOR[this.side]),
                        new Sprite(load(all_sprites[[8,7,0][this.type]], 5+(this.type==0)*2, NewVector(0, [0,0,1][this.type], 0), matrix_rotate_xy(Math.PI)),
                                   0, 0, COLOR[this.side]),
                        new Sprite(load(all_sprites[6], 1.8, NewVector(0, -1.5-(this.type==0), 0), matrix_rotate_xy(Math.PI)),
                                   0, 0, COLOR[this.side]),
                       
                       ]
        if (this.type != 0)
            this.sprites.push(new Sprite(load(all_sprites[3], 3, 0, matrix_rotate_xy(Math.PI)),
                                    0, 0, COLOR[this.side]));
        particles.push(new Tracer(this, .3, Y_DIR.scalar_multiply(2.5+(!this.type))));
    }

    update(dt) {
        if (SERVER)  {
            this.dead = this.health <= 0;
        }

        // TODO SPACE
        if (this.movefn) {
            [this.rotation, this.position] = this.movefn.act(get_time(), dt);
        }
    }
}



class Minion extends ClientObject {
    constructor(side, where) {
        super()
        this.args = [side, where];
        this._constructor = Minion.name;
        
        where = (where || ZERO).add(Z_DIR);
        this.position = where;
        this.position.z = 0;

        this.way = NewVector(side*2-1,side*2-1,0)
        this.movefn = linear_move(where,
                                  IDENTITY,
                                  where.add(this.way.scalar_multiply(100)),
                                  5);
        
        this.rotation = IDENTITY;
        this.side = side;
        this.last_shoot = 0;
        this.maxhealth = this.health = 11;
        this.uid = "Minion-"+UID() // DEBUGONLY
        this.enemy = undefined;
    }

    setup() {
        this.sprites = [new Sprite(load(all_sprites[3], 2, 0, matrix_rotate_xy(Math.PI)), 0,
                                   0, COLOR[this.side]),
                        new Sprite(load(all_sprites[4], 3, 0, matrix_rotate_xy(Math.PI)), 0,
                                   0, COLOR[this.side]),
                        new Sprite(load(all_sprites[6], .8, NewVector(0,.8,0)), 0,
                                   0, COLOR[this.side]),
                       ];
        particles.push(new Tracer(this, .1, Y_DIR));

        hud.push(new HealthBar(this));
    }

    make_decision() {

        if (Math.abs(this.position.x - this.position.y) > 15) {
            this.enemy = /*HACK*/undefined;
            this.movefn = this.move_to(NewVector((this.position.x+this.position.y)/2,
                                                 (this.position.x+this.position.y)/2,
                                                 0));
        } else if (this.enemy && this.enemy.position) {
            var distance = this.enemy.position.distance_to(this.position);
            if (!(this.enemy instanceof ClientObject) || this.enemy.dead
                || distance > 13) {
                this.enemy = /*HACK*/undefined;
                // Lose the target, they're too far
            }
        } else {
            // No enemy right now
            var close_enemy = objects.filter(x=> (x.side == 1-this.side) && x.position.distance_to(this.position) < 12
                                             && (x instanceof Minion || x instanceof Player || x instanceof Tower));
            if (close_enemy.length) {
                this.enemy = max_by(close_enemy, x=>-x.position.distance_to(this.position));
                var dist_to_enemy = this.position.distance_to(this.enemy.position);
                if (dist_to_enemy > 7)
                    this.move_to(this.position.moveto(this.enemy.position, dist_to_enemy/4))
            } else if (!this.movefn || this.movefn.isdone(get_time())) {
                this.movefn = linear_move(this.position,
                                          this.rotation,
                                          this.position.add(this.way.scalar_multiply(100)),
                                          5);
                
            }
        }

        if (this.enemy) {
            var next_pos = (this.movefn && this.movefn.act(get_time()+500)[1]) || this.position;
            var dist_to_enemy = this.position.distance_to(this.enemy.position);
            if (dist_to_enemy > 8) {
                if (!this.movefn || next_pos.distance_to(this.enemy.position) >= this.position.distance_to(this.enemy.position)) {
                    // If I'm far from the enemy, and I'm not already moving towards them...
                    this.move_to(this.position.moveto(this.enemy.position,
                                                                    dist_to_enemy/3));
                }
            } else {
                // Close enough to shoot
                if (last_now-this.last_shoot > 950 && SERVER) {
                    objects.push(new AutoAttack(this.enemy, this.position, 1));
                    this.last_shoot = last_now;
                    this.movefn = linear_move_withtime(this.position, this.rotation, this.position.moveto(this.enemy.position,.001), 1, get_time());
                    
                }
            }
        }        
    }

    move_to(goal) {
        for (var d = 0; d < 1000; d++) {
            var target = goal.noz().add(urandom_vector(d**.5).noz());
            // Is it okay to move to target?
            if (objects.every(x=>(x == this) || !(x instanceof Minion) || target.distance_to((x.movefn && x.movefn.act(1e90)[1]) || x.position) > 3)) {
                //console.log("Moving to", goal, target);
                return this.movefn = linear_move_withtime(this.position, this.rotation,
                                                          target, 5, get_time());
            }
        }
    }
    
    update(dt) {
        if (this.position.vector_length() > 100) this.dead = true;
        var ignore;
        if (this.movefn) {
            [this.rotation, this.position] = this.movefn.act(get_time(),dt);
        }

        if (!this.is_cc() && SERVER) {
            this.make_decision();
        }
    }
}

class AutoAttack extends ClientObject {
    constructor(target, where, power) {
        super()
        this.args = [...arguments];
        this._constructor = AutoAttack.name;
        this.movefn = linear_follow(this.position=where, IDENTITY, this.target=target, 20);
        this.rotation = IDENTITY;
        this.uid = "AutoAttack-"+UID() // DEBUGONLY
        this.power = power;
        this.side = 1-target.side;
        setTimeout(_=>this.dead=true,10000);
    }
    setup() {
        this.part = new ParticleSystem(100, .15, [.3 + this.power/15, .2, 1], color[this.side],
                                       () => [this.position, urandom_vector(.02)]);
        this.part.max_spawn = 8;
        this.part.die_with = this;
        this.sprites = [];
        particles.push(this.part);
    }
    update(dt) {
        if (!this.target || !this.target.position) {
            if (SERVER) this.dead = true;
            return;
        }
        this.position = this.movefn.act(get_time(), dt)[1];
        //console.log("Moving to", this.position, this.target.position);
        if (SERVER) {
            this.dead |= this.target.dead;
            if (this.position.distance_to(this.target.position) < .01) {
                this.target.damage(this.power, this);
                this.dead = true;
            }
        }
    }
}

class RangedAttack extends ClientObject {
    constructor(where, target, owner, kind) {
        super()
        console.log("Make", kind);
        this.args = [...arguments];
        this._constructor = RangedAttack.name;
        this.position = where;
        this.direction = mat_vector_product(matrix_rotate_xy(target.angle(ZERO)), Y_DIR);
        this.rotation = IDENTITY;
        this.uid = "RangedAttack-"+UID() // DEBUGONLY
        this.owner = owner;
        this.side = this.owner.side;
        var speed;
        var distance;
        this.kind = kind;
        if (kind == 0) {
            speed = 15;
            distance = 15;
        } else if (kind == -1) {
            speed = 7;
            distance = 20;
        } else {
            speed = 30; // cone or standard
            distance = 7;
        }
        this.movefn = linear_move_withtime(where, 0,
                                           kind == -1 ? this.position.moveto(target, 15) : this.position.add(target.scalar_multiply(distance)),
                                           speed, get_time());
        this.live_time = get_time();
        this.hits={};
    }

    setup() {
        this.part = new ParticleSystem(500, .4-(this.owner.type==2 && !this.kind)/5, [.3, .4+this.kind/3 + (this.owner.level>>2)/15, 1], color[this.side],
                                       _ => this.kind == 1 ?
                                       [this.position.add(this.direction.scalar_multiply(urandom()*(get_time()-this.live_time)/100)), urandom_vector(.02)]
                                       : 
                                       [this.position, urandom_vector(.02)] );
        this.part.max_spawn = 10;
        this.part.die_with = this;
        this.sprites = [];
        particles.push(this.part);
    }
    
    update(dt) {
        //console.log(this.movefn.act(get_time()));
        this.position = this.movefn.act(get_time())[1];
        //console.log(this.movefn);
        if (SERVER) {
            if (this.movefn.isdone(get_time())) {
                if (this.kind == -1) {
                    objects.push(new Boom(this.position, this.side));
                    objects.map(other => {
                        if (other.position.distance_to(this.position) < 4.5
                            && (other instanceof Minion || other instanceof Player)
                            && this.side != other.side) {
                            other.damage(4+2*(this.owner.level>>2), this.owner);
                        }
                    })
                }
                this.dead = 1;
            }
            objects.map(other => {
                var dst = other.position.distance_to(this.position);
                //mat_vector_product(matrix_rotate_xy(Math.PI/2), this.direction)
                var dst_along_parallel = Math.abs(this.direction.dot(this.position.subtract(other.position)));
                var width = (get_time()-this.live_time)/100;
                //if (other instanceof Minion && this.side != other.side) {
                //    console.log(dst, dst_along_parallel, width);
                //}
                if (dst-Math.min(width, dst_along_parallel)*(this.kind) < 1.5 + (other.size||0) &&
                    (other instanceof Minion || other instanceof Player || other instanceof Tower) &&
                    this.owner.side != other.side &&
                    !this.hits[other.uid]) {
                    var dist_scale = this.kind ? 1.5/Math.max(width,1) : 1;
                    other.damage(dist_scale * (2 + .5*(this.owner.level>>2)) * (3-this.owner.type/2), this.owner, this);
                    if (!this.kind) this.dead = true;
                    this.hits[other.uid] = true;
                }
            })
        }
    }
}

class TractorBeam extends ClientObject {
    constructor(src, dst, duration) {
        super();
        this.args = [...arguments];
        this._constructor = TractorBeam.name;
        this.src = src;
        this.dst = dst;
        setTimeout(_=>this.dead = true, duration);
    }
    setup() {
        this.part = new ParticleSystem(this.src.distance_to(this.dst.position)*80, .3, [.2, .2, 1], color2[1-this.dst.side],
                                       _ =>
                                       [this.src.lerp(this.dst.position,
                                                               Math.random()),
                                        this.src.subtract(this.dst.position)._normalize().scalar_multiply(.1)]);
        this.part.max_spawn = this.src.distance_to(this.dst.position)*2;
        this.part.die_with = this;
        particles.push(this.part);
        this.sprites=[]
    }
}

class Boom extends ClientObject {
    constructor(position, side) {
        super()
        this.args = [...arguments];
        this._constructor = Boom.name;
        this.uid = "Nuke-"+UID() // DEBUGONLY
        setTimeout(_=> this.dead=1, 400)
        this.position = position;
        this.side = side;
    }

    setup() {
        this.part = new ParticleSystem(400, .6, [.3, .5, 1], color[this.side],
                                       _ =>
                                       [this.position.add(urandom_vector()._normalize().scalar_multiply(2)), urandom_vector()._normalize().noz().scalar_multiply(.25), 1])
        
        this.part.max_spawn = 20;
        this.part.die_with = this;
        play(sounds.boom2, .4);
        play(sounds.rumble, .4);
        particles.push(this.part);
        this.sprites=[]
    }
}


class HealAnimation extends ClientObject {
    constructor(who) {
        super();
        this.args = [...arguments];
        this._constructor = HealAnimation.name;
        setTimeout(_=>this.dead = 1, 300);
        this.target = who;
        this.uid = "HealAnimation-"+UID(); // DEBUGONLY
    }

    setup() {
        this.sprites = [];
        this.part = new ParticleSystem(500, .3, [.2, .5, 1], [.1, .3, .2],
                                       _ =>
                                       [urandom_vector(.5).add(Z_DIR.scalar_multiply(1)), urandom_vector(.1).add(Z_DIR.scalar_multiply(.1))]);
        this.part.max_spawn = 30;
        this.part.die_with = this;
        particles.push(this.part);
    }
    update() {
        if (!SERVER) this.position = this.part.position = this.target.position;
    }
}

var CD_UID = 0;
class Cooldown extends Sprite {
    constructor(cd, index) {
        super([[-.4 + (CD_UID++)/6,-.8,0], [1,0,0]], ZERO, 0, 0, 10);
        this.cd = cd;
        this.type = gl.POINTS;
        this.z = 9;
        this.index = index;
    }
    update(dt) {
        if (this.a_normals[0] == 2) console.log(last_level >= this.index, (this.a_normals[0]+dt/1000/this.cd));
        this.a_normals[0] = last_level >= this.index && (this.a_normals[0]+dt/1000/this.cd);
        this.rebuffer();
    }
}

class GoTo extends Sprite {
    constructor(location) {
        var r = load(all_sprites[2], NewVector(2,2,.001));
        r[1].fill(local_time);
        setTimeout(_=>this.dead = true, 500)
        super(r, location, 0, 0, 5);
        
    }
    update(){}
}

class Hit extends ClientObject {
    constructor() {
        super();
        this.args = [...arguments];
        this._constructor = Hit.name;
        this._wait = get_time()+arguments[2]*900
        if (!SERVER) {
            play(sounds.boom2, .2);
            var h = new HitSprite(...arguments);
            h.die_with = this;
            particles.push(h);
            this.sprites = [];
        }
    }
    update(dt) {
        super.update(dt);
        this.dead = this._wait < get_time();
    }
}

class Hit2 extends Hit {
    constructor() {
        super(...arguments);
        this.args = [...arguments];
        this._constructor = Hit2.name;
        if (!SERVER && !game_state) {
            play(sounds.boom2, 1);
        }
    }
}

function Ability(cooldown, help, act_fn, noise, cando2) {
    var index = ability_text.length;
    ability_text.push(help)
    var timer = -1e6;

    var hud_cd = new Cooldown(cooldown, index);
    hud.push(hud_cd);
    
    return {
        can_do: goal => last_level >= index && last_now > timer+cooldown*1000 && (cando2||(_=>true))(goal),
        q: hud_cd,
        act: goal => {
            act_fn(goal);
            timer = last_now;
            hud_cd.a_normals[0] = 0;
            noise && play(noise,1);
        }
    }
}

function dot(action, count, delay) {
    range(count).map(i=>setTimeout(_=>action(i), delay*i));
}

function MultiFireAbility() {
    return Ability(3, `Shoot 4 quick shots`,
                   goal => dot(i=>{
                       socket.emit(CommandFire,
                                   me.position.add(mat_vector_product(me.rotation, NewVector((i%2)*3-1.5,-2,0)))._xyz(),
                                   mouse_target.subtract(me.position.add(mat_vector_product(me.rotation, NewVector((i%2)*3-1.5,-2,0)))).noz()._normalize()._xyz());
                       play(sounds.lazer, 1);
                   },
                               4, 200));
}

function RangedAbility(cd, kind) {
    return Ability(cd, [`Shoot in target direction`, `Launch an exploding missile at target`][0|(kind<0)],
                   goal => socket.emit(CommandFire,
                                       me.position._xyz(),
                                       (kind==-1 ? goal : goal.subtract(me.position).noz()._normalize())._xyz(),
                                       kind),
                   kind<0?sounds.lazer:sounds.lazer2);
}

function find_by(goal, xor) {
    return find_nearest_object(goal,
                               x=>(xor^x.side!=me.side) && (x instanceof Player || x instanceof Minion),
                               x=>1+(x instanceof Player))
}

function HealAbility() {
    return Ability(6, `Heals target ally`,
                   goal=> socket.emit(CommandHeal, find_by(goal, 1)[0].uid, 5 + 3*(me.level>>2)),
                  sounds._heal);
}

function DivertAbility() {
    return Ability(15, `Divert all incoming attacks`,
                   goal=> socket.emit(CommandDivert, me.position))
}

function ShieldAbility(usegoal) {
    return Ability(5, [`Shield yourself`,`Shield target ally`][usegoal],
                   goal=> socket.emit(CommandShield, usegoal ? find_by(goal, 1)[0].uid : me.uid, 20 + 10*(me.level>>2)),
                  sounds.shield);
}

function StunAbility() {
    return Ability(13, `Stun target enemy`,
                   goal=> socket.emit(CommandStun,
                                      find_by(goal)[0].uid,
                                      2000),
                   null,
                   goal => find_by(goal)[1] < 5);
}


function SpeedAbility() {
    return Ability(7, `Speed boost in target direction`,
                   goal=> {
                       socket.emit(CommandMove,
                                   me.movefn = linear_move_withtime(me.position,
                                                                    me.rotation,
                                                                    me.position.moveto(goal,10),
                                                                    50,
                                                                    get_time(),
                                                                   ));
                       me.cc_timer = get_time() + 300;
                       socket.emit(CommandShield, me.uid, 5 + 5*(me.level>>2))
                   },
                   sounds.shield,
                  _=>!me.movefn._force);
}

function make_tp(who, goal) {
    who = object_ht[who];
    goal = NewVectorFromList(goal)
    me.movefn = /*HACK*/undefined;
    dot(i => // TODO SPACE float32 should move to rebuffer?
        who.sprites.map((_,j) => {
            who.sprites[j].a_positions = new Float32Array(who.sprites[j].b_positions.flat().map(x=>x.scalar_multiply(Math.abs(i-20)/20)._xyz()).flat());
            // And now we just how the server sends the TP at the right time 200 ms later
            who.sprites[j].rebuffer();
        }), 40, 10)
}

// todo move this to receive
function TeleportAbility() {
    return Ability(13, `Teleport to target location`,
                   goal=>socket.emit(CommandTP, goal._xyz()));
}

function DamageEffect() {
    var sprite = new Sprite(load(all_sprites[2], 10), ZERO, 0, [.1, 0, 0], 7)
    sprite.update = _ => {
        sprite.position = camera_position;
        sprite.a_colors = new Float32Array(Array(48*3).fill(global_screen_color).flat());
        sprite.rebuffer();
    }
    return sprite;
}


function choose_abilities() {
    ability_text = [];
    CD_UID = 0;
    abilities = [
        // tank
        _=>[RangedAbility(.75,0),
            ShieldAbility(0),
            RangedAbility(3, -1),
            StunAbility()],
        // healer
        _=>[RangedAbility(.75,0),
            HealAbility(),
            ShieldAbility(1),
            DivertAbility()],
        // assassin
        _=>[RangedAbility(.75, 1),
            SpeedAbility(),
            MultiFireAbility(3),
            TeleportAbility()]
    ][player_type]();
    // For those who like this better
    [abilities.q, abilities.w, abilities.e, abilities.r] = abilities;
    abilities.unshift(0)
    rQ.style.display="block"
}

var ability_text;

function setup_game() {
}

