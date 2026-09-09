// Inline sound effects. A line like "L-listen, kid. *burp* You copy node_modules first." is split
// into spoken text and synthesized noises. Anything in (parentheses) or [brackets] is a stage
// direction and is dropped. *words* that aren't a known effect are spoken as plain emphasis.

import { SAMPLE_RATE } from "./wav.mjs";
import { biquad, distortion, normalize } from "./effects.mjs";

const TWO_PI = Math.PI * 2;

/**
 * @param {string} text
 * @returns {Array<{type:"text", text:string} | {type:"sfx", name:string}>}
 */
export function parseLine(text) {
  const cleaned = String(text)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const segments = [];
  const re = /\*([^*\n]{1,30})\*/g;
  let last = 0;
  let m;
  let pending = "";
  const flush = () => {
    const t = pending.replace(/\s+/g, " ").trim();
    if (t) segments.push({ type: "text", text: t });
    pending = "";
  };
  while ((m = re.exec(cleaned))) {
    const name = m[1].trim().toLowerCase();
    pending += cleaned.slice(last, m.index);
    if (SFX[name]) {
      flush();
      segments.push({ type: "sfx", name });
    } else {
      pending += " " + m[1] + " ";
    }
    last = re.lastIndex;
  }
  pending += cleaned.slice(last);
  flush();
  return segments;
}

function envelope(n, attackFrac, curve = 1) {
  const env = new Float32Array(n);
  const a = Math.max(1, Math.round(n * attackFrac));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    env[i] = i < a ? i / a : Math.pow(1 - (i - a) / (n - a), curve);
  }
  return env;
}

// Duration, pitch and gurgle rate vary a little per call so repeated burps don't sound copy-pasted.
function burp(sr, { duration = 0.42, base = 110 } = {}) {
  const dur = duration * (0.85 + Math.random() * 0.3);
  const f0 = base * (0.9 + Math.random() * 0.2);
  const gurgleHz = 18 + Math.random() * 12;
  const n = Math.round(dur * sr);
  const y = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = f0 * Math.pow(0.4, t);
    phase += (TWO_PI * f) / sr;
    const saw = 2 * ((phase / TWO_PI) % 1) - 1;
    const noise = Math.random() * 2 - 1;
    const gurgle = 0.7 + 0.3 * Math.sin(TWO_PI * gurgleHz * t * dur);
    const env = Math.min(1, t * 12) * Math.pow(1 - t, 0.8);
    y[i] = (saw * 0.7 + noise * 0.5) * env * gurgle;
  }
  return distortion(biquad(y, "lowpass", 700, 0.8, 0, sr), 2.5);
}

function belch(sr) {
  return burp(sr, { duration: 0.75, base: 85 });
}

function sigh(sr) {
  const n = Math.round(0.7 * sr);
  const y = new Float32Array(n);
  const env = envelope(n, 0.25, 1.5);
  for (let i = 0; i < n; i++) y[i] = (Math.random() * 2 - 1) * env[i];
  const breath = biquad(y, "bandpass", 1300, 1.2, 0, sr);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (TWO_PI * (230 - 60 * t)) / sr;
    breath[i] = breath[i] * 2.5 + Math.sin(phase) * 0.12 * env[i];
  }
  return breath;
}

function gulp(sr) {
  const n = Math.round(0.18 * sr);
  const y = new Float32Array(n);
  const env = envelope(n, 0.05, 2.5);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (TWO_PI * (180 * Math.pow(0.4, t))) / sr;
    const click = i < sr * 0.004 ? (Math.random() * 2 - 1) * 0.6 : 0;
    y[i] = (Math.sin(phase) * 0.9 + click) * env[i];
  }
  return y;
}

function cough(sr) {
  const n = Math.round(0.22 * sr);
  const y = new Float32Array(n);
  const env = envelope(n, 0.03, 2);
  for (let i = 0; i < n; i++) y[i] = (Math.random() * 2 - 1) * env[i];
  return distortion(biquad(y, "bandpass", 900, 0.7, 0, sr), 1.5);
}

function hiccup(sr) {
  const n = Math.round(0.12 * sr);
  const y = new Float32Array(n);
  const env = envelope(n, 0.08, 3);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    phase += (TWO_PI * (380 + 260 * t)) / sr;
    const click = i < sr * 0.003 ? (Math.random() * 2 - 1) * 0.8 : 0;
    y[i] = (Math.sin(phase) * 0.7 + click) * env[i];
  }
  return y;
}

export const SFX = { burp, belch, sigh, gulp, cough, hiccup };

export function synthSfx(name, sr = SAMPLE_RATE) {
  const fn = SFX[name];
  if (!fn) throw new Error(`Unknown sound effect "${name}"`);
  return normalize(fn(sr), 0.7);
}
