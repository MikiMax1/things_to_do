/* ============================================================
   battle.js — the visual skirmish. Your actual roster marches
   out, fights unit-by-unit, and the survivors come home.
   ============================================================ */
var BATTLE = (function () {
  'use strict';

  var FW = 340, FH = 620;      // virtual field — reshaped to the screen in resize()
  var cv, g, cw, ch, dpr = 1, scale = 1, ox = 0, oy = 0;
  var units = [], shots = [], fx = [];
  var running = false, done = false, t = 0, kind = 'raid';
  var onDone = null, ctx = null;
  var startOurs = 0, startFoes = 0;
  var logLines = [];
  var orders = [];
  var routing = { ours: false, foes: false };
  var endTimer = 0;
  var speedMul = 1.35;

  var COL = {
    ours: { shirt: '#3f6ea5', shield: '#2d5c96', trim: '#9dc0e8' },
    foes: { shirt: '#9c3b2c', shield: '#7a2a1e', trim: '#e0a08a' }
  };

  function el(id) { return document.getElementById(id); }

  function init() {
    cv = el('battle-canvas');
    g = cv.getContext('2d');
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = cv.clientWidth; ch = cv.clientHeight;
    cv.width = Math.floor(cw * dpr); cv.height = Math.floor(ch * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the field takes the shape of the screen, so a portrait phone gets a
    // tall battlefield rather than a thin letterboxed strip
    var portrait = ch >= cw;
    FW = portrait ? 340 : 620;
    FH = portrait ? 620 : 330;
    scale = Math.min(cw / FW, ch / FH) * 0.98;
    ox = (cw - FW * scale) / 2;
    oy = (ch - FH * scale) / 2;
  }
  function P(x, y) { return { x: ox + x * scale, y: oy + y * scale }; }

  /* ---------------- roster building ---------------- */
  function mkUnit(side, key, def, x, y, bonus) {
    return {
      side: side, key: key, name: def.name, vet: !!bonus.vet,
      hp: def.hp * (bonus.hp || 1), maxHp: def.hp * (bonus.hp || 1),
      atk: def.atk * (bonus.atk || 1), def: def.def + (bonus.def || 0),
      spd: def.spd * (bonus.spd || 1), rng: def.rng, rate: def.rate, splash: def.splash || 0,
      x: x, y: y, tx: x, ty: y, cd: Math.random() * def.rate,
      target: null, dead: false, flash: 0, bob: Math.random() * 6.28,
      fade: 1, state: 'advance'
    };
  }

  function buildOurs() {
    var G = SIM.G, sb = SIM.smithBonus();
    var defBonus = kind === 'defend' ? SIM.defenseScore() / 18 : 0;
    var fm = DATA.FORMATIONS[G.formation] || DATA.FORMATIONS.line;
    var vets = G.vets || {};
    var arr = [], i, n = 0;
    var keys = Object.keys(G.army);
    keys.forEach(function (k) { n += G.army[k]; });
    var perCol = Math.max(4, Math.ceil(Math.sqrt(n) * 1.1));
    var slot = 0;
    keys.forEach(function (k) {
      var d = DATA.UNITS[k];
      for (i = 0; i < G.army[k]; i++) {
        var col = Math.floor(slot / perCol), row = slot % perCol;
        // archers and siege deploy behind the line
        var back = (d.rng > 40) ? 26 : 0;
        var x = FW * 0.15 - col * 17 - back + (Math.random() - .5) * 5;
        var y = FH / 2 + (row - (perCol - 1) / 2) * (FH * 0.66 / perCol) + (Math.random() - .5) * 6;
        // veterans of a won battle fight noticeably harder
        var isVet = i < (vets[k] || 0);
        arr.push(mkUnit('ours', k, d, U.clamp(x, 12, FW * 0.38), U.clamp(y, 26, FH - 26), {
          vet: isVet,
          atk: sb.atk * fm.atk * (isVet ? 1.20 : 1),
          def: defBonus + fm.def + (isVet ? 2 : 0),
          hp: (1 + (G.happy - 50) / 400) * fm.hp * (isVet ? 1.22 : 1),
          spd: fm.spd
        }));
        slot++;
      }
    });
    return arr;
  }

  function buildFoes(spec) {
    var arr = [], slot = 0;
    var total = 0;
    Object.keys(spec).forEach(function (k) { total += spec[k]; });
    var perCol = Math.max(4, Math.ceil(Math.sqrt(total) * 1.1));
    Object.keys(spec).forEach(function (k) {
      var d = DATA.FOE_UNITS[k];
      for (var i = 0; i < spec[k]; i++) {
        var col = Math.floor(slot / perCol), row = slot % perCol;
        var back = (d.rng > 40) ? 26 : 0;
        var x = FW * 0.85 + col * 17 + back + (Math.random() - .5) * 5;
        var y = FH / 2 + (row - (perCol - 1) / 2) * (FH * 0.66 / perCol) + (Math.random() - .5) * 6;
        arr.push(mkUnit('foes', k, d, U.clamp(x, FW * 0.62, FW - 12), U.clamp(y, 26, FH - 26), {}));
        slot++;
      }
    });
    return arr;
  }

  /* compose an enemy army from Brannoch's strength */
  function foeArmy(power, flavour) {
    var spec = {};
    var budget = power;
    if (flavour === 'bandits') {
      spec.raider = Math.max(3, Math.round(budget / 9));
      spec.warhound = Math.round(budget / 26);
      spec.bowman = Math.round(budget / 30);
    } else {
      spec.axeman = Math.max(2, Math.round(budget / 15));
      spec.raider = Math.max(2, Math.round(budget / 13));
      spec.bowman = Math.round(budget / 22);
      if (budget > 70) spec.warhound = Math.round(budget / 40);
      if (budget > 110) spec.champion = Math.max(1, Math.round(budget / 90));
    }
    Object.keys(spec).forEach(function (k) { if (!spec[k]) delete spec[k]; });
    return spec;
  }

  /* ---------------- start / end ---------------- */
  function start(k, opts, cb) {
    kind = k; onDone = cb; ctx = opts || {};
    if (!cv) init();
    el('battle').classList.remove('hidden');
    el('bt-result').classList.add('hidden');
    resize();

    var power = ctx.power || SIM.G.rival.str;
    units = buildOurs().concat(buildFoes(foeArmy(power, ctx.flavour)));
    startOurs = units.filter(function (u) { return u.side === 'ours'; }).length;
    startFoes = units.length - startOurs;
    shots = []; fx = []; logLines = []; t = 0; done = false; running = true;
    routing = { ours: false, foes: false }; endTimer = 0;

    el('bt-foe-name').textContent = ctx.name || 'Brannoch';
    el('bt-our-name').textContent = 'Ashveil';
    el('bt-phase').textContent = kind === 'defend' ? 'Defending' : 'Attacking';

    setupOrders();
    say(kind === 'defend'
      ? 'Horns on the walls — ' + (ctx.name || 'Brannoch') + ' is at the gates!'
      : 'Your banners cross the border.');
    if (kind === 'defend' && SIM.defenseScore() > 0)
      say('Your walls and towers steady the line (+' + SIM.defenseScore() + ' defence).');
    var fmNow = DATA.FORMATIONS[SIM.G.formation] || DATA.FORMATIONS.line;
    var vetCount = units.filter(function (u) { return u.side === 'ours' && u.vet; }).length;
    say('Formation: ' + fmNow.name + (vetCount ? ' · ' + vetCount + ' veteran' + (vetCount > 1 ? 's' : '') + ' in the line' : ''));
    U.sfx.horn();
    U.vibrate(40);
  }

  function say(line) {
    logLines.unshift(line);
    if (logLines.length > 5) logLines.pop();
    el('bt-log').innerHTML = logLines.map(function (l, i) {
      return '<div style="opacity:' + (1 - i * 0.18).toFixed(2) + '">' + l + '</div>';
    }).join('');
  }

  /* ---------------- player orders ---------------- */
  function setupOrders() {
    orders = [
      { id: 'charge', label: '⚔️ Charge', cd: 0, max: 22, dur: 6,
        on: function () { say('“For Ashveil!” The line surges forward.'); U.sfx.horn(); } },
      { id: 'hold',   label: '🛡️ Hold',   cd: 0, max: 20, dur: 7,
        on: function () { say('Shields up — the line braces.'); } },
      { id: 'volley', label: '🏹 Volley', cd: 0, max: 24, dur: 5,
        on: function () { say('Loose! Arrows darken the sky.'); U.sfx.arrow(); } }
    ];
    var box = el('bt-orders');
    box.innerHTML = '';
    orders.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'btn sec';
      b.innerHTML = o.label + '<i class="cd" style="transform:scaleX(0)"></i>';
      b.addEventListener('click', function () {
        if (o.cd > 0 || done) return;
        o.cd = o.max; o.active = o.dur; o.on();
        U.vibrate(15);
      });
      o.el = b; o.bar = b.querySelector('.cd');
      box.appendChild(b);
    });
  }

  function activeOrder(id) {
    for (var i = 0; i < orders.length; i++) if (orders[i].id === id && orders[i].active > 0) return true;
    return false;
  }

  /* ---------------- simulation ---------------- */
  function alive(side) {
    var n = 0;
    for (var i = 0; i < units.length; i++) if (!units[i].dead && units[i].side === side) n++;
    return n;
  }

  function nearestEnemy(u) {
    var best = null, bd = 1e9;
    for (var i = 0; i < units.length; i++) {
      var o = units[i];
      if (o.dead || o.side === u.side) continue;
      var d = U.dist2(u.x, u.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  function hit(src, tgt, mult) {
    var raw = src.atk * U.range(Math.random, 0.82, 1.2) * (mult || 1);
    var dmg = raw * (12 / (12 + tgt.def));
    tgt.hp -= dmg;
    tgt.flash = 0.18;
    fx.push({ kind: 'spark', x: tgt.x, y: tgt.y, life: .25 });
    if (tgt.hp <= 0 && !tgt.dead) {
      tgt.dead = true; tgt.fade = 1;
      fx.push({ kind: 'dust', x: tgt.x, y: tgt.y, life: .6 });
      if (Math.random() < 0.5) U.sfx.death();
      var rem = alive(tgt.side);
      if (tgt.side === 'foes' && rem && rem % Math.max(1, Math.floor(startFoes / 3)) === 0)
        say('The enemy line thins — ' + rem + ' still standing.');
    }
    return dmg;
  }

  function step(dt) {
    t += dt;
    var chargeOn = activeOrder('charge'), holdOn = activeOrder('hold'), volleyOn = activeOrder('volley');

    orders.forEach(function (o) {
      if (o.cd > 0) o.cd = Math.max(0, o.cd - dt);
      if (o.active > 0) o.active -= dt;
      if (o.bar) o.bar.style.transform = 'scaleX(' + (o.cd / o.max).toFixed(3) + ')';
      o.el.disabled = o.cd > 0 || done;
    });

    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.dead) { u.fade = Math.max(0, u.fade - dt * 1.4); continue; }
      if (u.flash > 0) u.flash -= dt;

      var ours = u.side === 'ours';
      var rout = routing[u.side];

      if (rout) {
        // flee to your own edge
        var goal = ours ? -40 : FW + 40;
        u.x += Math.sign(goal - u.x) * u.spd * 1.5 * dt;
        u.bob += dt * 12;
        if (u.x < -30 || u.x > FW + 30) u.dead = true;
        continue;
      }

      var e = u.target && !u.target.dead ? u.target : nearestEnemy(u);
      u.target = e;
      if (!e) continue;

      var d = U.dist(u.x, u.y, e.x, e.y);
      var wantRange = u.rng;
      var spdMul = (ours && chargeOn) ? 1.7 : (ours && holdOn) ? 0 : 1;
      if (!ours) spdMul = 1;

      if (d > wantRange) {
        if (spdMul > 0) {
          var dx = (e.x - u.x) / d, dy = (e.y - u.y) / d;
          // spread out a little so units don't stack
          for (var j = 0; j < units.length; j += 3) {
            var o2 = units[j];
            if (o2 === u || o2.dead || o2.side !== u.side) continue;
            var dd = U.dist(u.x, u.y, o2.x, o2.y);
            if (dd < 9 && dd > 0.01) { dx += (u.x - o2.x) / dd * 0.5; dy += (u.y - o2.y) / dd * 0.5; }
          }
          var m = Math.hypot(dx, dy) || 1;
          u.x += dx / m * u.spd * spdMul * dt;
          u.y += dy / m * u.spd * spdMul * dt;
          u.bob += dt * 9;
          u.state = 'advance';
        } else u.state = 'hold';
      } else {
        u.state = 'fight';
        u.cd -= dt * (ours && volleyOn && u.rng > 40 ? 2.2 : 1) * (ours && chargeOn ? 1.25 : 1);
        if (u.cd <= 0) {
          u.cd = u.rate * U.range(Math.random, .85, 1.15);
          if (u.rng > 40) {
            shots.push({ x: u.x, y: u.y, tx: e.x, ty: e.y, t: 0,
              dur: U.clamp(d / 260, .18, .8), src: u, tgt: e, big: u.splash > 0 });
            U.sfx.arrow();
          } else {
            hit(u, e, (ours && chargeOn) ? 1.3 : 1);
            if (Math.random() < .35) U.sfx.clash();
          }
        }
      }
    }

    // projectiles
    for (var s = shots.length - 1; s >= 0; s--) {
      var p = shots[s];
      p.t += dt;
      if (p.t >= p.dur) {
        if (!p.tgt.dead) hit(p.src, p.tgt);
        if (p.big) {
          fx.push({ kind: 'boom', x: p.tx, y: p.ty, life: .45 });
          units.forEach(function (o) {
            if (o.dead || o.side === p.src.side) return;
            if (U.dist(o.x, o.y, p.tx, p.ty) < p.src.splash) hit(p.src, o, 0.55);
          });
          U.sfx.clash();
        }
        shots.splice(s, 1);
      }
    }
    for (var f = fx.length - 1; f >= 0; f--) { fx[f].life -= dt; if (fx[f].life <= 0) fx.splice(f, 1); }

    // morale
    var ao = alive('ours'), af = alive('foes');
    if (!routing.foes && af > 0 && af <= Math.max(1, startFoes * 0.22)) {
      routing.foes = true; say('The enemy breaks and runs!');
    }
    if (!routing.ours && ao > 0 && ao <= Math.max(1, startOurs * 0.20)) {
      routing.ours = true; say('Your line breaks — sound the retreat!');
    }

    el('bt-our-count').textContent = ao + ' / ' + startOurs;
    el('bt-foe-count').textContent = af + ' / ' + startFoes;
    el('bt-our-bar').style.width = (ao / Math.max(1, startOurs) * 50).toFixed(1) + '%';
    el('bt-foe-bar').style.width = (af / Math.max(1, startFoes) * 50).toFixed(1) + '%';

    if (!done && (ao === 0 || af === 0 || (routing.foes && af === 0) || t > 150)) {
      endTimer += dt;
      if (endTimer > 0.9 || ao === 0 || af === 0) finish();
    } else if (!done && (routing.ours || routing.foes)) {
      endTimer += dt;
      if (endTimer > 4.5) finish();
    }
  }

  /* ---------------- drawing ---------------- */
  function drawField() {
    // ground
    var grd = g.createLinearGradient(0, oy, 0, oy + FH * scale);
    grd.addColorStop(0, '#4e7038'); grd.addColorStop(.5, '#5d8040'); grd.addColorStop(1, '#4a6b36');
    g.fillStyle = grd;
    g.fillRect(0, 0, cw, ch);

    // trampled ground between the lines
    var mid = P(FW / 2, 0);
    var band = g.createLinearGradient(mid.x - FW * .22 * scale, 0, mid.x + FW * .22 * scale, 0);
    band.addColorStop(0, 'rgba(120,98,62,0)');
    band.addColorStop(.5, 'rgba(120,98,62,.30)');
    band.addColorStop(1, 'rgba(120,98,62,0)');
    g.fillStyle = band;
    g.fillRect(mid.x - FW * .22 * scale, 0, FW * .44 * scale, ch);

    // deterministic scatter: tufts, stones, patches
    var r = U.mulberry(1337);
    for (var i = 0; i < 90; i++) {
      var x = r() * FW, y = r() * FH, p = P(x, y), k = r();
      if (k < .55) {
        g.strokeStyle = 'rgba(255,255,255,.09)';
        g.lineWidth = 1.4 * scale;
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x + (r() - .5) * 4 * scale, p.y - (3 + r() * 4) * scale);
        g.stroke();
      } else if (k < .82) {
        g.fillStyle = 'rgba(0,0,0,.07)';
        g.beginPath();
        g.ellipse(p.x, p.y, (5 + r() * 12) * scale, (3 + r() * 6) * scale, 0, 0, 6.3);
        g.fill();
      } else {
        g.fillStyle = 'rgba(150,146,136,.5)';
        g.beginPath();
        g.ellipse(p.x, p.y, (1.6 + r() * 2) * scale, (1.2 + r() * 1.4) * scale, 0, 0, 6.3);
        g.fill();
      }
    }

    // your defences on the left, their camp on the right
    if (kind === 'defend') {
      var wallN = Math.max(0, Math.min(9, (SIM.G.count.wall || 0) + (SIM.G.count.tower || 0) * 2));
      for (var w = 0; w < wallN; w++) {
        var wp = P(FW * 0.055, 30 + w * (FH - 60) / Math.max(1, wallN - 1 || 1));
        g.fillStyle = '#948e82';
        g.fillRect(wp.x, wp.y, 12 * scale, 26 * scale);
        g.fillStyle = '#b3ada0';
        g.fillRect(wp.x, wp.y, 12 * scale, 5 * scale);
        g.strokeStyle = '#2a2018'; g.lineWidth = 1.4;
        g.strokeRect(wp.x, wp.y, 12 * scale, 26 * scale);
      }
    }
    // banners marking each side
    [[FW * 0.04, COL.ours.shield], [FW * 0.96, COL.foes.shield]].forEach(function (bn, si) {
      for (var b = 0; b < 3; b++) {
        var bp = P(bn[0], FH * (0.22 + b * 0.28));
        g.fillStyle = '#4a3524';
        g.fillRect(bp.x - 1 * scale, bp.y - 26 * scale, 2.4 * scale, 26 * scale);
        g.fillStyle = bn[1];
        var dir = si ? -1 : 1;
        g.beginPath();
        g.moveTo(bp.x + dir * 1.4 * scale, bp.y - 26 * scale);
        g.lineTo(bp.x + dir * 13 * scale, bp.y - 22 * scale);
        g.lineTo(bp.x + dir * 1.4 * scale, bp.y - 15 * scale);
        g.closePath(); g.fill();
      }
    });
    if (kind !== 'defend') {
      for (var e = 0; e < 8; e++) {
        var ep = P(FW - FW * 0.075, 24 + e * (FH - 48) / 7);
        g.fillStyle = '#5a422a';
        g.fillRect(ep.x, ep.y, 8 * scale, 24 * scale);
        g.fillStyle = '#3d2c1c';
        g.beginPath();
        g.moveTo(ep.x, ep.y); g.lineTo(ep.x + 4 * scale, ep.y - 6 * scale);
        g.lineTo(ep.x + 8 * scale, ep.y); g.closePath(); g.fill();
      }
    }
  }

  function drawUnit(u) {
    var p = P(u.x, u.y);
    var s = scale * 1.15;
    var c = COL[u.side];
    g.globalAlpha = u.dead ? u.fade * 0.8 : 1;
    // shadow
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.beginPath(); g.ellipse(p.x, p.y + 1, 5 * s, 2.2 * s, 0, 0, 6.3); g.fill();

    if (u.dead) {
      g.fillStyle = c.shirt;
      g.fillRect(p.x - 5 * s, p.y - 2 * s, 10 * s, 3 * s);
      g.globalAlpha = 1;
      return;
    }
    var bobY = Math.sin(u.bob) * (u.state === 'advance' ? 1.1 : .35) * s;
    // legs
    g.fillStyle = '#3b2e22';
    g.fillRect(p.x - 2.6 * s, p.y - 4 * s, 2 * s, 4 * s);
    g.fillRect(p.x + 0.6 * s, p.y - 4 * s, 2 * s, 4 * s);
    // body
    g.fillStyle = u.flash > 0 ? '#fff' : c.shirt;
    g.fillRect(p.x - 3.2 * s, p.y - 10 * s + bobY, 6.4 * s, 6.4 * s);
    // head
    g.fillStyle = u.flash > 0 ? '#fff' : '#e8c39a';
    g.beginPath(); g.arc(p.x, p.y - 12 * s + bobY, 2.5 * s, 0, 6.3); g.fill();
    // helm
    g.fillStyle = u.flash > 0 ? '#fff' : '#8c93a0';
    g.beginPath(); g.arc(p.x, p.y - 12.6 * s + bobY, 2.6 * s, Math.PI, 0); g.fill();
    // shield / weapon by role
    var facing = u.side === 'ours' ? 1 : -1;
    if (u.rng > 40) {
      g.strokeStyle = '#6b4a2e'; g.lineWidth = 1.2 * s;
      g.beginPath();
      g.arc(p.x + facing * 4 * s, p.y - 7 * s + bobY, 3.4 * s, -1.1, 1.1);
      g.stroke();
    } else {
      g.fillStyle = c.shield;
      g.fillRect(p.x - facing * 4.6 * s, p.y - 9.5 * s + bobY, 2.4 * s, 5.4 * s);
      g.fillStyle = c.trim;
      g.fillRect(p.x - facing * 4.4 * s, p.y - 9 * s + bobY, 2 * s, 1 * s);
      g.strokeStyle = '#d8dde5'; g.lineWidth = 1.3 * s;
      g.beginPath();
      g.moveTo(p.x + facing * 3.4 * s, p.y - 6 * s + bobY);
      g.lineTo(p.x + facing * (u.state === 'fight' ? 8 : 5.5) * s, p.y - 11 * s + bobY);
      g.stroke();
    }
    // veteran chevron
    if (u.vet) {
      g.strokeStyle = '#e0b23c'; g.lineWidth = 1.3 * s;
      g.beginPath();
      g.moveTo(p.x - 2.6 * s, p.y - 15.4 * s + bobY);
      g.lineTo(p.x, p.y - 17.2 * s + bobY);
      g.lineTo(p.x + 2.6 * s, p.y - 15.4 * s + bobY);
      g.stroke();
    }
    // health pip
    if (u.hp < u.maxHp) {
      var wpx = 9 * s, hp = U.clamp(u.hp / u.maxHp, 0, 1);
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect(p.x - wpx / 2, p.y - 17 * s + bobY, wpx, 2 * s);
      g.fillStyle = hp > .5 ? '#7dd45a' : hp > .25 ? '#e0b23c' : '#d4553a';
      g.fillRect(p.x - wpx / 2, p.y - 17 * s + bobY, wpx * hp, 2 * s);
    }
    g.globalAlpha = 1;
  }

  function render() {
    drawField();
    var order = units.slice().sort(function (a, b) { return a.y - b.y; });
    order.forEach(drawUnit);

    shots.forEach(function (p) {
      var k = p.t / p.dur;
      var x = U.lerp(p.x, p.tx, k), y = U.lerp(p.y, p.ty, k) - Math.sin(k * Math.PI) * (p.big ? 34 : 14);
      var s = P(x, y);
      if (p.big) {
        g.fillStyle = '#6b665c';
        g.beginPath(); g.arc(s.x, s.y, 4 * scale, 0, 6.3); g.fill();
      } else {
        var a = Math.atan2(p.ty - p.y, p.tx - p.x);
        g.strokeStyle = '#e8dcb5'; g.lineWidth = 1.4 * scale;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(s.x - Math.cos(a) * 7 * scale, s.y - Math.sin(a) * 7 * scale);
        g.stroke();
      }
    });

    fx.forEach(function (f) {
      var s = P(f.x, f.y);
      if (f.kind === 'spark') {
        g.globalAlpha = U.clamp(f.life * 4, 0, 1);
        g.fillStyle = '#ffe9a8';
        for (var i = 0; i < 4; i++) {
          var a = i * 1.57 + f.life * 6;
          g.fillRect(s.x + Math.cos(a) * 5 * scale, s.y - 8 * scale + Math.sin(a) * 5 * scale, 2 * scale, 2 * scale);
        }
        g.globalAlpha = 1;
      } else if (f.kind === 'dust') {
        g.globalAlpha = U.clamp(f.life * 1.6, 0, .6);
        g.fillStyle = '#cbb99a';
        g.beginPath(); g.arc(s.x, s.y - 4 * scale, (0.6 - f.life) * 26 * scale + 4, 0, 6.3); g.fill();
        g.globalAlpha = 1;
      } else if (f.kind === 'boom') {
        g.globalAlpha = U.clamp(f.life * 2.2, 0, 1);
        g.fillStyle = '#f2b45a';
        g.beginPath(); g.arc(s.x, s.y - 4 * scale, (0.45 - f.life) * 60 * scale + 6, 0, 6.3); g.fill();
        g.globalAlpha = 1;
      }
    });
  }

  /* ---------------- resolve ---------------- */
  function finish() {
    if (done) return;
    done = true; running = false;
    var G = SIM.G;
    var survivors = {};
    units.forEach(function (u) {
      if (u.side !== 'ours' || u.dead) return;
      survivors[u.key] = (survivors[u.key] || 0) + 1;
    });
    var lost = {}, lostTotal = 0;
    Object.keys(G.army).forEach(function (k) {
      var l = G.army[k] - (survivors[k] || 0);
      if (l > 0) { lost[k] = l; lostTotal += l; }
    });
    G.army = survivors;
    Object.keys(G.army).forEach(function (k) { if (!G.army[k]) delete G.army[k]; });

    var foesLeft = alive('foes');
    var won = foesLeft === 0 || (alive('ours') > 0 && routing.foes);
    var title, body = '';

    // veterans: win and everyone who walked off the field is blooded;
    // lose and you keep only the veterans who survived
    G.vets = G.vets || {};
    var newVets = {};
    Object.keys(survivors).forEach(function (k) {
      newVets[k] = won ? survivors[k] : Math.min(G.vets[k] || 0, survivors[k]);
    });
    G.vets = newVets;

    if (won) {
      G.stats.wins++;
      var loot = { gold: 0, food: 0, iron: 0 };
      if (kind === 'defend') {
        G.stats.raidsSurvived++;
        G.rival.str = Math.max(12, G.rival.str * 0.72);
        loot.gold = Math.round(30 + startFoes * 6);
        title = 'Ashveil Holds';
        body = 'The attack broke against your line. Brannoch withdraws, weakened.';
      } else if (ctx.flavour === 'bandits') {
        loot.gold = Math.round(90 + startFoes * 9);
        title = 'Road Cleared';
        body = 'The outlaws are scattered and their camp emptied.';
      } else {
        G.rival.str = Math.max(10, G.rival.str * 0.66);
        loot.gold = Math.round(70 + startFoes * 11);
        loot.food = Math.round(20 + startFoes * 4);
        loot.iron = Math.round(startFoes * 1.6);
        title = 'Victory';
        body = 'Brannoch\'s camp is taken and stripped. Their power is broken for a season.';
      }
      Object.keys(loot).forEach(function (k) {
        if (loot[k]) G.res[k] = Math.min(SIM.cap(k), G.res[k] + loot[k]);
      });
      G.happy = U.clamp(G.happy + 9, 0, 100);
      body += '<br><br><b>Spoils:</b> ' + Object.keys(loot).filter(function (k) { return loot[k]; })
        .map(function (k) { return '+' + loot[k] + ' ' + k; }).join(', ');
      U.sfx.victory();
    } else {
      G.stats.losses++;
      title = kind === 'defend' ? 'Ashveil Sacked' : 'Defeat';
      if (kind === 'defend') {
        var stolen = Math.round(Math.min(G.res.gold, 60 + startFoes * 8));
        var burned = Math.round(Math.min(G.res.food, 40 + startFoes * 6));
        G.res.gold -= stolen; G.res.food -= burned;
        G.rival.str += 6;
        body = 'They came over the wall. <b>−' + stolen + ' gold, −' + burned + ' food</b> carried off.';
      } else {
        G.rival.str += 8;
        body = 'Your banners fall back across the border. Brannoch takes heart.';
      }
      G.happy = U.clamp(G.happy - 14, 0, 100);
      U.sfx.defeat();
    }

    if (lostTotal) {
      body += '<br><b>Fallen:</b> ' + Object.keys(lost).map(function (k) {
        return lost[k] + '× ' + DATA.UNITS[k].name;
      }).join(', ');
    } else {
      body += '<br><b>Not a soul lost.</b>';
    }

    el('bt-result-title').textContent = title;
    el('bt-result-title').style.color = won ? '#8fd06a' : '#e0795f';
    el('bt-result-body').innerHTML = body;
    el('bt-result').classList.remove('hidden');
    el('bt-phase').textContent = won ? 'Victory' : 'Defeat';
    SIM.checkQuests();
    SIM.emit('army');
    SIM.save();
    U.vibrate(won ? [30, 60, 30] : 200);
  }

  function close() {
    el('battle').classList.add('hidden');
    running = false;
    if (onDone) { var f = onDone; onDone = null; f(); }
  }

  function update(dt) {
    if (!running && !done) return;
    if (running) {
      var d = Math.min(dt, 0.05) * speedMul;
      step(d);
    }
    render();
  }

  function isOpen() { return !el('battle').classList.contains('hidden'); }

  return {
    init: init, start: start, update: update, resize: resize, close: close,
    isOpen: isOpen, foeArmy: foeArmy
  };
})();
