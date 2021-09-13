// utils.js -- a collection of short functions used throughout

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


var CommandEval="CommandEval",CommandDisconnect="CommandDisconnect",CommandMove="CommandMove",CommandTeleport="CommandTeleport",CommandPing="CommandPing",CommandPong="CommandPong",CommandFire="CommandFire",CommandNuke="CommandNuke",CommandUpdate="CommandUpdate",CommandKillPlayer="CommandKillPlayer",CommandResponse="CommandResponse",CommandGrab="CommandGrab",CommandReset="CommandReset", CommandInit="CommandInit"; CommandRevive="CommandRevive"; CommandNewMe="CommandNewMe"; CommandHeal="CommandHeal"; CommandWin="CommandWin"; CommandWaitToStart="CommandWaitToStart"; CommandCrash="CommandCrash";CommandShield="CommandShield",CommandStun="CommandStun",CommandSound="CommandSound",CommandDivert="CommandDivert",CommandTP="CommandTP";CommandReplyTP="CommandReplyTP"; // DEBUGONLY

var NewVector = (a,b,c,d) => new Vector(a,b,c,d);
var NewVectorFromList = (x) => NewVector(...x); // TODO space need this?

var range = (N,a) => Array(N).fill().map((_,x)=>x+(a||0));

var transpose = (mat) => mat[0].map((x,i) => mat.map(x => x[i]))

var reshape = (A,m) => 
    range(A.length/m).map(x=>A.slice(x*m,(x+1)*m));

var urandom = _ => Math.random()*2 - 1;
var urandom_vector = n => NewVector(urandom()*(n=n||1),urandom()*n,urandom()*n)

var max_by = (list,fn,filter) => (list.filter(filter||(_=>1)).map(x=>[x,fn(x)]).sort((a,b)=>b[1]-a[1])[0]||[undefined])[0];

var matrix_rotate_xy = (theta) => 
    [Math.cos(theta), -Math.sin(theta), 0, 0,
     Math.sin(theta), Math.cos(theta), 0, 0,
     0, 0, 1, 0,
     0, 0, 0, 1];

var time_offset = 0;
var clock_drift = 0;
function get_time() {
    return +new Date() + time_offset + clock_drift;
}

var multiply, mat_vector_product;

var normal_to_plane = (a,b,c) =>
    (a.subtract(b).cross(c.subtract(b)))._normalize();

var clamp = (x,low,high) => Math.min(Math.max(low, x), high)
var sum = (x) => x.reduce((a,b)=>a+b)

var matrix_rotate_yz = (theta) => 
    [1,0,0,0,
     0,Math.cos(theta), -Math.sin(theta), 0,
     0,Math.sin(theta), Math.cos(theta), 0,
     0, 0, 0, 1];

var matrix_rotate_xz = (theta) => 
    [Math.cos(theta),0,-Math.sin(theta),0,
     0, 1, 0, 0,
     Math.sin(theta),0, Math.cos(theta), 0,
     0, 0, 0, 1];



var IDENTITY = matrix_rotate_xy(0);

class Vector {
    constructor(x, y, z, w) {
        this.x = +x||0;
        this.y = +y||0;
        this.z = +z||0;
        this.w = +w||0;
        this._constructor = Vector.name;
    }


    add(other) {
        return NewVector(this.x+other.x,
                         this.y+other.y,
                         this.z+other.z)
    }
    
    subtract(other) {
        return this.add(other.negate())
    }
    
    negate() {
        return this.scalar_multiply(-1);
    }
    
    scalar_multiply(c) {
        return NewVector(this.x * c,
                         this.y * c,
                         this.z * c)
    }

    vector_multiply(other) {
        return NewVector(this.x*other.x,
                         this.y*other.y,
                         this.z*other.z);
    }

    dot(other) {
        return this.x*other.x+this.y*other.y+this.z*other.z;
    }

    _xyz() {
        return [this.x,this.y,this.z]
    }

    _xyzw() {
        return [...this._xyz(),this.w];
    }

