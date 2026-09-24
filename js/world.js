/* ============================================================
   world.js — terrain generation, placement rules, pathfinding
   ============================================================ */
var W = (function () {
  'use strict';

  var COLS = 28, ROWS = 28;
  var tiles = [];          // flat array of tile objects
  var seed = 1;

  function idx(x, y) { return y * COLS + x; }
  function inb(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }
  function at(x, y) { return inb(x, y) ? tiles[idx(x, y)] : null; }

  /* island types: the same shaping, with different weather and bones */
  var KINDS = {
    green:    { wetF: 0.55, wetM: 0.46, rockH: 0.50, rockR: 0.72, hillH: 0.40, hillR: 0.60 },
    forest:   { wetF: 0.44, wetM: 0.38, rockH: 0.52, rockR: 0.76, hillH: 0.44, hillR: 0.64 },
    highland: { wetF: 0.60, wetM: 0.52, rockH: 0.36, rockR: 0.62, hillH: 0.24, hillR: 0.46 },
    twin:     { wetF: 0.55, wetM: 0.46, rockH: 0.50, rockR: 0.72, hillH: 0.40, hillR: 0.60, twin: true }
  };
  var kind = 'green';
  function generate(sd, type) {
    seed = sd >>> 0 || 1;
    kind = KINDS[type] ? type : 'green';
    var K = KINDS[kind];
    var n1 = U.makeNoise(seed), n2 = U.makeNoise(seed ^ 0x9e37), n3 = U.makeNoise(seed ^ 0x51ed);
    var r = U.mulberry(seed);
    tiles = [];
    var cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;

    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        // island falloff — land in the middle, sea at the edges
        var dx = (x - cx) / cx, dy = (y - cy) / cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (K.twin) {
          // two islands on a diagonal, joined by a spit of sand
          var d1 = Math.hypot(dx + 0.30, dy + 0.30) * 1.75, d2 = Math.hypot(dx - 0.40, dy - 0.40) * 2.1;
          d = Math.min(d1, d2);
        }
        var h = n1(x * 0.13, y * 0.13, 4) * 1.15 - Math.pow(d, 2.4) * 0.92 + 0.16;
        var t;
        if (h < -0.02) t = 'water';
        else if (h < 0.045) t = 'shore';
        else if (h < 0.10) t = 'sand';
        else {
          var rocky = n2(x * 0.17 + 40, y * 0.17 + 40, 3);
          var wet = n3(x * 0.15 - 20, y * 0.15 - 20, 3);
          if (h > K.rockH && rocky > K.rockR) t = 'rock';
          else if (h > K.hillH && rocky > K.hillR) t = 'hill';
          else if (wet > K.wetF) t = 'forest';
          else if (wet > K.wetM) t = 'meadow';
          else t = 'grass';
        }
        tiles.push({
          x: x, y: y, terr: t,
          v: Math.floor(r() * 4),
          tree: Math.floor(r() * 2),
          jitter: (r() - .5) * 10,
          jitter2: (r() - .5) * 10,
          bld: null,      // building object occupying this tile
          road: false
        });
      }
    }

    if (K.twin) {
      for (var k2 = 0; k2 <= 40; k2++) {
        var f2 = k2 / 40, bx = Math.round(cx - cx * 0.30 + f2 * cx * 0.70), by = Math.round(cy - cy * 0.30 + f2 * cy * 0.70);
        for (var o2 = -1; o2 <= 0; o2++) {
          var tb = tiles[(by + o2) * COLS + bx];
          if (tb && (tb.terr === 'water' || tb.terr === 'shore')) tb.terr = 'sand';
        }
      }
    }
    // tidy the coastline: a beach ring around the sea, no stray inland sand
    for (var i = 0; i < tiles.length; i++) {
      var t0 = tiles[i];
      if (t0.terr === 'water') {
        if (nearCount(t0.x, t0.y, ['sand', 'grass', 'meadow', 'forest', 'hill', 'rock'], 1) > 0) t0.terr = 'shore';
      }
    }
    for (i = 0; i < tiles.length; i++) {
      var t1 = tiles[i];
      if (t1.terr === 'sand' && nearCount(t1.x, t1.y, ['water', 'shore'], 3) === 0) {
        t1.terr = n3(t1.x * 0.15 - 20, t1.y * 0.15 - 20, 3) > 0.52 ? 'meadow' : 'grass';
      }
    }

    // guarantee a buildable heart for the castle
    var spot = findCastleSpot();
    for (var oy = -2; oy <= 3; oy++) {
      for (var ox = -2; ox <= 3; ox++) {
        var t2 = at(spot.x + ox, spot.y + oy);
        if (t2 && (t2.terr === 'water' || t2.terr === 'shore' || t2.terr === 'rock')) t2.terr = 'grass';
      }
    }
    // make sure there is some forest, hill and rock within reach
    ensure('forest', spot, 6, 10);
    ensure('hill', spot, 8, 8);
    ensure('rock', spot, 9, 4);
    return spot;
  }

  function ensure(kind, near, radius, count) {
    var have = 0;
    for (var i = 0; i < tiles.length; i++) {
      if (tiles[i].terr === kind && Math.abs(tiles[i].x - near.x) <= radius && Math.abs(tiles[i].y - near.y) <= radius) have++;
    }
    if (have >= count) return;
    var r = U.mulberry(seed ^ kind.charCodeAt(0) * 7919);
    var tries = 0;
    while (have < count && tries < 400) {
      tries++;
      var a = r() * 6.283, dd = 3 + r() * (radius - 3);
      var x = Math.round(near.x + Math.cos(a) * dd), y = Math.round(near.y + Math.sin(a) * dd);
      var t = at(x, y);
      if (!t || t.terr === 'water' || t.terr === 'shore') continue;
      if (Math.abs(x - near.x) <= 2 && Math.abs(y - near.y) <= 2) continue;
      if (t.terr === kind) continue;
      t.terr = kind;
      have++;
    }
  }

  function findCastleSpot() {
    var best = null, bestScore = -1e9;
    for (var y = 4; y < ROWS - 5; y++) {
      for (var x = 4; x < COLS - 5; x++) {
        var ok = true, land = 0;
        for (var oy = 0; oy < 2 && ok; oy++)
          for (var ox = 0; ox < 2 && ok; ox++) {
            var t = at(x + ox, y + oy);
            if (!t || !DATA.TERRAIN[t.terr].build) ok = false;
          }
        if (!ok) continue;
        for (var ry = -3; ry <= 3; ry++)
          for (var rx = -3; rx <= 3; rx++) {
            var t2 = at(x + rx, y + ry);
            if (t2 && DATA.TERRAIN[t2.terr].walk) land++;
          }
        var centre = -U.dist(x, y, COLS / 2, ROWS / 2) * 1.5;
        var score = land + centre;
        if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
      }
    }
    return best || { x: 13, y: 13 };
  }

  /* count matching terrain within radius (default 1 = the 8 neighbours) */
  function nearCount(x, y, kinds, radius) {
    radius = radius || 1;
    var n = 0;
    for (var oy = -radius; oy <= radius; oy++)
      for (var ox = -radius; ox <= radius; ox++) {
        if (!ox && !oy) continue;
        var t = at(x + ox, y + oy);
        if (t && kinds.indexOf(t.terr) >= 0) n++;
      }
    return n;
  }

  function footprint(def, x, y) {
    var w = def.w || 1, h = def.h || 1, out = [];
    for (var oy = 0; oy < h; oy++) for (var ox = 0; ox < w; ox++) out.push({ x: x + ox, y: y + oy });
    return out;
  }

  /* can this building go here? returns {ok:bool, why:string} */
  function canPlace(id, x, y, defOverride, ignore) {
    var def = defOverride || DATA.B[id];
    if (!def) return { ok: false, why: 'Unknown building' };
    var cells = footprint(def, x, y);
    for (var i = 0; i < cells.length; i++) {
      var t = at(cells[i].x, cells[i].y);
      if (!t) return { ok: false, why: 'Outside the realm' };
      // woodland is simply cleared for anything that could stand on open grass
      var ok = def.terrain.indexOf(t.terr) >= 0 ||
               (t.terr === 'forest' && def.terrain.indexOf('grass') >= 0);
      if (!ok) return { ok: false, why: 'Cannot build on ' + DATA.TERRAIN[t.terr].name.toLowerCase() };
      if (t.bld && t.bld !== ignore) return { ok: false, why: 'Already occupied' };
      if (typeof EXPLORE !== 'undefined') {
        if (!EXPLORE.seen(t.x, t.y)) return { ok: false, why: 'Unexplored — send a scout first' };
        if (EXPLORE.blocked(t.x, t.y)) return { ok: false, why: 'Something is already here' };
      }
    }
    if (def.near) {
      var n = nearCount(x, y, def.near.terrain, 1);
      if (n < def.near.min) {
        var names = def.near.terrain.map(function (k) { return DATA.TERRAIN[k].name.toLowerCase(); }).join(' or ');
        return { ok: false, why: 'Must be built beside ' + names };
      }
    }
    return { ok: true, why: '' };
  }

  /* ---------- pathfinding (A*) for villagers ---------- */
  function walkable(t) {
    if (!t) return false;
    if (!DATA.TERRAIN[t.terr].walk) return false;
    if (t.bld && !t.bld.def.isRoad && !t.bld.def.isWall) return t.bld.walkThrough === true;
    if (t.bld && t.bld.def.isWall) return false;
    return true;
  }
  function stepCost(t) { return t.path ? 0.45 : (t.terr === 'forest' ? 1.5 : 1); }

  var NB = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

  function path(sx, sy, tx, ty, limit) {
    limit = limit || 900;
    if (sx === tx && sy === ty) return [];
    var open = [{ x: sx, y: sy, g: 0, f: 0, p: null }];
    var seen = {}; seen[sx + ',' + sy] = 0;
    var iter = 0, best = null;
    while (open.length && iter++ < limit) {
      // cheapest first (small maps: linear scan is fine)
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (cur.x === tx && cur.y === ty) { best = cur; break; }
      for (var n = 0; n < NB.length; n++) {
        var nx = cur.x + NB[n][0], ny = cur.y + NB[n][1];
        var t = at(nx, ny);
        var goal = (nx === tx && ny === ty);
        if (!t) continue;
        if (!goal && !walkable(t)) continue;
        if (!goal && !DATA.TERRAIN[t.terr].walk) continue;
        var diag = NB[n][0] && NB[n][1];
        if (diag) {
          var a = at(cur.x + NB[n][0], cur.y), b = at(cur.x, cur.y + NB[n][1]);
          if (!walkable(a) || !walkable(b)) continue;
        }
        var g = cur.g + stepCost(t) * (diag ? 1.41 : 1);
        var key = nx + ',' + ny;
        if (seen[key] !== undefined && seen[key] <= g) continue;
        seen[key] = g;
        open.push({ x: nx, y: ny, g: g, f: g + U.dist(nx, ny, tx, ty) * 1.05, p: cur });
      }
    }
    if (!best) return null;
    var out = [];
    while (best) { out.unshift({ x: best.x, y: best.y }); best = best.p; }
    out.shift();
    return out;
  }

  function randomWalkable(r) {
    for (var i = 0; i < 200; i++) {
      var t = tiles[Math.floor(r() * tiles.length)];
      if (walkable(t)) return t;
    }
    return null;
  }

  /* ---------------- trees and rocks: where they stand ---------------- */
  function treesOf(t) {
    if (t._trees) return t._trees;
    var r = U.mulberry((seed * 31) ^ (t.x * 7349 + t.y * 3371));
    var out = [], n = 3 + (r() < 0.45 ? 1 : 0);
    // conifers cluster on high ground, broadleaf in the lowland
    var pine = (t.x * 0.37 + t.y * 0.23 + Math.sin(t.x * 0.9) * 2 + Math.cos(t.y * 0.7) * 2) % 5 > 3.1 ? 0.75 : 0.18;
    for (var i = 0; i < n; i++) {
      var u = (i % 2) * 0.46 + 0.15 + r() * 0.3, v = Math.floor(i / 2) * 0.46 + 0.15 + r() * 0.3;
      if (n === 3 && i === 2) u = 0.3 + r() * 0.4;
      var k = r() < pine ? 1 : (r() < 0.16 ? 2 : 0);
      out.push({ x: t.x + u, y: t.y + v, kind: k, v: Math.floor(r() * 3), s: 0.82 + r() * 0.36, ph: r() * 6.28 });
    }
    t._trees = out;
    return out;
  }
  function rocksOf(t) {
    if (t._rocks) return t._rocks;
    var r = U.mulberry((seed * 17) ^ (t.x * 5153 + t.y * 9203));
    var out = [];
    var n = 1 + Math.floor(r() * 2);
    for (var i = 0; i < n; i++) out.push({ x: t.x + 0.25 + r() * 0.5, y: t.y + 0.25 + r() * 0.5, v: Math.floor(r() * 4), s: 0.7 + r() * 0.5 });
    t._rocks = out;
    return out;
  }

  /* serialise only what generation can't recreate */
  function serialize() {
    var mods = [];
    tiles.forEach(function (t, i) {
      if (t.cleared) mods.push([i, 'c', t.terr]);
    });
    return { seed: seed, mods: mods, kind: kind };
  }
  function deserialize(d) {
    generate(d.seed, d.kind);
    (d.mods || []).forEach(function (m) {
      var t = tiles[m[0]];
      if (!t) return;
      if (m[1] === 'c') { t.cleared = true; t.terr = m[2]; }
    });
  }

  return {
    COLS: COLS, ROWS: ROWS, KINDS: KINDS, get kind() { return kind; },
    get tiles() { return tiles; },
    idx: idx, inb: inb, at: at,
    generate: generate, findCastleSpot: findCastleSpot,
    nearCount: nearCount, footprint: footprint, canPlace: canPlace,
    walkable: walkable, path: path, randomWalkable: randomWalkable,
    treesOf: treesOf, rocksOf: rocksOf,
    serialize: serialize, deserialize: deserialize,
    getSeed: function () { return seed; }
  };
})();
