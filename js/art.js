/* ============================================================
   art.js — every sprite is drawn in code, in 3D, and baked.
   No image files, nothing to download.

   Buildings are built from lit volumes: boxes, gabled and hipped
   roofs, towers, cones. Each face is painted in its own flat
   coordinate system (planks, stone courses, thatch, clay tiles,
   windows and doors), then skewed into place, so detail always
   sits on the wall it belongs to. Light comes low from the west:
   west-facing faces are bright, east-facing ones in shade. Every
   volume also drops a true shadow into a separate layer, so
   shadows fall on the ground and never across another sprite.
   ============================================================ */
var ART = (function () {
  'use strict';

  var SPX = 128;            // sprite px per tile width
  var UPR = 0.56;           // screen height of one unit of height, per tile width
  var SUN = norm3([-0.8, 0.5, 1.0]);
  var SHU = 0.62, SHV = -0.30; // where the shadow of one unit of height lands

  /* ---------------- colour ---------------- */
  var _hex = {};
  function rgbOf(h) {
    if (_hex[h]) return _hex[h];
    var n = parseInt(h.slice(1), 16);
    return (_hex[h] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
  }
  function col(h, f, a) {
    var c = rgbOf(h);
    f = f === undefined ? 1 : f;
    var r = Math.min(255, Math.round(c[0] * f)), g = Math.min(255, Math.round(c[1] * f)), b = Math.min(255, Math.round(c[2] * f));
    return a === undefined ? 'rgb(' + r + ',' + g + ',' + b + ')' : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  var C = {
    plaster: '#e2d4b4', plasterW: '#efe6d0', timber: '#4e3826', wood: '#8a6440', woodD: '#5b4029', woodL: '#a98256',
    stone: '#9c9486', stoneL: '#bdb5a5', stoneD: '#6f685c', brick: '#a45a40', thatch: '#c49c58', clay: '#b1563c',
    slate: '#5f6874', shingle: '#7c5c3e', glass: '#2e3f52', gold: '#e0b23c', red: '#a8382a', blue: '#2f5c96',
    banner: '#e0b23c', banner2: '#a8382a',
    iron: '#4a4d55', snow: '#eef2f7', dark: '#221a12', hay: '#d7b965', cloth1: '#b8453a', cloth2: '#3f6ea5', cloth3: '#d8b64a'
  };

  /* ---------------- vector helpers ---------------- */
  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function light(n) { n = norm3(n); return 0.60 + 0.55 * Math.max(0, dot(n, SUN)); }

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  /* ---------------- a sprite under construction ----------------
     w, h: footprint in tiles. maxH: tallest point in height units.
     e: extra margin in tiles (for things that reach past the plot). */
  function Sprite(w, h, maxH, e, seedKey) {
    e = e || 0;
    var S = SPX, UP = S * UPR;
    var shR = maxH * (SHU - SHV) * S / 2 + 8, shB = Math.max(0, maxH * (SHU + SHV) * S / 4) + 6;
    var padL = 8 + e * S / 2, padR = Math.max(10, shR) + e * S / 2;
    var padT = 12 + e * S / 4, padB = Math.max(8, shB) + e * S / 4;
    var cw = (w + h) * S / 2 + padL + padR;
    var chh = maxH * UP + (w + h) * S / 4 + padT + padB;
    var c = canvas(cw, chh), sh = canvas(cw, chh);
    return {
      c: c, sh: sh, g: c.getContext('2d'), sg: sh.getContext('2d'),
      s: S, UP: UP, ax: padL + h * S / 2, ay: padT + maxH * UP, w: w, h: h, top: maxH,
      lights: [], chimneys: [], rnd: U.mulberry(hashStr(seedKey || 'x'))
    };
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function P(sp, u, v, w) { return { x: sp.ax + (u - v) * sp.s / 2, y: sp.ay + (u + v) * sp.s / 4 - w * sp.UP }; }
  function proj(sp, d) { return { x: (d[0] - d[1]) * sp.s / 2, y: (d[0] + d[1]) * sp.s / 4 - d[2] * sp.UP }; }

  /* ---------------- shadows ---------------- */
  function hull(pts) {
    pts = pts.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    if (pts.length < 3) return pts;
    function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  /* cast a shadow from a set of 3D points (their convex hull on the ground) */
  function shadow(sp, pts3) {
    var pts = pts3.map(function (p) { return P(sp, p[0] + SHU * p[2], p[1] + SHV * p[2], 0); });
    var hl = hull(pts);
    if (hl.length < 3) return;
    var g = sp.sg;
    g.fillStyle = '#000';
    g.beginPath(); g.moveTo(hl[0].x, hl[0].y);
    for (var i = 1; i < hl.length; i++) g.lineTo(hl[i].x, hl[i].y);
    g.closePath(); g.fill();
  }
  function boxPts(u0, v0, u1, v1, w0, w1) {
    return [[u0, v0, w0], [u1, v0, w0], [u1, v1, w0], [u0, v1, w0], [u0, v0, w1], [u1, v0, w1], [u1, v1, w1], [u0, v1, w1]];
  }

  /* ---------------- painting a flat face ----------------
     o: 3D origin (the face's top-left as seen), A: 3D edge along local x,
     B: 3D edge along local y (downwards on walls). Local units are 100 per
     tile or unit of height, so a painter can think in plain numbers. */
  function plane(sp, o, A, B, n, paint, clipPts) {
    var g = sp.g, p0 = P(sp, o[0], o[1], o[2]), pa = proj(sp, A), pb = proj(sp, B);
    var lx = Math.hypot(A[0], A[1], A[2]) * 100, ly = Math.hypot(B[0], B[1], B[2]) * 100;
    if (lx < 0.5 || ly < 0.5) return;
    g.save();
    g.setTransform(pa.x / lx, pa.y / lx, pb.x / ly, pb.y / ly, p0.x, p0.y);
    g.beginPath();
    if (clipPts) {
      g.moveTo(clipPts[0][0], clipPts[0][1]);
      for (var i = 1; i < clipPts.length; i++) g.lineTo(clipPts[i][0], clipPts[i][1]);
      g.closePath();
    } else g.rect(0, 0, lx, ly);
    g.clip();
    var F = {
      sp: sp,
      at: function (x, y) {
        return [o[0] + A[0] * x / lx + B[0] * y / ly, o[1] + A[1] * x / lx + B[1] * y / ly, o[2] + A[2] * x / lx + B[2] * y / ly];
      },
      lamp: function (x, y, r, s) { var q = F.at(x, y); sp.lights.push([q[0], q[1], q[2], r || 0.5, s || 0.5]); }
    };
    paint(g, lx, ly, light(n), F);
    g.restore();
  }

  /* the three visible faces of a box */
  function faceLeft(sp, u0, u1, v, w0, w1, paint) {    // the +v face, lit
    plane(sp, [u0, v, w1], [u1 - u0, 0, 0], [0, 0, w0 - w1], [0, 1, 0], paint);
  }
  function faceRight(sp, u, v0, v1, w0, w1, paint) {   // the +u face, in shade
    plane(sp, [u, v1, w1], [0, v0 - v1, 0], [0, 0, w0 - w1], [1, 0, 0], paint);
  }
  function faceTop(sp, u0, v0, u1, v1, w, paint) {
    plane(sp, [u0, v0, w], [u1 - u0, 0, 0], [0, v1 - v0, 0], [0, 0, 1], paint);
  }
  function box(sp, u0, v0, u1, v1, w0, w1, left, right, top) {
    shadow(sp, boxPts(u0, v0, u1, v1, w0, w1));
    faceLeft(sp, u0, u1, v1, w0, w1, left);
    faceRight(sp, u1, v0, v1, w0, w1, right || left);
    if (top !== false) faceTop(sp, u0, v0, u1, v1, w1, top || flat(C.stoneD));
    edgeLines(sp, u0, v0, u1, v1, w0, w1);
  }
  /* a crisp dark line down the corner and along the eave gives volumes their edge */
  function edgeLines(sp, u0, v0, u1, v1, w0, w1) {
    var g = sp.g, a = P(sp, u1, v1, w0), b = P(sp, u1, v1, w1);
    g.strokeStyle = 'rgba(20,14,8,.35)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }

  /* ---------------- wall painters ---------------- */
  function flat(h, v) {
    return function (g, W, H, L) { g.fillStyle = col(h, L * (v || 1)); g.fillRect(0, 0, W, H); };
  }
  function ao(g, W, H) {
    var gr = g.createLinearGradient(0, H - 22, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.28)');
    g.fillStyle = gr; g.fillRect(0, H - 22, W, 22);
  }
  function eaveShade(g, W) {
    var gr = g.createLinearGradient(0, 0, 0, 10);
    gr.addColorStop(0, 'rgba(0,0,0,.30)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, 10);
  }
  function blotch(g, W, H, rnd, n, a) {
    for (var i = 0; i < n; i++) {
      g.fillStyle = rnd() > .5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(60,40,20,' + a + ')';
      g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 4 + rnd() * 10, 3 + rnd() * 6, 0, 0, 6.3); g.fill();
    }
  }

  function plasterWall(opts) {
    opts = opts || {};
    return function (g, W, H, L, F) {
      var r = F.sp.rnd;
      g.fillStyle = col(opts.col || C.plaster, L); g.fillRect(0, 0, W, H);
      blotch(g, W, H, r, Math.ceil(W * H / 900), 0.06);
      if (opts.timber) {
        g.fillStyle = col(C.timber, L);
        g.fillRect(0, 0, 4, H); g.fillRect(W - 4, 0, 4, H);
        g.fillRect(0, 0, W, 3.5); g.fillRect(0, H - 4, W, 4);
        var bays = Math.max(1, Math.round(W / 34));
        for (var i = 1; i < bays; i++) g.fillRect(i * W / bays - 2, 0, 4, H);
        if (H > 36) {
          g.fillRect(0, H * 0.5 - 2, W, 3.5);
          g.lineWidth = 3; g.strokeStyle = col(C.timber, L);
          for (var j = 0; j < bays; j++) {
            if ((j + (opts.flip ? 1 : 0)) % 2) continue;
            g.beginPath(); g.moveTo(j * W / bays + 3, H * 0.5); g.lineTo((j + 1) * W / bays - 3, 3); g.stroke();
          }
        }
      }
      eaveShade(g, W); ao(g, W, H);
      if (opts.deco) opts.deco(g, W, H, L, F);
    };
  }
  function stoneWall(opts) {
    opts = opts || {};
    return function (g, W, H, L, F) {
      var r = F.sp.rnd, base = opts.col || C.stone, rh = opts.course || 10;
      g.fillStyle = col(base, L * 0.72); g.fillRect(0, 0, W, H);
      for (var y = 0, row = 0; y < H; y += rh, row++) {
        var x = row % 2 ? -8 : 0;
        while (x < W) {
          var bw = (opts.ashlar ? 22 : 12 + r() * 14);
          g.fillStyle = col(base, L * (0.9 + r() * 0.2));
          g.fillRect(x + 0.9, y + 0.9, bw - 1.8, rh - 1.8);
          g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x + 0.9, y + 0.9, bw - 1.8, 1.4);
          x += bw;
        }
      }
      eaveShade(g, W); ao(g, W, H);
      if (opts.deco) opts.deco(g, W, H, L, F);
    };
  }
  function brickWall(opts) {
    opts = opts || {};
    return function (g, W, H, L, F) {
      var r = F.sp.rnd;
      g.fillStyle = col('#c9b89a', L * 0.8); g.fillRect(0, 0, W, H);
      for (var y = 0, row = 0; y < H; y += 5.5, row++) {
        for (var x = row % 2 ? -6 : 0; x < W; x += 12) {
          g.fillStyle = col(C.brick, L * (0.85 + r() * 0.25));
          g.fillRect(x + 0.7, y + 0.7, 10.6, 4.1);
        }
      }
      eaveShade(g, W); ao(g, W, H);
      if (opts.deco) opts.deco(g, W, H, L, F);
    };
  }
  function plankWall(opts) {
    opts = opts || {};
    return function (g, W, H, L, F) {
      var r = F.sp.rnd, base = opts.col || C.wood;
      for (var x = 0; x < W; x += 8) {
        g.fillStyle = col(base, L * (0.86 + r() * 0.24));
        g.fillRect(x, 0, 8, H);
        g.fillStyle = 'rgba(20,12,6,.45)'; g.fillRect(x + 7.2, 0, 0.9, H);
      }
      eaveShade(g, W); ao(g, W, H);
      if (opts.deco) opts.deco(g, W, H, L, F);
    };
  }
  function logWall(opts) {
    opts = opts || {};
    return function (g, W, H, L, F) {
      var r = F.sp.rnd;
      for (var y = 0; y < H; y += 8) {
        var gr = g.createLinearGradient(0, y, 0, y + 8);
        var f = 0.9 + r() * 0.2;
        gr.addColorStop(0, col(C.woodL, L * f)); gr.addColorStop(0.6, col(C.wood, L * f)); gr.addColorStop(1, col(C.woodD, L * f));
        g.fillStyle = gr; g.fillRect(0, y, W, 8);
      }
      eaveShade(g, W); ao(g, W, H);
      if (opts.deco) opts.deco(g, W, H, L, F);
    };
  }

  /* ---------------- windows and doors, painted onto a face ---------------- */
  function win(g, F, x, y, w, h, L, o) {
    o = o || {};
    g.fillStyle = col(o.frame || C.timber, L); g.fillRect(x - 2, y - 2, w + 4, h + 4);
    var gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, o.stained ? '#7a4f86' : '#51667a'); gr.addColorStop(1, o.stained ? '#2f5c7a' : '#1f2b38');
    g.fillStyle = gr;
    if (o.arch) {
      g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill();
    } else g.fillRect(x, y, w, h);
    g.fillStyle = col(o.frame || C.timber, L);
    g.fillRect(x + w / 2 - 0.8, y, 1.6, h);
    if (h > 12) g.fillRect(x, y + h * 0.45, w, 1.4);
    g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x + 1, y + 1, w * 0.3, h * 0.35);
    if (!o.noSill) { g.fillStyle = col(C.stoneL, L); g.fillRect(x - 3, y + h + 1, w + 6, 2.2); }
    if (o.shutters) {
      g.fillStyle = col(o.shutters, L);
      g.fillRect(x - 2 - w * 0.45, y - 1, w * 0.42, h + 2); g.fillRect(x + w + 2, y - 1, w * 0.42, h + 2);
    }
    if (o.box) {
      g.fillStyle = col(C.woodD, L); g.fillRect(x - 3, y + h + 3, w + 6, 4);
      ['#d9453b', '#f0d65a', '#e98fb0'].forEach(function (c2, i) { g.fillStyle = c2; g.beginPath(); g.arc(x + 2 + i * (w - 4) / 2, y + h + 2.6, 2, 0, 6.3); g.fill(); });
    }
    if (!o.dark) F.lamp(x + w / 2, y + h / 2, o.glow || 0.42, o.str || 0.5);
  }
  function door(g, F, x, y, w, h, L, o) {
    o = o || {};
    g.fillStyle = col(o.frame || C.timber, L * 0.9);
    g.beginPath(); g.moveTo(x - 2.5, y + h); g.lineTo(x - 2.5, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2 + 2.5, Math.PI, 0); g.lineTo(x + w + 2.5, y + h); g.closePath(); g.fill();
    g.fillStyle = col(o.col || '#6b4a2e', L);
    g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + w / 2); g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)';
    for (var i = 1; i < 3; i++) g.fillRect(x + i * w / 3, y + 2, 0.8, h - 2);
    g.fillStyle = col(C.iron, L); g.fillRect(x + 1, y + h * 0.3, w - 2, 1.5); g.fillRect(x + 1, y + h * 0.72, w - 2, 1.5);
    g.fillStyle = C.gold; g.beginPath(); g.arc(x + w * 0.78, y + h * 0.55, 1.2, 0, 6.3); g.fill();
    if (o.lamp) F.lamp(x + w / 2, y - 6, 0.5, 0.55);
  }

  /* ---------------- roof painters: x runs along the ridge, y down the slope ---------------- */
  function thatchRoof(base) {
    return function (g, W, H, L, F) {
      var r = F.sp.rnd;
      base = base || C.thatch;
      g.fillStyle = col(base, L * 0.92); g.fillRect(0, 0, W, H);
      for (var y = 2; y < H; y += 5) {
        for (var x = -2; x < W; x += 2.2) {
          g.strokeStyle = col(base, L * (0.72 + r() * 0.45), 0.8);
          g.lineWidth = 1.1;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 1.5, y + 6 + r() * 2); g.stroke();
        }
        g.fillStyle = 'rgba(60,40,10,.18)'; g.fillRect(0, y + 4, W, 1.2);
      }
      g.fillStyle = col(base, L * 0.6); g.fillRect(0, 0, W, 5);          // ridge cap
      var gr = g.createLinearGradient(0, H - 8, 0, H);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,24,6,.4)');
      g.fillStyle = gr; g.fillRect(0, H - 8, W, 8);
      snowOn(g, W, H, L, F);
    };
  }
  function tileRoof(base) {
    return function (g, W, H, L, F) {
      var r = F.sp.rnd;
      base = base || C.clay;
      g.fillStyle = col(base, L * 0.7); g.fillRect(0, 0, W, H);
      for (var y = 0, row = 0; y < H; y += 6.5, row++) {
        for (var x = row % 2 ? -4.5 : 0; x < W; x += 9) {
          var gr = g.createLinearGradient(x, 0, x + 9, 0);
          var f = 0.86 + r() * 0.26;
          gr.addColorStop(0, col(base, L * f * 1.12)); gr.addColorStop(1, col(base, L * f * 0.78));
          g.fillStyle = gr;
          g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 8.5, y); g.lineTo(x + 8.5, y + 5.5);
          g.quadraticCurveTo(x + 4.5, y + 8, x + 0.5, y + 5.5); g.closePath(); g.fill();
        }
      }
      g.fillStyle = col(base, L * 0.55); g.fillRect(0, 0, W, 3.5);
      snowOn(g, W, H, L, F);
    };
  }
  function slateRoof(base) {
    return function (g, W, H, L, F) {
      var r = F.sp.rnd;
      base = base || C.slate;
      g.fillStyle = col(base, L * 0.6); g.fillRect(0, 0, W, H);
      for (var y = 0, row = 0; y < H; y += 5, row++) {
        for (var x = row % 2 ? -3.5 : 0; x < W; x += 7) {
          g.fillStyle = col(base, L * (0.82 + r() * 0.3));
          g.fillRect(x + 0.5, y + 0.5, 6, 4.3);
        }
      }
      g.fillStyle = col(base, L * 0.5); g.fillRect(0, 0, W, 3);
      snowOn(g, W, H, L, F);
    };
  }
  function shingleRoof(base) {
    return function (g, W, H, L, F) {
      var r = F.sp.rnd;
      base = base || C.shingle;
      g.fillStyle = col(base, L * 0.6); g.fillRect(0, 0, W, H);
      for (var y = 0, row = 0; y < H; y += 5.5, row++) {
        for (var x = row % 2 ? -4 : 0; x < W; x += 8) {
          g.fillStyle = col(base, L * (0.8 + r() * 0.35));
          g.fillRect(x + 0.6, y + 0.6, 6.8, 4.6);
          g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 0.6, y + 4.6, 6.8, 0.8);
        }
      }
      g.fillStyle = col(base, L * 0.5); g.fillRect(0, 0, W, 3);
      snowOn(g, W, H, L, F);
    };
  }
  /* In winter the roofs are baked again under snow. */
  var WINTER = false;
  function snowOn(g, W, H, L, F) {
    if (!WINTER) return;
    var r = F.sp.rnd;
    g.fillStyle = col(C.snow, Math.min(1.05, L * 1.02));
    g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0);
    for (var x = W; x >= 0; x -= 6) g.lineTo(x, H * (0.74 + r() * 0.16));
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(150,175,210,.25)';
    g.fillRect(0, 0, W, 3);
  }

  /* ---------------- roofs ---------------- */
  /* A gabled roof. axis 'u' runs the ridge down-right; 'v' runs it down-left. */
  function gable(sp, u0, v0, u1, v1, we, wr, axis, roof, gableWall, over) {
    over = over === undefined ? 0.07 : over;
    gableWall = gableWall || plasterWall();
    var o = over;
    if (axis === 'u') {
      var vm = (v0 + v1) / 2, half = vm - v0, drop = (wr - we) * o / half, ee = we - drop;
      shadow(sp, [[u0 - o, v0 - o, ee], [u1 + o, v0 - o, ee], [u1 + o, v1 + o, ee], [u0 - o, v1 + o, ee], [u0 - o, vm, wr], [u1 + o, vm, wr]]);
      // back slope
      plane(sp, [u0 - o, vm, wr], [u1 - u0 + 2 * o, 0, 0], [0, -(half + o), ee - wr], [0, -(wr - ee), half + o], roof);
      // the gable end that faces us
      plane(sp, [u1, v1, wr], [0, v0 - v1, 0], [0, 0, we - wr], [1, 0, 0], gableWall,
        triClip(v1 - v0, wr - we, 0.5));
      // front slope
      plane(sp, [u0 - o, vm, wr], [u1 - u0 + 2 * o, 0, 0], [0, half + o, ee - wr], [0, wr - ee, half + o], roof);
      fascia(sp, [[u1 + o, vm, wr], [u1 + o, v1 + o, ee]], [[u1 + o, vm, wr], [u1 + o, v0 - o, ee]]);
    } else {
      var um = (u0 + u1) / 2, half2 = um - u0, drop2 = (wr - we) * o / half2, ee2 = we - drop2;
      shadow(sp, [[u0 - o, v0 - o, ee2], [u1 + o, v0 - o, ee2], [u1 + o, v1 + o, ee2], [u0 - o, v1 + o, ee2], [um, v0 - o, wr], [um, v1 + o, wr]]);
      plane(sp, [um, v1 + o, wr], [0, -(v1 - v0 + 2 * o), 0], [-(half2 + o), 0, ee2 - wr], [-(wr - ee2), 0, half2 + o], roof);
      plane(sp, [u0, v1, wr], [u1 - u0, 0, 0], [0, 0, we - wr], [0, 1, 0], gableWall,
        triClip(u1 - u0, wr - we, 0.5));
      plane(sp, [um, v1 + o, wr], [0, -(v1 - v0 + 2 * o), 0], [half2 + o, 0, ee2 - wr], [wr - ee2, 0, half2 + o], roof);
      fascia(sp, [[um, v1 + o, wr], [u0 - o, v1 + o, ee2]], [[um, v1 + o, wr], [u1 + o, v1 + o, ee2]]);
    }
  }
  function triClip(wUnits, hUnits, apex) {
    var W = wUnits * 100, H = hUnits * 100;
    return [[0, H], [W * apex, 0], [W, H]];
  }
  function fascia(sp) {
    var g = sp.g;
    g.strokeStyle = 'rgba(30,20,10,.55)'; g.lineWidth = 1.4;
    for (var i = 1; i < arguments.length; i++) {
      var seg = arguments[i], a = P(sp, seg[0][0], seg[0][1], seg[0][2]), b = P(sp, seg[1][0], seg[1][1], seg[1][2]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
  }
  /* A hipped roof: every side slopes. */
  function hip(sp, u0, v0, u1, v1, we, wr, roof, over, ridgeAlongU) {
    var o = over === undefined ? 0.07 : over;
    u0 -= o; v0 -= o; u1 += o; v1 += o;
    var alongU = ridgeAlongU !== false;
    var um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
    var inset = alongU ? (v1 - v0) / 2 : (u1 - u0) / 2;
    var r0, r1;       // ridge ends
    if (alongU) { r0 = [Math.min(um, u0 + inset), vm, wr]; r1 = [Math.max(um, u1 - inset), vm, wr]; }
    else { r0 = [um, Math.min(vm, v0 + inset), wr]; r1 = [um, Math.max(vm, v1 - inset), wr]; }
    var e00 = [u0, v0, we - 0.03], e10 = [u1, v0, we - 0.03], e11 = [u1, v1, we - 0.03], e01 = [u0, v1, we - 0.03];
    shadow(sp, [e00, e10, e11, e01, r0, r1]);
    // four faces drawn back to front: -v, -u, +u, +v
    tri4(sp, alongU ? [e00, e10, r1, r0] : [e00, e10, r0], roof, [0, -1, 1]);
    tri4(sp, alongU ? [e00, e01, r0] : [e00, e01, r1, r0], roof, [-1, 0, 1]);
    tri4(sp, alongU ? [e10, e11, r1] : [e10, e11, r1, r0], roof, [1, 0, 1]);
    tri4(sp, alongU ? [e01, e11, r1, r0] : [e01, e11, r1], roof, [0, 1, 1]);
  }
  /* paint a roof facet given by 3 or 4 corners (the first two are the eave) */
  function tri4(sp, pts, roof, hint) {
    var a = pts[0], b = pts[1];
    var top = pts.length === 4 ? pts[3] : pts[2];
    var A = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    // local y runs from the ridge line down to the eave, perpendicular to it
    var la = Math.hypot(A[0], A[1], A[2]);
    var ax = [A[0] / la, A[1] / la, A[2] / la];
    var t = [top[0] - a[0], top[1] - a[1], top[2] - a[2]];
    var along = dot(t, ax);
    var perp = [t[0] - ax[0] * along, t[1] - ax[1] * along, t[2] - ax[2] * along];
    var o = [a[0] + perp[0], a[1] + perp[1], a[2] + perp[2]];
    var B = [-perp[0], -perp[1], -perp[2]];
    var n = cross(A, B);
    if (dot(n, hint) < 0) n = [-n[0], -n[1], -n[2]];
    var lx = la * 100, ly = Math.hypot(B[0], B[1], B[2]) * 100;
    var clip = pts.map(function (p) {
      var d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
      return [dot(d, ax) * 100, dot(d, norm3(B)) * 100];
    });
    plane(sp, o, A, B, n, roof, clip);
    var g = sp.g;
    g.strokeStyle = 'rgba(30,20,10,.4)'; g.lineWidth = 1;
    g.beginPath();
    pts.forEach(function (p, i) { var q = P(sp, p[0], p[1], p[2]); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
    g.closePath(); g.stroke();
  }

  /* ---------------- round things ---------------- */
  function cyl(sp, uc, vc, r, w0, w1, base, o) {
    o = o || {};
    var g = sp.g, b = P(sp, uc, vc, w0), t = P(sp, uc, vc, w1);
    var r1 = o.rTop || r;
    var rx0 = r * sp.s * 0.7071, ry0 = r * sp.s * 0.3536, rx1 = r1 * sp.s * 0.7071, ry1 = r1 * sp.s * 0.3536;
    var pts = [];
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * 6.283;
      pts.push([uc + Math.cos(a) * r, vc + Math.sin(a) * r, w0], [uc + Math.cos(a) * r1, vc + Math.sin(a) * r1, w1]);
    }
    shadow(sp, pts);
    g.save();
    g.beginPath();
    g.moveTo(t.x - rx1, t.y); g.lineTo(b.x - rx0, b.y);
    g.ellipse(b.x, b.y, rx0, ry0, 0, Math.PI, 0, true);
    g.lineTo(t.x + rx1, t.y);
    g.ellipse(t.x, t.y, rx1, ry1, 0, 0, Math.PI, false);
    g.closePath();
    var gr = g.createLinearGradient(b.x - rx0, 0, b.x + rx0, 0);
    gr.addColorStop(0, col(base, 0.92)); gr.addColorStop(0.28, col(base, 1.06));
    gr.addColorStop(0.62, col(base, 0.78)); gr.addColorStop(1, col(base, 0.55));
    g.fillStyle = gr; g.fill();
    g.clip();
    if (o.courses) {
      var H = b.y - t.y, step = o.courses;
      g.strokeStyle = 'rgba(30,24,16,.28)'; g.lineWidth = 1;
      for (var yy = step, row = 0; yy < H; yy += step, row++) {
        var f = yy / H, rx = rx1 + (rx0 - rx1) * f, ry = ry1 + (ry0 - ry1) * f;
        g.beginPath(); g.ellipse(t.x, t.y + yy, rx, ry, 0, 0, Math.PI); g.stroke();
        for (var k = 0; k < 7; k++) {
          var ang = (k + (row % 2) * 0.5) / 7 * Math.PI;
          var jx = t.x + Math.cos(ang) * rx, jy = t.y + yy + Math.sin(ang) * ry;
          g.beginPath(); g.moveTo(jx, jy); g.lineTo(jx, jy - step); g.stroke();
        }
      }
    }
    if (o.bands) {
      g.fillStyle = 'rgba(40,26,14,.5)';
      o.bands.forEach(function (fy) { g.fillRect(b.x - rx0 - 2, t.y + (b.y - t.y) * fy - 1.5, rx0 * 2 + 4, 3); });
    }
    var ao2 = g.createLinearGradient(0, b.y + ry0 - 18, 0, b.y + ry0);
    ao2.addColorStop(0, 'rgba(0,0,0,0)'); ao2.addColorStop(1, 'rgba(0,0,0,.3)');
    g.fillStyle = ao2; g.fillRect(b.x - rx0 - 2, b.y + ry0 - 18, rx0 * 2 + 4, 18);
    g.restore();
    if (o.cap !== false) {
      g.fillStyle = col(o.capCol || base, 1.1);
      g.beginPath(); g.ellipse(t.x, t.y, rx1, ry1, 0, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke();
    }
    return { t: t, b: b, rx: rx1, ry: ry1 };
  }
  function cone(sp, uc, vc, r, w0, wa, base, o) {
    o = o || {};
    var g = sp.g, b = P(sp, uc, vc, w0), a = P(sp, uc, vc, wa);
    var rx = r * sp.s * 0.7071, ry = r * sp.s * 0.3536;
    var pts = [[uc, vc, wa]];
    for (var i = 0; i < 12; i++) { var an = i / 12 * 6.283; pts.push([uc + Math.cos(an) * r, vc + Math.sin(an) * r, w0]); }
    shadow(sp, pts);
    g.save();
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x - rx, b.y);
    g.ellipse(b.x, b.y, rx, ry, 0, Math.PI, 0, true);
    g.closePath();
    var gr = g.createLinearGradient(b.x - rx, 0, b.x + rx, 0);
    gr.addColorStop(0, col(base, 1.02)); gr.addColorStop(0.35, col(base, 1.12)); gr.addColorStop(1, col(base, 0.55));
    g.fillStyle = gr; g.fill();
    g.clip();
    g.strokeStyle = 'rgba(20,16,12,.25)'; g.lineWidth = 1;
    for (var k = 0; k <= 12; k++) {
      var ang = k / 12 * Math.PI;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x + Math.cos(ang) * rx, b.y + Math.sin(ang) * ry); g.stroke();
    }
    for (var s = 0.25; s < 1; s += 0.18) {
      g.beginPath(); g.ellipse(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s, rx * s, ry * s, 0, 0, Math.PI); g.stroke();
    }
    if (WINTER) {
      g.fillStyle = 'rgba(240,244,250,.92)';
      g.beginPath(); g.moveTo(a.x, a.y);
      g.lineTo(a.x - rx * 0.75, a.y + (b.y - a.y) * 0.72);
      g.quadraticCurveTo(a.x, a.y + (b.y - a.y) * 0.95, a.x + rx * 0.75, a.y + (b.y - a.y) * 0.72);
      g.closePath(); g.fill();
    }
    g.restore();
  }

  /* ---------------- props ---------------- */
  function barrel(sp, u, v, s) {
    s = s || 1;
    cyl(sp, u, v, 0.055 * s, 0, 0.13 * s, '#7a5634', { bands: [0.2, 0.8], capCol: '#8a6844' });
  }
  function crate(sp, u, v, s) {
    s = s || 1; var d = 0.055 * s;
    box(sp, u - d, v - d, u + d, v + d, 0, 0.11 * s, plankWall({ col: '#9a7448' }), plankWall({ col: '#9a7448' }), flat('#a88154'));
  }
  function sack(sp, u, v) {
    var g = sp.g, p = P(sp, u, v, 0);
    shadow(sp, [[u - .04, v - .04, 0], [u + .04, v + .04, 0], [u, v, 0.09]]);
    g.fillStyle = '#c8b286';
    g.beginPath(); g.ellipse(p.x, p.y - sp.s * 0.04, sp.s * 0.04, sp.s * 0.05, 0, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(p.x + sp.s * 0.012, p.y - sp.s * 0.035, sp.s * 0.025, sp.s * 0.045, 0, 0, 6.3); g.fill();
  }
  function logPile(sp, u, v, n, along) {
    var g = sp.g;
    shadow(sp, [[u - .12, v - .06, 0], [u + .12, v + .06, 0], [u, v, 0.14]]);
    var rows = [n, n - 1, n - 2];
    for (var r = 0; r < rows.length; r++) {
      for (var i = 0; i < rows[r]; i++) {
        var off = (i - (rows[r] - 1) / 2) * 0.052;
        var p = along === 'v' ? P(sp, u + off, v, 0.03 + r * 0.045) : P(sp, u, v + off, 0.03 + r * 0.045);
        // log body as a short cylinder lying down
        g.fillStyle = '#6e4e30';
        g.beginPath(); g.ellipse(p.x + (along === 'v' ? -1 : 1) * sp.s * 0.05, p.y - sp.s * 0.025, sp.s * 0.02, sp.s * 0.02, 0, 0, 6.3); g.fill();
        g.fillStyle = '#d9b27a';
        g.beginPath(); g.arc(p.x, p.y, sp.s * 0.021, 0, 6.3); g.fill();
        g.strokeStyle = '#8a6440'; g.lineWidth = 0.8; g.beginPath(); g.arc(p.x, p.y, sp.s * 0.012, 0, 6.3); g.stroke();
      }
    }
  }
  function haystack(sp, u, v, s) {
    s = s || 1;
    cone(sp, u, v, 0.1 * s, 0.05 * s, 0.24 * s, C.hay);
    cyl(sp, u, v, 0.1 * s, 0, 0.06 * s, C.hay, { cap: false });
  }
  function flag(sp, u, v, w, colr, big) {
    var g = sp.g, b = P(sp, u, v, 0), t = P(sp, u, v, w);
    shadow(sp, [[u, v, 0], [u + .01, v + .01, 0], [u, v, w]]);
    g.strokeStyle = '#3d2c1c'; g.lineWidth = big ? 2.4 : 1.6;
    g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(t.x, t.y); g.stroke();
    var fw = sp.s * (big ? 0.2 : 0.13), fh = sp.s * (big ? 0.11 : 0.075);
    g.fillStyle = colr;
    g.beginPath(); g.moveTo(t.x, t.y + 1);
    g.quadraticCurveTo(t.x + fw * 0.5, t.y - fh * 0.2, t.x + fw, t.y + fh * 0.15);
    g.lineTo(t.x + fw * 0.92, t.y + fh * 0.6);
    g.quadraticCurveTo(t.x + fw * 0.5, t.y + fh * 0.75, t.x, t.y + fh);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(t.x, t.y + fh * 0.55, fw * 0.9, fh * 0.12);
  }
  function fenceLine(sp, a, b, n, hgt) {
    var g = sp.g;
    hgt = hgt || 0.12;
    var pa = P(sp, a[0], a[1], 0), pb = P(sp, b[0], b[1], 0);
    g.strokeStyle = '#6b4e30'; g.lineWidth = 1.6;
    [0.45, 0.85].forEach(function (f) {
      g.beginPath(); g.moveTo(pa.x, pa.y - hgt * f * sp.UP); g.lineTo(pb.x, pb.y - hgt * f * sp.UP); g.stroke();
    });
    g.strokeStyle = '#4e3826'; g.lineWidth = 2;
    for (var i = 0; i <= n; i++) {
      var x = pa.x + (pb.x - pa.x) * i / n, y = pa.y + (pb.y - pa.y) * i / n;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - hgt * sp.UP); g.stroke();
    }
  }
  function chimney(sp, u, v, w0, w1, stone) {
    box(sp, u - 0.045, v - 0.045, u + 0.045, v + 0.045, w0, w1, stone ? stoneWall({ course: 6 }) : brickWall(), null, flat('#3a3028'));
    sp.chimneys.push([u, v, w1 + 0.04]);
  }
  function crenels(sp, a, b, w, n, base) {
    for (var i = 0; i <= n; i++) {
      if (i % 2) continue;
      var u = a[0] + (b[0] - a[0]) * i / n, v = a[1] + (b[1] - a[1]) * i / n;
      box(sp, u - 0.035, v - 0.035, u + 0.035, v + 0.035, w, w + 0.08, stoneWall({ col: base || C.stone, course: 6 }), null, flat(base || C.stoneL));
    }
  }
  function stall(sp, u, v, cloth, goods) {
    var g = sp.g;
    box(sp, u - 0.1, v - 0.07, u + 0.1, v + 0.07, 0, 0.09, plankWall(), null, flat('#8a6440'));
    goods.forEach(function (c2, i) {
      var p = P(sp, u - 0.06 + i * 0.045, v, 0.1);
      g.fillStyle = c2; g.beginPath(); g.arc(p.x, p.y - 2, sp.s * 0.016, 0, 6.3); g.fill();
    });
    [[-0.1, -0.07], [0.1, -0.07], [0.1, 0.07], [-0.1, 0.07]].forEach(function (d) {
      var a = P(sp, u + d[0], v + d[1], 0), b = P(sp, u + d[0], v + d[1], 0.26);
      g.strokeStyle = '#4e3826'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    });
    plane(sp, [u - 0.13, v - 0.1, 0.3], [0.26, 0, 0], [0, 0.22, -0.08], [0, 0.3, 1], function (gg, W, H, L) {
      for (var x = 0; x < W; x += 6) { gg.fillStyle = col((x / 6) % 2 ? '#efe6d2' : cloth, L); gg.fillRect(x, 0, 6, H); }
      gg.fillStyle = 'rgba(0,0,0,.25)'; gg.fillRect(0, H - 2, W, 2);
    });
    shadow(sp, [[u - 0.13, v - 0.1, 0.3], [u + 0.13, v - 0.1, 0.3], [u + 0.13, v + 0.12, 0.22], [u - 0.13, v + 0.12, 0.22]]);
  }

  /* ================================================================
     THE BUILDINGS
     Each takes a fresh Sprite and the building record, and draws
     back-to-front. Coordinates are tiles from the plot's far corner.
     ================================================================ */
  function cottageBody(sp, u0, v0, u1, v1, wall, rf, axis, o) {
    o = o || {};
    box(sp, u0, v0, u1, v1, 0, wall, plasterWall({ timber: true, deco: function (g, W, H, L, F) {
      door(g, F, W * 0.62, H - 30, 13, 30, L);
      win(g, F, W * 0.2, H * 0.3, 11, 11, L, { shutters: '#5d7a4a', box: o.flowers });
    } }), plasterWall({ timber: true, flip: true, deco: function (g, W, H, L, F) {
      win(g, F, W * 0.4, H * 0.3, 11, 11, L, { shutters: '#5d7a4a' });
    } }), false);
    gable(sp, u0, v0, u1, v1, wall, rf, axis, o.roof || thatchRoof(), plasterWall({ timber: true }));
  }

  var DRAW = {
    house: function (sp, b) {
      var lvl = b.level || 1;
      if (lvl === 1) {
        logPile(sp, 0.84, 0.3, 3, 'u');
        cottageBody(sp, 0.2, 0.3, 0.76, 0.74, 0.3, 0.7, 'u', { flowers: true });
        chimney(sp, 0.64, 0.42, 0.45, 0.82, true);
        barrel(sp, 0.84, 0.82);
      } else if (lvl === 2) {
        // townhouse: stone ground floor, jettied timber upper storey, clay tiles
        box(sp, 0.18, 0.26, 0.8, 0.76, 0, 0.3, stoneWall({ deco: function (g, W, H, L, F) {
          door(g, F, W * 0.6, H - 30, 13, 30, L, { lamp: true });
          win(g, F, W * 0.18, H * 0.25, 11, 12, L);
        } }), stoneWall({ deco: function (g, W, H, L, F) { win(g, F, W * 0.35, H * 0.25, 11, 12, L); } }), false);
        box(sp, 0.16, 0.24, 0.82, 0.8, 0.3, 0.6, plasterWall({ timber: true, col: '#e8dcc0', deco: function (g, W, H, L, F) {
          win(g, F, W * 0.15, H * 0.28, 11, 13, L, { box: true }); win(g, F, W * 0.6, H * 0.28, 11, 13, L, { box: true });
        } }), plasterWall({ timber: true, col: '#e8dcc0', deco: function (g, W, H, L, F) { win(g, F, W * 0.4, H * 0.28, 11, 13, L); } }), false);
        gable(sp, 0.16, 0.24, 0.82, 0.8, 0.6, 1.02, 'v', tileRoof(), plasterWall({ timber: true, col: '#e8dcc0' }));
        chimney(sp, 0.64, 0.4, 0.8, 1.12, false);
      } else {
        // fine house: dressed stone, three storeys, slate hip roof, a garden wall
        box(sp, 0.12, 0.2, 0.86, 0.8, 0, 0.82, stoneWall({ col: '#cfc6b2', ashlar: true, deco: function (g, W, H, L, F) {
          door(g, F, W / 2 - 7, H - 32, 14, 32, L, { lamp: true, col: '#3d5a3a' });
          [0.14, 0.72].forEach(function (f) { win(g, F, W * f, H - 30, 12, 16, L, { noSill: false }); });
          [0.14, 0.43, 0.72].forEach(function (f) { win(g, F, W * f, H * 0.4, 12, 16, L); win(g, F, W * f, H * 0.1, 12, 14, L); });
          g.fillStyle = col('#a39a86', L); g.fillRect(0, H * 0.34, W, 3); g.fillRect(0, H * 0.66, W, 3);
        } }), stoneWall({ col: '#cfc6b2', ashlar: true, deco: function (g, W, H, L, F) {
          [0.2, 0.62].forEach(function (f) { win(g, F, W * f, H * 0.4, 12, 16, L); win(g, F, W * f, H * 0.1, 12, 14, L); win(g, F, W * f, H - 30, 12, 16, L); });
          g.fillStyle = col('#a39a86', L); g.fillRect(0, H * 0.34, W, 3); g.fillRect(0, H * 0.66, W, 3);
        } }), false);
        hip(sp, 0.12, 0.2, 0.86, 0.8, 0.82, 1.2, slateRoof());
        chimney(sp, 0.26, 0.34, 1.0, 1.32, true);
        chimney(sp, 0.72, 0.34, 1.0, 1.32, true);
        flag(sp, 0.9, 0.84, 0.5, C.gold);
      }
    },

    manor: function (sp) {
      box(sp, 0.1, 0.16, 0.9, 0.62, 0, 0.62, brickWall({ deco: function (g, W, H, L, F) {
        [0.1, 0.34, 0.58, 0.8].forEach(function (f) { win(g, F, W * f, H * 0.18, 11, 15, L, { frame: '#e9e0cc' }); });
        [0.1, 0.8].forEach(function (f) { win(g, F, W * f, H * 0.62, 11, 15, L, { frame: '#e9e0cc' }); });
        door(g, F, W * 0.46, H - 32, 15, 32, L, { lamp: true, col: '#3b2a1c' });
      } }), brickWall({ deco: function (g, W, H, L, F) {
        [0.2, 0.62].forEach(function (f) { win(g, F, W * f, H * 0.18, 11, 15, L, { frame: '#e9e0cc' }); win(g, F, W * f, H * 0.62, 11, 15, L, { frame: '#e9e0cc' }); });
      } }), false);
      hip(sp, 0.1, 0.16, 0.9, 0.62, 0.62, 0.98, slateRoof());
      chimney(sp, 0.2, 0.3, 0.7, 1.12, false);
      chimney(sp, 0.8, 0.3, 0.7, 1.12, false);
      // a low garden wall and a gate in front
      box(sp, 0.08, 0.84, 0.4, 0.9, 0, 0.1, stoneWall({ course: 5 }), null, flat(C.stoneL));
      box(sp, 0.6, 0.84, 0.92, 0.9, 0, 0.1, stoneWall({ course: 5 }), null, flat(C.stoneL));
      flag(sp, 0.92, 0.9, 0.5, C.blue);
    },

    castle: function (sp, b) {
      var tier = SIM.G ? SIM.G.castle : 0;
      if (b && b._tier !== undefined) tier = b._tier;
      CASTLES[tier](sp);
    },

    farm: function (sp, b) {
      if (b && b.compact) {
        box(sp, 0.1, 0.1, 0.5, 0.42, 0, 0.26, plankWall({ col: '#9c4a34' }), null, false);
        gable(sp, 0.1, 0.1, 0.5, 0.42, 0.26, 0.5, 'u', shingleRoof(), plankWall({ col: '#9c4a34' }));
        haystack(sp, 0.7, 0.25, 0.8);
        return;
      }
      // a red barn and a farmhouse on the back plot; the fields are ground cover
      box(sp, 0.1, 0.12, 0.62, 0.62, 0, 0.36, plankWall({ col: '#9c4a34', deco: function (g, W, H, L, F) {
        g.fillStyle = col('#5b2a1e', L); g.fillRect(W * 0.3, H - 36, 26, 36);
        g.strokeStyle = col('#e8dcc0', L); g.lineWidth = 2;
        g.strokeRect(W * 0.3, H - 36, 26, 36);
        g.beginPath(); g.moveTo(W * 0.3, H - 36); g.lineTo(W * 0.3 + 26, H); g.moveTo(W * 0.3 + 26, H - 36); g.lineTo(W * 0.3, H); g.stroke();
      } }), plankWall({ col: '#9c4a34', deco: function (g, W, H, L, F) {
        g.fillStyle = col('#2a1a12', L); g.fillRect(W * 0.4, 6, 12, 10);
      } }), false);
      gable(sp, 0.1, 0.12, 0.62, 0.62, 0.36, 0.7, 'u', shingleRoof('#6e5a44'), plankWall({ col: '#9c4a34' }));
      cottageBody(sp, 0.12, 0.8, 0.5, 1.12, 0.26, 0.56, 'v', {});
      chimney(sp, 0.22, 0.96, 0.4, 0.66, true);
      haystack(sp, 0.86, 0.3, 1);
      haystack(sp, 0.84, 0.62, 0.8);
      fenceLine(sp, [0.02, 1.35], [0.02, 1.95], 3);
    },

    fishery: function (sp, b) {
      var dir = (b && b._dir) || 'v';
      // a jetty runs out over the water toward the sea
      var jet = { u: [[0.72, 0.4], [1.55, 0.6]], v: [[0.4, 0.72], [0.6, 1.55]], nu: [[-0.55, 0.4], [0.28, 0.6]], nv: [[0.4, -0.55], [0.6, 0.28]] }[dir];
      box(sp, jet[0][0], jet[0][1], jet[1][0], jet[1][1], 0.02, 0.06, plankWall({ col: '#8a6a48' }), plankWall({ col: '#8a6a48' }), function (g, W, H, L) {
        for (var x = 0; x < W; x += 7) { g.fillStyle = col('#a8845a', L * (0.9 + (x % 14 ? 0.1 : 0))); g.fillRect(x, 0, 6.3, H); }
      });
      var tip = { u: [1.5, 0.5], v: [0.5, 1.5], nu: [-0.5, 0.5], nv: [0.5, -0.5] }[dir];
      [[-0.08, -0.08], [0.08, 0.08]].forEach(function (d) { cyl(sp, tip[0] + d[0], tip[1] + d[1], 0.02, -0.05, 0.14, '#5b4029', { cap: false }); });
      // the hut on stilts
      box(sp, 0.2, 0.22, 0.66, 0.62, 0.06, 0.34, plankWall({ col: '#7d6448', deco: function (g, W, H, L, F) {
        door(g, F, W * 0.55, H - 26, 12, 26, L);
        win(g, F, W * 0.15, H * 0.3, 10, 9, L);
      } }), plankWall({ col: '#7d6448' }), false);
      gable(sp, 0.2, 0.22, 0.66, 0.62, 0.34, 0.6, 'u', thatchRoof('#b39a66'), plankWall({ col: '#7d6448' }));
      // drying rack with fish and nets
      var g = sp.g;
      var r0 = P(sp, 0.78, 0.2, 0), r1 = P(sp, 0.78, 0.2, 0.2), r2 = P(sp, 0.78, 0.6, 0), r3 = P(sp, 0.78, 0.6, 0.2);
      g.strokeStyle = '#4e3826'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(r0.x, r0.y); g.lineTo(r1.x, r1.y); g.lineTo(r3.x, r3.y); g.lineTo(r2.x, r2.y); g.stroke();
      for (var i = 1; i < 5; i++) {
        var p = P(sp, 0.78, 0.2 + i * 0.08, 0.2);
        g.fillStyle = '#9fb0b8'; g.beginPath(); g.ellipse(p.x, p.y + 5, 1.6, 4.5, 0, 0, 6.3); g.fill();
      }
      barrel(sp, 0.26, 0.82, 0.9);
    },

    bakery: function (sp) {
      box(sp, 0.16, 0.22, 0.66, 0.74, 0, 0.38, brickWall({ deco: function (g, W, H, L, F) {
        door(g, F, W * 0.2, H - 30, 13, 30, L);
        win(g, F, W * 0.58, H * 0.3, 14, 12, L, { glow: 0.55, str: 0.65 });
        g.fillStyle = col('#6b4a2e', L); g.fillRect(W * 0.52, H * 0.12, 26, 7);
        g.fillStyle = '#e8c070'; g.beginPath(); g.ellipse(W * 0.52 + 13, H * 0.12 + 3.5, 7, 2.4, 0, 0, 6.3); g.fill();
      } }), brickWall(), false);
      gable(sp, 0.16, 0.22, 0.66, 0.74, 0.38, 0.72, 'v', tileRoof());
      // the domed bread oven
      var g = sp.g, c0 = P(sp, 0.82, 0.5, 0);
      shadow(sp, [[0.68, 0.36, 0], [0.96, 0.64, 0], [0.82, 0.5, 0.26]]);
      var gr = g.createRadialGradient(c0.x - 8, c0.y - 22, 2, c0.x, c0.y - 10, sp.s * 0.2);
      gr.addColorStop(0, '#c98a5e'); gr.addColorStop(1, '#6e3e26');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(c0.x, c0.y - 2, sp.s * 0.14, sp.s * 0.08, 0, Math.PI, 0); g.lineTo(c0.x + sp.s * 0.14, c0.y);
      g.ellipse(c0.x, c0.y, sp.s * 0.14, sp.s * 0.07, 0, 0, Math.PI); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(c0.x, c0.y - 2, sp.s * 0.14, sp.s * 0.13, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#ffb347'; g.beginPath(); g.ellipse(c0.x - 6, c0.y + 1, 5, 5, 0, Math.PI, 0); g.fill();
      sp.lights.push([0.78, 0.6, 0.05, 0.7, 0.8]);
      chimney(sp, 0.84, 0.46, 0.2, 0.62, false);
      sack(sp, 0.3, 0.86); sack(sp, 0.38, 0.9);
    },

    windmill: function (sp) {
      // a tapering tower of whitewash with a turning wooden cap
      var c0 = cyl(sp, 0.5, 0.5, 0.26, 0, 0.92, '#e6dccb', { rTop: 0.18, courses: 0, bands: [0.95], cap: false });
      var g = sp.g;
      // door and windows painted straight onto the curve
      var d = P(sp, 0.5, 0.76, 0);
      g.fillStyle = '#5b4029'; g.beginPath(); g.moveTo(d.x - 7, d.y - 2); g.lineTo(d.x - 7, d.y - 20); g.arc(d.x, d.y - 20, 7, Math.PI, 0); g.lineTo(d.x + 7, d.y - 2); g.fill();
      var w1 = P(sp, 0.42, 0.66, 0.55);
      g.fillStyle = '#2e3f52'; g.fillRect(w1.x - 4, w1.y - 6, 8, 11);
      sp.lights.push([0.42, 0.68, 0.55, 0.4, 0.5]);
      cone(sp, 0.5, 0.5, 0.22, 0.9, 1.22, '#6b4a2e');
      var hub = P(sp, 0.72, 0.72, 1.0);
      sp.hub = [hub.x, hub.y];
    },

    lumber: function (sp) {
      box(sp, 0.12, 0.14, 0.56, 0.56, 0, 0.3, logWall({ deco: function (g, W, H, L, F) {
        door(g, F, W * 0.55, H - 26, 12, 26, L);
      } }), logWall({ deco: function (g, W, H, L, F) { win(g, F, W * 0.4, H * 0.3, 9, 9, L); } }), false);
      gable(sp, 0.12, 0.14, 0.56, 0.56, 0.3, 0.56, 'v', shingleRoof('#6a5238'), logWall());
      chimney(sp, 0.26, 0.26, 0.4, 0.66, true);
      logPile(sp, 0.78, 0.3, 4, 'u');
      logPile(sp, 0.74, 0.74, 3, 'v');
      // stump with the axe
      cyl(sp, 0.32, 0.8, 0.06, 0, 0.08, '#6e5238', { capCol: '#d8b27a' });
      var g = sp.g, a = P(sp, 0.32, 0.8, 0.08), bb = P(sp, 0.37, 0.76, 0.25);
      g.strokeStyle = '#8a6440'; g.lineWidth = 2; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(bb.x, bb.y); g.stroke();
      g.fillStyle = '#b8bcc4'; g.fillRect(a.x - 5, a.y - 4, 8, 5);
    },

    hunter: function (sp) {
      // a low log lodge with antlers over the door, a hide on a frame, game hanging
      box(sp, 0.16, 0.2, 0.62, 0.62, 0, 0.28, logWall({ deco: function (g, W, H, L, F) {
        door(g, F, W * 0.55, H - 26, 12, 26, L);
        g.strokeStyle = col('#e8dcc0', L); g.lineWidth = 1.6;
        var ax = W * 0.55 + 6, ay = H - 32;
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax - 8, ay - 8); g.lineTo(ax - 12, ay - 6); g.moveTo(ax - 5, ay - 5); g.lineTo(ax - 7, ay - 11);
        g.moveTo(ax, ay); g.lineTo(ax + 8, ay - 8); g.lineTo(ax + 12, ay - 6); g.moveTo(ax + 5, ay - 5); g.lineTo(ax + 7, ay - 11); g.stroke();
        win(g, F, W * 0.15, H * 0.3, 9, 9, L);
      } }), logWall(), false);
      gable(sp, 0.16, 0.2, 0.62, 0.62, 0.28, 0.54, 'v', shingleRoof('#5e4a36'), logWall());
      chimney(sp, 0.28, 0.3, 0.38, 0.64, true);
      var g = sp.g;
      // hide stretched on a frame
      var h0 = P(sp, 0.78, 0.3, 0), h1 = P(sp, 0.78, 0.3, 0.3), h2 = P(sp, 0.78, 0.62, 0.3), h3 = P(sp, 0.78, 0.62, 0);
      shadow(sp, [[0.78, 0.3, 0], [0.78, 0.62, 0], [0.78, 0.3, 0.3], [0.78, 0.62, 0.3]]);
      g.strokeStyle = '#4e3826'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(h0.x, h0.y); g.lineTo(h1.x, h1.y); g.lineTo(h2.x, h2.y); g.lineTo(h3.x, h3.y); g.stroke();
      g.fillStyle = '#a8784a';
      g.beginPath(); g.moveTo(h1.x + 3, h1.y + 3); g.lineTo(h2.x - 3, h2.y + 3); g.lineTo(h2.x - 4, h2.y + 16); g.lineTo(h1.x + 2, h1.y + 17); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(60,40,20,.5)'; g.lineWidth = 0.8; g.stroke();
      // game hanging from a pole
      var p0 = P(sp, 0.3, 0.84, 0.26), p1 = P(sp, 0.6, 0.84, 0.26);
      g.strokeStyle = '#5b4029'; g.lineWidth = 2; g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke();
      [0.35, 0.45, 0.55].forEach(function (u, i) {
        var q = P(sp, u, 0.84, 0.26);
        g.fillStyle = i === 1 ? '#8a6a4a' : '#6b5a44';
        g.beginPath(); g.ellipse(q.x, q.y + 7, 2.6, 6, 0, 0, 6.3); g.fill();
      });
      logPile(sp, 0.82, 0.82, 2, 'v');
    },

    sawmill: function (sp) {
      box(sp, 0.1, 0.12, 0.82, 0.6, 0, 0.36, plankWall({ col: '#8a6a48', deco: function (g, W, H, L, F) {
        g.fillStyle = 'rgba(20,12,6,.8)'; g.fillRect(W * 0.3, H * 0.28, W * 0.42, H * 0.72);
        win(g, F, W * 0.1, H * 0.3, 10, 10, L);
      } }), plankWall({ col: '#8a6a48' }), false);
      gable(sp, 0.1, 0.12, 0.82, 0.6, 0.36, 0.7, 'u', slateRoof('#6a6660'));
      // the big saw blade in the open bay
      var g = sp.g, c0 = P(sp, 0.46, 0.6, 0.16);
      g.fillStyle = '#c8ccd2'; g.beginPath(); g.arc(c0.x, c0.y, sp.s * 0.07, 0, 6.3); g.fill();
      g.strokeStyle = '#6a6e76'; g.lineWidth = 1; g.stroke();
      for (var i = 0; i < 16; i++) {
        var an = i / 16 * 6.283;
        g.beginPath(); g.moveTo(c0.x + Math.cos(an) * sp.s * .07, c0.y + Math.sin(an) * sp.s * .07);
        g.lineTo(c0.x + Math.cos(an + .2) * sp.s * .082, c0.y + Math.sin(an + .2) * sp.s * .082); g.stroke();
      }
      logPile(sp, 0.84, 0.82, 4, 'v');
      // stacked planks
      box(sp, 0.18, 0.74, 0.5, 0.88, 0, 0.08, plankWall({ col: '#c9a370' }), null, flat('#d8b27a'));
    },

    pasture: function (sp, b) {
      var w = (b && b.compact) ? 1 : 2;
      // a field shelter in the back corner; the fence is drawn as ground cover
      box(sp, 0.1, 0.1, 0.5, 0.36, 0, 0.24, plankWall({ col: '#7d6448' }), plankWall({ col: '#7d6448' }), false);
      gable(sp, 0.1, 0.1, 0.5, 0.36, 0.24, 0.44, 'u', thatchRoof('#b39a66'), plankWall({ col: '#7d6448' }));
      haystack(sp, 0.66, 0.2, 0.7);
      // trough
      box(sp, 0.18, 0.5, 0.42, 0.58, 0, 0.06, plankWall(), null, flat('#3f6e8a'));
      fenceLine(sp, [0.02, 0.02], [w - 0.02, 0.02], w * 5);
      fenceLine(sp, [0.02, 0.02], [0.02, w - 0.02], w * 5);
    },

    weaver: function (sp) {
      cottageBody(sp, 0.14, 0.2, 0.64, 0.66, 0.34, 0.74, 'v', { roof: tileRoof('#9a5a3e') });
      chimney(sp, 0.28, 0.32, 0.5, 0.84, true);
      // cloth hung out to dry on a frame
      var g = sp.g;
      var a0 = P(sp, 0.74, 0.18, 0), a1 = P(sp, 0.74, 0.18, 0.3), b0 = P(sp, 0.74, 0.86, 0), b1 = P(sp, 0.74, 0.86, 0.3);
      shadow(sp, [[0.74, 0.18, 0.3], [0.74, 0.86, 0.3], [0.74, 0.18, 0], [0.74, 0.86, 0]]);
      g.strokeStyle = '#4e3826'; g.lineWidth = 1.8;
      g.beginPath(); g.moveTo(a0.x, a0.y); g.lineTo(a1.x, a1.y); g.lineTo(b1.x, b1.y); g.lineTo(b0.x, b0.y); g.stroke();
      [C.cloth1, C.cloth3, C.cloth2, '#6b8a4a'].forEach(function (c2, i) {
        var p = P(sp, 0.74, 0.24 + i * 0.15, 0.3), q = P(sp, 0.74, 0.34 + i * 0.15, 0.3);
        g.fillStyle = c2;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.lineTo(q.x, q.y + 18); g.quadraticCurveTo((p.x + q.x) / 2, (p.y + q.y) / 2 + 22, p.x, p.y + 17); g.closePath(); g.fill();
        g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(p.x, p.y + 6, q.x - p.x, 2);
      });
    },

    quarry: function (sp) {
      // stepped cuts into a grey face, cut blocks, and a timber crane
      var g = sp.g;
      box(sp, 0.08, 0.08, 0.92, 0.3, 0, 0.42, stoneWall({ col: '#8f8a80', course: 14 }), stoneWall({ col: '#8f8a80', course: 14 }), flat('#a8a296'));
      box(sp, 0.08, 0.3, 0.6, 0.52, 0, 0.26, stoneWall({ col: '#99938a', course: 13 }), stoneWall({ col: '#99938a', course: 13 }), flat('#b4ada2'));
      box(sp, 0.08, 0.52, 0.34, 0.7, 0, 0.12, stoneWall({ col: '#a39d92', course: 12 }), null, flat('#bdb6aa'));
      [[0.62, 0.72], [0.74, 0.8], [0.66, 0.86]].forEach(function (p, i) {
        box(sp, p[0] - 0.05, p[1] - 0.04, p[0] + 0.05, p[1] + 0.04, i === 2 ? 0.08 : 0, i === 2 ? 0.16 : 0.08,
          stoneWall({ col: C.stoneL, ashlar: true, course: 8 }), null, flat('#cfc8ba'));
      });
      // crane
      var base = P(sp, 0.78, 0.46, 0), top = P(sp, 0.78, 0.46, 0.62), arm = P(sp, 0.5, 0.5, 0.58);
      shadow(sp, [[0.78, 0.46, 0], [0.78, 0.46, 0.62], [0.5, 0.5, 0.58], [0.8, 0.48, 0]]);
      g.strokeStyle = '#5b4029'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(base.x - 6, base.y); g.lineTo(top.x, top.y); g.lineTo(base.x + 6, base.y); g.stroke();
      g.lineWidth = 2.4; g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(arm.x, arm.y); g.stroke();
      g.strokeStyle = '#c9b78e'; g.lineWidth = 1; g.beginPath(); g.moveTo(arm.x, arm.y); g.lineTo(arm.x, arm.y + 26); g.stroke();
      g.fillStyle = '#b4ada2'; g.fillRect(arm.x - 5, arm.y + 26, 10, 7);
    },

    mine: function (sp) {
      var g = sp.g;
      // a rocky shoulder with a timbered adit cut into it
      box(sp, 0.06, 0.06, 0.94, 0.5, 0, 0.36, stoneWall({ col: '#7c766c', course: 16, deco: function (gg, W, H, L) {
        gg.fillStyle = '#16120d';
        gg.beginPath(); gg.moveTo(W * 0.36, H); gg.lineTo(W * 0.36, H * 0.4); gg.quadraticCurveTo(W * 0.5, H * 0.18, W * 0.64, H * 0.4); gg.lineTo(W * 0.64, H); gg.closePath(); gg.fill();
        gg.fillStyle = col(C.woodD, L);
        gg.fillRect(W * 0.33, H * 0.36, 5, H * 0.64); gg.fillRect(W * 0.64 - 2, H * 0.36, 5, H * 0.64); gg.fillRect(W * 0.31, H * 0.32, W * 0.38, 6);
      } }), stoneWall({ col: '#7c766c', course: 16 }), flat('#8a8478'));
      cone(sp, 0.5, 0.26, 0.36, 0.36, 0.62, '#77716a');
      // rails and an ore cart
      var r0 = P(sp, 0.5, 0.5, 0), r1 = P(sp, 0.5, 0.98, 0);
      g.strokeStyle = '#4a4d55'; g.lineWidth = 1.4;
      [-4, 4].forEach(function (dx) { g.beginPath(); g.moveTo(r0.x + dx, r0.y); g.lineTo(r1.x + dx, r1.y); g.stroke(); });
      box(sp, 0.42, 0.68, 0.58, 0.8, 0.03, 0.12, plankWall({ col: '#6a5238' }), plankWall({ col: '#6a5238' }), flat('#3d3a36'));
      var ore = P(sp, 0.5, 0.74, 0.13);
      g.fillStyle = '#5a5e68'; g.beginPath(); g.ellipse(ore.x, ore.y, 7, 3.4, 0, 0, 6.3); g.fill();
      // spoil heap
      cone(sp, 0.84, 0.76, 0.12, 0, 0.14, '#6d665c');
      sp.lights.push([0.5, 0.52, 0.12, 0.45, 0.5]);
    },

    smith: function (sp) {
      box(sp, 0.12, 0.14, 0.72, 0.62, 0, 0.36, stoneWall({ deco: function (g, W, H, L, F) {
        // the open forge
        g.fillStyle = '#1a120c'; g.fillRect(W * 0.46, H * 0.3, W * 0.44, H * 0.7);
        var gr = g.createRadialGradient(W * 0.68, H * 0.85, 2, W * 0.68, H * 0.85, 22);
        gr.addColorStop(0, '#fff0a0'); gr.addColorStop(0.35, '#ff9a30'); gr.addColorStop(1, 'rgba(160,40,10,0)');
        g.fillStyle = gr; g.fillRect(W * 0.46, H * 0.3, W * 0.44, H * 0.7);
        F.lamp(W * 0.68, H * 0.8, 0.8, 0.9);
        door(g, F, W * 0.12, H - 28, 12, 28, L);
      } }), stoneWall(), false);
      gable(sp, 0.12, 0.14, 0.72, 0.62, 0.36, 0.66, 'u', slateRoof(), stoneWall());
      chimney(sp, 0.62, 0.3, 0.5, 0.92, true);
      // anvil on its block
      cyl(sp, 0.72, 0.84, 0.05, 0, 0.07, '#6e5238', { capCol: '#7a5a3c' });
      box(sp, 0.66, 0.81, 0.8, 0.87, 0.07, 0.12, flat(C.iron), flat(C.iron, 0.7), flat('#6a6e78'));
      barrel(sp, 0.9, 0.62);
    },

    market: function (sp) {
      // a square of stalls round a market cross
      stall(sp, 0.26, 0.26, '#b3402f', ['#c9542f', '#e0b23c', '#5d9a41']);
      stall(sp, 0.74, 0.28, '#2f5c96', ['#d8c89a', '#8a5ab0', '#c9542f']);
      cyl(sp, 0.5, 0.52, 0.06, 0, 0.1, C.stoneL, {});
      cyl(sp, 0.5, 0.52, 0.025, 0.1, 0.46, C.stone, { cap: false });
      var g = sp.g, x0 = P(sp, 0.5, 0.52, 0.46);
      g.fillStyle = C.stoneL; g.fillRect(x0.x - 6, x0.y + 2, 12, 3);
      stall(sp, 0.28, 0.76, '#3d7a3a', ['#e0b23c', '#e8e0cc', '#9a4a2e']);
      stall(sp, 0.76, 0.74, '#c08a2e', ['#5d9a41', '#b3402f', '#e0b23c']);
      barrel(sp, 0.5, 0.9, 0.8); crate(sp, 0.92, 0.52);
    },

    granary: function (sp) {
      // raised on staddle stones against the rats
      [[0.2, 0.24], [0.7, 0.24], [0.2, 0.72], [0.7, 0.72], [0.45, 0.24], [0.45, 0.72]].forEach(function (p) {
        cyl(sp, p[0], p[1], 0.035, 0, 0.1, C.stone, {});
        cyl(sp, p[0], p[1], 0.06, 0.1, 0.13, C.stoneL, {});
      });
      box(sp, 0.14, 0.18, 0.76, 0.78, 0.13, 0.46, plankWall({ col: '#9c7a50', deco: function (g, W, H, L, F) {
        g.fillStyle = col(C.woodD, L); g.fillRect(W * 0.4, H * 0.3, 18, H * 0.7);
      } }), plankWall({ col: '#9c7a50' }), false);
      gable(sp, 0.14, 0.18, 0.76, 0.78, 0.46, 0.86, 'u', thatchRoof());
      sack(sp, 0.84, 0.86); sack(sp, 0.9, 0.78); sack(sp, 0.84, 0.72);
    },

    warehouse: function (sp) {
      box(sp, 0.06, 0.1, 0.94, 0.7, 0, 0.44, plankWall({ col: '#7a5e40', deco: function (g, W, H, L, F) {
        g.fillStyle = col('#4e3826', L); g.fillRect(W * 0.34, H * 0.28, W * 0.32, H * 0.72);
        g.strokeStyle = col('#a98256', L); g.lineWidth = 2;
        g.beginPath(); g.moveTo(W * 0.34, H * 0.28); g.lineTo(W * 0.66, H); g.moveTo(W * 0.66, H * 0.28); g.lineTo(W * 0.34, H); g.stroke();
        g.strokeRect(W * 0.34, H * 0.28, W * 0.32, H * 0.72);
        F.lamp(W * 0.5, H * 0.2, 0.45, 0.45);
      } }), plankWall({ col: '#7a5e40' }), false);
      gable(sp, 0.06, 0.1, 0.94, 0.7, 0.44, 0.82, 'u', slateRoof('#6a6660'));
      crate(sp, 0.18, 0.84); crate(sp, 0.3, 0.86); crate(sp, 0.24, 0.84, 0.8);
      barrel(sp, 0.84, 0.84); barrel(sp, 0.74, 0.88);
    },

    well: function (sp) {
      cyl(sp, 0.5, 0.5, 0.2, 0, 0.16, C.stone, { courses: 7, capCol: '#8a8478' });
      var g = sp.g, w0 = P(sp, 0.5, 0.5, 0.16);
      g.fillStyle = '#1d3346'; g.beginPath(); g.ellipse(w0.x, w0.y, sp.s * 0.11, sp.s * 0.055, 0, 0, 6.3); g.fill();
      g.fillStyle = 'rgba(160,200,230,.35)'; g.beginPath(); g.ellipse(w0.x - 3, w0.y - 1, sp.s * 0.05, sp.s * 0.02, 0, 0, 6.3); g.fill();
      [[0.34, 0.34], [0.66, 0.66]].forEach(function (p) {
        var a = P(sp, p[0], p[1], 0.14), b2 = P(sp, p[0], p[1], 0.5);
        g.strokeStyle = C.woodD; g.lineWidth = 3; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b2.x, b2.y); g.stroke();
      });
      var r0 = P(sp, 0.34, 0.34, 0.42), r1 = P(sp, 0.66, 0.66, 0.42);
      g.strokeStyle = C.wood; g.lineWidth = 2.4; g.beginPath(); g.moveTo(r0.x, r0.y); g.lineTo(r1.x, r1.y); g.stroke();
      g.strokeStyle = '#c9b78e'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(w0.x, w0.y - sp.UP * 0.26); g.lineTo(w0.x, w0.y - 2); g.stroke();
      gable(sp, 0.3, 0.3, 0.7, 0.7, 0.48, 0.66, 'u', shingleRoof(), flat(C.woodD), 0.04);
      box(sp, 0.72, 0.74, 0.8, 0.82, 0, 0.07, plankWall(), null, flat('#3f6e8a'));
    },

    chapel: function (sp) {
      // nave
      box(sp, 0.1, 0.24, 0.62, 0.74, 0, 0.44, stoneWall({ col: '#b5ad9c', deco: function (g, W, H, L, F) {
        win(g, F, W * 0.18, H * 0.2, 11, 22, L, { arch: true, stained: true, frame: '#8a8272', glow: 0.5, str: 0.6 });
        win(g, F, W * 0.58, H * 0.2, 11, 22, L, { arch: true, stained: true, frame: '#8a8272', glow: 0.5, str: 0.6 });
      } }), stoneWall({ col: '#b5ad9c', deco: function (g, W, H, L, F) {
        win(g, F, W * 0.38, H * 0.18, 13, 26, L, { arch: true, stained: true, frame: '#8a8272', glow: 0.5, str: 0.6 });
      } }), false);
      gable(sp, 0.1, 0.24, 0.62, 0.74, 0.44, 0.82, 'u', slateRoof(), stoneWall({ col: '#b5ad9c' }));
      // bell tower with a spire
      box(sp, 0.62, 0.3, 0.9, 0.66, 0, 0.98, stoneWall({ col: '#bfb7a6', deco: function (g, W, H, L, F) {
        door(g, F, W / 2 - 8, H - 30, 16, 30, L, { lamp: true });
        g.fillStyle = '#1c1612'; g.beginPath(); g.moveTo(W / 2 - 7, H * 0.2); g.lineTo(W / 2 - 7, H * 0.1); g.arc(W / 2, H * 0.1, 7, Math.PI, 0); g.lineTo(W / 2 + 7, H * 0.2); g.fill();
      } }), stoneWall({ col: '#bfb7a6', deco: function (g, W, H, L, F) {
        g.fillStyle = '#1c1612'; g.beginPath(); g.moveTo(W / 2 - 7, H * 0.2); g.lineTo(W / 2 - 7, H * 0.1); g.arc(W / 2, H * 0.1, 7, Math.PI, 0); g.lineTo(W / 2 + 7, H * 0.2); g.fill();
      } }), flat(C.stoneD));
      hip(sp, 0.62, 0.3, 0.9, 0.66, 0.98, 1.62, slateRoof(), 0.03, false);
      var g = sp.g, tip = P(sp, 0.76, 0.48, 1.62);
      g.fillStyle = C.gold; g.fillRect(tip.x - 1.2, tip.y - 14, 2.4, 14); g.fillRect(tip.x - 5, tip.y - 10, 10, 2.4);
    },

    tavern: function (sp) {
      box(sp, 0.08, 0.16, 0.86, 0.72, 0, 0.3, stoneWall({ deco: function (g, W, H, L, F) {
        door(g, F, W * 0.44, H - 30, 14, 30, L, { lamp: true });
        win(g, F, W * 0.12, H * 0.25, 14, 12, L, { glow: 0.55, str: 0.7 });
        win(g, F, W * 0.72, H * 0.25, 14, 12, L, { glow: 0.55, str: 0.7 });
      } }), stoneWall({ deco: function (g, W, H, L, F) { win(g, F, W * 0.35, H * 0.25, 14, 12, L, { glow: 0.55, str: 0.7 }); } }), false);
      box(sp, 0.06, 0.14, 0.88, 0.76, 0.3, 0.6, plasterWall({ timber: true, deco: function (g, W, H, L, F) {
        [0.12, 0.42, 0.72].forEach(function (f) { win(g, F, W * f, H * 0.3, 11, 12, L, { box: f !== 0.42 }); });
      } }), plasterWall({ timber: true, flip: true, deco: function (g, W, H, L, F) { win(g, F, W * 0.35, H * 0.3, 11, 12, L); } }), false);
      gable(sp, 0.06, 0.14, 0.88, 0.76, 0.6, 0.98, 'u', thatchRoof(), plasterWall({ timber: true }));
      chimney(sp, 0.24, 0.3, 0.8, 1.1, true);
      // hanging sign, benches and barrels
      var g = sp.g, s0 = P(sp, 0.3, 0.86, 0.34), s1 = P(sp, 0.3, 0.96, 0.34);
      g.strokeStyle = C.woodD; g.lineWidth = 2; g.beginPath(); g.moveTo(s0.x, s0.y); g.lineTo(s1.x, s1.y); g.stroke();
      g.fillStyle = '#7a5634'; g.fillRect(s1.x - 6, s1.y + 2, 12, 10);
      g.fillStyle = C.gold; g.beginPath(); g.arc(s1.x, s1.y + 7, 3, 0, 6.3); g.fill();
      barrel(sp, 0.92, 0.3); barrel(sp, 0.95, 0.42, 0.9);
      box(sp, 0.55, 0.86, 0.8, 0.9, 0, 0.06, plankWall(), null, flat('#8a6440'));
    },

    library: function (sp) {
      box(sp, 0.08, 0.14, 0.9, 0.7, 0, 0.56, stoneWall({ col: '#d3cab6', ashlar: true, deco: function (g, W, H, L, F) {
        [0.1, 0.3, 0.62, 0.82].forEach(function (f) { win(g, F, W * f, H * 0.18, 11, 30, L, { arch: true, frame: '#a39a86' }); });
        door(g, F, W * 0.45, H - 36, 16, 36, L, { lamp: true, col: '#4a3226' });
      } }), stoneWall({ col: '#d3cab6', ashlar: true, deco: function (g, W, H, L, F) {
        [0.2, 0.6].forEach(function (f) { win(g, F, W * f, H * 0.18, 11, 30, L, { arch: true, frame: '#a39a86' }); });
      } }), false);
      hip(sp, 0.08, 0.14, 0.9, 0.7, 0.56, 0.84, tileRoof('#8e4d3a'));
      // a copper cupola
      cyl(sp, 0.49, 0.42, 0.1, 0.84, 1.0, '#d3cab6', { cap: false });
      cone(sp, 0.49, 0.42, 0.12, 1.0, 1.22, '#5f9a86');
      // columns of the porch
      [0.3, 0.46, 0.62].forEach(function (u) { cyl(sp, u, 0.8, 0.025, 0, 0.4, '#e8e0cc', { cap: false }); });
      box(sp, 0.22, 0.74, 0.7, 0.86, 0.4, 0.46, stoneWall({ col: '#e0d8c4', course: 6 }), null, flat('#e8e0cc'));
    },

    barracks: function (sp) {
      box(sp, 0.06, 0.16, 0.94, 0.62, 0, 0.34, logWall({ deco: function (g, W, H, L, F) {
        door(g, F, W * 0.45, H - 28, 14, 28, L, { lamp: true });
        win(g, F, W * 0.12, H * 0.3, 10, 9, L); win(g, F, W * 0.78, H * 0.3, 10, 9, L);
      } }), logWall(), false);
      gable(sp, 0.06, 0.16, 0.94, 0.62, 0.34, 0.68, 'u', shingleRoof('#5e4a36'), logWall());
      // weapon rack and a training dummy
      var g = sp.g;
      for (var i = 0; i < 4; i++) {
        var a = P(sp, 0.14 + i * 0.05, 0.84, 0), b2 = P(sp, 0.16 + i * 0.05, 0.8, 0.28);
        g.strokeStyle = '#6b4a2e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b2.x, b2.y); g.stroke();
        g.fillStyle = '#c8ccd4'; g.beginPath(); g.moveTo(b2.x, b2.y - 6); g.lineTo(b2.x - 2, b2.y); g.lineTo(b2.x + 2, b2.y); g.fill();
      }
      var d0 = P(sp, 0.74, 0.84, 0), d1 = P(sp, 0.74, 0.84, 0.3);
      shadow(sp, [[0.72, 0.82, 0], [0.76, 0.86, 0], [0.74, 0.84, 0.3]]);
      g.strokeStyle = '#5b4029'; g.lineWidth = 2; g.beginPath(); g.moveTo(d0.x, d0.y); g.lineTo(d1.x, d1.y); g.stroke();
      g.beginPath(); g.moveTo(d1.x - 8, d1.y + 8); g.lineTo(d1.x + 8, d1.y + 8); g.stroke();
      g.fillStyle = C.hay; g.beginPath(); g.ellipse(d1.x, d1.y + 12, 5, 8, 0, 0, 6.3); g.fill();
      g.beginPath(); g.arc(d1.x, d1.y, 4, 0, 6.3); g.fill();
      flag(sp, 0.02, 0.62, 0.72, C.red, true);
    },

    range: function (sp) {
      // an open-fronted shelter and a row of butts
      [[0.12, 0.14], [0.12, 0.52], [0.34, 0.14], [0.34, 0.52]].forEach(function (p) { cyl(sp, p[0], p[1], 0.02, 0, 0.3, C.woodD, { cap: false }); });
      gable(sp, 0.1, 0.12, 0.36, 0.54, 0.3, 0.46, 'v', thatchRoof(), flat(C.woodD), 0.04);
      [[0.8, 0.24], [0.8, 0.54], [0.8, 0.84]].forEach(function (p) {
        var g = sp.g, c0 = P(sp, p[0], p[1], 0.14);
        shadow(sp, [[p[0], p[1] - .08, 0], [p[0], p[1] + .08, 0], [p[0], p[1], 0.24]]);
        g.strokeStyle = C.woodD; g.lineWidth = 1.6;
        var f0 = P(sp, p[0] + 0.05, p[1], 0);
        g.beginPath(); g.moveTo(f0.x, f0.y); g.lineTo(c0.x, c0.y); g.stroke();
        g.fillStyle = '#e8dcb5'; g.beginPath(); g.ellipse(c0.x, c0.y, 9, 11, -0.35, 0, 6.3); g.fill();
        g.strokeStyle = '#8a7a5a'; g.lineWidth = 1; g.stroke();
        g.fillStyle = C.red; g.beginPath(); g.ellipse(c0.x, c0.y, 5.5, 6.8, -0.35, 0, 6.3); g.fill();
        g.fillStyle = C.gold; g.beginPath(); g.ellipse(c0.x, c0.y, 2.2, 2.8, -0.35, 0, 6.3); g.fill();
      });
      flag(sp, 0.4, 0.9, 0.5, C.blue);
    },

    tower: function (sp) {
      cyl(sp, 0.5, 0.5, 0.26, 0, 1.2, C.stone, { courses: 9, cap: false });
      var g = sp.g;
      [0.4, 0.75].forEach(function (hh) {
        var p = P(sp, 0.38, 0.72, hh);
        g.fillStyle = '#1c1612'; g.fillRect(p.x - 2, p.y - 7, 4, 12);
      });
      sp.lights.push([0.38, 0.74, 0.75, 0.35, 0.5]);
      cyl(sp, 0.5, 0.5, 0.31, 1.2, 1.3, C.stoneL, { courses: 0, capCol: '#8a8274' });
      for (var i = 0; i < 8; i++) {
        var an = (i + 0.5) / 8 * Math.PI;   // the half facing us
        var u = 0.5 + Math.cos(an) * 0.28 * 0.7071 + Math.sin(an) * 0.28 * 0.7071;
        var v = 0.5 - Math.cos(an) * 0.28 * 0.7071 + Math.sin(an) * 0.28 * 0.7071;
        box(sp, u - 0.035, v - 0.035, u + 0.035, v + 0.035, 1.3, 1.4, stoneWall({ course: 5 }), null, flat(C.stoneL));
      }
      cone(sp, 0.5, 0.5, 0.2, 1.36, 1.8, C.slate);
      flag(sp, 0.5, 0.5, 2.05, C.gold);
      sp.lights.push([0.5, 0.5, 1.4, 0.7, 0.55]);
    },

    cathedral: function (sp) {
      var B = '#cdc4b0', sw = function (deco) { return stoneWall({ col: B, ashlar: true, course: 9, deco: deco }); };
      var lancets = function (g, W, H, L, F) {
        for (var x = 16; x < W - 16; x += 30) win(g, F, x, H * 0.22, 12, H * 0.52, L, { arch: true, stained: true, frame: '#8a8272', glow: 0.5, str: 0.6 });
        g.fillStyle = col('#a39a86', L); g.fillRect(0, H * 0.12, W, 3);
      };
      // choir and apse at the far end
      box(sp, 0.35, 1.05, 0.95, 1.95, 0, 0.7, sw(lancets), sw(lancets), false);
      gable(sp, 0.35, 1.05, 0.95, 1.95, 0.7, 1.15, 'u', slateRoof('#56606c'), sw());
      // the nave, long and high
      box(sp, 0.95, 1.0, 2.55, 2.0, 0, 0.95, sw(lancets), sw(lancets), false);
      // flying buttresses along the front flank
      [1.2, 1.6, 2.0, 2.35].forEach(function (u) {
        box(sp, u - 0.05, 2.0, u + 0.05, 2.28, 0, 0.62, sw(), sw(), flat(C.stoneL));
      });
      gable(sp, 0.95, 1.0, 2.55, 2.0, 0.95, 1.55, 'u', slateRoof('#56606c'), sw(function (g, W, H, L, F) {
        // the rose window in the west gable
        var cx = W / 2, cy = H * 0.62, r = Math.min(W, H) * 0.24;
        g.fillStyle = col('#8a8272', L); g.beginPath(); g.arc(cx, cy, r + 3, 0, 6.3); g.fill();
        var gr = g.createRadialGradient(cx, cy, 1, cx, cy, r);
        gr.addColorStop(0, '#f0c850'); gr.addColorStop(0.5, '#a83a4a'); gr.addColorStop(1, '#2f4f86');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 6.3); g.fill();
        g.strokeStyle = col('#8a8272', L); g.lineWidth = 1.4;
        for (var i = 0; i < 12; i++) { var a = i / 12 * 6.283; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke(); }
        F.lamp(cx, cy, 0.9, 0.7);
      }));
      // the transept crossing the nave, with its own gable to the front
      box(sp, 1.55, 0.55, 2.05, 2.45, 0, 1.0, sw(function (g, W, H, L, F) {
        door(g, F, W / 2 - 12, H - 40, 24, 40, L, { lamp: true, col: '#4a3226' });
        win(g, F, W / 2 - 8, H * 0.2, 16, H * 0.36, L, { arch: true, stained: true, frame: '#8a8272', glow: 0.6, str: 0.7 });
      }), sw(lancets), false);
      gable(sp, 1.55, 0.55, 2.05, 2.45, 1.0, 1.5, 'v', slateRoof('#56606c'), sw());
      // the spire over the crossing
      box(sp, 1.62, 1.32, 1.98, 1.68, 1.2, 1.9, sw(function (g, W, H, L, F) { win(g, F, W / 2 - 6, H * 0.25, 12, H * 0.5, L, { arch: true, frame: '#8a8272' }); }),
        sw(function (g, W, H, L, F) { win(g, F, W / 2 - 6, H * 0.25, 12, H * 0.5, L, { arch: true, frame: '#8a8272' }); }), flat(C.stoneD));
      hip(sp, 1.62, 1.32, 1.98, 1.68, 1.9, 3.1, slateRoof('#4a5460'), 0.02, false);
      var g = sp.g, tip = P(sp, 1.8, 1.5, 3.1);
      g.fillStyle = C.gold; g.fillRect(tip.x - 1.6, tip.y - 18, 3.2, 18); g.fillRect(tip.x - 6, tip.y - 13, 12, 3);
      // twin towers on the west front
      [[2.55, 1.0], [2.55, 1.62]].forEach(function (t) {
        box(sp, t[0], t[1], t[0] + 0.38, t[1] + 0.38, 0, 1.75, sw(function (g2, W, H, L, F) {
          for (var f = 0.12; f < 0.9; f += 0.26) win(g2, F, W / 2 - 5, H * f, 10, H * 0.14, L, { arch: true, frame: '#8a8272' });
        }), sw(function (g2, W, H, L, F) {
          for (var f = 0.12; f < 0.9; f += 0.26) win(g2, F, W / 2 - 5, H * f, 10, H * 0.14, L, { arch: true, frame: '#8a8272' });
          if (t[1] > 1.5) door(g2, F, W / 2 - 10, H - 36, 20, 36, L, { lamp: true, col: '#4a3226' });
        }), flat(C.stoneD));
        crenels(sp, [t[0] + 0.36, t[1] + 0.03], [t[0] + 0.36, t[1] + 0.35], 1.75, 4, B);
        crenels(sp, [t[0] + 0.03, t[1] + 0.36], [t[0] + 0.35, t[1] + 0.36], 1.75, 4, B);
        hip(sp, t[0] + 0.04, t[1] + 0.04, t[0] + 0.34, t[1] + 0.34, 1.78, 2.55, slateRoof('#4a5460'), 0.0, false);
      });
      flag(sp, 2.74, 1.19, 2.95, C.gold, true);
      flag(sp, 2.74, 1.81, 2.95, C.gold, true);
    },

    wall: function (sp, b) {
      var m = (b && b._mask) || 0;   // 1 −v, 2 +u, 4 +v, 8 −u
      var H = 0.5, T = 0.16;
      var sw = stoneWall({ course: 9 }), tp = flat(C.stoneL);
      // arms reaching toward neighbouring wall, back arms first
      if (m & 1) box(sp, 0.5 - T, 0, 0.5 + T, 0.5 - T, 0, H, sw, sw, tp);
      if (m & 8) box(sp, 0, 0.5 - T, 0.5 - T, 0.5 + T, 0, H, sw, sw, tp);
      box(sp, 0.5 - T - 0.02, 0.5 - T - 0.02, 0.5 + T + 0.02, 0.5 + T + 0.02, 0, H + 0.08, sw, sw, tp);
      if (m & 2) box(sp, 0.5 + T, 0.5 - T, 1, 0.5 + T, 0, H, sw, sw, tp);
      if (m & 4) box(sp, 0.5 - T, 0.5 + T, 0.5 + T, 1, 0, H, sw, sw, tp);
      // merlons along the outer edge of each arm
      if (m & 2) crenels(sp, [0.6, 0.5 + T - 0.03], [1, 0.5 + T - 0.03], H, 4);
      if (m & 4) crenels(sp, [0.5 + T - 0.03, 0.6], [0.5 + T - 0.03, 1], H, 4);
      if (!m) crenels(sp, [0.36, 0.64], [0.64, 0.64], H + 0.08, 2);
    }
  };

  /* ---------------- the four castles ---------------- */
  function palisade(sp, a, b, n, hgt) {
    var g = sp.g;
    for (var i = 0; i <= n; i++) {
      var u = a[0] + (b[0] - a[0]) * i / n, v = a[1] + (b[1] - a[1]) * i / n;
      cyl(sp, u, v, 0.035, 0, hgt + (i % 2) * 0.03, '#7a5634', { cap: false });
      var t = P(sp, u, v, hgt + (i % 2) * 0.03);
      g.fillStyle = '#5b4029'; g.beginPath(); g.moveTo(t.x - 3.2, t.y); g.lineTo(t.x, t.y - 6); g.lineTo(t.x + 3.2, t.y); g.fill();
    }
  }
  function curtain(sp, u0, v0, u1, v1, H, T, base, side) {
    // side: which edge of the square: 'nv' back, 'nu' left-back, 'u' right, 'v' front
    var sw = stoneWall({ col: base, course: 11 }), tp = flat(base === C.stone ? C.stoneL : '#e8e2d4');
    if (side === 'nv') box(sp, u0, v0, u1, v0 + T, 0, H, sw, sw, tp);
    if (side === 'nu') box(sp, u0, v0, u0 + T, v1, 0, H, sw, sw, tp);
    if (side === 'u') { box(sp, u1 - T, v0, u1, v1, 0, H, sw, sw, tp); crenels(sp, [u1 - 0.02, v0 + 0.1], [u1 - 0.02, v1 - 0.1], H, 10, base); }
    if (side === 'v') { box(sp, u0, v1 - T, u1, v1, 0, H, sw, sw, tp); crenels(sp, [u0 + 0.1, v1 - 0.02], [u1 - 0.1, v1 - 0.02], H, 10, base); }
  }
  function roundTower(sp, u, v, r, H, base, roofCol) {
    cyl(sp, u, v, r, 0, H, base, { courses: 9, cap: false });
    cyl(sp, u, v, r + 0.03, H, H + 0.08, base === C.stone ? C.stoneL : '#ece6d8', { capCol: '#8a8274' });
    if (roofCol) cone(sp, u, v, r + 0.02, H + 0.06, H + 0.06 + r * 2.1, roofCol);
    sp.lights.push([u - r * 0.5, v + r * 0.7, H * 0.6, 0.35, 0.45]);
  }
  function keep(sp, u0, v0, u1, v1, H, base, roof, roofH) {
    box(sp, u0, v0, u1, v1, 0, H, stoneWall({ col: base, ashlar: true, deco: function (g, W, Hh, L, F) {
      for (var f = 0.2; f < 0.95; f += 0.3) {
        win(g, F, W * 0.2, Hh * f, 9, 15, L, { arch: true, frame: '#6f685c' });
        win(g, F, W * 0.7, Hh * f, 9, 15, L, { arch: true, frame: '#6f685c' });
      }
    } }), stoneWall({ col: base, ashlar: true, deco: function (g, W, Hh, L, F) {
      for (var f = 0.2; f < 0.95; f += 0.3) win(g, F, W * 0.45, Hh * f, 9, 15, L, { arch: true, frame: '#6f685c' });
    } }), flat(C.stoneD));
    if (roof) hip(sp, u0, v0, u1, v1, H, H + roofH, roof, 0.04);
    else {
      crenels(sp, [u1 - 0.02, v0 + 0.05], [u1 - 0.02, v1 - 0.05], H, 8, base);
      crenels(sp, [u0 + 0.05, v1 - 0.02], [u1 - 0.05, v1 - 0.02], H, 8, base);
    }
  }
  function gatehouse(sp, u0, u1, v, H, base) {
    box(sp, u0, v - 0.2, u1, v, 0, H, stoneWall({ col: base, deco: function (g, W, Hh, L, F) {
      g.fillStyle = '#1a140e';
      g.beginPath(); g.moveTo(W * 0.3, Hh); g.lineTo(W * 0.3, Hh * 0.55); g.arc(W * 0.5, Hh * 0.55, W * 0.2, Math.PI, 0); g.lineTo(W * 0.7, Hh); g.fill();
      g.strokeStyle = 'rgba(120,120,130,.8)'; g.lineWidth = 1.2;
      for (var x = W * 0.33; x < W * 0.68; x += 5) { g.beginPath(); g.moveTo(x, Hh * 0.5); g.lineTo(x, Hh); g.stroke(); }
      F.lamp(W * 0.15, Hh * 0.45, 0.55, 0.6); F.lamp(W * 0.85, Hh * 0.45, 0.55, 0.6);
    } }), stoneWall({ col: base }), flat(C.stoneD));
    crenels(sp, [u0 + 0.03, v - 0.02], [u1 - 0.03, v - 0.02], H, 6, base);
  }
  var CASTLES = [
    function hall(sp) {
      palisade(sp, [0.1, 0.1], [1.9, 0.1], 18, 0.36);
      palisade(sp, [0.1, 0.1], [0.1, 1.9], 18, 0.36);
      box(sp, 0.45, 0.5, 1.55, 1.2, 0, 0.42, logWall({ deco: function (g, W, H, L, F) {
        door(g, F, W * 0.46, H - 34, 18, 34, L, { lamp: true });
        win(g, F, W * 0.16, H * 0.3, 11, 11, L); win(g, F, W * 0.78, H * 0.3, 11, 11, L);
      } }), logWall({ deco: function (g, W, H, L, F) { win(g, F, W * 0.4, H * 0.3, 11, 11, L); } }), false);
      gable(sp, 0.45, 0.5, 1.55, 1.2, 0.42, 1.0, 'u', shingleRoof('#6a5238'), logWall());
      chimney(sp, 0.7, 0.72, 0.8, 1.18, true);
      flag(sp, 1.55, 1.3, 0.9, C.banner, true);
      palisade(sp, [1.9, 0.1], [1.9, 1.9], 18, 0.36);
      palisade(sp, [0.1, 1.9], [0.8, 1.9], 7, 0.36);
      palisade(sp, [1.2, 1.9], [1.9, 1.9], 7, 0.36);
      box(sp, 0.8, 1.84, 0.84, 1.92, 0, 0.5, flat(C.woodD), null, flat(C.woodD));
      box(sp, 1.16, 1.84, 1.2, 1.92, 0, 0.5, flat(C.woodD), null, flat(C.woodD));
    },
    function stoneKeep(sp) {
      var B = C.stone;
      curtain(sp, 0.1, 0.1, 1.9, 1.9, 0.42, 0.14, B, 'nv');
      curtain(sp, 0.1, 0.1, 1.9, 1.9, 0.42, 0.14, B, 'nu');
      roundTower(sp, 0.16, 0.16, 0.16, 0.6, B, null);
      keep(sp, 0.6, 0.55, 1.4, 1.3, 1.25, B, null);
      flag(sp, 1.3, 1.2, 1.7, C.banner, true);
      roundTower(sp, 1.84, 0.16, 0.16, 0.6, B, null);
      roundTower(sp, 0.16, 1.84, 0.16, 0.6, B, null);
      curtain(sp, 0.1, 0.1, 1.9, 1.9, 0.42, 0.14, B, 'u');
      curtain(sp, 0.1, 0.1, 1.9, 1.9, 0.42, 0.14, B, 'v');
      gatehouse(sp, 0.75, 1.25, 1.95, 0.62, B);
      roundTower(sp, 1.84, 1.84, 0.16, 0.6, B, null);
    },
    function greatCastle(sp) {
      var B = C.stone;
      curtain(sp, 0.08, 0.08, 1.92, 1.92, 0.5, 0.14, B, 'nv');
      curtain(sp, 0.08, 0.08, 1.92, 1.92, 0.5, 0.14, B, 'nu');
      roundTower(sp, 0.16, 0.16, 0.19, 0.78, B, C.slate);
      keep(sp, 0.52, 0.48, 1.35, 1.25, 1.35, B, slateRoof(), 0.55);
      box(sp, 1.1, 0.3, 1.5, 0.7, 0, 0.9, stoneWall({ col: B }), stoneWall({ col: B }), flat(C.stoneD));
      hip(sp, 1.1, 0.3, 1.5, 0.7, 0.9, 1.25, slateRoof(), 0.03);
      flag(sp, 0.95, 0.88, 2.15, C.banner, true);
      roundTower(sp, 1.84, 0.16, 0.19, 0.78, B, C.slate);
      roundTower(sp, 0.16, 1.84, 0.19, 0.78, B, C.slate);
      curtain(sp, 0.08, 0.08, 1.92, 1.92, 0.5, 0.14, B, 'u');
      curtain(sp, 0.08, 0.08, 1.92, 1.92, 0.5, 0.14, B, 'v');
      gatehouse(sp, 0.72, 1.28, 1.97, 0.72, B);
      roundTower(sp, 1.84, 1.84, 0.19, 0.78, B, C.slate);
    },
    function citadel(sp) {
      var B = '#d6cfbf';
      curtain(sp, 0.04, 0.04, 1.96, 1.96, 0.6, 0.15, B, 'nv');
      curtain(sp, 0.04, 0.04, 1.96, 1.96, 0.6, 0.15, B, 'nu');
      roundTower(sp, 0.14, 0.14, 0.22, 0.98, B, C.blue);
      roundTower(sp, 1.0, 0.18, 0.16, 1.2, B, C.blue);
      keep(sp, 0.5, 0.46, 1.4, 1.3, 1.6, B, slateRoof('#3e5f86'), 0.6);
      roundTower(sp, 0.5, 0.46, 0.13, 2.0, B, C.blue);
      flag(sp, 0.5, 0.46, 2.55, C.banner, true);
      roundTower(sp, 1.4, 1.3, 0.13, 1.9, B, C.blue);
      roundTower(sp, 1.86, 0.14, 0.22, 0.98, B, C.blue);
      roundTower(sp, 0.14, 1.86, 0.22, 0.98, B, C.blue);
      curtain(sp, 0.04, 0.04, 1.96, 1.96, 0.6, 0.15, B, 'u');
      curtain(sp, 0.04, 0.04, 1.96, 1.96, 0.6, 0.15, B, 'v');
      gatehouse(sp, 0.7, 1.3, 1.99, 0.86, B);
      flag(sp, 0.72, 2.02, 1.15, C.banner2, true); flag(sp, 1.28, 2.02, 1.15, C.banner2, true);
      roundTower(sp, 1.86, 1.86, 0.22, 0.98, B, C.blue);
    }
  ];

  /* heights so each sprite's canvas is tall enough */
  var MAXH = {
    castle: [1.4, 1.9, 2.4, 2.9], house: [0.9, 1.2, 1.5], manor: 1.2, farm: 0.8, fishery: 0.7, bakery: 0.8,
    windmill: 1.9, lumber: 0.75, hunter: 0.7, sawmill: 0.8, pasture: 0.5, weaver: 0.9, quarry: 0.7, mine: 0.7,
    smith: 1.0, market: 0.5, granary: 0.95, warehouse: 0.9, well: 0.7, chapel: 1.8, tavern: 1.15,
    library: 1.3, barracks: 0.9, range: 0.6, tower: 2.3, wall: 0.7, cathedral: 3.4
  };

  /* Cut a finished sprite down to the pixels actually painted (its own and
     its shadow's), so drawing it touches as little empty canvas as possible.
     Hundreds of trees a frame make this matter. */
  function trim(out) {
    var c = out.c, W0 = c.width, H0 = c.height;
    var d = c.getContext('2d').getImageData(0, 0, W0, H0).data;
    var d2 = out.sh ? out.sh.getContext('2d').getImageData(0, 0, W0, H0).data : null;
    var x0 = W0, y0 = H0, x1 = -1, y1 = -1;
    for (var y = 0; y < H0; y++) {
      var row = y * W0 * 4;
      for (var x = 0; x < W0; x++) {
        var i = row + x * 4 + 3;
        if (d[i] > 3 || (d2 && d2[i] > 3)) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return out;
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1);
    var w = Math.min(W0, x1 + 2) - x0, h = Math.min(H0, y1 + 2) - y0;
    var nc = canvas(w, h);
    nc.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
    out.c = nc;
    if (out.sh) {
      var ns = canvas(w, h);
      ns.getContext('2d').drawImage(out.sh, x0, y0, w, h, 0, 0, w, h);
      out.sh = ns;
    }
    out.ax -= x0; out.ay -= y0;
    if (out.hub) out.hub = [out.hub[0] - x0, out.hub[1] - y0];
    return out;
  }

  /* ---------------- sprite cache ---------------- */
  var cache = {};
  function keyOf(b, winter) {
    var id = b.id, k = id;
    if (id === 'castle') k += (b._tier !== undefined ? b._tier : (SIM.G ? SIM.G.castle : 0));
    if (b.def && b.def.evolves) k += (b.level || 1);
    if (b.compact) k += 'c';
    if (id === 'fishery') k += (b._dir || fishDir(b));
    if (id === 'wall') k += (b._mask !== undefined ? b._mask : wallMask(b));
    return k + (winter ? 'W' : '');
  }
  function fishDir(b) {
    if (b._dir) return b._dir;
    if (b.x === undefined) return 'v';
    var opts = [['v', 0, 1], ['u', 1, 0], ['nv', 0, -1], ['nu', -1, 0]];
    for (var i = 0; i < opts.length; i++) {
      var t = W.at(b.x + opts[i][1], b.y + opts[i][2]);
      if (t && (t.terr === 'water' || t.terr === 'shore')) return opts[i][0];
    }
    return 'v';
  }
  function wallMask(b) {
    if (b.x === undefined) return 0;
    var m = 0;
    [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]].forEach(function (d) {
      var t = W.at(b.x + d[0], b.y + d[1]);
      if (t && t.bld && t.bld.def.isWall) m |= d[2];
    });
    return m;
  }

  function building(b, season) {
    var winter = season === 'winter';
    var k = keyOf(b, winter);
    if (cache[k]) return cache[k];
    var id = b.id, def = b.def || DATA.B[id];
    var w = def.w || 1, h = def.h || 1;
    if (b.compact) { w = 1; h = 1; }
    var mh = MAXH[id];
    if (Array.isArray(mh)) mh = mh[id === 'castle' ? (b._tier !== undefined ? b._tier : (SIM.G ? SIM.G.castle : 0)) : (b.level || 1) - 1];
    var sp = Sprite(w, h, mh || 1, id === 'fishery' ? 1.2 : 0, k);
    var rec = { id: id, def: def, level: b.level, compact: b.compact, _tier: b._tier, x: b.x, y: b.y,
      _dir: id === 'fishery' ? fishDir(b) : undefined, _mask: id === 'wall' ? wallMask(b) : undefined };
    WINTER = winter;
    if (DRAW[id]) DRAW[id](sp, rec);
    WINTER = false;
    var out = trim({ c: sp.c, sh: sp.sh, ax: sp.ax, ay: sp.ay, s: sp.s, top: mh || 1, lights: sp.lights, chimneys: sp.chimneys, hub: sp.hub });
    cache[k] = out;
    return out;
  }
  function lightsOf(b) {
    if (!b.built) return null;
    var sp = building(b, 'summer');
    return sp.lights;
  }
  /* a wall's look depends on its neighbours, so forget cached masks when
     walls come and go (the key includes the mask, so nothing goes stale) */

  /* ---------------- construction ---------------- */
  function scaffold(b) {
    var def = b.def, w = def.w || 1, h = def.h || 1;
    if (b.compact) { w = 1; h = 1; }
    var stage = b.prog < 0.3 ? 0 : b.prog < 0.65 ? 1 : 2;
    var k = 'scaf' + w + 'x' + h + ':' + stage;
    if (cache[k]) return cache[k];
    var sp = Sprite(w, h, 1.0, 0, k);
    var g = sp.g;
    // foundations marked out in stone
    var f0 = 0.14, f1u = w - 0.14, f1v = h - 0.14;
    box(sp, f0, f0, f1u, f0 + 0.05, 0, 0.05, stoneWall({ course: 5 }), null, flat(C.stoneL));
    box(sp, f0, f0, f0 + 0.05, f1v, 0, 0.05, stoneWall({ course: 5 }), null, flat(C.stoneL));
    box(sp, f1u - 0.05, f0, f1u, f1v, 0, 0.05, stoneWall({ course: 5 }), null, flat(C.stoneL));
    box(sp, f0, f1v - 0.05, f1u, f1v, 0, 0.05, stoneWall({ course: 5 }), null, flat(C.stoneL));
    if (stage >= 1) {
      // poles and boards
      var H = stage === 1 ? 0.45 : 0.75;
      [[f0, f0], [f1u, f0], [f0, f1v], [f1u, f1v], [(f0 + f1u) / 2, f1v], [f1u, (f0 + f1v) / 2]].forEach(function (p) {
        var a = P(sp, p[0], p[1], 0), t = P(sp, p[0], p[1], H);
        g.strokeStyle = '#b08a5a'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(t.x, t.y); g.stroke();
      });
      [H * 0.5, H].forEach(function (hh) {
        g.strokeStyle = '#8a6a44'; g.lineWidth = 2.6;
        var a = P(sp, f0, f1v, hh), b2 = P(sp, f1u, f1v, hh), c2 = P(sp, f1u, f0, hh);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b2.x, b2.y); g.lineTo(c2.x, c2.y); g.stroke();
      });
      shadow(sp, [[f0, f0, 0], [f1u, f1v, 0], [f1u, f0, H], [f0, f1v, H]]);
    }
    // materials waiting
    logPile(sp, w - 0.1, h * 0.5, 2, 'u');
    box(sp, 0.08, h - 0.2, 0.2, h - 0.08, 0, 0.08, stoneWall({ col: C.stoneL, course: 4 }), null, flat(C.stoneL));
    var out = trim({ c: sp.c, sh: sp.sh, ax: sp.ax, ay: sp.ay, s: sp.s, top: 1, lights: [], chimneys: [] });
    cache[k] = out;
    return out;
  }

  /* ---------------- fields ---------------- */
  function hasField(b) { return b.id === 'farm' || b.id === 'pasture'; }
  /* which stage the crop is at, from the season and how far through it we are */
  function cropStage(season, p) {
    if (season === 'spring') return p < 0.3 ? 0 : p < 0.7 ? 1 : 2;
    if (season === 'summer') return p < 0.5 ? 3 : 4;
    if (season === 'autumn') return p < 0.45 ? 5 : 6;
    return 7;
  }
  function field(b, season, p) {
    var compact = !!b.compact, w = compact ? 1 : (b.def.w || 1), h = compact ? 1 : (b.def.h || 1);
    var stage = b.id === 'pasture' ? (season === 'winter' ? 9 : 8) : cropStage(season, p);
    var k = 'field:' + b.id + (compact ? 'c' : '') + ':' + stage;
    if (cache[k]) return cache[k];
    var sp = Sprite(w, h, 0.35, 0, k);
    var g = sp.g;
    function quad(u0, v0, u1, v1, fill) {
      var a = P(sp, u0, v0, 0), b2 = P(sp, u1, v0, 0), c2 = P(sp, u1, v1, 0), d = P(sp, u0, v1, 0);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b2.x, b2.y); g.lineTo(c2.x, c2.y); g.lineTo(d.x, d.y); g.closePath();
      g.fillStyle = fill; g.fill();
    }
    if (b.id === 'pasture') {
      // lush grazing inside a post-and-rail fence
      quad(0.03, 0.03, w - 0.03, h - 0.03, stage === 9 ? 'rgba(236,240,246,.55)' : 'rgba(90,140,50,.35)');
      var r = sp.rnd;
      for (var i = 0; i < 60 * w * h; i++) {
        var p0 = P(sp, 0.05 + r() * (w - 0.1), 0.05 + r() * (h - 0.1), 0);
        g.strokeStyle = stage === 9 ? 'rgba(140,130,100,.5)' : 'rgba(40,80,24,.4)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p0.x + (r() - .5) * 3, p0.y - 3 - r() * 3); g.stroke();
      }
      fenceLine(sp, [w - 0.02, 0.02], [w - 0.02, h - 0.02], h * 5);
      fenceLine(sp, [0.02, h - 0.02], [w - 0.02, h - 0.02], w * 5);
    } else {
      // the plots that aren't the farmyard
      var plots = compact ? [[0.05, 0.5, 0.95, 0.95], [0.55, 0.05, 0.95, 0.5]]
        : [[1.04, 0.05, 1.95, 0.96], [1.04, 1.04, 1.95, 1.95], [0.05, 1.3, 0.96, 1.95]];
      var soil = stage === 7 ? '#8e8474' : stage === 6 ? '#9c7e4e' : '#6e5236';
      plots.forEach(function (pl, pi) {
        quad(pl[0], pl[1], pl[2], pl[3], soil);
        // furrows run along one axis, alternating plot by plot
        var alongU = pi % 2 === 0, n = 9;
        for (var j = 0; j < n; j++) {
          var f = (j + 0.5) / n;
          var a0 = alongU ? P(sp, pl[0], pl[1] + (pl[3] - pl[1]) * f, 0) : P(sp, pl[0] + (pl[2] - pl[0]) * f, pl[1], 0);
          var a1 = alongU ? P(sp, pl[2], pl[1] + (pl[3] - pl[1]) * f, 0) : P(sp, pl[0] + (pl[2] - pl[0]) * f, pl[3], 0);
          g.strokeStyle = 'rgba(40,26,14,.35)'; g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(a0.x, a0.y); g.lineTo(a1.x, a1.y); g.stroke();
          if (stage >= 1 && stage <= 6) {
            var ht = [0, 2, 4, 7, 9, 10, 2][stage];
            var cc = ['', '#7fb24e', '#6aa53e', '#5c9a36', '#9fb24a', '#d9b64e', '#c8a860'][stage];
            var steps = 16;
            for (var s = 0; s <= steps; s++) {
              var x = a0.x + (a1.x - a0.x) * s / steps, y = a0.y + (a1.y - a0.y) * s / steps;
              g.strokeStyle = cc; g.lineWidth = stage >= 5 ? 1.6 : 1.8;
              g.beginPath(); g.moveTo(x, y); g.lineTo(x + (sp.rnd() - .5) * 1.4, y - ht * (0.7 + sp.rnd() * 0.5)); g.stroke();
              if (stage === 5 && s % 2) { g.fillStyle = '#efd27a'; g.fillRect(x - 1, y - ht - 2, 2.2, 3); }
            }
          }
          if (stage === 7 && j % 2) { g.strokeStyle = 'rgba(245,248,252,.8)'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(a0.x, a0.y - 1); g.lineTo(a1.x, a1.y - 1); g.stroke(); }
        }
        if (stage === 6 && pi === 0) {
          // sheaves stooked in the stubble
          [0.3, 0.6].forEach(function (f) {
            var c0 = P(sp, pl[0] + (pl[2] - pl[0]) * f, pl[1] + (pl[3] - pl[1]) * 0.5, 0);
            g.fillStyle = '#d9b64e'; g.beginPath(); g.moveTo(c0.x - 5, c0.y); g.lineTo(c0.x, c0.y - 12); g.lineTo(c0.x + 5, c0.y); g.fill();
          });
        }
      });
    }
    var out = trim({ c: sp.c, sh: null, ax: sp.ax, ay: sp.ay, s: sp.s });
    cache[k] = out;
    return out;
  }

  /* ---------------- trees ---------------- */
  var LEAF = {
    spring: [['#4f8f3a', '#79b552', '#a4d06e'], ['#2f5a34', '#3f7442', '#5a8f58'], ['#6aa548', '#98c864', '#c4e08a']],
    summer: [['#2f5e28', '#487d34', '#6b9c48'], ['#24452a', '#35603a', '#4f7c50'], ['#4a7e36', '#6c9e4a', '#92bc62']],
    autumn: [['#8a3c1c', '#c46a2a', '#e8a043'], ['#27472c', '#37613c', '#4f7c50'], ['#b58a24', '#dcb640', '#f2d66a']],
    winter: [null, ['#2e4a38', '#3f5e48', '#587a60'], null]
  };
  function tree(kind, season, v) {
    var k = 'tree' + kind + season + v;
    if (cache[k]) return cache[k];
    var S = SPX, hgt = kind === 1 ? 1.25 : kind === 2 ? 1.1 : 1.0;
    hgt *= 0.9 + v * 0.1;
    var sp = Sprite(0.5, 0.5, hgt + 0.1, 0.2, k);
    // re-anchor: a tree stands on a point, not a plot
    sp.ax += 0; var base = P(sp, 0.25, 0.25, 0);
    var g = sp.g, r = sp.rnd, pal = LEAF[season][kind];
    var cx = base.x, by = base.y, UP = sp.UP;
    // shadow: a soft blob under where the crown is
    var crownR = (kind === 1 ? 0.2 : 0.26) * (0.9 + v * 0.06);
    var ch = hgt * 0.62;
    shadow(sp, (function () {
      var pts = [[0.25, 0.25, 0]];
      for (var i = 0; i < 10; i++) { var a = i / 10 * 6.283; pts.push([0.25 + Math.cos(a) * crownR, 0.25 + Math.sin(a) * crownR, ch]); }
      return pts;
    })());
    // trunk
    var tw = S * (kind === 1 ? 0.028 : 0.034);
    var tcol = kind === 2 ? '#e6e2d8' : '#5b4029';
    var trunkTop = by - UP * hgt * (kind === 1 ? 0.3 : 0.5);
    var tg = g.createLinearGradient(cx - tw, 0, cx + tw, 0);
    tg.addColorStop(0, col(tcol, 1.05)); tg.addColorStop(1, col(tcol, 0.55));
    g.fillStyle = tg;
    g.beginPath(); g.moveTo(cx - tw, by); g.lineTo(cx - tw * 0.55, trunkTop); g.lineTo(cx + tw * 0.55, trunkTop); g.lineTo(cx + tw, by); g.fill();
    if (kind === 2) { g.fillStyle = '#2a2622'; for (var m = 0; m < 5; m++) g.fillRect(cx - tw * 0.6 + r() * tw, by - r() * UP * hgt * 0.5, tw * 0.7, 1.4); }

    if (!pal) {
      // bare winter branches
      g.strokeStyle = kind === 2 ? '#cfc9bd' : '#4e3826'; g.lineCap = 'round';
      (function branch(x, y, ang, len, wdt, depth) {
        var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        g.lineWidth = wdt; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        if (depth <= 0) return;
        branch(x2, y2, ang - 0.45 - r() * 0.3, len * 0.72, wdt * 0.66, depth - 1);
        branch(x2, y2, ang + 0.4 + r() * 0.3, len * 0.7, wdt * 0.66, depth - 1);
      })(cx, trunkTop + UP * 0.1, -Math.PI / 2, UP * hgt * 0.35, tw * 1.1, 4);
      g.fillStyle = 'rgba(245,248,252,.8)';
      g.beginPath(); g.ellipse(cx - 2, trunkTop - UP * hgt * 0.35, S * 0.07, S * 0.02, 0, 0, 6.3); g.fill();
    } else if (kind === 1) {
      // a conifer: stacked tiers, lit from the west
      var tiers = 5, top = by - UP * hgt;
      for (var t = 0; t < tiers; t++) {
        var f = t / tiers, y0 = by - UP * hgt * (0.18 + f * 0.7), y1 = top + (by - top) * 0.02 * t;
        var wdt = S * crownR * (1 - f * 0.72) * 1.2;
        var ty = y0 - UP * hgt * 0.34;
        var grd = g.createLinearGradient(cx - wdt, 0, cx + wdt, 0);
        grd.addColorStop(0, pal[1]); grd.addColorStop(0.35, pal[2]); grd.addColorStop(1, pal[0]);
        g.fillStyle = grd;
        g.beginPath(); g.moveTo(cx, ty);
        for (var s = 0; s <= 8; s++) {
          var xx = cx - wdt + wdt * 2 * s / 8, yy = y0 + (s % 2 ? 3 : -1) - Math.abs(s - 4) * 0.6;
          g.lineTo(xx, yy);
        }
        g.closePath(); g.fill();
        if (season === 'winter') {
          g.fillStyle = 'rgba(240,244,250,.9)';
          g.beginPath(); g.moveTo(cx, ty); g.lineTo(cx - wdt * 0.6, y0 - (y0 - ty) * 0.4); g.lineTo(cx + wdt * 0.1, y0 - (y0 - ty) * 0.35); g.closePath(); g.fill();
        }
      }
    } else {
      // a broadleaf crown built from clusters, each shaded as a ball
      var ccy = by - UP * hgt * 0.68, R0 = S * crownR;
      var blobs = [];
      for (var i = 0; i < 9; i++) {
        var a = i / 9 * 6.283 + r() * 0.5, d = R0 * (0.35 + r() * 0.35);
        blobs.push([cx + Math.cos(a) * d, ccy + Math.sin(a) * d * 0.75, R0 * (0.42 + r() * 0.2)]);
      }
      blobs.push([cx, ccy - R0 * 0.35, R0 * 0.55]);
      blobs.sort(function (p, q) { return p[1] - q[1]; });
      // dark underlayer, then lit clusters
      g.fillStyle = pal[0];
      g.beginPath(); g.ellipse(cx, ccy + R0 * 0.1, R0 * 1.02, R0 * 0.82, 0, 0, 6.3); g.fill();
      blobs.forEach(function (bl) {
        var gr = g.createRadialGradient(bl[0] - bl[2] * 0.45, bl[1] - bl[2] * 0.5, bl[2] * 0.1, bl[0], bl[1], bl[2]);
        gr.addColorStop(0, pal[2]); gr.addColorStop(0.55, pal[1]); gr.addColorStop(1, pal[0]);
        g.fillStyle = gr; g.beginPath(); g.arc(bl[0], bl[1], bl[2], 0, 6.3); g.fill();
      });
      // leaf texture
      for (var j = 0; j < 70; j++) {
        var a2 = r() * 6.283, d2 = Math.sqrt(r()) * R0 * 0.95;
        var lx = cx + Math.cos(a2) * d2, ly = ccy + Math.sin(a2) * d2 * 0.8;
        var lit = (cx - lx) / R0 + (ccy - ly) / R0;
        g.fillStyle = lit > 0.2 ? pal[2] : lit < -0.4 ? pal[0] : pal[1];
        g.globalAlpha = 0.7;
        g.beginPath(); g.ellipse(lx, ly, 2.2, 1.5, r() * 3, 0, 6.3); g.fill();
      }
      g.globalAlpha = 1;
      if (season === 'spring' && v === 1 && kind === 0) {
        for (var q = 0; q < 26; q++) {
          var a3 = r() * 6.283, d3 = Math.sqrt(r()) * R0;
          g.fillStyle = r() > .5 ? '#f6dbe6' : '#fff4f8';
          g.beginPath(); g.arc(cx + Math.cos(a3) * d3, ccy + Math.sin(a3) * d3 * 0.8, 1.6, 0, 6.3); g.fill();
        }
      }
    }
    var out = trim({ c: sp.c, sh: null, ax: base.x, ay: base.y, s: sp.s });
    cache[k] = out;
    return out;
  }

  /* ---------------- crags ----------------
     A cluster of weathered boulders: rounded, cracked, lit from the west,
     with moss in the damp side (or snow on top in winter). */
  function boulder(g, cx, cy, rw, rh, r, winter) {
    var n = 11, pts = [];
    for (var i = 0; i < n; i++) {
      var a = Math.PI + i / (n - 1) * Math.PI;              // the upper half, left to right
      var j = 0.78 + r() * 0.34;
      if (i > 2 && i < n - 3 && r() < 0.5) j *= 0.9;         // a flattish, broken top
      pts.push([cx + Math.cos(a) * rw * j, cy + Math.sin(a) * rh * j * (0.9 + r() * 0.25)]);
    }
    g.beginPath();
    g.moveTo(cx - rw, cy);
    pts.forEach(function (p) { g.lineTo(p[0], p[1]); });
    g.lineTo(cx + rw, cy);
    g.quadraticCurveTo(cx + rw * 0.6, cy + rh * 0.34, cx, cy + rh * 0.36);
    g.quadraticCurveTo(cx - rw * 0.6, cy + rh * 0.34, cx - rw, cy);
    g.closePath();
    var gr = g.createLinearGradient(cx - rw, cy - rh, cx + rw * 0.8, cy + rh * 0.3);
    gr.addColorStop(0, '#c4bdb0'); gr.addColorStop(0.35, '#9d968a'); gr.addColorStop(0.75, '#6d675e'); gr.addColorStop(1, '#4e4a44');
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    // facets and cracks
    g.strokeStyle = 'rgba(40,34,28,.3)'; g.lineWidth = 1;
    for (var k = 0; k < 3; k++) {
      var x0 = cx - rw * 0.6 + r() * rw * 1.2, y0 = cy - rh * (0.2 + r() * 0.7);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (r() - .3) * rw * 0.6, y0 + rh * (0.3 + r() * 0.4)); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.beginPath(); g.ellipse(cx - rw * 0.35, cy - rh * 0.62, rw * 0.35, rh * 0.18, -0.3, 0, 6.3); g.fill();
    if (winter) {
      g.fillStyle = '#eef2f7';
      g.beginPath(); g.ellipse(cx - rw * 0.1, cy - rh * 0.95, rw * 0.85, rh * 0.32, 0, 0, 6.3); g.fill();
    } else {
      g.fillStyle = 'rgba(92,120,58,.32)';
      g.beginPath(); g.ellipse(cx + rw * 0.5, cy - rh * 0.05, rw * 0.3, rh * 0.18, 0.4, 0, 6.3); g.fill();
    }
    g.restore();
  }
  function rock(v, season) {
    var winter = season === 'winter';
    var k = 'rock' + v + (winter ? 'W' : '');
    if (cache[k]) return cache[k];
    var sp = Sprite(0.6, 0.6, 0.6, 0.2, k);
    var base = P(sp, 0.3, 0.3, 0), g = sp.g, r = sp.rnd, S = sp.s;
    // two or three boulders, the big one behind
    var set = [[0, -0.02, 0.22, 0.22], [-0.14, 0.08, 0.12, 0.12], [0.15, 0.07, 0.1, 0.09]];
    if (v % 2) set = [[0.02, -0.03, 0.24, 0.28], [0.17, 0.06, 0.11, 0.11]];
    if (v === 3) set = [[-0.07, -0.02, 0.17, 0.16], [0.1, 0.0, 0.16, 0.19], [0.0, 0.1, 0.1, 0.08]];
    set.forEach(function (b) {
      var p = { x: base.x + b[0] * S, y: base.y + b[1] * S };
      boulder(g, p.x, p.y, b[2] * S * (0.9 + r() * 0.2), b[3] * S * sp.UP / S * 1.6, r, winter);
    });
    var out = trim({ c: sp.c, sh: null, ax: base.x, ay: base.y, s: S });
    cache[k] = out;
    return out;
  }

  /* windmill sails are animated at draw time: four lattice sails on a hub,
     drawn in the plane of the cap as it faces the viewer */
  function drawSails(g, x, y, r, ang) {
    g.save(); g.translate(x, y);
    for (var i = 0; i < 4; i++) {
      var a = ang + i * Math.PI / 2;
      var ca = Math.cos(a), sa = Math.sin(a);
      // squash sideways a little: the sails face south-west, not the screen
      var ex = ca * r * 0.82, ey = sa * r;
      g.strokeStyle = '#4a3524'; g.lineWidth = Math.max(1.5, r * 0.05);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(ex, ey); g.stroke();
      var px = -sa * 0.82, py = ca;
      var w = r * 0.2;
      g.fillStyle = 'rgba(238,228,204,.92)';
      g.beginPath();
      g.moveTo(ex * 0.22, ey * 0.22); g.lineTo(ex, ey);
      g.lineTo(ex + px * w, ey + py * w); g.lineTo(ex * 0.22 + px * w, ey * 0.22 + py * w);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(80,60,40,.6)'; g.lineWidth = 0.8;
      for (var s = 0.35; s < 1; s += 0.16) {
        g.beginPath(); g.moveTo(ex * s, ey * s); g.lineTo(ex * s + px * w, ey * s + py * w); g.stroke();
      }
    }
    g.fillStyle = '#3d2c1c'; g.beginPath(); g.arc(0, 0, Math.max(2, r * 0.07), 0, 6.3); g.fill();
    g.restore();
  }

  /* ---------------- helpers used elsewhere ---------------- */
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function poly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }

  /* small icon for menus: the building, its field, cropped to fit */
  var icons = {};
  function icon(id, px) {
    px = px || 48;
    var tier = id === 'castle' && SIM.G ? SIM.G.castle : 0;
    var key = id + '@' + px + ':' + tier;
    if (icons[key]) return icons[key];
    var c = canvas(px * 2, px * 2), g = c.getContext('2d');
    var def = DATA.B[id];
    if (def) {
      var rec = { id: id, def: def, level: 1, _tier: tier, _mask: 10 };
      if (id === 'wall') rec._mask = 10;
      var sp = building(rec, 'summer');
      var f = hasField(rec) ? field(rec, 'summer', 0.8) : null;
      // bounds of the painted pixels are roughly the sprite minus its shadow margin
      var w = (def.w || 1) + (def.h || 1);
      var bw = w * sp.s / 2 + 16, bh = sp.ay + w * sp.s / 4 + 6;
      var sc = Math.min(c.width / bw, c.height / bh) * 0.96;
      var ox = (c.width - bw * sc) / 2 - (sp.ax - (def.h || 1) * sp.s / 2 - 8) * sc;
      var oy = c.height - bh * sc;
      g.imageSmoothingQuality = 'high';
      if (f) g.drawImage(f.c, ox + (sp.ax - f.ax) * sc, oy + (sp.ay - f.ay) * sc, f.c.width * sc, f.c.height * sc);
      g.drawImage(sp.c, ox, oy, sp.c.width * sc, sp.c.height * sc);
    }
    icons[key] = c;
    return c;
  }

  function bake() {
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    SPX = dpr >= 1.75 ? 128 : 96;
  }
  function clearCache() { cache = {}; icons = {}; }

  return {
    bake: bake, building: building, scaffold: scaffold, tree: tree, rock: rock,
    hasField: hasField, field: field, lightsOf: lightsOf, drawSails: drawSails,
    icon: icon, rr: rr, poly: poly, clearCache: clearCache, fishDir: fishDir,
    /* the ruler's colours fly from every tower of the castle */
    setBanner: function (a, b) { if (C.banner === a && C.banner2 === b) return; C.banner = a || C.gold; C.banner2 = b || C.red; clearCache(); },
    get SPX() { return SPX; }
  };
})();