    // TODO SPACE
    lerp(other, frac) {
        return this.scalar_multiply(1-frac).add(other.scalar_multiply(frac));
    }

    moveto(other, distance) {
        var f = other.subtract(this);
        if (f.vector_length() > distance) f = f._normalize().scalar_multiply(distance)
        return this.add(f);
    }
    
    cross(other) {
        return NewVector(this.y*other.z-this.z*other.y,
                          this.z*other.x-this.x*other.z,
                          this.x*other.y-this.y*other.x);
    }

    
    copy() {
        return NewVectorFromList(this._xyzw());
    }

    length_squared() {
        return this.dot(this)
    }

    vector_length() {
        return this.length_squared()**.5;
    }

    noz() {
        return NewVector(this.x, this.y, 0);
    }
    
    distance_to(other) {
        return this.subtract(other).vector_length();
    }

    angle(other) {
        return Math.atan2(other.y-this.y,
                          other.x-this.x);
    }

    _normalize() {
        return this.scalar_multiply(1.0/(this.vector_length()+1e-30))
    }
}

function find_nearest_object(where, filter, discount) {
    // todo space implement with max_by
    var nearest = objects.filter(filter||(_=>true)).map(x=>[x.position.distance_to(where)/(discount||(_=>1))(x),x]);
    if (nearest.length == 0) return [undefined, 1e8];
    var d = Math.min(...nearest.map(x=>x[0]));
    nearest = nearest.filter(x=>x[0]==d)[0][1];
    return [nearest, d];
}

// TODO SPACE REMOVE
function linear_move() {
    return linear_move_withtime(...arguments, get_time());
}
function linear_move_withtime(start_pos, start_rot, end_pos, rate, start_time, force) {
    var end_angle = end_pos.subtract(start_pos).angle(ZERO); // todo space
    var start_angle = start_rot ? mat_vector_product(start_rot, Y_DIR.negate()).angle(ZERO): end_angle;

    while (end_angle - start_angle > Math.PI) start_angle += Math.PI*2;
    while (start_angle - end_angle > Math.PI) start_angle -= Math.PI*2;

    var delta = start_angle - end_angle;
    var rot_time = Math.abs(delta)*50;
    //console.log(delta);

    var duration = start_pos.distance_to(end_pos)*1000/rate + rot_time;
    var end_time = start_time+duration;

    // Actually starts at 100, so actually ends at 500
    // I receive at 200, so boost factor is 100/400 = .25
    let local_start = Math.min(get_time(), start_time+rot_time);
    let boost_factor = 1+(local_start-start_time)/duration;
    
    // Now everything happens 25% faster
    rot_time /= boost_factor;
    duration /= boost_factor;
    
    return {_function: linear_move_withtime.name,
            act: curtime => 
            [matrix_rotate_xy(end_angle*clamp((curtime-local_start)/rot_time,0,1) + start_angle*(1-clamp((curtime-local_start)/rot_time,0,1))-Math.PI/2),
             start_pos.lerp(end_pos,
                            clamp((curtime - local_start - rot_time)/(duration - rot_time),
                                  0, 1))
             ],
            isdone: curtime => end_time < curtime,
            _force: force,
            args: [...arguments]}

}


function linear_follow(start_pos, start_rot, target, rate) {
    return {_function: linear_follow.name,
            act: (_,dt) => [start_rot, start_pos=start_pos.moveto(target.position,
                                                                     rate*dt/1000)],
            isdone: dt => !target.position || start_pos.distance_to(target.position)<.1,
            args: [...arguments]}
}

function stop_fn(where, rot) {
    return {_function: stop_fn.name,
            act: _=>[rot, where],
            isdone: _=>true,
            args: [...arguments]};
}

