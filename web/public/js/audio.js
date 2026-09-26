// Googly TK — every sound is synthesized live with Web Audio: cannon booms, wood knocks, glass,
// tin cans, googly voices, and an upbeat little band that changes key and feel with each world.

let ctx = null, master, sfxBus, musicBus, verb, verbSend, noiseBuf;
export const settings = { music: 0.55, sfx: 0.9 };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp);
  // safety ceiling: nothing, ever, gets louder than this — a soft clipper then a limiter
  const clip = ctx.createWaveShaper(), cv = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; cv[i] = Math.tanh(x * 1.2) * 0.8; } clip.curve = cv;
  const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
  comp.connect(lim); lim.connect(clip); clip.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = settings.sfx; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = settings.music; musicBus.connect(master);
  // reverb: a generated outdoor-ish impulse (short, bright early reflections, soft tail)
  verb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) { const t = i / ctx.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (t < 0.04 ? 0.6 : 0.35); } }
  verb.buffer = ir; verbSend = ctx.createGain(); verbSend.gain.value = 0.28; verbSend.connect(verb); verb.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
}
export function setVolumes() { if (!ctx) return; sfxBus.gain.setTargetAtTime(settings.sfx, ctx.currentTime, 0.05); musicBus.gain.setTargetAtTime(settings.music * duck, ctx.currentTime, 0.2); }
let duck = 1;
export function duckMusic(d) { duck = d; setVolumes(); }
export const now = () => (ctx ? ctx.currentTime : 0);

// ---------------------------------------------------------------- building blocks
function out(pan = 0, gain = 1, wet = 0.25, bus = sfxBus) {
  const g = ctx.createGain(); g.gain.value = gain;
  let node = g;
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
  node.connect(bus);
  if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(verbSend); }
  return g;
}
function noise(t, dur, dest, { type = 'bandpass', f = 1000, q = 1, a = 0.002, g = 1, fEnd = null } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (fEnd) fl.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
  const e = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + a); e.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(fl); fl.connect(e); e.connect(dest);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
function tone(t, dur, dest, { type = 'sine', f = 440, fEnd = null, a = 0.003, g = 1, curve = 'exp' } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
  const e = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + a);
  if (curve === 'exp') e.gain.exponentialRampToValueAtTime(0.0008, t + dur); else e.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(e); e.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  return o;
}
// a struck object: a few damped resonant modes
function modes(t, dest, list, g = 1) { for (const [f, d, a] of list) tone(t, d, dest, { f: f * (0.985 + Math.random() * 0.03), g: a * g, a: 0.001 }); }

