// Googly TK — Googly Tower Knockdown. One player, endless levels: load a googly into the cannon,
// aim, power up, and knock the towers off their pedestals.
import * as THREE from '../vendor/three.module.js';
import RAPIER from '../vendor/rapier.js';
import { makeLevel, GOOGLYS, THEMES, themeOf } from './level.js';
import { Sim, PIVOT, aimDir, muzzle, speedOf, MATS, G, AMMO } from './physics.js';
import { Googly, Cannon, canvasTex } from './googly.js';
import { buildWorld, buildMaterials, blockMesh, pedestalMesh } from './world.js';
import { initAudio, sfx, playMusic, stopMusic, settings, setVolumes, duckMusic } from './audio.js';

const Q = new URLSearchParams(location.search);
const LQ = Q.get('lq') === '1';
if (Q.get('shim') === '1') window.requestAnimationFrame = f => setTimeout(() => f(performance.now()), 16);
const $ = id => document.getElementById(id);
// phones & tablets: touch controls, lighter rendering. Desktop / the Mac app never match this.
const TOUCH = Q.get('touch') === '1' || matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
const MOB = TOUCH || Math.min(screen.width, screen.height) < 600;
if (TOUCH) document.documentElement.classList.add('touch');

// ---------------------------------------------------------------- renderer
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LQ, powerPreference: 'high-performance', preserveDrawingBuffer: Q.has('icon') });
renderer.setPixelRatio(Math.min(devicePixelRatio, LQ ? 1 : MOB ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = MOB ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2500);
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
if (MOB) { addEventListener('orientationchange', () => { resize(); setTimeout(resize, 250); setTimeout(resize, 700); }); if (window.visualViewport) visualViewport.addEventListener('resize', resize); }

await RAPIER.init();
buildMaterials(LQ);

// ---------------------------------------------------------------- save (auto-saves every 30 s)
const SAVE_KEY = 'gtk.save';
function freshSave() { return { unlocked: 1, cur: 1, stars: {}, best: {}, seen: {}, total: 0, music: 0.55, sfx: 0.9 }; }
let save = freshSave();
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.unlocked) save = { ...save, ...s }; } catch {}
settings.music = save.music; settings.sfx = save.sfx;
function persist(flash = false) {
  save.music = settings.music; save.sfx = settings.sfx;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
  if (flash) { const el = $('saved'); el.classList.add('on'); sfx.saved(); setTimeout(() => el.classList.remove('on'), 1400); }
}
setInterval(() => persist(state !== 'title'), 30000);

// ---------------------------------------------------------------- the scene objects
const cannon = new Cannon(); scene.add(cannon.group);
const fuse = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, '#ffe27a'); gr.addColorStop(0.6, 'rgba(255,120,20,.5)'); gr.addColorStop(1, 'rgba(255,80,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
fuse.position.set(0, 0.34, 0.5); fuse.scale.setScalar(0.3); fuse.visible = false; cannon.barrel.add(fuse);
const fuseLight = new THREE.PointLight(0xffa040, 0, 3); fuseLight.position.copy(fuse.position); cannon.barrel.add(fuseLight);

// trajectory preview dots
const dots = [];
const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), dotMat.clone()); m.visible = false; m.renderOrder = 5; scene.add(m); dots.push(m); }

let L = null, sim = null, world = null, worldTheme = -1, levelGroup = null;
let blockMeshes = [], pedMeshes = [], queue = [], flying = new Map();
let state = 'loading', paused = false;
let yaw = 0, pitch = 0.3, tYaw = 0, tPitch = 0.3, power = 0.6, charging = false, chargeT = 0, chargeSnd = null, loaded = false, loadAnim = null;
let ammoIdx = 0, levelScore = 0, combo = 0, comboT = 0, shotT = 0, watchT = 0, focus = new THREE.Vector3(), slow = 1, hitAny = false;
let zoom = false, towerView = false, shake = 0, clearedShown = false, finishing = false;
const camPos = new THREE.Vector3(0, 3, 6), camLook = new THREE.Vector3(0, 1, -20);

