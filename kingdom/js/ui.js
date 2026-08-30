/* ============================================================
   ui.js — HUD, panels, touch input, inspector, events
   ============================================================ */
var UI = (function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function h(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  var buildMode = null;      // building id currently being placed
  var openPanel = null;
  var openTab = {};
  var selected = null;       // {b:building} or {t:tile}
  var eventQueue = [];
  var modalBusy = false;
  var pendingRaid = false;

  /* =========================================================
     TOASTS
     ========================================================= */
  function toast(msg, kind) {
    var t = h('<div class="toast ' + (kind || '') + '">' + msg + '</div>');
    el('toasts').appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 2800);
    while (el('toasts').children.length > 4) el('toasts').removeChild(el('toasts').firstChild);
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
    if (!strip.children.length) {
      DATA.RES.forEach(function (r) {
        strip.appendChild(h('<div class="res" id="res-' + r.key + '"><span class="ic">' + r.ic +
          '</span><span class="amt">0</span><span class="rate"></span></div>'));
      });
    }
    DATA.RES.forEach(function (r) {
      var box = el('res-' + r.key);
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
    if (G.idle) note = '💤 ' + G.idle + ' idle';
    if (G.research) note = '📜 ' + Math.round(U.clamp(G.research.prog / DATA.TECH[G.research.id].time, 0, 1) * 100) + '%';
    mn.textContent = note;
    mn.className = 'mini dim' + (note ? '' : ' hidden');

    var s = SIM.season();
    el('season-icon').textContent = s.icon;
    el('season-name').textContent = s.name;
    el('year-label').textContent = 'Yr ' + SIM.year();
    el('season-fill').style.width = (SIM.seasonProgress() * 100).toFixed(1) + '%';
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
    build: { title: 'Build', tabs: function () { return DATA.CATS; }, body: buildBody },
    people: { title: 'People', tabs: function () { return [{ key: 'overview', name: 'Realm' }, { key: 'jobs', name: 'Work' }, { key: 'quests', name: 'Charters' }]; }, body: peopleBody },
    army: { title: 'Army', tabs: function () { return [{ key: 'roster', name: 'Roster' }, { key: 'muster', name: 'Muster' }, { key: 'war', name: 'War' }]; }, body: armyBody },
    tech: { title: 'Research', tabs: function () { return [{ key: 1, name: 'Tier I' }, { key: 2, name: 'Tier II' }, { key: 3, name: 'Tier III' }]; }, body: techBody },
    world: { title: 'The Realm', tabs: function () { return [{ key: 'castle', name: 'Castle' }, { key: 'trade', name: 'Trade' }, { key: 'chronicle', name: 'Chronicle' }, { key: 'settings', name: 'Settings' }]; }, body: worldBody }
  };

  function renderSheet(rebuildTabs) {
    if (!openPanel) return;
    var p = PANELS[openPanel];
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

  /* ---------------- BUILD ---------------- */
  function buildBody(box, cat) {
    var G = SIM.G;
    box.appendChild(h('<p class="hint">Pick a building, then tap the land. Roads and walls can be dragged in a line.</p>'));
    var any = false;
    Object.keys(DATA.B).forEach(function (id) {
      var def = DATA.B[id];
      if (def.cat !== cat || def.unique) return;
      var locked = def.tech && !G.tech[def.tech];
      var maxed = def.max && G.count[id] >= def.max;
      any = true;
      var cost = SIM.costOf(id);
      var card = h('<div class="card' + (locked ? ' locked' : '') + '">' +
        '<div class="card-row">' +
          '<div class="card-ic"></div>' +
          '<div class="card-main">' +
            '<h4>' + def.name + (G.count[id] ? ' <span style="opacity:.55;font-weight:400">×' + G.count[id] + '</span>' : '') + '</h4>' +
            '<p>' + def.desc + '</p>' +
            '<div class="cost">' + costPills(cost) +
              (def.jobs ? '<b>👷 ' + def.jobs + '</b>' : '') +
              (def.upkeep ? '<b>−' + def.upkeep.toFixed(2) + 'g/s</b>' : '') +
            '</div>' +
            (locked ? '<p style="color:#e0b23c;margin-top:5px">🔒 Requires ' + DATA.TECH[def.tech].name + '</p>' : '') +
          '</div>' +
        '</div></div>');
      card.querySelector('.card-ic').appendChild(ART.icon(id, 44));
      var btn = h('<button class="btn wide">Place</button>');
      btn.disabled = locked || maxed || !SIM.canAfford(cost);
      if (maxed) btn.textContent = 'Limit reached (' + def.max + ')';
      else if (!locked && !SIM.canAfford(cost)) btn.textContent = 'Need ' + DATA.RES.filter(function (r) {
        return cost[r.key] && G.res[r.key] < cost[r.key];
      }).map(function (r) { return r.name.toLowerCase(); }).join(' & ');
      btn.addEventListener('click', function () { startBuild(id); });
      card.appendChild(btn);
      box.appendChild(card);
    });
    if (!any) box.appendChild(h('<p class="hint">Nothing here yet — research will unlock more.</p>'));
  }

  /* ---------------- PEOPLE ---------------- */
  function peopleBody(box, tab) {
    var G = SIM.G;
    if (tab === 'overview') {
      var target = SIM.happyTarget();
      box.appendChild(h('<div class="card">' +
        '<div class="stat-line"><span>Villagers</span><b>' + Math.floor(G.pop) + ' / ' + SIM.housing() + ' housing</b></div>' +
        '<div class="stat-line"><span>At work</span><b>' + (Math.floor(G.pop) - (G.idle || 0)) + '</b></div>' +
        '<div class="stat-line"><span>Idle</span><b>' + (G.idle || 0) + '</b></div>' +
        '<div class="stat-line"><span>Contentment</span><b>' + Math.round(G.happy) + '% → ' + Math.round(target) + '%</b></div>' +
        '<div class="meter"><i class="' + (G.happy < 30 ? 'bad' : G.happy < 55 ? 'warn' : '') + '" style="width:' + G.happy + '%"></i></div>' +
        '<div class="stat-line" style="margin-top:8px"><span>Work efficiency</span><b>' + Math.round(SIM.efficiency() * 100) + '%</b></div>' +
        '<div class="stat-line"><span>Season effect on farms</span><b>×' + (SIM.G.tech.irrigation && SIM.season().key === 'winter' ? 0.65 : SIM.season().food) + '</b></div>' +
        '</div>'));
      box.appendChild(h('<p class="sect-label">What moves contentment</p>'));
      var lines = [];
      var capacity = 0;
      G.buildings.forEach(function (b) { if (b.built && b.def.happy) capacity += b.def.happy * 6; });
      lines.push(['Amenities serve', Math.round(capacity) + ' of ' + Math.floor(G.pop) + ' people']);
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
      box.appendChild(h('<p class="hint">Build wells, chapels and taverns to keep people content — unhappy villagers work slowly and eventually leave.</p>'));
    }

    if (tab === 'jobs') {
      box.appendChild(h('<p class="hint"><b>High</b> priority buildings are staffed to the brim first; everything else shares what is left, one villager each before any gets a second. Upgrading a building raises its output without needing more hands.</p>'));
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
          '<p>' + b.workers + '/' + SIM.jobsOf(b) + ' workers' + ((b.level || 1) > 1 ? ' · Lv ' + b.level : '') + ' · ' + outTxt + '/s</p></div>' +
          '</div></div>');
        card.querySelector('.card-ic').appendChild(ART.icon(b.id, 40));
        var prow2 = h('<div class="pill-row"></div>');
        ['Low', 'Normal', 'High'].forEach(function (lab, i) {
          var pl = h('<button class="pill' + ((b.prio === undefined ? 1 : b.prio) === i ? ' on' : '') + '">' + lab + '</button>');
          pl.addEventListener('click', function () { b.prio = i; U.sfx.tap(); renderSheet(); });
          prow2.appendChild(pl);
        });
        card.appendChild(prow2);
        var row = h('<div style="display:flex;gap:6px;margin-top:8px"></div>');
        var pb = h('<button class="btn sec" style="flex:1">' + (b.paused ? '▶ Resume' : '⏸ Pause') + '</button>');
        pb.addEventListener('click', function () { b.paused = !b.paused; renderSheet(); });
        var gb = h('<button class="btn sec" style="flex:1">Show</button>');
        gb.addEventListener('click', function () { RENDER.centreOn(b.x, b.y); closeSheet(); select({ b: b }); });
        row.appendChild(pb); row.appendChild(gb);
        card.appendChild(row);
        box.appendChild(card);
      });
    }

    if (tab === 'quests') {
      box.appendChild(h('<p class="hint">Charters from your council. Complete them for supplies.</p>'));
      var act = SIM.activeQuests(4);
      act.forEach(function (q) {
        box.appendChild(h('<div class="card"><div class="card-main"><h4>' + q.label + '</h4>' +
          '<div class="cost">' + Object.keys(q.reward).map(function (k) {
            var r = DATA.RES.filter(function (rr) { return rr.key === k; })[0];
            return '<b>' + (r ? r.ic : '') + ' +' + q.reward[k] + '</b>';
          }).join('') + '</div></div></div>'));
      });
      var doneN = Object.keys(SIM.G.quests).length;
      box.appendChild(h('<p class="sect-label">Completed — ' + doneN + ' / ' + DATA.QUESTS.length + '</p>'));
      DATA.QUESTS.filter(function (q) { return SIM.G.quests[q.id]; }).forEach(function (q) {
        box.appendChild(h('<div class="card" style="opacity:.55"><div class="card-main"><h4>✓ ' + q.label + '</h4></div></div>'));
      });
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
      var keys = Object.keys(G.army);
      if (!keys.length) box.appendChild(h('<p class="hint">You have no soldiers. Muster some before Brannoch comes calling.</p>'));
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

    if (tab === 'war') {
      var r = G.rival;
      var attackOdds = estimateOdds(r.str, 'raid');
      var defendOdds = estimateOdds(r.str * 0.85, 'defend');
      function col(o) { return o > 60 ? '#8fd06a' : o > 38 ? '#e0b23c' : '#e0795f'; }
      box.appendChild(h('<div class="card">' +
        '<h4 style="font-family:var(--font);font-size:15px">Brannoch</h4>' +
        '<p style="font-size:12px;color:#c3b18e;margin:4px 0 8px">A hard neighbour across the ash flats. They grow stronger every season you leave them alone.</p>' +
        '<div class="stat-line"><span>Their strength</span><b>' + Math.round(r.str) + '</b></div>' +
        '<div class="stat-line"><span>Your field strength</span><b>' + Math.round(fieldStrength()) + '</b></div>' +
        '<div class="stat-line"><span>Odds if you attack</span><b style="color:' + col(attackOdds) + '">' + attackOdds + '%</b></div>' +
        '<div class="stat-line"><span>Odds if they raid you</span><b style="color:' + col(defendOdds) + '">' + defendOdds + '%</b></div>' +
        '<div class="stat-line"><span>Next raid on you</span><b>~' + Math.max(0, Math.round(r.nextRaid / DATA.SEASON_LEN * 10) / 10) + ' seasons</b></div>' +
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

      var raid = h('<button class="btn wide">⚔️ March on Brannoch</button>');
      raid.disabled = SIM.armyCount() < 3;
      if (SIM.armyCount() < 3) raid.textContent = 'You need at least 3 soldiers';
      raid.addEventListener('click', function () {
        closeSheet();
        startBattle('raid', { power: G.rival.str, name: 'Brannoch' });
      });
      box.appendChild(raid);
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
      var tribute = h('<button class="btn sec wide">🕊️ Send tribute (−150 gold, delays their raid)</button>');
      tribute.addEventListener('click', function () {
        if (G.res.gold < 150) { toast('Not enough gold', 'bad'); return; }
        G.res.gold -= 150;
        r.nextRaid += DATA.SEASON_LEN * 2.4;
        r.str = Math.max(10, r.str - 6);
        toast('Brannoch accepts the tribute. Quiet, for now.', 'good');
        renderSheet();
      });
      box.appendChild(tribute);
      box.appendChild(h('<p class="hint">Walls and watchtowers only help when you are <b>defending</b>. Attacking is won by numbers, archers and smithies.</p>'));
    }
  }

  function unitStrength(hp, atk, def) { return (hp * 0.25 + atk * 1.6 + def * 0.8) / 3.1; }

  function fieldStrength(extraDef) {
    var G = SIM.G, sb = SIM.smithBonus(), s = 0;
    Object.keys(G.army).forEach(function (k) {
      var u = DATA.UNITS[k];
      s += G.army[k] * unitStrength(u.hp, u.atk * sb.atk, u.def + (extraDef || 0));
    });
    return s;
  }
  /* score the enemy the same way, from the army they would actually field */
  function foeStrength(power, flavour) {
    var spec = BATTLE.foeArmy(power, flavour), s = 0;
    Object.keys(spec).forEach(function (k) {
      var u = DATA.FOE_UNITS[k];
      s += spec[k] * unitStrength(u.hp, u.atk, u.def);
    });
    return s;
  }
  /* battles are superlinear in numbers, so compare squares (Lanchester) */
  function estimateOdds(power, kind, flavour) {
    var mine = fieldStrength(kind === 'defend' ? SIM.defenseScore() / 18 : 0);
    var theirs = foeStrength(power, flavour);
    if (mine <= 0) return 2;
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
      var avail = SIM.techAvailable(id);
      var missing = [];
      t.req.forEach(function (r) { if (!G.tech[r]) missing.push(DATA.TECH[r].name); });
      if (t.lib && G.count.library < t.lib) missing.push(t.lib + '× Library');
      var card = h('<div class="card' + (have || avail ? '' : ' locked') + '">' +
        '<div class="card-row"><div class="card-ic" style="font-size:20px">' + t.ic + '</div>' +
        '<div class="card-main"><h4>' + t.name + (have ? ' ✓' : '') + '</h4><p>' + t.desc + '</p>' +
        (have ? '' : '<div class="cost">' + costPills(t.cost) + '<b>⏳ ' + t.time + '</b></div>') +
        (missing.length ? '<p style="color:#e0b23c;margin-top:5px">🔒 Needs ' + missing.join(', ') + '</p>' : '') +
        '</div></div></div>');
      if (!have) {
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
  function worldBody(box, tab) {
    var G = SIM.G;
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
        '<div class="stat-line"><span>Roads laid</span><b>' + (G.count.road || 0) + '</b></div>' +
        '<div class="stat-line"><span>Research complete</span><b>' + G.stats.techDone + ' / ' + Object.keys(DATA.TECH).length + '</b></div>' +
        '<div class="stat-line"><span>Charters fulfilled</span><b>' + Object.keys(G.quests).length + ' / ' + DATA.QUESTS.length + '</b></div>' +
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
            'g · buy ' + DATA.TRADE_LOT + ' for ' + pr.buy + 'g</p></div></div></div>');
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
      var snd = h('<button class="btn sec wide">' + (U.isMuted() ? '🔇 Sound off' : '🔊 Sound on') + '</button>');
      snd.addEventListener('click', function () { toggleSound(); renderSheet(); });
      box.appendChild(snd);
      var fs = h('<button class="btn sec wide">⛶ Fullscreen</button>');
      fs.addEventListener('click', function () {
        var d = document.documentElement;
        if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen();
        else if (document.exitFullscreen) document.exitFullscreen();
      });
      box.appendChild(fs);
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
    updateGhost(RENDER.size.w / 2, RENDER.size.h / 2);
    U.sfx.tap();
  }
  function cancelBuild() {
    buildMode = null;
    RENDER.setGhost(null);
    el('build-banner').classList.add('hidden');
  }
  function updateGhost(sx, sy) {
    if (!buildMode) return;
    var t = RENDER.tileAtScreen(sx, sy);
    var chk = W.canPlace(buildMode, t.x, t.y);
    var cost = SIM.costOf(buildMode);
    var afford = SIM.canAfford(cost);
    RENDER.setGhost({ id: buildMode, x: t.x, y: t.y, ok: chk.ok && afford, why: chk.ok ? (afford ? '' : 'Not enough materials') : chk.why });
  }
  function tryPlaceAt(sx, sy) {
    var t = RENDER.tileAtScreen(sx, sy);
    var r = SIM.place(buildMode, t.x, t.y);
    if (r.ok) {
      U.sfx.place(); U.vibrate(12);
      RENDER.puff(t.x + .5, t.y + .8, '#c9b58a', 7);
      refreshHUD();
      if (!SIM.canAfford(SIM.costOf(buildMode))) {
        toast('Out of materials for more ' + DATA.B[buildMode].name.toLowerCase() + 's', 'war');
        cancelBuild();
      }
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

  function select(sel) {
    selected = sel;
    RENDER.setSelected(sel);
    renderInspector();
  }
  function clearSelection() {
    selected = null; RENDER.setSelected(null);
    el('inspector').classList.add('hidden');
  }

  function renderInspector() {
    if (!selected) { el('inspector').classList.add('hidden'); return; }
    var box = el('inspector');
    box.classList.remove('hidden');
    var ic = el('insp-icon'); ic.innerHTML = '';
    var body = el('insp-body'), acts = el('insp-actions');
    body.innerHTML = ''; acts.innerHTML = '';

    if (selected.b) {
      var b = selected.b, def = b.def;
      ic.appendChild(ART.icon(b.id, 40));
      el('insp-name').textContent = def.name + ((b.level || 1) > 1 ? '  ·  Lv ' + b.level : '');
      el('insp-sub').textContent = b.built
        ? (SIM.jobsOf(b) ? b.workers + '/' + SIM.jobsOf(b) + ' workers' : 'no workers needed') + (b.paused ? ' · paused' : '')
        : 'Under construction — ' + Math.round(b.prog * 100) + '%';
      var out = SIM.output(b);
      var lines = [];
      Object.keys(out).forEach(function (k) {
        if (Math.abs(out[k]) < 0.001) return;
        lines.push('<div class="stat-line"><span>' + k + '</span><b>' + U.signed(out[k], 2) + '/s</b></div>');
      });
      if (def.upkeep) lines.push('<div class="stat-line"><span>upkeep</span><b>−' + def.upkeep.toFixed(2) + ' g/s</b></div>');
      if (def.housing) lines.push('<div class="stat-line"><span>housing</span><b>+' + def.housing + '</b></div>');
      if (def.happy) lines.push('<div class="stat-line"><span>contentment</span><b>+' + def.happy + ' (r' + def.radius + ')</b></div>');
      if (def.defense) lines.push('<div class="stat-line"><span>defence</span><b>+' + def.defense * (SIM.G.tech.fortification ? 1.6 : 1) + '</b></div>');
      if (def.armyCap) lines.push('<div class="stat-line"><span>troop capacity</span><b>+' + def.armyCap + '</b></div>');
      if (def.aura) lines.push('<div class="stat-line"><span>aura</span><b>+' + Math.round(Object.values(def.aura)[0] * 100) + '% nearby</b></div>');
      if (b.built && def.scaleNear) {
        var n = W.nearCount(b.x, b.y, def.scaleNear.terrain, 1);
        lines.push('<div class="stat-line"><span>resource tiles nearby</span><b>' + n + '</b></div>');
      }
      body.innerHTML = lines.join('') || '<p style="font-size:12px;color:#bda98a;margin:0">' + def.desc + '</p>';

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
        body.innerHTML += '<div class="sect-label" style="margin:10px 0 4px">Worker priority</div>';
        var prow = h('<div class="pill-row" style="margin:0 0 2px"></div>');
        ['Low', 'Normal', 'High'].forEach(function (lab, i) {
          var pl = h('<button class="pill' + ((b.prio === undefined ? 1 : b.prio) === i ? ' on' : '') + '">' + lab + '</button>');
          pl.addEventListener('click', function () { b.prio = i; U.sfx.tap(); renderInspector(); });
          prow.appendChild(pl);
        });
        body.appendChild(prow);
        var pb = h('<button class="btn sec">' + (b.paused ? '▶ Resume' : '⏸ Pause') + '</button>');
        pb.addEventListener('click', function () { b.paused = !b.paused; renderInspector(); });
        acts.appendChild(pb);
      }
      if (b.id !== 'castle') {
        var db = h('<button class="btn danger">Demolish</button>');
        var armed = false;
        db.addEventListener('click', function () {
          if (!armed) { armed = true; db.textContent = 'Sure?'; setTimeout(function () { armed = false; db.textContent = 'Demolish'; }, 2600); return; }
          SIM.demolish(b); clearSelection(); refreshHUD(); U.sfx.place();
        });
        acts.appendChild(db);
      } else {
        var ub = h('<button class="btn">Castle & realm</button>');
        ub.addEventListener('click', function () { clearSelection(); openTab.world = 'castle'; openSheet('world'); });
        acts.appendChild(ub);
      }
    } else if (selected.t) {
      var t = selected.t;
      var terr = DATA.TERRAIN[t.terr];
      ic.textContent = { water: '🌊', shore: '🌊', sand: '🏖️', grass: '🌿', meadow: '🌸', forest: '🌲', hill: '⛰️', rock: '🪨' }[t.terr];
      ic.style.fontSize = '20px';
      el('insp-name').textContent = terr.name;
      el('insp-sub').textContent = 'Tile ' + t.x + ', ' + t.y + (t.road ? ' · road' : '');
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
      if (t.road) {
        var rb = h('<button class="btn danger">Tear up road</button>');
        rb.addEventListener('click', function () {
          var road = SIM.G.buildings.filter(function (b2) { return b2.def.isRoad && b2.x === t.x && b2.y === t.y; })[0];
          if (road) SIM.demolish(road); else t.road = false;
          clearSelection(); refreshHUD();
        });
        acts.appendChild(rb);
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
      canvas.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      U.resumeAudio();
      if (count() === 1) {
        moved = false; downT = performance.now(); downX = e.clientX; downY = e.clientY;
        lastPaint = null;
        longTimer = setTimeout(function () {
          if (!moved && !buildMode) {
            var t = RENDER.tileAtScreen(downX, downY - rectTop());
            var tile = W.at(t.x, t.y);
            if (tile) { U.vibrate(18); select(tile.bld ? { b: tile.bld } : { t: tile }); }
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
      if (buildMode && def && (def.isRoad || def.isWall) && moved) {
        // drag-paint roads and walls
        var t = RENDER.tileAtScreen(e.clientX, e.clientY - rectTop());
        var key = t.x + ',' + t.y;
        if (key !== lastPaint) {
          lastPaint = key;
          if (W.canPlace(buildMode, t.x, t.y).ok && SIM.canAfford(SIM.costOf(buildMode))) {
            SIM.place(buildMode, t.x, t.y);
            U.sfx.tap();
            refreshHUD();
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
        var t = RENDER.tileAtScreen(e.clientX, sy);
        var tile = W.at(t.x, t.y);
        if (!tile) { clearSelection(); return; }
        if (tile.bld) select({ b: tile.bld });
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
  function setSpeed(v) {
    SIM.G.speed = v;
    [0, 1, 2, 3].forEach(function (i) {
      var b = el('spd-' + i);
      var val = [0, 1, 2, 4][i];
      b.classList.toggle('active', val === v);
    });
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

  function fireEvent() {
    if (modalBusy || BATTLE.isOpen()) { return; }
    var G = SIM.G;
    var pool = DATA.EVENTS.filter(function (e) { return !e.when || e.when(G); });
    if (!pool.length) return;
    var ev = U.pick(Math.random, pool);
    showEvent(ev);
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

    el('event-modal').classList.remove('hidden');
    U.sfx.horn();
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

  function incomingRaid() {
    if (modalBusy || BATTLE.isOpen()) return;
    var G = SIM.G;
    var power = G.rival.str * U.range(Math.random, 0.7, 1.0);
    var ev = {
      art: '📯', title: 'Brannoch Rides on Ashveil',
      text: 'Smoke on the eastern road. A war band of roughly ' + Math.round(power / 9) +
            ' fighters is coming for your granaries. Your defences add +' + SIM.defenseScore() +
            ' to the line, and your captains rate the fight at about ' + estimateOdds(power, 'defend') + '%.',
      choices: [
        { label: '⚔️ Meet them in the field', sub: 'Fight — your walls and towers help', battle: true },
        { label: '💰 Buy them off', sub: '−' + Math.round(80 + power * 2) + ' gold', buy: Math.round(80 + power * 2) }
      ]
    };
    modalBusy = true;
    var prevSpeed = SIM.G.speed;
    setSpeed(0);
    el('ev-art').textContent = ev.art;
    el('ev-title').textContent = ev.title;
    el('ev-text').textContent = ev.text;
    var box = el('ev-choices'); box.innerHTML = '';
    ev.choices.forEach(function (c) {
      var b = h('<button class="ev-choice">' + c.label + '<small>' + c.sub + '</small></button>');
      if (c.buy && SIM.G.res.gold < c.buy) b.disabled = true;
      b.addEventListener('click', function () {
        el('event-modal').classList.add('hidden');
        modalBusy = false;
        if (c.battle) {
          startBattle('defend', { power: power, name: 'Brannoch' }, prevSpeed);
        } else {
          SIM.G.res.gold -= c.buy;
          SIM.G.happy = U.clamp(SIM.G.happy - 6, 0, 100);
          SIM.G.rival.str += 4;
          chronicle('Paid off a Brannoch war band for ' + c.buy + ' gold.');
          toast('The war band takes your gold and turns for home.', 'war');
          setSpeed(prevSpeed || 1);
          refreshHUD();
        }
      });
      box.appendChild(b);
    });
    el('event-modal').classList.remove('hidden');
    U.sfx.horn(); U.vibrate([40, 80, 40]);
  }

  /* =========================================================
     WIRING
     ========================================================= */
  function init() {
    bindInput(el('scene'));

    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.addEventListener('click', function () { U.sfx.tap(); openSheet(b.dataset.panel); });
    });
    el('sheet-close').addEventListener('click', closeSheet);
    el('sheet-scrim').addEventListener('click', closeSheet);
    el('insp-close').addEventListener('click', clearSelection);
    el('build-cancel').addEventListener('click', cancelBuild);
    el('btn-center').addEventListener('click', function () {
      var c = SIM.G.buildings[0];
      if (c) RENDER.centreOn(c.x, c.y);
    });
    el('btn-sound').addEventListener('click', toggleSound);
    el('btn-menu').addEventListener('click', function () { openTab.world = 'settings'; openSheet('world'); });
    [0, 1, 2, 3].forEach(function (i) {
      el('spd-' + i).addEventListener('click', function () { setSpeed([0, 1, 2, 4][i]); U.sfx.tap(); });
    });
    el('bt-done').addEventListener('click', function () { BATTLE.close(); });

    SIM.on(function (kind, payload) {
      if (kind === 'toast') { toast(payload.msg, payload.kind); chronicle(payload.msg); }
      if (kind === 'event') eventQueue.push('event');
      if (kind === 'raid-incoming') eventQueue.push('raid');
      if (kind === 'relief') eventQueue.push('relief');
      if (kind === 'season') { chronicle(payload.name + ' comes to Ashveil.'); }
      if (kind === 'completed') {
        RENDER.puff(payload.x + .5, payload.y + .6, '#e8dcb5', 10);
        RENDER.floater(payload.x + .5, payload.y - .1, payload.def.name + ' done', '#a8f07a');
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

  /* drain queued events between frames so two never stack */
  function pump() {
    if (modalBusy || BATTLE.isOpen() || !eventQueue.length) return;
    var next = eventQueue.shift();
    if (next === 'raid') incomingRaid();
    else if (next === 'relief') reliefEvent();
    else fireEvent();
  }

  return {
    init: init, refreshHUD: refreshHUD, toast: toast, pump: pump,
    setSpeed: setSpeed, renderSheet: function () { if (openPanel) renderSheet(); },
    isModalOpen: function () { return modalBusy; },
    chronicle: chronicle, closeSheet: closeSheet, clearSelection: clearSelection
  };
})();
