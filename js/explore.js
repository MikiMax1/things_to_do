/* ============================================================
   explore.js — a bigger world.
   On the island: most of it starts under mist. Buildings and
   watchtowers push the edge back, and scouts can be sent into the
   unknown, where old ruins, standing stones, an iron seam, a spring
   or a smugglers' cave may be waiting.
   At sea: a chart of the waters around Ashveil. Ships go out to
   chart the islets; outposts on them send goods home each season,
   a route to the mainland port brings in trade, and the Sea Wolves'
   haven can be found — and burned.
   ============================================================ */
var EXPLORE = (function () {
  'use strict';

  function G() { return SIM.G; }
  function R() { return Math.random(); }

  /* ---------------- fog on the island ---------------- */
  var fog = null, fogDirty = true, fogCv = null, noiseCv = null, fogEmpty = false;

  function ensure() {
    var g = G();
    if (!g) return;
    if (!fog || fog.length !== W.COLS * W.ROWS || fog._g !== g) {
      fog = new Uint8Array(W.COLS * W.ROWS);
      fog._g = g;
      if (typeof g.fog === 'string' && g.fog.length === fog.length) {
        for (var i = 0; i < fog.length; i++) fog[i] = g.fog.charCodeAt(i) === 49 ? 1 : 0;
      } else if (g.fog === undefined || g.fog === null) {
        fog.fill(1);   // a reign begun before the mist: all of it is known
      } else {
        var c = g.buildings[0];
        reveal(c.x + 1, c.y + 1, 7.5, true);
      }
      fogDirty = true;
    }
    if (!g.sites) g.sites = makeSites();
    if (!g.sea) g.sea = makeSea();
    if (!g.scouts) g.scouts = [];
  }
  function seen(x, y) {
    if (!fog) return true;
    if (x < 0 || y < 0 || x >= W.COLS || y >= W.ROWS) return true;
    return fog[y * W.COLS + x] === 1;
  }
  function reveal(cx, cy, r, quiet) {
    if (!fog) return;
    var any = false;
    for (var y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (var x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= W.COLS || y >= W.ROWS) continue;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        var k = y * W.COLS + x;
        if (!fog[k]) { fog[k] = 1; any = true; }
      }
    }
    if (!any) return;
    fogDirty = true;
    save();
    if (!quiet) checkSites();
  }
  function save() {
    var s = '';
    for (var i = 0; i < fog.length; i++) s += fog[i] ? '1' : '0';
    G().fog = s;
  }
  function known() {
    if (!fog) return 1;
    var n = 0, land = 0;
    for (var i = 0; i < fog.length; i++) {
      var t = W.tiles[i];
      if (t.terr === 'water') continue;
      land++; if (fog[i]) n++;
    }
    return land ? n / land : 1;
  }

  /* the mist, painted once per change into a small canvas that the
     renderer lays over the ground in world space */
  function fogCanvas() {
    if (!fog) return null;
    if (!fogDirty) return fogEmpty ? null : fogCv;
    fogDirty = false;
    // nothing left under mist (on land): draw nothing at all
    fogEmpty = true;
    for (var q = 0; q < fog.length && fogEmpty; q++) if (!fog[q] && W.tiles[q].terr !== 'water') fogEmpty = false;
    if (fogEmpty) return null;
    var S = 8, w = W.COLS * S, h = W.ROWS * S;
    if (!noiseCv) {
      noiseCv = document.createElement('canvas'); noiseCv.width = w; noiseCv.height = h;
      var nx = noiseCv.getContext('2d'), img = nx.createImageData(w, h), nz = U.makeNoise(911);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var v = nz(x * 0.045, y * 0.045, 4), i = (y * w + x) * 4;
        var c = 196 + v * 50;
        img.data[i] = c * 0.93; img.data[i + 1] = c * 0.95; img.data[i + 2] = c; img.data[i + 3] = 255;
      }
      nx.putImageData(img, 0, 0);
    }
    // alpha mask: one pixel a tile, smoothed up so the edge feathers
    var small = document.createElement('canvas'); small.width = W.COLS + 2; small.height = W.ROWS + 2;
    var sx = small.getContext('2d'), mi = sx.createImageData(W.COLS + 2, W.ROWS + 2);
    for (var yy = -1; yy <= W.ROWS; yy++) for (var xx = -1; xx <= W.COLS; xx++) {
      var tx = U.clamp(xx, 0, W.COLS - 1), ty = U.clamp(yy, 0, W.ROWS - 1), tt = W.at(tx, ty);
      var on = !seen(tx, ty) && tt && tt.terr !== 'water' && !(xx < 0 || yy < 0 || xx >= W.COLS || yy >= W.ROWS);
      var j = ((yy + 1) * (W.COLS + 2) + xx + 1) * 4;
      mi.data[j] = mi.data[j + 1] = mi.data[j + 2] = 255; mi.data[j + 3] = on ? 255 : 0;
    }
    sx.putImageData(mi, 0, 0);
    if (!fogCv) { fogCv = document.createElement('canvas'); fogCv.width = w; fogCv.height = h; }
    var fx = fogCv.getContext('2d');
    fx.clearRect(0, 0, w, h);
    fx.imageSmoothingEnabled = true; fx.imageSmoothingQuality = 'high';
    // two passes of upscaling soften the tile steps into a rolling bank
    var mid = document.createElement('canvas'); mid.width = W.COLS * 2; mid.height = W.ROWS * 2;
    var mx = mid.getContext('2d'); mx.imageSmoothingEnabled = true;
    mx.drawImage(small, 0.5, 0.5, W.COLS + 1, W.ROWS + 1, 0, 0, mid.width, mid.height);
    fx.drawImage(mid, 0, 0, w, h);
    fx.globalCompositeOperation = 'source-in';
    fx.drawImage(noiseCv, 0, 0);
    fx.globalCompositeOperation = 'source-over';
    return fogCv;
  }

  /* ---------------- scouts ---------------- */
  var SCOUT_COST = 10;
  function sendScout(tx, ty) {
    var g = G();
    if (g.res.gold < SCOUT_COST) return { ok: false, why: 'Not enough gold' };
    if (g.scouts.length >= 3) return { ok: false, why: 'All your scouts are already out' };
    g.res.gold -= SCOUT_COST;
    var c = g.buildings[0];
    g.scouts.push({ x: c.x + 1.5, y: c.y + 2.2, tx: tx + 0.5, ty: ty + 0.5, bob: 0, face: 1 });
    return { ok: true };
  }
  function tickScouts(dt) {
    var g = G();
    for (var i = g.scouts.length - 1; i >= 0; i--) {
      var s = g.scouts[i];
      var dx = s.tx - s.x, dy = s.ty - s.y, d = Math.hypot(dx, dy);
      var sp = 1.6 * dt;
      if (d <= sp) {
        reveal(s.tx, s.ty, 4.2);
        g.scouts.splice(i, 1);
        SIM.emit('toast', { msg: 'A scout is back with a map of the land to the ' + dirName(s.tx, s.ty) + '.', kind: 'good' });
        continue;
      }
      s.x += dx / d * sp; s.y += dy / d * sp; s.bob += sp * 9;
      if (Math.abs(dx) > 0.02) s.face = dx - dy > 0 ? 1 : -1;
      s.reveal = (s.reveal || 0) - dt;
      if (s.reveal <= 0) { s.reveal = 0.4; reveal(s.x, s.y, 1.8); }
    }
  }
  function dirName(x, y) {
    var c = G().buildings[0], a = Math.atan2(y - c.y, x - c.x);
    // the island is seen at a diamond: world +x runs down-right on screen
    var dirs = ['south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east'];
    return dirs[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }

  /* ---------------- sites on the island ---------------- */
  var SITES = {
    ruin:   { name: 'Ruined Watchtower', ic: '🏚️', desc: 'Fallen stones from before Ashveil. Someone left in a hurry.' },
    stones: { name: 'Standing Stones',   ic: '🗿', desc: 'A ring of old stones. The people leave flowers here.' },
    ore:    { name: 'Iron Seam',         ic: '⛓️', desc: 'Rust-red rock breaks the surface. Mines and quarries within 3 tiles work 40% better.' },
    spring: { name: 'Clear Spring',      ic: '💧', desc: 'Sweet water bubbling from the ground. Homes nearby drink from it as from a well, and farms within 3 tiles grow 15% more.' },
    cave:   { name: 'Smugglers\' Cave',   ic: '🕳️', desc: 'A cleft in the rock with a smell of tar. Somebody used this.' }
  };
  function makeSites() {
    var g = G(), r = U.mulberry((g.seed || 1) ^ 0x5eed), c = g.buildings[0], out = [];
    var want = ['ruin', 'stones', 'ore', 'spring', 'cave'];
    var land = W.tiles.filter(function (t) {
      return t.terr !== 'water' && t.terr !== 'shore' && t.terr !== 'rock' && !t.bld && Math.hypot(t.x - c.x, t.y - c.y) > 7.5;
    });
    want.forEach(function (k) {
      var pool = land.filter(function (t) {
        if (k === 'ore') return t.terr === 'hill' || W.nearCount(t.x, t.y, ['rock', 'hill'], 1) > 1;
        if (k === 'cave') return W.nearCount(t.x, t.y, ['rock', 'hill', 'shore'], 1) > 0;
        return true;
      }).filter(function (t) { return out.every(function (o) { return Math.hypot(o.x - t.x, o.y - t.y) > 4; }); });
      if (!pool.length) return;
      var t = pool[Math.floor(r() * pool.length)];
      out.push({ k: k, x: t.x, y: t.y, found: false, done: false });
    });
    return out;
  }
  function checkSites() {
    G().sites.forEach(function (s) {
      if (s.found || !seen(s.x, s.y)) return;
      s.found = true;
      SIM.emit('site-found', s);
    });
  }
  function siteAt(x, y) {
    var ss = (G() && G().sites) || [];
    for (var i = 0; i < ss.length; i++) if (ss[i].x === x && ss[i].y === y && ss[i].found) return ss[i];
    return null;
  }
  function blocked(x, y) {
    var ss = (G() && G().sites) || [];
    for (var i = 0; i < ss.length; i++) if (ss[i].x === x && ss[i].y === y) return ss[i];
    return null;
  }
  /* one-off rewards for poking about */
  function search(s) {
    var g = G();
    if (s.done) return { ok: false, why: 'Already searched' };
    s.done = true;
    var msg;
    if (s.k === 'ruin') {
      g.res.stone = Math.min(SIM.cap('stone'), g.res.stone + 60); g.res.gold = Math.min(SIM.cap('gold'), g.res.gold + 45);
      msg = 'Good dressed stone for the taking, and a purse under the hearth: +60 stone, +45 gold.';
    } else if (s.k === 'stones') {
      g.happy = U.clamp(g.happy + 8, 0, 100); g.blessing = (g.blessing || 0) + 3;
      msg = 'You have the stones cleared of brambles and a feast held there. The people are glad of it: +8 contentment now, and +3 for good.';
    } else if (s.k === 'cave') {
      var gold = 90 + Math.floor(R() * 80);
      g.res.gold = Math.min(SIM.cap('gold'), g.res.gold + gold); g.res.iron = Math.min(SIM.cap('iron'), g.res.iron + 15);
      msg = 'Kegs, bolts of cloth gone to rot, and a sea-chest: +' + gold + ' gold, +15 iron. Someone will miss it.';
    } else {
      msg = SITES[s.k].desc;
    }
    SIM.emit('change');
    return { ok: true, msg: msg };
  }
  /* lasting effects of a site on the buildings around it */
  function bonusAt(b) {
    var ss = G() && G().sites;
    if (!ss) return 1;
    var mul = 1;
    for (var i = 0; i < ss.length; i++) {
      var s = ss[i];
      if (!s.found) continue;
      var d = Math.hypot(s.x - b.x, s.y - b.y);
      if (s.k === 'ore' && d <= 3.4 && (b.id === 'mine' || b.id === 'quarry')) mul *= 1.4;
      if (s.k === 'spring' && d <= 3.4 && b.def.seasonal) mul *= 1.15;
    }
    return mul;
  }
  function springNear(b, r) {
    var ss = G() && G().sites;
    if (!ss) return 0;
    for (var i = 0; i < ss.length; i++) {
      var s = ss[i];
      if (s.k === 'spring' && s.found && Math.hypot(s.x - b.x, s.y - b.y) <= r) return Math.hypot(s.x - b.x, s.y - b.y) || 1;
    }
    return 0;
  }

  /* ---------------- the sea chart ---------------- */
  var SPOTS = {
    stone: { name: 'Gull Rock',      ic: '🪨', res: 'stone', amt: 45, desc: 'A bare granite islet loud with gulls. Quarry-stone for the taking.' },
    wood:  { name: 'Pine Holm',      ic: '🌲', res: 'wood',  amt: 55, desc: 'Tall pines grow right down to the tideline.' },
    food:  { name: 'Barley Isle',    ic: '🌾', res: 'food',  amt: 70, desc: 'Low, green and sheltered. Someone farmed it once.' },
    iron:  { name: 'Iron Skerry',    ic: '⛏️', res: 'iron',  amt: 18, desc: 'Red cliffs streaked with ore.' },
    wool:  { name: 'Wether Eyot',    ic: '🐑', res: 'wool',  amt: 26, desc: 'Wild sheep on a windy hump of grass.' },
    port:  { name: 'Carrow Port',    ic: '⚓', desc: 'The mainland market town. A standing route here brings steady trade.' },
    haven: { name: 'The Wolves\' Haven', ic: '🐺', desc: 'A cove of black-sailed longships. Burn it and the Sea Wolves will not trouble you for a long while.' },
    abbey: { name: 'The Drowned Abbey', ic: '⛪', desc: 'An abbey half taken by the sea. Its bell still rings at low tide.' }
  };
  var OUTPOST_COST = { gold: 60, wood: 80, food: 40 }, OUTPOST_PEOPLE = 3;
  var CHART_COST = { gold: 30, food: 20 }, ROUTE_COST = 180;
  function makeSea() {
    var r = U.mulberry(((G().seed || 1) ^ 0xc4a7) >>> 0);
    var kinds = ['stone', 'wood', 'food', 'iron', 'wool', 'port', 'haven', 'abbey'];
    var spots = [];
    var base = r() * 6.28;
    kinds.forEach(function (k, i) {
      var a = base + i / kinds.length * 6.28 + (r() - 0.5) * 0.5;
      var far = k === 'haven' || k === 'port' ? 0.40 + r() * 0.05 : 0.25 + r() * 0.13;
      spots.push({ k: k, x: 0.5 + Math.cos(a) * far, y: 0.5 + Math.sin(a) * far * 0.8, known: false, outpost: false, route: false, burned: false, seed: Math.floor(r() * 1e6) });
    });
    return { spots: spots, voyage: null, wolvesQuiet: 0 };
  }
  function harbour() { return (G().count && G().count.fishery) > 0; }
  function canAfford(c) { return Object.keys(c).every(function (k) { return G().res[k] >= c[k]; }); }
  function pay(c) { Object.keys(c).forEach(function (k) { G().res[k] -= c[k]; }); }
  function chart(i) {
    var g = G(), sp = g.sea.spots[i];
    if (!harbour()) return { ok: false, why: 'You need a harbour — build a fishing hut first' };
    if (g.sea.voyage) return { ok: false, why: 'Your ship is already at sea' };
    if (sp.known) return { ok: false, why: 'Already charted' };
    if (!canAfford(CHART_COST)) return { ok: false, why: 'Needs 30 gold and 20 food for the crew' };
    pay(CHART_COST);
    g.sea.voyage = { to: i, t: 0, len: DATA.SEASON_LEN * 0.55 };
    return { ok: true, msg: 'A ship puts out to chart the waters. Back in about half a season.' };
  }
  function tickSea(dt) {
    var g = G(), v = g.sea.voyage;
    if (!v) return;
    v.t += dt;
    if (v.t < v.len) return;
    g.sea.voyage = null;
    var sp = g.sea.spots[v.to], d = SPOTS[sp.k];
    sp.known = true;
    var extra = '';
    if (sp.k === 'abbey' && !sp.looted) {
      sp.looted = true;
      g.res.gold = Math.min(SIM.cap('gold'), g.res.gold + 150);
      g.happy = U.clamp(g.happy + 5, 0, 100);
      extra = ' The crew brought back a silver bell and chest of plate: +150 gold.';
    }
    SIM.emit('voyage', { spot: sp, msg: 'Your ship is home. They charted ' + d.name + ': ' + d.desc + extra });
  }
  function foundOutpost(i) {
    var g = G(), sp = g.sea.spots[i], d = SPOTS[sp.k];
    if (!d.res) return { ok: false, why: 'Nothing to settle there' };
    if (!sp.known) return { ok: false, why: 'Chart it first' };
    if (sp.outpost) return { ok: false, why: 'You already hold it' };
    if (!harbour()) return { ok: false, why: 'You need a harbour' };
    if (g.pop < OUTPOST_PEOPLE + 4) return { ok: false, why: 'You cannot spare ' + OUTPOST_PEOPLE + ' settlers' };
    if (!canAfford(OUTPOST_COST)) return { ok: false, why: 'Needs 60 gold, 80 wood and 40 food' };
    pay(OUTPOST_COST);
    g.pop -= OUTPOST_PEOPLE; g._lossWhy = 'leave';
    sp.outpost = true;
    return { ok: true, msg: OUTPOST_PEOPLE + ' families sail for ' + d.name + '. Their goods will come home every season.' };
  }
  function openRoute(i) {
    var g = G(), sp = g.sea.spots[i];
    if (sp.k !== 'port') return { ok: false, why: 'No market there' };
    if (!sp.known) return { ok: false, why: 'Chart it first' };
    if (sp.route) return { ok: false, why: 'The route is already running' };
    if (!harbour()) return { ok: false, why: 'You need a harbour' };
    if (g.res.gold < ROUTE_COST) return { ok: false, why: 'Needs ' + ROUTE_COST + ' gold' };
    g.res.gold -= ROUTE_COST; sp.route = true;
    return { ok: true, msg: 'The Carrow merchants agree terms. A ship will run between you every season.' };
  }
  function routeOpen() { var s = G() && G().sea; return !!(s && s.spots.some(function (p) { return p.route; })); }
  function tradeBonus() { return routeOpen() ? 0.06 : 0; }
  function wolvesQuiet() { var s = G() && G().sea; return !!(s && s.wolvesQuiet > G().time); }
  function hitHaven(won) {
    var g = G(), sp = g.sea.spots.filter(function (p) { return p.k === 'haven'; })[0];
    if (won) { g.sea.wolvesQuiet = g.time + DATA.SEASON_LEN * 8; if (sp) sp.burned = true; }
  }
  /* each new season: goods home from the outposts, gold from the route */
  function seasonSea() {
    var g = G(), notes = [], quiet = wolvesQuiet();
    g.sea.spots.forEach(function (sp) {
      var d = SPOTS[sp.k];
      if (sp.outpost) {
        if (!quiet && SIM.seasonIndex() >= 10 && R() < 0.1) {
          notes.push('Sea Wolves raided ' + d.name + ' — nothing came home');
          return;
        }
        var amt = d.amt * (SIM.season().key === 'winter' && sp.k === 'food' ? 0.4 : 1) * (SIM.done('harbour') ? 1.25 : 1);
        g.res[d.res] = Math.min(SIM.cap(d.res), (g.res[d.res] || 0) + amt);
        if (g.seen) g.seen[d.res] = 1;
        notes.push('+' + Math.round(amt) + ' ' + d.res + ' from ' + d.name);
      }
      if (sp.route) {
        var gold = Math.round((40 + Math.min(60, SIM.goodsValue() * 12)) * (SIM.done('harbour') ? 1.5 : 1));
        g.res.gold = Math.min(SIM.cap('gold'), g.res.gold + gold);
        notes.push('+' + gold + ' gold on the Carrow route');
      }
    });
    if (notes.length) SIM.emit('toast', { msg: '⛵ ' + notes.join(' · '), kind: 'good' });
  }

  /* ---------------- the chart itself ---------------- */
  function drawChart(cv, sel, time) {
    var g = G(), sea = g.sea, x = cv.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1), W0 = cv.clientWidth, H0 = cv.clientHeight;
    if (cv.width !== Math.round(W0 * dpr)) { cv.width = Math.round(W0 * dpr); cv.height = Math.round(H0 * dpr); }
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    // parchment
    var bg = x.createRadialGradient(W0 / 2, H0 / 2, 20, W0 / 2, H0 / 2, W0 * 0.75);
    bg.addColorStop(0, '#e9dcb8'); bg.addColorStop(1, '#bda779');
    x.fillStyle = bg; x.fillRect(0, 0, W0, H0);
    // sea tint and rhumb lines
    x.fillStyle = 'rgba(70,110,120,.13)'; x.fillRect(0, 0, W0, H0);
    x.strokeStyle = 'rgba(90,70,40,.16)'; x.lineWidth = 0.8;
    for (var k = 0; k < 16; k++) {
      var a = k / 16 * 6.28;
      x.beginPath(); x.moveTo(W0 / 2, H0 / 2); x.lineTo(W0 / 2 + Math.cos(a) * W0, H0 / 2 + Math.sin(a) * W0); x.stroke();
    }
    // Ashveil, drawn from the real island
    var S = Math.min(W0, H0) * 0.26 / W.COLS;
    var ox = W0 / 2 - W.COLS * S / 2, oy = H0 / 2 - W.ROWS * S / 2;
    var LAND = { sand: '#d6c48f', grass: '#9fae70', meadow: '#a9b56f', forest: '#71864f', hill: '#a39673', rock: '#8a8272' };
    W.tiles.forEach(function (t) {
      var c = LAND[t.terr]; if (!c) return;
      x.fillStyle = seen(t.x, t.y) ? c : '#c9b98f';
      x.fillRect(ox + t.x * S, oy + t.y * S, S + 0.6, S + 0.6);
    });
    x.fillStyle = '#5a3a22'; var cs = g.buildings[0];
    x.fillRect(ox + cs.x * S, oy + cs.y * S, S * 2, S * 2);
    label(x, 'ASHVEIL', W0 / 2, oy + W.ROWS * S + 13, true);
    // routes
    sea.spots.forEach(function (sp, i) {
      var p = at(sp);
      if (!sp.outpost && !sp.route) return;
      x.setLineDash([4, 4]); x.strokeStyle = sp.route ? 'rgba(150,90,20,.8)' : 'rgba(60,80,40,.7)'; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(W0 / 2, H0 / 2); x.lineTo(p.x, p.y); x.stroke(); x.setLineDash([]);
    });
    // islands
    sea.spots.forEach(function (sp, i) {
      var p = at(sp), d = SPOTS[sp.k], big = sp.k === 'port' ? 1.6 : sp.k === 'haven' ? 1.2 : 1;
      var rr = U.mulberry(sp.seed);
      x.beginPath();
      for (var s = 0; s <= 14; s++) {
        var an = s / 14 * 6.28, rad = (9 + rr() * 6) * big;
        var px = p.x + Math.cos(an) * rad * 1.3, py = p.y + Math.sin(an) * rad * 0.8;
        if (!s) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath();
      if (sp.known) {
        x.fillStyle = sp.k === 'haven' ? (sp.burned ? '#6d6458' : '#7d6f5c') : sp.k === 'port' ? '#b7a57a' : '#a3ad73';
        x.fill(); x.strokeStyle = 'rgba(60,40,20,.7)'; x.lineWidth = 1.2; x.stroke();
        x.font = '14px sans-serif'; x.textAlign = 'center'; x.fillText(d.ic, p.x, p.y + 5);
        label(x, d.name + (sp.outpost ? ' ⚑' : '') + (sp.burned ? ' (burned)' : ''), p.x, p.y + 24 * big);
      } else {
        x.setLineDash([3, 3]); x.strokeStyle = 'rgba(60,40,20,.55)'; x.lineWidth = 1.1; x.stroke(); x.setLineDash([]);
        x.fillStyle = 'rgba(60,40,20,.7)'; x.font = 'italic 700 14px Georgia, serif'; x.textAlign = 'center';
        x.fillText('?', p.x, p.y + 5);
      }
      if (sel === i) {
        x.strokeStyle = 'rgba(180,40,20,.85)'; x.lineWidth = 2;
        x.beginPath(); x.arc(p.x, p.y, 22 * big, 0, 6.3); x.stroke();
      }
    });
    // the ship, if one is out
    if (sea.voyage) {
      var tg = at(sea.spots[sea.voyage.to]), f = sea.voyage.t / sea.voyage.len;
      var out = f < 0.5 ? f * 2 : (1 - f) * 2;
      var sx = W0 / 2 + (tg.x - W0 / 2) * out, sy = H0 / 2 + (tg.y - H0 / 2) * out;
      x.font = '16px sans-serif'; x.textAlign = 'center'; x.fillText('⛵', sx, sy + Math.sin(time * 3) * 1.5);
    }
    // compass rose and cartouche
    rose(x, W0 - 34, H0 - 34, 22);
    x.fillStyle = 'rgba(60,40,20,.8)'; x.font = 'italic 12px Georgia, serif'; x.textAlign = 'left';
    x.fillText('The Ashveil Waters', 10, 18);
    x.textAlign = 'left';
    function at(sp) { return { x: sp.x * W0, y: sp.y * H0 }; }
  }
  function label(x, t, px, py, caps) {
    x.font = (caps ? '700 10px' : 'italic 11px') + ' Georgia, serif'; x.textAlign = 'center';
    x.fillStyle = 'rgba(233,220,184,.8)';
    var w = x.measureText(t).width;
    x.fillRect(px - w / 2 - 3, py - 10, w + 6, 13);
    x.fillStyle = 'rgba(50,32,16,.9)'; x.fillText(t, px, py);
  }
  function rose(x, cx, cy, r) {
    x.save(); x.translate(cx, cy);
    for (var i = 0; i < 8; i++) {
      x.rotate(Math.PI / 4);
      x.fillStyle = i % 2 ? 'rgba(60,40,20,.45)' : 'rgba(150,40,20,.6)';
      var l = i % 2 ? r * 0.6 : r;
      x.beginPath(); x.moveTo(0, -l); x.lineTo(3, 0); x.lineTo(-3, 0); x.fill();
    }
    x.fillStyle = 'rgba(60,40,20,.8)'; x.font = '700 9px Georgia, serif'; x.textAlign = 'center';
    x.restore(); x.fillStyle = 'rgba(60,40,20,.8)'; x.font = '700 9px Georgia, serif'; x.textAlign = 'center';
    x.fillText('N', cx, cy - r - 3);
  }
  function spotAt(cv, px, py) {
    var sea = G().sea, best = -1, bd = 30 * 30;
    sea.spots.forEach(function (sp, i) {
      var d = Math.pow(sp.x * cv.clientWidth - px, 2) + Math.pow(sp.y * cv.clientHeight - py, 2);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  /* ---------------- tick ---------------- */
  var last = -1;
  function tick(dt) {
    if (!G()) return;
    ensure();
    tickScouts(dt);
    tickSea(dt);
    var si = SIM.seasonIndex();
    if (last >= 0 && si !== last) seasonSea();
    last = si;
  }
  function reset() { fog = null; fogCv = null; fogDirty = true; last = -1; }

  // a new building pushes back the mist around it; a watchtower much further
  SIM.on(function (kind, b) {
    if (kind !== 'build' || !b || !b.def || !fog) return;
    reveal(b.x + (b.def.w || 1) / 2, b.y + (b.def.h || 1) / 2, b.id === 'tower' ? 8.5 : b.id === 'castle' ? 7 : 3.2);
  });

  return {
    tick: tick, reset: reset, seen: seen, reveal: reveal, known: known, fogCanvas: fogCanvas,
    sendScout: sendScout, SCOUT_COST: SCOUT_COST, siteAt: siteAt, blocked: blocked, search: search, SITES: SITES,
    bonusAt: bonusAt, springNear: springNear,
    SPOTS: SPOTS, chart: chart, foundOutpost: foundOutpost, openRoute: openRoute, hitHaven: hitHaven,
    tradeBonus: tradeBonus, wolvesQuiet: wolvesQuiet, harbour: harbour, drawChart: drawChart, spotAt: spotAt,
    OUTPOST_COST: OUTPOST_COST, OUTPOST_PEOPLE: OUTPOST_PEOPLE, CHART_COST: CHART_COST, ROUTE_COST: ROUTE_COST,
    get scouts() { return (G() && G().scouts) || []; },
    get sites() { return (G() && G().sites) || []; }
  };
})();
