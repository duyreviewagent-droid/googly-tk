// Greedy bot: for each level, tries a handful of aimed shots per googly and keeps the best.
// Proves the levels are beatable with the googlys given and reports how hard each one is.
// usage: node test/solve.mjs FROM TO
import RAPIER from '../web/public/vendor/rapier.js';
import { makeLevel } from '../web/public/js/level.js';
import { Sim, G, PIVOT, speedOf } from '../web/public/js/physics.js';
await RAPIER.init();
const [from = 1, to = 20] = process.argv.slice(2).map(Number);

function aimAt(tx, ty, tz, power) {
  const yaw = Math.atan2(tx, -tz), dx = Math.hypot(tx, tz) - 1.2, dy = ty - PIVOT[1], v = speedOf(power);
  const disc = v ** 4 - G * (G * dx * dx + 2 * dy * v * v);
  if (disc < 0) return null;
  return { yaw, pitch: Math.atan((v * v - Math.sqrt(disc)) / (G * dx)), power };
}
function run(L, shots, upto = Infinity) {
  const s = new Sim(RAPIER, L);
  s.step(0.7);
  for (const sh of shots) {
    s.fire(sh.kind, sh.yaw, sh.pitch, sh.power);
    let t = 0;
    for (; t < 12; t += 0.1) {
      s.step(0.1);
      if (sh.act && t > sh.act) { s.action(); sh.act = 0; }
      if (t > 1.5 && s.settled()) break;
    }
  }
  return s;
}
let fails = 0;
for (let n = from; n <= to; n++) {
  const L = makeLevel(n), t0 = Date.now();
  const chosen = [];
  let s = run(L, chosen);
  const pre = s.frac;
  for (const kind of L.ammo) {
    if (s.frac >= 1) break;
    // candidate targets: each tower's standing blocks
    const cands = [];
    s.peds.forEach((P, i) => {
      const up = s.blocks.filter(b => b.ped === i && !b.down);
      if (!up.length) return;
      const ys = up.map(b => b.body.translation().y), c = P.body.translation();
      const lo = Math.min(...ys), hi = Math.max(...ys);
      for (const f of [0.3, 0.75]) for (const pw of [0.7, 1]) {
        const a = aimAt(c.x, lo + (hi - lo) * f, c.z, pw);
        if (a) cands.push({ ...a, kind, w: up.length, act: kind === 'blue' ? Math.max(0.3, Math.hypot(c.x, c.z) / speedOf(pw) - 0.35) : kind === 'black' ? Math.hypot(c.x, c.z) / speedOf(pw) * 0.98 : 0 });
      }
    });
    let best = null, bestF = -1;
    for (const c of cands) {
      const r = run(L, [...chosen.map(x => ({ ...x })), { ...c }]);
      if (r.frac > bestF) { bestF = r.frac; best = c; }
      r.world.free();
    }
    if (!best) break;
    chosen.push(best);
    s.world.free();
    s = run(L, chosen.map(x => ({ ...x })));
  }
  const ok = s.frac >= L.need;
  if (!ok) fails++;
  console.log(`L${String(n).padStart(3)} ${L.name.padEnd(16)} blocks ${String(L.total).padStart(3)} ammo ${L.ammo.length} [${L.ammo.map(a => a[0]).join('')}] need ${(L.need * 100) | 0}% → got ${(s.frac * 100).toFixed(0)}% with ${chosen.length} shots ${ok ? 'OK' : 'FAIL'}  (pre-knock ${(pre * 100).toFixed(0)}%, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  s.world.free();
}
console.log(fails ? `${fails} level(s) not beaten by the bot` : 'all beaten');
