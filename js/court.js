/* ============================================================
   court.js — the ruler's side of the game.
   You: a name, a house and a banner; you age, marry, have heirs,
   and one day the crown passes on.
   Your people: petitions with deadlines — do what they ask, in time,
   and they remember it.
   Your realm's character: at the end of each chapter a charter, one
   of three, that shapes the rest of the reign.
   Your neighbour: Lord Harric writes, and what he writes depends on
   how he feels about you.
   ============================================================ */
var COURT = (function () {
  'use strict';

  function G() { return SIM.G; }
  function R() { return Math.random(); }
  function pick(a) { return a[Math.floor(R() * a.length)]; }
  var YEAR = function () { return DATA.SEASON_LEN * 4; };

  /* ---------------- the ruler ---------------- */
  var M_NAMES = ['Aldric', 'Edmund', 'Godfrey', 'Harold', 'Osric', 'Roland', 'Theobald', 'Walter', 'Aelric', 'Cedric', 'Leofric', 'Emeric'];
  var F_NAMES = ['Adela', 'Beatrice', 'Eleanor', 'Isolde', 'Matilda', 'Rosamund', 'Sibylla', 'Aveline', 'Ermengard', 'Gisela', 'Edith', 'Maud'];
  var HOUSES = ['Ashdown', 'Greymantle', 'Wyvernholt', 'Cindermoor', 'Thornfield', 'Blackwater', 'Everhollow', 'Stormhaven'];
  var BANNERS = [['#e0b23c', '#a8382a'], ['#2f5c96', '#e8e2d0'], ['#3d7a3a', '#e0b23c'], ['#6a2d6a', '#d9c89a'], ['#1f1f24', '#c9302c'], ['#a8382a', '#e8e2d0']];

  function randomRuler() {
    var title = R() < 0.5 ? 'Queen' : 'King';
    return { name: pick(title === 'Queen' ? F_NAMES : M_NAMES), title: title, house: pick(HOUSES), banner: pick(BANNERS) };
  }
  function ruler() {
    var g = G();
    if (!g.ruler) {
      var r = (g.setup && g.setup.ruler) || randomRuler();
      g.ruler = { name: r.name, title: r.title, house: r.house, banner: r.banner || BANNERS[0], age: 27 + Math.floor(R() * 6),
                  spouse: null, heirs: [], gen: 1, lastChild: -1e9, matchAt: DATA.SEASON_LEN * (3 + R() * 3) };
    }
    return g.ruler;
  }
  function styled(r) { r = r || ruler(); return r.title + ' ' + r.name + ' of House ' + r.house; }
  function applyBanner() { var r = ruler(); if (typeof ART !== 'undefined' && ART.setBanner) ART.setBanner(r.banner[0], r.banner[1]); }
  function spouseTitle(r) { return r.title === 'Queen' ? 'Prince consort' : 'Queen consort'; }

  function tickRuler(dt) {
    var g = G(), r = ruler(), yr = dt / YEAR();
    r.age += yr;
    if (r.spouse) r.spouse.age += yr;
    r.heirs.forEach(function (h) { h.age += yr; });
    // a match is proposed
    if (!r.spouse && !r.matchOffered && g.time > r.matchAt) { r.matchOffered = true; SIM.emit('court-letter', { k: 'match' }); }
    // children, while young enough
    if (r.spouse && r.heirs.length < 4 && r.age < 44 && g.time - r.lastChild > YEAR() * (1.2 + R() * 0.02) && R() < dt / (YEAR() * 0.9)) {
      r.lastChild = g.time;
      var s = R() < 0.5 ? 'f' : 'm';
      var h = { name: pick(s === 'f' ? F_NAMES : M_NAMES), s: s, age: 0 };
      if (r.heirs.some(function (x) { return x.name === h.name; })) h.name = pick(s === 'f' ? F_NAMES : M_NAMES);
      r.heirs.push(h);
      g.happy = U.clamp(g.happy + 5, 0, 100);
      SIM.emit('court', { msg: '👶 A ' + (s === 'f' ? 'princess' : 'prince') + ', ' + h.name + ', is born to ' + styled(r) + '. Bells ring across the island.', good: true });
    }
    // death comes for everyone, eventually
    if (r.age > 56 && R() < (r.age - 54) * 0.03 * yr) succession();
  }
  function succession() {
    var g = G(), old = ruler();
    var adult = old.heirs.filter(function (h) { return h.age >= 16; }).sort(function (a, b) { return b.age - a.age; })[0];
    var next, note;
    if (adult) { next = adult; note = 'The eldest, ' + adult.name + ', is crowned.'; }
    else if (old.heirs.length) { next = old.heirs.sort(function (a, b) { return b.age - a.age; })[0]; note = next.name + ' is only ' + Math.floor(next.age) + ' — ' + (old.spouse ? old.spouse.name : 'the council') + ' will rule as regent until they come of age.'; }
    else { next = { name: pick(R() < 0.5 ? F_NAMES : M_NAMES), s: R() < 0.5 ? 'f' : 'm', age: 24 }; next.s = F_NAMES.indexOf(next.name) >= 0 ? 'f' : 'm'; note = 'There was no heir. A cousin, ' + next.name + ', takes the crown.'; }
    g.ruler = { name: next.name, title: next.s === 'f' ? 'Queen' : 'King', house: old.house, banner: old.banner, age: Math.max(next.age, 16),
                spouse: null, heirs: old.heirs.filter(function (h) { return h !== next; }).map(function (h) { h.sibling = true; return h; }).slice(0, 0),
                gen: (old.gen || 1) + 1, lastChild: -1e9, matchAt: g.time + DATA.SEASON_LEN * 2 };
    g.stats.successions = (g.stats.successions || 0) + 1;
    g.happy = U.clamp(g.happy - 6, 0, 100);
    SIM.emit('succession', { old: old, next: g.ruler, note: note });
  }

  /* a match for the ruler */
  function matchOffer() {
    var r = ruler(), g = G(), att = SIM.dip ? SIM.dip().att : 0;
    var names = (r.title === 'Queen' ? M_NAMES : F_NAMES).slice(), sp = { length: 0 };
    function pick() { return names.splice(Math.floor(R() * names.length), 1)[0]; }   // three different suitors
    var offers = [
      { label: 'Wed ' + pick() + ' of Carrow', sub: 'A merchant house: +250 gold dowry', gold: 250 },
      { label: 'Wed ' + pick() + ', of a local family', sub: 'The people love it: +12 contentment', happy: 12 }
    ];
    if (att > -30) offers.unshift({ label: 'Wed ' + pick() + ' of Brannoch', sub: 'Lord Harric\'s kin: Brannoch warms to you (+30)', att: 30 });
    return offers;
  }
  function marry(o) {
    var r = ruler(), g = G();
    r.spouse = { name: o.label.replace(/^Wed /, '').split(' ')[0], age: r.age - 2 + R() * 4 };
    r.lastChild = g.time;
    if (o.gold) g.res.gold = Math.min(SIM.cap('gold'), g.res.gold + o.gold);
    if (o.happy) g.happy = U.clamp(g.happy + o.happy, 0, 100);
    if (o.att && SIM.dip) { var d = SIM.dip(); d.att = U.clamp(d.att + o.att, -100, 100); }
    g.happy = U.clamp(g.happy + 4, 0, 100);
    return '💍 ' + styled(r) + ' is wed to ' + r.spouse.name + '. There is dancing in every lane.';
  }

  /* ---------------- petitions ---------------- */
  var PETITIONS = [
    { id: 'well', ic: '⛲', ask: 'asks for a new well — the women are carrying water half across the town.', bld: 'well', n: 1, reward: { happy: 6, gold: 40 } },
    { id: 'tavern', ic: '🍺', ask: 'says the lower lanes need a tavern of their own.', bld: 'tavern', n: 1, reward: { happy: 7, gold: 50 } },
    { id: 'chapel', ic: '⛪', ask: 'begs for a chapel, so the old folk need not walk to the hall to pray.', bld: 'chapel', n: 1, reward: { happy: 9 } },
    { id: 'bakery', ic: '🥖', ask: 'wants a bakery — bread, not porridge, three times a day.', bld: 'bakery', n: 1, reward: { happy: 6, food: 60 } },
    { id: 'homes', ic: '🏠', ask: 'speaks for the young couples: three more cottages, so they can marry.', bld: 'house', n: 3, reward: { happy: 6, gold: 60 } },
    { id: 'granary', ic: '🌾', ask: 'fears the winter and asks for another granary.', bld: 'granary', n: 1, reward: { happy: 5, gold: 50 } },
    { id: 'market', ic: '⚖️', ask: 'wants a second market square, nearer the south lanes.', bld: 'market', n: 1, reward: { gold: 120 } },
    { id: 'bandits', ic: '🏴', ask: 'on behalf of the carters: clear the bandits off the hill road.', wins: 1, reward: { gold: 120, happy: 4 } },
    { id: 'soldiers', ic: '🛡️', ask: 'says the watch is too thin — muster three more soldiers.', army: 3, reward: { happy: 5 } },
    { id: 'feast', ic: '🍖', ask: 'asks you to proclaim a feast day before the season is out.', decree: 'feast', reward: { happy: 4, gold: 30 } },
    { id: 'mist', ic: '🧭', ask: 'swears there is something out in the mist. Send scouts and see more of the island.', explore: 0.12, reward: { gold: 80 } }
  ];
  function now() {
    var g = G();
    return { count: Object.assign({}, g.count), wins: g.stats.wins, army: SIM.armyCount(), known: typeof EXPLORE !== 'undefined' ? EXPLORE.known() : 1, feastAt: (g.decrees || {}).feast || 0 };
  }
  function offerPetition() {
    var g = G();
    if (!g.petitions) g.petitions = [];
    var used = g.petitions.map(function (p) { return p.id; });
    var pool = PETITIONS.filter(function (p) {
      if (used.indexOf(p.id) >= 0) return false;
      if (p.bld && !SIM.unlocked(p.bld)) return false;
      if (p.explore && (typeof EXPLORE === 'undefined' || EXPLORE.known() > 0.85)) return false;
      if (p.army && SIM.armyCap() - SIM.armySlots() < 3) return false;
      if (p.id === 'market' && !(g.count.market > 0)) return false;
      return true;
    });
    if (!pool.length) return null;
    var p = pick(pool), who = 'A villager';
    if (typeof FOLK !== 'undefined' && FOLK.list.length) { var adults = FOLK.list.filter(function (x) { return x.a >= 20; }); if (adults.length) who = FOLK.full(pick(adults)); }
    return { k: 'petition', id: p.id, who: who };
  }
  function acceptPetition(L) {
    var g = G(), p = PETITIONS.filter(function (x) { return x.id === L.id; })[0];
    if (!p) return;
    if (!g.petitions) g.petitions = [];
    g.petitions.push({ id: p.id, who: L.who, base: now(), until: g.time + DATA.SEASON_LEN * 2 });
  }
  function petitionMet(a) {
    var g = G(), p = PETITIONS.filter(function (x) { return x.id === a.id; })[0], b = a.base;
    if (p.bld) return (g.count[p.bld] || 0) - (b.count[p.bld] || 0) >= p.n;
    if (p.wins) return g.stats.wins - b.wins >= p.wins;
    if (p.army) return SIM.armyCount() - b.army >= p.army;
    if (p.decree) return ((g.decrees || {})[p.decree] || 0) > b.feastAt;
    if (p.explore) return typeof EXPLORE !== 'undefined' && EXPLORE.known() - b.known >= p.explore;
    return false;
  }
  function petitionText(a) {
    var p = PETITIONS.filter(function (x) { return x.id === a.id; })[0];
    return p ? p.ic + ' ' + a.who + ' ' + p.ask : '';
  }
  function petitionLabel(a) {
    var p = PETITIONS.filter(function (x) { return x.id === a.id; })[0], b = a.base, g = G();
    if (p.bld) return (p.n > 1 ? p.n + ' ' : 'A ') + DATA.B[p.bld].name.toLowerCase() + (p.n > 1 ? 's' : '') + ' (' + Math.min(p.n, (g.count[p.bld] || 0) - (b.count[p.bld] || 0)) + '/' + p.n + ')';
    if (p.wins) return 'Clear the bandit camp';
    if (p.army) return 'Muster 3 soldiers (' + Math.max(0, SIM.armyCount() - b.army) + '/3)';
    if (p.decree) return 'Proclaim a feast day';
    if (p.explore) return 'Explore more of the island (' + Math.round(Math.max(0, EXPLORE.known() - b.known) * 100) + '/' + Math.round(p.explore * 100) + '%)';
    return p.id;
  }
  function tickPetitions() {
    var g = G();
    if (!g.petitions || !g.petitions.length) return;
    var keep = [];
    g.petitions.forEach(function (a) {
      var p = PETITIONS.filter(function (x) { return x.id === a.id; })[0];
      if (petitionMet(a)) {
        SIM.applyEffects(p.reward);
        g.stats.petitions = (g.stats.petitions || 0) + 1;
        SIM.emit('court', { msg: '🙏 ' + a.who + ' thanks you: the petition is answered. ' + rewardText(p.reward), good: true });
      } else if (g.time > a.until) {
        g.happy = U.clamp(g.happy - 5, 0, 100);
        SIM.emit('court', { msg: '😞 The petition from ' + a.who + ' went unanswered. People talk. (−5 contentment)', good: false });
      } else keep.push(a);
    });
    g.petitions = keep;
  }
  function rewardText(r) {
    return Object.keys(r).map(function (k) { return (k === 'happy' ? '+' + r[k] + ' contentment' : '+' + r[k] + ' ' + k); }).join(', ') + '.';
  }

  /* ---------------- charters ---------------- */
  var CHARTERS = {
    trade:     { name: 'Charter of Trade',     ic: '💰', desc: '+15% gold from everything, and markets cost a fifth less.' },
    granary:   { name: 'Granary of the Isles', ic: '🌾', desc: '+15% food from every field, boat and hunter.' },
    foresters: { name: 'Foresters\' Rights',   ic: '🌲', desc: '+25% timber, and fires are a third less likely.' },
    masons:    { name: 'Masons\' Guild',        ic: '🧱', desc: 'Stone costs a fifth less and everything goes up 30% faster.' },
    fortress:  { name: 'Fortress Isle',        ic: '🛡️', desc: 'Walls and towers count 30% more, and soldiers eat half as much.' },
    holy:      { name: 'Holy Isle',            ic: '⛪', desc: '+6 contentment for good, and chapels and wells cost a third less.' },
    seafarers: { name: 'Seafarers\' Charter',  ic: '⛵', desc: 'Ships sail twice as fast and outposts send home 30% more.' },
    scholars:  { name: 'Scholars\' Charter',   ic: '📜', desc: 'Research runs 30% faster.' }
  };
  function perk(id) { var g = G(); return !!(g && g.perks && g.perks[id]); }
  function charterChoices(idx) {
    var ids = Object.keys(CHARTERS).filter(function (k) { return !perk(k); });
    var r = U.mulberry(((G().seed || 1) + idx * 977) >>> 0), out = [];
    while (out.length < 3 && ids.length) out.push(ids.splice(Math.floor(r() * ids.length), 1)[0]);
    return out;
  }
  function takeCharter(id) {
    var g = G();
    if (!g.perks) g.perks = {};
    g.perks[id] = true;
    if (id === 'holy') g.blessing = (g.blessing || 0) + 6;
  }

  /* ---------------- letters from Brannoch ---------------- */
  function harricLetter() {
    if (!SIM.dip) return null;
    var d = SIM.dip(), a = d.att;
    if (d.ally) return { k: 'harric', kind: 'ally' };
    if (a <= -40) return { k: 'harric', kind: 'threat' };
    if (a < 10) return { k: 'harric', kind: 'demand' };
    return { k: 'harric', kind: 'trade' };
  }
  function harricCard(kind) {
    var g = G(), r = ruler();
    if (kind === 'threat') return { art: '🗡️', title: 'A Letter Sealed in Black',
      text: 'Lord Harric writes: "' + r.title + ' ' + r.name + ', your island grows fat while my people go hungry. That will not last."',
      choices: [{ label: 'Send a soft answer and a gift', sub: '−60 gold, Brannoch cools (+10)', gold: -60, att: 10 },
                { label: 'Answer in kind', sub: 'Your people cheer; Brannoch seethes (−10)', happy: 6, att: -10 }] };
    if (kind === 'demand') return { art: '📜', title: 'Lord Harric Demands Timber',
      text: '"The winter was cruel to Brannoch. Send us timber, as a good neighbour would."',
      choices: [{ label: 'Send 80 wood', sub: 'Brannoch warms (+12)', wood: -80, att: 12 },
                { label: 'Refuse politely', sub: 'Brannoch sulks (−4)', att: -4 }] };
    if (kind === 'trade') return { art: '🤝', title: 'An Offer from Brannoch',
      text: '"Our smiths have iron to spare, and your fields have grain. A fair exchange?"',
      choices: [{ label: 'Trade 100 food for 40 iron', sub: 'Brannoch is pleased (+5)', food: -100, iron: 40, att: 5 },
                { label: 'Decline', sub: 'No harm done' }] };
    return { art: '💍', title: 'Word from Your Ally',
      text: '"Brother-realm, the Sea Wolves have been seen off our coast. Brannoch sends a gift, and asks only that you keep your watch."',
      choices: [{ label: 'Accept with thanks', sub: '+80 gold, +20 iron', gold: 80, iron: 20 }] };
  }
  function applyChoice(c) {
    var g = G();
    ['gold', 'food', 'wood', 'iron', 'stone'].forEach(function (k) { if (c[k]) g.res[k] = U.clamp(g.res[k] + c[k], 0, SIM.cap(k)); });
    if (c.happy) g.happy = U.clamp(g.happy + c.happy, 0, 100);
    if (c.att && SIM.dip) { var d = SIM.dip(); d.att = U.clamp(d.att + c.att, -100, 100); }
  }

  /* ---------------- ticking ---------------- */
  var petT = 0, harT = 0, slow = 0;
  function tick(dt) {
    var g = G(); if (!g) return;
    tickRuler(dt);
    slow -= dt;
    if (slow <= 0) { slow = 1; tickPetitions(); }
    // a petition every couple of seasons, never more than two at once
    petT += dt;
    if (petT > DATA.SEASON_LEN * 1.8 && SIM.seasonIndex() >= 2 && (!g.petitions || g.petitions.length < 2)) {
      petT = -R() * DATA.SEASON_LEN;
      var L = offerPetition(); if (L) SIM.emit('court-letter', L);
    }
    // Lord Harric writes now and then
    harT += dt;
    if (harT > DATA.SEASON_LEN * 3.2 && SIM.seasonIndex() >= 4 && !g.war) {
      harT = -R() * DATA.SEASON_LEN * 1.5;
      var H = harricLetter(); if (H) SIM.emit('court-letter', H);
    }
  }
  function reset() { petT = 0; harT = 0; slow = 0; }

  return {
    tick: tick, reset: reset, ruler: ruler, styled: styled, applyBanner: applyBanner, randomRuler: randomRuler,
    BANNERS: BANNERS, HOUSES: HOUSES, M_NAMES: M_NAMES, F_NAMES: F_NAMES, spouseTitle: spouseTitle,
    matchOffer: matchOffer, marry: marry, succession: succession,
    PETITIONS: PETITIONS, acceptPetition: acceptPetition, petitionText: petitionText, petitionLabel: petitionLabel,
    CHARTERS: CHARTERS, perk: perk, charterChoices: charterChoices, takeCharter: takeCharter,
    harricCard: harricCard, applyChoice: applyChoice
  };
})();
