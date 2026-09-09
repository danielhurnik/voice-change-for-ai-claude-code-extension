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

// A burp is a rough, irregular voice-box buzz shaped by the mouth: vowel formants ("uuurrp"), a sharp
// onset, a raspy tremor, and a lip-closure "p" at the end. Duration, pitch and tremor vary per call so
// repeated burps don't sound copy-pasted. (A low buzz through a lowpass is a fart. We learned this.)
function burp(sr, { duration = 0.45, base = 75 } = {}) {
  const dur = duration * (0.85 + Math.random() * 0.3);
  const f0 = base * (0.9 + Math.random() * 0.2);
  const tremorHz = 22 + Math.random() * 10;
  const n = Math.round(dur * sr);

  // voice source: glottal-ish pulses whose period jitters every cycle (= rasp), pitch kicks up at the onset then sags
  const src = new Float32Array(n);
  let phase = 0;
  let jitter = 1;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = f0 * (1 + 0.5 * Math.exp(-t * 6)) * (1 - 0.35 * t) * jitter;
    phase += f / sr;
    if (phase >= 1) {
      phase -= 1;
      jitter = 0.8 + Math.random() * 0.4;
    }
    src[i] = Math.pow(1 - phase, 6) * 2 - 0.3 + (Math.random() * 2 - 1) * 0.35;
  }

  // vocal tract: an open "uh/ah"; the first formant sweeps up as the mouth opens
  const f1a = biquad(src, "bandpass", 450, 4, 0, sr);
  const f1b = biquad(src, "bandpass", 700, 4, 0, sr);
  const f2 = biquad(src, "bandpass", 1150, 6, 0, sr);
  const f3 = biquad(src, "bandpass", 2600, 8, 0, sr);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const open = Math.min(1, t * 5);
    const f1 = f1a[i] * (1 - open) + f1b[i] * open;
    const attack = Math.min(1, i / (0.012 * sr));
    const release = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1;
    const tremor = 1 - 0.15 * (0.5 + 0.5 * Math.sin(TWO_PI * tremorHz * t * dur));
    y[i] = (f1 + f2[i] * 0.6 + f3[i] * 0.25 + src[i] * 0.08) * attack * release * tremor;
  }

  // lip closure: a short muffled "p" right at the end
  const closure = Math.round(0.015 * sr);
  const click = new Float32Array(closure);
  for (let i = 0; i < closure; i++) click[i] = (Math.random() * 2 - 1) * (1 - i / closure);
  const pop = biquad(click, "lowpass", 1200, 0.707, 0, sr);
  const peak = y.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6);
  for (let i = 0; i < closure && n - closure + i >= 0; i++) y[n - closure + i] += pop[i] * peak * 0.5;

  return distortion(y, 1.6);
}

function belch(sr) {
  return burp(sr, { duration: 0.8, base: 60 });
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

/** Cartoon alternative: let the TTS voice *say* the sound effect instead of synthesizing it. */
export const ONOMATOPOEIA = {
  burp: "Brraaap.",
  belch: "Brrraaaaaap.",
  sigh: "Haaah...",
  gulp: "Gulp.",
  cough: "Ahem, ahem.",
  hiccup: "Hic!",
};

export function synthSfx(name, sr = SAMPLE_RATE) {
  const fn = SFX[name];
  if (!fn) throw new Error(`Unknown sound effect "${name}"`);
  return normalize(fn(sr), 0.7);
}
