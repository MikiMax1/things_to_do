/* ============================================================
   scenery.js — the small life of the island.
   Washing on the line, woodpiles that shrink through the winter,
   hens in the yards, ox-carts hauling to the castle, surf on the
   beaches, fish jumping, gulls and flocks, dawn mist, summer storms,
   rainbows and puddles — and one wind that everything obeys.
   Nothing here changes the economy; it only makes it visible.
   ============================================================ */
var SCENERY = (function () {
  'use strict';

  var time = 0, wet = 0, flash = 0, nextBolt = 5, rainbow = 0, wasRain = false;
  var birds = [], flockTimer = 8, carts = [], cartTimer = 6, jumps = [], jumpTimer = 3;

  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = n * 0x27d4eb2d; return (n ^ (n >>> 15)) >>> 0; }
  function G() { return SIM.G; }

  /* ---------------- one wind ---------------- */
  function wind() {
    var storm = G() && G().storm && G().weather === 'rain';
    return (0.55 + Math.sin(time * 0.13) * 0.35 + Math.sin(time * 0.7) * 0.18) * (storm ? 2.2 : 1);
  }

  /* ---------------- ticking ---------------- */
  function update(dt, api) {
    time += dt;
    var g = G(); if (!g) return;
    var raining = g.weather === 'rain';
    wet = U.clamp(wet + (raining ? dt * 0.25 : -dt * 0.018), 0, 1);
    if (wasRain && !raining && api.night < 0.3 && SIM.season().key !== 'winter' && Math.random() < 0.7) rainbow = 1;
    wasRain = raining;
    if (rainbow > 0) rainbow = Math.max(0, rainbow - dt / 22);
    // lightning in a summer storm
    flash = Math.max(0, flash - dt * 3.5);
    if (raining && g.storm) {
      nextBolt -= dt;
      if (nextBolt <= 0) {
        nextBolt = 3 + Math.random() * 7; flash = 1;
        var delay = 250 + Math.random() * 900;
        setTimeout(function () { if (U.sfx.thunder) U.sfx.thunder(); }, delay);
      }
    }
    updateBirds(dt, api);
    updateCarts(dt);
    updateJumps(dt);
    townSounds(dt, api);
  }

  /* the town, heard close up: the smithy's hammer, the woodcutters, the
     market's chatter, the mill, the flocks, the chapel bell at dawn */
  var soundT = 2;
  var SOUNDS = { smith: 'clink', lumber: 'chop', sawmill: 'chop', market: 'chatter', tavern: 'chatter', windmill: 'creak', pasture: 'bleat' };
  function townSounds(dt, api) {
    soundT -= dt;
    if (soundT > 0 || api.z < 55 || U.isMuted() || !U.soundPref('amb')) return;
    soundT = 0.9 + Math.random() * 1.4;
    var cx = api.cw / 2, cy = api.ch / 2, pool = [];
    G().buildings.forEach(function (b) {
      if (!b.built || !SOUNDS[b.id] || !(b.workers > 0)) return;
      if (b.id === 'tavern' && api.night < 0.4) return;
      if (b.id !== 'tavern' && api.night > 0.7) return;
      var s = api.toScreen(b.x + 0.5, b.y + 0.5), d = Math.hypot(s.x - cx, s.y - cy);
      if (d < Math.min(api.cw, api.ch) * 0.55) pool.push({ b: b, v: 1 - d / (Math.min(api.cw, api.ch) * 0.55) });
    });
    var chapel = G().buildings.filter(function (b) { return b.built && b.id === 'chapel'; })[0];
    if (chapel && api.dayPhase > 0.06 && api.dayPhase < 0.09 && Math.random() < 0.5) { U.sfx.bell(0.8); return; }
    if (!pool.length) return;
    var p = pool[Math.floor(Math.random() * pool.length)], k = SOUNDS[p.b.id], zoom = U.clamp((api.z - 55) / 60, 0.3, 1);
    if (U.sfx[k]) U.sfx[k](p.v * zoom);
  }

  /* ---------------- birds: flocks crossing, gulls over the shore ---------------- */
  function updateBirds(dt, api) {
    flockTimer -= dt;
    if (flockTimer <= 0 && api.night < 0.4) {
      flockTimer = 18 + Math.random() * 30;
      var n = 5 + Math.floor(Math.random() * 7), fromLeft = Math.random() < 0.5, y0 = api.ch * (0.1 + Math.random() * 0.35);
      var vx = (fromLeft ? 1 : -1) * (38 + Math.random() * 20), vy = (Math.random() - 0.5) * 12;
      for (var i = 0; i < n; i++) {
        var row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        birds.push({ x: (fromLeft ? -40 : api.cw + 40) - Math.sign(vx) * row * 16, y: y0 + side * row * 9, vx: vx, vy: vy, ph: Math.random() * 6, s: 0.9 + Math.random() * 0.3, life: 60 });
      }
    }
    for (var j = birds.length - 1; j >= 0; j--) {
      var b = birds[j];
      b.x += b.vx * dt; b.y += b.vy * dt; b.ph += dt * 9; b.life -= dt;
      if (b.life <= 0 || b.x < -120 || b.x > api.cw + 120) birds.splice(j, 1);
    }
  }
  function drawBirds(g2, api) {
    g2.strokeStyle = api.night > 0.5 ? 'rgba(20,20,30,.55)' : 'rgba(40,36,34,.7)';
    g2.lineWidth = 1.3; g2.lineCap = 'round';
    birds.forEach(function (b) {
      var f = Math.sin(b.ph) * 3 * b.s, w = 5 * b.s;
      g2.beginPath(); g2.moveTo(b.x - w, b.y - f); g2.quadraticCurveTo(b.x - w * 0.4, b.y - 1, b.x, b.y);
      g2.quadraticCurveTo(b.x + w * 0.4, b.y - 1, b.x + w, b.y - f); g2.stroke();
    });
    // gulls wheeling over the harbour
    var fish = (G().buildings || []).filter(function (b) { return b.built && b.id === 'fishery'; });
    if (api.night < 0.5) fish.slice(0, 3).forEach(function (b, i) {
      for (var k = 0; k < 2; k++) {
        var a = time * (0.5 + k * 0.13) + i * 2 + k * 3, r = 0.9 + k * 0.4;
        var s = api.toScreen(b.x + 0.5 + Math.cos(a) * r, b.y + 0.5 + Math.sin(a) * r);
        var y = s.y - api.z * (1.3 + k * 0.3), f = Math.sin(time * 6 + k) * 2.2, w = Math.max(3, api.z * 0.07);
        g2.strokeStyle = 'rgba(245,245,240,.9)'; g2.lineWidth = 1.4;
        g2.beginPath(); g2.moveTo(s.x - w, y - f); g2.quadraticCurveTo(s.x - w * 0.4, y - 1, s.x, y);
        g2.quadraticCurveTo(s.x + w * 0.4, y - 1, s.x + w, y - f); g2.stroke();
      }
    });
  }

  /* ---------------- ox-carts hauling goods to the castle ---------------- */
  var LOAD = { food: '#d9bf55', wood: '#8a6b45', stone: '#a09b90', iron: '#8f95a3', wool: '#efe8d8', cloth: '#b5503f', bread: '#c89a5a' };
  function updateCarts(dt) {
    var g = G();
    cartTimer -= dt * Math.max(1, Math.min(4, g.speed || 1));
    if (cartTimer <= 0 && carts.length < 3) {
      cartTimer = 10 + Math.random() * 14;
      var src = g.buildings.filter(function (b) { return b.built && b.def.produces && b.workers > 0 && Math.hypot(b.x - g.buildings[0].x, b.y - g.buildings[0].y) > 3; });
      if (src.length) {
        var b = src[Math.floor(Math.random() * src.length)], c = g.buildings[0];
        var p = W.path(b.x, b.y, c.x, c.y + 1, 500);
        if (p && p.length > 2) carts.push({ path: p, i: 0, x: b.x + 0.5, y: b.y + 0.5, load: Object.keys(b.def.produces)[0], face: 1, bob: 0 });
      }
    }
    for (var j = carts.length - 1; j >= 0; j--) {
      var ct = carts[j], n = ct.path[ct.i];
      if (!n) { carts.splice(j, 1); continue; }
      var tx = n.x + 0.5, ty = n.y + 0.5, dx = tx - ct.x, dy = ty - ct.y, d = Math.hypot(dx, dy);
      var sp = 0.55 * dt * Math.min(4, g.speed || 1);
      if (d < sp) { ct.x = tx; ct.y = ty; ct.i++; }
      else { ct.x += dx / d * sp; ct.y += dy / d * sp; if (Math.abs(dx - dy) > 0.02) ct.face = dx - dy > 0 ? 1 : -1; }
      ct.bob += sp * 12;
    }
  }
  function drawCart(g2, ct, api) {
    var s = api.toScreen(ct.x, ct.y), z = api.z, u = z / 60, f = ct.face;
    // ox
    var ox = s.x + f * 12 * u, oy = s.y - 1 * u;
    g2.fillStyle = 'rgba(0,0,0,.25)'; g2.beginPath(); g2.ellipse(s.x + 4 * u, s.y + 1 * u, 18 * u, 5 * u, 0, 0, 6.3); g2.fill();
    g2.fillStyle = '#6b4a30'; g2.beginPath(); g2.ellipse(ox, oy - 6 * u, 7 * u, 4 * u, 0, 0, 6.3); g2.fill();
    g2.beginPath(); g2.ellipse(ox + f * 6 * u, oy - 7 * u, 2.6 * u, 2.2 * u, 0, 0, 6.3); g2.fill();
    g2.strokeStyle = '#4a3322'; g2.lineWidth = 1.4 * u;
    var st2 = Math.sin(ct.bob) * 1.5 * u;
    g2.beginPath(); g2.moveTo(ox - 4 * u, oy - 3 * u); g2.lineTo(ox - 4 * u + st2, oy + 1 * u); g2.moveTo(ox + 4 * u, oy - 3 * u); g2.lineTo(ox + 4 * u - st2, oy + 1 * u); g2.stroke();
    // cart and its load
    g2.fillStyle = '#8a6a44'; g2.fillRect(s.x - 7 * u, s.y - 10 * u, 14 * u, 6 * u);
    g2.fillStyle = LOAD[ct.load] || '#c9b58a';
    g2.beginPath(); g2.ellipse(s.x, s.y - 11 * u, 6.5 * u, 3.4 * u, 0, 0, 6.3); g2.fill();
    g2.fillStyle = '#3d2c1c'; g2.beginPath(); g2.arc(s.x - 3 * u, s.y - 3 * u, 3 * u, 0, 6.3); g2.fill();
    g2.strokeStyle = '#6b4a30'; g2.lineWidth = 1 * u; g2.beginPath(); g2.moveTo(s.x + f * 7 * u, s.y - 7 * u); g2.lineTo(ox - f * 4 * u, oy - 5 * u); g2.stroke();
  }

  /* ---------------- fish jumping ---------------- */
  function updateJumps(dt) {
    jumpTimer -= dt;
    if (jumpTimer <= 0) {
      jumpTimer = 1.5 + Math.random() * 4;
      var t = W.tiles[Math.floor(Math.random() * W.tiles.length)];
      if (t && t.terr === 'water' && W.nearCount(t.x, t.y, ['shore'], 2) > 0) jumps.push({ x: t.x + Math.random(), y: t.y + Math.random(), t: 0 });
    }
    for (var j = jumps.length - 1; j >= 0; j--) { jumps[j].t += dt; if (jumps[j].t > 1.6) jumps.splice(j, 1); }
  }
  function drawJumps(g2, api) {
    jumps.forEach(function (J) {
      var s = api.toScreen(J.x, J.y), u = api.z / 60;
      if (J.t < 0.5) {
        var k = J.t / 0.5, arc = Math.sin(k * Math.PI) * 10 * u;
        g2.fillStyle = 'rgba(200,210,215,.95)';
        g2.beginPath(); g2.ellipse(s.x - 6 * u + k * 12 * u, s.y - arc, 3 * u, 1.3 * u, (k - 0.5) * 1.6, 0, 6.3); g2.fill();
      }
      var r = (J.t) * 9 * u;
      g2.strokeStyle = 'rgba(230,240,245,' + (0.6 * (1 - J.t / 1.6)).toFixed(2) + ')'; g2.lineWidth = 1;
      g2.beginPath(); g2.ellipse(s.x + 6 * u, s.y, r, r * 0.45, 0, 0, 6.3); g2.stroke();
    });
  }

  /* ---------------- surf on the beaches ---------------- */
  function drawSurf(g2, api) {
    var x0 = api.x0, x1 = api.x1, y0 = api.y0, y1 = api.y1, z = api.z;
    if (z < 22) return;
    g2.lineCap = 'round';
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var t = W.at(x, y);
      if (!t || t.terr !== 'shore') continue;
      // the direction of the land from here
      var lx = 0, ly = 0;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        var n = W.at(x + ox, y + oy);
        if (n && n.terr !== 'water' && n.terr !== 'shore') { lx += ox; ly += oy; }
      }
      var m = Math.hypot(lx, ly);
      if (!m) continue;
      lx /= m; ly /= m;
      var h = hash(x * 131 + y * 7919), ph = time * 0.7 + (h % 628) / 100;
      var run = (Math.sin(ph) + 1) / 2;               // the wave runs up the sand and back
      var cx = x + 0.5 + lx * (0.15 + run * 0.35), cy = y + 0.5 + ly * (0.15 + run * 0.35);
      var px = -ly * 0.45, py = lx * 0.45;
      var a = api.toScreen(cx - px, cy - py), b = api.toScreen(cx + px, cy + py), mid = api.toScreen(cx + lx * 0.12, cy + ly * 0.12);
      g2.strokeStyle = 'rgba(245,250,250,' + (0.25 + run * 0.4).toFixed(2) + ')';
      g2.lineWidth = Math.max(1, z * 0.025);
      g2.beginPath(); g2.moveTo(a.x, a.y); g2.quadraticCurveTo(mid.x, mid.y, b.x, b.y); g2.stroke();
    }
  }

  /* ---------------- puddles after rain ---------------- */
  function drawPuddles(g2, api) {
    if (wet < 0.05 || SIM.season().key === 'winter') return;
    for (var y = api.y0; y <= api.y1; y++) for (var x = api.x0; x <= api.x1; x++) {
      var t = W.at(x, y);
      if (!t || !t.path || t.bld) continue;
      var h = hash(x * 977 + y * 131);
      if (h % 3) continue;
      var s = api.toScreen(x + 0.3 + (h % 40) / 100, y + 0.3 + ((h >> 6) % 40) / 100), r = api.z * (0.08 + (h % 7) / 90);
      g2.fillStyle = 'rgba(150,175,195,' + (wet * 0.45).toFixed(2) + ')';
      g2.beginPath(); g2.ellipse(s.x, s.y, r, r * 0.42, 0, 0, 6.3); g2.fill();
      g2.fillStyle = 'rgba(235,245,255,' + (wet * 0.35).toFixed(2) + ')';
      g2.beginPath(); g2.ellipse(s.x - r * 0.25, s.y - r * 0.08, r * 0.35, r * 0.1, 0, 0, 6.3); g2.fill();
    }
  }

  /* ---------------- homes: washing, woodpiles, hens ---------------- */
  function woodFill() {
    var k = SIM.season().key, p = SIM.seasonProgress();
    return k === 'autumn' ? 0.6 + p * 0.4 : k === 'winter' ? 1 - p * 0.85 : k === 'spring' ? 0.15 + p * 0.1 : 0.25 + p * 0.3;
  }
  function homeItems(items, api) {
    var g = G(), season = SIM.season().key, raining = g.weather === 'rain';
    g.buildings.forEach(function (b) {
      if (!b.built || !b.def.evolves) return;
      var h = hash(b.uid * 7 + b.x * 131 + b.y);
      if (!api.onScreen(b.x + 0.5, b.y + 0.5, api.z * 2)) return;
      // the woodpile by the side wall
      items.push({ k: 'scn', d: b.x + b.y + 1.02, o: { draw: function (g2) { drawWoodpile(g2, b, api); } } });
      // washing on the line, on a dry day
      if (h % 5 < 2 && !raining && season !== 'winter' && api.night < 0.6)
        items.push({ k: 'scn', d: b.x + b.y + 1.6, o: { draw: function (g2) { drawWashing(g2, b, h, api); } } });
      // hens scratching in the yard
      if (h % 3 === 0 && season !== 'winter' && api.night < 0.55)
        items.push({ k: 'scn', d: b.x + b.y + 1.4, o: { draw: function (g2) { drawHens(g2, b, h, api); } } });
    });
    // storm damage: a tarp over the torn thatch
    g.buildings.forEach(function (b) {
      if (!b.damage || !api.onScreen(b.x + 0.5, b.y + 0.5, api.z * 2)) return;
      items.push({ k: 'scn', d: b.x + b.y + (b.def.w || 1) + 0.1, o: { draw: function (g2) {
        var s = api.toScreen(b.x + (b.def.w || 1) * 0.5, b.y + (b.def.h || 1) * 0.5), u = api.z / 60;
        g2.fillStyle = '#6b5a44'; g2.save(); g2.translate(s.x + 4 * u, s.y - 30 * u); g2.rotate(-0.4);
        g2.fillRect(-8 * u, -4 * u, 16 * u, 9 * u); g2.strokeStyle = '#3d2c1c'; g2.lineWidth = 0.8; g2.strokeRect(-8 * u, -4 * u, 16 * u, 9 * u); g2.restore();
      } } });
    });
    // the churchyard fills, one stone at a time
    var chapel = g.buildings.filter(function (b) { return b.built && b.id === 'chapel'; })[0], dead = Math.min(24, g.stats.dead || 0);
    if (chapel && dead && api.onScreen(chapel.x + 0.5, chapel.y + 0.5, api.z * 3)) {
      items.push({ k: 'scn', d: chapel.x + chapel.y + 1.9, o: { draw: function (g2) {
        var u = api.z / 60;
        for (var i = 0; i < dead; i++) {
          var s = api.toScreen(chapel.x + 1.15 + (i % 4) * 0.16, chapel.y + 0.15 + Math.floor(i / 4) * 0.15);
          g2.fillStyle = 'rgba(0,0,0,.2)'; g2.fillRect(s.x - 1 * u, s.y - 0.5 * u, 4 * u, 1.5 * u);
          g2.fillStyle = i % 3 ? '#a39c8c' : '#8f8878';
          g2.beginPath(); g2.moveTo(s.x - 1.6 * u, s.y); g2.lineTo(s.x - 1.6 * u, s.y - 3.6 * u); g2.quadraticCurveTo(s.x, s.y - 5.4 * u, s.x + 1.6 * u, s.y - 3.6 * u); g2.lineTo(s.x + 1.6 * u, s.y); g2.fill();
        }
      } } });
    }
    carts.forEach(function (ct) {
      if (api.onScreen(ct.x, ct.y, 60)) items.push({ k: 'scn', d: ct.x + ct.y + 0.03, o: { draw: function (g2) { drawCart(g2, ct, api); } } });
    });
  }
  function drawWoodpile(g2, b, api) {
    var fill = woodFill(); if (fill < 0.06) return;
    var s = api.toScreen(b.x + 1.02, b.y + 0.25), u = api.z / 60, n = Math.round(1 + fill * 5);
    for (var r = 0; r < 3; r++) for (var i = 0; i < n - r; i++) {
      if (r * 3 + i > fill * 12) continue;
      var x = s.x + i * 3.4 * u - r * 1.2 * u, y = s.y - 2 * u - r * 3 * u - i * 1.7 * u;
      g2.fillStyle = '#7a5838'; g2.beginPath(); g2.ellipse(x, y, 3.4 * u, 1.9 * u, -0.45, 0, 6.3); g2.fill();
      g2.fillStyle = '#c9a26c'; g2.beginPath(); g2.ellipse(x + 2.4 * u, y - 1.1 * u, 1.1 * u, 1.3 * u, -0.45, 0, 6.3); g2.fill();
    }
  }
  var CLOTH = ['#e8e2d0', '#b5503f', '#3f6ea5', '#d9c89a', '#5d8a3f', '#f0ece2'];
  function drawWashing(g2, b, h, api) {
    var a = api.toScreen(b.x + 1.25, b.y + 0.15), c = api.toScreen(b.x + 1.25, b.y + 0.95), u = api.z / 60, H = 16 * u;
    g2.strokeStyle = '#6b4a2e'; g2.lineWidth = Math.max(1, 1.4 * u);
    g2.beginPath(); g2.moveTo(a.x, a.y); g2.lineTo(a.x, a.y - H); g2.moveTo(c.x, c.y); g2.lineTo(c.x, c.y - H); g2.stroke();
    var sag = 3 * u, w = wind();
    g2.strokeStyle = 'rgba(230,225,210,.8)'; g2.lineWidth = 0.8;
    g2.beginPath(); g2.moveTo(a.x, a.y - H); g2.quadraticCurveTo((a.x + c.x) / 2, (a.y + c.y) / 2 - H + sag * 2, c.x, c.y - H); g2.stroke();
    var n = 3 + h % 3;
    for (var i = 1; i <= n; i++) {
      var k = i / (n + 1), x = a.x + (c.x - a.x) * k, y = a.y + (c.y - a.y) * k - H + Math.sin(k * Math.PI) * sag;
      var sw = Math.sin(time * 3 + i + h) * 2 * u * w, cw2 = 4 * u, chh = (5 + (h >> i) % 4) * u;
      g2.fillStyle = CLOTH[(h >> (i * 2)) % CLOTH.length];
      g2.beginPath(); g2.moveTo(x - cw2 / 2, y); g2.lineTo(x + cw2 / 2, y); g2.lineTo(x + cw2 / 2 + sw, y + chh); g2.lineTo(x - cw2 / 2 + sw, y + chh); g2.closePath(); g2.fill();
    }
  }
  function drawHens(g2, b, h, api) {
    var u = api.z / 60;
    for (var i = 0; i < 2 + h % 2; i++) {
      var a = time * 0.3 + i * 2.2 + h, r = 0.25 + (i % 2) * 0.12;
      var s = api.toScreen(b.x + 0.5 + Math.cos(a) * r + 0.6, b.y + 1.15 + Math.sin(a * 0.7) * r * 0.5);
      var peck = Math.max(0, Math.sin(time * 5 + i * 3)) * 1.5 * u;
      g2.fillStyle = 'rgba(0,0,0,.2)'; g2.beginPath(); g2.ellipse(s.x, s.y, 3 * u, 1.1 * u, 0, 0, 6.3); g2.fill();
      g2.fillStyle = i % 2 ? '#a8653a' : '#efe6d4';
      g2.beginPath(); g2.ellipse(s.x, s.y - 3 * u, 3 * u, 2.3 * u, 0, 0, 6.3); g2.fill();
      g2.beginPath(); g2.arc(s.x + 2.4 * u, s.y - 5 * u + peck, 1.4 * u, 0, 6.3); g2.fill();
      g2.fillStyle = '#c0392b'; g2.fillRect(s.x + 2 * u, s.y - 6.8 * u + peck, 1 * u, 1 * u);
      g2.fillStyle = '#e0a030'; g2.fillRect(s.x + 3.5 * u, s.y - 5 * u + peck, 1.2 * u, 0.7 * u);
    }
  }

  /* ---------------- fireworks over the castle ---------------- */
  var rockets = [], sparks = [], fwQueue = 0, fwTimer = 0;
  var FW_COL = ['#ffd24a', '#ff6a4a', '#7ad0ff', '#b98aff', '#8fff8a', '#fff'];
  function fireworks(n) { fwQueue += n || 5; }
  function updateFireworks(dt, api) {
    fwTimer -= dt;
    if (fwQueue > 0 && fwTimer <= 0) {
      fwQueue--; fwTimer = 0.35 + Math.random() * 0.5;
      var c = G().buildings[0], s = api.toScreen(c.x + 1, c.y + 1);
      rockets.push({ x: s.x + (Math.random() - 0.5) * 120, y: s.y - 20, vy: -(180 + Math.random() * 80), t: 0.9 + Math.random() * 0.4, col: FW_COL[Math.floor(Math.random() * FW_COL.length)] });
      if (U.sfx.tap) U.sfx.tap();
    }
    for (var i = rockets.length - 1; i >= 0; i--) {
      var r = rockets[i]; r.y += r.vy * dt; r.vy += 60 * dt; r.t -= dt;
      if (r.t <= 0) {
        for (var k = 0; k < 26; k++) { var a = k / 26 * 6.283, sp = 60 + Math.random() * 50; sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.2, col: r.col }); }
        rockets.splice(i, 1);
        if (U.sfx.clash) setTimeout(function () { U.sfx.arrow && U.sfx.arrow(); }, 120);
      }
    }
    for (var j = sparks.length - 1; j >= 0; j--) {
      var p = sparks[j]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 50 * dt; p.vx *= 0.985; p.life -= dt;
      if (p.life <= 0) sparks.splice(j, 1);
    }
  }
  function drawFireworks(g2) {
    if (!rockets.length && !sparks.length) return;
    g2.save(); g2.globalCompositeOperation = 'lighter';
    rockets.forEach(function (r) { g2.fillStyle = '#fff3c0'; g2.fillRect(r.x - 1, r.y - 1, 2, 5); });
    sparks.forEach(function (p) { g2.globalAlpha = Math.min(1, p.life); g2.fillStyle = p.col; g2.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4); });
    g2.restore();
  }

  /* ---------------- the sky: mist, rainbow, lightning ---------------- */
  function drawSky(g2, api) {
    // dawn mist lying in the low ground and over the water
    var p = api.dayPhase, dawn = p < 0.18 ? U.clamp(1 - Math.abs(p - 0.07) / 0.11, 0, 1) : 0;
    if (dawn > 0.02 && !api.calm) {
      g2.save();
      for (var i = 0; i < 7; i++) {
        var x = ((i * 173 + time * 6) % (api.cw + 400)) - 200, y = api.ch * (0.25 + (i * 0.37 % 0.6));
        var gr = g2.createRadialGradient(x, y, 10, x, y, api.cw * 0.45);
        gr.addColorStop(0, 'rgba(235,238,240,' + (0.22 * dawn).toFixed(3) + ')'); gr.addColorStop(1, 'rgba(235,238,240,0)');
        g2.fillStyle = gr; g2.beginPath(); g2.ellipse(x, y, api.cw * 0.45, api.cw * 0.12, 0, 0, 6.3); g2.fill();
      }
      g2.restore();
    }
    if (rainbow > 0.01) {
      var cx = api.cw * 0.7, cy = api.ch * 0.62, R = Math.max(api.cw, api.ch) * 0.6;
      var cols = ['#ff4a3a', '#ff9a2a', '#ffe23a', '#5ad04a', '#3a8aff', '#7a4aff'];
      g2.save(); g2.globalAlpha = Math.min(1, rainbow * 1.4) * 0.16; g2.lineWidth = R * 0.018;
      cols.forEach(function (c, i) { g2.strokeStyle = c; g2.beginPath(); g2.arc(cx, cy, R - i * R * 0.018, Math.PI * 1.08, Math.PI * 1.72); g2.stroke(); });
      g2.restore();
    }
    drawBirds(g2, api);
    updateFireworks(1 / 60, api);
    drawFireworks(g2);
    if (flash > 0.02) {
      g2.fillStyle = 'rgba(235,240,255,' + (flash * flash * 0.55).toFixed(3) + ')';
      g2.fillRect(0, 0, api.cw, api.ch);
    }
  }

  return {
    update: update, wind: wind, fireworks: fireworks, homeItems: homeItems, drawSurf: drawSurf, drawPuddles: drawPuddles,
    drawJumps: drawJumps, drawSky: drawSky, get wet() { return wet; }
  };
})();
