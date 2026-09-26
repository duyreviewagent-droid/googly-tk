// Googly TK — the physics world (Rapier). No three.js here: the page draws what this simulates,
// and test/solve.mjs runs the very same code in node to prove every level can be beaten.

import { rng } from "./level.js";

export const G = 9.81, DT = 1 / 120;
export const PIVOT = [0, 1.05, 0], BARREL = 1.7;
export const speedOf = p => 12 + 24 * p;                      // power 0..1 → 12..36 m/s
export function aimDir(yaw, pitch) { return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]; }
export function muzzle(yaw, pitch) { const d = aimDir(yaw, pitch); return [PIVOT[0] + d[0] * BARREL, PIVOT[1] + d[1] * BARREL, PIVOT[2] + d[2] * BARREL]; }

// real-ish densities (tonnes per m³) — the googly is a jelly bean about as dense as water
export const MATS = {
  wood: { density: 0.6, friction: 0.62, rest: 0.12, pts: 100 },
  stone: { density: 2.4, friction: 0.75, rest: 0.04, pts: 200 },
  glass: { density: 2.5, friction: 0.35, rest: 0.1, pts: 150, breakF: 220, breakDv: 3.2 },
  ice: { density: 0.92, friction: 0.03, rest: 0.08, pts: 150, breakF: 320, breakDv: 4.5 },
  metal: { density: 0.35, friction: 0.45, rest: 0.25, pts: 120 },       // hollow tin cans
  gold: { density: 1.2, friction: 0.5, rest: 0.1, pts: 500 },
};
export const AMMO = {
  yellow: { r: 0.3, hh: 0.19, density: 1.0 },
  red: { r: 0.38, hh: 0.24, density: 3.4 },
  blue: { r: 0.26, hh: 0.16, density: 1.1 },
  black: { r: 0.3, hh: 0.19, density: 1.4 },
};
const BOMB_R = 3.4;

function quatYaw(y) { return { x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) }; }
// rotation turning +Y (the capsule axis) onto direction d
function quatFromUp(d) {
  const [x, y, z] = d, l = Math.hypot(x, y, z); const ax = z / l, az = -x / l, dot = y / l;
  const s = Math.hypot(ax, az);
  if (s < 1e-6) return dot > 0 ? { x: 0, y: 0, z: 0, w: 1 } : { x: 1, y: 0, z: 0, w: 0 };
  const ang = Math.acos(Math.max(-1, Math.min(1, dot))), k = Math.sin(ang / 2) / s;
  return { x: ax * k, y: 0, z: az * k, w: Math.cos(ang / 2) };
}

