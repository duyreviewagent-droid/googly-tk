// Googly TK — the googlys (glossy jelly beans with rattling googly eyes) and the cannon they ride.
import * as THREE from '../vendor/three.module.js';
import { AMMO } from './physics.js';

const std = (color, rough = 0.6, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const skinCache = new Map();
function jellyMat(color) {
  if (skinCache.has(color)) return skinCache.get(color);
  const c = new THREE.Color(color), hex = '#' + c.getHexString();
  const lt = '#' + c.clone().lerp(new THREE.Color('#fff'), 0.35).getHexString(), dk = '#' + c.clone().multiplyScalar(0.5).getHexString();
  const map = canvasTex(128, 128, (g, w) => { g.fillStyle = hex; g.fillRect(0, 0, w, w); for (let i = 0; i < 700; i++) { g.fillStyle = Math.random() < 0.5 ? lt + '16' : dk + '16'; g.fillRect(Math.random() * w, Math.random() * w, 3, 3); } });
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map, roughness: 0.26, clearcoat: 0.8, clearcoatRoughness: 0.15, sheen: 0.4, sheenColor: c.clone().lerp(new THREE.Color('#fff'), 0.5) });
  skinCache.set(color, m);
  return m;
}
const COLORS = { yellow: '#ffd21f', red: '#e8322a', blue: '#2d8cff', black: '#2e2e36' };

const V = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), E = new THREE.Vector3(), UX = new THREE.Vector3(), UY = new THREE.Vector3(), Q = new THREE.Quaternion();

