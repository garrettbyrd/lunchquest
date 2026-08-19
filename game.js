/* Lunchquest — a tiny self-playing 2D RPG.
   Procedural worldgen, procedural textures, BFS-driven autopilot hero.
   No external assets, no dependencies. */
(function () {
'use strict';

/* ---------------- tiny utils ---------------- */
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

/* value-noise with fBm octaves, tileable on a 256 grid */
function makeNoise(rnd) {
  var N = 256, g = new Float32Array(N * N);
  for (var i = 0; i < g.length; i++) g[i] = rnd();
  function at(x, y) { return g[(y & 255) * N + (x & 255)]; }
  function smooth(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
    var sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    var a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }
  return function (x, y, oct, f) {
    var v = 0, amp = 1, tot = 0;
    for (var o = 0; o < oct; o++) { v += smooth(x * f, y * f) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return v / tot;
  };
}

/* ---------------- constants ---------------- */
var TILE = 24, W = 100, H = 100;
var CW = 960, CH = 540, VPW = 716, VPH = 540;      /* viewport vs. HUD panel */
var DEEP = 0, WATER = 1, SAND = 2, GRASS = 3, TALL = 4, TREE = 5, ROCK = 6, PATH = 7, FLOWER = 8;
var WALK = [0, 0, 1, 1, 1, 0, 0, 1, 1];
var MINI = [ '#12283f','#1d5b91','#d8c48c','#3f8a3f','#4fa04a','#245227','#7d7f86','#b09a6d','#5aa84e' ];
var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
var VARIANTS = 4;
var TURN_MS = 145;

/* ---------------- procedural tile textures ---------------- */
var sheet = null;
function rect(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
function buildSheet() {
  var cv = document.createElement('canvas');
  cv.width = TILE * VARIANTS; cv.height = TILE * 9;
  var g = cv.getContext('2d'), rnd = mulberry32(0xC0FFEE);
  var base = ['#12283f', '#1d5b91', '#d6c189', '#3d8a3f', '#48993f', '#245227', '#797b82', '#ab9468', '#3d8a3f'];
  for (var t = 0; t < 9; t++) {
    for (var v = 0; v < VARIANTS; v++) {
      var ox = v * TILE, oy = t * TILE, i, x, y;
      rect(g, ox, oy, TILE, TILE, base[t]);
      for (i = 0; i < 46; i++) {                       /* dither grain */
        x = ox + (rnd() * TILE | 0); y = oy + (rnd() * TILE | 0);
        g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '0,0,0,' : '255,255,255,') + (0.03 + rnd() * 0.06).toFixed(3) + ')';
        g.fillRect(x, y, 2, 2);
      }
      if (t === DEEP || t === WATER) {
        for (i = 0; i < 3; i++) {
          x = ox + (rnd() * (TILE - 10) | 0); y = oy + 3 + (rnd() * (TILE - 6) | 0);
          rect(g, x, y, 6 + (rnd() * 4 | 0), 1, t === DEEP ? 'rgba(150,200,255,.16)' : 'rgba(200,235,255,.30)');
        }
      } else if (t === SAND) {
        for (i = 0; i < 10; i++) rect(g, ox + (rnd() * TILE | 0), oy + (rnd() * TILE | 0), 1, 1, 'rgba(120,90,50,.35)');
      } else if (t === GRASS || t === TALL) {
        var n = t === TALL ? 12 : 6, hh = t === TALL ? 5 : 3;
        for (i = 0; i < n; i++) {
          x = ox + 1 + (rnd() * (TILE - 2) | 0); y = oy + 2 + (rnd() * (TILE - hh - 2) | 0);
          rect(g, x, y, 1, hh, rnd() < 0.5 ? 'rgba(0,50,0,.35)' : 'rgba(160,235,120,.30)');
        }
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
        var cx = ox + 12, cy = oy + 11;
        for (i = 0; i < 9; i++) {
          var bx = cx + (rnd() * 14 - 7 | 0), by = cy + (rnd() * 12 - 7 | 0);
          g.fillStyle = i % 3 === 0 ? '#3f7f38' : (i % 3 === 1 ? '#2f6a2c' : '#4d9440');
          g.beginPath(); g.arc(bx, by, 4 + rnd() * 3, 0, 6.2832); g.fill();
        }
      } else if (t === ROCK) {
        for (i = 0; i < 5; i++) {
          x = ox + (rnd() * (TILE - 8) | 0); y = oy + (rnd() * (TILE - 8) | 0);
          var w2 = 5 + (rnd() * 7 | 0), h2 = 4 + (rnd() * 7 | 0);
          rect(g, x, y, w2, h2, rnd() < 0.5 ? '#8d9098' : '#63666d');
          rect(g, x, y, w2, 1, 'rgba(255,255,255,.22)');
          rect(g, x, y + h2 - 1, w2, 1, 'rgba(0,0,0,.28)');
        }
      } else if (t === PATH) {
        for (i = 0; i < 8; i++) rect(g, ox + (rnd() * (TILE - 3) | 0), oy + (rnd() * (TILE - 3) | 0), 2 + (rnd() * 2 | 0), 2, rnd() < 0.5 ? 'rgba(255,255,255,.14)' : 'rgba(70,50,25,.30)');
      }
    }
  }
  sheet = cv;
}

/* ---------------- world ---------------- */
var world = null;

function genWorld(seed) {
  var rnd = mulberry32(seed);
  var n1 = makeNoise(mulberry32(seed ^ 0x9E3779B9));
  var n2 = makeNoise(mulberry32(seed ^ 0x85EBCA6B));
  var tiles = new Uint8Array(W * H), variant = new Uint8Array(W * H);
  var x, y, i;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var e = n1(x, y, 5, 0.055), m = n2(x, y, 4, 0.085);
    var dx = (x / (W - 1) - 0.5) * 2, dy = (y / (H - 1) - 0.5) * 2;
    var d = Math.sqrt(dx * dx + dy * dy);
    e = e * 1.08 - Math.max(0, d - 0.50) * 1.6;       /* island falloff */
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

  /* connected-component fill to find the main landmass */
  var comp = new Int32Array(W * H).fill(-1), best = -1, bestN = 0, comps = [];
  var q = new Int32Array(W * H);
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
  if (best < 0 || bestN < 400) return null;            /* reject dud seeds */
  var land = comps[best];

  /* drunken-walk trails between random landmarks, for readable structure */
  for (var p = 0; p < 4; p++) {
    var a = land[rnd() * land.length | 0], b = land[rnd() * land.length | 0];
    var ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W, guard = 0;
    while ((ax !== bx || ay !== by) && guard++ < 900) {
      if (WALK[tiles[ay * W + ax]] && tiles[ay * W + ax] !== SAND) tiles[ay * W + ax] = PATH;
      if (rnd() < 0.75) { if (Math.abs(bx - ax) > Math.abs(by - ay)) ax += bx > ax ? 1 : -1; else ay += by > ay ? 1 : -1; }
      else { if (rnd() < 0.5) ax += rnd() < 0.5 ? 1 : -1; else ay += rnd() < 0.5 ? 1 : -1; }
      ax = clamp(ax, 1, W - 2); ay = clamp(ay, 1, H - 2);
    }
  }

  /* minimap bake */
  var mm = document.createElement('canvas'); mm.width = W; mm.height = H;
  var mg = mm.getContext('2d');
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) { mg.fillStyle = MINI[tiles[y * W + x]]; mg.fillRect(x, y, 1, 1); }

  return { seed: seed, tiles: tiles, variant: variant, comp: comp, land: land, mainComp: best, mini: mm, rnd: rnd };
}

function tileAt(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return ROCK;
  return world.tiles[y * W + x];
}
function walkable(x, y) { return !!WALK[tileAt(x, y)]; }

/* ---------------- state ---------------- */
var hero, mobs, items, floats, log, cam, stats, tick, idleTicks, shake, over;

var MTYPES = [
  { k: 'slime',    hp: 12, atk: 3, def: 0, ev: 2, aggro: 7,  gold: 3,  xp: 4,  col: '#6ad36f', dark: '#2f7a37' },
  { k: 'bat',      hp: 9,  atk: 4, def: 0, ev: 1, aggro: 10, gold: 5,  xp: 6,  col: '#a479d6', dark: '#5c3b85' },
  { k: 'skeleton', hp: 20, atk: 6, def: 1, ev: 2, aggro: 9,  gold: 9,  xp: 10, col: '#e8e4d5', dark: '#8b8776' },
  { k: 'ogre',     hp: 34, atk: 9, def: 2, ev: 3, aggro: 7,  gold: 18, xp: 18, col: '#9a7350', dark: '#5c452e' }
];

function say(msg) { log.push(msg); if (log.length > 7) log.shift(); }

function newHero() {
  return { x: 0, y: 0, px: 0, py: 0, hp: 34, max: 34, atk: 5, def: 1, lvl: 1, xp: 0, next: 20,
           gold: 0, kills: 0, face: 2, swing: 0, hurt: 0, intent: 'waking up', goal: null };
}

function freeSpot(rnd, minDistFrom, minDist) {
  for (var tries = 0; tries < 400; tries++) {
    var c = world.land[rnd() * world.land.length | 0];
    var x = c % W, y = (c - x) / W;
    if (occupied(x, y)) continue;
    if (minDistFrom && Math.abs(x - minDistFrom.x) + Math.abs(y - minDistFrom.y) < minDist) continue;
    return { x: x, y: y };
  }
  var c2 = world.land[0];
  return { x: c2 % W, y: (c2 - c2 % W) / W };
}
function occupied(x, y) {
  if (hero && hero.x === x && hero.y === y) return true;
  for (var i = 0; i < mobs.length; i++) if (mobs[i].x === x && mobs[i].y === y) return true;
  return false;
}

function newWorld(depth, keepHero) {
  var seed, w = null, attempt = 0;
  do { seed = (Math.random() * 0x7FFFFFFF) | 0; w = genWorld(seed); } while (!w && ++attempt < 30);
  if (!w) w = genWorld(12345);
  world = w;
  var rnd = w.rnd;
  mobs = []; items = []; floats = [];
  if (!keepHero) hero = newHero();
  var spot = freeSpot(rnd, null, 0);
  hero.x = spot.x; hero.y = spot.y; hero.px = spot.x; hero.py = spot.y; hero.goal = null;

  var pool = [];
  for (var i = 0; i < MTYPES.length; i++) {
    var weight = clamp(4 - Math.abs(i - Math.min(3, (depth - 1) * 0.7)) * 2, 0, 4) | 0;
    for (var j = 0; j < weight + (i === 0 ? 1 : 0); j++) pool.push(i);
  }
  if (!pool.length) pool.push(0);

  var nmob = Math.min(34, 9 + depth * 2);
  for (var m = 0; m < nmob; m++) {
    var ti = pool[rnd() * pool.length | 0], T = MTYPES[ti];
    var s = freeSpot(rnd, hero, 9);
    var scale = 1 + 0.16 * (depth - 1);
    mobs.push({ t: T, x: s.x, y: s.y, px: s.x, py: s.y,
                hp: Math.round(T.hp * scale), max: Math.round(T.hp * scale),
                atk: T.atk + ((depth / 2) | 0), def: T.def, ev: T.ev,
                face: 2, hurt: 0, swing: 0, wake: 0 });
  }
  for (var c = 0; c < 4 + (depth % 3); c++) { var cs = freeSpot(rnd, hero, 4); items.push({ kind: 'chest', x: cs.x, y: cs.y, bob: rnd() * 6 }); }
  for (var pn = 0; pn < 4; pn++) { var ps = freeSpot(rnd, hero, 3); items.push({ kind: 'potion', x: ps.x, y: ps.y, bob: rnd() * 6 }); }

  cam = { x: hero.x * TILE - VPW / 2, y: hero.y * TILE - VPH / 2 };
  idleTicks = 0; over = 0;
  say('· depth ' + depth + ' · seed ' + (w.seed >>> 0).toString(16) + ' · ' + nmob + ' hostiles');
}

/* ---------------- pathfinding (BFS with stamped visit buffer) ---------------- */
var visit = new Int32Array(W * H), prev = new Int32Array(W * H), stamp = 0;
var bq = new Int32Array(W * H);
function stepToward(sx, sy, tx, ty, budget) {
  if (sx === tx && sy === ty) return null;
  stamp++;
  var start = sy * W + sx, goal = ty * W + tx, qh = 0, qt = 0, n = 0, found = false;
  visit[start] = stamp; prev[start] = start; bq[qt++] = start;
  while (qh < qt && n++ < budget) {
    var cur = bq[qh++];
    if (cur === goal) { found = true; break; }
    var cx = cur % W, cy = (cur - cx) / W;
    for (var d = 0; d < 4; d++) {
      var nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      var ni = ny * W + nx;
      if (visit[ni] === stamp) continue;
      if (ni !== goal && (!walkable(nx, ny) || occupied(nx, ny))) continue;
      visit[ni] = stamp; prev[ni] = cur; bq[qt++] = ni;
    }
  }
  if (!found) return null;
  var c = goal, guard = 0;
  while (prev[c] !== start && guard++ < W * H) c = prev[c];
  var fx = c % W, fy = (c - fx) / W;
  return { x: fx - sx, y: fy - sy };
}

/* ---------------- combat + turns ---------------- */
function fl(x, y, txt, col) { floats.push({ x: x, y: y, txt: txt, col: col, t: 0 }); }
function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function heroAttack(mob) {
  hero.face = mob.x > hero.x ? 1 : mob.x < hero.x ? 3 : mob.y > hero.y ? 2 : 0;
  hero.swing = 1;
  var dmg = Math.max(1, hero.atk + (Math.random() * 4 | 0) - mob.def);
  mob.hp -= dmg; mob.hurt = 1; mob.wake = 1;
  fl(mob.x, mob.y, '-' + dmg, '#ffd166');
  if (mob.hp <= 0) {
    mobs.splice(mobs.indexOf(mob), 1);
    hero.gold += mob.t.gold; hero.kills++; stats.kills++; stats.gold += mob.t.gold;
    hero.xp += mob.t.xp;
    say('slew a ' + mob.t.k + ' (+' + mob.t.gold + 'g)');
    fl(mob.x, mob.y, '*', '#ffe9a8');
    while (hero.xp >= hero.next) {
      hero.xp -= hero.next; hero.lvl++; hero.next = Math.round(hero.next * 1.55);
      hero.max += 7; hero.hp = hero.max; hero.atk += 2; if (hero.lvl % 3 === 0) hero.def++;
      say('LEVEL UP → ' + hero.lvl);
      fl(hero.x, hero.y, 'LVL ' + hero.lvl, '#8ef2a0');
    }
    idleTicks = 0;
  }
}
function mobAttack(mob) {
  mob.swing = 1;
  mob.face = hero.x > mob.x ? 1 : hero.x < mob.x ? 3 : hero.y > mob.y ? 2 : 0;
  var dmg = Math.max(1, mob.atk + (Math.random() * 3 | 0) - hero.def);
  hero.hp -= dmg; hero.hurt = 1; shake = 3;
  fl(hero.x, hero.y, '-' + dmg, '#ff6b6b');
  if (hero.hp <= 0) {
    hero.hp = 0;
    say('the hero has fallen at depth ' + stats.depth);
    over = 1; stats.deaths++;
  }
}

function tryMove(e, dx, dy) {
  var nx = e.x + dx, ny = e.y + dy;
  if (!walkable(nx, ny) || occupied(nx, ny)) return false;
  e.x = nx; e.y = ny;
  e.face = dy < 0 ? 0 : dy > 0 ? 2 : dx > 0 ? 1 : 3;
  return true;
}

function nearest(list, filter) {
  var best = null, bd = 1e9;
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (filter && !filter(o)) continue;
    var d = dist(hero, o);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { o: best, d: bd } : null;
}

/* the decision loop: heal → fight → loot → explore */
function heroTurn() {
  var lowHp = hero.hp / hero.max < 0.45;
  var potion = nearest(items, function (i) { return i.kind === 'potion'; });
  var mob = nearest(mobs, null);
  var chest = nearest(items, function (i) { return i.kind === 'chest'; });
  var target = null, why = '';

  if (lowHp && potion && potion.d < 26) { target = potion.o; why = 'wounded — seeking a potion'; }
  else if (mob && mob.d <= 1) { hero.intent = 'fighting a ' + mob.o.t.k; heroAttack(mob.o); return; }
  else if (mob && mob.d <= 16 && !lowHp) { target = mob.o; why = 'hunting a ' + mob.o.t.k; }
  else if (chest && chest.d < 30) { target = chest.o; why = 'looting a chest'; }
  else if (potion && hero.hp < hero.max * 0.9) { target = potion.o; why = 'grabbing a potion'; }
  else if (mob) { target = mob.o; why = 'tracking a ' + mob.o.t.k; }

  if (!target) {                                          /* wander/explore */
    if (!hero.goal || (hero.x === hero.goal.x && hero.y === hero.goal.y)) hero.goal = freeSpot(Math.random, hero, 12);
    target = hero.goal; why = 'exploring';
  }
  hero.intent = why;

  var st = stepToward(hero.x, hero.y, target.x, target.y, 12000);
  if (!st) { hero.goal = null; idleTicks += 2; return; }
  if (target.x === hero.x + st.x && target.y === hero.y + st.y && target.kind === undefined) {
    heroAttack(target); return;                           /* stepping onto a mob = attack */
  }
  if (!tryMove(hero, st.x, st.y)) { idleTicks += 2; return; }

  /* pickups */
  for (var i = items.length - 1; i >= 0; i--) {
    var it = items[i];
    if (it.x !== hero.x || it.y !== hero.y) continue;
    if (it.kind === 'potion' && hero.hp > hero.max * 0.92) continue;   /* save it for later */
    items.splice(i, 1); idleTicks = 0;
    if (it.kind === 'potion') {
      var heal = Math.min(hero.max - hero.hp, 18 + hero.lvl * 3);
      hero.hp += heal; fl(hero.x, hero.y, '+' + heal, '#8ef2a0'); say('drank a potion (+' + heal + ' hp)');
    } else {
      var g = 12 + (Math.random() * 20 | 0) + stats.depth * 4;
      hero.gold += g; stats.gold += g; fl(hero.x, hero.y, '+' + g + 'g', '#ffe9a8'); say('opened a chest (+' + g + 'g)');
    }
  }
}

function mobTurn(mob) {
  var d = dist(mob, hero);
  if (d <= mob.t.aggro) mob.wake = 1;
  if (!mob.wake) { if (Math.random() < 0.25) tryMove(mob, DX[Math.random() * 4 | 0], DY[Math.random() * 4 | 0]); return; }
  if (d <= 1) { mobAttack(mob); return; }
  if (d > mob.t.aggro + 6) { mob.wake = 0; return; }
  var st = stepToward(mob.x, mob.y, hero.x, hero.y, 900);
  if (st) tryMove(mob, st.x, st.y);
  else tryMove(mob, hero.x > mob.x ? 1 : hero.x < mob.x ? -1 : 0, 0) || tryMove(mob, 0, hero.y > mob.y ? 1 : -1);
}

function doTurn() {
  tick++; idleTicks++;
  if (over) {
    over++;
    if (over > 16) { stats.runs++; stats.depth = 1; say('a new hero takes up the quest'); newWorld(1, false); }
    return;
  }
  heroTurn();
  if (over) return;
  for (var i = mobs.length - 1; i >= 0; i--) {
    var m = mobs[i];
    if (m.hp <= 0) continue;
    if (tick % m.ev === 0) mobTurn(m);
    if (over) return;
  }
  var chestsLeft = 0;
  for (var c2 = 0; c2 < items.length; c2++) if (items[c2].kind === 'chest') chestsLeft++;
  if (!mobs.length && !chestsLeft) {
    stats.depth++; stats.cleared++;
    say('region cleared — travelling onward');
    hero.hp = Math.min(hero.max, hero.hp + Math.round(hero.max * 0.4));
    newWorld(stats.depth, true);
  } else if (idleTicks > 700) {
    say('the trail went cold — new lands');
    newWorld(stats.depth, true);
  }
}

/* ---------------- rendering ---------------- */
var cv = document.getElementById('c'), ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

function drawHero(sx, sy) {
  var bob = Math.sin(tick * 0.9 + performance.now() / 260) * 0.8;
  var y = sy + bob;
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(sx + 12, sy + 21, 8, 3.5, 0, 0, 6.2832); ctx.fill();
  var tint = hero.hurt > 0;
  rect(ctx, sx + 7, y + 10, 10, 9, tint ? '#ff9d9d' : '#3a6fd8');   /* tunic */
  rect(ctx, sx + 7, y + 19, 3, 3, '#2b2b38'); rect(ctx, sx + 14, y + 19, 3, 3, '#2b2b38');
  rect(ctx, sx + 7, y + 3, 10, 8, '#f0c39a');                        /* head */
  rect(ctx, sx + 6, y + 2, 12, 3, '#6a3f22');                        /* hair */
  if (hero.face === 2) { rect(ctx, sx + 9, y + 7, 2, 2, '#22222c'); rect(ctx, sx + 13, y + 7, 2, 2, '#22222c'); }
  else if (hero.face === 1) rect(ctx, sx + 13, y + 7, 2, 2, '#22222c');
  else if (hero.face === 3) rect(ctx, sx + 9, y + 7, 2, 2, '#22222c');
  if (hero.swing > 0) {                                              /* sword arc */
    var ax = sx + 12 + DX[hero.face] * 13, ay = y + 13 + DY[hero.face] * 13;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + 0.5 * hero.swing) + ')';
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ax, ay, 7 * hero.swing + 2, 0, 6.2832); ctx.stroke();
    rect(ctx, ax - 1, ay - 1, 3, 3, '#e8ecf5');
  }
}