function disposeLevel() {
  if (levelGroup) { scene.remove(levelGroup); levelGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  if (sim) { sim.world.free(); sim = null; }
  flying.clear(); queue = []; blockMeshes = []; pedMeshes = [];
  clearParticles();
  $('pops').innerHTML = '';
}

function loadLevel(n) {
  disposeLevel();
  L = makeLevel(n);
  if (L.theme !== worldTheme) { if (world) world.dispose(); world = buildWorld(scene, renderer, L.theme, LQ, MOB); worldTheme = L.theme; }
  sim = new Sim(RAPIER, L);
  levelGroup = new THREE.Group(); scene.add(levelGroup);
  pedMeshes = sim.peds.map(p => { const m = pedestalMesh(p); m.position.set(p.x, p.h / 2, p.z); levelGroup.add(m); return m; });
  blockMeshes = sim.blocks.map((b, i) => { const m = blockMesh(b.def, i + n * 7); levelGroup.add(m); return m; });
  // the googlys waiting their turn beside the cannon
  queue = L.ammo.map((k, i) => { const g = new Googly(k); levelGroup.add(g.group); g.slot = i; g.group.position.copy(slotPos(i, k)); g.group.rotation.y = 1.9; return g; });
  ammoIdx = 0; levelScore = 0; combo = 0; loaded = false; loadAnim = null; charging = false; clearedShown = false; finishing = false; hitAny = false;
  // start aimed roughly at the nearest tower
  const P = [...sim.peds].sort((a, b) => b.z - a.z)[0];
  tYaw = yaw = Math.atan2(P.x, -P.z) * 0.9; tPitch = pitch = 0.22;
  towerView = false; zoom = false;
  syncMeshes(0);
  updateHud();
}
function slotPos(i, kind) { const s = AMMO[kind].r / 0.3; return new THREE.Vector3(-2.1 - i * 0.8, 0.49 * s, -0.4 - i * 0.12); }

// ---------------------------------------------------------------- particles
const soft = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
const parts = [];
const shardGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.09, 0.02, 0), new THREE.Vector3(0.03, 0.1, 0)]); shardGeo.computeVertexNormals();
const shardMat = new THREE.MeshStandardMaterial({ color: 0xd8f4ff, metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
const iceShard = shardMat.clone(); iceShard.color.set(0xeaf8ff);
const chipGeo = new THREE.BoxGeometry(0.05, 0.02, 0.12);
const chipMat = { wood: new THREE.MeshStandardMaterial({ color: 0x8a5a30, roughness: 0.9 }), stone: new THREE.MeshStandardMaterial({ color: 0x8a867e, roughness: 1 }) };
function puff(p, { n = 6, color = 0xffffff, size = 1, spread = 1, up = 1, life = 1.6, additive = false, speed = 1, opacity = 0.6 } = {}) {
  for (let i = 0; i < n; i++) {
    if (parts.length > 400) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color, transparent: true, depthWrite: false, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.position.set(p[0] + (Math.random() - 0.5) * 0.4 * spread, p[1] + (Math.random() - 0.5) * 0.3 * spread, p[2] + (Math.random() - 0.5) * 0.4 * spread);
    const sz = size * (0.5 + Math.random() * 0.6); s.scale.setScalar(sz);
    scene.add(s);
    parts.push({ o: s, v: new THREE.Vector3((Math.random() - 0.5) * 2 * spread * speed, (0.3 + Math.random()) * up * speed, (Math.random() - 0.5) * 2 * spread * speed), t: 0, life: life * (0.7 + Math.random() * 0.6), grow: size * 1.2, g: -0.2, sprite: true, op: opacity, drag: 1.8 });
  }
}
function debris(p, v0, n, geo, mat, spd = 3) {
  for (let i = 0; i < n; i++) {
    if (parts.length > 400) return;
    const m = new THREE.Mesh(geo, mat); m.position.set(p[0] + (Math.random() - 0.5) * 0.4, p[1] + (Math.random() - 0.5) * 0.4, p[2] + (Math.random() - 0.5) * 0.4);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); m.castShadow = true; scene.add(m);
    parts.push({ o: m, v: new THREE.Vector3(v0[0] * 0.4 + (Math.random() - 0.5) * spd, v0[1] * 0.3 + Math.random() * spd, v0[2] * 0.4 + (Math.random() - 0.5) * spd), w: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12), t: 0, life: 4 + Math.random() * 2, g: -G, sprite: false, drag: 0.1 });
  }
}
function floorAt(x, z) { if (!sim) return 0; for (const P of sim.peds) { const c = P.body.translation(); if (Math.abs(x - c.x) < P.w && Math.abs(z - c.z) < P.d) return P.h; } return 0; }
function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i]; q.t += dt;
    if (q.t > q.life) { scene.remove(q.o); if (q.sprite) q.o.material.dispose(); parts.splice(i, 1); continue; }
    q.v.y += q.g * dt; q.v.multiplyScalar(1 - q.drag * dt);
    q.o.position.addScaledVector(q.v, dt);
    const k = q.t / q.life;
    if (q.sprite) { q.o.scale.addScalar(q.grow * dt); q.o.material.opacity = q.op * (1 - k) * Math.min(1, q.t * 10); }
    else {
      const f = floorAt(q.o.position.x, q.o.position.z);
      if (q.o.position.y < f + 0.02) { q.o.position.y = f + 0.02; q.v.y *= -0.25; q.v.x *= 0.5; q.v.z *= 0.5; q.w.multiplyScalar(0.5); }
      q.o.rotation.x += q.w.x * dt; q.o.rotation.y += q.w.y * dt;
      if (k > 0.8) q.o.scale.setScalar((1 - k) * 5);
    }
  }
}
function clearParticles() { for (const q of parts) { scene.remove(q.o); if (q.sprite) q.o.material.dispose(); } parts.length = 0; }
let flashLight = new THREE.PointLight(0xffaa44, 0, 30); scene.add(flashLight);

// ---------------------------------------------------------------- floating score text
const pops = [];
function popText(text, p, gold = false) {
  const el = document.createElement('div'); el.className = 'pop' + (gold ? ' gold' : ''); el.textContent = text; $('pops').appendChild(el);
  pops.push({ el, p: new THREE.Vector3(...p), t: 0 });
}
const PV = new THREE.Vector3();
function updatePops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const q = pops[i]; q.t += dt;
    if (q.t > 1.2) { q.el.remove(); pops.splice(i, 1); continue; }
    PV.copy(q.p); PV.y += q.t * 1.2; PV.project(camera);
    if (PV.z > 1) { q.el.style.opacity = 0; continue; }
    q.el.style.left = ((PV.x + 1) / 2 * innerWidth) + 'px'; q.el.style.top = ((1 - PV.y) / 2 * innerHeight) + 'px';
    q.el.style.opacity = Math.min(1, (1.2 - q.t) * 3);
  }
}