export class Sim {
  constructor(R, L) {
    this.R = R; this.L = L; this.rand = rng(L.seed); this.t = 0; this.acc = 0; this.armed = 0.6;
    const w = this.world = new R.World({ x: 0, y: -G, z: 0 });
    w.timestep = DT;
    w.integrationParameters.numSolverIterations = 8;
    this.eq = new R.EventQueue(true);
    this.cols = new Map();                                     // collider handle → what it belongs to
    this.events = [];

    const ground = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.5, -40));
    this.cols.set(w.createCollider(R.ColliderDesc.cuboid(200, 0.5, 200).setFriction(0.9).setRestitution(0.1), ground).handle, { k: 'ground' });

    this.peds = L.pedestals.map((p, i) => {
      const moving = !!p.moving;
      const bd = (moving ? R.RigidBodyDesc.kinematicVelocityBased() : R.RigidBodyDesc.fixed()).setTranslation(p.x, p.h / 2, p.z);
      const body = w.createRigidBody(bd);
      const col = w.createCollider(R.ColliderDesc.cuboid(p.w, p.h / 2, p.d).setFriction(0.8).setRestitution(0.05), body);
      this.cols.set(col.handle, { k: 'ped', i });
      return { ...p, body, i, x0: p.x };
    });

    this.blocks = L.blocks.map((b, i) => {
      const P = this.peds[b.ped], M = MATS[b.mat];
      const body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(P.x + b.p[0], P.h + b.p[1], P.z + b.p[2]).setRotation(quatYaw(b.yaw))
        .setLinearDamping(0.02).setAngularDamping(0.08).setCanSleep(true));
      let cd = b.shape === 'box' ? R.ColliderDesc.cuboid(...b.h) : R.ColliderDesc.cylinder(b.hh, b.r);
      cd = cd.setDensity(M.density).setFriction(M.friction).setRestitution(M.rest);
      if (M.breakF) cd = cd.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(M.breakF * 0.5);
      const col = w.createCollider(cd, body);
      const blk = { i, def: b, body, col, mat: b.mat, mass: body.mass(), down: false, broken: false, ped: b.ped, lv: { x: 0, y: 0, z: 0 }, cool: 0 };
      this.cols.set(col.handle, { k: 'block', b: blk });
      return blk;
    });
    // put everyone to sleep so perfectly stacked towers stand still until something hits them
    for (const b of this.blocks) if (!this.peds[b.ped].moving) b.body.sleep();
    this.ammo = [];
    this.wind = L.wind || { x: 0, z: 0 };
  }

  get total() { return this.blocks.length; }
  get downCount() { let n = 0; for (const b of this.blocks) if (b.down) n++; return n; }
  get frac() { return this.downCount / this.total; }

  fire(kind, yaw, pitch, power) {
    const R = this.R, A = AMMO[kind], d = aimDir(yaw, pitch), m = muzzle(yaw, pitch), v = speedOf(power);
    return this._spawn(kind, m, [d[0] * v, d[1] * v, d[2] * v], d);
  }
  _spawn(kind, pos, vel, dir) {
    const R = this.R, A = AMMO[kind];
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(...pos).setRotation(quatFromUp(dir))
      .setLinvel(...vel).setAngvel({ x: (this.rand() - 0.5) * 2, y: 0, z: (this.rand() - 0.5) * 2 })
      .setCcdEnabled(true).setLinearDamping(0.01).setAngularDamping(0.3));
    const col = this.world.createCollider(R.ColliderDesc.capsule(A.hh, A.r).setDensity(A.density).setFriction(0.7).setRestitution(0.35)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), body);
    if (this.wind.x || this.wind.z) body.addForce({ x: this.wind.x * body.mass(), y: 0, z: this.wind.z * body.mass() }, true);
    const a = { kind, body, col, t: 0, hit: false, hitT: 0, done: false, alive: true, lv: { x: vel[0], y: vel[1], z: vel[2] }, id: this.rand() };
    this.cols.set(col.handle, { k: 'ammo', a });
    this.ammo.push(a);
    this.events.push({ k: 'spawn', a });
    return a;
  }

  /** click while flying: blue splits, black explodes */
  action() {
    for (const a of this.ammo) {
      if (!a.alive || a.done) continue;
      if (a.kind === 'blue' && !a.hit) {
        a.done = true;
        const p = a.body.translation(), v = a.body.linvel(), sp = Math.hypot(v.x, v.y, v.z) || 1;
        for (const s of [-1, 1]) {
          const ang = s * 0.13, c = Math.cos(ang), si = Math.sin(ang);
          const nv = [v.x * c - v.z * si, v.y + s * 0.3, v.x * si + v.z * c];
          const side = [-v.z / sp * s * 0.45, 0, v.x / sp * s * 0.45];
          const b = this._spawn('blue', [p.x + side[0], p.y, p.z + side[2]], nv, nv);
          b.done = true;
        }
        this.events.push({ k: 'split', p: [p.x, p.y, p.z] });
        return true;
      }
      if (a.kind === 'black') { this.explode(a); return true; }
    }
    return false;
  }

  explode(a) {
    const p = a.body.translation();
    a.done = true; this.kill(a);
    for (const b of this.blocks) {
      if (b.broken) continue;
      const q = b.body.translation(), dx = q.x - p.x, dy = q.y - p.y + 0.3, dz = q.z - p.z, d = Math.hypot(dx, dy, dz);
      if (d > BOMB_R) continue;
      const k = 1 - d / BOMB_R;
      if ((b.mat === 'glass' || b.mat === 'ice') && k > 0.3) { this.breakBlock(b); continue; }
      const dv = 2 + 13 * k, l = d || 1, m = b.mass;
      b.body.applyImpulse({ x: dx / l * dv * m, y: (dy / l * 0.6 + 0.4) * dv * m, z: dz / l * dv * m }, true);
      b.body.applyTorqueImpulse({ x: (this.rand() - 0.5) * m * 2, y: (this.rand() - 0.5) * m * 2, z: (this.rand() - 0.5) * m * 2 }, true);
    }
    for (const o of this.ammo) if (o.alive && o !== a) {
      const q = o.body.translation(), d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (d < BOMB_R) o.body.applyImpulse({ x: (q.x - p.x) / d * 6 * o.body.mass(), y: 4 * o.body.mass(), z: (q.z - p.z) / d * 6 * o.body.mass() }, true);
    }
    this.events.push({ k: 'boom', p: [p.x, p.y, p.z] });
  }

  kill(a) {
    if (!a.alive) return;
    a.alive = false;
    this.cols.delete(a.col.handle);
    this.world.removeRigidBody(a.body);
    this.events.push({ k: 'gone', a });
  }

  breakBlock(b) {
    if (b.broken) return;
    const p = b.body.translation(), v = b.body.linvel();
    b.broken = true;
    this.cols.delete(b.col.handle);
    this.world.removeRigidBody(b.body);
    this.events.push({ k: 'break', b, p: [p.x, p.y, p.z], v: [v.x, v.y, v.z] });
    // wake whatever was resting on it
    for (const o of this.blocks) if (!o.broken && o.body.isSleeping()) { const q = o.body.translation(); if (Math.abs(q.x - p.x) < 2 && Math.abs(q.z - p.z) < 2 && q.y > p.y - 0.2) o.body.wakeUp(); }
  }

  /** advance by dt seconds of game time (in fixed 1/120 steps); returns the events that happened */
  step(dt) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= DT) { this.acc -= DT; this._tick(); }
    const ev = this.events; this.events = [];
    return ev;
  }

  _tick() {
    const w = this.world;
    this.t += DT;
    for (const P of this.peds) if (P.moving) {
      const M = P.moving, om = M.speed / M.amp;
      P.body.setLinvel({ x: M.amp * om * Math.cos(this.t * om + M.phase), y: 0, z: 0 }, true);
    }
    w.step(this.eq);
    const armed = this.t > this.armed;
    this.eq.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      for (const [h, o] of [[h1, h2], [h2, h1]]) {
        const c = this.cols.get(h);
        if (c && c.k === 'ammo' && !c.a.hit) { c.a.hit = true; c.a.hitT = c.a.t; const other = this.cols.get(o); this.events.push({ k: 'ahit', a: c.a, on: other ? other.k : 'ground' }); }
      }
    });
    this.eq.drainContactForceEvents(e => {
      if (!armed) return;
      const f = e.maxForceMagnitude();
      for (const h of [e.collider1(), e.collider2()]) {
        const c = this.cols.get(h);
        if (c && c.k === 'block' && !c.b.broken) { const M = MATS[c.b.mat]; if (M.breakF && f > M.breakF) this.breakBlock(c.b); }
      }
    });

    // impacts (for sounds and glass): a sudden change of velocity in one step
    for (const b of this.blocks) {
      if (b.broken) continue;
      if (b.cool > 0) b.cool -= DT;
      if (b.body.isSleeping()) { b.lv.x = b.lv.y = b.lv.z = 0; continue; }
      const v = b.body.linvel(), dv = Math.hypot(v.x - b.lv.x, v.y - b.lv.y, v.z - b.lv.z);
      b.lv.x = v.x; b.lv.y = v.y; b.lv.z = v.z;
      if (!armed) continue;
      const M = MATS[b.mat];
      if (M.breakDv && dv > M.breakDv) { this.breakBlock(b); continue; }
      if (dv > 1.1 && b.cool <= 0) { b.cool = 0.09; const p = b.body.translation(); this.events.push({ k: 'hit', mat: b.mat, p: [p.x, p.y, p.z], s: dv, m: b.mass }); }
      const p = b.body.translation();
      if (p.y < -30) { this.breakBlock(b); }
    }
    for (const a of this.ammo) {
      if (!a.alive) continue;
      a.t += DT;
      const v = a.body.linvel(), dv = Math.hypot(v.x - a.lv.x, v.y - a.lv.y, v.z - a.lv.z);
      a.lv.x = v.x; a.lv.y = v.y; a.lv.z = v.z;
      if (dv > 2.5) { const p = a.body.translation(); this.events.push({ k: 'thud', a, p: [p.x, p.y, p.z], s: dv }); }
      const p = a.body.translation();
      if (a.kind === 'black' && !a.done && ((a.hit && a.t - a.hitT > 1.4) || a.t > 7)) this.explode(a);
      else if (p.y < -20 || Math.abs(p.x) > 180 || p.z < -220 || p.z > 60) this.kill(a);
    }
    // which blocks are now off their pedestal
    for (const b of this.blocks) {
      if (b.down) continue;
      let down = b.broken;
      if (!down) {
        const p = b.body.translation(), P = this.peds[b.ped], c = P.body.translation();
        down = p.y < P.h - 0.02 || Math.abs(p.x - c.x) > P.w + 0.35 || Math.abs(p.z - c.z) > P.d + 0.35;
      }
      if (down) { b.down = true; this.events.push({ k: 'down', b }); }
    }
  }

  /** everything has (nearly) stopped moving */
  settled() {
    for (const a of this.ammo) if (a.alive) { const v = a.body.linvel(); if (Math.hypot(v.x, v.y, v.z) > 0.35) return false; if (a.kind === 'black' && !a.done) return false; }
    for (const b of this.blocks) if (!b.broken && !b.body.isSleeping()) { const v = b.body.linvel(); if (Math.hypot(v.x, v.y, v.z) > 0.2) return false; }
    return true;
  }
}
