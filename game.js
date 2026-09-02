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
var TILE = 24, W = 160, H = 160;
var CW = 960, CH = 540, VPW = 716, VPH = 540;
var DEEP = 0, WATER = 1, SAND = 2, GRASS = 3, TALL = 4, TREE = 5, ROCK = 6, PATH = 7, FLOWER = 8;
var WALK = [0, 0, 1, 1, 1, 0, 0, 1, 1];
var MINI = ['#12283f', '#1d5b91', '#d8c48c', '#3f8a3f', '#4fa04a', '#245227', '#7d7f86', '#b09a6d', '#5aa84e'];
var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
var VARIANTS = 4, TURN_MS = 145, FLOORS = 5;

/* each floor gets its own mood: a tint over the shared tilesheet */
var FLOORDEF = [
  { name: 'Verdant Shore', dark: 0.42, recipe: null, sea: null },
  { name: 'Amber Reach', dark: 0.46, recipe: [
    { op: 'hue', col: 'hsl(32,80%,50%)' }, { op: 'multiply', col: 'rgba(240,185,110,0.45)' }],
    sea: 'rgba(215,200,165,0.20)' },
  { name: 'Ashen Waste', dark: 0.56, recipe: [
    { op: 'saturation', col: 'hsl(0,10%,50%)' }, { op: 'multiply', col: 'rgba(175,150,145,0.60)' }],
    sea: 'rgba(150,150,160,0.34)' },
  { name: 'Frostmarch', dark: 0.48, recipe: [
    { op: 'hue', col: 'hsl(200,75%,50%)' }, { op: 'saturation', col: 'hsl(0,45%,50%)' },
    { op: 'screen', col: 'rgba(190,225,255,0.22)' }],
    sea: 'rgba(205,235,255,0.18)' },
  { name: 'The Black Vault', dark: 0.70, recipe: [
    { op: 'hue', col: 'hsl(266,60%,50%)' }, { op: 'saturation', col: 'hsl(0,26%,50%)' },
    { op: 'multiply', col: 'rgba(96,84,138,0.74)' }],
    sea: 'rgba(110,100,155,0.45)' }
];

/* ---------------- gear ---------------- */
var MATS = [
  { n: 'iron',  col: '#9aa2ad', edge: '#d6dae0' },
  { n: 'steel', col: '#7fa8c9', edge: '#dff0ff' },
  { n: 'elven', col: '#c9d6a8', edge: '#f2ffd9' },
  { n: 'glass', col: '#6fd8c0', edge: '#d3fff5' },
  { n: 'ebony', col: '#6b6480', edge: '#c3b8e0' }
];
/* enchantments: the main source of run-to-run variance in a kit */
var AFFIX = {
  keen:     { on: ['sword', 'bow'],      atk: 3,      col: '#ffd166' },
  cruel:    { on: ['sword'],             atk: 6,      col: '#ff8a8a' },
  vampiric: { on: ['sword'],             leech: 0.25, col: '#d86a8a' },
  burning:  { on: ['sword', 'bow'],      fire: 1,     col: '#ff8a3d' },
  sturdy:   { on: ['shield', 'armor'],   def: 2,      col: '#9fd8e6' },
  warded:   { on: ['shield', 'armor'],   hp: 14,      col: '#8ef2a0' },
  swift:    { on: ['bow', 'axe'],        rng: 1,      col: '#cfe6ff' },
  vigorous: { on: ['shield', 'armor'],   stam: 12,    col: '#f4b183' }
};
var AFFIXKEYS = Object.keys(AFFIX);
function affixFor(slot, rnd, chance) {
  if (rnd() > chance) return null;
  var ok = [];
  for (var i = 0; i < AFFIXKEYS.length; i++) if (AFFIX[AFFIXKEYS[i]].on.indexOf(slot) >= 0) ok.push(AFFIXKEYS[i]);
  return ok.length ? ok[rnd() * ok.length | 0] : null;
}
function affixWorth(a) {
  if (!a) return 0;
  var A = AFFIX[a];
  return (A.atk || 0) + (A.def || 0) * 2 + (A.hp || 0) * 0.3 + (A.stam || 0) * 0.3 + (A.leech ? 5 : 0) + (A.fire ? 5 : 0) + (A.rng ? 4 : 0);
}
function gearName(slot, tier, affix) {
  return (affix ? affix + ' ' : '') + matsFor(slot)[tier].n + ' ' + SLOTS[slot].label;
}
var BOWMATS = [
  { n: 'ash',        col: '#a8794a', edge: '#d9b487' },
  { n: 'yew',        col: '#7c9b5a', edge: '#cfe6a8' },
  { n: 'elven',      col: '#c9d6a8', edge: '#f2ffd9' },
  { n: 'glass',      col: '#6fd8c0', edge: '#d3fff5' },
  { n: 'dragonbone', col: '#d8607a', edge: '#ffd0dc' }
];
var SLOTS = {
  sword:  { atk: [4, 8, 13, 19, 26],    label: 'blade'  },
  shield: { def: [1, 3, 5, 8, 11],      label: 'shield' },
  armor:  { hp:  [10, 22, 38, 58, 82],  label: 'armor'  },
  bow:    { pow: [3, 6, 11, 16, 22], rng: [6, 7, 8, 8, 9], label: 'bow', mats: BOWMATS },
  axe:    { chop: [4, 3, 2, 2, 1], label: 'axe' }
};
var SLOTKEYS = ['sword', 'shield', 'armor', 'bow', 'axe'];
var BOAT_WOOD = 6, BOAT_TURNS = 5;
var QUIVER_MAX = 24;
/* stamina: what an action costs.  Being winded doesn't stop you, it makes you weak. */
var STAM = { melee: 4, bossMelee: 6, bow: 3, run: 3, charge: 12, bolt: 4, summon: 8, chop: 2, build: 1, swim: 2 };
var HERO_STAM = 40, HERO_STAM_LVL = 4;
var ELEMENTS = {
  fire:  { n: 'fire',  col: '#ff8a3d', edge: '#ffd7a8', fx: 'blast' },
  frost: { n: 'frost', col: '#8fdcff', edge: '#dff4ff', fx: 'freeze' },
  shock: { n: 'shock', col: '#ffe066', edge: '#fff8c8', fx: 'chain' }
};
var ELEKEYS = ['fire', 'frost', 'shock'];
function matsFor(slot) { return SLOTS[slot].mats || MATS; }

/* ---------------- bosses ---------------- */
var BOSSES = [
  { n: 'Vermathrax the Ember', s: 'Vermathrax',  shape: 'dragon',   hp: 150, atk: 12, def: 3, stam: 70, ev: 2, aggro: 7,  ab: 'ranged', col: '#c0392b', col2: '#6f1d15', size: 2.1 },
  { n: 'The Broodmother', s: 'the Broodmother',       shape: 'arachnid', hp: 130, atk: 10, def: 2, stam: 60, ev: 1, aggro: 6, ab: 'summon', col: '#5b4a80', col2: '#241d3a', size: 1.9 },
  { n: 'Grond, Bull of the Deep', s: 'Grond', shape: 'brute',  hp: 170, atk: 13, def: 4, stam: 90, ev: 2, aggro: 8,  ab: 'charge', col: '#96603d', col2: '#4a2e1e', size: 2.0 },
  { n: 'Sablecoil the Basilisk', s: 'Sablecoil', shape: 'serpent', hp: 140, atk: 11, def: 3, stam: 65, ev: 2, aggro: 7,  ab: 'ranged', col: '#b6e04a', col2: '#26301a', size: 2.1 },
  { n: 'Aurex, Stone Warden', s: 'Aurex',   shape: 'construct', hp: 200, atk: 11, def: 7, stam: 80, ev: 3, aggro: 7,  ab: 'armor',  col: '#8d9098', col2: '#4e5158', size: 2.0 },
  { n: 'Skarn the Wyvern', s: 'Skarn',      shape: 'dragon',   hp: 135, atk: 13, def: 2, stam: 70, ev: 1, aggro: 6, ab: 'charge', col: '#8e5bb5', col2: '#432a5c', size: 1.9 },
  { n: 'The Chimera', s: 'the Chimera',           shape: 'beast',    hp: 155, atk: 12, def: 3, stam: 75, ev: 2, aggro: 7,  ab: 'ranged', col: '#c98a4b', col2: '#6b4522', size: 2.0 },
  { n: 'Malzeth the Necromancer', s: 'Malzeth', shape: 'robed',  hp: 130, atk: 11, def: 2, stam: 55, ev: 2, aggro: 8, ab: 'summon', col: '#6d4fa8', col2: '#2e1f4d', size: 2.1 },
  { n: 'The Hollow Wraith', s: 'the Wraith',     shape: 'spectre',  hp: 125, atk: 13, def: 2, stam: 60, ev: 1, aggro: 6, ab: 'drain',  col: '#9fd8e6', col2: '#2a4a55', size: 2.0 }
];
var SEABOSSES = [
  { n: 'The Kraken of Still Water', s: 'the Kraken', shape: 'tentacle', hp: 170, atk: 11, def: 3, stam: 80, ev: 2, aggro: 8, sea: 1, ab: 'summon', col: '#4a7fa8', col2: '#1f3d55', size: 2.2 },
  { n: 'Grandfather Sturgeon', s: 'the Sturgeon', shape: 'fish', hp: 230, atk: 12, def: 5, stam: 100, ev: 2, aggro: 7, sea: 1, ab: 'charge', col: '#7d8a6a', col2: '#3d4630', size: 2.3 },
  { n: 'The Siren of Salt Harbour', s: 'the Siren', shape: 'siren', hp: 150, atk: 12, def: 2, stam: 60, ev: 2, aggro: 9, sea: 1, ab: 'ranged', col: '#8fd6c8', col2: '#2f6a68', size: 2.0 },
  { n: 'Nessa of the Long Loch', s: 'Nessa', shape: 'nessie', hp: 205, atk: 13, def: 4, stam: 95, ev: 2, aggro: 8, sea: 1, ab: 'charge', col: '#4e7a58', col2: '#223d2a', size: 2.3 }
];
var LICH = { n: 'Xanthemar, the Undying', s: 'Xanthemar', shape: 'lich', hp: 700, atk: 32, def: 9, stam: 140, ev: 2, aggro: 9, ab: 'lich', col: '#cfe6ff', col2: '#3b2a5e', size: 2.4 };

/* sea: water only.  amph: either.  fly: crosses water but fights like a land thing. */
var SEATYPES = [
  { k: 'eel',   hp: 14, atk: 6, def: 0, stam: 16, ev: 1, aggro: 8,  gold: 7,  xp: 10, sea: 1, col: '#4f9e6a', dark: '#204a33' },
  { k: 'jelly', hp: 20, atk: 5, def: 3, stam: 10, ev: 3, aggro: 6,  gold: 9,  xp: 12, sea: 1, col: '#c79ce0', dark: '#5d3d75' },
  { k: 'nixie', hp: 16, atk: 6, def: 1, stam: 14, ev: 2, aggro: 9,  gold: 12, xp: 15, sea: 1, rng: 5, shot: '#9fe6ff', col: '#7fc7d9', dark: '#2f5a68' }
];
var ISLETTYPES = [
  { k: 'crab',  hp: 20, atk: 6, def: 3, stam: 20, ev: 2, aggro: 6,  gold: 10, xp: 13, amph: 1, col: '#d0603f', dark: '#6e2c1c' },
  { k: 'harpy', hp: 16, atk: 7, def: 0, stam: 18, ev: 1, aggro: 10, gold: 11, xp: 15, fly: 1, col: '#c9a86a', dark: '#6b5324' }
];
var MIMIC = { k: 'mimic', hp: 34, atk: 9, def: 2, stam: 24, ev: 2, aggro: 3, gold: 30, xp: 24, col: '#a86e35', dark: '#5b3a1e' };