// ---------------------------------------------------------------- sound effects
/** where a sound is relative to the listener → pan + loudness */
export function place(p, cam) {
  if (!p || !cam) return { pan: 0, vol: 1 };
  const dx = p[0] - cam.x, dz = p[2] - cam.z, d = Math.hypot(dx, p[1] - cam.y, dz);
  return { pan: Math.max(-0.8, Math.min(0.8, dx / Math.max(6, d) * 1.3)), vol: Math.min(1, 9 / (d + 3)) };
}
let hitBudget = 0, hitT = 0;
export const sfx = {
  click() { if (!ctx) return; const t = ctx.currentTime; tone(t, 0.06, out(0, 0.25, 0), { type: 'triangle', f: 900, fEnd: 1300 }); },
  hover() { if (!ctx) return; tone(ctx.currentTime, 0.04, out(0, 0.08, 0), { f: 1500 }); },
  boom(big = false) {
    if (!ctx) return; const t = ctx.currentTime, o = out(0, big ? 1.1 : 0.95, 0.45);
    tone(t, 0.55, o, { f: 110, fEnd: 34, g: 1.1 });
    tone(t, 0.25, o, { type: 'triangle', f: 70, fEnd: 40, g: 0.6 });
    noise(t, 0.9, o, { type: 'lowpass', f: 2600, fEnd: 180, g: 0.9, q: 0.4 });
    noise(t, 0.08, o, { type: 'highpass', f: 3000, g: 0.5 });
    noise(t + 0.03, 1.8, out(0, 0.15, 0.6), { type: 'bandpass', f: 600, fEnd: 200, g: 0.6, q: 0.5 });    // rolling echo
  },
  // the rising whine while you hold to charge
  chargeStart() {
    if (!ctx) return null; const t = ctx.currentTime, o = out(0, 0.0, 0.1);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 180;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 6;
    osc.connect(f); f.connect(o); osc.start(t);
    const hiss = ctx.createBufferSource(); hiss.buffer = noiseBuf; hiss.loop = true; const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 5000; hf.Q.value = 2; const hg = ctx.createGain(); hg.gain.value = 0.25; hiss.connect(hf); hf.connect(hg); hg.connect(o); hiss.start(t);
    return { set(p) { osc.frequency.setTargetAtTime(160 + p * 380, ctx.currentTime, 0.03); f.frequency.setTargetAtTime(600 + p * 2600, ctx.currentTime, 0.03); o.gain.setTargetAtTime(0.05 + p * 0.09, ctx.currentTime, 0.03); },
      stop() { o.gain.setTargetAtTime(0, ctx.currentTime, 0.02); osc.stop(ctx.currentTime + 0.2); hiss.stop(ctx.currentTime + 0.2); } };
  },
  // googly voices: formant-filtered buzz sliding in pitch
  voice(kind = 'whee', pitch = 1, pan = 0, vol = 1) {
    if (!ctx) return; const t = ctx.currentTime, o = out(pan, 0.22 * vol, 0.25);
    const shapes = { whee: [[420, 900, 0.7], [1.7, 1.2]], hup: [[300, 360, 0.14], [1, 1]], ow: [[520, 260, 0.35], [1.3, 0.8]], yay: [[380, 620, 0.5], [1, 1.6]], uhoh: [[400, 300, 0.5], [1.1, 0.9]] };
    const [[f0, f1, d], [fa, fb]] = shapes[kind] || shapes.whee;
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * pitch, t); src.frequency.exponentialRampToValueAtTime(f1 * pitch, t + d);
    const vib = ctx.createOscillator(); vib.frequency.value = 7; const vg = ctx.createGain(); vg.gain.value = 12 * pitch; vib.connect(vg); vg.connect(src.frequency); vib.start(t); vib.stop(t + d + 0.1);
    const e = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(1, t + 0.02); e.gain.setValueAtTime(1, t + d * 0.7); e.gain.linearRampToValueAtTime(0, t + d);
    for (const [F, Q, G] of [[800 * fa, 8, 1], [1300 * fb, 10, 0.6], [2600, 12, 0.25]]) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(F, t); bp.frequency.linearRampToValueAtTime(F * (fb / fa), t + d); bp.Q.value = Q; const g = ctx.createGain(); g.gain.value = G * 3; src.connect(bp); bp.connect(g); g.connect(e); }
    e.connect(o); src.start(t); src.stop(t + d + 0.05);
  },
  load() { if (!ctx) return; const t = ctx.currentTime, o = out(-0.3, 0.3, 0.1); tone(t, 0.12, o, { f: 300, fEnd: 700, type: 'triangle' }); noise(t + 0.25, 0.12, o, { type: 'lowpass', f: 500, g: 0.8 }); tone(t + 0.25, 0.15, o, { f: 90, fEnd: 50, g: 0.8 }); },
  /** something hit something. mat decides the voice, s is how hard (m/s change), m its mass */
  hit(mat, s, p, cam) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - hitT > 0.05) { hitT = t; hitBudget = 0; }
    if (hitBudget++ > 5) return;                                        // a collapsing tower shouldn't clip
    const { pan, vol } = place(p, cam);
    const k = Math.min(1, s / 7) * vol, o = out(pan, 0.9 * k, 0.3);
    const j = 0.9 + Math.random() * 0.2;
    switch (mat) {
      case 'wood': modes(t, o, [[210 * j, 0.14, 0.5], [480 * j, 0.09, 0.4], [930 * j, 0.05, 0.25], [1650 * j, 0.03, 0.12]]); noise(t, 0.05, o, { f: 1800 * j, q: 1.2, g: 0.5 }); break;
      case 'stone': modes(t, o, [[95 * j, 0.18, 0.7], [240 * j, 0.1, 0.35]]); noise(t, 0.12, o, { type: 'lowpass', f: 1400, g: 0.9 }); noise(t, 0.2, o, { f: 3500, q: 0.7, g: 0.12 }); break;
      case 'metal': modes(t, o, [[640 * j, 0.5, 0.35], [1480 * j, 0.35, 0.25], [2350 * j, 0.25, 0.18], [3900 * j, 0.15, 0.1]]); noise(t, 0.03, o, { f: 4000, g: 0.4 }); break;
      case 'glass': case 'ice': modes(t, o, [[2100 * j, 0.25, 0.25], [3300 * j, 0.2, 0.18], [5200 * j, 0.12, 0.1]]); noise(t, 0.03, o, { type: 'highpass', f: 5000, g: 0.3 }); break;
      case 'gold': modes(t, o, [[880 * j, 0.6, 0.3], [1760 * j, 0.4, 0.15], [2640 * j, 0.3, 0.1]]); break;
      default: noise(t, 0.1, o, { type: 'lowpass', f: 700, g: 0.8 });
    }
  },
  thud(s, p, cam) { if (!ctx) return; const { pan, vol } = place(p, cam), t = ctx.currentTime, o = out(pan, Math.min(1, s / 12) * vol * 0.8, 0.2); tone(t, 0.18, o, { f: 120, fEnd: 60 }); noise(t, 0.12, o, { type: 'lowpass', f: 600, g: 0.8 }); tone(t, 0.12, o, { f: 260 + Math.random() * 60, fEnd: 180, type: 'triangle', g: 0.4 }); },
  shatter(p, cam, ice = false) {
    if (!ctx) return; const { pan, vol } = place(p, cam), t = ctx.currentTime, o = out(pan, 0.7 * Math.max(0.35, vol), 0.4);
    noise(t, 0.35, o, { type: 'highpass', f: ice ? 2500 : 3500, g: 0.9 });
    noise(t, 0.12, o, { f: 1800, q: 1, g: 0.6 });
    for (let i = 0; i < 14; i++) { const tt = t + 0.02 + Math.random() * 0.45; tone(tt, 0.08 + Math.random() * 0.12, o, { f: (ice ? 2600 : 3000) + Math.random() * 4500, g: 0.12 + Math.random() * 0.12 }); }
  },
  explode(p, cam) {
    if (!ctx) return; const { pan } = place(p, cam), t = ctx.currentTime, o = out(pan * 0.5, 1.2, 0.5);
    tone(t, 0.9, o, { f: 80, fEnd: 25, g: 1.2 });
    noise(t, 1.6, o, { type: 'lowpass', f: 3500, fEnd: 120, g: 1.2, q: 0.3 });
    noise(t, 0.2, o, { type: 'highpass', f: 2000, g: 0.7 });
    for (let i = 0; i < 10; i++) noise(t + 0.1 + Math.random() * 0.9, 0.06, o, { f: 800 + Math.random() * 2000, g: 0.25 });     // debris pattering
  },
  split() { if (!ctx) return; const t = ctx.currentTime, o = out(0, 0.4, 0.3); tone(t, 0.12, o, { f: 500, fEnd: 1400, type: 'square', g: 0.15 }); for (const d of [0, 0.05, 0.1]) tone(t + d, 0.1, o, { f: 900 + d * 4000, fEnd: 1800 + d * 4000, type: 'triangle', g: 0.3 }); },
  fuse() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.1, out(0, 0.05, 0), { type: 'highpass', f: 6000, g: 0.5 }); },
  // a block knocked off: a bright ding that climbs with each one in a row
  down(combo, pts, p, cam) {
    if (!ctx) return; const t = ctx.currentTime, { pan } = place(p, cam), o = out(pan * 0.5, 0.16, 0.3);
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const f = 660 * Math.pow(2, scale[Math.min(combo, scale.length - 1)] / 12);
    tone(t, 0.25, o, { f, type: 'triangle' }); tone(t, 0.18, o, { f: f * 2, g: 0.3 });
    if (pts >= 500) { tone(t + 0.08, 0.5, o, { f: f * 1.5, g: 0.8 }); tone(t + 0.16, 0.6, o, { f: f * 2, g: 0.6 }); }
  },
  star(i) { if (!ctx) return; const t = ctx.currentTime, o = out(0, 0.35, 0.4), f = [784, 988, 1175][i] || 1175; tone(t, 0.6, o, { f, type: 'triangle' }); tone(t, 0.8, o, { f: f * 2, g: 0.3 }); noise(t, 0.3, o, { type: 'highpass', f: 7000, g: 0.2 }); },
  clear() {
    if (!ctx) return; const t = ctx.currentTime, o = out(0, 0.3, 0.35);
    const notes = [[0, 523], [0.12, 659], [0.24, 784], [0.36, 1047], [0.6, 988], [0.72, 1047], [0.84, 1319]];
    for (const [d, f] of notes) { tone(t + d, 0.35, o, { f, type: 'square', g: 0.2 }); tone(t + d, 0.4, o, { f, type: 'triangle', g: 0.5 }); }
    for (const f of [523, 659, 784, 1047]) tone(t + 0.96, 1.4, o, { f, type: 'sawtooth', g: 0.1, curve: 'lin' });
    noise(t + 0.96, 0.8, o, { type: 'highpass', f: 6000, g: 0.25 });
  },
  fail() { if (!ctx) return; const t = ctx.currentTime, o = out(0, 0.3, 0.3); [[0, 392], [0.3, 370], [0.6, 349], [0.9, 330]].forEach(([d, f], i) => { const osc = tone(t + d, i === 3 ? 1 : 0.3, o, { f, type: 'sawtooth', g: 0.25 }); if (i === 3) { const l = ctx.createOscillator(); l.frequency.value = 6; const lg = ctx.createGain(); lg.gain.value = 8; l.connect(lg); lg.connect(osc.frequency); l.start(t + d); l.stop(t + d + 1); } }); },
  saved() { if (!ctx) return; const t = ctx.currentTime; tone(t, 0.1, out(0, 0.06, 0), { f: 1320, type: 'triangle' }); },
};

