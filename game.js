/* Lunchquest — a self-playing roguelike.
   5 floors per run: four random floor bosses, then the Lich.
   Procedural worldgen, procedural textures, autopilot hero. No dependencies. */
(function () {
'use strict';

/* ---------------- utils ---------------- */
function mulberry32(a) {
  return function () {
    a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
function makeNoise(rnd) {
  var N = 256, g = new Float32Array(N * N), i;
  for (i = 0; i < g.length; i++) g[i] = rnd();
  function at(x, y) { return g[(y & 255) * N + (x & 255)]; }
  function smoothAt(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
    var sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    var a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }
  return function (x, y, oct, f) {
    var v = 0, amp = 1, tot = 0;
    for (var o = 0; o < oct; o++) { v += smoothAt(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return v / tot;
  };
}

/* ---------------- constants ---------------- */
var TILE = 24, W = 100, H = 100;
var CW = 960, CH = 540, VPW = 716, VPH = 540;
var DEEP = 0, WATER = 1, SAND = 2, GRASS = 3, TALL = 4, TREE = 5, ROCK = 6, PATH = 7, FLOWER = 8;
var WALK = [0, 0, 1, 1, 1, 0, 0, 1, 1];
var MINI = ['#12283f', '#1d5b91', '#d8c48c', '#3f8a3f', '#4fa04a', '#245227', '#7d7f86', '#b09a6d', '#5aa84e'];
var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
var VARIANTS = 4, TURN_MS = 145, FLOORS = 5;

/* each floor gets its own mood: a tint over the shared tilesheet */
var FLOORDEF = [
  { name: 'Verdant Shore', dark: 0.42, recipe: null },
  { name: 'Amber Reach', dark: 0.46, recipe: [
    { op: 'hue', col: 'hsl(32,80%,50%)' }, { op: 'multiply', col: 'rgba(240,185,110,0.45)' }] },
  { name: 'Ashen Waste', dark: 0.56, recipe: [
    { op: 'saturation', col: 'hsl(0,10%,50%)' }, { op: 'multiply', col: 'rgba(175,150,145,0.60)' }] },
  { name: 'Frostmarch', dark: 0.48, recipe: [
    { op: 'hue', col: 'hsl(200,75%,50%)' }, { op: 'saturation', col: 'hsl(0,45%,50%)' },
    { op: 'screen', col: 'rgba(190,225,255,0.22)' }] },
  { name: 'The Black Vault', dark: 0.70, recipe: [
    { op: 'hue', col: 'hsl(266,60%,50%)' }, { op: 'saturation', col: 'hsl(0,26%,50%)' },
    { op: 'multiply', col: 'rgba(96,84,138,0.74)' }] }
];

/* ---------------- gear ---------------- */
var MATS = [
  { n: 'iron',       col: '#9aa2ad', edge: '#d6dae0' },
  { n: 'steel',      col: '#7fa8c9', edge: '#dff0ff' },
  { n: 'electrum',   col: '#e0c469', edge: '#fff4c2' },
  { n: 'orichalcum', col: '#4fd6b8', edge: '#d3fff5' }
];
var SLOTS = {
  sword:  { atk: [4, 8, 13, 20],  label: 'blade'  },
  shield: { def: [1, 3, 5, 8],    label: 'shield' },
  armor:  { hp:  [10, 22, 38, 60], label: 'armor' }
};
var SLOTKEYS = ['sword', 'shield', 'armor'];

/* ---------------- bosses ---------------- */
var BOSSES = [
  { n: 'Vermathrax the Ember', s: 'Vermathrax',  shape: 'dragon',   hp: 150, atk: 12, def: 3, ev: 2, aggro: 7,  ab: 'ranged', col: '#c0392b', col2: '#6f1d15', size: 2.1 },
  { n: 'The Broodmother', s: 'the Broodmother',       shape: 'arachnid', hp: 130, atk: 10, def: 2, ev: 1, aggro: 6, ab: 'summon', col: '#5b4a80', col2: '#241d3a', size: 1.9 },
  { n: 'Grond, Bull of the Deep', s: 'Grond', shape: 'brute',  hp: 170, atk: 13, def: 4, ev: 2, aggro: 8,  ab: 'charge', col: '#96603d', col2: '#4a2e1e', size: 2.0 },
  { n: 'Sablecoil the Basilisk', s: 'Sablecoil', shape: 'serpent', hp: 140, atk: 11, def: 3, ev: 2, aggro: 7,  ab: 'ranged', col: '#b6e04a', col2: '#26301a', size: 2.1 },
  { n: 'The Kraken of Still Water', s: 'the Kraken', shape: 'tentacle', hp: 160, atk: 11, def: 3, ev: 2, aggro: 7, ab: 'summon', col: '#4a7fa8', col2: '#1f3d55', size: 2.1 },
  { n: 'Aurex, Stone Warden', s: 'Aurex',   shape: 'construct', hp: 200, atk: 11, def: 7, ev: 3, aggro: 7,  ab: 'armor',  col: '#8d9098', col2: '#4e5158', size: 2.0 },
  { n: 'Skarn the Wyvern', s: 'Skarn',      shape: 'dragon',   hp: 135, atk: 13, def: 2, ev: 1, aggro: 6, ab: 'charge', col: '#8e5bb5', col2: '#432a5c', size: 1.9 },
  { n: 'The Chimera', s: 'the Chimera',           shape: 'beast',    hp: 155, atk: 12, def: 3, ev: 2, aggro: 7,  ab: 'ranged', col: '#c98a4b', col2: '#6b4522', size: 2.0 },
  { n: 'Malzeth the Necromancer', s: 'Malzeth', shape: 'robed',  hp: 130, atk: 11, def: 2, ev: 2, aggro: 8, ab: 'summon', col: '#6d4fa8', col2: '#2e1f4d', size: 2.1 },
  { n: 'The Hollow Wraith', s: 'the Wraith',     shape: 'spectre',  hp: 125, atk: 13, def: 2, ev: 1, aggro: 6, ab: 'drain',  col: '#9fd8e6', col2: '#2a4a55', size: 2.0 }
];
var LICH = { n: 'Xanthemar, the Undying', s: 'Xanthemar', shape: 'lich', hp: 430, atk: 26, def: 7, ev: 2, aggro: 9, ab: 'lich', col: '#cfe6ff', col2: '#3b2a5e', size: 2.4 };

var MTYPES = [
  { k: 'slime',    hp: 12, atk: 3, def: 0, ev: 2, aggro: 7,  gold: 3,  xp: 5,  col: '#6ad36f', dark: '#2f7a37' },
  { k: 'bat',      hp: 9,  atk: 4, def: 0, ev: 1, aggro: 8, gold: 5,  xp: 7,  col: '#a479d6', dark: '#5c3b85' },
  { k: 'skeleton', hp: 20, atk: 6, def: 1, ev: 2, aggro: 7,  gold: 9,  xp: 12, col: '#e8e4d5', dark: '#8b8776' },
  { k: 'ogre',     hp: 34, atk: 9, def: 2, ev: 3, aggro: 7,  gold: 18, xp: 22, col: '#9a7350', dark: '#5c452e' }
];

/* ---------------- textures ---------------- */
var baseSheet = null, sheets = [];
function rect(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function buildBaseSheet() {
  var cv = newCanvas(TILE * VARIANTS, TILE * 9), g = cv.getContext('2d'), rnd = mulberry32(0xC0FFEE);
  var base = ['#12283f', '#1d5b91', '#d6c189', '#3d8a3f', '#48993f', '#245227', '#797b82', '#ab9468', '#3d8a3f'];
  for (var t = 0; t < 9; t++) for (var v = 0; v < VARIANTS; v++) {
    var ox = v * TILE, oy = t * TILE, i, x, y;
    rect(g, ox, oy, TILE, TILE, base[t]);
    for (i = 0; i < 46; i++) {
      x = ox + (rnd() * TILE | 0); y = oy + (rnd() * TILE | 0);
      g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '0,0,0,' : '255,255,255,') + (0.03 + rnd() * 0.06).toFixed(3) + ')';
      g.fillRect(x, y, 2, 2);
    }
    if (t === DEEP || t === WATER) {
      for (i = 0; i < 3; i++) rect(g, ox + (rnd() * (TILE - 10) | 0), oy + 3 + (rnd() * (TILE - 6) | 0), 6 + (rnd() * 4 | 0), 1, t === DEEP ? 'rgba(150,200,255,.16)' : 'rgba(200,235,255,.30)');
    } else if (t === SAND) {
      for (i = 0; i < 10; i++) rect(g, ox + (rnd() * TILE | 0), oy + (rnd() * TILE | 0), 1, 1, 'rgba(120,90,50,.35)');
    } else if (t === GRASS || t === TALL) {
      var n = t === TALL ? 12 : 6, hh = t === TALL ? 5 : 3;
      for (i = 0; i < n; i++) rect(g, ox + 1 + (rnd() * (TILE - 2) | 0), oy + 2 + (rnd() * (TILE - hh - 2) | 0), 1, hh, rnd() < 0.5 ? 'rgba(0,50,0,.35)' : 'rgba(160,235,120,.30)');
    } else if (t === FLOWER) {
      for (i = 0; i < 6; i++) rect(g, ox + 1 + (rnd() * (TILE - 2) | 0), oy + 2 + (rnd() * (TILE - 5) | 0), 1, 3, 'rgba(0,50,0,.30)');
      for (i = 0; i < 4; i++) {
        x = ox + 3 + (rnd() * (TILE - 6) | 0); y = oy + 3 + (rnd() * (TILE - 6) | 0);
        var fc = pick(rnd, ['#ffe066', '#ff8fa3', '#c6a3ff', '#fff1c1']);
        rect(g, x, y, 2, 2, fc); rect(g, x - 1, y + 1, 1, 1, fc); rect(g, x + 2, y + 1, 1, 1, fc);
      }
    } else if (t === TREE) {
      for (i = 0; i < 5; i++) rect(g, ox + (rnd() * TILE | 0), oy + (rnd() * TILE | 0), 2, 2, 'rgba(0,0,0,.18)');
      rect(g, ox + 10, oy + 14, 4, 9, '#5b3a1e');
      for (i = 0; i < 9; i++) {
        g.fillStyle = i % 3 === 0 ? '#3f7f38' : (i % 3 === 1 ? '#2f6a2c' : '#4d9440');
        g.beginPath(); g.arc(ox + 12 + (rnd() * 14 - 7 | 0), oy + 11 + (rnd() * 12 - 7 | 0), 4 + rnd() * 3, 0, 6.2832); g.fill();
      }
    } else if (t === ROCK) {
      for (i = 0; i < 5; i++) {
        x = ox + (rnd() * (TILE - 8) | 0); y = oy + (rnd() * (TILE - 8) | 0);
        var w2 = 5 + (rnd() * 7 | 0), h2 = 4 + (rnd() * 7 | 0);
        rect(g, x, y, w2, h2, rnd() < 0.5 ? '#8d9098' : '#63666d');
        rect(g, x, y, w2, 1, 'rgba(255,255,255,.22)'); rect(g, x, y + h2 - 1, w2, 1, 'rgba(0,0,0,.28)');
      }
    } else if (t === PATH) {
      for (i = 0; i < 8; i++) rect(g, ox + (rnd() * (TILE - 3) | 0), oy + (rnd() * (TILE - 3) | 0), 2 + (rnd() * 2 | 0), 2, rnd() < 0.5 ? 'rgba(255,255,255,.14)' : 'rgba(70,50,25,.30)');
    }
  }
  baseSheet = cv;
}
function applyRecipe(cv, recipe) {
  if (!recipe) return cv;
  var g = cv.getContext('2d');
  for (var r = 0; r < recipe.length; r++) { g.globalCompositeOperation = recipe[r].op; rect(g, 0, 0, cv.width, cv.height, recipe[r].col); }
  g.globalCompositeOperation = 'source-over';
  return cv;
}
function sheetFor(floor) {
  var i = clamp(floor - 1, 0, FLOORDEF.length - 1);
  if (sheets[i]) return sheets[i];
  var def = FLOORDEF[i];
  if (!def.recipe) { sheets[i] = baseSheet; return baseSheet; }
  var cv = newCanvas(baseSheet.width, baseSheet.height), g = cv.getContext('2d');
  g.drawImage(baseSheet, 0, 0);
  applyRecipe(cv, def.recipe);
  sheets[i] = cv;
  return cv;
}

/* ---------------- world ---------------- */
var world = null;
function genWorld(seed) {
  var rnd = mulberry32(seed);
  var n1 = makeNoise(mulberry32(seed ^ 0x9E3779B9)), n2 = makeNoise(mulberry32(seed ^ 0x85EBCA6B));
  var tiles = new Uint8Array(W * H), variant = new Uint8Array(W * H), x, y, i;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var e = n1(x, y, 5, 0.055), m = n2(x, y, 4, 0.085);
    var dx = (x / (W - 1) - 0.5) * 2, dy = (y / (H - 1) - 0.5) * 2;
    e = e * 1.08 - Math.max(0, Math.sqrt(dx * dx + dy * dy) - 0.50) * 1.6;
    var t;
    if (e < 0.30) t = DEEP;
    else if (e < 0.355) t = WATER;
    else if (e < 0.395) t = SAND;
    else if (e > 0.72) t = ROCK;
    else if (m > 0.615) t = TREE;
    else if (m > 0.545) t = TALL;
    else if (m < 0.40) t = rnd() < 0.14 ? FLOWER : GRASS;
    else t = GRASS;
    tiles[y * W + x] = t; variant[y * W + x] = rnd() * VARIANTS | 0;
  }
  var comp = new Int32Array(W * H).fill(-1), best = -1, bestN = 0, comps = [], q = new Int32Array(W * H);
  for (i = 0; i < W * H; i++) {
    if (comp[i] !== -1 || !WALK[tiles[i]]) continue;
    var id = comps.length, list = [], qh = 0, qt = 0;
    comp[i] = id; q[qt++] = i;
    while (qh < qt) {
      var cur = q[qh++]; list.push(cur);
      var cx = cur % W, cy = (cur - cx) / W;
      for (var k = 0; k < 4; k++) {
        var nx = cx + DX[k], ny = cy + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var ni = ny * W + nx;
        if (comp[ni] !== -1 || !WALK[tiles[ni]]) continue;
        comp[ni] = id; q[qt++] = ni;
      }
    }
    comps.push(list);
    if (list.length > bestN) { bestN = list.length; best = id; }
  }
  if (best < 0 || bestN < 500) return null;
  var land = comps[best];
  for (var p = 0; p < 4; p++) {
    var a = land[rnd() * land.length | 0], b = land[rnd() * land.length | 0];
    var ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W, guard = 0;
    while ((ax !== bx || ay !== by) && guard++ < 900) {
      if (WALK[tiles[ay * W + ax]] && tiles[ay * W + ax] !== SAND) tiles[ay * W + ax] = PATH;
      if (rnd() < 0.75) { if (Math.abs(bx - ax) > Math.abs(by - ay)) ax += bx > ax ? 1 : -1; else ay += by > ay ? 1 : -1; }
      else if (rnd() < 0.5) ax += rnd() < 0.5 ? 1 : -1; else ay += rnd() < 0.5 ? 1 : -1;
      ax = clamp(ax, 1, W - 2); ay = clamp(ay, 1, H - 2);
    }
  }
  var mm = newCanvas(W, H), mg = mm.getContext('2d');
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) { mg.fillStyle = MINI[tiles[y * W + x]]; mg.fillRect(x, y, 1, 1); }
  return { seed: seed, tiles: tiles, variant: variant, land: land, mini: mm, rnd: rnd };
}
function tileAt(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? ROCK : world.tiles[y * W + x]; }
function walkable(x, y) { return !!WALK[tileAt(x, y)]; }

/* ---------------- state ---------------- */
var hero, mobs, items, floats, bolts, log, cam, run, stats, tick, shake, phase, sheet, parading = 0, nextId = 1;

function say(m) { log.push(m); if (log.length > 7) log.shift(); }
function fl(x, y, txt, col) { floats.push({ x: x, y: y, txt: txt, col: col, t: 0 }); }
function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function setPhase(name, dur) { phase = { name: name, t: 0, dur: dur }; }

function newHero() {
  var h = { x: 0, y: 0, px: 0, py: 0, lvl: 1, xp: 0, next: 22, gold: 0, kills: 0, bosses: 0,
            baseAtk: 5, baseDef: 1, baseMax: 44, potions: 2,
            gear: { sword: 0, shield: -1, armor: -1 },
            face: 2, swing: 0, hurt: 0, intent: 'descending', lock: null, lockT: 0,
            hist: [], lastProgress: 0, ban: {} };
  recalc(h); h.hp = h.max; return h;
}
function recalc(h) {
  h.atk = h.baseAtk + (h.gear.sword >= 0 ? SLOTS.sword.atk[h.gear.sword] : 0);
  h.def = h.baseDef + (h.gear.shield >= 0 ? SLOTS.shield.def[h.gear.shield] : 0);
  h.max = h.baseMax + (h.gear.armor >= 0 ? SLOTS.armor.hp[h.gear.armor] : 0);
  if (h.hp > h.max) h.hp = h.max;
}
function occupied(x, y) {
  if (hero && hero.x === x && hero.y === y) return true;
  for (var i = 0; i < mobs.length; i++) if (mobs[i].x === x && mobs[i].y === y) return true;
  return false;
}
function freeSpot(rnd, from, minD) {
  for (var t = 0; t < 500; t++) {
    var c = world.land[rnd() * world.land.length | 0], x = c % W, y = (c - x) / W;
    if (occupied(x, y)) continue;
    if (from && Math.abs(x - from.x) + Math.abs(y - from.y) < minD) continue;
    return { x: x, y: y };
  }
  var c2 = world.land[0];
  return { x: c2 % W, y: (c2 - c2 % W) / W };
}

/* ---------------- run / floor setup ---------------- */
function newRun() {
  var order = BOSSES.slice(), i, j, tmp;
  for (i = order.length - 1; i > 0; i--) { j = Math.random() * (i + 1) | 0; tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
  run = { n: (run ? run.n + 1 : 1), floor: 1, floorStart: tick, plan: order.slice(0, FLOORS - 1) };
  hero = newHero();
  say('run ' + run.n + ' begins');
  buildFloor(1);
}

function buildFloor(floor) {
  var w = null, attempt = 0;
  do { w = genWorld((Math.random() * 0x7FFFFFFF) | 0); } while (!w && ++attempt < 30);
  world = w || genWorld(12345);
  sheet = sheetFor(floor);
  applyRecipe(world.mini, FLOORDEF[clamp(floor - 1, 0, FLOORDEF.length - 1)].recipe);
  var rnd = world.rnd;
  mobs = []; items = []; floats = []; bolts = [];
  var spot = freeSpot(rnd, null, 0);
  hero.x = spot.x; hero.y = spot.y; hero.px = spot.x; hero.py = spot.y;
  hero.lock = null; hero.lockT = 0; hero.ban = {}; hero.hist = []; hero.lastProgress = tick;

  /* rank-and-file */
  var pool = [];
  for (var i = 0; i < MTYPES.length; i++) {
    var wgt = clamp(4 - Math.abs(i - clamp((floor - 1) * 0.95, 0, 3)) * 1.7, 0, 4) | 0;
    for (var j = 0; j < wgt + (i === 0 && floor < 3 ? 1 : 0); j++) pool.push(i);
  }
  if (!pool.length) pool.push(1);
  var nmob = 7 + floor * 3, mscale = 1 + 0.45 * (floor - 1);
  for (var m = 0; m < nmob; m++) {
    var T = MTYPES[pool[rnd() * pool.length | 0]], s = freeSpot(rnd, hero, floor === 1 ? 15 : 10);
    mobs.push({ id: nextId++, t: T, boss: 0, name: T.k, x: s.x, y: s.y, px: s.x, py: s.y,
      hp: Math.round(T.hp * mscale), max: Math.round(T.hp * mscale),
      atk: T.atk + (floor - 1) * 2, def: T.def + (floor > 2 ? 1 : 0) + (floor > 4 ? 1 : 0), ev: T.ev,
      face: 2, hurt: 0, swing: 0, wake: 0 });
  }

  /* the floor's boss */
  var B = floor >= FLOORS ? LICH : run.plan[floor - 1];
  var bs = freeSpot(rnd, hero, 42);
  var bScale = floor >= FLOORS ? 1 : (0.55 + 0.22 * floor);
  mobs.push({ id: nextId++, t: B, boss: 1, name: B.n, sname: B.s, shape: B.shape, ab: B.ab, size: B.size,
    x: bs.x, y: bs.y, px: bs.x, py: bs.y,
    hp: Math.round(B.hp * bScale), max: Math.round(B.hp * bScale),
    atk: Math.round(B.atk * (floor >= FLOORS ? 1 : 0.62 + 0.15 * floor)), def: B.def, ev: B.ev,
    col: B.col, col2: B.col2, face: 2, hurt: 0, swing: 0, wake: 0, cd: 0 });

  /* loot: chests, potions, and gear of a tier that tracks the floor */
  for (var c = 0; c < 4 + (floor % 3); c++) { var cs = freeSpot(rnd, hero, 5); items.push({ id: nextId++, kind: 'chest', x: cs.x, y: cs.y, bob: rnd() * 6 }); }
  for (var p = 0; p < 3 + (floor > 2 ? 1 : 0); p++) { var ps = freeSpot(rnd, hero, 4); items.push({ id: nextId++, kind: 'potion', x: ps.x, y: ps.y, bob: rnd() * 6 }); }
  for (var gi = 0; gi < 3; gi++) {
    var slot = SLOTKEYS[gi % 3];
    var tier = clamp((floor - 1) + (rnd() < 0.35 ? 1 : 0) - (rnd() < 0.2 ? 1 : 0), 0, MATS.length - 1);
    var gs = freeSpot(rnd, hero, 6);
    items.push({ id: nextId++, kind: 'gear', slot: slot, tier: tier, x: gs.x, y: gs.y, bob: rnd() * 6 });
  }
  run.floorStart = tick;
  say('floor ' + floor + ' — ' + FLOORDEF[clamp(floor - 1, 0, 4)].name);
  cam = { x: hero.x * TILE - VPW / 2, y: hero.y * TILE - VPH / 2 };
}

function theBoss() { for (var i = 0; i < mobs.length; i++) if (mobs[i].boss) return mobs[i]; return null; }

/* ---------------- pathfinding ---------------- */
var visit = new Int32Array(W * H), prevB = new Int32Array(W * H), bq = new Int32Array(W * H), st4 = 0;
function stepToward(sx, sy, tx, ty, budget, avoid) {
  if (sx === tx && sy === ty) return null;
  st4++;
  var start = sy * W + sx, goal = ty * W + tx, qh = 0, qt = 0, n = 0, found = false;
  visit[start] = st4; prevB[start] = start; bq[qt++] = start;
  while (qh < qt && n++ < budget) {
    var cur = bq[qh++];
    if (cur === goal) { found = true; break; }
    var cx = cur % W, cy = (cur - cx) / W;
    for (var d = 0; d < 4; d++) {
      var nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      var ni = ny * W + nx;
      if (visit[ni] === st4) continue;
      if (ni !== goal && (!walkable(nx, ny) || occupied(nx, ny))) continue;
      if (avoid && ni !== goal && Math.abs(nx - avoid.x) + Math.abs(ny - avoid.y) <= avoid.r) continue;
      visit[ni] = st4; prevB[ni] = cur; bq[qt++] = ni;
    }
  }
  if (!found) return null;
  var c = goal, guard = 0;
  while (prevB[c] !== start && guard++ < W * H) c = prevB[c];
  var fx = c % W, fy = (c - fx) / W;
  return { x: fx - sx, y: fy - sy };
}

/* ---------------- combat ---------------- */
function progress() { hero.lastProgress = tick; }

function heroAttack(mob) {
  hero.face = mob.x > hero.x ? 1 : mob.x < hero.x ? 3 : mob.y > hero.y ? 2 : 0;
  hero.swing = 1; progress();
  var dmg = Math.max(1, hero.atk + (Math.random() * 4 | 0) - mob.def);
  mob.hp -= dmg; mob.hurt = 1; mob.wake = 1;
  fl(mob.x, mob.y, '-' + dmg, mob.boss ? '#ffb4b4' : '#ffd166');
  if (mob.hp > 0) return;
  mobs.splice(mobs.indexOf(mob), 1);
  var gold = mob.boss ? 150 + run.floor * 60 : mob.t.gold;
  var xp = mob.boss ? 90 + run.floor * 40 : mob.t.xp;
  hero.gold += gold; hero.kills++; hero.xp += xp; stats.kills++;
  if (mob.boss) {
    hero.bosses++; stats.bosses++; shake = 9;
    say('★ ' + mob.name + ' falls');
    fl(mob.x, mob.y, 'SLAIN', '#ffe9a8');
  } else say('slew a ' + mob.name + ' (+' + gold + 'g)');
  while (hero.xp >= hero.next) {
    hero.xp -= hero.next; hero.lvl++; hero.next = Math.round(hero.next * 1.5);
    hero.baseMax += 6; hero.baseAtk += 2; if (hero.lvl % 3 === 0) hero.baseDef++;
    recalc(hero); hero.hp = Math.min(hero.max, hero.hp + 14);
    say('LEVEL UP → ' + hero.lvl); fl(hero.x, hero.y, 'LVL ' + hero.lvl, '#8ef2a0');
  }
  if (mob.boss) floorCleared();
}

function hurtHero(dmg, src) {
  if (src) hero.lastHitBy = src.boss ? 'BOSS ' + src.name : src.name;
  hero.hp -= dmg; hero.hurt = 1; shake = Math.max(shake, src && src.boss ? 5 : 3); progress();
  fl(hero.x, hero.y, '-' + dmg, '#ff6b6b');
  if (hero.hp <= 0) { hero.hp = 0; heroDied(); }
}
function mobAttack(mob) {
  mob.swing = 1;
  mob.face = hero.x > mob.x ? 1 : hero.x < mob.x ? 3 : hero.y > mob.y ? 2 : 0;
  var dmg = Math.max(1, mob.atk + (Math.random() * 3 | 0) - hero.def);
  if (mob.ab === 'drain' || mob.ab === 'lich') { mob.hp = Math.min(mob.max, mob.hp + Math.round(dmg * 0.6)); fl(mob.x, mob.y, '+' + Math.round(dmg * 0.6), '#9fd8e6'); }
  hurtHero(dmg, mob);
}
function tryMove(e, dx, dy) {
  var nx = e.x + dx, ny = e.y + dy;
  if (!walkable(nx, ny) || occupied(nx, ny)) return false;
  e.x = nx; e.y = ny;
  e.face = dy < 0 ? 0 : dy > 0 ? 2 : dx > 0 ? 1 : 3;
  return true;
}

/* ---------------- hero brain ---------------- */
/* Targets are committed to for a while, and a target that leads to visible
   dithering gets banned — that kills the hunt/loot flip-flop. */
function banned(id) { return hero.ban[id] && hero.ban[id] > tick; }
function targetValid(lk) {
  if (!lk) return false;
  if (lk.kind === 'mob') return mobs.indexOf(lk.o) >= 0;
  if (lk.kind === 'item') return items.indexOf(lk.o) >= 0;
  return !(hero.x === lk.o.x && hero.y === lk.o.y);           /* explore point */
}
function nearestOf(list, ok) {
  var best = null, bd = 1e9;
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (banned(o.id) || (ok && !ok(o))) continue;
    var d = dist(hero, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { o: best, d: bd } : null;
}
function gearScore(slot, tier) {
  var cur = hero.gear[slot];
  return tier > cur ? tier - cur : -1;
}
function readyForBoss(boss) {
  if (!boss || hero.hp < hero.max * 0.7) return false;
  var mine = Math.max(1, hero.atk + 1.5 - boss.def);
  var theirs = Math.max(1, boss.atk + 1 - hero.def) * (boss.ab === 'ranged' || boss.ab === 'lich' ? 1.25 : 1);
  var turnsToKill = boss.hp / mine;
  var turnsToLive = (hero.hp + hero.potions * hero.max * 0.5) / theirs;
  var slog = tick - run.floorStart > 700 ? 1.0 : 1.25;        /* patience runs out */
  return turnsToLive > turnsToKill * slog;
}
function threatNear(range) {
  for (var i = 0; i < mobs.length; i++) if (dist(hero, mobs[i]) <= range) return mobs[i];
  return null;
}
/* pick the reachable spot that puts the most ground between us and the threat */
function safeSpot(minD) {
  var b = theBoss(), ready = b && readyForBoss(b);
  for (var i = 0; i < 24; i++) {
    var c = freeSpot(Math.random, hero, minD);
    if (!b || ready || Math.abs(c.x - b.x) + Math.abs(c.y - b.y) > 14) return c;
  }
  return freeSpot(Math.random, hero, minD);
}
function fleeSpot(from) {
  var best = null, bd = -1;
  for (var i = 0; i < 6; i++) {
    var c = safeSpot(12), d = Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}

function chooseTarget() {
  /* interrupts, in order */
  for (var i = 0; i < mobs.length; i++) if (dist(hero, mobs[i]) <= 1) return { kind: 'mob', o: mobs[i], why: 'fighting ' + (mobs[i].sname || mobs[i].name) };
  if (hero.hp < hero.max * 0.45 && hero.potions > 0) return { kind: 'quaff' };
  var bss = theBoss();
  if (bss && bss.wake && dist(hero, bss) <= 7 && !readyForBoss(bss)) {
    if (!hero.lock || hero.lock.why !== 'fleeing ' + (bss.sname || bss.name) || !targetValid(hero.lock)) {
      hero.lock = { kind: 'spot', o: fleeSpot(bss), why: 'fleeing ' + (bss.sname || bss.name) }; hero.lockT = 22;
    }
    return hero.lock;
  }
  if (hero.hp < hero.max * 0.32 && hero.potions === 0) {
    var thr = threatNear(4);
    if (thr) {
      if (!hero.lock || hero.lock.why !== 'retreating' || !targetValid(hero.lock)) {
        hero.lock = { kind: 'spot', o: fleeSpot(thr), why: 'retreating' }; hero.lockT = 16;
      }
      return hero.lock;
    }
  }

  if (hero.lockT > 0 && targetValid(hero.lock)) { hero.lockT--; return hero.lock; }

  var lk = null;
  var boss = theBoss();
  var keepAway = boss && !readyForBoss(boss) ? boss : null;
  var far = function (o) { return !keepAway || dist(keepAway, o) > 8; };
  var potion = nearestOf(items, function (o) { return o.kind === 'potion' && far(o); });
  var gear = nearestOf(items, function (o) { return o.kind === 'gear' && gearScore(o.slot, o.tier) > 0 && far(o); });
  var mob = nearestOf(mobs, function (o) { return !o.boss && far(o); });
  var chest = nearestOf(items, function (o) { return o.kind === 'chest' && far(o); });

  if (hero.hp < hero.max * 0.5 && potion && potion.d < 30) lk = { kind: 'item', o: potion.o, why: 'wounded — potion' };
  else if (gear && gear.d < 26) lk = { kind: 'item', o: gear.o, why: 'claiming ' + MATS[gear.o.tier].n + ' ' + SLOTS[gear.o.slot].label };
  else if (boss && !banned(boss.id) && readyForBoss(boss)) lk = { kind: 'mob', o: boss, why: 'closing on ' + (boss.sname || boss.n) };
  else if (mob && mob.d <= 18) lk = { kind: 'mob', o: mob.o, why: 'hunting a ' + mob.o.name };
  else if (chest) lk = { kind: 'item', o: chest.o, why: 'looting a chest' };
  else if (potion) lk = { kind: 'item', o: potion.o, why: 'fetching a potion' };
  else if (mob) lk = { kind: 'mob', o: mob.o, why: 'tracking a ' + mob.o.name };
  else if (boss && !banned(boss.id)) lk = { kind: 'mob', o: boss, why: 'seeking ' + (boss.sname || boss.n) };
  else { lk = { kind: 'spot', o: safeSpot(14), why: 'exploring' }; }

  hero.lock = lk;
  hero.lockT = lk.kind === 'spot' ? 60 : 45;                  /* commit */
  return lk;
}

function oscillating() {
  var h = hero.hist;
  if (h.length < 16 || tick - hero.lastProgress < 16) return false;
  var seen = {}, n = 0;
  for (var i = h.length - 16; i < h.length; i++) if (!seen[h[i]]) { seen[h[i]] = 1; n++; }
  return n <= 3;                                             /* ping-ponging over ≤3 tiles */
}

function heroTurn() {
  hero.hist.push(hero.x * 1000 + hero.y);
  if (hero.hist.length > 24) hero.hist.shift();

  if (oscillating()) {
    if (hero.lock && hero.lock.o && hero.lock.o.id) hero.ban[hero.lock.o.id] = tick + 90;
    hero.lock = null; hero.lockT = 0; hero.hist = []; hero.lastProgress = tick;
    stats.unstuck++;
    var away = safeSpot(22);
    hero.lock = { kind: 'spot', o: away, why: 'shaking off indecision' }; hero.lockT = 50;
    say('…thinks better of it');
  }

  if (hero.hp < hero.max && tick % 6 === 0 && !threatNear(8)) hero.hp++;   /* breather */

  var tg = chooseTarget();
  hero.intent = tg.why || hero.intent;

  if (tg.kind === 'quaff') {
    hero.potions--; var heal = Math.min(hero.max - hero.hp, Math.round(hero.max * 0.5));
    hero.hp += heal; fl(hero.x, hero.y, '+' + heal, '#8ef2a0'); say('quaffs a potion (+' + heal + ')');
    hero.intent = 'drinking a potion'; progress(); return;
  }
  if (tg.kind === 'mob') {
    if (dist(hero, tg.o) <= 1) { heroAttack(tg.o); return; }
  }
  var bs2 = theBoss(), avoid = null;
  if (bs2 && !readyForBoss(bs2) && !(tg.kind === 'mob' && tg.o === bs2)) avoid = { x: bs2.x, y: bs2.y, r: 9 };
  var st = stepToward(hero.x, hero.y, tg.o.x, tg.o.y, 12000, avoid);
  if (!st && avoid && tg.kind !== 'spot') { if (tg.o.id) hero.ban[tg.o.id] = tick + 50; hero.lock = null; hero.lockT = 0; return; }
  if (!st) {
    if (tg.o.id) hero.ban[tg.o.id] = tick + 60;
    hero.lock = null; hero.lockT = 0; return;
  }
  if (tg.kind === 'mob' && tg.o.x === hero.x + st.x && tg.o.y === hero.y + st.y) { heroAttack(tg.o); return; }
  if (!tryMove(hero, st.x, st.y)) { hero.lockT = Math.min(hero.lockT, 3); return; }

  for (var i = items.length - 1; i >= 0; i--) {
    var it = items[i];
    if (it.x !== hero.x || it.y !== hero.y) continue;
    if (it.kind === 'potion') {
      if (hero.potions >= 3) continue;
      items.splice(i, 1); hero.potions++; fl(hero.x, hero.y, 'potion', '#8ef2a0'); say('pockets a potion'); progress();
    } else if (it.kind === 'chest') {
      items.splice(i, 1);
      var g = 15 + (Math.random() * 22 | 0) + run.floor * 8;
      hero.gold += g; fl(hero.x, hero.y, '+' + g + 'g', '#ffe9a8'); say('opens a chest (+' + g + 'g)'); progress();
    } else if (it.kind === 'gear') {
      if (gearScore(it.slot, it.tier) <= 0) continue;
      items.splice(i, 1);
      hero.gear[it.slot] = it.tier; recalc(hero);
      var nm = MATS[it.tier].n + ' ' + SLOTS[it.slot].label;
      fl(hero.x, hero.y, nm, MATS[it.tier].edge); say('equips ' + nm); progress();
    }
  }
}

/* ---------------- monsters ---------------- */
function spawnMinion(near) {
  if (mobs.length > 22) return;
  for (var t = 0; t < 12; t++) {
    var x = near.x + (Math.random() * 7 | 0) - 3, y = near.y + (Math.random() * 7 | 0) - 3;
    if (!walkable(x, y) || occupied(x, y)) continue;
    var T = MTYPES[clamp(1 + (Math.random() * 2 | 0), 0, 3)], sc = 1 + 0.3 * (run.floor - 1);
    mobs.push({ id: nextId++, t: T, boss: 0, name: T.k, x: x, y: y, px: x, py: y,
      hp: Math.round(T.hp * sc), max: Math.round(T.hp * sc), atk: T.atk + run.floor, def: T.def, ev: T.ev,
      face: 2, hurt: 0, swing: 0, wake: 1 });
    fl(x, y, 'risen', '#c6a3ff');
    return;
  }
}
function spawnWanderer() {
  var rnd = Math.random, spot = freeSpot(rnd, hero, 18), floor = run.floor;
  var pool = [0, 1, 1, 2, 2, 3], T = MTYPES[pool[clamp((rnd() * 6 | 0) + (floor > 2 ? 1 : 0), 0, 5)]];
  var sc = 1 + 0.45 * (floor - 1);
  mobs.push({ id: nextId++, t: T, boss: 0, name: T.k, x: spot.x, y: spot.y, px: spot.x, py: spot.y,
    hp: Math.round(T.hp * sc), max: Math.round(T.hp * sc),
    atk: T.atk + (floor - 1) * 2, def: T.def + (floor > 2 ? 1 : 0), ev: T.ev,
    face: 2, hurt: 0, swing: 0, wake: 0 });
}
function bolt(from, to, col) { bolts.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, t: 0, col: col }); }

function mobTurn(m) {
  var d = dist(m, hero);
  if (d <= (m.t.aggro || 8)) m.wake = 1;
  if (!m.wake) { if (!m.boss && Math.random() < 0.25) tryMove(m, DX[Math.random() * 4 | 0], DY[Math.random() * 4 | 0]); return; }

  if (m.boss) {
    m.cd = (m.cd || 0) + 1;
    if ((m.ab === 'ranged' || m.ab === 'lich') && d >= 2 && d <= 6 && m.cd % 3 === 0) {
      bolt(m, hero, m.ab === 'lich' ? '#a9f0ff' : '#ff9d4d');
      hurtHero(Math.max(2, Math.round(m.atk * 0.7) - Math.round(hero.def * 0.4)), m);
      return;
    }
    if ((m.ab === 'summon' || m.ab === 'lich') && m.cd % (m.ab === 'lich' ? 12 : 16) === 0) { spawnMinion(m); if (m.ab === 'summon') return; }
    if (m.ab === 'lich' && m.cd % 11 === 0 && m.hp < m.max) {
      m.hp = Math.min(m.max, m.hp + Math.round(m.max * 0.03)); fl(m.x, m.y, 'unlife', '#cfe6ff');
    }
    if (m.ab === 'charge' && d >= 2 && d <= 6 && m.cd % 4 === 0) {
      for (var s = 0; s < 3; s++) {
        var stc = stepToward(m.x, m.y, hero.x, hero.y, 700);
        if (!stc || !tryMove(m, stc.x, stc.y)) break;
      }
      if (dist(m, hero) <= 1) mobAttack(m);
      return;
    }
  }
  if (d <= 1) { mobAttack(m); return; }
  if (d > (m.t.aggro || 8) + (m.boss ? 13 : 7)) { m.wake = 0; return; }
  var st = stepToward(m.x, m.y, hero.x, hero.y, m.boss ? 3000 : 900);
  if (st) tryMove(m, st.x, st.y);
  else if (!tryMove(m, hero.x > m.x ? 1 : hero.x < m.x ? -1 : 0, 0)) tryMove(m, 0, hero.y > m.y ? 1 : -1);
}

/* ---------------- run flow ---------------- */
function floorCleared() {
  if (run.floor >= FLOORS) {
    stats.wins++;
    stats.best = Math.max(stats.best, FLOORS);
    setPhase('victory', 6200);
    say('THE LICH IS UNMADE');
  } else {
    stats.best = Math.max(stats.best, run.floor);
    setPhase('cleared', 3000);
  }
}
function heroDied() {
  stats.deaths++;
  var kk = (hero.lastHitBy || 'unknown') + ' @f' + run.floor + ' lvl' + hero.lvl;
  stats.killers[kk] = (stats.killers[kk] || 0) + 1;
  stats.best = Math.max(stats.best, run.floor);
  say('the hero dies on floor ' + run.floor);
  setPhase('died', 4600);
}

function doTurn() {
  tick++;
  if (parading) return;
  if (phase.name !== 'play') {
    phase.t += TURN_MS;
    if (phase.t < phase.dur) return;
    if (phase.name === 'cleared') {
      run.floor++;
      hero.hp = Math.min(hero.max, hero.hp + Math.round(hero.max * 0.45));
      hero.potions = Math.min(3, hero.potions + 1);
      buildFloor(run.floor); setPhase('play', 0);
    } else if (phase.name === 'died' || phase.name === 'victory') {
      setPhase('title', 3200);
    } else if (phase.name === 'title') {
      newRun(); setPhase('play', 0);
    }
    return;
  }
  heroTurn();
  if (phase.name !== 'play') return;
  for (var i = mobs.length - 1; i >= 0; i--) {
    var m = mobs[i];
    if (m.hp <= 0) continue;
    if (tick % m.ev === 0) mobTurn(m);
    if (phase.name !== 'play') return;
  }
  if (tick % 110 === 0) {
    var rank = 0;
    for (var w = 0; w < mobs.length; w++) if (!mobs[w].boss) rank++;
    if (rank < (run.floor === 1 ? 4 : 5)) { spawnWanderer(); if (Math.random() < 0.4) spawnWanderer(); }
  }
  if (tick - hero.lastProgress > 900) { say('the trail goes cold'); stats.unstuck++; buildFloor(run.floor); }
}

/* ---------------- rendering ---------------- */
var cv = document.getElementById('c'), ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

var hasLS = 'letterSpacing' in ctx;
function spaced(txt, cx, y, size, sp, col, font) {
  ctx.font = size + 'px ' + (font || '"Times New Roman", Georgia, serif');
  ctx.fillStyle = col;
  if (hasLS) {                                   /* real letter-spacing keeps narrow glyphs even */
    ctx.letterSpacing = sp + 'px';
    ctx.font = size + 'px ' + (font || '"Times New Roman", Georgia, serif');
    var save = ctx.textAlign; ctx.textAlign = 'center';
    ctx.fillText(txt, cx + sp / 2, y);
    ctx.textAlign = save; ctx.letterSpacing = '0px';
    return;
  }
  var wds = 0, i;
  for (i = 0; i < txt.length; i++) wds += ctx.measureText(txt[i]).width + sp;
  wds -= sp;
  var x = cx - wds / 2;
  for (i = 0; i < txt.length; i++) { ctx.fillText(txt[i], x, y); x += ctx.measureText(txt[i]).width + sp; }
}

function drawHero(sx, sy) {
  var y = sy + Math.sin(performance.now() / 260) * 0.8;
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(sx + 12, sy + 21, 8, 3.5, 0, 0, 6.2832); ctx.fill();
  var arm = hero.gear.armor, tunic = hero.hurt > 0 ? '#ff9d9d' : (arm >= 0 ? MATS[arm].col : '#3a6fd8');
  rect(ctx, sx + 7, y + 10, 10, 9, tunic);
  if (arm >= 0) { rect(ctx, sx + 7, y + 10, 10, 2, MATS[arm].edge); rect(ctx, sx + 11, y + 12, 2, 6, MATS[arm].edge); }
  rect(ctx, sx + 7, y + 19, 3, 3, '#2b2b38'); rect(ctx, sx + 14, y + 19, 3, 3, '#2b2b38');
  rect(ctx, sx + 7, y + 3, 10, 8, '#f0c39a');
  rect(ctx, sx + 6, y + 2, 12, 3, '#6a3f22');
  if (hero.face === 2) { rect(ctx, sx + 9, y + 7, 2, 2, '#22222c'); rect(ctx, sx + 13, y + 7, 2, 2, '#22222c'); }
  else if (hero.face === 1) rect(ctx, sx + 13, y + 7, 2, 2, '#22222c');
  else if (hero.face === 3) rect(ctx, sx + 9, y + 7, 2, 2, '#22222c');
  var sh = hero.gear.shield;
  if (sh >= 0) { rect(ctx, sx + (hero.face === 3 ? 3 : 17), y + 11, 4, 7, MATS[sh].col); rect(ctx, sx + (hero.face === 3 ? 3 : 17), y + 11, 4, 2, MATS[sh].edge); }
  var sw = hero.gear.sword;
  if (hero.swing > 0) {
    var ax = sx + 12 + DX[hero.face] * 13, ay = y + 13 + DY[hero.face] * 13;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.3 + 0.5 * hero.swing) + ')';
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ax, ay, 7 * hero.swing + 2, 0, 6.2832); ctx.stroke();
    rect(ctx, ax - 1, ay - 1, 3, 3, sw >= 0 ? MATS[sw].edge : '#e8ecf5');
  } else if (sw >= 0) {
    rect(ctx, sx + (hero.face === 3 ? 4 : 16), y + 8, 2, 11, MATS[sw].col);
    rect(ctx, sx + (hero.face === 3 ? 3 : 15), y + 13, 4, 2, MATS[sw].edge);
  }
}

function bossSprite(m, sx, sy, S) {
  var g = ctx, c = m.hurt > 0 ? '#ffffff' : m.col, c2 = m.col2, wob = Math.sin(performance.now() / 260 + m.x) * S;
  var cx = sx + 12, cy = sy + 12;
  function blob(x, y, r, col) { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); }
  function box(x, y, w, h, col) { rect(g, x, y, w, h, col); }
  g.fillStyle = 'rgba(0,0,0,.34)';
  g.beginPath(); g.ellipse(cx, sy + 22, 13 * S, 5 * S, 0, 0, 6.2832); g.fill();
  var sh = m.shape;
  if (sh === 'dragon') {
    g.fillStyle = c2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - 26 * S, cy - 16 * S - wob); g.lineTo(cx - 6 * S, cy + 8 * S); g.fill();
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 26 * S, cy - 16 * S - wob); g.lineTo(cx + 6 * S, cy + 8 * S); g.fill();
    blob(cx, cy + 4 * S, 11 * S, c);
    blob(cx, cy - 8 * S, 7 * S, c);
    box(cx + 3 * S, cy - 11 * S, 10 * S, 4 * S, c);          /* snout */
    box(cx + 9 * S, cy - 10 * S, 2 * S, 2 * S, '#ffef9f');
    box(cx - 4 * S, cy - 15 * S, 2 * S, 5 * S, c2); box(cx + 1 * S, cy - 16 * S, 2 * S, 6 * S, c2);
  } else if (sh === 'brute') {
    box(cx - 12 * S, cy - 2 * S, 24 * S, 20 * S, c);
    box(cx - 8 * S, cy - 14 * S, 16 * S, 13 * S, c);
    box(cx - 16 * S, cy - 16 * S, 5 * S, 4 * S, '#f0e6cf'); box(cx + 11 * S, cy - 16 * S, 5 * S, 4 * S, '#f0e6cf');
    box(cx - 12 * S, cy - 14 * S, 4 * S, 3 * S, '#f0e6cf'); box(cx + 8 * S, cy - 14 * S, 4 * S, 3 * S, '#f0e6cf');
    box(cx - 5 * S, cy - 9 * S, 3 * S, 3 * S, '#ff3b3b'); box(cx + 2 * S, cy - 9 * S, 3 * S, 3 * S, '#ff3b3b');
    box(cx - 6 * S, cy - 3 * S, 12 * S, 2 * S, c2);
    box(cx + 13 * S, cy - 6 * S, 5 * S, 22 * S, c2);          /* axe haft */
  } else if (sh === 'beast') {
    box(cx - 14 * S, cy + 2 * S, 28 * S, 12 * S, c);
    box(cx - 12 * S, cy + 12 * S, 4 * S, 8 * S, c2); box(cx + 8 * S, cy + 12 * S, 4 * S, 8 * S, c2);
    blob(cx - 12 * S, cy - 4 * S, 7 * S, c);                  /* head one */
    blob(cx + 8 * S, cy - 6 * S, 6 * S, c2);                  /* head two */
    box(cx - 14 * S, cy - 5 * S, 2 * S, 2 * S, '#ffe066'); box(cx + 7 * S, cy - 7 * S, 2 * S, 2 * S, '#ff6b6b');
    for (var t = 0; t < 5; t++) box(cx - 6 * S + t * 4 * S, cy - 1 * S, 2 * S, 4 * S, c2);
  } else if (sh === 'construct') {
    box(cx - 13 * S, cy - 8 * S, 26 * S, 26 * S, c);
    box(cx - 9 * S, cy - 16 * S, 18 * S, 9 * S, c2);
    box(cx - 5 * S, cy - 13 * S, 3 * S, 3 * S, '#9ff0ff'); box(cx + 3 * S, cy - 13 * S, 3 * S, 3 * S, '#9ff0ff');
    box(cx - 13 * S, cy + 2 * S, 26 * S, 3 * S, c2);
    box(cx - 17 * S, cy - 6 * S, 5 * S, 16 * S, c2); box(cx + 12 * S, cy - 6 * S, 5 * S, 16 * S, c2);
  } else if (sh === 'tentacle') {
    g.lineCap = 'round';
    for (var a = 0; a < 7; a++) {
      var ang = 0.35 + a / 7 * 2.5, curl = Math.sin(performance.now() / 700 + a) * 6 * S;
      g.strokeStyle = c2; g.lineWidth = 7 * S;
      g.beginPath(); g.moveTo(cx, cy + 5 * S);
      g.bezierCurveTo(cx + Math.cos(ang) * 14 * S, cy + 12 * S,
                      cx + Math.cos(ang) * 24 * S + curl, cy + 14 * S + Math.sin(ang) * 6 * S,
                      cx + Math.cos(ang) * 27 * S, cy + 21 * S);
      g.stroke();
      g.strokeStyle = c; g.lineWidth = 3.5 * S; g.stroke();
    }
    g.lineCap = 'butt';
    blob(cx, cy - 1 * S, 14 * S, c);
    blob(cx, cy - 9 * S, 9 * S, c);                          /* mantle */
    blob(cx - 6 * S, cy - 1 * S, 4 * S, '#ffe9a8'); blob(cx + 6 * S, cy - 1 * S, 4 * S, '#ffe9a8');
    box(cx - 7 * S, cy - 2 * S, 2 * S, 2 * S, '#1a1a22'); box(cx + 6 * S, cy - 2 * S, 2 * S, 2 * S, '#1a1a22');
    box(cx - 2 * S, cy + 7 * S, 4 * S, 4 * S, '#2b2b33');    /* beak */
  } else if (sh === 'serpent') {
    g.lineCap = 'round';
    g.strokeStyle = c2; g.lineWidth = 13 * S; g.beginPath();
    for (var i2 = 0; i2 <= 24; i2++) {
      var px2 = cx - 15 * S + i2 * (30 * S / 24), py2 = cy + 12 * S + Math.sin(i2 * 0.55 + performance.now() / 320) * 7 * S;
      if (i2 === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
    }
    g.stroke();
    g.strokeStyle = c; g.lineWidth = 9 * S; g.stroke();
    g.lineCap = 'butt';
    blob(cx + 2 * S, cy - 6 * S, 10 * S, c);                 /* raised head */
    box(cx + 8 * S, cy - 8 * S, 8 * S, 5 * S, c);            /* snout */
    box(cx + 13 * S, cy - 7 * S, 3 * S, 2 * S, '#ffe066');
    box(cx + 10 * S, cy - 3 * S, 2 * S, 3 * S, '#ffffff'); box(cx + 14 * S, cy - 3 * S, 2 * S, 3 * S, '#ffffff');
    box(cx - 2 * S, cy - 14 * S, 2 * S, 5 * S, c2); box(cx + 4 * S, cy - 15 * S, 2 * S, 6 * S, c2);
  } else if (sh === 'arachnid') {
    for (var L = 0; L < 4; L++) {
      var yy = cy - 4 * S + L * 4 * S, sp2 = Math.sin(performance.now() / 200 + L) * 3 * S;
      g.strokeStyle = c2; g.lineWidth = 2.5 * S;
      g.beginPath(); g.moveTo(cx, yy); g.lineTo(cx - 14 * S, yy - 6 * S + sp2); g.lineTo(cx - 20 * S, yy + 6 * S); g.stroke();
      g.beginPath(); g.moveTo(cx, yy); g.lineTo(cx + 14 * S, yy - 6 * S - sp2); g.lineTo(cx + 20 * S, yy + 6 * S); g.stroke();
    }
    blob(cx, cy + 6 * S, 12 * S, c);
    blob(cx, cy - 7 * S, 7 * S, c2);
    box(cx - 4 * S, cy - 9 * S, 2 * S, 2 * S, '#ff5c5c'); box(cx + 2 * S, cy - 9 * S, 2 * S, 2 * S, '#ff5c5c');
  } else if (sh === 'robed' || sh === 'lich') {
    var lich = sh === 'lich';
    g.fillStyle = lich ? '#241a3d' : c2;
    g.beginPath(); g.moveTo(cx, cy - 14 * S); g.lineTo(cx + 14 * S, cy + 20 * S); g.lineTo(cx - 14 * S, cy + 20 * S); g.fill();
    if (lich) {                                              /* spectral aura */
      g.globalAlpha = 0.28 + 0.12 * Math.sin(performance.now() / 240);
      blob(cx, cy + 2 * S, 22 * S, '#6f5bd6'); g.globalAlpha = 1;
    }
    blob(cx, cy - 15 * S, 7 * S, lich ? '#e8e4d5' : '#d9cdb5');
    box(cx - 4 * S, cy - 17 * S, 3 * S, 3 * S, lich ? '#7cf7ff' : '#ff6b6b');
    box(cx + 2 * S, cy - 17 * S, 3 * S, 3 * S, lich ? '#7cf7ff' : '#ff6b6b');
    if (lich) { for (var cr = 0; cr < 5; cr++) box(cx - 8 * S + cr * 4 * S, cy - 24 * S, 2 * S, 5 * S, '#e0c469'); }
    g.strokeStyle = lich ? '#cfe6ff' : c; g.lineWidth = 2.5 * S;
    g.beginPath(); g.moveTo(cx + 12 * S, cy - 22 * S); g.lineTo(cx + 14 * S, cy + 14 * S); g.stroke();
    blob(cx + 12 * S, cy - 24 * S, 4 * S, lich ? '#7cf7ff' : '#c6a3ff');
  } else {                                                   /* spectre */
    g.globalAlpha = 0.55 + 0.15 * Math.sin(performance.now() / 200);
    g.fillStyle = c;
    g.beginPath(); g.moveTo(cx - 12 * S, cy + 18 * S);
    g.quadraticCurveTo(cx - 14 * S, cy - 12 * S, cx, cy - 14 * S);
    g.quadraticCurveTo(cx + 14 * S, cy - 12 * S, cx + 12 * S, cy + 18 * S);
    g.fill(); g.globalAlpha = 1;
    box(cx - 5 * S, cy - 8 * S, 3 * S, 4 * S, '#0d1018'); box(cx + 2 * S, cy - 8 * S, 3 * S, 4 * S, '#0d1018');
    blob(cx, cy - 2 * S, 3 * S, '#ffffff');
  }
  if (m.swing > 0) {
    g.strokeStyle = 'rgba(255,140,140,' + m.swing + ')'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx + DX[m.face] * 16 * S, cy + DY[m.face] * 16 * S, 9 * S, 0, 6.2832); g.stroke();
  }
}

