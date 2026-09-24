/* ============================================================
   ui.js — HUD, panels, touch input, inspector, events
   ============================================================ */
var UI = (function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function now() { return (typeof performance !== 'undefined') ? performance.now() : Date.now(); }
  /* A tap that opens a card must not also press a button on it: phones send
     a click right after the touch, to whatever is now under the finger. */
  var openedAt = { modal: 0, insp: 0 };
  function guard(id, key) {
    el(id).addEventListener('click', function (e) {
      if (now() - openedAt[key] < 380) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }
  function h(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  var buildMode = null;      // building id currently being placed
  var moveTarget = null;     // a building being moved, when buildMode is for a move
  var rowMode = false;       // drag lays a row instead of panning
  var openPanel = null;
  var openTab = {};
  var selected = null;       // {b:building} or {t:tile}
  var eventQueue = [];
  var modalBusy = false;
  var pendingRaid = false;

  /* =========================================================
     TOASTS
     ========================================================= */
  /* One line of news at a time. Everything also goes into the news log
     (tap the line to read it), so nothing is lost when the line moves on. */
  var newsQ = [], newsNow = null, newsTimer = null;
  function toast(msg, kind) {
    var G = SIM.G;
    if (G) {
      if (!G.news) G.news = [];
      if (!G.news.length || G.news[0].m !== msg) {
        G.news.unshift({ s: SIM.season().name.slice(0, 3) + ' ' + SIM.year(), m: msg, k: kind || '' });
        if (G.news.length > 40) G.news.pop();
      }
    }
    if ((newsNow && newsNow.msg === msg) || newsQ.some(function (n) { return n.msg === msg; })) return;
    newsQ.push({ msg: msg, kind: kind || '' });
    // a long queue drops the calmest news first; it is all still in the log
    while (newsQ.length > 3) {
      var calm = -1;
      for (var i = 0; i < newsQ.length; i++) if (newsQ[i].kind !== 'bad' && newsQ[i].kind !== 'war') { calm = i; break; }
      newsQ.splice(calm >= 0 ? calm : 0, 1);
    }
    if (!newsNow) nextNews();
  }
  function nextNews() {
    var box = el('toasts');
    clearTimeout(newsTimer);
    if (!newsQ.length) { newsNow = null; box.innerHTML = ''; return; }
    newsNow = newsQ.shift();
    box.innerHTML = '';
    var t = h('<div class="toast ' + newsNow.kind + '">' + newsNow.msg + (newsQ.length ? '<i class="more">+' + newsQ.length + '</i>' : '') + '</div>');
    t.addEventListener('click', function () { U.sfx.tap(); openSheet('news'); });
    box.appendChild(t);
    var dur = (newsNow.kind === 'bad' || newsNow.kind === 'war' ? 3400 : 2600) * (newsQ.length ? 0.7 : 1);
    newsTimer = setTimeout(function () {
      t.classList.add('out');
      newsTimer = setTimeout(nextNews, 260);
    }, dur);
  }
  function newsBody(box) {
    var n = (SIM.G.news || []);
    if (!n.length) { box.appendChild(h('<p class="hint">Nothing yet.</p>')); return; }
    box.appendChild(h('<div class="card">' + n.map(function (l) {
      var col = l.k === 'bad' ? '#e0795f' : l.k === 'war' ? '#e0b23c' : l.k === 'good' ? '#8fd06a' : '#8a7a5e';
      return '<div class="stat-line"><span style="flex:0 0 58px;color:' + col + '">' + l.s + '</span><b style="font-weight:400;text-align:left;flex:1">' + l.m + '</b></div>';
    }).join('') + '</div>'));
  }

  /* =========================================================
     TOP HUD
     ========================================================= */
  function costPills(cost, cls) {
    return DATA.RES.filter(function (r) { return cost[r.key]; }).map(function (r) {
      var lack = SIM.G.res[r.key] < cost[r.key];
      return '<b class="' + (lack ? 'short' : '') + (cls || '') + '">' + r.ic + ' ' + cost[r.key] + '</b>';
    }).join('');
  }

  function refreshHUD() {
    var G = SIM.G;
    if (!G) return;
    var net = SIM.ledger();
    var strip = el('res-strip');
    // A chip only appears once the realm has actually seen that resource, so a
    // new village shows four and a mature one shows nine without ever being a
    // wall of numbers you have to scroll.
    var show = DATA.RES.filter(function (r) { return (G.seen && G.seen[r.key]) || G.res[r.key] > 0; });
    var key = show.map(function (r) { return r.key; }).join(',');
    if (strip.dataset.keys !== key) {
      strip.dataset.keys = key;
      strip.innerHTML = '';
      show.forEach(function (r) {
        strip.appendChild(h('<div class="res" id="res-' + r.key + '"><span class="ic">' + r.ic +
          '</span><span class="amt">0</span><span class="rate"></span></div>'));
      });
    }
    show.forEach(function (r) {
      var box = el('res-' + r.key);
      if (!box) return;
      var v = G.res[r.key], c = SIM.cap(r.key);
      box.querySelector('.amt').textContent = U.fmt(v);
      var rt = box.querySelector('.rate');
      rt.textContent = U.signed(net[r.key], 1);
      rt.className = 'rate ' + (net[r.key] > 0.049 ? 'up' : net[r.key] < -0.049 ? 'dn' : '');
      box.classList.toggle('warn', (r.key === 'food' && net[r.key] < 0.05 && v < G.pop * 3));
      box.title = r.name + ' — ' + Math.floor(v) + ' / ' + c;
    });
    var mood = G.happy > 75 ? '😀' : G.happy > 55 ? '🙂' : G.happy > 35 ? '😐' : G.happy > 18 ? '😟' : '😠';
    var mp = el('mini-pop'), mh = el('mini-happy'), ma = el('mini-army'), mn = el('mini-note');
    mp.textContent = '👥 ' + Math.floor(G.pop) + '/' + SIM.housing();
    mp.className = 'mini' + (G.pop >= SIM.housing() ? ' warn' : '');
    mh.textContent = mood + ' ' + Math.round(G.happy) + '%';
    mh.className = 'mini' + (G.happy < 25 ? ' warn' : '');
    ma.textContent = '⚔️ ' + SIM.armyCount() + ' (' + SIM.armySlots() + '/' + SIM.armyCap() + ')';
    ma.className = 'mini';
    var note = '';
    if (G.idle) note = '🧺 ' + G.idle + ' labourer' + (G.idle > 1 ? 's' : '');
    if (G.research) note = '📜 ' + Math.round(U.clamp(G.research.prog / DATA.TECH[G.research.id].time, 0, 1) * 100) + '%';
    mn.textContent = note;
    mn.className = 'mini dim' + (note ? '' : ' hidden');

    var n = SIM.issueCount();
    var badge = el('alert-badge'), abtn = el('btn-alerts');
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
    abtn.classList.toggle('calm', n === 0);
    abtn.textContent = n === 0 ? '🔕' : '🔔';
    abtn.appendChild(badge);

    refreshGoal();

    var s = SIM.season();
    el('season-icon').textContent = s.icon;
    el('season-name').textContent = s.name;
    el('year-label').textContent = 'Yr ' + SIM.year();
    el('season-fill').style.width = (SIM.seasonProgress() * 100).toFixed(1) + '%';
  }

  var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  /* The card under the HUD: an emergency if there is one, otherwise the
     next goal of the current chapter and how close it is. */
  function refreshGoal() {
    var G = SIM.G, card = el('goal-card');
    if (!card) return;
    var urgent = SIM.issues().filter(function (i) { return i.sev >= 2; })[0];
    card.classList.toggle('urgent', !!urgent);
    if (urgent) {
      el('gc-ch').textContent = '⚠ Needs you now';
      el('gc-goal').textContent = urgent.text + (urgent.hint ? ' — ' + urgent.hint : '');
      el('gc-fill').style.width = '0%';
      card.dataset.go = 'alerts';
      return;
    }
    card.dataset.go = 'story';
    if (G.won) {
      el('gc-ch').textContent = '👑 Your reign is complete';
      el('gc-goal').textContent = 'Ashveil endures. Build on as you please.';
      el('gc-fill').style.width = '100%';
      return;
    }
    var ch = SIM.chapter(), idx = G.chapter || 0;
    var act = SIM.activeQuests();
    el('gc-ch').textContent = 'Chapter ' + ROMAN[idx] + ' · ' + ch.title;
    if (!act.length) { el('gc-goal').textContent = 'Chapter complete!'; el('gc-fill').style.width = '100%'; return; }
    var q = act[0], p = SIM.goalProgress(q);
    var frac = p.need > 0 ? p.have / p.need : 0;
    var num = p.need > 1 && !(DATA.B.cathedral && q.need.bld && q.need.bld.cathedral) ? ' (' + Math.floor(p.have) + '/' + p.need + ')' : '';
    if (q.need.bld && q.need.bld.cathedral && p.have > 0) num = ' (' + Math.round(p.have * 100) + '%)';
    el('gc-goal').textContent = q.label + num + (act.length > 1 ? '  ·  +' + (act.length - 1) + ' more' : '');
    el('gc-fill').style.width = Math.round(U.clamp(frac, 0, 1) * 100) + '%';
  }

  /* =========================================================
     SHEET
     ========================================================= */
  function openSheet(panel) {
    if (openPanel === panel) { closeSheet(); return; }
    openPanel = panel;
    cancelBuild();
    el('sheet').classList.remove('hidden', 'closing');
    el('sheet-scrim').classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.panel === panel);
    });
    renderSheet(true);
  }
  function closeSheet() {
    if (!openPanel) return;
    openPanel = null;
    var sh = el('sheet');
    sh.classList.add('closing');
    setTimeout(function () { sh.classList.add('hidden'); sh.classList.remove('closing'); }, 190);
    el('sheet-scrim').classList.add('hidden');
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
  }

  var PANELS = {
    build: { title: 'Build', tabs: function () { return [{ key: 'suggested', name: '★ Suggested' }].concat(DATA.CATS); }, body: buildBody },
    people: { title: 'People', tabs: function () { return [{ key: 'quests', name: 'Story' }, { key: 'overview', name: 'Realm' }, { key: 'folk', name: 'Families' }, { key: 'jobs', name: 'Work' }]; }, body: peopleBody },
    army: { title: 'Army', tabs: function () { return [{ key: 'roster', name: 'Roster' }, { key: 'muster', name: 'Muster' }, { key: 'war', name: 'War' }, { key: 'dip', name: 'Diplomacy' }]; }, body: armyBody },
    tech: { title: 'Research', tabs: function () { return [{ key: 1, name: 'Tier I' }, { key: 2, name: 'Tier II' }, { key: 3, name: 'Tier III' }]; }, body: techBody },
    decrees: { title: 'Royal Decrees', tabs: function () { return [{ key: 'all', name: 'Decrees' }]; }, body: decreesBody },
    alerts: { title: 'Needs attention', tabs: function () { return [{ key: 'all', name: 'All' }]; }, body: alertsBody },
    news: { title: 'News', tabs: function () { return [{ key: 'all', name: 'Latest' }]; }, body: newsBody },
    world: { title: 'The Realm', tabs: function () { return [{ key: 'castle', name: 'Castle' }, { key: 'trade', name: 'Trade' }, { key: 'sea', name: 'Sea chart' }, { key: 'honours', name: 'Honours' }, { key: 'chronicle', name: 'Chronicle' }, { key: 'settings', name: 'Settings' }]; }, body: worldBody }
  };

  try { var savedTabs = JSON.parse(localStorage.getItem('ashveil.tabs') || '{}'); Object.keys(savedTabs).forEach(function (k) { openTab[k] = savedTabs[k]; }); } catch (e) {}
  function rememberTabs() { try { localStorage.setItem('ashveil.tabs', JSON.stringify(openTab)); } catch (e) {} }
  /* tabs that show slow-changing things, drawn once rather than every moment */
  var STILL = { 'world:sea': 1, 'world:honours': 1, 'world:settings': 1, 'world:chronicle': 1, 'people:folk': 1, 'people:overview': 1, 'news:all': 1, 'army:dip': 1 };
  var touchedSheet = 0;
  function renderSheet(rebuildTabs) {
    if (!openPanel) return;
    var p = PANELS[openPanel];
    if (!p) return;
    el('sheet-title').textContent = p.title;
    var tabs = p.tabs();
    if (openTab[openPanel] === undefined) openTab[openPanel] = tabs[0].key;
    if (rebuildTabs) {
      var box = el('sheet-tabs');
      box.innerHTML = '';
      tabs.forEach(function (t) {
        var b = h('<button class="tab' + (openTab[openPanel] === t.key ? ' active' : '') + '">' + t.name + '</button>');
        b.addEventListener('click', function () {
          openTab[openPanel] = t.key;
          rememberTabs();
          renderSheet(true);
        });
        box.appendChild(b);
      });
    }
    var body = el('sheet-body');
    var st = body.scrollTop;
    body.innerHTML = '';
    p.body(body, openTab[openPanel]);
    if (!rebuildTabs) body.scrollTop = st;
  }

  /* ---------------- DECREES ---------------- */
  function decreesBody(box) {
    box.appendChild(h('<p class="hint">Things you can simply order. Each has its price, and the people need time before you can order it again.</p>'));
    if (SIM.G.shiftUntil > SIM.G.time) {
      box.appendChild(h('<div class="card" style="border-color:#e0b23c"><div class="card-main"><h4>⚒️ Double shifts are on</h4><p>' +
        ((SIM.G.shiftUntil - SIM.G.time) / DATA.SEASON_LEN).toFixed(1) + ' seasons left at +30% output.</p></div></div>'));
    }
    Object.keys(DATA.DECREES).forEach(function (id) {
      var d = DATA.DECREES[id], wait = SIM.decreeReady(id), cost = SIM.decreeCost(id);
      var card = h('<div class="card"><div class="card-row"><div class="card-ic" style="font-size:22px">' + d.ic + '</div>' +
        '<div class="card-main"><h4>' + d.name + '</h4><p>' + d.desc + '</p>' +
        '<div class="cost">' + costPills(cost) + '<b>' + d.effect + '</b></div></div></div></div>');
      var b = h('<button class="btn wide">Decree it</button>');
      if (wait > 0) { b.disabled = true; b.textContent = 'Again in ' + (wait / DATA.SEASON_LEN).toFixed(1) + ' seasons'; }
      else if (!SIM.canAfford(cost)) { b.disabled = true; b.textContent = 'Cannot afford it'; }
      b.addEventListener('click', function () {
        var r = SIM.decree(id);
        if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); }
        renderSheet(); refreshHUD();
      });
      card.appendChild(b);
      box.appendChild(card);
    });
  }

  /* ---------------- ALERTS ---------------- */
  function alertsBody(box) {
    var list = SIM.issues();
    if (!list.length) {
      box.appendChild(h('<p class="hint">Nothing needs you. The realm is running itself — a good moment to build something, or study.</p>'));
      return;
    }
    box.appendChild(h('<p class="hint">Tap anything with a place attached and the map will take you there.</p>'));
    list.forEach(function (i) {
      var row = h('<button class="issue sev' + i.sev + '">' +
        '<span class="ic">' + i.ic + '</span>' +
        '<span class="body"><b>' + i.text + '</b>' + (i.hint ? '<small>' + i.hint + '</small>' : '') + '</span>' +
        (i.b ? '<span class="go">Show ›</span>' : '') +
        '</button>');
      if (i.ship) {
        row.addEventListener('click', function () {
          closeSheet(); RENDER.centreOn(SIM.G.ship.x - 0.5, SIM.G.ship.y - 0.5); setTimeout(openShip, 250);
        });
      }
      if (i.b) {
        row.addEventListener('click', function () {
          RENDER.centreOn(i.b.x, i.b.y);
          closeSheet();
          select({ b: i.b });
          U.sfx.tap();
        });
      }
      box.appendChild(row);
    });
  }

  /* ---------------- BUILD ---------------- */
  function buildCard(id, reason) {
    var G = SIM.G, def = DATA.B[id];
    var lock = SIM.lockReason(id);
    var maxed = def.max && SIM.countAll(id) >= def.max;
    var cost = SIM.costOf(id);
    var extra = def.wonderCost ? '<p style="color:#d9c89a;margin-top:4px">Then, as it rises: ' +
      Object.keys(def.wonderCost).map(function (k) { return def.wonderCost[k] + ' ' + k; }).join(', ') + '</p>' : '';
    var card = h('<div class="card' + (lock ? ' locked' : '') + '">' +
      '<div class="card-row">' +
        '<div class="card-ic"></div>' +
        '<div class="card-main">' +
          '<h4>' + def.name + (G.count[id] ? ' <span style="opacity:.55;font-weight:400">×' + G.count[id] + '</span>' : '') +
            ((def.w || 1) > 1 ? ' <span style="opacity:.5;font-weight:400;font-size:11px">' + def.w + '×' + def.h + '</span>' : '') + '</h4>' +
          '<p>' + def.desc + '</p>' + extra +
          '<div class="cost">' + costPills(cost) +
            (def.jobs ? '<b>👷 ' + def.jobs + '</b>' : '') +
            (def.upkeep ? '<b>−' + def.upkeep.toFixed(2) + 'g/s</b>' : '') +
          '</div>' +
          (reason ? '<span class="need-tag' + (/^For your chapter/.test(reason) ? ' chap' : '') + '">' + reason + '</span>' : '') +
          (lock ? '<p style="color:#e0b23c;margin-top:5px">🔒 ' + lock + '</p>' : '') +
        '</div>' +
      '</div></div>');
    card.querySelector('.card-ic').appendChild(ART.icon(id, 44));
    var btn = h('<button class="btn wide">Place</button>');
    btn.disabled = !!lock || maxed;
    if (maxed) btn.textContent = 'Limit reached (' + def.max + ')';
    else if (!lock && !SIM.canAfford(cost)) {
      // mark it out now; the builders start as soon as the stores can pay
      var eta = affordIn(cost);
      btn.classList.add('sec');
      btn.innerHTML = '📐 Plan it <small>' + (eta < 0 ? 'short of ' + shortOf(cost) + ' — nothing coming in' : eta < 3 ? 'ready any moment' : 'ready in ~' + fmtWait(eta)) + '</small>';
    }
    btn.addEventListener('click', function () { startBuild(id); });
    card.appendChild(btn);
    return card;
  }
  /* seconds (at 1×) until the stores could pay, or −1 if they never will */
  function affordIn(cost) {
    var G = SIM.G, net = SIM.ledger(), worst = 0;
    for (var k in cost) {
      var need = cost[k] - (G.res[k] || 0);
      if (need <= 0) continue;
      var rate = net[k] || 0;
      if (k === 'food') rate = SIM.foodTrend(net);
      if (rate <= 0.0005) return -1;
      if (SIM.cap(k) < cost[k]) return -1;
      worst = Math.max(worst, need / rate);
    }
    return worst;
  }
  function shortOf(cost) {
    return Object.keys(cost).filter(function (k) { return SIM.G.res[k] < cost[k]; }).join(' & ');
  }
  function fmtWait(sec) {
    if (sec < 90) return Math.ceil(sec / 5) * 5 + 's';
    if (sec < DATA.SEASON_LEN * 2) return Math.round(sec / 60) + ' min';
    return (sec / DATA.SEASON_LEN).toFixed(1) + ' seasons';
  }
  function buildBody(box, cat) {
    var plans = SIM.plans;
    if (plans.length) {
      box.appendChild(h('<p class="hint">📐 <b>' + plans.length + ' planned</b> — ' + plans.map(function (p) { return DATA.B[p.id].name; }).join(', ') +
        '. The builders start each one, in order, as soon as it can be paid for. Tap a plan on the map to cancel it.</p>'));
    }
    var adv = SIM.advice();
    if (cat === 'suggested') {
      if (!adv.order.length) {
        box.appendChild(h('<p class="hint">Nothing is urgent. Browse the other tabs — or keep an eye on the goal card at the top of the screen.</p>'));
        return;
      }
      box.appendChild(h('<p class="hint">What your realm needs most right now. Building on woodland clears it for you and puts the timber in store.</p>'));
      adv.order.slice(0, 6).forEach(function (id) { box.appendChild(buildCard(id, adv.map[id])); });
      return;
    }
    var any = false;
    Object.keys(DATA.B).forEach(function (id) {
      var def = DATA.B[id];
      if (def.cat !== cat || def.unique || def.isRoad) return;
      any = true;
      box.appendChild(buildCard(id, adv.map[id]));
    });
    if (!any) box.appendChild(h('<p class="hint">Nothing here yet — research will unlock more.</p>'));
  }

  /* ---------------- PEOPLE ---------------- */
  function folkBody(box) {
    var f = FOLK.summary(), st = f.stats;
    box.appendChild(h('<div class="card">' +
      '<div class="stat-line"><span>Households</span><b>' + f.households + '</b></div>' +
      '<div class="stat-line"><span>Married couples</span><b>' + f.couples + '</b></div>' +
      '<div class="stat-line"><span>Children · elders</span><b>' + f.children + ' · ' + f.elders + '</b></div>' +
      (f.oldest ? '<div class="stat-line"><span>Oldest soul</span><b>' + FOLK.full(f.oldest) + ', ' + Math.floor(f.oldest.a) + '</b></div>' : '') +
      '<div class="stat-line"><span>This year</span><b>' + st.born + ' born · ' + st.wed + ' wed · ' + st.came + ' came · ' + (st.died + st.left) + ' lost</b></div>' +
      (f.sick ? '<div class="stat-line"><span style="color:#d8c13a">🤒 Fever</span><b>' + f.sick + ' ill in ' + f.sickHomes + ' home' + (f.sickHomes > 1 ? 's' : '') + '</b></div>' : '') +
      (f.noWell ? '<div class="stat-line"><span>Homes with no well near</span><b style="color:#e0b23c">' + f.noWell + '</b></div>' : '') +
      '</div>'));
    box.appendChild(h('<p class="hint">Tap anyone in the lanes to meet them. Crowded homes far from a <b>well</b> breed fever; a yellow cloth on the door marks a sick house — tap it to send for the physician.</p>'));
    box.appendChild(h('<p class="sect-label">Families of Ashveil</p>'));
    box.appendChild(h('<div class="card"><p class="folk-names fams">' + FOLK.families().slice(0, 18).map(function (x) {
      return '<span>' + x.f + ' <i>' + x.n + '</i></span>'; }).join('') + '</p></div>'));
    if (f.log.length) {
      box.appendChild(h('<p class="sect-label">Births, weddings and burials</p>'));
      box.appendChild(h('<div class="card">' + f.log.slice(0, 14).map(function (l) {
        return '<div class="stat-line"><span style="flex:0 0 58px;color:#8a7a5e">' + l.s + '</span><b style="font-weight:400;text-align:left;flex:1">' + l.m + '</b></div>';
      }).join('') + '</div>'));
    }
  }

  function peopleBody(box, tab) {
    var G = SIM.G;
    if (tab === 'folk') { folkBody(box); return; }
    if (tab === 'overview') {
      var target = SIM.happyTarget();
      var led = h('<div class="card ledger"><p class="sect-label" style="margin:0 0 6px">The ledger, season by season</p><div class="ledger-grid"></div></div>');
      var lg = led.querySelector('.ledger-grid');
      [['pop', 'People', '#8fd06a'], ['food', 'Food', '#d9bf55'], ['gold', 'Gold', '#e0b23c'], ['happy', 'Contentment', '#6fb0d9']].forEach(function (c) {
        var cell = h('<div><span>' + c[1] + '</span><canvas></canvas></div>');
        lg.appendChild(cell);
        requestAnimationFrame(function () { HONOURS.drawChart(cell.querySelector('canvas'), c[0], c[2]); });
      });
      box.appendChild(led);
      box.appendChild(h('<div class="card">' +
        '<div class="stat-line"><span>Villagers</span><b>' + Math.floor(G.pop) + ' / ' + SIM.housing() + ' housing</b></div>' +
        '<div class="stat-line"><span>At work</span><b>' + (Math.floor(G.pop) - (G.idle || 0)) + '</b></div>' +
        '<div class="stat-line"><span>Labourers (foraging &amp; hauling)</span><b>' + (G.idle || 0) + '</b></div>' +
        '<div class="stat-line"><span>Contentment</span><b>' + Math.round(G.happy) + '% → ' + Math.round(target) + '%</b></div>' +
        '<div class="meter"><i class="' + (G.happy < 30 ? 'bad' : G.happy < 55 ? 'warn' : '') + '" style="width:' + G.happy + '%"></i></div>' +
        '<div class="stat-line" style="margin-top:8px"><span>Work efficiency</span><b>' + Math.round(SIM.efficiency() * 100) + '%</b></div>' +
        '<div class="stat-line"><span>Tools in workers\' hands</span><b style="color:' +
          ((G.toolCov || 0) > 0.66 ? '#8fd06a' : (G.toolCov || 0) > 0.2 ? '#e0b23c' : '#e0795f') + '">' +
          Math.round((G.toolCov || 0) * 100) + '% — +' + Math.round((G.toolCov || 0) * 25) + '% output</b></div>' +
        '<div class="stat-line"><span>Bread on the table</span><b style="color:' +
          ((G.breadCov || 0) > 0.66 ? '#8fd06a' : (G.breadCov || 0) > 0.2 ? '#e0b23c' : '#a8967a') + '">' +
          Math.round((G.breadCov || 0) * 100) + '% — −' + Math.round((G.breadCov || 0) * 35) + '% grain eaten, +' +
          Math.round((G.breadCov || 0) * 12) + ' contentment</b></div>' +
        '<div class="stat-line"><span>Season effect on farms</span><b>×' + (SIM.G.tech.irrigation && SIM.season().key === 'winter' ? 0.65 : SIM.season().food) + '</b></div>' +
        '</div>'));
      var lvls = [1, 2, 3].map(function (l) { return SIM.countHouseTier(l); });
      var nf = SIM.nextFestival();
      box.appendChild(h('<div class="card"><div class="stat-line"><span>' + nf.icon + ' Next occasion</span><b>' +
        nf.name + ' — ' + nf.seasons.toFixed(1) + ' seasons</b></div>' +
        (SIM.fairOn() ? '<div class="stat-line"><span>🎪 The fair is open</span><b>better prices at market</b></div>' : '') +
        '</div>'));
      box.appendChild(h('<p class="sect-label">Homes</p>'));
      box.appendChild(h('<div class="card">' +
        '<div class="stat-line"><span>🏠 Cottages</span><b>' + (lvls[0] - lvls[1]) + '</b></div>' +
        '<div class="stat-line"><span>🏘️ Townhouses</span><b>' + (lvls[1] - lvls[2]) + '</b></div>' +
        '<div class="stat-line"><span>🏛️ Fine houses</span><b>' + lvls[2] + '</b></div>' +
        '<div class="stat-line"><span>Homes can currently reach</span><b>' +
          (DATA.B.house.tierNames[SIM.houseTierEarned() - 1]) + '</b></div>' +
        '</div>'));
      box.appendChild(h('<p class="hint">Homes better themselves when the realm can keep them that way — contentment, bread, and cloth. Better homes hold more people and pay more tax. Let standards slip and they slip back.</p>'));
      box.appendChild(h('<p class="sect-label">What moves contentment</p>'));
      var lines = [];
      var capacity = 0;
      G.buildings.forEach(function (b) { if (b.built && b.def.happy) capacity += b.def.happy * 6; });
      lines.push(['Amenities serve', Math.round(capacity) + ' of ' + Math.floor(G.pop) + ' people']);
      lines.push(['Bread', (G.breadCov || 0) > 0.05 ? '+' + Math.round((G.breadCov || 0) * 12) : 'none baked']);
      lines.push(['Food stores', G.res.food > G.pop * 10 ? 'plentiful (+8)' : G.res.food <= 0 ? 'empty (−34)' : G.res.food < G.pop * 2 ? 'low (−12)' : 'adequate']);
      lines.push(['Growing?', G.pop >= SIM.housing() ? 'no — out of housing'
        : G.res.food <= G.pop * 1.5 ? 'no — barns too low to feed more mouths'
        : G.happy <= 38 ? 'no — people are too unhappy' : 'yes']);
      if (G.pop > SIM.housing()) lines.push(['Overcrowding', '−18']);
      if (SIM.season().key === 'winter') lines.push(['Winter', '−4']);
      if (G.tech.sanitation) lines.push(['Sanitation', '+8']);
      lines.push(['War record', (G.stats.wins - G.stats.losses >= 0 ? '+' : '') + (G.stats.wins - G.stats.losses) * 2]);
      box.appendChild(h('<div class="card">' + lines.map(function (l) {
        return '<div class="stat-line"><span>' + l[0] + '</span><b>' + l[1] + '</b></div>';
      }).join('') + '</div>'));
      if ((G.toolCov || 0) < 0.66) {
        box.appendChild(h('<p class="hint">Workers without tools are slow. A <b>Blacksmith</b> turns iron and timber into tools, and a well-stocked realm works <b>25% faster at everything</b>.</p>'));
      }
      box.appendChild(h('<p class="hint">Build wells, chapels and taverns to keep people content — unhappy villagers work slowly and eventually leave.</p>'));
    }

    if (tab === 'jobs') {
      box.appendChild(h('<p class="hint">Villagers post themselves. Every few moments the realm works out what it is short of and shares everyone out in proportion to how badly each workplace is needed — so a famine pulls people onto the farms and full barns send them elsewhere. Anyone with no post left becomes a <b>labourer</b>, foraging and hauling for the builders. Pause a building to keep hands off it, and upgrade to raise output without needing more people.</p>'));
      var working = G.buildings.filter(function (b) { return b.built && SIM.jobsOf(b) > 0; });
      if (!working.length) box.appendChild(h('<p class="hint">No workplaces yet.</p>'));
      working.sort(function (a, b) { return a.def.cat.localeCompare(b.def.cat) || a.uid - b.uid; });
      working.forEach(function (b) {
        var out = SIM.output(b);
        var outTxt = Object.keys(out).filter(function (k) { return Math.abs(out[k]) > 0.001; })
          .map(function (k) { return U.signed(out[k], 2) + ' ' + k; }).join(', ') || 'idle';
        var card = h('<div class="card"><div class="card-row">' +
          '<div class="card-ic"></div>' +
          '<div class="card-main"><h4>' + b.def.name + ' <span style="opacity:.5;font-weight:400">(' + b.x + ',' + b.y + ')</span></h4>' +
          '<p>' + b.workers + '/' + SIM.jobsOf(b) + ' workers · ' + (b.paused ? 'paused' : SIM.priorityLabel(SIM.scoreOf(b)) + ' need') +
          ((b.level || 1) > 1 ? ' · Lv ' + b.level : '') + ' · ' + outTxt + '/s</p></div>' +
          '</div></div>');
        card.querySelector('.card-ic').appendChild(ART.icon(b.id, 40));
        var row = h('<div style="display:flex;gap:6px;margin-top:8px"></div>');
        var pb = h('<button class="btn sec" style="flex:1">' + (b.paused ? '▶ Resume' : '⏸ Pause') + '</button>');
        pb.addEventListener('click', function () { b.paused = !b.paused; SIM.assignWorkers(true); renderSheet(); });
        var gb = h('<button class="btn sec" style="flex:1">Show</button>');
        gb.addEventListener('click', function () { RENDER.centreOn(b.x, b.y); closeSheet(); select({ b: b }); });
        row.appendChild(pb); row.appendChild(gb);
        card.appendChild(row);
        box.appendChild(card);
      });
    }

    if (tab === 'quests') {
      var idx = G.chapter || 0, ch = SIM.chapter();
      if (G.won) box.appendChild(h('<div class="card" style="border-color:#e0b23c"><h4 style="font-family:var(--font);font-size:16px">👑 Your reign is complete</h4><p class="story">Every chapter is told. Ashveil is yours to keep building for as long as you like.</p></div>'));
      box.appendChild(h('<p class="sect-label">Chapter ' + ROMAN[idx] + ' of ' + DATA.CHAPTERS.length + '</p>'));
      var goals = ch.goals.map(function (q) {
        var p = SIM.goalProgress(q), done = !!G.quests[q.id];
        var prog = done ? 'done' : (q.need.bld && q.need.bld.cathedral) ? Math.round(p.have * 100) + '%' : Math.floor(p.have) + ' / ' + p.need;
        var rw = Object.keys(q.reward).map(function (k) {
          var r = DATA.RES.filter(function (rr) { return rr.key === k; })[0];
          return (r ? r.ic : '') + q.reward[k];
        }).join(' ');
        return '<div class="goal-row' + (done ? ' done' : '') + '"><span class="tick">' + (done ? '✅' : '▫️') + '</span>' +
          '<span class="lbl">' + q.label + (rw && !done ? ' <span style="opacity:.6;font-size:11px">· ' + rw + '</span>' : '') + '</span>' +
          '<span class="prog">' + prog + '</span></div>';
      }).join('');
      box.appendChild(h('<div class="card"><h4 style="font-family:var(--font);font-size:16px">' + ch.icon + ' ' + ch.title + '</h4>' +
        '<p class="story">' + ch.text + '</p>' + goals + '</div>'));
      if (idx > 0) {
        box.appendChild(h('<p class="sect-label">Behind you</p>'));
        for (var i = idx - 1; i >= 0; i--) {
          var c = DATA.CHAPTERS[i];
          box.appendChild(h('<div class="card" style="opacity:.6"><div class="card-main"><h4>✓ ' + ROMAN[i] + ' · ' + c.title + '</h4><p>' + c.done + '</p></div></div>'));
        }
      }
    }
  }

  /* ---------------- ARMY ---------------- */
  function armyBody(box, tab) {
    var G = SIM.G;
    if (tab === 'roster') {
      var sb = SIM.smithBonus();
      box.appendChild(h('<div class="card">' +
        '<div class="stat-line"><span>Soldiers</span><b>' + SIM.armyCount() + '</b></div>' +
        '<div class="stat-line"><span>Capacity used</span><b>' + SIM.armySlots() + ' / ' + SIM.armyCap() + '</b></div>' +
        '<div class="meter"><i style="width:' + Math.min(100, SIM.armySlots() / Math.max(1, SIM.armyCap()) * 100) + '%"></i></div>' +
        '<div class="stat-line" style="margin-top:8px"><span>Smithy bonus</span><b>+' + Math.round((sb.atk - 1) * 100) + '% attack, +' + Math.round((sb.def - 1) * 100) + '% defence</b></div>' +
        '<div class="stat-line"><span>Home defence</span><b>+' + SIM.defenseScore() + '</b></div>' +
        '<div class="stat-line"><span>Upkeep</span><b>' + (SIM.armySlots() * 0.014).toFixed(2) + ' g/s · ' + (SIM.armySlots() * 0.012).toFixed(2) + ' food/s</b></div>' +
        '<div class="stat-line"><span>Formation</span><b>' + (DATA.FORMATIONS[G.formation] || DATA.FORMATIONS.line).name + '</b></div>' +
        '</div>'));
      box.appendChild(h('<p class="hint">Soldiers who survive a victory become <b>veterans</b> — +22% health and +20% attack next time out. Lose a battle and only the veterans who walked away keep the rank.</p>'));
      if (G.campaign) {
        box.appendChild(h('<p class="hint">⚔️ <b>' + SIM.awayCount() + ' soldiers are in the field</b> and are not defending Ashveil. See the War tab.</p>'));
      }
      var keys = Object.keys(G.army);
      if (!keys.length) box.appendChild(h('<p class="hint">You have no soldiers at home. Muster some before Brannoch comes calling.</p>'));
      keys.forEach(function (k) {
        var u = DATA.UNITS[k];
        var card = h('<div class="card"><div class="card-row">' +
          '<div class="card-ic" style="font-size:22px">' + u.ic + '</div>' +
          '<div class="card-main"><h4>' + u.name + ' ×' + G.army[k] +
          (((G.vets || {})[k]) ? ' <span style="color:#e0b23c;font-weight:400">· ' + G.vets[k] + ' veteran</span>' : '') + '</h4>' +
          '<p>' + u.hp + ' hp · ' + u.atk + ' atk · ' + u.def + ' def' + (u.rng > 40 ? ' · ranged' : '') + '</p></div>' +
          '</div></div>');
        var db = h('<button class="btn sec wide">Disband one (villager returns)</button>');
        db.addEventListener('click', function () { SIM.disband(k); renderSheet(); });
        card.appendChild(db);
        box.appendChild(card);
      });
    }

    if (tab === 'muster') {
      box.appendChild(h('<p class="hint">Each soldier costs one villager. Capacity comes from barracks, ranges and your castle.</p>'));
      Object.keys(DATA.UNITS).forEach(function (k) {
        var u = DATA.UNITS[k];
        var avail = SIM.unitAvailable(k);
        var card = h('<div class="card' + (avail ? '' : ' locked') + '"><div class="card-row">' +
          '<div class="card-ic" style="font-size:22px">' + u.ic + '</div>' +
          '<div class="card-main"><h4>' + u.name + '</h4><p>' + u.desc + '</p>' +
          '<div class="cost">' + costPills(u.cost) + '<b>❤ ' + u.hp + '</b><b>⚔ ' + u.atk + '</b><b>🛡 ' + u.def + '</b>' +
          (u.slots > 1 ? '<b>takes ' + u.slots + ' slots</b>' : '') + '</div>' +
          (avail ? '' : '<p style="color:#e0b23c;margin-top:5px">🔒 Needs ' +
            (u.tech && !SIM.G.tech[u.tech] ? DATA.TECH[u.tech].name : 'a ' + DATA.B[u.need].name) + '</p>') +
          '</div></div>');
        var row = h('<div style="display:flex;gap:6px;margin-top:8px"></div>');
        [1, 5].forEach(function (n) {
          var b = h('<button class="btn" style="flex:1">Muster ' + n + '</button>');
          b.disabled = !avail;
          b.addEventListener('click', function () {
            var r = SIM.recruit(k, n);
            if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); }
            else { toast('Mustered ' + r.made + '× ' + u.name, 'good'); }
            renderSheet(); refreshHUD();
          });
          row.appendChild(b);
        });
        card.appendChild(row);
        box.appendChild(card);
      });
    }

    if (tab === 'dip') { dipBody(box); return; }
    if (tab === 'war') {
      var r = G.rival;
      var attackOdds = estimateOdds(r.str, 'raid');
      var incoming = SIM.raidPower();
      var defendOdds = estimateOdds(incoming, 'defend');
      var grace = SIM.graceLeft();
      function col(o) { return o > 60 ? '#8fd06a' : o > 38 ? '#e0b23c' : '#e0795f'; }
      box.appendChild(h('<div class="card">' +
        '<h4 style="font-family:var(--font);font-size:15px">Brannoch</h4>' +
        '<p style="font-size:12px;color:#c3b18e;margin:4px 0 8px">A hard neighbour across the ash flats. They grow stronger every season you leave them alone.</p>' +
        '<div class="stat-line"><span>Their strength</span><b>' + Math.round(r.str) + '</b></div>' +
        '<div class="stat-line"><span>Your field strength</span><b>' + Math.round(fieldStrength()) + '</b></div>' +
        '<div class="stat-line"><span>Odds if you attack</span><b style="color:' + col(attackOdds) + '">' + attackOdds + '%</b></div>' +
        '<div class="stat-line"><span>Odds if they raid you</span><b style="color:' + col(defendOdds) + '">' + defendOdds + '%</b></div>' +
        '<div class="stat-line"><span>Strength of their next raid</span><b>' + Math.round(incoming) + '</b></div>' +
        '<div class="stat-line"><span>Do they fear you?</span><b style="color:' +
          (SIM.deterrence() > 1.45 ? '#8fd06a' : SIM.deterrence() > 0.9 ? '#e0b23c' : '#e0795f') + '">' +
          (SIM.deterrence() > 1.45 ? 'yes — many raids turn back' : SIM.deterrence() > 0.9 ? 'they are wary' : 'no — you look easy') + '</b></div>' +
        '<div class="stat-line"><span>Next raid on you</span><b>' + (SIM.atPeace() ? 'none — you have a treaty' : grace > 0 ? 'at peace for ' + grace + ' more season' + (grace > 1 ? 's' : '') : '~' + Math.max(0, Math.round(r.nextRaid / DATA.SEASON_LEN * 10) / 10) + ' seasons') + '</b></div>' +
        '<div class="stat-line"><span>Battles won / lost</span><b>' + G.stats.wins + ' / ' + G.stats.losses + '</b></div>' +
        '</div>'));
      box.appendChild(h('<p class="sect-label">Formation</p>'));
      Object.keys(DATA.FORMATIONS).forEach(function (fk) {
        var f = DATA.FORMATIONS[fk];
        var on = (G.formation || 'line') === fk;
        var c = h('<div class="card" style="' + (on ? 'border-color:#e0b23c' : '') + '"><div class="card-row">' +
          '<div class="card-ic" style="font-size:20px">' + f.ic + '</div>' +
          '<div class="card-main"><h4>' + f.name + (on ? ' ✓' : '') + '</h4><p>' + f.desc + '</p></div></div></div>');
        c.addEventListener('click', function () { G.formation = fk; U.sfx.tap(); renderSheet(); });
        box.appendChild(c);
      });

      if (G.campaign) {
        var ph = G.campaign.phase;
        var seasons = Math.max(0, G.campaign.timeLeft / DATA.SEASON_LEN).toFixed(1);
        box.appendChild(h('<div class="card" style="border-color:#8a6f45">' +
          '<h4 style="font-family:var(--font);font-size:15px">⚔️ ' +
            (ph === 'out' ? 'Marching on ' + G.campaign.name : ph === 'battle' ? 'Battle joined' : 'Marching home') + '</h4>' +
          '<p style="font-size:12px;color:#c3b18e;margin:4px 0 8px">' +
            (ph === 'out' ? 'Your army is on the road. Home is held by walls and towers alone.'
             : ph === 'battle' ? 'They have reached the border.'
             : 'The survivors are on their way back.') + '</p>' +
          '<div class="stat-line"><span>Soldiers in the field</span><b>' + SIM.awayCount() + '</b></div>' +
          (ph === 'battle' ? '' : '<div class="stat-line"><span>Arrives in</span><b>' + seasons + ' seasons</b></div>') +
          '<div class="stat-line"><span>Provisions</span><b>−' + (SIM.campaignSlots() * 0.02).toFixed(2) + ' food/s</b></div>' +
          '<div class="stat-line"><span>Defending home</span><b>' + SIM.armyCount() + ' soldiers, +' + SIM.defenseScore() + ' walls</b></div>' +
          '</div>'));
      } else {
        var raid = h('<button class="btn wide">⚔️ March on Brannoch</button>');
        raid.disabled = SIM.armyCount() < 3;
        if (SIM.armyCount() < 3) raid.textContent = 'You need at least 3 soldiers';
        if (SIM.atPeace()) raid.textContent = '⚔️ March on Brannoch (breaks your ' + (SIM.dip().ally ? 'alliance' : 'pact') + ')';
        raid.addEventListener('click', function () {
          if (SIM.atPeace() && !raid.dataset.sure) {
            raid.dataset.sure = 1; raid.textContent = 'Tap again to break faith and march'; raid.classList.add('danger'); U.sfx.err(); return;
          }
          var r = SIM.launchCampaign({ power: G.rival.str, name: 'Brannoch' });
          if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); return; }
          U.sfx.horn();
          chronicle('The army marched for Brannoch.');
          renderSheet(); refreshHUD();
        });
        box.appendChild(raid);
        box.appendChild(h('<p class="hint">A march takes about ' + SIM.MARCH_SEASONS +
          ' season each way and eats provisions on the road. While your army is away, only walls and towers defend Ashveil — and Brannoch judges its raids by your whole strength, not by what is left at home.</p>'));
      }
      var scout = h('<button class="btn sec wide">🔭 Scout their camp (−25 gold)</button>');
      scout.addEventListener('click', function () {
        if (G.res.gold < 25) { toast('Not enough gold', 'bad'); return; }
        G.res.gold -= 25;
        var f = BATTLE.foeArmy(G.rival.str, null);
        toast('Scouts report: ' + Object.keys(f).map(function (k) {
          return f[k] + '× ' + DATA.FOE_UNITS[k].name;
        }).join(', '), 'war');
        r.nextRaid = Math.max(r.nextRaid, DATA.SEASON_LEN * 0.6);
        renderSheet();
      });
      box.appendChild(scout);
      box.appendChild(h('<p class="hint">Brannoch sizes each raid against <b>your</b> strength, so you will not be jumped by an army ten times your own — but leave yourself defenceless and they will still take your stores. Walls and watchtowers only help when <b>defending</b>. Attacking is won by numbers, archers and smithies.</p>'));
    }
  }

  function dipBody(box) {
    var G = SIM.G, d = SIM.dip(), p = SIM.persona(), mood = SIM.dipMood(), D = SIM.DIP;
    var pct = (d.att + 100) / 2;
    var status = d.ally ? '💍 Allies by marriage' : d.pact >= 0 ? '🤝 Trade pact' : G.tribute ? '⚖️ Paying you tribute' : '⚔️ No treaty';
    box.appendChild(h('<div class="card">' +
      '<h4 style="font-family:var(--font);font-size:15px">Lord Harric of Brannoch</h4>' +
      '<p style="font-size:12px;color:#c3b18e;margin:4px 0 8px">' + (d.known ? p.desc : 'You know little of him yet. Send an envoy to learn his temper.') + '</p>' +
      '<div class="stat-line"><span>Their mood</span><b style="color:' + mood.col + '">' + mood.name + ' (' + (d.att > 0 ? '+' : '') + Math.round(d.att) + ')</b></div>' +
      '<div class="meter dip"><i style="width:' + pct.toFixed(1) + '%"></i><em style="left:' + ((D.pactAtt + 100) / 2) + '%"></em><em style="left:' + ((D.allyAtt + 100) / 2) + '%"></em></div>' +
      '<div class="stat-line" style="margin-top:8px"><span>Standing</span><b>' + status + '</b></div>' +
      (d.known ? '<div class="stat-line"><span>Temper</span><b>' + p.name + '</b></div>' : '') +
      (G.tribute ? '<div class="stat-line"><span>Tribute</span><b>' + G.tribute.amt + ' gold × ' + G.tribute.left + ' seasons</b></div>' : '') +
      '</div>'));
    function act(kind, label, sub, disabledWhy) {
      var b = h('<button class="btn ' + (kind === 'pact' || kind === 'ally' ? '' : 'sec ') + 'wide dip-act">' +
        '<span>' + label + '</span><small>' + (disabledWhy || sub) + '</small></button>');
      b.disabled = !!disabledWhy;
      b.addEventListener('click', function () {
        var r = SIM.dipAct(kind);
        if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); return; }
        toast(r.msg, 'good'); U.sfx.tap();
        chronicle(kind === 'gift' ? 'Sent gifts to Brannoch.' : kind === 'envoy' ? 'An envoy went to Brannoch.' :
                  kind === 'pact' ? 'Signed a trade pact with Brannoch.' : 'A royal wedding: Brannoch is now an ally.');
        SIM.save(); renderSheet(); refreshHUD();
      });
      box.appendChild(b);
    }
    var marching = G.campaign ? 'Not while your army is marching on them' : '';
    act('envoy', '📜 Send an envoy · ' + D.envoy + ' gold', d.known ? 'Keep the talks going (+3).' : 'Learn their lord\'s temper, and warm him a little.',
      marching || (SIM.dipReady('envoy') ? '' : 'Your last envoy has only just returned'));
    act('gift', '🎁 Send gifts · ' + D.gift + ' gold', 'Warms them' + (d.known ? ' by about ' + Math.round(12 * p.gift) : '') + ' and delays any raid.',
      marching || (SIM.dipReady('gift') ? '' : 'You sent gifts this season'));
    if (!d.ally && d.pact < 0) {
      act('pact', '🤝 Offer a trade pact · ' + D.pact + ' gold', 'No more raids from Brannoch, and +18 gold in trade every season.',
        marching || (d.att < D.pactAtt ? 'Needs their mood at +' + D.pactAtt + ' or better' : ''));
    } else if (!d.ally) {
      var held = (G.time - d.pact) / DATA.SEASON_LEN;
      act('ally', '💍 Propose a royal marriage · ' + D.ally + ' gold', 'Allies for good: +40 gold every season and a happier realm.',
        held < D.allySeasons ? 'Keep the pact ' + Math.ceil(D.allySeasons - held) + ' more season' + (D.allySeasons - held > 1 ? 's' : '') :
        d.att < D.allyAtt ? 'Needs their mood at +' + D.allyAtt + ' or better' : '');
    }
    box.appendChild(h('<p class="hint">Beating Brannoch in battle sours most lords — though a <b>wary</b> one respects it. Storming their town earns a year of tribute. Marching on them breaks any pact. <b>The Sea Wolves</b> talk to nobody: keep soldiers and walls for them whatever you sign.</p>'));
  }

  function fieldStrength(extraDef) { return SIM.fieldStrength(extraDef); }

  /* score the enemy the same way, from the army they would actually field */
  function foeStrength(power, flavour) {
    var spec = BATTLE.foeArmy(power, flavour), s = 0;
    Object.keys(spec).forEach(function (k) {
      var u = DATA.FOE_UNITS[k];
      s += spec[k] * SIM.unitStrength(u.hp, u.atk, u.def);
    });
    return s;
  }
  /* battles are superlinear in numbers, so compare squares (Lanchester) */
  function estimateOdds(power, kind, flavour) {
    var mine = fieldStrength(kind === 'defend' ? SIM.defenseScore() / 18 : 0);
    var theirs = foeStrength(power, flavour);
    if (mine <= 0) return theirs <= 0 ? 50 : 2;
    if (theirs <= 0) return 98;
    return U.clamp(Math.round(mine * mine / (mine * mine + theirs * theirs) * 100), 2, 98);
  }

  /* ---------------- TECH ---------------- */
  function techBody(box, tier) {
    var G = SIM.G;
    if (G.research) {
      var t = DATA.TECH[G.research.id];
      var pct = U.clamp(G.research.prog / t.time * 100, 0, 100);
      box.appendChild(h('<div class="card" style="border-color:#8a6f45">' +
        '<h4 style="font-family:var(--font);font-size:14px">' + t.ic + ' Studying: ' + t.name + '</h4>' +
        '<div class="meter"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<p style="font-size:11.5px;color:#c3b18e;margin-top:6px">' + Math.round(pct) + '% — libraries speed this up.</p></div>'));
    } else {
      box.appendChild(h('<p class="hint">No research under way. Scholars in libraries make study faster.</p>'));
    }
    var any = false;
    Object.keys(DATA.TECH).forEach(function (id) {
      var t = DATA.TECH[id];
      if (t.tier !== tier) return;
      any = true;
      var have = !!G.tech[id];
      var closed = SIM.techClosed(id);
      var avail = SIM.techAvailable(id);
      var missing = [];
      t.req.forEach(function (r) { if (!G.tech[r]) missing.push(DATA.TECH[r].name); });
      if (t.lib && G.count.library < t.lib) missing.push(t.lib + '× Library');
      var other = t.excludes ? DATA.TECH[t.excludes] : null;
      var forkNote = '';
      if (other) {
        forkNote = closed
          ? '<p style="color:#8a7a5e;margin-top:5px">✕ Closed — you chose ' + other.name + '</p>'
          : have
            ? '<p style="color:#8fd06a;margin-top:5px">✓ Chosen over ' + other.name + '</p>'
            : '<p style="color:#e0b23c;margin-top:5px">⚠ ' + t.fork + ': taking this closes off <b>' + other.name + '</b> for good</p>';
      }
      var card = h('<div class="card' + (have || avail ? '' : ' locked') +
        (other && !have && !closed ? '" style="border-color:#8a6f45' : '') + '">' +
        '<div class="card-row"><div class="card-ic" style="font-size:20px">' + t.ic + '</div>' +
        '<div class="card-main"><h4>' + t.name + (have ? ' ✓' : '') + '</h4><p>' + t.desc + '</p>' +
        (have || closed ? '' : '<div class="cost">' + costPills(t.cost) + '<b>⏳ ' + t.time + '</b></div>') +
        (missing.length && !closed ? '<p style="color:#e0b23c;margin-top:5px">🔒 Needs ' + missing.join(', ') + '</p>' : '') +
        forkNote +
        '</div></div></div>');
      if (!have && !closed) {
        var b = h('<button class="btn wide">Begin study</button>');
        b.disabled = !avail || !!G.research || !SIM.canAfford(t.cost);
        if (G.research) b.textContent = 'Scholars are busy';
        else if (avail && !SIM.canAfford(t.cost)) b.textContent = 'Cannot afford';
        b.addEventListener('click', function () {
          var r = SIM.startResearch(id);
          if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); }
          else { toast('Scholars begin work on ' + t.name, 'good'); U.sfx.tap(); }
          renderSheet();
        });
        card.appendChild(b);
      }
      box.appendChild(card);
    });
    if (!any) box.appendChild(h('<p class="hint">Nothing at this tier.</p>'));
  }

  /* ---------------- WORLD ---------------- */
  function honoursBody(box) {
    var sc = HONOURS.score(), best = HONOURS.best(), have = HONOURS.earned(), D = SIM.diff();
    box.appendChild(h('<div class="card score-card"><p class="sect-label" style="margin:0">Reign score</p>' +
      '<div class="score-big">' + sc.toLocaleString() + '</div>' +
      '<p class="hint" style="margin:2px 0 8px">' + D.name + ' — scores ×' + D.score + '. Best on this setting: <b>' + (best[(SIM.G.setup || {}).diff || 'fair'] || sc).toLocaleString() + '</b></p>' +
      HONOURS.parts().filter(function (p) { return p[1]; }).map(function (p) {
        return '<div class="stat-line"><span>' + p[0] + '</span><b>' + p[1].toLocaleString() + '</b></div>'; }).join('') + '</div>'));
    var n = HONOURS.LIST.filter(function (x) { return have[x.id]; }).length;
    box.appendChild(h('<p class="sect-label">Honours · ' + n + ' of ' + HONOURS.LIST.length + '</p>'));
    box.appendChild(h('<p class="hint" style="margin-top:0">Honours stay earned from one reign to the next.</p>'));
    var grid = h('<div class="honours"></div>');
    HONOURS.LIST.forEach(function (x) {
      grid.appendChild(h('<div class="honour' + (have[x.id] ? ' got' : '') + '"><i>' + x.ic + '</i><b>' + x.name + '</b><span>' + x.desc + '</span></div>'));
    });
    box.appendChild(grid);
  }

  var chartSel = -1, chartCv = null;
  function seaBody(box) {
    var G = SIM.G, sea = G.sea;
    if (!sea) { box.appendChild(h('<p class="hint">The chart is still being drawn.</p>')); return; }
    chartCv = h('<canvas class="sea-chart"></canvas>');
    box.appendChild(chartCv);
    chartCv.addEventListener('click', function (e) {
      var r = chartCv.getBoundingClientRect();
      chartSel = EXPLORE.spotAt(chartCv, e.clientX - r.left, e.clientY - r.top);
      U.sfx.tap(); renderSheet();
    });
    (function paint(n) {
      requestAnimationFrame(function () {
        if (!chartCv) return;
        if (!chartCv.clientWidth && n < 20) return paint(n + 1);
        EXPLORE.drawChart(chartCv, chartSel, performance.now() / 1000);
      });
    })(0);
    var harbour = EXPLORE.harbour();
    if (!harbour) box.appendChild(h('<p class="hint">⚓ You need a harbour to put ships to sea — any <b>fishing hut</b> will do.</p>'));
    if (sea.voyage) {
      var left = Math.max(0, (sea.voyage.len - sea.voyage.t) / DATA.SEASON_LEN);
      box.appendChild(h('<p class="hint">⛵ Your ship is out charting ' + EXPLORE.SPOTS[sea.spots[sea.voyage.to].k].name.replace(/.*/, function (n) { return sea.spots[sea.voyage.to].known ? n : 'unknown waters'; }) +
        ' — back in ' + left.toFixed(1) + ' seasons.</p>'));
    }
    if (chartSel < 0) {
      box.appendChild(h('<p class="hint">Tap a place on the chart. Charted islets can be settled as <b>outposts</b> that ship goods home every season; the mainland port can take a standing <b>trade route</b>.</p>'));
      return;
    }
    var sp = sea.spots[chartSel], d = EXPLORE.SPOTS[sp.k];
    var card = h('<div class="card"><div class="card-row"><div class="card-ic" style="font-size:22px">' + (sp.known ? d.ic : '❔') + '</div>' +
      '<div class="card-main"><h4>' + (sp.known ? d.name : 'Uncharted waters') + '</h4><p>' +
      (sp.known ? d.desc : 'Something lies out there. Only a ship will tell you what.') + '</p>' +
      (sp.outpost ? '<p style="color:#8fd06a;margin-top:5px">⚑ Your outpost: +' + d.amt + ' ' + d.res + ' every season</p>' : '') +
      (sp.route ? '<p style="color:#8fd06a;margin-top:5px">⛵ Trade route running: gold every season, better prices at market</p>' : '') +
      (sp.burned ? '<p style="color:#8fd06a;margin-top:5px">🔥 Burned. The Wolves are licking their wounds.</p>' : '') +
      '</div></div></div>');
    function act(label, fn, dis) {
      var b = h('<button class="btn wide">' + label + '</button>');
      b.disabled = !!dis;
      b.addEventListener('click', function () {
        var r = fn();
        if (!r || !r.ok) { if (r) toast(r.why, 'bad'); U.sfx.err(); return; }
        if (r.msg) { toast(r.msg, 'good'); chronicle(r.msg); }
        U.sfx.tap(); SIM.save(); renderSheet(); refreshHUD();
      });
      card.appendChild(b);
    }
    if (!sp.known) act('🧭 Send a ship to chart it (30 gold, 20 food)', function () { return EXPLORE.chart(chartSel); }, !harbour || !!sea.voyage);
    else if (d.res && !sp.outpost) act('⚑ Found an outpost (60 gold, 80 wood, 40 food, 3 settlers)', function () { return EXPLORE.foundOutpost(chartSel); }, !harbour);
    else if (sp.k === 'port' && !sp.route) act('⚓ Open a trade route (' + EXPLORE.ROUTE_COST + ' gold)', function () { return EXPLORE.openRoute(chartSel); }, !harbour);
    else if (sp.k === 'haven' && !sp.burned) {
      act('🔥 Sail on the haven with your army', function () {
        if (SIM.armyCount() < 6) return { ok: false, why: 'You need at least 6 soldiers at home' };
        closeSheet();
        startBattle('raid', { power: 40 + SIM.seasonIndex() * 2.2, name: 'The Sea Wolves', flavour: 'wolves', faction: 'wolves' });
        return { ok: true };
      }, SIM.armyCount() < 6);
      card.appendChild(h('<p class="hint" style="margin-top:6px">A walled cove. Bring at least 6 soldiers — catapults help with the gate.</p>'));
    }
    box.appendChild(card);
  }

  /* larger text and calmer screens, remembered per device */
  function setComfort(k, on) {
    document.documentElement.classList.toggle(k === 'big' ? 'big-text' : 'calm', on);
    try { localStorage.setItem('ashveil.' + k, on ? '1' : '0'); } catch (e) {}
    if (k === 'calm' && RENDER.setCalm) RENDER.setCalm(on);
  }
  try {
    if (localStorage.getItem('ashveil.big') === '1') document.documentElement.classList.add('big-text');
    if (localStorage.getItem('ashveil.calm') === '1') document.documentElement.classList.add('calm');
  } catch (e) {}

  function worldBody(box, tab) {
    var G = SIM.G;
    if (tab === 'sea') { seaBody(box); return; }
    if (tab === 'honours') { honoursBody(box); return; }
    if (tab === 'castle') {
      var cur = DATA.CASTLE[G.castle], nxt = SIM.nextCastle();
      box.appendChild(h('<div class="card">' +
        '<h4 style="font-family:var(--font);font-size:16px">🏰 ' + cur.name + '</h4>' +
        '<p style="font-size:12px;color:#c3b18e;margin:4px 0 0">' + cur.desc + '</p></div>'));
      if (nxt) {
        var card = h('<div class="card"><div class="card-main"><h4>Next: ' + nxt.name + '</h4>' +
          '<p>' + nxt.desc + '</p><div class="cost">' + costPills(nxt.cost) + '</div></div></div>');
        var b = h('<button class="btn wide">Raise the castle</button>');
        b.disabled = !SIM.canAfford(nxt.cost);
        b.addEventListener('click', function () {
          var r = SIM.upgradeCastle();
          if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); }
          renderSheet(); refreshHUD();
        });
        card.appendChild(b);
        box.appendChild(card);
      } else {
        box.appendChild(h('<p class="hint">Your castle can rise no further. Ashveil is complete.</p>'));
      }
      box.appendChild(h('<p class="sect-label">Realm at a glance</p>'));
      var built = G.buildings.filter(function (b2) { return b2.built; }).length;
      box.appendChild(h('<div class="card">' +
        '<div class="stat-line"><span>Season</span><b>' + SIM.season().name + ', Year ' + SIM.year() + '</b></div>' +
        '<div class="stat-line"><span>Buildings standing</span><b>' + built + '</b></div>' +

        '<div class="stat-line"><span>Research complete</span><b>' + G.stats.techDone + ' / ' + Object.keys(DATA.TECH).length + '</b></div>' +
        '<div class="stat-line"><span>Chapter</span><b>' + (G.won ? 'reign complete' : ROMAN[G.chapter || 0] + ' of ' + DATA.CHAPTERS.length) + '</b></div>' +
        '<div class="stat-line"><span>Raids survived</span><b>' + G.stats.raidsSurvived + '</b></div>' +
        '</div>'));
    }

    if (tab === 'trade') {
      if (!SIM.canTrade()) {
        box.appendChild(h('<p class="hint">Merchants will not deal with a realm that has no market. Build one, and you can sell what you have spare and buy what you lack.</p>'));
      } else {
        var sp = SIM.tradeSpread();
        box.appendChild(h('<p class="hint">Traded in lots of ' + DATA.TRADE_LOT + '. Trade Charter, Guilds, Banking and upgraded markets all narrow the spread. Currently selling at ' +
          Math.round(sp.sell * 100) + '% and buying at ' + Math.round(sp.buy * 100) + '% of worth.</p>'));
        Object.keys(DATA.TRADE).forEach(function (k) {
          var t = DATA.TRADE[k], pr = SIM.priceOf(k);
          var card = h('<div class="card"><div class="card-row">' +
            '<div class="card-ic" style="font-size:20px">' + t.ic + '</div>' +
            '<div class="card-main"><h4>' + t.name + '</h4>' +
            '<p>You hold ' + Math.floor(G.res[k]) + ' · sell ' + DATA.TRADE_LOT + ' for ' + pr.sell +
            'g · buy ' + DATA.TRADE_LOT + ' for ' + pr.buy + 'g' +
            (pr.trend < 0.93 ? ' · <span style="color:#e0795f">prices depressed — you have been selling</span>' :
             pr.trend > 1.07 ? ' · <span style="color:#e0b23c">prices up — you have been buying</span>' : '') + '</p></div></div></div>');
          var row = h('<div style="display:flex;gap:6px;margin-top:8px"></div>');
          var sb2 = h('<button class="btn sec" style="flex:1">Sell ' + DATA.TRADE_LOT + '</button>');
          sb2.disabled = G.res[k] < DATA.TRADE_LOT;
          sb2.addEventListener('click', function () {
            var r = SIM.sell(k, 1);
            if (!r.ok) toast(r.why, 'bad'); else toast('Sold ' + r.amount + ' ' + k + ' for ' + r.gain + ' gold.', 'good');
            renderSheet(); refreshHUD();
          });
          var bb2 = h('<button class="btn" style="flex:1">Buy ' + DATA.TRADE_LOT + '</button>');
          bb2.disabled = G.res.gold < pr.buy;
          bb2.addEventListener('click', function () {
            var r = SIM.buy(k, 1);
            if (!r.ok) toast(r.why, 'bad'); else toast('Bought ' + r.amount + ' ' + k + ' for ' + r.cost + ' gold.', 'good');
            renderSheet(); refreshHUD();
          });
          row.appendChild(sb2); row.appendChild(bb2);
          card.appendChild(row);
          box.appendChild(card);
        });
      }
    }

    if (tab === 'chronicle') {
      if (!G.log.length) box.appendChild(h('<p class="hint">Nothing has happened yet.</p>'));
      box.appendChild(h('<div class="card">' + G.log.slice(0, 40).map(function (l) {
        return '<div style="font-size:12px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06);color:#c9b795">' +
          '<span style="opacity:.5">' + l.s + '</span> ' + l.m + '</div>';
      }).join('') + '</div>'));
    }

    if (tab === 'settings') {
      var sv = h('<button class="btn wide">💾 Save now</button>');
      sv.addEventListener('click', function () {
        toast(SIM.save() ? 'Kingdom saved.' : 'Could not save (storage blocked).', SIM.save() ? 'good' : 'bad');
      });
      box.appendChild(sv);
      box.appendChild(h('<p class="sect-label">Detail</p>'));
      var qrow = h('<div class="pill-row"></div>');
      [['auto', 'Automatic'], ['high', 'High'], ['balanced', 'Balanced'], ['saver', 'Battery saver']].forEach(function (q) {
        var pb = h('<button class="pill' + (RENDER.qualityPref() === q[0] ? ' on' : '') + '">' + q[1] + '</button>');
        pb.addEventListener('click', function () { RENDER.setQuality(q[0]); U.sfx.tap(); renderSheet(); });
        qrow.appendChild(pb);
      });
      box.appendChild(qrow);
      box.appendChild(h('<p class="hint">Automatic starts at High and eases off if your phone struggles. Now drawing at: <b>' +
        { high: 'High', balanced: 'Balanced', saver: 'Battery saver' }[RENDER.quality()] + '</b>.</p>'));
      box.appendChild(h('<p class="sect-label">Sound</p>'));
      var srow = h('<div class="pill-row"></div>');
      [['all', U.isMuted() ? '🔇 All sound off' : '🔊 Sound on', !U.isMuted()], ['amb', '🌊 Sea & birds', U.soundPref('amb')], ['music', '🎵 Music', U.soundPref('music')]].forEach(function (o) {
        var pb = h('<button class="pill' + (o[2] ? ' on' : '') + '">' + o[1] + '</button>');
        pb.addEventListener('click', function () {
          if (o[0] === 'all') toggleSound(); else U.setSoundPref(o[0], !U.soundPref(o[0]));
          U.resumeAudio(); U.sfx.tap(); renderSheet();
        });
        srow.appendChild(pb);
      });
      box.appendChild(srow);
      box.appendChild(h('<p class="sect-label">Comfort</p>'));
      var arow = h('<div class="pill-row"></div>');
      [['big', 'Larger text'], ['calm', 'Reduce motion']].forEach(function (o) {
        var on = document.documentElement.classList.contains(o[0] === 'big' ? 'big-text' : 'calm');
        var pb = h('<button class="pill' + (on ? ' on' : '') + '">' + o[1] + '</button>');
        pb.addEventListener('click', function () { setComfort(o[0], !on); U.sfx.tap(); renderSheet(); });
        arow.appendChild(pb);
      });
      box.appendChild(arow);
      var fs = h('<button class="btn sec wide">⛶ Fullscreen</button>');
      fs.addEventListener('click', function () {
        var d = document.documentElement;
        if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen();
        else if (document.exitFullscreen) document.exitFullscreen();
      });
      box.appendChild(fs);
      box.appendChild(h('<p class="sect-label">Keep a copy</p>'));
      box.appendChild(h('<p class="hint">Your kingdom lives in this browser. Copy its save code somewhere safe — a note, a message to yourself — and you can bring it back here or on another phone.</p>'));
      var cp = h('<button class="btn sec wide">📋 Copy save code</button>');
      cp.addEventListener('click', function () {
        SIM.save();
        var code = SIM.exportCode();
        var done = function () { toast('Save code copied — ' + Math.round(code.length / 1024) + ' KB of text.', 'good'); };
        var fallback = function () { ta.value = code; ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Select the text below and copy it.', ''); } };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, fallback);
        else fallback();
      });
      box.appendChild(cp);
      var ta = h('<textarea id="save-code" rows="3" placeholder="Paste a save code here to load it"></textarea>');
      box.appendChild(ta);
      var ld = h('<button class="btn sec wide">📥 Load this save code</button>');
      var armedL = false;
      ld.addEventListener('click', function () {
        var r = SIM.checkCode(ta.value);
        if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); return; }
        if (!armedL) { armedL = true; ld.textContent = 'Tap again — this replaces the kingdom you are playing'; return; }
        SIM.importCode(ta.value);
        location.reload();
      });
      box.appendChild(ld);
      box.appendChild(h('<p class="sect-label">Danger</p>'));
      var rs = h('<button class="btn danger wide">Abandon this kingdom and start over</button>');
      var armed = false;
      rs.addEventListener('click', function () {
        if (!armed) { armed = true; rs.textContent = 'Tap again to confirm — this cannot be undone'; return; }
        U.wipe();
        location.reload();
      });
      box.appendChild(rs);
      box.appendChild(h('<p class="hint" style="margin-top:12px">Your kingdom saves automatically to this device every few seconds. Clearing your browser data will erase it.</p>'));
    }
  }

  /* =========================================================
     BUILD MODE + INPUT
     ========================================================= */
  function startBuild(id) {
    buildMode = id;
    closeSheet();
    el('build-banner').classList.remove('hidden');
    el('build-banner-text').textContent = 'Placing ' + DATA.B[id].name +
      (DATA.B[id].isRoad || DATA.B[id].isWall ? ' — drag to lay a line' : ' — tap a tile');
    rowMode = false;
    el('build-row').classList.remove('on');
    el('build-row').classList.toggle('hidden', !!(DATA.B[id].isRoad || DATA.B[id].isWall || DATA.B[id].max || DATA.B[id].unique));
    updateGhost(RENDER.size.w / 2, RENDER.size.h / 2);
    U.sfx.tap();
  }
  function startMove(b) {
    clearSelection(); closeSheet();
    buildMode = b.id; moveTarget = b;
    el('build-banner').classList.remove('hidden');
    el('build-row').classList.add('hidden');
    var mc = SIM.moveCost(b);
    el('build-banner-text').textContent = 'Moving ' + (b.def.name) + ' — tap the new spot (' +
      Object.keys(mc).map(function (k) { return mc[k] + ' ' + k; }).join(', ') + ')';
    updateGhost(RENDER.size.w / 2, RENDER.size.h / 2);
    U.sfx.tap();
  }
  function cancelBuild() {
    moveTarget = null;
    buildMode = null;
    rowMode = false;
    if (el('build-row')) el('build-row').classList.remove('on');
    RENDER.setGhost(null);
    el('build-banner').classList.add('hidden');
  }
  /* the plot a finger at (sx,sy) means: big buildings centre on it */
  function plotAt(sx, sy, id) {
    var def = moveTarget ? moveTarget.def : DATA.B[id], w = RENDER.toWorld(sx, sy);
    return { x: Math.round(w.x - (def.w || 1) / 2), y: Math.round(w.y - (def.h || 1) / 2) };
  }
  function updateGhost(sx, sy) {
    if (!buildMode) return;
    var t = plotAt(sx, sy, buildMode);
    if (moveTarget) {
      var mchk = SIM.canMove(moveTarget, t.x, t.y), maff = SIM.canAfford(SIM.moveCost(moveTarget));
      RENDER.setGhost({ id: buildMode, x: t.x, y: t.y, ok: mchk.ok && maff, def: moveTarget.def, b: moveTarget,
        why: mchk.ok ? (maff ? '' : 'Not enough to move it') : mchk.why,
        preview: mchk.ok ? (maff ? 'Move here' : 'Not enough to move it') : mchk.why });
      return;
    }
    var chk = W.canPlace(buildMode, t.x, t.y);
    var cost = SIM.costOf(buildMode);
    var afford = SIM.canAfford(cost);
    RENDER.setGhost({ id: buildMode, x: t.x, y: t.y, ok: chk.ok, plan: chk.ok && !afford,
      why: chk.ok ? '' : chk.why,
      preview: chk.ok ? (afford ? SIM.preview(buildMode, t.x, t.y) || DATA.B[buildMode].name : '📐 Plan — waits for ' + shortOf(cost)) : chk.why });
  }
  function tryPlaceAt(sx, sy) {
    var t = plotAt(sx, sy, buildMode);
    if (moveTarget) {
      var mb = moveTarget, mr = SIM.moveBuilding(mb, t.x, t.y);
      if (mr.ok) {
        U.sfx.place(); U.vibrate(12);
        RENDER.puff(t.x + (mb.def.w || 1) / 2, t.y + (mb.def.h || 1) / 2, '#c9b58a', 9);
        toast(mb.def.name + ' moved.', 'good');
        cancelBuild(); refreshHUD();
      } else { U.sfx.err(); toast(mr.why, 'bad'); }
      return mr.ok;
    }
    var r = SIM.canAfford(SIM.costOf(buildMode)) ? SIM.place(buildMode, t.x, t.y) : SIM.planBuild(buildMode, t.x, t.y);
    if (r.ok && r.plan) {
      U.sfx.tap(); U.vibrate(8);
      toast('📐 Planned. Builders start when you have the ' + shortOf(SIM.costOf(buildMode)) + '.', '');
      refreshHUD();
    } else if (r.ok) {
      showUndo();
      U.sfx.place(); U.vibrate(12);
      RENDER.puff(t.x + (DATA.B[buildMode].w || 1) / 2, t.y + (DATA.B[buildMode].h || 1) / 2, '#c9b58a', 9);
      refreshHUD();
      if (DATA.B[buildMode].max && SIM.countAll(buildMode) >= DATA.B[buildMode].max) cancelBuild();
    } else {
      U.sfx.err();
      toast(r.why, 'bad');
      if (/Not enough/.test(r.why)) {
        if (SIM.canTrade()) toast('Short of materials? Sell what you have spare in The Realm → Trade.', 'war');
        else if (/wood/.test(r.why)) toast('Tap any woodland tile and fell it for timber — it grows back.', 'war');
      }
    }
    return r.ok;
  }

  function collectFind(i) {
    var r = SIM.collectFind(i);
    if (!r) return;
    U.sfx.coin(); U.vibrate(15);
    RENDER.puff(r.x, r.y, '#e8dcb5', 8);
    var txt = Object.keys(r.got).map(function (k) {
      var q = DATA.RES.filter(function (x) { return x.key === k; })[0];
      return '+' + r.got[k] + ' ' + (q ? q.ic : k);
    }).join('  ');
    RENDER.floater(r.x, r.y, txt, '#f0d98a');
    toast(r.kind === 'drift' ? 'Driftwood hauled up the beach — ' + txt : 'Salvage from a wreck — ' + txt, 'good');
    refreshHUD();
  }
  /* the merchant cog's offers, as a story card */
  function openShip() {
    var sh = SIM.G.ship;
    if (!sh || sh.phase !== 'anchored') return;
    var name = function (k) { var q = DATA.RES.filter(function (x) { return x.key === k; })[0]; return (q ? q.ic + ' ' : '') + k; };
    var btns = sh.offers.map(function (o, i) {
      var label, sub;
      if (o.kind === 'sell') { label = 'Buy ' + o.amount + ' ' + name(o.res) + ' for ' + o.price + ' gold'; sub = 'The market square would charge ' + SIM.priceOf(o.res).buy * Math.round(o.amount / DATA.TRADE_LOT) + ''; }
      else if (o.kind === 'buy') { label = 'Sell them ' + o.amount + ' ' + name(o.res) + ' for ' + o.price + ' gold'; sub = 'The market square would pay ' + SIM.priceOf(o.res).sell * Math.round(o.amount / DATA.TRADE_LOT); }
      else { label = o.label + ' — ' + o.price + ' gold'; sub = '+' + o.happy + ' contentment'; }
      return { label: label, sub: sub, then: function () {
        var r = SIM.takeOffer(i);
        if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); }
        else toast('A good bargain struck with the merchants.', 'good');
        if (SIM.G.ship && SIM.G.ship.offers.length) setTimeout(openShip, 60);
      } };
    });
    btns.push({ label: 'Nothing today', sub: 'They will stay until the season turns' });
    storyCard('⛵', 'A Merchant Cog', 'A trader from the southern ports has dropped anchor off Ashveil. Their prices beat the market square — for today.', btns);
  }

  var undoTimer = null;
  function showUndo() {
    var chip = el('undo-chip');
    chip.classList.remove('hidden');
    clearInterval(undoTimer);
    var tickU = function () {
      var left = SIM.undoLeft();
      if (left <= 0) { chip.classList.add('hidden'); clearInterval(undoTimer); return; }
      el('undo-left').textContent = Math.ceil(left) + 's';
    };
    tickU();
    undoTimer = setInterval(tickU, 250);
  }

  function select(sel) {
    if (selected && selected.a) selected.a.sel = false;
    if (sel && sel.a) sel.a.sel = true;
    selected = sel;
    RENDER.setSelected(sel);
    renderInspector();
  }
  function clearSelection() {
    if (selected && selected.a) selected.a.sel = false;
    selected = null; RENDER.setSelected(null);
    el('inspector').classList.add('hidden');
  }

  /* one of your people */
  function personCard(p, ic, body, acts) {
    if (!p) { clearSelection(); return; }
    var home = FOLK.homeOf(p), m = FOLK.mood(p), job = FOLK.jobOf(p);
    ic.textContent = p.sick ? '🤒' : p.a < 6 ? '👶' : p.a < 14 ? (p.s === 'f' ? '👧' : '👦') : p.a >= 62 ? (p.s === 'f' ? '👵' : '👴') : (p.s === 'f' ? '👩' : '👨');
    ic.style.fontSize = '26px';
    el('insp-name').textContent = FOLK.full(p);
    el('insp-sub').textContent = Math.floor(p.a) + ' years old · ' + FOLK.tradeOf(p);
    var sp = p.sp && FOLK.get(p.sp), pa = p.pa && FOLK.get(p.pa);
    var kids = FOLK.list.filter(function (q) { return q.pa === p.i || (p.sp && q.pa === p.sp); });
    var sv = FOLK.servicesOf(home);
    var col = m.v < 30 ? '#e0795f' : m.v < 55 ? '#e0b23c' : '#8fd06a';
    var lines = [
      '<div class="stat-line"><span>Mood</span><b style="color:' + col + '">' + m.word + '</b></div>' +
        (m.why.length ? '<p class="why">Troubled by ' + m.why.join(', ') + '.</p>' : ''),
      '<div class="stat-line"><span>Home</span><b>' + (home ? (home.id === 'castle' ? 'a bed in the castle hall' : (home.def.tierNames ? home.def.tierNames[(home.level || 1) - 1] : home.def.name)) : 'none') + '</b></div>',
      job ? '<div class="stat-line"><span>Works at</span><b>' + job.def.name + '</b></div>' : '',
      sp ? '<div class="stat-line"><span>Married to</span><b>' + sp.n + '</b></div>' : p.grief > 0 ? '<div class="stat-line"><span>Widowed</span><b>and grieving</b></div>' : '',
      pa ? '<div class="stat-line"><span>Child of</span><b>' + pa.n + (FOLK.get(pa.sp) ? ' and ' + FOLK.get(pa.sp).n : '') + '</b></div>' : '',
      kids.length ? '<div class="stat-line"><span>Children</span><b>' + kids.map(function (k) { return k.n; }).join(', ') + '</b></div>' : '',
      home && home.id !== 'castle' ? '<div class="stat-line"><span>Near home</span><b>' +
        [sv.well ? '⛲' : '', sv.chapel ? '⛪' : '', sv.tavern ? '🍺' : '', sv.market ? '⚖️' : ''].join(' ') + (sv.well ? '' : ' no well') + '</b></div>' : ''
    ];
    body.innerHTML = lines.join('');
    if (home) {
      var hb = h('<button class="btn sec">🏠 Show their home</button>');
      hb.addEventListener('click', function () { RENDER.centreOn(home.x, home.y); select({ b: home }); });
      acts.appendChild(hb);
    }
    if (job) {
      var jb = h('<button class="btn sec">⚒️ Their workplace</button>');
      jb.addEventListener('click', function () { RENDER.centreOn(job.x, job.y); select({ b: job }); });
      acts.appendChild(jb);
    }
  }

  function renderInspector() {
    if (!selected) { el('inspector').classList.add('hidden'); return; }
    var box = el('inspector');
    if (box.classList.contains('hidden')) openedAt.insp = now();
    box.classList.remove('hidden');
    var ic = el('insp-icon'); ic.innerHTML = '';
    var body = el('insp-body'), acts = el('insp-actions');
    body.innerHTML = ''; acts.innerHTML = '';

    if (selected.b) {
      var b = selected.b, def = b.def;
      ic.appendChild(ART.icon(b.id, 40));
      var tierName = def.evolves && def.tierNames ? def.tierNames[(b.level || 1) - 1] : null;
      el('insp-name').textContent = (tierName || def.name) +
        (!def.evolves && (b.level || 1) > 1 ? '  ·  Lv ' + b.level : '');
      el('insp-sub').textContent = b.built
        ? (SIM.jobsOf(b) ? b.workers + '/' + SIM.jobsOf(b) + ' workers' : 'no workers needed') + (b.paused ? ' · paused' : '')
        : 'Under construction — ' + Math.round(b.prog * 100) + '%' + (b.waiting ? ' · waiting for ' + b.waiting : '');
      var out = SIM.output(b);
      var lines = [];
      if (b.fire) {
        lines.push('<div class="stat-line"><span style="color:#f08a6a">🔥 On fire</span><b>' + Math.round(b.fire.dmg * 100) + '% burned · ' +
          (SIM.wellsNear(b, 5) ? SIM.wellsNear(b, 5) + ' well nearby' : 'no well nearby') + '</b></div>');
        var fb = h('<button class="btn danger">🪣 Call the bucket brigade!</button>');
        fb.disabled = b.fire.brigade > 0;
        if (b.fire.brigade > 0) fb.textContent = '🪣 The brigade is on it';
        fb.addEventListener('click', function () { SIM.rallyBrigade(b); U.sfx.horn(); U.vibrate(25); renderInspector(); });
        acts.appendChild(fb);
      }
      if (b.def.seasonal && b.built) {
        var hr = SIM.harvestRate(b);
        lines.push('<div class="stat-line"><span>🌾 Crop standing in the fields</span><b>' + Math.round(b.crop || 0) + '</b></div>');
        lines.push('<div class="stat-line"><span>Now</span><b>' + (hr > 0 ? 'harvesting — ' + (hr * DATA.SEASON_LEN).toFixed(0) + ' a season'
          : SIM.season().key === 'winter' ? 'the fields lie fallow' : SIM.season().key === 'autumn' ? 'harvest is in'
          : 'growing — harvest comes in autumn') + '</b></div>');
      }
      if (def.upkeep) lines.push('<div class="stat-line"><span>upkeep</span><b>−' + def.upkeep.toFixed(2) + ' g/s</b></div>');
      if (def.housing) lines.push('<div class="stat-line"><span>housing</span><b>+' + def.housing + '</b></div>');
      if (b.built && typeof FOLK !== 'undefined' && (def.housing || b.id === 'castle')) {
        var res = FOLK.residents(b), sick = FOLK.sickAt(b), sv = FOLK.servicesOf(b);
        if (res.length) {
          var fams = {};
          res.forEach(function (p) { fams[p.f] = (fams[p.f] || 0) + 1; });
          lines.push('<div class="stat-line"><span>Home to</span><b>' + Object.keys(fams).map(function (f) { return 'the ' + f + 's'; }).join(', ') + ' (' + res.length + ')</b></div>');
          lines.push('<p class="folk-names">' + res.map(function (p) {
            return '<span' + (p.sick ? ' class="ill"' : '') + '>' + p.n + ' <i>' + Math.floor(p.a) + '</i></span>'; }).join('') + '</p>');
        }
        if (b.id !== 'castle') lines.push('<div class="stat-line"><span>Nearby</span><b>' +
          [sv.well ? '⛲ well' : '<s>no well</s>', sv.chapel ? '⛪ chapel' : '', sv.tavern ? '🍺 tavern' : '', sv.market ? '⚖️ market' : '']
            .filter(Boolean).join(' · ') + '</b></div>');
        if (sick) {
          var doc = b.physic && b.physic > SIM.G.time;
          lines.push('<div class="stat-line"><span style="color:#d8c13a">🤒 Fever</span><b>' + sick + ' ill' + (doc ? ' · the physician is here' : sv.well ? '' : ' · no clean water near') + '</b></div>');
          var pb2 = h('<button class="btn">⚕️ Send for the physician (−25 gold)</button>');
          pb2.disabled = doc;
          if (doc) pb2.textContent = '⚕️ The physician is tending them';
          pb2.addEventListener('click', function () {
            var r = FOLK.physician(b);
            if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); return; }
            toast('The physician comes with herbs and clean linen.', 'good'); U.sfx.tap(); renderInspector(); refreshHUD();
          });
          acts.appendChild(pb2);
        }
      }
      // NB: contentment is still pooled realm-wide, so don't claim a radius
      // the simulation does not honour — see "the balance audit" in PLAN.md
      if (def.happy) lines.push('<div class="stat-line"><span>contentment</span><b>+' + def.happy + ' realm-wide</b></div>');
      if (def.defense) lines.push('<div class="stat-line"><span>defence</span><b>+' + def.defense * (SIM.G.tech.fortification ? 1.6 : 1) + '</b></div>');
      if (def.armyCap) lines.push('<div class="stat-line"><span>troop capacity</span><b>+' + def.armyCap + '</b></div>');
      if (def.aura) lines.push('<div class="stat-line"><span>aura</span><b>+' + Math.round(Object.values(def.aura)[0] * 100) + '% nearby</b></div>');
      if (b.built && def.trade && b.id !== 'castle') {
        lines.push('<div class="stat-line"><span>Realm produces</span><b>' + SIM.goodsValue().toFixed(2) + ' g/s of goods</b></div>');
        lines.push('<div class="stat-line"><span>This market\'s cut</span><b>' +
          Math.round(SIM.marketCut(b._mIdx || 0) * 100) + '% (market #' + ((b._mIdx || 0) + 1) + ')</b></div>');
      }
      if (b.built && def.scaleNear) {
        var n = W.nearCount(b.x, b.y, def.scaleNear.terrain, 1);
        lines.push('<div class="stat-line"><span>resource tiles nearby</span><b>' + n + '</b></div>');
      }
      body.innerHTML = lines.join('') || '<p style="font-size:12px;color:#bda98a;margin:0">' + def.desc + '</p>';

      if (b.built && def.evolves) {
        var earned = SIM.houseTierEarned(), cur = b.level || 1;
        var nextT = DATA.HOUSE_TIERS[cur];
        body.innerHTML += '<div class="stat-line"><span>Standing</span><b>' +
          (def.tierNames[cur - 1]) + '</b></div>';
        if (nextT) {
          body.innerHTML += '<div class="stat-line"><span>To become a ' + def.tierNames[cur] + '</span><b style="color:' +
            (earned > cur ? '#8fd06a' : '#e0b23c') + '">' + nextT.needs + '</b></div>';
        } else {
          body.innerHTML += '<div class="stat-line"><span>Standing</span><b>as fine as they come</b></div>';
        }
        if (earned < cur) {
          body.innerHTML += '<div class="stat-line"><span>Warning</span><b style="color:#e0795f">the realm can no longer keep it — it will slip back</b></div>';
        }
      }
      if (b.built && SIM.canUpgrade(b)) {
        var uc = SIM.upgradeCost(b);
        body.innerHTML += '<div class="sect-label" style="margin:10px 0 4px">Upgrade to level ' + (b.level + 1) +
          ' — +' + Math.round(DATA.UPGRADE.gain * 100) + '% output, no extra workers</div>' +
          '<div class="cost">' + costPills(uc) + '</div>';
        var ub2 = h('<button class="btn">⬆ Upgrade</button>');
        ub2.disabled = !SIM.canAfford(uc);
        ub2.addEventListener('click', function () {
          var r = SIM.upgradeBuilding(b);
          if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); }
          else { RENDER.puff(b.x + .5, b.y + .5, '#f0d98a', 10); RENDER.floater(b.x + .5, b.y - .1, 'Level ' + b.level, '#f0d98a'); }
          renderInspector(); refreshHUD();
        });
        acts.appendChild(ub2);
      } else if (b.built && (b.level || 1) >= DATA.UPGRADE.max && b.id !== 'castle' && !b.def.isRoad && !b.def.isWall) {
        body.innerHTML += '<div class="stat-line"><span>Level</span><b>' + b.level + ' — fully upgraded</b></div>';
      }

      if (b.built && SIM.jobsOf(b) > 0) {
        var sc = SIM.scoreOf(b);
        body.innerHTML += '<div class="stat-line"><span>Assigned by the realm</span><b>' +
          (b.paused ? 'paused' : SIM.priorityLabel(sc) + ' need') + '</b></div>';
        var pb = h('<button class="btn sec">' + (b.paused ? '▶ Resume' : '⏸ Pause') + '</button>');
        pb.addEventListener('click', function () { b.paused = !b.paused; SIM.assignWorkers(true); renderInspector(); });
        acts.appendChild(pb);
      }
      if (b.id !== 'castle' && !b.fire) {
        var mv = h('<button class="btn sec">✥ Move</button>');
        mv.addEventListener('click', function () { startMove(b); });
        acts.appendChild(mv);
      }
      if (b.id !== 'castle') {
        var db = h('<button class="btn danger">Demolish</button>');
        var armed = false;
        db.addEventListener('click', function () {
          if (!armed) { armed = true; db.textContent = 'Sure?'; setTimeout(function () { armed = false; db.textContent = 'Demolish'; }, 2600); return; }
          SIM.demolish(b); clearSelection(); refreshHUD(); U.sfx.place(); showUndo();
        });
        acts.appendChild(db);
      } else {
        var ub = h('<button class="btn">Castle & realm</button>');
        ub.addEventListener('click', function () { clearSelection(); openTab.world = 'castle'; openSheet('world'); });
        acts.appendChild(ub);
      }
    } else if (selected.p) {
      personCard(FOLK.get(selected.p), ic, body, acts);
    } else if (selected.plan) {
      var pl = selected.plan, pd = DATA.B[pl.id], pc = SIM.costOf(pl.id), pos = SIM.plans.indexOf(pl);
      if (pos < 0) { clearSelection(); return; }
      ic.appendChild(ART.icon(pl.id, 40));
      el('insp-name').textContent = 'Planned: ' + pd.name;
      el('insp-sub').textContent = pos === 0 ? 'next in line' : 'number ' + (pos + 1) + ' in line';
      var e2 = affordIn(pc);
      body.innerHTML = '<div class="cost">' + costPills(pc) + '</div>' +
        '<div class="stat-line"><span>Builders start</span><b>' + (SIM.canAfford(pc) ? (pos === 0 ? 'any moment' : 'after the plans before it') : e2 < 0 ? 'when you have more ' + shortOf(pc) : 'in about ' + fmtWait(e2)) + '</b></div>' +
        (pl.by && pl.by !== 'you' ? '<div class="stat-line"><span>Marked out by</span><b>' + pl.by + '</b></div>' : '');
      var cb = h('<button class="btn danger">✕ Cancel this plan</button>');
      cb.addEventListener('click', function () { SIM.cancelPlan(pl); clearSelection(); U.sfx.tap(); toast('Plan cancelled.', ''); });
      acts.appendChild(cb);
      if (pos > 0) {
        var fb = h('<button class="btn sec">⤒ Build this first</button>');
        fb.addEventListener('click', function () { var ps = SIM.plans; ps.splice(ps.indexOf(pl), 1); ps.unshift(pl); U.sfx.tap(); renderInspector(); });
        acts.appendChild(fb);
      }
    } else if (selected.site) {
      var st = selected.site, sd = EXPLORE.SITES[st.k];
      ic.textContent = sd.ic; ic.style.fontSize = '24px';
      el('insp-name').textContent = sd.name;
      el('insp-sub').textContent = st.done ? 'searched' : (st.k === 'ore' || st.k === 'spring') ? 'found by your scouts' : 'waiting to be searched';
      body.innerHTML = '<p style="font-size:12.5px;color:#d9ccae;margin:0">' + sd.desc + '</p>';
      if (!st.done && st.k !== 'ore' && st.k !== 'spring') {
        var sb = h('<button class="btn">🔦 Search it</button>');
        sb.addEventListener('click', function () {
          var r = EXPLORE.search(st);
          if (!r.ok) { toast(r.why, 'bad'); return; }
          U.sfx.quest(); chronicle('Searched the ' + sd.name.toLowerCase() + '.');
          RENDER.puff(st.x + .5, st.y + .5, '#f0d98a', 10);
          clearSelection(); refreshHUD();
          storyCard(sd.ic, sd.name, r.msg, [{ label: 'Good' }]);
        });
        acts.appendChild(sb);
      }
    } else if (selected.t && typeof EXPLORE !== 'undefined' && !EXPLORE.seen(selected.t.x, selected.t.y)) {
      var ft = selected.t;
      ic.textContent = '🌫️'; ic.style.fontSize = '22px';
      el('insp-name').textContent = 'Unexplored';
      el('insp-sub').textContent = Math.round(EXPLORE.known() * 100) + '% of the island is known';
      body.innerHTML = '<p style="font-size:12.5px;color:#d9ccae;margin:0">Nobody from Ashveil has been this way. Send a scout to map it — or build nearby, and the mist will lift around it. Watchtowers see furthest.</p>';
      var scb = h('<button class="btn">🧭 Send a scout (' + EXPLORE.SCOUT_COST + ' gold)</button>');
      scb.addEventListener('click', function () {
        var r = EXPLORE.sendScout(ft.x, ft.y);
        if (!r.ok) { toast(r.why, 'bad'); U.sfx.err(); return; }
        toast('A scout sets out to the ' + 'unknown.', 'good'); U.sfx.tap();
        clearSelection(); refreshHUD();
      });
      acts.appendChild(scb);
    } else if (selected.t) {
      var t = selected.t;
      var terr = DATA.TERRAIN[t.terr];
      ic.textContent = { water: '🌊', shore: '🌊', sand: '🏖️', grass: '🌿', meadow: '🌸', forest: '🌲', hill: '⛰️', rock: '🪨' }[t.terr];
      ic.style.fontSize = '20px';
      el('insp-name').textContent = terr.name;
      el('insp-sub').textContent = 'Tile ' + t.x + ', ' + t.y + (t.path ? ' · footpath' : '');
      var near = {};
      ['forest', 'rock', 'hill', 'water'].forEach(function (k) { near[k] = W.nearCount(t.x, t.y, [k], 1); });
      body.innerHTML =
        '<div class="stat-line"><span>Buildable</span><b>' + (terr.build ? 'yes' : 'no') + '</b></div>' +
        (t.terr === 'meadow' ? '<div class="stat-line"><span>Farms here</span><b>+35% food</b></div>' : '') +
        (t.terr === 'sand' ? '<div class="stat-line"><span>Farms here</span><b>−30% food</b></div>' : '') +
        (t.terr === 'forest' ? '<div class="stat-line"><span>Clearing it</span><b>+12 wood</b></div>' : '') +
        '<div class="stat-line"><span>Neighbours</span><b>' +
          ['forest', 'hill', 'rock', 'water'].filter(function (k) { return near[k]; })
            .map(function (k) { return near[k] + ' ' + k; }).join(', ') || 'open ground' + '</b></div>';
      if (SIM.canFell(t)) {
        var fb = h('<button class="btn">🪓 Fell the trees (+12 wood)</button>');
        fb.addEventListener('click', function () {
          var r = SIM.fell(t);
          if (!r.ok) { toast(r.why, 'bad'); return; }
          U.sfx.place(); U.vibrate(10);
          RENDER.puff(t.x + .5, t.y + .6, '#8a6b45', 8);
          RENDER.floater(t.x + .5, t.y, '+' + r.gain + ' wood', '#c9a86a');
          clearSelection(); refreshHUD();
        });
        acts.appendChild(fb);
      }
      if (terr.build) {
        var bb = h('<button class="btn">Build here</button>');
        bb.addEventListener('click', function () { clearSelection(); openSheet('build'); });
        acts.appendChild(bb);
      }
    }
  }

  /* ---------------- pointer input ---------------- */
  function bindInput(canvas) {
    var pts = {};       // active pointers
    var startDist = 0, startZoom = 0, moved = false, downT = 0, downX = 0, downY = 0;
    var lastPaint = null, longTimer = null;

    function count() { return Object.keys(pts).length; }

    canvas.addEventListener('pointerdown', function (e) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ }
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      U.resumeAudio();
      if (count() === 1) {
        moved = false; downT = performance.now(); downX = e.clientX; downY = e.clientY;
        lastPaint = null;
        longTimer = setTimeout(function () {
          if (!moved && !buildMode) {
            var hb = RENDER.pickBuilding(downX, downY - rectTop());
            var t = RENDER.tileAtScreen(downX, downY - rectTop());
            var tile = W.at(t.x, t.y);
            if (hb) { U.vibrate(18); select({ b: hb }); }
            else if (tile) { U.vibrate(18); select(tile.bld ? { b: tile.bld } : { t: tile }); }
          }
        }, 420);
      } else if (count() === 2) {
        var k = Object.keys(pts);
        startDist = Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y);
        startZoom = RENDER.cam.z;
      }
    });

    function rectTop() { return canvas.getBoundingClientRect().top; }

    canvas.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      var prev = pts[e.pointerId];
      var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8) moved = true;

      if (count() === 2) {
        var k = Object.keys(pts);
        var d = Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y);
        if (startDist > 0) {
          var cx = (pts[k[0]].x + pts[k[1]].x) / 2, cy = (pts[k[0]].y + pts[k[1]].y) / 2 - rectTop();
          var want = startZoom * (d / startDist);
          RENDER.zoomAt(cx, cy, want / RENDER.cam.z);
        }
        return;
      }

      var def = buildMode ? DATA.B[buildMode] : null;
      if (buildMode && !moveTarget && def && (def.isRoad || def.isWall || rowMode) && moved) {
        // drag-paint roads, walls — and in row mode, anything
        var t = (def.w || 1) > 1 ? plotAt(e.clientX, e.clientY - rectTop(), buildMode) : RENDER.tileAtScreen(e.clientX, e.clientY - rectTop());
        var key = t.x + ',' + t.y;
        if (key !== lastPaint) {
          lastPaint = key;
          if (W.canPlace(buildMode, t.x, t.y).ok) {
            var pr = SIM.canAfford(SIM.costOf(buildMode)) ? SIM.place(buildMode, t.x, t.y) : (rowMode ? SIM.planBuild(buildMode, t.x, t.y) : { ok: false });
            if (pr.ok) { U.sfx.tap(); U.vibrate(6); refreshHUD(); }
          }
        }
        updateGhost(e.clientX, e.clientY - rectTop());
        return;
      }
      if (buildMode) { updateGhost(e.clientX, e.clientY - rectTop()); if (moved) RENDER.pan(dx, dy); return; }
      RENDER.pan(dx, dy);
    });

    function up(e) {
      clearTimeout(longTimer);
      var wasSingle = count() === 1;
      delete pts[e.pointerId];
      if (!wasSingle) { startDist = 0; return; }
      var quick = performance.now() - downT < 400;
      if (moved || !quick) return;
      var sy = e.clientY - rectTop();
      if (buildMode) {
        updateGhost(e.clientX, sy);
        tryPlaceAt(e.clientX, sy);
      } else {
        if (WAR.active && WAR.selected) {
          var wp = RENDER.toWorld(e.clientX, sy);
          WAR.orderAt(wp.x, wp.y); U.sfx.tap(); U.vibrate(10);
          RENDER.puff(wp.x, wp.y, '#f0d98a', 5);
          return;
        }
        if (RENDER.pickShip(e.clientX, sy)) { U.sfx.tap(); openShip(); return; }
        var fi = RENDER.pickFind(e.clientX, sy);
        if (fi >= 0) { collectFind(fi); return; }
        var site = RENDER.pickSite(e.clientX, sy);
        if (site) { select({ site: site }); U.sfx.tap(); return; }
        var plan = RENDER.pickPlan(e.clientX, sy);
        if (plan) { select({ plan: plan }); U.sfx.tap(); return; }
        var hitB = RENDER.pickBuilding(e.clientX, sy);
        // a villager right under the finger beats the building behind them
        var ag = typeof FOLK !== 'undefined' ? RENDER.pickAgent(e.clientX, sy, !!hitB) : null;
        if (ag && ag.pid && FOLK.get(ag.pid)) { select({ p: ag.pid, a: ag }); U.sfx.tap(); return; }
        var t = RENDER.tileAtScreen(e.clientX, sy);
        var tile = W.at(t.x, t.y);
        if (hitB) select({ b: hitB });
        else if (!tile) { clearSelection(); return; }
        else if (tile.bld) select({ b: tile.bld });
        else select({ t: tile });
        U.sfx.tap();
      }
    }
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', function (e) { clearTimeout(longTimer); delete pts[e.pointerId]; startDist = 0; });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      RENDER.zoomAt(e.clientX, e.clientY - rectTop(), e.deltaY > 0 ? 0.9 : 1.11);
    }, { passive: false });

    // keyboard for desktop play
    window.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      if (k === 'escape') { cancelBuild(); clearSelection(); closeSheet(); }
      if (k === 'b') openSheet('build');
      if (k === ' ') { e.preventDefault(); setSpeed(SIM.G.speed === 0 ? 1 : 0); }
      if (k === '1') setSpeed(1);
      if (k === '2') setSpeed(2);
      if (k === '3') setSpeed(4);
      if (k === '4') setSpeed(8);
      if (k === 'n') startSkip();
      var pan = 60;
      if (k === 'arrowleft') RENDER.pan(pan, 0);
      if (k === 'arrowright') RENDER.pan(-pan, 0);
      if (k === 'arrowup') RENDER.pan(0, pan);
      if (k === 'arrowdown') RENDER.pan(0, -pan);
    });
  }

  /* =========================================================
     SPEED
     ========================================================= */
  var SPEEDS = [0, 1, 2, 4, 8];
  function setSpeed(v) {
    if (skipping && v !== SKIP_SPEED) endSkip(true);
    SIM.G.speed = v;
    SPEEDS.forEach(function (val, i) {
      var b = el('spd-' + i);
      if (b) b.classList.toggle('active', val === v);
    });
  }
  /* "Skip to next season": run fast until the season turns, or until
     something needs you */
  var skipping = null, SKIP_SPEED = 30;
  function startSkip() {
    if (skipping) { endSkip(false); return; }
    if (modalBusy || SIM.G.war) { toast('Not while something needs you.', 'war'); return; }
    skipping = { to: SIM.seasonIndex() + 1, prev: SIM.G.speed || 1 };
    SIM.G.speed = SKIP_SPEED;
    SPEEDS.forEach(function (val, i) { el('spd-' + i).classList.remove('active'); });
    el('season-chip').classList.add('skipping');
    U.sfx.tap();
  }
  function endSkip(quiet) {
    if (!skipping) return;
    var prev = skipping.prev;
    skipping = null;
    el('season-chip').classList.remove('skipping');
    if (!quiet) setSpeed(prev);
  }
  function checkSkip() {
    if (!skipping) return;
    if (SIM.seasonIndex() >= skipping.to) { endSkip(false); toast(SIM.season().icon + ' ' + SIM.season().name + ' has come.', 'good'); }
    else if (modalBusy || SIM.G.war || BATTLE.isOpen() || SIM.burning().length) endSkip(false);
  }

  function toggleSound() {
    U.setMuted(!U.isMuted());
    el('btn-sound').textContent = U.isMuted() ? '🔇' : '🔊';
    el('btn-sound').classList.toggle('off', U.isMuted());
    try { localStorage.setItem('ashveil.muted', U.isMuted() ? '1' : '0'); } catch (e) {}
  }

  /* =========================================================
     EVENTS + BATTLES
     ========================================================= */
  function chronicle(msg) {
    SIM.G.log.unshift({ s: SIM.season().name.slice(0, 3) + ' ' + SIM.year(), m: msg });
    if (SIM.G.log.length > 60) SIM.G.log.pop();
  }

  /* nobody should ever be stuck with nothing and no way to earn */
  function reliefEvent() {
    if (modalBusy || BATTLE.isOpen()) { eventQueue.push('relief'); return; }
    showEvent({
      art: '🕯️', title: 'The Steward Opens the Vault',
      text: 'Your steward finds you staring at empty stores. "There is a little put by for exactly this, my lord. Silver plate, a few barrels, some seasoned timber. It will get us moving again."',
      choices: [
        { label: 'Take it and rebuild', sub: '+120 gold, +60 wood, +40 stone', apply: { gold: 120, wood: 60, stone: 40 } },
        { label: 'Take it and sell the rest', sub: '+220 gold', apply: { gold: 220 } }
      ]
    });
  }

  /* The year's occasions. Costs scale with the size of the realm, so a
     feast bites a village and a kingdom about equally. */
  function festivalEvent(key) {
    if (modalBusy || BATTLE.isOpen()) { eventQueue.push({ k: 'festival', key: key }); return; }
    var G = SIM.G, f = DATA.FESTIVALS[key];
    var pop = Math.max(4, Math.round(G.pop));
    var ev = { art: f.art, title: f.title, text: f.text, choices: [] };

    if (key === 'autumn') {
      var big = Math.round(pop * 1.6), small = Math.round(pop * 0.5);
      ev.choices = [
        { label: 'A feast for the whole valley', sub: '−' + big + ' food, +18 contentment', apply: { food: -big, happy: 18 } },
        { label: 'A modest thanksgiving', sub: '−' + small + ' food, +7 contentment', apply: { food: -small, happy: 7 } },
        { label: 'No feast — the barns come first', sub: '−6 contentment', apply: { happy: -6 } }
      ];
    } else if (key === 'winter') {
      var wellFed = G.res.food > pop * 8;
      ev.text += wellFed ? '\n\nThe lofts are full. This will be a comfortable winter.'
                         : '\n\nThere is not much up there. This will be a lean one.';
      var open = Math.round(pop * 1.2);
      ev.choices = [
        { label: 'Open the stores', sub: '−' + open + ' food, +' + (wellFed ? 14 : 8) + ' contentment',
          apply: { food: -open, happy: wellFed ? 14 : 8 } },
        { label: 'Ration hard until spring', sub: '−10 contentment, but the food keeps', apply: { happy: -10 } }
      ];
    } else if (key === 'spring') {
      ev.choices = [
        { label: 'Throw the gates open to the fair', sub: 'A season of far better prices at market', fair: true },
        { label: 'Charge them a pitch fee', sub: '+' + Math.round(40 + pop * 3) + ' gold, −5 contentment',
          apply: { gold: Math.round(40 + pop * 3), happy: -5 } }
      ];
    } else {
      var n = SIM.armyCount(), strong = n >= 8;
      ev.text += strong ? '\n\n' + n + ' swords answer the call. It is a fine sight, and word of it travels.'
                        : '\n\nOnly ' + n + ' answer the call. The crowd is quiet.';
      ev.choices = [
        { label: strong ? 'Parade them through the town' : 'Muster who you have',
          sub: strong ? '+12 contentment, and Brannoch hears of it' : '−5 contentment',
          apply: strong ? { happy: 12, rival: -6 } : { happy: -5 } },
        { label: 'Skip it this year', sub: '−8 contentment', apply: { happy: -8 } }
      ];
    }

    modalBusy = true;
    var prevSpeed = SIM.G.speed;
    setSpeed(0);
    el('ev-art').textContent = ev.art;
    el('ev-title').textContent = ev.title;
    el('ev-text').textContent = ev.text;
    el('ev-text').style.whiteSpace = 'pre-line';
    var box = el('ev-choices'); box.innerHTML = '';
    ev.choices.forEach(function (c) {
      var b = h('<button class="ev-choice">' + c.label + '<small>' + (c.sub || '') + '</small></button>');
      b.addEventListener('click', function () {
        el('event-modal').classList.add('hidden');
        modalBusy = false;
        chronicle(ev.title + ' — ' + c.label);
        if (c.fair) {
          SIM.G.fairUntil = SIM.G.time + DATA.SEASON_LEN;
          toast('The fair is open — prices are good all season.', 'good');
        }
        if (c.apply) SIM.applyEffects(c.apply);
        setSpeed(prevSpeed || 1);
        refreshHUD();
        U.sfx.quest();
      });
      box.appendChild(b);
    });
    el('event-modal').classList.remove('hidden'); openedAt.modal = now();
    U.sfx.season();
  }

  /* a simple story card: title, words, one or more buttons */
  function storyCard(art, title, text, buttons) {
    modalBusy = true;
    var prevSpeed = SIM.G.speed;
    setSpeed(0);
    el('ev-art').textContent = art;
    el('ev-title').textContent = title;
    el('ev-text').textContent = text;
    el('ev-text').style.whiteSpace = 'pre-line';
    var box = el('ev-choices'); box.innerHTML = '';
    buttons.forEach(function (bt) {
      var b = h('<button class="ev-choice">' + bt.label + (bt.sub ? '<small>' + bt.sub + '</small>' : '') + '</button>');
      b.addEventListener('click', function () {
        el('event-modal').classList.add('hidden');
        modalBusy = false;
        setSpeed(prevSpeed || 1);
        refreshHUD();
        if (bt.then) bt.then();
      });
      box.appendChild(b);
    });
    el('event-modal').classList.remove('hidden'); openedAt.modal = now();
  }
  function rewardText(r) {
    var keys = Object.keys(r || {});
    if (!keys.length) return '';
    return keys.map(function (k) {
      var q = DATA.RES.filter(function (x) { return x.key === k; })[0];
      return '+' + r[k] + ' ' + (q ? q.ic : k);
    }).join('  ');
  }
  function chapterEvent(idx) {
    var ch = DATA.CHAPTERS[idx], nxt = DATA.CHAPTERS[idx + 1];
    U.sfx.victory();
    chronicle('Chapter ' + ROMAN[idx] + ' closed: ' + ch.title);
    if (!nxt) return;               // the last chapter ends in the victory card
    storyCard(ch.icon, 'Chapter ' + ROMAN[idx] + ' complete', ch.done + (rewardText(ch.reward) ? '\n\nThe realm is rewarded: ' + rewardText(ch.reward) : ''), [
      { label: 'Onward', sub: 'Chapter ' + ROMAN[idx + 1] + ': ' + nxt.title, then: function () {
        storyCard(nxt.icon, 'Chapter ' + ROMAN[idx + 1] + ' · ' + nxt.title, nxt.text, [{ label: 'Begin', sub: nxt.goals.length + ' goals — see the card at the top of the screen' }]);
      } }
    ]);
  }
  function victoryEvent() {
    var G = SIM.G;
    U.sfx.victory();
    chronicle('The Great Cathedral is complete. The reign is crowned.');
    var built = G.buildings.filter(function (b) { return b.built; }).length;
    storyCard('👑', 'Your Reign Is Complete',
      DATA.CHAPTERS[DATA.CHAPTERS.length - 1].done +
      '\n\nYear ' + SIM.year() + ' · ' + Math.floor(G.pop) + ' villagers · ' + built + ' buildings · ' +
      G.stats.wins + ' battles won · ' + G.stats.techDone + ' discoveries' +
      '\n\nReign score: ' + HONOURS.score().toLocaleString() + ' (' + SIM.diff().name + ')',
      [{ label: 'Keep ruling', sub: 'Ashveil is yours to build on for as long as you like' }]);
  }

  /* the first thing a new ruler sees */
  function introCard() {
    var ch = DATA.CHAPTERS[0], sc = SIM.G.setup && SIM.G.setup.scen, SC = SIM.SCENARIOS[sc];
    var extra = sc === 'winter' ? '\n\n❄️ You landed late: it is already autumn, the barns are near empty and winter is coming. Farms and a fishing hut, first of all.'
      : sc === 'border' ? '\n\n⚔️ Brannoch is already strong and their scouts are watching. You have a few soldiers — keep them, and raise more.'
      : sc === 'merchant' ? '\n\n💰 Your purse is heavy and your timber-yard empty. A market lets you buy what you lack.' : '';
    storyCard(SC && sc !== 'standard' ? SC.ic : '🏝️', 'Chapter I · ' + ch.title,
      ch.text + extra + '\n\nDrag to look around, pinch to zoom, and tap anything to see what it does. Your next goal is always in the card at the top of the screen — and the Build menu opens on what your realm needs most.',
      [{ label: 'Begin', sub: 'A few quick pointers first — you can skip them', then: function () { TUT.start(); } }]);
  }

  function fireEvent() {
    var L = pickEvent();
    if (L) showEvent(DATA.EVENTS[L.i]);
  }
  function pickEvent() {
    var G = SIM.G;
    var pool = DATA.EVENTS.filter(function (e) { return !e.when || e.when(G); });
    if (!pool.length) return null;
    // not the same letter twice running
    var last = G.lastEvent, ev = U.pick(Math.random, pool);
    if (pool.length > 1 && DATA.EVENTS.indexOf(ev) === last) ev = U.pick(Math.random, pool);
    G.lastEvent = DATA.EVENTS.indexOf(ev);
    return { k: 'event', i: DATA.EVENTS.indexOf(ev) };
  }

  /* ---------------- letters ----------------
     Offers, requests and festivals arrive as sealed scrolls. The game keeps
     going; open them when it suits you. Most go stale after a while. */
  function letterTitle(L) {
    if (L.k === 'event') return (DATA.EVENTS[L.i] || {}).title || 'A letter';
    if (L.k === 'festival') return (DATA.FESTIVALS[L.key] || {}).title || 'A festival';
    return 'Your steward asks for a word';
  }
  function letterArt(L) {
    if (L.k === 'event') return (DATA.EVENTS[L.i] || {}).art || '📜';
    if (L.k === 'festival') return (DATA.FESTIVALS[L.key] || {}).art || '🎉';
    return '🕯️';
  }
  function addLetter(L) {
    if (!L) return;
    var G = SIM.G;
    if (!G.letters) G.letters = [];
    if (L.k !== 'event' && G.letters.some(function (x) { return x.k === L.k && x.key === L.key; })) return;
    if (G.letters.length >= 4) G.letters.shift();   // the oldest goes unanswered
    L.t = G.time;
    L.until = L.k === 'relief' ? Infinity : G.time + DATA.SEASON_LEN * (L.k === 'festival' ? 1 : 1.5);
    G.letters.push(L);
    toast('📜 ' + letterTitle(L) + ' — tap the scroll to read it.', '');
    U.sfx.season();
    refreshLetters();
  }
  function refreshLetters() {
    var G = SIM.G, n = (G && G.letters || []).length, b = el('btn-letters');
    if (!b) return;
    b.classList.toggle('hidden', !n);
    el('letter-badge').textContent = n;
    b.classList.toggle('fresh', n > 0);
  }
  function openLetter() {
    var G = SIM.G;
    if (!G.letters || !G.letters.length || modalBusy || BATTLE.isOpen()) return;
    var L = G.letters.shift();
    refreshLetters();
    U.sfx.tap();
    if (L.k === 'event') showEvent(DATA.EVENTS[L.i]);
    else if (L.k === 'festival') festivalEvent(L.key);
    else reliefEvent();
  }
  function expireLetters() {
    var G = SIM.G;
    if (!G.letters || !G.letters.length) return;
    var keep = [];
    G.letters.forEach(function (L) {
      if (G.time > L.until) toast(letterTitle(L) + ' — the moment passed.', '');
      else keep.push(L);
    });
    if (keep.length !== G.letters.length) { G.letters = keep; refreshLetters(); }
  }

  function showEvent(ev) {
    modalBusy = true;
    var prevSpeed = SIM.G.speed;
    setSpeed(0);
    el('ev-art').textContent = ev.art;
    el('ev-title').textContent = ev.title;
    el('ev-text').textContent = ev.text;
    var box = el('ev-choices');
    box.innerHTML = '';

    function shortFor(c) {
      if (!c.apply) return false;
      return Object.keys(c.apply).some(function (k) {
        return SIM.G.res[k] !== undefined && c.apply[k] < 0 && SIM.G.res[k] + c.apply[k] < 0;
      });
    }
    var afford = ev.choices.map(function (c) { return !shortFor(c); });
    var anyAfford = afford.some(function (a) { return a; });

    function addChoice(c, disabled, note) {
      var b = h('<button class="ev-choice">' + c.label + '<small>' + (c.sub || '') + '</small></button>');
      if (note) b.querySelector('small').textContent = (c.sub || '') + ' — ' + note;
      b.disabled = !!disabled;
      b.addEventListener('click', function () {
        el('event-modal').classList.add('hidden');
        modalBusy = false;
        chronicle(ev.title + ' — ' + c.label);
        U.sfx.tap();
        if (c.battle) {
          startBattle('raid', { power: 30 + SIM.G.stats.wins * 12, name: 'Bandits', flavour: 'bandits' }, prevSpeed);
          return;
        }
        if (c.apply) SIM.applyEffects(c.apply);   // applyEffects clamps at zero
        setSpeed(prevSpeed || 1);
        refreshHUD();
      });
      box.appendChild(b);
      return b;
    }

    ev.choices.forEach(function (c, i) {
      // A choice you cannot fully pay for is only greyed out when some OTHER
      // choice is affordable. If the realm can afford none of them, every one
      // stays open and simply takes everything you have — an event must never
      // be able to trap you behind a wall of dead buttons.
      if (afford[i]) addChoice(c, false, null);
      else if (anyAfford) addChoice(c, true, 'you cannot afford this');
      else addChoice(c, false, 'takes everything you have');
    });

    // Last resort: there is always a way out of an event.
    if (!anyAfford) {
      addChoice({
        label: 'Endure it as best you can',
        sub: 'You have nothing left to give — −8 contentment',
        apply: { happy: -8 }
      }, false, null);
    }

    el('event-modal').classList.remove('hidden'); openedAt.modal = now();
    U.sfx.horn();
  }

  function campaignBattle() {
    var c = SIM.G.campaign;
    if (!c || c.phase !== 'battle') return;
    startBattle('raid', {
      power: c.power, name: c.name, flavour: c.flavour,
      roster: c.army, vets: c.vets
    });
  }

  function startBattle(kind, opts, restoreSpeed) {
    var prev = restoreSpeed !== undefined ? restoreSpeed : SIM.G.speed;
    setSpeed(0);
    closeSheet(); clearSelection(); cancelBuild();
    chronicle(kind === 'defend' ? 'Attacked by ' + (opts.name || 'Brannoch') : 'Marched on ' + (opts.name || 'Brannoch'));
    BATTLE.start(kind, opts, function () {
      setSpeed(prev || 1);
      refreshHUD();
      if (openPanel) renderSheet(true);
    });
  }

  function incomingRaid(causeKey) {
    if (modalBusy || BATTLE.isOpen()) return;
    var G = SIM.G;
    var cause = DATA.RAID_CAUSES[causeKey] || DATA.RAID_CAUSES.raid;
    var power = SIM.raidPower() * cause.power * U.range(Math.random, 0.86, 1.06);
    var ev = {
      art: cause.art, title: cause.title,
      text: cause.text + '\n\nRoughly ' + Math.round(power / 9) +
            ' fighters in ' + (cause.faction === 'wolves' ? 'black-sailed longships' : 'longships') + '. Your defences add +' + SIM.defenseScore() +
            ' to the line, and your captains rate the fight at about ' + estimateOdds(power, 'defend') + '%.' +
            (SIM.G.campaign ? '\n\nYour army is in the field and cannot get back in time.' : '') +
            (cause.counter ? '\n\n' + cause.counter : ''),
      choices: [
        { label: '⚔️ Man the defences', sub: 'Fight them on the island — towers shoot, walls block, you command', battle: true },
        { label: '💰 Buy them off', sub: '−' + Math.round(35 + power * 1.5) + ' gold', buy: Math.round(35 + power * 1.5) }
      ]
    };
    modalBusy = true;
    var prevSpeed = SIM.G.speed;
    setSpeed(0);
    el('ev-art').textContent = ev.art;
    el('ev-title').textContent = ev.title;
    el('ev-text').textContent = ev.text;
    el('ev-text').style.whiteSpace = 'pre-line';
    var box = el('ev-choices'); box.innerHTML = '';
    ev.choices.forEach(function (c) {
      var b = h('<button class="ev-choice">' + c.label + '<small>' + c.sub + '</small></button>');
      if (c.buy && SIM.G.res.gold < c.buy) b.disabled = true;
      b.addEventListener('click', function () {
        el('event-modal').classList.add('hidden');
        modalBusy = false;
        if (c.battle) {
          setSpeed(prevSpeed || 1);
          var fac = cause.faction || 'brannoch';
          if (WAR.begin({ power: power, cause: cause.key, faction: fac, name: fac === 'wolves' ? 'The Sea Wolves' : 'Brannoch' })) {
            var st = WAR.state;
            RENDER.centreOn(st.land.x - 0.5, st.land.y - 0.5);
            chronicle((fac === 'wolves' ? 'Sea Wolf' : 'Brannoch') + ' longships sighted.');
            toast('⛵ Longships! They will land in moments — your soldiers are mustering.', 'war');
            refreshHUD();
          } else {
            startBattle('defend', { power: power, name: fac === 'wolves' ? 'The Sea Wolves' : 'Brannoch', cause: cause.key, faction: fac }, prevSpeed);
          }
        } else {
          SIM.G.res.gold -= c.buy;
          SIM.G.happy = U.clamp(SIM.G.happy - 6, 0, 100);
          if (cause.faction !== 'wolves') { SIM.G.rival.str += 4; if (SIM.dip().pers === 'greedy') SIM.dip().att = Math.min(100, SIM.dip().att + 4); }
          chronicle('Paid off a ' + (cause.faction === 'wolves' ? 'Sea Wolf' : 'Brannoch') + ' war band for ' + c.buy + ' gold.');
          toast('The war band takes your gold and turns for home.', 'war');
          setSpeed(prevSpeed || 1);
          refreshHUD();
        }
      });
      box.appendChild(b);
    });
    el('event-modal').classList.remove('hidden'); openedAt.modal = now();
    U.sfx.horn(); U.vibrate([40, 80, 40]);
  }

  /* =========================================================
     WIRING
     ========================================================= */
  function init() {
    bindInput(el('scene'));
    guard('event-modal', 'modal');
    RENDER.onQuality = function (lvl) {
      toast('Lowered the detail to ' + (lvl === 'saver' ? 'battery saver' : 'balanced') + ' for smoother play. Change it in ☰ → Settings.', '');
    };
    guard('inspector', 'insp');

    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () { U.sfx.tap(); openSheet(b.dataset.panel); });
    });
    el('sheet-close').addEventListener('click', closeSheet);
    el('sheet-scrim').addEventListener('click', closeSheet);
    el('insp-close').addEventListener('click', clearSelection);
    el('build-cancel').addEventListener('click', cancelBuild);
    el('undo-chip').addEventListener('click', function () {
      var r = SIM.undoPlace();
      el('undo-chip').classList.add('hidden');
      if (!r.ok) { toast(r.why, 'bad'); return; }
      U.sfx.tap();
      RENDER.puff(r.b.x + (r.b.def.w || 1) / 2, r.b.y + (r.b.def.h || 1) / 2, '#c9b58a', 8);
      toast(r.restored ? r.b.def.name + ' put back as it was.' : 'Taken back — everything it cost is returned.', 'good');
      refreshHUD();
    });
    el('btn-center').addEventListener('click', function () {
      var c = SIM.G.buildings[0];
      if (c) RENDER.centreOn(c.x, c.y);
    });
    el('btn-alerts').addEventListener('click', function () { U.sfx.tap(); openSheet('alerts'); });
    el('btn-letters').addEventListener('click', openLetter);
    el('season-chip').addEventListener('click', startSkip);
    el('build-row').addEventListener('click', function () {
      rowMode = !rowMode; U.sfx.tap();
      el('build-row').classList.toggle('on', rowMode);
      el('build-banner-text').textContent = rowMode ? 'Drag across the ground to lay a row' : 'Placing ' + DATA.B[buildMode].name + ' — tap a tile';
    });
    ['pointerdown', 'scroll', 'touchmove'].forEach(function (ev) {
      el('sheet-body').addEventListener(ev, function () { touchedSheet = performance.now(); }, { passive: true });
    });
    refreshLetters();
    el('goal-card').addEventListener('click', function () {
      U.sfx.tap();
      if (el('goal-card').dataset.go === 'alerts') { openSheet('alerts'); return; }
      openTab.people = 'quests'; if (openPanel === 'people') renderSheet(true); else openSheet('people');
    });
    el('btn-sound').addEventListener('click', toggleSound);
    el('btn-decrees').addEventListener('click', function () { U.sfx.tap(); openSheet('decrees'); });
    el('btn-menu').addEventListener('click', function () { openTab.world = 'settings'; openSheet('world'); });
    document.querySelectorAll('.war-orders button').forEach(function (b) {
      b.addEventListener('click', function () { WAR.orderAll(b.dataset.o); U.sfx.horn(); U.vibrate(15); });
    });
    [0, 1, 2, 3, 4].forEach(function (i) {
      el('spd-' + i).addEventListener('click', function () { setSpeed(SPEEDS[i]); U.sfx.tap(); });
    });
    el('bt-done').addEventListener('click', function () { BATTLE.close(); });
    el('dep-begin').addEventListener('click', function () { BATTLE.beginFight(); });

    SIM.on(function (kind, payload) {
      if (kind === 'toast') { toast(payload.msg, payload.kind); chronicle(payload.msg); }
      if (kind === 'event') addLetter(pickEvent());
      if (kind === 'raid-incoming') {
        // never let raids stack up behind a modal — one war band at a time
        if (!eventQueue.some(function (e) { return e && e.k === 'raid'; })) {
          eventQueue.push({ k: 'raid', cause: (payload && payload.cause) || 'raid' });
        }
      }
      if (kind === 'campaign-arrived') eventQueue.push('campaign');
      if (kind === 'relief') addLetter({ k: 'relief' });
      if (kind === 'festival') addLetter({ k: 'festival', key: payload });
      if (kind === 'chapter') {
        // several chapters closing at once (an old, advanced kingdom) make one card, not a stack
        eventQueue = eventQueue.filter(function (e) { return !(e && e.k === 'chapter'); });
        eventQueue.unshift({ k: 'chapter', idx: payload.idx });
      }
      if (kind === 'victory') eventQueue.unshift({ k: 'victory' });
      if (kind === 'war-landed') { toast('They are ashore! Send your squads to meet them.', 'war'); U.sfx.horn(); U.vibrate([40, 60, 40]); }
      if (kind === 'war-flee') toast(payload.why === 'broken' ? 'The raiders break and run for their boats!' : 'The raiders are loading their plunder onto the ships…', payload.why === 'broken' ? 'good' : 'war');
      if (kind === 'war-over') eventQueue.unshift({ k: 'warover', r: payload });
      if (kind === 'weather' && payload === 'rain') toast('🌧️ Rain sweeps in off the sea — the fields drink it up.', '');
      if (kind === 'folk' && payload.toast) { chronicle(payload.msg); toast(payload.msg, /died|Fever|fever/.test(payload.msg) ? 'bad' : 'good'); }
      if (kind === 'site-found') {
        var sd2 = EXPLORE.SITES[payload.k];
        toast(sd2.ic + ' Your people found ' + sd2.name.toLowerCase().replace(/^/, /^[aeiou]/i.test(sd2.name) ? 'an ' : 'a ') + '! Tap it on the map.', 'good');
        chronicle('Found ' + sd2.name + '.'); U.sfx.quest();
      }
      if (kind === 'voyage') { toast('⛵ ' + payload.msg, 'good'); chronicle(payload.msg); U.sfx.quest(); if (openPanel === 'world') renderSheet(); }
      if (kind === 'honour') { toast('🏅 Honour earned: ' + payload.name + ' — ' + payload.desc, 'good'); chronicle('Honour earned: ' + payload.name + '.'); U.sfx.victory(); }
      if (kind === 'plan-built') toast('📐 The builders have started the planned ' + DATA.B[payload.plan.id].name.toLowerCase() + '.', 'good');
      if (kind === 'harvest') { toast('🌾 Harvest time! ' + payload + ' food stands in the fields — the farmhands are bringing it in.', 'good'); chronicle('The harvest began: ' + payload + ' in the fields.'); U.sfx.quest(); }
      if (kind === 'fire') {
        toast('🔥 Fire at the ' + payload.def.name.toLowerCase() + '! Tap it to call the bucket brigade.', 'bad');
        chronicle('Fire broke out at the ' + payload.def.name.toLowerCase() + '.');
        U.sfx.horn(); U.vibrate([60, 60, 60]);
      }
      if (kind === 'fire-out') { toast('The fire at the ' + payload.def.name.toLowerCase() + ' is out.', 'good'); RENDER.puff(payload.x + .5, payload.y + .5, '#9aa0a8', 10); }
      if (kind === 'burned') {
        toast('The ' + payload.def.name.toLowerCase() + ' burned to the ground.', 'bad');
        chronicle('The ' + payload.def.name.toLowerCase() + ' burned down.');
        RENDER.puff(payload.x + .5, payload.y + .5, '#3a3638', 16);
        if (selected && selected.b === payload) clearSelection();
      }
      if (kind === 'find') toast(payload === 'drift' ? '🪵 Something has washed up on the beach — tap it.' : '📦 Wreckage on the shore! Tap it to salvage what you can.', '');
      if (kind === 'ship') { toast('⛵ A merchant cog has dropped anchor. Tap it to trade.', 'good'); chronicle('A merchant ship called at Ashveil.'); U.sfx.coin(); }
      if (kind === 'treasure') { RENDER.floater(payload.x + .5, payload.y + .2, '+' + payload.gain + ' 🪙 buried coins!', '#f0cd6a'); toast('Clearing the roots turned up an old coin hoard: +' + payload.gain + ' gold.', 'good'); U.sfx.coin(); }
      if (kind === 'decree') {
        var dn = DATA.DECREES[payload.id];
        toast(dn.ic + ' ' + dn.name + ' — ' + (payload.id === 'levy' ? '+' + payload.cost.coin + ' gold collected' : dn.effect), 'good');
        chronicle('Decreed: ' + dn.name);
        U.sfx.quest();
        if (payload.id === 'settlers') { var c0 = SIM.G.buildings[0]; RENDER.floater(c0.x + 1, c0.y + 1, '+6 settlers', '#a8f07a'); }
      }
      if (kind === 'season') { chronicle(payload.name + ' comes to Ashveil.'); }
      if (kind === 'completed') {
        var cw2 = (payload.def.w || 1) / 2, ch2 = (payload.def.h || 1) / 2;
        RENDER.puff(payload.x + cw2, payload.y + ch2, '#e8dcb5', 12);
        RENDER.floater(payload.x + cw2, payload.y + ch2, payload.def.name + ' built', '#a8f07a');
      }
      if (kind === 'cleared') {
        RENDER.puff(payload.x + .5, payload.y + .5, '#7a9a4a', 10);
        RENDER.floater(payload.x + .5, payload.y + .5, '+' + payload.gain + ' wood from clearing', '#d9b27a');
      }
      if (kind === 'tech' || kind === 'castle' || kind === 'army' || kind === 'quest') {
        if (openPanel) renderSheet(true);
      }
      if (kind === 'newgame') { refreshHUD(); }
    });

    try {
      if (localStorage.getItem('ashveil.muted') === '1') { U.setMuted(true); el('btn-sound').textContent = '🔇'; el('btn-sound').classList.add('off'); }
    } catch (e) {}
  }

  /* the panel shown while raiders are on the island */
  var warKey = '';
  function refreshWar() {
    var hud = el('war-hud');
    if (!WAR.active) {
      if (!hud.classList.contains('hidden')) { hud.classList.add('hidden'); el('side-tools').style.display = ''; }
      warKey = ''; return;
    }
    hud.classList.remove('hidden');
    el('side-tools').style.display = 'none';
    var st = WAR.state;
    el('war-title').textContent = (st.faction === 'wolves' ? '🐺 The Sea Wolves' : '⚔️ Brannoch') +
      (st.phase === 'sail' ? ' — landing soon' : st.phase === 'fleeing' ? ' — running for their boats' : ' — ashore');
    el('war-count').textContent = 'raiders ' + (st.phase === 'sail' ? st.startFoes : WAR.alive('foe')) + ' · yours ' + WAR.alive('mine');
    var sq = WAR.squads(), key = JSON.stringify(sq) + WAR.selected;
    if (key !== warKey) {
      warKey = key;
      var box = el('war-squads'); box.innerHTML = '';
      Object.keys(WAR.SQUADS).forEach(function (k) {
        if (!sq[k]) return;
        var b = h('<button type="button" class="' + (WAR.selected === k ? 'on' : '') + '">' + WAR.SQUADS[k].ic + ' ' + WAR.SQUADS[k].name + ' ' + sq[k] + '</button>');
        b.addEventListener('click', function () { WAR.select(k); U.sfx.tap(); warKey = ''; });
        box.appendChild(b);
      });
      if (!Object.keys(sq).length) box.appendChild(h('<p style="margin:0;font-size:12px;color:#f0c8b8">No soldiers to send — only towers and walls stand between them and the town.</p>'));
      el('war-hint').textContent = WAR.selected ? 'Now tap where to send the ' + WAR.SQUADS[WAR.selected].name.toLowerCase() + ' — or tap a raider.' : 'Tap a squad, then tap where to send it.';
    }
  }

  function warOver(r) {
    var name = r.faction === 'wolves' ? 'the Sea Wolves' : 'Brannoch';
    var lines = [];
    if (r.won) lines.push('The raiders broke and ran for their boats. ' + r.killed + ' of them will not be going home.');
    else lines.push(name.charAt(0).toUpperCase() + name.slice(1) + ' sailed off with their plunder.');
    var st = Object.keys(r.stolen).filter(function (k) { return r.stolen[k] >= 1; }).map(function (k) { return Math.round(r.stolen[k]) + ' ' + k; });
    if (st.length) lines.push('They carried off ' + st.join(', ') + (r.won ? ' — half of it recovered from the fallen.' : '.'));
    var lt = Object.keys(r.loot).filter(function (k) { return r.loot[k] > 0; }).map(function (k) { return '+' + r.loot[k] + ' ' + k; });
    if (lt.length) lines.push('Spoils: ' + lt.join(', '));
    lines.push(r.lostN ? 'Fallen: ' + Object.keys(r.lost).map(function (k) { return r.lost[k] + '× ' + DATA.UNITS[k].name; }).join(', ') : 'Not a soldier lost.');
    chronicle(r.won ? 'Drove off a raid by ' + name + '.' : 'Raided by ' + name + '.');
    storyCard(r.won ? '🛡️' : '🔥', r.won ? 'Ashveil Holds' : 'The Raiders Got Away', lines.join('\n\n'), [{ label: 'Back to work' }]);
  }

  /* drain queued events between frames so two never stack */
  /* ---------------- tips, once each, when they are useful ---------------- */
  var TIPS = [
    { id: 'row', test: function (G) { return G.count.house >= 4; }, text: 'Placing lots of cottages? Press ⟷ Row in the build bar and drag across the ground.' },
    { id: 'plan', test: function (G) { return G.time > 90; }, text: 'Short of materials? Place it anyway — it is marked out as a plan and built the moment you can pay.' },
    { id: 'speed', test: function (G) { return G.time > 150 && G.speed === 1; }, text: 'Waiting for something? Tap the season to skip ahead, or try 4× and 8×.' },
    { id: 'autumn', test: function (G) { return SIM.season().key === 'autumn' && G.count.farm > 0; }, text: 'Autumn: the farmhands are bringing the harvest in. Store enough for winter.' },
    { id: 'winter', test: function (G) { return SIM.season().key === 'winter'; }, text: 'Nothing grows in winter. Hunters and fishers still bring food in.' },
    { id: 'beds', test: function (G) { return G.pop >= SIM.housing() - 0.01 && G.time > 60; }, text: 'Every bed is full. More cottages, more people — and more hands for work.' },
    { id: 'market', test: function (G) { return G.count.market > 0; }, text: 'With a market you can sell what you have too much of: The Realm → Trade.' },
    { id: 'harbour', test: function (G) { return G.count.fishery > 0; }, text: 'A fishing hut is a harbour too. The Realm → Sea chart sends ships to chart the islands.' },
    { id: 'mist', test: function (G) { return SIM.seasonIndex() >= 2 && typeof EXPLORE !== 'undefined' && EXPLORE.known() < 0.55; }, text: 'Tap the mist to send a scout. There are things out there worth finding.' },
    { id: 'army', test: function (G) { return SIM.graceLeft() <= 1 && SIM.armyCount() < 4; }, text: 'Brannoch will not stay patient much longer. A barracks and a few soldiers, soon.' },
    { id: 'fever', test: function (G) { return G.sickN > 0; }, text: 'Fever spreads in crowded homes far from a well. Tap the house with the yellow cloth.' },
    { id: 'dip', test: function (G) { return SIM.seasonIndex() >= 9; }, text: 'War is not the only way with Brannoch: Army → Diplomacy.' }
  ];
  var tipTimer = 0;
  function checkTips() {
    var G = SIM.G;
    if ((tipTimer += 1) % 90 || G.tut >= 0 || modalBusy || G.time < 30) return;
    if (!G.tips) G.tips = {};
    for (var i = 0; i < TIPS.length; i++) {
      var t = TIPS[i];
      if (G.tips[t.id]) continue;
      var ok = false;
      try { ok = t.test(G); } catch (e) {}
      if (ok) { G.tips[t.id] = 1; toast('💡 ' + t.text, ''); return; }
    }
  }

  /* the first thing you see when you come back to a saved kingdom */
  function welcomeBack() {
    var G = SIM.G, lines = [];
    lines.push(SIM.season().icon + ' ' + SIM.season().name + ', year ' + SIM.year() + ' — ' + Math.floor(G.pop) + ' people, ' + Math.round(G.res.gold) + ' gold, ' + Math.round(G.res.food) + ' food.');
    var goal = el('gc-goal') && el('gc-goal').textContent;
    if (goal && goal !== '—') lines.push('🎯 Next goal: ' + goal);
    var iss = SIM.issues().filter(function (x) { return x.sev >= 1; }).slice(0, 2);
    iss.forEach(function (x) { lines.push(x.ic + ' ' + x.text); });
    if (G.letters && G.letters.length) lines.push('📜 ' + G.letters.length + ' letter' + (G.letters.length > 1 ? 's' : '') + ' waiting for you.');
    if (G.plans && G.plans.length) lines.push('📐 ' + G.plans.length + ' building' + (G.plans.length > 1 ? 's' : '') + ' planned.');
    if (G.finds && G.finds.length) lines.push('🪵 Something washed up on the shore.');
    storyCard('🏰', 'Welcome back', lines.join('\n'), [{ label: 'Carry on' }]);
  }

  function pump() {
    refreshWar();
    checkSkip();
    expireLetters();
    checkTips();
    if (modalBusy || BATTLE.isOpen() || !eventQueue.length) return;
    var next = eventQueue.shift();
    if (next && next.k === 'warover') warOver(next.r);
    else if (next && next.k === 'chapter') chapterEvent(next.idx);
    else if (next && next.k === 'victory') victoryEvent();
    else if (next && next.k === 'festival') festivalEvent(next.key);
    else if (next && next.k === 'raid') incomingRaid(next.cause);
    else if (next === 'raid') incomingRaid('raid');
    else if (next === 'campaign') campaignBattle();
    else if (next === 'relief') reliefEvent();
    else fireEvent();
  }

  return {
    init: init, refreshHUD: refreshHUD, toast: toast, pump: pump,
    setSpeed: setSpeed,
    // the main loop's refresh: live tabs only, and never under a moving finger
    renderSheet: function () {
      if (!openPanel || STILL[openPanel + ':' + openTab[openPanel]] || performance.now() - touchedSheet < 1500) return;
      renderSheet();
    },
    refreshSheet: function () { if (openPanel) renderSheet(); },
    welcomeBack: welcomeBack,
    isModalOpen: function () { return modalBusy; },
    chronicle: chronicle, closeSheet: closeSheet, clearSelection: clearSelection, introCard: introCard,
    ghostTo: function (p) { if (buildMode) updateGhost(p.x, p.y); },
    get panel() { return openPanel; }, get building() { return buildMode; }, get selection() { return selected; }
  };
})();