// ---------------------------------------------------------------- the band
// A lookahead scheduler against the audio clock, 16th-note grid. Each world has its own key, tempo and groove;
// the melody is composed from a seed in A-A-B-A form so it sticks in your head without looping every 2 bars.
const WORLDS = [
  { root: 60, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 5, 3, 4], bpm: 108, swing: 0.08, lead: 'marimba' },        // meadow: sunny C major
  { root: 57, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6], bpm: 96, swing: 0.14, lead: 'pluck' },           // autumn: A minor, lazy swing
  { root: 62, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 1, 0, 6], bpm: 102, swing: 0.1, lead: 'pluck' },           // desert: D phrygian dominant
  { root: 65, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 4, 5, 3], bpm: 112, swing: 0.0, lead: 'bell' },            // snow: F lydian, sparkly
  { root: 55, scale: [0, 2, 4, 5, 7, 9, 10], prog: [0, 6, 3, 0], bpm: 100, swing: 0.06, lead: 'marimba' },        // title: G mixolydian
];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
let song = null;

function compose(W, seed) {
  let s = seed >>> 0; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const phrase = () => { const notes = []; let deg = 2 + Math.floor(R() * 3); for (let i = 0; i < 32; i++) { const hit = i % 4 === 0 ? R() < 0.85 : i % 2 === 0 ? R() < 0.45 : R() < 0.15; if (hit) { deg += Math.floor(R() * 5) - 2; deg = Math.max(0, Math.min(9, deg)); notes.push([i, deg, i % 4 === 0 && R() < 0.4 ? 2 : 1]); } } return notes; };
  const A = phrase(), B = phrase();
  return [A, A, B, A];
}
function chordNotes(W, deg) { return [0, 2, 4].map(k => { const d = deg + k; return W.root + W.scale[d % 7] + 12 * Math.floor(d / 7); }); }

