#!/usr/bin/env node
/* ============================================================
   tools/balance.js — measure the economy instead of guessing.

   Loads the real game code headlessly (no browser), builds a
   scripted kingdom many times over, and reports what actually
   happens. Run it before and after any balance change.

       node tools/balance.js            # default 24 runs
       node tools/balance.js 60         # more runs, tighter numbers
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

/* --- the smallest stub that lets sim.js run outside a browser --- */
global.window = {};
global.performance = { now: () => Date.now() };
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {} }) }),
  addEventListener: () => {}
};
// node already provides navigator; util.js only probes navigator.vibrate

// runInThisContext, not eval: a strict-mode eval keeps its declarations to
// itself, so the game's globals would never appear.
for (const f of ['util', 'data', 'world', 'sim', 'agents']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
}
const { U, DATA, W, SIM, AGENTS } = global;

const VALUE = { gold: 1, food: 1.0, wood: 1.3, stone: 1.85, iron: 3.6, tools: 5.2, bread: 2.4, wool: 2.1, cloth: 6.5 };
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6, dp = 2) => String(typeof v === 'number' ? v.toFixed(dp) : v).padStart(n);

/* ------------------------------------------------------------
   1. Static payback: cost in gold-equivalent over net output
   ------------------------------------------------------------ */
function paybackTable() {
  const rows = [];
  for (const id of Object.keys(DATA.B)) {
    const def = DATA.B[id];
    if (def.isRoad || def.unique) continue;
    const cost = Object.entries(def.cost || {}).reduce((a, [k, v]) => a + v * (VALUE[k] || 1), 0);
    let out = 0;
    for (const [k, v] of Object.entries(def.produces || {})) out += v * (VALUE[k] || 1);
    for (const [k, v] of Object.entries(def.consumes || {})) out -= v * (VALUE[k] || 1);
    out -= def.upkeep || 0;
    rows.push({ name: def.name, cost, out, jobs: def.jobs || 0, payback: out > 0 ? cost / out : null });
  }
  rows.sort((a, b) => (a.payback ?? 1e9) - (b.payback ?? 1e9));
  console.log('\n=== PAYBACK (gold-equivalent cost / net output per second, full staff) ===');
  console.log(pad('building', 16) + num('cost', 7, 0) + num('net/s', 8, 3) + '  jobs   payback');
  for (const r of rows) {
    console.log(pad(r.name, 16) + num(r.cost, 7, 0) + num(r.out, 8, 3) +
      num(r.jobs, 6, 0) + '   ' + (r.payback ? Math.round(r.payback) + 's' : '—'));
  }
  // A converter's worth is systemic — tools lift every trade in the realm,
  // bread saves more grain than the bakery eats — so raw output payback
  // badly misjudges them. Compare extractors only.
  const CONVERTERS = ['Blacksmith', 'Bakery', 'Weaver'];
  const extractors = rows.filter(r => r.payback && !CONVERTERS.includes(r.name));
  if (extractors.length > 1) {
    const best = extractors[0], worst = extractors[extractors.length - 1];
    const ratio = worst.payback / best.payback;
    console.log(`\n  extractor spread: ${best.name} ${Math.round(best.payback)}s … ` +
      `${worst.name} ${Math.round(worst.payback)}s (${ratio.toFixed(1)}×)` +
      (ratio > 6 ? '   <-- WIDE: the slow ones may be dead content' : '   ok'));
    console.log('  converters (' + CONVERTERS.join(', ') + ') are judged by the simulation below,');
    console.log('  not by this table — their return is a realm-wide multiplier, not their own output.');
  }
}

/* ------------------------------------------------------------
   2. Simulated kingdoms
   ------------------------------------------------------------ */
/* A plan a reasonable player would actually follow: food first and food
   often, since winter is the thing that kills young kingdoms. */
const PLAN = [
  ['house', 3], ['farm', 4], ['lumber', 2], ['granary', 1], ['quarry', 1],
  ['market', 1], ['well', 2], ['house', 3], ['farm', 3], ['fishery', 2],
  ['bakery', 2], ['chapel', 1], ['tavern', 1], ['library', 1], ['house', 3],
  ['farm', 3], ['pasture', 2], ['weaver', 1], ['market', 1], ['warehouse', 1],
  ['barracks', 1], ['house', 3], ['tower', 2], ['farm', 3], ['pasture', 3], ['weaver', 2]
];

function place(id, n) {
  const c = SIM.G.buildings[0];
  let made = 0;
  for (let r = 1; r < 12 && made < n; r++) {
    for (let dx = -r; dx <= r && made < n; dx++) {
      for (let dy = -r; dy <= r && made < n; dy++) {
        if (SIM.place(id, c.x + dx, c.y + dy).ok) made++;
      }
    }
  }
  return made;
}

