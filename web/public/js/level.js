// Googly TK — endless level generator. Every level number always builds the same towers (seeded),
// and the towers get taller, heavier, further away and trickier the higher you climb.
// Pure data: no three.js, no physics, so the browser and the node tests share it.

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const THEMES = [
  { id: 'meadow', name: 'Green Meadow' },
  { id: 'autumn', name: 'Autumn Valley' },
  { id: 'desert', name: 'Red Rock Desert' },
  { id: 'snow', name: 'Frozen Peaks' },
];
export const themeOf = n => Math.floor((n - 1) / 5) % THEMES.length;

// every block: { shape: 'box', h: [hx,hy,hz] } or { shape: 'cyl', r, hh }, mat, p (relative to pedestal top centre), yaw
const GAP = 0.004;   // hairline gaps so nothing starts overlapping (overlaps make stacks explode on the first frame)
function box(mat, hx, hy, hz, x, y, z, yaw = 0) { return { shape: 'box', h: [hx, hy, hz], mat, p: [x, y, z], yaw }; }
function cyl(mat, r, hh, x, y, z) { return { shape: 'cyl', r, hh, mat, p: [x, y, z], yaw: 0 }; }

// ---------------------------------------------------------------- structures
// Each returns { blocks, fx, fz } with fx/fz the half-size of its footprint.
function jenga(R, layers, mat) {
  const t = 0.18, w = 0.3, L = 0.9, blocks = [];
  for (let i = 0; i < layers; i++) {
    const y = t / 2 + i * (t + GAP), m = typeof mat === 'function' ? mat(i) : mat;
    for (let k = -1; k <= 1; k++) {
      if (i > 2 && R() < 0.12) continue;                      // pulled-out pieces, like a real jenga game
      if (i % 2) blocks.push(box(m, L / 2, t / 2, w / 2 - GAP, 0, y, k * w));
      else blocks.push(box(m, w / 2 - GAP, t / 2, L / 2, k * w, y, 0));
    }
  }
  return { blocks, fx: 0.45, fz: 0.45 };
}
function pyramid(R, rows, mat, s = 0.44) {
  const blocks = [];
  for (let r = 0; r < rows; r++) {
    const n = rows - r;
    for (let k = 0; k < n; k++) {
      const m = typeof mat === 'function' ? mat(r, k) : mat;
      blocks.push(box(m, s / 2 - GAP, s / 2, s / 2 - GAP, (k - (n - 1) / 2) * s, s / 2 + r * (s + GAP), 0));
    }
  }
  return { blocks, fx: rows * s / 2, fz: s / 2 };
}
function cans(R, rows) {
  const r = 0.15, hh = 0.21, sp = 0.31, blocks = [];
  for (let row = 0; row < rows; row++) {
    const n = rows - row;
    for (let k = 0; k < n; k++) blocks.push(cyl('metal', r, hh, (k - (n - 1) / 2) * sp, hh + row * (hh * 2 + GAP), 0));
  }
  return { blocks, fx: rows * sp / 2, fz: r };
}
function house(R, floors, mat, glass) {
  const blocks = [], ph = 0.45, pw = 0.1, S = 0.5, st = 0.07;
  let y = 0;
  for (let f = 0; f < floors; f++) {
    const m = typeof mat === 'function' ? mat(f) : mat;
    for (const x of [-S, S]) for (const z of [-S, S]) blocks.push(box(m, pw, ph, pw, x, y + ph, z));
    if (glass && R() < 0.7) blocks.push(box('glass', S - pw - GAP * 3, ph - 0.02, 0.035, 0, y + ph - 0.02 + GAP, S));
    y += ph * 2 + GAP;
    blocks.push(box(m === 'glass' ? 'wood' : m, S + pw + 0.02, st, S + pw + 0.02, 0, y + st, 0));
    y += st * 2 + GAP;
  }
  // a little roof pyramid
  if (R() < 0.6) { blocks.push(box(mat === 'stone' ? 'stone' : 'wood', 0.2, 0.2, 0.2, -0.22, y + 0.2, 0), box('wood', 0.2, 0.2, 0.2, 0.22, y + 0.2, 0), box('wood', 0.2, 0.2, 0.2, 0, y + 0.6 + GAP, 0)); }
  return { blocks, fx: S + pw + 0.02, fz: S + pw + 0.02 };
}
function wall(R, rows, cols, mat) {
  const bw = 0.5, bh = 0.25, bd = 0.28, blocks = [];
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0, n = r % 2 ? cols - 1 : cols;
    for (let k = 0; k < n; k++) {
      const m = typeof mat === 'function' ? mat(r, k) : mat;
      blocks.push(box(m, bw / 2 - GAP, bh / 2, bd / 2, (k - (cols - 1) / 2) * bw + off, bh / 2 + r * (bh + GAP), 0));
    }
  }
  return { blocks, fx: cols * bw / 2, fz: bd / 2 };
}
function stack(R, n, mat) {
  const blocks = []; let y = 0;
  for (let i = 0; i < n; i++) {
    const s = 0.5 - i * 0.02, m = typeof mat === 'function' ? mat(i) : mat;
    blocks.push(box(m, s / 2, s / 2, s / 2, (R() - 0.5) * 0.06, y + s / 2, (R() - 0.5) * 0.06, (R() - 0.5) * 0.5));
    y += s + GAP;
  }
  return { blocks, fx: 0.3, fz: 0.3 };
}
function fort(R, floors, mat) {
  // Angry-bird style: two pillars and a long beam, floor after floor, glass windows in the middle
  const blocks = []; let y = 0; const X = 0.7;
  for (let f = 0; f < floors; f++) {
    const m = typeof mat === 'function' ? mat(f) : mat, ph = 0.5;
    blocks.push(box(m, 0.11, ph, 0.22, -X, y + ph, 0), box(m, 0.11, ph, 0.22, X, y + ph, 0));
    if (R() < 0.6) blocks.push(box('glass', 0.035, ph - 0.03, 0.2, 0, y + ph - 0.03 + GAP, 0));
    y += ph * 2 + GAP;
    blocks.push(box(m === 'glass' ? 'wood' : m, X + 0.14, 0.08, 0.26, 0, y + 0.08, 0));
    y += 0.16 + GAP;
  }
  blocks.push(box('gold', 0.14, 0.14, 0.14, 0, y + 0.14, 0));
  return { blocks, fx: X + 0.14, fz: 0.26 };
}