function kick(t, g) { const o = out(0, g, 0.05, musicBus); tone(t, 0.3, o, { f: 140, fEnd: 42, g: 1 }); tone(t, 0.02, o, { f: 1200, g: 0.3, type: 'triangle' }); }
function snare(t, g) { const o = out(0.05, g, 0.25, musicBus); noise(t, 0.18, o, { f: 2200, q: 0.6, g: 0.8 }); tone(t, 0.1, o, { f: 200, fEnd: 150, type: 'triangle', g: 0.6 }); }
function hat(t, g, open) { const o = out(0.2, g, 0.1, musicBus); noise(t, open ? 0.25 : 0.04, o, { type: 'highpass', f: 8000, g: 0.7 }); }
function shaker(t, g) { const o = out(-0.25, g, 0.1, musicBus); noise(t, 0.06, o, { type: 'bandpass', f: 6500, q: 1.5, a: 0.02, g: 0.6 }); }
function bass(t, m, d, g) {
  const o = out(0, g, 0.03, musicBus), f = mtof(m);
  const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
  const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = f;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(220, t + 0.18);
  const e = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.5, t + 0.005); e.gain.exponentialRampToValueAtTime(0.001, t + d);
  osc.connect(lp); lp.connect(e); const sg = ctx.createGain(); sg.gain.value = 0.7; sub.connect(sg); sg.connect(e); e.connect(o);
  osc.start(t); sub.start(t); osc.stop(t + d + 0.05); sub.stop(t + d + 0.05);
}
function keys(t, ms, d, g) {
  // soft electric piano: FM bell on top of a sine
  const o = out(-0.15, g, 0.35, musicBus);
  for (const m of ms) {
    const f = mtof(m), c = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
    c.frequency.value = f; mod.frequency.value = f * 14; mg.gain.setValueAtTime(f * 1.2, t); mg.gain.exponentialRampToValueAtTime(1, t + 0.4);
    mod.connect(mg); mg.connect(c.frequency);
    const e = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.18, t + 0.01); e.gain.exponentialRampToValueAtTime(0.001, t + d);
    c.connect(e); e.connect(o); c.start(t); mod.start(t); c.stop(t + d + 0.05); mod.stop(t + d + 0.05);
  }
}
const plucks = new Map();
function pluckBuf(m) {
  if (plucks.has(m)) return plucks.get(m);
  const sr = ctx.sampleRate, len = Math.floor(sr * 1.8), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
  const N = Math.max(2, Math.round(sr / mtof(m))), ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  let peak = 0;
  for (let i = 0; i < len; i++) { const k = i % N, nx = (k + 1) % N; const v = ring[k]; ring[k] = 0.996 * 0.5 * (ring[k] + ring[nx]); d[i] = v; peak = Math.max(peak, Math.abs(v)); }
  for (let i = 0; i < len; i++) d[i] /= peak || 1;       // averaging only ever shrinks it, so this is always <= 1
  plucks.set(m, b);
  return b;
}
function lead(t, m, d, g, kind) {
  const o = out(0.2, g, 0.4, musicBus), f = mtof(m);
  if (kind === 'marimba') { tone(t, 0.45 * d, o, { f, g: 0.8 }); tone(t, 0.12, o, { f: f * 4, g: 0.25 }); tone(t, 0.05, o, { f: f * 10, g: 0.08 }); }
  else if (kind === 'bell') { tone(t, 1.2 * d, o, { f, g: 0.5 }); tone(t, 0.8 * d, o, { f: f * 2.76, g: 0.2 }); tone(t, 0.4, o, { f: f * 5.4, g: 0.1 }); }
  else {
    // plucked string: Karplus-Strong computed once per note into a buffer (no live feedback loop, so it can never run away)
    const src = ctx.createBufferSource(); src.buffer = pluckBuf(m);
    const e = ctx.createGain(); e.gain.setValueAtTime(0.9, t); e.gain.setTargetAtTime(0, t + 0.6 * d, 0.1);
    src.connect(e); e.connect(o); src.start(t); src.stop(t + 2);
  }
}