function drawMob(m, sx, sy) {
  if (m.boss) { bossSprite(m, sx, sy, (m.size || 2) * 0.95); return; }
  var t = m.t, wob = Math.sin(performance.now() / 200 + m.x * 1.3 + m.y) * 1.4;
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(sx + 12, sy + 21, 7, 3, 0, 0, 6.2832); ctx.fill();
  var col = m.hurt > 0 ? '#ffffff' : t.col;
  if (t.k === 'slime') {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(sx + 12, sy + 15 + wob * 0.3, 9, 7 - wob * 0.3, 0, 0, 6.2832); ctx.fill();
    rect(ctx, sx + 8, sy + 13, 2, 2, '#12321a'); rect(ctx, sx + 14, sy + 13, 2, 2, '#12321a');
  } else if (t.k === 'bat') {
    ctx.fillStyle = col;
    var sp = Math.abs(Math.sin(performance.now() / 90)) * 5 + 3;
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 12 + wob); ctx.lineTo(sx + 2, sy + 12 - sp + wob); ctx.lineTo(sx + 9, sy + 15 + wob); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 12 + wob); ctx.lineTo(sx + 22, sy + 12 - sp + wob); ctx.lineTo(sx + 15, sy + 15 + wob); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + 12, sy + 13 + wob, 4.5, 0, 6.2832); ctx.fill();
    rect(ctx, sx + 10, sy + 12 + wob, 2, 2, '#2a0f2f'); rect(ctx, sx + 13, sy + 12 + wob, 2, 2, '#2a0f2f');
  } else if (t.k === 'skeleton') {
    rect(ctx, sx + 8, sy + 11, 8, 8, col); rect(ctx, sx + 8, sy + 4, 9, 7, col);
    rect(ctx, sx + 10, sy + 7, 2, 2, '#2a2a30'); rect(ctx, sx + 14, sy + 7, 2, 2, '#2a2a30');
    rect(ctx, sx + 7, sy + 12, 11, 1, t.dark); rect(ctx, sx + 7, sy + 15, 11, 1, t.dark);
    rect(ctx, sx + 17, sy + 8, 2, 12, '#b8bcc6');
  } else {
    rect(ctx, sx + 5, sy + 9, 14, 12, col); rect(ctx, sx + 7, sy + 2, 10, 8, col);
    rect(ctx, sx + 9, sy + 5, 2, 2, '#20140b'); rect(ctx, sx + 14, sy + 5, 2, 2, '#20140b');
    rect(ctx, sx + 9, sy + 8, 6, 1, '#3a2415'); rect(ctx, sx + 18, sy + 6, 4, 14, t.dark);
  }
  if (m.hp < m.max) {
    rect(ctx, sx + 3, sy - 3, 18, 3, 'rgba(0,0,0,.55)');
    rect(ctx, sx + 4, sy - 2, Math.max(1, Math.round(16 * m.hp / m.max)), 1, '#ff6b6b');
  }
  if (m.swing > 0) { ctx.strokeStyle = 'rgba(255,120,120,' + m.swing + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx + 12 + DX[m.face] * 10, sy + 12 + DY[m.face] * 10, 6, 0, 6.2832); ctx.stroke(); }
}