// ---------------------------------------------------------------- HUD
const COLORS = { yellow: '#ffd21f', red: '#e8322a', blue: '#2d8cff', black: '#2e2e36' };
function amIcon(kind) { const d = document.createElement('div'); d.className = 'am'; d.style.background = COLORS[kind]; if (kind === 'red') { d.style.width = '44px'; d.style.height = '58px'; } return d; }
function updateHud() {
  if (!L) return;
  $('hLevel').innerHTML = `<b>${L.n}</b>LEVEL<span class="w">${L.name.toUpperCase()}</span>`;
  $('hScore').querySelector('span').textContent = (save.total + levelScore).toLocaleString();
  const f = sim ? sim.frac : 0;
  const fill = $('meter').querySelector('.fill'); fill.style.width = (f * 100) + '%'; fill.classList.toggle('ok', f >= L.need);
  $('meter').querySelector('.need').style.left = (L.need * 100) + '%';
  $('meter').querySelector('.pct').textContent = `${Math.round(f * 100)}%  ·  need ${Math.round(L.need * 100)}%`;
  const am = $('ammo'); am.innerHTML = '';
  L.ammo.forEach((k, i) => { const d = amIcon(k); if (i < ammoIdx) d.classList.add('used'); if (i === ammoIdx && state === 'aim') d.classList.add('next'); am.appendChild(d); });
  const w = L.wind, ws = Math.hypot(w.x, w.z);
  $('wind').classList.toggle('hidden', ws < 0.05);
  if (ws >= 0.05) { $('wind').querySelector('.arrow').style.transform = `rotate(${Math.atan2(w.z, w.x) * 180 / Math.PI}deg)`; $('wind').querySelector('.v').textContent = ws.toFixed(1); }
}
function banner(big, small = '', ms = 1600) {
  const b = $('banner'); b.querySelector('.big').textContent = big; b.querySelector('.small').textContent = small;
  b.classList.remove('hidden', 'show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.add('hidden'), ms);
}
function show(id, on = true) { $(id).classList.toggle('hidden', !on); }

// ---------------------------------------------------------------- flow
function toTitle() {
  state = 'title'; paused = false;
  ['hud', 'intro', 'result', 'pause', 'levels', 'cleared'].forEach(id => show(id, false)); show('title');
  loadLevel(save.cur);
  $('playBtn').textContent = save.cur > 1 ? `CONTINUE · LEVEL ${save.cur}` : 'PLAY';
  playMusic(4, 1, true);
}
function startLevel(n) {
  save.cur = n; persist();
  ['title', 'levels', 'result', 'pause', 'cleared'].forEach(id => show(id, false));
  loadLevel(n);
  state = 'intro';
  $('inTitle').textContent = `LEVEL ${n}`;
  $('inWorld').textContent = `${L.name.toUpperCase()}${L.pedestals.some(p => p.moving) ? ' · MOVING PLATFORMS' : ''}${Math.hypot(L.wind.x, L.wind.z) > 0.05 ? ' · WINDY' : ''}`;
  $('inGoal').innerHTML = `Knock <b>${Math.round(L.need * 100)}%</b> of the blocks off their pedestals.<br>You have <b>${L.ammo.length}</b> googlys.`;
  const fresh = [...new Set(L.ammo)].filter(k => !save.seen[k]);
  const nw = $('inNew'); nw.innerHTML = '';
  for (const k of fresh) { const d = document.createElement('div'); d.className = 'gl'; d.appendChild(amIcon(k)); const t = document.createElement('div'); t.innerHTML = `<b>NEW: ${GOOGLYS[k].name}</b><br>${TOUCH ? GOOGLYS[k].tip.replace(/Click/g, "Tap") : GOOGLYS[k].tip}`; d.appendChild(t); nw.appendChild(d); save.seen[k] = 1; }
  $('inKeys').classList.toggle('hidden', n > 3);
  show('intro'); show('hud');
  playMusic(L.theme, Math.floor((n - 1) / 5) + 1, false); duckMusic(1);
  if (Q.has('level') && !Q.has('intro')) go();
}
function go() {
  if (state !== 'intro') return;
  show('intro', false);
  state = 'aim'; nextGoogly();
  banner(`LEVEL ${L.n}`, L.name, 1300);
}
function nextGoogly() {
  loaded = false;
  if (ammoIdx >= L.ammo.length) return;
  const g = queue.find(q => q.slot === ammoIdx);
  if (!g) return;
  loadAnim = { g, t: 0, from: g.group.position.clone() };
  g.face(true); sfx.voice('hup', g.kind === 'red' ? 0.7 : g.kind === 'blue' ? 1.3 : 1, -0.3, 0.7);
  updateHud();
}
function fire() {
  if (!loaded || state !== 'aim') return;
  const kind = L.ammo[ammoIdx];
  const a = sim.fire(kind, yaw, pitch, power);
  ammoIdx++; loaded = false;
  const g = new Googly(kind); g.face(true); g.pose(true); levelGroup.add(g.group); flying.set(a, g);
  syncGoogly(a, g);
  cannon.fire(); shake = kind === 'red' ? 0.5 : 0.35;
  sfx.boom(kind === 'red'); setTimeout(() => sfx.voice('whee', kind === 'red' ? 0.72 : kind === 'blue' ? 1.35 : 1, 0, 0.9), 60);
  const m = muzzle(yaw, pitch), d = aimDir(yaw, pitch);
  puff([m[0] + d[0] * 0.5, m[1] + d[1] * 0.5, m[2] + d[2] * 0.5], { n: 14, color: 0xdedad2, size: 1.1, spread: 1.4, up: 0.8, life: 2.4, speed: 2, opacity: 0.55 });
  puff(m, { n: 5, color: 0xffa040, size: 0.9, spread: 0.3, additive: true, life: 0.25, opacity: 1 });
  state = 'flight'; shotT = 0; watchT = 0; hitAny = false; slow = 1; towerView = false; zoom = false;
  show('cleared', false);
  updateHud();
}
function finishLevel() {
  if (finishing) return; finishing = true;
  state = 'result';
  const f = sim.frac, left = L.ammo.length - ammoIdx;
  const stars = f >= 0.999 ? 3 : f >= L.need + (1 - L.need) * 0.5 ? 2 : 1;
  const bonus = left * 1000, perfect = f >= 0.999 ? 2000 : 0, tot = levelScore + bonus + perfect;
  save.total += tot;
  save.stars[L.n] = Math.max(save.stars[L.n] || 0, stars);
  save.best[L.n] = Math.max(save.best[L.n] || 0, tot);
  save.unlocked = Math.max(save.unlocked, L.n + 1); save.cur = L.n + 1;
  persist(true);
  $('resTitle').textContent = stars === 3 ? 'PERFECT KNOCKDOWN!' : 'LEVEL CLEAR!';
  const S = [...$('resStars').children]; S.forEach(s => s.classList.remove('on'));
  $('resStars').style.display = '';
  $('resLines').innerHTML = `<div><span>Knocked off</span><b>${Math.round(f * 100)}%</b></div><div><span>Blocks</span><b>${levelScore.toLocaleString()}</b></div><div><span>Googlys left × 1000</span><b>${bonus.toLocaleString()}</b></div>${perfect ? '<div><span>Perfect bonus</span><b>2,000</b></div>' : ''}<div class="tot"><span>Total</span><span>${tot.toLocaleString()}</span></div>`;
  $('resNext').classList.remove('hidden'); $('resNext').textContent = 'NEXT ▶';
  show('cleared', false); show('result');
  sfx.clear(); duckMusic(0.35);
  S.forEach((s, i) => { if (i < stars) setTimeout(() => { s.classList.add('on'); sfx.star(i); }, 700 + i * 380); });
  for (const g of queue) { g.cheer = true; g.face(true); g.pose(true); }
  for (const g of flying.values()) g.pose(true);
  setTimeout(() => sfx.voice('yay', 1.1, -0.4, 0.8), 500);
}
function failLevel() {
  state = 'result';
  $('resTitle').textContent = sim.frac > L.need - 0.1 ? 'SO CLOSE!' : 'THE TOWERS WIN THIS TIME';
  $('resStars').style.display = 'none';
  $('resLines').innerHTML = `<div><span>Knocked off</span><b>${Math.round(sim.frac * 100)}%</b></div><div><span>Needed</span><b>${Math.round(L.need * 100)}%</b></div>`;
  $('resNext').classList.add('hidden');
  show('result'); sfx.fail(); duckMusic(0.35);
  setTimeout(() => sfx.voice('uhoh', 1, 0, 0.8), 300);
}

// ---------------------------------------------------------------- input
const mouse = { x: 0.5, y: 0.5 };
let lastInput = 'mouse';
function aimFromMouse() { tYaw = (mouse.x - 0.5) * 1.5; tPitch = Math.max(-0.08, Math.min(1.05, (1 - mouse.y) * 1.25 - 0.18)); }
addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; lastInput = 'mouse'; mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; if (state === 'aim' && !paused) aimFromMouse(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function press() {
  if (paused) return;
  if (state === 'intro') { go(); return; }
  if (state === 'aim') { if (loaded && !charging) { charging = true; chargeT = 0; chargeSnd = sfx.chargeStart(); } return; }
  if (state === 'flight' || state === 'watch') {
    const acted = sim.action();
    if (!acted && state === 'watch' && watchT > 0.6) endWatch();
  }
}
function release() {
  if (charging) { charging = false; if (chargeSnd) { chargeSnd.stop(); chargeSnd = null; } fire(); }
}
canvas.addEventListener('pointerdown', e => { initAudio(); if (e.pointerType !== 'mouse') { touchDown(e); return; } if (e.button === 2) { zoom = true; return; } if (e.button === 0) press(); });
addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') return; if (e.button === 2) { zoom = false; return; } if (e.button === 0) release(); });
const keys = new Set();
addEventListener('keydown', e => {
  initAudio();
  if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
  keys.add(e.code);
  if (e.code === 'Escape') { if (!$('levels').classList.contains('hidden')) { show('levels', false); return; } togglePause(); return; }
  if (e.code === 'Space') { e.preventDefault(); press(); }
  if (e.code === 'KeyZ') zoom = true;
  if (e.code === 'KeyC' && (state === 'aim')) towerView = !towerView;
  if (e.code === 'Enter') {
    if (state === 'intro') go();
    else if (state === 'aim' && sim && sim.frac >= L.need) finishLevel();
    else if (state === 'result' && !$('resNext').classList.contains('hidden')) startLevel(L.n + 1);
    else if (state === 'result') startLevel(L.n);
    else if (state === 'title') $('playBtn').click();
  }
  if (e.code === 'KeyR' && state !== 'title' && state !== 'loading' && !e.metaKey) startLevel(L.n);
});
addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Space') release(); if (e.code === 'KeyZ') zoom = false; });
// ---- touch: drag anywhere to aim, hold the FIRE button to power up, let go to shoot; tap mid-air for the special move
const drags = new Map();
function touchDown(e) {
  lastInput = 'touch';
  if (paused) return;
  if (state === 'aim') { drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { canvas.setPointerCapture(e.pointerId); } catch {} return; }
  press();
}
canvas.addEventListener('pointermove', e => {
  const d = drags.get(e.pointerId); if (!d) return;
  if (state === 'aim' && !paused) {
    const k = 1.1 / Math.min(innerWidth, innerHeight);
    tYaw = Math.max(-0.9, Math.min(0.9, tYaw + (e.clientX - d.x) * k));
    tPitch = Math.max(-0.08, Math.min(1.05, tPitch - (e.clientY - d.y) * k));
  }
  d.x = e.clientX; d.y = e.clientY;
});
const undrag = e => drags.delete(e.pointerId);
canvas.addEventListener('pointerup', undrag); canvas.addEventListener('pointercancel', undrag);
function cancelCharge() { if (charging) { charging = false; if (chargeSnd) chargeSnd.stop(); chargeSnd = null; } }
const tFire = $('tFire');
tFire.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation(); initAudio(); lastInput = 'touch';
  try { tFire.setPointerCapture(e.pointerId); } catch {}
  tFire.pid = e.pointerId; press();
});
tFire.addEventListener('pointerup', e => { if (e.pointerId !== tFire.pid) return; tFire.pid = null; release(); });
tFire.addEventListener('pointercancel', e => { if (e.pointerId !== tFire.pid) return; tFire.pid = null; cancelCharge(); });
const tapBtn = (id, f) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); lastInput = 'touch'; if (!paused) f(); });
tapBtn('tZoom', () => { if (state === 'aim') { zoom = !zoom; towerView = false; sfx.click(); } });
tapBtn('tView', () => { if (state === 'aim') { towerView = !towerView; zoom = false; sfx.click(); } });
tapBtn('tRestart', () => { if (['aim', 'flight', 'watch'].includes(state)) { sfx.click(); startLevel(L.n); } });
let fireLbl = '';
function updateTouchUI() {
  let lbl = '', cls = '';
  if (state === 'aim') { lbl = loaded ? 'FIRE' : '…'; cls = loaded ? (charging ? 'charging' : '') : 'dim'; }
  else if (state === 'flight' || state === 'watch') {
    let act = '';
    for (const a of sim.ammo) if (a.alive && !a.done && (a.kind === 'black' || (a.kind === 'blue' && !a.hit))) { act = a.kind === 'blue' ? 'SPLIT!' : 'BOOM!'; break; }
    if (act) { lbl = act; cls = 'act'; } else if (state === 'watch') { lbl = 'SKIP ▶'; cls = watchT > 0.6 ? 'skip' : 'skip dim'; } else { lbl = ''; cls = 'off'; }
  } else cls = 'off';
  const k = lbl + '|' + cls;
  if (k !== fireLbl) { fireLbl = k; tFire.querySelector('span').textContent = lbl; tFire.className = 'tbtn ' + cls; }
  tFire.style.setProperty('--p', charging ? power.toFixed(3) : 0);
  tFire.style.setProperty('--pc', `hsl(${Math.round(120 - power * 120)} 90% 55%)`);
  const aimOn = state === 'aim';
  $('tZoom').classList.toggle('on', zoom); $('tView').classList.toggle('on', towerView);
  $('tZoom').classList.toggle('off', !aimOn); $('tView').classList.toggle('off', !aimOn); $('tRestart').classList.toggle('off', !['aim', 'flight', 'watch'].includes(state));
}
if (TOUCH) {
  // the page itself never scrolls, rubber-bands or zooms (menus that scroll are marked .scroll)
  document.addEventListener('touchmove', e => { if (!e.target.closest || !e.target.closest('.scroll, input')) e.preventDefault(); }, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'dblclick']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
  // iOS unlocks audio on touchend/click, not always on touchstart
  for (const ev of ['touchend', 'click']) addEventListener(ev, () => initAudio(), { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelCharge(); if (['aim', 'flight', 'watch'].includes(state) && !paused) togglePause(); } else initAudio(); });
  $('hint').textContent = 'Drag to aim · hold FIRE to power up · let go to shoot';
  $('inKeys').innerHTML = 'Drag anywhere: aim · Hold FIRE: power up · Let go: shoot<br>Tap mid-air: special move · 🔍 zoom · 🏰 look at the towers · ↻ restart';
  $('clearedTxt').textContent = '✔ CLEARED! Shoot for more stars, or';
}
addEventListener('blur', () => { if (charging) { charging = false; if (chargeSnd) chargeSnd.stop(); chargeSnd = null; } if (['aim', 'flight', 'watch'].includes(state) && !paused) togglePause(); });

