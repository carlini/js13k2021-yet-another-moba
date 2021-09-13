## build.py -- Do a bunch more ugly JS compression.

## Copyright (C) 2021, Nicholas Carlini <nicholas@carlini.com>.
##
## This program is free software: you can redistribute it and/or modify
## it under the terms of the GNU General Public License as published by
## the Free Software Foundation, either version 3 of the License, or
## (at your option) any later version.
##
## This program is distributed in the hope that it will be useful,
## but WITHOUT ANY WARRANTY; without even the implied warranty of
## MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
## GNU General Public License for more details.
##
## You should have received a copy of the GNU General Public License
## along with this program.  If not, see <http://www.gnu.org/licenses/>.


import re
import os
import string
import esprima

def encode(num,orig):
    return str(num) # +orig
    num += 1
    out = ""
    while num > 0:
        out += (string.ascii_letters)[num%(26)]
        num //= (26)
    return out



def compress_webgl_variables(original_data, data):
    """
    Do some simple shader compression. This mostly just looks for variables
    to rewrite and doesn't do much else. There is better compression
    available and I use that for the final product, but this gets 95% of
    the way there.
    """
    shaders = []
    is_in_shader = False

    # 1. Scan the file to find all of the shaders.
    for line in original_data.split("\n"):
        if "#version 300 es" in line or "//SHADER" in line:
            is_in_shader = True
        elif is_in_shader:
            if '`' in line:
                is_in_shader = False
            else:
                #print("Add", line.split("//")[0])
                shaders.append(line.split("//")[0])

    # 2. Look for the variables in the shader.
    shader_variables = []
    keywords = "bool vec2 vec3 vec4 mat3 mat4 sampler2D float int".split()
    all_new_words = []
    for line in shaders:
        new_words = []
        for kw in keywords:
            if kw in line:
                options = re.findall("^ [a-zA-Z_0-9,]*",line.split(kw)[1])
                if len(options) > 0:
                    new_words += [x.strip() for x in options[0].split(",")]
        new_words = [x for x in new_words if x not in ["gl_Position"] and len(x) > 1]
        all_new_words.extend(new_words)
    #print(all_new_words)

    # 3. Rewrite the variables to use ascii letters (except i/j)
    letters = string.ascii_letters.replace("i","").replace("j","")
    letters = [x for x in letters]
    letters = letters + [a+b for a in letters for b in letters]
    for i,var_name in enumerate(sorted(set(all_new_words),key=len)[::-1]):
        data = re.sub("([^a-zA-Z_])"+var_name+"([^a-zA-Z_])", "\\1"+letters[i]+"\\2", data)
    data = data.replace(r'"\n"', "$SLASH_N$")
    data = data.replace(r"\n"," ")

    # 4. Remove all duplicate whitespace
    for _ in range(10):
        data = data.replace("  ", " ")

    # 5. Remove whitespace around symbols
    for symbol in "(){}<>=-+*/,&|;?:":
        for _ in range(5):
            data = data.replace(" "+symbol, symbol)
            data = data.replace(symbol+" ", symbol)
    data = data.replace("$SLASH_N$",r'"\n"')
    data = data.replace("#version 300 es","#version 300 es\\n")
    data = data.replace("//SHADER", "")

    data = re.sub(r"/\*[^*]*\*/", "", data)
    
    return data

