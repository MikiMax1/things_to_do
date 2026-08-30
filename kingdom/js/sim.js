/* ============================================================
   sim.js — game state, economy, workers, research, population
   ============================================================ */
var SIM = (function () {
  'use strict';

  var G = null;                 // the whole game state
  var listeners = [];
  function on(fn) { listeners.push(fn); }
  function emit(kind, payload) { listeners.forEach(function (f) { f(kind, payload); }); }

  var BASE_STORE = { gold: 500, food: 400, wood: 350, stone: 300, iron: 150 };

  /* ---------------------------------------------------------
     new game
     --------------------------------------------------------- */
  function newGame(seed) {
    seed = seed || Math.floor(Math.random() * 1e9);
    var spot = W.generate(seed);
    G = {
      seed: seed,
      time: 0,                       // seconds of game time
      res: { gold: 260, food: 220, wood: 160, stone: 70, iron: 0 },
      pop: 6, happy: 62,
      buildings: [],
      tech: {}, research: null, researchPts: 0,
      castle: 0,
      army: { militia: 4 },
      rival: { str: 30, anger: 0, nextRaid: DATA.SEASON_LEN * 6.5, warned: false },
      quests: {}, questShown: [],
      stats: { wins: 0, losses: 0, built: 0, raidsSurvived: 0, techDone: 0, upgrades: 0, traded: 0 },
      vets: {}, formation: 'line',
      eventTimer: DATA.SEASON_LEN * 1.6,
      growTimer: 6, reliefTimer: 30, reliefCooldown: 0,
      speed: 1,
      log: []
    };
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
    refreshCounts();
    AGENTS.reset();
    emit('newgame');
    return G;
  }

  /* ---------------------------------------------------------
     buildings
     --------------------------------------------------------- */
  var uid = 1;
  function mkBuilding(id, x, y) {
    var def = DATA.B[id];
    return {
      uid: uid++, id: id, def: def, x: x, y: y,
      built: false, prog: 0, workers: 0, paused: false,
      t: Math.random() * 6.28, level: 1
    };
  }
  function commit(b) {
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

  function costOf(id) {
    var def = DATA.B[id], out = {};
    Object.keys(def.cost || {}).forEach(function (k) {
      var v = def.cost[k];
      if (k === 'stone' && G.tech.masonry) v *= 0.9;
      out[k] = Math.round(v);
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
    if (def.unique) return false;
    return true;
  }

  function place(id, x, y) {
    var def = DATA.B[id];
    if (!unlocked(id)) return { ok: false, why: 'Not yet researched' };
    if (def.max && G.count[id] >= def.max) return { ok: false, why: 'You already have ' + def.max };
    var chk = W.canPlace(id, x, y);
    if (!chk.ok) return chk;
    var cost = costOf(id);
    if (!canAfford(cost)) return { ok: false, why: 'Not enough ' + short(cost) };
    pay(cost);
    var b = mkBuilding(id, x, y);
    // clearing woodland pays you back in timber
    W.footprint(def, x, y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (t && t.terr === 'forest') G.res.wood = Math.min(cap('wood'), G.res.wood + 12);
    });
    if (def.build <= 0) { b.built = true; b.prog = 1; }
    commit(b);
    G.stats.built++;
    refreshCounts();
    emit('build', b);
    return { ok: true, b: b };
  }

  function short(cost) {
    return Object.keys(cost).filter(function (k) { return G.res[k] < cost[k]; }).join(' & ');
  }

  function demolish(b) {
    if (b.id === 'castle') return false;
    var i = G.buildings.indexOf(b);
    if (i < 0) return false;
    G.buildings.splice(i, 1);
    W.footprint(b.def, b.x, b.y).forEach(function (c) {
      var t = W.at(c.x, c.y);
      if (!t) return;
      if (b.def.isRoad) t.road = false; else if (t.bld === b) t.bld = null;
    });
    // half the timber and stone come back
    var cost = costOf(b.id);
    ['wood', 'stone'].forEach(function (k) {
      if (cost[k]) G.res[k] = Math.min(cap(k), G.res[k] + Math.round(cost[k] * (b.built ? 0.4 : 0.9)));
    });
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
    G.count = c;
  }

  function castleBonus() { return DATA.CASTLE[G.castle].bonus || {}; }

  function cap(res) {
    var v = BASE_STORE[res] || 0;
    G.buildings.forEach(function (b) {
      if (b.built && b.def.store && b.def.store[res]) v += b.def.store[res] * lvlMul(b);
    });
    if (res === 'gold' && G.tech.banking) v += 200;
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
  var GRACE_SEASONS = 6;

  function unitStrength(hp, atk, def) { return (hp * 0.25 + atk * 1.6 + def * 0.8) / 3.1; }

  function fieldStrength(extraDef) {
    var sb = smithBonus(), out = 0;
    Object.keys(G.army).forEach(function (k) {
      var u = DATA.UNITS[k];
      if (!u) return;
      out += G.army[k] * unitStrength(u.hp, u.atk * sb.atk, u.def + (extraDef || 0));
    });
    return out;
  }

  /* Brannoch sends a war band sized against YOU, not against a number that
     ticks up on its own. A defenceless village gets a scouting party; a
     kingdom with knights gets a real war. Never more than their true
     strength, so beating them down still counts for something. */
  function raidPower() {
    var seasons = seasonIndex();
    var ramp = U.clamp((seasons - GRACE_SEASONS) / 14, 0, 1);
    // scaled against your ARMY only — walls and towers must stay a pure
    // advantage, never a reason for Brannoch to send more men
    var mine = fieldStrength(0);
    var base = 6 + ramp * 26;
    var target = mine * (0.50 + ramp * 0.60) + base;
    return U.clamp(Math.min(G.rival.str, target), 6, G.rival.str);
  }

  function graceLeft() { return Math.max(0, GRACE_SEASONS - seasonIndex()); }

  function defenseScore() {
    var d = castleBonus().defense || 0;
    var mul = G.tech.fortification ? 1.6 : 1;
    G.buildings.forEach(function (b) { if (b.built && b.def.defense) d += b.def.defense * mul * lvlMul(b); });
    return Math.round(d);
  }

  function smithBonus() {
    var atk = 0, def = 0;
    G.buildings.forEach(function (b) {
      if (b.built && b.id === 'smith' && staffRatio(b) > 0.2) { atk += b.def.armyAtk * lvlMul(b); def += b.def.armyDef * lvlMul(b); }
    });
    if (G.tech.iron_weapons) atk += 0.10;
    return { atk: 1 + Math.min(atk, 0.6), def: 1 + Math.min(def, 0.5) };
  }

  /* jobs / workforce --------------------------------------
     Nobody is told what to do by hand any more. Every few moments the realm
     works out what it is short of, scores each workplace against that, and
     spreads the villagers over the jobs in proportion to how badly each one
     is needed. Anyone left over becomes a labourer rather than standing idle.
  */

  function raidSoon() {
    return G.rival && G.rival.nextRaid < DATA.SEASON_LEN * 1.5 && seasonIndex() >= GRACE_SEASONS;
  }

  /* how badly the realm wants each resource right now */
  function pressures() {
    var net = ledger(), p = {};
    ['food', 'wood', 'stone', 'iron', 'gold'].forEach(function (k) {
      var c = cap(k), ratio = c > 0 ? G.res[k] / c : 0;
      var need = 1;
      if (net[k] < 0) need += 1.5;
      if (ratio < 0.10) need += 1.3;
      else if (ratio < 0.30) need += 0.55;
      else if (ratio > 0.92) need -= 0.75;      // barns are full; go do something else
      p[k] = Math.max(0.12, need);
    });
    // starving is not a resource problem, it is an emergency
    if (G.res.food < G.pop * 2) p.food += 2.6;
    else if (G.res.food < G.pop * 5) p.food += 1.1;
    if (net.food < 0) p.food += 1.0;
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
    if (b.def.soilBonus) {
      var t = W.at(b.x, b.y);
      if (t && t.terr === 'meadow') s *= 1.25;
      if (t && t.terr === 'sand') s *= 0.75;
    }
    if (b.def.seasonal) s *= (0.55 + foodSeasonMul() * 0.6);      // nobody farms hard in deep winter
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
    var key = G.buildings.length + '|' + Math.floor(G.pop) + '|' + (G.research ? 1 : 0);
    if (!force && G._workTimer > 0 && G._workKey === key) return;
    G._workTimer = 0.45;
    G._workKey = key;

    var avail = Math.floor(G.pop);
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
    return mul;
  }

  function techMul(res) {
    var m = 1;
    if (res === 'food' && G.tech.crop_rotation) m += 0.25;
    if (res === 'wood' && G.tech.forestry) m += 0.20;
    if (res === 'stone' && G.tech.masonry) m += 0.20;
    if (res === 'iron' && G.tech.deep_mining) m += 0.50;
    if (res === 'gold' && G.tech.trade_charter) m += 0.25;
    if (res === 'gold' && G.tech.guilds) m += 0.15;
    if (res === 'gold' && G.tech.banking) m += 0.25;
    var cb = castleBonus();
    if (res === 'gold' && cb.gold) m += cb.gold;
    if (cb.all) m += cb.all;
    return m;
  }

  function seasonIndex() { return Math.floor(G.time / DATA.SEASON_LEN); }
  function season() { return DATA.SEASONS[seasonIndex() % 4]; }
  function year() { return Math.floor(seasonIndex() / 4) + 1; }
  function seasonProgress() { return (G.time % DATA.SEASON_LEN) / DATA.SEASON_LEN; }

  function foodSeasonMul() {
    var s = season();
    if (s.key === 'winter' && G.tech.irrigation) return 0.65;
    return s.food;
  }

  function efficiency() {
    return U.clamp(0.62 + (G.happy / 100) * 0.45, 0.45, 1.12);
  }

  /* production of one building, per second */
  function output(b) {
    var out = {};
    if (!b.built || b.paused) return out;
    var ratio = staffRatio(b);
    if (ratio <= 0 && jobsOf(b) > 0) return out;
    var eff = efficiency() * ratio * auraFor(b) * lvlMul(b);
    if (b.def.produces) {
      Object.keys(b.def.produces).forEach(function (k) {
        var v = b.def.produces[k] * eff * techMul(k);
        if (b.def.seasonal && k === 'food') v *= foodSeasonMul();
        if (b.def.scaleNear) {
          var n = W.nearCount(b.x, b.y, b.def.scaleNear.terrain, 1);
          v *= U.clamp(n / b.def.scaleNear.div, 0.34, 2.0);
        }
        if (b.def.soilBonus) {
          var t = W.at(b.x, b.y);
          if (t && t.terr === 'meadow') v *= 1.35;
          if (t && t.terr === 'sand') v *= 0.7;
        }
        out[k] = (out[k] || 0) + v;
      });
    }
    if (b.def.trade) {
      var roads = W.nearCount(b.x, b.y, [], 2);
      var roadN = 0;
      for (var oy = -2; oy <= 2; oy++) for (var ox = -2; ox <= 2; ox++) {
        var tt = W.at(b.x + ox, b.y + oy);
        if (tt && tt.road) roadN++;
      }
      var g = (b.def.trade * G.pop + 0.30) * eff * techMul('gold') * (1 + Math.min(roadN, 8) * 0.05);
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
    var net = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
    G.buildings.forEach(function (b) {
      var o = output(b);
      Object.keys(o).forEach(function (k) { net[k] += o[k]; });
      if (b.built && b.def.upkeep) net.gold -= b.def.upkeep;
    });
    // villagers with no post left to fill turn their hands to foraging and
    // hauling — far less than a proper job, but never nothing
    var spare = G.idle || 0;
    if (spare > 0) {
      var eff = efficiency();
      net.food += spare * 0.020 * eff * foodSeasonMul();
      net.wood += spare * 0.010 * eff;
    }
    net.food -= G.pop * 0.055;
    net.food -= armySlots() * 0.012;
    net.gold -= armySlots() * 0.014;
    if (season().key === 'winter') {
      var spoil = G.count.granary > 0 ? 0.03 : 0.06;
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
    var coverage = G.pop > 0 ? U.clamp(capacity / G.pop, 0, 1.35) : 1;
    var t = 34 + coverage * 46;
    if (G.tech.sanitation) t += 8;
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

    G._workTimer = (G._workTimer || 0) - dt;
    assignWorkers();

    // construction
    G.buildings.forEach(function (b) {
      if (b.built) { b.t += dt; return; }
      var speed = (1 + G.builders * 0.35) / Math.max(1, b.def.build);
      b.prog += speed * dt;
      if (b.prog >= 1) {
        b.prog = 1; b.built = true;
        refreshCounts();
        U.sfx.build();
        emit('completed', b);
      }
    });

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
      G.pop -= 0.045 * dt;
      if (!G._starveWarned || G.time - G._starveWarned > 20) {
        G._starveWarned = G.time;
        emit('toast', { msg: 'Your people are starving — build farms!', kind: 'bad' });
      }
    } else if (G.pop < h && G.happy > 38 && G.res.food > G.pop * 1.5) {
      // People only have children while the barns can actually feed them.
      // Without this the village breeds itself straight into a famine every
      // time housing outruns the harvest.
      var rate = 0.09 * season().growth * (G.happy / 70) * U.clamp((h - G.pop) / 6, 0.15, 1);
      G.pop = Math.min(h, G.pop + rate * dt);
    } else if (G.happy < 18 && G.pop > 2) {
      G.pop -= 0.02 * dt;   // people drift away
    }

    // research
    if (G.research) {
      var rate = 0.34;
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
    G.rival.str += dt * (0.010 + G.time / 140000);
    G.rival.nextRaid -= dt;
    if (!G.rival.warned && G.rival.nextRaid <= DATA.SEASON_LEN * 0.85 && seasonIndex() >= GRACE_SEASONS - 1) {
      G.rival.warned = true;
      emit('toast', { msg: 'Scouts: Brannoch is mustering. Roughly a season before they ride.', kind: 'war' });
    }
    if (G.rival.nextRaid <= 0) {
      G.rival.warned = false;
      // raids come further apart while you are still finding your feet
      var gap = seasonIndex() < GRACE_SEASONS + 8 ? (4.5 + Math.random() * 2.2) : (2.8 + Math.random() * 1.8);
      G.rival.nextRaid = DATA.SEASON_LEN * gap;
      if (seasonIndex() < GRACE_SEASONS) {
        G.rival.nextRaid = DATA.SEASON_LEN * 2;   // still at peace — try again later
      } else {
        emit('raid-incoming');
      }
    }

    regrow(dt);
    checkRelief(dt);

    // random events
    G.eventTimer -= dt;
    if (G.eventTimer <= 0) {
      G.eventTimer = DATA.SEASON_LEN * (1.5 + Math.random() * 1.6);
      emit('event');
    }

    if (seasonIndex() !== prevSeason) {
      U.sfx.season();
      emit('season', season());
    }

    checkQuests();
  }

  /* ---------------------------------------------------------
     woodland: always fellable, and it grows back
     --------------------------------------------------------- */
  function canFell(t) { return !!t && t.terr === 'forest' && !t.bld && !t.road; }
  function fell(t) {
    if (!canFell(t)) return { ok: false, why: 'Nothing to fell here' };
    t.terr = 'grass'; t.cleared = true;
    var gain = (DATA.TERRAIN.forest.clearGain || { wood: 12 }).wood;
    G.res.wood = Math.min(cap('wood'), G.res.wood + gain);
    emit('felled', { t: t, gain: gain });
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
      if (!t || t.bld || t.road) continue;
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
    var sp = tradeSpread();
    return {
      sell: Math.max(1, Math.round(t.base * sp.sell * DATA.TRADE_LOT)),
      buy: Math.max(2, Math.round(t.base * sp.buy * DATA.TRADE_LOT))
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
    G.stats.traded = (G.stats.traded || 0) + 1;
    U.sfx.coin();
    emit('change');
    return { ok: true, cost: price, amount: amount };
  }

  /* ---------------------------------------------------------
     last-resort relief: you should never be able to get stuck
     --------------------------------------------------------- */
  function destitute() {
    if (G.res.gold >= 40 || G.res.wood >= 20 || G.res.stone >= 20) return false;
    var net = ledger();
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
    if (t.req.some(function (r) { return !G.tech[r]; })) return false;
    if (t.lib && G.count.library < t.lib) return false;
    return true;
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
      G.pop = Math.max(1, G.pop - 1);
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
    G.pop += 1;
    emit('army');
  }

  /* ---------------------------------------------------------
     objectives
     --------------------------------------------------------- */
  function questMet(q) {
    var n = q.need;
    if (n.pop && G.pop < n.pop) return false;
    if (n.army && armyCount() < n.army) return false;
    if (n.castle && G.castle < n.castle) return false;
    if (n.tech && G.stats.techDone < n.tech) return false;
    if (n.wins && G.stats.wins < n.wins) return false;
    if (n.upgrades && (G.stats.upgrades || 0) < n.upgrades) return false;
    if (n.bld) {
      for (var k in n.bld) if ((G.count[k] || 0) < n.bld[k]) return false;
    }
    return true;
  }
  function checkQuests() {
    DATA.QUESTS.forEach(function (q) {
      if (G.quests[q.id]) return;
      if (!questMet(q)) return;
      G.quests[q.id] = true;
      Object.keys(q.reward).forEach(function (k) {
        G.res[k] = Math.min(cap(k), G.res[k] + q.reward[k]);
      });
      U.sfx.quest();
      emit('toast', { msg: 'Charter fulfilled — ' + q.label, kind: 'good' });
      emit('quest', q);
    });
  }
  function activeQuests(n) {
    return DATA.QUESTS.filter(function (q) { return !G.quests[q.id]; }).slice(0, n || 3);
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
     save / load
     --------------------------------------------------------- */
  function save() {
    if (!G) return false;
    var d = {
      v: 3, world: W.serialize(),
      time: G.time, res: G.res, pop: G.pop, happy: G.happy,
      castle: G.castle, tech: G.tech, research: G.research,
      army: G.army, rival: G.rival, quests: G.quests, stats: G.stats,
      vets: G.vets || {}, formation: G.formation || 'line',
      eventTimer: G.eventTimer, speed: G.speed,
      buildings: G.buildings.map(function (b) {
        return [b.id, b.x, b.y, b.built ? 1 : 0, Number(b.prog.toFixed(3)),
                b.paused ? 1 : 0, b.level || 1];
      })
    };
    return U.save(d);
  }
  function hasSave() { return !!U.load(); }
  function loadGame() {
    var d = U.load();
    if (!d || !(d.v === 2 || d.v === 3)) return false;   // v2 saves still load
    W.deserialize(d.world);
    var st = d.stats || {};
    if (st.upgrades === undefined) st.upgrades = 0;
    if (st.traded === undefined) st.traded = 0;
    G = {
      seed: d.world.seed, time: d.time, res: d.res, pop: d.pop, happy: d.happy,
      buildings: [], tech: d.tech || {}, research: d.research || null,
      castle: d.castle || 0, army: d.army || {}, rival: d.rival,
      quests: d.quests || {}, stats: st, eventTimer: d.eventTimer,
      vets: d.vets || {}, formation: d.formation || 'line',
      growTimer: 6, reliefTimer: 30, reliefCooldown: 0,
      speed: d.speed || 1, log: []
    };
    d.buildings.forEach(function (a) {
      if (!DATA.B[a[0]]) return;
      var b = mkBuilding(a[0], a[1], a[2]);
      b.built = !!a[3]; b.prog = a[4]; b.paused = !!a[5];
      b.level = a[6] || 1;
      commit(b);
    });
    refreshCounts();
    assignWorkers();
    AGENTS.reset();
    emit('newgame');
    return true;
  }

  return {
    get G() { return G; },
    on: on, emit: emit,
    newGame: newGame, loadGame: loadGame, hasSave: hasSave, save: save,
    tick: tick, place: place, demolish: demolish, costOf: costOf, canAfford: canAfford,
    unlocked: unlocked, refreshCounts: refreshCounts,
    ledger: ledger, output: output, cap: cap, housing: housing,
    armyCap: armyCap, armySlots: armySlots, armyCount: armyCount,
    defenseScore: defenseScore, smithBonus: smithBonus,
    fieldStrength: fieldStrength, unitStrength: unitStrength,
    raidPower: raidPower, graceLeft: graceLeft, GRACE_SEASONS: GRACE_SEASONS,
    jobsOf: jobsOf, staffRatio: staffRatio, efficiency: efficiency,
    scoreOf: scoreOf, priorityLabel: priorityLabel, assignWorkers: assignWorkers,
    season: season, seasonIndex: seasonIndex, year: year, seasonProgress: seasonProgress,
    nextCastle: nextCastle, upgradeCastle: upgradeCastle,
    lvlMul: lvlMul, canUpgrade: canUpgrade, upgradeCost: upgradeCost, upgradeBuilding: upgradeBuilding,
    canFell: canFell, fell: fell,
    canTrade: canTrade, priceOf: priceOf, sell: sell, buy: buy, tradeSpread: tradeSpread,
    techAvailable: techAvailable, startResearch: startResearch,
    unitAvailable: unitAvailable, recruit: recruit, disband: disband,
    activeQuests: activeQuests, applyEffects: applyEffects, checkQuests: checkQuests,
    happyTarget: happyTarget
  };
})();