function togglePause() {
  if (!['aim', 'flight', 'watch'].includes(state)) return;
  paused = !paused; show('pause', paused);
  $('volMusic').value = settings.music; $('volSfx').value = settings.sfx;
  duckMusic(paused ? 0.4 : 1);
}
const click = (id, f) => $(id).addEventListener('click', e => { initAudio(); sfx.click(); e.stopPropagation(); f(); });
click('playBtn', () => startLevel(Math.min(save.cur, save.unlocked)));
click('newBtn', () => { if (confirm('Start over from level 1? Your stars and score will be wiped.')) { save = freshSave(); persist(); toTitle(); } });
click('levelsBtn', () => {
  const grid = $('lvGrid'); grid.innerHTML = '';
  for (let n = 1; n <= save.unlocked; n++) {
    const b = document.createElement('button'); b.className = 'lv' + (n === save.cur ? ' cur' : '');
    b.innerHTML = `${n}<small>${'★'.repeat(save.stars[n] || 0)}</small>`;
    b.title = THEMES[themeOf(n)].name;
    b.onclick = () => { sfx.click(); startLevel(n); };
    grid.appendChild(b);
  }
  show('levels'); setTimeout(() => grid.lastChild && grid.lastChild.scrollIntoView({ block: 'nearest' }), 30);
});
click('lvBack', () => show('levels', false));
click('setBtn', () => { settings.music = settings.music > 0 ? 0 : 0.55; settings.sfx = settings.music > 0 ? 0.9 : settings.sfx; setVolumes(); persist(); $('setBtn').textContent = settings.music > 0 ? 'SOUND: ON' : 'MUSIC: OFF'; });
click('goBtn', go);
click('resNext', () => startLevel(L.n + 1));
click('resRetry', () => startLevel(L.n));
click('resMenu', toTitle);
click('pResume', togglePause);
click('pRestart', () => startLevel(L.n));
click('pMenu', toTitle);
click('hPause', togglePause);
click('finishBtn', () => { if (state === 'aim' && sim.frac >= L.need) finishLevel(); });
$('volMusic').addEventListener('input', e => { settings.music = +e.target.value; setVolumes(); persist(); });
$('volSfx').addEventListener('input', e => { settings.sfx = +e.target.value; setVolumes(); persist(); });
$('setBtn').textContent = settings.music > 0 ? 'SOUND: ON' : 'MUSIC: OFF';
// first click anywhere starts the audio (browsers insist)
addEventListener('pointerdown', () => { initAudio(); if (state === 'title') playMusic(4, 1, true); }, { once: true });