function drawItem(it, sx, sy) {
  var bob = Math.sin(performance.now() / 300 + it.bob) * 1.6;
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(sx + 12, sy + 20, 6, 2.5, 0, 0, 6.2832); ctx.fill();
  if (it.kind === 'chest') {
    rect(ctx, sx + 4, sy + 10, 16, 10, '#8a5a2b'); rect(ctx, sx + 4, sy + 7, 16, 4, '#a86e35');
    rect(ctx, sx + 4, sy + 13, 16, 2, '#d9b45c'); rect(ctx, sx + 11, sy + 12, 3, 4, '#ffe9a8');
  } else if (it.kind === 'potion') {
    rect(ctx, sx + 9, sy + 6 + bob, 6, 3, '#cfd6e4'); rect(ctx, sx + 8, sy + 9 + bob, 8, 9, '#ff5c7a');
    rect(ctx, sx + 10, sy + 11 + bob, 2, 4, 'rgba(255,255,255,.55)');
  } else {
    var M = MATS[it.tier], yb = sy + bob;
    ctx.globalAlpha = 0.5 + 0.3 * Math.abs(Math.sin(performance.now() / 400 + it.bob));
    ctx.fillStyle = M.edge; ctx.beginPath(); ctx.arc(sx + 12, yb + 12, 9, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    if (it.slot === 'sword') {
      rect(ctx, sx + 11, yb + 3, 3, 13, M.col); rect(ctx, sx + 11, yb + 3, 3, 3, M.edge);
      rect(ctx, sx + 8, yb + 15, 9, 2, '#6a4a2a'); rect(ctx, sx + 11, yb + 17, 3, 4, '#6a4a2a');
    } else if (it.slot === 'shield') {
      rect(ctx, sx + 7, yb + 5, 11, 10, M.col); rect(ctx, sx + 9, yb + 15, 7, 3, M.col);
      rect(ctx, sx + 7, yb + 5, 11, 2, M.edge); rect(ctx, sx + 11, yb + 8, 3, 5, M.edge);
    } else {
      rect(ctx, sx + 7, yb + 6, 11, 12, M.col); rect(ctx, sx + 7, yb + 6, 11, 2, M.edge);
      rect(ctx, sx + 11, yb + 9, 3, 7, M.edge); rect(ctx, sx + 5, yb + 8, 2, 6, M.col); rect(ctx, sx + 18, yb + 8, 2, 6, M.col);
    }
  }
}

function bar(x, y, w, h, frac, col, bg) {
  rect(ctx, x, y, w, h, bg || 'rgba(255,255,255,.10)');
  rect(ctx, x, y, Math.max(0, Math.round(w * clamp(frac, 0, 1))), h, col);
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
}

function drawBossBar() {
  var b = theBoss();
  if (!b || !b.wake || dist(b, hero) > 22) return;
  var w = 420, x = (VPW - w) / 2, y = 22;
  rect(ctx, x - 2, y - 2, w + 4, 14, 'rgba(0,0,0,.62)');
  bar(x, y, w, 10, b.hp / b.max, '#a8232b', 'rgba(60,20,20,.85)');
  ctx.textAlign = 'center';
  spaced(b.name.toUpperCase(), VPW / 2, y - 6, 13, 2, 'rgba(232,224,200,.92)');
  ctx.textAlign = 'left';
}

function drawHUD() {
  var X = VPW, PW = CW - VPW;
  rect(ctx, X, 0, PW, CH, '#10141c'); rect(ctx, X, 0, 2, CH, '#2a3547');
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e6ecf7'; ctx.font = 'bold 15px ui-monospace, monospace';
  ctx.fillText('LUNCHQUEST', X + 14, 12);
  ctx.font = '10px ui-monospace, monospace'; ctx.fillStyle = '#7f8ca3';
  ctx.fillText('run ' + run.n + ' · floor ' + run.floor + '/' + FLOORS, X + 14, 30);
  ctx.fillStyle = '#5f6b80';
  ctx.fillText(FLOORDEF[clamp(run.floor - 1, 0, 4)].name, X + 14, 42);

  var y = 60;
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = '#cfd6e4'; ctx.fillText('HP  ' + hero.hp + '/' + hero.max, X + 14, y);
  bar(X + 14, y + 14, PW - 28, 8, hero.hp / hero.max, '#e8506a'); y += 30;
  ctx.fillStyle = '#cfd6e4'; ctx.fillText('XP  lvl ' + hero.lvl, X + 14, y);
  bar(X + 14, y + 14, PW - 28, 6, hero.xp / hero.next, '#5aa9e6'); y += 28;

  var rows = [['gold', hero.gold], ['kills', hero.kills], ['atk', hero.atk], ['def', hero.def],
              ['potions', hero.potions], ['foes', mobs.length]];
  for (var i = 0; i < rows.length; i++) {
    var rx = X + 14 + (i % 2) * ((PW - 28) / 2), ry = y + ((i / 2) | 0) * 16;
    ctx.fillStyle = '#6e7b91'; ctx.fillText(rows[i][0], rx, ry);
    ctx.fillStyle = '#e6ecf7'; ctx.fillText(String(rows[i][1]), rx + 58, ry);
  }
  y += 3 * 16 + 8;

  for (var s = 0; s < SLOTKEYS.length; s++) {                 /* gear panel */
    var k = SLOTKEYS[s], tr = hero.gear[k];
    ctx.fillStyle = '#6e7b91'; ctx.fillText(SLOTS[k].label, X + 14, y);
    if (tr < 0) { ctx.fillStyle = '#3f4859'; ctx.fillText('—', X + 76, y); }
    else { ctx.fillStyle = MATS[tr].edge; rect(ctx, X + 76, y + 2, 6, 6, MATS[tr].col); ctx.fillText(MATS[tr].n, X + 88, y); }
    y += 15;
  }
  y += 6;

  var ms = PW - 44, mx = X + 22;
  ctx.fillStyle = '#000'; ctx.fillRect(mx - 1, y - 1, ms + 2, ms + 2);
  ctx.drawImage(world.mini, mx, y, ms, ms);
  var sc = ms / W, k2;
  for (k2 = 0; k2 < items.length; k2++) {
    var it = items[k2];
    ctx.fillStyle = it.kind === 'chest' ? '#ffd166' : it.kind === 'potion' ? '#8ef2a0' : MATS[it.tier].edge;
    ctx.fillRect(mx + it.x * sc, y + it.y * sc, 2, 2);
  }
  for (k2 = 0; k2 < mobs.length; k2++) {
    var mb = mobs[k2];
    if (mb.boss) { ctx.fillStyle = '#ff2d2d'; ctx.fillRect(mx + mb.x * sc - 2, y + mb.y * sc - 2, 6, 6); }
    else { ctx.fillStyle = '#ff5c5c'; ctx.fillRect(mx + mb.x * sc, y + mb.y * sc, 2, 2); }
  }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(mx + hero.x * sc - 1, y + hero.y * sc - 1, 4, 4);
  ctx.strokeStyle = '#2a3547'; ctx.strokeRect(mx - 1.5, y - 1.5, ms + 3, ms + 3);
  y += ms + 10;

  ctx.fillStyle = '#8ef2a0'; ctx.fillText(('› ' + hero.intent).slice(0, 28), X + 14, y); y += 16;
  for (var L = 0; L < log.length; L++) {
    ctx.fillStyle = L === log.length - 1 ? '#aab6c9' : 'rgba(150,163,185,' + (0.30 + 0.06 * L) + ')';
    ctx.fillText(log[L].slice(0, 28), X + 14, y + L * 13);
  }
}

/* full-screen story cards */
function drawCard() {
  if (phase.name === 'play') return;
  var p = clamp(phase.t / phase.dur, 0, 1);
  var fade = clamp(p < 0.15 ? p / 0.15 : p > 0.86 ? (1 - p) / 0.14 : 1, 0, 1);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, VPW, CH); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,' + (0.88 * fade).toFixed(3) + ')';
  ctx.fillRect(0, 0, VPW, CH);
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  var mid = CH / 2;
  if (phase.name === 'died') {
    var gr = ctx.createLinearGradient(0, mid - 30, 0, mid + 12);
    gr.addColorStop(0, '#e0473f'); gr.addColorStop(1, '#6d1512');
    spaced('YOU DIED', VPW / 2, mid, 62, 9, gr);
    rect(ctx, VPW / 2 - 200, mid + 16, 400, 1, 'rgba(180,60,50,.45)');
    spaced('FLOOR ' + run.floor + '  ·  LEVEL ' + hero.lvl + '  ·  ' + hero.gold + ' GOLD', VPW / 2, mid + 44, 15, 3, 'rgba(190,180,170,.75)');
  } else if (phase.name === 'cleared') {
    var g2 = ctx.createLinearGradient(0, mid - 26, 0, mid + 10);
    g2.addColorStop(0, '#ffeeb0'); g2.addColorStop(1, '#a8842f');
    spaced('FLOOR CLEARED', VPW / 2, mid, 44, 7, g2);
    rect(ctx, VPW / 2 - 200, mid + 16, 400, 1, 'rgba(200,170,90,.45)');
    spaced('DESCENDING TO FLOOR ' + (run.floor + 1), VPW / 2, mid + 44, 15, 3, 'rgba(220,210,180,.8)');
  } else if (phase.name === 'victory') {
    var g3 = ctx.createLinearGradient(0, mid - 34, 0, mid + 12);
    g3.addColorStop(0, '#fffbe6'); g3.addColorStop(1, '#c9a227');
    spaced('VICTORY', VPW / 2, mid - 14, 60, 10, g3);
    spaced('THE UNDYING IS UNMADE', VPW / 2, mid + 24, 18, 5, 'rgba(240,230,200,.85)');
    rect(ctx, VPW / 2 - 200, mid + 40, 400, 1, 'rgba(200,170,90,.45)');
    spaced('LEVEL ' + hero.lvl + '  ·  ' + hero.kills + ' SLAIN  ·  ' + hero.gold + ' GOLD', VPW / 2, mid + 68, 15, 3, 'rgba(220,210,180,.8)');
  } else {
    spaced('LUNCHQUEST', VPW / 2, mid - 10, 54, 12, '#dfe6f2');
    spaced('RUN ' + (run.n + 1), VPW / 2, mid + 26, 17, 6, 'rgba(180,190,210,.7)');
    spaced('A HERO DESCENDS', VPW / 2, mid + 56, 12, 4, 'rgba(140,150,170,.6)');
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.restore();
}