var MTYPES = [
  { k: 'slime',    hp: 12, atk: 3, def: 0, stam: 12, ev: 2, aggro: 7,  gold: 3,  xp: 5,  col: '#6ad36f', dark: '#2f7a37' },
  { k: 'bat',      hp: 9,  atk: 4, def: 0, stam: 12, ev: 1, aggro: 8, gold: 5,  xp: 7,  col: '#a479d6', dark: '#5c3b85' },
  { k: 'archer',   hp: 14, atk: 5, def: 0, stam: 14, ev: 2, aggro: 9,  gold: 8,  xp: 11, rng: 5, shot: '#e8d9a8', col: '#d9c9a0', dark: '#7d6f4e' },
  { k: 'skeleton', hp: 20, atk: 6, def: 1, stam: 20, ev: 2, aggro: 7,  gold: 9,  xp: 12, col: '#e8e4d5', dark: '#8b8776' },
  { k: 'imp',      hp: 16, atk: 6, def: 1, stam: 14, ev: 2, aggro: 9,  gold: 11, xp: 14, rng: 4, shot: '#ff9d4d', col: '#e0763c', dark: '#7a3a18' },
  { k: 'ogre',     hp: 34, atk: 9, def: 2, stam: 28, ev: 3, aggro: 7,  gold: 18, xp: 22, col: '#9a7350', dark: '#5c452e' }
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
function applyRecipe(cv, recipe, y0, h0) {
  if (!recipe) return cv;
  var g = cv.getContext('2d');
  y0 = y0 || 0; h0 = h0 === undefined ? cv.height : h0;
  g.save();
  g.beginPath(); g.rect(0, y0, cv.width, h0); g.clip();
  for (var r = 0; r < recipe.length; r++) { g.globalCompositeOperation = recipe[r].op; rect(g, 0, y0, cv.width, h0, recipe[r].col); }
  g.globalCompositeOperation = 'source-over';
  g.restore();
  return cv;
}
function sheetFor(floor) {
  var i = clamp(floor - 1, 0, FLOORDEF.length - 1);
  if (sheets[i]) return sheets[i];
  var def = FLOORDEF[i];
  if (!def.recipe) { sheets[i] = baseSheet; return baseSheet; }
  var cv = newCanvas(baseSheet.width, baseSheet.height), g = cv.getContext('2d');
  g.drawImage(baseSheet, 0, 0);
  applyRecipe(cv, def.recipe, TILE * 2, cv.height - TILE * 2);   /* land rows only */
  if (def.sea) {                                                 /* the water stays water */
    g.save();
    g.beginPath(); g.rect(0, 0, cv.width, TILE * 2); g.clip();
    g.globalCompositeOperation = 'multiply';
    rect(g, 0, 0, cv.width, TILE * 2, def.sea);
    g.globalCompositeOperation = 'source-over';
    g.restore();
  }
  sheets[i] = cv;
  return cv;
}

/* ---------------- world ---------------- */
var world = null;
function genWorld(seed) {
  var rnd = mulberry32(seed);
  var n1 = makeNoise(mulberry32(seed ^ 0x9E3779B9)), n2 = makeNoise(mulberry32(seed ^ 0x85EBCA6B));
  var tiles = new Uint8Array(W * H), variant = new Uint8Array(W * H), x, y, i;

  /* scatter a few island centres, keeping them apart; land is the union of
     their falloffs, so the sea between them is genuinely deep */
  var cores = [], want = 3 + (rnd() * 3 | 0);
  for (var a = 0; a < want * 14 && cores.length < want; a++) {
    var cx0 = 22 + rnd() * (W - 44), cy0 = 22 + rnd() * (H - 44), rr = 20 + rnd() * 20, ok = 1;
    for (var b = 0; b < cores.length; b++) {
      if (Math.hypot(cores[b].x - cx0, cores[b].y - cy0) < cores[b].r + rr + 9) { ok = 0; break; }
    }
    if (ok) cores.push({ x: cx0, y: cy0, r: rr, sq: 0.7 + rnd() * 0.9 });
  }
  if (!cores.length) cores.push({ x: W / 2, y: H / 2, r: 34, sq: 1 });

  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var mask = 0;
    for (var c = 0; c < cores.length; c++) {
      var C = cores[c], ddx = (x - C.x) / C.r, ddy = (y - C.y) / (C.r * C.sq);
      var infl = 1 - Math.pow(Math.min(1, Math.sqrt(ddx * ddx + ddy * ddy)), 1.7);
      if (infl > mask) mask = infl;
    }
    var e = n1(x, y, 5, 0.055), m = n2(x, y, 4, 0.085);
    e = e * 0.58 + mask * 0.62 - 0.30;
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
  var islands = [], islets = [];
  for (i = 0; i < comps.length; i++) {
    if (comps[i].length >= 90) islands.push({ id: i, tiles: comps[i] });
    else if (comps[i].length >= 4) islets.push({ id: i, tiles: comps[i] });
  }
  islands.sort(function (p2, q2) { return q2.tiles.length - p2.tiles.length; });
  if (islands.length < 2) return null;                        /* we want an archipelago */
  var land = comps[best];
  for (var p = 0; p < islands.length * 2; p++) {
    var isl = islands[p % islands.length].tiles;
    var a = isl[rnd() * isl.length | 0], b = isl[rnd() * isl.length | 0];
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
  var trees = [];
  for (i = 0; i < W * H; i++) if (tiles[i] === TREE) trees.push(i);
  var fog = newCanvas(W, H), fg = fog.getContext('2d');
  fg.fillStyle = '#05070c'; fg.fillRect(0, 0, W, H);
  var shallows = [];
  for (i = 0; i < W * H; i++) {
    if (tiles[i] !== WATER) continue;
    var sx2 = i % W, sy2 = (i - sx2) / W;
    if (sx2 < 2 || sy2 < 2 || sx2 > W - 3 || sy2 > H - 3) continue;
    shallows.push(i);
  }
  return { seed: seed, tiles: tiles, variant: variant, land: land, comp: comp, islands: islands, islets: islets,
           shallows: shallows, trees: trees,
           seen: new Uint8Array(W * H), vis: new Int32Array(W * H).fill(-1), seenCount: 0, fog: fog, mini: mm, rnd: rnd };
}
function tileAt(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? ROCK : world.tiles[y * W + x]; }
function walkable(x, y) { return !!WALK[tileAt(x, y)]; }

/* ---------------- state ---------------- */
var hero, mobs, items, floats, shots, fx, log, cam, run, stats, tick, shake, phase, sheet, parading = 0, nextId = 1;

function say(m) { log.push(m); if (log.length > 6) log.shift(); }
function fl(x, y, txt, col) { floats.push({ x: x, y: y, txt: txt, col: col, t: 0 }); }
function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function setPhase(name, dur) { phase = { name: name, t: 0, dur: dur }; }

/* ---------------- beings ----------------
   Everything that breathes shares one shape: a place on the map, health,
   stamina, and the little animation counters the renderer needs.  Hero and
   Mob hang their own bookkeeping off this. */
function Being(x, y) {
  this.x = x; this.y = y; this.px = x; this.py = y;
  this.hp = 1; this.max = 1;
  this.stam = 1; this.stamMax = 1; this.stamRegen = 2;
  this.exert = 0;                 /* this turn: 0 rested, 1 walked, 2 worked */
  this.winded = 0; this.frozen = 0;
  this.face = 2; this.swing = 0; this.hurt = 0; this.shoot = 0;
}
Being.prototype.stamFrac = function () { return this.stamMax > 0 ? this.stam / this.stamMax : 0; };
Being.prototype.canAfford = function (n) { return this.stam >= n; };
/* pay for an action; going to zero is allowed, and announced once */
Being.prototype.spend = function (n) {
  this.stam = Math.max(0, this.stam - n); this.exert = 2;
  if (this.stam === 0 && !this.winded) { this.winded = 1; fl(this.x, this.y, 'winded', '#f4b183'); }
};
/* how hard a blow lands: full strength above half stamina, fading to 60% when spent */
Being.prototype.effort = function () {
  var f = this.stamFrac();
  return f >= 0.5 ? 1 : 0.6 + 0.8 * f;
};
/* end of a turn: a body that did nothing recovers fastest, a walking one a little,
   a working one not at all */
Being.prototype.breathe = function () {
  if (this.exert === 0) this.stam = Math.min(this.stamMax, this.stam + this.stamRegen);
  else if (this.exert === 1) this.stam = Math.min(this.stamMax, this.stam + 1);
  if (this.winded && this.stam >= this.stamMax * 0.3) this.winded = 0;
  this.exert = 0;
};

function Hero() {
  Being.call(this, 0, 0);
  this.lvl = 1; this.xp = 0; this.next = 22; this.gold = 0; this.kills = 0; this.bosses = 0;
  this.baseAtk = 5; this.baseDef = 1; this.baseMax = 44; this.baseStam = HERO_STAM;
  this.potions = 2; this.arrows = 0; this.ammo = { fire: 0, frost: 0, shock: 0 };
  this.gear = { sword: 0, shield: -1, armor: -1, bow: -1, axe: -1 };
  this.affix = { sword: null, shield: null, armor: null, bow: null, axe: null };
  this.wood = 0; this.boat = 0; this.boatHp = 0; this.sailing = 0; this.swimming = 0; this.chop = null; this.build = null;
  this.intent = 'descending'; this.lock = null; this.lockT = 0; this.resting = 0; this.ran = 0;
  this.hist = []; this.lastProgress = 0; this.ban = {};
  recalc(this); this.hp = this.max; this.stam = this.stamMax;
}
Hero.prototype = Object.create(Being.prototype);
Hero.prototype.constructor = Hero;
/* the cost of a swing goes up with the weight of the blade */
Hero.prototype.meleeCost = function () { return STAM.melee + (this.gear.sword > 1 ? 1 : 0); };

/* one constructor for rank-and-file and bosses; the floor sets the scale */
function Mob(T, x, y, floor, boss) {
  Being.call(this, x, y);
  this.id = nextId++; this.t = T; this.boss = boss ? 1 : 0; this.name = boss ? T.n : T.k;
  this.ev = T.ev; this.wake = 0; this.cd = 0;
  if (boss) {
    this.sname = T.s; this.shape = T.shape; this.ab = T.ab; this.size = T.size; this.col = T.col; this.col2 = T.col2;
    var last = floor >= FLOORS;
    this.max = Math.round(T.hp * (last ? 1 : 0.62 + 0.30 * floor));
    this.atk = Math.round(T.atk * (last ? 1 : 0.64 + 0.19 * floor));
    this.def = T.def + (floor > 2 ? 1 : 0);
    this.stamMax = T.stam || 60; this.stamRegen = T.ab === 'lich' ? 4 : 3;
  } else {
    var sc = 1 + 0.62 * (floor - 1);
    this.max = Math.round(T.hp * sc);
    this.atk = T.atk + Math.round((floor - 1) * 2.6);
    this.def = T.def + (floor > 2 ? 1 : 0) + (floor > 4 ? 1 : 0);
    this.stamMax = T.stam || 16; this.stamRegen = 2;
  }
  this.hp = this.max; this.stam = this.stamMax;
}
Mob.prototype = Object.create(Being.prototype);
Mob.prototype.constructor = Mob;
Mob.prototype.meleeCost = function () { return this.boss ? STAM.bossMelee : STAM.melee; };

function newHero() { return new Hero(); }
function recalc(h) {
  h.atk = h.baseAtk + (h.gear.sword >= 0 ? SLOTS.sword.atk[h.gear.sword] : 0);
  h.def = h.baseDef + (h.gear.shield >= 0 ? SLOTS.shield.def[h.gear.shield] : 0);
  h.max = h.baseMax + (h.gear.armor >= 0 ? SLOTS.armor.hp[h.gear.armor] : 0);
  h.stamMax = h.baseStam;
  h.rpow = h.gear.bow >= 0 ? SLOTS.bow.pow[h.gear.bow] : 0;
  h.rng = h.gear.bow >= 0 ? SLOTS.bow.rng[h.gear.bow] : 0;
  h.leech = 0; h.burn = 0;
  for (var si = 0; si < SLOTKEYS.length; si++) {
    var sk = SLOTKEYS[si], af = h.affix[sk];
    if (!af || h.gear[sk] < 0) continue;
    var A = AFFIX[af];
    if (A.atk) { if (sk === 'bow') h.rpow += A.atk; else h.atk += A.atk; }
    if (A.def) h.def += A.def;
    if (A.hp) h.max += A.hp;
    if (A.stam) h.stamMax += A.stam;
    if (A.rng && sk === 'bow') h.rng += A.rng;
    if (A.leech) h.leech = A.leech;
    if (A.fire) h.burn = 1;
  }
  h.stamRegen = Math.max(3, Math.round(h.stamMax / 16));     /* a bigger pool refills faster */
  if (h.hp > h.max) h.hp = h.max;
  if (h.stam > h.stamMax) h.stam = h.stamMax;
}
function occupied(x, y) {
  if (hero && hero.x === x && hero.y === y) return true;
  for (var i = 0; i < mobs.length; i++) if (mobs[i].x === x && mobs[i].y === y) return true;
  return false;
}
function islandAt(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? -1 : world.comp[y * W + x]; }
function islandTiles(id) {
  var i;
  for (i = 0; i < world.islands.length; i++) if (world.islands[i].id === id) return world.islands[i].tiles;
  for (i = 0; i < world.islets.length; i++) if (world.islets[i].id === id) return world.islets[i].tiles;
  return world.land;
}
function freeSpot(rnd, from, minD, island) {
  var pool = island === undefined ? world.land : islandTiles(island);
  for (var t = 0; t < 500; t++) {
    var c = pool[rnd() * pool.length | 0], x = c % W, y = (c - x) / W;
    if (occupied(x, y)) continue;
    if (from && Math.abs(x - from.x) + Math.abs(y - from.y) < minD) continue;
    return { x: x, y: y };
  }
  var c2 = pool[0];
  return { x: c2 % W, y: (c2 - c2 % W) / W };
}

/* ---------------- run / floor setup ---------------- */
function newRun(seed) {
  if (seed === undefined || !isFinite(seed)) seed = (Math.random() * 0x7FFFFFFF) | 0;
  var rng = mulberry32(seed);
  var order = BOSSES.slice(), i, j, tmp;
  for (i = order.length - 1; i > 0; i--) { j = rng() * (i + 1) | 0; tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
  var plan = order.slice(0, FLOORS - 2);                      /* three from the land */
  plan.push(SEABOSSES[rng() * SEABOSSES.length | 0]);         /* and one from the water */
  for (i = plan.length - 1; i > 0; i--) { j = rng() * (i + 1) | 0; tmp = plan[i]; plan[i] = plan[j]; plan[j] = tmp; }
  run = { n: (run ? run.n + 1 : 1), seed: seed >>> 0, rng: rng, floor: 1, floorStart: tick, plan: plan };
  hero = newHero();
  say('run ' + run.n + ' \u00b7 seed ' + run.seed.toString(16));
  buildFloor(1);
}

function buildFloor(floor) {
  var w = null, attempt = 0;
  do { w = genWorld((run.rng() * 0x7FFFFFFF) | 0); } while (!w && ++attempt < 30);
  world = w || genWorld(12345);
  sheet = sheetFor(floor);
  applyRecipe(world.mini, FLOORDEF[clamp(floor - 1, 0, FLOORDEF.length - 1)].recipe);
  var rnd = world.rnd;
  mobs = []; items = []; floats = []; shots = []; fx = [];
  world.home = world.islands[0].id;
  var spot = freeSpot(rnd, null, 0, world.home);
  hero.x = spot.x; hero.y = spot.y; hero.px = spot.x; hero.py = spot.y;
  hero.lock = null; hero.lockT = 0; hero.ban = {}; hero.hist = []; hero.lastProgress = tick;
  hero.boat = 0; hero.sailing = 0; hero.swimming = 0; hero.boatHp = 0; hero.chop = null; hero.build = null;
  hero.stam = hero.stamMax; hero.resting = 0; hero.exert = 0;

  /* rank-and-file */
  var pool = [];
  for (var i = 0; i < MTYPES.length; i++) {
    var wgt = clamp(4 - Math.abs(i - clamp((floor - 1) * 1.2, 0, 5)) * 1.5, 0, 4) | 0;
    for (var j = 0; j < wgt + (i === 0 && floor < 3 ? 1 : 0); j++) pool.push(i);
  }
  if (!pool.length) pool.push(1);
  var nmob = 7 + floor * 3 + (floor > 3 ? 4 : 0);
  for (var m = 0; m < nmob; m++)
    spawnMob(MTYPES[pool[rnd() * pool.length | 0]], freeSpot(rnd, hero, floor === 1 ? 15 : 10, world.home), floor);

  /* things in the water */
  var nsea = 5 + floor * 2;
  for (var sm = 0; sm < nsea; sm++)
    spawnMob(SEATYPES[rnd() * SEATYPES.length | 0], seaSpot(rnd, hero, 12), floor);

  /* the little islands: a guard or two, and something worth the crossing */
  for (var il = 0; il < world.islets.length && il < 6; il++) {
    var isl2 = world.islets[il], guards = 1 + (rnd() < 0.5 ? 1 : 0);
    for (var g2 = 0; g2 < guards; g2++)
      spawnMob(ISLETTYPES[rnd() * ISLETTYPES.length | 0], freeSpot(rnd, null, 0, isl2.id), floor, { wake: 0 });
    var ic = freeSpot(rnd, null, 0, isl2.id);
    if (rnd() < 0.32) items.push({ id: nextId++, kind: 'chest', mimic: 1, loot: [], x: ic.x, y: ic.y, bob: rnd() * 6 });
    else items.push({ id: nextId++, kind: 'chest', ornate: rnd() < 0.5 ? 1 : 0, loot: rollLoot(floor, 1, rnd), x: ic.x, y: ic.y, bob: rnd() * 6 });
  }

  /* the floor's boss */
  var B = floor >= FLOORS ? LICH : run.plan[floor - 1];
  /* the boss often holds a different island — that is what the boat is for */
  var away = world.islands.length > 1 && rnd() < 0.65 ? world.islands[1 + (rnd() * (world.islands.length - 1) | 0)].id : world.home;
  var bs = B.sea ? seaSpot(rnd, hero, 30) : freeSpot(rnd, hero, away === world.home ? 42 : 10, away);
  mobs.push(new Mob(B, bs.x, bs.y, floor, 1));

  /* loot: chests, potions, and gear of a tier that tracks the floor */
  for (var c = 0; c < 4 + (floor % 3); c++) {
    var cs = freeSpot(rnd, hero, 5, world.home);
    items.push({ id: nextId++, kind: 'chest', loot: rollLoot(floor, 0, rnd), x: cs.x, y: cs.y, bob: rnd() * 6 });
  }
  for (var p = 0; p < 3 + (floor > 2 ? 1 : 0); p++) { var ps = freeSpot(rnd, hero, 4, world.home); items.push({ id: nextId++, kind: 'potion', x: ps.x, y: ps.y, bob: rnd() * 6 }); }
  for (var dw = 0; dw < 2; dw++) {                            /* driftwood on the sand */
    var ds = freeSpot(rnd, hero, 6, world.home);
    items.push({ id: nextId++, kind: 'wood', n: 2 + (rnd() * 2 | 0), x: ds.x, y: ds.y, bob: rnd() * 6 });
  }
  for (var oi2 = 1; oi2 < world.islands.length; oi2++) {       /* rewards for crossing */
    var os = freeSpot(rnd, null, 0, world.islands[oi2].id);
    items.push({ id: nextId++, kind: 'chest', ornate: 1, loot: rollLoot(floor, 1, rnd), x: os.x, y: os.y, bob: rnd() * 6 });
  }
  for (var qv = 0; qv < 2 + (floor > 2 ? 1 : 0); qv++) {
    var qs = freeSpot(rnd, hero, floor === 1 ? 5 : 6, world.home);
    items.push({ id: nextId++, kind: 'arrows', n: 4 + (rnd() * 6 | 0), x: qs.x, y: qs.y, bob: rnd() * 6 });
  }
  if (rnd() < 0.22 + floor * 0.08) {                          /* rare elemental cache */
    var es = freeSpot(rnd, hero, 8, world.home), ek = ELEKEYS[rnd() * ELEKEYS.length | 0];
    items.push({ id: nextId++, kind: 'ammo', ele: ek, n: 1 + (rnd() < 0.3 ? 1 : 0), x: es.x, y: es.y, bob: rnd() * 6 });
  }
  for (var gi = 0; gi < SLOTKEYS.length; gi++) {
    var slot = SLOTKEYS[gi];
    var tier = clamp((floor - 1) + (rnd() < 0.35 ? 1 : 0) - (rnd() < 0.2 ? 1 : 0), 0, MATS.length - 1);
    var gs = freeSpot(rnd, hero, slot === 'bow' && floor === 1 ? 7 : 6, world.home);
    items.push({ id: nextId++, kind: 'gear', slot: slot, tier: tier, affix: affixFor(slot, rnd, 0.2), x: gs.x, y: gs.y, bob: rnd() * 6 });
  }
  run.floorStart = tick; run.rumor = null;
  say('floor ' + floor + ' — ' + FLOORDEF[clamp(floor - 1, 0, 4)].name);
  cam = { x: hero.x * TILE - VPW / 2, y: hero.y * TILE - VPH / 2 };
}

function seaSpot(rnd, from, minD) {
  var pool = world.shallows;
  for (var t = 0; t < 600; t++) {
    var c = pool[rnd() * pool.length | 0], x = c % W, y = (c - x) / W;
    if (occupied(x, y)) continue;
    if (from && Math.abs(x - from.x) + Math.abs(y - from.y) < minD) continue;
    return { x: x, y: y };
  }
  var c2 = pool[0] || 0;
  return { x: c2 % W, y: (c2 - c2 % W) / W };
}
function spawnMob(T, spot, floor, extra) {
  var m = new Mob(T, spot.x, spot.y, floor, 0);
  if (extra) for (var k in extra) m[k] = extra[k];
  mobs.push(m);
  return m;
}
function theBoss() { for (var i = 0; i < mobs.length; i++) if (mobs[i].boss) return mobs[i]; return null; }
function knownBoss() { var b = theBoss(); return b && knownMob(b) ? b : null; }

/* ---------------- pathfinding ---------------- */
var visit = new Int32Array(W * H), prevB = new Int32Array(W * H), bq = new Int32Array(W * H), st4 = 0;
function landPass(x, y) { return walkable(x, y) && !occupied(x, y); }
function mobCanEnter(m, x, y) {
  if (occupied(x, y)) return false;
  var t = tileAt(x, y);
  if (m.t.sea) return t <= WATER;
  if (m.t.amph || m.t.fly) return !!WALK[t] || t <= WATER;
  return !!WALK[t];
}
function mobPass(m) { return function (x, y) { return mobCanEnter(m, x, y); }; }
function heroPass(x, y) {
  if (occupied(x, y)) return false;
  return walkable(x, y) || ((hero.boat || hero.swimming) && tileAt(x, y) <= WATER);
}
function isShore(x, y) {
  if (!walkable(x, y)) return false;
  for (var d = 0; d < 4; d++) if (tileAt(x + DX[d], y + DY[d]) <= WATER) return true;
  return false;
}
function stepToward(sx, sy, tx, ty, budget, avoid, pass) {
  pass = pass || landPass;
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
      if (ni !== goal && !pass(nx, ny)) continue;
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

/* ---------------- what the hero knows ----------------
   The hero only acts on what it has seen. Terrain is remembered once
   glimpsed; monsters are forgotten a while after they leave sight. */
var SIGHT = 11, SIGHT_SEA = 16, MOB_MEMORY = 45;
function seenAt(x, y) { return world.seen[y * W + x]; }
function visibleAt(x, y) { return parading || world.vis[y * W + x] === tick; }
function blocksSight(x, y) { return tileAt(x, y) === ROCK; }
function markSeen(x, y) {
  var i = y * W + x;
  world.vis[i] = tick;
  if (world.seen[i]) return;
  world.seen[i] = 1; world.seenCount++;
  var g = world.fog.getContext('2d');
  g.fillStyle = MINI[world.tiles[i]]; g.fillRect(x, y, 1, 1);
}
function updateVision() {
  var R = hero.sailing ? SIGHT_SEA : SIGHT, R2 = R * R;
  markSeen(hero.x, hero.y);
  for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R2) continue;
    var tx = hero.x + dx, ty = hero.y + dy;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    /* walk the line; a ridge of rock hides what is behind it */
    var ax = Math.abs(dx), sx = dx > 0 ? 1 : -1, ay = -Math.abs(dy), sy = dy > 0 ? 1 : -1;
    var err = ax + ay, x = hero.x, y = hero.y, guard = 0;
    while (guard++ < R * 2 + 3) {
      if (x !== hero.x || y !== hero.y) {
        markSeen(x, y);
        if (blocksSight(x, y)) break;
      }
      if (x === tx && y === ty) break;
      var e2 = 2 * err;
      if (e2 >= ay) { err += ay; x += sx; }
      if (e2 <= ax) { err += ax; y += sy; }
    }
  }
  for (var i = 0; i < items.length; i++) if (visibleAt(items[i].x, items[i].y)) items[i].known = 1;
  for (var m = 0; m < mobs.length; m++) {
    if (!visibleAt(mobs[m].x, mobs[m].y)) continue;
    mobs[m].seenT = tick; mobs[m].lx = mobs[m].x; mobs[m].ly = mobs[m].y;
  }
}
function knownMob(m) { return parading || (m.seenT !== undefined && tick - m.seenT <= MOB_MEMORY); }
function knownItem(o) { return !!o.known; }
function islandKnown(id) {
  var t = islandTiles(id);
  for (var i = 0; i < t.length; i += 3) if (world.seen[t[i]]) return true;
  return false;
}

/* ---------------- ranged combat ----------------
   One model for every arrow and bolt in the game: trace a line, stop at the
   first wall or body, apply damage there, and draw a tracer along the path. */
function blocksShot(x, y) { var t = tileAt(x, y); return t === TREE || t === ROCK; }
function bodyAt(x, y) {
  if (hero && hero.x === x && hero.y === y) return hero;
  for (var i = 0; i < mobs.length; i++) if (mobs[i].x === x && mobs[i].y === y) return mobs[i];
  return null;
}
function traceShot(x0, y0, x1, y1, range) {
  var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  var err = dx + dy, x = x0, y = y0, px = x0, py = y0, steps = 0;
  while (steps++ < range + 2) {
    var e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
    if (blocksShot(x, y)) return { x: px, y: py, hit: null };
    var b = bodyAt(x, y);
    if (b) return { x: x, y: y, hit: b };
    if (x === x1 && y === y1) return { x: x, y: y, hit: null };
    px = x; py = y;
  }
  return { x: px, y: py, hit: null };
}
function canShoot(from, to, range) {
  var d = dist(from, to);
  if (d < 2 || d > range) return false;
  return traceShot(from.x, from.y, to.x, to.y, range).hit === to;
}
function mobsNear(x, y, r, skip) {
  var out = [];
  for (var i = 0; i < mobs.length; i++) {
    if (mobs[i] === skip) continue;
    if (Math.abs(mobs[i].x - x) + Math.abs(mobs[i].y - y) <= r) out.push(mobs[i]);
  }
  return out;
}
function applyElement(ele, x, y, hit, dmg, byHero) {
  var E = ELEMENTS[ele];
  if (E.fx === 'blast') {
    fx.push({ kind: 'ring', x: x, y: y, t: 0, col: E.col, r: 2.2 });
    var caught = mobsNear(x, y, 2, hit);
    for (var i = 0; i < caught.length; i++) damageMob(caught[i], Math.max(1, Math.round(dmg * 0.7) - caught[i].def), byHero);
    if (hero && Math.abs(hero.x - x) + Math.abs(hero.y - y) <= 2 && !byHero) hurtHero(Math.max(1, Math.round(dmg * 0.7) - hero.def), null);
    shake = Math.max(shake, 7);
    if (byHero && caught.length) say('the blast catches ' + caught.length + ' more');
  } else if (E.fx === 'freeze') {
    if (hit && hit !== hero) { hit.frozen = 3; fl(hit.x, hit.y, 'frozen', E.edge); }
    fx.push({ kind: 'ring', x: x, y: y, t: 0, col: E.col, r: 1.2 });
  } else if (E.fx === 'chain') {
    var near = mobsNear(x, y, 5, hit).slice(0, 2), from = { x: x, y: y };
    for (var c = 0; c < near.length; c++) {
      fx.push({ kind: 'chain', x0: from.x, y0: from.y, x1: near[c].x, y1: near[c].y, t: 0, col: E.edge });
      damageMob(near[c], Math.max(1, Math.round(dmg * 0.6) - near[c].def), byHero);
      from = near[c];
    }
    if (byHero && near.length) say('lightning arcs to ' + near.length);
  }
}
function fireShot(from, to, spec) {
  var r = traceShot(from.x, from.y, to.x, to.y, spec.range);
  shots.push({ x0: from.x, y0: from.y, x1: r.x, y1: r.y, t: 0, kind: spec.kind, col: spec.col });
  if (!r.hit) { if (spec.ele && ELEMENTS[spec.ele].fx === 'blast') applyElement(spec.ele, r.x, r.y, null, spec.dmg, spec.byHero); return null; }
  if (r.hit === hero) hurtHero(Math.max(1, spec.dmg - hero.def), from);
  else damageMob(r.hit, Math.max(1, spec.dmg - r.hit.def), spec.byHero);
  if (spec.ele) applyElement(spec.ele, r.x, r.y, r.hit, spec.dmg, spec.byHero);
  return r.hit;
}

/* ---------------- combat ---------------- */
function progress() { hero.lastProgress = tick; }

function heroAttack(mob) {
  hero.face = mob.x > hero.x ? 1 : mob.x < hero.x ? 3 : mob.y > hero.y ? 2 : 0;
  hero.swing = 1; progress();
  var dmg = Math.max(1, Math.round((hero.atk + (Math.random() * 4 | 0)) * hero.effort()) - mob.def);
  hero.spend(hero.meleeCost());
  var alive = mob.hp > dmg;
  damageMob(mob, dmg, 1);
  if (hero.leech) {
    var heal = Math.min(hero.max - hero.hp, Math.round(dmg * hero.leech));
    if (heal > 0) { hero.hp += heal; fl(hero.x, hero.y, '+' + heal, '#d86a8a'); }
  }
  if (hero.burn && alive) applyElement('fire', mob.x, mob.y, mob, Math.round(dmg * 0.5), 1);
}

function damageMob(mob, dmg, byHero) {
  mob.hp -= dmg; mob.hurt = 1; mob.wake = 1;
  if (byHero) progress();
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
  } else {
    say('slew a ' + mob.name + ' (+' + gold + 'g)');
    if (mob.t.rng && Math.random() < 0.65 && !bodyAt(mob.x, mob.y))
      items.push({ id: nextId++, kind: 'arrows', n: 2 + (Math.random() * 4 | 0), x: mob.x, y: mob.y, bob: Math.random() * 6 });
  }
  while (hero.xp >= hero.next) {
    hero.xp -= hero.next; hero.lvl++; hero.next = Math.round(hero.next * 1.5);
    hero.baseMax += 6; hero.baseAtk += 2; hero.baseStam += HERO_STAM_LVL; if (hero.lvl % 3 === 0) hero.baseDef++;
    recalc(hero); hero.hp = Math.min(hero.max, hero.hp + 14); hero.stam = hero.stamMax;
    say('LEVEL UP → ' + hero.lvl); fl(hero.x, hero.y, 'LVL ' + hero.lvl, '#8ef2a0');
  }
  if (mob.boss) floorCleared();
}

function hurtHero(dmg, src) {
  if (src) hero.lastHitBy = src.boss ? 'BOSS ' + src.name : src.name;
  if (hero.sailing && hero.boat && Math.random() < 0.35) {    /* the hull takes some of it */
    hero.boatHp--;
    fl(hero.x, hero.y, 'hull!', '#d9b487');
    if (hero.boatHp <= 0) {
      hero.boat = 0; hero.swimming = 1; shake = Math.max(shake, 8);
      say('the boat splinters — swimming!'); fl(hero.x, hero.y, 'WRECKED', '#ff6b6b'); stats.wrecks++;
    }
  }
  hero.hp -= dmg; hero.hurt = 1; shake = Math.max(shake, src && src.boss ? 5 : 3); progress();
  fl(hero.x, hero.y, '-' + dmg, '#ff6b6b');
  if (hero.hp <= 0) { hero.hp = 0; heroDied(); }
}
function mobAttack(mob) {
  mob.swing = 1;
  mob.face = hero.x > mob.x ? 1 : hero.x < mob.x ? 3 : hero.y > mob.y ? 2 : 0;
  var dmg = Math.max(1, Math.round((mob.atk + (Math.random() * 3 | 0)) * mob.effort()) - hero.def + (hero.sailing && mob.t.sea ? 3 : 0));
  mob.spend(mob.meleeCost());
  if (mob.ab === 'drain' || mob.ab === 'lich') { mob.hp = Math.min(mob.max, mob.hp + Math.round(dmg * 0.6)); fl(mob.x, mob.y, '+' + Math.round(dmg * 0.6), '#9fd8e6'); }
  hurtHero(dmg, mob);
}
function tryMove(e, dx, dy) {
  var nx = e.x + dx, ny = e.y + dy;
  if (e === hero ? !heroPass(nx, ny) : !mobCanEnter(e, nx, ny)) return false;
  e.x = nx; e.y = ny;
  e.face = dy < 0 ? 0 : dy > 0 ? 2 : dx > 0 ? 1 : 3;
  if (e.exert < 1) e.exert = 1;                               /* a walk is not a rest */
  return true;
}
/* a second step in one turn.  Costs stamina, kicks up dust, never on water. */
function tryRun(e, dx, dy) {
  if (!e.canAfford(STAM.run) || tileAt(e.x, e.y) <= WATER) return false;
  var ox = e.x, oy = e.y;
  if (!tryMove(e, dx, dy)) return false;
  e.spend(STAM.run);
  fx.push({ kind: 'ring', x: ox, y: oy, t: 0, col: 'rgba(225,212,185,.55)', r: 0.45 });
  return true;
}

/* ---------------- loot ---------------- */
function rollGear(floor, rnd, rich) {
  var slot = SLOTKEYS[rnd() * SLOTKEYS.length | 0];
  var tier = clamp((floor - 1) + (rich ? 1 : 0) + (rnd() < 0.3 ? 1 : 0) - (rnd() < 0.25 ? 1 : 0), 0, MATS.length - 1);
  return { slot: slot, tier: tier, affix: affixFor(slot, rnd, rich ? 0.55 : 0.22) };
}
function rollLoot(floor, ornate, rnd) {
  var out = [], rolls = ornate ? 3 + (rnd() < 0.4 ? 1 : 0) : 1 + (rnd() < 0.45 ? 1 : 0);
  for (var i = 0; i < rolls; i++) {
    var r = rnd();
    if (r < 0.26) out.push({ kind: 'gold', n: 18 + (rnd() * 34 | 0) + floor * 9 });
    else if (r < 0.44) out.push({ kind: 'potion', n: 1 });
    else if (r < 0.60) out.push({ kind: 'arrows', n: 5 + (rnd() * 8 | 0) });
    else if (r < 0.68) out.push({ kind: 'wood', n: 2 + (rnd() * 3 | 0) });
    else if (r < 0.90) { var g = rollGear(floor, rnd, ornate); g.kind = 'gear'; out.push(g); }
    else out.push({ kind: 'ammo', ele: ELEKEYS[rnd() * ELEKEYS.length | 0], n: 1 });
  }
  if (ornate && !out.some(function (o) { return o.kind === 'gear'; })) {
    var g2 = rollGear(floor, rnd, 1); g2.kind = 'gear'; out.push(g2);
  }
  return out;
}
/* opening one: take what is better, leave the rest on the ground */
function openChest(it) {
  if (it.mimic) {                                             /* it had teeth */
    var m = spawnMob(MIMIC, { x: it.x, y: it.y }, run.floor, { wake: 1, seenT: tick, lx: it.x, ly: it.y });
    say('the chest was a mimic!'); fl(it.x, it.y, 'MIMIC!', '#ff6b6b');
    shake = Math.max(shake, 6); progress();
    return;
  }
  var got = [];
  for (var i = 0; i < it.loot.length; i++) {
    var L = it.loot[i];
    if (L.kind === 'gold') { hero.gold += L.n; got.push(L.n + 'g'); }
    else if (L.kind === 'potion') { if (hero.potions < 4) { hero.potions++; got.push('potion'); } }
    else if (L.kind === 'arrows') { hero.arrows = Math.min(QUIVER_MAX, hero.arrows + L.n); got.push(L.n + ' arrows'); }
    else if (L.kind === 'wood') { hero.wood += L.n; got.push(L.n + ' wood'); }
    else if (L.kind === 'ammo') { hero.ammo[L.ele] += L.n; got.push(L.ele + ' arrow'); }
    else if (L.kind === 'gear') {
      if (gearScore(L.slot, L.tier, L.affix) > 0) {
        hero.gear[L.slot] = L.tier; hero.affix[L.slot] = L.affix || null; recalc(hero);
        got.push(gearName(L.slot, L.tier, L.affix));
      } else {
        items.push({ id: nextId++, kind: 'gear', slot: L.slot, tier: L.tier, affix: L.affix, x: hero.x, y: hero.y, bob: Math.random() * 6 });
      }
    }
  }
  say((it.ornate ? '★ ornate chest: ' : 'chest: ') + got.join(', ').slice(0, 24));
  fl(hero.x, hero.y, it.ornate ? 'ORNATE!' : 'loot', it.ornate ? '#ffe9a8' : '#ffd166');
  progress();
}

/* ---------------- woodcraft ---------------- */
function nearestTree(maxR) {
  var best = null, bd = 1e9;
  for (var i = 0; i < world.trees.length; i++) {
    var c = world.trees[i], x = c % W, y = (c - x) / W;
    if (tileAt(x, y) !== TREE) continue;
    var d = Math.abs(x - hero.x) + Math.abs(y - hero.y);
    if (d < bd && d <= maxR && islandAt(x + 1, y) === islandAt(hero.x, hero.y) ||
        d < bd && d <= maxR && islandAt(x - 1, y) === islandAt(hero.x, hero.y)) { bd = d; best = { x: x, y: y }; }
  }
  return best;
}
function nearestLand() {
  var best = null, bd = 1e9;
  for (var r = 1; r < 40; r++) {
    for (var a = -r; a <= r; a++) for (var b = -1; b <= 1; b += 2) {
      var cands = [{ x: hero.x + a, y: hero.y + b * r }, { x: hero.x + b * r, y: hero.y + a }];
      for (var ci = 0; ci < 2; ci++) {
        var c = cands[ci];
        if (c.x < 0 || c.y < 0 || c.x >= W || c.y >= H) continue;
        if (!walkable(c.x, c.y) || occupied(c.x, c.y)) continue;
        var d = Math.abs(c.x - hero.x) + Math.abs(c.y - hero.y);
        if (d < bd) { bd = d; best = c; }
      }
    }
    if (best) return best;
  }
  return best;
}
function nearestShore() {
  var best = null, bd = 1e9, isl = islandTiles(islandAt(hero.x, hero.y));
  for (var i = 0; i < isl.length; i++) {
    var c = isl[i], x = c % W, y = (c - x) / W;
    if (!isShore(x, y)) continue;
    var d = Math.abs(x - hero.x) + Math.abs(y - hero.y);
    if (d < bd) { bd = d; best = { x: x, y: y }; }
  }
  return best;
}
function chopTurn(t) {
  if (!hero.chop || hero.chop.x !== t.x || hero.chop.y !== t.y)
    hero.chop = { x: t.x, y: t.y, left: SLOTS.axe.chop[hero.gear.axe] };
  hero.chop.left--; hero.swing = 1; progress(); hero.spend(STAM.chop);
  hero.face = t.x > hero.x ? 1 : t.x < hero.x ? 3 : t.y > hero.y ? 2 : 0;
  fl(t.x, t.y, 'chop', '#d9b487');
  if (hero.chop.left > 0) return;
  world.tiles[t.y * W + t.x] = GRASS;
  var got = 2 + (Math.random() < 0.4 ? 1 : 0);
  hero.wood += got; hero.chop = null;
  fl(t.x, t.y, '+' + got + ' wood', '#d9b487');
  say('fells a tree (+' + got + ' wood)');
}
function buildTurn(spot) {
  if (!hero.build || hero.build.x !== spot.x || hero.build.y !== spot.y)
    hero.build = { x: spot.x, y: spot.y, left: BOAT_TURNS };
  hero.build.left--; progress(); hero.spend(STAM.build);
  fl(hero.x, hero.y, 'build', '#d9b487');
  if (hero.build.left > 0) return;
  hero.wood -= BOAT_WOOD; hero.boat = 1; hero.boatHp = 3; hero.build = null;
  say('launches a boat'); fl(hero.x, hero.y, 'BOAT', '#9fd8e6'); stats.boats++;
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
    if (o.kind ? !knownItem(o) : !knownMob(o)) continue;      /* out of sight, out of mind */
    var d = dist(hero, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { o: best, d: bd } : null;
}
function gearScore(slot, tier, affix) {
  var have = hero.gear[slot] < 0 ? -10 : hero.gear[slot] * 10 + affixWorth(hero.affix[slot]);
  return (tier * 10 + affixWorth(affix)) - have;
}
function readyForBoss(boss) {
  if (!boss || hero.hp < hero.max * 0.7) return false;
  if (!boss.wake && hero.stamFrac() < 0.5) return false;      /* don't start a fight out of breath */
  var mine = Math.max(1, hero.atk + 1.5 - boss.def);
  var theirs = Math.max(1, boss.atk + 1 - hero.def) * (boss.ab === 'ranged' || boss.ab === 'lich' ? 1.25 : 1);
  var turnsToKill = boss.hp / mine;
  var turnsToLive = (hero.hp + hero.potions * hero.max * 0.5) / theirs;
  var slog = tick - run.floorStart > 700 ? 1.0 : 1.25;        /* patience runs out */
  return turnsToLive > turnsToKill * slog;
}
function nextToWater(x, y) {
  for (var d = 0; d < 4; d++) if (tileAt(x + DX[d], y + DY[d]) <= WATER) return true;
  return false;
}
/* a thing that only swims cannot touch a hero standing inland */
function mobThreatens(m) {
  if (!m.t.sea) return true;
  if (hero.sailing || hero.swimming) return true;
  if (m.t.rng) return true;                                   /* but it can still shoot */
  return nextToWater(hero.x, hero.y);
}
function threatNear(range) {
  for (var i = 0; i < mobs.length; i++)
    if (knownMob(mobs[i]) && mobThreatens(mobs[i]) && dist(hero, mobs[i]) <= range) return mobs[i];
  return null;
}
/* pick the reachable spot that puts the most ground between us and the threat */
/* the edge of the map the hero has drawn for itself */
function frontierSpot(wantSea) {
  var C = world.fcache || (world.fcache = {});
  var key = wantSea ? 'sea' : 'land';
  if (C[key] && tick - C[key].t < 6) return C[key].spot;
  var spot = frontierScan(wantSea);
  C[key] = { t: tick, spot: spot };
  return spot;
}
function frontierScan(wantSea) {
  var best = null, bd = 1e9, bx = hero.x, by = hero.y;
  for (var y = 1; y < H - 1; y++) for (var x = 1; x < W - 1; x++) {
    var i = y * W + x;
    if (!world.seen[i]) continue;
    if (!(walkable(x, y) || (hero.boat && world.tiles[i] <= WATER))) continue;
    if (!hero.boat && world.tiles[i] <= WATER) continue;
    if (!hero.boat && walkable(x, y) && islandAt(x, y) !== islandAt(hero.x, hero.y)) continue;
    var edge = 0;
    for (var d = 0; d < 4; d++) {
      var nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (!world.seen[ny * W + nx]) { edge = 1; break; }
    }
    if (!edge) continue;
    if (wantSea && islandAt(x, y) === islandAt(hero.x, hero.y) && world.tiles[i] > WATER) continue;
    var dd = Math.abs(x - bx) + Math.abs(y - by);
    if (dd < 4) continue;                                     /* not the tile we're stood on */
    if (dd < bd) { bd = dd; best = { x: x, y: y }; }
  }
  return best;
}
function safeSpot(minD) {
  var b = knownBoss(), ready = b && readyForBoss(b);
  for (var i = 0; i < 24; i++) {
    var c = freeSpot(Math.random, hero, minD, islandAt(hero.x, hero.y));
    if (!b || ready || Math.abs(c.x - b.x) + Math.abs(c.y - b.y) > 14) return c;
  }
  return freeSpot(Math.random, hero, minD);
}
function fleeSpot(from) {
  if (from.t && from.t.sea && !hero.sailing && !hero.swimming) {
    /* just get away from the water's edge */
    for (var r = 3; r <= 8; r++) {
      for (var a = -r; a <= r; a++) for (var b = -1; b <= 1; b += 2) {
        var cs = [{ x: hero.x + a, y: hero.y + b * r }, { x: hero.x + b * r, y: hero.y + a }];
        for (var ci = 0; ci < 2; ci++) {
          var c2 = cs[ci];
          if (c2.x < 1 || c2.y < 1 || c2.x >= W - 1 || c2.y >= H - 1) continue;
          if (!walkable(c2.x, c2.y) || occupied(c2.x, c2.y)) continue;
          if (nextToWater(c2.x, c2.y)) continue;
          if (islandAt(c2.x, c2.y) !== islandAt(hero.x, hero.y)) continue;
          return c2;
        }
      }
    }
  }
  var best = null, bd = -1;
  for (var i = 0; i < 6; i++) {
    var c = safeSpot(12), d = Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}

/* anything worth crossing water for */
function offIsland(o) {
  var oi = islandAt(o.x, o.y);
  return oi >= 0 && oi !== islandAt(hero.x, hero.y);
}
function unexploredHere() { return !!frontierSpot(0); }
function boatPlan() {
  if (hero.boat) return null;
  var pull = run.rumor && islandAt(run.rumor.x, run.rumor.y) !== islandAt(hero.x, hero.y);
  if (!pull && unexploredHere()) return null;                 /* no reason to sail yet */
  if (hero.gear.axe < 0) {
    var axe = nearestOf(items, function (o) { return o.kind === 'gear' && o.slot === 'axe'; });
    if (axe) return { kind: 'item', o: axe.o, why: 'seeking an axe' };
    var drift = nearestOf(items, function (o) { return o.kind === 'wood'; });
    if (drift) return { kind: 'item', o: drift.o, why: 'gathering driftwood' };
    return null;
  }
  if (hero.wood < BOAT_WOOD) {
    var t = nearestTree(40);
    if (t) return { kind: 'tree', o: t, why: 'felling trees ' + hero.wood + '/' + BOAT_WOOD };
    return null;
  }
  var sh = nearestShore();
  if (sh) return { kind: 'shore', o: sh, why: 'building a boat' };
  return null;
}

function chooseTarget() {
  /* interrupts, in order */
  for (var i = 0; i < mobs.length; i++) if (dist(hero, mobs[i]) <= 1) return { kind: 'mob', o: mobs[i], why: 'fighting ' + (mobs[i].sname || mobs[i].name) };
  if (hero.swimming) {
    var land = nearestLand();
    if (land) return { kind: 'spot', o: land, why: 'swimming for shore' };
  }
  if (hero.hp < hero.max * 0.45 && hero.potions > 0) return { kind: 'quaff' };
  /* out of breath and nothing close: stand still until it comes back */
  if (!hero.swimming) {
    if (hero.resting) {
      if (hero.stamFrac() < 0.7 && !threatNear(7)) return { kind: 'rest', why: 'catching breath' };
      hero.resting = 0;
    } else if (hero.stamFrac() < 0.2 && !threatNear(7)) {
      hero.resting = 1; return { kind: 'rest', why: 'catching breath' };
    }
  }
  var bss = knownBoss();
  if (bss && bss.wake && dist(hero, bss) <= 7 && !readyForBoss(bss) && mobThreatens(bss)) {
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

  /* curiosity: with nothing pressing, sometimes go and look at the dark */
  if (hero.hp > hero.max * 0.7 && Math.random() < 0.10 && !threatNear(9)) {
    var peek = frontierSpot(0);
    if (peek && dist(hero, peek) < 45) {
      hero.lock = { kind: 'spot', o: peek, why: 'having a look around' };
      hero.lockT = 30; return hero.lock;
    }
  }

  var lk = null;
  var boss = knownBoss();                                     /* can't hunt what we haven't found */
  var keepAway = boss && !readyForBoss(boss) ? boss : null;
  var reach = function (o) {
    if (hero.boat) return true;
    if (tileAt(o.x, o.y) <= WATER) {                          /* wade in from the beach? */
      for (var d = 0; d < 4; d++) {
        var nx = o.x + DX[d], ny = o.y + DY[d];
        if (walkable(nx, ny) && islandAt(nx, ny) === islandAt(hero.x, hero.y)) return true;
      }
      return false;
    }
    return !offIsland(o);
  };
  var far0 = function (o) { return !keepAway || dist(keepAway, o) > 8; };
  var far = function (o) { return far0(o) && reach(o); };
  var potion = nearestOf(items, function (o) { return o.kind === 'potion' && hero.potions < 4 && far(o); });
  var gear = nearestOf(items, function (o) { return o.kind === 'gear' && gearScore(o.slot, o.tier, o.affix) > 0 && far(o); });
  var quiver = nearestOf(items, function (o) { return o.kind === 'arrows' && hero.arrows < QUIVER_MAX && far(o); });
  var rare = nearestOf(items, function (o) { return o.kind === 'ammo'; });
  var mob = nearestOf(mobs, function (o) { return !o.boss && far(o); });
  var chest = nearestOf(items, function (o) { return o.kind === 'chest' && far(o); });

  if (hero.hp < hero.max * 0.5 && potion && potion.d < 30) lk = { kind: 'item', o: potion.o, why: 'wounded — potion' };
  else if (gear && gear.d < 26) lk = { kind: 'item', o: gear.o, why: 'claiming ' + gearName(gear.o.slot, gear.o.tier, gear.o.affix) };
  else if (rare && rare.d < 34) lk = { kind: 'item', o: rare.o, why: 'after a ' + rare.o.ele + ' arrow' };
  else if (quiver && quiver.d < 22 && hero.gear.bow >= 0 && hero.arrows < 8) lk = { kind: 'item', o: quiver.o, why: 'restocking arrows' };
  else if (boss && !reach(boss) && readyForBoss(boss) && boatPlan()) lk = boatPlan();
  else if (boss && !banned(boss.id) && readyForBoss(boss)) lk = { kind: 'mob', o: boss, why: 'closing on ' + (boss.sname || boss.n) };
  else if (mob && mob.d <= 18) lk = { kind: 'mob', o: mob.o, why: 'hunting a ' + mob.o.name };
  else if (chest) lk = { kind: 'item', o: chest.o, why: 'looting a chest' };
  else if (potion) lk = { kind: 'item', o: potion.o, why: 'fetching a potion' };
  else if (mob) lk = { kind: 'mob', o: mob.o, why: 'tracking a ' + mob.o.name };
  else if (boss && !banned(boss.id) && reach(boss)) lk = { kind: 'mob', o: boss, why: 'seeking ' + (boss.sname || boss.n) };
  else {
    var rumorHere = run.rumor && (hero.boat || islandAt(run.rumor.x, run.rumor.y) === islandAt(hero.x, hero.y));
    if (run.rumor && !knownBoss() && rumorHere && Math.random() < 0.8) {
      lk = { kind: 'spot', o: run.rumor, why: 'chasing the roar' };
      if (dist(hero, run.rumor) <= 3) run.rumor = null;       /* nothing here — keep looking */
    }
    if (!lk && run.rumor && !rumorHere) lk = boatPlan();      /* it came from over there */
    if (!lk) {
      var fr = frontierSpot(0);
      if (fr) lk = { kind: 'spot', o: fr, why: 'exploring' };
    }
    if (!lk) lk = boatPlan();                                 /* land's end — put to sea */
    if (!lk) {
      var sea = frontierSpot(1);
      lk = sea ? { kind: 'spot', o: sea, why: 'sailing onward' } : { kind: 'spot', o: safeSpot(14), why: 'wandering' };
    }
  }

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

function pickAmmo(target) {
  var cluster = mobsNear(target.x, target.y, 2, null).length;
  if (hero.ammo.fire > 0 && (target.boss || cluster >= 3)) return 'fire';
  if (hero.ammo.shock > 0 && (target.boss || cluster >= 2)) return 'shock';
  if (hero.ammo.frost > 0 && (target.boss || hero.hp < hero.max * 0.5)) return 'frost';
  return null;
}
function heroShot(target) {
  if (hero.gear.bow < 0 || hero.swimming) return false;       /* both hands are busy */
  if (!hero.canAfford(STAM.bow)) return false;                /* can't draw the string */
  var ele = pickAmmo(target);
  if (!ele && hero.arrows <= 0) return false;
  if (!ele && !target.boss && hero.arrows <= 2) return false;  /* save the last few */
  if (!canShoot(hero, target, hero.rng)) return false;
  if (ele) { hero.ammo[ele]--; stats.specials++; say('looses a ' + ele + ' arrow'); }
  else hero.arrows--;
  hero.shoot = 1; stats.shots++; progress(); hero.spend(STAM.bow);
  hero.face = Math.abs(target.x - hero.x) > Math.abs(target.y - hero.y)
    ? (target.x > hero.x ? 1 : 3) : (target.y > hero.y ? 2 : 0);
  if (!ele && hero.burn && Math.random() < 0.35) ele = 'fire';  /* a burning bow catches now and then */
  var M = BOWMATS[hero.gear.bow], E = ele ? ELEMENTS[ele] : null;
  fireShot(hero, target, {
    range: hero.rng, dmg: Math.round((hero.rpow + 2 + (Math.random() * 4 | 0)) * hero.effort() * (ele ? 1.5 : 1)),
    kind: ele || 'arrow', col: E ? E.edge : M.edge, ele: ele, byHero: 1 });
  return true;
}

/* when is a second step worth the wind? */
function wantsRun(tg) {
  if (hero.swimming || hero.boat && tileAt(hero.x, hero.y) <= WATER) return false;
  if (!tg.o || dist(hero, tg.o) <= 1 || !hero.canAfford(STAM.run)) return false;
  var f = hero.stamFrac(), why = tg.why || '';
  if (/^(fleeing|retreating)/.test(why)) return true;         /* run for your life */
  if (/potion/.test(why) && hero.hp < hero.max * 0.5) return f > 0.3;
  if (tg.kind === 'mob') return f > 0.5;                      /* close the gap while fresh */
  return f > 0.75;                                            /* otherwise only when rested */
}

function heroTurn() {
  updateVision();
  hero.ran = 0;
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

  if (hero.swimming) {
    if (tileAt(hero.x, hero.y) > WATER) { hero.swimming = 0; say('drags itself ashore'); }
    else {                                                    /* every stroke costs; spent, it drowns */
      hero.spend(STAM.swim);
      if (hero.stam === 0 && tick % 2 === 0) hurtHero(1, null);
    }
  }
  if (!hero.swimming && hero.hp < hero.max && tick % 6 === 0 && !threatNear(8)) hero.hp++;   /* breather */

  var tg = chooseTarget();
  hero.intent = tg.why || hero.intent;

  if (tg.kind === 'quaff') {
    hero.potions--; var heal = Math.min(hero.max - hero.hp, Math.round(hero.max * 0.5));
    hero.hp += heal; fl(hero.x, hero.y, '+' + heal, '#8ef2a0'); say('quaffs a potion (+' + heal + ')');
    hero.stam = Math.min(hero.stamMax, hero.stam + Math.round(hero.stamMax * 0.4));
    hero.intent = 'drinking a potion'; progress(); return;
  }
  if (tg.kind === 'rest') {                                   /* exert stays 0: full second wind */
    hero.hist.length = 0; hero.lastProgress = tick;           /* standing still on purpose isn't dithering */
    return;
  }
  if (tg.kind === 'tree') {
    if (dist(hero, tg.o) <= 1) { chopTurn(tg.o); return; }
  }
  if (tg.kind === 'shore') {
    if (hero.x === tg.o.x && hero.y === tg.o.y) { buildTurn(tg.o); return; }
  }
  if (tg.kind === 'mob') {
    if (dist(hero, tg.o) <= 1) { heroAttack(tg.o); return; }
    if (heroShot(tg.o)) { hero.intent = 'loosing at ' + (tg.o.sname || tg.o.name); return; }
  }
  var bs2 = knownBoss(), avoid = null;
  if (bs2 && !readyForBoss(bs2) && !(tg.kind === 'mob' && tg.o === bs2)) avoid = { x: bs2.x, y: bs2.y, r: 9 };
  var st = stepToward(hero.x, hero.y, tg.o.x, tg.o.y, 26000, avoid, heroPass);
  if (!st && avoid && tg.kind !== 'spot') { if (tg.o.id) hero.ban[tg.o.id] = tick + 50; hero.lock = null; hero.lockT = 0; return; }
  if (!st) {
    if (tg.o.id) hero.ban[tg.o.id] = tick + 60;
    hero.lock = null; hero.lockT = 0; return;
  }
  if (tg.kind === 'mob' && tg.o.x === hero.x + st.x && tg.o.y === hero.y + st.y) { heroAttack(tg.o); return; }
  if (tg.kind === 'tree' && tg.o.x === hero.x + st.x && tg.o.y === hero.y + st.y) { chopTurn(tg.o); return; }
  if (!tryMove(hero, st.x, st.y)) { hero.lockT = Math.min(hero.lockT, 3); return; }
  hero.sailing = (hero.boat || hero.swimming) && tileAt(hero.x, hero.y) <= WATER ? 1 : 0;
  if (pickUp()) return;                                       /* stopped for something on the ground */
  if (wantsRun(tg)) {
    var st2 = stepToward(hero.x, hero.y, tg.o.x, tg.o.y, 26000, avoid, heroPass);
    if (st2 && !(tg.kind === 'mob' && tg.o.x === hero.x + st2.x && tg.o.y === hero.y + st2.y) && tryRun(hero, st2.x, st2.y)) {
      hero.ran = 1;
      hero.sailing = (hero.boat || hero.swimming) && tileAt(hero.x, hero.y) <= WATER ? 1 : 0;
      pickUp();
    }
  }
}

/* whatever is underfoot: take it, or note that it isn't worth stooping for */
function pickUp() {
  var took = 0;
  for (var i = items.length - 1; i >= 0; i--) {
    var it = items[i];
    if (it.x !== hero.x || it.y !== hero.y) continue;
    if (it.kind === 'potion') {
      if (hero.potions >= 4) { hero.ban[it.id] = tick + 250; continue; }
      items.splice(i, 1); hero.potions++; fl(hero.x, hero.y, 'potion', '#8ef2a0'); say('pockets a potion'); progress(); took = 1;
    } else if (it.kind === 'chest') {
      items.splice(i, 1);
      openChest(it); took = 1;
    } else if (it.kind === 'arrows') {
      if (hero.arrows >= QUIVER_MAX) { hero.ban[it.id] = tick + 250; continue; }
      items.splice(i, 1);
      var got = Math.min(it.n, QUIVER_MAX - hero.arrows); hero.arrows += got;
      fl(hero.x, hero.y, '+' + got + ' arrows', '#e8d9a8'); say('gathers ' + got + ' arrows'); progress(); took = 1;
    } else if (it.kind === 'wood') {
      items.splice(i, 1); hero.wood += it.n;
      fl(hero.x, hero.y, '+' + it.n + ' wood', '#d9b487'); say('gathers driftwood (+' + it.n + ')'); progress(); took = 1;
    } else if (it.kind === 'ammo') {
      items.splice(i, 1); hero.ammo[it.ele] += it.n;
      fl(hero.x, hero.y, it.ele + ' arrow!', ELEMENTS[it.ele].edge);
      say('★ finds ' + it.n + ' ' + it.ele + ' arrow' + (it.n > 1 ? 's' : '')); progress(); took = 1;
    } else if (it.kind === 'gear') {
      if (gearScore(it.slot, it.tier, it.affix) <= 0) { hero.ban[it.id] = tick + 400; continue; }
      items.splice(i, 1);
      hero.gear[it.slot] = it.tier; hero.affix[it.slot] = it.affix || null; recalc(hero);
      var nm = gearName(it.slot, it.tier, it.affix);
      fl(hero.x, hero.y, nm, MATS[it.tier].edge); say('equips ' + nm); progress(); took = 1;
    }
  }
  return took;
}

/* ---------------- monsters ---------------- */
function spawnMinion(near) {
  if (mobs.length > 24) return;
  var wet = !!near.t.sea;
  for (var t = 0; t < 14; t++) {
    var x = near.x + (Math.random() * 7 | 0) - 3, y = near.y + (Math.random() * 7 | 0) - 3;
    if (x < 0 || y < 0 || x >= W || y >= H || occupied(x, y)) continue;
    if (wet ? tileAt(x, y) > WATER : !walkable(x, y)) continue;
    var T = wet ? SEATYPES[Math.random() * SEATYPES.length | 0] : MTYPES[clamp(1 + (Math.random() * 2 | 0), 0, 3)];
    spawnMob(T, { x: x, y: y }, run.floor, { wake: 1, seenT: visibleAt(x, y) ? tick : undefined, lx: x, ly: y });
    fl(x, y, wet ? 'surfaces' : 'risen', wet ? '#9fe6ff' : '#c6a3ff');
    return;
  }
}
function spawnWanderer() {
  var rnd = Math.random, spot = freeSpot(rnd, hero, 18, islandAt(hero.x, hero.y)), floor = run.floor;
  var pool = [0, 1, 2, 3, 4, 5], T = MTYPES[pool[clamp((rnd() * 4 | 0) + (floor > 2 ? 2 : 0), 0, 5)]];
  var m = spawnMob(T, spot, floor);                           /* stragglers come a little softer */
  m.hp = m.max = Math.round(T.hp * (1 + 0.45 * (floor - 1)));
  m.atk = T.atk + (floor - 1) * 2;
}

function mobTurn(m) {
  var d = dist(m, hero);
  if (d <= (m.t.aggro || 8)) m.wake = 1;
  if (!m.wake) { if (!m.boss && Math.random() < 0.25) tryMove(m, DX[Math.random() * 4 | 0], DY[Math.random() * 4 | 0]); return; }

  if (m.boss) {
    m.cd = (m.cd || 0) + 1;
    if ((m.ab === 'ranged' || m.ab === 'lich') && m.cd % (m.ab === 'lich' ? 2 : 3) === 0 && m.canAfford(STAM.bolt) && canShoot(m, hero, 10)) {
      m.swing = 1; m.spend(STAM.bolt);
      fireShot(m, hero, { range: 10, dmg: Math.round((m.atk * 0.9 + (Math.random() * 4 | 0)) * m.effort()),
        kind: 'bolt', col: m.ab === 'lich' ? '#a9f0ff' : '#ff9d4d' });
      return;
    }
    if ((m.ab === 'summon' || m.ab === 'lich') && m.cd % (m.ab === 'lich' ? 12 : 16) === 0 && m.canAfford(STAM.summon)) {
      m.spend(STAM.summon); spawnMinion(m); if (m.ab === 'summon') return;
    }
    if (m.ab === 'lich' && m.cd % 11 === 0 && m.hp < m.max) {
      m.hp = Math.min(m.max, m.hp + Math.round(m.max * 0.03)); fl(m.x, m.y, 'unlife', '#cfe6ff');
    }
    if (m.ab === 'charge' && d >= 2 && d <= 6 && m.cd % 4 === 0 && m.canAfford(STAM.charge)) {
      m.spend(STAM.charge);
      for (var s = 0; s < 3; s++) {
        var stc = stepToward(m.x, m.y, hero.x, hero.y, 700, null, mobPass(m));
        if (!stc || !tryMove(m, stc.x, stc.y)) break;
      }
      if (dist(m, hero) <= 1) mobAttack(m);
      return;
    }
  }
  if (d <= 1) { mobAttack(m); return; }
  if (m.t.rng && m.canAfford(STAM.bow) && canShoot(m, hero, m.t.rng)) {   /* a winded archer closes in instead */
    m.swing = 1; m.spend(STAM.bow);
    m.face = Math.abs(hero.x - m.x) > Math.abs(hero.y - m.y) ? (hero.x > m.x ? 1 : 3) : (hero.y > m.y ? 2 : 0);
    fireShot(m, hero, { range: m.t.rng, dmg: Math.round((m.atk * 0.8 + (Math.random() * 3 | 0)) * m.effort()), kind: 'arrow', col: m.t.shot });
    return;
  }
  if (d > (m.t.aggro || 8) + (m.boss ? 13 : 7)) { m.wake = 0; return; }
  var pass = mobPass(m);
  var st = stepToward(m.x, m.y, hero.x, hero.y, m.boss ? 3000 : 900, null, pass);
  if (st) {
    tryMove(m, st.x, st.y);
    if (!m.t.rng && d >= 3 && m.canAfford(STAM.run) && Math.random() < (m.boss ? 0.5 : 0.7)) {   /* run the archer down */
      var st2 = stepToward(m.x, m.y, hero.x, hero.y, m.boss ? 3000 : 900, null, pass);
      if (st2) tryRun(m, st2.x, st2.y);
    }
  }
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
  if (phase.name === 'play' && tick % 130 === 0) {
    var bz = theBoss();
    if (bz && !knownMob(bz)) {                                /* a rumour, not a map pin */
      var jitter = 6;
      run.rumor = { x: clamp(bz.x + (Math.random() * jitter * 2 | 0) - jitter, 1, W - 2),
                    y: clamp(bz.y + (Math.random() * jitter * 2 | 0) - jitter, 1, H - 2) };
      say('a distant roar rolls across the water');
    }
  }
  if (parading) return;
  if (phase.name !== 'play') {
    phase.t += TURN_MS;
    if (phase.t < phase.dur) return;
    if (phase.name === 'cleared') {
      run.floor++;
      hero.hp = Math.min(hero.max, hero.hp + Math.round(hero.max * 0.45));
      hero.stam = hero.stamMax;
      hero.potions = Math.min(4, hero.potions + 1);
      buildFloor(run.floor); setPhase('play', 0);
    } else if (phase.name === 'died' || phase.name === 'victory') {
      setPhase('title', 3200);
    } else if (phase.name === 'title') {
      newRun(); setPhase('play', 0);
    }
    return;
  }
  heroTurn();
  hero.breathe();
  if (phase.name !== 'play') return;
  for (var i = mobs.length - 1; i >= 0; i--) {
    var m = mobs[i];
    if (m.hp <= 0) continue;
    if (m.frozen > 0) { m.frozen--; fl(m.x, m.y, '*', '#8fdcff'); continue; }
    if (tick % m.ev === 0) { mobTurn(m); m.breathe(); }
    if (phase.name !== 'play') return;
  }
  if (tick % 210 === 0) {
    var rank = 0;
    for (var w = 0; w < mobs.length; w++) if (!mobs[w].boss) rank++;
    if (rank < (run.floor === 1 ? 3 : 4)) { spawnWanderer(); if (Math.random() < 0.3) spawnWanderer(); }
  }
  if (tick - hero.lastProgress > 1400) { say('the trail goes cold'); stats.unstuck++; buildFloor(run.floor); }
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
  var sail = hero.sailing && tileAt(hero.x, hero.y) <= WATER;
  var y = sy + Math.sin(performance.now() / 260) * 0.8 + (sail ? Math.sin(performance.now() / 400) * 1.2 - 3 : 0);
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(sx + 12, sy + 21, 8, 3.5, 0, 0, 6.2832); ctx.fill();
  if (sail) {
    var by = sy + 16 + Math.sin(performance.now() / 400) * 1.2;
    ctx.fillStyle = 'rgba(255,255,255,.30)';
    ctx.beginPath(); ctx.ellipse(sx + 12, by + 5, 13, 3.5, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#6b4a2a';
    ctx.beginPath(); ctx.moveTo(sx - 1, by); ctx.lineTo(sx + 25, by);
    ctx.lineTo(sx + 20, by + 7); ctx.lineTo(sx + 4, by + 7); ctx.fill();
    rect(ctx, sx - 1, by, 26, 2, '#9c7440');
  }
  var arm = hero.gear.armor, tunic = hero.hurt > 0 ? '#ff9d9d' : (arm >= 0 ? MATS[arm].col : '#3a6fd8');
  rect(ctx, sx + 7, y + 10, 10, 9, tunic);
  if (arm >= 0) { rect(ctx, sx + 7, y + 10, 10, 2, MATS[arm].edge); rect(ctx, sx + 11, y + 12, 2, 6, MATS[arm].edge); }
  if (!sail) { rect(ctx, sx + 7, y + 19, 3, 3, '#2b2b38'); rect(ctx, sx + 14, y + 19, 3, 3, '#2b2b38'); }
  rect(ctx, sx + 7, y + 3, 10, 8, '#f0c39a');
  rect(ctx, sx + 6, y + 2, 12, 3, '#6a3f22');
  if (hero.face === 2) { rect(ctx, sx + 9, y + 7, 2, 2, '#22222c'); rect(ctx, sx + 13, y + 7, 2, 2, '#22222c'); }
  else if (hero.face === 1) rect(ctx, sx + 13, y + 7, 2, 2, '#22222c');
  else if (hero.face === 3) rect(ctx, sx + 9, y + 7, 2, 2, '#22222c');
  var sh = hero.gear.shield;
  if (sh >= 0) { rect(ctx, sx + (hero.face === 3 ? 3 : 17), y + 11, 4, 7, MATS[sh].col); rect(ctx, sx + (hero.face === 3 ? 3 : 17), y + 11, 4, 2, MATS[sh].edge); }
  var bw = hero.gear.bow;
  if (bw >= 0) {
    var BM = BOWMATS[bw], side = hero.face === 3 ? -1 : 1, bx = sx + 12 + side * 9;
    ctx.strokeStyle = hero.shoot > 0 ? BM.edge : BM.col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, y + 13, 7, side > 0 ? -1.1 : 2.0, side > 0 ? 1.1 : 4.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,240,225,.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx + side * (hero.shoot > 0 ? -2 : 0), y + 7);
    ctx.lineTo(bx - side * (hero.shoot > 0 ? 4 : 0), y + 19); ctx.stroke();
    if (hero.shoot > 0) rect(ctx, sx + 12 + side * 2, y + 12, side * 8, 1, '#efe6c8');
  }
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

/* ---------------- boss art ----------------
   Every boss is a small pixel bitmap, drawn at two screen pixels per cell and
   cached to an offscreen canvas per frame.  Letters map to a palette built from
   the boss's two colours:  # outline  a base  b shade  d deep shade  c light
   e eyes  w bone/teeth  k black  m red mouth  x accent  y second accent  . clear
   Two frames each; the renderer flips between them for an idle. */
var BOSSART = {
  dragon: { eye: '#ffe066', x: '#f2a33a', hover: 1, frames: [[
    '..............#....#............',
    '.............#b#..#b#...........',
    '.............#b#..#b#...........',
    '..#...........#aaaa#.........#..',
    '.##..........#aaaaaa#.......##..',
    '.#b#.........#aeaaea#......#b#..',
    '.#bb#........#akaaaka#.....#bb#.',
    '#bbbb#.......#aaaaaaa#....#bbbb#',
    '#bbbbb#......#awwaaww#...#bbbbb#',
    '#bbbbbb#....#caaaaaaac#.#bbbbbb#',
    '#bbbdbbb#...#ccaaaaacc#.#bbbdbbb#',
    '#bbdbdbbb#.#acccccccca#bbbbdbbb#',
    '#bdbbdbbbb##aaccccccaa##bbdbbbb#',
    '.#bdbbdbbbaaaacccccaaaabbbbdbb#.',
    '.#bbdbdbbbaaaaccccccaaabbdbbbb#.',
    '..#bbdbbb#aaaaaccccaaaa#bbbbbb#.',
    '..#bbbbb#.#aaaaccccaaa#.#bbbbb#.',
    '...#bbb#..#aaaaaccaaaa#..#bbb#..',
    '....#b#...#aaaaaaaaaaa#...#b#...',
    '.....#....#aa#aaaaaa#aa#...#....',
    '..........#aa#.#aa#.#aa#........',
    '.........#aa#..#aa#..#aa#.......',
    '.........#ww#..#aa#..#ww#.......',
    '.........####..#aa#..####..#....',
    '...............#aa#.......#ba#..',
    '................#aaa#....#baa#..',
    '.................#aaaa###aaa#...',
    '..................#aaaaaaaa#....',
    '...................########.....'
  ], [
    '..............#....#............',
    '.............#b#..#b#...........',
    '.............#b#..#b#...........',
    '..............#aaaa#............',
    '#............#aaaaaa#..........#',
    '##...........#aeaaea#.........##',
    '#b#..........#akaaaka#.......#b#',
    '#bb#.........#aaaaaaa#......#bb#',
    '#bbb#........#awwaaww#.....#bbb#',
    '#bbbb#......#caaaaaaac#...#bbbb#',
    '#bbdbb#.....#ccaaaaacc#..#bbdbb#',
    '#bbdbbb#...#acccccccca#.#bbbdbb#',
    '#bdbbdbb#..#aaccccccaa#.#bbdbbb#',
    '.#bdbbdbb#.aaaacccccaaa#bbdbbb#.',
    '.#bbdbdbbb#aaaaccccccaa#bdbbbb#.',
    '..#bbdbbbbaaaaaccccaaaabbbbbb#..',
    '..#bbbbbbbaaaaaccccaaaabbbbb#...',
    '...#bbbbbbaaaaaaccaaaaabbbb#....',
    '....#bbbb#aaaaaaaaaaaa#bbb#.....',
    '.....####.#aa#aaaaaa#aa###......',
    '..........#aa#.#aa#.#aa#........',
    '.........#aa#..#aa#..#aa#.......',
    '.........#ww#..#aa#..#ww#.......',
    '.........####..#aa#..####..#....',
    '...............#aa#.......#ba#..',
    '................#aaa#....#baa#..',
    '.................#aaaa###aaa#...',
    '..................#aaaaaaaa#....',
    '...................########.....'
  ]] },

  arachnid: { eye: '#ff5c5c', x: '#e8d9a8', frames: [[
    '............................',
    '....#.....#.......#.....#...',
    '...#b#...#b#.....#b#...#b#..',
    '...#b#...#b#.....#b#...#b#..',
    '..#b#...#b#..###..#b#...#b#.',
    '..#b#...#b##aaaaa##b#...#b#.',
    '.#b#...#b#aaeaaaeaa#b#...#b#',
    '.#b#...#b#aaeaaaeaa#b#...#b#',
    '.#b#..#b#.#aakkkaa#.#b#..#b#',
    '#b#..#b#..#awa#awa#..#b#..#b#',
    '#b#..#b#.#acccccccca#.#b#..#b#',
    '#b#.#b#.#accccccccccca#.#b#.#b#',
    '#b#.#b#.#aacxxxxxxxcaa#.#b#.#b#',
    '#b##b#..#aaacxxxxxcaaa#..#b##b#',
    '.#bb#...#aaaacxxxcaaaa#...#bb#.',
    '.#b#....#aaaaacxcaaaaa#....#b#.',
    '.##.....#baaaaacaaaaab#.....##.',
    '.........#baaaaaaaaab#..........',
    '..........#bbaaaaabb#...........',
    '...........#bbbbbbb#............',
    '............#######.............'
  ], [
    '............................',
    '..#.....#...........#.....#.',
    '.#b#...#b#.........#b#...#b#',
    '.#b#...#b#.........#b#...#b#',
    '.#b#...#b#...###...#b#...#b#',
    '..#b#..#b#.#aaaaa#.#b#..#b#.',
    '..#b#...#b#aaeaaaeaa#b#...#b#',
    '...#b#..#b#aaeaaaeaa#b#..#b#.',
    '...#b#...##aakkkaa##...#b#..',
    '....#b#...#awa#awa#...#b#...',
    '....#b#..#acccccccca#..#b#..',
    '.....#b##accccccccccca##b#...',
    '.....#b##aacxxxxxxxcaa##b#...',
    '......#b#aaacxxxxxcaaa#b#....',
    '......#b#aaaacxxxcaaaa#b#....',
    '.......##aaaaacxcaaaaa##.....',
    '........#baaaaacaaaaab#......',
    '.........#baaaaaaaaab#.......',
    '..........#bbaaaaabb#........',
    '...........#bbbbbbb#.........',
    '............#######..........'
  ]] },

  brute: { eye: '#ff3b3b', x: '#9aa2ad', y: '#d6dae0', frames: [[
    '..##..............##....',
    '.#ww#............#ww#...',
    '#www#..#######...#www#..',
    '#ww#..#aaaaaaa#...#ww#..',
    '.##..#aaaaaaaaa#...##...',
    '.....#aeaaaaaea#........',
    '.....#akaaaaaka#...#....',
    '.....#aaawwwaaa#..#x#...',
    '.....#baawwwaab#..#x#...',
    '......#bbaaabb#...#x#...',
    '...####bbbbbbb####x#....',
    '..#aaaaaaaaaaaaaaa#x#...',
    '.#aaaaaaaaaaaaaaaaa#x#..',
    '.#aaaccaaaaaaaccaaa#x#..',
    '#aaaaaaaaaaaaaaaaaaa#x#.',
    '#aa#aaaaaaaaaaaaa#aa#x#.',
    '#aa#aaaaaaaaaaaaa#aa#x#.',
    '#aa#.#bbbbbbbbb#.#aa#x#.',
    '.##..#bdbbbbbdb#..##.#x#',
    '.....#bbbbbbbbb#....#yyy#',
    '.....#bbbbbbbbb#....#yyyy#',
    '.....#aaa#.#aaa#....#yyyy#',
    '.....#aaa#.#aaa#.....#yy#.',
    '....#aaaa#.#aaaa#.....##..',
    '....#bbbb#.#bbbb#.........',
    '....######.######.........'
  ], [
    '..##..............##....',
    '.#ww#............#ww#...',
    '#www#..#######...#www#..',
    '#ww#..#aaaaaaa#...#ww#..',
    '.##..#aaaaaaaaa#...##...',
    '.....#aeaaaaaea#........',
    '.....#akaaaaaka#...#....',
    '.....#aaawwwaaa#..#x#...',
    '.....#baawwwaab#..#x#...',
    '......#bbaaabb#...#x#...',
    '...####bbbbbbb####x#....',
    '..#aaaaaaaaaaaaaaa#x#...',
    '.#aaaaaaaaaaaaaaaaa#x#..',
    '.#aaaccaaaaaaaccaaa#x#..',
    '#aaaaaaaaaaaaaaaaaaa#x#.',
    '#aa#aaaaaaaaaaaaa#aa#x#.',
    '#aa#aaaaaaaaaaaaa#aa#x#.',
    '#aa#.#bbbbbbbbb#.#aa#x#.',
    '.##..#bdbbbbbdb#..##.#x#',
    '.....#bbbbbbbbb#....#yyy#',
    '.....#bbbbbbbbb#....#yyyy#',
    '.....#aaa#.#aaa#....#yyyy#',
    '.....#aaa#.#aaa#.....#yy#.',
    '....#aaaa#.#aaaa#.....##..',
    '....#bbbb#.#bbbb#.........',
    '....######.######.........'
  ]] },

  serpent: { eye: '#ffe066', x: '#e0f070', frames: [[
    '..........#.#..#.#......',
    '.........#x##..##x#.....',
    '.........#xx#..#xx#.....',
    '........#xxxx##xxxx#....',
    '.......#xaaaaaaaaaax#...',
    '......#xaaaaaaaaaaaax#..',
    '......#aaeekaaaakeeaa#..',
    '......#aaeekaaaakeeaa#..',
    '......#aaaaaaaaaaaaaa#..',
    '.......#aaawaaaaawaa#...',
    '........#aawaaaaawa#....',
    '.........#aaa#m#aa#.....',
    '.........#aaa#m#a#......',
    '..........#aa#.##.......',
    '..........#aa#..........',
    '.........#caa#..........',
    '........#ccaaa#.........',
    '.......#ccaaaaa#........',
    '.....##ccaaaaaaa##......',
    '...##ccaaaaaaaaaaa##....',
    '..#ccaaaaaaaaaaaaaaa#...',
    '.#caaaaa###########aa#..',
    '.#caaaa#...........#aa#.',
    '.#caaaa#..#######..#aa#.',
    '.#caaaaa##aaaaaaa##aab#.',
    '..#caaaaaaaaaaaaaaaab#..',
    '...#ccaaaaaaaaaaaabb#...',
    '....##caaaaaaaaabb##....',
    '......####bbbbb###......',
    '..........#####.........'
  ], [
    '..........#.#..#.#......',
    '.........#x##..##x#.....',
    '.........#xx#..#xx#.....',
    '........#xxxx##xxxx#....',
    '.......#xaaaaaaaaaax#...',
    '......#xaaaaaaaaaaaax#..',
    '......#aaeekaaaakeeaa#..',
    '......#aaeekaaaakeeaa#..',
    '......#aaaaaaaaaaaaaa#..',
    '.......#aaawaaaaawaa#...',
    '........#aawaaaaawa#....',
    '.........#aaa###aa#.....',
    '.........#aaa#.#a#......',
    '..........#aa#..........',
    '..........#aa#..........',
    '.........#caa#..........',
    '........#ccaaa#.........',
    '.......#ccaaaaa#........',
    '.....##ccaaaaaaa##......',
    '...##ccaaaaaaaaaaa##....',
    '..#ccaaaaaaaaaaaaaaa#...',
    '.#caaaaa###########aa#..',
    '.#caaaa#...........#aa#.',
    '.#caaaa#..#######..#aa#.',
    '.#caaaaa##aaaaaaa##aab#.',
    '..#caaaaaaaaaaaaaaaab#..',
    '...#ccaaaaaaaaaaaabb#...',
    '....##caaaaaaaaabb##....',
    '......####bbbbb###......',
    '..........#####.........'
  ]] },

  construct: { eye: '#9ff0ff', x: '#9ff0ff', frames: [[
    '.........########.........',
    '........#aaaaaaaa#........',
    '........#aeaaaaea#........',
    '........#aeaaaaea#........',
    '........#aaaaaaaa#........',
    '.........#aaxxaa#.........',
    '....######aaaaaa######....',
    '..##aaaaaaaaaaaaaaaaaa##..',
    '.#aaaaaaaaaaaaaaaaaaaaaa#.',
    '#aaaaaaaa#aaaaaaaa#aaaaaaa#',
    '#aaaaaaa#aaaaaaaaaa#aaaaaa#',
    '#aaaaaa#aaaaxxxxaaaa#aaaaa#',
    '#aaaaaa#aaaxxxxxxaaa#aaaaa#',
    '#aaaaa#.#aaxxxxxxaa#.#aaaa#',
    '#aaaaa#.#aaaxxxxaaa#.#aaaa#',
    '#abbaa#.#aaaaaaaaaa#.#aabb#',
    '#abbaa#.#aabaaaabaa#.#aabb#',
    '#aaaaa#.#aaabaabaaa#.#aaaa#',
    '#aaaaa#.#baaaaaaaab#.#aaaa#',
    '.#aaa#..#bbbaaaabbb#..#aaa#',
    '.#bbb#..#bbbb##bbbb#..#bbb#',
    '.#####..#aaa#..#aaa#..#####',
    '........#aaa#..#aaa#......',
    '.......#aaaa#..#aaaa#.....',
    '.......#bbbb#..#bbbb#.....',
    '.......######..######.....'
  ], [
    '.........########.........',
    '........#aaaaaaaa#........',
    '........#aeaaaaea#........',
    '........#aeaaaaea#........',
    '........#aaaaaaaa#........',
    '.........#aaxxaa#.........',
    '....######aaaaaa######....',
    '..##aaaaaaaaaaaaaaaaaa##..',
    '.#aaaaaaaaaaaaaaaaaaaaaa#.',
    '#aaaaaaaa#aaaaaaaa#aaaaaaa#',
    '#aaaaaaa#aaaaaaaaaa#aaaaaa#',
    '#aaaaaa#aaaaxxxxaaaa#aaaaa#',
    '#aaaaaa#aaaxxxxxxaaa#aaaaa#',
    '#aaaaa#.#aaxxxxxxaa#.#aaaa#',
    '#aaaaa#.#aaaxxxxaaa#.#aaaa#',
    '#abbaa#.#aaaaaaaaaa#.#aabb#',
    '#abbaa#.#aabaaaabaa#.#aabb#',
    '#aaaaa#.#aaabaabaaa#.#aaaa#',
    '#aaaaa#.#baaaaaaaab#.#aaaa#',
    '.#aaa#..#bbbaaaabbb#..#aaa#',
    '.#bbb#..#bbbb##bbbb#..#bbb#',
    '.#####..#aaa#..#aaa#..#####',
    '........#aaa#..#aaa#......',
    '.......#aaaa#..#aaaa#.....',
    '.......#bbbb#..#bbbb#.....',
    '.......######..######.....'
  ]] },

  beast: { eye: '#ffe066', x: '#6aa84f', y: '#f0e6cf', frames: [[
    '..............................',
    '.#..#....................##...',
    '#yy#y#..................#xx#..',
    '#yyyyy#.................#xx#..',
    '#yeyye#.....#######......#x#..',
    '#yyyyy#....#bbbbbbb#.....#x#..',
    '#yywyy#...#bbaaaaabb#....#x#..',
    '.#yyy#...#bbaaaaaaabb#..#x#...',
    '.#yy#...#bbaaeaaaeaabb#.#x#...',
    '.#y#....#bbaakaaakaabb#.#x#...',
    '.#y#....#bbaaaaaaaaabb#.#x#...',
    '.#y####.#bbaaawwwaaabb##x#....',
    '.#yaaaa##bbbaawwwaabbb#x#.....',
    '..#aaaaaaabbbaaaaabbbaax#.....',
    '..#aaaaaaaaabbbbbbbaaaa#......',
    '.#aaaaaaaaaaaaaaaaaaaaa#......',
    '.#aaaaaaaaaaaaaaaaaaaaa#......',
    '.#aaaaaaaaaaaaaaaaaaaaa#......',
    '.#aaa#aaaaa#aaaaa#aaaaa#......',
    '.#aa#.#aaa#.#aaa#.#aaa#.......',
    '.#aa#.#aa#..#aa#..#aa#........',
    '#baa#.#bb#..#bb#..#bb#........',
    '#####.####..####..####........'
  ], [
    '..............................',
    '.#..#.....................##..',
    '#yy#y#...................#xx#.',
    '#yyyyy#..................#xx#.',
    '#yeyye#.....#######.......#x#.',
    '#yyyyy#....#bbbbbbb#......#x#.',
    '#yywyy#...#bbaaaaabb#.....#x#.',
    '.#yyy#...#bbaaaaaaabb#...#x#..',
    '.#yy#...#bbaaeaaaeaabb#..#x#..',
    '.#y#....#bbaakaaakaabb#..#x#..',
    '.#y#....#bbaaaaaaaaabb#.#x#...',
    '.#y####.#bbaaawwwaaabb##x#....',
    '.#yaaaa##bbbaawwwaabbb#x#.....',
    '..#aaaaaaabbbaaaaabbbaax#.....',
    '..#aaaaaaaaabbbbbbbaaaa#......',
    '.#aaaaaaaaaaaaaaaaaaaaa#......',
    '.#aaaaaaaaaaaaaaaaaaaaa#......',
    '.#aaaaaaaaaaaaaaaaaaaaa#......',
    '.#aaa#aaaaa#aaaaa#aaaaa#......',
    '.#aa#.#aaa#.#aaa#.#aaa#.......',
    '.#aa#.#aa#..#aa#..#aa#........',
    '#baa#.#bb#..#bb#..#bb#........',
    '#####.####..####..####........'
  ]] },

  robed: { eye: '#ff6b6b', x: '#c6a3ff', hover: 0, frames: [[
    '......###..........##.',
    '.....#bbb#........#xx#',
    '....#bbbbb#.......#xx#',
    '....#bwwwb#........#k#',
    '....#bwewb#........#k#',
    '....#bwewb#........#k#',
    '....#bwwwb#........#k#',
    '....#bwkwb#........#k#',
    '.....#www#.........#k#',
    '....##bbb##........#k#',
    '...#bbbbbbb#.......#k#',
    '..#bbbbbbbbb#......#k#',
    '..#bbbbbbbbb#.....#w#k#',
    '.#bbbbabbbbbb#...#ww#k#',
    '.#bbbbabbbbbb#..#ww#.#k',
    '.#bbbaaabbbbbb##ww#..#k',
    '#bbbbaaabbbbbbbww#...#k',
    '#bbbbaaabbbbbbbb#....#k',
    '#bbbaaaaabbbbbbb#....#k',
    '#bbbaaaaabbbbbbb#....#k',
    '#bbbbaaabbbbbbbb#....#k',
    '#bbbbbbbbbbbbbbb#....#k',
    '#bbbbbbbbbbbbbbb#....#k',
    '#bbbbbbbbbbbbbbbb#...#k',
    '#bbbbbbbbbbbbbbbb#...##',
    '#################.....'
  ], [
    '......###..........##.',
    '.....#bbb#........#xx#',
    '....#bbbbb#.......#xx#',
    '....#bwwwb#........#k#',
    '....#bwewb#........#k#',
    '....#bwewb#........#k#',
    '....#bwwwb#........#k#',
    '....#bwkwb#........#k#',
    '.....#www#.........#k#',
    '....##bbb##........#k#',
    '...#bbbbbbb#.......#k#',
    '..#bbbbbbbbb#......#k#',
    '..#bbbbbbbbb#.....#w#k#',
    '.#bbbbabbbbbb#...#ww#k#',
    '.#bbbbabbbbbb#..#ww#.#k',
    '.#bbbaaabbbbbb##ww#..#k',
    '#bbbbaaabbbbbbbww#...#k',
    '#bbbbaaabbbbbbbb#....#k',
    '#bbbaaaaabbbbbbb#....#k',
    '#bbbaaaaabbbbbbb#....#k',
    '#bbbbaaabbbbbbbb#....#k',
    '#bbbbbbbbbbbbbbb#....#k',
    '#bbbbbbbbbbbbbbb#....#k',
    '#bbbbbbbbbbbbbbbb#...#k',
    '#bbbbbbbbbbbbbbbb#...##',
    '#################.....'
  ]] },

  spectre: { eye: '#0d1018', x: '#ffffff', hover: 1, ghost: 1, frames: [[
    '......########......',
    '....##aaaaaaaa##....',
    '...#aaaaaaaaaaaa#...',
    '..#aaaaaaaaaaaaaa#..',
    '..#aaaaaaaaaaaaaa#..',
    '.#aaabeebaaabeebaa#.',
    '.#aaabeebaaabeebaa#.',
    '.#aaabbbbaaabbbbaa#.',
    '.#aaaaaaaaaaaaaaaa#.',
    '.#aaaaaabeeebaaaaa#.',
    '.#aaaaaabeeebaaaaa#.',
    '.#aaaaaaabbbaaaaaa#.',
    '.#aaaaaaaaaaaaaaaa#.',
    '.#aaaaaaaaaaaaaaaa#.',
    '.#baaaaaaaaaaaaaab#.',
    '.#baaaaaaaaaaaaaab#.',
    '.#bbaaaaaaaaaaaabb#.',
    '.#bbaaaaaaaaaaaabb#.',
    '.#bbbaaaaaaaaaabbb#.',
    '..#bbaaaaaaaaaabb#..',
    '..#bbb#aaaaaa#bbb#..',
    '..#bb#.#aaaa#.#bb#..',
    '...##...#aa#...##...',
    '.........##.........'
  ], [
    '......########......',
    '....##aaaaaaaa##....',
    '...#aaaaaaaaaaaa#...',
    '..#aaaaaaaaaaaaaa#..',
    '..#aaaaaaaaaaaaaa#..',
    '.#aaabeebaaabeebaa#.',
    '.#aaabeebaaabeebaa#.',
    '.#aaabbbbaaabbbbaa#.',
    '.#aaaaaaaaaaaaaaaa#.',
    '.#aaaaaabeeebaaaaa#.',
    '.#aaaaaabeeebaaaaa#.',
    '.#aaaaaaabbbaaaaaa#.',
    '.#aaaaaaaaaaaaaaaa#.',
    '.#aaaaaaaaaaaaaaaa#.',
    '.#baaaaaaaaaaaaaab#.',
    '.#baaaaaaaaaaaaaab#.',
    '.#bbaaaaaaaaaaaabb#.',
    '..#baaaaaaaaaaaab#..',
    '..#bbaaaaaaaaaabb#..',
    '.#bbb#aaaaaaaa#bbb#.',
    '.#bb#.#aaaaaa#.#bb#.',
    '..##..#aa##aa#..##..',
    '.......##..##.......',
    '....................'
  ]] },

  tentacle: { eye: '#ffe9a8', x: '#2b2b33', frames: [[
    '..........############..........',
    '........##aaaaaaaaaaaa##........',
    '.......#aaaaaaaaaaaaaaaa#.......',
    '......#aaaaaaaaaaaaaaaaaa#......',
    '.....#aaaaaaaaaaaaaaaaaaaa#.....',
    '.....#aaaaaaaaaaaaaaaaaaaa#.....',
    '....#aaaaaccccaaaaccccaaaaa#....',
    '....#aaaaccccccaaccccccaaaa#....',
    '....#aaaacceeccaacceeccaaaa#....',
    '....#aaaacceeccaacceeccaaaa#....',
    '....#aaaaccccccaaccccccaaaa#....',
    '....#aaaaaccccaaaaccccaaaaa#....',
    '.....#aaaaaaaaaaaaaaaaaaaa#.....',
    '.....#aaaaaaaaaxxaaaaaaaaa#.....',
    '......#aaaaaaaxxxxaaaaaaa#......',
    '.......#aaaaaa#xx#aaaaaa#.......',
    '..##...#a#aa#aaaaaa#aa#a#...##..',
    '.#bb#.#aa#aa#aa#.aa#aa#aa#.#bb#.',
    '#bb#..#a#.#a#a#...#a#.#a#..#bb#.',
    '#b#..#aa#.#a#a#...#a#.#aa#..#b#.',
    '#b#..#a#..#a##a#.#a##a#..#a#.#b#',
    '#b#.#aa#..#a#.#a#a#.#a#..#aa#.#b',
    '.#b#aa#..#a#..#aaa#..#a#..#aa#b#',
    '..#aaa#..#a#...#a#...#a#..#aaa#.',
    '...#aa#.#a#....###....#a#.#aa#..',
    '....####a#..............#a####..',
    '.......##................##.....'
  ], [
    '..........############..........',
    '........##aaaaaaaaaaaa##........',
    '.......#aaaaaaaaaaaaaaaa#.......',
    '......#aaaaaaaaaaaaaaaaaa#......',
    '.....#aaaaaaaaaaaaaaaaaaaa#.....',
    '.....#aaaaaaaaaaaaaaaaaaaa#.....',
    '....#aaaaaccccaaaaccccaaaaa#....',
    '....#aaaaccccccaaccccccaaaa#....',
    '....#aaaacceeccaacceeccaaaa#....',
    '....#aaaacceeccaacceeccaaaa#....',
    '....#aaaaccccccaaccccccaaaa#....',
    '....#aaaaaccccaaaaccccaaaaa#....',
    '.....#aaaaaaaaaaaaaaaaaaaa#.....',
    '.....#aaaaaaaaaxxaaaaaaaaa#.....',
    '......#aaaaaaaxxxxaaaaaaa#......',
    '.......#aaaaaa#xx#aaaaaa#.......',
    '.......#a#aa#aaaaaa#aa#a#.......',
    '..##..#aa#aa#aa#.aa#aa#aa#..##..',
    '.#bb#.#a#.#a#a#...#a#.#a#.#bb#..',
    '.#b#.#aa#.#a#a#...#a#.#aa#.#b#..',
    '#b#..#a#..#a##a#.#a##a#..#a#.#b#',
    '#b#.#aa#..#a#.#a#a#.#a#..#aa#.#b',
    '#b#.#a#..#a#..#aaa#..#a#..#a#.#b',
    '.#b#aa#..#a#...#a#...#a#..#aa#b#',
    '..#aaa#.#a#....###....#a#.#aaa#.',
    '...#aa#.#a#............#a#.#aa#.',
    '....######..............######..'
  ]] },

  fish: { eye: '#ffe066', x: '#e8e4d5', frames: [[
    '.............#..................',
    '............#a#.................',
    '...........#aa#.................',
    '..........#aaa#......#..........',
    '......###.#aaaa#....#a#.........',
    '....##aaa##aaaaa##.#aa#.........',
    '...#aaaaaaaaaaaaaa##aaa#........',
    '..#axaaxaaxaaxaaxaaaaaaa##......',
    '.#aaxaaxaaxaaxaaxaaaaaaaaa##....',
    '#aaaaaaaaaaaaaaaaaaaaaaaaaaaa#..',
    '#aaaaaaaaaaaaaaaaaaaaaaaaeaaaa#.',
    '#aaaaaaaaaaaaaaaaaaaaaaaakaaaaa#',
    '#baaaaaaaaaaaaaaaaaaaaaaaaaaab#.',
    '#bbaaaaaaaaaaaaaaaaaaaaaaaabbb#.',
    '.#bbbbbaaaaaaaaaaaaaaaaabbbb#...',
    '..#bbbbbbbaaaaaaaaaabbbbbb#.#...',
    '...##bbbbbbbbbbbbbbbbbb###...#..',
    '.....####bbbbbb#bbbbb##......#..',
    '.........#bbbb#.####..........',
    '..........#bb#..................',
    '...........##...................'
  ], [
    '................................',
    '.............#..................',
    '............#a#......#..........',
    '...........#aa#.....#a#.........',
    '......###.#aaa#....#aa#.........',
    '....##aaa##aaaa##.#aaa#.........',
    '...#aaaaaaaaaaaaa##aaaa#........',
    '..#axaaxaaxaaxaaxaaaaaaa##......',
    '.#aaxaaxaaxaaxaaxaaaaaaaaa##....',
    '#aaaaaaaaaaaaaaaaaaaaaaaaaaaa#..',
    '#aaaaaaaaaaaaaaaaaaaaaaaaeaaaa#.',
    '#aaaaaaaaaaaaaaaaaaaaaaaakaaaaa#',
    '#baaaaaaaaaaaaaaaaaaaaaaaaaaab#.',
    '#bbaaaaaaaaaaaaaaaaaaaaaaaabbb#.',
    '.#bbbbbaaaaaaaaaaaaaaaaabbbb#.#.',
    '..#bbbbbbbaaaaaaaaaabbbbbb#..#..',
    '...##bbbbbbbbbbbbbbbbbb###..#...',
    '.....####bbbbbbbb#bbb##.........',
    '.........#bbbbbb#.###...........',
    '..........#bbbb#................',
    '...........####.................'
  ]] },

  siren: { eye: '#123344', x: '#f0d8c0', y: '#8a2a3a', frames: [[
    '.......#######........',
    '......#bbbbbbb#.......',
    '.....#bbbbbbbbb#......',
    '.....#bbxxxxxbb#......',
    '....#bbxxxxxxxbb#.....',
    '....#bbxxexexxbb#.....',
    '....#bbxxxxxxxbb#.....',
    '....#bbbxxyxxbbb#.....',
    '....#bbb#xxx#bbb#.....',
    '....#bbb##x##bbb#.....',
    '....#bb#xxxxx#bb#.....',
    '....#b#xxaaaxx#b#.....',
    '....#b#xaaaaax#b#.....',
    '....#b#xaaaaax#b#.....',
    '....#b##aaaaa##b#.....',
    '.....#.#aaaaa#.#......',
    '.......#aaaaa#........',
    '.......#caaaac#.......',
    '......#caaaaaac#......',
    '......#caaaaaac#......',
    '.......#caaaac#.......',
    '........#caaac#.......',
    '.........#caa#........',
    '..........#aa#..#.....',
    '..........#aaa##a#....',
    '..........#aaaaaaa#...',
    '.........#aaaaaaaaa#..',
    '........#aaaa#.#aaaa#.',
    '........######.######.'
  ], [
    '.......#######........',
    '......#bbbbbbb#.......',
    '.....#bbbbbbbbb#......',
    '.....#bbxxxxxbb#......',
    '....#bbxxxxxxxbb#.....',
    '....#bbxxexexxbb#.....',
    '....#bbxxxxxxxbb#.....',
    '....#bbbxxyxxbbb#.....',
    '....#bbb#xxx#bbb#.....',
    '....#bbb##x##bbb#.....',
    '....#bb#xxxxx#bb#.....',
    '....#b#xxaaaxx#b#.....',
    '....#b#xaaaaax#b#.....',
    '....#b#xaaaaax#b#.....',
    '....#b##aaaaa##b#.....',
    '.....#.#aaaaa#.#......',
    '.......#aaaaa#........',
    '.......#caaaac#.......',
    '......#caaaaaac#......',
    '......#caaaaaac#......',
    '.......#caaaac#.......',
    '........#caaac#.......',
    '.........#caa#........',
    '..........#aa#........',
    '.....#....#aa#........',
    '....#a##.#aaa#........',
    '...#aaaaa#aaa#........',
    '..#aaaaaaaaaa#........',
    '..############........'
  ]] },

  nessie: { eye: '#ffe066', x: '#dff4ff', frames: [[
    '.....................#####......',
    '....................#aaaaa##....',
    '...................#aaeaaaaa#...',
    '...................#aakaaaaaa#..',
    '...................#aaaaaaaaa#..',
    '....................#aaa#####...',
    '....................#aaa#.......',
    '....................#aaa#.......',
    '....................#aaa#.......',
    '...................#aaaa#.......',
    '...................#aaaa#.......',
    '..................#aaaaa#.......',
    '..................#aaaa#........',
    '.................#aaaaa#........',
    '................#aaaaa#.........',
    '...............#aaaaaa#.........',
    '.....######...#caaaaaa#.........',
    '....#aaaaaa#.#caaaaaaa#.........',
    '...#aaaaaaaa#caaaaaaaa#.........',
    '..#aaaaaaaaaaaaaaaaaaa#.#####...',
    '.#aaaaaaaaaaaaaaaaaaaa##aaaaa#..',
    '#baaaaaaaaaaaaaaaaaaaaaaaaaaab#.',
    '#bbaaaaaaaaaaaaaaaaaaaaaaaaabb#.',
    '.#bbbbbbbbbbbbbbbbbbbbbbbbbbb#..',
    '..###########################...'
  ], [
    '......................#####.....',
    '.....................#aaaaa##...',
    '....................#aaeaaaaa#..',
    '....................#aakaaaaaa#.',
    '....................#aaaaaaaaa#.',
    '.....................#aaa#####..',
    '.....................#aaa#......',
    '.....................#aaa#......',
    '....................#aaaa#......',
    '....................#aaaa#......',
    '...................#aaaaa#......',
    '...................#aaaa#.......',
    '..................#aaaaa#.......',
    '.................#aaaaa#........',
    '................#aaaaaa#........',
    '...............#caaaaaa#........',
    '.....######...#caaaaaaa#........',
    '....#aaaaaa#.#caaaaaaaa#........',
    '...#aaaaaaaa#caaaaaaaaa#........',
    '..#aaaaaaaaaaaaaaaaaaaa#.#####..',
    '.#aaaaaaaaaaaaaaaaaaaaa##aaaaa#.',
    '#baaaaaaaaaaaaaaaaaaaaaaaaaaaab#',
    '#bbaaaaaaaaaaaaaaaaaaaaaaaaaabb#',
    '.#bbbbbbbbbbbbbbbbbbbbbbbbbbbb#.',
    '..############################..'
  ]] },

  lich: { eye: '#7cf7ff', x: '#e0c469', y: '#7cf7ff', hover: 1, frames: [[
    '....#..#..#..#..#........',
    '....#x##x##x##x##x#...##.',
    '....#xxxxxxxxxxxxx#..#yy#',
    '.....#xxxxxxxxxxx#...#yy#',
    '.....#wwwwwwwwwww#....#k#',
    '.....#wwwwwwwwwww#....#k#',
    '.....#weewwwwweew#....#k#',
    '.....#weewwwwweew#....#k#',
    '.....#wwwwwkwwwww#....#k#',
    '.....#wwwwkkkwwww#....#k#',
    '......#wkwkwkwkw#.....#k#',
    '......#wwwwwwwww#.....#k#',
    '.......##wwwww##......#k#',
    '.....##bbbbbbbbb##....#k#',
    '....#bbbbbbbbbbbbb#...#k#',
    '...#bbbbbbybbbbbbbb#..#k#',
    '...#bbbbbyyybbbbbbb#.#w#k#',
    '..#bbbbbbbybbbbbbbbb##ww#k#',
    '..#bbbbbbbbbbbbbbbbb#ww#.#k',
    '..#bbbbbbybbbbbbbbbbww#..#k',
    '.#bbbbbbyyybbbbbbbbww#...#k',
    '.#bbbbbbbybbbbbbbbbb#....#k',
    '.#bbbbbbbbbbbbbbbbbb#....#k',
    '.#bbbbbbbybbbbbbbbbb#....#k',
    '#bbbbbbbyyybbbbbbbbbb#...#k',
    '#bbbbbbbbybbbbbbbbbbb#...#k',
    '#bbbbbbbbbbbbbbbbbbbb#...#k',
    '#bbbbbbbbbbbbbbbbbbbb#...#k',
    '.#bbbbbbbbbbbbbbbbbb#....##',
    '..##bbbbbbbbbbbbbb##.....',
    '....##bbbbbbbbbb##.......',
    '......####bb####.........',
    '..........##.............'
  ], [
    '....#..#..#..#..#........',
    '....#x##x##x##x##x#...##.',
    '....#xxxxxxxxxxxxx#..#yy#',
    '.....#xxxxxxxxxxx#...#yy#',
    '.....#wwwwwwwwwww#....#k#',
    '.....#wwwwwwwwwww#....#k#',
    '.....#weewwwwweew#....#k#',
    '.....#weewwwwweew#....#k#',
    '.....#wwwwwkwwwww#....#k#',
    '.....#wwwwkkkwwww#....#k#',
    '......#wkwkwkwkw#.....#k#',
    '......#wwwwwwwww#.....#k#',
    '.......##wwwww##......#k#',
    '.....##bbbbbbbbb##....#k#',
    '....#bbbbbbbbbbbbb#...#k#',
    '...#bbbbbbybbbbbbbb#..#k#',
    '...#bbbbbyyybbbbbbb#.#w#k#',
    '..#bbbbbbbybbbbbbbbb##ww#k#',
    '..#bbbbbbbbbbbbbbbbb#ww#.#k',
    '..#bbbbbbybbbbbbbbbbww#..#k',
    '.#bbbbbbyyybbbbbbbbww#...#k',
    '.#bbbbbbbybbbbbbbbbb#....#k',
    '.#bbbbbbbbbbbbbbbbbb#....#k',
    '.#bbbbbbbybbbbbbbbbb#....#k',
    '#bbbbbbbyyybbbbbbbbbb#...#k',
    '#bbbbbbbbybbbbbbbbbbb#...#k',
    '#bbbbbbbbbbbbbbbbbbbb#...#k',
    '#bbbbbbbbbbbbbbbbbbbb#...#k',
    '.#bbbbbbbbbbbbbbbbbb#....##',
    '..##bbbbbbbbbbbbbb##.....',
    '.....##bbbbbbbbb##.......',
    '........###bb###.........',
    '.........................'
  ]] }
};

function hexMix(h, t, f) {                                  /* blend hex colour h toward t */
  var a = parseInt(h.slice(1), 16), b = parseInt(t.slice(1), 16), o = '#';
  for (var s = 16; s >= 0; s -= 8) {
    var v = Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f);
    o += (v < 16 ? '0' : '') + v.toString(16);
  }
  return o;
}
var bossCache = {};
var BOSS_PX = 2;                                             /* screen pixels per art cell */
/* the bitmap for one boss, one frame, rendered once and kept */
function bossCanvas(m, frame, hurt) {
  var art = BOSSART[m.shape], key = m.shape + '|' + m.col + '|' + frame + '|' + (hurt ? 1 : 0);
  if (bossCache[key]) return bossCache[key];
  var rows = art.frames[frame], h = rows.length, w = 0, r, c;
  for (r = 0; r < h; r++) if (rows[r].length > w) w = rows[r].length;
  var pal = {
    '#': hexMix(m.col2, '#000000', 0.55), a: m.col, b: m.col2, d: hexMix(m.col2, '#000000', 0.3),
    c: hexMix(m.col, '#ffffff', 0.35), e: art.eye || '#ffe066', w: '#efe6d2', k: '#15121c',
    m: '#b8323a', x: art.x || '#c9a227', y: art.y || '#ffffff'
  };
  var cv = newCanvas(w * BOSS_PX, h * BOSS_PX), g = cv.getContext('2d');
  for (r = 0; r < h; r++) for (c = 0; c < rows[r].length; c++) {
    var ch = rows[r][c];
    if (ch === '.' || ch === ' ') continue;
    g.fillStyle = hurt ? (ch === '#' ? '#ffffff' : '#fff6f0') : pal[ch] || m.col;
    g.fillRect(c * BOSS_PX, r * BOSS_PX, BOSS_PX, BOSS_PX);
  }
  bossCache[key] = cv;
  return cv;
}

/* a boss on screen: its cached bitmap, a shadow, and whatever it does to the air around it */
function bossSprite(m, sx, sy) {
  var g = ctx, art = BOSSART[m.shape] || BOSSART.brute, now = performance.now();
  var frame = ((now / 420 + m.x * 0.7) | 0) & 1;
  var cv = bossCanvas(m, frame, m.hurt > 0);
  var cx = sx + 12, ground = sy + 23, base = g.globalAlpha;
  var bob = art.hover ? Math.sin(now / 300 + m.x) * 2 - 3 : 0;
  var wet = m.t && m.t.sea;
  g.fillStyle = wet ? 'rgba(220,240,255,.28)' : 'rgba(0,0,0,.34)';
  g.beginPath(); g.ellipse(cx, ground - 1, cv.width * 0.42, wet ? 4 : 5, 0, 0, 6.2832); g.fill();
  if (m.shape === 'lich') {                                  /* spectral aura */
    g.globalAlpha = base * (0.26 + 0.12 * Math.sin(now / 240));
    g.fillStyle = '#6f5bd6'; g.beginPath(); g.arc(cx, ground - cv.height * 0.45, cv.width * 0.62, 0, 6.2832); g.fill();
    g.globalAlpha = base;
  }
  if (art.ghost) g.globalAlpha = base * (0.72 + 0.12 * Math.sin(now / 200));
  g.drawImage(cv, Math.round(cx - cv.width / 2), Math.round(ground - cv.height + bob));
  g.globalAlpha = base;
  if (m.shape === 'siren') {                                 /* the song */
    g.globalAlpha = base * (0.30 + 0.18 * Math.sin(now / 200));
    g.strokeStyle = '#dffcff'; g.lineWidth = 2;
    for (var ri = 1; ri <= 3; ri++) { g.beginPath(); g.arc(cx + 6, ground - cv.height + 22, ri * 9, -0.9, 0.9); g.stroke(); }
    g.globalAlpha = base;
  }
  if (m.swing > 0) {
    g.strokeStyle = 'rgba(255,140,140,' + m.swing + ')'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx + DX[m.face] * 30, ground - 20 + DY[m.face] * 26, 16, 0, 6.2832); g.stroke();
  }
}

function drawMob(m, sx, sy) {
  if (m.boss) { bossSprite(m, sx, sy); return; }
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
  } else if (t.k === 'eel') {
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    for (var ei = 0; ei <= 10; ei++) {
      var ex = sx + 3 + ei * 1.8, ey = sy + 14 + Math.sin(ei * 0.8 + performance.now() / 150) * 4;
      if (ei === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
    }
    ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx + 20, sy + 14 + wob, 3.5, 0, 6.2832); ctx.fill();
    rect(ctx, sx + 21, sy + 13 + wob, 2, 2, '#ffe066');
  } else if (t.k === 'jelly') {
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = col; ctx.beginPath();
    ctx.ellipse(sx + 12, sy + 11 + wob * 0.5, 8, 6.5, 0, 3.1416, 0); ctx.fill();
    ctx.strokeStyle = t.dark; ctx.lineWidth = 1.5;
    for (var jt = 0; jt < 4; jt++) {
      var jx = sx + 6 + jt * 4;
      ctx.beginPath(); ctx.moveTo(jx, sy + 11 + wob * 0.5);
      ctx.quadraticCurveTo(jx + Math.sin(performance.now() / 260 + jt) * 3, sy + 16, jx, sy + 21); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    rect(ctx, sx + 9, sy + 8 + wob * 0.5, 2, 2, '#fff'); rect(ctx, sx + 14, sy + 8 + wob * 0.5, 2, 2, '#fff');
  } else if (t.k === 'nixie') {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(sx + 12, sy + 9 + wob * 0.4, 4.5, 0, 6.2832); ctx.fill();
    rect(ctx, sx + 8, sy + 4 + wob * 0.4, 9, 3, '#3f7f8f');            /* wet hair */
    rect(ctx, sx + 10, sy + 13 + wob * 0.4, 5, 6, col);
    ctx.fillStyle = t.dark;                                            /* tail fluke */
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 18 + wob * 0.4);
    ctx.lineTo(sx + 6, sy + 23); ctx.lineTo(sx + 18, sy + 23); ctx.fill();
    rect(ctx, sx + 10, sy + 8 + wob * 0.4, 2, 2, '#123'); rect(ctx, sx + 14, sy + 8 + wob * 0.4, 2, 2, '#123');
  } else if (t.k === 'crab') {
    rect(ctx, sx + 5, sy + 11, 14, 8, col); rect(ctx, sx + 5, sy + 11, 14, 2, '#f0a080');
    rect(ctx, sx + 8, sy + 8, 2, 3, t.dark); rect(ctx, sx + 14, sy + 8, 2, 3, t.dark);
    rect(ctx, sx + 8, sy + 6, 2, 2, '#ffe066'); rect(ctx, sx + 14, sy + 6, 2, 2, '#ffe066');
    var cl = Math.sin(performance.now() / 200) * 2;
    rect(ctx, sx + 1, sy + 10 + cl, 5, 5, col); rect(ctx, sx + 18, sy + 10 - cl, 5, 5, col);
    for (var lg = 0; lg < 3; lg++) {
      rect(ctx, sx + 6 + lg * 4, sy + 19, 1, 3, t.dark);
      rect(ctx, sx + 6 + lg * 4, sy + 19, 1, 3, t.dark);
    }
  } else if (t.k === 'harpy') {
    var fl2 = Math.abs(Math.sin(performance.now() / 110)) * 6;
    ctx.fillStyle = t.dark;
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 12 + wob); ctx.lineTo(sx + 1, sy + 6 - fl2 + wob); ctx.lineTo(sx + 9, sy + 17 + wob); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 12 + wob); ctx.lineTo(sx + 23, sy + 6 - fl2 + wob); ctx.lineTo(sx + 15, sy + 17 + wob); ctx.fill();
    rect(ctx, sx + 9, sy + 9 + wob, 6, 9, col);
    ctx.fillStyle = '#f0d8b0'; ctx.beginPath(); ctx.arc(sx + 12, sy + 7 + wob, 3.5, 0, 6.2832); ctx.fill();
    rect(ctx, sx + 10, sy + 6 + wob, 2, 2, '#22222c'); rect(ctx, sx + 13, sy + 6 + wob, 2, 2, '#22222c');
    rect(ctx, sx + 10, sy + 18 + wob, 2, 4, '#c9a86a'); rect(ctx, sx + 13, sy + 18 + wob, 2, 4, '#c9a86a');
  } else if (t.k === 'mimic') {
    rect(ctx, sx + 3, sy + 11, 18, 10, col); rect(ctx, sx + 3, sy + 6, 18, 5, t.dark);
    rect(ctx, sx + 3, sy + 13, 18, 2, '#d9b45c');
    for (var tt2 = 0; tt2 < 5; tt2++) {                                /* teeth */
      rect(ctx, sx + 4 + tt2 * 4, sy + 11, 2, 3, '#fff8e8');
      rect(ctx, sx + 5 + tt2 * 4, sy + 8, 2, 3, '#fff8e8');
    }
    rect(ctx, sx + 6, sy + 3, 3, 3, '#ff5c5c'); rect(ctx, sx + 15, sy + 3, 3, 3, '#ff5c5c');
    ctx.strokeStyle = '#ffb3b3'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx + 8, sy + 21); ctx.lineTo(sx + 12, sy + 23); ctx.lineTo(sx + 16, sy + 21); ctx.stroke();
  } else if (t.k === 'archer') {
    rect(ctx, sx + 8, sy + 10, 9, 10, col); rect(ctx, sx + 8, sy + 3, 9, 8, col);
    rect(ctx, sx + 8, sy + 10, 9, 2, t.dark);
    rect(ctx, sx + 10, sy + 6, 2, 2, '#2a2a30'); rect(ctx, sx + 14, sy + 6, 2, 2, '#2a2a30');
    var bs = m.face === 3 ? -1 : 1, bxx = sx + 12 + bs * 8;
    ctx.strokeStyle = '#8a6238'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bxx, sy + 13, 6, bs > 0 ? -1.1 : 2.0, bs > 0 ? 1.1 : 4.2); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,240,225,.7)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bxx, sy + 8); ctx.lineTo(bxx, sy + 18); ctx.stroke();
  } else if (t.k === 'imp') {
    ctx.fillStyle = t.dark;
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 11); ctx.lineTo(sx + 2, sy + 5 + wob); ctx.lineTo(sx + 9, sy + 15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 11); ctx.lineTo(sx + 22, sy + 5 + wob); ctx.lineTo(sx + 15, sy + 15); ctx.fill();
    rect(ctx, sx + 8, sy + 10, 9, 9, col);
    rect(ctx, sx + 8, sy + 4, 9, 7, col);
    rect(ctx, sx + 7, sy + 1, 2, 4, t.dark); rect(ctx, sx + 16, sy + 1, 2, 4, t.dark);
    rect(ctx, sx + 9, sy + 6, 3, 2, '#fff2a8'); rect(ctx, sx + 14, sy + 6, 3, 2, '#fff2a8');
    rect(ctx, sx + 11, sy + 19, 3, 4, t.dark);
  } else {
    rect(ctx, sx + 5, sy + 9, 14, 12, col); rect(ctx, sx + 7, sy + 2, 10, 8, col);
    rect(ctx, sx + 9, sy + 5, 2, 2, '#20140b'); rect(ctx, sx + 14, sy + 5, 2, 2, '#20140b');
    rect(ctx, sx + 9, sy + 8, 6, 1, '#3a2415'); rect(ctx, sx + 18, sy + 6, 4, 14, t.dark);
  }
  if (m.frozen > 0) {
    ctx.globalAlpha = 0.45; rect(ctx, sx + 4, sy + 2, 16, 20, '#8fdcff'); ctx.globalAlpha = 1;
    rect(ctx, sx + 4, sy + 2, 16, 1, '#dff4ff'); rect(ctx, sx + 4, sy + 21, 16, 1, '#dff4ff');
  }
  var tired = m.stam < m.stamMax * 0.5;
  if (m.hp < m.max || tired) {
    rect(ctx, sx + 3, sy - 4, 18, 4, 'rgba(0,0,0,.55)');
    rect(ctx, sx + 4, sy - 3, Math.max(1, Math.round(16 * m.hp / m.max)), 1, '#ff6b6b');
    rect(ctx, sx + 4, sy - 1, Math.max(0, Math.round(16 * m.stamFrac())), 1, m.winded ? '#ff9d6b' : '#e0c469');
  }
  if (m.swing > 0) { ctx.strokeStyle = 'rgba(255,120,120,' + m.swing + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx + 12 + DX[m.face] * 10, sy + 12 + DY[m.face] * 10, 6, 0, 6.2832); ctx.stroke(); }
}

