// The voice changer. Pure-JS DSP on mono Float32Array buffers — no native deps, no Web Audio.
// Every effect takes (samples, params, sampleRate) and returns a new buffer.

import { SAMPLE_RATE } from "./wav.mjs";

const TWO_PI = Math.PI * 2;

export const semitonesToRatio = (semitones) => Math.pow(2, semitones / 12);
export const dbToLinear = (db) => Math.pow(10, db / 20);

export function silence(seconds, sr = SAMPLE_RATE) {
  return new Float32Array(Math.max(0, Math.round(seconds * sr)));
}

/** @param {Float32Array[]} parts */
export function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function fade(x, ms = 8, sr = SAMPLE_RATE) {
  const n = Math.min(Math.round((ms / 1000) * sr), Math.floor(x.length / 2));
  const y = Float32Array.from(x);
  for (let i = 0; i < n; i++) {
    const g = i / n;
    y[i] *= g;
    y[y.length - 1 - i] *= g;
  }
  return y;
}

export function normalize(x, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  if (max < 1e-6) return x;
  return gain(x, 20 * Math.log10(peak / max));
}

export function gain(x, db) {
  const g = dbToLinear(db);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
}

// ---------- filters ----------

/** RBJ cookbook biquad. type: lowpass | highpass | bandpass | peak */
export function biquad(x, type, freq, q = 0.707, gainDb = 0, sr = SAMPLE_RATE) {
  const w0 = (TWO_PI * Math.min(freq, sr * 0.49)) / sr;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case "lowpass":
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "peak": {
      const A = Math.pow(10, gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    }
    default:
      throw new Error(`Unknown filter type "${type}"`);
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = out;
    y[i] = out;
  }
  return y;
}

// ---------- time & pitch ----------

/** Play x at `ratio` speed (ratio 2 = twice as fast and an octave up). Duration changes. */
export function stretchResample(x, ratio, sr = SAMPLE_RATE) {
  if (Math.abs(ratio - 1) < 1e-6) return x;
  const src = ratio > 1 ? biquad(x, "lowpass", (0.45 * sr) / ratio, 0.707, 0, sr) : x;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const y = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const t = pos - i0;
    y[i] = src[i0] * (1 - t) + src[i1] * t;
  }
  return y;
}

/** Convert between sample rates (e.g. an OS voice at 22050 Hz into the pipeline's 24000 Hz). */
export function convertRate(x, fromRate, toRate) {
  if (fromRate === toRate) return x;
  return stretchResample(x, fromRate / toRate, fromRate);
}

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / n);
  return w;
}

/**
 * WSOLA time stretch: factor 2 = twice as long, pitch unchanged.
 * 32 ms grains, 50% overlap, ±8 ms similarity search so grains line up in phase.
 */
export function timeStretch(x, factor, sr = SAMPLE_RATE) {
  if (Math.abs(factor - 1) < 1e-4 || x.length < 64) return x;
  const N = Math.round(0.032 * sr);
  const Hs = N >> 1;
  const Ha = Hs / factor;
  const delta = Math.round(0.008 * sr);
  const window = hann(N);
  const outLen = Math.round(x.length * factor);
  const y = new Float32Array(outLen + N);
  const frames = Math.ceil(outLen / Hs);
  let prevPos = 0;
  for (let k = 0; k < frames; k++) {
    const nominal = Math.round(k * Ha);
    let pos = nominal;
    const target = prevPos + Hs;
    if (k > 0 && target + Hs <= x.length) {
      const lo = Math.max(0, nominal - delta);
      const hi = Math.min(x.length - N, nominal + delta);
      let best = -Infinity;
      for (let cand = lo; cand <= hi; cand++) {
        let c = 0;
        for (let i = 0; i < Hs; i++) c += x[cand + i] * x[target + i];
        if (c > best) {
          best = c;
          pos = cand;
        }
      }
    }
    const outPos = k * Hs;
    for (let i = 0; i < N; i++) {
      const xi = pos + i;
      if (xi >= x.length) break;
      y[outPos + i] += x[xi] * window[i];
    }
    prevPos = pos;
  }
  return y.subarray(0, outLen);
}

