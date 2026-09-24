/* ============================================================
   war.js — raids fought on the island itself.

   Longships are seen at sea, run up onto a beach, and the raiders
   march on the town: they set roofs alight and carry off what they
   can from granaries, warehouses, the market and the keep. Your
   soldiers muster at the castle and the barracks and go out to meet
   them; towers and the keep shoot at anyone in range; walls must be
   gone round or broken through. You can send each squad where you
   want it, or leave them to it. It ends when the raiders are dead,
   or break and run for their boats, or sail off with their plunder.
   ============================================================ */
var WAR = (function () {
  'use strict';

  var war = null;          // the raid in progress, if any
  var shots = [];          // arrows and stones in flight
  var fx = [];             // sparks and dust
  var selected = null;     // squad key the player has picked
  var PACE = 0.5;          // how hard blows land, relative to the battle screen

  var SQUADS = {
    foot: { name: 'Infantry', ic: '🛡️', keys: ['militia', 'spearman', 'manatarms'] },
    bows: { name: 'Archers', ic: '🏹', keys: ['archer'] },
    horse: { name: 'Knights', ic: '🐎', keys: ['knight'] },
    siege: { name: 'Catapults', ic: '🎯', keys: ['catapult'] }
  };
  function squadOf(key) {
    for (var s in SQUADS) if (SQUADS[s].keys.indexOf(key) >= 0) return s;
    return 'foot';
  }

  /* map units are the battle units scaled to tiles */
  function mkUnit(side, key, def, x, y, bonus) {
    bonus = bonus || {};
    return {
      side: side, key: key, squad: side === 'mine' ? squadOf(key) : null, vet: !!bonus.vet,
      hp: def.hp * (bonus.hp || 1), maxHp: def.hp * (bonus.hp || 1),
      atk: def.atk * (bonus.atk || 1), def: def.def + (bonus.def || 0),
      spd: def.spd / 20 * (bonus.spd || 1), rng: def.rng > 40 ? def.rng / 18 : 0.62, ranged: def.rng > 40,
      rate: def.rate, splash: (def.splash || 0) / 18, cd: Math.random() * def.rate,
      x: x, y: y, path: null, node: 0, repath: 0, target: null, dead: false, fade: 1,
      bob: Math.random() * 6, face: 1, flash: 0, order: null, fled: false, loot: 0
    };
  }

  /* ---------------- where they come ashore ---------------- */
  function landingSite() {
    var c = SIM.G.buildings[0], best = null, bestD = 1e9;
    W.tiles.forEach(function (t) {
      if (!W.walkable(t) || t.bld) return;
      if (W.nearCount(t.x, t.y, ['water', 'shore'], 1) < 2) return;
      var d = U.dist(t.x, t.y, c.x + 1, c.y + 1);
      if (d < 5) return;
      // a little randomness so they do not always pick the same beach
      d += Math.random() * 6;
      if (d < bestD) { bestD = d; best = t; }
    });
    return best;
  }
  function seaApproach(land) {
    // the nearest water tile to the beach, and a start point out at sea beyond it
    var water = null, wd = 1e9;
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
      var t = W.at(land.x + dx, land.y + dy);
      if (t && (t.terr === 'water' || t.terr === 'shore')) {
        var d = Math.abs(dx) + Math.abs(dy);
        if (d < wd) { wd = d; water = t; }
      }
    }
    if (!water) water = { x: land.x, y: land.y + 1 };
    var cx = W.COLS / 2, cy = W.ROWS / 2;
    var ax = water.x - cx, ay = water.y - cy, al = Math.hypot(ax, ay) || 1;
    return { to: { x: water.x + 0.5, y: water.y + 0.5 }, from: { x: water.x + 0.5 + ax / al * 14, y: water.y + 0.5 + ay / al * 14 } };
  }

  /* ---------------- beginning ---------------- */
  function begin(opts) {
    var G = SIM.G;
    var land = landingSite();
    if (!land) return false;
    var sea = seaApproach(land);
    var spec = BATTLE.foeArmy(opts.power, opts.flavour);
    var n = 0; Object.keys(spec).forEach(function (k) { n += spec[k]; });
    var nShips = Math.max(1, Math.min(4, Math.ceil(n / 7)));
    var ships = [];
    for (var i = 0; i < nShips; i++) {
      var off = (i - (nShips - 1) / 2) * 0.9;
      ships.push({ x: sea.from.x + off, y: sea.from.y - off, tx: sea.to.x + off * 0.5, ty: sea.to.y - off * 0.5, beached: false, face: 1 });
    }
    war = {
      phase: 'sail', t: 0, land: { x: land.x + 0.5, y: land.y + 0.5 }, ships: ships, spec: spec,
      power: opts.power, cause: opts.cause, faction: opts.faction || 'brannoch', name: opts.name || 'Brannoch',
      units: [], startFoes: n, startMine: 0, stolen: {}, plunderT: 0, killed: 0, outcome: null
    };
    G.war = true;
    selected = null; shots = []; fx = [];
    muster();
    return true;
  }

  /* your soldiers come out of the castle and the barracks */
  function muster() {
    var G = SIM.G, sb = SIM.smithBonus(), vets = G.vets || {};
    var doors = G.buildings.filter(function (b) { return b.built && (b.id === 'castle' || b.id === 'barracks' || b.id === 'range'); });
    var i = 0;
    Object.keys(G.army).forEach(function (k) {
      var d = DATA.UNITS[k];
      for (var j = 0; j < G.army[k]; j++) {
        var door = doors[i++ % doors.length];
        var p = besideDoor(door);
        var isVet = j < (vets[k] || 0);
        war.units.push(mkUnit('mine', k, d, p.x + (Math.random() - .5) * 0.6, p.y + (Math.random() - .5) * 0.6, {
          vet: isVet, atk: sb.atk * (isVet ? 1.2 : 1), def: (isVet ? 2 : 0), hp: (1 + (G.happy - 50) / 400) * (isVet ? 1.22 : 1)
        }));
      }
    });
    war.startMine = war.units.length;
    // left to themselves they go and wait by the beach, between it and the town
    var c = G.buildings[0];
    war.rally = { x: (war.land.x * 2 + c.x + 1) / 3, y: (war.land.y * 2 + c.y + 1) / 3 };
    ['foot', 'bows', 'horse', 'siege'].forEach(function (s) { setOrder(s, 'engage'); });
  }
  function besideDoor(b) {
    var w = b.def.w || 1, h = b.def.h || 1;
    var opts = [[b.x + w, b.y + h - 1], [b.x + w - 1, b.y + h], [b.x - 1, b.y], [b.x, b.y - 1]];
    for (var i = 0; i < opts.length; i++) {
      var t = W.at(opts[i][0], opts[i][1]);
      if (t && W.walkable(t) && !t.bld) return { x: t.x + 0.5, y: t.y + 0.5 };
    }
    return { x: b.x + w + 0.5, y: b.y + h + 0.5 };
  }

  function landFoes() {
    var n = 0, spec = war.spec;
    Object.keys(spec).forEach(function (k) {
      var d = DATA.FOE_UNITS[k];
      for (var j = 0; j < spec[k]; j++) {
        var ang = (n++ / Math.max(1, war.startFoes)) * 6.28;
        var p = spreadOnLand(war.land.x + Math.cos(ang) * 0.8, war.land.y + Math.sin(ang) * 0.8);
        war.units.push(mkUnit('foe', k, d, p.x, p.y));
      }
    });
    war.phase = 'ashore';
  }
  function spreadOnLand(x, y) {
    var t = W.at(Math.floor(x), Math.floor(y));
    if (t && W.walkable(t)) return { x: x, y: y };
    return { x: war.land.x, y: war.land.y };
  }

  /* ---------------- orders ---------------- */
  function setOrder(squad, kind, x, y) {
    if (!war) return;
    war.units.forEach(function (u) {
      if (u.side !== 'mine' || u.dead || u.squad !== squad) return;
      u.order = { kind: kind, x: x, y: y };
      u.path = null; u.repath = 0; u.target = null;
    });
  }
  function orderAll(kind) {
    ['foot', 'bows', 'horse', 'siege'].forEach(function (s) {
      if (kind === 'hold') {
        war.units.forEach(function (u) { if (u.side === 'mine' && u.squad === s && !u.dead) { u.order = { kind: 'hold', x: u.x, y: u.y }; u.path = null; } });
      } else setOrder(s, kind);
    });
  }
  function orderAt(x, y) {
    if (!war || !selected) return false;
    // tapping near a raider means "go for that one"; anywhere else, "go there"
    var foe = nearest({ x: x, y: y }, 'foe', 1.2);
    setOrder(selected, foe ? 'attack' : 'move', x, y);
    if (foe) war.units.forEach(function (u) { if (u.side === 'mine' && u.squad === selected) u.target = foe; });
    return true;
  }
  function select(sq) { selected = selected === sq ? null : sq; }

  /* ---------------- the fight ---------------- */
  function alive(side) {
    var n = 0;
    for (var i = 0; i < war.units.length; i++) { var u = war.units[i]; if (!u.dead && !u.fled && u.side === side) n++; }
    return n;
  }
  function nearest(p, side, maxD) {
    var best = null, bd = (maxD || 1e9) * (maxD || 1e9);
    for (var i = 0; i < war.units.length; i++) {
      var o = war.units[i];
      if (o.dead || o.fled || o.side !== side) continue;
      var d = U.dist2(p.x, p.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function bldCentre(b) { return { x: b.x + (b.def.w || 1) / 2, y: b.y + (b.def.h || 1) / 2 }; }
  var LOOTABLE = { granary: { food: 1 }, warehouse: { wood: 0.5, stone: 0.5, iron: 0.3, cloth: 0.2 }, market: { gold: 1 }, castle: { gold: 1, food: 0.5 } };
  function pickTarget(u) {
    var best = null, bs = -1e9;
    SIM.G.buildings.forEach(function (b) {
      if (!b.built || b.def.isWall) return;
      var c = bldCentre(b), d = U.dist(u.x, u.y, c.x, c.y);
      var worth = LOOTABLE[b.id] ? 6 : b.id === 'house' ? 3 : 1;
      var score = worth - d * 0.8 - (b.fire ? 4 : 0);
      if (score > bs) { bs = score; best = b; }
    });
    return best;
  }

  function walkTo(u, tx, ty, dt, near) {
    var d = U.dist(u.x, u.y, tx, ty);
    if (d <= near) { u.path = null; return true; }
    u.repath -= dt;
    if (!u.path || u.repath <= 0) {
      u.repath = 1.2 + Math.random();
      var p = W.path(Math.floor(u.x), Math.floor(u.y), Math.floor(tx), Math.floor(ty), 500);
      u.path = p && p.length ? p : null; u.node = 0;
      if (!u.path) {
        // no way through: the raiders batter the nearest wall instead
        if (u.side === 'foe') { var wl = nearestWall(u); if (wl) u.target = wl; }
        stepToward(u, tx, ty, dt);
        return false;
      }
    }
    var n = u.path[u.node];
    if (!n) { u.path = null; return false; }
    var nx = n.x + 0.5, ny = n.y + 0.5, nd = U.dist(u.x, u.y, nx, ny);
    if (nd < 0.12) { u.node++; if (u.node >= u.path.length) u.path = null; return false; }
    var t = W.at(n.x, n.y);
    if (t && t.bld && !t.bld.def.isRoad && U.dist(u.x, u.y, tx, ty) < near + 1.2) { u.path = null; return true; }
    stepToward(u, nx, ny, dt);
    return false;
  }
  function stepToward(u, tx, ty, dt) {
    var dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy) || 1;
    var s = Math.min(d, u.spd * dt);
    u.x += dx / d * s; u.y += dy / d * s;
    u.face = (dx - dy) >= 0 ? 1 : -1;
    u.bob += s * 9;
    u.moving = true;
  }
  function nearestWall(u) {
    var best = null, bd = 1e9;
    SIM.G.buildings.forEach(function (b) {
      if (!b.built || !b.def.isWall) return;
      var d = U.dist(u.x, u.y, b.x + 0.5, b.y + 0.5);
      if (d < bd) { bd = d; best = b; }
    });
    return best;
  }

  function hit(src, tgt, mult) {
    var raw = src.atk * U.range(Math.random, 0.82, 1.2) * (mult || 1);
    // half the battle screen's pace, so there is time to give orders
    var dmg = raw * (12 / (12 + tgt.def)) * PACE;
    tgt.hp -= dmg; tgt.flash = 0.18;
    fx.push({ k: 'spark', x: tgt.x, y: tgt.y, life: 0.25 });
    if (tgt.hp <= 0 && !tgt.dead) {
      tgt.dead = true; tgt.fade = 1;
      if (tgt.side === 'foe') war.killed++;
      if (Math.random() < 0.5) U.sfx.death();
    }
  }
  function strikeBuilding(u, b) {
    // blows and torches: enough of them and the roof catches
    b._warDmg = (b._warDmg || 0) + u.atk;
    fx.push({ k: 'spark', x: b.x + 0.5, y: b.y + 0.5, life: 0.25, h: 0.3 });
    if (b.def.isWall) {
      if (b._warDmg > 70) { SIM.demolish(b); U.sfx.clash(); }
      return;
    }
    if (b._warDmg > 40 && !b.fire && SIM.fireRisk(b) > 0) SIM.ignite(b);
    var L = LOOTABLE[b.id];
    if (L) {
      Object.keys(L).forEach(function (k) {
        var take = Math.min(SIM.G.res[k], 4 * L[k]);
        if (take > 0) { SIM.G.res[k] -= take; war.stolen[k] = (war.stolen[k] || 0) + take; u.loot += take; }
      });
    }
  }

  function tick(dt) {
    if (!war) return;
    war.t += dt;
    if (war.phase === 'sail') {
      var there = true;
      war.ships.forEach(function (s) {
        var dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
        if (d > 0.05) { var st = Math.min(d, 0.55 * dt); s.x += dx / d * st; s.y += dy / d * st; s.face = (dx - dy) >= 0 ? 1 : -1; there = false; }
      });
      stepMine(dt);
      if (there) { landFoes(); SIM.emit('war-landed', war); }
      return;
    }
    if (war.phase === 'over') return;

    // towers and the keep shoot at anyone in reach
    SIM.G.buildings.forEach(function (b) {
      if (!b.built) return;
      var power = b.id === 'tower' ? 6 : b.id === 'castle' && SIM.G.castle > 0 ? 3 + SIM.G.castle * 2 : 0;
      if (!power) return;
      b._shootCd = (b._shootCd || Math.random()) - dt;
      if (b._shootCd > 0) return;
      var c = bldCentre(b), foe = nearest(c, 'foe', b.id === 'tower' ? 5 : 4);
      if (!foe) return;
      b._shootCd = 1.4;
      var mul = SIM.G.tech.fortification ? 1.6 : 1;
      shots.push({ x: c.x, y: c.y, h: b.id === 'tower' ? 1.3 : 1.0, tx: foe.x, ty: foe.y, t: 0, dur: 0.6, tgt: foe, atk: power * mul, from: 'tower' });
      U.sfx.arrow();
    });

    stepMine(dt);
    stepFoes(dt);

    // arrows and stones land
    for (var i = shots.length - 1; i >= 0; i--) {
      var p = shots[i];
      p.t += dt;
      if (p.t < p.dur) continue;
      if (p.tgt && !p.tgt.dead) {
        if (p.from === 'tower') { p.tgt.hp -= p.atk * (12 / (12 + p.tgt.def)) * PACE; p.tgt.flash = 0.18; if (p.tgt.hp <= 0 && !p.tgt.dead) { p.tgt.dead = true; war.killed++; } }
        else hit(p.src, p.tgt, 1);
      }
      if (p.big) {
        fx.push({ k: 'boom', x: p.tx, y: p.ty, life: 0.45 });
        war.units.forEach(function (o) { if (!o.dead && o.side === 'foe' && U.dist(o.x, o.y, p.tx, p.ty) < p.src.splash) hit(p.src, o, 0.55); });
      }
      shots.splice(i, 1);
    }
    for (var f = fx.length - 1; f >= 0; f--) { fx[f].life -= dt; if (fx[f].life <= 0) fx.splice(f, 1); }
    war.units.forEach(function (u) { if (u.dead) u.fade = Math.max(0, u.fade - dt * 0.35); if (u.flash > 0) u.flash -= dt; });

    // morale: a raid breaks when most of it is dead, or has taken enough
    var af = alive('foe');
    if (war.phase === 'ashore') {
      war.plunderT += dt;
      var took = 0; Object.keys(war.stolen).forEach(function (k) { took += war.stolen[k]; });
      if (af <= Math.max(0, Math.floor(war.startFoes * 0.3))) flee('broken');
      else if (war.plunderT > 55 || took > 60 + war.startFoes * 10) flee('plunder');
    }
    if (war.phase === 'fleeing') {
      var aboard = true;
      war.units.forEach(function (u) { if (u.side === 'foe' && !u.dead && !u.fled) aboard = false; });
      if (aboard || war.t - war.fleeAt > 25) end();
    }
  }

  function stepMine(dt) {
    war.units.forEach(function (u) {
      if (u.side !== 'mine' || u.dead) return;
      u.moving = false;
      u.cd -= dt;
      var o = u.order || { kind: 'engage' };
      if (o.kind === 'retreat') {
        var c = SIM.G.buildings[0], door = besideDoor(c);
        walkTo(u, door.x, door.y, dt, 0.6);
        u.hp = Math.min(u.maxHp, u.hp + dt * 1.5);
        return;
      }
      if (war.phase === 'sail') {
        var rp = o.kind === 'move' || o.kind === 'hold' ? { x: o.x, y: o.y } : war.rally;
        walkTo(u, rp.x, rp.y, dt, 0.8);
        return;
      }
      // who to fight: the one you were sent after, else whoever is near enough
      var reach = o.kind === 'hold' ? u.rng + 0.8 : o.kind === 'move' ? 2.5 : 8;
      var from = o.kind === 'hold' || o.kind === 'move' ? { x: o.x, y: o.y } : u;
      if (!u.target || u.target.dead || u.target.fled) {
        u.target = nearest(u, 'foe', u.ranged ? Math.max(u.rng, reach) : reach);
        if (u.target && o.kind !== 'engage' && o.kind !== 'attack' && U.dist(from.x, from.y, u.target.x, u.target.y) > reach + u.rng) u.target = null;
      }
      var e = u.target;
      if (e) {
        var d = U.dist(u.x, u.y, e.x, e.y);
        if (d > u.rng) {
          if (o.kind === 'hold' && !u.ranged) { u.target = null; return; }
          walkTo(u, e.x, e.y, dt, u.rng * 0.9);
        } else if (u.cd <= 0) {
          u.cd = u.rate * U.range(Math.random, 0.85, 1.15);
          u.face = (e.x - u.x) - (e.y - u.y) >= 0 ? 1 : -1;
          if (u.ranged) {
            shots.push({ x: u.x, y: u.y, h: 0.3, tx: e.x, ty: e.y, t: 0, dur: U.clamp(d / 9, 0.2, 0.8), src: u, tgt: e, big: u.splash > 0 });
            U.sfx.arrow();
          } else { hit(u, e); if (Math.random() < 0.3) U.sfx.clash(); }
        }
        return;
      }
      if (o.kind === 'move' || o.kind === 'hold') walkTo(u, o.x, o.y, dt, 0.5);
      else walkTo(u, war.rally.x, war.rally.y, dt, 1.2);
    });
  }

  function stepFoes(dt) {
    war.units.forEach(function (u) {
      if (u.side !== 'foe' || u.dead || u.fled) return;
      u.moving = false;
      u.cd -= dt;
      if (war.phase === 'fleeing') {
        if (walkTo(u, war.land.x, war.land.y, dt, 0.9)) u.fled = true;
        return;
      }
      // a soldier close by is dealt with first
      var enemy = nearest(u, 'mine', u.ranged ? u.rng : 1.8);
      if (enemy) {
        var d = U.dist(u.x, u.y, enemy.x, enemy.y);
        if (d > u.rng) walkTo(u, enemy.x, enemy.y, dt, u.rng * 0.9);
        else if (u.cd <= 0) {
          u.cd = u.rate * U.range(Math.random, 0.85, 1.15);
          if (u.ranged) shots.push({ x: u.x, y: u.y, h: 0.3, tx: enemy.x, ty: enemy.y, t: 0, dur: U.clamp(d / 9, 0.2, 0.8), src: u, tgt: enemy });
          else { hit(u, enemy); if (Math.random() < 0.3) U.sfx.clash(); }
        }
        return;
      }
      // otherwise: the town
      if (!u.target || (u.target.dead !== undefined) || SIM.G.buildings.indexOf(u.target) < 0 || (u.target.fire && Math.random() < dt * 0.3)) u.target = pickTarget(u);
      var b = u.target;
      if (!b) return;
      var c = bldCentre(b);
      var reach = Math.max(b.def.w || 1, b.def.h || 1) / 2 + 0.6;
      if (walkTo(u, c.x, c.y, dt, reach) || U.dist(u.x, u.y, c.x, c.y) <= reach + 0.2) {
        if (u.cd <= 0) { u.cd = u.rate * 1.3; strikeBuilding(u, b); }
      }
    });
  }

  function flee(why) {
    if (war.phase !== 'ashore') return;
    war.phase = 'fleeing'; war.fleeAt = war.t; war.why = why;
    SIM.emit('war-flee', { why: why });
  }

  /* ---------------- the reckoning ---------------- */
  function end() {
    var G = SIM.G;
    war.phase = 'over';
    var survivors = {}, lost = {}, lostN = 0;
    war.units.forEach(function (u) {
      if (u.side !== 'mine') return;
      if (u.dead) { lost[u.key] = (lost[u.key] || 0) + 1; lostN++; }
      else survivors[u.key] = (survivors[u.key] || 0) + 1;
    });
    var won = war.why === 'broken';
    var newVets = {};
    Object.keys(survivors).forEach(function (k) { newVets[k] = won ? survivors[k] : Math.min((G.vets || {})[k] || 0, survivors[k]); });
    G.vets = newVets;
    G.army = survivors;
    var res = { won: won, lost: lost, lostN: lostN, killed: war.killed, startFoes: war.startFoes, stolen: war.stolen, name: war.name, faction: war.faction, loot: {} };
    if (won) {
      G.stats.wins++; G.stats.raidsSurvived++;
      if (war.faction === 'brannoch') G.rival.str = Math.max(12, G.rival.str * 0.72);
      if (war.faction === 'brannoch') SIM.dipBattle(true, false);
      // what the fallen raiders carried is yours
      res.loot.gold = Math.round(30 + war.killed * 7);
      Object.keys(war.stolen).forEach(function (k) { res.loot[k] = (res.loot[k] || 0) + Math.round(war.stolen[k] * 0.5); });
      Object.keys(res.loot).forEach(function (k) { G.res[k] = Math.min(SIM.cap(k), G.res[k] + res.loot[k]); });
      G.happy = U.clamp(G.happy + 9, 0, 100);
      U.sfx.victory();
    } else {
      G.stats.losses++;
      if (war.faction === 'brannoch') G.rival.str += 6;
      if (war.faction === 'brannoch') SIM.dipBattle(false, false);
      G.happy = U.clamp(G.happy - 12, 0, 100);
      U.sfx.defeat();
    }
    G.war = false;
    var result = res;
    war = null; shots = []; selected = null;
    SIM.emit('army');
    SIM.checkQuests();
    SIM.emit('war-over', result);
  }

  /* ---------------- drawing ---------------- */
  var FACTION = {
    brannoch: { sail: '#9c3b2c', stripe: '#e8dcc0', shirt: '#9c3b2c', shield: '#7a2a1e' },
    wolves: { sail: '#2a2a30', stripe: '#c8c8c8', shirt: '#3a3a44', shield: '#1e1e24' }
  };
  var MINE = { shirt: '#3f6ea5', shield: '#2d5c96', trim: '#9dc0e8' };

  function drawShip(g, s, px, py, z) {
    var fc = FACTION[war ? war.faction : 'brannoch'] || FACTION.brannoch;
    var L = z * 0.5, rock = Math.sin((war ? war.t : 0) * 1.6 + s.x) * 0.05;
    g.save(); g.translate(px, py); g.rotate(rock); g.scale(s.face, 1);
    g.fillStyle = 'rgba(10,30,50,.3)'; g.beginPath(); g.ellipse(0, 2, L, L * 0.2, 0, 0, 6.3); g.fill();
    // a long, low hull with a carved prow
    g.fillStyle = '#4a3020';
    g.beginPath(); g.moveTo(-L, -L * 0.2); g.quadraticCurveTo(0, L * 0.18, L, -L * 0.22);
    g.quadraticCurveTo(L * 1.15, -L * 0.5, L * 1.05, -L * 0.62); g.lineTo(L * 0.9, -L * 0.3); g.lineTo(-L * 0.9, -L * 0.3);
    g.lineTo(-L * 1.05, -L * 0.55); g.closePath(); g.fill();
    // a row of shields along the side
    for (var i = -3; i <= 3; i++) {
      g.fillStyle = i % 2 ? fc.shield : '#c8b070';
      g.beginPath(); g.arc(i * L * 0.24, -L * 0.28, L * 0.08, 0, 6.3); g.fill();
    }
    g.strokeStyle = '#2a1c12'; g.lineWidth = Math.max(1.5, L * 0.05);
    g.beginPath(); g.moveTo(0, -L * 0.3); g.lineTo(0, -L * 1.5); g.stroke();
    g.fillStyle = fc.sail;
    g.fillRect(-L * 0.42, -L * 1.4, L * 0.84, L * 0.8);
    g.fillStyle = fc.stripe;
    for (var j = 0; j < 3; j++) g.fillRect(-L * 0.42 + j * L * 0.3, -L * 1.4, L * 0.14, L * 0.8);
    g.restore();
  }

  function drawUnit(g, u, px, py, z) {
    var c = u.side === 'mine' ? MINE : (FACTION[war.faction] || FACTION.brannoch);
    var s = Math.max(0.6, z / 50) * 1.05;
    g.globalAlpha = u.dead ? u.fade * 0.8 : 1;
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.beginPath(); g.ellipse(px + 2 * s, py, 5 * s, 1.8 * s, 0, 0, 6.3); g.fill();
    if (u.dead) {
      g.fillStyle = c.shirt; g.beginPath(); g.ellipse(px, py - 1.5 * s, 5.5 * s, 2 * s, 0.2, 0, 6.3); g.fill();
      g.globalAlpha = 1; return;
    }
    if (u.side === 'mine' && selected && u.squad === selected) {
      g.strokeStyle = 'rgba(240,215,110,.9)'; g.lineWidth = 1.6;
      g.beginPath(); g.ellipse(px, py, 7 * s, 3 * s, 0, 0, 6.3); g.stroke();
    }
    var step = Math.sin(u.bob), bob = u.moving ? Math.abs(step) * s : 0, y0 = py - bob;
    var mounted = u.key === 'knight';
    if (mounted) {
      g.fillStyle = u.flash > 0 ? '#fff' : '#7a5634';
      g.beginPath(); g.ellipse(px, y0 - 6 * s, 7 * s, 3 * s, 0, 0, 6.3); g.fill();
      g.strokeStyle = '#3d2c1c'; g.lineWidth = 1.4 * s;
      g.beginPath(); g.moveTo(px - 4 * s, y0 - 4 * s); g.lineTo(px - 4 * s + step * 2 * s, py); g.moveTo(px + 4 * s, y0 - 4 * s); g.lineTo(px + 4 * s - step * 2 * s, py); g.stroke();
      g.fillStyle = c.shield; g.fillRect(px - 6 * s, y0 - 7 * s, 12 * s, 3 * s);
      y0 -= 6 * s;
    } else {
      g.strokeStyle = '#3b2e22'; g.lineWidth = 1.5 * s;
      g.beginPath(); g.moveTo(px - 1.2 * s, y0 - 4.5 * s); g.lineTo(px - 1.2 * s + (u.moving ? step * 2 * s : 0), py);
      g.moveTo(px + 1.2 * s, y0 - 4.5 * s); g.lineTo(px + 1.2 * s - (u.moving ? step * 2 * s : 0), py); g.stroke();
    }
    g.fillStyle = u.flash > 0 ? '#fff' : c.shirt;
    g.fillRect(px - 3 * s, y0 - 10 * s, 6 * s, 6 * s);
    g.fillStyle = u.flash > 0 ? '#fff' : '#e8c39a';
    g.beginPath(); g.arc(px, y0 - 12 * s, 2.2 * s, 0, 6.3); g.fill();
    g.fillStyle = u.side === 'foe' ? '#6b6f78' : '#8c93a0';
    g.beginPath(); g.arc(px, y0 - 12.6 * s, 2.4 * s, Math.PI, 0); g.fill();
    if (u.side === 'foe' && (u.key === 'axeman' || u.key === 'champion')) {
      g.strokeStyle = '#e8dcc0'; g.lineWidth = 0.9 * s;
      g.beginPath(); g.moveTo(px - 2 * s, y0 - 13.5 * s); g.lineTo(px - 3.4 * s, y0 - 16 * s); g.moveTo(px + 2 * s, y0 - 13.5 * s); g.lineTo(px + 3.4 * s, y0 - 16 * s); g.stroke();
    }
    var dir = u.face;
    if (u.ranged) {
      g.strokeStyle = '#6b4a2e'; g.lineWidth = 1 * s;
      g.beginPath(); g.arc(px + dir * 3.5 * s, y0 - 8 * s, 3.4 * s, dir > 0 ? -1.2 : Math.PI - 1.2, dir > 0 ? 1.2 : Math.PI + 1.2); g.stroke();
    } else {
      g.fillStyle = c.shield; g.beginPath(); g.arc(px + dir * 2.8 * s, y0 - 7.5 * s, 2.5 * s, 0, 6.3); g.fill();
      var sw = u.target && !u.moving ? Math.sin((war ? war.t : 0) * 10 + u.x * 3) : 0;
      g.strokeStyle = '#d8dde5'; g.lineWidth = 1 * s;
      g.beginPath(); g.moveTo(px - dir * 2.5 * s, y0 - 8 * s); g.lineTo(px - dir * (2.5 + 6 * Math.cos(-1.9 + sw)) * s, y0 - 8 * s + 6 * Math.sin(-1.9 + sw) * s); g.stroke();
    }
    if (u.loot > 0) { g.fillStyle = '#d9bf55'; g.beginPath(); g.ellipse(px - dir * 3 * s, y0 - 10 * s, 2.4 * s, 2 * s, 0, 0, 6.3); g.fill(); }
    if (u.vet) { g.strokeStyle = '#e0b23c'; g.lineWidth = 1 * s; g.beginPath(); g.moveTo(px - 2 * s, y0 - 16 * s); g.lineTo(px, y0 - 17.4 * s); g.lineTo(px + 2 * s, y0 - 16 * s); g.stroke(); }
    if (u.hp < u.maxHp) {
      var w = 9 * s, hp = U.clamp(u.hp / u.maxHp, 0, 1), hy = y0 - 18 * s;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(px - w / 2, hy, w, 1.8 * s);
      g.fillStyle = u.side === 'mine' ? '#7dd45a' : '#e0795f'; g.fillRect(px - w / 2, hy, w * hp, 1.8 * s);
    }
    g.globalAlpha = 1;
  }

  function drawShots(g, toScreen, z) {
    shots.forEach(function (p) {
      var k = p.t / p.dur;
      var x = U.lerp(p.x, p.tx, k), y = U.lerp(p.y, p.ty, k);
      var lift = (p.h || 0.3) * (1 - k) + Math.sin(k * Math.PI) * (p.big ? 1.2 : 0.6);
      var gs = toScreen(x, y), s = { x: gs.x, y: gs.y - lift * z * 0.56 };
      g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(gs.x, gs.y, p.big ? 3 : 1.6, p.big ? 1.2 : 0.7, 0, 0, 6.3); g.fill();
      if (p.big) { g.fillStyle = '#6b665c'; g.beginPath(); g.arc(s.x, s.y, Math.max(2, z * 0.05), 0, 6.3); g.fill(); return; }
      var k2 = Math.min(1, k + 0.06), x2 = U.lerp(p.x, p.tx, k2), y2 = U.lerp(p.y, p.ty, k2);
      var lift2 = (p.h || 0.3) * (1 - k2) + Math.sin(k2 * Math.PI) * 0.6;
      var n2 = toScreen(x2, y2); n2.y -= lift2 * z * 0.56;
      var a = Math.atan2(n2.y - s.y, n2.x - s.x), L = Math.max(5, z * 0.12);
      g.strokeStyle = '#4a3524'; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - Math.cos(a) * L, s.y - Math.sin(a) * L); g.stroke();
    });
    fx.forEach(function (f) {
      var s = toScreen(f.x, f.y);
      if (f.k === 'spark') {
        g.globalAlpha = U.clamp(f.life * 4, 0, 1); g.fillStyle = '#ffe9a8';
        for (var i = 0; i < 3; i++) { var a = i * 2.1 + f.life * 8; g.fillRect(s.x + Math.cos(a) * 4, s.y - 8 + Math.sin(a) * 4, 2, 2); }
        g.globalAlpha = 1;
      } else if (f.k === 'boom') {
        g.globalAlpha = U.clamp(f.life * 2.2, 0, 1); g.fillStyle = '#f2b45a';
        g.beginPath(); g.arc(s.x, s.y - 4, (0.45 - f.life) * z * 1.1 + 4, 0, 6.3); g.fill(); g.globalAlpha = 1;
      }
    });
  }

  function squads() {
    var out = {};
    if (!war) return out;
    war.units.forEach(function (u) {
      if (u.side !== 'mine' || u.dead) return;
      out[u.squad] = (out[u.squad] || 0) + 1;
    });
    return out;
  }

  return {
    begin: begin, tick: tick, orderAt: orderAt, orderAll: orderAll, select: select, squads: squads,
    drawUnit: drawUnit, drawShip: drawShip, drawShots: drawShots, SQUADS: SQUADS,
    get active() { return !!war; }, get state() { return war; }, get selected() { return selected; },
    alive: function (side) { return war ? alive(side) : 0; }
  };
})();
