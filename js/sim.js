/* ============================================================
   sim.js — game state, economy, workers, research, population
   ============================================================ */
var SIM = (function () {
  'use strict';

  var G = null;                 // the whole game state
  var listeners = [];
  function on(fn) { listeners.push(fn); }
  function emit(kind, payload) { listeners.forEach(function (f) { f(kind, payload); }); }

  var BASE_STORE = { gold: 500, food: 400, wood: 350, stone: 300, iron: 150, tools: 120, bread: 120, wool: 150, cloth: 100 };

  /* ---------------------------------------------------------
     new game
     --------------------------------------------------------- */
  /* how hard the world pushes back */
  var DIFFS = {
    gentle: { name: 'Gentle', res: 1.4, rival: 0.6, gap: 1.4, fire: 0.6, fever: 0.5, grace: 10, score: 0.8, cost: 0.9, work: 1.08, joy: 4,
              desc: 'More in the stores, a slower neighbour, and fewer fires and fevers.' },
    fair:   { name: 'Fair',   res: 1,   rival: 1,   gap: 1,   fire: 1,   fever: 1,   grace: 6,  score: 1, cost: 1, work: 1,
              desc: 'The realm as it was meant to be played.' },
    harsh:  { name: 'Harsh',  res: 0.75, rival: 1.45, gap: 0.8, fire: 1.2, fever: 1.4, grace: 4, score: 1.45, cost: 1.2, work: 0.88, joy: -4,
              desc: 'Thin stores, a hungry neighbour, and a hard world. Worth far more at the end.' }
  };
  var SCENARIOS = {
    standard: { name: 'A New Beginning', ic: '🏝️', desc: 'Land, a hall, a few families and a spring to start in.' },
    winter:   { name: 'The Late Landing', ic: '❄️', desc: 'You landed in autumn with little put by. Get food in before the snow.' },
    border:   { name: 'The Border War', ic: '⚔️', desc: 'Brannoch is already strong and already angry. Soldiers from day one.' },
    merchant: { name: 'The Merchant Prince', ic: '💰', desc: 'A fortune in gold and almost nothing else. Buy what you cannot build.' }
  };
  function diff() { return DIFFS[(G && G.setup && G.setup.diff) || 'fair'] || DIFFS.fair; }
  function graceSeasons() {
    var sc = G && G.setup && G.setup.scen;
    return sc === 'border' ? 3 : diff().grace + (sc === 'winter' ? 2 : 0);
  }

  function newGame(seed, setup) {
    if (typeof FOLK !== 'undefined') FOLK.reset();
    if (typeof EXPLORE !== 'undefined') EXPLORE.reset();
    if (typeof HONOURS !== 'undefined') HONOURS.reset();
    if (typeof STEWARD !== 'undefined') STEWARD.reset();
    if (typeof COURT !== 'undefined') COURT.reset();
    seed = seed || Math.floor(Math.random() * 1e9);
    setup = setup || { map: 'green', diff: 'fair', scen: 'standard' };
    var spot = W.generate(seed, setup.map);
    G = {
      seed: seed,
      time: 0,                       // seconds of game time
      res: { gold: 260, food: 220, wood: 160, stone: 70, iron: 0, tools: 0, bread: 0, wool: 0, cloth: 0 },
      seen: { gold: 1, food: 1, wood: 1, stone: 1 },
      toolCov: 0, breadCov: 0,
      pop: 6, happy: 62,
      buildings: [],
      tech: {}, research: null, researchPts: 0,
      castle: 0,
      army: { militia: 4 },
      rival: { str: 30, anger: 0, nextRaid: DATA.SEASON_LEN * 6.5, warned: false },
      quests: {}, questShown: [], chapter: 0, won: false, weather: 'clear', weatherTimer: 40,
      tut: -1, mkt: {}, decrees: {}, shiftUntil: -1, finds: [], findTimer: DATA.SEASON_LEN * 0.8,
      fog: '',                       // the mist over the island; '' = a fresh reign, not yet painted
      ship: null, shipTimer: DATA.SEASON_LEN * 2.2, fireTimer: 5,
      stats: { wins: 0, losses: 0, built: 0, raidsSurvived: 0, techDone: 0, upgrades: 0, traded: 0 },
      vets: {}, formation: 'line', campaign: null,
      eventTimer: DATA.SEASON_LEN * 1.6,
      growTimer: 6, reliefTimer: 30, reliefCooldown: 0, festivals: {}, fairUntil: -1,
      speed: 1, setup: setup, fresh: true,
      log: []
    };
    // how hard, and how it begins
    var D = diff();
    // gentler stores lean on food, so a quick start never outgrows its barns
    Object.keys(G.res).forEach(function (k) { G.res[k] = Math.round(G.res[k] * (k === 'food' ? Math.max(D.res, D.res * D.res) : Math.min(D.res, 1.15))); });
    if (setup.scen === 'winter') {
      G.time = DATA.SEASON_LEN * 2 + 1;   // autumn of the first year
      G.res.food = Math.round(90 * D.res); G.happy = 52;
      G.rival.nextRaid += DATA.SEASON_LEN * 2; G.fireTimer = 5;
    } else if (setup.scen === 'border') {
      G.rival.str = 55; G.rival.nextRaid = DATA.SEASON_LEN * 3.2;
      G.army = { militia: 6, spearman: 2 }; G.res.gold += 120; G.res.iron = 20;
    } else if (setup.scen === 'merchant') {
      G.res.gold = Math.round(900 * D.res); G.res.wood = 50; G.res.stone = 20; G.res.food = Math.round(300 * D.res);
    }
    // the castle is free and pre-placed
    var castle = mkBuilding('castle', spot.x, spot.y);
    castle.built = true; castle.prog = 1;
    commit(castle);
    // a couple of starter cottages so villagers exist from the first second
    [[-2, 0], [3, 1]].forEach(function (o) {
      var x = spot.x + o[0], y = spot.y + o[1];
      if (W.canPlace('house', x, y).ok) {
        var h = mkBuilding('house', x, y); h.built = true; h.prog = 1; commit(h);
      }
    });
    // the merchant prince lands with a trading post already standing: gold is
    // only worth having if there is somewhere to spend it
    if (setup.scen === 'merchant') {
      for (var rr = 2, placed = false; rr < 7 && !placed; rr++)
        for (var dy = -rr; dy <= rr && !placed; dy++) for (var dx = -rr; dx <= rr && !placed; dx++) {
          if (Math.abs(dx) !== rr && Math.abs(dy) !== rr) continue;
          if (W.canPlace('market', spot.x + dx, spot.y + dy).ok) { var m = mkBuilding('market', spot.x + dx, spot.y + dy); m.built = true; m.prog = 1; commit(m); placed = true; }
        }
    }
    refreshCounts();
    AGENTS.reset();
    emit('newgame');
    return G;
  }

  /* ---------------------------------------------------------
     buildings
     --------------------------------------------------------- */
  var uid = 1;
  function makeCompact(b) {
    b.compact = true;
    var d = {};
    Object.keys(b.def).forEach(function (k) { d[k] = b.def[k]; });
    d.w = 1; d.h = 1;
    b.def = d;
  }
  function mkBuilding(id, x, y) {
    var def = DATA.B[id];
    return {
      uid: uid++, id: id, def: def, x: x, y: y,
      built: false, prog: 0, workers: 0, paused: false,
      t: Math.random() * 6.28, level: 1
    };
  }
  function commit(b) {
    markPathsDirty();
    G.buildings.push(b);
    W.footprint(b.def, b.x, b.y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (!t) return;
      if (b.def.isRoad) { t.road = true; }
      else {
        if (t.terr === 'forest') { t.terr = 'grass'; t.cleared = true; }
        t.bld = b;
      }
    });
  }

  /* A farm's plot can straddle kinds of ground: its soil is the average. */
  function soilMul(b) {
    var cells = W.footprint(b.def, b.x, b.y), m = 0;
    cells.forEach(function (c) {
      var t = W.at(c.x, c.y);
      m += !t ? 1 : t.terr === 'meadow' ? 1.35 : t.terr === 'sand' ? 0.7 : 1;
    });
    return cells.length ? m / cells.length : 1;
  }

  /* what an upgraded building is worth, per level */
  function lvlMul(b) { return 1 + DATA.UPGRADE.gain * ((b.level || 1) - 1); }

  function upgradeCost(b) {
    if (!canUpgrade(b)) return null;
    var base = costOf(b.id), out = {}, mult = Math.pow(DATA.UPGRADE.costPow, b.level || 1);
    Object.keys(base).forEach(function (k) { out[k] = Math.max(5, Math.round(base[k] * mult)); });
    if (!Object.keys(out).length) out.gold = 60 * (b.level || 1);
    return out;
  }
  function canUpgrade(b) {
    if (!b.built) return false;
    if (b.def.evolves) return false;          // these rise on their own merit
    if (b.def.isRoad || b.def.isWall || b.id === 'castle') return false;
    return (b.level || 1) < DATA.UPGRADE.max;
  }
  function upgradeBuilding(b) {
    if (!canUpgrade(b)) return { ok: false, why: 'This cannot be upgraded further' };
    var cost = upgradeCost(b);
    if (!canAfford(cost)) return { ok: false, why: 'Not enough ' + short(cost) };
    pay(cost);
    b.level = (b.level || 1) + 1;
    G.stats.upgrades = (G.stats.upgrades || 0) + 1;
    U.sfx.build();
    emit('toast', { msg: b.def.name + ' upgraded to level ' + b.level, kind: 'good' });
    emit('change');
    checkQuests();
    return { ok: true };
  }

  /* ---------------------------------------------------------
     Footpaths.
     Paths are NOT buildings. They are worked out from where your
     buildings stand, cost nothing, and occupy no tile — they are the
     tracks worn between doorways. You can still build on ground a path
     crosses; the path simply reroutes around the new wall.
     Each tile counts how many routes cross it, so busy ground reads as
     a wider, darker track and quiet ground as a thin trail.
     --------------------------------------------------------- */
  var _pathDirty = true;
  function markPathsDirty() { _pathDirty = true; }

  function blocked(t) {
    if (!t) return true;
    if (!DATA.TERRAIN[t.terr].walk) return true;
    return !!t.bld;                       // walk around buildings, not through
  }

  /* cheapest route from one building's doorstep to anything already on the
     network; existing tracks are cheap so routes braid into shared lanes */
  function tracePath(b, onNet) {
    var starts = [], seen = {}, open = [];
    W.footprint(b.def, b.x, b.y).forEach(function (c) {
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (d) {
        var t = W.at(c.x + d[0], c.y + d[1]);
        if (t && !blocked(t)) starts.push(t);
      });
    });
    for (var i = 0; i < starts.length; i++) {
      var k = starts[i].x + ',' + starts[i].y;
      if (seen[k] !== undefined) continue;
      seen[k] = 0;
      open.push({ t: starts[i], cost: 0, prev: null });
    }
    var guard = 0;
    while (open.length && guard++ < 1500) {
      var bi = 0;
      for (var j = 1; j < open.length; j++) if (open[j].cost < open[bi].cost) bi = j;
      var cur = open.splice(bi, 1)[0];
      if (onNet(cur.t)) {
        var run = [];
        while (cur) { run.push(cur.t); cur = cur.prev; }
        return run;
      }
      if (cur.cost > 24) continue;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (d) {
        var n = W.at(cur.t.x + d[0], cur.t.y + d[1]);
        if (blocked(n)) return;
        var step = n.path ? 0.25 : (n.terr === 'forest' ? 1.5 : 1);
        var c2 = cur.cost + step, k2 = n.x + ',' + n.y;
        if (seen[k2] !== undefined && seen[k2] <= c2) return;
        seen[k2] = c2;
        open.push({ t: n, cost: c2, prev: cur });
      });
    }
    return null;
  }

  function rebuildPaths() {
    _pathDirty = false;
    var tiles = W.tiles, i;
    for (i = 0; i < tiles.length; i++) tiles[i].path = 0;
    var castle = G.buildings[0];
    if (!castle) return;

    // the castle forecourt seeds the network — or, if the castle has been
    // built in on every side, the nearest open ground to it
    var net = {}, seeded = 0;
    W.footprint(castle.def, castle.x, castle.y).forEach(function (c) {
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (d) {
        var t = W.at(c.x + d[0], c.y + d[1]);
        if (t && !blocked(t)) { t.path = 1; net[t.x + ',' + t.y] = 1; seeded++; }
      });
    });
    for (var rad = 2; !seeded && rad <= 5; rad++) {
      for (var oy = -rad; oy <= rad + 1; oy++) for (var ox = -rad; ox <= rad + 1; ox++) {
        var t3 = W.at(castle.x + ox, castle.y + oy);
        if (t3 && !blocked(t3) && (Math.abs(ox) === rad || Math.abs(oy) === rad || ox === rad + 1 || oy === rad + 1)) {
          t3.path = 1; net[t3.x + ',' + t3.y] = 1; seeded++;
        }
      }
    }
    // Every building traces the whole way to the castle gate rather than
    // stopping at the first track it meets, so tiles near the keep carry
    // many routes and wear into broad lanes while the outskirts stay thin.
    // Worn ground is cheap to walk, so routes braid together on their own.
    function atGate(t) { return !!net[t.x + ',' + t.y]; }

    var list = G.buildings.filter(function (b) { return b !== castle && !b.def.isWall; });
    list.sort(function (a, b) {
      return U.dist(a.x, a.y, castle.x, castle.y) - U.dist(b.x, b.y, castle.x, castle.y);
    });
    list.forEach(function (b) {
      var run = tracePath(b, atGate);
      if (!run) return;
      run.forEach(function (t) { t.path = (t.path || 0) + 1; });
    });
  }
  /* Tracing every building to the gate is not free, and placing a row of
     houses dirties it on each one. Coalesce: rebuild at most a few times a
     second, and immediately the first time or when a caller insists. */
  var _pathAt = -1e9, _pathEver = false;
  function ensurePaths(force) {
    if (!_pathDirty) return;
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (!force && _pathEver && now - _pathAt < 350) return;
    _pathAt = now; _pathEver = true;
    rebuildPaths();
  }

  /* What the realm produces each second, valued in gold. Markets take a cut
     of this, so trade grows with what your kingdom actually makes rather than
     with where a stall happens to sit. Cached — output() asks for it once per
     market and it must not walk every building each time. */
  var GOODS_VALUE = { food: 1.00, wood: 1.30, stone: 1.85, iron: 3.60, tools: 5.20, bread: 2.40, wool: 2.10, cloth: 6.50 };
  var _goodsCache = 0, _goodsAt = -1e9;
  function goodsValue() {
    if (Math.abs(G.time - _goodsAt) < 0.25) return _goodsCache;
    var total = 0;
    G.buildings.forEach(function (b) {
      if (!b.built || b.paused || !b.def.produces) return;
      if (b.def.seasonal) { total += farmYearly(b) * GOODS_VALUE.food; return; }
      var o = output(b);
      Object.keys(o).forEach(function (k) {
        if (o[k] > 0 && GOODS_VALUE[k]) total += o[k] * GOODS_VALUE[k];
      });
    });
    _goodsAt = G.time; _goodsCache = total;
    return total;
  }

  /* Each further market takes a smaller cut of the same goods, so a second
     market is worth building and a tenth is not. */
  function marketCut(index) { return 0.24 * Math.pow(0.7, index); }

  function costOf(id) {
    var def = DATA.B[id], out = {};
    Object.keys(def.cost || {}).forEach(function (k) {
      var v = def.cost[k];
      if (k === 'stone' && G.tech.masonry) v *= 0.9;
      if (k === 'stone' && perk('masons')) v *= 0.8;
      if (id === 'market' && perk('trade')) v *= 0.8;
      if ((id === 'chapel' || id === 'well') && perk('holy')) v *= 0.67;
      out[k] = Math.round(v * (diff().cost || 1));
    });
    return out;
  }

  function canAfford(cost) {
    return Object.keys(cost).every(function (k) { return G.res[k] >= cost[k]; });
  }
  function pay(cost) {
    Object.keys(cost).forEach(function (k) { G.res[k] -= cost[k]; });
  }

  function unlocked(id) {
    var def = DATA.B[id];
    if (def.tech && !G.tech[def.tech]) return false;
    if (def.castleReq && G.castle < def.castleReq) return false;
    if (def.unique) return false;
    return true;
  }
  function lockReason(id) {
    var def = DATA.B[id];
    if (def.tech && !G.tech[def.tech]) return 'Requires ' + DATA.TECH[def.tech].name;
    if (def.castleReq && G.castle < def.castleReq) return 'Requires the ' + DATA.CASTLE[def.castleReq].name;
    return '';
  }
  /* every one standing or going up, for limits like "one cathedral" */
  function countAll(id) {
    var n = 0;
    G.buildings.forEach(function (b) { if (b.id === id) n++; });
    return n;
  }

  function place(id, x, y) {
    var def = DATA.B[id];
    if (!unlocked(id)) return { ok: false, why: lockReason(id) || 'Not yet available' };
    if (def.max && countAll(id) >= def.max) return { ok: false, why: 'You already have ' + def.max };
    var chk = W.canPlace(id, x, y);
    if (!chk.ok) return chk;
    var cost = costOf(id);
    if (!canAfford(cost)) return { ok: false, why: 'Not enough ' + short(cost) };
    pay(cost);
    var b = mkBuilding(id, x, y);
    // woodland in the way is cleared as the plot is marked out, and the
    // timber goes to the stores
    var felled = 0;
    W.footprint(def, x, y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (t && t.terr === 'forest') felled++;
    });
    if (felled) {
      G.res.wood = Math.min(cap('wood'), G.res.wood + 12 * felled);
      emit('cleared', { x: x, y: y, gain: 12 * felled });
      rootTreasure(x, y);
    }
    if (def.build <= 0) { b.built = true; b.prog = 1; }
    b.paid = cost;
    commit(b);
    lastPlaced = { kind: 'place', b: b, at: Date.now() };
    G.stats.built++;
    refreshCounts();
    emit('build', b);
    return { ok: true, b: b };
  }

  /* What a building would do on a given spot, in a few words, for the
     placement ghost — so you can see rich soil or thick woodland pay off
     before you commit. */
  function preview(id, x, y) {
    var def = DATA.B[id];
    if (!def) return '';
    var b = mkBuilding(id, x, y);
    uid--;
    b.built = true; b.workers = jobsOf(b);
    if (id === 'market') b._mIdx = G.count[id] || 0;
    var parts = [];
    if (def.seasonal) {
      var yr = farmPotential(b) * DATA.SEASON_LEN * (GARDEN * 3.4 + CROP_RATE * 2.3);
      parts.push('≈+' + Math.round(yr) + ' 🌾 a year, most at harvest');
    } else if (def.produces || def.trade) {
      var o = output(b);
      Object.keys(o).forEach(function (k) {
        if (o[k] > 0.004) {
          var r = DATA.RES.filter(function (q) { return q.key === k; })[0];
          parts.push('+' + (o[k] * DATA.SEASON_LEN).toFixed(0) + ' ' + (r ? r.ic : k));
        }
      });
      if (parts.length) parts[parts.length - 1] += ' a season';
    }
    if (def.housing) parts.push('homes for ' + def.housing);
    if (def.happy) parts.push('+' + def.happy + ' contentment');
    if (def.aura) {
      var n = 0;
      G.buildings.forEach(function (o2) {
        if (o2.built && def.aura[o2.id] && U.dist(x, y, o2.x, o2.y) <= (def.radius || 3) + 0.4) n++;
      });
      parts.push('boosts ' + n + ' nearby');
    }
    if (def.store) parts.push('more storage');
    if (def.defense) parts.push('+' + def.defense + ' defence');
    if (def.armyCap) parts.push('+' + def.armyCap + ' troops');
    if (def.research) parts.push('faster research');
    return parts.slice(0, 2).join(' · ');
  }

  /* ---------------------------------------------------------
     Second thoughts. A building placed a moment ago can be taken back for
     everything it cost, and any building can be moved for a quarter of
     its price — no demolishing and rebuilding to fix a misplaced farm.
     --------------------------------------------------------- */
  var UNDO_MS = 8000, lastPlaced = null;
  function canUndo() {
    if (!lastPlaced || Date.now() - lastPlaced.at >= UNDO_MS) return false;
    var there = G.buildings.indexOf(lastPlaced.b) >= 0;
    return lastPlaced.kind === 'demolish' ? !there : there;
  }
  function undoLeft() { return canUndo() ? (UNDO_MS - (Date.now() - lastPlaced.at)) / 1000 : 0; }
  function undoPlace() {
    if (!canUndo()) return { ok: false, why: 'Too late to take that back' };
    var b = lastPlaced.b;
    if (lastPlaced.kind === 'demolish') {
      // put it back exactly as it was, if the ground is still free
      var free = W.footprint(b.def, b.x, b.y).every(function (c) { var t = W.at(c.x, c.y); return t && !t.bld; });
      if (!free) return { ok: false, why: 'Something else stands there now' };
      var refund = lastPlaced.refund;
      lastPlaced = null;
      Object.keys(refund).forEach(function (k) { G.res[k] = Math.max(0, G.res[k] - refund[k]); });
      commit(b);
      refreshCounts();
      emit('undone', b);
      return { ok: true, b: b, restored: true };
    }
    lastPlaced = null;
    removeFromMap(b);
    Object.keys(b.paid || {}).forEach(function (k) { G.res[k] = Math.min(cap(k) + b.paid[k], G.res[k] + b.paid[k]); });
    G.stats.built = Math.max(0, G.stats.built - 1);
    refreshCounts();
    emit('undone', b);
    return { ok: true, b: b };
  }
  function removeFromMap(b) {
    var i = G.buildings.indexOf(b);
    if (i >= 0) G.buildings.splice(i, 1);
    markPathsDirty();
    W.footprint(b.def, b.x, b.y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (t && t.bld === b) t.bld = null;
    });
    AGENTS.dropJob(b);
  }
  function moveCost(b) {
    var base = costOf(b.id), out = {};
    Object.keys(base).forEach(function (k) { out[k] = Math.max(1, Math.round(base[k] * 0.25)); });
    out.gold = Math.max(5, out.gold || 0);
    return out;
  }
  function canMove(b, x, y) {
    // it may have burned down (or been undone) while you were choosing the spot
    if (!b || G.buildings.indexOf(b) < 0) return { ok: false, why: 'It is no longer standing' };
    if (b.def.unique) return { ok: false, why: 'The castle stays where it is' };
    if (b.fire) return { ok: false, why: 'Not while it is burning' };
    if (x === b.x && y === b.y) return { ok: false, why: 'That is where it already is' };
    return W.canPlace(b.id, x, y, b.def, b);
  }
  function moveBuilding(b, x, y) {
    var chk = canMove(b, x, y);
    if (!chk.ok) return chk;
    var cost = moveCost(b);
    if (!canAfford(cost)) return { ok: false, why: 'Moving it needs ' + short(cost) };
    pay(cost);
    W.footprint(b.def, b.x, b.y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (t && t.bld === b) t.bld = null;
    });
    var felled = 0;
    W.footprint(b.def, x, y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (!t) return;
      if (t.terr === 'forest') { t.terr = 'grass'; t.cleared = true; felled++; }
      t.bld = b;
    });
    if (felled) G.res.wood = Math.min(cap('wood'), G.res.wood + 12 * felled);
    b.x = x; b.y = y;
    b.crop = 0;
    AGENTS.dropJob(b);
    markPathsDirty();
    refreshCounts();
    emit('moved', b);
    return { ok: true };
  }

  function short(cost) {
    return Object.keys(cost).filter(function (k) { return G.res[k] < cost[k]; }).join(' & ');
  }

  function demolish(b) {
    if (b.id === 'castle') return false;
    var i = G.buildings.indexOf(b);
    if (i < 0) return false;
    G.buildings.splice(i, 1);
    markPathsDirty();
    W.footprint(b.def, b.x, b.y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (!t) return;
      if (b.def.isRoad) t.road = false; else if (t.bld === b) t.bld = null;
    });
    // half the timber and stone come back
    var cost = costOf(b.id), refund = {};
    ['wood', 'stone'].forEach(function (k) {
      if (!cost[k]) return;
      var before = G.res[k];
      G.res[k] = Math.min(cap(k), G.res[k] + Math.round(cost[k] * (b.built ? 0.4 : 0.9)));
      refund[k] = G.res[k] - before;
    });
    lastPlaced = { kind: 'demolish', b: b, refund: refund, at: Date.now() };
    AGENTS.dropJob(b);
    refreshCounts();
    emit('demolish', b);
    return true;
  }

  /* ---------------------------------------------------------
     derived numbers
     --------------------------------------------------------- */
  function refreshCounts() {
    var c = {};
    Object.keys(DATA.B).forEach(function (k) { c[k] = 0; });
    G.buildings.forEach(function (b) { if (b.built) c[b.id]++; });
    var mi = 0;
    G.buildings.forEach(function (b) {
      if (b.built && b.id === 'market') b._mIdx = mi++;
    });
    G.count = c;
    // Both caches are keyed on game time, which does not move while paused.
    // Building something must refresh them or the numbers freeze with it.
    _goodsAt = -1e9; _pAt = -1e9;
  }

  function castleBonus() { return DATA.CASTLE[G.castle].bonus || {}; }

  function cap(res) {
    var v = BASE_STORE[res] || 0;
    G.buildings.forEach(function (b) {
      if (b.built && b.def.store && b.def.store[res]) v += b.def.store[res] * lvlMul(b);
    });
    if (res === 'gold' && G.tech.banking) v += 200;
    if (res === 'food' && done('stores')) v += 400;
    return v;
  }

  function housing() {
    var h = 0;
    G.buildings.forEach(function (b) { if (b.built && b.def.housing) h += b.def.housing * lvlMul(b); });
    h += castleBonus().housing || 0;
    return h;
  }

  function armyCap() {
    var v = 8 + (castleBonus().armyCap || 0);
    G.buildings.forEach(function (b) { if (b.built && b.def.armyCap) v += Math.round(b.def.armyCap * lvlMul(b)); });
    return v;
  }
  function armySlots() {
    var n = 0;
    Object.keys(G.army).forEach(function (k) { n += G.army[k] * (DATA.UNITS[k].slots || 1); });
    return n;
  }
  function armyCount() {
    var n = 0;
    Object.keys(G.army).forEach(function (k) { n += G.army[k]; });
    return n;
  }

  /* ---------------------------------------------------------
     how strong a force actually is — one formula, used by the
     odds readout AND by how hard Brannoch hits you
     --------------------------------------------------------- */

  function unitStrength(hp, atk, def) { return (hp * 0.25 + atk * 1.6 + def * 0.8) / 3.1; }

  function rosterStrength(roster, extraDef) {
    var sb = smithBonus(), out = 0;
    Object.keys(roster || {}).forEach(function (k) {
      var u = DATA.UNITS[k];
      if (!u) return;
      out += roster[k] * unitStrength(u.hp, u.atk * sb.atk, u.def + (extraDef || 0));
    });
    return out;
  }
  function fieldStrength(extraDef) { return rosterStrength(G.army, extraDef); }
  function totalStrength() {
    return fieldStrength(0) + (G.campaign ? rosterStrength(G.campaign.army, 0) : 0);
  }

  /* Brannoch sends a war band sized against YOU, not against a number that
     ticks up on its own. A defenceless village gets a scouting party; a
     kingdom with knights gets a real war. Never more than their true
     strength, so beating them down still counts for something. */
  function raidPower() {
    var seasons = seasonIndex();
    var ramp = U.clamp((seasons - graceSeasons()) / 14, 0, 1);
    // scaled against your ARMY only — walls and towers must stay a pure
    // advantage, never a reason for Brannoch to send more men
    var mine = totalStrength();
    var base = 6 + ramp * 26;
    var target = mine * (0.50 + ramp * 0.60) + base;
    return U.clamp(Math.min(G.rival.str, target), 6, G.rival.str);
  }

  function graceLeft() { return Math.max(0, graceSeasons() - seasonIndex()); }

  /* Standing strength should stop a war before it starts. A realm that
     plainly outmatches them is often simply left alone — which is what
     makes soldiers and walls worth paying for even in peacetime. */
  function deterrence() {
    var mine = totalStrength() + defenseScore() * 0.8;
    var theirs = Math.max(1, G.rival.str);
    return mine / theirs;
  }

  /* the reason they are coming, decided from the state of the world */
  function raidCause() {
    var s = season().key;
    // most specific reason first: a generic hungry-winter raid should never
    // mask the fact that they are actually here to conquer you
    if (G.campaign) return 'opportunity';
    if (G.res.gold > 550 && totalStrength() < G.rival.str * 0.7) return 'plunder';
    if (G.rival.str > totalStrength() * 1.7 && seasonIndex() > graceSeasons() + 6) return 'conquest';
    if (G.stats.wins > G.stats.losses && Math.random() < 0.5) return 'revenge';
    if ((s === 'winter' || s === 'autumn') && Math.random() < 0.55) return 'hunger';
    return 'raid';
  }

  /* a home with a well, a market, a chapel or a tavern near its door pays
     more: neighbours matter */
  function homeMul(b) {
    if (typeof FOLK === 'undefined') return 1;
    var sv = FOLK.servicesOf(b), n = (sv.well ? 1 : 0) + (sv.market ? 1 : 0) + (sv.chapel ? 1 : 0) + (sv.tavern ? 1 : 0);
    return 1 + 0.12 * n;
  }
  function perk(id) { return typeof COURT !== 'undefined' && COURT.perk(id); }
  function defenseScore() {
    var d = castleBonus().defense || 0;
    var mul = G.tech.fortification ? 1.6 : 1;
    G.buildings.forEach(function (b) { if (b.built && b.def.defense) d += b.def.defense * mul * lvlMul(b); });
    return Math.round(d * (perk('fortress') ? 1.3 : 1));
  }

  function smithBonus() {
    var atk = 0, def = 0;
    G.buildings.forEach(function (b) {
      if (b.built && b.id === 'smith' && staffRatio(b) > 0.2) { atk += b.def.armyAtk * lvlMul(b); def += b.def.armyDef * lvlMul(b); }
    });
    if (G.tech.iron_weapons) atk += 0.10;
    if (G.tech.siege_forges) { atk += 0.25 * (G.toolCov || 0); def += 0.25 * (G.toolCov || 0); }
    return { atk: 1 + Math.min(atk, 0.6), def: 1 + Math.min(def, 0.5) };
  }

  /* jobs / workforce --------------------------------------
     Nobody is told what to do by hand any more. Every few moments the realm
     works out what it is short of, scores each workplace against that, and
     spreads the villagers over the jobs in proportion to how badly each one
     is needed. Anyone left over becomes a labourer rather than standing idle.
  */

  function raidSoon() {
    return G.rival && G.rival.nextRaid < DATA.SEASON_LEN * 1.5 && seasonIndex() >= graceSeasons();
  }

  /* how badly the realm wants each resource right now */
  function pressures() {
    var net = ledger(), p = {};
    ['food', 'wood', 'stone', 'iron', 'gold', 'tools', 'bread', 'wool', 'cloth'].forEach(function (k) {
      var c = cap(k), ratio = c > 0 ? G.res[k] / c : 0;
      var need = 1;
      if (net[k] < 0) need += 1.5;
      if (ratio < 0.10) need += 1.3;
      else if (ratio < 0.30) need += 0.55;
      else if (ratio > 0.92) need -= 0.75;      // barns are full; go do something else
      p[k] = Math.max(0.12, need);
    });
    // food is judged over the year, with the crop still standing counted in
    var ft = foodTrend(net), stock = G.res.food + standingCrop() * 0.8;
    p.food = 1 + (ft < 0 ? 1.5 : 0);
    var fr = cap('food') > 0 ? stock / cap('food') : 0;
    if (fr < 0.10) p.food += 1.3; else if (fr < 0.30) p.food += 0.55; else if (fr > 0.92) p.food -= 0.75;
    p.food = Math.max(0.12, p.food);
    // starving is not a resource problem, it is an emergency
    if (G.res.food < G.pop * 2) p.food += 2.6;
    else if (stock < G.pop * 5) p.food += 1.1;
    if (ft < 0) p.food += 1.0;
    // bare hands slow every trade in the realm, so a smithy is urgent
    if ((G.toolCov || 0) < 0.5 && G.count.smith > 0) p.tools += 1.6;
    if ((G.breadCov || 0) < 0.6 && G.count.bakery > 0 && G.res.food > G.pop * 4) p.bread += 1.2;
    return p;
  }

  /* score one workplace against those pressures */
  function needScore(b, p) {
    var s = 0.45;
    if (b.def.produces) {
      Object.keys(b.def.produces).forEach(function (k) { s = Math.max(s, p[k] || 1); });
    }
    if (b.def.trade) s = Math.max(s, p.gold);
    if (b.def.research) s = Math.max(s, G.research ? 1.15 : 0.30);
    if (b.def.happy) s = Math.max(s, G.happy < 42 ? 2.6 : G.happy < 62 ? 1.25 : 0.5);
    if (b.def.aura) s = Math.max(s, 1.35);                       // multiplies its neighbours
    if (b.def.store) s = Math.max(s, 0.55);
    if (b.def.armyCap || b.def.defense) s = Math.max(s, raidSoon() ? 1.6 : 0.5);
    if (b.id === 'smith') s = Math.max(s, raidSoon() ? 1.3 : 0.8);
    // don't staff something that eats a resource we have none of
    if (b.def.consumes) {
      Object.keys(b.def.consumes).forEach(function (k) {
        if (G.res[k] !== undefined && G.res[k] < 15) s *= 0.35;
      });
    }
    // a farm on bad ground is a poor use of a pair of hands
    if (b.def.soilBonus) s *= 0.3 + 0.7 * soilMul(b);
    if (b.def.seasonal) s *= (0.55 + foodSeasonMul() * 0.6);      // nobody farms hard in deep winter
    if (b.def.seasonal && harvesting() && b.crop > 1) s *= 1.8;     // everyone to the fields
    return Math.max(0.05, s);
  }

  /* a plain-English label for the UI */
  function priorityLabel(score) {
    return score >= 2.4 ? 'Critical' : score >= 1.5 ? 'High' : score >= 0.8 ? 'Normal' : 'Low';
  }
  /* the UI asks for this once per building per redraw, so memo it briefly */
  var _pCache = null, _pAt = -1e9;
  function pressuresCached() {
    if (_pCache && Math.abs(G.time - _pAt) < 0.3) return _pCache;
    _pCache = pressures(); _pAt = G.time;
    return _pCache;
  }
  function scoreOf(b) {
    if (!b.built || jobsOf(b) === 0 || b.paused) return 0;
    return needScore(b, pressuresCached());
  }

  function assignWorkers(force) {
    var key = G.buildings.length + '|' + Math.floor(G.pop) + '|' + (G.research ? 1 : 0) + '|' + (G.sickN || 0) + '|' + Math.floor(G.kidsOff || 0);
    if (!force && G._workTimer > 0 && G._workKey === key) return;
    G._workTimer = 0.45;
    G._workKey = key;

    // the sick stay abed, and little children do not work (older ones help)
    var avail = Math.max(0, Math.floor(G.pop) - (G.sickN || 0) - Math.floor(G.kidsOff || 0));
    var list = G.buildings.filter(function (b) { return b.built && jobsOf(b) > 0 && !b.paused; });
    G.buildings.forEach(function (b) { b.workers = 0; });
    if (!list.length) { G.idle = avail; G.builders = Math.min(6, Math.max(1, Math.floor(avail * 0.5) + 1)); return; }

    var p = pressures(), total = 0;
    list.forEach(function (b) {
      b._score = needScore(b, p);
      b._weight = b._score * jobsOf(b);
      total += b._weight;
    });

    // share the villagers out in proportion to need
    var left = avail;
    if (total > 0) {
      list.forEach(function (b) {
        var want = Math.floor(avail * b._weight / total);
        var give = Math.min(jobsOf(b), want, left);
        b.workers = give; left -= give;
      });
    }
    // hand out the remainder to whoever wants it most
    var order = list.slice().sort(function (a, b) { return b._score - a._score; });
    var guard = 0;
    while (left > 0 && guard++ < 400) {
      var gave = false;
      for (var i = 0; i < order.length && left > 0; i++) {
        if (order[i].workers < jobsOf(order[i])) { order[i].workers++; left--; gave = true; }
      }
      if (!gave) break;
    }

    G.idle = left;
    G.builders = Math.min(8, Math.max(1, Math.floor(left * 0.6) + 1));
  }

  function jobsOf(b) {
    var j = b.def.jobs || 0;
    if (b.id === 'market' && G.tech.guilds) j += 1;
    return j;
  }
  function staffRatio(b) {
    var j = jobsOf(b);
    if (j === 0) return b.paused ? 0 : 1;
    return b.workers / j;
  }

  /* auras (windmill / sawmill) ---------------------------- */
  function auraFor(b) {
    var mul = 1;
    G.buildings.forEach(function (a) {
      if (!a.built || !a.def.aura || a.paused) return;
      var bonus = a.def.aura[b.id];
      if (!bonus) return;
      if (U.dist(a.x, a.y, b.x, b.y) <= (a.def.radius || 3) + 0.4) mul += bonus * Math.max(0.34, staffRatio(a));
    });
    if (typeof EXPLORE !== 'undefined') mul *= EXPLORE.bonusAt(b);   // an iron seam, a spring
    return mul;
  }

  /* ---------------------------------------------------------
     Tools.
     A worker with tools does far more than one with bare hands.
     Every staffed workplace draws on the tool store; the better
     stocked it is, the bigger the bonus everyone gets. Runs the
     iron chain — mine to smithy to every trade in the realm.
     --------------------------------------------------------- */
  var TOOL_PER_WORKER = 0.0035;   // consumed per second per working pair of hands
  var TOOL_BONUS = 0.25;          // output multiplier at full supply
  var TOOL_BUFFER = 8;            // seconds of stock that counts as "fully supplied"

  function toolDemand() {
    var d = 0;
    G.buildings.forEach(function (b) {
      if (!b.built || b.paused || !b.def.produces) return;
      if (b.id === 'smith') return;                 // the smithy makes them, it does not eat them
      d += b.workers * TOOL_PER_WORKER;
    });
    return d;
  }
  function toolCoverage() {
    var d = toolDemand();
    if (d <= 0) return G.res.tools > 0 ? 1 : 0;
    return U.clamp(G.res.tools / (d * TOOL_BUFFER), 0, 1);
  }

  /* Bread. Baked grain goes further than raw, so a realm eating bread needs
     less food AND is markedly happier. Same supply model as tools. */
  var BREAD_PER_HEAD = 0.0040;
  var BREAD_SAVING = 0.35;     // how much less grain a bread-fed realm eats
  var BREAD_JOY = 12;          // contentment at full supply

  function breadDemand() { return G.pop * BREAD_PER_HEAD; }
  function breadCoverage() {
    var d = breadDemand();
    if (d <= 0) return 0;
    return U.clamp(G.res.bread / (d * 8), 0, 1);
  }

  function techMul(res) {
    var m = 1;
    if (res === 'food' && G.tech.crop_rotation) m += 0.25;
    if ((res === 'food' || res === 'wool') && G.tech.enclosure) m += 0.40;
    if ((res === 'food' || res === 'wool') && G.tech.common_fields) m += 0.15;
    if (res === 'gold' && G.tech.guild_charter) m += 0.30;
    if (res === 'wood' && G.tech.forestry) m += 0.20;
    if (res === 'stone' && G.tech.masonry) m += 0.20;
    if (res === 'iron' && G.tech.deep_mining) m += 0.50;
    if (res === 'gold' && G.tech.trade_charter) m += 0.25;
    if (res === 'gold' && G.tech.guilds) m += 0.15;
    if (res === 'gold' && G.tech.banking) m += 0.25;
    if (res === 'gold' && perk('trade')) m += 0.15;
    if (res === 'food' && perk('granary')) m += 0.15;
    if (res === 'wood' && perk('foresters')) m += 0.25;
    var cb = castleBonus();
    if (res === 'gold' && cb.gold) m += cb.gold;
    if (cb.all) m += cb.all;
    return m;
  }

  function seasonIndex() { return Math.floor(G.time / DATA.SEASON_LEN); }
  function season() { return DATA.SEASONS[seasonIndex() % 4]; }
  function year() { return Math.floor(seasonIndex() / 4) + 1; }
  function seasonProgress() { return (G.time % DATA.SEASON_LEN) / DATA.SEASON_LEN; }
  function nextFestival() {
    var s2 = DATA.SEASONS[(seasonIndex() + 1) % 4];
    return { name: DATA.FESTIVALS[s2.key].title, icon: DATA.FESTIVALS[s2.key].art,
             seasons: 1 - seasonProgress() };
  }
  function fairOn() { return G.fairUntil > G.time; }

  function foodSeasonMul() {
    var s = season();
    if (s.key === 'winter' && G.tech.irrigation) return 0.65;
    return s.food;
  }

  function efficiency() {
    return U.clamp(0.62 + (G.happy / 100) * 0.45, 0.45, 1.12) * zeal() * (done('streets') ? 1.08 : 1) * (diff().work || 1);
  }
  /* settlers' zeal: a new colony works hard. Half again as much at the
     start, fading away over the first four seasons. */
  function zeal() {
    var k = U.clamp(1 - G.time / (DATA.SEASON_LEN * 4), 0, 1);
    return 1 + 0.5 * k;
  }

  /* As autumn begins: will the stores last the winter? Said plainly, with
     what can be done about it. */
  function winterWarning() {
    if (seasonIndex() < 2) return;
    var need = G.pop * 0.055 * (1 - BREAD_SAVING * (G.breadCov || 0)) * DATA.SEASON_LEN * 1.1 + armySlots() * 0.012 * DATA.SEASON_LEN;
    var have = G.res.food + standingCrop() * 0.85;
    // what still comes in through winter: fish, venison, winter gardens
    var winterIn = 0;
    G.buildings.forEach(function (b) {
      if (!b.built || b.def.seasonal) return;
      var o = output(b); if (o.food) winterIn += o.food * 0.8;
    });
    have += winterIn * DATA.SEASON_LEN;
    var short2 = Math.round(need - have);
    if (short2 > 20) emit('toast', { msg: '❄️ Winter will run about ' + short2 + ' food short. Fish and venison still come in winter — or buy grain, or ration the stores (👑).', kind: 'war' });
    else emit('toast', { msg: '❄️ The barns should see you through the winter.', kind: 'good' });
  }

  /* ---------------------------------------------------------
     A battle settled on paper: used for "auto-resolve", and by the
     balance harness. The same arithmetic the war tab shows as odds.
     --------------------------------------------------------- */
  function foeSpec(power, flavour) {
    var spec = {}, budget = power;
    if (flavour === 'bandits') {
      spec.raider = Math.max(3, Math.round(budget / 9));
      spec.warhound = Math.round(budget / 26);
      spec.bowman = Math.round(budget / 30);
    } else {
      spec.raider = Math.max(2, Math.round(budget / 11));
      spec.axeman = Math.round(budget / 18);
      spec.bowman = Math.round(budget / 26);
      if (budget > 70) spec.warhound = Math.round(budget / 42);
      if (budget > 120) spec.champion = Math.max(1, Math.round(budget / 95));
    }
    Object.keys(spec).forEach(function (k) { if (!spec[k]) delete spec[k]; });
    return spec;
  }
  function foeStrengthOf(spec) {
    var s2 = 0;
    Object.keys(spec).forEach(function (k) { var u = DATA.FOE_UNITS[k]; s2 += spec[k] * unitStrength(u.hp, u.atk, u.def); });
    return s2;
  }
  function autoBattle(opts) {
    var mine = fieldStrength(0), spec = foeSpec(opts.power, opts.flavour), theirs = foeStrengthOf(spec);
    var p = mine <= 0 ? 0 : mine * mine / (mine * mine + theirs * theirs);
    var won = Math.random() < p;
    // losses: heavier the closer the fight, heavier still in defeat
    var frac = U.clamp((won ? 0.5 : 0.9) * theirs / Math.max(1, mine + theirs) * (won ? 1 : 1.4), 0.04, 0.85);
    var lost = {}, lostN = 0;
    Object.keys(G.army).forEach(function (k) {
      var n = G.army[k], die = 0;
      for (var i = 0; i < n; i++) if (Math.random() < frac) die++;
      if (die) { lost[k] = die; lostN += die; G.army[k] -= die; if (!G.army[k]) delete G.army[k]; }
    });
    var loot = {};
    if (won) {
      G.stats.wins++;
      loot.gold = Math.round((opts.flavour === 'bandits' ? 90 : 70) + opts.power * 1.6);
      G.res.gold = Math.min(cap('gold'), G.res.gold + loot.gold);
      G.happy = U.clamp(G.happy + 6, 0, 100);
    } else {
      G.stats.losses++;
      G.happy = U.clamp(G.happy - 8, 0, 100);
    }
    checkQuests();
    emit('army');
    return { won: won, odds: Math.round(p * 100), lost: lost, lostN: lostN, loot: loot };
  }
  /* the outlaws' camp in the hills: a fight you can pick whenever you like */
  function banditPower() { return 26 + G.stats.wins * 9 + seasonIndex() * 0.8; }
  function banditReady() { return G.time - (G.banditAt === undefined ? -1e9 : G.banditAt) >= DATA.SEASON_LEN; }

  /* ---------------------------------------------------------
     the world pushing back, quietly: tired soil, dry summers, storm-torn
     roofs, cold winters, thin fish and deer. Each one either looks after
     itself or turns into a plain choice.
     --------------------------------------------------------- */
  // fields tire with every harvest and rest a little every season
  function tired(b) { var s = b.soil === undefined ? 1 : b.soil; return 0.55 + 0.45 * s; }
  function harvestSoil() {
    G.buildings.forEach(function (b) {
      if (!b.def.seasonal || !b.built) return;
      if (b.soil === undefined) b.soil = 1;
      b.soil = Math.max(0, b.soil - (G.tech.crop_rotation ? 0.035 : 0.08));
    });
  }
  function restSoil() {
    G.buildings.forEach(function (b) {
      if (!b.def.seasonal || b.soil === undefined) return;
      b.soil = Math.min(1, b.soil + (b.fallowUntil > G.time ? 0.3 : 0.025));
    });
  }
  function fallow(b) {
    if (!b.def.seasonal) return { ok: false, why: 'Only fields can lie fallow' };
    b.fallowUntil = G.time + DATA.SEASON_LEN * 3; b.crop = 0;
    return { ok: true };
  }
  // a dry summer: no rain, thin crops — unless there is water to hand
  function droughtMul(b) {
    if (!G.drought || season().key !== 'summer') return 1;
    if (G.tech.irrigation) return 0.95;
    return wellsNear(b, 3) ? 0.9 : 0.72;
  }
  // storm damage, mended by the builders with timber
  function wear(b) { return 1 - (b.damage || 0) * 0.6; }
  function stormDamage() {
    var roofs = G.buildings.filter(function (b) { return b.built && fireRisk(b) > 0 && b.id !== 'castle' && !b.damage; });
    var n = Math.min(roofs.length, 1 + Math.floor(Math.random() * 3)), hit = [];
    for (var i = 0; i < n; i++) { var b = roofs.splice(Math.floor(Math.random() * roofs.length), 1)[0]; b.damage = 0.5 + Math.random() * 0.3; hit.push(b.def.name.toLowerCase()); }
    if (hit.length) emit('toast', { msg: '⛈️ The storm tore at the thatch: ' + hit.join(', ') + ' damaged. The builders will mend them with timber.', kind: 'war' });
  }
  function mendRoofs(dt) {
    G.buildings.forEach(function (b) {
      if (!b.damage) return;
      if (G.res.wood < 0.3 * dt) return;
      G.res.wood -= 0.3 * dt;
      b.damage = Math.max(0, b.damage - dt * 0.02);
      if (!b.damage) delete b.damage;
    });
  }
  // skill: a trade learned over years (the register knows who has been where)
  function skill(b) { return typeof FOLK !== 'undefined' && FOLK.skillMul ? FOLK.skillMul(b) : 1; }
  // fish and deer: stocks that thin if worked too hard, and come back
  function stockMul(b) {
    var st = G.stocks || { fish: 1, deer: 1 };
    if (b.id === 'fishery') return 0.45 + 0.55 * st.fish;
    if (b.id === 'hunter') return 0.4 + 0.6 * st.deer;
    return 1;
  }
  function tickStocks(dt) {
    if (!G.stocks) G.stocks = { fish: 1, deer: 1 };
    var st = G.stocks, fishers = 0, hunters = 0;
    G.buildings.forEach(function (b) { if (b.built && !b.paused) { if (b.id === 'fishery') fishers += staffRatio(b); if (b.id === 'hunter') hunters += staffRatio(b); } });
    st.fish = U.clamp(st.fish - fishers * 0.00045 * dt + (1 - st.fish) * 0.006 * dt, 0.05, 1);
    st.deer = U.clamp(st.deer - hunters * 0.0009 * dt + (1 - st.deer) * 0.005 * dt, 0.05, 1);
  }
  // woodcutters really do fell the woods around them; the woods grow back
  function tickFelling(dt) {
    G._fellT = (G._fellT || 0) - dt;
    if (G._fellT > 0) return;
    G._fellT = 12;
    G.buildings.forEach(function (b) {
      if (b.id !== 'lumber' || !b.built || b.paused || staffRatio(b) < 0.5) return;
      if (Math.random() > (G.tech.forestry ? 0.12 : 0.25)) return;   // forestry replants as it goes
      var best = null;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        var t = W.at(b.x + dx, b.y + dy);
        if (t && t.terr === 'forest' && !t.bld && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) { best = t; break; }
      }
      if (best) { best.terr = 'grass'; best.cleared = true; best._trees = null; emit('felled', { t: best, gain: 0, quiet: true }); }
    });
  }
  // winter: every hearth burns wood. Without it, the town is cold.
  var FIREWOOD = 0.022;   // wood a second, per hearth, through the winter
  function hearths() {
    var n = 0;
    G.buildings.forEach(function (b) { if (b.built && b.def.housing && b.id !== 'castle') n += FIREWOOD * lvlMul(b); });
    return n;
  }
  function firewoodNeed() { return season().key === 'winter' ? hearths() : 0; }
  function cold() { return season().key === 'winter' && G.res.wood < 1; }
  // a varied table: grain, fish, meat, bread
  function diet() {
    var d = 0;
    if (G.count.farm) d++;
    if (G.count.fishery) d++;
    if (G.count.hunter) d++;
    if ((G.breadCov || 0) > 0.2) d++;
    return d;
  }
  // taxes and the church's tithe, set by the ruler
  function taxMul() { return G.tax === 'low' ? 0.6 : G.tax === 'high' ? 1.5 : 1; }

  /* ---------------------------------------------------------
     great works: paid for as they go up
     --------------------------------------------------------- */
  function done(id) { return !!(G.works && G.works[id] === true); }
  function workProgress(id) { var w = G.works && G.works[id]; return w === true ? 1 : (w || 0); }
  function workAvailable(id) { var p = DATA.PROJECTS[id]; return (G.chapter || 0) >= p.need - 1 || G.castle >= 1; }
  function startWork(id) {
    if (!G.works) G.works = {};
    if (done(id)) return { ok: false, why: 'Already finished' };
    if (!workAvailable(id)) return { ok: false, why: 'Not yet — later in your reign' };
    G.workNow = id;
    if (!G.works[id]) G.works[id] = 0.0001;
    return { ok: true };
  }
  var WORK_LEN = DATA.SEASON_LEN * 1.1;
  function tickWorks(dt) {
    var id = G.workNow;
    if (!id || done(id)) { G.workNow = null; return; }
    var p = DATA.PROJECTS[id], step = dt / WORK_LEN, short2 = null;
    for (var k in p.cost) if (G.res[k] < p.cost[k] * step) short2 = k;
    G.workWaiting = short2;
    if (short2) return;
    for (var k2 in p.cost) G.res[k2] -= p.cost[k2] * step;
    G.works[id] += step;
    if (G.works[id] >= 1) {
      G.works[id] = true; G.workNow = null;
      if (id === 'gardens') G.blessing = (G.blessing || 0) + 8;
      if (id === 'monument') G.blessing = (G.blessing || 0) + 6;
      G.stats.works = (G.stats.works || 0) + 1;
      emit('work-done', id);
    }
  }

  /* production of one building, per second */
  /* ---------------------------------------------------------
     The harvest. A farm's kitchen garden feeds the town a little through
     the growing months, but most of its yield stands in the fields until
     autumn, when it is brought in over the first part of the season. Store
     it well: nothing grows in winter, and a crop left standing when the
     snow comes is lost.
     --------------------------------------------------------- */
  var GARDEN = 0.35, CROP_RATE = 1.08, HARVEST_LEN = 0.45;
  function gardenMul() {
    var k = season().key;
    if (k === 'winter') return G.tech.irrigation ? 0.4 : 0;
    return season().food;
  }
  function growMul() {
    var k = season().key;
    return (k === 'spring' ? 1.0 : k === 'summer' ? 1.3 : 0) * rainMul() * (G.tech.irrigation ? 1.25 : 1);
  }
  /* what a farm would yield per second at this moment, before the season */
  function farmPotential(b) {
    if (!b.built || b.paused || b.fire) return 0;
    var ratio = staffRatio(b);
    if (ratio <= 0) return 0;
    var toolBoost = 1 + TOOL_BONUS * (G.toolCov || 0);
    if (G.tech.iron_ploughs) toolBoost += 0.25 * (G.toolCov || 0);
    if (b.fallowUntil > G.time) return 0;
    return b.def.produces.food * efficiency() * ratio * auraFor(b) * lvlMul(b) * toolBoost *
      techMul('food') * soilMul(b) * shiftMul() * tired(b) * droughtMul(b) * wear(b) * skill(b);
  }
  function cropRate(b) { return farmPotential(b) * CROP_RATE * growMul(); }
  function harvesting() { return season().key === 'autumn' && seasonProgress() < HARVEST_LEN + 0.02; }
  function harvestRate(b) {
    if (!harvesting() || !(b.crop > 0) || !b.built || b.fire) return 0;
    var full = (b.cropStart || b.crop) / (HARVEST_LEN * DATA.SEASON_LEN);
    // hands bring it in faster; even an unstaffed farm's family gets some in
    return full * Math.max(0.3, staffRatio(b));
  }
  function standingCrop() {
    var n = 0;
    G.buildings.forEach(function (b) { if (b.def.seasonal) n += b.crop || 0; });
    return n;
  }
  function tickHarvest(dt) {
    G.buildings.forEach(function (b) {
      if (!b.def.seasonal || !b.built) return;
      var h = harvestRate(b);
      if (h > 0) b.crop = Math.max(0, b.crop - h * dt);
      else if (!harvesting()) b.crop = (b.crop || 0) + cropRate(b) * dt;
    });
  }

  function shiftMul() { return G.shiftUntil > G.time ? 1.3 : 1; }

  /* A farm's yield averaged over the whole year, per second. */
  function farmYearly(b) { return farmPotential(b) * (GARDEN * 3.4 + CROP_RATE * 2.3) / 4; }
  /* Food balance judged over the year rather than this very second: the
     harvest's share is spread evenly instead of arriving in autumn. Anything
     that decides whether the realm is short of food should use this, or
     every spring looks like a famine and every autumn like a glut. */
  function foodTrend(net) {
    net = net || ledger();
    var f = net.food;
    G.buildings.forEach(function (b) {
      if (!b.def.seasonal || !b.built) return;
      var o = output(b);
      f += farmYearly(b) - (o.food || 0) - harvestRate(b);
    });
    return f;
  }

  function output(b) {
    var out = {};
    if (!b.built || b.paused || b.fire) return out;
    var ratio = staffRatio(b);
    if (ratio <= 0 && jobsOf(b) > 0) return out;
    var toolBoost = (b.id === 'smith') ? 1 : 1 + TOOL_BONUS * (G.toolCov || 0);
    if (G.tech.iron_ploughs && (b.def.seasonal || b.def.seasonalWool)) toolBoost += 0.25 * (G.toolCov || 0);
    var eff = efficiency() * ratio * auraFor(b) * lvlMul(b) * toolBoost * shiftMul() * wear(b) * skill(b) * stockMul(b);
    if (b.def.produces) {
      Object.keys(b.def.produces).forEach(function (k) {
        var v = b.def.produces[k] * eff * techMul(k);
        if (b.def.seasonal && k === 'food') v *= GARDEN * gardenMul();
        if (b.def.seasonalWool) v *= (0.55 + season().food * 0.45);
        if (b.def.scaleNear) {
          var n = W.nearCount(b.x, b.y, b.def.scaleNear.terrain, 1);
          v *= U.clamp(n / b.def.scaleNear.div, 0.34, 2.0);
        }
        if (b.def.soilBonus) v *= soilMul(b);
        out[k] = (out[k] || 0) + v;
      });
    }
    if (b.def.trade) {
      // retail from the people, plus a cut of the realm's goods
      // the town's shoppers are shared between its markets
      var g = (b.def.trade * G.pop * (b.id === 'market' ? Math.pow(0.6, b._mIdx || 0) : 1) + 0.20) * eff * techMul('gold');
      // only markets take a cut of the realm's goods; a tavern's trade is its own
      if (b.id === 'market') {
        g += goodsValue() * marketCut(b._mIdx || 0) * eff * techMul('gold') * lvlMul(b);
      }
      out.gold = (out.gold || 0) + g;
    }
    if (b.def.consumes) {
      Object.keys(b.def.consumes).forEach(function (k) {
        out[k] = (out[k] || 0) - b.def.consumes[k] * ratio * lvlMul(b);
      });
    }
    return out;
  }

  /* full per-second ledger, used by the HUD and the tick */
  function ledger() {
    var net = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0, tools: 0, bread: 0, wool: 0, cloth: 0 };
    G.buildings.forEach(function (b) {
      var o = output(b);
      Object.keys(o).forEach(function (k) { net[k] += o[k]; });
      if (b.built && b.def.upkeep) net.gold -= b.def.upkeep;
      if (b.def.seasonal) net.food += harvestRate(b);
    });
    // villagers with no post left to fill turn their hands to foraging and
    // hauling — far less than a proper job, but never nothing
    var spare = G.idle || 0;
    if (spare > 0) {
      var eff = efficiency();
      net.food += spare * 0.020 * eff * foodSeasonMul();
      net.wood += spare * 0.010 * eff;
    }
    var fine = 0;
    G.buildings.forEach(function (b) {
      if (!b.built || !b.def.evolves) return;
      var tier = DATA.HOUSE_TIERS[(b.level || 1) - 1];
      if (tier && tier.tax) net.gold += tier.tax * techMul('gold') * homeMul(b) * taxMul() * (G.tithe ? 0.9 : 1);
      if ((b.level || 1) >= 3) fine++;
    });
    if (fine) net.cloth -= fine * DATA.CLOTH_PER_FINE_HOUSE;
    net.tools -= toolDemand() * (G.toolCov || 0);
    net.bread -= breadDemand() * (G.breadCov || 0);
    net.food -= G.pop * 0.055 * (1 - BREAD_SAVING * (G.breadCov || 0)) * (G.rationUntil > G.time ? 0.65 : 1);
    net.food -= armySlots() * 0.012 * (perk('fortress') ? 0.5 : 1);
    net.wood -= firewoodNeed();
    // with the woodpile low, anyone without a trade goes out for deadwood
    if (firewoodNeed() && G.res.wood < hearths() * DATA.SEASON_LEN) net.wood += Math.min(firewoodNeed() * 0.8, (G.idle || 0) * 0.03);
    // and with no woodcutters and the woodpile bare, they gather enough for
    // one: otherwise a realm that spent its timber first could never cut more
    else if (!G.count.lumber && G.res.wood < 25) net.wood += Math.min(0.2, (G.idle || 0) * 0.03);
    if (season().key === 'winter') net.food -= (G.count.pasture || 0) * 0.015;   // hay for the flocks
    net.food -= campaignSlots() * PROVISION_PER_SLOT;
    net.gold -= armySlots() * 0.014;
    if (season().key === 'winter') {
      var spoil = (G.count.granary > 0 ? 0.03 : 0.06) * (done('stores') ? 0.5 : 1);
      net.food -= G.res.food * spoil * 0.01;
    }
    return net;
  }

  /* amenity-driven contentment target */
  function happyTarget() {
    var capacity = 0;
    G.buildings.forEach(function (b) {
      if (!b.built || !b.def.happy) return;
      if (jobsOf(b) > 0 && staffRatio(b) < 0.5) return;
      capacity += b.def.happy * 6 * lvlMul(b);
    });
    // enough is enough: a town awash with taverns is no happier than one with
    // room for all (up to 1.35 once: two wells kept a village of 30 at the
    // ceiling, and the ceiling made every other choice free)
    var coverage = G.pop > 0 ? U.clamp(capacity / G.pop, 0, 1) : 1;
    var t = 34 + coverage * 46;
    if (G.tech.sanitation) t += 8;
    t += G.blessing || 0;
    if (G.rationUntil > G.time) t -= 12;
    t += diff().joy || 0;
    if (cold()) t -= 14;
    t += Math.max(0, diet() - 1) * 2;
    if (G.tax === 'low') t += 6; else if (G.tax === 'high') t -= 10;
    if (G.tithe) t += 4;
    // a bigger town expects more of its lord: crowds, noise, prices
    t -= U.clamp((G.pop - 45) * 0.15, 0, 22);
    // and the better off a household is, the harder it is to please
    var hs = 0, hn = 0;
    G.buildings.forEach(function (b) { if (b.built && b.def.evolves) { hs += (b.level || 1) - 1; hn++; } });
    if (hn) t -= hs / hn * 4;
    t += BREAD_JOY * (G.breadCov || 0);
    if (G.tech.enclosure) t -= 10;
    if (G.tech.common_fields) t += 8;
    if (G.tech.guild_charter) t -= 6;
    if (G.tech.free_trade) t += 5;
    if (G.res.food > G.pop * 10) t += 8;
    else if (G.res.food <= 0) t -= 34;
    else if (G.res.food < G.pop * 2) t -= 12;
    if (G.pop > housing()) t -= 18;
    if (G.idle > G.pop * 0.5 && G.pop > 14) t -= 4;   // too many with no real trade
    if (season().key === 'winter') t -= 4;
    t += (G.stats.wins - G.stats.losses) * 2;
    return U.clamp(t, 0, 100);
  }

  /* ---------------------------------------------------------
     the tick
     --------------------------------------------------------- */
  function tick(dt) {
    if (!G) return;
    var prevSeason = seasonIndex();
    G.time += dt;

    ensurePaths();
    G._workTimer = (G._workTimer || 0) - dt;
    assignWorkers();

    // construction
    G.buildings.forEach(function (b) {
      if (b.built) { b.t += dt; return; }
      var speed = (1 + G.builders * 0.35) / Math.max(1, b.def.build) * (perk('masons') ? 1.3 : 1);
      var dp = speed * dt;
      if (b.def.wonderCost) {
        // each slice of progress must be paid for as it is laid
        var wc = b.def.wonderCost, short2 = null;
        Object.keys(wc).forEach(function (k) { if (!short2 && G.res[k] < wc[k] * dp) short2 = k; });
        b.waiting = short2;
        if (short2) return;
        Object.keys(wc).forEach(function (k) { G.res[k] -= wc[k] * dp; });
      }
      b.prog += dp;
      if (b.prog >= 1) {
        b.prog = 1; b.built = true;
        refreshCounts();
        U.sfx.build();
        emit('completed', b);
      }
    });

    G.toolCov = toolCoverage();
    G.breadCov = breadCoverage();
    if (!G.seen) G.seen = { gold: 1, food: 1, wood: 1, stone: 1 };
    DATA.RES.forEach(function (r) { if (G.res[r.key] > 0) G.seen[r.key] = 1; });

    // economy
    var net = ledger();
    Object.keys(net).forEach(function (k) {
      G.res[k] = U.clamp(G.res[k] + net[k] * dt, 0, cap(k));
    });

    // contentment drifts toward its target
    var ht = happyTarget();
    G.happy += U.clamp(ht - G.happy, -1, 1) * 0.55 * dt;
    G.happy = U.clamp(G.happy, 0, 100);

    // population
    var h = housing();
    if (G.res.food <= 0.5 && G.pop > 1) {
      G.pop -= 0.045 * dt; G._lossWhy = 'starve';
      if (!G._starveWarned || G.time - G._starveWarned > 20) {
        G._starveWarned = G.time;
        emit('toast', { msg: 'Your people are starving — build farms!', kind: 'bad' });
      }
    } else if (G.pop < h && G.happy > 22 && G.res.food > G.pop * 1.5) {
      // People only have children while the barns can actually feed them.
      // Without this the village breeds itself straight into a famine every
      // time housing outruns the harvest.
      // an unhappy town still grows, just slowly: no cliff edge at any one number
      var rate = 0.09 * season().growth * U.clamp((G.happy - 22) / 48, 0.05, 1.4) * U.clamp((h - G.pop) / 6, 0.15, 1);
      G.pop = Math.min(h, G.pop + rate * dt);
    } else if (G.happy < 18 && G.pop > 2) {
      G.pop -= 0.02 * dt; G._lossWhy = 'leave';   // people drift away
    }

    // research
    if (G.research) {
      var rate = 0.34 * (done('academy') ? 1.4 : 1) * (perk('scholars') ? 1.3 : 1);
      G.buildings.forEach(function (b) {
        if (b.built && b.def.research) rate += b.def.research * staffRatio(b) * lvlMul(b);
      });
      G.research.prog += rate * dt;
      if (G.research.prog >= DATA.TECH[G.research.id].time) {
        var id = G.research.id;
        G.tech[id] = true; G.research = null; G.stats.techDone++;
        U.sfx.quest();
        emit('tech', id);
        emit('toast', { msg: 'Research complete: ' + DATA.TECH[id].name, kind: 'good' });
      }
    }

    // the rival
    var ahead = U.clamp(totalStrength() / Math.max(1, G.rival.str) - 1.5, 0, 2);
    G.rival.str += dt * (0.010 + G.time / 140000) * diff().rival * (1 + ahead * 0.5);
    if (!G.war) G.rival.nextRaid -= dt;
    if (!G.rival.warned && !atPeace() && G.rival.nextRaid <= DATA.SEASON_LEN * 0.85 && seasonIndex() >= graceSeasons() - 1) {
      G.rival.warned = true;
      emit('toast', { msg: 'Scouts: Brannoch is mustering. Roughly a season before they ride.', kind: 'war' });
    }
    if (G.rival.nextRaid <= 0) {
      G.rival.warned = false;
      // raids come further apart while you are still finding your feet
      var gap = seasonIndex() < graceSeasons() + 8 ? (4.5 + Math.random() * 2.2) : (2.8 + Math.random() * 1.8);
      G.rival.nextRaid = DATA.SEASON_LEN * gap * diff().gap;
      if (seasonIndex() < graceSeasons()) {
        G.rival.nextRaid = DATA.SEASON_LEN * 2;   // still at peace — try again later
      } else if (atPeace()) {
        // the treaty holds; only the Sea Wolves still come
        G.rival.nextRaid = DATA.SEASON_LEN * (2.5 + Math.random() * 2);
        if (seasonIndex() >= 12 && Math.random() < 0.45 && !(typeof EXPLORE !== 'undefined' && EXPLORE.wolvesQuiet())) emit('raid-incoming', { cause: 'wolves', faction: 'wolves' });
      } else if (deterrence() > 1.45 && Math.random() < U.clamp((deterrence() - 1.45) * 0.55, 0, 0.88)) {
        // they looked, and thought better of it
        G.rival.nextRaid = DATA.SEASON_LEN * (2 + Math.random() * 2.5);
        emit('toast', { msg: 'Brannoch\'s scouts turned back at the border — Ashveil looks too strong to bother.', kind: 'good' });
      } else if (seasonIndex() >= 12 && Math.random() < 0.35 && !(typeof EXPLORE !== 'undefined' && EXPLORE.wolvesQuiet())) {
        emit('raid-incoming', { cause: 'wolves', faction: 'wolves' });
      } else if (dip().att > 0 && Math.random() < dip().att / 110) {
        G.rival.nextRaid = DATA.SEASON_LEN * (2 + Math.random() * 2);
        emit('toast', { msg: 'Brannoch\'s council argued down a raid. Your goodwill is paying off.', kind: 'good' });
      } else {
        emit('raid-incoming', { cause: raidCause() });
      }
    }

    if (typeof WAR !== 'undefined') WAR.tick(dt);
    tickPlans(dt);
    tickStocks(dt);
    tickFelling(dt);
    mendRoofs(dt);
    tickWorks(dt);
    if (typeof FOLK !== 'undefined') FOLK.tick(dt);
    if (typeof EXPLORE !== 'undefined') EXPLORE.tick(dt);
    if (typeof HONOURS !== 'undefined') HONOURS.tick(dt);
    if (typeof STEWARD !== 'undefined') STEWARD.tick(dt);
    if (typeof COURT !== 'undefined') COURT.tick(dt);
    tickWeather(dt);
    tickHarvest(dt);
    tickFire(dt);
    tickMarket(dt);
    tickFinds(dt);
    tickShip(dt);
    if (G.shiftUntil > 0 && G.shiftUntil <= G.time) {
      G.shiftUntil = -1;
      G.happy = U.clamp(G.happy - 10, 0, 100);
      emit('toast', { msg: 'The double shifts are over. Everyone is exhausted.', kind: 'war' });
    }
    regrow(dt);
    checkRelief(dt);
    tickCampaign(dt);
    evolveHousing(dt);

    // random events
    G.eventTimer -= dt;
    if (G.eventTimer <= 0) {
      G.eventTimer = DATA.SEASON_LEN * (1.5 + Math.random() * 1.6);
      emit('event');
    }

    if (seasonIndex() !== prevSeason) {
      U.sfx.season();
      emit('season', season());
      dipSeason();
      restSoil();
      // one summer in seven or so is a dry one
      G.drought = season().key === 'summer' && seasonIndex() > 4 && Math.random() < 0.15;
      if (G.drought) emit('toast', { msg: '☀️ A dry summer: no rain is coming. Fields near a well hold up; the rest will be thin. (Irrigation would help.)', kind: 'war' });
      if (season().key === 'autumn' && seasonIndex() > 2) {
        var needW = Math.round(hearths() * DATA.SEASON_LEN);
        if (G.res.wood < needW * 1.2) emit('toast', { msg: '🪵 Winter hearths will burn about ' + needW + ' wood. Lay some by, or the town will be cold.', kind: 'war' });
      }
      if (season().key === 'autumn') {
        winterWarning();
        var any = 0;
        G.buildings.forEach(function (b) { if (b.def.seasonal && b.built) { b.cropStart = b.crop || 0; any += b.crop || 0; } });
        harvestSoil();
        if (any > 1) emit('harvest', Math.round(any));
      }
      if (season().key === 'winter') {
        var lost = 0;
        G.buildings.forEach(function (b) { if (b.def.seasonal) { lost += b.crop || 0; b.crop = 0; } });
        if (lost > 8) emit('toast', { msg: Math.round(lost) + ' food was never brought in and rotted in the snow. More farmhands next autumn.', kind: 'bad' });
      }
      // the season's occasion, once a year, every year
      var key = season().key, yr = year();
      if (!G.festivals) G.festivals = {};
      if (G.festivals[key] !== yr && seasonIndex() > 0) {
        G.festivals[key] = yr;
        emit('festival', key);
      }
    }

    checkQuests();
  }

  /* ---------------------------------------------------------
     weather: rain comes and goes, most often in spring and autumn,
     and waters the fields while it lasts
     --------------------------------------------------------- */
  var RAIN_CHANCE = { spring: 0.40, summer: 0.18, autumn: 0.45, winter: 0 };
  function tickWeather(dt) {
    if (G.weatherTimer === undefined) { G.weatherTimer = 30; G.weather = 'clear'; }
    G.weatherTimer -= dt;
    if (season().key === 'winter' && G.weather === 'rain') G.weather = 'clear';
    if (G.weatherTimer > 0) return;
    var wet = Math.random() < RAIN_CHANCE[season().key];
    if (wet && G.weather !== 'rain') emit('weather', 'rain');
    G.weather = wet ? 'rain' : 'clear';
    // now and then a summer or autumn rain comes in as a storm: wind, lightning
    G.storm = wet && (season().key === 'summer' || season().key === 'autumn') && Math.random() < 0.3;
    if (G.drought && season().key === 'summer') { G.weather = 'clear'; G.storm = false; }
    if (G.storm && seasonIndex() > 3) stormDamage();
    G.weatherTimer = wet ? 14 + Math.random() * 16 : 24 + Math.random() * 30;
  }
  function rainMul() { return G.weather === 'rain' ? 1.12 : 1; }

  /* ---------------------------------------------------------
     Fire. Thatch, ovens and forges catch; stone does not. A fire spreads
     to its neighbours if it is left, and burns the building down in about
     half a minute. Villagers fight it with buckets — slowly on their own,
     quickly with a well close by, and fastest when the ruler calls out a
     bucket brigade. Rain helps. Nothing burns in your first few seasons.
     --------------------------------------------------------- */
  var FIRE_GRACE = 5;
  function fireRisk(b) {
    var r = DATA.FIRE_RISK[b.id];
    if (Array.isArray(r)) r = r[Math.min(r.length - 1, b.id === 'castle' ? G.castle : (b.level || 1) - 1)];
    return r || 0;
  }
  function centre(b) { return { x: b.x + (b.def.w || 1) / 2, y: b.y + (b.def.h || 1) / 2 }; }
  function wellsNear(b, rad) {
    var c = centre(b), n = 0;
    G.buildings.forEach(function (w) {
      if (w.built && w.id === 'well') { var d = centre(w); if (U.dist(c.x, c.y, d.x, d.y) <= rad) n++; }
    });
    return n;
  }
  function ignite(b) {
    if (b.fire || !b.built) return;
    b.fire = { hp: 1, dmg: 0, brigade: 0, spread: 7 };
    emit('fire', b);
  }
  function burning() { return G.buildings.filter(function (b) { return !!b.fire; }); }
  function rallyBrigade(b) {
    if (!b || !b.fire) return { ok: false, why: 'Nothing is burning there' };
    b.fire.brigade = 10;
    return { ok: true };
  }
  function tickFire(dt) {
    G.fireTimer = (G.fireTimer || 5) - dt;
    if (G.fireTimer <= 0) {
      G.fireTimer = 5;
      if (seasonIndex() >= FIRE_GRACE && G.weather !== 'rain') {
        var sk = season().key, sm = sk === 'winter' ? 1.5 : sk === 'summer' ? 1.3 : 1;
        G.buildings.forEach(function (b) {
          if (!b.built || b.fire) return;
          var risk = fireRisk(b) * (perk('foresters') ? 0.7 : 1);
          if (!risk) return;
          var p = 0.00042 * risk * sm * (wellsNear(b, 4) ? 0.4 : 1) * diff().fire * (G.fireCalm > G.time ? 0.3 : 1);
          if (Math.random() < p) ignite(b);
        });
      }
    }
    burning().forEach(function (b) {
      var f = b.fire;
      f.dmg += dt / 34;
      f.brigade = Math.max(0, f.brigade - dt);
      var douse = 0.028 + 0.05 * Math.min(2, wellsNear(b, 5)) + (f.brigade > 0 ? 0.14 : 0) + (G.weather === 'rain' ? 0.1 : 0);
      f.hp -= douse * dt;
      if (f.hp <= 0) {
        b.fire = null;
        G.stats.firesOut = (G.stats.firesOut || 0) + 1;
        emit('fire-out', b);
        return;
      }
      if (f.dmg >= 1) { burnDown(b); return; }
      f.spread -= dt;
      if (f.spread <= 0) {
        f.spread = 6;
        if (f.dmg > 0.25) {
          var c = centre(b);
          var near = G.buildings.filter(function (o) {
            if (o === b || !o.built || o.fire || !fireRisk(o)) return false;
            var d = centre(o);
            return U.dist(c.x, c.y, d.x, d.y) <= 1.2 + ((b.def.w || 1) + (o.def.w || 1)) / 2;
          });
          // a town that has just lost a building is wetting its thatch; and
          // no more than three blazes at once — neighbours beat the rest out
          var spreadP = 0.3 * (G.fireCalm > G.time ? 0.4 : 1);
          if (near.length && burning().length < 3 && Math.random() < spreadP) ignite(near[Math.floor(Math.random() * near.length)]);
        }
      }
    });
  }
  function burnDown(b) {
    b.fire = null;
    var i = G.buildings.indexOf(b);
    if (i < 0 || b.id === 'castle') { if (b.id === 'castle') G.res.gold = Math.max(0, G.res.gold - 60); return; }
    G.buildings.splice(i, 1);
    markPathsDirty();
    W.footprint(b.def, b.x, b.y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (t && t.bld === b) t.bld = null;
    });
    AGENTS.dropJob(b);
    G.stats.burned = (G.stats.burned || 0) + 1;
    G.fireCalm = G.time + DATA.SEASON_LEN * 1.5;   // everyone is careful with candles for a while
    // once a roof has fallen the whole street turns out: the blazes it had
    // spread to get buckets for a few seconds, so one fire rarely takes a quarter
    var c0 = centre(b);
    burning().forEach(function (o) { var c1 = centre(o); if (U.dist(c0.x, c0.y, c1.x, c1.y) <= 5) o.fire.brigade = Math.max(o.fire.brigade, 5); });
    G.happy = U.clamp(G.happy - 6, 0, 100);
    refreshCounts();
    emit('burned', b);
  }

  /* ---------------------------------------------------------
     Prices that answer back. Sell a lot of one thing and it fetches
     less for a while; buy a lot and it costs more. Both drift home.
     --------------------------------------------------------- */
  function mktOf(res) { if (!G.mkt) G.mkt = {}; return G.mkt[res] || 1; }
  function tickMarket(dt) {
    if (!G.mkt) G.mkt = {};
    Object.keys(G.mkt).forEach(function (k) {
      G.mkt[k] += (1 - G.mkt[k]) * Math.min(1, dt * 0.012);
      if (Math.abs(G.mkt[k] - 1) < 0.005) delete G.mkt[k];
    });
  }

  /* ---------------------------------------------------------
     Royal decrees: things you can simply order, each with a wait.
     --------------------------------------------------------- */
  function decreeReady(id) {
    var at = (G.decrees || {})[id] || 0;
    return Math.max(0, at - G.time);
  }
  function decreeCost(id) {
    var d = DATA.DECREES[id], out = {};
    if (d.cost) Object.keys(d.cost).forEach(function (k) { out[k] = d.cost[k]; });
    if (d.costPerPop) Object.keys(d.costPerPop).forEach(function (k) { out[k] = Math.round(d.costPerPop[k] * Math.max(6, G.pop)); });
    return out;
  }
  function decree(id) {
    var d = DATA.DECREES[id];
    if (!d) return { ok: false, why: 'No such decree' };
    if (decreeReady(id) > 0) return { ok: false, why: 'Not yet — the people remember the last one' };
    var cost = decreeCost(id);
    if (!canAfford(cost)) return { ok: false, why: 'Not enough ' + short(cost) };
    if (id === 'settlers' && housing() - G.pop < 6) return { ok: false, why: 'There are no empty homes for them' };
    if (id === 'shifts' && G.shiftUntil > G.time) return { ok: false, why: 'The shifts are already doubled' };
    pay(cost);
    if (id === 'feast') G.happy = U.clamp(G.happy + 15, 0, 100);
    if (id === 'shifts') G.shiftUntil = G.time + DATA.SEASON_LEN * 0.5;
    if (id === 'ration') G.rationUntil = G.time + DATA.SEASON_LEN;
    if (id === 'levy') { var coin = Math.round(5 * G.pop); G.res.gold = Math.min(cap('gold'), G.res.gold + coin); G.happy = U.clamp(G.happy - 10, 0, 100); cost = { coin: coin }; }
    if (id === 'settlers') { G.pop = Math.min(housing(), G.pop + 6); G._gainWhy = 'settlers'; }
    if (!G.decrees) G.decrees = {};
    G.decrees[id] = G.time + d.cooldown * DATA.SEASON_LEN;
    emit('decree', { id: id, cost: cost });
    emit('change');
    return { ok: true };
  }

  /* ---------------------------------------------------------
     Things washed up. Now and then the sea leaves driftwood or a wreck
     on the beach for whoever walks down to look.
     --------------------------------------------------------- */
  function beachTiles() {
    return W.tiles.filter(function (t) {
      return (t.terr === 'sand' || t.terr === 'grass') && !t.bld && W.nearCount(t.x, t.y, ['water', 'shore'], 1) >= 2;
    });
  }
  function tickFinds(dt) {
    if (!G.finds) G.finds = [];
    G.findTimer = (G.findTimer === undefined ? 40 : G.findTimer) - dt;
    if (G.findTimer > 0) return;
    G.findTimer = DATA.SEASON_LEN * (0.7 + Math.random() * 0.8);
    if (G.finds.length >= 2) return;
    var spots = beachTiles();
    // wash up where someone would see it
    if (typeof EXPLORE !== 'undefined') { var vis = spots.filter(function (t) { return EXPLORE.seen(t.x, t.y); }); if (vis.length) spots = vis; }
    if (!spots.length) return;
    var t = spots[Math.floor(Math.random() * spots.length)];
    var kind = Math.random() < 0.72 ? 'drift' : 'wreck';
    G.finds.push({ kind: kind, x: t.x + 0.3 + Math.random() * 0.4, y: t.y + 0.3 + Math.random() * 0.4, at: G.time });
    emit('find', kind);
  }
  function collectFind(i) {
    var f = G.finds && G.finds[i];
    if (!f) return null;
    G.finds.splice(i, 1);
    var got = {};
    if (f.kind === 'drift') { got.wood = 18 + Math.floor(Math.random() * 26); if (Math.random() < 0.3) got.food = 15 + Math.floor(Math.random() * 20); }
    else {
      var r = Math.random();
      if (r < 0.5) got.gold = 50 + Math.floor(Math.random() * 60);
      else if (r < 0.8) { got.iron = 15 + Math.floor(Math.random() * 20); got.wood = 20; }
      else { got.cloth = 10 + Math.floor(Math.random() * 12); got.gold = 30; }
    }
    Object.keys(got).forEach(function (k) { G.res[k] = Math.min(cap(k), G.res[k] + got[k]); if (got[k] > 0) G.seen[k] = 1; });
    G.stats.finds = (G.stats.finds || 0) + 1;
    emit('change');
    return { kind: f.kind, got: got, x: f.x, y: f.y };
  }

  /* ---------------------------------------------------------
     Merchant ships. Once you have a market, a trading cog calls every
     couple of years, anchors off your coast for a season, and offers
     better terms than the market square — for what you lack, and for
     what you have too much of.
     --------------------------------------------------------- */
  function seaSpots() {
    return W.tiles.filter(function (t) {
      return t.terr === 'water' && W.nearCount(t.x, t.y, ['shore'], 1) > 0 && W.nearCount(t.x, t.y, ['sand', 'grass', 'meadow', 'forest'], 2) > 0;
    });
  }
  function shipOffers() {
    var goods = ['food', 'wood', 'stone', 'iron', 'tools', 'wool', 'cloth', 'bread'];
    var ratio = function (k) { return G.res[k] / Math.max(1, cap(k)); };
    var lack = goods.filter(function (k) { return k !== 'bread' && k !== 'cloth' && k !== 'wool'; })
      .sort(function (a, b) { return ratio(a) - ratio(b); })[0];
    var glut = goods.slice().sort(function (a, b) { return ratio(b) - ratio(a); })[0];
    var offers = [];
    var n1 = 60;
    offers.push({ kind: 'sell', res: lack, amount: n1, price: Math.round(DATA.TRADE[lack].base * n1 * 1.05) });
    if (glut !== lack && G.res[glut] >= 40) {
      var n2 = Math.min(80, Math.floor(G.res[glut] / 10) * 10);
      offers.push({ kind: 'buy', res: glut, amount: n2, price: Math.round(DATA.TRADE[glut].base * n2 * 1.3) });
    }
    var rare = Math.random();
    if (rare < 0.4) offers.push({ kind: 'relic', label: 'A saint\'s relic for the chapel', price: 160, happy: 10 });
    else if (rare < 0.75) offers.push({ kind: 'sell', res: 'cloth', amount: 20, price: Math.round(DATA.TRADE.cloth.base * 20 * 1.0) });
    else offers.push({ kind: 'sell', res: 'tools', amount: 30, price: Math.round(DATA.TRADE.tools.base * 30 * 1.0) });
    return offers;
  }
  function tickShip(dt) {
    G.shipTimer = (G.shipTimer === undefined ? 120 : G.shipTimer) - dt;
    var s2 = G.ship;
    if (!s2) {
      if (G.shipTimer > 0 || !(G.count.market > 0)) return;
      var spots = seaSpots();
      if (!spots.length) { G.shipTimer = 60; return; }
      var t = spots[Math.floor(Math.random() * spots.length)];
      var from = Math.random() < 0.5 ? { x: -3, y: t.y } : { x: t.x, y: -3 };
      G.ship = { x: from.x, y: from.y, tx: t.x + 0.5, ty: t.y + 0.5, phase: 'in', left: DATA.SEASON_LEN * 1.1, offers: shipOffers(), face: 1 };
      return;
    }
    var dx = s2.tx - s2.x, dy = s2.ty - s2.y, d = Math.hypot(dx, dy);
    if (d > 0.05) {
      var sp = Math.min(d, 0.9 * dt);
      s2.x += dx / d * sp; s2.y += dy / d * sp;
      s2.face = (dx - dy) >= 0 ? 1 : -1;
    } else if (s2.phase === 'in') {
      s2.phase = 'anchored';
      emit('ship');
    } else if (s2.phase === 'out') {
      G.ship = null;
      G.shipTimer = DATA.SEASON_LEN * (2.2 + Math.random() * 1.5) * (done('harbour') ? 0.5 : 1);
      return;
    }
    if (s2.phase === 'anchored') {
      s2.left -= dt;
      if (s2.left <= 0 || !s2.offers.length) shipLeaves();
    }
  }
  function shipLeaves() {
    if (!G.ship) return;
    G.ship.phase = 'out';
    G.ship.tx = G.ship.x < W.COLS / 2 ? -4 : W.COLS + 4;
    G.ship.ty = G.ship.y;
  }
  function takeOffer(i) {
    var s2 = G.ship, o = s2 && s2.offers[i];
    if (!o) return { ok: false, why: 'That offer is gone' };
    if (o.kind === 'sell') {
      if (G.res.gold < o.price) return { ok: false, why: 'Not enough gold' };
      G.res.gold -= o.price;
      G.res[o.res] = Math.min(cap(o.res), G.res[o.res] + o.amount);
      G.seen[o.res] = 1;
    } else if (o.kind === 'buy') {
      if (G.res[o.res] < o.amount) return { ok: false, why: 'You no longer have ' + o.amount + ' ' + o.res };
      G.res[o.res] -= o.amount;
      G.res.gold = Math.min(cap('gold'), G.res.gold + o.price);
    } else {
      if (G.res.gold < o.price) return { ok: false, why: 'Not enough gold' };
      G.res.gold -= o.price;
      G.happy = U.clamp(G.happy + o.happy, 0, 100);
    }
    s2.offers.splice(i, 1);
    G.stats.traded = (G.stats.traded || 0) + 1;
    U.sfx.coin();
    emit('change');
    return { ok: true, offer: o };
  }

  /* ---------------------------------------------------------
     woodland: always fellable, and it grows back
     --------------------------------------------------------- */
  function canFell(t) { return !!t && t.terr === 'forest' && !t.bld; }
  /* now and then, clearing woodland turns up something someone buried */
  function rootTreasure(x, y) {
    if (Math.random() > 0.07) return;
    var g = 30 + Math.floor(Math.random() * 50);
    G.res.gold = Math.min(cap('gold'), G.res.gold + g);
    emit('treasure', { x: x, y: y, gain: g });
  }
  function fell(t) {
    if (!canFell(t)) return { ok: false, why: 'Nothing to fell here' };
    t.terr = 'grass'; t.cleared = true;
    var gain = (DATA.TERRAIN.forest.clearGain || { wood: 12 }).wood;
    G.res.wood = Math.min(cap('wood'), G.res.wood + gain);
    emit('felled', { t: t, gain: gain });
    rootTreasure(t.x, t.y);
    checkQuests();
    return { ok: true, gain: gain };
  }

  /* cleared ground beside standing woodland slowly turns back to forest,
     so timber is renewable and you can never strip the island for good */
  function regrow(dt) {
    G.growTimer -= dt;
    if (G.growTimer > 0) return;
    G.growTimer = 3.0;
    var tiles = W.tiles, forestN = 0;
    for (var f = 0; f < tiles.length; f++) if (tiles[f].terr === 'forest') forestN++;
    for (var i = 0; i < 40; i++) {
      var t = tiles[Math.floor(Math.random() * tiles.length)];
      if (!t || t.bld) continue;
      if (t.terr !== 'grass' && t.terr !== 'meadow') continue;
      var near = W.nearCount(t.x, t.y, ['forest'], 1);
      if (near > 0) {
        // spreads outward from standing woodland — the more trees around a
        // patch, the faster it takes. One neighbour is enough, so a single
        // surviving tree can reseed the whole island given time.
        if (Math.random() < Math.min(0.30, 0.07 * near)) { t.terr = 'forest'; t.cleared = true; }
      } else if (forestN < 6) {
        // stripped bare: seedlings blow in, so timber is never gone for good
        if (Math.random() < 0.04) { t.terr = 'forest'; t.cleared = true; }
      }
    }
  }

  /* ---------------------------------------------------------
     trade — sell surplus, buy what you lack. Needs a market.
     --------------------------------------------------------- */
  function tradeSpread() {
    var s2 = 0.62, b2 = 1.62;
    if (G.tech.trade_charter) { s2 += 0.06; b2 -= 0.10; }
    if (G.tech.guilds)        { s2 += 0.06; b2 -= 0.10; }
    if (G.tech.banking)       { s2 += 0.08; b2 -= 0.12; }
    if (G.tech.free_trade)    { s2 += 0.20; b2 -= 0.15; }
    if (G.fairUntil > G.time) { s2 += 0.25; b2 -= 0.20; }
    if (typeof EXPLORE !== 'undefined') { s2 += EXPLORE.tradeBonus(); b2 -= EXPLORE.tradeBonus(); }
    var lvl = 0;
    G.buildings.forEach(function (b) { if (b.built && b.id === 'market') lvl += lvlMul(b); });
    s2 += Math.min(0.10, lvl * 0.02);
    b2 -= Math.min(0.14, lvl * 0.03);
    return { sell: s2, buy: Math.max(1.05, b2) };
  }
  function canTrade() { return (G.count.market || 0) > 0; }
  function priceOf(res) {
    var t = DATA.TRADE[res];
    if (!t) return null;
    var sp = tradeSpread(), m = mktOf(res);
    return {
      sell: Math.max(1, Math.round(t.base * sp.sell * m * DATA.TRADE_LOT)),
      buy: Math.max(2, Math.round(t.base * sp.buy * m * DATA.TRADE_LOT)),
      trend: m
    };
  }
  function sell(res, lots) {
    lots = lots || 1;
    if (!canTrade()) return { ok: false, why: 'You need a market to trade' };
    var amount = DATA.TRADE_LOT * lots;
    if (G.res[res] < amount) return { ok: false, why: 'Not enough ' + res + ' to sell' };
    var gain = priceOf(res).sell * lots;
    if (G.res.gold + gain > cap('gold') + 1) {
      return { ok: false, why: 'Your treasury is full — spend some gold first' };
    }
    G.res[res] -= amount;
    G.res.gold = Math.min(cap('gold'), G.res.gold + gain);
    G.mkt[res] = Math.max(0.55, mktOf(res) * Math.pow(0.93, lots));
    G.stats.traded = (G.stats.traded || 0) + 1;
    U.sfx.coin();
    emit('change');
    return { ok: true, gain: gain, amount: amount };
  }
  function buy(res, lots) {
    lots = lots || 1;
    if (!canTrade()) return { ok: false, why: 'You need a market to trade' };
    var price = priceOf(res).buy * lots;
    if (G.res.gold < price) return { ok: false, why: 'Not enough gold' };
    var amount = DATA.TRADE_LOT * lots;
    if (G.res[res] + amount > cap(res) + 1) {
      return { ok: false, why: 'No room to store more ' + res + ' — build a warehouse' };
    }
    G.res.gold -= price;
    G.res[res] = Math.min(cap(res), G.res[res] + amount);
    G.mkt[res] = Math.min(1.6, mktOf(res) * Math.pow(1.06, lots));
    G.stats.traded = (G.stats.traded || 0) + 1;
    U.sfx.coin();
    emit('change');
    return { ok: true, cost: price, amount: amount };
  }

  /* ---------------------------------------------------------
     last-resort relief: you should never be able to get stuck
     --------------------------------------------------------- */
  function destitute() {
    // timber and stone are no use to a realm that has no market to sell them
    // at and no coin to build one: on Harsh that could last four years
    var noSale = !canTrade() && seasonIndex() >= 6;
    if (G.res.gold >= 40 || (!noSale && (G.res.wood >= 20 || G.res.stone >= 20))) return false;
    var net = ledger();
    if (noSale) return net.gold <= 0.1;
    // broke, with nothing coming in but the castle's thin trickle of tax
    return net.gold <= 0.35 && net.wood <= 0.02 && net.stone <= 0.02;
  }
  function checkRelief(dt) {
    if (G.reliefCooldown > 0) G.reliefCooldown -= dt;
    G.reliefTimer -= dt;
    if (G.reliefTimer > 0) return;
    G.reliefTimer = 20;
    if (G.reliefCooldown > 0) return;
    if (!destitute()) return;
    G.reliefCooldown = DATA.SEASON_LEN * 2.5;
    emit('relief');
  }

  /* ---------------------------------------------------------
     Homes that better themselves.
     A cottage becomes a townhouse, and then a fine house, when the realm
     can keep it that way — contentment, bread on the table, cloth in
     store. Let those slip and the house slips back with them. Nothing is
     bought: this is what the economy is FOR.
     --------------------------------------------------------- */
  /* What a home could climb to from nothing. */
  function houseTierEarned() {
    var lvl = 1;
    for (var i = 1; i < DATA.HOUSE_TIERS.length; i++) {
      var t = DATA.HOUSE_TIERS[i];
      if (G.happy < t.happy) break;
      if ((G.breadCov || 0) < t.bread) break;
      if (t.cloth > 0 && G.res.cloth < t.cloth) break;
      lvl = i + 1;
    }
    return lvl;
  }
  /* Where a home at `cur` should be, allowing for hysteresis: it climbs on
     the rise bar and only slips through the lower fall bar. */
  function houseTierFor(cur) {
    var earned = houseTierEarned();
    if (earned > cur) return cur + 1;                 // one step at a time
    if (earned === cur) return cur;
    var t = DATA.HOUSE_TIERS[cur - 1];                // the bar it must drop through
    if (!t) return cur;
    var slipped = G.happy < t.fallHappy ||
                  (G.breadCov || 0) < t.fallBread ||
                  (t.fallCloth > 0 && G.res.cloth < t.fallCloth);
    return slipped ? cur - 1 : cur;
  }
  function countHouseTier(lvl) {
    var n = 0;
    G.buildings.forEach(function (b) {
      if (b.built && b.def.evolves && (b.level || 1) >= lvl) n++;
    });
    return n;
  }
  function evolveHousing(dt) {
    G.evolveTimer = (G.evolveTimer || 0) - dt;
    if (G.evolveTimer > 0) return;
    G.evolveTimer = 4;
    var changed = false;
    G.buildings.forEach(function (b) {
      if (!b.built || !b.def.evolves) return;
      var cur = b.level || 1, want = houseTierFor(cur);
      if (want > cur) { b.level = want; changed = true; emit('evolved', b); }
      else if (want < cur) { b.level = want; changed = true; }
    });
    if (changed) { refreshCounts(); emit('change'); }
  }

  /* ---------------------------------------------------------
     Campaigns.
     Marching on Brannoch is no longer instant. The army leaves, takes a
     season to reach the border, fights, and takes a season to come home.
     While it is away your walls are all that stand between Brannoch and
     your granaries — which is the decision the war was missing.
     --------------------------------------------------------- */
  var MARCH_SEASONS = 1.0;
  var PROVISION_PER_SLOT = 0.020;    // food eaten per second on the march

  function campaignSlots() {
    if (!G.campaign) return 0;
    var n = 0;
    Object.keys(G.campaign.army).forEach(function (k) {
      n += G.campaign.army[k] * (DATA.UNITS[k].slots || 1);
    });
    return n;
  }
  function awayCount() {
    if (!G.campaign) return 0;
    var n = 0;
    Object.keys(G.campaign.army).forEach(function (k) { n += G.campaign.army[k]; });
    return n;
  }

  function launchCampaign(opts) {
    if (G.campaign) return { ok: false, why: 'Your army is already in the field' };
    if (armyCount() < 3) return { ok: false, why: 'You need at least 3 soldiers to march' };
    if (!opts.flavour) breakPeace();
    G.campaign = {
      phase: 'out', timeLeft: DATA.SEASON_LEN * MARCH_SEASONS,
      army: G.army, vets: G.vets || {},
      power: opts.power, name: opts.name || 'Brannoch', flavour: opts.flavour || null
    };
    G.army = {}; G.vets = {};
    emit('army');
    emit('toast', { msg: 'Your army marches for ' + G.campaign.name + '. Home is held by your walls alone.', kind: 'war' });
    return { ok: true };
  }

  /* diplomacy -------------------------------------------
     Brannoch's lord has a temper you learn over time. Their attitude runs
     from −100 (sworn enemy) to 100 (kin). Gifts and envoys warm it; beating
     them cools it — unless they are the kind who respect strength. Warm
     enough and they will sign a trade pact (no more raids from Brannoch,
     a trickle of trade gold); keep the peace and a marriage makes them
     allies for good. The Sea Wolves answer to nobody. */
  var PERSONAS = {
    greedy: { name: 'Greedy', gift: 1.6, beaten: -12, desc: 'Lord Harric counts coin before honour. Gifts go a long way with him.' },
    proud:  { name: 'Proud',  gift: 0.6, beaten: -26, desc: 'Lord Harric never forgets a defeat, and takes gifts as no more than his due.' },
    wary:   { name: 'Wary',   gift: 1.0, beaten: 6,   desc: 'Lord Harric respects strength. Every beating makes him readier to talk.' }
  };
  var DIP = { gift: 80, envoy: 20, pact: 150, ally: 400, pactAtt: 25, allyAtt: 60, allySeasons: 4 };
  function dip() {
    if (!G.dip) {
      var keys = Object.keys(PERSONAS);
      G.dip = { att: -20, pers: keys[Math.floor(U.mulberry((G.seed || 1) + 77)() * keys.length)], known: false,
                pact: -1, ally: false, giftAt: -1e9, envoyAt: -1e9 };
    }
    return G.dip;
  }
  function persona() { return PERSONAS[dip().pers] || PERSONAS.wary; }
  function atPeace() { var d = dip(); return d.ally || d.pact >= 0; }
  function dipShift(n) { var d = dip(); d.att = U.clamp(d.att + n, -100, 100); }
  function dipMood() {
    var a = dip().att;
    return a <= -50 ? { name: 'Hostile', col: '#e0795f' } : a < 0 ? { name: 'Cold', col: '#e0795f' }
         : a < DIP.pactAtt ? { name: 'Wary', col: '#e0b23c' } : a < DIP.allyAtt ? { name: 'Friendly', col: '#8fd06a' }
         : { name: 'Warm', col: '#8fd06a' };
  }
  function dipReady(kind) {
    var d = dip(), at = kind === 'gift' ? d.giftAt : d.envoyAt;
    return G.time - at >= DATA.SEASON_LEN;
  }
  function dipAct(kind) {
    var d = dip(), p = persona();
    if (G.campaign && kind !== 'break') return { ok: false, why: 'Not while your army is marching on them' };
    if (kind === 'gift' || kind === 'envoy') {
      if (!dipReady(kind)) return { ok: false, why: 'Wait a season before sending another' };
      var c = kind === 'gift' ? DIP.gift : DIP.envoy;
      if (G.res.gold < c) return { ok: false, why: 'Not enough gold' };
      G.res.gold -= c;
      if (kind === 'gift') {
        d.giftAt = G.time; var gain = Math.round(12 * p.gift);
        dipShift(gain);
        G.rival.nextRaid += DATA.SEASON_LEN * 0.5;
        return { ok: true, msg: 'Brannoch accepts the gift. (+' + gain + ' goodwill)' };
      }
      d.envoyAt = G.time; d.known = true; dipShift(3);
      return { ok: true, msg: 'Your envoy returns: ' + p.desc };
    }
    if (kind === 'pact') {
      if (d.pact >= 0 || d.ally) return { ok: false, why: 'You already have a pact' };
      if (d.att < DIP.pactAtt) return { ok: false, why: 'They are not friendly enough yet' };
      if (G.res.gold < DIP.pact) return { ok: false, why: 'Not enough gold' };
      G.res.gold -= DIP.pact; d.pact = G.time; dipShift(8);
      G.stats.pacts = (G.stats.pacts || 0) + 1;
      return { ok: true, msg: 'The pact is sealed. Brannoch\'s raiders stay home, and their merchants come instead.' };
    }
    if (kind === 'ally') {
      if (d.ally) return { ok: false, why: 'You are already allies' };
      if (d.pact < 0 || G.time - d.pact < DATA.SEASON_LEN * DIP.allySeasons) return { ok: false, why: 'Keep the pact for ' + DIP.allySeasons + ' seasons first' };
      if (d.att < DIP.allyAtt) return { ok: false, why: 'They are not warm enough yet' };
      if (G.res.gold < DIP.ally) return { ok: false, why: 'Not enough gold' };
      G.res.gold -= DIP.ally; d.ally = true; dipShift(15);
      G.happy = U.clamp(G.happy + 10, 0, 100);
      return { ok: true, msg: 'Bells ring on both shores: a royal wedding binds Ashveil and Brannoch.' };
    }
    return { ok: false, why: '?' };
  }
  /* marching on a partner tears up whatever was agreed */
  function breakPeace() {
    var d = dip();
    if (!atPeace()) return false;
    d.pact = -1; d.ally = false; dipShift(-60);
    G.happy = U.clamp(G.happy - 6, 0, 100);
    emit('toast', { msg: 'You broke faith with Brannoch. They will not trust you again soon.', kind: 'bad' });
    return true;
  }
  /* how a battle against Brannoch changes their mind */
  function dipBattle(won, full) {
    var p = persona();
    if (won) dipShift(full ? p.beaten : Math.round(p.beaten / 2));
    else dipShift(5);
  }
  /* each new season: trade under the pact, tribute, and the slow drift */
  function dipSeason() {
    var d = dip(), notes = [];
    if (d.ally || d.pact >= 0) {
      var trade = d.ally ? 40 : 18;
      G.res.gold = Math.min(cap('gold'), G.res.gold + trade);
      dipShift(d.ally ? 1 : 2);
      notes.push('+' + trade + ' gold in trade with Brannoch');
    } else {
      var base = G.tribute && G.tribute.left > 0 ? -35 : -20;
      if (d.att > base) dipShift(-Math.min(3, d.att - base));
      else if (d.att < base) dipShift(Math.min(2, base - d.att));
    }
    if (G.tribute && G.tribute.left > 0) {
      G.res.gold = Math.min(cap('gold'), G.res.gold + G.tribute.amt);
      G.tribute.left--;
      notes.push('Brannoch\'s tribute: +' + G.tribute.amt + ' gold' + (G.tribute.left ? ' (' + G.tribute.left + ' more)' : ' — the last of it'));
      if (!G.tribute.left) G.tribute = null;
    }
    if (notes.length) emit('toast', { msg: notes.join(' · '), kind: 'good' });
  }

  /* ---------------------------------------------------------
     plans: a building marked out on the ground that the builders start
     the moment the stores can pay for it
     --------------------------------------------------------- */
  function plans() { if (!G.plans) G.plans = []; return G.plans; }
  function planAt(x, y) {
    var ps = (G && G.plans) || [];
    for (var i = 0; i < ps.length; i++) {
      var d = DATA.B[ps[i].id];
      if (x >= ps[i].x && y >= ps[i].y && x < ps[i].x + (d.w || 1) && y < ps[i].y + (d.h || 1)) return ps[i];
    }
    return null;
  }
  function planBuild(id, x, y, by) {
    if (!unlocked(id)) return { ok: false, why: lockReason(id) || 'Not yet available' };
    var def = DATA.B[id];
    if (def.max && countAll(id) + plans().filter(function (p) { return p.id === id; }).length >= def.max) return { ok: false, why: 'You already have ' + def.max };
    var chk = W.canPlace(id, x, y);
    if (!chk.ok) return chk;
    if (plans().length >= 12) return { ok: false, why: 'Twelve plans are waiting already' };
    var p = { id: id, x: x, y: y, t: G.time, by: by || 'you' };
    plans().push(p);
    emit('planned', p);
    return { ok: true, plan: p };
  }
  function cancelPlan(p) {
    var i = plans().indexOf(p);
    if (i >= 0) plans().splice(i, 1);
  }
  var planTimer = 0;
  function tickPlans(dt) {
    planTimer -= dt;
    if (planTimer > 0 || !G.plans || !G.plans.length) return;
    planTimer = 0.8;
    // first come, first served: a later, cheaper plan never jumps the queue
    var p = G.plans[0];
    G.plans.shift();
    var chk = W.canPlace(p.id, p.x, p.y);
    if (!chk.ok) { emit('toast', { msg: 'A planned ' + DATA.B[p.id].name.toLowerCase() + ' was dropped: ' + chk.why.toLowerCase() + '.', kind: 'war' }); return; }
    if (!canAfford(costOf(p.id))) { G.plans.unshift(p); return; }
    var r = place(p.id, p.x, p.y);
    if (r.ok) { r.b.fromPlan = true; emit('plan-built', { plan: p, b: r.b }); }
  }

  /* the battle is over — the survivors turn for home */
  function campaignResolved(survivors) {
    if (!G.campaign) return;
    G.campaign.army = survivors || {};
    G.campaign.vets = G.vets || {};
    G.campaign.phase = 'back';
    G.campaign.timeLeft = DATA.SEASON_LEN * MARCH_SEASONS;
    if (!awayCount()) { G.campaign = null; emit('army'); }
  }

  function bringArmyHome() {
    if (!G.campaign) return;
    var back = G.campaign.army || {};
    Object.keys(back).forEach(function (k) { G.army[k] = (G.army[k] || 0) + back[k]; });
    var v = G.campaign.vets || {};
    Object.keys(v).forEach(function (k) { G.vets[k] = Math.min(G.army[k] || 0, (G.vets[k] || 0) + v[k]); });
    G.campaign = null;
    emit('army');
    emit('toast', { msg: 'Your army is home.', kind: 'good' });
  }

  function tickCampaign(dt) {
    if (!G.campaign) return;
    if (G.campaign.phase === 'battle') return;      // waiting on the field
    G.campaign.timeLeft -= dt;
    if (G.campaign.timeLeft > 0) return;
    if (G.campaign.phase === 'out') {
      G.campaign.phase = 'battle';
      emit('campaign-arrived');
    } else {
      bringArmyHome();
    }
  }

  /* ---------------------------------------------------------
     castle / research / army
     --------------------------------------------------------- */
  function nextCastle() { return DATA.CASTLE[G.castle + 1] || null; }
  function upgradeCastle() {
    var n = nextCastle();
    if (!n) return { ok: false, why: 'Already at the greatest tier' };
    if (!canAfford(n.cost)) return { ok: false, why: 'Not enough ' + short(n.cost) };
    pay(n.cost);
    G.castle++;
    U.sfx.quest();
    emit('toast', { msg: 'The castle rises: ' + DATA.CASTLE[G.castle].name, kind: 'good' });
    emit('castle');
    return { ok: true };
  }

  function techAvailable(id) {
    var t = DATA.TECH[id];
    if (G.tech[id]) return false;
    if (t.excludes && G.tech[t.excludes]) return false;   // you chose the other road
    if (t.req.some(function (r) { return !G.tech[r]; })) return false;
    if (t.lib && G.count.library < t.lib) return false;
    return true;
  }
  function techClosed(id) {
    var t = DATA.TECH[id];
    return !!(t && t.excludes && G.tech[t.excludes]);
  }
  function startResearch(id) {
    if (G.research) return { ok: false, why: 'Already studying ' + DATA.TECH[G.research.id].name };
    if (!techAvailable(id)) return { ok: false, why: 'Requirements not met' };
    var t = DATA.TECH[id];
    if (!canAfford(t.cost)) return { ok: false, why: 'Not enough ' + short(t.cost) };
    pay(t.cost);
    G.research = { id: id, prog: 0 };
    emit('research');
    return { ok: true };
  }

  function unitAvailable(key) {
    var u = DATA.UNITS[key];
    if (u.tech && !G.tech[u.tech]) return false;
    if (u.need && !G.count[u.need]) return false;
    return true;
  }
  function recruit(key, n) {
    n = n || 1;
    var u = DATA.UNITS[key];
    if (!unitAvailable(key)) return { ok: false, why: 'Not available yet' };
    var made = 0;
    for (var i = 0; i < n; i++) {
      if (armySlots() + (u.slots || 1) > armyCap()) break;
      if (!canAfford(u.cost)) break;
      if (G.pop < 2) break;
      pay(u.cost);
      G.army[key] = (G.army[key] || 0) + 1;
      G.pop = Math.max(1, G.pop - 1); G._lossWhy = 'soldier';
      if (typeof FOLK !== 'undefined') FOLK.tick(0);
      made++;
    }
    if (made) { U.sfx.place(); emit('army'); return { ok: true, made: made }; }
    var why = armySlots() + (u.slots || 1) > armyCap() ? 'No troop capacity — build a barracks'
            : G.pop < 2 ? 'No villagers to muster' : 'Not enough ' + short(u.cost);
    return { ok: false, why: why };
  }
  function disband(key) {
    if (!G.army[key]) return;
    G.army[key]--;
    if (!G.army[key]) delete G.army[key];
    G.pop += 1; G._gainWhy = 'veteran';
    if (typeof FOLK !== 'undefined') FOLK.tick(0);
    emit('army');
  }

  /* ---------------------------------------------------------
     objectives
     --------------------------------------------------------- */
  function goalProgress(q) {
    var n = q.need, have = 0, need = 1;
    if (n.pop) { have = Math.floor(G.pop); need = n.pop; }
    else if (n.army) { have = armyCount() + awayCount(); need = n.army; }
    else if (n.castle) { have = G.castle; need = n.castle; }
    else if (n.tech) { have = G.stats.techDone; need = n.tech; }
    else if (n.wins) { have = G.stats.wins; need = n.wins; }
    else if (n.houseTier) { have = countHouseTier(n.houseTier.lvl); need = n.houseTier.n; }
    else if (n.bld) {
      var k = Object.keys(n.bld)[0];
      have = G.count[k] || 0; need = n.bld[k];
      if (DATA.B[k] && DATA.B[k].wonder) {
        // show how far the work has got, not just whether it is done
        G.buildings.forEach(function (b) { if (b.id === k && !b.built) have = Math.max(have, b.prog * 0.999); });
      }
    }
    return { have: Math.min(have, need), need: need, done: have >= need };
  }
  function questMet(q) { return goalProgress(q).done; }
  function chapter() { return DATA.CHAPTERS[Math.min(G.chapter || 0, DATA.CHAPTERS.length - 1)]; }
  function giveReward(r) {
    Object.keys(r || {}).forEach(function (k) { G.res[k] = Math.min(cap(k), G.res[k] + r[k]); });
  }
  /* Goals of the current chapter are checked; when every one is done the
     chapter closes, pays out, and the next opens — whose goals may well be
     met already, so this loops until nothing more changes. */
  function checkQuests() {
    if (!G || G.won) return;
    var guard = 0;
    while (guard++ < 8) {
      var ch = chapter(), changed = false;
      ch.goals.forEach(function (q) {
        if (G.quests[q.id] || !questMet(q)) return;
        G.quests[q.id] = true;
        giveReward(q.reward);
        U.sfx.quest();
        emit('toast', { msg: '✓ ' + q.label, kind: 'good' });
        emit('quest', q);
        changed = true;
      });
      var allDone = ch.goals.every(function (q) { return G.quests[q.id]; });
      if (!allDone) return;
      giveReward(ch.reward);
      var idx = G.chapter || 0;
      emit('chapter', { idx: idx, ch: ch });
      if (idx >= DATA.CHAPTERS.length - 1) { G.won = true; emit('victory'); return; }
      G.chapter = idx + 1;
      if (!changed && guard > 6) return;
    }
  }
  function activeQuests() {
    return chapter().goals.filter(function (q) { return !G.quests[q.id]; });
  }

  /* apply an event choice */
  function applyEffects(e) {
    Object.keys(e).forEach(function (k) {
      if (k === 'pop') G.pop = Math.max(1, G.pop + e.pop);
      else if (k === 'happy') G.happy = U.clamp(G.happy + e.happy, 0, 100);
      else if (k === 'rival') G.rival.str = Math.max(8, G.rival.str + e.rival);
      else if (k === 'research') { if (G.research) G.research.prog += e.research; }
      else if (G.res[k] !== undefined) G.res[k] = U.clamp(G.res[k] + e[k], 0, cap(k));
    });
    checkQuests();
    emit('change');
  }

  /* ---------------------------------------------------------
     What needs attention.
     On a phone you cannot see the whole realm at once, so the realm
     tells you what is wrong instead. Severity 2 is urgent, 1 wants
     seeing to, 0 is worth knowing.
     --------------------------------------------------------- */
  var _issCache = null, _issAt = -1e9;
  function issues() {
    if (_issCache && Math.abs(G.time - _issAt) < 0.5) return _issCache;
    var out = [], net = ledger();

    burning().forEach(function (b) {
      out.push({ sev: 2, ic: '🔥', text: b.def.name + ' is on fire!', b: b,
        hint: 'Tap it and call the bucket brigade' + (wellsNear(b, 5) ? '' : ' — there is no well nearby') });
    });
    if (typeof FOLK !== 'undefined' && G.sickN) {
      var sh = FOLK.sickHomes();
      out.push({ sev: sh.length > 2 ? 2 : 1, ic: '🤒', text: 'Fever: ' + G.sickN + ' ill in ' + sh.length + ' home' + (sh.length > 1 ? 's' : ''),
        b: sh.length ? sh[0].b : null, hint: 'Tap the house with the yellow cloth and send for the physician. Wells stop it spreading' });
    }
    if (G.ship && G.ship.phase === 'anchored' && G.ship.offers.length) {
      out.push({ sev: 0, ic: '⛵', text: 'A merchant ship is at anchor', hint: 'Tap the ship to see what they offer', ship: true });
    }
    if (G.res.food <= 0.5 && G.pop > 1) {
      out.push({ sev: 2, ic: '💀', text: 'Your people are starving', hint: 'Anything that makes food, now' });
    } else if (foodTrend(net) < -0.01) {
      var seasons = (G.res.food + standingCrop() * 0.8) / (-foodTrend(net)) / DATA.SEASON_LEN;
      out.push({ sev: seasons < 1.5 ? 2 : 1, ic: '🌾',
        text: 'Food is falling — about ' + seasons.toFixed(1) + ' seasons left',
        hint: 'Build farms, or a fishing hut by the water' });
    }
    if (cold()) out.push({ sev: 2, ic: '🥶', text: 'No firewood — the town is freezing', hint: 'Timber, now: a lumber camp, felling woodland, or buying wood at market' });
    G.buildings.forEach(function (b) {
      if (b.def.seasonal && b.built && b.soil !== undefined && b.soil < 0.35 && !(b.fallowUntil > G.time))
        out.push({ sev: 0, ic: '🌱', text: 'A field is worn out', b: b, hint: 'Tap it and let it lie fallow for a while — or research Crop Rotation' });
    });
    ['gold', 'wood', 'stone'].forEach(function (k) {
      if (G.res[k] >= cap(k) * 0.98 && G.time > DATA.SEASON_LEN * 3)
        out.push({ sev: 0, ic: '📦', text: 'Your ' + k + ' store is full — anything more is wasted',
          hint: k === 'gold' ? 'Spend it: a great work (The Realm → Castle), soldiers, or a warehouse' : 'Build with it, sell it at market, or add a warehouse' });
    });
    if (G.pop >= housing() - 0.01) {
      out.push({ sev: 1, ic: '🏠', text: 'No room to grow — every bed is full', hint: 'Raise more cottages' });
    }
    if (G.happy < 30) {
      out.push({ sev: G.happy < 18 ? 2 : 1, ic: '😠', text: 'The people are miserable (' + Math.round(G.happy) + '%)',
        hint: 'Wells, chapels, taverns — and keep the barns full' });
    }
    G.buildings.forEach(function (b) {
      if (!b.built) return;
      if (b.paused) { out.push({ sev: 0, ic: '⏸', text: b.def.name + ' is paused', b: b }); return; }
      if (jobsOf(b) > 0 && b.workers === 0) {
        out.push({ sev: 1, ic: '⚠', text: b.def.name + ' has nobody working it', b: b,
          hint: 'Not enough villagers to go round' });
      }
    });
    if (G.count.smith > 0 && (G.toolCov || 0) < 0.5) {
      out.push({ sev: 1, ic: '🔨', text: 'Tools are running short — every trade is slower',
        hint: 'The smithy needs iron and timber' });
    }
    if (G.count.bakery > 0 && (G.breadCov || 0) < 0.4) {
      out.push({ sev: 0, ic: '🍞', text: 'Little bread on the table', hint: 'The bakery needs grain and firewood' });
    }
    if (!G.research && G.count.library > 0) {
      out.push({ sev: 0, ic: '📜', text: 'Your scholars are idle', hint: 'Begin a study in Research' });
    }
    DATA.RES.forEach(function (r) {
      if (G.res[r.key] >= cap(r.key) - 0.5 && net[r.key] > 0.02) {
        out.push({ sev: 0, ic: r.ic, text: r.name + ' stores are full — the surplus is being wasted',
          hint: 'Build a warehouse, or sell some at the market' });
      }
    });
    if (G.campaign) {
      out.push({ sev: G.campaign.phase === 'out' ? 1 : 0, ic: '⚔️',
        text: G.campaign.phase === 'out' ? 'Your army is away — only walls defend Ashveil'
             : G.campaign.phase === 'battle' ? 'Your army has reached the border'
             : 'Your army is marching home',
        hint: 'See the War tab' });
    } else if (raidSoon() && armyCount() === 0 && defenseScore() < 10) {
      out.push({ sev: 2, ic: '📯', text: 'Brannoch rides soon and Ashveil is undefended',
        hint: 'Muster soldiers, build a tower, or save gold to buy them off' });
    }

    out.sort(function (a, b2) { return b2.sev - a.sev; });
    _issCache = out; _issAt = G.time;
    return out;
  }
  /* What would help most right now, as {buildingId: reason}. Drives the
     Suggested tab so a new player never has to guess what is missing. */
  function advice() {
    var net = ledger(), out = {}, order = [];
    function need(id, why) {
      if (out[id] || !DATA.B[id] || !unlocked(id)) return;
      var def = DATA.B[id];
      if (def.max && countAll(id) >= def.max) return;
      out[id] = why; order.push(id);
    }
    // chapter goals first: that is where the player is being led
    activeQuests().forEach(function (q) {
      if (q.need.bld) Object.keys(q.need.bld).forEach(function (k) { need(k, 'For your chapter: ' + q.label.toLowerCase()); });
      if (q.need.pop) need('house', 'For your chapter: more homes, more villagers');
    });
    if (G.res.food < G.pop * 3 || foodTrend(net) < -0.01) {
      need('farm', 'Food is running short');
      var coast = W.tiles.some(function (t) { return (t.terr === 'sand' || t.terr === 'grass') && !t.bld && W.nearCount(t.x, t.y, ['water', 'shore'], 1) > 0; });
      if (coast) need('fishery', 'Food is running short — fish don\'t mind winter');
    }
    if (G.pop >= housing() - 1) need('house', 'Every bed is full — no room to grow');
    if (G.happy < 50) {
      if (!G.count.well) need('well', 'The people are unhappy');
      need('tavern', 'The people are unhappy');
      need('chapel', 'The people are unhappy');
    }
    if (G.count.bakery > 0 && (G.breadCov || 0) < 0.5 && G.pop > 20) need('bakery', 'Not enough bread for everyone — homes won\'t improve without it');
    if (!G.count.bakery && G.pop > 30) need('bakery', 'Bread lets homes become townhouses');
    if (season().key === 'autumn' || season().key === 'winter') {
      if (foodTrend(net) < 0.2 || G.res.food < G.pop * 6) need('hunter', 'Winter: the forest still feeds you when the fields do not');
    }
    if (net.wood < 0.05 && G.res.wood < 90) need('lumber', 'Timber is running low');
    if ((season().key === 'autumn' || season().key === 'winter') && G.res.wood < firewoodNeed() * DATA.SEASON_LEN + 60 + G.pop) need('lumber', 'Firewood for the winter hearths');
    if ((G.count.quarry || 0) === 0 && G.res.stone < 60) need('quarry', 'Nothing brings in stone');
    if (net.gold < 0.15) need('market', 'Gold comes in slowly');
    if (G.res.food >= cap('food') - 5 && G.res.food < G.pop * 20) need('granary', 'The barns are full');
    if (G.res.wood >= cap('wood') - 5 || G.res.stone >= cap('stone') - 5) need('warehouse', 'The stores are full');
    if (raidSoon() && deterrence() < 1) { need('tower', 'Brannoch is coming'); need('barracks', 'Brannoch is coming'); }
    // what the next castle is short of, and who makes it
    var ncs = nextCastle(), MAKER = { iron: 'mine', stone: 'quarry', wood: 'lumber' };
    if (ncs && (G.chapter || 0) >= 2) Object.keys(ncs.cost).forEach(function (k) {
      if (MAKER[k] && G.res[k] < ncs.cost[k] && !(net[k] > 0.05)) need(MAKER[k], 'The ' + ncs.name + ' needs ' + k);
    });
    // what stands between the homes and the next standing
    var earned = houseTierEarned(), top = 1;
    G.buildings.forEach(function (b) { if (b.def.evolves && b.built) top = Math.max(top, b.level || 1); });
    var nextT = DATA.HOUSE_TIERS[Math.min(top, DATA.HOUSE_TIERS.length - 1)];
    if (earned <= top && nextT && top < DATA.HOUSE_TIERS.length) {
      if ((G.breadCov || 0) < nextT.bread) { need('bakery', 'Homes need more bread to rise'); need('windmill', 'Homes need more bread to rise'); }
      if (nextT.cloth > 0 && G.res.cloth < nextT.cloth) { need('pasture', 'Fine homes want cloth — it starts with wool'); if (G.count.pasture) need('weaver', 'Fine homes want cloth'); }
      if (G.happy < nextT.happy) { need('chapel', 'Homes rise only in a contented town'); need('tavern', 'Homes rise only in a contented town'); }
    }
    return { map: out, order: order };
  }

  function issueCount() {
    var n = 0;
    issues().forEach(function (i) { if (i.sev >= 1) n++; });
    return n;
  }

  /* ---------------------------------------------------------
     save / load
     --------------------------------------------------------- */
  /* A save written before a resource existed has no key for it, and
     undefined + number is NaN — which would poison the whole economy on
     load. Every resource the game knows about gets a number here. */
  function normaliseRes(res) {
    var out = res || {};
    DATA.RES.forEach(function (r) {
      if (typeof out[r.key] !== 'number' || !isFinite(out[r.key])) out[r.key] = 0;
    });
    return out;
  }

  function save() {
    if (!G) return false;
    var d = {
      v: 4, world: W.serialize(),
      time: G.time, res: G.res, pop: G.pop, happy: G.happy,
      castle: G.castle, tech: G.tech, research: G.research,
      army: G.army, rival: G.rival, quests: G.quests, stats: G.stats, chapter: G.chapter || 0, won: !!G.won,
      tut: typeof G.tut === 'number' ? G.tut : -1, mkt: G.mkt || {}, decrees: G.decrees || {}, shiftUntil: G.shiftUntil || -1, finds: G.finds || [],
      dip: G.dip || null, tribute: G.tribute || null,
      folk: typeof FOLK !== 'undefined' ? FOLK.pack() : null,
      stocks: G.stocks || null, tax: G.tax || 'normal', tithe: !!G.tithe, drought: !!G.drought,
      grow: G.grow || null, ruler: G.ruler || null, petitions: G.petitions || [], perks: G.perks || {},
      works: G.works || {}, workNow: G.workNow || null, rationUntil: G.rationUntil || 0, fireCalm: G.fireCalm || 0, banditAt: G.banditAt || -1e9,
      plans: G.plans || [], news: (G.news || []).slice(0, 40), letters: G.letters || [], tips: G.tips || {},
      hist: G.hist || [], fog: G.fog, sites: G.sites || null, sea: G.sea || null, scouts: G.scouts || [], blessing: G.blessing || 0,
      shipTimer: G.shipTimer, findTimer: G.findTimer,
      vets: G.vets || {}, formation: G.formation || 'line', seen: G.seen || {}, campaign: G.campaign || null,
      festivals: G.festivals || {}, fairUntil: G.fairUntil || -1,
      eventTimer: G.eventTimer, speed: G.speed, setup: G.setup,
      buildings: G.buildings.map(function (b) {
        return [b.id, b.x, b.y, b.built ? 1 : 0, Number(b.prog.toFixed(3)),
                b.paused ? 1 : 0, b.level || 1, b.compact ? 1 : 0, Math.round(b.crop || 0), Math.round(b.cropStart || 0),
                b.soil === undefined ? 1 : Number(b.soil.toFixed(3)), b.fallowUntil || 0, Number((b.damage || 0).toFixed(3))];
      })
    };
    return U.save(d);
  }
  function hasSave() { return !!U.load(); }

  /* A save as a line of text, for keeping somewhere safe. */
  var CODE_TAG = 'ASHVEIL1:';
  function exportCode() {
    var d = U.load();
    if (!d) return '';
    return CODE_TAG + btoa(unescape(encodeURIComponent(JSON.stringify(d))));
  }
  function decodeCode(text) {
    var t = String(text || '').replace(/\s+/g, '');
    if (t.indexOf(CODE_TAG) !== 0) return null;
    try { return JSON.parse(decodeURIComponent(escape(atob(t.slice(CODE_TAG.length))))); }
    catch (e) { return null; }
  }
  function checkCode(text) {
    var d = decodeCode(text);
    if (!d) return { ok: false, why: 'That is not an Ashveil save code' };
    if (!(d.v >= 2 && d.v <= 4) || !d.world || !Array.isArray(d.buildings)) return { ok: false, why: 'That save code is damaged or from an unknown version' };
    return { ok: true, d: d };
  }
  function importCode(text) {
    var r = checkCode(text);
    if (!r.ok) return r;
    U.save(r.d);
    return { ok: true };
  }
  function loadGame() {
    var d = U.load();
    if (typeof FOLK !== 'undefined') FOLK.reset();
    if (typeof EXPLORE !== 'undefined') EXPLORE.reset();
    if (typeof HONOURS !== 'undefined') HONOURS.reset();
    if (typeof STEWARD !== 'undefined') STEWARD.reset();
    if (typeof COURT !== 'undefined') COURT.reset();
    if (!d || !(d.v >= 2 && d.v <= 4)) return false;    // older saves still load
    W.deserialize(d.world);
    var st = d.stats || {};
    if (st.upgrades === undefined) st.upgrades = 0;
    if (st.traded === undefined) st.traded = 0;
    G = {
      seed: d.world.seed, time: d.time, res: normaliseRes(d.res), pop: d.pop, happy: d.happy,
      toolCov: 0, breadCov: 0, seen: d.seen || { gold: 1, food: 1, wood: 1, stone: 1 },
      campaign: d.campaign || null,
      festivals: d.festivals || {}, fairUntil: d.fairUntil || -1,
      buildings: [], tech: d.tech || {}, research: d.research || null,
      castle: d.castle || 0, army: d.army || {}, rival: d.rival,
      quests: d.quests || {}, stats: st, eventTimer: d.eventTimer,
      chapter: d.chapter || 0, won: !!d.won, weather: 'clear', weatherTimer: 30,
      tut: typeof d.tut === 'number' ? d.tut : -1, mkt: d.mkt || {}, decrees: d.decrees || {}, shiftUntil: d.shiftUntil || -1, finds: d.finds || [],
      dip: d.dip || null, tribute: d.tribute || null, folkSave: d.folk || null,
      stocks: d.stocks || null, tax: d.tax || 'normal', tithe: !!d.tithe, drought: !!d.drought,
      grow: d.grow || null, ruler: d.ruler || null, petitions: d.petitions || [], perks: d.perks || {},
      works: d.works || {}, workNow: d.workNow || null, rationUntil: d.rationUntil || 0, fireCalm: d.fireCalm || 0, banditAt: d.banditAt === undefined ? -1e9 : d.banditAt,
      plans: d.plans || [], news: d.news || [], letters: d.letters || [], tips: d.tips || {},
      hist: d.hist || [], fog: d.fog, sites: d.sites || null, sea: d.sea || null, scouts: d.scouts || [], blessing: d.blessing || 0,
      ship: null, shipTimer: d.shipTimer || DATA.SEASON_LEN * 2, findTimer: d.findTimer || 40, fireTimer: 5,
      vets: d.vets || {}, formation: d.formation || 'line',
      growTimer: 6, reliefTimer: 30, reliefCooldown: 0,
      speed: d.speed || 1, log: [], setup: d.setup || { map: 'green', diff: 'fair', scen: 'standard' },
    };
    d.buildings.forEach(function (a) {
      if (!DATA.B[a[0]]) return;
      var b = mkBuilding(a[0], a[1], a[2]);
      b.built = !!a[3]; b.prog = a[4]; b.paused = !!a[5];
      b.level = a[6] || 1;
      b.crop = a[8] || 0; b.cropStart = a[9] || 0;
      if (a[10] !== undefined) { b.soil = a[10]; if (a[11]) b.fallowUntil = a[11]; if (a[12]) b.damage = a[12]; }
      // Farms and pastures became 2×2 plots. One saved before that keeps its
      // single tile rather than spilling onto its neighbours.
      if (a[7] || (d.v < 4 && (b.def.w || 1) > 1 && b.id !== 'castle')) makeCompact(b);
      commit(b);
    });
    // Kingdoms saved while roads were placeable buildings: pull them up,
    // hand back the stone, and let the footpaths wear themselves in instead.
    var oldRoads = G.buildings.filter(function (b) { return b.def.isRoad; });
    if (oldRoads.length) {
      var each = (DATA.B.road.cost && DATA.B.road.cost.stone) || 3;
      oldRoads.forEach(function (b) {
        var i = G.buildings.indexOf(b);
        if (i >= 0) G.buildings.splice(i, 1);
        var t = W.at(b.x, b.y);
        if (t) { t.road = false; if (t.bld === b) t.bld = null; }
      });
      G.res.stone = Math.min(cap('stone'), G.res.stone + oldRoads.length * each);
    }
    W.tiles.forEach(function (t) { t.road = false; });

    refreshCounts();
    markPathsDirty();
    ensurePaths(true);
    assignWorkers();
    AGENTS.reset();
    // bring the people and the mist back before anything asks about them
    if (typeof FOLK !== 'undefined') FOLK.tick(0);
    if (typeof EXPLORE !== 'undefined') EXPLORE.tick(0);
    emit('newgame');
    // an army saved while it waited at the border still has its battle to fight
    if (G.campaign && G.campaign.phase === 'battle') emit('campaign-arrived');
    return true;
  }

  return {
    get G() { return G; },
    on: on, emit: emit,
    newGame: newGame, loadGame: loadGame, hasSave: hasSave, save: save,
    exportCode: exportCode, checkCode: checkCode, importCode: importCode,
    tick: tick, place: place, demolish: demolish, costOf: costOf, canAfford: canAfford,
    unlocked: unlocked, refreshCounts: refreshCounts,
    ledger: ledger, output: output, cap: cap, housing: housing,
    armyCap: armyCap, armySlots: armySlots, armyCount: armyCount,
    defenseScore: defenseScore, smithBonus: smithBonus,
    fieldStrength: fieldStrength, unitStrength: unitStrength, totalStrength: totalStrength,
    launchCampaign: launchCampaign, campaignResolved: campaignResolved,
    campaignSlots: campaignSlots, awayCount: awayCount, MARCH_SEASONS: MARCH_SEASONS,
    raidPower: raidPower, graceLeft: graceLeft, raidSoon: raidSoon, get GRACE_SEASONS() { return graceSeasons(); }, DIFFS: DIFFS, SCENARIOS: SCENARIOS, diff: diff,
    deterrence: deterrence, raidCause: raidCause,
    jobsOf: jobsOf, staffRatio: staffRatio, efficiency: efficiency,
    scoreOf: scoreOf, priorityLabel: priorityLabel, assignWorkers: assignWorkers,
    season: season, seasonIndex: seasonIndex, year: year, seasonProgress: seasonProgress,
    nextFestival: nextFestival, fairOn: fairOn,
    nextCastle: nextCastle, upgradeCastle: upgradeCastle,
    lvlMul: lvlMul, canUpgrade: canUpgrade, upgradeCost: upgradeCost, upgradeBuilding: upgradeBuilding,
    houseTierEarned: houseTierEarned, houseTierFor: houseTierFor, countHouseTier: countHouseTier,
    canFell: canFell, fell: fell,
    ensurePaths: ensurePaths, markPathsDirty: markPathsDirty,
    goodsValue: goodsValue, marketCut: marketCut,
    rebuildPaths: function () { markPathsDirty(); ensurePaths(true); },
    preview: preview, soilMul: soilMul,
    canUndo: canUndo, undoLeft: undoLeft, undoPlace: undoPlace, lastAction: function () { return lastPlaced && lastPlaced.kind; },
    autoBattle: autoBattle, foeSpec: foeSpec, foeStrengthOf: foeStrengthOf, banditPower: banditPower, banditReady: banditReady,
    perk: perk, homeMul: homeMul, hearths: hearths, tired: tired, fallow: fallow, cold: cold, diet: diet, firewoodNeed: firewoodNeed, stockMul: stockMul, taxMul: taxMul,
    done: done, workProgress: workProgress, workAvailable: workAvailable, startWork: startWork, zeal: zeal,
    planBuild: planBuild, cancelPlan: cancelPlan, planAt: planAt, get plans() { return plans(); },
    moveCost: moveCost, canMove: canMove, moveBuilding: moveBuilding,
    canTrade: canTrade, priceOf: priceOf, sell: sell, buy: buy, tradeSpread: tradeSpread,
    techAvailable: techAvailable, techClosed: techClosed, startResearch: startResearch,
    unitAvailable: unitAvailable, recruit: recruit, disband: disband,
    activeQuests: activeQuests, applyEffects: applyEffects, checkQuests: checkQuests,
    goalProgress: goalProgress, chapter: chapter, lockReason: lockReason, countAll: countAll, rainMul: rainMul,
    cropRate: cropRate, harvestRate: harvestRate, foodTrend: foodTrend, farmYearly: farmYearly, harvesting: harvesting, standingCrop: standingCrop, gardenMul: gardenMul,
    ignite: ignite, rallyBrigade: rallyBrigade, burning: burning, wellsNear: wellsNear, fireRisk: fireRisk,
    decree: decree, decreeReady: decreeReady, decreeCost: decreeCost, shiftMul: shiftMul,
    collectFind: collectFind, takeOffer: takeOffer, shipLeaves: shipLeaves, mktOf: mktOf,
    issues: issues, issueCount: issueCount, advice: advice,
    happyTarget: happyTarget,
    dip: dip, persona: persona, atPeace: atPeace, dipMood: dipMood, dipReady: dipReady, dipAct: dipAct,
    dipBattle: dipBattle, breakPeace: breakPeace, DIP: DIP, PERSONAS: PERSONAS
  };
})();
