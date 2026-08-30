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
      rival: { str: 34, anger: 0, nextRaid: DATA.SEASON_LEN * 3.2 },
      quests: {}, questShown: [],
      stats: { wins: 0, losses: 0, built: 0, raidsSurvived: 0, techDone: 0 },
      eventTimer: DATA.SEASON_LEN * 1.6,
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
      if (b.built && b.def.store && b.def.store[res]) v += b.def.store[res];
    });
    if (res === 'gold' && G.tech.banking) v += 200;
    return v;
  }

  function housing() {
    var h = 0;
    G.buildings.forEach(function (b) { if (b.built && b.def.housing) h += b.def.housing; });
    h += castleBonus().housing || 0;
    return h;
  }

  function armyCap() {
    var v = 8 + (castleBonus().armyCap || 0);
    G.buildings.forEach(function (b) { if (b.built && b.def.armyCap) v += b.def.armyCap; });
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

  function defenseScore() {
    var d = castleBonus().defense || 0;
    var mul = G.tech.fortification ? 1.6 : 1;
    G.buildings.forEach(function (b) { if (b.built && b.def.defense) d += b.def.defense * mul; });
    return Math.round(d);
  }

  function smithBonus() {
    var atk = 0, def = 0;
    G.buildings.forEach(function (b) {
      if (b.built && b.id === 'smith' && staffRatio(b) > 0.2) { atk += b.def.armyAtk; def += b.def.armyDef; }
    });
    if (G.tech.iron_weapons) atk += 0.10;
    return { atk: 1 + Math.min(atk, 0.6), def: 1 + Math.min(def, 0.5) };
  }

  /* jobs / workforce -------------------------------------- */
  var PRIORITY = { food: 0, industry: 1, civic: 2, military: 3, housing: 4 };
  function assignWorkers() {
    var avail = Math.floor(G.pop);
    var list = G.buildings.filter(function (b) { return b.built && jobsOf(b) > 0 && !b.paused; });
    list.sort(function (a, b) {
      var pa = PRIORITY[a.def.cat], pb = PRIORITY[b.def.cat];
      if (pa !== pb) return pa - pb;
      return a.uid - b.uid;
    });
    list.forEach(function (b) { b.workers = 0; });
    // round-robin: one worker to each workplace, then a second, and so on.
    // Keeps a new quarry staffed instead of the farms swallowing everybody.
    var guard = 0;
    while (avail > 0 && guard++ < 12) {
      var gave = false;
      for (var i = 0; i < list.length && avail > 0; i++) {
        var b = list[i];
        if (b.workers < jobsOf(b)) { b.workers++; avail--; gave = true; }
      }
      if (!gave) break;
    }
    G.buildings.forEach(function (b) { if (b.paused || jobsOf(b) === 0) b.workers = 0; });
    G.idle = avail;
    G.builders = Math.min(6, Math.max(1, Math.floor(avail * 0.5) + 1));
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
    var eff = efficiency() * ratio * auraFor(b);
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
        out[k] = (out[k] || 0) - b.def.consumes[k] * ratio;
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
      capacity += b.def.happy * 6;
    });
    var coverage = G.pop > 0 ? U.clamp(capacity / G.pop, 0, 1.35) : 1;
    var t = 34 + coverage * 46;
    if (G.tech.sanitation) t += 8;
    if (G.res.food > G.pop * 10) t += 8;
    else if (G.res.food <= 0) t -= 34;
    else if (G.res.food < G.pop * 2) t -= 12;
    if (G.pop > housing()) t -= 18;
    if (G.idle > G.pop * 0.45 && G.pop > 12) t -= 6;
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
    } else if (G.pop < h && G.happy > 38) {
      var rate = 0.09 * season().growth * (G.happy / 70) * U.clamp((h - G.pop) / 6, 0.15, 1);
      G.pop = Math.min(h, G.pop + rate * dt);
    } else if (G.happy < 18 && G.pop > 2) {
      G.pop -= 0.02 * dt;   // people drift away
    }

    // research
    if (G.research) {
      var rate = 0.34;
      G.buildings.forEach(function (b) {
        if (b.built && b.def.research) rate += b.def.research * staffRatio(b);
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
    G.rival.str += dt * (0.014 + G.time / 90000);
    G.rival.nextRaid -= dt;
    if (G.rival.nextRaid <= 0) {
      G.rival.nextRaid = DATA.SEASON_LEN * (2.6 + Math.random() * 1.8);
      emit('raid-incoming');
    }

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
      v: 2, world: W.serialize(),
      time: G.time, res: G.res, pop: G.pop, happy: G.happy,
      castle: G.castle, tech: G.tech, research: G.research,
      army: G.army, rival: G.rival, quests: G.quests, stats: G.stats,
      eventTimer: G.eventTimer, speed: G.speed,
      buildings: G.buildings.map(function (b) {
        return [b.id, b.x, b.y, b.built ? 1 : 0, Number(b.prog.toFixed(3)), b.paused ? 1 : 0];
      })
    };
    return U.save(d);
  }
  function hasSave() { return !!U.load(); }
  function loadGame() {
    var d = U.load();
    if (!d || d.v !== 2) return false;
    W.deserialize(d.world);
    G = {
      seed: d.world.seed, time: d.time, res: d.res, pop: d.pop, happy: d.happy,
      buildings: [], tech: d.tech || {}, research: d.research || null,
      castle: d.castle || 0, army: d.army || {}, rival: d.rival,
      quests: d.quests || {}, stats: d.stats, eventTimer: d.eventTimer,
      speed: d.speed || 1, log: []
    };
    d.buildings.forEach(function (a) {
      if (!DATA.B[a[0]]) return;
      var b = mkBuilding(a[0], a[1], a[2]);
      b.built = !!a[3]; b.prog = a[4]; b.paused = !!a[5];
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
    jobsOf: jobsOf, staffRatio: staffRatio, efficiency: efficiency,
    season: season, seasonIndex: seasonIndex, year: year, seasonProgress: seasonProgress,
    nextCastle: nextCastle, upgradeCastle: upgradeCastle,
    techAvailable: techAvailable, startResearch: startResearch,
    unitAvailable: unitAvailable, recruit: recruit, disband: disband,
    activeQuests: activeQuests, applyEffects: applyEffects, checkQuests: checkQuests,
    happyTarget: happyTarget
  };
})();
