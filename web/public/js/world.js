// Googly TK — the scenery: sky, sun, ground, far mountains, trees, clouds, and the look of every block.
import * as THREE from '../vendor/three.module.js';
import { canvasTex } from './googly.js';
import { rng } from './level.js';

// ---------------------------------------------------------------- procedural textures
function valueNoise(w, h, oct, seed, cell = 32) {
  const R = rng(seed), out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const c = Math.max(2, cell >> o), gw = Math.ceil(w / c) + 1, gh = Math.ceil(h / c) + 1, g = new Float32Array(gw * gh).map(() => R());
    // wrap so the texture tiles
    const gx = Math.round(w / c), gy = Math.round(h / c);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / c, fy = y / c, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[(j % gy) * gw + (i % gx)];
      const v = at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy) + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy;
      out[y * w + x] += v * amp;
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function paint(w, h, f, srgb = true) {
  return canvasTex(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, gg, b] = f(x, y); const i = (y * w + x) * 4; img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, srgb);
}
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const TEX = {};
function woodTextures(seed, tint) {
  const W = 256, H = 256, n = valueNoise(W, H, 3, seed, 64), fine = valueNoise(W, H, 2, seed + 1, 8);
  const col = [], bump = [];
  const map = paint(W, H, (x, y) => {
    const k = (x + y * W);
    const ring = Math.sin((y * 0.09 + n[k] * 14) * 2.2) * 0.5 + 0.5;
    const t = Math.pow(ring, 3) * 0.55 + fine[k] * 0.3;
    const c = mix3(tint[0], tint[1], t);
    return c;
  });
  const bmp = paint(W, H, (x, y) => { const k = x + y * W; const ring = Math.sin((y * 0.09 + n[k] * 14) * 2.2) * 0.5 + 0.5; const v = 150 + ring * 60 + fine[k] * 40; return [v, v, v]; }, false);
  return { map, bmp };
}
function stoneTextures(seed, a, b) {
  const W = 256, n = valueNoise(W, W, 5, seed, 64), s = valueNoise(W, W, 2, seed + 5, 4);
  const map = paint(W, W, (x, y) => { const k = x + y * W, v = n[k] * 0.8 + s[k] * 0.2; const c = mix3(a, b, v); const sp = s[k] > 0.8 ? 25 : s[k] < 0.15 ? -30 : 0; return [c[0] + sp, c[1] + sp, c[2] + sp]; });
  const bmp = paint(W, W, (x, y) => { const k = x + y * W, v = 90 + n[k] * 120 + s[k] * 45; return [v, v, v]; }, false);
  return { map, bmp };
}
function groundTexture(theme) {
  const W = 512, n = valueNoise(W, W, 5, 77 + theme, 128), f = valueNoise(W, W, 2, 99 + theme, 4);
  const P = [
    [[58, 102, 34], [104, 146, 52], [70, 90, 40]],       // meadow grass
    [[112, 108, 46], [150, 124, 58], [120, 70, 30]],     // autumn: dry grass + leaves
    [[196, 130, 82], [226, 170, 112], [170, 100, 64]],   // desert sand
    [[222, 230, 240], [250, 252, 255], [190, 204, 222]], // snow
  ][theme];
  const map = paint(W, W, (x, y) => {
    const k = x + y * W; let c = mix3(P[0], P[1], n[k]);
    if (theme < 2) { const blade = f[k]; c = mix3(c, blade > 0.6 ? P[1] : P[0], Math.abs(blade - 0.5) * 0.8); if (theme === 1 && f[k] > 0.88) c = P[2]; }
    else if (theme === 2) { const rip = Math.sin(y * 0.18 + n[k] * 20) * 0.5 + 0.5; c = mix3(c, P[2], rip * 0.25 + f[k] * 0.15); }
    else { c = mix3(c, P[2], f[k] * 0.25 + (n[k] < 0.35 ? 0.3 : 0)); }
    return c;
  });
  map.repeat.set(60, 60);
  const bmp = paint(W, W, (x, y) => { const k = x + y * W; const v = theme === 3 ? 140 + n[k] * 60 : 80 + f[k] * 120 + n[k] * 50; return [v, v, v]; }, false);
  bmp.repeat.set(60, 60);
  return { map, bmp };
}
function canLabel(seed) {
  const R = rng(seed);
  const hues = ['#d7263d', '#1b998b', '#f46036', '#2e294e', '#c5d86d', '#ffd21f'];
  const bg = hues[Math.floor(R() * hues.length)];
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#c9ced4'; g.fillRect(0, 0, w, h);
    g.fillStyle = bg; g.fillRect(0, 22, w, h - 44);
    g.fillStyle = '#fff'; g.fillRect(0, 22, w, 8); g.fillRect(0, h - 30, w, 8);
    g.font = '900 54px "Avenir Next", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.fillText(['GOOGLY', 'BEANS', 'SOUP', 'PEAS'][Math.floor(R() * 4)], w * 0.3, h / 2);
    g.beginPath(); g.arc(w * 0.72, h / 2, 46, 0, 7); g.fillStyle = '#fff'; g.fill(); g.beginPath(); g.arc(w * 0.72 + 8, h / 2 + 12, 20, 0, 7); g.fillStyle = '#111'; g.fill();
    for (let i = 0; i < 12; i++) { g.fillStyle = `rgba(0,0,0,${R() * 0.08})`; g.fillRect(R() * w, 0, 2 + R() * 6, h); }
  });
}