function drawMob(m, sx, sy) {
  var t = m.t, wob = Math.sin(performance.now() / 200 + m.x * 1.3 + m.y) * 1.4;
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(sx + 12, sy + 21, 7, 3, 0, 0, 6.2832); ctx.fill();
  var col = m.hurt > 0 ? '#ffffff' : t.col;
  if (t.k === 'slime') {
    ctx.fillStyle = col; ctx.beginPath();
    ctx.ellipse(sx + 12, sy + 15 + wob * 0.3, 9, 7 - wob * 0.3, 0, 0, 6.2832); ctx.fill();
    rect(ctx, sx + 8, sy + 13, 2, 2, '#12321a'); rect(ctx, sx + 14, sy + 13, 2, 2, '#12321a');
  } else if (t.k === 'bat') {
    ctx.fillStyle = col;
    var sp = Math.abs(Math.sin(performance.now() / 90)) * 5 + 3;
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 12 + wob); ctx.lineTo(sx + 12 - 10, sy + 12 - sp + wob); ctx.lineTo(sx + 12 - 3, sy + 15 + wob); ctx.fill();
    ctx.beginPath(); ctx.moveTo(sx + 12, sy + 12 + wob); ctx.lineTo(sx + 12 + 10, sy + 12 - sp + wob); ctx.lineTo(sx + 12 + 3, sy + 15 + wob); ctx.fill();
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
    rect(ctx, sx + 9, sy + 8, 6, 1, '#3a2415');
    rect(ctx, sx + 18, sy + 6, 4, 14, t.dark);
  }
  if (m.hp < m.max) {                                                /* health pip bar */
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
    rect(ctx, sx + 4, sy + 10 + bob * 0.3, 16, 10, '#8a5a2b');
    rect(ctx, sx + 4, sy + 7 + bob * 0.3, 16, 4, '#a86e35');
    rect(ctx, sx + 4, sy + 13 + bob * 0.3, 16, 2, '#d9b45c');
    rect(ctx, sx + 11, sy + 12 + bob * 0.3, 3, 4, '#ffe9a8');
  } else {
    rect(ctx, sx + 9, sy + 6 + bob, 6, 3, '#cfd6e4');
    rect(ctx, sx + 8, sy + 9 + bob, 8, 9, '#ff5c7a');
    rect(ctx, sx + 10, sy + 11 + bob, 2, 4, 'rgba(255,255,255,.55)');
  }
}