function runKingdom(seed, seasons) {
  SIM.newGame(seed);
  const G = SIM.G;
  const rec = { starved: 0, broke: 0, raids: 0, minFood: 1e9, minGold: 1e9, churn: 0 };
  let lastTiers = null;
  let step = 0, sinceBuild = 0;
  const DT = 0.5, ticks = Math.round(seasons * DATA.SEASON_LEN / DT);

  SIM.on(k => { if (k === 'raid-incoming') rec.raids++; });

  for (let i = 0; i < ticks; i++) {
    SIM.tick(DT);
    // finish construction instantly so we measure economy, not build queues
    G.buildings.forEach(b => { if (!b.built) { b.built = true; b.prog = 1; } });
    // research whatever is available and affordable
    if (!G.research) {
      for (const t of Object.keys(DATA.TECH)) {
        if (SIM.techAvailable(t) && SIM.canAfford(DATA.TECH[t].cost)) { SIM.startResearch(t); break; }
      }
    }
    // follow the build plan whenever it is affordable
    sinceBuild += DT;
    if (step < PLAN.length && sinceBuild > 4) {
      const [id, n] = PLAN[step];
      if (SIM.unlocked(id) && SIM.canAfford(SIM.costOf(id))) {
        if (place(id, 1) > 0) {
          PLAN[step] = [id, n - 1];
          if (n - 1 <= 0) { step++; PLAN[step - 1] = [id, n]; }
          sinceBuild = 0;
        }
      }
    }
    // housing churn: how often homes change standing. High numbers mean the
    // tiers are flickering rather than settling.
    const tiers = G.buildings.filter(b => b.def.evolves && b.built).map(b => b.level || 1).join(',');
    if (lastTiers !== null && tiers !== lastTiers) rec.churn++;
    lastTiers = tiers;
    if (G.res.food <= 0.5) rec.starved += DT;
    if (G.res.gold <= 1) rec.broke += DT;
    rec.minFood = Math.min(rec.minFood, G.res.food);
    rec.minGold = Math.min(rec.minGold, G.res.gold);
  }

  const net = SIM.ledger();
  return {
    pop: G.pop, happy: G.happy, housing: SIM.housing(),
    tier: SIM.G.buildings.filter(b=>b.def.evolves&&b.built).reduce((a,b)=>a+(b.level||1),0) / Math.max(1,SIM.countHouseTier(1)),
    gold: net.gold, food: net.food,
    goods: SIM.goodsValue(),
    tech: G.stats.techDone,
    starvedPct: rec.starved / (seasons * DATA.SEASON_LEN) * 100,
    brokePct: rec.broke / (seasons * DATA.SEASON_LEN) * 100,
    raids: rec.raids, minFood: rec.minFood, minGold: rec.minGold,
    churn: rec.churn / seasons
  };
}

function simulate(runs, seasons) {
  console.log(`\n=== ${runs} KINGDOMS, ${seasons} SEASONS EACH (scripted build order) ===`);
  const all = [];
  for (let i = 0; i < runs; i++) all.push(runKingdom(1000 + i * 7919, seasons));
  const avg = k => all.reduce((a, r) => a + r[k], 0) / all.length;
  const min = k => Math.min(...all.map(r => r[k]));
  const max = k => Math.max(...all.map(r => r[k]));
  const row = (label, k, dp = 1) =>
    console.log('  ' + pad(label, 22) + num(avg(k), 8, dp) + '   (' + num(min(k), 7, dp) + ' … ' + num(max(k), 7, dp) + ' )');

  row('population', 'pop');
  row('housing', 'housing');
  row('contentment', 'happy');
  row('house standing', 'tier', 2);
  row('gold /s', 'gold', 2);
  row('food /s', 'food', 2);
  row('goods value /s', 'goods', 2);
  row('technologies', 'tech', 1);
  row('raids faced', 'raids', 1);
  row('% time starving', 'starvedPct', 1);
  row('% time broke', 'brokePct', 1);
  row('lowest food seen', 'minFood', 0);
  row('lowest gold seen', 'minGold', 0);
  row('housing changes/season', 'churn', 2);

  console.log('\n  health checks:');
  const chk = (ok, msg) => console.log('   ' + (ok ? 'PASS' : 'FAIL') + '  ' + msg);
  chk(avg('starvedPct') < 8, 'kingdoms are not starving for long stretches (<8% of the time)');
  chk(avg('brokePct') < 12, 'kingdoms are not stuck at zero gold (<12% of the time)');
  chk(avg('gold') > 0, 'a followed build order ends gold-positive');
  chk(avg('food') > 0, 'a followed build order ends food-positive');
  chk(avg('tier') > 1.2, 'homes get past cottages');
  chk(avg('churn') < 1.0, 'house standings settle rather than flicker (<1 change per season)');
  chk(all.every(r => isFinite(r.pop) && isFinite(r.gold)), 'no NaN anywhere in the economy');
  return all;
}

const runs = parseInt(process.argv[2] || '24', 10);
paybackTable();
simulate(runs, 40);
console.log('');