export function buildMaterials(lq) {
  if (TEX.ready) return TEX;
  const woods = [[[150, 102, 58], [110, 68, 34]], [[176, 128, 76], [132, 88, 48]], [[128, 84, 46], [92, 56, 28]]].map((t, i) => woodTextures(11 + i, t));
  TEX.wood = woods.map(w => new THREE.MeshStandardMaterial({ map: w.map, bumpMap: w.bmp, bumpScale: 1.2, roughness: 0.72 }));
  const st = stoneTextures(31, [118, 116, 110], [168, 164, 156]);
  TEX.stone = [new THREE.MeshStandardMaterial({ map: st.map, bumpMap: st.bmp, bumpScale: 2.5, roughness: 0.92 })];
  TEX.glass = [lq ? new THREE.MeshStandardMaterial({ color: 0xbfe3ee, transparent: true, opacity: 0.4, roughness: 0.05, metalness: 0.1 })
    : new THREE.MeshPhysicalMaterial({ color: 0xd8f0f4, transmission: 1, thickness: 0.08, roughness: 0.04, ior: 1.52, specularIntensity: 1, clearcoat: 1, attenuationColor: new THREE.Color(0x9fd8d0), attenuationDistance: 0.6 })];
  const iceT = stoneTextures(41, [190, 225, 245], [230, 245, 255]);
  TEX.ice = [lq ? new THREE.MeshStandardMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.7, roughness: 0.2 })
    : new THREE.MeshPhysicalMaterial({ color: 0xdff4ff, transmission: 0.75, thickness: 0.4, roughness: 0.18, ior: 1.31, bumpMap: iceT.bmp, bumpScale: 0.8 })];
  TEX.gold = [new THREE.MeshPhysicalMaterial({ color: 0xffc83a, metalness: 1, roughness: 0.2, clearcoat: 0.6 })];
  const tin = new THREE.MeshStandardMaterial({ color: 0xd6dbe0, metalness: 1, roughness: 0.3 });
  TEX.metal = [0, 1, 2, 3, 4].map(i => [new THREE.MeshStandardMaterial({ map: canLabel(i + 3), metalness: 0.55, roughness: 0.35 }), tin, tin]);
  const concrete = stoneTextures(51, [150, 146, 138], [190, 186, 178]);
  const crate = woodTextures(61, [[190, 150, 96], [150, 110, 64]]);
  const rock = stoneTextures(71, [84, 78, 72], [128, 118, 106]);
  TEX.ped = {
    stone: new THREE.MeshStandardMaterial({ map: concrete.map, bumpMap: concrete.bmp, bumpScale: 2, roughness: 0.95 }),
    crate: new THREE.MeshStandardMaterial({ map: crate.map, bumpMap: crate.bmp, bumpScale: 1.5, roughness: 0.8 }),
    rock: new THREE.MeshStandardMaterial({ map: rock.map, bumpMap: rock.bmp, bumpScale: 4, roughness: 1 }),
  };
  TEX.ready = true;
  return TEX;
}

