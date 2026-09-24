/* ============================================================
   render.js — the isometric view: camera, ground, shadows, the
   depth-sorted world, weather, light and the overlays on top.
   ============================================================ */
var RENDER = (function () {
  'use strict';

  var cv, g, cw = 0, ch = 0, dpr = 1;
  var cam = { x: 14, y: 14, z: 52, tz: 52 };
  var MINZ = 22, MAXZ = 190;
  var ghost = null;        // {id,x,y,ok,why}
  var selected = null;     // {b} or {t}
  var particles = [];      // world-space: smoke, dust, sparks
  var weather = [];        // screen-space: rain, snow, leaves
  var floaters = [];
  var clouds = [];
  var birds = [];
  var time = 0;
  var lastSeason = null;
  var DBG = {};          // switches for profiling

  /* ---------------- detail levels ----------------
     'auto' starts at high and steps down if the phone cannot keep up;
     a level picked by hand stays put. */
  var QPREF = 'auto', QLEVEL = 'high';
  var Q = {
    high:     { dpr: 2,   lean: true,  weather: 1,   clouds: true,  glints: true },
    balanced: { dpr: 1.5, lean: false, weather: 0.6, clouds: true,  glints: true },
    saver:    { dpr: 1,   lean: false, weather: 0.3, clouds: false, glints: false }
  };
  try { QPREF = localStorage.getItem('ashveil.quality') || 'auto'; } catch (e) {}
  if (QPREF !== 'auto' && Q[QPREF]) QLEVEL = QPREF;
  var perf = { t: 0, frames: 0, slow: 0 }, onQuality = null;
  function setQuality(pref) {
    QPREF = pref;
    try { localStorage.setItem('ashveil.quality', pref); } catch (e) {}
    QLEVEL = pref === 'auto' ? 'high' : pref;
    perf.slow = 0;
    resize();
  }
  function watchFrames(dt) {
    if (QPREF !== 'auto' || document.hidden) return;
    perf.t += dt; perf.frames++;
    if (perf.t < 2) return;
    var avg = perf.t / perf.frames;
    perf.t = 0; perf.frames = 0;
    // slower than about 36 frames a second, twice running: ease off
    if (avg > 0.028) perf.slow++; else perf.slow = 0;
    if (perf.slow >= 2 && QLEVEL !== 'saver') {
      QLEVEL = QLEVEL === 'high' ? 'balanced' : 'saver';
      perf.slow = 0;
      resize();
      if (onQuality) onQuality(QLEVEL);
    }
  }

  var calm = document.documentElement.classList.contains('calm');
  function init(canvas) {
    cv = canvas; g = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    for (var i = 0; i < 5; i++) clouds.push(newCloud(true));
  }

  function resize() {
    // 2× is indistinguishable from 3× on a phone and costs half the pixels
    dpr = Math.min(window.devicePixelRatio || 1, Q[QLEVEL].dpr);
    cw = cv.clientWidth; ch = cv.clientHeight;
    cv.width = Math.floor(cw * dpr); cv.height = Math.floor(ch * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- projection ----------------
     world (x, y) on the ground → screen. A tile is z px wide, z/2 tall. */
  function toScreen(wx, wy) {
    return {
      x: cw / 2 + ((wx - wy) - (cam.x - cam.y)) * cam.z / 2,
      y: ch / 2 + ((wx + wy) - (cam.x + cam.y)) * cam.z / 4
    };
  }
  function toWorld(sx, sy) {
    var a = (sx - cw / 2) / (cam.z / 2) + (cam.x - cam.y);
    var b = (sy - ch / 2) / (cam.z / 4) + (cam.x + cam.y);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }
  function tileAtScreen(sx, sy) {
    var w = toWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }
  /* The ground plane as a canvas transform, so shapes drawn in world
     units lie flat on the land. */
  function groundTransform() {
    var z = cam.z;
    var ox = cw / 2 - (cam.x - cam.y) * z / 2, oy = ch / 2 - (cam.x + cam.y) * z / 4;
    g.setTransform(dpr * z / 2, dpr * z / 4, -dpr * z / 2, dpr * z / 4, dpr * ox, dpr * oy);
  }
  function screenTransform() { g.setTransform(dpr, 0, 0, dpr, 0, 0); }

  function centreOn(x, y) { cam.x = x + .5; cam.y = y + .5; clampCam(); }
  function pan(dx, dy) {
    var da = -dx / (cam.z / 2), db = -dy / (cam.z / 4);
    cam.x += (da + db) / 2; cam.y += (db - da) / 2;
    clampCam();
  }
  function zoomAt(sx, sy, factor) {
    var before = toWorld(sx, sy);
    cam.tz = U.clamp(cam.tz * factor, MINZ, MAXZ);
    cam.z = cam.tz;
    var after = toWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    clampCam();
  }
  function clampCam() {
    var m = 2;
    cam.x = U.clamp(cam.x, -m, W.COLS + m);
    cam.y = U.clamp(cam.y, -m, W.ROWS + m);
  }

  /* ---------------- time of day ---------------- */
  /* a game starts at mid-morning rather than in the dark before dawn */
  function dayPhase() { return ((SIM.G.time / DATA.SEASON_LEN) + 0.18) % 1; }
  /* 0 at noon, 1 at midnight */
  function nightAmount() {
    var p = dayPhase();
    if (p < 0.10) return U.lerp(0.85, 0, p / 0.10);
    if (p < 0.62) return 0;
    if (p < 0.80) return U.lerp(0, 1, (p - 0.62) / 0.18);
    return 1;
  }
  /* warmth of the light: 1 at dawn and dusk */
  function goldenAmount() {
    var p = dayPhase();
    if (p < 0.16) return 1 - Math.abs(p - 0.06) / 0.10;
    if (p > 0.52 && p < 0.76) return 1 - Math.abs(p - 0.66) / 0.12;
    return 0;
  }

  /* ---------------- particles ---------------- */
  function smoke(x, y, h) {
    particles.push({ kind: 'smoke', x: x, y: y, h: h, vx: 0.05 + Math.random() * .04, vy: -0.03, vh: 0.28 + Math.random() * .15,
      life: 3 + Math.random() * 2, max: 5, sz: 0.018 + Math.random() * 0.012 });
  }
  function puff(x, y, col, n) {
    for (var i = 0; i < (n || 6); i++) {
      particles.push({ kind: 'puff', col: col || '#d9cdb4', x: x, y: y, h: 0.1,
        vx: (Math.random() - .5) * 1.4, vy: (Math.random() - .5) * 1.4, vh: 0.6 + Math.random() * 1.2,
        life: 0.5 + Math.random() * 0.4, max: 0.9, sz: 0.035 + Math.random() * 0.035 });
    }
  }
  function spark(x, y, h) {
    particles.push({ kind: 'spark', x: x, y: y, h: h, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4,
      vh: 0.8 + Math.random(), life: 0.6 + Math.random() * .5, max: 1.1, sz: 0.012 });
  }
  function floater(x, y, text, col) {
    floaters.push({ x: x, y: y, text: text, col: col || '#f0e2bd', life: 1.6 });
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.h += p.vh * dt;
      if (p.kind === 'smoke') { p.vh *= (1 - dt * .25); p.sz += dt * .022; }
      if (p.kind === 'puff') { p.vh -= dt * 4; if (p.h < 0) { p.h = 0; p.vh = 0; } p.vx *= 0.96; p.vy *= 0.96; }
      if (p.kind === 'spark') p.vh -= dt * 3;
      if (p.life <= 0) particles.splice(i, 1);
    }
    if (particles.length > 500) particles.splice(0, particles.length - 500);
    for (var j = floaters.length - 1; j >= 0; j--) {
      floaters[j].life -= dt;
      if (floaters[j].life <= 0) floaters.splice(j, 1);
    }
  }

  /* weather lives in screen space: it falls past the camera, not the map */
  function updateWeather(dt, season) {
    var rainy = SIM.G && SIM.G.weather === 'rain';
    var kind = season === 'winter' ? 'snow' : rainy ? 'rain' : season === 'autumn' ? 'leaf' : season === 'spring' ? 'petal' : null;
    var rate = kind === 'snow' ? 60 : kind === 'rain' ? 220 : kind === 'leaf' ? 7 : kind === 'petal' ? 6 : 0;
    if (calm) rate *= (kind === 'leaf' || kind === 'petal') ? 0 : 0.3;   // reduce motion
    var n = rate * dt * (cw / 400) * Q[QLEVEL].weather;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n--;
      var x = Math.random() * (cw + 200) - 100;
      if (kind === 'rain') weather.push({ k: 'rain', x: x, y: -20, vx: 60, vy: 900 + Math.random() * 200, life: 2, len: 10 + Math.random() * 8 });
      else if (kind === 'snow') weather.push({ k: 'snow', x: x, y: -10, vx: 10 + Math.random() * 20, vy: 30 + Math.random() * 40, life: 30, r: 1 + Math.random() * 2.2, ph: Math.random() * 6 });
      else if (kind) weather.push({ k: kind, x: x, y: -10, vx: 20 + Math.random() * 30, vy: 40 + Math.random() * 30, life: 30, r: Math.random() * 6, vr: (Math.random() - .5) * 4, ph: Math.random() * 6 });
    }
    for (var i = weather.length - 1; i >= 0; i--) {
      var w = weather[i];
      w.life -= dt;
      w.x += (w.vx + (w.k !== 'rain' ? Math.sin(time * 1.3 + w.ph) * 18 : 0)) * dt;
      w.y += w.vy * dt;
      if (w.r !== undefined && w.vr) w.r += w.vr * dt;
      if (w.y > ch + 20 || w.life <= 0) weather.splice(i, 1);
    }
    if (weather.length > 700) weather.splice(0, weather.length - 700);
  }

  function newCloud(anywhere) {
    return {
      x: anywhere ? Math.random() * (W.COLS + 16) - 8 : -10 - Math.random() * 6,
      y: Math.random() * (W.ROWS + 10) - 5,
      r: 2.5 + Math.random() * 3.5, v: 0.10 + Math.random() * 0.08,
      puffs: [0, 1, 2, 3].map(function () { return [(Math.random() - .5) * 1.4, (Math.random() - .5) * 0.9, 0.5 + Math.random() * 0.5]; })
    };
  }

  /* ---------------- sprites ---------------- */
  function drawSprite(sp, x, y, alpha, scaleMul) {
    var s = toScreen(x, y), k = cam.z / sp.s * (scaleMul || 1);
    if (alpha !== undefined && alpha < 1) g.globalAlpha = alpha;
    g.drawImage(sp.c, s.x - sp.ax * k, s.y - sp.ay * k, sp.c.width * k, sp.c.height * k);
    if (alpha !== undefined && alpha < 1) g.globalAlpha = 1;
  }
  function drawShadow(sp, x, y, scaleMul) {
    if (!sp.sh) return;
    var s = toScreen(x, y), k = cam.z / sp.s * (scaleMul || 1);
    g.drawImage(sp.sh, s.x - sp.ax * k, s.y - sp.ay * k, sp.c.width * k, sp.c.height * k);
  }

  function spriteOf(b, season) {
    return ART.building(b, season);
  }

  /* ---------------- main draw ---------------- */
  function draw(dt) {
    var G = SIM.G;
    if (!G) return;
    time += dt;
    watchFrames(dt);
    var season = SIM.season().key;
    if (season !== lastSeason) {
      if (lastSeason !== null) {
        TERRAIN.setSeason(season);
        // last season's snow and leaves settle rather than hang in the air
        weather.forEach(function (w) { w.life = Math.min(w.life, 1.5 + Math.random() * 2); });
      }
      lastSeason = season;
    }
    TERRAIN.sync();
    TERRAIN.step(TERRAIN.detailed ? 5 : 14);
    updateParticles(dt);
    updateWeather(dt, season);

    var z = cam.z;
    screenTransform();
    g.fillStyle = 'rgb(' + TERRAIN.DEEP.join(',') + ')';
    g.fillRect(0, 0, cw, ch);

    /* ---- 1. the ground ---- */
    if (!DBG.noTerrain) TERRAIN.draw(g, cam, cw, ch, z);

    // visible tile range
    var c1 = toWorld(0, 0), c2 = toWorld(cw, 0), c3 = toWorld(0, ch), c4 = toWorld(cw, ch);
    var x0 = Math.max(0, Math.floor(Math.min(c1.x, c3.x)) - 2), x1 = Math.min(W.COLS - 1, Math.ceil(Math.max(c2.x, c4.x)) + 1);
    var y0 = Math.max(0, Math.floor(Math.min(c1.y, c2.y)) - 2), y1 = Math.min(W.ROWS - 1, Math.ceil(Math.max(c3.y, c4.y)) + 1);
    function onScreen(x, y, pad) {
      var s = toScreen(x, y);
      return s.x > -pad && s.x < cw + pad && s.y > -pad * 0.5 && s.y < ch + pad * 1.6;
    }

    if (!DBG.noWater && Q[QLEVEL].glints) drawWater(x0, x1, y0, y1, z);

    var night = nightAmount(), golden = goldenAmount();
    var sun = 1 - night;

    /* ---- 2. collect everything that stands up ---- */
    var items = [];
    var pad = z * 2.2;
    var misty = typeof EXPLORE !== 'undefined' ? EXPLORE.seen : null;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var t = W.at(x, y);
        if (!t || t.bld) continue;
        if (misty && !misty(x, y)) continue;
        if (t.terr === 'forest' && !DBG.noTrees) {
          if (!onScreen(x + .5, y + .5, pad)) continue;
          W.treesOf(t).forEach(function (tr) { items.push({ k: 'tree', o: tr, d: tr.x + tr.y }); });
        } else if (t.terr === 'rock') {
          if (!onScreen(x + .5, y + .5, pad)) continue;
          W.rocksOf(t).forEach(function (rk) { items.push({ k: 'rock', o: rk, d: rk.x + rk.y }); });
        }
      }
    }
    G.buildings.forEach(function (b) {
      if (b.def.isRoad) return;
      var w = b.def.w || 1, h = b.def.h || 1;
      if (!onScreen(b.x + w / 2, b.y + h / 2, pad * 1.4)) return;
      items.push({ k: 'bld', b: b, d: b.x + b.y + (w + h) / 2 });
    });
    AGENTS.list.forEach(function (a) {
      if (!onScreen(a.x, a.y, 40)) return;
      items.push({ k: 'vil', a: a, d: a.x + a.y + 0.02 });
    });
    AGENTS.animals.forEach(function (a) {
      if (!onScreen(a.x, a.y, 40)) return;
      if (misty && !misty(Math.floor(a.x), Math.floor(a.y))) return;
      items.push({ k: 'ani', a: a, d: a.x + a.y + 0.02 });
    });
    (G.finds || []).forEach(function (f, i) {
      if (misty && !misty(Math.floor(f.x), Math.floor(f.y))) return;
      if (onScreen(f.x, f.y, 40)) items.push({ k: 'find', f: f, d: f.x + f.y });
    });
    if (misty) {
      EXPLORE.sites.forEach(function (st) { if (st.found && onScreen(st.x + .5, st.y + .5, 60)) items.push({ k: 'site', s: st, d: st.x + st.y + 1 }); });
      EXPLORE.scouts.forEach(function (sc) { if (onScreen(sc.x, sc.y, 40)) items.push({ k: 'scout', a: sc, d: sc.x + sc.y + 0.02 }); });
    }
    if (G.ship && onScreen(G.ship.x, G.ship.y, 120)) items.push({ k: 'ship', d: G.ship.x + G.ship.y });
    if (WAR.active) {
      WAR.state.ships.forEach(function (s) { if (onScreen(s.x, s.y, 120)) items.push({ k: 'wship', s: s, d: s.x + s.y }); });
      WAR.state.units.forEach(function (u) { if ((!u.dead || u.fade > 0) && !u.fled && onScreen(u.x, u.y, 40)) items.push({ k: 'war', u: u, d: u.x + u.y + (u.dead ? -0.3 : 0.03) }); });
    }
    items.sort(function (p, q) { return p.d - q.d; });

    /* ---- 3. ground cover: fields, then every shadow ---- */
    G.buildings.forEach(function (b) {
      if (!b.built || !ART.hasField(b)) return;
      var w = b.def.w || 1, h = b.def.h || 1;
      if (!onScreen(b.x + w / 2, b.y + h / 2, pad * 1.4)) return;
      var f = ART.field(b, season, SIM.seasonProgress());
      if (f) drawSprite(f, b.x, b.y);
    });

    if (sun > 0.02) {
      g.globalAlpha = 0.30 * sun + 0.06 * golden;
      // (trees and crags have their shadows painted into the ground)
      items.forEach(function (it) {
        if (it.k === 'bld') {
          var sp = it.b.built ? spriteOf(it.b, season) : ART.scaffold(it.b);
          drawShadow(sp, it.b.x, it.b.y);
        }
      });
      g.globalAlpha = 1;
    }

    /* ---- 4. the world, back to front ---- */
    var wind = Math.sin(time * 0.7) * 0.5 + Math.sin(time * 1.9) * 0.25;
    // trees standing just in front of a building thin out so it can be seen
    var screenT = {};
    G.buildings.forEach(function (b) {
      var w = b.def.w || 1, h = b.def.h || 1;
      for (var oy = 0; oy < h + 2; oy++) for (var ox = 0; ox < w + 2; ox++) {
        if (ox < w && oy < h) continue;
        screenT[(b.x + ox) + ',' + (b.y + oy)] = 1;
      }
    });
    items.forEach(function (it) {
      if (it.k === 'tree') {
        var tr = it.o, sp = ART.tree(tr.kind, season, tr.v);
        var s = toScreen(tr.x, tr.y), k = cam.z / sp.s * tr.s * 0.82;
        var thin = screenT[Math.floor(tr.x) + ',' + Math.floor(tr.y)];
        if (thin) g.globalAlpha = 0.42;
        // trees lean a touch in the wind, from the root
        if (z > 44 && Q[QLEVEL].lean && !calm) {
          var lean = (wind + Math.sin(time * 1.3 + tr.ph) * 0.35) * 0.018;
          g.setTransform(dpr, 0, dpr * lean, dpr, dpr * s.x, dpr * s.y);
          g.drawImage(sp.c, -sp.ax * k, -sp.ay * k, sp.c.width * k, sp.c.height * k);
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
          g.drawImage(sp.c, s.x - sp.ax * k, s.y - sp.ay * k, sp.c.width * k, sp.c.height * k);
        }
        if (thin) g.globalAlpha = 1;
      } else if (it.k === 'rock') {
        drawSprite(ART.rock(it.o.v, season), it.o.x, it.o.y, 1, it.o.s);
      } else if (it.k === 'bld') {
        drawBuilding(it.b, z, night, season);
      } else if (it.k === 'find') {
        drawFind(it.f, z);
      } else if (it.k === 'ship') {
        drawShip(G.ship, z);
      } else if (it.k === 'wship') {
        var ss = toScreen(it.s.x, it.s.y); WAR.drawShip(g, it.s, ss.x, ss.y, z);
      } else if (it.k === 'war') {
        var su = toScreen(it.u.x, it.u.y); WAR.drawUnit(g, it.u, su.x, su.y, z);
      } else if (it.k === 'site') {
        drawSite(it.s, z);
      } else if (it.k === 'scout') {
        var sc = it.a, ss2 = toScreen(sc.x, sc.y);
        AGENTS.draw(g, { x: sc.x, y: sc.y, bob: sc.bob, face: sc.face, path: true, shirt: '#8a3a2a', skin: '#d3a476', hair: '#3a2a22', speed: 1, state: 'scout' }, ss2.x, ss2.y, z);
      } else if (it.k === 'vil') {
        var sp2 = toScreen(it.a.x, it.a.y);
        AGENTS.draw(g, it.a, sp2.x, sp2.y, z);
      } else {
        var sp3 = toScreen(it.a.x, it.a.y);
        AGENTS.drawAnimal(g, it.a, sp3.x, sp3.y, z, season);
      }
    });

    if (WAR.active) WAR.drawShots(g, toScreen, z);

    /* ---- 4b. what each workplace makes, rising off it now and then ---- */
    if (G.speed > 0 && z >= 34) productionPops(dt * G.speed, onScreen);

    /* ---- 5. particles ---- */
    particles.forEach(function (p) {
      var s = toScreen(p.x, p.y);
      var sy = s.y - p.h * z * 0.56;
      if (s.x < -40 || s.x > cw + 40 || sy < -40 || sy > ch + 40) return;
      var sz = p.sz * z;
      if (p.kind === 'smoke') {
        g.globalAlpha = U.clamp(p.life / p.max, 0, 1) * 0.34;
        g.fillStyle = p.dark ? (night > 0.5 ? '#3a3638' : '#4a4644') : night > 0.5 ? '#8a8a96' : '#d8d4cc';
        if (p.dark) g.globalAlpha = Math.min(0.55, g.globalAlpha * 1.8);
        g.beginPath(); g.arc(s.x, sy, sz * 1.6, 0, 6.3); g.fill();
      } else if (p.kind === 'puff') {
        g.globalAlpha = U.clamp(p.life * 2, 0, 1) * 0.85;
        g.fillStyle = p.col;
        g.beginPath(); g.arc(s.x, sy, sz, 0, 6.3); g.fill();
      } else if (p.kind === 'spark') {
        g.globalAlpha = U.clamp(p.life, 0, 1);
        g.fillStyle = '#ffcf6a';
        g.fillRect(s.x, sy, Math.max(1.2, sz * 2), Math.max(1.2, sz * 2));
      }
      g.globalAlpha = 1;
    });

    /* ---- 5b. the mist over land nobody has walked yet ---- */
    if (misty) drawFog(z);

    /* ---- 6. clouds and their shadows ---- */
    if (!DBG.noClouds) drawClouds(dt, z, sun);

    /* ---- 7. light ---- */
    if (!DBG.noGrade) grade(night, golden, season);
    if (night > 0.15) drawLights(night, z);
    drawFireGlow(z);

    /* ---- 8. weather over everything ---- */
    if (!DBG.noWeather) drawWeather();

    /* ---- 9. overlays ---- */
    if (ghost) drawGhost(z);
    if (selected && selected.b) drawSelection(selected.b, z);
    if (selected && selected.t) drawTileSelection(selected.t, z);
    G.buildings.forEach(function (b) { drawBadges(b, z); });

    floaters.forEach(function (f) {
      var s = toScreen(f.x, f.y);
      var rise = (1.6 - f.life) * z * 0.35;
      g.globalAlpha = U.clamp(f.life, 0, 1);
      g.font = '700 ' + (f.small ? Math.max(11, Math.min(15, z * .17)) : Math.max(12, z * .2)).toFixed(0) + 'px -apple-system,system-ui,sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(20,14,8,.8)';
      g.strokeText(f.text, s.x, s.y - rise);
      g.fillStyle = f.col;
      g.fillText(f.text, s.x, s.y - rise);
      g.globalAlpha = 1;
    });
    g.textAlign = 'left';
  }

  /* ---------------- produce you can see ---------------- */
  var POP_COL = { food: '#e8d27a', wood: '#d9b27a', stone: '#d8d4cc', iron: '#b8c0d0', gold: '#f0cd6a',
                  tools: '#c8d0dc', bread: '#f0c890', wool: '#f4f0e6', cloth: '#e8a0c8' };
  var POP_IC = {};
  var rateAt = 0;
  function productionPops(gdt, onScreen) {
    if (!POP_IC.food) DATA.RES.forEach(function (r) { POP_IC[r.key] = r.ic; });
    var fresh = time - rateAt > 0.5;
    if (fresh) rateAt = time;
    var shown = 0;
    SIM.G.buildings.forEach(function (b) {
      if (!b.built || b.paused) return;
      var main = b.def.produces ? Object.keys(b.def.produces)[0] : (b.def.trade && b.id !== 'castle' ? 'gold' : null);
      if (!main) return;
      if (fresh) { var o = SIM.output(b); b._rate = o[main] || 0; }
      if (!(b._rate > 0)) return;
      b._acc = (b._acc || 0) + b._rate * gdt;
      var step = (main === 'iron' || main === 'tools' || main === 'cloth' || main === 'bread' || main === 'wool') ? 1 : 3;
      if (b._acc < step) return;
      var n = Math.floor(b._acc);
      b._acc -= n;
      var cx = b.x + (b.def.w || 1) / 2, cy = b.y + (b.def.h || 1) / 2;
      if (shown > 3 || floaters.length > 10 || !onScreen(cx, cy, 0)) return;
      shown++;
      floaters.push({ x: cx, y: cy, text: '+' + n + ' ' + POP_IC[main], col: POP_COL[main] || '#f0e2bd', life: 1.3, small: true });
    });
  }

  /* ---------------- the sea moves ---------------- */
  function drawWater(x0, x1, y0, y1, z) {
    groundTransform();
    var lw = 1.6 / z, near = U.clamp((z - 20) / 30, 0.15, 1);
    g.lineCap = 'round';
    var buckets = [[], [], [], []];
    for (var y = y0 - 1; y <= y1 + 1; y++) {
      for (var x = x0 - 1; x <= x1 + 1; x++) {
        var t = W.at(x, y);
        var water = !t || t.terr === 'water' || t.terr === 'shore';
        if (!water) continue;
        var h = (x * 928371 + y * 364479) >>> 0;
        for (var i = 0; i < 2; i++) {
          var ph = time * (0.35 + (h % 7) * 0.03) + (h % 628) / 100 + i * 3.1;
          var a = Math.sin(ph);
          if (a < 0.2) continue;
          var px = x + ((h >> (i * 5)) % 100) / 100, py = y + ((h >> (i * 5 + 3)) % 100) / 100;
          px += Math.sin(time * 0.3 + i) * 0.08;
          buckets[Math.min(3, Math.floor((a - 0.2) / 0.2))].push(px, py);
        }
      }
    }
    for (var k = 0; k < 4; k++) {
      var bk = buckets[k];
      if (!bk.length) continue;
      g.strokeStyle = 'rgba(225,240,255,' + ((k * 0.2 + 0.1) * 0.45 * near).toFixed(3) + ')';
      g.lineWidth = lw * (1.3 + k * 0.2);
      g.beginPath();
      for (var j = 0; j < bk.length; j += 2) {
        g.moveTo(bk[j] - 0.16, bk[j + 1] + 0.16);
        g.quadraticCurveTo(bk[j], bk[j + 1] + 0.05, bk[j] + 0.16, bk[j + 1] - 0.16);
      }
      g.stroke();
    }
    screenTransform();
  }

  function drawClouds(dt, z, sun) {
    if (!SIM.G) return;
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.x += c.v * dt; c.y -= c.v * dt * 0.35;
      if (c.x > W.COLS + 12 || c.y < -12) clouds[i] = newCloud(false);
    }
    var season = SIM.season().key;
    var dark = SIM.G.weather === 'rain' ? 0.16 : season === 'winter' ? 0.10 : 0.08;
    groundTransform();
    g.globalAlpha = dark * (0.3 + sun * 0.7);
    g.fillStyle = '#0a1420';
    clouds.forEach(function (c) {
      c.puffs.forEach(function (p) {
        g.beginPath(); g.arc(c.x + p[0] * c.r, c.y + p[1] * c.r, c.r * p[2], 0, 6.3); g.fill();
      });
    });
    g.globalAlpha = 1;
    screenTransform();
    // seen from a distance, the clouds themselves drift over the island
    var far = Q[QLEVEL].clouds ? U.clamp((42 - z) / 18, 0, 1) : 0;
    if (far > 0) {
      clouds.forEach(function (c) {
        var s = toScreen(c.x - 2.2, c.y - 2.2);
        c.puffs.forEach(function (p) {
          var r = c.r * p[2] * z * 0.62;
          var gr = g.createRadialGradient(s.x + p[0] * c.r * z * .5, s.y - 60 + p[1] * c.r * z * .25, 0, s.x + p[0] * c.r * z * .5, s.y - 60 + p[1] * c.r * z * .25, r);
          gr.addColorStop(0, 'rgba(255,255,255,' + (0.55 * far).toFixed(3) + ')');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.beginPath(); g.arc(s.x + p[0] * c.r * z * .5, s.y - 60 + p[1] * c.r * z * .25, r, 0, 6.3); g.fill();
        });
      });
    }
  }

  /* colour grade for the hour and season */
  function grade(night, golden, season) {
    if (golden > 0.01) {
      g.globalCompositeOperation = 'soft-light';
      g.fillStyle = 'rgba(255,150,60,' + (golden * 0.45).toFixed(3) + ')';
      g.fillRect(0, 0, cw, ch);
      g.globalCompositeOperation = 'source-over';
    }
    if (night > 0.01) {
      g.globalCompositeOperation = 'multiply';
      var r = Math.round(255 - 200 * night), gg = Math.round(255 - 180 * night), b = Math.round(255 - 110 * night);
      g.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
      g.fillRect(0, 0, cw, ch);
      g.globalCompositeOperation = 'source-over';
    }
    if (season === 'winter') {
      g.fillStyle = 'rgba(190,210,235,.06)'; g.fillRect(0, 0, cw, ch);
    } else if (SIM.G.weather === 'rain') {
      g.fillStyle = 'rgba(60,70,90,.14)'; g.fillRect(0, 0, cw, ch);
    }
  }

  /* lamplight: windows, forges and braziers glow once the sun is down.
     One glow is drawn once and stamped everywhere, which is far cheaper
     than building a gradient per window per frame. */
  var glowSprite = null;
  function glow() {
    if (glowSprite) return glowSprite;
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,205,125,1)'); gr.addColorStop(0.3, 'rgba(255,150,70,.45)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return (glowSprite = c);
  }
  function drawLights(night, z) {
    var gs = glow();
    g.globalCompositeOperation = 'lighter';
    SIM.G.buildings.forEach(function (b) {
      if (!b.built) return;
      var L = ART.lightsOf(b);
      if (!L) return;
      for (var i = 0; i < L.length; i++) {
        var l = L[i];
        var s = toScreen(b.x + l[0], b.y + l[1]);
        var sy = s.y - l[2] * z * 0.56;
        if (s.x < -80 || s.x > cw + 80 || sy < -80 || sy > ch + 80) continue;
        var flick = 0.85 + Math.sin(time * 7 + b.uid * 3 + i) * 0.08 + Math.sin(time * 13 + i) * 0.05;
        var r = z * (l[3] || 0.5) * 0.55 * flick;
        g.globalAlpha = U.clamp((night - 0.15) * (l[4] || 0.5) * 0.6, 0, 1);
        g.drawImage(gs, s.x - r, sy - r, r * 2, r * 2);
      }
    });
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function drawFireGlow(z) {
    var fires = SIM.burning ? SIM.burning() : [];
    if (!fires.length) return;
    var gs = glow();
    g.globalCompositeOperation = 'lighter';
    fires.forEach(function (b) {
      var s = toScreen(b.x + (b.def.w || 1) / 2, b.y + (b.def.h || 1) / 2);
      var r = z * (1.1 + Math.sin(time * 9 + b.uid) * 0.08) * Math.sqrt(b.def.w || 1);
      g.globalAlpha = 0.55 * b.fire.hp + 0.2;
      g.drawImage(gs, s.x - r, s.y - r * 0.9, r * 2, r * 2);
    });
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function drawWeather() {
    for (var i = 0; i < weather.length; i++) {
      var w = weather[i];
      if (w.k === 'rain') {
        g.strokeStyle = 'rgba(200,215,235,.42)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(w.x, w.y); g.lineTo(w.x - w.len * 0.07, w.y - w.len); g.stroke();
      } else if (w.k === 'snow') {
        g.fillStyle = 'rgba(255,255,255,.9)';
        g.beginPath(); g.arc(w.x, w.y, w.r, 0, 6.3); g.fill();
      } else if (w.k === 'leaf') {
        g.save(); g.translate(w.x, w.y); g.rotate(w.r);
        g.fillStyle = '#c4722e'; g.beginPath(); g.ellipse(0, 0, 4, 2, 0, 0, 6.3); g.fill(); g.restore();
      } else if (w.k === 'petal') {
        g.fillStyle = 'rgba(250,215,225,.9)';
        g.beginPath(); g.ellipse(w.x, w.y, 2.6, 1.5, w.r, 0, 6.3); g.fill();
      }
    }
  }

  /* ---------------- buildings ---------------- */
  function drawBuilding(b, z, night, season) {
    if (!b.built) {
      var sc = ART.scaffold(b);
      // the building itself rises inside its scaffolding, course by course
      var f = U.clamp((b.prog - 0.18) / 0.82, 0, 1);
      if (f > 0) {
        var full = spriteOf(b, season), s0 = toScreen(b.x, b.y), k0 = z / full.s;
        var top0 = s0.y - full.ay * k0, hh = full.c.height * k0;
        var cut = top0 + hh * (1 - f);
        g.save();
        g.beginPath(); g.rect(s0.x - full.ax * k0 - 2, cut, full.c.width * k0 + 4, hh); g.clip();
        g.drawImage(full.c, s0.x - full.ax * k0, top0, full.c.width * k0, hh);
        g.restore();
      }
      drawSprite(sc, b.x, b.y);
      if (Math.random() < 0.04) puff(b.x + (b.def.w || 1) * Math.random(), b.y + (b.def.h || 1) * Math.random(), '#c9b58a', 1);
      return;
    }
    var sp = spriteOf(b, season);
    drawSprite(sp, b.x, b.y);
    // moving parts
    if (b.id === 'windmill') {
      var hub = sp.hub, s = toScreen(b.x, b.y), k = z / sp.s;
      ART.drawSails(g, s.x - sp.ax * k + hub[0] * k, s.y - sp.ay * k + hub[1] * k, z * 0.62,
        time * 0.9 * (SIM.staffRatio(b) > 0 ? 1 : 0.12));
    }
    var chim = sp.chimneys;
    if (chim && chim.length) {
      var active = b.id === 'smith' || b.id === 'bakery' || night > 0.3 || season === 'winter' || season === 'autumn';
      if (active && Math.random() < (b.id === 'smith' || b.id === 'bakery' ? 0.05 : 0.012) * chim.length) {
        var c = chim[Math.floor(Math.random() * chim.length)];
        smoke(b.x + c[0], b.y + c[1], c[2]);
      }
    }
    if (b.id === 'smith' && b.workers > 0 && Math.random() < 0.05) spark(b.x + 0.7, b.y + 0.85, 0.15);
    if (b.fire) drawFire(b, sp, z);
  }

  /* ---------------- fire ---------------- */
  function drawFire(b, sp, z) {
    var f = b.fire, w = b.def.w || 1, h = b.def.h || 1;
    var cx = b.x + w / 2, cy = b.y + h / 2;
    var s = toScreen(cx, cy), top = s.y - (sp.top || 0.8) * z * 0.5;
    var size = z * (0.18 + f.hp * 0.22) * Math.sqrt(w);
    var n = 5 + Math.round(f.hp * 4);
    for (var i = 0; i < n; i++) {
      var ph = time * (7 + i) + i * 2.1 + b.uid;
      var ox = (i / (n - 1) - 0.5) * z * 0.5 * w + Math.sin(ph * 0.7) * z * 0.03;
      var fh = size * (0.7 + 0.45 * Math.sin(ph)) * (1 - Math.abs(i / (n - 1) - 0.5));
      var base = top + z * 0.12 + Math.abs(ox) * 0.25;
      var gr = g.createLinearGradient(0, base, 0, base - fh * 1.6);
      gr.addColorStop(0, 'rgba(255,90,20,.9)'); gr.addColorStop(0.45, 'rgba(255,170,40,.85)'); gr.addColorStop(1, 'rgba(255,240,160,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(s.x + ox - fh * 0.32, base);
      g.quadraticCurveTo(s.x + ox - fh * 0.3, base - fh * 0.9, s.x + ox + Math.sin(ph * 1.3) * fh * 0.2, base - fh * 1.6);
      g.quadraticCurveTo(s.x + ox + fh * 0.3, base - fh * 0.9, s.x + ox + fh * 0.32, base);
      g.closePath(); g.fill();
    }
    if (Math.random() < 0.5) particles.push({ kind: 'smoke', dark: true, x: cx + (Math.random() - .5) * 0.4 * w, y: cy - 0.2, h: (sp.top || 0.8) * 0.9,
      vx: 0.12, vy: -0.05, vh: 0.5 + Math.random() * 0.3, life: 3 + Math.random() * 2, max: 5, sz: 0.05 + Math.random() * 0.03 });
    if (Math.random() < 0.3) spark(cx + (Math.random() - .5) * 0.5, cy, (sp.top || 0.8) * 0.8);
  }

  /* ---------------- flotsam and the merchant cog ---------------- */
  function drawFind(f, z) {
    var s = toScreen(f.x, f.y), u = z / 100;
    var pulse = 0.5 + Math.sin(time * 3 + f.x) * 0.5;
    g.strokeStyle = 'rgba(255,230,140,' + (0.35 + pulse * 0.45).toFixed(2) + ')'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(s.x, s.y, z * (0.26 + pulse * 0.05), z * (0.13 + pulse * 0.025), 0, 0, 6.3); g.stroke();
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(s.x + 3 * u, s.y + 1, 18 * u, 6 * u, 0, 0, 6.3); g.fill();
    if (f.kind === 'drift') {
      // bleached planks and a spar
      g.save(); g.translate(s.x, s.y);
      [[-10, -2, 0.3], [2, 2, -0.2], [-4, -6, 0.1]].forEach(function (p) {
        g.save(); g.translate(p[0] * u, p[1] * u); g.rotate(p[2]);
        g.fillStyle = '#b8a07a'; g.fillRect(-12 * u, -2 * u, 24 * u, 4 * u);
        g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(-12 * u, 1 * u, 24 * u, 1.2 * u);
        g.restore();
      });
      g.restore();
    } else {
      // a stove-in chest and a barrel
      g.fillStyle = '#6b4a2e'; g.fillRect(s.x - 12 * u, s.y - 10 * u, 16 * u, 10 * u);
      g.fillStyle = '#8a6440'; g.fillRect(s.x - 12 * u, s.y - 13 * u, 16 * u, 4 * u);
      g.fillStyle = '#e0b23c'; g.fillRect(s.x - 5 * u, s.y - 8 * u, 3 * u, 3 * u);
      g.fillStyle = '#7a5634'; g.beginPath(); g.ellipse(s.x + 10 * u, s.y - 3 * u, 5 * u, 7 * u, 0.4, 0, 6.3); g.fill();
      g.strokeStyle = '#3d2c1c'; g.lineWidth = 1; g.stroke();
    }
    // a glint to draw the eye
    if (pulse > 0.8) { g.fillStyle = '#fff8d8'; g.fillRect(s.x - 1, s.y - z * 0.22, 2, 2); }
  }
  function drawShip(sh, z) {
    var s = toScreen(sh.x, sh.y), L = z * 0.55;
    var rock = Math.sin(time * 1.2) * 0.04;
    g.save(); g.translate(s.x, s.y); g.rotate(rock);
    g.fillStyle = 'rgba(10,30,50,.3)'; g.beginPath(); g.ellipse(0, 2, L * 0.9, L * 0.22, 0, 0, 6.3); g.fill();
    g.scale(sh.face || 1, 1);
    // hull: a broad cog with raised castles fore and aft
    var hg = g.createLinearGradient(0, -L * 0.35, 0, L * 0.15);
    hg.addColorStop(0, '#8a5a34'); hg.addColorStop(1, '#4a3020');
    g.fillStyle = hg;
    g.beginPath(); g.moveTo(-L * 0.8, -L * 0.28); g.quadraticCurveTo(-L * 0.2, L * 0.2, L * 0.8, -L * 0.3);
    g.lineTo(L * 0.72, -L * 0.45); g.lineTo(-L * 0.75, -L * 0.42); g.closePath(); g.fill();
    g.fillStyle = '#6b4a2e'; g.fillRect(-L * 0.78, -L * 0.62, L * 0.3, L * 0.2); g.fillRect(L * 0.46, -L * 0.6, L * 0.28, L * 0.18);
    g.strokeStyle = 'rgba(255,230,180,.35)'; g.lineWidth = 1;
    for (var i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-L * 0.7, -L * (0.36 - i * 0.07)); g.lineTo(L * 0.7, -L * (0.37 - i * 0.07)); g.stroke(); }
    // mast and a square sail in foreign colours
    g.strokeStyle = '#3d2c1c'; g.lineWidth = Math.max(1.5, L * 0.04);
    g.beginPath(); g.moveTo(0, -L * 0.4); g.lineTo(0, -L * 1.9); g.stroke();
    var billow = Math.sin(time * 2) * L * 0.04;
    g.fillStyle = '#efe4c8';
    g.beginPath(); g.moveTo(-L * 0.45, -L * 1.75); g.lineTo(L * 0.45, -L * 1.75);
    g.quadraticCurveTo(L * 0.55 + billow, -L * 1.2, L * 0.45, -L * 0.75); g.lineTo(-L * 0.45, -L * 0.75);
    g.quadraticCurveTo(-L * 0.35 + billow, -L * 1.2, -L * 0.45, -L * 1.75); g.fill();
    g.fillStyle = '#2f6a5a';
    g.fillRect(-L * 0.45, -L * 1.45, L * 0.9, L * 0.14); g.fillRect(-L * 0.45, -L * 1.12, L * 0.9, L * 0.14);
    g.fillStyle = '#c9402f';
    g.beginPath(); g.moveTo(0, -L * 1.9); g.lineTo(L * 0.3, -L * 1.84); g.lineTo(0, -L * 1.78); g.fill();
    g.restore();
    if (sh.phase === 'anchored' && sh.offers.length) {
      var pulse = 0.5 + Math.sin(time * 3) * 0.5;
      g.fillStyle = 'rgba(24,18,12,.85)';
      ART.rr(g, s.x - 16, s.y - L * 2.3 - 22, 32, 22, 11); g.fill();
      g.strokeStyle = 'rgba(224,178,60,' + (0.5 + pulse * 0.5).toFixed(2) + ')'; g.lineWidth = 2; g.stroke();
      g.font = '14px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText('💰', s.x, s.y - L * 2.3 - 6); g.textAlign = 'left';
    }
  }
  function pickFind(sx, sy) {
    var fs = (SIM.G && SIM.G.finds) || [];
    for (var i = 0; i < fs.length; i++) {
      var s = toScreen(fs[i].x, fs[i].y);
      if (Math.abs(sx - s.x) < Math.max(26, cam.z * 0.35) && Math.abs(sy - (s.y - cam.z * 0.05)) < Math.max(22, cam.z * 0.25)) return i;
    }
    return -1;
  }
  /* mist: once on the ground, once lifted so it swallows what stands in it */
  function drawFog(z) {
    var fc = EXPLORE.fogCanvas();
    if (!fc) return;
    groundTransform();
    g.globalAlpha = 0.93;
    g.drawImage(fc, 0, 0, W.COLS, W.ROWS);
    screenTransform();
    var z0 = cam.z, ox = cw / 2 - (cam.x - cam.y) * z0 / 2, oy = ch / 2 - (cam.x + cam.y) * z0 / 4 - z0 * 0.32;
    g.setTransform(dpr * z0 / 2, dpr * z0 / 4, -dpr * z0 / 2, dpr * z0 / 4, dpr * ox, dpr * oy);
    g.globalAlpha = 0.8;
    g.drawImage(fc, 0, 0, W.COLS, W.ROWS);
    g.globalAlpha = 1;
    screenTransform();
  }

  /* things found on the island, marked where they lie */
  function drawSite(st, z) {
    var s = toScreen(st.x + .5, st.y + .5), u = z / 60;
    g.fillStyle = 'rgba(0,0,0,.22)';
    g.beginPath(); g.ellipse(s.x + 4 * u, s.y + 2 * u, 20 * u, 8 * u, 0, 0, 6.3); g.fill();
    var stone = function (x, y, w, h, c) {
      var gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      gr.addColorStop(0, c || '#b8b2a4'); gr.addColorStop(1, '#6e695e');
      g.fillStyle = gr; g.beginPath();
      g.moveTo(x - w / 2, y); g.lineTo(x - w * 0.42, y - h); g.quadraticCurveTo(x, y - h - w * 0.3, x + w * 0.42, y - h); g.lineTo(x + w / 2, y); g.closePath(); g.fill();
    };
    if (st.k === 'stones') {
      for (var i = 0; i < 7; i++) {
        var a = i / 7 * 6.28, px = s.x + Math.cos(a) * 16 * u, py = s.y + Math.sin(a) * 7 * u;
        stone(px, py, 5 * u, (12 + (i % 3) * 3) * u);
      }
    } else if (st.k === 'ruin') {
      stone(s.x - 8 * u, s.y, 9 * u, 22 * u, '#a39c8c'); stone(s.x + 6 * u, s.y + 3 * u, 8 * u, 12 * u, '#a39c8c');
      g.fillStyle = '#8f8878'; for (var j = 0; j < 5; j++) g.fillRect(s.x - 16 * u + j * 7 * u, s.y + 4 * u + (j % 2) * 2 * u, 5 * u, 3 * u);
      if (!st.done) { g.fillStyle = '#f0cd6a'; g.beginPath(); g.arc(s.x + 12 * u, s.y - 2 * u, 2.2 * u, 0, 6.3); g.fill(); }
    } else if (st.k === 'ore') {
      stone(s.x, s.y, 20 * u, 12 * u, '#9a6a4a');
      g.fillStyle = '#c0603a'; for (var k = 0; k < 6; k++) g.fillRect(s.x - 8 * u + k * 3 * u, s.y - 6 * u - (k % 3) * 2 * u, 2 * u, 2 * u);
    } else if (st.k === 'spring') {
      g.fillStyle = '#8a8272'; g.beginPath(); g.ellipse(s.x, s.y, 15 * u, 7 * u, 0, 0, 6.3); g.fill();
      var wg = g.createRadialGradient(s.x, s.y - 1 * u, 1, s.x, s.y, 12 * u);
      wg.addColorStop(0, '#bfe3f0'); wg.addColorStop(1, '#4f8fb0');
      g.fillStyle = wg; g.beginPath(); g.ellipse(s.x, s.y, 12 * u, 5.2 * u, 0, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(255,255,255,' + (0.4 + Math.sin(time * 3) * 0.2).toFixed(2) + ')'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(s.x, s.y, 5 * u + Math.sin(time * 2) * 2 * u, 2 * u, 0, 0, 6.3); g.stroke();
    } else if (st.k === 'cave') {
      stone(s.x, s.y + 2 * u, 30 * u, 18 * u, '#8f887a');
      g.fillStyle = '#17120e'; g.beginPath(); g.ellipse(s.x, s.y - 3 * u, 7 * u, 8 * u, 0, Math.PI, 0); g.lineTo(s.x + 7 * u, s.y + 2 * u); g.lineTo(s.x - 7 * u, s.y + 2 * u); g.fill();
    }
    if (!st.done && st.k !== 'ore' && st.k !== 'spring') {
      var bob = Math.sin(time * 3) * 2;
      g.fillStyle = 'rgba(24,18,12,.8)'; ART.rr(g, s.x - 9, s.y - 44 * u - 20 + bob, 18, 18, 9); g.fill();
      g.fillStyle = '#f0d98a'; g.font = '700 12px sans-serif'; g.textAlign = 'center'; g.fillText('?', s.x, s.y - 44 * u - 7 + bob); g.textAlign = 'left';
    }
  }
  function pickSite(sx, sy) {
    if (typeof EXPLORE === 'undefined') return null;
    var ss = EXPLORE.sites;
    for (var i = 0; i < ss.length; i++) {
      if (!ss[i].found) continue;
      var s = toScreen(ss[i].x + .5, ss[i].y + .5);
      if (Math.abs(sx - s.x) < Math.max(22, cam.z * 0.4) && sy < s.y + 12 && sy > s.y - Math.max(40, cam.z * 0.9)) return ss[i];
    }
    return null;
  }

  /* the villager under a finger: feet to head, a little generous */
  function pickAgent(sx, sy, tight) {
    var best = null, bd = 1e9, z = cam.z, hh = Math.max(7, z * 0.19), k = tight ? 0.55 : 1;
    AGENTS.list.forEach(function (a) {
      if (a.state === 'asleep' || a.state === 'abed') return;
      var s = toScreen(a.x, a.y), cy = s.y - hh * 0.5;
      var dx = sx - s.x, dy = sy - cy;
      if (Math.abs(dx) > Math.max(13, hh * 0.6) * k || Math.abs(dy) > Math.max(16, hh * 0.8) * k) return;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = a; }
    });
    return best;
  }
  function pickShip(sx, sy) {
    var sh = SIM.G && SIM.G.ship;
    if (!sh || sh.phase !== 'anchored') return false;
    var s = toScreen(sh.x, sh.y), L = cam.z * 0.55;
    return Math.abs(sx - s.x) < Math.max(30, L) && sy < s.y + 12 && sy > s.y - L * 2.6 - 24;
  }

  function drawBadges(b, z) {
    if (!b.built) {
      var s0 = toScreen(b.x + (b.def.w || 1) / 2, b.y + (b.def.h || 1) / 2);
      var bw = z * 0.6, by = s0.y + z * 0.12;
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(s0.x - bw / 2 - 1, by - 1, bw + 2, 5);
      g.fillStyle = '#8fd06a'; g.fillRect(s0.x - bw / 2, by, bw * b.prog, 3);
      return;
    }
    if (typeof FOLK !== 'undefined' && b.def.housing && FOLK.sickAt(b)) drawSickFlag(b, z);
    var jobs = SIM.jobsOf(b);
    var mark = b.paused ? '⏸' : (jobs > 0 && b.workers === 0) ? '!' : null;
    if (!mark || z < 30) return;
    var s = toScreen(b.x + (b.def.w || 1) / 2, b.y + (b.def.h || 1) / 2);
    var sp = spriteOf(b, SIM.season().key);
    var top = s.y - (sp.top || 1) * z * 0.56 - 12;
    var r = Math.max(6.5, Math.min(10, z * 0.08));
    g.fillStyle = mark === '!' ? 'rgba(150,40,26,.82)' : 'rgba(20,16,10,.8)';
    g.beginPath(); g.arc(s.x, top, r, 0, 6.3); g.fill();
    g.strokeStyle = '#f0d98a'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#fff4d0';
    g.font = '700 ' + (r * 1.15).toFixed(0) + 'px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(mark, s.x, top + 1);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }

  /* the old custom: a yellow cloth hung by the door of a fever house */
  function drawSickFlag(b, z) {
    var s = toScreen(b.x + (b.def.w || 1), b.y + (b.def.h || 1) * 0.5);
    var ph = z * 0.36, x = s.x - z * 0.12, y = s.y - z * 0.02;
    g.strokeStyle = '#4a3524'; g.lineWidth = Math.max(1, z * 0.02);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - ph); g.stroke();
    var wave = Math.sin(time * 4 + b.x) * z * 0.015;
    g.fillStyle = b.physic && b.physic > SIM.G.time ? '#e8e2cf' : '#d8c13a';
    g.beginPath(); g.moveTo(x, y - ph); g.quadraticCurveTo(x + z * 0.09, y - ph + wave, x + z * 0.17, y - ph + z * 0.02);
    g.lineTo(x + z * 0.17, y - ph + z * 0.11); g.quadraticCurveTo(x + z * 0.09, y - ph + z * 0.09 + wave, x, y - ph + z * 0.1); g.fill();
    if (z > 40) { g.globalAlpha = 0.18 + Math.sin(time * 2) * 0.05; g.fillStyle = '#b9c77a';
      g.beginPath(); g.ellipse(s.x - z * 0.3, s.y - z * 0.25, z * 0.35, z * 0.16, 0, 0, 6.3); g.fill(); g.globalAlpha = 1; }
  }

  /* a diamond on the ground over a block of tiles */
  function footprintPath(x, y, w, h, inset) {
    inset = inset || 0;
    var a = toScreen(x + inset, y + inset), b = toScreen(x + w - inset, y + inset);
    var c = toScreen(x + w - inset, y + h - inset), d = toScreen(x + inset, y + h - inset);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath();
  }
  function auraRing(cx, cy, r) {
    var s = toScreen(cx, cy);
    g.strokeStyle = 'rgba(240,220,140,.6)';
    g.lineWidth = 2; g.setLineDash([7, 6]);
    g.beginPath(); g.ellipse(s.x, s.y, r * cam.z / Math.SQRT2, r * cam.z / (2 * Math.SQRT2), 0, 0, 6.3); g.stroke();
    g.setLineDash([]);
  }

  function drawGhost(z) {
    var def = ghost.def || DATA.B[ghost.id];
    var wT = def.w || 1, hT = def.h || 1;
    footprintPath(ghost.x, ghost.y, wT, hT, 0.02);
    g.fillStyle = ghost.ok ? 'rgba(125,212,90,.32)' : 'rgba(212,85,58,.38)';
    g.fill();
    g.strokeStyle = ghost.ok ? '#b4f58a' : '#f59a7a'; g.lineWidth = 2.5; g.stroke();
    var sp = ART.building(ghost.b ? { id: ghost.b.id, def: def, level: ghost.b.level, compact: ghost.b.compact } : { id: ghost.id, def: def, level: 1 }, SIM.season().key);
    if (sp) drawSprite(sp, ghost.x, ghost.y, 0.62);
    if (def.radius && def.aura) auraRing(ghost.x + wT / 2, ghost.y + hT / 2, def.radius + .5);
    // what it would make here
    if (ghost.preview) {
      var s = toScreen(ghost.x + wT / 2, ghost.y + hT / 2);
      var top = s.y - (sp && sp.top || 1) * z * 0.56 - 16;
      g.font = '700 13px -apple-system,system-ui,sans-serif';
      g.textAlign = 'center';
      var tw = g.measureText(ghost.preview).width + 16;
      g.fillStyle = 'rgba(24,18,12,.88)';
      ART.rr(g, s.x - tw / 2, top - 15, tw, 22, 11); g.fill();
      g.strokeStyle = ghost.ok ? '#8fd06a' : '#e0795f'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#f4ead0';
      g.fillText(ghost.preview, s.x, top + 1);
      g.textAlign = 'left';
    }
  }

  function drawSelection(b, z) {
    var wT = b.def.w || 1, hT = b.def.h || 1;
    var pulse = 0.55 + Math.sin(time * 4) * 0.25;
    footprintPath(b.x, b.y, wT, hT, -0.04);
    g.strokeStyle = 'rgba(245,215,120,' + pulse.toFixed(2) + ')';
    g.lineWidth = 3; g.stroke();
    if (b.def.radius && b.def.aura) auraRing(b.x + wT / 2, b.y + hT / 2, b.def.radius + .5);
  }
  function drawTileSelection(t, z) {
    var pulse = 0.5 + Math.sin(time * 4) * 0.25;
    footprintPath(t.x, t.y, 1, 1, 0.03);
    g.strokeStyle = 'rgba(245,235,200,' + pulse.toFixed(2) + ')';
    g.lineWidth = 2; g.stroke();
  }

  /* Which building is drawn under a screen point. Tall roofs stand in front
     of the ground behind them, so the tile under a finger is not enough:
     test sprites front to back, down to the painted pixel. */
  var _alpha = null;
  function pickBuilding(sx, sy) {
    if (!SIM.G) return null;
    var season = SIM.season().key, z = cam.z;
    var list = SIM.G.buildings.slice().sort(function (a, b) {
      return (b.x + b.y + ((b.def.w || 1) + (b.def.h || 1)) / 2) - (a.x + a.y + ((a.def.w || 1) + (a.def.h || 1)) / 2);
    });
    if (!_alpha) { var c = document.createElement('canvas'); c.width = c.height = 1; _alpha = c.getContext('2d', { willReadFrequently: true }); }
    for (var i = 0; i < list.length; i++) {
      var b = list[i], sp = b.built ? spriteOf(b, season) : ART.scaffold(b);
      var s = toScreen(b.x, b.y), k = z / sp.s;
      var lx = (sx - (s.x - sp.ax * k)) / k, ly = (sy - (s.y - sp.ay * k)) / k;
      if (lx < 0 || ly < 0 || lx >= sp.c.width || ly >= sp.c.height) continue;
      _alpha.clearRect(0, 0, 1, 1);
      _alpha.drawImage(sp.c, Math.floor(lx), Math.floor(ly), 1, 1, 0, 0, 1, 1);
      if (_alpha.getImageData(0, 0, 1, 1).data[3] > 40) return b;
    }
    return null;
  }

  return {
    init: init, resize: resize, draw: draw, pickBuilding: pickBuilding, pickFind: pickFind, pickShip: pickShip, pickAgent: pickAgent, pickSite: pickSite,
    toScreen: toScreen, toWorld: toWorld, tileAtScreen: tileAtScreen,
    centreOn: centreOn, pan: pan, zoomAt: zoomAt,
    get cam() { return cam; },
    setGhost: function (gh) { ghost = gh; },
    getGhost: function () { return ghost; },
    setSelected: function (s) { selected = s; }, setCalm: function (on) { calm = on; },
    puff: puff, floater: floater, nightAmount: nightAmount, DBG: DBG,
    quality: function () { return QLEVEL; }, qualityPref: function () { return QPREF; }, setQuality: setQuality,
    set onQuality(f) { onQuality = f; },
    get size() { return { w: cw, h: ch }; }
  };
})();