// ---------------------------------------------------------------- physics events → sounds, particles, score
const CP = new THREE.Vector3();
function handleEvents(evs) {
  const cam = camera.position;
  for (const e of evs) {
    switch (e.k) {
      case 'hit':
        sfx.hit(e.mat, e.s, e.p, cam);
        if (e.s > 4 && (e.mat === 'wood' || e.mat === 'stone')) debris(e.p, [0, 0, 0], e.mat === 'stone' ? 2 : 3, chipGeo, chipMat[e.mat], 2);
        if (e.s > 2.5 && e.p[1] < 0.6) puff(e.p, { n: 3, color: [0xb8a888, 0xb09a78, 0xd8b088, 0xffffff][L.theme], size: 0.8, spread: 1, up: 0.4, life: 1.4, opacity: 0.45 });
        break;
      case 'thud': sfx.thud(e.s, e.p, cam); if (e.s > 6) puff(e.p, { n: 4, color: [0xb8a888, 0xb09a78, 0xd8b088, 0xffffff][L.theme], size: 0.9, spread: 1, up: 0.5, life: 1.5, opacity: 0.5 }); break;
      case 'ahit': {
        const g = flying.get(e.a); if (g) { g.face(true); g.pose(false); }
        const p = e.a.body.translation();
        if (!hitAny) { hitAny = true; focus.set(p.x, p.y, p.z); if (state === 'flight') { state = 'watch'; watchT = 0; } }
        sfx.voice('ow', e.a.kind === 'red' ? 0.7 : e.a.kind === 'blue' ? 1.35 : 1, 0, 0.6);
        break;
      }
      case 'break': {
        const m = blockMeshes[e.b.i]; if (m) m.visible = false;
        const ice = e.b.mat === 'ice';
        debris(e.p, e.v, LQ ? 8 : 18, shardGeo, ice ? iceShard : shardMat, 3.5);
        puff(e.p, { n: 3, color: 0xffffff, size: 0.5, spread: 0.6, life: 0.6, opacity: 0.35 });
        sfx.shatter(e.p, cam, ice);
        break;
      }
      case 'down': {
        const pts = MATS[e.b.mat].pts;
        levelScore += pts; combo++; comboT = 0;
        const p = e.b.broken ? blockMeshes[e.b.i].position.toArray() : e.b.body.translation(); const pp = Array.isArray(p) ? p : [p.x, p.y, p.z];
        popText('+' + pts, [pp[0], pp[1] + 0.4, pp[2]], pts >= 500);
        sfx.down(combo, pts, pp, cam);
        updateHud();
        if (!clearedShown && sim.frac >= L.need) { clearedShown = true; banner('CLEARED!', 'Now knock the rest down for more stars', 1700); sfx.star(2); }
        break;
      }
      case 'boom': {
        const p = e.p;
        puff(p, { n: 14, color: 0xff8a2a, size: 1.6, spread: 1.6, up: 1, life: 0.55, additive: true, speed: 3, opacity: 1 });
        puff(p, { n: 16, color: 0x3a3632, size: 2.2, spread: 2, up: 1.4, life: 3.2, speed: 2, opacity: 0.6 });
        flashLight.position.set(p[0], p[1] + 0.5, p[2]); flashLight.intensity = 300;
        shake = 0.9; sfx.explode(p, cam);
        if (!hitAny) { hitAny = true; focus.set(...p); if (state === 'flight') { state = 'watch'; watchT = 0; } }
        break;
      }
      case 'split': sfx.split(); puff(e.p, { n: 5, color: 0x9fd0ff, size: 0.7, spread: 0.6, life: 0.6, opacity: 0.6 }); break;
      case 'spawn': if (!flying.has(e.a)) { const g = new Googly(e.a.kind); g.face(true); g.pose(true); levelGroup.add(g.group); flying.set(e.a, g); } break;
      case 'gone': { const g = flying.get(e.a); if (g) { levelGroup.remove(g.group); flying.delete(e.a); } break; }
    }
  }
}

