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
for (const f of ['util', 'data', 'world', 'sim', 'folk', 'steward', 'court', 'agents']) {
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
  ['barracks', 1], ['house', 3], ['tower', 2], ['farm', 3], ['bakery', 2], ['pasture', 3], ['weaver', 2]
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
  SIM.newGame(seed, { map: process.argv[4] || 'green', diff: process.argv[3] || 'fair', scen: process.argv[5] || 'standard' });
  const G = SIM.G;
  const rec = { playing: 0, atCap: 0, wonAt: 99, battles: 0, battleWins: 0, starved: 0, broke: 0, raids: 0, minFood: 1e9, minGold: 1e9, churn: 0, reached: [0, 99, 99, 99, 99] };
  let lastTiers = null;
  let step = 0, sinceBuild = 0;
  const DT = 0.5, ticks = Math.round(seasons * DATA.SEASON_LEN / DT);

  SIM.on(k => { if (k === 'raid-incoming') rec.raids++; });
  // a stuck realm is offered the vault; any player would take it
  SIM.on(k => { if (k === 'relief' && SIM.G === G) { G.res.gold += 120; G.res.wood += 60; G.res.stone += 40; rec.reliefs = (rec.reliefs || 0) + 1; } });
  // every kingdom follows its own copy of the plan: counting down a shared
  // one left every kingdom after the first with a plan of single buildings
  const plan = PLAN.map(p => p.slice());
  // 'steward' as the sixth argument: the Village Growth steward builds instead
  // of the scripted plan, and the harness only does what a ruler would still do
  const STEWARDED = process.argv[6] === 'steward';
  if (STEWARDED) { SIM.G.grow = { mode: 'steward', reserve: 120, focus: 'balanced', clear: {}, log: [] }; }

  for (let i = 0; i < ticks; i++) {
    SIM.tick(DT);
    // finish construction instantly so we measure economy, not build queues
    let fin = false;
    G.buildings.forEach(b => { if (!b.built) { b.built = true; b.prog = 1; fin = true; } });
    if (fin) SIM.refreshCounts();
    // a rich treasury buys what the builders are short of, as a player would
    if (SIM.canTrade() && G.res.gold > SIM.cap('gold') * 0.8) {
      for (const k of ['wood', 'stone']) if (G.res[k] < SIM.cap(k) * 0.5) SIM.buy(k, 1);
    }
    // research whatever is available and affordable
    if (!STEWARDED && !G.research) {
      for (const t of Object.keys(DATA.TECH)) {
        if (SIM.techAvailable(t) && SIM.canAfford(DATA.TECH[t].cost)) { SIM.startResearch(t); break; }
      }
    }
    // raise the castle when the realm can spare it, as a player would
    const nc = SIM.nextCastle();
    if (!STEWARDED && nc && SIM.canAfford(nc.cost) && G.res.gold > nc.cost.gold + 120) SIM.upgradeCastle();
    // a player's other habits, from Chapter IV on: raise soldiers, clear the
    // bandit camp now and then, and pour spare gold into great works
    const chN0 = G.chapter || 0;
    if (chN0 >= 3 && SIM.armyCount() < 14 && G.res.gold > 160 && Math.random() < 0.05) {
      const kind = ['spearman', 'archer', 'militia'].find(k => SIM.unitAvailable(k)) || 'militia';
      SIM.recruit(kind, 1);
    }
    if (chN0 >= 3 && SIM.armyCount() >= 6 && SIM.banditReady()) {
      G.banditAt = G.time; const r = SIM.autoBattle({ power: SIM.banditPower(), flavour: 'bandits' });
      rec.battles++; if (r.won) rec.battleWins++;
    }
    if (G.workNow && (G.res.wood < 80 || G.res.stone < 80)) G.workNow = null;   // never starve the builders
    if (!STEWARDED && !G.workNow && G.res.gold > SIM.cap('gold') * 0.7 && G.res.wood > 150 && G.res.stone > 150) {
      const w = Object.keys(DATA.PROJECTS).find(id => !SIM.done(id) && SIM.workAvailable(id));
      if (w) SIM.startWork(w);
    }
    if (chN0 >= 4 && !SIM.countAll('cathedral') && SIM.unlocked('cathedral') && SIM.canAfford(SIM.costOf('cathedral'))) place('cathedral', 1);
    if (!G.won) { rec.playing += DT; if (G.res.gold >= SIM.cap('gold') * 0.98) rec.atCap += DT; }
    if (G.won && rec.wonAt === 99) rec.wonAt = (i * DT) / DATA.SEASON_LEN;
    // follow the build plan whenever it is affordable
    sinceBuild += DT;
    if (!STEWARDED && step < plan.length && sinceBuild > 4) {
      const [id, n] = plan[step];
      if (SIM.unlocked(id) && SIM.canAfford(SIM.costOf(id))) {
        if (place(id, 1) > 0) {
          plan[step] = [id, n - 1];
          if (n - 1 <= 0) step++;
          sinceBuild = 0;
        } else step++;        // nowhere to put it on this island: move on
      }
    }
    // housing churn: how often homes change standing. High numbers mean the
    // tiers are flickering rather than settling.
    const tiers = G.buildings.filter(b => b.def.evolves && b.built).map(b => b.level || 1).join(',');
    if (lastTiers !== null && tiers !== lastTiers) rec.churn++;
    lastTiers = tiers;
    const chN = G.chapter || 0;
    if (rec.reached[chN] === 99) rec.reached[chN] = (i * DT) / DATA.SEASON_LEN;
    if (G.res.food <= 0.5) rec.starved += DT;
    if (G.res.gold <= 1) rec.broke += DT;
    rec.minFood = Math.min(rec.minFood, G.res.food);
    rec.minGold = Math.min(rec.minGold, G.res.gold);
  }

  const net = SIM.ledger();
  return {
    pop: G.pop, happy: G.happy, housing: SIM.housing(),
    tier: SIM.G.buildings.filter(b=>b.def.evolves&&b.built).reduce((a,b)=>a+(b.level||1),0) / Math.max(1,SIM.countHouseTier(1)),
    gold: net.gold, food: SIM.foodTrend ? SIM.foodTrend(net) : net.food,
    goods: SIM.goodsValue(),
    tech: G.stats.techDone,
    starvedPct: rec.starved / (seasons * DATA.SEASON_LEN) * 100,
    brokePct: rec.broke / (seasons * DATA.SEASON_LEN) * 100,
    raids: rec.raids, minFood: rec.minFood, minGold: rec.minGold,
    churn: rec.churn / seasons,
    bread: G.breadCov || 0, cloth: G.res.cloth, foodStock: G.res.food,
    burned: G.stats.burned || 0, firesOut: G.stats.firesOut || 0,
    fever: G.stats.fever || 0, oldAge: G.stats.oldAge || 0, folkOk: (G.folk || []).length === Math.max(1, Math.floor(G.pop + 1e-6)) ? 1 : 0,
    chapter: (G.chapter || 0) + 1,
    ch2: rec.reached[1], ch3: rec.reached[2], ch4: rec.reached[3], ch5: rec.reached[4], wonAt: rec.wonAt,
    won: G.won ? 1 : 0,
    capPct: rec.atCap / Math.max(1, rec.playing) * 100, works: G.stats.works || 0,
    battles: rec.battles, battleWins: rec.battleWins, army: SIM.armyCount()
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
  row('food /s (over a year)', 'food', 2);
  row('goods value /s', 'goods', 2);
  row('technologies', 'tech', 1);
  row('raids faced', 'raids', 1);
  row('% time starving', 'starvedPct', 1);
  row('% time broke', 'brokePct', 1);
  row('lowest food seen', 'minFood', 0);
  row('lowest gold seen', 'minGold', 0);
  row('housing changes/season', 'churn', 2);
  row('buildings lost to fire', 'burned', 1);
  row('fires put out', 'firesOut', 1);
  row('died of fever', 'fever', 1);
  row('died of old age', 'oldAge', 1);
  row('register matches head count', 'folkOk', 2);
  row('bread coverage', 'bread', 2);
  row('cloth in store', 'cloth', 0);
  row('food in store', 'foodStock', 0);
  row('chapter reached', 'chapter', 1);
  row('season chapter II opens', 'ch2', 1);
  row('season chapter III opens', 'ch3', 1);
  row('season chapter IV opens', 'ch4', 1);
  row('season chapter V opens', 'ch5', 1);
  row('season the reign is won', 'wonAt', 1);
  row('share of reigns won', 'won', 2);
  row('% of the reign gold at cap', 'capPct', 1);
  row('great works finished', 'works', 1);
  row('bandit battles fought', 'battles', 1);
  row('bandit battles won', 'battleWins', 1);
  row('soldiers at the end', 'army', 1);

  console.log('\n  health checks:');
  const chk = (ok, msg) => console.log('   ' + (ok ? 'PASS' : 'FAIL') + '  ' + msg);
  chk(avg('starvedPct') < 8, 'kingdoms are not starving for long stretches (<8% of the time)');
  chk(avg('brokePct') < 12, 'kingdoms are not stuck at zero gold (<12% of the time)');
  chk(avg('gold') > 0, 'a followed build order ends gold-positive');
  chk(avg('food') > 0, 'a followed build order ends food-positive');
  chk(avg('tier') > 1.2, 'homes get past cottages');
  chk(avg('churn') < 1.0, 'house standings settle rather than flicker (<1 change per season)');
  chk(all.every(r => isFinite(r.pop) && isFinite(r.gold)), 'no NaN anywhere in the economy');
  chk(avg('ch3') < 20, 'the story moves: chapter III opens within 20 seasons (5 years)');
  chk(avg('burned') < 3, 'fire is a danger, not a plague (<3 buildings lost in 10 years, nobody fighting it)');
  chk(avg('fever') < 12, 'fever is a worry, not a cull (<12 deaths in 10 years with no physician)');
  chk(all.every(r => r.folkOk), 'every head the economy counts has a name');
  chk(avg('ch4') < 16 && max('ch4') < 26, 'Chapter IV opens within 16 seasons, and never later than 26');
  chk(all.filter(r => r.ch5 < 99).length >= all.length * 0.75, 'three kingdoms in four reach Chapter V');
  chk(avg('capPct') < 30, 'gold is not left sitting at its cap while the reign is on (<30%)');
  chk(avg('won') >= 0.8, 'at least four reigns in five are won within ten years');
  chk(all.filter(r => r.won).reduce((a, r) => a + r.wonAt, 0) / Math.max(1, all.filter(r => r.won).length) > 16, 'reigns are not won in a rush (over 4 years on average)');
  chk(avg('happy') < 92, 'contentment is earned, not automatic (average under 92%)');
  chk(max('burned') <= 8, 'no single kingdom is burned flat by bad luck (≤8 buildings lost)');
  return all;
}

if (require.main === module) {
  const runs = parseInt(process.argv[2] || '24', 10);
  paybackTable();
  simulate(runs, 40);
} else {
  module.exports = { runKingdom, SIM, DATA, W };
}
console.log('');