function drawItem(it, sx, sy) {
  var bob = Math.sin(performance.now() / 300 + it.bob) * 1.6;
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath(); ctx.ellipse(sx + 12, sy + 20, 6, 2.5, 0, 0, 6.2832); ctx.fill();
  if (it.kind === 'chest') {
    if (it.ornate) {
      ctx.globalAlpha = 0.30 + 0.20 * Math.abs(Math.sin(performance.now() / 380 + it.bob));
      ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(sx + 12, sy + 13, 13, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
      rect(ctx, sx + 2, sy + 9, 20, 12, '#7a4a22'); rect(ctx, sx + 2, sy + 5, 20, 5, '#9c5f2c');
      rect(ctx, sx + 2, sy + 13, 20, 2, '#ffd166'); rect(ctx, sx + 2, sy + 9, 20, 1, '#ffe9a8');
      rect(ctx, sx + 10, sy + 11, 4, 5, '#fff4c2');
      rect(ctx, sx + 2, sy + 5, 2, 16, '#ffd166'); rect(ctx, sx + 20, sy + 5, 2, 16, '#ffd166');
    } else {
    rect(ctx, sx + 4, sy + 10, 16, 10, '#8a5a2b'); rect(ctx, sx + 4, sy + 7, 16, 4, '#a86e35');
    rect(ctx, sx + 4, sy + 13, 16, 2, '#d9b45c'); rect(ctx, sx + 11, sy + 12, 3, 4, '#ffe9a8');
    }
  } else if (it.kind === 'arrows') {
    var ab = sy + bob;
    rect(ctx, sx + 7, ab + 9, 9, 11, '#6b4a2a'); rect(ctx, sx + 7, ab + 9, 9, 2, '#8a6238');
    for (var q = 0; q < 3; q++) {
      rect(ctx, sx + 8 + q * 3, ab + 3, 1, 7, '#c9b48a');
      rect(ctx, sx + 7 + q * 3, ab + 2, 3, 2, '#e8e2d2');
    }
  } else if (it.kind === 'ammo') {
    var E2 = ELEMENTS[it.ele], eb = sy + bob;
    ctx.globalAlpha = 0.45 + 0.35 * Math.abs(Math.sin(performance.now() / 300 + it.bob));
    ctx.fillStyle = E2.col; ctx.beginPath(); ctx.arc(sx + 12, eb + 12, 10, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    for (var ea = 0; ea < 2; ea++) {
      rect(ctx, sx + 9 + ea * 5, eb + 5, 1, 12, '#c9b48a');
      rect(ctx, sx + 8 + ea * 5, eb + 3, 3, 3, E2.edge);
    }
  } else if (it.kind === 'wood') {
    var wb = sy + bob;
    rect(ctx, sx + 4, wb + 12, 16, 4, '#8a6238'); rect(ctx, sx + 4, wb + 12, 16, 1, '#b78a54');
    rect(ctx, sx + 6, wb + 16, 14, 4, '#6b4a2a'); rect(ctx, sx + 6, wb + 16, 14, 1, '#9c7440');
    rect(ctx, sx + 5, wb + 13, 2, 2, '#c9a06a'); rect(ctx, sx + 17, wb + 17, 2, 2, '#c9a06a');
  } else if (it.kind === 'potion') {
    rect(ctx, sx + 9, sy + 6 + bob, 6, 3, '#cfd6e4'); rect(ctx, sx + 8, sy + 9 + bob, 8, 9, '#ff5c7a');
    rect(ctx, sx + 10, sy + 11 + bob, 2, 4, 'rgba(255,255,255,.55)');
  } else {
    var M = matsFor(it.slot)[it.tier], yb = sy + bob;
    ctx.globalAlpha = 0.5 + 0.3 * Math.abs(Math.sin(performance.now() / 400 + it.bob));
    ctx.fillStyle = it.affix ? AFFIX[it.affix].col : M.edge; ctx.beginPath(); ctx.arc(sx + 12, yb + 12, 9, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
    if (it.slot === 'sword') {
      rect(ctx, sx + 11, yb + 3, 3, 13, M.col); rect(ctx, sx + 11, yb + 3, 3, 3, M.edge);
      rect(ctx, sx + 8, yb + 15, 9, 2, '#6a4a2a'); rect(ctx, sx + 11, yb + 17, 3, 4, '#6a4a2a');
    } else if (it.slot === 'shield') {
      rect(ctx, sx + 7, yb + 5, 11, 10, M.col); rect(ctx, sx + 9, yb + 15, 7, 3, M.col);
      rect(ctx, sx + 7, yb + 5, 11, 2, M.edge); rect(ctx, sx + 11, yb + 8, 3, 5, M.edge);
    } else if (it.slot === 'axe') {
      rect(ctx, sx + 11, yb + 4, 2, 16, '#6b4a2a');
      rect(ctx, sx + 6, yb + 4, 7, 6, M.col); rect(ctx, sx + 6, yb + 4, 7, 2, M.edge);
      rect(ctx, sx + 13, yb + 5, 3, 4, M.col);
    } else if (it.slot === 'bow') {
      ctx.strokeStyle = M.col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx + 15, yb + 12, 8, 2.1, 4.2); ctx.stroke();
      ctx.strokeStyle = M.edge; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx + 11, yb + 5); ctx.lineTo(sx + 11, yb + 19); ctx.stroke();
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
  var b = knownBoss();
  if (!b || !b.wake || dist(b, hero) > 22) return;
  var w = 420, x = (VPW - w) / 2, y = 22;
  rect(ctx, x - 2, y - 2, w + 4, 18, 'rgba(0,0,0,.62)');
  bar(x, y, w, 10, b.hp / b.max, '#a8232b', 'rgba(60,20,20,.85)');
  bar(x, y + 11, w, 3, b.stamFrac(), '#e0c469', 'rgba(50,40,15,.85)');
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
  ctx.fillText('seed ' + run.seed.toString(16), X + 150, 30);
  ctx.fillText('explored ' + Math.round(world.seenCount / (W * H) * 100) + '%', X + 150, 42);
  ctx.fillStyle = '#5f6b80';
  ctx.fillText(FLOORDEF[clamp(run.floor - 1, 0, 4)].name, X + 14, 42);

  var y = 60;
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = '#cfd6e4'; ctx.fillText('HP  ' + hero.hp + '/' + hero.max, X + 14, y);
  ctx.fillStyle = hero.winded ? '#ff9d6b' : '#c9b98a'; ctx.fillText('SP  ' + hero.stam + '/' + hero.stamMax, X + 14 + (PW - 28) / 2, y);
  bar(X + 14, y + 13, PW - 28, 6, hero.hp / hero.max, '#e8506a');
  bar(X + 14, y + 21, PW - 28, 4, hero.stamFrac(), hero.winded ? '#ff9d6b' : hero.resting ? '#f0d890' : '#e0c469'); y += 30;
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
    if (tr < 0) {
      ctx.fillStyle = '#3f4859'; ctx.fillText('—', X + 76, y);
      if (k === 'axe' && hero.wood) { ctx.fillStyle = '#d9b487'; ctx.fillText('\u00d7' + hero.wood, X + 186, y); }
    }
    else {
      var MM = matsFor(k)[tr], AF = hero.affix[k];
      rect(ctx, X + 76, y + 2, 6, 6, AF ? AFFIX[AF].col : MM.col);
      ctx.fillStyle = AF ? AFFIX[AF].col : MM.edge;
      ctx.fillText(((AF ? AF.slice(0, 4) + ' ' : '') + MM.n).slice(0, 14), X + 88, y);
      if (k === 'bow') { ctx.fillStyle = hero.arrows > 0 ? '#e8d9a8' : '#8a4a4a'; ctx.fillText('\u00d7' + hero.arrows, X + 186, y); }
      if (k === 'axe') { ctx.fillStyle = '#d9b487'; ctx.fillText('\u00d7' + hero.wood, X + 186, y); }
    }
    y += 14;
  }
  var pips = 0;
  if (hero.boat) {
    rect(ctx, X + 14, y + 2, 8, 5, '#9c7440');
    ctx.fillStyle = '#9fd8e6'; ctx.fillText('hull ' + hero.boatHp + '/3', X + 26, y);
    pips += 2;
  } else if (hero.swimming) {
    rect(ctx, X + 14, y + 2, 8, 5, '#e8506a');
    ctx.fillStyle = '#ff9d9d'; ctx.fillText('adrift', X + 26, y);
    pips += 2;
  }
  for (var e2 = 0; e2 < ELEKEYS.length; e2++) {
    var ek2 = ELEKEYS[e2], cnt = hero.ammo[ek2];
    if (!cnt) continue;
    var px4 = X + 14 + pips * 34;
    rect(ctx, px4, y + 2, 7, 7, ELEMENTS[ek2].col);
    ctx.fillStyle = ELEMENTS[ek2].edge; ctx.fillText('\u00d7' + cnt, px4 + 11, y);
    pips++;
  }
  y += pips ? 17 : 4;

  var ms = PW - 74, mx = X + 37;
  ctx.fillStyle = '#000'; ctx.fillRect(mx - 1, y - 1, ms + 2, ms + 2);
  ctx.drawImage(world.fog, mx, y, ms, ms);
  var sc = ms / W, k2;
  for (k2 = 0; k2 < items.length; k2++) {
    var it = items[k2];
    if (!it.known) continue;
    ctx.fillStyle = it.kind === 'chest' ? (it.ornate ? '#fff4c2' : '#ffd166') : it.kind === 'potion' ? '#8ef2a0'
      : it.kind === 'arrows' ? '#e8d9a8' : it.kind === 'wood' ? '#d9b487'
      : it.kind === 'ammo' ? ELEMENTS[it.ele].edge : matsFor(it.slot)[it.tier].edge;
    ctx.fillRect(mx + it.x * sc, y + it.y * sc, 2, 2);
  }
  for (k2 = 0; k2 < mobs.length; k2++) {
    var mb = mobs[k2];
    if (!knownMob(mb)) continue;
    var live = visibleAt(mb.x, mb.y), bx2 = live ? mb.x : mb.lx, by2 = live ? mb.y : mb.ly;
    ctx.globalAlpha = live ? 1 : 0.45;
    if (mb.boss) { ctx.fillStyle = '#ff2d2d'; ctx.fillRect(mx + bx2 * sc - 2, y + by2 * sc - 2, 6, 6); }
    else { ctx.fillStyle = '#ff5c5c'; ctx.fillRect(mx + bx2 * sc, y + by2 * sc, 2, 2); }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(mx + hero.x * sc - 1, y + hero.y * sc - 1, 4, 4);
  ctx.strokeStyle = '#2a3547'; ctx.strokeRect(mx - 1.5, y - 1.5, ms + 3, ms + 3);
  y += ms + 10;

  ctx.fillStyle = '#8ef2a0'; ctx.fillText(((hero.ran ? '» ' : '› ') + hero.intent).slice(0, 28), X + 14, y); y += 16;
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
    spaced('SEED ' + run.seed.toString(16), VPW / 2, mid + 70, 12, 3, 'rgba(150,140,135,.6)');
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
    spaced('SEED ' + run.seed.toString(16), VPW / 2, mid + 94, 12, 3, 'rgba(200,190,160,.6)');
  } else {
    spaced('LUNCHQUEST', VPW / 2, mid - 10, 54, 12, '#dfe6f2');
    spaced('RUN ' + (run.n + 1), VPW / 2, mid + 26, 17, 6, 'rgba(180,190,210,.7)');
    spaced('A HERO DESCENDS', VPW / 2, mid + 56, 12, 4, 'rgba(140,150,170,.6)');
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.restore();
}

/* sprites glide to their tile at a steady pace that fills most of the turn, so a
   step, a sprint and a charge all read as motion rather than a jump.  Anything
   farther than that is a teleport (a new floor) and snaps. */
function smooth(e, dt) {
  if (e.tx !== e.x || e.ty !== e.y) {                       /* new destination: set the pace */
    e.tx = e.x; e.ty = e.y;
    var d0 = Math.abs(e.x - e.px) + Math.abs(e.y - e.py);
    if (d0 > 3) { e.px = e.x; e.py = e.y; return; }
    e.spd = d0 / (TURN_MS * 0.9);                            /* tiles per ms */
  }
  var dx = e.x - e.px, dy = e.y - e.py, d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-3) { e.px = e.x; e.py = e.y; return; }
  var step = Math.min(d, (e.spd || 1 / TURN_MS) * dt);
  e.px += dx / d * step; e.py += dy / d * step;
}

function render(dt) {
  smooth(hero, dt);
  for (var i = 0; i < mobs.length; i++) smooth(mobs[i], dt);
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
    var idx = yy * W + xx, dx2 = xx * TILE + ox, dy2 = yy * TILE + oy;
    if (!world.seen[idx]) { rect(ctx, dx2, dy2, TILE, TILE, '#05070c'); continue; }
    ctx.drawImage(sheet, world.variant[idx] * TILE, world.tiles[idx] * TILE, TILE, TILE, dx2, dy2, TILE, TILE);
    if (world.vis[idx] !== tick) rect(ctx, dx2, dy2, TILE, TILE, 'rgba(4,6,12,.58)');
  }
  var ents = [], a;
  for (a = 0; a < items.length; a++) if (items[a].known) ents.push({ y: items[a].y, d: items[a], k: 'i' });
  for (a = 0; a < mobs.length; a++) {
    var mm3 = mobs[a];
    if (visibleAt(mm3.x, mm3.y)) ents.push({ y: mm3.py, d: mm3, k: 'm' });
    else if (knownMob(mm3)) ents.push({ y: mm3.ly, d: mm3, k: 'g' });
  }
  ents.push({ y: hero.py, d: hero, k: 'h' });
  ents.sort(function (p, q) { return p.y - q.y; });
  for (a = 0; a < ents.length; a++) {
    var o = ents[a].d;
    if (ents[a].k === 'i') drawItem(o, o.x * TILE + ox, o.y * TILE + oy);
    else if (ents[a].k === 'm') drawMob(o, o.px * TILE + ox, o.py * TILE + oy);
    else if (ents[a].k === 'g') {
      ctx.globalAlpha = 0.26;                                  /* a memory, not a sighting */
      drawMob(o, o.lx * TILE + ox, o.ly * TILE + oy);
      ctx.globalAlpha = 1;
    } else drawHero(o.px * TILE + ox, o.py * TILE + oy);
  }
  for (var fi = fx.length - 1; fi >= 0; fi--) {              /* impact effects */
    var F = fx[fi]; F.t += dt / (F.kind === 'chain' ? 300 : 430);
    if (F.t >= 1) { fx.splice(fi, 1); continue; }
    ctx.globalAlpha = 1 - F.t;
    if (F.kind === 'ring') {
      var rr = F.r * TILE * (0.25 + F.t * 0.95);
      ctx.strokeStyle = F.col; ctx.lineWidth = 4 * (1 - F.t) + 1;
      ctx.beginPath(); ctx.arc(F.x * TILE + ox + 12, F.y * TILE + oy + 12, rr, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = (1 - F.t) * 0.35; ctx.fillStyle = F.col;
      ctx.beginPath(); ctx.arc(F.x * TILE + ox + 12, F.y * TILE + oy + 12, rr * 0.8, 0, 6.2832); ctx.fill();
    } else {
      ctx.strokeStyle = F.col; ctx.lineWidth = 2;
      var jx = F.x0 * TILE + ox + 12, jy = F.y0 * TILE + oy + 12;
      var kx = F.x1 * TILE + ox + 12, ky = F.y1 * TILE + oy + 12;
      ctx.beginPath(); ctx.moveTo(jx, jy);
      for (var seg = 1; seg <= 4; seg++) {
        var tt = seg / 4;
        ctx.lineTo(lerp(jx, kx, tt) + (seg < 4 ? (Math.random() * 10 - 5) : 0),
                   lerp(jy, ky, tt) + (seg < 4 ? (Math.random() * 10 - 5) : 0));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  for (var sh = shots.length - 1; sh >= 0; sh--) {            /* arrows in flight */
    var S2 = shots[sh]; S2.t += dt / 190;
    if (S2.t >= 1) { shots.splice(sh, 1); continue; }
    var ax0 = S2.x0 * TILE + ox + 12, ay0 = S2.y0 * TILE + oy + 12;
    var ax1 = S2.x1 * TILE + ox + 12, ay1 = S2.y1 * TILE + oy + 12;
    var px3 = lerp(ax0, ax1, S2.t), py3 = lerp(ay0, ay1, S2.t);
    var vx = ax1 - ax0, vy = ay1 - ay0, len = Math.max(1, Math.sqrt(vx * vx + vy * vy));
    vx /= len; vy /= len;
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px3 - vx * 9, py3 - vy * 9); ctx.lineTo(px3, py3); ctx.stroke();
    ctx.strokeStyle = S2.col; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px3 - vx * 9, py3 - vy * 9); ctx.lineTo(px3, py3); ctx.stroke();
    rect(ctx, px3 - 1, py3 - 1, 3, 3, S2.col);
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
  hero.shoot = Math.max(0, (hero.shoot || 0) - dt / 220);
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
  stats = { kills: 0, bosses: 0, deaths: 0, wins: 0, best: 1, unstuck: 0, shots: 0, specials: 0, boats: 0, wrecks: 0, killers: {} };
  log = []; tick = 0; shake = 0; run = null; hero = null;
  mobs = []; items = []; floats = []; shots = []; fx = [];
  setPhase('play', 0);
  say('lunchquest — the hero needs no player');
  var sq = typeof location !== 'undefined' ? /seed=([0-9a-f]+)/i.exec(location.search || '') : null;
  newRun(sq ? parseInt(sq[1], 16) : undefined);
  var q = typeof location !== 'undefined' && location.search ? /card=(\w+)/.exec(location.search) : null;
  if (q) { setPhase(q[1], 100000); phase.t = 42000; }          /* card preview for screenshots */
  if (typeof location !== 'undefined' && /parade/.test(location.search || '')) parade();
  if (typeof location !== 'undefined' && /kit/.test(location.search || '')) {
    hero.gear = { sword: 4, shield: 4, armor: 4, bow: 4, axe: 4 };
    hero.affix = { sword: 'vampiric', shield: 'sturdy', armor: 'warded', bow: 'keen', axe: 'swift' };
    recalc(hero); hero.hp = hero.max;
    hero.arrows = QUIVER_MAX; hero.ammo = { fire: 9, frost: 9, shock: 9 };
    hero.wood = 20; hero.boat = 1; hero.boatHp = 3;
  }
  var fq = typeof location !== 'undefined' ? /floor=(\d)/.exec(location.search || '') : null;
  if (fq) { run.floor = clamp(+fq[1], 1, FLOORS); buildFloor(run.floor); }
}
/* dev: line the whole bestiary up next to the hero */
function parade() {
  parading = 1;
  world.seen.fill(1); world.seenCount = W * H;
  world.fog.getContext('2d').drawImage(world.mini, 0, 0);
  mobs.length = 0;
  var all = BOSSES.concat(SEABOSSES).concat([LICH]);
  for (var i = 0; i < all.length; i++) {
    var B = all[i], x = hero.x - 8 + (i % 5) * 4, y = hero.y - 6 + ((i / 5) | 0) * 5;
    var m = new Mob(B, x, y, FLOORS, 1);
    m.hp = m.max = B.hp; m.atk = 0; m.ev = 99; m.wake = i === 0 ? 1 : 0;
    mobs.push(m);
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
  state: function () { return { hero: hero, mobs: mobs, items: items, stats: stats, run: run, phase: phase, tick: tick, log: log }; }
};
})();