/** a mesh for one block definition (geometry centred like its physics body) */
export function blockMesh(b, i) {
  let geo, mat;
  const set = TEX[b.mat];
  if (b.shape === 'box') {
    const [hx, hy, hz] = b.h;
    geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    // stretch UVs so the grain runs along the long side and isn't smeared
    const uv = geo.attributes.uv, pos = geo.attributes.position, nrm = geo.attributes.normal;
    for (let k = 0; k < uv.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k), ax = Math.abs(nrm.getX(k)), ay = Math.abs(nrm.getY(k));
      let u, v; if (ax > 0.5) { u = z; v = y; } else if (ay > 0.5) { u = x; v = z; } else { u = x; v = y; }
      const long = Math.max(hx, hy, hz), flip = hy === long && ay < 0.5;
      uv.setXY(k, (flip ? v : u) * 0.9 + i * 0.37, (flip ? u : v) * 0.9 + i * 0.21);
    }
    mat = set[i % set.length];
  } else {
    geo = new THREE.CylinderGeometry(b.r, b.r, b.hh * 2, 28);
    mat = set[i % set.length];
  }
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  if (b.shape === 'cyl') {           // tin can rims
    const rim = new THREE.Mesh(new THREE.TorusGeometry(b.r * 0.97, 0.012, 6, 24), TEX.metal[0][1]);
    for (const s of [-1, 1]) { const r = rim.clone(); r.rotation.x = Math.PI / 2; r.position.y = s * b.hh; m.add(r); }
  }
  return m;
}

export function pedestalMesh(p) {
  const g = new THREE.Group();
  const mat = TEX.ped[p.style];
  if (p.style === 'rock') {
    const geo = new THREE.BoxGeometry(p.w * 2 + 0.3, p.h, p.d * 2 + 0.3, 4, Math.max(2, Math.round(p.h * 3)), 4);
    const pos = geo.attributes.position, R = rng(Math.round(p.x * 100) + 5);
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y > p.h / 2 - 0.01) continue; pos.setX(i, pos.getX(i) * (1 + (R() - 0.3) * 0.25 + (p.h / 2 - y) * 0.06)); pos.setZ(i, pos.getZ(i) * (1 + (R() - 0.3) * 0.25 + (p.h / 2 - y) * 0.06)); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); g.add(m);
    const top = new THREE.Mesh(new THREE.BoxGeometry(p.w * 2, 0.04, p.d * 2), TEX.ped.stone); top.position.y = p.h / 2 - 0.02; g.add(top);
  } else if (p.style === 'crate') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w * 2, p.h, p.d * 2), mat); g.add(m);
    // corner posts and cross braces make it read as a wooden crate stand
    const dark = new THREE.MeshStandardMaterial({ map: mat.map, color: 0x9a7a55, roughness: 0.85 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, p.h, 0.08), dark); post.position.set(sx * (p.w + 0.01), 0, sz * (p.d + 0.01)); g.add(post); }
    const lid = new THREE.Mesh(new THREE.BoxGeometry(p.w * 2 + 0.06, 0.05, p.d * 2 + 0.06), dark); lid.position.y = p.h / 2 - 0.025; g.add(lid);
  } else {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.w * 2, p.h, p.d * 2), mat); g.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(p.w * 2 + 0.1, 0.08, p.d * 2 + 0.1), mat); cap.position.y = p.h / 2 - 0.04; g.add(cap);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(p.w * 2 + 0.16, 0.14, p.d * 2 + 0.16), mat); foot.position.y = -p.h / 2 + 0.07; g.add(foot);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------------------------------------------------------------- sky, light and scenery for a world
