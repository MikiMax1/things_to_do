/* ============================================================
   main.js — boot, title screen, the loop
   ============================================================ */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  var last = 0, running = false, saveTimer = 0, hudTimer = 0, sheetTimer = 0;

  function boot() {
    ART.bake();
    RENDER.init(el('scene'));
    BATTLE.init();
    UI.init();

    var hasSave = SIM.hasSave();
    el('btn-continue').style.display = hasSave ? 'block' : 'none';
    if (!hasSave) el('btn-new').textContent = 'Begin';

    el('btn-continue').addEventListener('click', function () {
      U.resumeAudio();
      if (!SIM.loadGame()) { SIM.newGame(); }
      enter();
    });
    el('btn-new').addEventListener('click', function () {
      U.resumeAudio();
      if (SIM.hasSave() && !el('btn-new').dataset.armed) {
        el('btn-new').dataset.armed = '1';
        el('btn-new').textContent = 'Tap again — this replaces your saved kingdom';
        return;
      }
      U.wipe();
      SIM.newGame();
      enter();
    });

    // keep the canvas honest through rotations and browser chrome changes
    window.addEventListener('resize', function () { RENDER.resize(); BATTLE.resize(); });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { RENDER.resize(); BATTLE.resize(); }, 250);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { SIM.save(); }
      else last = performance.now();
    });
    window.addEventListener('pagehide', function () { SIM.save(); });
    // block the browser's own pinch-zoom / double-tap zoom
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });
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
    UI.toast('Tap the land to look around. Start with cottages and farms.', 'good');
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (!running) return;
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
    }

    RENDER.draw(dt);
    UI.pump();

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