export function playMusic(world, seed = 1, calm = false) {
  if (!ctx) return;
  const key = world + ':' + seed + ':' + calm;
  if (song && song.key === key) return;
  stopMusic();
  const W = WORLDS[world] || WORLDS[0];
  const S = { key, W, mel: compose(W, seed * 31 + world * 7), step: 0, next: ctx.currentTime + 0.1, calm, alive: true };
  const sp16 = 60 / W.bpm / 4;
  S.timer = setInterval(() => {
    if (!S.alive) return;
    while (S.next < ctx.currentTime + 0.2) {
      const st = S.step, bar = Math.floor(st / 16) % 16, i16 = st % 16, sec = Math.floor(bar / 4), inSec = (bar % 4) * 16 + i16;
      const t = S.next + (i16 % 2 ? W.swing * sp16 * 2 : 0);
      const chord = W.prog[bar % 4], ch = chordNotes(W, chord);
      const drums = !S.calm && bar >= 2;
      if (drums) {
        if (i16 === 0 || i16 === 8 || (i16 === 10 && bar % 2)) kick(t, 0.55);
        if (i16 === 4 || i16 === 12) snare(t, 0.3);
        if (i16 % 2 === 0) hat(t, i16 % 4 === 2 ? 0.12 : 0.07, i16 === 14 && bar % 4 === 3);
      }
      shaker(t, S.calm ? 0.03 : 0.05);
      if (i16 === 0 || i16 === 6 || i16 === 10 || (i16 === 14 && bar % 2)) bass(t, ch[0] - 24 + (i16 === 10 ? 12 : 0), sp16 * 3, S.calm ? 0.18 : 0.3);
      if (i16 === 0 || i16 === 7 || i16 === 12) keys(t, ch.map(m => m - 12), sp16 * (i16 === 0 ? 6 : 3), 0.14);
      if (bar >= 4 || S.calm) {
        const ph = S.mel[sec];
        for (const [pos, deg, len] of ph) if (pos === inSec % 32 && (inSec < 32 ? true : true)) {
          const m = W.root + W.scale[deg % 7] + 12 * Math.floor(deg / 7) + 12;
          lead(t, m, sp16 * 4 * len, S.calm ? 0.12 : 0.17, W.lead);
        }
      }
      S.step++; S.next += sp16;
    }
  }, 50);
  song = S;
}
export function stopMusic() { if (song) { song.alive = false; clearInterval(song.timer); song = null; } }