function syncGoogly(a, g) { const p = a.body.translation(), r = a.body.rotation(); g.group.position.set(p.x, p.y, p.z); g.group.quaternion.set(r.x, r.y, r.z, r.w); }
function syncMeshes(dt) {
  if (!sim) return;
  for (const b of sim.blocks) { if (b.broken) continue; const m = blockMeshes[b.i], p = b.body.translation(), r = b.body.rotation(); m.position.set(p.x, p.y, p.z); m.quaternion.set(r.x, r.y, r.z, r.w); }
  for (const P of sim.peds) if (P.moving) { const p = P.body.translation(); pedMeshes[P.i].position.set(p.x, p.y, p.z); }
  for (const [a, g] of flying) { if (a.alive) syncGoogly(a, g); g.update(dt, a.kind === 'black' && !a.done); }
}

function endWatch() {
  if (state !== 'watch' && state !== 'flight') return;
  const f = sim.frac;
  if (f >= 0.999) return finishLevel();
  if (ammoIdx >= L.ammo.length) return f >= L.need ? finishLevel() : failLevel();
  state = 'aim'; slow = 1;
  if (lastInput === 'mouse') aimFromMouse();
  show('cleared', f >= L.need);
  nextGoogly();
}

// ---------------------------------------------------------------- camera
const T1 = new THREE.Vector3(), T2 = new THREE.Vector3();
function towersCentre(out) {
  out.set(0, 0, 0); let n = 0;
  for (const b of sim.blocks) if (!b.down) { const p = b.body.translation(); out.x += p.x; out.y += p.y; out.z += p.z; n++; }
  if (!n) { for (const P of sim.peds) { out.x += P.x; out.z += P.z; out.y += P.h; n++; } }
  return out.divideScalar(n);
}
function updateCamera(dt, t) {
  let fov = 44;
  const k = 1 - Math.exp(-dt * 5);
  if (state === 'title' || state === 'loading') {
    const a = Math.sin(t * 0.07) * 0.35 - 0.5;
    T1.set(Math.sin(a) * 9, 3.2 + Math.sin(t * 0.13) * 0.4, 6 + Math.cos(a) * 3);
    T2.set(0, 2.2, -22);
    camPos.lerp(T1, k * 0.5); camLook.lerp(T2, k * 0.5);
  } else if (state === 'flight' && flying.size) {
    let g = null; for (const [a, gg] of flying) if (a.alive && a.t < 20 && (!g || a.t < g[0].t)) g = [a, gg];
    if (g) {
      const p = g[0].body.translation(), v = g[0].body.linvel(), sp = Math.hypot(v.x, v.y, v.z) || 1;
      T1.set(p.x - v.x / sp * 5.5 + 0.9, p.y - v.y / sp * 3 + 1.8, p.z - v.z / sp * 5.5);
      T1.y = Math.max(T1.y, floorAt(T1.x, T1.z) + 0.8);
      T2.set(p.x + v.x * 0.2, p.y + v.y * 0.1, p.z + v.z * 0.2);
      const kk = 1 - Math.exp(-dt * 6);
      camPos.lerp(T1, kk); camLook.lerp(T2, kk * 1.5);
    }
  } else if (state === 'watch' || state === 'result') {
    const c = T2.copy(focus); c.y = Math.max(1.2, c.y);
    const ang = Math.atan2(camPos.x - c.x, camPos.z - c.z) + dt * 0.12;
    T1.set(c.x + Math.sin(ang) * 10, c.y + 3.2, c.z + Math.cos(ang) * 10);
    camPos.lerp(T1, k * 0.6); camLook.lerp(c, k);
  } else if (towerView) {
    towersCentre(T2);
    T1.set(T2.x + 7, T2.y + 4.5, T2.z + 13);
    camPos.lerp(T1, k); camLook.lerp(T2, k);
  } else {
    // behind the cannon, turning with it
    const cy = yaw * 0.75, off = new THREE.Vector3(1.1, 2.4, 4.9).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -cy);
    T1.set(PIVOT[0] + off.x, off.y, PIVOT[2] + off.z);
    const d = aimDir(yaw, Math.min(pitch, 0.25) * 0.4);
    T2.set(PIVOT[0] + d[0] * 30, 1.6 + d[1] * 30, PIVOT[2] + d[2] * 30);
    if (zoom) {
      const dz = aimDir(yaw, 0.02);
      T1.set(PIVOT[0] - dz[0] * 1.8 + 0.3, 2.05, PIVOT[2] - dz[2] * 1.8);
      towersCentre(T2); const dist = Math.hypot(T2.x, T2.z);
      T2.set(dz[0] * dist, T2.y * 0.9, dz[2] * dist);
      fov = 16;
    }
    camPos.lerp(T1, k * 1.4); camLook.lerp(T2, k * 1.4);
  }
  if (camera.aspect < 1.3) fov = Math.min(100, 2 * Math.atan(Math.tan(fov * Math.PI / 360) * 1.3 / camera.aspect) * 180 / Math.PI);
  camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 8)); camera.updateProjectionMatrix();
  camera.position.copy(camPos); camera.lookAt(camLook);
  if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake * 0.35; camera.position.y += (Math.random() - 0.5) * shake * 0.35; shake = Math.max(0, shake - dt * 1.6); }
}

