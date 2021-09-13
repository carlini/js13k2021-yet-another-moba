// graphics.js -- the core rendering engine

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


function make_proj_matrix() {
    var f = Math.tan(Math.PI/2 - .9/2);

    // Only allow one field of view to save space
    return [
        [1, 0, 0, camera_position.x,
         0, 1, 0, camera_position.y,
         0, 0, 1, camera_position.z,
         0, 0, 0, 1],
        camera_rotation,
        [aspect/f, 0, 0, 0,
         0, 0, 1, 0,
         0, 1/f, 0, 0,
         0, 0, -1, 1]
    ].reduce(multiply)
}

var aspect;
function Camera() {
    aspect = cQ.width/cQ.height;
    gl.viewport(0, 0, cQ.width, cQ.height)

    return _ => {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniform1f(locations.u_time, local_time);

        // Rener backdrop with depth test off
        backdrop.render();
        gl.depthMask(true);
        
        gl.enable(gl.DEPTH_TEST);


        gl.uniform1f(locations.u_is_dead, me.dead);

        gl.uniform4fv(locations.u_camera_position, camera_position._xyzw());

        gl.uniformMatrix4fv(locations.u_camera_matrix, true,
                            proj_mat = make_proj_matrix());

        objects.map(x=>x.render());
        
        gl.enable(gl.BLEND);
        gl.depthMask(false);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        particles.map(obj => obj.render());
        
        var base = NewVectorFromList(me.position._xyz().map(x=>(x>>5)<<5));
        range(8*8*8).map(z => {
            var v = NewVector((z&7)-3,((z>>=3)&7)-3,(z>>3)-3);
            if (v.vector_length() < 3) {
                glitter.position = base.add(v.scalar_multiply(32));
                    glitter.render();
            }
        });
        

        gl.disable(gl.DEPTH_TEST);
        
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        hud.map(x=>x.render());
        hud.sort((x,y)=>x.z-y.z).map(x=>x.render());

        // ALLOW depth mask for next loop iteration
        // That way background is always in the back
        //gl.depthMask(true);
        gl.disable(gl.BLEND);
    }
}


var PARTS = 0; // DEBUGONLY

class ParticleSystem extends Sprite {
    constructor(num_particles, maxage, settings, color,
                particle_start, dont_use_random) {
        super([range((num_particles|=0)*3).map(x=>1e8),
                                    range(num_particles).map(x=>color).flat(1)], ZERO, IDENTITY,
              settings, 2);
        this.velocitys = range(num_particles*3);
        this.settings = settings;
        this.ages = Array(num_particles).fill(0)

        this.type = gl.POINTS;
        this.maxage = maxage;
        this.fakedead = undefined;
        this.particle_start = particle_start;
        this.max_spawn = 1e6;
        this.use_random = !dont_use_random;
        this.die_with = this;
        this.uid = UID();
    }

    update(dt, other_max) {
        if (this.die_with.dead && !this.fakedead) {
            this.fakedead = get_time()+500;;
        }
        if (this.fakedead < get_time()) this.dead = true;
        var did = 0;

        var max = Math.min(other_max||1e9,this.max_spawn)*dt/16.7;
        
        for (var i = 0; i < this.ages.length; i++) {
            if ((this.ages[i] -= dt) < 0 && did < max && !this.fakedead) {
                did++;
                var [tmp, tmp2, tmp3] = this.particle_start(dt, max);
                this.ages[i] = this.maxage*1000*(this.use_random||Math.random());
                this.a_colors[i*3] = this.settings[0];
                this.a_colors[i*3+1] = tmp3 || this.settings[1];
                this.a_settings[i*3] = local_time;
                this.a_settings[i*3+1] = local_time + this.ages[i];
                this.a_positions.set(tmp._xyz(), i*3)
                this.a_velocity.set(tmp2._xyz(), i*3)
            }
        }

        if (did) {
            this.rebuffer()
        }
    }
}

class HitSprite extends ParticleSystem {
    constructor(pos, count, age, size, speed, color) {
        super(count, age, [.2, .5*(size||1), 0], urandom() < .5 ? [.3, .3, .3] : [.6, .4, .3],
              _=> [this.pos.add(urandom_vector()),
                   urandom_vector()._normalize().scalar_multiply(this.speed)]);
        this.pos = pos;
        this.max_spawn = 5;
        this.speed = speed||1;
    }
}