/** A googly. Its group's origin is the middle of its capsule (same as the physics body). */
export class Googly {
  constructor(kind = 'yellow') {
    const A = AMMO[kind], s = A.r / 0.3;
    this.kind = kind;
    this.group = new THREE.Group();
    this.root = new THREE.Group(); this.root.scale.setScalar(s); this.group.add(this.root);
    const mat = jellyMat(COLORS[kind]);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.38, 12, 28), mat);
    body.castShadow = true; body.receiveShadow = true; this.root.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), jellyMat(new THREE.Color(COLORS[kind]).lerp(new THREE.Color('#fff'), 0.3).getStyle()));
    belly.scale.set(1, 1.3, 0.42); belly.position.set(0, -0.14, 0.19); this.root.add(belly);
    // googly eyes
    this.eyes = [];
    for (const side of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(side * 0.125, 0.27, 0.268); e.rotation.set(-0.08, side * 0.28, 0);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.134, 0.134, 0.03, 32), std(0x15151a, 0.5)); rim.rotation.x = Math.PI / 2; e.add(rim);
      const white = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.036, 32), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1 })); white.rotation.x = Math.PI / 2; e.add(white);
      const pupil = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 24), std(0x050505, 0.2)); pupil.rotation.x = Math.PI / 2; pupil.position.set(0, -0.03, 0.022); e.add(pupil);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.128, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transmission: 0.95, transparent: true, opacity: 0.35, clearcoat: 1 }));
      dome.rotation.x = Math.PI / 2; dome.scale.y = 0.22; dome.position.z = 0.018; e.add(dome);
      this.root.add(e);
      this.eyes.push({ node: e, pupil, p: new THREE.Vector2(0, -0.03), v: new THREE.Vector2(), last: null, lastV: new THREE.Vector3() });
    }
    this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 8, 16, Math.PI), std(0x2a0c12, 0.4));
    this.mouth.position.set(0, 0.1, 0.29); this.mouth.rotation.z = Math.PI; this.root.add(this.mouth);
    this.oMouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.018, 8, 16), std(0x2a0c12, 0.4));
    this.oMouth.position.set(0, 0.08, 0.292); this.oMouth.visible = false; this.root.add(this.oMouth);
    // stubby arms
    this.arms = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * 0.29, 0.02, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 6, 12), mat); arm.position.y = -0.13; arm.castShadow = true;
      pivot.add(arm); pivot.rotation.z = side * 0.35; this.root.add(pivot); this.arms.push(pivot);
    }
    // little feet
    for (const side of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), mat); f.scale.set(1, 0.6, 1.4); f.position.set(side * 0.13, -0.47, 0.05); f.castShadow = true; this.root.add(f);
    }
    if (kind === 'red') {
      // a dented steel helmet: Big Red means business
      const helm = new THREE.Mesh(new THREE.SphereGeometry(0.31, 28, 12, 0, Math.PI * 2, 0, 1.05), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.35 }));
      helm.position.y = 0.2; helm.castShadow = true; this.root.add(helm);
      for (const side of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), std(0x1a0a0a)); b.position.set(side * 0.12, 0.43, 0.26); b.rotation.z = side * -0.4; this.root.add(b); }
    }
    if (kind === 'black') {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.08, 16), std(0x444444, 0.4, 0.7)); cap.position.y = 0.5; this.root.add(cap);
      const fuse = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.53, 0), new THREE.Vector3(0.03, 0.62, 0), new THREE.Vector3(0.08, 0.68, 0.02)]), 12, 0.013, 6), std(0xc9b48a, 0.9));
      this.root.add(fuse);
      this.spark = new THREE.PointLight(0xffaa33, 0, 2.5); this.spark.position.set(0.08, 0.7, 0.02); this.root.add(this.spark);
      this.sparkMesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffdd66 })); this.sparkMesh.position.copy(this.spark.position); this.root.add(this.sparkMesh);
    }
    if (kind === 'blue') {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 10), mat); tuft.position.set(0, 0.55, 0); tuft.rotation.z = 0.3; this.root.add(tuft);
    }
    this.t = Math.random() * 10;
  }
  /** scared/excited face */
  face(o) { this.oMouth.visible = o; this.mouth.visible = !o; }
  pose(armsUp) { this.arms.forEach((a, i) => { const s = i ? 1 : -1; a.rotation.z = s * (armsUp ? 2.6 : 0.35); }); }
  update(dt, lit = false) {
    this.t += dt;
    if (this.spark) { const f = lit ? 0.6 + Math.random() * 0.8 : 0; this.spark.intensity = f * 2; this.sparkMesh.visible = lit; this.sparkMesh.scale.setScalar(0.7 + Math.random() * 0.8); }
    // pupils rattle around under gravity and every jolt
    this.group.updateMatrixWorld(true);
    for (const e of this.eyes) {
      e.node.getWorldPosition(E); e.node.getWorldQuaternion(Q);
      UX.set(1, 0, 0).applyQuaternion(Q); UY.set(0, 1, 0).applyQuaternion(Q);
      if (!e.last) { e.last = E.clone(); e.lastV.set(0, 0, 0); }
      const h0 = Math.max(dt, 1e-3);
      const ve = V.copy(E).sub(e.last).divideScalar(h0);
      const ae = V2.copy(ve).sub(e.lastV).divideScalar(h0); if (ae.length() > 250) ae.setLength(250);
      e.last.copy(E); e.lastV.copy(ve);
      const a3 = V3.set(0, -22, 0).sub(ae), ax = a3.dot(UX), ay = a3.dot(UY);
      for (let k = 0; k < 3; k++) {
        const h = dt / 3;
        e.v.x += ax * h; e.v.y += ay * h; e.v.multiplyScalar(1 - 1.6 * h);
        e.p.x += e.v.x * h; e.p.y += e.v.y * h;
        const maxD = 0.061, d = e.p.length();
        if (d > maxD) { const nx = e.p.x / d, ny = e.p.y / d; e.p.set(nx * maxD, ny * maxD); const vn = e.v.x * nx + e.v.y * ny; if (vn > 0) { e.v.x -= nx * vn * 1.55; e.v.y -= ny * vn * 1.55; } }
      }
      e.pupil.position.set(e.p.x, e.p.y, 0.022);
    }
  }
}