const SKY = [
  { top: 0x2f6fd0, hor: 0xcfe4f4, sun: 0xfff3dc, sunI: 3.2, elev: 0.95, azi: 0.6, fog: 0xc6dcee, hemiG: 0x5a6e38, env: 0.75 },
  { top: 0x4a7fc4, hor: 0xf3d9b8, sun: 0xffd9a0, sunI: 2.8, elev: 0.45, azi: -0.8, fog: 0xe6d2b8, hemiG: 0x7a5a30, env: 0.7 },
  { top: 0x2b5fae, hor: 0xf8cf96, sun: 0xffc27a, sunI: 3.0, elev: 0.3, azi: 0.9, fog: 0xf0c898, hemiG: 0x9a6040, env: 0.75 },
  { top: 0x6a90c4, hor: 0xe4ecf4, sun: 0xfff6ee, sunI: 2.4, elev: 0.55, azi: -0.4, fog: 0xdbe4ee, hemiG: 0xb8c4d4, env: 0.9 },
];

function skyDome(S, sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(S.top) }, hor: { value: new THREE.Color(S.hor) }, sunC: { value: new THREE.Color(S.sun) }, sunDir: { value: sunDir.clone() } },
    vertexShader: 'varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 top, hor, sunC, sunDir; varying vec3 vd;
      void main(){ float h = max(vd.y, 0.0); vec3 c = mix(hor, top, pow(h, 0.55));
        c = mix(c, hor * 0.92, smoothstep(0.0, -0.2, vd.y));
        float s = max(dot(normalize(vd), sunDir), 0.0);
        c += sunC * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
}

function cloudTex() {
  return canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = 40 + Math.random() * (w - 80), y = h * 0.55 + (Math.random() - 0.5) * 30, r = 18 + Math.random() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  });
}