function bar(x, y, w, h, frac, col, bg) {
  rect(ctx, x, y, w, h, bg || 'rgba(255,255,255,.10)');
  rect(ctx, x, y, Math.max(0, Math.round(w * clamp(frac, 0, 1))), h, col);
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
}

function drawHUD() {
  var X = VPW, PW = CW - VPW;
  rect(ctx, X, 0, PW, CH, '#10141c');
  rect(ctx, X, 0, 2, CH, '#2a3547');
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e6ecf7'; ctx.font = 'bold 15px ui-monospace, monospace';
  ctx.fillText('LUNCHQUEST', X + 14, 12);
  ctx.font = '10px ui-monospace, monospace'; ctx.fillStyle = '#7f8ca3';
  ctx.fillText('autoplaying · seed ' + (world.seed >>> 0).toString(16), X + 14, 30);

  var y = 52;
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = '#cfd6e4';
  ctx.fillText('HP  ' + hero.hp + '/' + hero.max, X + 14, y); bar(X + 14, y + 14, PW - 28, 8, hero.hp / hero.max, '#e8506a'); y += 32;
  ctx.fillStyle = '#cfd6e4';
  ctx.fillText('XP  lvl ' + hero.lvl, X + 14, y); bar(X + 14, y + 14, PW - 28, 6, hero.xp / hero.next, '#5aa9e6'); y += 30;

  var rows = [
    ['depth', stats.depth], ['gold', hero.gold], ['kills', hero.kills],
    ['atk/def', hero.atk + '/' + hero.def], ['foes', mobs.length], ['loot', items.length],
    ['runs', stats.runs], ['cleared', stats.cleared]
  ];
  for (var i = 0; i < rows.length; i++) {
    var rx = X + 14 + (i % 2) * ((PW - 28) / 2), ry = y + ((i / 2) | 0) * 17;
    ctx.fillStyle = '#6e7b91'; ctx.fillText(rows[i][0], rx, ry);
    ctx.fillStyle = '#e6ecf7'; ctx.fillText(String(rows[i][1]), rx + 58, ry);
  }
  y += 4 * 17 + 10;

  /* minimap */
  var ms = PW - 44, mx = X + 22;
  ctx.fillStyle = '#000'; ctx.fillRect(mx - 1, y - 1, ms + 2, ms + 2);
  ctx.drawImage(world.mini, mx, y, ms, ms);
  var sc = ms / W;
  for (var k = 0; k < mobs.length; k++) { ctx.fillStyle = '#ff5c5c'; ctx.fillRect(mx + mobs[k].x * sc, y + mobs[k].y * sc, 2, 2); }
  for (var q2 = 0; q2 < items.length; q2++) { ctx.fillStyle = items[q2].kind === 'chest' ? '#ffd166' : '#8ef2a0'; ctx.fillRect(mx + items[q2].x * sc, y + items[q2].y * sc, 2, 2); }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(mx + hero.x * sc - 1, y + hero.y * sc - 1, 4, 4);
  ctx.strokeStyle = '#2a3547'; ctx.strokeRect(mx - 1.5, y - 1.5, ms + 3, ms + 3);
  y += ms + 12;

  ctx.fillStyle = '#8ef2a0'; ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(('› ' + hero.intent).slice(0, 28), X + 14, y); y += 18;
  ctx.fillStyle = '#5f6b80';
  for (var L = 0; L < log.length; L++) {
    ctx.fillStyle = L === log.length - 1 ? '#aab6c9' : 'rgba(150,163,185,' + (0.28 + 0.06 * L) + ')';
    ctx.fillText(log[L].slice(0, 28), X + 14, y + L * 14);
  }

  if (over) {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, VPW, CH);
    ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 34px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.fillText('THE HERO HAS FALLEN', VPW / 2, CH / 2 - 24);
    ctx.fillStyle = '#cfd6e4'; ctx.font = '14px ui-monospace, monospace';
    ctx.fillText('depth ' + stats.depth + ' · lvl ' + hero.lvl + ' · ' + hero.gold + ' gold · a new hero rises…', VPW / 2, CH / 2 + 18);
    ctx.textAlign = 'left';
  }
}