// ------------------------------------------------------------------ the cannon
function woodTex() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6b4424'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${40 + Math.random() * 40},${22 + Math.random() * 20},10,${0.25 + Math.random() * 0.3})`; g.lineWidth = 1 + Math.random() * 2; const y = Math.random() * h; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3); g.stroke(); }
  });
}
export class Cannon {
  constructor() {
    this.group = new THREE.Group();                      // turns left/right (yaw)
    const wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.8 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.85, roughness: 0.38 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc8962e, metalness: 1, roughness: 0.28 });
    // carriage: two cheeks and an axle bed
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape(); shape.moveTo(-0.9, 0); shape.lineTo(0.7, 0); shape.lineTo(0.55, 0.62); shape.lineTo(0.1, 0.8); shape.lineTo(-0.5, 0.5); shape.lineTo(-0.9, 0.3); shape.closePath();
      const cheek = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015 }), wood);
      cheek.rotation.y = Math.PI / 2; cheek.position.set(side * 0.34 - 0.06, 0.25, 0); cheek.castShadow = true; cheek.receiveShadow = true;
      this.group.add(cheek);
      // spoked wheel
      const wheel = new THREE.Group(); wheel.position.set(side * 0.5, 0.42, -0.25);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 10, 32), wood); rim.rotation.y = Math.PI / 2; rim.castShadow = true; wheel.add(rim);
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.022, 8, 32), iron); tyre.rotation.y = Math.PI / 2; wheel.add(tyre);
      for (let k = 0; k < 8; k++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.78, 6), wood); sp.rotation.x = k * Math.PI / 8; wheel.add(sp); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 14), iron); hub.rotation.z = Math.PI / 2; wheel.add(hub);
      this.group.add(wheel);
    }
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 1.5), wood); bed.position.set(0, 0.3, 0.1); bed.castShadow = true; this.group.add(bed);
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 10), iron); axle.rotation.z = Math.PI / 2; axle.position.set(0, 0.42, -0.25); this.group.add(axle);
    // barrel: pitches around the trunnions at PIVOT
    this.pitch = new THREE.Group(); this.pitch.position.set(0, 1.05, 0); this.group.add(this.pitch);
    this.barrel = new THREE.Group(); this.pitch.add(this.barrel);
    const prof = [[0, -0.75], [0.12, -0.78], [0.2, -0.72], [0.27, -0.6], [0.3, -0.45], [0.3, -0.3], [0.27, -0.25], [0.26, 0.2], [0.24, 0.25], [0.24, 0.8], [0.21, 1.4], [0.24, 1.5], [0.25, 1.7], [0.18, 1.7], [0.17, 0.2]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const tube = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), iron); tube.castShadow = true; tube.receiveShadow = true;
    tube.rotation.x = -Math.PI / 2; this.barrel.add(tube);
    for (const z of [0.25, 0.8, 1.45]) { const band = new THREE.Mesh(new THREE.TorusGeometry(z > 1 ? 0.225 : 0.255, 0.025, 8, 36), brass); band.position.z = -z; this.barrel.add(band); }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), brass); knob.position.z = 0.83; this.barrel.add(knob);
    const bore = new THREE.Mesh(new THREE.CircleGeometry(0.175, 28), new THREE.MeshBasicMaterial({ color: 0x050505 })); bore.position.z = -1.68; bore.rotation.y = Math.PI; this.barrel.add(bore);
    const trun = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.74, 12), iron); trun.rotation.z = Math.PI / 2; this.pitch.add(trun);
    // muzzle flash
    this.flash = new THREE.PointLight(0xffaa55, 0, 12); this.flash.position.set(0, 0, -2); this.barrel.add(this.flash);
    this.recoil = 0;
  }
  aim(yaw, pitch) { this.group.rotation.y = -yaw; this.pitch.rotation.x = pitch; }
  fire() { this.recoil = 1; this.flash.intensity = 60; }
  update(dt) {
    this.recoil = Math.max(0, this.recoil - dt * 2.2);
    const r = this.recoil;
    this.barrel.position.z = 0.28 * Math.sin(Math.min(1, r * 1.3) * Math.PI / 2) * r;
    this.flash.intensity *= Math.pow(0.001, dt);
  }
}