// ---------------------------------------------------------------- per-frame
function updateAim(dt) {
  const ks = dt * 0.6;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) tYaw -= ks;
  if (keys.has('ArrowRight') || keys.has('KeyD')) tYaw += ks;
  if (keys.has('ArrowUp') || keys.has('KeyW')) tPitch = Math.min(1.05, tPitch + ks);
  if (keys.has('ArrowDown') || keys.has('KeyS')) tPitch = Math.max(-0.08, tPitch - ks);
  tYaw = Math.max(-0.9, Math.min(0.9, tYaw));
  const k = 1 - Math.exp(-dt * 14);
  yaw += (tYaw - yaw) * k; pitch += (tPitch - pitch) * k;
  if (charging) { chargeT += dt; const p = (chargeT / 1.25) % 2; power = 0.04 + 0.96 * (p < 1 ? p : 2 - p); if (chargeSnd) chargeSnd.set(power); }
  show('power', charging);
  $('power').querySelector('.fill').style.width = (power * 100) + '%';
  // dotted preview of the first part of the flight
  const show3 = state === 'aim' && loaded && !towerView;
  const m = muzzle(yaw, pitch), d = aimDir(yaw, pitch), v = speedOf(charging ? power : 0.6);
  const T = L.n <= 8 ? 1.15 : L.n <= 20 ? 0.85 : L.n <= 40 ? 0.6 : 0.45;
  dots.forEach((dot, i) => {
    const t = (i + 1) / dots.length * T;
    dot.visible = show3;
    if (!show3) return;
    dot.position.set(m[0] + d[0] * v * t, m[1] + d[1] * v * t - 0.5 * G * t * t, m[2] + d[2] * v * t);
    dot.material.opacity = (1 - i / dots.length) * (charging ? 0.95 : 0.45);
    dot.scale.setScalar(charging ? 1 : 0.8);
  });
}

