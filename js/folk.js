/* ============================================================
   folk.js — the people of Ashveil, one by one.
   The economy still counts heads; this gives every head a name,
   a family, an age, a home and a trade. Children are born to
   couples, newcomers step off the boats, the old die in their
   beds, and sickness moves through crowded houses. It is kept in
   step with SIM's population, so it never fights the economy —
   except for sickness, which keeps the ill off work, and old age.
   ============================================================ */
var FOLK = (function () {
  'use strict';

  var F_NAMES = ['Ada', 'Agnes', 'Alys', 'Beatrix', 'Cecily', 'Edith', 'Elin', 'Emma', 'Gwen', 'Hild', 'Isolde', 'Joan',
    'Maud', 'Mabel', 'Margery', 'Nell', 'Rose', 'Sibyl', 'Tamsin', 'Wren', 'Avice', 'Elsbeth', 'Idony', 'Lettice', 'Mariot', 'Petronel'];
  var M_NAMES = ['Alan', 'Aldous', 'Bran', 'Cuthbert', 'Edmund', 'Geoffrey', 'Hal', 'Hugh', 'Jory', 'Martin', 'Osric', 'Piers',
    'Ralf', 'Robin', 'Simon', 'Tobin', 'Walter', 'Wat', 'Will', 'Godric', 'Aelric', 'Denis', 'Emery', 'Gil', 'Lambert', 'Roger'];
  var SURNAMES = ['Miller', 'Cooper', 'Fletcher', 'Thatcher', 'Weaver', 'Fisher', 'Baker', 'Carter', 'Mason', 'Ward', 'Brewer',
    'Tanner', 'Shepherd', 'Reeve', 'Ashdown', 'Greaves', 'Hollis', 'Marsh', 'Wolde', 'Penrose', 'Tidwell', 'Fenn', 'Crowe',
    'Hardy', 'Blythe', 'Sallow', 'Rooke', 'Kettle', 'Hale', 'Dunmore'];
  var YEAR = function () { return DATA.SEASON_LEN * 4; };

  var byId = {}, homesOf = {}, services = {}, jobTimer = 0, sickTimer = 0, outbreakTimer = 6, lifeTimer = 0;

  function G() { return SIM.G; }
  function R() { return Math.random(); }
  function pick(a) { return a[Math.floor(R() * a.length)]; }
  function st() {
    var g = G();
    if (!g.folkStats || g.folkStats.y !== SIM.year()) g.folkStats = { y: SIM.year(), born: 0, died: 0, wed: 0, came: 0, left: 0 };
    return g.folkStats;
  }
  function note(msg, toast) {
    var g = G();
    if (!g.folkLog) g.folkLog = [];
    g.folkLog.unshift({ s: SIM.season().name.slice(0, 3) + ' ' + SIM.year(), m: msg });
    if (g.folkLog.length > 30) g.folkLog.pop();
    SIM.emit('folk', { msg: msg, toast: !!toast });
  }
  function full(p) { return p.n + ' ' + p.f; }

  /* ---------------- the register ---------------- */
  function person(o) {
    var g = G();
    g.folkNext = (g.folkNext || 1);
    var p = { i: g.folkNext++, n: o.n, f: o.f, s: o.s, a: o.a, h: 0, sp: 0, pa: 0, sick: 0, j: 0, grief: 0 };
    if (o.pa) p.pa = o.pa;
    g.folk.push(p); byId[p.i] = p;
    return p;
  }
  function stranger(age, sex, fam) {
    sex = sex || (R() < 0.5 ? 'f' : 'm');
    return person({ n: pick(sex === 'f' ? F_NAMES : M_NAMES), f: fam || pick(SURNAMES), s: sex, a: age });
  }
  function wed(a, b) {
    a.sp = b.i; b.sp = a.i;
    // the one who moves takes the family name
    b.f = a.f;
    b.h = a.h;
  }
  function remove(p) {
    var g = G(), k = g.folk.indexOf(p);
    if (k >= 0) g.folk.splice(k, 1);
    delete byId[p.i];
    if (p.sp && byId[p.sp]) { byId[p.sp].sp = 0; byId[p.sp].grief = 1; }
  }

  /* the first families, when a new reign starts */
  function seed(n) {
    var g = G();
    g.folk = []; g.folkNext = 1; byId = {};
    while (g.folk.length < n) {
      var fam = pick(SURNAMES);
      var a = stranger(24 + R() * 16, 'm', fam), b = stranger(22 + R() * 14, 'f', fam);
      wed(a, b);
      var kids = Math.floor(R() * 3);
      for (var k = 0; k < kids && g.folk.length < n; k++) {
        var c = stranger(1 + R() * 14, null, fam); c.pa = a.i;
      }
      if (g.folk.length < n && R() < 0.3) stranger(58 + R() * 12, null, fam);
    }
    while (g.folk.length > n) remove(g.folk[g.folk.length - 1]);
  }

  /* ---------------- save / load ---------------- */
  function pack() {
    var g = G();
    if (!g || !g.folk) return null;
    var idx = {};
    g.buildings.forEach(function (b, i) { idx[b.uid] = i; });
    return {
      next: g.folkNext, stats: g.folkStats || null, log: g.folkLog || [], levy: g.levy || [],
      p: g.folk.map(function (p) {
        return [p.i, p.n, p.f, p.s, Number(p.a.toFixed(2)), p.h in idx ? idx[p.h] : -1, p.sp, p.pa,
                Math.round(p.sick), Number((p.grief || 0).toFixed(2))];
      })
    };
  }
  function unpack(d) {
    var g = G();
    g.folk = []; byId = {};
    g.folkNext = d.next || 1; g.folkStats = d.stats || null; g.folkLog = d.log || []; g.levy = d.levy || [];
    (d.p || []).forEach(function (a) {
      var b = a[5] >= 0 ? g.buildings[a[5]] : null;
      var p = { i: a[0], n: a[1], f: a[2], s: a[3], a: a[4], h: b ? b.uid : 0, sp: a[6], pa: a[7], sick: a[8] || 0, j: 0, grief: a[9] || 0 };
      g.folk.push(p); byId[p.i] = p;
      if (p.i >= g.folkNext) g.folkNext = p.i + 1;
    });
  }
  function ensure() {
    var g = G();
    if (g.folkSave) { unpack(g.folkSave); g.folkSave = null; }
    if (!g.folk) seed(Math.floor(g.pop));
    if (!Object.keys(byId).length && g.folk.length) g.folk.forEach(function (p) { byId[p.i] = p; });
  }
  function reset() { byId = {}; homesOf = {}; services = {}; }

  /* ---------------- homes ---------------- */
  function homes() {
    return G().buildings.filter(function (b) { return b.built && (b.def.housing || b === G().buildings[0]); });
  }
  function capOf(b) {
    if (b === G().buildings[0]) return Math.max(2, SIM.housing() - homes().reduce(function (s, h) {
      return s + (h.def.housing && h !== G().buildings[0] ? h.def.housing * SIM.lvlMul(h) : 0); }, 0));
    return Math.max(1, Math.floor(b.def.housing * SIM.lvlMul(b)));
  }
  /* put everyone under a roof: families together, the crowded spread out */
  function rehouse() {
    var g = G(), hs = homes(), uid = {};
    hs.forEach(function (b) { uid[b.uid] = b; });
    homesOf = {};
    hs.forEach(function (b) { homesOf[b.uid] = []; });
    function free(b) { return capOf(b) - homesOf[b.uid].length; }
    function best() {
      var top = null, room = -1e9;
      hs.forEach(function (b) { var r = free(b) - (b === g.buildings[0] ? 2 : 0); if (r > room) { room = r; top = b; } });
      return top;
    }
    // keep people where they are while there is room
    g.folk.forEach(function (p) {
      var b = uid[p.h];
      if (b && free(b) > 0) homesOf[b.uid].push(p); else p.h = 0;
    });
    g.folk.forEach(function (p) {
      if (p.h) return;
      // follow a spouse or a parent if they have space
      var kin = (p.sp && byId[p.sp]) || (p.pa && byId[p.pa]);
      var b = kin && uid[kin.h] && free(uid[kin.h]) > 0 ? uid[kin.h] : best();
      if (!b) return;
      p.h = b.uid; homesOf[b.uid].push(p);
    });
  }
  function homeOf(p) { var b = null; G().buildings.forEach(function (x) { if (x.uid === p.h) b = x; }); return b; }

  /* what is within reach of a front door */
  function near(b, id, r) {
    var cx = b.x + (b.def.w || 1) / 2, cy = b.y + (b.def.h || 1) / 2, best = 1e9;
    G().buildings.forEach(function (o) {
      if (o.id !== id || !o.built) return;
      var d = Math.hypot(o.x + (o.def.w || 1) / 2 - cx, o.y + (o.def.h || 1) / 2 - cy);
      if (d < best) best = d;
    });
    return best <= r ? best : 0;
  }
  function refreshServices() {
    services = {};
    homes().forEach(function (b) {
      services[b.uid] = { well: near(b, 'well', 4.5), chapel: near(b, 'chapel', 7), tavern: near(b, 'tavern', 6), market: near(b, 'market', 8) };
    });
  }
  function servicesOf(b) { return (b && services[b.uid]) || { well: 0, chapel: 0, tavern: 0, market: 0 }; }

  /* ---------------- trades ---------------- */
  function assignJobs() {
    var g = G(), slots = [];
    g.buildings.forEach(function (b) {
      if (!b.built || b.paused || !b.workers) return;
      for (var i = 0; i < b.workers; i++) slots.push(b);
    });
    // grown folk first, then youngsters — the smallest children stay home
    var pool = g.folk.filter(function (p) { return !p.sick; })
      .sort(function (p, q) { return workRank(p) - workRank(q) || p.i - q.i; });
    var count = {}, uid = {};
    slots.forEach(function (b) { count[b.uid] = (count[b.uid] || 0) + 1; uid[b.uid] = b; });
    g.folk.forEach(function (p) { if (p.sick) p.j = 0; });
    // keep people in the trade they already have
    var used = {};
    pool.forEach(function (p) {
      if (p.j && count[p.j] && (used[p.j] || 0) < count[p.j]) used[p.j] = (used[p.j] || 0) + 1;
      else p.j = 0;
    });
    var open = [];
    Object.keys(count).forEach(function (k) { for (var n = used[k] || 0; n < count[k]; n++) open.push(+k); });
    pool.forEach(function (p) { if (!p.j && open.length) p.j = open.shift(); });
  }
  function workRank(p) { return p.a >= 16 && p.a < 62 ? 0 : p.a >= 62 ? 1 : p.a >= 11 ? 2 : 3; }
  function jobOf(p) {
    if (!p.j) return null;
    var b = null; G().buildings.forEach(function (x) { if (x.uid === p.j) b = x; });
    return b;
  }
  var TRADES = { farm: 'Farmhand', fishery: 'Fisher', hunter: 'Hunter', bakery: 'Baker', windmill: 'Miller', lumber: 'Woodcutter',
    sawmill: 'Sawyer', pasture: 'Shepherd', weaver: 'Weaver', quarry: 'Quarryman', mine: 'Miner', smith: 'Smith',
    market: 'Trader', granary: 'Storekeeper', warehouse: 'Porter', chapel: 'Priest', tavern: 'Innkeeper',
    library: 'Scholar', castle: 'Steward', barracks: 'Drillmaster', range: 'Bowyer', cathedral: 'Mason' };
  function tradeOf(p) {
    if (p.sick) return 'Sick abed';
    var b = jobOf(p);
    if (b) return (p.a < 14 ? 'Helps at the ' + b.def.name.toLowerCase() : (TRADES[b.id] || 'Works at the ' + b.def.name));
    if (p.a < 6) return 'A little one';
    if (p.a < 14) return 'Child';
    if (p.a >= 64) return 'Elder';
    return G().buildings.some(function (x) { return !x.built; }) ? 'Labourer (building)' : 'Labourer';
  }

  /* ---------------- how someone feels ---------------- */
  function mood(p) {
    var g = G(), b = homeOf(p), sv = servicesOf(b), v = g.happy, why = [];
    if (b && b.def.evolves) v += ((b.level || 1) - 1) * 5;
    if (sv.well) v += 3; else { v -= 6; why.push('no well near home'); }
    if (sv.chapel) v += 3; else if (g.pop > 20) { v -= 3; why.push('no chapel nearby'); }
    if (sv.tavern) v += 2;
    if (p.sick) { v = Math.min(v - 25, 34); why.push('sick'); }
    if (p.grief > 0) { v -= 18 * p.grief; why.push('grieving'); }
    if (b && homesOf[b.uid] && homesOf[b.uid].length >= capOf(b) && b !== g.buildings[0]) { v -= 3; why.push('a crowded house'); }
    if (g.res.food <= 0.5) { v -= 15; why.push('hungry'); }
    v = U.clamp(v, 0, 100);
    var word = v < 25 ? 'Miserable' : v < 40 ? 'Unhappy' : v < 60 ? 'Content' : v < 80 ? 'Happy' : 'Joyful';
    return { v: v, word: word, why: why };
  }

  /* ---------------- keeping count with the economy ---------------- */
  function couples() {
    var t = G().time;
    // no more than one baby a year to any mother
    return G().folk.filter(function (p) { return p.sp && p.s === 'f' && p.a >= 18 && p.a <= 44 && byId[p.sp] && !(p.lastBirth > t - YEAR()); });
  }
  function grow(why) {
    var g = G(), s = st();
    if (why === 'veteran' && g.levy && g.levy.length) {
      var v = g.levy.pop();
      var back = person({ n: v.n, f: v.f, s: v.s, a: v.a });
      note(full(back) + ' comes home from the army.');
      return;
    }
    var cs = couples();
    var kids = g.folk.filter(function (q) { return q.a < 14; }).length / Math.max(1, g.folk.length);
    if (why !== 'settlers' && cs.length && R() < 0.62 * U.clamp(1 - (kids - 0.25) / 0.15, 0, 1)) {
      var mum = pick(cs), dad = byId[mum.sp];
      var kid = stranger(0, null, mum.f); kid.pa = mum.i; kid.h = mum.h; mum.lastBirth = g.time;
      // never two of the same name under one roof
      var taken = g.folk.filter(function (q) { return q !== kid && (q.pa === mum.i || q.pa === dad.i || q === mum || q === dad); }).map(function (q) { return q.n; });
      for (var tries = 0; tries < 8 && taken.indexOf(kid.n) >= 0; tries++) kid.n = pick(kid.s === 'f' ? F_NAMES : M_NAMES);
      s.born++;
      note('A child, ' + kid.n + ', is born to ' + mum.n + ' and ' + dad.n + ' ' + mum.f + '.');
      return;
    }
    var p = stranger(17 + R() * 20);
    s.came++;
    note(full(p) + ' ' + pick(['steps off a fishing boat and stays', 'comes over from the mainland', 'arrives looking for work',
      'walks in from the ash flats', 'comes to live with kin']) + '.');
  }
  function shrink(why) {
    var g = G(), s = st(), p;
    var adults = g.folk.filter(function (q) { return q.a >= 16; });
    if (why === 'soldier') {
      var fit = g.folk.filter(function (q) { return q.a >= 16 && q.a < 45 && !q.sick; });
      fit.sort(function (a, b) { return (a.sp ? 1 : 0) - (b.sp ? 1 : 0) || (a.j ? 1 : 0) - (b.j ? 1 : 0); });
      p = fit[0] || adults[0] || g.folk[0];
      if (!g.levy) g.levy = [];
      g.levy.push({ n: p.n, f: p.f, s: p.s, a: p.a });
      remove(p);
      return;
    }
    if (why === 'starve') {
      var weak = g.folk.filter(function (q) { return q.a >= 62 || q.a < 4; });
      p = weak.length ? pick(weak) : pick(g.folk);
      s.died++;
      note(full(p) + ' died in the hunger' + (p.a >= 62 ? ', aged ' + Math.floor(p.a) : p.a < 4 ? ', only a baby' : '') + '.', true);
      remove(p);
      return;
    }
    // they gave up on Ashveil — whole households go together when they can
    // they gave up on Ashveil
    var loose = adults.filter(function (q) { return !q.sp; });
    p = loose.length ? pick(loose) : adults.length ? pick(adults) : pick(g.folk);
    s.left += 1;
    note(full(p) + ' gave up on Ashveil and left for the mainland.');
    remove(p);
  }
  function reconcile() {
    var g = G(), want = Math.max(1, Math.floor(g.pop + 1e-6));
    var n = 0;
    while (g.folk.length < want && n++ < 40) grow(g._gainWhy);
    while (g.folk.length > want && n++ < 80) shrink(g._lossWhy);
    g._gainWhy = null; g._lossWhy = null;
    // the fallen: soldiers who do not come home
    var soldiers = SIM.armyCount() + (SIM.awayCount ? SIM.awayCount() : 0);
    if (g.levy && g.levy.length > soldiers) {
      var names = [];
      while (g.levy.length > soldiers) { var k = Math.floor(R() * g.levy.length); names.push(g.levy[k].n + ' ' + g.levy[k].f); g.levy.splice(k, 1); }
      st().died += names.length;
      note('Fell fighting for Ashveil: ' + names.slice(0, 6).join(', ') + (names.length > 6 ? ' and ' + (names.length - 6) + ' more' : '') + '.');
    }
  }

  /* ---------------- a life: ageing, weddings, old age ---------------- */
  function life(dt) {
    var g = G(), yr = dt / YEAR();
    var died = [];
    g.folk.forEach(function (p) {
      p.a += yr;
      if (p.grief > 0) p.grief = Math.max(0, p.grief - yr * 1.5);
      if (p.a > 60) {
        var risk = (p.a - 58) * 0.03 * yr;
        if (R() < risk) died.push(p);
      }
    });
    died.forEach(function (p) {
      if (g.folk.length <= 2) return;
      st().died++;
      g.stats.oldAge = (g.stats.oldAge || 0) + 1;
      note('Old ' + full(p) + ' died peacefully, aged ' + Math.floor(p.a) + '.');
      remove(p);
      g.pop = Math.max(1, g.pop - 1);
    });
    lifeTimer -= dt;
    if (lifeTimer > 0) return;
    lifeTimer = DATA.SEASON_LEN * (0.6 + R() * 0.8);
    // a wedding
    var single = g.folk.filter(function (p) { return !p.sp && p.a >= 18 && p.a < 46; });
    var fs = single.filter(function (p) { return p.s === 'f'; }), ms = single.filter(function (p) { return p.s === 'm'; });
    if (fs.length && ms.length && R() < 0.75) {
      var groom = pick(ms), bride = pick(fs);
      var was = bride.f;
      wed(groom, bride);
      st().wed++;
      g.happy = U.clamp(g.happy + 2, 0, 100);
      note('Wedding bells: ' + bride.n + ' ' + was + ' married ' + full(groom) + (SIM.G.count && SIM.G.count.chapel ? ' in the chapel' : ' under the old oak') + '.', true);
    }
  }

  /* ---------------- sickness ---------------- */
  function sickHomes() {
    var out = [];
    homes().forEach(function (b) {
      var n = (homesOf[b.uid] || []).filter(function (p) { return p.sick > 0; }).length;
      if (n) out.push({ b: b, n: n });
    });
    return out;
  }
  function sickAt(b) { return (homesOf[b.uid] || []).filter(function (p) { return p.sick > 0; }).length; }
  function physician(b) {
    if (G().res.gold < 25) return { ok: false, why: 'Not enough gold' };
    if (b.physic && b.physic > G().time) return { ok: false, why: 'The physician is already there' };
    G().res.gold -= 25; b.physic = G().time + DATA.SEASON_LEN;
    return { ok: true };
  }
  function fallSick(p) { if (p.imm > G().time) return; p.sick = 38 + R() * 30; p.j = 0; }
  function sickness(dt) {
    var g = G();
    var seasons = SIM.seasonIndex();
    var sanit = g.tech.sanitation ? 0.4 : 1, winter = SIM.season().key === 'winter' ? 1.6 : 1;
    // new outbreaks, where houses are crowded and the water is far
    outbreakTimer -= dt;
    if (outbreakTimer <= 0) {
      outbreakTimer = 8;
      if (g.pop >= 16 && seasons >= 6) {
        homes().forEach(function (b) {
          var occ = homesOf[b.uid] || [];
          if (!occ.length || b === g.buildings[0]) return;
          var crowd = occ.length / capOf(b);
          var risk = 0.0045 * crowd * crowd * (servicesOf(b).well ? 0.35 : 1) * sanit * winter;
          if (R() < risk) {
            var p = pick(occ);
            if (p.sick) return;
            fallSick(p);
            note('Fever in the ' + (b.def.tierNames ? b.def.tierNames[(b.level || 1) - 1].toLowerCase() : 'house') + ' of the ' + p.f + 's — ' + p.n + ' has taken ill.', true);
            SIM.emit('sick', b);
          }
        });
      }
    }
    // it spreads, it passes, and sometimes it kills
    sickTimer -= dt;
    var spread = sickTimer <= 0;
    if (spread) sickTimer = 4;
    var dead = [];
    homes().forEach(function (b) {
      var occ = homesOf[b.uid] || [], ill = occ.filter(function (p) { return p.sick > 0; });
      if (!ill.length) return;
      var doc = b.physic && b.physic > g.time, well = servicesOf(b).well;
      ill.forEach(function (p) {
        p.sick -= dt * (doc ? 2.5 : 1) * (well ? 1.3 : 1);
        var die = 0.0011 * (p.a >= 60 ? 3 : p.a < 5 ? 2 : 1) * (doc ? 0.3 : 1);
        if (R() < die * dt) dead.push(p);
        else if (p.sick <= 0) { p.sick = 0; p.imm = g.time + DATA.SEASON_LEN * 3; }   // once through it, spared a while
      });
      if (!spread) return;
      var k = (doc ? 0.3 : 1) * sanit * (well ? 0.5 : 1);
      occ.forEach(function (p) { if (!p.sick && R() < 0.1 * k * ill.length / occ.length * 2) fallSick(p); });
      homes().forEach(function (o) {
        if (o === b || o === g.buildings[0]) return;
        if (Math.abs(o.x - b.x) > 2.5 || Math.abs(o.y - b.y) > 2.5) return;
        var oc = homesOf[o.uid] || [];
        if (oc.length && R() < 0.03 * k * (servicesOf(o).well ? 0.4 : 1)) {
          var q = pick(oc); if (!q.sick) fallSick(q);
        }
      });
    });
    dead.forEach(function (p) {
      if (g.folk.length <= 2) return;
      st().died++;
      g.stats.fever = (g.stats.fever || 0) + 1;
      note(full(p) + ' died of the fever' + (p.a < 5 ? ', just a baby' : p.a >= 60 ? ', aged ' + Math.floor(p.a) : '') + '.', true);
      remove(p);
      g.pop = Math.max(1, g.pop - 1);
    });
    g.sickN = g.folk.filter(function (p) { return p.sick > 0; }).length;
  }

  /* ---------------- the tick ---------------- */
  var slow = 0;
  function tick(dt) {
    if (!G()) return;
    ensure();
    reconcile();
    slow -= dt;
    if (slow <= 0) {
      slow = 1;
      rehouse();
      refreshServices();
    }
    life(dt);
    sickness(dt);
    jobTimer -= dt;
    if (jobTimer <= 0) { jobTimer = 1; assignJobs(); }
  }

  function get(i) { return byId[i] || null; }
  function families() {
    var fams = {};
    G().folk.forEach(function (p) { fams[p.f] = (fams[p.f] || 0) + 1; });
    return Object.keys(fams).map(function (k) { return { f: k, n: fams[k] }; }).sort(function (a, b) { return b.n - a.n; });
  }
  function summary() {
    var g = G(), f = g.folk || [];
    var noWell = 0;
    homes().forEach(function (b) { if (b !== g.buildings[0] && (homesOf[b.uid] || []).length && !servicesOf(b).well) noWell++; });
    return {
      people: f.length, children: f.filter(function (p) { return p.a < 14; }).length,
      elders: f.filter(function (p) { return p.a >= 60; }).length,
      couples: f.filter(function (p) { return p.sp && p.s === 'f'; }).length,
      sick: f.filter(function (p) { return p.sick > 0; }).length, sickHomes: sickHomes().length,
      households: Object.keys(homesOf).filter(function (k) { return homesOf[k].length; }).length,
      noWell: noWell, oldest: f.reduce(function (o, p) { return !o || p.a > o.a ? p : o; }, null),
      stats: st(), log: g.folkLog || []
    };
  }

  return {
    tick: tick, reset: reset, pack: pack, get: get, full: full, mood: mood, tradeOf: tradeOf, homeOf: homeOf, jobOf: jobOf,
    servicesOf: servicesOf, sickAt: sickAt, sickHomes: sickHomes, physician: physician, families: families, summary: summary,
    residents: function (b) { return homesOf[b.uid] || []; },
    get list() { return (G() && G().folk) || []; }
  };
})();
