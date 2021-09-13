// audio.js -- sounds (both audio and music) for the game

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

var sounds;

var context;
var play = (which, amt) => {
    if (which === undefined) return; // DEBUGONLY
    var m = context.createBuffer(1,which.length,48e3);
    m.copyToChannel(new Float32Array(which), 0, 0);
    var src = context.createBufferSource();
    src.buffer = m;

    var gain = context.createGain()
    gain.gain.value = amt || 1
    gain.connect(context.destination)
    src.connect(gain);
    
    src.start(); // QQ
    return src;
}


function setup_audio() {
    context = new AudioContext();    
    arr = [
/*0*/        3,,0.05,0.75,0.15,0.3,,,,1,,,,,,,-1,1,0.1,-0.55,1,,,0.5, // tower target
/*1*/        1,0.75,0.95,,1,0.35,0.05,-0.2,-0.1,0.55,0.9,0.6,0.9,1,-0.85,1,0.55,0.2,0.1,-0.15,0.35,,,0.2,
/*2*/        0,0.05,0.2,0.2,0.05,0.05,,,,,,-0.65,,,,,,,0.1,-0.8,,0.05,,0.3,
/*3*/        1,0.1,0.2,,0.3,0.5,0.1,-0.05,-0.05,0.85,,,-1,,,,-0.1,0.7,0.1,-0.05,0.2,,-1,0.2,
/*4*/        1,0.15,0.35,,0.55,0.2,,-0.15,-0.05,1,,,,0.2,-0.5,0.95,-0.7,-0.1,0.15,-0.05,,,,0.15,
/*5*/        1,0.5,0.7,,1,0.2,,-0.15,-0.05,1,,,,0.2,-0.5,0.95,-0.7,-0.1,0.15,-0.05,,,,0.2,
/*6*/        3,,0.05,0.75,0.4,0.4,,,,1,,0.5,0.6,,,,1,,0.05,-0.25,1,,,0.3, // collect
/*7*/        3,.7,0.1,,0.05,0.1,,0.1,,0.45,,,,0.1,-0.15,,-0.65,,0.15,-0.15,0.45,,,0.2,
/*8*/        0,0.8,,,0.3,0.3,0.05,,-0.1,0.6,0.05,,,,,,0.65,0.35,0.1,-0.05,,,,0.3,
        // 1,0.65,0.7,,0.2,0.35,,-0.25,,0.95,,,,,,0.05,0.4,0.1,0.1,-0.4,0.85,,-0.05,0.2,
          ]
    arr = reshape(arr.map(x=>x||0),24)

    sounds = {}
    sounds.lazer = jsfxr(arr[3]);
    // DEBUGONLY
    sounds.boom2 = jsfxr(arr[1]);
    sounds.bass = jsfxr(arr[4]);
    sounds.rumble = jsfxr(arr[5]);
    sounds.shield = jsfxr(arr[7]);

    sounds._nope = jsfxr(arr[2]);
    sounds._heal = jsfxr(arr[8]);
    
    arr[3][2] = .6;
    sounds.lazer2 = jsfxr(arr[3]);
    //*/ // DEBUGONLY
    sounds[0] = sounds.collect = jsfxr(arr[6]);
    sounds[1] = sounds.towertarget = jsfxr(arr[0]);
    
}
