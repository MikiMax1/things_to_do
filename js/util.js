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
    season:   function () { tone(392, .18, 'sine', .12); setTimeout(function(){ tone(523,.22,'sine',.12); }, 140); }
  };

  function vibrate(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }

  return {
    clamp: clamp, lerp: lerp, dist: dist, dist2: dist2,
    mulberry: mulberry, makeNoise: makeNoise, range: range, pick: pick, chance: chance, rnd: rnd,
    fmt: fmt, signed: signed,
    save: save, load: load, wipe: wipe,
    sfx: SFX, setMuted: setMuted, isMuted: isMuted, resumeAudio: resume, vibrate: vibrate
  };
})();
