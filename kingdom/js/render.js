/* ============================================================
   render.js — camera, world drawing, weather, day/night
   ============================================================ */
var RENDER = (function () {
  'use strict';

  var cv, g, cw = 0, ch = 0, dpr = 1;
  var cam = { x: 14, y: 14, z: 44, tz: 44 };
  var MINZ = 20, MAXZ = 120;
  var ghost = null;        // {id,x,y,ok,why}
  var selected = null;     // building or tile
  var particles = [];
  var floaters = [];       // "+5 gold" popups
  var time = 0;

  function init(canvas) {
    cv = canvas; g = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = cv.clientWidth; ch = cv.clientHeight;
    cv.width = Math.floor(cw * dpr); cv.height = Math.floor(ch * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function toScreen(wx, wy) {
    return { x: (wx - cam.x) * cam.z + cw / 2, y: (wy - cam.y) * cam.z + ch / 2 };
  }
  function toWorld(sx, sy) {
    return { x: (sx - cw / 2) / cam.z + cam.x, y: (sy - ch / 2) / cam.z + cam.y };
  }
  function tileAtScreen(sx, sy) {
    var w = toWorld(sx, sy);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }
  function centreOn(x, y) { cam.x = x + .5; cam.y = y + .5; }
  function pan(dx, dy) {
    cam.x -= dx / cam.z; cam.y -= dy / cam.z;
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
    var m = 3;
    cam.x = U.clamp(cam.x, -m, W.COLS + m);
    cam.y = U.clamp(cam.y, -m, W.ROWS + m);
  }

  /* ---------------- day / night ---------------- */
  function dayPhase() {
    // one full day per season
    return (SIM.G.time % DATA.SEASON_LEN) / DATA.SEASON_LEN;
  }
  function nightAmount() {
    var p = dayPhase();
    // dawn .0-.12, day .12-.62, dusk .62-.78, night .78-1
    if (p < 0.10) return U.lerp(0.55, 0, p / 0.10);
    if (p < 0.60) return 0;
    if (p < 0.76) return U.lerp(0, 0.62, (p - 0.60) / 0.16);
    return 0.62;
  }

  /* ---------------- particles ---------------- */
  function spawnWeather(dt) {
    var s = SIM.season().key;
    var rate = s === 'winter' ? 26 : s === 'autumn' ? 9 : s === 'spring' ? 7 : 2;
    var n = rate * dt;
    while (n > 0) {
      if (n < 1 && Math.random() > n) break;
      n--;
      var w = toWorld(Math.random() * cw, -20);
      particles.push({
        kind: s === 'winter' ? 'snow' : s === 'autumn' ? 'leaf' : s === 'spring' ? 'petal' : 'dust',
        x: w.x, y: w.y, vx: (Math.random() - .5) * .5 + .25, vy: 0.6 + Math.random() * 0.9,
        r: Math.random() * 6.28, vr: (Math.random() - .5) * 3,
        life: 6 + Math.random() * 5, sz: 0.05 + Math.random() * 0.06
      });
    }
  }
  function smoke(x, y) {
    particles.push({
      kind: 'smoke', x: x, y: y, vx: (Math.random() - .3) * .12, vy: -0.28 - Math.random() * .2,
      life: 2.4 + Math.random() * 1.6, sz: 0.08 + Math.random() * 0.05, r: 0, vr: 0
    });
  }
  function puff(x, y, col, n) {
    for (var i = 0; i < (n || 6); i++) {
      particles.push({
        kind: 'puff', col: col || '#d9cdb4', x: x, y: y,
        vx: (Math.random() - .5) * 1.6, vy: -0.4 - Math.random() * 1.2,
        life: 0.5 + Math.random() * 0.4, sz: 0.05 + Math.random() * 0.05, r: 0, vr: 0
      });
    }
  }
  function floater(x, y, text, col) {
    floaters.push({ x: x, y: y, text: text, col: col || '#f0e2bd', life: 1.5 });
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      if (p.kind === 'smoke') { p.vy *= (1 - dt * .5); p.sz += dt * .05; }
      if (p.kind === 'puff') p.vy += dt * 3;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (var j = floaters.length - 1; j >= 0; j--) {
      floaters[j].life -= dt;
      floaters[j].y -= dt * 0.7;
      if (floaters[j].life <= 0) floaters.splice(j, 1);
    }
    if (particles.length > 420) particles.splice(0, particles.length - 420);
  }

  /* ---------------- roads ---------------- */
  function drawRoad(t, sx, sy, z) {
    var n = W.at(t.x, t.y - 1), so = W.at(t.x, t.y + 1);
    var e = W.at(t.x + 1, t.y), we = W.at(t.x - 1, t.y);
    var hN = !!(n && n.road), hS = !!(so && so.road), hE = !!(e && e.road), hW = !!(we && we.road);
    var cx = sx + z / 2, cy = sy + z / 2, wd = z * 0.48, half = wd / 2;

    // shadowed rut under the path
    g.fillStyle = 'rgba(60,46,26,.22)';
    g.beginPath(); g.arc(cx, cy + z * .03, half + z * .05, 0, 6.3); g.fill();

    g.fillStyle = '#ab9268';
    g.beginPath(); g.arc(cx, cy, half, 0, 6.3); g.fill();
    if (hN) g.fillRect(cx - half, sy - 1, wd, z / 2 + 2);
    if (hS) g.fillRect(cx - half, cy, wd, z / 2 + 2);
    if (hE) g.fillRect(cx, cy - half, z / 2 + 2, wd);
    if (hW) g.fillRect(sx - 1, cy - half, z / 2 + 2, wd);

    // gravel — stable per tile so it doesn't crawl between frames
    g.fillStyle = 'rgba(122,98,60,.5)';
    for (var i = 0; i < 5; i++) {
      var a = ((t.x * 37 + t.y * 71 + i * 53) % 100) / 100;
      var b = ((t.x * 17 + t.y * 43 + i * 29) % 100) / 100;
      g.fillRect(cx - half + a * wd * .85, cy - half + b * wd * .85, z * .06, z * .045);
    }
  }

  /* ---------------- main draw ---------------- */
  function draw(dt) {
    var G = SIM.G;
    if (!G) return;
    time += dt;
    updateParticles(dt);
    spawnWeather(dt);

    var z = cam.z;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = '#1f3550';
    g.fillRect(0, 0, cw, ch);

    var x0 = Math.max(0, Math.floor(cam.x - cw / 2 / z) - 1);
    var x1 = Math.min(W.COLS - 1, Math.ceil(cam.x + cw / 2 / z) + 1);
    var y0 = Math.max(0, Math.floor(cam.y - ch / 2 / z) - 1);
    var y1 = Math.min(W.ROWS - 1, Math.ceil(cam.y + ch / 2 / z) + 2);

    var season = SIM.season().key;

    /* ---- 1. terrain ---- */
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var t = W.at(x, y);
        if (!t) continue;
        var s = toScreen(x, y);
        var img = ART.tiles[t.terr][t.v];
        g.drawImage(img, s.x, s.y, z + 1, z + 1);
        if (t.terr === 'water' || t.terr === 'shore') {
          var shimmer = Math.sin(time * 1.6 + x * .8 + y * 1.3);
          if (shimmer > 0.75) {
            g.fillStyle = 'rgba(255,255,255,' + ((shimmer - .75) * .5).toFixed(3) + ')';
            g.fillRect(s.x + z * .2, s.y + z * .4, z * .35, z * .06);
          }
        }
        if (season === 'winter' && t.terr !== 'water' && t.terr !== 'shore') {
          g.fillStyle = 'rgba(230,238,250,.30)';
          g.fillRect(s.x, s.y, z + 1, z + 1);
        }
        if (t.road) drawRoad(t, s.x, s.y, z);
      }
    }

    /* ---- 2. sortable layer: decor, buildings, villagers ---- */
    var items = [];
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        var t2 = W.at(x, y);
        if (!t2) continue;
        if (t2.terr === 'forest' && !t2.bld) items.push({ k: 'tree', t: t2, sy: y + 0.9 });
      }
    }
    G.buildings.forEach(function (b) {
      if (b.def.isRoad) return;
      if (b.x < x0 - 2 || b.x > x1 + 2 || b.y < y0 - 2 || b.y > y1 + 3) return;
      items.push({ k: 'bld', b: b, sy: b.y + (b.def.h || 1) - 0.02 });
    });
    AGENTS.list.forEach(function (a) {
      if (a.x < x0 - 1 || a.x > x1 + 1 || a.y < y0 - 1 || a.y > y1 + 2) return;
      items.push({ k: 'vil', a: a, sy: a.y });
    });
    items.sort(function (p, q) { return p.sy - q.sy; });

    var night = nightAmount();

    items.forEach(function (it) {
      if (it.k === 'tree') {
        var s = toScreen(it.t.x, it.t.y);
        var img = ART.trees[season][it.t.tree];
        var sz = z * 1.05;
        g.drawImage(img, s.x + z * .5 - sz / 2 + it.t.jitter * z / 90,
                    s.y + z - sz * .96 + it.t.jitter2 * z / 160, sz, sz);
      } else if (it.k === 'bld') {
        drawBuilding(it.b, z, night);
      } else {
        var sp = toScreen(it.a.x, it.a.y);
        AGENTS.draw(g, it.a, sp.x, sp.y, z);
      }
    });

    /* ---- 3. particles ---- */
    particles.forEach(function (p) {
      var s = toScreen(p.x, p.y);
      if (s.x < -40 || s.x > cw + 40 || s.y < -40 || s.y > ch + 40) return;
      var sz = p.sz * z;
      if (p.kind === 'snow') {
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.beginPath(); g.arc(s.x, s.y, sz * .5, 0, 6.3); g.fill();
      } else if (p.kind === 'leaf') {
        g.save(); g.translate(s.x, s.y); g.rotate(p.r);
        g.fillStyle = '#c47f36'; g.fillRect(-sz * .5, -sz * .3, sz, sz * .6); g.restore();
      } else if (p.kind === 'petal') {
        g.fillStyle = 'rgba(245,205,215,.9)';
        g.beginPath(); g.ellipse(s.x, s.y, sz * .55, sz * .3, p.r, 0, 6.3); g.fill();
      } else if (p.kind === 'dust') {
        g.fillStyle = 'rgba(255,240,200,.35)';
        g.fillRect(s.x, s.y, sz * .4, sz * .4);
      } else if (p.kind === 'smoke') {
        g.globalAlpha = U.clamp(p.life / 4, 0, .26);
        g.fillStyle = '#d8d2c6';
        g.beginPath(); g.arc(s.x, s.y, sz * 1.7, 0, 6.3); g.fill();
        g.globalAlpha = 1;
      } else if (p.kind === 'puff') {
        g.globalAlpha = U.clamp(p.life * 2, 0, 1);
        g.fillStyle = p.col;
        g.fillRect(s.x, s.y, sz * .6, sz * .6);
        g.globalAlpha = 1;
      }
    });

    /* ---- 4. tint: night + season ---- */
    if (night > 0.01) {
      g.fillStyle = 'rgba(18,26,58,' + (night * 0.62).toFixed(3) + ')';
      g.fillRect(0, 0, cw, ch);
    }
    var st = DATA.SEASONS[SIM.seasonIndex() % 4].tint;
    g.fillStyle = 'rgba(' + st[0] + ',' + st[1] + ',' + st[2] + ',' + st[3] + ')';
    g.fillRect(0, 0, cw, ch);

    /* ---- 5. overlays: ghost, selection, floaters ---- */
    if (ghost) drawGhost(z);
    if (selected && selected.b) drawSelection(selected.b, z);

    floaters.forEach(function (f) {
      var s = toScreen(f.x, f.y);
      g.globalAlpha = U.clamp(f.life, 0, 1);
      g.font = '600 ' + Math.max(11, z * .26).toFixed(0) + 'px -apple-system,system-ui,sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.65)';
      g.strokeText(f.text, s.x, s.y);
      g.fillStyle = f.col;
      g.fillText(f.text, s.x, s.y);
      g.globalAlpha = 1;
    });
    g.textAlign = 'left';
  }

  function drawBuilding(b, z, night) {
    var art = ART.bld[b.id];
    if (!art) return;
    var wTiles = b.def.w || 1, hTiles = b.def.h || 1;
    var s = toScreen(b.x, b.y);
    var scale = z / ART.T;
    var dw = art.w * scale, dh = art.h * scale;
    var px = s.x + (wTiles * z) / 2 - dw / 2;
    var py = s.y + hTiles * z - dh;

    if (!b.built) {
      var sc = ART.scaffold();
      g.globalAlpha = 0.95;
      g.drawImage(sc, px + (dw - ART.BW * scale) / 2, s.y + hTiles * z - ART.BH * scale,
                  ART.BW * scale, ART.BH * scale);
      g.globalAlpha = 1;
      // ghosted preview of what is coming
      g.globalAlpha = 0.22 + b.prog * 0.35;
      g.drawImage(art.c, px, py, dw, dh);
      g.globalAlpha = 1;
      // progress bar
      var bw = z * 0.7, bx = s.x + (wTiles * z - bw) / 2, by = s.y + hTiles * z + 2;
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(bx - 1, by - 1, bw + 2, 5);
      g.fillStyle = '#8fd06a'; g.fillRect(bx, by, bw * b.prog, 3);
      if (Math.random() < 0.03) puff(b.x + 0.5, b.y + 0.4, '#c9b58a', 1);
      return;
    }

    g.drawImage(art.c, px, py, dw, dh);

    // farms show a growing field under them
    if (b.id === 'farm') { /* field drawn below in pass? keep simple: crop patch beside */ }

    if (b.id === 'windmill') {
      ART.drawSails(g, px + dw / 2, py + dh * 0.115, z * 0.42, time * 1.1 * (SIM.staffRatio(b) > 0 ? 1 : 0.15));
    }
    // chimney smoke from homes and workshops at night / winter
    var smokey = b.id === 'house' || b.id === 'manor' || b.id === 'smith' || b.id === 'tavern';
    if (smokey && (b.uid % 3 === 0) && (night > 0.2 || SIM.season().key === 'winter') && Math.random() < 0.006) {
      smoke(b.x + 0.7, b.y + 0.25);
    }
    // a warm spill of lamplight from the windows after dusk
    if (night > 0.25 && b.id !== 'wall' && b.id !== 'well') {
      var gx = px + dw / 2, gy = py + dh * 0.74, gr = z * 0.30;
      var grad = g.createRadialGradient(gx, gy, 0, gx, gy, gr);
      grad.addColorStop(0, 'rgba(255,205,110,' + (night * 0.34).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,190,90,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(gx, gy, gr, 0, 6.3); g.fill();
    }
    // unstaffed / paused warning
    var jobs = SIM.jobsOf(b);
    if (b.paused) badge(s.x + wTiles * z / 2, py + 2, '⏸');
    else if (jobs > 0 && b.workers === 0) badge(s.x + wTiles * z / 2, py + 2, '⚠');
  }

  function badge(x, y, ch2) {
    var r = Math.max(7, cam.z * 0.15);
    g.fillStyle = 'rgba(20,16,10,.8)';
    g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
    g.strokeStyle = '#e0b23c'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#f0d98a';
    g.font = (r * 1.1).toFixed(0) + 'px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch2, x, y + 1);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }

  function drawGhost(z) {
    var def = DATA.B[ghost.id];
    var wT = def.w || 1, hT = def.h || 1;
    var s = toScreen(ghost.x, ghost.y);
    g.globalAlpha = 0.35;
    g.fillStyle = ghost.ok ? '#7dd45a' : '#d4553a';
    g.fillRect(s.x, s.y, wT * z, hT * z);
    g.globalAlpha = 1;
    g.strokeStyle = ghost.ok ? '#a8f07a' : '#f08a6a';
    g.lineWidth = 2.5;
    g.strokeRect(s.x + 1, s.y + 1, wT * z - 2, hT * z - 2);

    var art = ART.bld[ghost.id];
    if (art && !def.isRoad) {
      var scale = z / ART.T, dw = art.w * scale, dh = art.h * scale;
      g.globalAlpha = 0.62;
      g.drawImage(art.c, s.x + (wT * z) / 2 - dw / 2, s.y + hT * z - dh, dw, dh);
      g.globalAlpha = 1;
    }
    // show the aura / requirement radius
    if (def.radius) {
      g.strokeStyle = 'rgba(240,220,140,.55)';
      g.lineWidth = 2; g.setLineDash([6, 5]);
      g.beginPath();
      g.arc(s.x + wT * z / 2, s.y + hT * z / 2, (def.radius + .5) * z, 0, 6.3);
      g.stroke(); g.setLineDash([]);
    }
  }

  function drawSelection(b, z) {
    var wT = b.def.w || 1, hT = b.def.h || 1;
    var s = toScreen(b.x, b.y);
    var pulse = 0.55 + Math.sin(time * 4) * 0.2;
    g.strokeStyle = 'rgba(240,210,120,' + pulse.toFixed(2) + ')';
    g.lineWidth = 3;
    g.strokeRect(s.x + 1, s.y + 1, wT * z - 2, hT * z - 2);
    if (b.def.radius) {
      g.strokeStyle = 'rgba(240,220,140,.4)';
      g.setLineDash([6, 5]); g.lineWidth = 2;
      g.beginPath(); g.arc(s.x + wT * z / 2, s.y + hT * z / 2, (b.def.radius + .5) * z, 0, 6.3);
      g.stroke(); g.setLineDash([]);
    }
  }

  return {
    init: init, resize: resize, draw: draw,
    toScreen: toScreen, toWorld: toWorld, tileAtScreen: tileAtScreen,
    centreOn: centreOn, pan: pan, zoomAt: zoomAt,
    get cam() { return cam; },
    setGhost: function (gh) { ghost = gh; },
    getGhost: function () { return ghost; },
    setSelected: function (s) { selected = s; },
    puff: puff, floater: floater,
    get size() { return { w: cw, h: ch }; }
  };
})();