/** Shift pitch by semitones, keeping the duration. */
export function pitchShift(x, semitones, sr = SAMPLE_RATE) {
  if (Math.abs(semitones) < 1e-3) return x;
  const ratio = semitonesToRatio(semitones);
  return timeStretch(stretchResample(x, ratio, sr), ratio, sr);
}

// ---------- character ----------

/** Multiply by a sine — 30 Hz is the Dalek. */
export function ringMod(x, freq = 30, mix = 1, sr = SAMPLE_RATE) {
  const y = new Float32Array(x.length);
  const inc = (TWO_PI * freq) / sr;
  for (let i = 0; i < x.length; i++) y[i] = x[i] * (1 - mix + mix * Math.sin(i * inc));
  return y;
}

export function distortion(x, drive = 2) {
  const norm = Math.tanh(drive);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = Math.tanh(x[i] * drive) / norm;
  return y;
}

export function bitcrush(x, bits = 8, downsample = 4) {
  const levels = Math.pow(2, bits);
  const y = new Float32Array(x.length);
  let hold = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % downsample === 0) hold = Math.round(x[i] * levels) / levels;
    y[i] = hold;
  }
  return y;
}

/** Octave-down doubling (low-passed so it rumbles instead of buzzing) + gentle soft clip: growl, gruffness, gravel. */
export function gravel(x, amount = 0.4, sr = SAMPLE_RATE) {
  if (amount <= 0) return x;
  const sub = biquad(pitchShift(x, -12, sr), "lowpass", 1500, 0.707, 0, sr);
  const n = Math.min(x.length, sub.length);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] + (i < n ? amount * sub[i] : 0);
  return distortion(y, 1 + 0.4 * amount);
}

export function tremolo(x, { rate = 6, depth = 0.5 } = {}, sr = SAMPLE_RATE) {
  const y = new Float32Array(x.length);
  const inc = (TWO_PI * rate) / sr;
  for (let i = 0; i < x.length; i++) y[i] = x[i] * (1 - depth * (0.5 + 0.5 * Math.sin(i * inc)));
  return y;
}

/** Modulated delay line — vibrato (mix 1, tiny depth) or chorus (mix 0.5, longer base delay). */
export function modDelay(x, { rate = 5, depthMs = 2, baseMs = 5, mix = 1, feedback = 0 } = {}, sr = SAMPLE_RATE) {
  const maxDelay = Math.ceil(((baseMs + depthMs) / 1000) * sr) + 2;
  const buf = new Float32Array(maxDelay);
  const y = new Float32Array(x.length);
  const inc = (TWO_PI * rate) / sr;
  let w = 0;
  for (let i = 0; i < x.length; i++) {
    const d = ((baseMs + depthMs * Math.sin(i * inc)) / 1000) * sr;
    let r = w - d;
    while (r < 0) r += maxDelay;
    const r0 = Math.floor(r) % maxDelay;
    const r1 = (r0 + 1) % maxDelay;
    const t = r - Math.floor(r);
    const delayed = buf[r0] * (1 - t) + buf[r1] * t;
    buf[w] = x[i] + delayed * feedback;
    y[i] = x[i] * (1 - mix) + delayed * mix;
    w = (w + 1) % maxDelay;
  }
  return y;
}

export function echo(x, { delayMs = 250, feedback = 0.35, mix = 0.4 } = {}, sr = SAMPLE_RATE) {
  const D = Math.max(1, Math.round((delayMs / 1000) * sr));
  const fb = Math.min(0.95, Math.max(0, feedback));
  const taps = fb > 0 ? Math.ceil(Math.log(0.01) / Math.log(fb)) : 1;
  const len = x.length + D * taps;
  const wet = new Float32Array(len);
  for (let i = D; i < len; i++) {
    const back = i - D;
    wet[i] = (back < x.length ? x[back] : 0) + fb * wet[back];
  }
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) y[i] = (i < x.length ? x[i] : 0) * (1 - mix) + wet[i] * mix;
  return y;
}