def compress(files):
    hdr = ""


    original_data = '(()=>{"use strict";' + "".join(open("public/"+x).read() for x in files) + hdr + "})()"
    
    newdat = ""
    for line in original_data.split("\n"):
        if "// DEBUGONLY" in line:
            #continue
            #newdat += line+"\n"
            pass
        elif "// QQ" in line:
            newdat += line.replace(".", ".QWQWQ")+"\n"
        elif "/*HACK*/" in line:
            newdat += line.replace("/*HACK*/","zzHACK")+"\n"
        elif 'console.log' in line:
            continue
        else:
            newdat += line+"\n"

    for i,cmd in enumerate(set(re.findall("Command[a-zA-Z_]*", newdat))):
        newdat = newdat.replace(cmd, str(i))#'"'+cmd+'"') 

    ### ATTEMPT 0
    newdat = re.sub(r'\("([^"]*)"\)', "`\\1`", newdat)
    newdat = re.sub(r"\('([^']*)'\)", "`\\1`", newdat)

    newdat = newdat.replace("true", "1")
    newdat = newdat.replace("false", "0")

    states = set(re.findall("State\\.[A-Z]*", newdat))
    for i,state in enumerate(states):
        newdat = newdat.replace(state, str(i))
    
    hdr = ""

    ## Now we're going to white-list all the props we're allowed to mangle
    ## Then replace them with __NUM and tell uglify it's allowed to mangle
    ## underscore variables.
    rewrite = "position add theta scalar_multiply sprite state subtract shadow_camera dead velocity theta2 distance_to lerp render waypoint post_filter floor_height a_colors vector_length solid recoil ceil_height brightness theta3 still parallel_dir a_positions _params spins parent_obj get_floor_height floor_light cel_light vertices transparent sprite2 rebuffer reset patrol get_region_at lines draw_scene doorclose dimensions components a_normals vector_multiply  texture_direction camera_is_light state rotation update regions dimensions onhit ceil_light synthWave negate collect2 collect compute_shadowmap cross dooropen length_squared old_color reset_color_timer totalReset buffers time speedinv framebuffer spin_rate floor_cache count copy slow shadow grounded attacking dynamic_shadow is_in_region levels ghost sprites load_level cull timer aq_angle floor_texture ceil_texture boom aspect wall_texture put_objects collect_dist remake backup_levels texture_id height_offset gethelp clock all_levels particle target goal spinGoal spinTime, velocitys spin size max_spawn is_mine use_random settings positions last_target_position last_shoot fakedead direction shoot_lr proj_mat decayrate counter speed particle_start spinTime which last_pos mass damage tpos project_onto prev_which speed orig_rot orig_pos offset normal maxage health get_new_pos boom2 ages tracked rumble rand lazer graphicslevel particle_start last_vel bass ready my_offset engines energy is_small annoyed lazer2 warmup moveto axis side movefn enemy part tracking type level shield owner maxhealth die_with kind cc_timer player last_state angle okayplay move_to live_time last_position last_minion is_spawn hits is_cc fully_dead client_die towertarget make_decision power can_do b_positions isdone".split() # xyz xyzw

    # Look for the props to rewrite with this command here
    # cat /tmp/comp3.js | grep -o "\.[a-zA-Z_][a-zA-Z_0-9]*" | grep "....." | sort | uniq -c | sort -nr

    open("/tmp/out0.js","w").write(newdat)

    it = newdat.split("`")
    newdat = ""
    for i,t in enumerate(it):
        if i%2 == 1:
            newdat += t
        else:
            newdat += "@".join(re.split('([^a-zA-Z0-9_$])', t))
        newdat += '`'
    newdat = newdat[:-1]
    print(newdat[:100])
    
    print(newdat[:100])
    for i,each in enumerate(rewrite):
        what = "__"+encode(i,"")
        newdat = newdat.replace("@"+each+"@","@"+what+"@")
    newdat = newdat.replace("@","")

    open("/tmp/out.js","w").write(newdat)
    open("/tmp/out2.js","w").write(newdat.replace("QWQWQ","").replace("zzHACK",""))

    data = os.popen("uglifyjs --compress --mangle --mangle-props regex=/^_.*/ -- /tmp/out.js > /tmp/comp.js").read()
    data = open("/tmp/comp.js").read()
    data = data[19:-6]

    # Parse it and remove undefined assignments.
    
    data = data.replace("QWQWQ","")
    
    data = compress_webgl_variables(original_data, data)

    # Remove assignments of the form this.x = undefined;
    for set_to_undef in re.findall("((this.)?[a-zA-Z0-9_$]*=void 0)", data):
        set_to_undef = set_to_undef[0]
        a,_,b = data.partition(set_to_undef)
        #print(a[-30:],_,b[:30])
        if a[-1] in ',;':
            data = a[:-1]+b
        else:
            if b[0] in ',;':
                data = a+b[1:]
            else:
                print("WARNING")
                data = a+b

    merged_out = data.replace("zzHACK","").replace("}^", "} ")
    open("/tmp/comp3.js","w").write(merged_out)

    # split off the server
    common, server = merged_out.split("startserver();")
    try:
        server, client = server.split(",startclient();")
    except:
        server, client = server.split("startclient();")

    client = client.replace("`Please don't cheat.`",
                            '("Please don\'t cheat.")')
        
    open("build/public/z","wb").write(open("public/z","rb").read())
    open("build/public/server.js","w").write(server)
    open("build/public/client.js","w").write(client)
    open("build/public/shared.js","w").write(common)

    used = int(os.popen("advzip -i 100 -4 -a /tmp/a.zip build/public && wc /tmp/a.zip").read().split()[-2])
    print(13*1024-used)

    
    return

    
    
if __name__ == "__main__":
    files = ["utils.js", "objects.js", "graphics.js", "game.js", "jsfxr.js", "audio.js", "server.js", "webgl.js"]
    compress(files)
