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
    var spd = a.speed * (tile && tile.road ? 2.3 : 1.25);
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

  /* draw one villager at screen pos */
  function draw(g, a, px, py, sc) {
    var bob = Math.sin(a.bob) * (a.path ? 1 : 0.25) * sc * 0.06;
    var h = 12 * sc / 40, w = 6 * sc / 40;
    g.globalAlpha = .25; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(px, py + 1, w * .55, w * .26, 0, 0, 6.3); g.fill();
    g.globalAlpha = 1;
    // legs
    g.fillStyle = '#3b2e22';
    var swing = Math.sin(a.bob) * w * .22;
    g.fillRect(px - w * .28 + swing, py - h * .3, w * .22, h * .3);
    g.fillRect(px + w * .06 - swing, py - h * .3, w * .22, h * .3);
    // body
    g.fillStyle = a.shirt;
    ART.rr(g, px - w * .4, py - h * .78 + bob, w * .8, h * .5, w * .2); g.fill();
    // head
    g.fillStyle = a.skin;
    g.beginPath(); g.arc(px, py - h * .92 + bob, w * .3, 0, 6.3); g.fill();
    // hair / cap
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.beginPath(); g.arc(px, py - h * .98 + bob, w * .3, Math.PI, 0); g.fill();
    // carried goods
    if (a.carry) {
      g.fillStyle = CARRY_COL[a.carry] || '#ccc';
      g.fillRect(px + a.face * w * .42 - w * .16, py - h * .68 + bob, w * .34, w * .34);
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = Math.max(.6, sc * .012);
      g.strokeRect(px + a.face * w * .42 - w * .16, py - h * .68 + bob, w * .34, w * .34);
    }
    // working sparkle
    if (a.state === 'working' && Math.sin(a.bob * 2) > 0.7) {
      g.fillStyle = 'rgba(255,240,180,.8)';
      g.fillRect(px + a.face * w * .5, py - h * .8, w * .16, w * .16);
    }
  }

  return {
    get list() { return list; },
    reset: reset, update: update, draw: draw, dropJob: dropJob
  };
})();