/** Schroeder reverb: 4 damped combs in parallel, 2 allpasses in series, plus a tail so it rings out. */
export function reverb(x, { mix = 0.3, decay = 0.5, size = 1, damp = 0.3 } = {}, sr = SAMPLE_RATE) {
  const g = Math.min(0.95, Math.max(0, decay));
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.max(1, Math.round(d * size * sr)));
  const allpasses = [0.005, 0.0017].map((d) => Math.max(1, Math.round(d * sr)));
  const tail = Math.round(sr * (0.3 + 2.0 * g * size));
  const len = x.length + tail;
  const wet = new Float32Array(len);
  for (const D of combs) {
    const buf = new Float32Array(D);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const delayed = buf[idx];
      lp = delayed * (1 - damp) + lp * damp;
      buf[idx] = (i < x.length ? x[i] : 0) + lp * g;
      idx = (idx + 1) % D;
      wet[i] += delayed / combs.length;
    }
  }
  for (const D of allpasses) {
    const buf = new Float32Array(D);
    const k = 0.7;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const delayed = buf[idx];
      const v = wet[i] + k * delayed;
      buf[idx] = v;
      wet[i] = delayed - k * v;
      idx = (idx + 1) % D;
    }
  }
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) y[i] = (i < x.length ? x[i] : 0) * (1 - mix) + wet[i] * mix;
  return y;
}

/** Peak-envelope compressor. threshold in dB, ratio n:1. */
export function compress(x, { threshold = -18, ratio = 4, attackMs = 5, releaseMs = 80 } = {}, sr = SAMPLE_RATE) {
  const thr = dbToLinear(threshold);
  const att = Math.exp(-1 / ((attackMs / 1000) * sr));
  const rel = Math.exp(-1 / ((releaseMs / 1000) * sr));
  const y = new Float32Array(x.length);
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    const g = env > thr ? Math.pow(env / thr, 1 / ratio - 1) : 1;
    y[i] = x[i] * g;
  }
  return y;
}

/** Vinyl crackle + hiss for the old-radio characters. */
export function crackle(x, { amount = 0.3, density = 25 } = {}, sr = SAMPLE_RATE) {
  const y = Float32Array.from(x);
  const p = density / sr;
  let hiss = 0;
  for (let i = 0; i < y.length; i++) {
    hiss = hiss * 0.6 + (Math.random() * 2 - 1) * 0.4;
    y[i] += hiss * amount * 0.03;
    if (Math.random() < p) {
      const pop = (Math.random() * 2 - 1) * amount * 0.8;
      y[i] += pop;
      if (i + 1 < y.length) y[i + 1] += pop * 0.5;
    }
  }
  return y;
}

// ---------- chain ----------

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Scale a whole effect chain by one knob: 0 = untouched voice, 1 = the chain as written, 1.5 = more.
 * Every parameter moves between its "transparent" value and the configured one.
 */
