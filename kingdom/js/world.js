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

  function generate(sd) {
    seed = sd >>> 0 || 1;
    var n1 = U.makeNoise(seed), n2 = U.makeNoise(seed ^ 0x9e37), n3 = U.makeNoise(seed ^ 0x51ed);
    var r = U.mulberry(seed);
    tiles = [];
    var cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;

    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        // island falloff — land in the middle, sea at the edges
        var dx = (x - cx) / cx, dy = (y - cy) / cy;
        var d = Math.sqrt(dx * dx + dy * dy);
        var h = n1(x * 0.13, y * 0.13, 4) * 1.15 - Math.pow(d, 2.4) * 0.92 + 0.16;
        var t;
        if (h < -0.02) t = 'water';
        else if (h < 0.045) t = 'shore';
        else if (h < 0.10) t = 'sand';
        else {
          var rocky = n2(x * 0.17 + 40, y * 0.17 + 40, 3);
          var wet = n3(x * 0.15 - 20, y * 0.15 - 20, 3);
          if (h > 0.44 && rocky > 0.60) t = 'rock';
          else if (h > 0.33 && rocky > 0.47) t = 'hill';
          else if (wet > 0.60) t = 'forest';
          else if (wet > 0.50) t = 'meadow';
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
  function canPlace(id, x, y) {
    var def = DATA.B[id];
    if (!def) return { ok: false, why: 'Unknown building' };
    var cells = footprint(def, x, y);
    for (var i = 0; i < cells.length; i++) {
      var t = at(cells[i].x, cells[i].y);
      if (!t) return { ok: false, why: 'Outside the realm' };
      if (def.terrain.indexOf(t.terr) < 0) return { ok: false, why: 'Cannot build on ' + DATA.TERRAIN[t.terr].name.toLowerCase() };
      if (t.bld) return { ok: false, why: 'Already occupied' };
      if (t.road && !def.isRoad) return { ok: false, why: 'A road runs here' };
      if (def.isRoad && t.road) return { ok: false, why: 'Already a road' };
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
  function stepCost(t) { return t.road ? 0.45 : (t.terr === 'forest' ? 1.5 : 1); }

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

  /* serialise only what generation can't recreate */
  function serialize() {
    var mods = [];
    tiles.forEach(function (t, i) {
      if (t.road) mods.push([i, 'r']);
      if (t.cleared) mods.push([i, 'c', t.terr]);
    });
    return { seed: seed, mods: mods };
  }
  function deserialize(d) {
    generate(d.seed);
    (d.mods || []).forEach(function (m) {
      var t = tiles[m[0]];
      if (!t) return;
      if (m[1] === 'r') t.road = true;
      if (m[1] === 'c') { t.cleared = true; t.terr = m[2]; }
    });
  }

  return {
    COLS: COLS, ROWS: ROWS,
    get tiles() { return tiles; },
    idx: idx, inb: inb, at: at,
    generate: generate, findCastleSpot: findCastleSpot,
    nearCount: nearCount, footprint: footprint, canPlace: canPlace,
    walkable: walkable, path: path, randomWalkable: randomWalkable,
    serialize: serialize, deserialize: deserialize,
    getSeed: function () { return seed; }
  };
})();
