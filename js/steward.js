/* ============================================================
   steward.js — Village Growth.
   A switch that lets the villagers build for themselves, a little at
   a time, out of the treasury:
     Off      you build everything
     Homes    cottages when families are crowded
     Needs    and whatever the realm is short of
     Steward  and growth: scouting, upgrades, research, the castle,
              the sea, great works, a garrison when raiders are near
   It keeps a gold reserve you set, keeps off ground you mark, puts your
   own plans first, stops for raids, fires and famine, and never starts
   a war. Everything it does goes in the news with the reason why.
   ============================================================ */
var STEWARD = (function () {
  'use strict';

  var MODES = {
    off:     { name: 'Off',     ic: '✋', desc: 'You build everything yourself.' },
    homes:   { name: 'Homes',   ic: '🏠', desc: 'Families raise cottages when they are crowded, and nothing else.' },
    needs:   { name: 'Needs',   ic: '🧺', desc: 'Homes, and whatever the realm is short of — food, timber, water, a market, a chapel.' },
    steward: { name: 'Steward', ic: '🏰', desc: 'Everything: they also scout, upgrade, research, raise the castle, sail and fund great works.' }
  };
  var FOCUS = {
    balanced: { name: 'Balanced', ic: '⚖️', list: [] },
    farming:  { name: 'Farming',  ic: '🌾', list: ['farm', 'fishery', 'pasture', 'windmill', 'bakery', 'granary', 'hunter'] },
    trade:    { name: 'Trade',    ic: '💰', list: ['market', 'weaver', 'warehouse', 'pasture', 'smith'] },
    defence:  { name: 'Defence',  ic: '🛡️', list: ['barracks', 'tower', 'range', 'smith'] },
    faith:    { name: 'Faith',    ic: '⛪', list: ['chapel', 'well', 'tavern', 'library'] }
  };

  function G() { return SIM.G; }
  function st() {
    var g = G();
    if (!g.grow) g.grow = { mode: 'off', reserve: 120, focus: 'balanced', clear: {}, log: [] };
    if (!g.grow.clear) g.grow.clear = {};
    if (!g.grow.log) g.grow.log = [];
    return g.grow;
  }
  function on() { return G() && st().mode !== 'off'; }
  function level() { return { off: 0, homes: 1, needs: 2, steward: 3 }[st().mode] || 0; }

  /* ---------------- where things go ---------------- */
  function cleared(x, y) { return !!st().clear[x + ',' + y]; }
  function toggleClear(x, y, val) {
    var k = x + ',' + y, c = st().clear;
    if (val === undefined) val = !c[k];
    if (val) c[k] = 1; else delete c[k];
    return val;
  }
  function near(x, y, ids, r) {
    var n = 0;
    G().buildings.forEach(function (b) {
      if (ids.indexOf(b.id) < 0) return;
      if (Math.hypot(b.x + (b.def.w || 1) / 2 - x, b.y + (b.def.h || 1) / 2 - y) <= r) n++;
    });
    return n;
  }
  /* a score for putting building `id` with its corner at (x,y) */
  function score(id, x, y) {
    var def = DATA.B[id], w = def.w || 1, h = def.h || 1, cx = x + w / 2, cy = y + h / 2;
    var c = G().buildings[0], d = Math.hypot(cx - c.x - 1, cy - c.y - 1);
    var s = 0;
    var HOMES = ['house', 'manor'], NOISY = ['smith', 'mine', 'quarry', 'sawmill', 'barracks', 'range'];
    // beside a lane is better than out in the grass
    var onPath = 0;
    for (var oy = -1; oy <= h; oy++) for (var ox = -1; ox <= w; ox++) {
      var t = W.at(x + ox, y + oy);
      if (t && t.path && !t.bld) onPath++;
    }
    onPath = Math.min(onPath, 3);
    if (def.housing) {
      // homes cluster round the hall and along the lanes, away from forges
      s += 10 - d * 0.9 + near(cx, cy, HOMES, 2.2) * 1.6 + near(cx, cy, ['well'], 4) * 1.5 +
           near(cx, cy, ['market', 'chapel', 'tavern'], 5) * 0.8 - near(cx, cy, NOISY, 2.5) * 2.5;
    } else if (def.seasonal || id === 'pasture') {
      // fields on the best soil, just outside the houses, with other fields
      var soil = SIM.soilMul({ def: def, x: x, y: y });
      s += soil * 8 + near(cx, cy, ['farm', 'pasture', 'windmill'], 3) * 1.2 - Math.abs(d - 6) * 0.6 - near(cx, cy, HOMES, 1.6) * 1.5;
    } else if (def.scaleNear) {
      // woodcutters by the woods, quarries by the rock, fishers by the water
      var n = W.nearCount(x, y, def.scaleNear.terrain, 1);
      s += n * 2.2 - d * 0.35;
    } else if (id === 'well') {
      // where the most homes are without water
      var dry = 0;
      G().buildings.forEach(function (b) {
        if (!b.built || !b.def.housing || b.id === 'castle') return;
        var hx = b.x + 0.5, hy = b.y + 0.5;
        if (Math.hypot(hx - cx, hy - cy) <= 4 && !(typeof FOLK !== 'undefined' && FOLK.servicesOf(b).well)) dry++;
      });
      s += dry * 3 - d * 0.2 + near(cx, cy, HOMES, 3);
    } else if (['market', 'chapel', 'tavern', 'library', 'granary', 'warehouse'].indexOf(id) >= 0) {
      // the middle of town
      s += 8 - d * 0.7 + near(cx, cy, HOMES, 4) * 0.9;
    } else if (id === 'windmill' || id === 'bakery') {
      s += near(cx, cy, ['farm'], 4) * 1.5 + near(cx, cy, HOMES, 4) * 0.5 - d * 0.3;
    } else if (id === 'smith' || id === 'sawmill') {
      s += near(cx, cy, ['mine', 'quarry', 'lumber'], 4) * 1.5 - d * 0.3 - near(cx, cy, HOMES, 1.5) * 2;
    } else if (id === 'tower') {
      // a watch on the shore, facing the sea
      s += W.nearCount(x, y, ['shore', 'water'], 2) * 0.8 - Math.abs(d - 7) * 0.5;
    } else {
      s += 6 - d * 0.5;
    }
    s += onPath * 0.8;
    // do not fell good woodland for a house if open ground will do
    W.footprint(def, x, y).forEach(function (f) { var t = W.at(f.x, f.y); if (t && t.terr === 'forest' && id !== 'lumber') s -= 1.2; });
    return s;
  }
  function spotFor(id) {
    var def = DATA.B[id], c = G().buildings[0], best = null, bs = -1e9;
    for (var y = 0; y < W.ROWS; y++) for (var x = 0; x < W.COLS; x++) {
      if (Math.abs(x - c.x) > 14 || Math.abs(y - c.y) > 14) continue;
      var bad = false;
      W.footprint(def, x, y).forEach(function (f) { if (cleared(f.x, f.y)) bad = true; });
      if (bad || !W.canPlace(id, x, y).ok) continue;
      var sc = score(id, x, y);
      if (sc > bs) { bs = sc; best = { x: x, y: y }; }
    }
    return best;
  }

  /* ---------------- what to do next ---------------- */
  function spare(cost, urgent) {
    // an empty larder is what the reserve is kept for
    var g = G(), res = urgent ? 0 : st().reserve;
    for (var k in cost) {
      var keep = k === 'gold' ? res : k === 'food' ? Math.max(40, g.pop * 3) : 20;
      if (g.res[k] - cost[k] < keep) return false;
    }
    return true;
  }
  function family() {
    var f = typeof FOLK !== 'undefined' ? FOLK.families() : [];
    return f.length ? 'The ' + f[Math.floor(Math.random() * Math.min(6, f.length))].f + 's' : 'The villagers';
  }
  function log(msg) {
    var s2 = st();
    s2.log.unshift({ s: SIM.season().name.slice(0, 3) + ' ' + SIM.year(), m: msg });
    if (s2.log.length > 30) s2.log.pop();
  }
  /* give a new building time to make a difference before building another
     of the same: a season for workshops, less for homes */
  function rested(id) {
    var last = st().last && st().last[id];
    if (last === undefined) return true;
    var wait = DATA.B[id].housing ? DATA.SEASON_LEN * 0.15 : DATA.SEASON_LEN * 0.9;
    return G().time - last >= wait;
  }
  function build(id, why, urgent) {
    if (!SIM.unlocked(id) || !rested(id)) return false;
    var def = DATA.B[id];
    if (def.max && SIM.countAll(id) >= def.max) return false;
    if (!spare(SIM.costOf(id), urgent)) return false;
    var p = spotFor(id);
    if (!p) return false;
    var r = SIM.place(id, p.x, p.y);
    if (!r.ok) return false;
    r.b.byFolk = true;
    if (!st().last) st().last = {};
    st().last[id] = G().time;
    var who = def.housing ? family() : 'The villagers';
    var msg = who + ' built ' + (/^[aeiou]/i.test(def.name) ? 'an ' : 'a ') + def.name.toLowerCase() + ' — ' + why + '.';
    log(msg);
    SIM.emit('grow-built', { b: r.b, msg: msg });
    return true;
  }
  var HOME_WHY = 'families were sharing rooms';

  function crowded() { var g = G(); return g.pop >= SIM.housing() - 1.5; }

  function think() {
    var g = G(), L = level();
    // a fire: the villagers do not wait to be told
    SIM.burning().forEach(function (b) { if (!(b.fire.brigade > 0) && L >= 2) { SIM.rallyBrigade(b); note('Neighbours ran with buckets to the burning ' + b.def.name.toLowerCase() + '.'); } });
    // things that come before building: a fire, raiders, an empty larder
    if (g.war || SIM.burning().length) return;
    var starving = g.res.food <= g.pop * 0.5;
    if (starving) { build('fishery', 'the larder was empty', true) || build('farm', 'the larder was empty', true) || build('hunter', 'the larder was empty', true); return; }
    // the player's own plans come first
    if (SIM.plans.some(function (p) { return p.by === 'you'; })) return;

    if (crowded() && build('house', HOME_WHY)) return;
    if (L < 2) return;

    // needs, in the order the realm's advisor gives them
    var adv = SIM.advice(), focus = FOCUS[st().focus] || FOCUS.balanced;
    var order = adv.order.slice();
    order.sort(function (a, b) { return (focus.list.indexOf(b) >= 0) - (focus.list.indexOf(a) >= 0); });
    var fed = g.res.food > g.pop * 25;
    for (var i = 0; i < order.length; i++) {
      if (fed && ['farm', 'fishery', 'hunter', 'granary'].indexOf(order[i]) >= 0) continue;   // the barns are bursting
      var id = order[i], why = adv.map[id].replace(/^For your chapter: /, 'for the chapter: ').replace(/^./, function (c) { return c.toLowerCase(); });
      if (id === 'house' && !crowded()) continue;
      if (build(id, why)) return;
    }
    // water for homes that have none
    if (typeof FOLK !== 'undefined' && FOLK.summary().noWell >= 2 && build('well', 'homes had no water nearby')) return;
  }

  /* the grown-up part: expansion and development, on its own clock so a
     busy building season never starves the scholars or the scouts */
  var stewardTimer = 0;
  function steward() {
    if (G().war || SIM.burning().length) return;
    develop();
  }
  function develop() {
    var g = G(), focus = FOCUS[st().focus] || FOCUS.balanced;
    // keep homes a little ahead of the people, so the town can grow
    if (g.pop >= SIM.housing() - 4 && g.happy > 35 && build('house', 'the town was ready to grow')) return;
    // a focus gets one of its buildings when there is money to spare
    if (focus.list.length && g.res.gold > st().reserve + 250) {
      for (var i = 0; i < focus.list.length; i++) {
        var id = focus.list[i];
        if ((g.count[id] || 0) < 1 + Math.floor(g.pop / 25) && build(id, 'the realm is set on ' + focus.name.toLowerCase())) return;
      }
    }
    // scholars need somewhere to work before the deeper studies open up
    if (!g.research) {
      var blocked = Object.keys(DATA.TECH).some(function (t) {
        var d = DATA.TECH[t];
        return !g.tech[t] && !SIM.techClosed(t) && d.lib && (g.count.library || 0) < d.lib && d.req.every(function (r) { return g.tech[r]; });
      });
      if (blocked && build('library', 'the scholars had outgrown their books')) return;
    }
    // research
    if (!g.research) {
      // the forks close a road for good: that choice is left to the ruler
      var techs = Object.keys(DATA.TECH).filter(function (t) { return !DATA.TECH[t].fork && SIM.techAvailable(t) && spare(DATA.TECH[t].cost); });
      techs.sort(function (a, b) { return DATA.TECH[a].tier - DATA.TECH[b].tier; });
      if (techs.length && SIM.startResearch(techs[0]).ok) { note('The scholars began studying ' + DATA.TECH[techs[0]].name + '.'); return; }
    }
    // the castle — buying what the builders cannot make, if the purse is fat
    var nc = SIM.nextCastle();
    if (nc && SIM.canTrade() && g.res.gold > st().reserve + 300) {
      for (var k in nc.cost) if (k !== 'gold' && g.res[k] < nc.cost[k] && SIM.priceOf(k) && SIM.buy(k, 1).ok) { note('The steward bought ' + k + ' at market for the ' + nc.name + '.'); return; }
    }
    if (nc && spare(nc.cost) && SIM.upgradeCastle().ok) { note('The masons raised the ' + nc.name + '.'); return; }
    // upgrades: the busiest workplaces first
    var up = g.buildings.filter(function (b) { return SIM.canUpgrade(b) && SIM.jobsOf(b) > 0 && b.workers >= SIM.jobsOf(b); });
    up.sort(function (a, b) { return (a.level || 1) - (b.level || 1); });
    for (var u = 0; u < up.length; u++) {
      var uc = SIM.upgradeCost(up[u]);
      if (uc && spare(uc) && SIM.upgradeBuilding(up[u]).ok) { note('The ' + up[u].def.name.toLowerCase() + ' was improved to level ' + up[u].level + '.'); return; }
    }
    // push into the mist
    if (typeof EXPLORE !== 'undefined' && EXPLORE.known() < 0.95 && !EXPLORE.scouts.length && g.res.gold > st().reserve + 30) {
      var c = g.buildings[0], tgt = null, bd = 1e9;
      W.tiles.forEach(function (t) {
        if (t.terr === 'water' || EXPLORE.seen(t.x, t.y)) return;
        var d = Math.hypot(t.x - c.x, t.y - c.y);
        if (d < bd) { bd = d; tgt = t; }
      });
      if (tgt && EXPLORE.sendScout(tgt.x, tgt.y).ok) { note('A scout was sent to map the land to the ' + (tgt.x > c.x ? 'east' : 'west') + '.'); return; }
    }
    // the sea
    if (typeof EXPLORE !== 'undefined' && EXPLORE.harbour() && g.sea && !g.sea.voyage) {
      var sp = g.sea.spots.map(function (s, i) { return i; }).filter(function (i) { return !g.sea.spots[i].known; });
      if (sp.length && spare(EXPLORE.CHART_COST) && EXPLORE.chart(sp[0]).ok) { note('A ship put out to chart the waters.'); return; }
      var op = g.sea.spots.map(function (s, i) { return i; }).filter(function (i) { var s = g.sea.spots[i]; return s.known && !s.outpost && EXPLORE.SPOTS[s.k].res; });
      if (op.length && g.pop > 30 && spare(EXPLORE.OUTPOST_COST) && EXPLORE.foundOutpost(op[0]).ok) { note('Settlers sailed to found an outpost on ' + EXPLORE.SPOTS[g.sea.spots[op[0]].k].name + '.'); return; }
    }
    // a garrison when raiders are coming and the walls look thin (never an attack)
    if (SIM.raidSoon() && SIM.deterrence() < 1.2 && SIM.armyCount() < 3 + g.pop / 12 && SIM.armySlots() < SIM.armyCap()) {
      var kind = ['spearman', 'archer', 'militia'].filter(function (k) { return SIM.unitAvailable(k) && spare(DATA.UNITS[k].cost); })[0];
      if (kind && SIM.recruit(kind, 1).ok) { note('A ' + DATA.UNITS[kind].name.toLowerCase() + ' took up arms to guard the town.'); return; }
    }
    // great works with a full treasury
    if (!g.workNow && g.res.gold > SIM.cap('gold') * 0.8) {
      var w = Object.keys(DATA.PROJECTS).filter(function (id) { return !SIM.done(id) && SIM.workAvailable(id); })[0];
      if (w && SIM.startWork(w).ok) { note('The treasury began paying for ' + DATA.PROJECTS[w].name + '.'); return; }
    }
  }
  function note(msg) { log(msg); SIM.emit('grow-built', { msg: msg }); }

  var timer = 3;
  function tick(dt) {
    if (!on()) return;
    timer -= dt;
    if (timer > 0) return;
    // one decision every few seconds: the village grows, it does not erupt
    timer = level() >= 3 ? 3.5 : 4.5;
    think();
    if (level() >= 3 && --stewardTimer <= 0) { stewardTimer = 2; steward(); }
  }
  function reset() { timer = 3; stewardTimer = 0; }

  return {
    tick: tick, reset: reset, MODES: MODES, FOCUS: FOCUS, state: st, on: on,
    setMode: function (m) { st().mode = m; timer = 1; }, setFocus: function (f) { st().focus = f; },
    setReserve: function (v) { st().reserve = v; },
    cleared: cleared, toggleClear: toggleClear, spotFor: spotFor, score: score
  };
})();
