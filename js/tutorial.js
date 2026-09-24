/* ============================================================
   tutorial.js — the first few minutes, shown rather than told.
   A bubble says what to do, a ring pulses round the thing to tap,
   and each step waits until you have actually done it.
   ============================================================ */
var TUT = (function () {
  'use strict';

  var bubble, ring, text, next, skip, target = null, spot = null;

  function el(id) { return document.getElementById(id); }
  function q(sel) { return document.querySelector(sel); }
  function houses() { return SIM.G.buildings.filter(function (b) { return b.id === 'house'; }).length; }
  function farms() { return SIM.G.buildings.filter(function (b) { return b.id === 'farm'; }).length; }

  /* a good empty plot near the hall, for pointing at */
  function openSpot(id) {
    var c = SIM.G.buildings[0], def = DATA.B[id];
    for (var r = 2; r < 9; r++) {
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        var x = c.x + dx, y = c.y + dy;
        if (W.canPlace(id, x, y).ok) return { x: x + (def.w || 1) / 2, y: y + (def.h || 1) / 2 };
      }
    }
    return null;
  }

  var STEPS = [
    { say: 'Tap <b>Build</b> to see what your village needs.', at: function () { return q('.nav-btn[data-panel="build"]'); },
      done: function () { return UI.panel === 'build'; } },
    { say: 'Your people need homes. Press <b>Place</b> on the <b>Cottage</b>.',
      at: function () { var cards = document.querySelectorAll('#sheet-body .card'); for (var i = 0; i < cards.length; i++) if (/Cottage/.test(cards[i].textContent)) return cards[i].querySelector('.btn'); return null; },
      done: function () { return UI.building === 'house'; },
      lost: function () { return UI.panel !== 'build' && UI.building !== 'house'; }, back: 0 },
    { say: 'Now tap open ground near your hall. The outline turns <b>green</b> where it fits.', world: 'house',
      enter: function (st) { st.count = houses(); },
      done: function (st) { return houses() > st.count; },
      lost: function () { return !UI.building; }, back: 0 },
    { say: 'A cottage is going up. Now food: open <b>Build</b> and place a <b>Farm</b>. Fields need a 2×2 patch of open ground.',
      at: function () { return UI.panel === 'build' ? null : q('.nav-btn[data-panel="build"]'); },
      enter: function (st) { st.count = farms(); },
      done: function (st) { return farms() > st.count; } },
    { say: 'Your goals live up here, with how close you are. Tap it any time to read the whole chapter.',
      at: function () { return el('goal-card'); }, button: 'Got it' },
    { say: 'Time runs by itself. Speed it up here when you are waiting on something.',
      at: function () { return q('.speed-group'); }, button: 'Got it' },
    { say: 'Tap any building to see what it makes — and to <b>move</b>, <b>upgrade</b> or <b>pause</b> it. Placed something in the wrong spot? Press <b>↶ Undo</b> straight after.',
      button: 'Start ruling' }
  ];

  function init() {
    bubble = document.createElement('div'); bubble.id = 'tut';
    bubble.innerHTML = '<p id="tut-text"></p><div class="tut-row"><button id="tut-skip" type="button">Skip tutorial</button><button id="tut-next" type="button">Got it</button></div>';
    ring = document.createElement('div'); ring.id = 'tut-ring';
    el('app').appendChild(ring); el('app').appendChild(bubble);
    text = el('tut-text'); next = el('tut-next'); skip = el('tut-skip');
    bubble.classList.add('hidden'); ring.classList.add('hidden');
    next.addEventListener('click', function () { advance(); });
    skip.addEventListener('click', function () { finish(true); });
  }

  function current() { var i = SIM.G && SIM.G.tut; return (typeof i === 'number' && i >= 0 && i < STEPS.length) ? STEPS[i] : null; }
  function start() { SIM.G.tut = 0; entered = -1; }
  var entered = -1, state = {};
  function advance() {
    SIM.G.tut++;
    U.sfx.tap();
    if (SIM.G.tut >= STEPS.length) finish(false);
  }
  function finish(skipped) {
    SIM.G.tut = -1;
    bubble.classList.add('hidden'); ring.classList.add('hidden');
    if (!skipped) UI.toast('The realm is yours. Follow the goal card, and good luck.', 'good');
  }

  /* called every frame */
  function update() {
    if (!bubble) return;
    var st = current();
    var blocked = !st || !el('event-modal').classList.contains('hidden') || BATTLE.isOpen();
    if (blocked) { bubble.classList.add('hidden'); ring.classList.add('hidden'); return; }
    if (entered !== SIM.G.tut) {
      entered = SIM.G.tut; state = {}; if (st.enter) st.enter(state);
      spot = st.world ? openSpot(st.world) : null;
      // frame the suggested plot in the upper part of the screen, above the bubble
      if (spot) { RENDER.centreOn(spot.x - 0.5 + 2, spot.y - 0.5 + 2); UI.ghostTo(RENDER.toScreen(spot.x, spot.y)); }
    }
    if (st.done && st.done(state)) { advance(); return; }
    if (st.lost && st.lost(state)) { SIM.G.tut = st.back; return; }

    text.innerHTML = st.say;
    next.style.display = st.button ? '' : 'none';
    if (st.button) next.textContent = st.button;
    bubble.classList.remove('hidden');

    // where to point: an element on screen, or a spot on the map
    var r = null;
    target = st.at ? st.at() : null;
    if (target && target.offsetParent !== null) {
      var b = target.getBoundingClientRect();
      r = { x: b.left, y: b.top, w: b.width, h: b.height };
    } else if (spot) {
      var s = RENDER.toScreen(spot.x, spot.y), top = el('scene').getBoundingClientRect().top;
      var sz = RENDER.cam.z * 0.9;
      r = { x: s.x - sz / 2, y: s.y + top - sz / 4, w: sz, h: sz / 2 };
    }
    var H = window.innerHeight;
    if (r) {
      ring.classList.remove('hidden');
      ring.style.left = (r.x - 6) + 'px'; ring.style.top = (r.y - 6) + 'px';
      ring.style.width = (r.w + 12) + 'px'; ring.style.height = (r.h + 12) + 'px';
      ring.classList.toggle('round', !!spot && !target);
      // the bubble sits on the far side of the screen from its target
      var below = r.y + r.h / 2 < H * 0.5;
      bubble.style.top = below ? Math.min(H - 160, r.y + r.h + 18) + 'px' : '';
      bubble.style.bottom = below ? '' : Math.max(80, H - r.y + 18) + 'px';
    } else {
      ring.classList.add('hidden');
      bubble.style.top = ''; bubble.style.bottom = (H * 0.42) + 'px';
    }
  }

  return { init: init, start: start, update: update, get active() { return !!current(); } };
})();