function smooth(e, k) {
  if (Math.abs(e.px - e.x) > 2 || Math.abs(e.py - e.y) > 2) { e.px = e.x; e.py = e.y; return; }
  e.px = lerp(e.px, e.x, k); e.py = lerp(e.py, e.y, k);
}

function render(dt) {
  /* interpolate toward true tile positions, but snap if we fell far behind
     (sparse frames while the tab was hidden) so the view never lies */
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
    var idx = yy * W + xx, tt = world.tiles[idx], vv = world.variant[idx];
    ctx.drawImage(sheet, vv * TILE, tt * TILE, TILE, TILE, xx * TILE + ox, yy * TILE + oy, TILE, TILE);
  }
  /* entities, painter-sorted */
  var ents = [];
  for (var a = 0; a < items.length; a++) ents.push({ y: items[a].y, d: items[a], k: 'i' });
  for (var b = 0; b < mobs.length; b++) ents.push({ y: mobs[b].py, d: mobs[b], k: 'm' });
  ents.push({ y: hero.py, d: hero, k: 'h' });
  ents.sort(function (p, q) { return p.y - q.y; });
  for (var e = 0; e < ents.length; e++) {
    var o = ents[e].d;
    if (ents[e].k === 'i') drawItem(o, o.x * TILE + ox, o.y * TILE + oy);
    else if (ents[e].k === 'm') drawMob(o, o.px * TILE + ox, o.py * TILE + oy);
    else drawHero(o.px * TILE + ox, o.py * TILE + oy);
  }
  /* floating combat text */
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
  /* vignette */
  var gr = ctx.createRadialGradient(VPW / 2, CH / 2, CH * 0.30, VPW / 2, CH / 2, CH * 0.85);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.42)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, VPW, CH);
  ctx.restore();

  drawHUD();

  hero.swing = Math.max(0, hero.swing - dt / 160);
  hero.hurt = Math.max(0, hero.hurt - dt / 200);
  for (var mm2 = 0; mm2 < mobs.length; mm2++) {
    mobs[mm2].swing = Math.max(0, mobs[mm2].swing - dt / 160);
    mobs[mm2].hurt = Math.max(0, mobs[mm2].hurt - dt / 200);
  }
  shake = Math.max(0, shake - dt / 90);
}

