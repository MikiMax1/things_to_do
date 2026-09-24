/* ============================================================
   honours.js — how the reign will be remembered.
   A running score for the realm, a ledger of how it has grown
   season by season, and honours that stay earned from one reign
   to the next (kept in this browser, apart from any one save).
   ============================================================ */
var HONOURS = (function () {
  'use strict';

  var KEY = 'ashveil.honours', BEST = 'ashveil.best';

  function G() { return SIM.G; }
  function fq(n) { return typeof FOLK !== 'undefined' ? n : 0; }

  /* ---------------- the score ---------------- */
  function parts() {
    var g = G(), s = g.stats;
    var built = g.buildings.filter(function (b) { return b.built; }).length;
    var outposts = g.sea ? g.sea.spots.filter(function (p) { return p.outpost; }).length : 0;
    var known = typeof EXPLORE !== 'undefined' ? EXPLORE.known() : 1;
    var fine = g.buildings.filter(function (b) { return b.def.evolves && (b.level || 1) >= 2; }).length;
    return [
      ['People', Math.floor(g.pop) * 12],
      ['Buildings', built * 6],
      ['Fine homes', fine * 15],
      ['Contentment', Math.round(g.happy * 3)],
      ['Chapters', (g.chapter || 0) * 180 + (g.won ? 1200 : 0)],
      ['Battles won', s.wins * 45],
      ['Discoveries', s.techDone * 25],
      ['Island known', Math.round(known * 250)],
      ['Outposts', outposts * 120],
      ['Treaties', typeof SIM.dip === 'function' ? (SIM.dip().ally ? 300 : SIM.dip().pact >= 0 ? 120 : 0) : 0]
    ];
  }
  function score() {
    var raw = parts().reduce(function (a, p) { return a + p[1]; }, 0);
    return Math.round(raw * SIM.diff().score);
  }

  /* ---------------- the ledger ---------------- */
  function record() {
    var g = G();
    if (!g.hist) g.hist = [];
    g.hist.push({
      s: SIM.seasonIndex(), pop: Math.floor(g.pop), gold: Math.round(g.res.gold), food: Math.round(g.res.food),
      happy: Math.round(g.happy), army: SIM.armyCount(), score: score()
    });
    if (g.hist.length > 120) g.hist.shift();
  }

  /* ---------------- honours ---------------- */
  var LIST = [
    { id: 'village',  ic: '🏘️', name: 'A Village',          desc: 'Reach Chapter II.',                          test: function (g) { return g.chapter >= 1; } },
    { id: 'town',     ic: '🏙️', name: 'Township',           desc: 'Grow to 50 people.',                         test: function (g) { return g.pop >= 50; } },
    { id: 'city',     ic: '🏰', name: 'City on the Sea',    desc: 'Grow to 110 people.',                        test: function (g) { return g.pop >= 110; } },
    { id: 'joy',      ic: '🎉', name: 'Merry Ashveil',      desc: 'Contentment of 90% or more.',                test: function (g) { return g.happy >= 90; } },
    { id: 'shield',   ic: '🛡️', name: 'Shield of the Isle', desc: 'Survive 5 raids.',                           test: function (g) { return g.stats.raidsSurvived >= 5; } },
    { id: 'gate',     ic: '🚪', name: 'Through the Gate',   desc: 'Storm Brannoch\'s town.',                    test: function (g) { return !!g.tribute || !!g._stormed; } },
    { id: 'wedding',  ic: '💍', name: 'Wedding of the Age', desc: 'Bind Brannoch with a royal marriage.',       test: function (g) { return !!(g.dip && g.dip.ally); } },
    { id: 'haven',    ic: '🔥', name: 'Wolf-Burner',        desc: 'Burn the Sea Wolves\' haven.',               test: function (g) { return !!(g.sea && g.sea.spots.some(function (p) { return p.burned; })); } },
    { id: 'chart',    ic: '🧭', name: 'Cartographer',       desc: 'Chart every place on the sea chart.',        test: function (g) { return !!(g.sea && g.sea.spots.every(function (p) { return p.known; })); } },
    { id: 'mist',     ic: '🌫️', name: 'No More Mist',       desc: 'Explore the whole island.',                  test: function () { return typeof EXPLORE !== 'undefined' && EXPLORE.known() >= 0.985; } },
    { id: 'sites',    ic: '🗿', name: 'Old Things',         desc: 'Find every hidden place on the island.',     test: function (g) { return !!(g.sites && g.sites.length && g.sites.every(function (s) { return s.found; })); } },
    { id: 'outposts', ic: '⚑',  name: 'Little Empire',      desc: 'Hold 3 outposts.',                           test: function (g) { return !!(g.sea && g.sea.spots.filter(function (p) { return p.outpost; }).length >= 3); } },
    { id: 'scholar',  ic: '📜', name: 'Scholar-King',       desc: 'Complete 10 discoveries.',                   test: function (g) { return g.stats.techDone >= 10; } },
    { id: 'warden',   ic: '🪣', name: 'Fire Warden',        desc: 'Put out 10 fires.',                          test: function (g) { return (g.stats.firesOut || 0) >= 10; } },
    { id: 'dynasty',  ic: '👶', name: 'Generations',        desc: 'See 60 children born in one reign.',         test: function (g) { return (g.stats.births || 0) >= 60; } },
    { id: 'crown',    ic: '👑', name: 'The Crown',          desc: 'Finish the Great Cathedral.',                test: function (g) { return !!g.won; } },
    { id: 'iron',     ic: '⚔️', name: 'Iron Crown',         desc: 'Finish the Cathedral on Harsh.',             test: function (g) { return !!g.won && g.setup && g.setup.diff === 'harsh'; } },
    { id: 'score',    ic: '⭐', name: 'Remembered',          desc: 'Reach a reign score of 5,000.',              test: function () { return score() >= 5000; } }
  ];
  function earned() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function best() {
    try { return JSON.parse(localStorage.getItem(BEST) || '{}') || {}; } catch (e) { return {}; }
  }
  var timer = 3, lastSeason = -1;
  function tick(dt) {
    var g = G();
    if (!g) return;
    var si = SIM.seasonIndex();
    if (si !== lastSeason) { if (lastSeason >= 0) record(); lastSeason = si; }
    timer -= dt;
    if (timer > 0) return;
    timer = 2;
    var have = earned(), fresh = [];
    LIST.forEach(function (h) {
      if (have[h.id]) return;
      var ok = false;
      try { ok = h.test(g); } catch (e) { ok = false; }
      // earned with the villagers building for you: still yours, marked as such
      if (ok) { have[h.id] = (typeof STEWARD !== 'undefined' && STEWARD.on()) ? { t: Date.now(), help: true } : Date.now(); fresh.push(h); }
    });
    if (fresh.length) {
      try { localStorage.setItem(KEY, JSON.stringify(have)); } catch (e) {}
      fresh.forEach(function (h) { SIM.emit('honour', h); });
    }
    // the best reign on each difficulty, kept across saves
    var sc = score(), d = (g.setup && g.setup.diff) || 'fair', b = best();
    if (!b[d] || sc > b[d]) { b[d] = sc; try { localStorage.setItem(BEST, JSON.stringify(b)); } catch (e) {} }
  }
  function reset() { lastSeason = -1; timer = 3; }

  /* a line chart of one thing over the reign */
  function drawChart(cv, key, col, tries) {
    if (!cv.clientWidth) { if ((tries || 0) < 20 && cv.isConnected !== false) requestAnimationFrame(function () { drawChart(cv, key, col, (tries || 0) + 1); }); return; }
    var hist = (G().hist || []).concat([{ pop: Math.floor(G().pop), gold: G().res.gold, food: G().res.food, happy: G().happy, army: SIM.armyCount(), score: score() }]);
    var x = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    var vals = hist.map(function (p) { return p[key] || 0; });
    var max = Math.max(1, Math.max.apply(null, vals)), min = Math.min(0, Math.min.apply(null, vals));
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 1;
    for (var i = 1; i < 4; i++) { x.beginPath(); x.moveTo(0, h * i / 4); x.lineTo(w, h * i / 4); x.stroke(); }
    if (vals.length < 2) return;
    var px = function (i) { return 4 + i / (vals.length - 1) * (w - 8); }, py = function (v) { return h - 4 - (v - min) / (max - min) * (h - 10); };
    var gr = x.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, col + '66'); gr.addColorStop(1, col + '00');
    x.beginPath(); x.moveTo(px(0), h);
    vals.forEach(function (v, i) { x.lineTo(px(i), py(v)); });
    x.lineTo(px(vals.length - 1), h); x.closePath(); x.fillStyle = gr; x.fill();
    x.beginPath();
    vals.forEach(function (v, i) { if (!i) x.moveTo(px(i), py(v)); else x.lineTo(px(i), py(v)); });
    x.strokeStyle = col; x.lineWidth = 2; x.lineJoin = 'round'; x.stroke();
  }

  return { tick: tick, reset: reset, score: score, parts: parts, LIST: LIST, earned: earned, best: best, drawChart: drawChart, record: record };
})();
