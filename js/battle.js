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
  var ground = 'open', reserve = [], reservePct = 0, retreated = false, deploying = false;
  var fort = null;   // Brannoch's town: a palisade and a gate to batter down

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
    // a campaign fights with the army that marched out, not with whatever
    // is standing at home
    var roster = ctx.roster || G.army;
    var vets = ctx.vets || G.vets || {};
    var arr = [], i, n = 0;
    var keys = Object.keys(roster);
    keys.forEach(function (k) { n += roster[k]; });
    var perCol = Math.max(4, Math.ceil(Math.sqrt(n) * 1.1));
    var slot = 0;
    keys.forEach(function (k) {
      var d = DATA.UNITS[k];
      for (i = 0; i < roster[k]; i++) {
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
        if (fort) x = Math.max(fort.x + 18, x - FW * 0.05);
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
      // small war bands are mostly light raiders; the heavy troops only
      // appear once Brannoch is actually throwing weight at you
      spec.raider = Math.max(2, Math.round(budget / 11));
      spec.axeman = Math.round(budget / 18);
      spec.bowman = Math.round(budget / 26);
      if (budget > 70) spec.warhound = Math.round(budget / 42);
      if (budget > 120) spec.champion = Math.max(1, Math.round(budget / 95));
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
    ground = 'open'; reservePct = 0; retreated = false; reserve = [];
    var gateHp = Math.round(180 + power * 1.6);
    fort = (k === 'raid' && ctx.flavour !== 'bandits') ? { x: FW * 0.66,
      gate: { gate: true, x: FW * 0.66, y: FH / 2, hp: gateHp, maxHp: gateHp, def: 10, side: 'foes', dead: false, flash: 0 } } : null;
    var ours = buildOurs();
    units = ours.concat(buildFoes(foeArmy(power, ctx.flavour)));
    startOurs = ours.length;
    startFoes = units.length - startOurs;
    shots = []; fx = []; logLines = []; t = 0; done = false; running = false;
    routing = { ours: false, foes: false }; endTimer = 0;

    el('bt-foe-name').textContent = ctx.name || 'Brannoch';
    el('bt-our-name').textContent = 'Ashveil';
    el('bt-phase').textContent = kind === 'defend' ? 'Defending' : fort ? 'Storming the town' : 'Attacking';

    setupOrders();
    openDeploy();
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

  /* Pick the ground and decide what to hold back, before a blow is struck. */
  function openDeploy() {
    deploying = true;
    var dep = el('battle-deploy');
    dep.classList.remove('hidden');
    el('dep-title').textContent = kind === 'defend' ? 'They Are At The Gate' : 'Order of Battle';
    el('dep-sub').textContent = kind === 'defend'
      ? 'Choose where to meet them, and what to keep in hand.'
      : 'Choose where to force the fight, and what to keep in hand.';

    var gbox = el('dep-ground');
    gbox.innerHTML = '';
    Object.keys(DATA.GROUNDS).forEach(function (k) {
      var g2 = DATA.GROUNDS[k];
      var b = document.createElement('button');
      b.className = 'ground-opt' + (ground === k ? ' on' : '');
      b.innerHTML = '<b>' + g2.ic + '  ' + g2.name + '</b><small>' + g2.desc + '</small>';
      b.addEventListener('click', function () { ground = k; U.sfx.tap(); openDeploy(); });
      gbox.appendChild(b);
    });

    var rbox = el('dep-reserve');
    rbox.innerHTML = '';
    [0, 25, 50].forEach(function (pct) {
      var b = document.createElement('button');
      b.className = 'res-opt' + (reservePct === pct ? ' on' : '');
      b.innerHTML = '<b>' + (pct === 0 ? 'None' : pct + '%') + '</b><small>' +
        (pct === 0 ? 'all in' : Math.round(startOurs * pct / 100) + ' held') + '</small>';
      b.addEventListener('click', function () { reservePct = pct; U.sfx.tap(); openDeploy(); });
      rbox.appendChild(b);
    });

    var held = Math.round(startOurs * reservePct / 100);
    var gd = DATA.GROUNDS[ground];
    el('dep-summary').innerHTML =
      '<b>' + (startOurs - held) + '</b> take the field, <b>' + held + '</b> in reserve, against roughly <b>' +
      startFoes + '</b>.<br>' + gd.name + ' — ' + gd.desc +
      (held ? '<br>Reserves that are never committed walk home whatever happens.' : '');
  }

  function beginFight() {
    deploying = false;
    el('battle-deploy').classList.add('hidden');
    // pull the reserve off the field, back to front so the front line holds
    var mine = units.filter(function (u) { return u.side === 'ours'; });
    var held = Math.round(mine.length * reservePct / 100);
    reserve = [];
    for (var i = 0; i < held; i++) {
      var u = mine[mine.length - 1 - i];
      if (!u) break;
      reserve.push(u);
      units.splice(units.indexOf(u), 1);
    }
    startOurs = units.filter(function (x) { return x.side === 'ours'; }).length + reserve.length;
    if (reserve.length) say(reserve.length + ' held back out of the first clash.');
    if (ground !== 'open') say('You take the fight to ' + DATA.GROUNDS[ground].name.toLowerCase() + '.');
    running = true;
    U.sfx.horn();
  }

  function commitReserve() {
    if (!reserve.length) return;
    var edge = FW * 0.10;
    reserve.forEach(function (u, i) {
      u.x = edge; u.y = FH * (0.2 + 0.6 * (i / Math.max(1, reserve.length - 1)));
      u.target = null;
      units.push(u);
    });
    say('The reserve comes on — ' + reserve.length + ' fresh soldiers!');
    reserve = [];
    U.sfx.horn(); U.vibrate(20);
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
        on: function () { say('Loose! Arrows darken the sky.'); U.sfx.arrow(); } },
      { id: 'reserve', label: '➕ Reserve', cd: 0, max: 0, dur: 0, once: true,
        on: function () { commitReserve(); } },
      { id: 'retreat', label: '🏳️ Retreat', cd: 0, max: 0, dur: 0, danger: true,
        on: function () { retreated = true; say('Sound the retreat — get them out.'); finish(); } }
    ];
    var box = el('bt-orders');
    box.innerHTML = '';
    orders.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'btn ' + (o.danger ? 'danger' : 'sec');
      b.innerHTML = o.label + '<i class="cd" style="transform:scaleX(0)"></i>';
      b.addEventListener('click', function () {
        if (o.cd > 0 || done || deploying) return;
        if (o.id === 'reserve' && !reserve.length) return;
        o.cd = o.max; o.active = o.dur; o.on();
        if (o.once) o.spent = true;
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
    if (tgt.gate) {
      if (tgt.dead) return 0;
      var gd = raw * (12 / (12 + tgt.def)) * (src.splash ? 3 : 1);
      tgt.hp -= gd; tgt.flash = 0.18;
      fx.push({ kind: 'spark', x: tgt.x - 4, y: src.y, life: .25 });
      if (tgt.hp <= 0) {
        tgt.dead = true;
        fx.push({ kind: 'boom', x: tgt.x, y: tgt.y, life: .6 });
        say('The gate gives way! Into the town!'); U.sfx.horn(); U.vibrate(30);
        units.forEach(function (o) { if (o.target === tgt) o.target = null; });
      }
      return gd;
    }
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

  /* On a narrow front the bigger army cannot bring its numbers to bear, so
     each side's blows are scaled by how badly it outnumbers the other. */
  function narrowFactor(side) {
    if (DATA.GROUNDS[ground] && DATA.GROUNDS[ground].narrow) {
      var mine = alive(side), theirs = alive(side === 'ours' ? 'foes' : 'ours');
      if (mine > theirs && mine > 0) return Math.max(0.45, theirs / mine);
    }
    return 1;
  }

  function step(dt) {
    t += dt;
    var chargeOn = activeOrder('charge'), holdOn = activeOrder('hold'), volleyOn = activeOrder('volley');

    orders.forEach(function (o) {
      if (o.cd > 0) o.cd = Math.max(0, o.cd - dt);
      if (o.active > 0) o.active -= dt;
      if (o.bar && o.max) o.bar.style.transform = 'scaleX(' + (o.cd / o.max).toFixed(3) + ')';
      if (o.id === 'reserve') {
        o.el.disabled = done || !reserve.length;
        o.el.innerHTML = reserve.length ? '➕ Reserve (' + reserve.length + ')<i class="cd" style="transform:scaleX(0)"></i>'
                                        : '➕ Reserve<i class="cd" style="transform:scaleX(0)"></i>';
        o.bar = o.el.querySelector('.cd');
      } else if (o.id === 'retreat') {
        o.el.disabled = done;
      } else {
        o.el.disabled = o.cd > 0 || done;
      }
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
      // while the gate stands, fighters and siege engines go for the gate
      var walled = fort && !fort.gate.dead;
      if (walled && ours && e && e.x > fort.x && !e.gate && (u.rng <= 40 || u.splash > 0)) e = fort.gate;
      u.target = e;
      if (!e) continue;

      var d = e.gate ? Math.hypot(e.x - u.x, Math.max(0, Math.abs(u.y - e.y) - 14)) : U.dist(u.x, u.y, e.x, e.y);
      var wantRange = u.rng;
      var spdMul = (ours && chargeOn) ? 1.7 : (ours && holdOn) ? 0 : 1;
      if (!ours) spdMul = 1;
      if (DATA.GROUNDS[ground] && DATA.GROUNDS[ground].spd && u.rng <= 40) spdMul *= DATA.GROUNDS[ground].spd;

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
          if (walled) { if (ours && u.x > fort.x - 5) u.x = fort.x - 5; if (!ours && u.x < fort.x + 7) u.x = fort.x + 7; }
          u.bob += dt * 9;
          u.state = 'advance';
          if (Math.random() < dt * 0.25) fx.push({ kind: 'dust', x: u.x - (u.side === 'ours' ? 4 : -4), y: u.y, life: .5 });
        } else u.state = 'hold';
      } else {
        u.state = 'fight';
        u.cd -= dt * (ours && volleyOn && u.rng > 40 ? 2.2 : 1) * (ours && chargeOn ? 1.25 : 1);
        if (u.cd <= 0) {
          u.cd = u.rate * U.range(Math.random, .85, 1.15);
          if (u.rng > 40) {
            shots.push({ x: u.x, y: u.y, tx: e.x, ty: e.y, t: 0,
              dur: U.clamp(d / 260, .18, .8), src: u, tgt: e, big: u.splash > 0,
              mult: narrowFactor(u.side) * (walled && ours && !e.gate && e.x > fort.x ? 0.55 : 1) });
            U.sfx.arrow();
          } else {
            hit(u, e, ((ours && chargeOn) ? 1.3 : 1) * narrowFactor(u.side));
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
        if (!p.tgt.dead) hit(p.src, p.tgt, p.mult || 1);
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
    if (!routing.ours && !reserve.length && ao > 0 && ao <= Math.max(1, startOurs * 0.20)) {
      routing.ours = true; say('Your line breaks — sound the retreat!');
    }

    el('bt-our-count').textContent = (ao + reserve.length) + ' / ' + startOurs;
    el('bt-foe-count').textContent = af + ' / ' + startFoes;
    el('bt-our-bar').style.width = ((ao + reserve.length) / Math.max(1, startOurs) * 50).toFixed(1) + '%';
    el('bt-foe-bar').style.width = (af / Math.max(1, startFoes) * 50).toFixed(1) + '%';

    if (!done && (ao === 0 || af === 0 || (routing.foes && af === 0) || t > 150)) {
      endTimer += dt;
      if (endTimer > 0.9 || ao === 0 || af === 0) finish();
    } else if (!done && (routing.ours || routing.foes)) {
      endTimer += dt;
      if (endTimer > 4.5) finish();
    }
  }

  /* ---------------- drawing ----------------
     The field is painted once per battle into its own canvas: grass for
     the season, a trampled strip where the lines meet, and what stands
     around it — your walls and cottages when you defend, Brannoch's camp
     when you attack, woods pressing in on a narrow front, rocks on broken
     ground. Soldiers are then drawn over it every frame, nearer ones a
     little larger, each with its own shadow. */
  var fieldCv = null, fieldKey = '';
  function depth(y) { return 0.82 + 0.34 * (y / FH); }

  function bakeField() {
    var season = SIM.season().key;
    var key = cw + 'x' + ch + ':' + kind + ':' + ground + ':' + season;
    if (fieldCv && fieldKey === key) return;
    fieldKey = key;
    fieldCv = document.createElement('canvas');
    fieldCv.width = Math.max(1, Math.floor(cw * dpr)); fieldCv.height = Math.max(1, Math.floor(ch * dpr));
    var f = fieldCv.getContext('2d');
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    var r = U.mulberry(1337 + (ctx.power | 0));
    var pal = {
      spring: ['#5f8f3c', '#76a64a', '#4c7a32'], summer: ['#5a8436', '#6f9a44', '#48702e'],
      autumn: ['#7f7f3a', '#9a8e48', '#66662e'], winter: ['#dfe6ee', '#eef2f6', '#c6d0da']
    }[season];
    var grd = f.createLinearGradient(0, 0, 0, ch);
    grd.addColorStop(0, pal[2]); grd.addColorStop(0.5, pal[0]); grd.addColorStop(1, pal[2]);
    f.fillStyle = grd; f.fillRect(0, 0, cw, ch);
    // patches of lighter and darker ground
    for (var i = 0; i < 160; i++) {
      var x = r() * cw, y = r() * ch, rw = 10 + r() * 60;
      f.globalAlpha = 0.10 + r() * 0.12;
      f.fillStyle = r() > .5 ? pal[1] : pal[2];
      f.beginPath(); f.ellipse(x, y, rw, rw * 0.45, 0, 0, 6.3); f.fill();
    }
    f.globalAlpha = 1;
    // the trampled strip between the lines
    var mid = P(FW / 2, 0), bw = FW * 0.26 * scale;
    var band = f.createLinearGradient(mid.x - bw, 0, mid.x + bw, 0);
    var mud = season === 'winter' ? '130,120,108' : '122,98,62';
    band.addColorStop(0, 'rgba(' + mud + ',0)'); band.addColorStop(.5, 'rgba(' + mud + ',.42)'); band.addColorStop(1, 'rgba(' + mud + ',0)');
    f.fillStyle = band; f.fillRect(mid.x - bw, 0, bw * 2, ch);
    // tufts and stones
    for (var j = 0; j < 420; j++) {
      var tx = r() * cw, ty = r() * ch;
      if (r() < 0.8) {
        f.strokeStyle = season === 'winter' ? 'rgba(120,110,90,.35)' : r() > .5 ? 'rgba(30,60,20,.35)' : 'rgba(210,230,150,.25)';
        f.lineWidth = 1;
        f.beginPath(); f.moveTo(tx, ty); f.lineTo(tx - 1.5, ty - 4 - r() * 3); f.moveTo(tx + 1.5, ty); f.lineTo(tx + 2.5, ty - 4 - r() * 3); f.stroke();
      } else {
        f.fillStyle = 'rgba(0,0,0,.18)'; f.beginPath(); f.ellipse(tx + 1, ty + 1, 3, 1.4, 0, 0, 6.3); f.fill();
        f.fillStyle = '#9d978b'; f.beginPath(); f.ellipse(tx, ty, 2.6, 1.6, 0, 0, 6.3); f.fill();
      }
    }
    // what stands around the field
    var sprites = [];
    function put(sp, x, y, sc) { sprites.push({ sp: sp, x: x, y: y, sc: sc || 1 }); }
    var treeScale = scale * 0.34;
    function tree(x, y) { put(ART.tree(r() < 0.5 ? 1 : 0, season, Math.floor(r() * 3)), x, y, treeScale * (0.8 + r() * 0.4)); }
    if (ground === 'narrow') {
      // woods press in from both sides of the field
      for (var k = 0; k < 70; k++) {
        var edge = r() < 0.5, along = r() * FW;
        var depthIn = r() * FH * 0.2;
        var py = edge ? depthIn + 10 : FH - depthIn;
        var q = P(along, py); tree(q.x, q.y);
      }
    } else {
      for (var k2 = 0; k2 < 18; k2++) {
        var q2 = P(r() * FW, r() < 0.5 ? r() * FH * 0.06 : FH - r() * FH * 0.05);
        tree(q2.x, q2.y);
      }
    }
    if (ground === 'broken') {
      for (var m = 0; m < 26; m++) {
        var q3 = P(FW * 0.2 + r() * FW * 0.6, r() * FH);
        put(ART.rock(Math.floor(r() * 4), season), q3.x, q3.y, scale * 0.3 * (0.6 + r() * 0.6));
      }
    }
    var bs = scale * 0.42;
    if (kind === 'defend') {
      // your cottages behind the line; the rampart is drawn below, over them
      for (var hh = 0; hh < 5; hh++) {
        var q5 = P(-FW * 0.02, FH * (0.06 + hh * 0.22));
        put(ART.building({ id: 'house', def: DATA.B.house, level: 1 + (hh % 3) }, season), q5.x, q5.y, bs);
      }
    } else {
      // Brannoch's camp: a palisade and tents on the far side
      for (var t2 = 0; t2 < 5; t2++) {
        var q6 = P(FW * 1.01, FH * (0.1 + t2 * 0.2));
        put(ART.building({ id: 'barracks', def: DATA.B.barracks }, season), q6.x, q6.y, bs * 0.8);
      }
    }
    sprites.sort(function (p1, p2) { return p1.y - p2.y; });
    sprites.forEach(function (s2) {
      var sp = s2.sp, k3 = s2.sc * 128 / sp.s;
      if (sp.sh) { f.globalAlpha = 0.3; f.drawImage(sp.sh, s2.x - sp.ax * k3, s2.y - sp.ay * k3, sp.c.width * k3, sp.c.height * k3); f.globalAlpha = 1; }
      f.drawImage(sp.c, s2.x - sp.ax * k3, s2.y - sp.ay * k3, sp.c.width * k3, sp.c.height * k3);
    });
    // your rampart: stronger the more walls and towers the realm has built
    if (kind === 'defend') {
      var strength = (SIM.G.count.wall || 0) + (SIM.G.count.tower || 0) * 2;
      var wx0 = P(FW * 0.035, 0).x, wt = (strength > 0 ? 10 : 5) * scale;
      var top = 0, bot = ch;
      f.fillStyle = 'rgba(0,0,0,.28)'; f.fillRect(wx0 + wt, top, 6 * scale, bot);
      var sg = f.createLinearGradient(wx0, 0, wx0 + wt, 0);
      sg.addColorStop(0, strength > 0 ? '#b5ad9c' : '#8a6a44'); sg.addColorStop(1, strength > 0 ? '#7c766a' : '#5b4029');
      f.fillStyle = sg; f.fillRect(wx0, top, wt, bot);
      f.strokeStyle = 'rgba(40,30,20,.35)'; f.lineWidth = 1;
      for (var yy = 0; yy < ch; yy += 6 * scale) { f.beginPath(); f.moveTo(wx0, yy); f.lineTo(wx0 + wt, yy); f.stroke(); }
      if (strength > 0) {
        for (var ym = 0; ym < ch; ym += 12 * scale) { f.fillStyle = '#c8c0ae'; f.fillRect(wx0 + wt - 1, ym, 3.5 * scale, 6 * scale); }
      } else {
        for (var yp = 0; yp < ch; yp += 5 * scale) { f.fillStyle = '#6e5238'; f.beginPath(); f.arc(wx0 + wt / 2, yp, wt * 0.55, 0, 6.3); f.fill(); }
      }
      var towers = Math.min(4, SIM.G.count.tower || 0);
      for (var tw = 0; tw < towers; tw++) {
        var ty0 = ch * (0.2 + tw * 0.6 / Math.max(1, towers - 1 || 1));
        var trr = 13 * scale;
        f.fillStyle = 'rgba(0,0,0,.3)'; f.beginPath(); f.ellipse(wx0 + wt / 2 + 6 * scale, ty0 + 3 * scale, trr, trr * 0.5, 0, 0, 6.3); f.fill();
        var tg = f.createRadialGradient(wx0 + wt / 2 - trr * 0.3, ty0 - trr * 0.3, 1, wx0 + wt / 2, ty0, trr);
        tg.addColorStop(0, '#cfc7b6'); tg.addColorStop(1, '#7c766a');
        f.fillStyle = tg; f.beginPath(); f.arc(wx0 + wt / 2, ty0, trr, 0, 6.3); f.fill();
        f.strokeStyle = 'rgba(40,30,20,.4)'; f.stroke();
      }
    }
    // soft edges so the eye stays on the fight
    var vg = f.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)');
    f.fillStyle = vg; f.fillRect(0, 0, cw, ch);
  }

  function drawField() {
    bakeField();
    g.drawImage(fieldCv, 0, 0, cw, ch);
    // banners that flutter
    [[FW * 0.04, COL.ours.shield], [FW * 0.96, COL.foes.shield]].forEach(function (bn, si) {
      for (var b = 0; b < 3; b++) {
        var bp = P(bn[0], FH * (0.22 + b * 0.28));
        var dir = si ? -1 : 1, wave = Math.sin(t * 5 + b) * 2 * scale;
        g.fillStyle = '#4a3524';
        g.fillRect(bp.x - 1 * scale, bp.y - 30 * scale, 2.2 * scale, 30 * scale);
        g.fillStyle = bn[1];
        g.beginPath();
        g.moveTo(bp.x + dir * 1.2 * scale, bp.y - 30 * scale);
        g.quadraticCurveTo(bp.x + dir * 8 * scale, bp.y - 30 * scale + wave, bp.x + dir * 15 * scale, bp.y - 26 * scale);
        g.lineTo(bp.x + dir * 1.2 * scale, bp.y - 18 * scale);
        g.closePath(); g.fill();
      }
    });
  }

  /* ---------------- the soldiers ---------------- */
  var SKIN = ['#e8c39a', '#d3a476', '#a9764e', '#f0d3b0'];
  function limb(x0, y0, x1, y1, w, c) {
    g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  function drawUnit(u) {
    var p = P(u.x, u.y), s = scale * 1.55 * depth(u.y);
    var c = COL[u.side], dir = u.side === 'ours' ? 1 : -1;
    var flash = u.flash > 0;
    g.globalAlpha = u.dead ? u.fade * 0.85 : 1;
    // shadow on the grass, cast east like everything else
    g.fillStyle = 'rgba(0,0,0,.28)';
    var big = u.key === 'knight' || u.key === 'catapult';
    g.beginPath(); g.ellipse(p.x + 3 * s, p.y + 0.5 * s, (big ? 10 : 5.5) * s, (big ? 3 : 2) * s, 0, 0, 6.3); g.fill();
    if (u.dead) {
      // fallen where they stood
      g.fillStyle = shadeC(c.shirt, 0.7);
      g.beginPath(); g.ellipse(p.x, p.y - 1 * s, 6 * s, 2.2 * s, 0.15 * dir, 0, 6.3); g.fill();
      g.fillStyle = '#8c93a0'; g.beginPath(); g.arc(p.x + 5 * s * dir, p.y - 1.5 * s, 1.8 * s, 0, 6.3); g.fill();
      g.globalAlpha = 1;
      return;
    }
    var moving = u.state === 'advance';
    var step = Math.sin(u.bob), bob = moving ? Math.abs(step) * 1.1 * s : 0;
    var swing = u.state === 'fight' ? Math.sin(t * 9 + u.x) : 0;
    var skin = SKIN[(u.maxHp * 7 | 0) % SKIN.length];
    var shirt = flash ? '#fff' : c.shirt;

    if (u.key === 'warhound') {
      var hy = p.y - 4 * s - bob;
      g.fillStyle = flash ? '#fff' : '#4a3a2c';
      g.beginPath(); g.ellipse(p.x, hy, 6 * s, 2.6 * s, 0, 0, 6.3); g.fill();
      g.beginPath(); g.ellipse(p.x + dir * 6 * s, hy - 2 * s, 2.6 * s, 2 * s, 0, 0, 6.3); g.fill();
      limb(p.x - 4 * s, hy, p.x - 4 * s + step * 2 * s, p.y, 1.3 * s, '#3a2c20');
      limb(p.x + 4 * s, hy, p.x + 4 * s - step * 2 * s, p.y, 1.3 * s, '#3a2c20');
      g.fillStyle = '#b3402f'; g.fillRect(p.x + dir * 3 * s - 1 * s, hy - 2.4 * s, 2 * s, 1.2 * s);
      g.globalAlpha = 1; hpBar(u, p, s, 12);
      return;
    }
    if (u.key === 'catapult') {
      var cy = p.y - 3 * s;
      g.fillStyle = '#6b4a2e';
      g.fillRect(p.x - 9 * s, cy - 3 * s, 18 * s, 3.5 * s);
      g.fillStyle = '#3d2c1c';
      [-6, 6].forEach(function (dx) { g.beginPath(); g.arc(p.x + dx * s, p.y - 1.5 * s, 2.6 * s, 0, 6.3); g.fill(); });
      limb(p.x - 3 * s, cy - 3 * s, p.x, cy - 12 * s, 1.6 * s, '#5b4029');
      limb(p.x + 3 * s, cy - 3 * s, p.x, cy - 12 * s, 1.6 * s, '#5b4029');
      var arm = u.cd < 0.5 ? -0.2 : -1.2 + (u.cd / u.rate) * 0.9;
      limb(p.x, cy - 10 * s, p.x + Math.cos(arm) * 14 * s * dir, cy - 10 * s + Math.sin(arm) * 14 * s, 1.8 * s, '#7a5634');
      g.globalAlpha = 1; hpBar(u, p, s, 22);
      return;
    }
    var mounted = u.key === 'knight';
    var baseY = p.y;
    if (mounted) {
      // the horse, then the rider sits on it
      var hy2 = p.y - 7 * s - bob * 0.6;
      limb(p.x - 5 * s, hy2 + 2 * s, p.x - 5 * s + step * 3 * s, p.y, 1.6 * s, '#3d2c1c');
      limb(p.x + 5 * s, hy2 + 2 * s, p.x + 5 * s - step * 3 * s, p.y, 1.6 * s, '#3d2c1c');
      g.fillStyle = flash ? '#fff' : '#7a5634';
      g.beginPath(); g.ellipse(p.x, hy2, 8 * s, 3.6 * s, 0, 0, 6.3); g.fill();
      g.beginPath(); g.moveTo(p.x + dir * 6 * s, hy2 - 1 * s); g.lineTo(p.x + dir * 10 * s, hy2 - 7 * s); g.lineTo(p.x + dir * 12 * s, hy2 - 6 * s); g.lineTo(p.x + dir * 8 * s, hy2 + 1 * s); g.fill();
      g.fillStyle = c.shield;
      g.fillRect(p.x - 7 * s, hy2 - 1 * s, 14 * s, 4 * s);
      g.fillStyle = c.trim; g.fillRect(p.x - 7 * s, hy2 + 2.4 * s, 14 * s, 0.8 * s);
      baseY = hy2 + 1 * s;
    }
    var hs = u.key === 'champion' ? 1.3 : u.key === 'axeman' || u.key === 'manatarms' ? 1.1 : 1;
    var S2 = s * hs;
    var y0 = baseY - bob;
    // legs
    if (!mounted) {
      var lw = moving ? step * 2.2 * S2 : 0;
      limb(p.x - 1.3 * S2, y0 - 5 * S2, p.x - 1.3 * S2 + lw, baseY, 1.6 * S2, '#3b2e22');
      limb(p.x + 1.3 * S2, y0 - 5 * S2, p.x + 1.3 * S2 - lw, baseY, 1.6 * S2, '#3b2e22');
    }
    // body: mail for professionals, cloth for the rest
    var armoured = u.key === 'manatarms' || u.key === 'knight' || u.key === 'champion' || u.key === 'axeman';
    var gr = g.createLinearGradient(p.x - 3.5 * S2, 0, p.x + 3.5 * S2, 0);
    gr.addColorStop(0, flash ? '#fff' : armoured ? '#a9b0ba' : shirt);
    gr.addColorStop(1, flash ? '#ddd' : shadeC(armoured ? '#a9b0ba' : shirt, 0.6));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(p.x - 3 * S2, y0 - 11 * S2); g.lineTo(p.x + 3 * S2, y0 - 11 * S2);
    g.lineTo(p.x + 3.6 * S2, y0 - 4.5 * S2); g.lineTo(p.x - 3.6 * S2, y0 - 4.5 * S2); g.closePath(); g.fill();
    if (armoured) { g.fillStyle = shirt; g.fillRect(p.x - 2.2 * S2, y0 - 10.5 * S2, 4.4 * S2, 6 * S2); }   // surcoat
    // head and helm
    g.fillStyle = flash ? '#fff' : skin;
    g.beginPath(); g.arc(p.x, y0 - 13 * S2, 2.3 * S2, 0, 6.3); g.fill();
    var helm = u.key === 'militia' || u.key === 'raider' ? null : u.key === 'archer' || u.key === 'bowman' ? 'hood' : 'helm';
    if (helm === 'helm') {
      g.fillStyle = flash ? '#fff' : '#8c93a0';
      g.beginPath(); g.arc(p.x, y0 - 13.6 * S2, 2.5 * S2, Math.PI, 0); g.fill();
      g.fillRect(p.x - 0.35 * S2 + dir * 0.6 * S2, y0 - 13.6 * S2, 0.7 * S2, 2.4 * S2);
      if (u.key === 'axeman' || u.key === 'champion') {
        g.strokeStyle = '#e8dcc0'; g.lineWidth = 1 * S2;
        g.beginPath(); g.moveTo(p.x - 2 * S2, y0 - 14.5 * S2); g.quadraticCurveTo(p.x - 3.5 * S2, y0 - 17 * S2, p.x - 2 * S2, y0 - 18 * S2); g.stroke();
        g.beginPath(); g.moveTo(p.x + 2 * S2, y0 - 14.5 * S2); g.quadraticCurveTo(p.x + 3.5 * S2, y0 - 17 * S2, p.x + 2 * S2, y0 - 18 * S2); g.stroke();
      }
    } else if (helm === 'hood') {
      g.fillStyle = flash ? '#fff' : u.side === 'ours' ? '#4e6b3a' : '#6b3a2e';
      g.beginPath(); g.arc(p.x, y0 - 13.4 * S2, 2.7 * S2, Math.PI * 0.95, Math.PI * 2.05); g.fill();
    } else {
      g.fillStyle = '#4a3322'; g.beginPath(); g.arc(p.x, y0 - 13.8 * S2, 2.3 * S2, Math.PI, 0); g.fill();
    }
    if (u.key === 'champion') {
      g.fillStyle = '#7a1e18';
      g.beginPath(); g.moveTo(p.x - 3 * S2, y0 - 11 * S2); g.lineTo(p.x - dir * 6 * S2, y0 - 3 * S2); g.lineTo(p.x - 2 * S2, y0 - 4 * S2); g.fill();
    }
    // weapons, by trade
    var hx = p.x + dir * 3.2 * S2, hy3 = y0 - 8 * S2;
    if (u.rng > 40) {
      // a bow held out toward the enemy
      g.strokeStyle = '#6b4a2e'; g.lineWidth = 1.1 * S2;
      g.beginPath(); g.arc(hx + dir * 1 * S2, hy3 - 1 * S2, 4.2 * S2, dir > 0 ? -1.2 : Math.PI - 1.2, dir > 0 ? 1.2 : Math.PI + 1.2); g.stroke();
      g.strokeStyle = 'rgba(230,220,190,.8)'; g.lineWidth = 0.5 * S2;
      g.beginPath(); g.moveTo(hx + dir * 2.4 * S2, hy3 - 5 * S2); g.lineTo(hx - dir * (u.state === 'fight' ? 1.5 : 0) * S2, hy3 - 1 * S2); g.lineTo(hx + dir * 2.4 * S2, hy3 + 3 * S2); g.stroke();
    } else {
      var shieldy = u.key === 'spearman' || u.key === 'manatarms' || u.key === 'knight' || u.key === 'raider' || u.key === 'champion';
      if (shieldy) {
        var sx = p.x + dir * 2.8 * S2, sy = y0 - 8.5 * S2;
        g.fillStyle = flash ? '#fff' : c.shield;
        if (u.key === 'manatarms' || u.key === 'knight') {
          g.beginPath(); g.moveTo(sx - 2.4 * S2, sy - 3 * S2); g.lineTo(sx + 2.4 * S2, sy - 3 * S2); g.lineTo(sx + 2.4 * S2, sy + 1 * S2); g.lineTo(sx, sy + 4.5 * S2); g.lineTo(sx - 2.4 * S2, sy + 1 * S2); g.closePath(); g.fill();
          g.fillStyle = c.trim; g.fillRect(sx - 0.4 * S2, sy - 2.4 * S2, 0.8 * S2, 5 * S2); g.fillRect(sx - 1.6 * S2, sy - 0.8 * S2, 3.2 * S2, 0.8 * S2);
        } else {
          g.beginPath(); g.arc(sx, sy, 2.9 * S2, 0, 6.3); g.fill();
          g.fillStyle = '#c9ccd2'; g.beginPath(); g.arc(sx, sy, 0.9 * S2, 0, 6.3); g.fill();
        }
      }
      var wx = p.x - dir * 2.6 * S2, wy = y0 - 8 * S2;
      if (u.key === 'spearman' || u.key === 'militia' || mounted) {
        var ang = mounted ? -0.12 : -1.1 + swing * 0.35;
        var L = mounted ? 20 : u.key === 'spearman' ? 16 : 12;
        limb(wx, wy + 2 * S2, wx + Math.cos(ang) * L * S2 * dir, wy + 2 * S2 + Math.sin(ang) * L * S2, 1 * S2, '#7a5634');
        var tx2 = wx + Math.cos(ang) * L * S2 * dir, ty2 = wy + 2 * S2 + Math.sin(ang) * L * S2;
        g.fillStyle = '#d8dde5';
        g.beginPath(); g.moveTo(tx2, ty2); g.lineTo(tx2 - Math.cos(ang - 0.3) * 3 * S2 * dir, ty2 - Math.sin(ang - 0.3) * 3 * S2); g.lineTo(tx2 - Math.cos(ang + 0.3) * 3 * S2 * dir, ty2 - Math.sin(ang + 0.3) * 3 * S2); g.fill();
      } else {
        // sword or axe, swung when in contact
        var a2 = -2.0 + (swing + 1) * 0.9;
        var L2 = u.key === 'axeman' ? 11 : 8;
        var ex = wx + Math.cos(a2) * L2 * S2 * dir, ey = wy + Math.sin(a2) * L2 * S2;
        limb(wx, wy, ex, ey, (u.key === 'axeman' ? 1 : 1.1) * S2, u.key === 'axeman' || u.key === 'raider' ? '#6b4a2e' : '#d8dde5');
        if (u.key === 'axeman' || u.key === 'raider') {
          g.fillStyle = '#c0c6cf';
          g.beginPath(); g.ellipse(ex, ey, 2.2 * S2, 1.4 * S2, a2, 0, 6.3); g.fill();
        }
      }
    }
    if (u.vet) {
      g.strokeStyle = '#e0b23c'; g.lineWidth = 1.2 * s;
      g.beginPath(); g.moveTo(p.x - 2.4 * s, y0 - 18 * S2); g.lineTo(p.x, y0 - 19.6 * S2); g.lineTo(p.x + 2.4 * s, y0 - 18 * S2); g.stroke();
    }
    g.globalAlpha = 1;
    hpBar(u, p, s, (mounted ? 26 : 20) * hs);
  }
  function hpBar(u, p, s, up) {
    if (u.hp >= u.maxHp) return;
    var wpx = 10 * s, hp = U.clamp(u.hp / u.maxHp, 0, 1), y = p.y - up * s;
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(p.x - wpx / 2, y, wpx, 2 * s);
    g.fillStyle = hp > .5 ? '#7dd45a' : hp > .25 ? '#e0b23c' : '#d4553a';
    g.fillRect(p.x - wpx / 2, y, wpx * hp, 2 * s);
  }
  function shadeC(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgb(' + Math.round(((n >> 16) & 255) * f) + ',' + Math.round(((n >> 8) & 255) * f) + ',' + Math.round((n & 255) * f) + ')';
  }

  /* the palisade round Brannoch's town, with its gate */
  function drawFort() {
    var fx0 = fort.x, gate = fort.gate, top = 8, bot = FH - 8, seg = 7;
    function post(x, y, h) {
      var a = P(x, y), w = 3.2 * scale;
      g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(a.x - w / 2 + 3 * scale, a.y - 1 * scale, w * 1.3, 2.2 * scale);
      var gr = g.createLinearGradient(a.x - w / 2, 0, a.x + w / 2, 0);
      gr.addColorStop(0, '#8a6a45'); gr.addColorStop(1, '#4f3a25');
      g.fillStyle = gr; g.fillRect(a.x - w / 2, a.y - h * scale, w, h * scale);
      g.fillStyle = '#a58459';
      g.beginPath(); g.moveTo(a.x - w / 2, a.y - h * scale); g.lineTo(a.x, a.y - (h + 3) * scale); g.lineTo(a.x + w / 2, a.y - h * scale); g.fill();
    }
    for (var y = top; y <= bot; y += seg) {
      if (Math.abs(y - gate.y) < 15) continue;
      post(fx0 + Math.sin(y * 0.7) * 0.8, y, 17 + Math.sin(y * 1.3) * 1.5);
    }
    // gate towers
    [gate.y - 18, gate.y + 18].forEach(function (ty) {
      var a = P(fx0, ty), w = 12 * scale, h = 30 * scale;
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(a.x - w / 2 + 4 * scale, a.y - 2 * scale, w * 1.1, 4 * scale);
      var gr = g.createLinearGradient(a.x - w / 2, 0, a.x + w / 2, 0);
      gr.addColorStop(0, '#7a5c3c'); gr.addColorStop(1, '#43301f');
      g.fillStyle = gr; g.fillRect(a.x - w / 2, a.y - h, w, h);
      g.fillStyle = '#5b4330'; g.fillRect(a.x - w / 2 - 1.5 * scale, a.y - h - 3 * scale, w + 3 * scale, 4 * scale);
      g.fillStyle = COL.foes.shield;
      g.fillRect(a.x - 0.6 * scale, a.y - h - 13 * scale, 1.2 * scale, 10 * scale);
      g.fillRect(a.x, a.y - h - 13 * scale, (6 + Math.sin(t * 5 + ty) * 1.2) * scale, 4 * scale);
    });
    var gp = P(fx0, gate.y + 12), gw = 6 * scale, gh = 24 * scale;
    if (!gate.dead) {
      g.fillStyle = gate.flash > 0 ? '#c9a878' : '#5c4128';
      g.fillRect(gp.x - gw / 2, gp.y - gh, gw, gh);
      g.strokeStyle = 'rgba(20,14,8,.7)'; g.lineWidth = 1.2 * scale;
      for (var i = 1; i < 4; i++) { g.beginPath(); g.moveTo(gp.x - gw / 2, gp.y - gh * i / 4); g.lineTo(gp.x + gw / 2, gp.y - gh * i / 4); g.stroke(); }
      var k = Math.max(0, gate.hp / gate.maxHp), bp = P(fx0, gate.y - 34);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(bp.x - 16 * scale, bp.y, 32 * scale, 3.4 * scale);
      g.fillStyle = k > 0.5 ? '#d9b44a' : '#e0795f'; g.fillRect(bp.x - 16 * scale, bp.y, 32 * k * scale, 3.4 * scale);
    } else {
      g.fillStyle = '#3d2c1c';
      g.save(); g.translate(gp.x + 3 * scale, gp.y); g.rotate(1.2); g.fillRect(-gw / 2, -gh, gw, gh); g.restore();
    }
  }

  function render() {
    drawField();
    if (fort) drawFort();
    var order = units.slice().sort(function (a, b) { return a.y - b.y; });
    // the fallen first, so the living stand over them
    order.forEach(function (u) { if (u.dead) drawUnit(u); });
    order.forEach(function (u) { if (!u.dead) drawUnit(u); });

    shots.forEach(function (p) {
      var k = p.t / p.dur;
      var x = U.lerp(p.x, p.tx, k), y = U.lerp(p.y, p.ty, k);
      var lift = Math.sin(k * Math.PI) * (p.big ? 46 : 22);
      var gs = P(x, y), s = P(x, y - lift);
      g.fillStyle = 'rgba(0,0,0,.2)';
      g.beginPath(); g.ellipse(gs.x, gs.y, (p.big ? 4 : 2) * scale, (p.big ? 1.6 : 0.8) * scale, 0, 0, 6.3); g.fill();
      if (p.big) {
        g.fillStyle = '#6b665c';
        g.beginPath(); g.arc(s.x, s.y, 4 * scale, 0, 6.3); g.fill();
        g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(s.x - scale, s.y - scale, 1.6 * scale, 0, 6.3); g.fill();
      } else {
        var k2 = Math.min(1, k + 0.05);
        var nx = U.lerp(p.x, p.tx, k2), ny = U.lerp(p.y, p.ty, k2) - Math.sin(k2 * Math.PI) * 22;
        var n2 = P(nx, ny), a = Math.atan2(n2.y - s.y, n2.x - s.x);
        g.strokeStyle = '#6b4a2e'; g.lineWidth = 1.2 * scale;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - Math.cos(a) * 8 * scale, s.y - Math.sin(a) * 8 * scale); g.stroke();
        g.strokeStyle = '#e8e2d0'; g.lineWidth = 1.4 * scale;
        g.beginPath(); g.moveTo(s.x - Math.cos(a) * 6.5 * scale, s.y - Math.sin(a) * 6.5 * scale); g.lineTo(s.x - Math.cos(a) * 8.5 * scale, s.y - Math.sin(a) * 8.5 * scale); g.stroke();
      }
    });

    fx.forEach(function (f) {
      var s = P(f.x, f.y);
      if (f.kind === 'spark') {
        g.globalAlpha = U.clamp(f.life * 4, 0, 1);
        g.fillStyle = '#ffe9a8';
        for (var i = 0; i < 4; i++) {
          var a = i * 1.57 + f.life * 6;
          g.fillRect(s.x + Math.cos(a) * 5 * scale, s.y - 10 * scale + Math.sin(a) * 5 * scale, 1.6 * scale, 1.6 * scale);
        }
        g.globalAlpha = 1;
      } else if (f.kind === 'dust') {
        g.globalAlpha = U.clamp(f.life * 0.9, 0, .28);
        g.fillStyle = '#cbb99a';
        g.beginPath(); g.ellipse(s.x, s.y - 3 * scale, (0.6 - f.life) * 30 * scale + 4, (0.6 - f.life) * 14 * scale + 2, 0, 0, 6.3); g.fill();
        g.globalAlpha = 1;
      } else if (f.kind === 'boom') {
        g.globalAlpha = U.clamp(f.life * 2.2, 0, 1);
        var rr = Math.max(0, 0.45 - f.life) * 60 * scale + 6;
        var gr = g.createRadialGradient(s.x, s.y - 4 * scale, 0, s.x, s.y - 4 * scale, rr);
        gr.addColorStop(0, '#fff0b0'); gr.addColorStop(0.4, '#f2a24a'); gr.addColorStop(1, 'rgba(120,90,60,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(s.x, s.y - 4 * scale, rr, 0, 6.3); g.fill();
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
    // anyone never committed simply marches home
    reserve.forEach(function (u) { survivors[u.key] = (survivors[u.key] || 0) + 1; });
    var fought = ctx.roster || G.army;
    var lost = {}, lostTotal = 0;
    Object.keys(fought).forEach(function (k) {
      var l = fought[k] - (survivors[k] || 0);
      if (l > 0) { lost[k] = l; lostTotal += l; }
    });
    Object.keys(survivors).forEach(function (k) { if (!survivors[k]) delete survivors[k]; });

    var foesLeft = alive('foes');
    var won = !retreated && (foesLeft === 0 || (alive('ours') > 0 && routing.foes));
    var title, body = '';

    // veterans: win and everyone who walked off the field is blooded;
    // lose and you keep only the veterans who survived
    G.vets = G.vets || {};
    var newVets = {};
    Object.keys(survivors).forEach(function (k) {
      newVets[k] = won ? survivors[k] : Math.min(G.vets[k] || 0, survivors[k]);
    });
    G.vets = newVets;

    // survivors go back to whoever sent them: the campaign, or the home muster
    if (ctx.roster) SIM.campaignResolved(survivors);
    else G.army = survivors;

    if (retreated) {
      G.stats.losses++;
      G.happy = U.clamp(G.happy - 5, 0, 100);
      if (kind === 'defend') {
        var taken = Math.round(Math.min(G.res.food, 30 + startFoes * 4));
        G.res.food -= taken;
        body = 'You gave ground rather than your soldiers. They took <b>' + taken +
               ' food</b> from the outlying stores and rode off.';
      } else {
        body = 'You broke off before it turned into a slaughter. Brannoch keeps the field, and their confidence.';
        G.rival.str += 3;
      }
      title = 'Withdrawn';
      U.sfx.defeat();
    } else if (won) {
      G.stats.wins++;
      var loot = { gold: 0, food: 0, iron: 0 };
      if (kind === 'defend') {
        G.stats.raidsSurvived++;
        G.rival.str = Math.max(12, G.rival.str * 0.72);
        loot.gold = Math.round(30 + startFoes * 6);
        title = 'Ashveil Holds';
        body = 'The attack broke against your line. Brannoch withdraws, weakened.';
      } else if (ctx.flavour === 'wolves') {
        loot.gold = Math.round(120 + startFoes * 10);
        loot.iron = Math.round(startFoes * 2);
        if (typeof EXPLORE !== 'undefined') EXPLORE.hitHaven(true);
        title = 'The Haven Burns';
        body = 'Their longships burn at their moorings. The Sea Wolves will not raid Ashveil for two years at least.';
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
        G.tribute = { left: 4, amt: Math.round(30 + startFoes * 4) };
        body = 'The gate is down and Brannoch\'s town is taken and stripped. They will pay tribute every season for a year — <b>' +
               G.tribute.amt + ' gold</b> a time.';
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
        if (ctx.flavour === 'wolves') body = 'The Wolves drove your men back to the boats. Their haven stands.';
        else { G.rival.str += 8; body = 'Your banners fall back across the border. Brannoch takes heart.'; }
      }
      G.happy = U.clamp(G.happy - 14, 0, 100);
      U.sfx.defeat();
    }

    if (ctx.flavour !== 'bandits' && ctx.faction !== 'wolves') SIM.dipBattle(won && !retreated, kind === 'raid');

    if (lostTotal) {
      body += '<br><b>Fallen:</b> ' + Object.keys(lost).map(function (k) {
        return lost[k] + '× ' + DATA.UNITS[k].name;
      }).join(', ');
    } else {
      body += '<br><b>Not a soul lost.</b>';
    }

    el('bt-result-title').textContent = title;
    el('bt-result-title').style.color = won ? '#8fd06a' : retreated ? '#e0b23c' : '#e0795f';
    el('bt-result-body').innerHTML = body;
    el('bt-result').classList.remove('hidden');
    el('bt-phase').textContent = won ? 'Victory' : retreated ? 'Withdrawn' : 'Defeat';
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
    if (deploying) { render(); return; }
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
    beginFight: function () { if (deploying) beginFight(); },
    isDeploying: function () { return deploying; },
    isOpen: isOpen, foeArmy: foeArmy
  };
})();