/* ---------------- boot + loop ---------------- */
function boot() {
  buildSheet();
  stats = { depth: 1, runs: 1, kills: 0, gold: 0, cleared: 0, deaths: 0 };
  log = []; tick = 0; shake = 0;
  hero = null; mobs = []; items = []; floats = [];
  say('lunchquest online — the hero needs no player');
  newWorld(1, false);
}

var last = 0;
function frame(now) {
  if (!last) last = now;
  var dt = Math.min(80, now - last); last = now;
  render(dt);
  requestAnimationFrame(frame);
}

/* the simulation runs on its own clock so it keeps playing even when the
   compositor throttles animation frames (background tab, headless, etc.) */
function simStep() {
  try { doTurn(); }
  catch (err) {
    say('the world convulsed — reforming'); stats.depth = Math.max(1, stats.depth);
    try { newWorld(stats.depth, false); } catch (e2) { /* next tick tries again */ }
  }
}

boot();
setInterval(simStep, TURN_MS);
requestAnimationFrame(frame);
if (typeof window !== 'undefined') window.LQ = { hero: function(){return hero}, mobs: function(){return mobs}, stats: function(){return stats}, tick: function(){return tick} };
if (typeof module !== 'undefined') module.exports = { doTurn: function(){ return doTurn(); }, state: function(){ return { hero: hero, mobs: mobs, items: items, stats: stats }; } };
})();