function updateQueue(dt, t) {
  for (const g of queue) {
    if (loadAnim && loadAnim.g === g) continue;
    if (g.slot < ammoIdx || (g.slot === ammoIdx && loaded)) { g.group.visible = false; continue; }
    const target = slotPos(g.slot - ammoIdx, g.kind);
    g.group.position.x += (target.x - g.group.position.x) * (1 - Math.exp(-dt * 5));
    g.group.position.z += (target.z - g.group.position.z) * (1 - Math.exp(-dt * 5));
    const hop = g.cheer ? Math.abs(Math.sin(t * 7 + g.slot)) * 0.35 : Math.abs(Math.sin(t * 2.4 + g.slot * 1.3)) * 0.04;
    g.group.position.y = target.y + hop;
    g.group.rotation.y = 1.9 + Math.sin(t * 0.7 + g.slot) * 0.25;
    g.update(dt);
  }
  if (loadAnim) {
    const A = loadAnim; A.t += dt;
    const k = Math.min(1, A.t / 0.6), m = muzzle(yaw, pitch);
    const p = new THREE.Vector3().lerpVectors(A.from, new THREE.Vector3(m[0], m[1] + 0.3, m[2]), k); p.y += Math.sin(k * Math.PI) * 1.3;
    A.g.group.position.copy(p);
    A.g.group.rotation.x = -k * 2.5;
    A.g.group.scale.setScalar(k > 0.8 ? 1 - (k - 0.8) * 4 : 1);
    A.g.pose(true); A.g.update(dt);
    if (k >= 1) { A.g.group.visible = false; loadAnim = null; loaded = true; sfx.load(); updateHud(); }
  }
}

let last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  if (sim && !paused && state !== 'loading') {
    const playing = ['aim', 'flight', 'watch', 'result', 'intro', 'title'].includes(state);
    if (state === 'flight' && !hitAny) {
      // slow motion just before the googly crashes into a tower
      let near = false;
      for (const [a] of flying) if (a.alive) { const p = a.body.translation(); for (const b of sim.blocks) if (!b.down) { const q = b.body.translation(); if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 < 9) { near = true; break; } } }
      slow += ((near ? 0.3 : 1) - slow) * (1 - Math.exp(-dt * 10));
    } else slow += (1 - slow) * (1 - Math.exp(-dt * 2.5));
    if (playing) handleEvents(sim.step(dt * slow));
    if (state === 'flight') { shotT += dt; if (shotT > 9) { state = 'watch'; watchT = 0; focus.copy(camLook); } }
    if (state === 'watch') { watchT += dt; if ((watchT > 1.6 && sim.settled()) || watchT > 8) endWatch(); }
    if (state === 'aim') updateAim(dt);
    if (state !== 'aim') { dots.forEach(d => d.visible = false); show('power', false); }
    comboT += dt; if (comboT > 1.3) combo = 0;
    const gd = dt * slow;
    syncMeshes(gd);
    if (state !== "icon") updateQueue(gd, clock); else queue.forEach(g => (g.group.visible = false));
  }
  if (state !== "icon") cannon.aim(yaw, pitch); cannon.update(dt);
  fuse.visible = charging; fuseLight.intensity = charging ? 1.5 + Math.random() * 2 : 0;
  if (charging) { fuse.scale.setScalar(0.22 + Math.random() * 0.18); if (Math.random() < 0.3) sfx.fuse(); }
  flashLight.intensity *= Math.pow(0.0005, dt);
  updateParticles(dt * slow);
  updatePops(dt);
  if (world) world.update(dt, clock);
  if (state === "icon") { camera.updateProjectionMatrix(); window.__iconCam(); } else updateCamera(dt, clock);
  $('hint').classList.toggle('hidden', !(state === 'aim' && L && L.n <= 3 && ammoIdx === 0));
  if (TOUCH && sim) updateTouchUI();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start
show('loading', false);
if (Q.has('icon')) {
  (await import('./icon.js')).iconScene({ THREE, scene, camera, cannon, fuse, fuseLight, Googly, loadLevel: n => loadLevel(n), renderer, show, setState: s => (state = s), world: () => world });
} else if (Q.has('level')) { startLevel(Math.max(1, +Q.get('level') || 1)); }
else toTitle();
requestAnimationFrame(frame);

// test hook: ?auto=1 aims at the nearest standing tower and fires by itself
if (Q.get('auto') === '1') setInterval(() => {
  if (state !== 'aim' || !loaded || charging) return;
  const up = sim.blocks.filter(b => !b.down); if (!up.length) return;
  const p = up[0].body.translation(), P = sim.peds[up[0].ped].body.translation();
  const pw = 0.85, v = speedOf(pw), dx = Math.hypot(P.x, P.z) - 1.2, dy = p.y - PIVOT[1];
  const disc = v ** 4 - G * (G * dx * dx + 2 * dy * v * v); if (disc < 0) return;
  tYaw = yaw = Math.atan2(P.x, -P.z); tPitch = pitch = Math.atan((v * v - Math.sqrt(disc)) / (G * dx)); power = pw;
  fire();
}, 500);
window.__gtk = { get state() { return state; }, get sim() { return sim; }, get L() { return L; }, fire, startLevel, get aim() { return { yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), power: +power.toFixed(3), chargeT: +chargeT.toFixed(2), charging, loaded, zoom, towerView, ammoIdx, frac: sim ? +sim.frac.toFixed(3) : 0, touch: TOUCH }; } };