class Tracer extends ParticleSystem {
    constructor(target, size, offset) {
        super(target instanceof Player ? 200 : 50, .3, [.8, size, 1], color2[target.side],
              _=> [this.target.position.add(mat_vector_product(this.target.rotation, offset)).add(urandom_vector(.1*size)),
                   mat_vector_product(this.target.rotation, Y_DIR.scalar_multiply(.1).add(urandom_vector(.01)))]);
        this.size = size;
        this.target = target;
        this.max_spawn = 5;
        this.position = ZERO;
        this.last_position = this.target.position;
    }
    
    update(dt) {
        super.update(dt);
        if (this.target.dead && !this.fakedead) {
            this.fakedead = true;
            setTimeout(_ => this.dead = true, 1000);
        }
        //this.settings[1] = this.size * (.5+this.target.position.distance_to(this.last_position));
        this.maxage = (this.size**.5/2+Math.min(this.target.position.distance_to(this.last_position)/2,.5));
        this.last_position = this.target.position;
    }
}


function setup_graphics() {
var fragmentShaderSource = `#version 300 es
precision mediump float;

in vec4 v_normal,world_position,v_color,v_position;

uniform int u_texture_mux;
uniform vec4 u_world_position,u_camera_position;
uniform float u_time,u_alpha,u_is_dead;

out vec4 out_color;

float rand_gl(vec2 co){
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
  vec3 v_normal_ = normalize(v_normal.xyz);
  float light_add;


  vec2 from_center = 2.*gl_PointCoord.xy-vec2(1,1);
  if (u_texture_mux == 1) {
        light_add += pow(clamp(dot(vec3(0, 0, -1), v_normal_),0.,1.),3.);
        light_add += pow(clamp(dot(vec3(1, 0, .5), v_normal_),0.,1.),3.);
        light_add += pow(clamp(dot(vec3(-.5, -.86, .5), v_normal_),0.,1.),3.);
        light_add += pow(clamp(dot(vec3(-.5, .86, .5), v_normal_),0.,1.),3.);
    
        light_add /= 2.;
        light_add += .2 + u_alpha;
        out_color += (v_color) * vec4(light_add, light_add, light_add, 1);
  } if (u_texture_mux == 2) {
    /* particles system */
    out_color.rgb = v_normal.rgb;
    out_color.w = smoothstep(1.,0.,length(from_center)) * v_color.x;
  } if (u_texture_mux == 5) {
    /* GoTo animation */
    out_color.xyz = vec3(1.);
    out_color.w = abs((v_normal.x-u_time+200.)/250.-length(v_position.xy)) < .1 ? 1. : 0.;
  } if (u_texture_mux == 4) { /* floor tile */
     vec2 on_line = clamp(mod(v_position.xy/15., 1.), 0., 1.);
     float is_ok = smoothstep(1., 0., abs(on_line.x-.99)*100.)+smoothstep(1., 0., abs(on_line.y-.99)*100.);

     out_color = vec4(0, min(is_ok,1.), 0, 1);

     float pa,Z=pa= 0.;
     for (float j=0.; j<3.; j++) {
       vec3 p = world_position.xyz/40. - vec3(1,1,0) + u_camera_position.xyz/(130.+j*60.) + j*20.; 
       p = mod(p,2.);
       p = abs(p-1.);
       for (int i=0; i<15; i += 1) {
         p=abs(p)/dot(p,p)-.48-j/50.;
         Z+=abs(length(p)-pa);
         pa=length(p);
       }
     }
     Z *= Z*Z;
     out_color.rgb += .5 * clamp(pow(vec3(Z/3e6, Z/2e6, Z/2e6), vec3(.9)),0.,2.);
     out_color.w = 1.;
  } if (u_texture_mux == 3) { /* health bar */
     bool border = abs(gl_PointCoord.x-.5) > .48
                || abs(gl_PointCoord.y-.5) > .08;
     /* v_color.y has the object's health, v_color.z has health + shield */
     vec3 c = border ? vec3(0) : (v_color.y > gl_PointCoord.x ? (v_color.x > .5 ? vec3(.2,.2,.8) : vec3(.8,.2,.2))  : v_color.z > gl_PointCoord.x ? vec3(.9,.3,.9) : vec3(.2, .2, .2));
     out_color = vec4(c, abs(gl_PointCoord.y-.5) < .1);
  } if (u_texture_mux == 10) { /* ability bar */
     vec2 middle = gl_PointCoord.xy - vec2(.5,.5);
     bool border = abs(middle.x) > .48
                || abs(middle.y) > .48;
     /* v_normal.x has the cooldown */
     vec3 c = border ? vec3(0) : (v_normal.x >= 1.) ? vec3(0, .4, .9) :  (1.-v_normal.x)*6.28-3.14 < atan(middle.x, middle.y) ? vec3(0,.2,.5): vec3(.2, .2, .2);
     out_color = vec4(c, 1);
     return;
  }
   if (u_texture_mux == 7) {
    /* damage sprite */
    out_color.xyzw = v_color.rggb; /* Can do xyzw, rgbb if I want */
   }

   if (u_is_dead > .5) {
      out_color.xyz = vec3(length(out_color.xyz))/2.;
   }

   /*+abs(world_position.x-world_position.y)/4.*/
   float alpha = smoothstep(1., 0., (length(world_position.xy)-55.)/10.);
   out_color.xyz *= vec3(alpha);
}
`;

    var program = gl.createProgram();
    var vertexShaderSource = `#version 300 es
precision mediump float;
precision mediump int;

in vec4 a_position,a_normal,a_color,a_velocity,a_settings;
uniform int u_texture_mux;
uniform float u_time;

out vec4 v_normal,world_position,v_color,v_position;

uniform vec4 u_world_position,u_camera_position;
uniform mat4 u_world_rotation,u_camera_matrix;


/* settings. x: start, y: end */
void main() {
  vec4 my_pos = a_position + vec4((u_time-a_settings.x)/16.*a_velocity.xyz,0);
  world_position = (my_pos) * u_world_rotation - u_world_position;
 
  v_normal = a_normal * u_world_rotation;
  v_color = a_color;

  mat4 c_inv = inverse(u_camera_matrix);

  if (u_texture_mux == 3) { /* health, ability hud */
     gl_PointSize = a_normal.z;
     world_position.z += a_normal.y; /* height */
     gl_Position.x -= world_position.w*1.25;
  }

  gl_Position += c_inv * world_position;

  if (u_texture_mux == 2) { /* particle system */
     /* x sets the size and transparency, y just sets the size */
     v_color.x *= smoothstep(1., 0., (u_time-a_settings.x)/(a_settings.y-a_settings.x));
     gl_PointSize = (4000./gl_Position.w) * (2.+v_color.x) * a_color.y / float(${1<<(GRAPHICS>>1)});
     v_normal = a_normal;
  }

  if (u_texture_mux == 10) { /* Ability bar */
     gl_Position = a_position;
     gl_PointSize = 100.;
  }


  v_position = a_position;

}
`;

    [[gl.VERTEX_SHADER, vertexShaderSource],
     [gl.FRAGMENT_SHADER, fragmentShaderSource]].map(type_and_code => {
         var shader = gl.createShader(type_and_code[0]);
         gl.shaderSource(shader, type_and_code[1]); 
         gl.compileShader(shader);
         gl.attachShader(program, shader);

         // Just assume success on the compiled version
         var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS); // DEBUGONLY
         if (!success) { // DEBUGONLY
             console./*HACK*/log(type_and_code[1].split("\n").map((x,i)=>(i+1)+":" + x).join("\n")); // DEBUGONLY
             console./*HACK*/log(gl.getShaderInfoLog(shader)); // DEBUGONLY
             gl.deleteShader(shader); // DEBUGONLY
             sdf; // DEBUGONLY
         } // DEBUGONLY
     });
    
    gl.linkProgram(program);

    // Again assume success on the compiled version
    var success = gl.getProgramParameter(program, gl.LINK_STATUS); // DEBUGONLY
    if (success) { // DEBUGONLY
        // TODO SPACE is it shorter to just inline all the assignments?
        locations = {};
        var prev_in = true;
        (fragmentShaderSource+vertexShaderSource).match(/[a-zA-Z_]+(\[[0-9]*\])?/g).map(tok => {
            var toks = [tok];
            if (tok.indexOf("[") > 0) {
                toks = range(32).map(x=>tok.replace(/[0-9]+/,x));
            }
            if (tok == "in") prev_in = true;
            if (tok == "uniform") prev_in = false;
            toks.map(tok => 
                     locations[tok] = locations[tok] || (prev_in ? gl.getAttribLocation(program, tok) :gl.getUniformLocation(program, tok))
                    )
        })
    } else { // DEBUGONLY
        console.log(gl.getProgramInfoLog(program)); // DEBUGONLY
        gl.deleteProgram(program); // DEBUGONLY
    } // DEBUGONLY

    gl.useProgram(program);

}
