/* ============================================================
   main.js — boot, title screen, the loop
   ============================================================ */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  var last = 0, running = false, saveTimer = 0, hudTimer = 0, sheetTimer = 0;

  /* The title is painted from the game's own art: evening over the sea,
     and the citadel you are working toward, on its island among trees. */
  function paintTitle() {
    var cv = el('title-art');
    if (!cv) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = cv.clientWidth, H = cv.clientHeight;
    cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var horizon = H * 0.42;
    var sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#1b2440'); sky.addColorStop(0.55, '#6a4a5a'); sky.addColorStop(1, '#e89a5a');
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon + 1);
    // the low sun and its glow
    var sunX = W > H * 1.2 ? W * 0.52 : W * 0.72;
    var sun = g.createRadialGradient(sunX, horizon - 6, 2, sunX, horizon - 6, W * 0.6);
    sun.addColorStop(0, 'rgba(255,225,160,.95)'); sun.addColorStop(0.08, 'rgba(255,190,110,.55)'); sun.addColorStop(1, 'rgba(255,150,80,0)');
    g.fillStyle = sun; g.fillRect(0, 0, W, horizon + 40);
    // a few thin clouds catching the light
    for (var i = 0; i < 7; i++) {
      var cxx = W * (0.08 + i * 0.15), cyy = horizon * (0.3 + (i % 3) * 0.13), cw2 = W * (0.14 + (i % 2) * 0.08);
      g.save(); g.translate(cxx, cyy); g.scale(1, 0.12);
      var cg = g.createRadialGradient(0, 0, 0, 0, 0, cw2);
      cg.addColorStop(0, 'rgba(255,196,160,' + (0.22 + i * 0.02) + ')'); cg.addColorStop(1, 'rgba(255,196,160,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(0, 0, cw2, 0, 6.3); g.fill(); g.restore();
    }
    // the sea, with the sun's path on it
    var sea = g.createLinearGradient(0, horizon, 0, H);
    sea.addColorStop(0, '#6b6a78'); sea.addColorStop(0.15, '#2b4a66'); sea.addColorStop(1, '#0e1f30');
    g.fillStyle = sea; g.fillRect(0, horizon, W, H - horizon);
    for (var k = 0; k < 60; k++) {
      var yy = horizon + 3 + Math.pow(k / 60, 1.6) * (H - horizon) * 0.8;
      var ww = 6 + k * 1.4;
      g.fillStyle = 'rgba(255,200,130,' + (0.5 - k / 140) + ')';
      g.fillRect(sunX - ww / 2 + Math.sin(k * 7.3) * 10, yy, ww * (0.4 + (k % 3) * 0.3), 1.4);
    }
    // the island
    var wide = W > H * 1.2;
    var ix = wide ? W * 0.3 : W * 0.5, iy = wide ? H * 0.58 : H * 0.47;
    var iw = wide ? Math.min(W * 0.24, H * 0.6, 230) : Math.min(W * 0.44, 230);
    g.fillStyle = '#5b4a36';
    g.beginPath(); g.ellipse(ix, iy + 10, iw, iw * 0.23, 0, 0, 6.3); g.fill();
    var land = g.createLinearGradient(ix - iw, 0, ix + iw, 0);
    land.addColorStop(0, '#6f9a44'); land.addColorStop(0.7, '#4f7a32'); land.addColorStop(1, '#3a5c26');
    g.fillStyle = land;
    g.beginPath(); g.ellipse(ix, iy, iw * 0.97, iw * 0.21, 0, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.beginPath(); g.ellipse(ix, iy + iw * 0.2, iw * 0.9, 3, 0, 0, Math.PI); g.fill();
    // what stands on it, back to front
    var r = U.mulberry(7);
    var things = [];
    for (var t = 0; t < 26; t++) {
      var a = r() * 6.283, d = 0.62 + r() * 0.34;
      things.push({ k: 'tree', x: ix + Math.cos(a) * iw * 0.9 * d, y: iy + Math.sin(a) * iw * 0.18 * d, v: Math.floor(r() * 3), kind: r() < 0.45 ? 1 : 0 });
    }
    [[-0.5, 0.03, 'house', 2], [0.5, 0.05, 'house', 3], [-0.34, 0.11, 'house', 1], [0.66, -0.03, 'windmill', 1]].forEach(function (h) {
      things.push({ k: 'bld', id: h[2], lvl: h[3], x: ix + h[0] * iw, y: iy + h[1] * iw });
    });
    things.push({ k: 'castle', x: ix, y: iy + iw * 0.04 });
    things.sort(function (p, q) { return p.y - q.y; });
    var unit = iw / 2.3;                   // px per tile on this painting
    things.forEach(function (o) {
      var sp, sc;
      if (o.k === 'tree') { sp = ART.tree(o.kind, 'summer', o.v); sc = unit * 0.62 / sp.s; }
      else if (o.k === 'castle') { sp = ART.building({ id: 'castle', def: DATA.B.castle, _tier: 3 }, 'summer'); sc = unit / sp.s; }
      else { sp = ART.building({ id: o.id, def: DATA.B[o.id], level: o.lvl }, 'summer'); sc = unit * 0.8 / sp.s; }
      var px = o.x, py = o.y;
      if (o.k === 'castle') { px -= 0; py -= unit * 0.5; }
      g.drawImage(sp.c, px - sp.ax * sc, py - sp.ay * sc, sp.c.width * sc, sp.c.height * sc);
    });
    // warm evening light over all of it, and a darker foot for the buttons
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = 'rgba(255,150,70,.35)'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    if (wide) {
      var side = g.createLinearGradient(W * 0.5, 0, W, 0);
      side.addColorStop(0, 'rgba(8,10,16,0)'); side.addColorStop(1, 'rgba(8,10,16,.8)');
      g.fillStyle = side; g.fillRect(W * 0.5, 0, W * 0.5, H);
    } else {
      var foot = g.createLinearGradient(0, H * 0.55, 0, H);
      foot.addColorStop(0, 'rgba(8,10,16,0)'); foot.addColorStop(1, 'rgba(8,10,16,.85)');
      g.fillStyle = foot; g.fillRect(0, H * 0.55, W, H * 0.45);
    }
  }

  /* the choices before a new reign: island, world, beginning */
  var setup = { map: 'green', diff: 'fair', scen: 'standard' };
  var MAPS = {
    green: { name: 'Green Isle', ic: '🌿', desc: 'Meadows, woods and a little of everything. The classic start.' },
    forest: { name: 'Forest Isle', ic: '🌲', desc: 'Deep woods to the shore. Timber is easy; open fields are not.' },
    highland: { name: 'Highlands', ic: '⛰️', desc: 'Hills and crags. Stone and iron for the taking, thin soil for farms.' },
    twin: { name: 'Twin Isles', ic: '🏝️', desc: 'Two islands joined by a spit of sand. Tight, and beautiful.' }
  };
  function openSetup() {
    try { var sv = JSON.parse(localStorage.getItem('ashveil.setup') || 'null'); if (sv) setup = sv; } catch (e) {}
    el('title-screen').classList.add('setting-up');
    el('btn-new').style.display = 'none'; el('btn-continue').style.display = 'none';
    el('setup').classList.remove('hidden');
    renderSetup();
  }
  function renderSetup() {
    var lists = { map: MAPS, diff: SIM.DIFFS, scen: SIM.SCENARIOS };
    var rows = document.querySelectorAll('#setup .setup-row');
    Array.prototype.forEach.call(rows, function (row) {
      var k = row.dataset.k, L = lists[k];
      row.innerHTML = '';
      Object.keys(L).forEach(function (id) {
        var o = L[id], b = document.createElement('button');
        b.type = 'button'; b.className = 'setup-pill' + (setup[k] === id ? ' on' : '');
        b.innerHTML = (o.ic ? '<i>' + o.ic + '</i>' : '') + o.name;
        b.addEventListener('click', function () { setup[k] = id; U.sfx.tap(); renderSetup(); });
        row.appendChild(b);
      });
    });
    el('setup-desc').innerHTML = '<b>' + MAPS[setup.map].name + '.</b> ' + MAPS[setup.map].desc + '<br><b>' + SIM.DIFFS[setup.diff].name + '.</b> ' +
      SIM.DIFFS[setup.diff].desc + '<br><b>' + SIM.SCENARIOS[setup.scen].name + '.</b> ' + SIM.SCENARIOS[setup.scen].desc;
  }

  function boot() {
    ART.bake();
    try { paintTitle(); } catch (e) { /* the title works without its painting */ }
    window.addEventListener('resize', function () { if (!running) { try { paintTitle(); } catch (e) {} } });
    RENDER.init(el('scene'));
    BATTLE.init();
    UI.init();
    TUT.init();

    var hasSave = SIM.hasSave();
    el('btn-continue').style.display = hasSave ? 'block' : 'none';
    if (!hasSave) el('btn-new').textContent = 'Begin';

    el('btn-continue').addEventListener('click', function () {
      U.resumeAudio();
      if (!SIM.loadGame()) { SIM.newGame(); }
      prepare(enter);
    });
    el('btn-new').addEventListener('click', function () {
      U.resumeAudio();
      if (SIM.hasSave() && !el('btn-new').dataset.armed) {
        el('btn-new').dataset.armed = '1';
        el('btn-new').textContent = 'Tap again — this replaces your saved kingdom';
        return;
      }
      openSetup();
    });
    el('btn-found').addEventListener('click', function () {
      U.resumeAudio(); U.sfx.tap();
      try { localStorage.setItem('ashveil.setup', JSON.stringify(setup)); } catch (e) {}
      el('setup').classList.add('hidden');
      U.wipe();
      SIM.newGame(null, { map: setup.map, diff: setup.diff, scen: setup.scen });
      prepare(enter);
    });
    el('btn-setup-back').addEventListener('click', function () {
      el('setup').classList.add('hidden');
      el('btn-new').style.display = ''; if (SIM.hasSave()) el('btn-continue').style.display = 'block';
      el('title-screen').classList.remove('setting-up');
    });

    // keep the canvas honest through rotations and browser chrome changes
    window.addEventListener('resize', function () { RENDER.resize(); BATTLE.resize(); });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { RENDER.resize(); BATTLE.resize(); }, 250);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { SIM.save(); TERRAIN.saveCache(); }
      else last = performance.now();
    });
    window.addEventListener('pagehide', function () { SIM.save(); TERRAIN.saveCache(); });
    // block the browser's own pinch-zoom / double-tap zoom
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  }

  /* The island is painted pixel by pixel before you see it. It takes a
     moment on a phone, so it happens behind a progress bar rather than
     as a frozen screen. */
  var preparing = false;
  function prepare(then) {
    if (preparing) return;
    preparing = true;
    el('btn-continue').style.display = 'none';
    el('btn-new').style.display = 'none';
    el('loading').classList.remove('hidden');
    TERRAIN.begin(SIM.season().key, SIM.G.seed);
    (function stepLoad() {
      TERRAIN.step(28);
      el('load-fill').style.width = Math.round(TERRAIN.progress() * 100) + '%';
      if (TERRAIN.ready) { preparing = false; then(); }
      else requestAnimationFrame(stepLoad);
    })();
  }

  function enter() {
    var ts = el('title-screen');
    ts.classList.add('gone');
    setTimeout(function () { ts.style.display = 'none'; }, 520);
    var c = SIM.G.buildings[0];
    if (c) RENDER.centreOn(c.x, c.y);
    UI.setSpeed(1);
    UI.refreshHUD();
    UI.chronicle('Ashveil is founded.');
    if (SIM.G.fresh) { SIM.G.fresh = false; UI.introCard(); }
    else UI.toast('Welcome back to Ashveil.', 'good');
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!running) return;
    // battery saver draws at most 30 times a second
    if (RENDER.quality() === 'saver' && now - last < 30) return;
    var dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    if (BATTLE.isOpen()) {
      BATTLE.update(dt);
      return;
    }

    var speed = SIM.G.speed || 0;
    if (speed > 0 && !UI.isModalOpen()) {
      // step the economy in slices so high speeds stay stable
      var remain = dt * speed, slice = 0.05;
      while (remain > 0) {
        var d = Math.min(slice, remain);
        SIM.tick(d);
        remain -= d;
      }
      AGENTS.update(Math.min(dt * Math.min(speed, 2), 0.15));
      U.ambient(dt, { night: RENDER.nightAmount(), season: SIM.season().key, rain: SIM.G.weather === 'rain' || SIM.G.weather === 'storm',
                      storm: SIM.G.weather === 'storm', war: !!SIM.G.war || BATTLE.isOpen() });
    }

    RENDER.draw(dt);
    UI.pump();
    TUT.update();

    hudTimer += dt;
    if (hudTimer > 0.2) { hudTimer = 0; UI.refreshHUD(); }
    sheetTimer += dt;
    if (sheetTimer > 0.6) { sheetTimer = 0; UI.renderSheet(); }
    saveTimer += dt;
    if (saveTimer > 8) { saveTimer = 0; SIM.save(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
