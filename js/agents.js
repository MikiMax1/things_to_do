/* ============================================================
   agents.js — villagers who live in your houses, walk your roads
   and work your buildings. Purely cosmetic, but driven by the
   real economy: a farm with no workers has nobody standing in it.
   ============================================================ */
var AGENTS = (function () {
  'use strict';

  var list = [];
  var MAX = 46;                 // cap for phone performance
  var SHIRTS = ['#b5503f', '#3f6ea5', '#5d8a3f', '#8a5ab0', '#c08a2e', '#4a8f86', '#a6553f', '#6b6f8f'];
  var SKINS  = ['#e8c39a', '#d3a476', '#a9764e', '#7d5334', '#f0d3b0'];

  function reset() { list = []; }

  function mk(home) {
    var t = home ? { x: home.x, y: home.y } : W.randomWalkable(Math.random);
    if (!t) t = { x: W.COLS >> 1, y: W.ROWS >> 1 };
    return {
      x: t.x + 0.5, y: t.y + 0.5,
      px: t.x + 0.5, py: t.y + 0.5,
      home: home || null, job: null,
      path: null, node: 0,
      state: 'idle', timer: Math.random() * 3,
      shirt: U.pick(Math.random, SHIRTS), skin: U.pick(Math.random, SKINS),
      carry: null, bob: Math.random() * 6.28, face: 1, speed: 0.9 + Math.random() * 0.35
    };
  }

  function dropJob(b) {
    list.forEach(function (a) {
      if (a.job === b) { a.job = null; a.path = null; a.state = 'idle'; }
      if (a.home === b) { a.home = null; }
    });
  }

  /* keep the crowd matching the population and the job board */
  function restaff() {
    var G = SIM.G;
    if (!G) return;
    var want = Math.min(MAX, Math.max(1, Math.round(G.pop)));
    var homes = G.buildings.filter(function (b) { return b.built && b.def.housing && b.id !== 'castle'; });

    while (list.length < want) list.push(mk(homes.length ? U.pick(Math.random, homes) : null));
    while (list.length > want) list.pop();

    // rebuild the job roster from SIM's worker allocation
    var slots = [];
    G.buildings.forEach(function (b) {
      if (!b.built || b.paused) return;
      for (var i = 0; i < b.workers; i++) slots.push(b);
    });
    // construction sites want visitors too
    G.buildings.forEach(function (b) { if (!b.built) { slots.push(b); slots.push(b); } });

    var used = 0;
    list.forEach(function (a) {
      if (a.job && (!a.job.built && a.job.prog >= 1)) a.job = null;
      if (a.job && G.buildings.indexOf(a.job) < 0) a.job = null;
    });
    // clear jobs that no longer have a slot, then fill
    var taken = {};
    list.forEach(function (a) {
      if (!a.job) return;
      var k = a.job.uid;
      taken[k] = (taken[k] || 0) + 1;
      var allow = a.job.built ? a.job.workers : 2;
      if (taken[k] > allow) { a.job = null; taken[k]--; }
    });
    list.forEach(function (a) {
      if (a.job) return;
      for (; used < slots.length; used++) {
        var b = slots[used];
        var k = b.uid, allow = b.built ? b.workers : 2;
        if ((taken[k] || 0) >= allow) continue;
        taken[k] = (taken[k] || 0) + 1;
        a.job = b; a.path = null; a.state = 'idle';
        used++;
        return;
      }
    });
    // rehome the homeless
    list.forEach(function (a) {
      if ((!a.home || SIM.G.buildings.indexOf(a.home) < 0) && homes.length)
        a.home = U.pick(Math.random, homes);
    });
  }

  function goTo(a, tx, ty) {
    var p = W.path(Math.floor(a.x), Math.floor(a.y), tx, ty, 700);
    if (!p || !p.length) {
      // no route — hop there rather than freeze
      a.x = tx + 0.5; a.y = ty + 0.5; a.path = null;
      return false;
    }
    a.path = p; a.node = 0;
    return true;
  }

  function follow(a, dt) {
    if (!a.path || a.node >= a.path.length) { a.path = null; return true; }
    var n = a.path[a.node];
    var tx = n.x + 0.5, ty = n.y + 0.5;
    var tile = W.at(n.x, n.y);
    var spd = a.speed * (tile && tile.path ? 1.7 : 1.1);
    var dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
    if (d < 0.06) {
      a.node++;
      if (a.node >= a.path.length) { a.path = null; return true; }
      return false;
    }
    var step = Math.min(d, spd * dt);
    a.x += dx / d * step; a.y += dy / d * step;
    if (Math.abs(dx) > 0.02) a.face = dx > 0 ? 1 : -1;
    a.bob += step * 9;
    return false;
  }

  var CARRY_COL = { food: '#d9bf55', wood: '#8a6b45', stone: '#a09b90', iron: '#8f95a3', gold: '#e0b23c' };

  function carryOf(b) {
    if (!b || !b.def.produces) return null;
    var k = Object.keys(b.def.produces)[0];
    return k || null;
  }

  function update(dt) {
    var G = SIM.G;
    if (!G) return;
    restaff();
    syncAnimals();
    updateAnimals(dt);
    var castle = G.buildings[0];

    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      a.px = a.x; a.py = a.y;
      a.timer -= dt;

      if (a.path) { follow(a, dt); continue; }

      switch (a.state) {
        case 'idle':
          if (a.job) {
            a.state = 'toWork';
            goTo(a, a.job.x, a.job.y);
          } else if (a.timer <= 0) {
            var spot = W.randomWalkable(Math.random);
            if (spot) goTo(a, spot.x, spot.y);
            a.timer = 3 + Math.random() * 6;
            a.state = 'wander';
          }
          break;

        case 'wander':
          a.state = 'idle';
          a.timer = 1 + Math.random() * 4;
          break;

        case 'toWork':
          a.state = 'working';
          a.timer = a.job && !a.job.built ? 2.5 : 4 + Math.random() * 5;
          break;

        case 'working':
          if (!a.job) { a.state = 'idle'; break; }
          if (a.timer <= 0) {
            var c = carryOf(a.job);
            if (c && castle && Math.random() < 0.8) {
              a.carry = c; a.state = 'deliver';
              goTo(a, castle.x, castle.y + 1);
            } else if (a.home && Math.random() < 0.35) {
              a.state = 'toHome';
              goTo(a, a.home.x, a.home.y);
            } else {
              a.timer = 3 + Math.random() * 5;
            }
          }
          break;

        case 'deliver':
          a.carry = null;
          a.state = 'toWork';
          a.timer = 0.4;
          if (a.job) goTo(a, a.job.x, a.job.y); else a.state = 'idle';
          break;

        case 'toHome':
          a.state = 'resting';
          a.timer = 2 + Math.random() * 4;
          break;

        case 'resting':
          if (a.timer <= 0) a.state = 'idle';
          break;

        default:
          a.state = 'idle';
      }
    }
  }

  /* draw one villager standing at screen pos (feet at px,py) */
  var HAIR = ['#2b1d12', '#5a3a1e', '#8a5a2a', '#c9a15a', '#3a2a22', '#6b6258'];
  function draw(g, a, px, py, z) {
    var h = Math.max(7, z * 0.19), w = h * 0.42;
    var moving = !!a.path;
    var step = Math.sin(a.bob);
    var bob = moving ? Math.abs(step) * h * 0.05 : 0;
    if (!a.hair) a.hair = HAIR[(a.speed * 1000 | 0) % HAIR.length];
    // shadow
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.beginPath(); g.ellipse(px + w * 0.3, py, w * 0.62, w * 0.24, 0, 0, 6.3); g.fill();
    var y0 = py - bob;
    // legs
    var sw = moving ? step * w * 0.28 : 0;
    g.strokeStyle = '#3b2e22'; g.lineWidth = Math.max(1.2, w * 0.24); g.lineCap = 'round';
    g.beginPath();
    g.moveTo(px - w * 0.14, y0 - h * 0.34); g.lineTo(px - w * 0.14 + sw, py - 0.5);
    g.moveTo(px + w * 0.14, y0 - h * 0.34); g.lineTo(px + w * 0.14 - sw, py - 0.5);
    g.stroke();
    // tunic, lit from the west
    var gr = g.createLinearGradient(px - w * 0.5, 0, px + w * 0.5, 0);
    gr.addColorStop(0, a.shirt); gr.addColorStop(1, shade(a.shirt, 0.62));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(px - w * 0.36, y0 - h * 0.74); g.lineTo(px + w * 0.36, y0 - h * 0.74);
    g.lineTo(px + w * 0.46, y0 - h * 0.3); g.lineTo(px - w * 0.46, y0 - h * 0.3); g.closePath(); g.fill();
    // belt
    g.fillStyle = 'rgba(40,26,14,.7)'; g.fillRect(px - w * 0.42, y0 - h * 0.47, w * 0.84, Math.max(1, h * 0.05));
    // arms
    var as = moving ? -step * w * 0.3 : 0;
    g.strokeStyle = shade(a.shirt, 0.8); g.lineWidth = Math.max(1.1, w * 0.2);
    g.beginPath();
    g.moveTo(px - w * 0.4, y0 - h * 0.7); g.lineTo(px - w * 0.5 + as, y0 - h * 0.42);
    g.moveTo(px + w * 0.4, y0 - h * 0.7); g.lineTo(px + w * 0.5 - as, y0 - h * 0.42);
    g.stroke();
    // head and hair
    g.fillStyle = a.skin;
    g.beginPath(); g.arc(px, y0 - h * 0.85, w * 0.3, 0, 6.3); g.fill();
    g.fillStyle = a.hair;
    g.beginPath(); g.arc(px, y0 - h * 0.9, w * 0.31, Math.PI * 1.05, Math.PI * 1.95); g.fill();
    // carried goods on the shoulder
    if (a.carry) {
      g.fillStyle = CARRY_COL[a.carry] || '#ccc';
      g.beginPath(); g.ellipse(px + a.face * w * 0.35, y0 - h * 0.8, w * 0.32, w * 0.24, 0, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 0.8; g.stroke();
    }
    // at work: a tool swinging
    if (a.state === 'working' && !moving) {
      var sw2 = Math.sin(a.bob * 3) * 0.9;
      g.strokeStyle = '#6b4a2e'; g.lineWidth = Math.max(1, w * 0.14);
      g.beginPath(); g.moveTo(px + w * 0.45, y0 - h * 0.6);
      g.lineTo(px + w * 0.45 + Math.cos(-1.2 + sw2) * h * 0.4, y0 - h * 0.6 + Math.sin(-1.2 + sw2) * h * 0.4); g.stroke();
      a.bob += 0.02;
    }
  }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' + Math.round(((n >> 16) & 255) * f) + ',' + Math.round(((n >> 8) & 255) * f) + ',' + Math.round((n & 255) * f) + ')';
  }

  /* ---------------- animals and boats ----------------
     Sheep graze inside each pasture, and every fishing hut keeps a boat
     working the water off its jetty. Purely for looks. */
  var animals = [];
  function syncAnimals() {
    var G = SIM.G;
    var want = [];
    G.buildings.forEach(function (b) {
      if (!b.built) return;
      if (b.id === 'pasture') for (var i = 0; i < (b.compact ? 2 : 5); i++) want.push({ k: 'sheep', home: b, i: i });
      if (b.id === 'fishery') want.push({ k: 'boat', home: b, i: 0 });
    });
    // keep existing ones that still have a home
    var keep = [];
    want.forEach(function (w) {
      var have = null;
      for (var j = 0; j < animals.length; j++) {
        if (animals[j].home === w.home && animals[j].k === w.k && animals[j].i === w.i) { have = animals[j]; break; }
      }
      keep.push(have || mkAnimal(w));
    });
    animals = keep;
  }
  function mkAnimal(w) {
    var b = w.home, sz = b.compact ? 1 : (b.def.w || 1);
    var a = { k: w.k, home: b, i: w.i, x: b.x + 0.5, y: b.y + 0.5, tx: 0, ty: 0, t: Math.random() * 4, face: 1, ph: Math.random() * 6 };
    if (w.k === 'sheep') {
      a.x = b.x + 0.3 + Math.random() * (sz - 0.6); a.y = b.y + 0.3 + Math.random() * (sz - 0.6);
      if (sz > 1 && a.x < b.x + 0.7 && a.y < b.y + 0.6) a.x += 0.8;
      a.tx = a.x; a.ty = a.y;
      a.white = Math.random() > 0.15;
    } else {
      var spot = waterNear(b);
      a.x = spot.x; a.y = spot.y; a.tx = a.x; a.ty = a.y;
    }
    return a;
  }
  function waterNear(b) {
    var opts = [];
    for (var dy = -3; dy <= 3; dy++) for (var dx = -3; dx <= 3; dx++) {
      var t = W.at(b.x + dx, b.y + dy);
      if (t && t.terr === 'water' || t && t.terr === 'shore') opts.push({ x: t.x + 0.5, y: t.y + 0.5 });
    }
    if (!opts.length) return { x: b.x + 0.5, y: b.y + 1.5 };
    return opts[Math.floor(Math.random() * opts.length)];
  }
  function updateAnimals(dt) {
    for (var i = 0; i < animals.length; i++) {
      var a = animals[i], b = a.home;
      a.t -= dt;
      var dx = a.tx - a.x, dy = a.ty - a.y, d = Math.hypot(dx, dy);
      var spd = a.k === 'boat' ? 0.25 : 0.12;
      if (d > 0.02) {
        a.x += dx / d * Math.min(d, spd * dt); a.y += dy / d * Math.min(d, spd * dt);
        a.face = (dx - dy) >= 0 ? 1 : -1;
        a.moving = true;
      } else {
        a.moving = false;
        if (a.t <= 0) {
          a.t = a.k === 'boat' ? 4 + Math.random() * 8 : 2 + Math.random() * 6;
          if (a.k === 'sheep') {
            var sz = b.compact ? 1 : (b.def.w || 1);
            var nx = b.x + 0.25 + Math.random() * (sz - 0.5), ny = b.y + 0.25 + Math.random() * (sz - 0.5);
            if (sz > 1 && nx < b.x + 0.65 && ny < b.y + 0.55) nx += 0.8;
            a.tx = nx; a.ty = ny;
          } else {
            var s = waterNear(b); a.tx = s.x + (Math.random() - .5) * 0.5; a.ty = s.y + (Math.random() - .5) * 0.5;
          }
        }
      }
    }
  }
  function drawAnimal(g, a, px, py, z, season) {
    if (a.k === 'sheep') {
      var r = Math.max(3, z * 0.055);
      var bob = a.moving ? Math.abs(Math.sin(a.x * 30)) * r * 0.2 : 0;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(px + r * 0.4, py, r * 1.3, r * 0.45, 0, 0, 6.3); g.fill();
      g.strokeStyle = '#2a2420'; g.lineWidth = Math.max(1, r * 0.28);
      g.beginPath(); g.moveTo(px - r * 0.6, py - r * 0.6); g.lineTo(px - r * 0.6, py); g.moveTo(px + r * 0.6, py - r * 0.6); g.lineTo(px + r * 0.6, py); g.stroke();
      var gr = g.createRadialGradient(px - r * 0.4, py - r * 1.3 - bob, r * 0.2, px, py - r - bob, r * 1.3);
      gr.addColorStop(0, a.white ? '#fbf8f0' : '#6a5a4a'); gr.addColorStop(1, a.white ? '#c8c0b0' : '#3a3028');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(px, py - r - bob, r * 1.15, r * 0.8, 0, 0, 6.3); g.fill();
      g.fillStyle = '#2a2420';
      g.beginPath(); g.ellipse(px + a.face * r * 1.05, py - r * 1.25 - bob, r * 0.38, r * 0.3, 0, 0, 6.3); g.fill();
    } else {
      var L = Math.max(6, z * 0.2);
      var rock = Math.sin(SIM.G.time * 1.5 + a.ph) * 1.2;
      g.save(); g.translate(px, py + rock * 0.3);
      g.fillStyle = 'rgba(10,30,50,.3)'; g.beginPath(); g.ellipse(0, 1, L * 0.7, L * 0.2, 0, 0, 6.3); g.fill();
      // hull, pointing along its heading
      g.scale(a.face, 1);
      g.fillStyle = '#6b4a2e';
      g.beginPath(); g.moveTo(-L * 0.6, -L * 0.12); g.quadraticCurveTo(0, L * 0.3, L * 0.6, -L * 0.2);
      g.lineTo(L * 0.45, -L * 0.28); g.lineTo(-L * 0.5, -L * 0.22); g.closePath(); g.fill();
      g.fillStyle = '#8a6440'; g.fillRect(-L * 0.5, -L * 0.3, L * 0.95, L * 0.07);
      // mast and sail
      g.strokeStyle = '#3d2c1c'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, -L * 0.25); g.lineTo(0, -L * 1.0); g.stroke();
      g.fillStyle = '#e8dcc0';
      g.beginPath(); g.moveTo(L * 0.03, -L * 0.95); g.quadraticCurveTo(L * 0.35, -L * 0.6, L * 0.05, -L * 0.32); g.closePath(); g.fill();
      g.restore();
    }
  }

  return {
    get list() { return list; },
    get animals() { return animals; },
    reset: function () { reset(); animals = []; }, update: update, draw: draw, dropJob: dropJob,
    drawAnimal: drawAnimal, syncAnimals: syncAnimals
  };
})();
