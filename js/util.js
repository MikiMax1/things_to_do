/* ============================================================
   util.js — maths, RNG, storage, sound
   ============================================================ */
var U = (function () {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }

  /* deterministic RNG so a seed always grows the same island */
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = Math.random;
  function range(r, lo, hi) { return lo + r() * (hi - lo); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length) % arr.length]; }
  function chance(r, p) { return r() < p; }

  /* value noise for terrain */
  function makeNoise(seed) {
    var r = mulberry(seed), g = [];
    for (var i = 0; i < 256; i++) g.push(r());
    /* integer hash — every step stays in int32 (Math.imul, >>>) so the
       result is actually uniform. Plain * and >> overflow to floats and
       collapse the distribution, which flattens the whole map. */
    function at(x, y) {
      var n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) ^ seed;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      n = Math.imul(n ^ (n >>> 16), 1103515245);
      return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
    }
    function smooth(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return lerp(lerp(at(xi, yi), at(xi + 1, yi), u),
                  lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
    }
    return function (x, y, oct) {
      oct = oct || 3;
      var amp = 1, f = 1, sum = 0, norm = 0;
      for (var i = 0; i < oct; i++) { sum += smooth(x * f, y * f) * amp; norm += amp; amp *= .5; f *= 2; }
      return sum / norm;
    };
  }

  function fmt(n) {
    n = Math.floor(n);
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }
  function signed(n, dp) {
    dp = dp === undefined ? 1 : dp;
    var v = Number(n.toFixed(dp));
    if (Math.abs(v) < 0.05) return '0';
    return (v > 0 ? '+' : '') + v;
  }

  /* ---------- storage ---------- */
  var KEY = 'ashveil.save.v2';
  function save(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }
  function load() {
    try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function wipe() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* ---------- sound (all synthesised, no assets) ---------- */
  var actx = null, muted = false, master = null;
  function audio() {
    if (actx) return actx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.28;
    master.connect(actx.destination);
    return actx;
  }
  function resume() { var a = audio(); if (a && a.state === 'suspended') a.resume(); }
  function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.28; }
  function isMuted() { return muted; }

  function tone(freq, dur, type, vol, slideTo) {
    if (muted) return;
    var a = audio(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, a.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(a.currentTime + dur + 0.02);
  }
  function noise(dur, vol, filterHz) {
    if (muted) return;
    var a = audio(); if (!a) return;
    var len = Math.floor(a.sampleRate * dur);
    var buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = a.createBufferSource(); src.buffer = buf;
    var f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz || 900;
    var g = a.createGain(); g.gain.value = vol || 0.25;
    src.connect(f); f.connect(g); g.connect(master); src.start();
  }

  var SFX = {
    tap:      function () { tone(520, .05, 'triangle', .16); },
    place:    function () { tone(300, .08, 'square', .16); noise(.14, .16, 700); },
    build:    function () { tone(440, .09, 'triangle', .2); setTimeout(function(){ tone(660, .12, 'triangle', .18); }, 90); },
    coin:     function () { tone(880, .06, 'square', .13); setTimeout(function(){ tone(1320, .09, 'square', .11); }, 55); },
    err:      function () { tone(180, .14, 'sawtooth', .14, 120); },
    quest:    function () { [523,659,784,1046].forEach(function(f,i){ setTimeout(function(){ tone(f,.16,'triangle',.16); }, i*85); }); },
    horn:     function () { tone(180, .5, 'sawtooth', .2, 240); setTimeout(function(){ tone(240,.55,'sawtooth',.16); }, 180); },
    clash:    function () { noise(.09, .3, 2400); tone(range(rnd,700,1100), .05, 'square', .1); },
    arrow:    function () { noise(.06, .13, 3200); },
    death:    function () { tone(220, .2, 'sawtooth', .12, 90); },
    victory:  function () { [523,659,784,1046,1318].forEach(function(f,i){ setTimeout(function(){ tone(f,.24,'triangle',.18); }, i*110); }); },
    defeat:   function () { [440,392,330,262].forEach(function(f,i){ setTimeout(function(){ tone(f,.3,'sine',.16); }, i*160); }); },
    thunder:  function () { noise(1.6, 0.34, 180); setTimeout(function () { noise(1.1, 0.18, 120); }, 260); },
    season:   function () { tone(392, .18, 'sine', .12); setTimeout(function(){ tone(523,.22,'sine',.12); }, 140); }
  };

  /* ---------------- the island's sound ----------------
     Surf and wind as filtered noise, birds by day and crickets by night,
     rain when it rains — and, if wanted, a slow tune plucked on a lute. */
  var pref = { amb: true, music: true };
  try {
    if (localStorage.getItem('ashveil.amb') === '0') pref.amb = false;
    if (localStorage.getItem('ashveil.music') === '0') pref.music = false;
  } catch (e) {}
  var bed = null, rainBed = null, ambT = 0, birdT = 2, noteT = 1, phrase = [], droneOsc = null;
  function loopNoise(a, brown) {
    var len = a.sampleRate * 3, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    var src = a.createBufferSource(); src.buffer = buf; src.loop = true;
    return src;
  }
  function makeBeds(a) {
    bed = { src: loopNoise(a, true), f: a.createBiquadFilter(), g: a.createGain() };
    bed.f.type = 'lowpass'; bed.f.frequency.value = 520; bed.g.gain.value = 0;
    bed.src.connect(bed.f); bed.f.connect(bed.g); bed.g.connect(master); bed.src.start();
    rainBed = { src: loopNoise(a, false), f: a.createBiquadFilter(), g: a.createGain() };
    rainBed.f.type = 'highpass'; rainBed.f.frequency.value = 1800; rainBed.g.gain.value = 0;
    rainBed.src.connect(rainBed.f); rainBed.f.connect(rainBed.g); rainBed.g.connect(master); rainBed.src.start();
  }
  function chirp(a) {
    var t = a.currentTime, n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1600;
    for (var i = 0; i < n; i++) {
      var o = a.createOscillator(), g = a.createGain(), t0 = t + i * (0.09 + Math.random() * 0.05);
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), t0);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.5), t0 + 0.07);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.018, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.1);
    }
  }
  function cricket(a) {
    var t = a.currentTime;
    for (var i = 0; i < 3; i++) {
      var o = a.createOscillator(), g = a.createGain(), t0 = t + i * 0.055;
      o.type = 'triangle'; o.frequency.value = 4400 + Math.random() * 200;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.008, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.05);
    }
  }
  /* a lute-ish pluck: bright attack, a quick fall, a soft tail */
  function pluck(a, f, when, vol) {
    var o = a.createOscillator(), o2 = a.createOscillator(), g = a.createGain(), lp = a.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'sawtooth'; o.frequency.value = f; o2.frequency.value = f * 2.001;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * 6, when); lp.frequency.exponentialRampToValueAtTime(f * 1.5, when + 0.6);
    var g2 = a.createGain(); g2.gain.value = 0.18;
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vol, when + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, when + 1.6);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(master);
    o.start(when); o2.start(when); o.stop(when + 1.7); o2.stop(when + 1.7);
  }
  // D dorian, low to high; the tune wanders by steps and rests often
  var SCALE = [146.8, 164.8, 174.6, 196, 220, 246.9, 261.6, 293.7, 329.6, 349.2, 392, 440];
  var deg = 7;
  function nextPhrase(minor) {
    var out = [], n = 4 + Math.floor(Math.random() * 4);
    for (var i = 0; i < n; i++) {
      deg = Math.max(2, Math.min(SCALE.length - 1, deg + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
      var f = SCALE[deg];
      if (minor && (deg === 5 || deg === 12)) f = SCALE[deg - 1];
      out.push({ f: f, d: [0.42, 0.42, 0.84, 0.63][Math.floor(Math.random() * 4)] });
    }
    return out;
  }
  function ambient(dt, env) {
    if (muted || !actx || actx.state !== 'running') return;
    var a = actx;
    if (!bed) makeBeds(a);
    ambT -= dt;
    if (ambT <= 0) {
      ambT = 0.5;
      var surf = pref.amb ? 0.05 + 0.025 * Math.sin(a.currentTime * 0.35) + (env.storm ? 0.05 : 0) : 0;
      bed.g.gain.setTargetAtTime(surf, a.currentTime, 0.8);
      rainBed.g.gain.setTargetAtTime(pref.amb && env.rain ? 0.035 : 0, a.currentTime, 1.2);
    }
    if (pref.amb) {
      birdT -= dt;
      if (birdT <= 0) {
        if (env.night > 0.6) { cricket(a); birdT = 0.35 + Math.random() * 1.4; }
        else if (!env.rain && env.season !== 'winter') { chirp(a); birdT = 2.5 + Math.random() * 6; }
        else birdT = 3;
      }
    }
    if (pref.music && !env.war) {
      noteT -= dt;
      if (noteT <= 0) {
        if (!phrase.length) {
          phrase = nextPhrase(env.season === 'winter' || env.night > 0.6);
          noteT = 2.5 + Math.random() * 4;   // a breath between phrases
          if (Math.random() < 0.5) pluck(a, SCALE[0] / 2 * (env.season === 'winter' ? 0.94 : 1), a.currentTime + 0.05, 0.05);
          return;
        }
        var nt = phrase.shift();
        pluck(a, nt.f, a.currentTime + 0.02, 0.055);
        if (Math.random() < 0.25) pluck(a, nt.f * 1.5, a.currentTime + 0.03, 0.025);
        noteT = nt.d;
      }
    }
  }
  function setPref(k, on) {
    pref[k] = on;
    try { localStorage.setItem(k === 'amb' ? 'ashveil.amb' : 'ashveil.music', on ? '1' : '0'); } catch (e) {}
    if (k === 'amb' && !on && bed && actx) { bed.g.gain.setTargetAtTime(0, actx.currentTime, 0.3); rainBed.g.gain.setTargetAtTime(0, actx.currentTime, 0.3); }
  }

  function vibrate(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }

  return {
    clamp: clamp, lerp: lerp, dist: dist, dist2: dist2,
    mulberry: mulberry, makeNoise: makeNoise, range: range, pick: pick, chance: chance, rnd: rnd,
    fmt: fmt, signed: signed,
    save: save, load: load, wipe: wipe,
    sfx: SFX, setMuted: setMuted, isMuted: isMuted, resumeAudio: resume, vibrate: vibrate,
    ambient: ambient, soundPref: function (k) { return pref[k]; }, setSoundPref: setPref
  };
})();