function fix_json(x) {
    if (x === null) return x;

    var already_exists = object_ht[x.uid];
    if (already_exists) return already_exists;
    
    var it;
    if (x._function) {
        it = /*HACK*/eval(x._function)(...(x.args.map(fix_json)))
    } else if (x._constructor) {
        //console.log("Spawn", x)
        it = new (/*HACK*/eval(x._constructor))(...(x.args || []).map(fix_json));
        // todo space: better to pass these as keyword arguments somehow?
        Object.keys(x).map(k=> {
            if (k != 'sprites')
                it[k] = fix_json(x[k]);
        })
    } else if (x instanceof Object) {
        Object.keys(x).map(k=> {
            if (k != 'sprites')
                x[k] = fix_json(x[k]);
        })
        it = x
    } else {
        it = x;
    }
    return it;
}



// TODO space write in terms of proj_uv
function dist_ray_point(start, direction, point) {
    return direction.cross(start.subtract(point)).vector_length()/direction.vector_length()
}


var ZERO = new Vector(0, 0, 0); // TODO keep it like this to stop the optimizer from inlining the class definition and making things 10x slower
var X_DIR = NewVector(1, 0, 0);
var Y_DIR = NewVector(0, 1, 0);
var Z_DIR = NewVector(0, 0, 1);

var last_sent_rotation;
var SERVER = false;

class Sprite {
    constructor(pos_and_normal, position, rotation, colors, texture) {
        if (SERVER) return;
        this.position = position;
        this.uid = UID();
        this.count = (this.a_positions = new Float32Array(pos_and_normal[0])).length/3;
        this.a_velocity = new Float32Array(pos_and_normal[0].length);
        this.a_settings = new Float32Array(pos_and_normal[0].length);
        this.b_positions = pos_and_normal[2];
        this.a_normals = new Float32Array(pos_and_normal[1]);
        this.buffers = range(5).map(x=>gl.createBuffer())
        this.rotation = rotation||IDENTITY;

        this.a_colors = new Float32Array(Array(this.count).fill(colors || [1,1,1]).flat());

        this._texture = texture || 1;

        this.type = gl.TRIANGLES;
        this.sprites = [this];
        
        this.rebuffer();
    }

    rebuffer() {
        [this.a_positions, this.a_normals, this.a_velocity, this.a_settings, this.a_colors].map((which, i) => {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]);
            gl.bufferData(gl.ARRAY_BUFFER, which, gl.DYNAMIC_DRAW);
        });
    }

    render() {
        gl.uniform4fv(locations.u_world_position, this.position.negate()._xyzw());
        if (this.rotation != last_sent_rotation) {
            last_sent_rotation = this.rotation;
            gl.uniformMatrix4fv(locations.u_world_rotation, false, this.rotation);
        }

        [locations.a_position,
         locations.a_normal,
         locations.a_velocity,
         locations.a_settings,
         locations.a_color].map((location,i) => {
             gl.enableVertexAttribArray(location);
             gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]);
             gl.vertexAttribPointer(
                 location, 3, gl.FLOAT, false, 0, 0);
         });
        gl.uniform1i(locations.u_texture_mux, this._texture);

        gl.drawArrays(this.type, 0, this.count);
    }
}

var setup_utils = () => {
    var B = reshape(range(4),1);
    var q = reshape(range(16),4).map(c=>B[0].map((_,i)=>B.reduce((s,d,j)=>`${s}+b[${d[i]}]*a[${c[j]}]`,0)))
    
    //var mat_product_symbolic = B =>
    //    `(a,b)=>[${reshape(range(16),4).map(c=>B[0].map((_,i)=>B.reduce((s,d,j)=>`${s}+b[${d[i]}]*a[${c[j]}]`,0))).flat()}]`;
    var mat_product_symbolic = B =>
        `(a,b)=>[${[].concat(...reshape(range(16),4).map(c=>B[0].map((_,i)=>B.reduce((s,d,j)=>`${s}+b[${d[i]}]*a[${c[j]}]`,0))))}]`;    

    
    multiply = eval/*HACK*/(mat_product_symbolic(reshape(range(16),4))
                           )    
    var mat_vector_product_q = eval/*HACK*/(mat_product_symbolic(reshape(range(4),1))
                                       )

    mat_vector_product = (m,x) => NewVectorFromList(mat_vector_product_q(m,x._xyzw()));
};

