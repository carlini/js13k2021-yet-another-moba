// objects.js -- create 3d objects through lathing

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


function load_compressed_4(data) {
    function get(n) {
        var o = parseInt(data.splice(0,n).join(""),2);
        return o;
    }
    data = data.splice(0, get(16));
    var BITS = get(3);
    var SYM = get(3);

    var the_face = [];
    var history = [];
    var faces = [];
    var prev=0;
    while (data.length) {
        if (get(1) == 0) {
            history.unshift(history[get(5)])
        } else {
            history.unshift(mat_vector_product(matrix_rotate_yz(Math.PI/2),
                                               NewVector(get(BITS)/2**BITS, get(BITS)/2**BITS, get(BITS)/2**BITS)
                                              ));
        }

        the_face[prev=(prev+get(1)+1)%3] = history[0];
        if (history.length > 2) {
            faces.unshift(the_face.map(x=>x));
            if (faces.length%2 == 1) {
                faces[0].reverse();
            }
        }
    }
    [4,2,1].map((elt,j) => {
        if (SYM&elt) {
            var arr = [1,1,1];
            arr[j] *= -1;
            faces = [...faces, ...faces.map(f=> f.map(x=>x.vector_multiply(NewVectorFromList(arr))).reverse())];
        }
    })
    return faces;
}

function load(outsf, N, offset, rotation, randomize) {
    if (!(N instanceof Vector)) N = NewVector(N,N,N);

    var center = outsf.flat(1).reduce((a,b)=>a.add(b));
    center = center.scalar_multiply(1/outsf.flat(1).length);
    outsf = outsf.map(f=>f.map(x=>x.subtract(center.noz())));
    outsf = outsf.map(f=>f.map(x=>mat_vector_product(rotation||IDENTITY, x.vector_multiply(N).add(offset||ZERO))))
    outsf = outsf.map(f=>f.map(randomize || (_=>_)));

    var outsn = outsf.map(x=> {
        var q=normal_to_plane(...x).negate()._xyz();
        if (sum(q.map(Math.abs)) < 1e-5) sdf; // DEBUGONLY
        return [q,q,q];
    })
    return [outsf.flat().map(x=>x._xyz()).flat(), outsn.flat(2), outsf]
}

var all_sprites = [];

function setup_sprites(arr) {
    setup_utils();
    arr = arr.split("");
    while (arr.length>8) {
        all_sprites.push(load_compressed_4(arr))
        load(all_sprites[all_sprites.length-1], 1) // DEBUGONLY
    }
    setTimeout(setup, 1)
}
