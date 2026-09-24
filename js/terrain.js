/* ============================================================
   terrain.js — the ground, baked once per pixel into one big
   isometric canvas and patched in place when the land changes.

   Every pixel is worked out from the tiles around it: the kind of
   ground blends softly into its neighbours along noisy edges, a
   smooth height field gives hills their light and shade, the sea
   deepens away from the beach, the island stands on a low earth
   bank, and footpaths are worn into it by how often they are used.
   ============================================================ */
var TERRAIN = (function () {
  'use strict';

  var M = 3;                 // tiles of open sea baked around the island
  var TPX = 96;              // canvas px per tile width (a tile is TPX × TPX/2)
  var R = 6;                 // height samples per tile
  var cv = null, g = null, CW = 0, CH = 0;
  var NT = null, NS = 256;   // tileable noise texture
  var HG = null, GXG = null, GYG = null, GW = 0;
  var EXT = 0;               // tiles across the extended square (map + sea)
  var TYPE = null;           // type index per extended tile
  var PATH = null, YARD = null, PNEAR = null;
  var sigs = null;           // what each tile looked like when last baked
  var season = 'summer', seed = 1;
  var jobs = [];             // dirty rects waiting to be baked
  var full = null;           // a whole-island rebake in progress (new season)
  var fade = null;           // {old canvas, t} cross-fade after a full rebake
  var ready = false;

  var KIND = { water: 0, shore: 1, sand: 2, grass: 3, meadow: 4, forest: 5, hill: 6, rock: 7 };
  var BASE_H = [-1.0, -0.22, 0.16, 0.24, 0.22, 0.30, 0.62, 1.02];

  /* ---------- palettes: [dark, mid, light] per season ---------- */
  var PAL = {
    spring: {
      2: [[196, 176, 124], [216, 198, 148], [230, 216, 172]],
      3: [[70, 118, 44], [98, 148, 58], [132, 172, 76]],
      4: [[58, 110, 40], [84, 140, 52], [116, 164, 66]],
      5: [[44, 72, 34], [62, 92, 42], [86, 108, 52]],
      6: [[98, 116, 58], [126, 140, 74], [156, 160, 96]],
      7: [[92, 88, 80], [124, 118, 106], [160, 152, 138]]
    },
    summer: {
      2: [[200, 178, 124], [220, 200, 150], [234, 218, 176]],
      3: [[66, 108, 40], [92, 136, 52], [124, 160, 70]],
      4: [[52, 98, 36], [76, 128, 46], [106, 152, 60]],
      5: [[40, 64, 30], [58, 84, 38], [80, 100, 46]],
      6: [[112, 118, 60], [140, 140, 78], [170, 162, 102]],
      7: [[92, 88, 80], [124, 118, 106], [160, 152, 138]]
    },
    autumn: {
      2: [[196, 172, 120], [214, 192, 142], [228, 210, 168]],
      3: [[98, 104, 42], [128, 126, 56], [160, 146, 72]],
      4: [[86, 100, 40], [114, 122, 52], [146, 140, 66]],
      5: [[70, 58, 30], [96, 74, 38], [124, 90, 46]],
      6: [[124, 108, 58], [150, 128, 74], [176, 150, 96]],
      7: [[90, 84, 76], [120, 112, 100], [154, 144, 130]]
    },
    winter: {
      2: [[176, 164, 136], [198, 188, 162], [214, 206, 186]],
      3: [[92, 104, 70], [118, 124, 86], [140, 140, 102]],
      4: [[84, 98, 64], [108, 118, 80], [132, 136, 96]],
      5: [[58, 66, 50], [76, 82, 62], [96, 98, 76]],
      6: [[110, 110, 90], [134, 132, 110], [158, 154, 132]],
      7: [[96, 94, 92], [128, 126, 122], [162, 160, 156]]
    }
  };
  var DIRT = [[112, 88, 58], [140, 114, 78], [164, 140, 100]];
  var DEEP = [18, 54, 86];

  function smooth(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

  /* ---------- noise ---------- */
  function makeNoiseTex(sd) {
    var r = U.mulberry(sd ^ 0x7f4a7c15);
    var out = new Float32Array(NS * NS), norm = 0;
    [[8, 1], [16, .55], [32, .3], [64, .16]].forEach(function (oc) {
      var n = oc[0], amp = oc[1], cell = NS / n, lat = new Float32Array(n * n);
      for (var i = 0; i < lat.length; i++) lat[i] = r();
      for (var y = 0; y < NS; y++) {
        var gy = y / cell, y0 = Math.floor(gy), fy = smooth(gy - y0), y1 = (y0 + 1) % n;
        for (var x = 0; x < NS; x++) {
          var gx = x / cell, x0 = Math.floor(gx), fx = smooth(gx - x0), x1 = (x0 + 1) % n;
          var a = lat[y0 * n + x0], b = lat[y0 * n + x1], c = lat[y1 * n + x0], d = lat[y1 * n + x1];
          out[y * NS + x] += amp * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
        }
      }
      norm += amp;
    });
    // stretch to use the full 0..1 range
    var lo = 1e9, hi = -1e9, i2;
    for (i2 = 0; i2 < out.length; i2++) { out[i2] /= norm; if (out[i2] < lo) lo = out[i2]; if (out[i2] > hi) hi = out[i2]; }
    for (i2 = 0; i2 < out.length; i2++) out[i2] = (out[i2] - lo) / (hi - lo);
    return out;
  }
  function sn(u, v) {
    var x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    x0 &= 255; y0 &= 255;
    var x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    var a = NT[(y0 << 8) + x0], b = NT[(y0 << 8) + x1], c = NT[(y1 << 8) + x0], d = NT[(y1 << 8) + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /* ---------- tile grids ---------- */
  function ti(ix, iy) { return (iy + M) * EXT + (ix + M); }
  function inExt(ix, iy) { return ix >= -M && iy >= -M && ix < W.COLS + M && iy < W.ROWS + M; }

  function readTiles() {
    EXT = W.COLS + 2 * M;
    TYPE = new Int8Array(EXT * EXT);
    PATH = new Int8Array(EXT * EXT);
    YARD = new Int8Array(EXT * EXT);
    for (var iy = -M; iy < W.ROWS + M; iy++) {
      for (var ix = -M; ix < W.COLS + M; ix++) {
        var t = W.at(ix, iy), k = ti(ix, iy);
        TYPE[k] = t ? KIND[t.terr] : 0;
        PATH[k] = t && t.path ? Math.min(6, t.path) : 0;
        YARD[k] = t && t.bld && !t.bld.def.isWall && !t.bld.def.noYard ? (t.bld.built ? 1 : 2) : 0;
      }
    }
    PNEAR = new Int8Array(EXT * EXT);
    for (iy = -M; iy < W.ROWS + M; iy++) {
      for (ix = -M; ix < W.COLS + M; ix++) {
        var any = 0;
        for (var oy = -1; oy <= 1 && !any; oy++) for (var ox = -1; ox <= 1; ox++) {
          if (inExt(ix + ox, iy + oy) && PATH[ti(ix + ox, iy + oy)]) { any = 1; break; }
        }
        PNEAR[ti(ix, iy)] = any;
      }
    }
  }

  function tileSig(t) {
    if (!t) return 0;
    return KIND[t.terr] * 256 + Math.min(6, t.path || 0) * 4 +
      (t.bld && !t.bld.def.isWall && !t.bld.def.noYard ? (t.bld.built ? 1 : 2) : 0);
  }
  function snapshotSigs() {
    var s = new Int32Array(W.COLS * W.ROWS);
    for (var i = 0; i < s.length; i++) s[i] = tileSig(W.tiles[i]);
    return s;
  }

  /* ---------- the height field ---------- */
  function buildHeights() {
    GW = EXT * R + 1;
    HG = new Float32Array(GW * GW);
    for (var gy = 0; gy < GW; gy++) {
      for (var gx = 0; gx < GW; gx++) {
        var wx = gx / R - M, wy = gy / R - M;
        var fx = wx - 0.5, fy = wy - 0.5, ix = Math.floor(fx), iy = Math.floor(fy);
        var sx = smooth(fx - ix), sy = smooth(fy - iy);
        var h00 = tH(ix, iy), h10 = tH(ix + 1, iy), h01 = tH(ix, iy + 1), h11 = tH(ix + 1, iy + 1);
        var h = (h00 * (1 - sx) + h10 * sx) * (1 - sy) + (h01 * (1 - sx) + h11 * sx) * sy;
        // rough ground is lumpier: hills roll, crags jut
        var rough = U.clamp((h - 0.25) * 1.6, 0.15, 1);
        h += (sn(wx * 11 + 40, wy * 11 + 17) - 0.5) * 0.20 * rough;
        h += (sn(wx * 29 + 3, wy * 29 + 91) - 0.5) * 0.10 * rough;
        HG[gy * GW + gx] = h;
      }
    }
    GXG = new Float32Array(GW * GW); GYG = new Float32Array(GW * GW);
    for (gy = 0; gy < GW; gy++) {
      for (gx = 0; gx < GW; gx++) {
        var xa = Math.max(0, gx - 1), xb = Math.min(GW - 1, gx + 1);
        var ya = Math.max(0, gy - 1), yb = Math.min(GW - 1, gy + 1);
        GXG[gy * GW + gx] = (HG[gy * GW + xb] - HG[gy * GW + xa]) * R / (xb - xa);
        GYG[gy * GW + gx] = (HG[yb * GW + gx] - HG[ya * GW + gx]) * R / (yb - ya);
      }
    }
  }
  function tH(ix, iy) { return inExt(ix, iy) ? BASE_H[TYPE[ti(ix, iy)]] : -1; }

  /* Heights only follow the lie of the land, not what stands on it, so a
     felled wood or a new house never has to rebuild the whole field — only
     a change of ground type does (forest → grass is nearly level anyway). */
  function patchHeights(tx0, ty0, tx1, ty1) {
    var gx0 = Math.max(0, (tx0 - 1 + M) * R), gx1 = Math.min(GW - 1, (tx1 + 2 + M) * R);
    var gy0 = Math.max(0, (ty0 - 1 + M) * R), gy1 = Math.min(GW - 1, (ty1 + 2 + M) * R);
    for (var gy = gy0; gy <= gy1; gy++) {
      for (var gx = gx0; gx <= gx1; gx++) {
        var wx = gx / R - M, wy = gy / R - M;
        var fx = wx - 0.5, fy = wy - 0.5, ix = Math.floor(fx), iy = Math.floor(fy);
        var sx = smooth(fx - ix), sy = smooth(fy - iy);
        var h = (tH(ix, iy) * (1 - sx) + tH(ix + 1, iy) * sx) * (1 - sy) +
                (tH(ix, iy + 1) * (1 - sx) + tH(ix + 1, iy + 1) * sx) * sy;
        var rough = U.clamp((h - 0.25) * 1.6, 0.15, 1);
        h += (sn(wx * 11 + 40, wy * 11 + 17) - 0.5) * 0.20 * rough;
        h += (sn(wx * 29 + 3, wy * 29 + 91) - 0.5) * 0.10 * rough;
        HG[gy * GW + gx] = h;
      }
    }
    for (gy = Math.max(0, gy0 - 1); gy <= Math.min(GW - 1, gy1 + 1); gy++) {
      for (gx = Math.max(0, gx0 - 1); gx <= Math.min(GW - 1, gx1 + 1); gx++) {
        var xa = Math.max(0, gx - 1), xb = Math.min(GW - 1, gx + 1);
        var ya = Math.max(0, gy - 1), yb = Math.min(GW - 1, gy + 1);
        GXG[gy * GW + gx] = (HG[gy * GW + xb] - HG[gy * GW + xa]) * R / (xb - xa);
        GYG[gy * GW + gx] = (HG[yb * GW + gx] - HG[ya * GW + gx]) * R / (yb - ya);
      }
    }
  }

  /* bilinear sample of a grid at world position */
  var _gv = 0, _gxv = 0, _gyv = 0;
  function sampleH(x, y) {
    var u = (x + M) * R, v = (y + M) * R;
    if (u < 0) u = 0; if (v < 0) v = 0;
    if (u > GW - 1.001) u = GW - 1.001; if (v > GW - 1.001) v = GW - 1.001;
    var x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, k = y0 * GW + x0;
    var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    _gv = HG[k] * w00 + HG[k + 1] * w10 + HG[k + GW] * w01 + HG[k + GW + 1] * w11;
    _gxv = GXG[k] * w00 + GXG[k + 1] * w10 + GXG[k + GW] * w01 + GXG[k + GW + 1] * w11;
    _gyv = GYG[k] * w00 + GYG[k + 1] * w10 + GYG[k + GW] * w01 + GYG[k + GW + 1] * w11;
  }
  function heightAt(x, y) { sampleH(x, y); return _gv; }

  /* ---------- colour of one kind of ground at a point ---------- */
  var cr = 0, cg = 0, cb = 0;
  function groundColour(kind, x, y, n1, n2, grain, pal) {
    if (kind < 2) kind = 2;                   // the sea's edge reads as beach
    var p = pal[kind], v = n2 * 0.62 + n1 * 0.38, a, b, t;
    if (kind === 6) v = v * 0.8 + 0.1;
    if (v < 0.5) { a = p[0]; b = p[1]; t = v * 2; } else { a = p[1]; b = p[2]; t = (v - 0.5) * 2; }
    cr = a[0] + (b[0] - a[0]) * t; cg = a[1] + (b[1] - a[1]) * t; cb = a[2] + (b[2] - a[2]) * t;
    var k;
    if (kind === 2) {
      // wind ripples in the sand
      k = 1 + Math.sin((x * 0.7 + y * 1.3) * 9 + n1 * 7) * 0.035;
      cr *= k; cg *= k; cb *= k;
    } else if (kind === 4) {
      // rich soil shows dark earth between the growth
      if (n1 > 0.66) { t = Math.min(1, (n1 - 0.66) * 3) * 0.45; cr += (70 - cr) * t; cg += (56 - cg) * t; cb += (36 - cb) * t; }
    } else if (kind === 5) {
      // leaf litter
      t = sn(x * 23 + 5, y * 23 + 9);
      if (t > 0.6) { t = (t - 0.6) * 1.4; cr += (104 - cr) * t; cg += (80 - cg) * t; cb += (44 - cb) * t; }
    } else if (kind === 6) {
      // the hills break into bare rock in places
      t = sn(x * 5 + 70, y * 5 + 30);
      if (t > 0.64) { t = Math.min(1, (t - 0.64) * 3.2) * 0.8; cr += (132 - cr) * t; cg += (126 - cg) * t; cb += (114 - cb) * t; }
    } else if (kind === 7) {
      // weathered stone with dark fissures
      t = Math.abs(sn(x * 13 + 11, y * 13 + 57) - 0.5);
      if (t < 0.05) { k = 0.62 + t * 7; cr *= k; cg *= k; cb *= k; }
      t = sn(x * 3 + 8, y * 3 + 2);
      if (t > 0.6) { t = (t - 0.6) * 1.2; cr += (96 - cr) * t; cg += (112 - cg) * t; cb += (70 - cb) * t; }
    }
    k = 0.93 + grain * 0.14;
    cr *= k; cg *= k; cb *= k;
  }

  /* ---------- geometry ---------- */
  // canvas px of a world point
  function cx(x, y) { return (x - y + W.ROWS + 2 * M) * TPX / 2; }
  function cy(x, y) { return (x + y + 2 * M) * TPX / 4; }

  function setup() {
    readTiles();
    NT = NT || makeNoiseTex(seed);
    buildHeights();
    CW = Math.ceil((W.COLS + W.ROWS + 4 * M) * TPX / 2);
    CH = Math.ceil((W.COLS + W.ROWS + 4 * M) * TPX / 4);
  }

  /* bake a rectangle of canvas pixels into ctx */
  function bakeRect(ctx, px0, py0, pw, ph, seasonKey) {
    px0 = Math.max(0, Math.floor(px0)); py0 = Math.max(0, Math.floor(py0));
    pw = Math.min(CW - px0, Math.ceil(pw)); ph = Math.min(CH - py0, Math.ceil(ph));
    if (pw <= 0 || ph <= 0) return;
    var img = ctx.createImageData(pw, ph), d = img.data;
    var pal = PAL[seasonKey], winter = seasonKey === 'winter';
    var halfT = TPX / 2, qT = TPX / 4, offA = W.ROWS + 2 * M, offB = 2 * M;
    var COLS = W.COLS, ROWS = W.ROWS;
    var o = 0;
    for (var py = py0; py < py0 + ph; py++) {
      var b = (py + 0.5) / qT - offB;                 // x + y
      for (var px = px0; px < px0 + pw; px++, o += 4) {
        var a = (px + 0.5) / halfT - offA;            // x - y
        var x = (a + b) * 0.5, y = (b - a) * 0.5;
        var r, gg, bb;
        // beyond the baked sea: the open ocean, flat colour
        if (x < -M || y < -M || x > COLS + M || y > ROWS + M) {
          d[o] = DEEP[0]; d[o + 1] = DEEP[1]; d[o + 2] = DEEP[2]; d[o + 3] = 255; continue;
        }
        sampleH(x, y);
        var h = _gv, gxv = _gxv, gyv = _gyv;

        if (h < 0) {
          /* ---- water ---- */
          // the island stands on a low bank: just below land, you see earth
          var onBank = false;
          if (h > -0.5) { sampleH(x - 0.13, y - 0.13); onBank = _gv > 0; }
          if (onBank) {
            var bank = U.clamp(_gv / 0.12, 0, 1);
            r = 108 - 30 * (1 - bank); gg = 92 - 26 * (1 - bank); bb = 66 - 20 * (1 - bank);
            if (h > -0.05) { r += 60; gg += 60; bb += 60; }        // foam at the waterline
            if (winter) { r += 20; gg += 22; bb += 26; }
          } else {
            var dep = U.clamp(-h / 0.9, 0, 1), fade2;
            // shallows are clear over sand; the deep is dark blue
            var sh = smooth(1 - dep * 3.2);
            r = 30 + (122 - 30) * sh; gg = 96 + (178 - 96) * sh; bb = 128 + (166 - 128) * sh;
            var deep = smooth((dep - 0.25) / 0.75);
            r += (DEEP[0] - r) * deep; gg += (DEEP[1] - gg) * deep; bb += (DEEP[2] - bb) * deep;
            // gentle swell pattern, fading out in the open sea so the edge is seamless
            fade2 = U.clamp(1 - (Math.max(-x, -y, x - COLS, y - ROWS) + 0.5) / 2.2, 0, 1);
            var sw = (sn(x * 9 + 200, y * 4 + 60) - 0.5) * 16 * fade2;
            r += sw * 0.4; gg += sw * 0.7; bb += sw;
            if (-h < 0.035) { var fo = 1 - (-h / 0.035); r += (230 - r) * fo * 0.7; gg += (236 - gg) * fo * 0.7; bb += (232 - bb) * fo * 0.7; }
            if (winter && dep < 0.15) { r += 26; gg += 28; bb += 30; }
          }
        } else {
          /* ---- land ---- */
          var n1 = sn(x * 7.3 + 13, y * 7.3 + 71), n2 = sn(x * 19.7 + 101, y * 19.7 + 7);
          var gh = (((px * 73856093) ^ (py * 19349663)) >>> 0) % 1000 / 1000;
          // wobble the sample point so borders between kinds of ground are ragged
          var wx = x + (sn(x * 5.1 + 300, y * 5.1) - 0.5) * 0.55;
          var wy = y + (sn(x * 5.1, y * 5.1 + 300) - 0.5) * 0.55;
          var fx = wx - 0.5, fy = wy - 0.5, ix = Math.floor(fx), iy = Math.floor(fy);
          var tx = fx - ix, ty = fy - iy;
          var sx = smooth((tx - 0.22) / 0.56), sy = smooth((ty - 0.22) / 0.56);
          var k00 = inExt(ix, iy) ? ti(ix, iy) : -1, k10 = inExt(ix + 1, iy) ? ti(ix + 1, iy) : -1;
          var k01 = inExt(ix, iy + 1) ? ti(ix, iy + 1) : -1, k11 = inExt(ix + 1, iy + 1) ? ti(ix + 1, iy + 1) : -1;
          var t00 = k00 < 0 ? 0 : TYPE[k00], t10 = k10 < 0 ? 0 : TYPE[k10];
          var t01 = k01 < 0 ? 0 : TYPE[k01], t11 = k11 < 0 ? 0 : TYPE[k11];
          if (t00 < 2) t00 = 2; if (t10 < 2) t10 = 2; if (t01 < 2) t01 = 2; if (t11 < 2) t11 = 2;
          var w00 = (1 - sx) * (1 - sy), w10 = sx * (1 - sy), w01 = (1 - sx) * sy, w11 = sx * sy;
          if (t00 === t10 && t00 === t01 && t00 === t11) {
            groundColour(t00, x, y, n1, n2, gh, pal); r = cr; gg = cg; bb = cb;
          } else {
            r = 0; gg = 0; bb = 0;
            if (w00 > 0.001) { groundColour(t00, x, y, n1, n2, gh, pal); r += cr * w00; gg += cg * w00; bb += cb * w00; }
            if (w10 > 0.001) { groundColour(t10, x, y, n1, n2, gh, pal); r += cr * w10; gg += cg * w10; bb += cb * w10; }
            if (w01 > 0.001) { groundColour(t01, x, y, n1, n2, gh, pal); r += cr * w01; gg += cg * w01; bb += cb * w01; }
            if (w11 > 0.001) { groundColour(t11, x, y, n1, n2, gh, pal); r += cr * w11; gg += cg * w11; bb += cb * w11; }
          }

          // trampled yards around buildings
          var yd = (k00 >= 0 && YARD[k00] ? w00 : 0) + (k10 >= 0 && YARD[k10] ? w10 : 0) +
                   (k01 >= 0 && YARD[k01] ? w01 : 0) + (k11 >= 0 && YARD[k11] ? w11 : 0);
          if (yd > 0) {
            yd *= 0.5;
            var dv = n2;
            var dr = DIRT[1][0] + (dv - 0.5) * 40, dg = DIRT[1][1] + (dv - 0.5) * 34, db = DIRT[1][2] + (dv - 0.5) * 26;
            r += (dr - r) * yd; gg += (dg - gg) * yd; bb += (db - bb) * yd;
          }

          // snow lies on everything but the steepest ground
          if (winter) {
            var slope = Math.sqrt(gxv * gxv + gyv * gyv);
            var snow = U.clamp((n1 * 0.5 + n2 * 0.5 - 0.18) * 2.6, 0, 1) * U.clamp(1.25 - slope * 0.9, 0, 1);
            r += (236 - r) * snow; gg += (240 - gg) * snow; bb += (246 - bb) * snow;
          }

          // footpaths worn into the ground
          var ixc = Math.floor(x), iyc = Math.floor(y);
          if (inExt(ixc, iyc) && PNEAR[ti(ixc, iyc)]) {
            var pw2 = pathAt(x, y, n2);
            if (pw2 > 0) {
              var pr = winter ? 118 : DIRT[1][0], pg = winter ? 104 : DIRT[1][1], pb = winter ? 92 : DIRT[1][2];
              var rut = sn(x * 40, y * 40);
              pr += (rut - 0.5) * 30; pg += (rut - 0.5) * 26; pb += (rut - 0.5) * 20;
              r += (pr - r) * pw2; gg += (pg - gg) * pw2; bb += (pb - bb) * pw2;
            }
          }

          // hill shading: slopes that face the low western sun are lit
          var shade = 1.04 + (gxv - gyv * 0.35) * 0.30;
          if (shade < 0.55) shade = 0.55; else if (shade > 1.4) shade = 1.4;
          // damp, dark sand right at the water's edge
          if (h < 0.05) { var wet = 1 - h / 0.05; shade *= 1 - wet * 0.22; }
          r *= shade; gg *= shade; bb *= shade;
        }
        d[o] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[o + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
        d[o + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, px0, py0);
    decals(ctx, px0, py0, pw, ph, seasonKey);
  }

  /* how strongly a point lies on a footpath (0..1) */
  function pathAt(x, y, n2) {
    var ix = Math.floor(x), iy = Math.floor(y), best = 0;
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        var jx = ix + ox, jy = iy + oy;
        if (!inExt(jx, jy)) continue;
        var p = PATH[ti(jx, jy)];
        if (!p) continue;
        var ccx = jx + 0.5, ccy = jy + 0.5, w = 0.10 + p * 0.028;
        var dd = Math.sqrt((x - ccx) * (x - ccx) + (y - ccy) * (y - ccy));
        // east and south links (west and north are the neighbour's east/south)
        if (inExt(jx + 1, jy) && PATH[ti(jx + 1, jy)]) {
          var w2 = (w + 0.10 + PATH[ti(jx + 1, jy)] * 0.028) * 0.5;
          var t = U.clamp(x - ccx, 0, 1), d2 = Math.sqrt((x - ccx - t) * (x - ccx - t) + (y - ccy) * (y - ccy));
          best = Math.max(best, edge(d2, w2, n2));
        }
        if (inExt(jx, jy + 1) && PATH[ti(jx, jy + 1)]) {
          var w3 = (w + 0.10 + PATH[ti(jx, jy + 1)] * 0.028) * 0.5;
          var t2 = U.clamp(y - ccy, 0, 1), d3 = Math.sqrt((x - ccx) * (x - ccx) + (y - ccy - t2) * (y - ccy - t2));
          best = Math.max(best, edge(d3, w3, n2));
        }
        best = Math.max(best, edge(dd, w * 1.05, n2));
      }
    }
    return best;
  }
  function edge(d, w, n2) {
    d += (n2 - 0.5) * 0.07;
    return U.clamp((w - d) / 0.05, 0, 1) * 0.82;
  }

  /* ---------- small painted details: tufts, flowers, stones ---------- */
  function decals(ctx, px0, py0, pw, ph, seasonKey) {
    ctx.save();
    ctx.beginPath(); ctx.rect(px0, py0, pw, ph); ctx.clip();
    // which tiles can reach into this rectangle
    var corners = [[px0, py0], [px0 + pw, py0], [px0, py0 + ph], [px0 + pw, py0 + ph]];
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    corners.forEach(function (c) {
      var a = c[0] / (TPX / 2) - (W.ROWS + 2 * M), b = c[1] / (TPX / 4) - 2 * M;
      var x = (a + b) / 2, y = (b - a) / 2;
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    });
    var s = TPX / 96, winter = seasonKey === 'winter';
    for (var iy = Math.max(0, Math.floor(miny) - 1); iy <= Math.min(W.ROWS - 1, Math.ceil(maxy) + 1); iy++) {
      for (var ix = Math.max(0, Math.floor(minx) - 1); ix <= Math.min(W.COLS - 1, Math.ceil(maxx) + 1); ix++) {
        var t = W.at(ix, iy);
        if (!t || t.bld) continue;
        var kind = KIND[t.terr];
        if (kind < 2) continue;
        if (kind === 5) treeShadows(ctx, t, s, winter);
        if (kind === 7) rockShadows(ctx, t, s);
        var r = U.mulberry((seed * 7919) ^ (ix * 92821 + iy * 68917) ^ kind * 131);
        var n = kind === 7 ? 3 : kind === 5 ? 3 : kind === 2 ? 2 : 7;
        if (winter) n = Math.ceil(n * 0.35);
        for (var i = 0; i < n; i++) {
          var wx = ix + 0.08 + r() * 0.84, wy = iy + 0.08 + r() * 0.84;
          if (t.path && pathAt(wx, wy, 0.5) > 0.1) { r(); r(); continue; }
          var X = cx(wx, wy), Y = cy(wx, wy), v = r(), q = r();
          if (kind === 3 || kind === 4 || kind === 6) {
            if (q < (kind === 4 ? 0.45 : 0.18) && !winter && seasonKey !== 'autumn') {
              // a few flowers
              var fc = seasonKey === 'spring' ? ['#f2e7f0', '#e9b8cf', '#f5e27a', '#cfd8f5'] : ['#f0d65a', '#f4f1e2', '#d9748c', '#b89ce0'];
              for (var f = 0; f < 3; f++) {
                ctx.fillStyle = fc[(f + (v * 4 | 0)) % 4];
                ctx.beginPath(); ctx.arc(X + (r() - .5) * 7 * s, Y + (r() - .5) * 4 * s, 1.1 * s, 0, 6.3); ctx.fill();
              }
            } else if (kind === 6 && q > 0.72) {
              stone(ctx, X, Y, (2.2 + v * 2.6) * s, winter);
            } else {
              // a tuft of grass
              ctx.strokeStyle = winter ? 'rgba(120,110,80,.55)' : v > .5 ? 'rgba(30,60,20,.38)' : 'rgba(200,220,140,.30)';
              ctx.lineWidth = 1 * s;
              ctx.beginPath();
              for (var b2 = -1; b2 <= 1; b2++) {
                ctx.moveTo(X + b2 * 1.4 * s, Y);
                ctx.lineTo(X + b2 * 2.4 * s + (v - .5) * 2 * s, Y - (3 + q * 3) * s);
              }
              ctx.stroke();
            }
          } else if (kind === 7) {
            stone(ctx, X, Y, (3 + v * 4) * s, winter);
          } else if (kind === 2) {
            if (q > 0.5) { ctx.fillStyle = 'rgba(255,250,235,.55)'; ctx.fillRect(X, Y, 1.6 * s, 1.1 * s); }
            else stone(ctx, X, Y, 1.4 * s, winter);
          } else if (kind === 5) {
            // ferns and fallen leaves on the forest floor
            ctx.fillStyle = seasonKey === 'autumn' ? 'rgba(190,110,40,.55)' : 'rgba(40,74,30,.5)';
            ctx.beginPath(); ctx.ellipse(X, Y, 3.2 * s, 1.5 * s, 0, 0, 6.3); ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  }
  /* Trees stand still, so their shadows are painted into the ground once
     rather than drawn every frame. They fall east, away from the low sun. */
  function softBlob(ctx, X, Y, rx, ry, a) {
    ctx.save();
    ctx.translate(X, Y); ctx.scale(1, ry / rx);
    var gr = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
    gr.addColorStop(0, 'rgba(8,16,4,' + a + ')'); gr.addColorStop(0.7, 'rgba(8,16,4,' + (a * 0.7) + ')'); gr.addColorStop(1, 'rgba(8,16,4,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.3); ctx.fill();
    ctx.restore();
  }
  function treeShadows(ctx, t, s, winter) {
    W.treesOf(t).forEach(function (tr) {
      var hgt = (tr.kind === 1 ? 1.25 : tr.kind === 2 ? 1.1 : 1.0) * tr.s * 0.82;
      var bare = winter && tr.kind !== 1;
      var sx = tr.x + 0.62 * hgt * 0.62, sy = tr.y - 0.30 * hgt * 0.62;
      var r = (tr.kind === 1 ? 0.17 : 0.22) * tr.s;
      var X0 = cx(tr.x, tr.y), Y0 = cy(tr.x, tr.y), X1 = cx(sx, sy), Y1 = cy(sx, sy);
      ctx.strokeStyle = 'rgba(8,16,4,.22)'; ctx.lineWidth = 2.2 * s;
      ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(X1, Y1); ctx.stroke();
      softBlob(ctx, X1, Y1, r * TPX * 0.707, r * TPX * 0.354, bare ? 0.12 : 0.34);
    });
  }
  function rockShadows(ctx, t, s) {
    W.rocksOf(t).forEach(function (rk) {
      var X = cx(rk.x + 0.2 * rk.s, rk.y - 0.08 * rk.s), Y = cy(rk.x + 0.2 * rk.s, rk.y - 0.08 * rk.s);
      softBlob(ctx, X, Y, 0.3 * rk.s * TPX * 0.707, 0.3 * rk.s * TPX * 0.354, 0.32);
    });
  }
  function stone(ctx, X, Y, rad, winter) {
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(X + rad * .3, Y + rad * .25, rad * 1.1, rad * .5, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#8d877c';
    ctx.beginPath(); ctx.ellipse(X, Y - rad * .2, rad, rad * .62, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = winter ? '#eef1f5' : '#b1ab9f';
    ctx.beginPath(); ctx.ellipse(X - rad * .25, Y - rad * .45, rad * .55, rad * .3, 0, 0, 6.3); ctx.fill();
  }

  /* ---------- public: build, patch, draw ---------- */
  function pickRes() {
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return dpr >= 1.75 ? 96 : 72;
  }

  /* Start baking the whole island. Returns a job object whose `done` flag
     flips when the last stripe is in; step() advances it. */
  function begin(seasonKey, sd) {
    seed = sd || 1;
    season = seasonKey || 'summer';
    TPX = pickRes();
    NT = null;
    setup();
    cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    g = cv.getContext('2d');
    sigs = snapshotSigs();
    jobs = [];
    fade = null;
    full = { canvas: cv, g: g, y: 0, season: season, swap: false };
    ready = false;
  }

  /* Advance any baking for up to `budget` ms. Call every frame. */
  function step(budget) {
    if (!g && !full) return;
    var t0 = now();
    budget = budget || 6;
    while (full && now() - t0 < budget) {
      var rows = Math.max(8, Math.floor(40 * 96 / TPX));
      bakeRect(full.g, 0, full.y, CW, rows, full.season);
      full.y += rows;
      if (full.y >= CH) {
        if (full.swap) {
          fade = { old: cv, t: 0 };
          cv = full.canvas; g = full.g;
        }
        full = null;
        ready = true;
        // anything that changed during the bake gets patched now
        sync(true);
      }
    }
    while (!full && jobs.length && now() - t0 < budget) {
      var j = jobs.shift();
      bakeRect(g, j.x, j.y, j.w, j.h, season);
    }
  }
  function progress() { return full ? full.y / CH : 1; }
  function now() { return (typeof performance !== 'undefined') ? performance.now() : Date.now(); }

  /* A new season re-paints the island into a fresh canvas and cross-fades. */
  function setSeason(seasonKey) {
    if (seasonKey === season && !full) return;
    season = seasonKey;
    readTiles();
    var c2 = document.createElement('canvas');
    c2.width = CW; c2.height = CH;
    full = { canvas: c2, g: c2.getContext('2d'), y: 0, season: season, swap: true };
    sigs = snapshotSigs();
    jobs = [];
  }

  /* Compare the land with what was baked and patch whatever changed:
     felled trees, regrowth, new buildings, footpaths wearing in. */
  var _syncAt = 0;
  function sync(force) {
    if (!sigs || !g) return;
    var t = now();
    if (!force && t - _syncAt < 250) return;
    _syncAt = t;
    var changed = [], typeChanged = false;
    for (var i = 0; i < sigs.length; i++) {
      var s = tileSig(W.tiles[i]);
      if (s !== sigs[i]) {
        if ((s >> 8) !== (sigs[i] >> 8)) typeChanged = true;
        sigs[i] = s;
        changed.push(i);
      }
    }
    if (!changed.length) return;
    readTiles();
    // group the changed tiles into a few rectangles and queue them
    var rects = [];
    changed.forEach(function (i) {
      var x = i % W.COLS, y = Math.floor(i / W.COLS);
      for (var k = 0; k < rects.length; k++) {
        var r = rects[k];
        if (x >= r.x0 - 2 && x <= r.x1 + 2 && y >= r.y0 - 2 && y <= r.y1 + 2) {
          r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x);
          r.y0 = Math.min(r.y0, y); r.y1 = Math.max(r.y1, y);
          return;
        }
      }
      rects.push({ x0: x, x1: x, y0: y, y1: y });
    });
    rects.forEach(function (r) {
      if (typeChanged) patchHeights(r.x0, r.y0, r.x1, r.y1);
      queueTiles(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1);
    });
  }
  function queueTiles(x0, y0, x1, y1) {
    // canvas bounding box of the tile block
    var left = cx(x0, y1 + 1), right = cx(x1 + 1, y0), top = cy(x0, y0), bot = cy(x1 + 1, y1 + 1);
    var pad = 4;
    jobs.push({ x: left - pad, y: top - pad - TPX * 0.2, w: right - left + pad * 2, h: bot - top + pad * 2 + TPX * 0.2 });
  }

  /* Draw the visible part of the ground. `toScreen` maps world→screen. */
  function draw(ctx, cam, cw, ch, z) {
    var cvs = cv;
    if (!cvs || !ready) return false;
    var k = z / TPX;                          // screen px per canvas px
    // screen position of the canvas origin
    var ox = cw / 2 - (cam.x - cam.y + W.ROWS + 2 * M) * z / 2;
    var oy = ch / 2 - (cam.x + cam.y + 2 * M) * z / 4;
    var sx = Math.max(0, -ox / k), sy = Math.max(0, -oy / k);
    var ex = Math.min(CW, (cw - ox) / k), ey = Math.min(CH, (ch - oy) / k);
    if (ex <= sx || ey <= sy) return true;
    ctx.imageSmoothingEnabled = true;
    // plain bilinear when the ground is magnified; mipmapped only when it is
    // being shrunk, where bilinear would shimmer
    ctx.imageSmoothingQuality = k * ((typeof window !== 'undefined' && window.devicePixelRatio) || 1) < 0.8 ? 'medium' : 'low';
    ctx.drawImage(cvs, sx, sy, ex - sx, ey - sy, ox + sx * k, oy + sy * k, (ex - sx) * k, (ey - sy) * k);
    if (fade) {
      fade.t += 1 / 60;
      var a = 1 - fade.t / 1.6;
      if (a <= 0) fade = null;
      else {
        ctx.globalAlpha = a;
        ctx.drawImage(fade.old, sx, sy, ex - sx, ey - sy, ox + sx * k, oy + sy * k, (ex - sx) * k, (ey - sy) * k);
        ctx.globalAlpha = 1;
      }
    }
    return true;
  }

  return {
    begin: begin, step: step, progress: progress, setSeason: setSeason, sync: sync,
    draw: draw, heightAt: heightAt,
    get ready() { return ready; },
    get canvas() { return cv; },
    get season() { return season; },
    DEEP: DEEP, M: M
  };
})();
