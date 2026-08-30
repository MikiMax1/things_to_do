/* ============================================================
   art.js — every sprite is drawn in code and baked to canvases.
   No image files, nothing to download.
   ============================================================ */
var ART = (function () {
  'use strict';

  var T = 64;          // art pixels per tile
  var BW = 64, BH = 96; // building sprite box (base sits at bottom)

  function cv(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function ctxOf(c) { var x = c.getContext('2d'); return x; }

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
  function fill(g, c) { g.fillStyle = c; g.fill(); }
  function line(g, c, w) { g.strokeStyle = c; g.lineWidth = w || 2; g.stroke(); }
  function fs(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x, y, w, h); }

  var P = {
    wood: '#7a5636', woodD: '#4a3524', woodL: '#9c7346',
    thatch: '#c2a05c', thatchD: '#8a6d34',
    tileRoof: '#9c4634', tileRoofD: '#6e2f22',
    slate: '#5c6470', slateD: '#3d434c',
    stone: '#948e82', stoneD: '#6b665c', stoneL: '#b3ada0',
    plaster: '#ddd0b4', plasterD: '#b9a988',
    dark: '#2a2018',
    gold: '#e0b23c', red: '#b3402f', green: '#4e8b3a',
    win: '#f2cd6b', winD: '#8a6a2a'
  };

  /* ---------------- terrain ---------------- */
  var TERR_COL = {
    water:  ['#2b4f74', '#39678f', '#22415f'],
    shore:  ['#4b7fa3', '#5c93b5', '#3f6d8d'],
    sand:   ['#d8c48c', '#e2d0a0', '#c8b27a'],
    grass:  ['#6d9c48', '#78a752', '#628e40'],
    meadow: ['#80af4c', '#8dbb57', '#74a044'],
    forest: ['#659143', '#6f9b4b', '#5b833b'],
    hill:   ['#8c9659', '#98a266', '#7e8850'],
    rock:   ['#7c7870', '#8b8880', '#6e6a63']
  };

  function bakeTerrain(key, variant) {
    var c = cv(T, T), g = ctxOf(c);
    var col = TERR_COL[key];
    var r = U.mulberry(key.charCodeAt(0) * 97 + variant * 31 + 7);
    g.fillStyle = col[0];
    g.fillRect(0, 0, T, T);
    // soft blotches for depth — kept subtle so tiles don't read as a grid
    for (var i = 0; i < 22; i++) {
      g.globalAlpha = 0.16 + r() * 0.16;
      g.fillStyle = r() > .5 ? col[1] : col[2];
      var x = r() * T, y = r() * T, w = 4 + r() * 11;
      g.beginPath(); g.ellipse(x, y, w, w * .72, r() * 3, 0, 6.3); g.fill();
    }
    g.globalAlpha = 1;

    if (key === 'grass' || key === 'meadow' || key === 'hill') {
      for (var j = 0; j < 26; j++) {
        var gx = r() * T, gy = r() * T;
        g.strokeStyle = 'rgba(255,255,255,.10)';
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + (r() - .5) * 4, gy - 4 - r() * 4); g.stroke();
      }
      if (key === 'meadow') {
        for (var f = 0; f < 5; f++) {
          g.fillStyle = ['#e8d45f', '#e88fb0', '#f0efe0'][Math.floor(r() * 3)];
          g.beginPath(); g.arc(r() * T, r() * T, 1.8, 0, 6.3); g.fill();
        }
      }
    }
    if (key === 'sand') {
      for (var s = 0; s < 30; s++) {
        g.fillStyle = 'rgba(150,120,70,.22)';
        g.fillRect(r() * T, r() * T, 2, 1.6);
      }
    }
    if (key === 'rock') {
      for (var k = 0; k < 4; k++) {
        var rx = 8 + r() * (T - 22), ry = 8 + r() * (T - 22), rw = 12 + r() * 16;
        poly(g, [[rx, ry + rw * .8], [rx + rw * .35, ry], [rx + rw, ry + rw * .5], [rx + rw * .8, ry + rw]]);
        fill(g, '#9a968d'); line(g, '#5e5a53', 2);
        poly(g, [[rx, ry + rw * .8], [rx + rw * .35, ry], [rx + rw * .5, ry + rw * .55]]);
        fill(g, '#b5b1a8');
      }
    }
    if (key === 'water' || key === 'shore') {
      for (var w2 = 0; w2 < 5; w2++) {
        g.strokeStyle = 'rgba(255,255,255,.15)';
        g.lineWidth = 2;
        var wy = r() * T, wx = r() * T;
        g.beginPath();
        g.moveTo(wx - 9, wy); g.quadraticCurveTo(wx - 4, wy - 3, wx, wy);
        g.quadraticCurveTo(wx + 4, wy + 3, wx + 9, wy);
        g.stroke();
      }
    }
    return c;
  }

  /* ---------------- decorations ---------------- */
  function bakeTree(kind, season) {
    var c = cv(T, T), g = ctxOf(c);
    var leaf = { spring: '#3e7a34', summer: '#356b2c', autumn: '#a4632a', winter: '#5a6b4a' }[season];
    var leaf2 = { spring: '#4d9440', summer: '#437f36', autumn: '#c47f36', winter: '#6b7c5a' }[season];
    var cx = T / 2, by = T - 10;
    g.globalAlpha = .25; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(cx, by + 3, 13, 5, 0, 0, 6.3); g.fill();
    g.globalAlpha = 1;
    fs(g, P.woodD, cx - 3, by - 14, 6, 16);
    if (kind === 0) { // round broadleaf
      [[0, -30, 15], [-10, -22, 11], [10, -22, 11]].forEach(function (b, i) {
        g.fillStyle = i ? leaf : leaf2;
        g.beginPath(); g.arc(cx + b[0], by + b[1], b[2], 0, 6.3); g.fill();
      });
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.beginPath(); g.arc(cx - 5, by - 34, 7, 0, 6.3); g.fill();
    } else { // conifer
      for (var i = 0; i < 3; i++) {
        var yy = by - 8 - i * 11, ww = 17 - i * 4;
        poly(g, [[cx - ww, yy], [cx, yy - 17], [cx + ww, yy]]);
        fill(g, i % 2 ? leaf : leaf2);
      }
    }
    return c;
  }

  function bakeCrop(stage) {
    var c = cv(T, T), g = ctxOf(c);
    g.fillStyle = '#8a6a42'; g.fillRect(0, 0, T, T);
    for (var i = 0; i < 6; i++) {
      g.fillStyle = 'rgba(0,0,0,.16)';
      g.fillRect(0, i * 11 + 3, T, 3);
    }
    if (stage > 0) {
      var cols = ['#6fae4a', '#93bd47', '#d9bf55'];
      var h = [0, 6, 11, 15][stage];
      for (var r2 = 0; r2 < 6; r2++) {
        for (var x = 4; x < T - 2; x += 7) {
          g.strokeStyle = cols[stage - 1];
          g.lineWidth = 2.4;
          g.beginPath();
          g.moveTo(x, r2 * 11 + 8);
          g.lineTo(x + 1, r2 * 11 + 8 - h);
          g.stroke();
          if (stage === 3) { g.fillStyle = '#efd884'; g.fillRect(x - 1, r2 * 11 + 8 - h - 3, 4, 4); }
        }
      }
    }
    return c;
  }

  /* ---------------- building primitives ---------------- */
  function shadow(g, w) {
    g.globalAlpha = .28; g.fillStyle = '#000';
    g.beginPath(); g.ellipse(BW / 2, BH - 7, (w || 24), 8, 0, 0, 6.3); g.fill();
    g.globalAlpha = 1;
  }
  function box(g, x, y, w, h, face, side) {
    fs(g, face, x, y, w, h);
    fs(g, side, x, y, w, 4);                // top light band
    g.strokeStyle = P.dark; g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
  function gableRoof(g, x, y, w, h, col, colD) {
    poly(g, [[x - 4, y + h], [x + w / 2, y], [x + w + 4, y + h]]);
    fill(g, col); line(g, P.dark, 2);
    poly(g, [[x + w / 2, y], [x + w + 4, y + h], [x + w / 2, y + h]]);
    fill(g, colD);
  }
  function window_(g, x, y, w, h) {
    fs(g, P.winD, x - 1, y - 1, w + 2, h + 2);
    fs(g, P.win, x, y, w, h);
  }
  function door(g, x, y, w, h) {
    rr(g, x, y, w, h, 3); fill(g, P.woodD); line(g, P.dark, 1.5);
  }
  function banner(g, x, y, col) {
    fs(g, P.woodD, x, y - 22, 2, 24);
    poly(g, [[x + 2, y - 22], [x + 16, y - 18], [x + 2, y - 12]]);
    fill(g, col || P.red);
  }

  /* ---------------- building sprites ---------------- */
  var DRAW = {
    castle: function (g) {
      // drawn into a 2x2 sprite: caller resizes canvas
      var W = BW * 2, H = BH + 40, cx = W / 2, base = H - 12;
      g.globalAlpha = .3; g.fillStyle = '#000';
      g.beginPath(); g.ellipse(cx, base + 2, 52, 12, 0, 0, 6.3); g.fill();
      g.globalAlpha = 1;
      // curtain wall
      box(g, cx - 50, base - 40, 100, 40, P.stone, P.stoneL);
      for (var i = 0; i < 7; i++) fs(g, P.stone, cx - 50 + i * 15, base - 48, 10, 9);
      for (i = 0; i < 7; i++) { g.strokeStyle = P.dark; g.lineWidth = 1.6; g.strokeRect(cx - 49 + i * 15, base - 47, 9, 9); }
      // keep
      box(g, cx - 26, base - 92, 52, 56, P.stoneL, '#c6c0b2');
      poly(g, [[cx - 32, base - 92], [cx, base - 126], [cx + 32, base - 92]]);
      fill(g, P.tileRoof); line(g, P.dark, 2);
      poly(g, [[cx, base - 126], [cx + 32, base - 92], [cx, base - 92]]);
      fill(g, P.tileRoofD);
      window_(g, cx - 16, base - 78, 10, 14);
      window_(g, cx + 6, base - 78, 10, 14);
      door(g, cx - 9, base - 40, 18, 28);
      // flanking towers
      [-44, 44].forEach(function (dx) {
        box(g, cx + dx - 12, base - 66, 24, 54, P.stone, P.stoneL);
        poly(g, [[cx + dx - 16, base - 66], [cx + dx, base - 92], [cx + dx + 16, base - 66]]);
        fill(g, P.slate); line(g, P.dark, 2);
        window_(g, cx + dx - 4, base - 54, 8, 11);
      });
      banner(g, cx + 2, base - 126, P.gold);
    },
    house: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 22);
      box(g, cx - 20, b - 26, 40, 26, P.plaster, '#eee2c6');
      fs(g, P.woodD, cx - 20, b - 26, 3, 26); fs(g, P.woodD, cx + 17, b - 26, 3, 26);
      gableRoof(g, cx - 20, b - 48, 40, 22, P.thatch, P.thatchD);
      window_(g, cx - 14, b - 20, 9, 9);
      door(g, cx + 2, b - 16, 12, 16);
      fs(g, P.stoneD, cx + 12, b - 52, 6, 12); // chimney
    },
    manor: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 26);
      box(g, cx - 25, b - 34, 50, 34, P.plaster, '#eee2c6');
      gableRoof(g, cx - 25, b - 58, 50, 24, P.tileRoof, P.tileRoofD);
      window_(g, cx - 18, b - 27, 9, 10); window_(g, cx - 5, b - 27, 9, 10); window_(g, cx + 8, b - 27, 9, 10);
      door(g, cx - 6, b - 15, 13, 15);
      fs(g, P.stoneD, cx - 20, b - 66, 6, 14); fs(g, P.stoneD, cx + 15, b - 66, 6, 14);
      banner(g, cx + 24, b - 56, P.blue || '#3b6ea5');
    },
    farm: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 20);
      box(g, cx - 17, b - 24, 34, 24, '#a8503c', '#c26a52');
      gableRoof(g, cx - 17, b - 44, 34, 20, '#8d4130', '#6b2e21');
      fs(g, P.woodD, cx - 5, b - 20, 12, 20);
      fs(g, '#e8d9a8', cx - 3, b - 18, 8, 8);
      // hay bale
      g.fillStyle = P.thatch;
      g.beginPath(); g.arc(cx + 24, b - 6, 7, 0, 6.3); g.fill();
      line(g, P.thatchD, 1.5);
    },
    fishery: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 20);
      fs(g, P.woodD, cx - 18, b - 6, 4, 8); fs(g, P.woodD, cx + 14, b - 6, 4, 8);
      box(g, cx - 18, b - 26, 34, 20, P.wood, P.woodL);
      gableRoof(g, cx - 19, b - 42, 36, 16, P.thatch, P.thatchD);
      window_(g, cx - 12, b - 21, 8, 8);
      // net
      g.strokeStyle = '#d8cda6'; g.lineWidth = 1;
      for (var i = 0; i < 4; i++) { g.beginPath(); g.moveTo(cx + 18, b - 26 + i * 5); g.lineTo(cx + 30, b - 20 + i * 5); g.stroke(); }
    },
    lumber: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 20);
      box(g, cx - 18, b - 22, 36, 22, P.wood, P.woodL);
      poly(g, [[cx - 22, b - 22], [cx + 22, b - 22], [cx + 16, b - 36], [cx - 16, b - 36]]);
      fill(g, P.woodD); line(g, P.dark, 2);
      // log pile
      [[-24, -4], [-18, -4], [-21, -10]].forEach(function (p) {
        g.fillStyle = '#8a6b45'; g.beginPath(); g.arc(cx + p[0], b + p[1], 4, 0, 6.3); g.fill();
        line(g, P.woodD, 1.4);
      });
      // axe in stump
      fs(g, '#6b5334', cx + 20, b - 10, 10, 10);
      g.strokeStyle = '#c9ccd2'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + 25, b - 10); g.lineTo(cx + 30, b - 22); g.stroke();
    },
    sawmill: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 24);
      box(g, cx - 22, b - 30, 44, 30, P.wood, P.woodL);
      gableRoof(g, cx - 22, b - 48, 44, 18, P.slate, P.slateD);
      // water wheel
      g.strokeStyle = P.woodD; g.lineWidth = 3;
      g.beginPath(); g.arc(cx + 26, b - 14, 13, 0, 6.3); g.stroke();
      for (var i = 0; i < 6; i++) {
        var a = i * 1.05;
        g.beginPath(); g.moveTo(cx + 26, b - 14);
        g.lineTo(cx + 26 + Math.cos(a) * 13, b - 14 + Math.sin(a) * 13); g.stroke();
      }
      window_(g, cx - 14, b - 24, 9, 9);
    },
    quarry: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 24);
      poly(g, [[cx - 26, b], [cx - 16, b - 22], [cx + 12, b - 26], [cx + 26, b]]);
      fill(g, '#6f6a61'); line(g, P.dark, 2);
      poly(g, [[cx - 16, b - 22], [cx + 12, b - 26], [cx + 4, b - 12], [cx - 8, b - 10]]);
      fill(g, '#a09b90');
      [[-14, -4], [-6, -3], [4, -5], [14, -3]].forEach(function (p) {
        g.fillStyle = P.stoneL; g.fillRect(cx + p[0], b + p[1] - 5, 8, 6);
        g.strokeStyle = P.dark; g.lineWidth = 1.2; g.strokeRect(cx + p[0], b + p[1] - 5, 8, 6);
      });
      fs(g, P.woodD, cx + 20, b - 24, 3, 20);
      g.fillStyle = '#c9ccd2'; g.fillRect(cx + 17, b - 26, 10, 5);
    },
    mine: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 22);
      poly(g, [[cx - 24, b], [cx - 20, b - 30], [cx + 20, b - 30], [cx + 24, b]]);
      fill(g, '#5e5850'); line(g, P.dark, 2);
      // entrance
      g.fillStyle = '#1a1712';
      g.beginPath(); g.moveTo(cx - 11, b); g.lineTo(cx - 11, b - 14);
      g.quadraticCurveTo(cx, b - 26, cx + 11, b - 14); g.lineTo(cx + 11, b); g.fill();
      fs(g, P.woodD, cx - 14, b - 16, 4, 16); fs(g, P.woodD, cx + 10, b - 16, 4, 16);
      fs(g, P.woodD, cx - 15, b - 20, 30, 5);
      // cart
      fs(g, '#7a5636', cx + 16, b - 9, 12, 8);
      g.fillStyle = P.dark;
      g.beginPath(); g.arc(cx + 19, b - 1, 2.6, 0, 6.3); g.arc(cx + 26, b - 1, 2.6, 0, 6.3); g.fill();
    },
    smith: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 22);
      box(g, cx - 20, b - 28, 40, 28, P.stone, P.stoneL);
      gableRoof(g, cx - 20, b - 44, 40, 16, P.slate, P.slateD);
      fs(g, '#1a1712', cx - 12, b - 20, 16, 20);
      fs(g, '#e8622a', cx - 10, b - 12, 12, 11);
      fs(g, '#f5b03c', cx - 8, b - 8, 8, 7);
      fs(g, P.stoneD, cx + 10, b - 54, 8, 14);
      // anvil
      fs(g, '#4a4a52', cx + 16, b - 10, 12, 4);
      fs(g, '#4a4a52', cx + 20, b - 6, 5, 6);
    },
    market: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 26);
      fs(g, P.woodD, cx - 22, b - 22, 3, 22); fs(g, P.woodD, cx + 19, b - 22, 3, 22);
      // striped awning
      for (var i = 0; i < 6; i++) {
        g.fillStyle = i % 2 ? '#d9d2c0' : '#b3402f';
        poly(g, [[cx - 26 + i * 9, b - 22], [cx - 17 + i * 9, b - 22], [cx - 15 + i * 9, b - 34], [cx - 24 + i * 9, b - 34]]);
        g.fill();
      }
      g.strokeStyle = P.dark; g.lineWidth = 2;
      g.strokeRect(cx - 26, b - 34, 52, 12);
      // table + goods
      fs(g, P.wood, cx - 20, b - 12, 40, 5);
      ['#c9542f', '#e0b23c', '#5d9a41', '#8a5ab0'].forEach(function (c, i) {
        g.fillStyle = c; g.beginPath(); g.arc(cx - 14 + i * 9, b - 15, 3.4, 0, 6.3); g.fill();
      });
      fs(g, P.woodD, cx - 18, b - 7, 4, 7); fs(g, P.woodD, cx + 14, b - 7, 4, 7);
    },
    granary: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 20);
      fs(g, P.woodD, cx - 14, b - 8, 4, 8); fs(g, P.woodD, cx + 10, b - 8, 4, 8);
      box(g, cx - 17, b - 30, 34, 22, P.wood, P.woodL);
      poly(g, [[cx - 22, b - 30], [cx, b - 52], [cx + 22, b - 30]]);
      fill(g, P.thatch); line(g, P.dark, 2);
      poly(g, [[cx, b - 52], [cx + 22, b - 30], [cx, b - 30]]);
      fill(g, P.thatchD);
      fs(g, P.woodD, cx - 6, b - 26, 12, 14);
      fs(g, '#e8d9a8', cx - 4, b - 24, 8, 6);
    },
    warehouse: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 26);
      box(g, cx - 24, b - 28, 48, 28, P.wood, P.woodL);
      poly(g, [[cx - 28, b - 28], [cx - 20, b - 42], [cx + 20, b - 42], [cx + 28, b - 28]]);
      fill(g, P.slate); line(g, P.dark, 2);
      fs(g, P.woodD, cx - 10, b - 22, 20, 22);
      g.strokeStyle = '#a08055'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx - 10, b - 22); g.lineTo(cx + 10, b); g.moveTo(cx + 10, b - 22); g.lineTo(cx - 10, b); g.stroke();
      fs(g, '#8a6b45', cx + 14, b - 12, 9, 12);
    },
    well: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 14);
      fs(g, P.woodD, cx - 12, b - 34, 3, 22); fs(g, P.woodD, cx + 9, b - 34, 3, 22);
      poly(g, [[cx - 17, b - 32], [cx, b - 44], [cx + 17, b - 32]]);
      fill(g, P.thatch); line(g, P.dark, 2);
      rr(g, cx - 13, b - 14, 26, 14, 3); fill(g, P.stone); line(g, P.dark, 2);
      g.fillStyle = '#2b4f74';
      g.beginPath(); g.ellipse(cx, b - 13, 10, 4, 0, 0, 6.3); g.fill();
      fs(g, P.woodD, cx - 2, b - 26, 4, 6);
    },
    chapel: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 22);
      box(g, cx - 18, b - 32, 36, 32, P.plaster, '#eee2c6');
      gableRoof(g, cx - 18, b - 50, 36, 18, P.slate, P.slateD);
      // tower
      box(g, cx + 12, b - 54, 16, 54, P.plasterD, P.plaster);
      poly(g, [[cx + 10, b - 54], [cx + 20, b - 74], [cx + 30, b - 54]]);
      fill(g, P.slateD); line(g, P.dark, 2);
      fs(g, P.gold, cx + 19, b - 84, 2.5, 11); fs(g, P.gold, cx + 15, b - 80, 11, 2.5);
      // arched window
      g.fillStyle = P.win;
      g.beginPath(); g.moveTo(cx - 10, b - 8); g.lineTo(cx - 10, b - 20);
      g.quadraticCurveTo(cx - 4, b - 28, cx + 2, b - 20); g.lineTo(cx + 2, b - 8); g.fill();
      g.strokeStyle = P.winD; g.lineWidth = 2; g.stroke();
    },
    tavern: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 24);
      box(g, cx - 21, b - 30, 42, 30, P.plaster, '#eee2c6');
      fs(g, P.woodD, cx - 21, b - 30, 42, 3);
      fs(g, P.woodD, cx - 21, b - 16, 42, 3);
      gableRoof(g, cx - 21, b - 48, 42, 18, P.thatch, P.thatchD);
      window_(g, cx - 15, b - 13, 10, 10); window_(g, cx + 5, b - 13, 10, 10);
      door(g, cx - 6, b - 12, 12, 12);
      // hanging sign
      fs(g, P.woodD, cx + 21, b - 40, 12, 2);
      rr(g, cx + 26, b - 38, 12, 10, 2); fill(g, P.wood); line(g, P.dark, 1.5);
      g.fillStyle = P.gold; g.fillRect(cx + 30, b - 35, 4, 5);
    },
    library: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 24);
      box(g, cx - 23, b - 34, 46, 34, P.plaster, '#eee2c6');
      // columns
      [-18, -6, 6, 15].forEach(function (dx) { fs(g, '#c9bda0', cx + dx, b - 30, 5, 30); });
      poly(g, [[cx - 27, b - 34], [cx, b - 50], [cx + 27, b - 34]]);
      fill(g, P.stoneL); line(g, P.dark, 2);
      fs(g, P.stoneD, cx - 27, b - 36, 54, 4);
      door(g, cx - 5, b - 16, 11, 16);
      // book
      fs(g, '#8a3f2f', cx + 20, b - 44, 10, 3);
    },
    barracks: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 26);
      box(g, cx - 24, b - 28, 48, 28, P.wood, P.woodL);
      gableRoof(g, cx - 24, b - 46, 48, 18, '#6b4a2e', '#4a3220');
      window_(g, cx - 17, b - 21, 8, 9); window_(g, cx + 9, b - 21, 8, 9);
      door(g, cx - 7, b - 16, 14, 16);
      // weapon rack
      g.strokeStyle = '#c9ccd2'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(cx + 22, b - 2); g.lineTo(cx + 26, b - 22); g.stroke();
      g.beginPath(); g.moveTo(cx + 28, b - 2); g.lineTo(cx + 24, b - 22); g.stroke();
      banner(g, cx - 26, b - 30, P.red);
    },
    range: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 24);
      fs(g, P.woodD, cx - 22, b - 24, 4, 24); fs(g, P.woodD, cx + 4, b - 24, 4, 24);
      poly(g, [[cx - 26, b - 24], [cx + 12, b - 24], [cx + 8, b - 36], [cx - 22, b - 36]]);
      fill(g, P.thatch); line(g, P.dark, 2);
      // target
      var tx = cx + 22, ty = b - 16;
      g.fillStyle = '#f0e6cc'; g.beginPath(); g.arc(tx, ty, 10, 0, 6.3); g.fill();
      g.strokeStyle = P.dark; g.lineWidth = 1.6; g.stroke();
      g.fillStyle = P.red; g.beginPath(); g.arc(tx, ty, 5.5, 0, 6.3); g.fill();
      g.fillStyle = '#f0e6cc'; g.beginPath(); g.arc(tx, ty, 2, 0, 6.3); g.fill();
      fs(g, P.woodD, tx - 1.5, ty + 8, 3, 12);
    },
    tower: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 18);
      box(g, cx - 14, b - 62, 28, 62, P.stone, P.stoneL);
      for (var i = 0; i < 4; i++) fs(g, P.stoneL, cx - 15 + i * 8, b - 70, 6, 9);
      g.strokeStyle = P.dark; g.lineWidth = 1.6;
      for (i = 0; i < 4; i++) g.strokeRect(cx - 15 + i * 8, b - 70, 6, 9);
      fs(g, P.stoneD, cx - 17, b - 62, 34, 5);
      window_(g, cx - 4, b - 48, 8, 12);
      window_(g, cx - 4, b - 28, 8, 12);
      door(g, cx - 6, b - 14, 12, 14);
      banner(g, cx + 14, b - 70, P.gold);
    },
    wall: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 24);
      box(g, cx - 30, b - 26, 60, 26, P.stone, P.stoneL);
      for (var i = 0; i < 5; i++) {
        fs(g, P.stoneL, cx - 30 + i * 13, b - 34, 9, 9);
        g.strokeStyle = P.dark; g.lineWidth = 1.5;
        g.strokeRect(cx - 30 + i * 13, b - 34, 9, 9);
      }
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1.4;
      for (i = 1; i < 4; i++) { g.beginPath(); g.moveTo(cx - 30, b - 26 + i * 7); g.lineTo(cx + 30, b - 26 + i * 7); g.stroke(); }
    },
    windmill: function (g) {
      var b = BH - 12, cx = BW / 2;
      shadow(g, 20);
      poly(g, [[cx - 18, b], [cx - 12, b - 46], [cx + 12, b - 46], [cx + 18, b]]);
      fill(g, P.plaster); line(g, P.dark, 2);
      poly(g, [[cx - 15, b - 46], [cx, b - 62], [cx + 15, b - 46]]);
      fill(g, '#6b4a2e'); line(g, P.dark, 2);
      door(g, cx - 6, b - 16, 12, 16);
      window_(g, cx - 4, b - 36, 8, 8);
      // sails drawn separately (animated) — keep hub only
      g.fillStyle = P.woodD;
      g.beginPath(); g.arc(cx, b - 52, 3.5, 0, 6.3); g.fill();
    },
    road: function (g) {
      g.clearRect(0, 0, BW, BH);
    }
  };

  /* windmill sails are animated at draw time */
  function drawSails(g, x, y, r, ang) {
    g.save(); g.translate(x, y); g.rotate(ang);
    for (var i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.fillStyle = '#5a422a'; g.fillRect(-1.5, 0, 3, -r);
      g.fillStyle = 'rgba(240,232,205,.9)';
      g.fillRect(1.5, -r * .95, r * .22, r * .8);
      g.strokeStyle = P.dark; g.lineWidth = 1;
      g.strokeRect(1.5, -r * .95, r * .22, r * .8);
    }
    g.restore();
  }

  /* ---------------- construction scaffold ---------------- */
  function bakeScaffold() {
    var c = cv(BW, BH), g = ctxOf(c), b = BH - 12, cx = BW / 2;
    shadow(g, 20);
    fs(g, '#8a6b45', cx - 18, b - 6, 36, 6);
    g.strokeStyle = '#a8895c'; g.lineWidth = 3;
    [[-16, -6, -16, -34], [16, -6, 16, -34], [-16, -34, 16, -34], [-16, -20, 16, -20]].forEach(function (l) {
      g.beginPath(); g.moveTo(cx + l[0], b + l[1]); g.lineTo(cx + l[2], b + l[3]); g.stroke();
    });
    g.strokeStyle = '#7a5636';
    g.beginPath(); g.moveTo(cx - 16, b - 6); g.lineTo(cx + 16, b - 34); g.stroke();
    return c;
  }

  /* ---------------- villager sprite ---------------- */
  /* built at draw time (tiny) — see render.js */

  /* ---------------- baking ---------------- */
  var tiles = {}, bld = {}, trees = {}, crops = [], scaffold = null, icons = {};

  function bake() {
    Object.keys(TERR_COL).forEach(function (k) {
      tiles[k] = [];
      for (var v = 0; v < 4; v++) tiles[k].push(bakeTerrain(k, v));
    });
    ['spring', 'summer', 'autumn', 'winter'].forEach(function (s) {
      trees[s] = [bakeTree(0, s), bakeTree(1, s)];
    });
    for (var i = 0; i < 4; i++) crops.push(bakeCrop(i));
    scaffold = bakeScaffold();

    Object.keys(DATA.B).forEach(function (id) {
      var big = id === 'castle';
      var w = big ? BW * 2 : BW, h = big ? BH + 40 : BH;
      var c = cv(w, h), g = ctxOf(c);
      if (DRAW[id]) DRAW[id](g);
      bld[id] = { c: c, w: w, h: h };
    });
  }

  /* small icon canvas for menus (crops the building nicely) */
  function icon(id, px) {
    px = px || 48;
    var key = id + '@' + px;
    if (icons[key]) return icons[key];
    var src = bld[id];
    var c = cv(px, px), g = ctxOf(c);
    if (src) {
      var sc = px / Math.max(src.w, src.h * .78);
      g.imageSmoothingQuality = 'high';
      var dw = src.w * sc, dh = src.h * sc;
      g.drawImage(src.c, (px - dw) / 2, px - dh + dh * .06, dw, dh);
    }
    icons[key] = c;
    return c;
  }

  return {
    T: T, BW: BW, BH: BH, P: P, TERR_COL: TERR_COL,
    bake: bake, tiles: tiles, bld: bld, trees: trees, crops: crops,
    scaffold: function () { return scaffold; },
    icon: icon, drawSails: drawSails, rr: rr, poly: poly
  };
})();