function smooth(e, k) {
  if (Math.abs(e.px - e.x) > 2 || Math.abs(e.py - e.y) > 2) { e.px = e.x; e.py = e.y; return; }
  e.px = lerp(e.px, e.x, k); e.py = lerp(e.py, e.y, k);
}

function render(dt) {
  smooth(hero, 0.35);
  for (var i = 0; i < mobs.length; i++) smooth(mobs[i], 0.3);
  var tx = clamp(hero.px * TILE + TILE / 2 - VPW / 2, 0, W * TILE - VPW);
  var ty = clamp(hero.py * TILE + TILE / 2 - VPH / 2, 0, H * TILE - VPH);
  if (Math.abs(cam.x - tx) > TILE * 6 || Math.abs(cam.y - ty) > TILE * 6) { cam.x = tx; cam.y = ty; }
  else { cam.x = lerp(cam.x, tx, 0.12); cam.y = lerp(cam.y, ty, 0.12); }
  var ox = -Math.round(cam.x) + (shake > 0 ? (Math.random() * shake - shake / 2) | 0 : 0);
  var oy = -Math.round(cam.y) + (shake > 0 ? (Math.random() * shake - shake / 2) | 0 : 0);

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, VPW, CH); ctx.clip();
  rect(ctx, 0, 0, VPW, CH, '#0d1a2b');
  var x0 = Math.max(0, ((cam.x / TILE) | 0) - 1), y0 = Math.max(0, ((cam.y / TILE) | 0) - 1);
  var x1 = Math.min(W - 1, x0 + (VPW / TILE | 0) + 2), y1 = Math.min(H - 1, y0 + (VPH / TILE | 0) + 2);
  for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
    var idx = yy * W + xx;
    ctx.drawImage(sheet, world.variant[idx] * TILE, world.tiles[idx] * TILE, TILE, TILE, xx * TILE + ox, yy * TILE + oy, TILE, TILE);
  }
  var ents = [], a;
  for (a = 0; a < items.length; a++) ents.push({ y: items[a].y, d: items[a], k: 'i' });
  for (a = 0; a < mobs.length; a++) ents.push({ y: mobs[a].py, d: mobs[a], k: 'm' });
  ents.push({ y: hero.py, d: hero, k: 'h' });
  ents.sort(function (p, q) { return p.y - q.y; });
  for (a = 0; a < ents.length; a++) {
    var o = ents[a].d;
    if (ents[a].k === 'i') drawItem(o, o.x * TILE + ox, o.y * TILE + oy);
    else if (ents[a].k === 'm') drawMob(o, o.px * TILE + ox, o.py * TILE + oy);
    else drawHero(o.px * TILE + ox, o.py * TILE + oy);
  }
  for (var bl = bolts.length - 1; bl >= 0; bl--) {            /* boss projectiles */
    var B2 = bolts[bl]; B2.t += dt / 320;
    if (B2.t >= 1) { bolts.splice(bl, 1); continue; }
    ctx.globalAlpha = 1 - B2.t; ctx.strokeStyle = B2.col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(B2.x0 * TILE + ox + 12, B2.y0 * TILE + oy + 12);
    ctx.lineTo(B2.x1 * TILE + ox + 12, B2.y1 * TILE + oy + 12); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.font = 'bold 12px ui-monospace, monospace'; ctx.textAlign = 'center';
  for (var f = floats.length - 1; f >= 0; f--) {
    var ft = floats[f]; ft.t += dt / 900;
    if (ft.t >= 1) { floats.splice(f, 1); continue; }
    ctx.globalAlpha = 1 - ft.t;
    ctx.fillStyle = '#000'; ctx.fillText(ft.txt, ft.x * TILE + ox + 13, ft.y * TILE + oy + 3 - ft.t * 20);
    ctx.fillStyle = ft.col; ctx.fillText(ft.txt, ft.x * TILE + ox + 12, ft.y * TILE + oy + 2 - ft.t * 20);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
  var dark = FLOORDEF[clamp(run.floor - 1, 0, 4)].dark;
  var gr2 = ctx.createRadialGradient(VPW / 2, CH / 2, CH * 0.30, VPW / 2, CH / 2, CH * 0.85);
  gr2.addColorStop(0, 'rgba(0,0,0,0)'); gr2.addColorStop(1, 'rgba(0,0,0,' + dark + ')');
  ctx.fillStyle = gr2; ctx.fillRect(0, 0, VPW, CH);
  drawBossBar();
  ctx.restore();

  drawCard();
  drawHUD();

  hero.swing = Math.max(0, hero.swing - dt / 160);
  hero.hurt = Math.max(0, hero.hurt - dt / 200);
  for (var m2 = 0; m2 < mobs.length; m2++) {
    mobs[m2].swing = Math.max(0, mobs[m2].swing - dt / 160);
    mobs[m2].hurt = Math.max(0, mobs[m2].hurt - dt / 200);
  }
  shake = Math.max(0, shake - dt / 90);
}

/* ---------------- boot ---------------- */
function boot() {
  buildBaseSheet();
  stats = { kills: 0, bosses: 0, deaths: 0, wins: 0, best: 1, unstuck: 0, killers: {} };
  log = []; tick = 0; shake = 0; run = null; hero = null;
  mobs = []; items = []; floats = []; bolts = [];
  setPhase('play', 0);
  say('lunchquest — the hero needs no player');
  newRun();
  var q = typeof location !== 'undefined' && location.search ? /card=(\w+)/.exec(location.search) : null;
  if (q) { setPhase(q[1], 100000); phase.t = 42000; }          /* card preview for screenshots */
  if (typeof location !== 'undefined' && /parade/.test(location.search || '')) parade();
  var fq = typeof location !== 'undefined' ? /floor=(\d)/.exec(location.search || '') : null;
  if (fq) { run.floor = clamp(+fq[1], 1, FLOORS); buildFloor(run.floor); }
}
/* dev: line the whole bestiary up next to the hero */
function parade() {
  parading = 1;
  mobs.length = 0;
  var all = BOSSES.concat([LICH]);
  for (var i = 0; i < all.length; i++) {
    var B = all[i], x = hero.x - 6 + (i % 4) * 4, y = hero.y - 4 + ((i / 4) | 0) * 4;
    mobs.push({ id: nextId++, t: B, boss: 1, name: B.n, sname: B.s, shape: B.shape, ab: B.ab, size: B.size,
      x: x, y: y, px: x, py: y, hp: B.hp, max: B.hp, atk: 0, def: B.def, ev: 99,
      col: B.col, col2: B.col2, face: 2, hurt: 0, swing: 0, wake: i === 0 ? 1 : 0, cd: 0 });
  }
  items.length = 0;
}

var last = 0;
function frame(now) {
  if (!last) last = now;
  var dt = Math.min(80, now - last); last = now;
  render(dt);
  requestAnimationFrame(frame);
}
function simStep() {
  try { doTurn(); }
  catch (err) {
    say('the world convulsed — reforming');
    try { buildFloor(run.floor); setPhase('play', 0); } catch (e2) { /* retry next tick */ }
  }
}
boot();
setInterval(simStep, TURN_MS);
requestAnimationFrame(frame);
if (typeof window !== 'undefined') window.LQ = {
  hero: function () { return hero; }, mobs: function () { return mobs; }, items: function () { return items; },
  stats: function () { return stats; }, run: function () { return run; }, tick: function () { return tick; },
  phase: function () { return phase; }, boss: theBoss
};
if (typeof module !== 'undefined') module.exports = {
  state: function () { return { hero: hero, mobs: mobs, items: items, stats: stats, run: run, phase: phase, tick: tick }; }
};
})();