// ---------------------------------------------------------------- the level
export function makeLevel(n) {
  const R = rng(n * 9973 + 1234);
  const theme = themeOf(n);
  const pick = a => a[Math.floor(R() * a.length)];
  const d = Math.min(1, (n - 1) / 40);                            // 0 → 1 difficulty ramp over the first 40 levels

  // which materials are unlocked
  const mats = ['wood'];
  if (n >= 3) mats.push('glass');
  if (n >= 6) mats.push('stone');
  if (theme === 3 && n >= 3) mats.push('ice');
  const mixMat = () => { const r = R(); return r < 0.55 ? 'wood' : pick(mats); };
  const heavy = () => (n >= 6 && R() < 0.35 ? 'stone' : theme === 3 && R() < 0.4 ? 'ice' : 'wood');

  const kinds = ['jenga', 'pyramid', 'stack'];
  if (n >= 2) kinds.push('cans');
  if (n >= 3) kinds.push('house', 'wall');
  if (n >= 5) kinds.push('fort');
  const count = Math.min(4, 1 + Math.floor(n / 4));
  const towers = [];
  const size = 0.35 + d * 0.65;                                      // 0.35 → 1: how big each structure is allowed to be

  for (let t = 0; t < count; t++) {
    const kind = t === 0 && n === 1 ? 'pyramid' : pick(kinds);
    let s;
    switch (kind) {
      case 'jenga': { const m = heavy(); s = jenga(R, 6 + Math.round(R() * 10 * size), i => (i % 4 === 3 && mats.includes('stone') && R() < 0.3 ? 'stone' : m)); break; }
      case 'pyramid': s = pyramid(R, 3 + Math.round(R() * 3 * size), () => (R() < 0.7 ? 'wood' : pick(mats))); break;
      case 'cans': s = cans(R, 3 + Math.round(R() * 2 * size)); break;
      case 'house': s = house(R, 1 + Math.round(R() * 2.4 * size), heavy(), mats.includes('glass')); break;
      case 'wall': s = wall(R, 4 + Math.round(R() * 6 * size), 3 + Math.round(R() * 3 * size), () => mixMat()); break;
      case 'stack': s = stack(R, 4 + Math.round(R() * 6 * size), () => mixMat()); break;
      case 'fort': s = fort(R, 1 + Math.round(R() * 2.5 * size), heavy()); break;
    }
    // stand the structure on a pedestal just a little bigger than it: knocking blocks OFF the pedestal is the goal
    const ped = { w: s.fx + 0.12, d: s.fz + 0.12, h: 0.6 + R() * (0.4 + d * 2.6), style: pick(['stone', 'crate', 'rock']), moving: null };
    if (n >= 14 && R() < 0.12 + d * 0.25) ped.moving = { amp: 1 + R() * 1.5, speed: 0.35 + R() * 0.35 * (0.5 + d), phase: R() * 6.28 };
    towers.push({ kind, ped, blocks: s.blocks });
  }

  // lay the towers out in front of the cannon without overlapping
  const near = 18 + d * 6, far = 26 + d * 22 + count * 2;
  const placed = [];
  for (const T of towers) {
    const r = Math.hypot(T.ped.w, T.ped.d) + (T.ped.moving ? T.ped.moving.amp : 0) + 0.8;
    for (let tries = 0; tries < 200; tries++) {
      const z = -(near + R() * (far - near)), x = (R() - 0.5) * 2 * (-z * 0.32);
      if (placed.every(o => Math.hypot(o.x - x, o.z - z) > o.r + r)) { Object.assign(T.ped, { x, z }); placed.push({ x, z, r }); break; }
      if (tries === 199) { T.ped.x = placed.length * 4 - 6; T.ped.z = -far - placed.length * 3; placed.push({ x: T.ped.x, z: T.ped.z, r }); }
    }
  }
  towers.sort((a, b) => a.ped.z - b.ped.z);

  // flatten into pedestals + blocks
  const pedestals = [], blocks = [];
  towers.forEach((T, i) => {
    pedestals.push(T.ped);
    for (const b of T.blocks) blocks.push({ ...b, ped: i });
  });

  // the googlys you get
  const total = blocks.length;
  const ammo = [];
  const shots = Math.max(3, Math.round(count * (n < 10 ? 2 : 1.6) + total / 22));
  const specials = [];
  if (n >= 4) specials.push('red');
  if (n >= 7) specials.push('blue');
  if (n >= 10) specials.push('black');
  for (let i = 0; i < shots; i++) ammo.push(specials.length && i > 0 && R() < 0.45 ? pick(specials) : 'yellow');
  // stone is heavy: make sure there are enough Big Reds to move it
  const stones = blocks.filter(b => b.mat === 'stone').length;
  for (let i = 0, want = Math.floor(stones / 12); i < ammo.length && want > ammo.filter(a => a === 'red').length; i++) if (ammo[i] === 'yellow' && i > 0) ammo[i] = 'red';
  if (n === 4) ammo[1] = 'red';
  if (n === 7) ammo[1] = 'blue';
  if (n === 10) ammo[1] = 'black';

  const need = Math.min(0.8, 0.6 + (n - 1) * 0.007);
  const wind = n >= 18 && R() < 0.5 ? { x: (R() - 0.5) * 2 * (1 + d * 1.5), z: (R() - 0.5) * 1.5 } : { x: 0, z: 0 };

  return { n, theme, seed: n * 7919 + 17, pedestals, blocks, total, ammo, need, wind, name: THEMES[theme].name };
}

// what each googly does (shown on the level card the first time you meet one)
export const GOOGLYS = {
  yellow: { name: 'Yellow Googly', color: '#ffd21f', tip: 'The classic. Brave, bouncy, a little bit dumb.' },
  red: { name: 'Big Red', color: '#e8322a', tip: 'Twice the size, four times the weight. Smashes stone.' },
  blue: { name: 'Blue Triplets', color: '#2d8cff', tip: 'Click while it flies and it splits into three.' },
  black: { name: 'Boom Googly', color: '#2a2a30', tip: 'Click while it flies (or wait after it lands) to explode.' },
};