export function buildWorld(scene, renderer, theme, lq) {
  const S = SKY[theme];
  const group = new THREE.Group(); scene.add(group);
  const sunDir = new THREE.Vector3(Math.sin(S.azi) * Math.cos(S.elev), Math.sin(S.elev), -Math.cos(S.azi) * Math.cos(S.elev) * 0.6 + 0.4).normalize();
  const sky = skyDome(S, sunDir); group.add(sky);
  scene.fog = new THREE.Fog(S.fog, 70, 420);

  // reflections come from this very sky
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(skyDome(S, sunDir));
  const gnd = new THREE.Mesh(new THREE.CircleGeometry(800, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(S.hemiG).multiplyScalar(0.6) })); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -5; envScene.add(gnd);
  const env = pm.fromScene(envScene, 0.03).texture; pm.dispose();
  scene.environment = env; scene.environmentIntensity = S.env;

  const sun = new THREE.DirectionalLight(S.sun, S.sunI);
  sun.position.copy(sunDir).multiplyScalar(80).add(new THREE.Vector3(0, 0, -28));
  sun.target.position.set(0, 0, -28); group.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lq ? 1024 : 4096, lq ? 1024 : 4096);
  const sc = sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 10; sc.far = 200;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  group.add(sun);
  group.add(new THREE.HemisphereLight(S.hor, S.hemiG, 0.55));

  // ground
  const gt = groundTexture(theme);
  const groundGeo = new THREE.PlaneGeometry(900, 900, 120, 120);
  const pos = groundGeo.attributes.position, gn = rng(theme * 13 + 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = -pos.getY(i), d = Math.max(0, Math.abs(x) - 30 - Math.max(0, -z) * 0.4) + Math.max(0, z - 25) + Math.max(0, -z - 120);
    pos.setZ(i, d > 0 ? (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 3 + Math.sin(x * 0.013 + z * 0.02) * 8) * Math.min(1, d / 40) : 0);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: gt.map, bumpMap: gt.bmp, bumpScale: 1.5, roughness: theme === 3 ? 0.7 : 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  // a trodden dirt patch around the cannon
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(3.2, 40), new THREE.MeshStandardMaterial({ color: theme === 3 ? 0xc8cfd8 : theme === 2 ? 0xb07a4c : 0x7a5e40, roughness: 1, transparent: true, opacity: 0.85, map: canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, '#fff'); gr.addColorStop(0.7, '#ddd'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }) }));
  dirt.rotation.x = -Math.PI / 2; dirt.position.set(-0.8, 0.01, 0.4); dirt.receiveShadow = true; group.add(dirt);

  // far mountains, tinted by the fog
  const mtnMat = new THREE.MeshStandardMaterial({ color: [0x5d7a52, 0x7a6448, 0xa0583a, 0xdde6f0][theme], roughness: 1, flatShading: true });
  const mR = rng(theme * 7 + 1);
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI * 0.95 + (i / 25) * Math.PI * 1.9 + (mR() - 0.5) * 0.1, r = 260 + mR() * 160, h = (theme === 2 ? 30 : 50) + mR() * (theme === 3 ? 110 : 70);
    const geo = theme === 2 ? new THREE.CylinderGeometry(30 + mR() * 30, 45 + mR() * 30, h * 0.6, 7, 3) : new THREE.ConeGeometry(50 + mR() * 60, h, 7, 4);
    const p = geo.attributes.position; for (let k = 0; k < p.count; k++) if (p.getY(k) < h * 0.29) { p.setX(k, p.getX(k) * (0.85 + mR() * 0.3)); p.setZ(k, p.getZ(k) * (0.85 + mR() * 0.3)); p.setY(k, p.getY(k) + (mR() - 0.5) * 4); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mtnMat); m.position.set(Math.sin(a) * r, theme === 2 ? h * 0.3 - 2 : h / 2 - 4, -Math.cos(a) * r * 0.9 - 60); group.add(m);
    if (theme === 3 || (theme === 0 && h > 100)) { const cap = new THREE.Mesh(new THREE.ConeGeometry(geo.parameters.radius * 0.36, h * 0.36, 7, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, flatShading: true })); cap.position.copy(m.position); cap.position.y += h * 0.33; group.add(cap); }
  }

  // trees / cacti / rocks along the sides (instanced)
  const R = rng(theme * 101 + 9), spots = [];
  for (let i = 0; i < (lq ? 90 : 260); i++) {
    const z = 18 - R() * 170, side = R() < 0.5 ? -1 : 1, x = side * (16 + Math.max(0, -z) * 0.42 + R() * 60);
    spots.push([x, z, 0.7 + R() * 0.8, R() * 6.28]);
  }
  const dummy = new THREE.Object3D();
  const inst = (geo, mat, list, f) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((s, i) => { f(dummy, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); }); im.castShadow = true; im.receiveShadow = true; group.add(im); return im; };
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 1 });
  if (theme === 2) {
    const cactus = new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.8 });
    const cs = spots.slice(0, spots.length / 2), rs = spots.slice(spots.length / 2);
    inst(new THREE.CapsuleGeometry(0.35, 3, 6, 10), cactus, cs, (d, [x, z, s, r]) => { d.position.set(x, 1.8 * s, z); d.scale.setScalar(s); d.rotation.set(0, r, 0); });
    inst(new THREE.CapsuleGeometry(0.22, 1.1, 6, 8), cactus, cs, (d, [x, z, s, r]) => { d.position.set(x + Math.cos(r) * 0.55 * s, 2.3 * s, z + Math.sin(r) * 0.55 * s); d.scale.setScalar(s); d.rotation.set(0, r, 0); });
    inst(new THREE.DodecahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x9a5a3a, roughness: 1, flatShading: true }), rs, (d, [x, z, s, r]) => { d.position.set(x, 0.3 * s, z); d.scale.set(s * 1.8, s * 1.1, s * 1.4); d.rotation.set(r, r * 2, 0); });
  } else {
    const leaf = new THREE.MeshStandardMaterial({ color: [0x3f6b2a, 0xc0621e, 0, 0x2f4a36][theme], roughness: 0.9, flatShading: true });
    const leaf2 = new THREE.MeshStandardMaterial({ color: [0x557f30, 0xd8932a, 0, 0xf4f8fc][theme], roughness: 0.9, flatShading: true });
    const pines = theme === 3 ? spots : spots.filter((_, i) => i % 3 === 0), round = theme === 3 ? [] : spots.filter((_, i) => i % 3 !== 0);
    inst(new THREE.CylinderGeometry(0.18, 0.28, 2, 7), bark, spots, (d, [x, z, s]) => { d.position.set(x, s, z); d.scale.setScalar(s); d.rotation.set(0, 0, 0); });
    if (pines.length) {
      inst(new THREE.ConeGeometry(1.6, 3.2, 8), leaf, pines, (d, [x, z, s, r]) => { d.position.set(x, 3 * s, z); d.scale.setScalar(s); d.rotation.set(0, r, 0); });
      inst(new THREE.ConeGeometry(1.15, 2.4, 8), theme === 3 ? leaf2 : leaf, pines, (d, [x, z, s, r]) => { d.position.set(x, 4.6 * s, z); d.scale.setScalar(s); d.rotation.set(0, r, 0); });
    }
    if (round.length) {
      inst(new THREE.IcosahedronGeometry(1.7, 1), leaf, round, (d, [x, z, s, r]) => { d.position.set(x, 3.4 * s, z); d.scale.set(s, s * 0.9, s); d.rotation.set(r, r, 0); });
      inst(new THREE.IcosahedronGeometry(1.1, 1), leaf2, round, (d, [x, z, s, r]) => { d.position.set(x + 0.6 * s, 4.4 * s, z + 0.3 * s); d.scale.setScalar(s); d.rotation.set(0, r, r); });
    }
    // little rocks and tufts scattered close to the play area
    const near = []; for (let i = 0; i < 70; i++) { const z = 8 - R() * 70, x = (R() < 0.5 ? -1 : 1) * (6 + R() * 22); if (Math.abs(x) > 5) near.push([x, z, 0.15 + R() * 0.35, R() * 6]); }
    inst(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: theme === 3 ? 0x8a929c : 0x8a8478, roughness: 1, flatShading: true }), near, (d, [x, z, s, r]) => { d.position.set(x, s * 0.3, z); d.scale.set(s * 1.4, s, s * 1.2); d.rotation.set(r, r, 0); });
  }

  // clouds
  const ct = cloudTex(), cm = new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: theme === 3 ? 0.95 : 0.85, color: theme === 2 ? 0xffe6cc : 0xffffff });
  for (let i = 0; i < 22; i++) { const s = new THREE.Sprite(cm); s.position.set((R() - 0.5) * 700, 70 + R() * 70, -60 - R() * 500); s.scale.set(120 + R() * 120, 45 + R() * 30, 1); group.add(s); }

  // snowfall in the frozen world
  let snow = null;
  if (theme === 3) {
    const N = lq ? 600 : 2500, g = new THREE.BufferGeometry(), p = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { p[i * 3] = (R() - 0.5) * 80; p[i * 3 + 1] = R() * 30; p[i * 3 + 2] = 10 - R() * 80; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
    group.add(snow);
  }

  return {
    group, sun, sunDir,
    update(dt, t) {
      if (snow) { const a = snow.geometry.attributes.position; for (let i = 0; i < a.count; i++) { let y = a.getY(i) - dt * 1.2; if (y < 0) y += 30; a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(t + i) * dt * 0.3); } a.needsUpdate = true; }
    },
    dispose() { scene.remove(group); group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); env.dispose(); },
  };
}