export function scaleEffects(effects, k = 1) {
  if (k === 1) return effects;
  if (k <= 0) return [];
  return effects.map((fx) => {
    const p = { ...fx };
    switch (fx.type) {
      case "pitch": p.semitones = (fx.semitones ?? 0) * k; break;
      case "speed": p.factor = lerp(1, fx.factor ?? 1, k); break;
      case "ringmod": p.mix = clamp01((fx.mix ?? 1) * k); break;
      case "distortion":
      case "telephone": p.drive = lerp(1, fx.drive ?? 2, k); break;
      case "bitcrush":
        p.bits = Math.round(lerp(16, fx.bits ?? 8, k));
        p.downsample = Math.max(1, Math.round(lerp(1, fx.downsample ?? 4, k)));
        break;
      case "lowpass": p.freq = lerp(11000, fx.freq ?? 1000, Math.min(1, k)); break;
      case "highpass": p.freq = lerp(20, fx.freq ?? 1000, Math.min(1, k)); break;
      case "peak": p.gainDb = (fx.gainDb ?? 0) * k; break;
      case "reverb": p.mix = clamp01((fx.mix ?? 0.3) * k); break;
      case "echo": p.mix = clamp01((fx.mix ?? 0.4) * k); break;
      case "chorus": p.mix = clamp01((fx.mix ?? 0.5) * k); break;
      case "vibrato": p.depthMs = (fx.depthMs ?? 1.5) * k; break;
      case "tremolo": p.depth = clamp01((fx.depth ?? 0.5) * k); break;
      case "compress": p.ratio = Math.max(1, lerp(1, fx.ratio ?? 4, k)); break;
      case "gravel": p.amount = (fx.amount ?? 0.4) * k; break;
      case "crackle": p.amount = (fx.amount ?? 0.3) * k; break;
      case "gain": p.db = (fx.db ?? 0) * k; break;
      default: break;
    }
    return p;
  });
}

/**
 * Apply a character's effect chain. Each entry is { type, ...params }.
 * Available types: pitch, speed, ringmod, distortion, bitcrush, lowpass, highpass, bandpass, peak,
 * reverb, vibrato, chorus, tremolo, echo, compress, gravel, crackle, telephone, gain, normalize.
 * `intensity` scales the whole chain (see scaleEffects).
 */
export function applyEffects(x, effects = [], sr = SAMPLE_RATE, { intensity = 1 } = {}) {
  let y = x;
  for (const fx of scaleEffects(effects, intensity)) {
    const { type, ...p } = fx;
    switch (type) {
      case "pitch":
        y = p.keepDuration === false
          ? stretchResample(y, semitonesToRatio(p.semitones ?? 0), sr)
          : pitchShift(y, p.semitones ?? 0, sr);
        break;
      case "speed":
        y = timeStretch(y, 1 / (p.factor ?? 1), sr);
        break;
      case "ringmod":
        y = ringMod(y, p.freq ?? 30, p.mix ?? 1, sr);
        break;
      case "distortion":
        y = distortion(y, p.drive ?? 2);
        break;
      case "bitcrush":
        y = bitcrush(y, p.bits ?? 8, p.downsample ?? 4);
        break;
      case "lowpass":
      case "highpass":
      case "bandpass":
        y = biquad(y, type, p.freq ?? 1000, p.q ?? 0.707, 0, sr);
        break;
      case "peak":
        y = biquad(y, "peak", p.freq ?? 1000, p.q ?? 1, p.gainDb ?? 0, sr);
        break;
      case "reverb":
        y = reverb(y, p, sr);
        break;
      case "vibrato":
        y = modDelay(y, { rate: p.rate ?? 5.5, depthMs: p.depthMs ?? 1.5, baseMs: 3, mix: 1 }, sr);
        break;
      case "chorus":
        y = modDelay(y, { rate: p.rate ?? 1.2, depthMs: p.depthMs ?? 3, baseMs: p.baseMs ?? 20, mix: p.mix ?? 0.5 }, sr);
        break;
      case "tremolo":
        y = tremolo(y, p, sr);
        break;
      case "echo":
        y = echo(y, p, sr);
        break;
      case "compress":
        y = compress(y, p, sr);
        break;
      case "gravel":
        y = gravel(y, p.amount ?? 0.4, sr);
        break;
      case "crackle":
        y = crackle(y, p, sr);
        break;
      case "telephone":
        y = distortion(biquad(biquad(y, "highpass", 300, 0.9, 0, sr), "lowpass", 3400, 0.9, 0, sr), p.drive ?? 1.6);
        break;
      case "gain":
        y = gain(y, p.db ?? 0);
        break;
      case "normalize":
        y = normalize(y, p.peak ?? 0.9);
        break;
      default:
        throw new Error(`Unknown effect type "${type}"`);
    }
  }
  return y;
}
