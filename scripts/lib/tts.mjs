// Text-to-speech engines. Both return mono Float32Array at SAMPLE_RATE.
//   kokoro  — Kokoro-82M via kokoro-js, fully offline after a one-time ~90 MB model download. The good one.
//   system  — the OS voice (macOS `say`, Windows SAPI, Linux espeak-ng). Instant, robotic, no downloads.
//   auto    — kokoro, falling back to system if kokoro-js isn't installed.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeWav, SAMPLE_RATE } from "./wav.mjs";
import { biquad, convertRate } from "./effects.mjs";

export const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

export function modelCacheDir() {
  if (process.env.VOICE_CHANGE_CACHE) return process.env.VOICE_CHANGE_CACHE;
  if (process.env.CLAUDE_PLUGIN_DATA) return path.join(process.env.CLAUDE_PLUGIN_DATA, "models");
  return path.join(os.homedir(), ".cache", "voice-change-for-ai");
}

/** Split long text at sentence boundaries; Kokoro is happiest with short-ish chunks. */
export function chunkText(text, max = 300) {
  const sentences = text.match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) || [text];
  const chunks = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + s).length > max) {
      chunks.push(cur.trim());
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

let kokoroPromise = null;

async function loadKokoro(log) {
  if (kokoroPromise) return kokoroPromise;
  kokoroPromise = (async () => {
    let mod;
    try {
      mod = await import("kokoro-js");
    } catch (err) {
      const e = new Error("kokoro-js is not installed");
      e.code = "KOKORO_MISSING";
      e.cause = err;
      throw e;
    }
    try {
      const { env } = await import("@huggingface/transformers");
      env.cacheDir = modelCacheDir();
      fs.mkdirSync(env.cacheDir, { recursive: true });
    } catch {
      // not resolvable from here: transformers.js falls back to its own cache directory
    }
    log(`Loading Kokoro voice model — the first run downloads ~90 MB into ${modelCacheDir()}`);
    let lastPct = -1;
    try {
      return await mod.KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: process.env.KOKORO_DTYPE || "q8",
        device: "cpu",
        progress_callback: (p) => {
          if (p.status !== "progress" || !String(p.file || "").endsWith(".onnx")) return;
          const pct = Math.floor(p.progress / 10) * 10;
          if (pct !== lastPct) {
            lastPct = pct;
            log(`  downloading model… ${pct}%`);
          }
        },
      });
    } catch (err) {
      throw new Error(
        `Couldn't load the Kokoro voice model (${err.message}). ` +
          `It downloads from huggingface.co on first use — check your network or proxy, or use --engine system.`,
      );
    }
  })();
  return kokoroPromise;
}

/** The accents of English in the phonemizer's espeak-ng build (it ships no other languages). */
export const ACCENTS = {
  "en-us": "American",
  "en-us-nyc": "New York City",
  "en-gb": "British",
  "en-gb-x-rp": "Received Pronunciation",
  "en-gb-scotland": "Scottish",
  "en-gb-x-gbclan": "Lancashire",
  "en-gb-x-gbcwmd": "West Midlands",
  "en-029": "Caribbean",
};

const PUNCTUATION = ';:,.!?¡¿—…"«»“”';
const PUNCT_RUN = new RegExp(`(\\s*[${PUNCTUATION}]+\\s*)+`, "g");

/**
 * Kokoro's own text → phoneme pipeline (normalize, keep punctuation, espeak the rest, tidy symbols),
 * but with any espeak-ng voice — so a character can speak with a Scottish accent instead of the
 * en-us / en-gb default that the voice's letter would pick.
 */
export async function phonemizeWithAccent(text, accent) {
  let mod;
  try {
    mod = await import("phonemizer");
  } catch (err) {
    const e = new Error("phonemizer is not installed — run `npm install` in the plugin folder (needed for voice.accent)");
    e.cause = err;
    throw e;
  }
  const normalized = text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, "“")
    .replace(/»/g, "”")
    .replace(/[“”]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/[^\S \n]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  const parts = [];
  let last = 0;
  for (const m of normalized.matchAll(PUNCT_RUN)) {
    if (m.index > last) parts.push({ punct: false, text: normalized.slice(last, m.index) });
    if (m[0]) parts.push({ punct: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < normalized.length) parts.push({ punct: false, text: normalized.slice(last) });
  const pieces = await Promise.all(
    parts.map(async (p) => {
      if (p.punct) return p.text;
      let out;
      try {
        out = await mod.phonemize(p.text, accent);
      } catch (err) {
        throw new Error(`espeak-ng could not phonemize with accent "${accent}" (${err.message.split("\n")[0]}). English accents: ${Object.keys(ACCENTS).join(", ")}`);
      }
      // some accents write the length mark as an ASCII colon, which Kokoro would read as punctuation
      return out.join(" ").replace(/:/g, "ː").replace(/ːː+/g, "ː");
    }),
  );
  return pieces
    .join("")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/ʉː?/g, "uː") // Scottish "hoose": Kokoro never saw ʉ in training, uː is the nearest sound it knows
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z")
    .trim();
}

async function kokoroSynth(text, voice, log) {
  const tts = await loadKokoro(log);
  const name = voice.kokoro || "af_heart";
  if (!(name in tts.voices)) {
    throw new Error(`Unknown Kokoro voice "${name}". Available: ${Object.keys(tts.voices).join(", ")}`);
  }
  const opts = { voice: name, speed: voice.speed ?? 1 };
  const parts = [];
  for (const chunk of chunkText(text)) {
    let audio;
    if (voice.accent) {
      const phonemes = await phonemizeWithAccent(chunk, voice.accent);
      const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
      audio = await tts.generate_from_ids(input_ids, opts);
    } else {
      audio = await tts.generate(chunk, opts);
    }
    parts.push(convertRate(Float32Array.from(audio.audio), audio.sampling_rate, SAMPLE_RATE));
  }
  return join(parts);
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

function systemCommand(txtFile, wavFile, voiceName, rate) {
  switch (process.platform) {
    case "darwin": {
      const args = ["-o", wavFile, "--data-format=LEI16@24000", "-r", String(Math.round(175 * rate)), "-f", txtFile];
      if (voiceName) args.unshift("-v", voiceName);
      return ["say", args];
    }
    case "win32": {
      const select = voiceName ? `try { $s.SelectVoice(${psq(voiceName)}) } catch {}; ` : "";
      const r = Math.round(Math.max(-10, Math.min(10, (rate - 1) * 10)));
      const script =
        `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${select}` +
        `$s.Rate = ${r}; $s.SetOutputToWaveFile(${psq(wavFile)}); $s.Speak([IO.File]::ReadAllText(${psq(txtFile)})); $s.Dispose()`;
      return ["powershell", ["-NoProfile", "-NonInteractive", "-Command", script]];
    }
    default: {
      const args = ["-w", wavFile, "-s", String(Math.round(160 * rate)), "-f", txtFile];
      if (voiceName) args.unshift("-v", voiceName);
      return ["espeak-ng", args];
    }
  }
}

function systemSynth(text, voice) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voice-change-"));
  const txtFile = path.join(tmp, "line.txt");
  const wavFile = path.join(tmp, "line.wav");
  // BOM so PowerShell's ReadAllText decodes UTF-8 correctly; say/espeak ignore it
  fs.writeFileSync(txtFile, "\ufeff" + text);
  try {
    const voiceName = voice.system?.[process.platform] ?? voice.system?.default;
    const rate = voice.speed ?? 1;
    let [cmd, args] = systemCommand(txtFile, wavFile, voiceName, rate);
    let r = spawnSync(cmd, args, { encoding: "utf8" });
    if (process.platform === "linux" && r.error?.code === "ENOENT") r = spawnSync("espeak", args, { encoding: "utf8" });
    if ((r.error || r.status !== 0) && voiceName) {
      // the hinted voice isn't installed — try the default voice
      [cmd, args] = systemCommand(txtFile, wavFile, null, rate);
      r = spawnSync(cmd, args, { encoding: "utf8" });
    }
    if (r.error || r.status !== 0) {
      const hint =
        process.platform === "linux"
          ? "Install espeak-ng (e.g. `sudo apt install espeak-ng`) or use the kokoro engine."
          : "Use the kokoro engine instead.";
      throw new Error(`System TTS (${cmd}) failed: ${r.error?.message || r.stderr?.trim() || `exit ${r.status}`}. ${hint}`);
    }
    const { samples, sampleRate } = decodeWav(fs.readFileSync(wavFile));
    return convertRate(samples, sampleRate, SAMPLE_RATE);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** A buzzy vowel with syllables — stands in for a voice when testing scripts and effect chains without a model. */
export function fakeSynth(text, voice = {}, sr = SAMPLE_RATE) {
  const TWO_PI = Math.PI * 2;
  const n = Math.round((Math.max(0.4, text.length * 0.06) / (voice.speed ?? 1)) * sr);
  const y = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    phase += (TWO_PI * (130 + 12 * Math.sin(TWO_PI * 0.7 * t))) / sr;
    const saw = 2 * ((phase / TWO_PI) % 1) - 1;
    const syllable = Math.pow(0.5 + 0.5 * Math.sin(TWO_PI * 4 * t), 0.6);
    y[i] = saw * syllable * 0.5;
  }
  const f1 = biquad(y, "bandpass", 650, 2, 0, sr);
  const f2 = biquad(y, "bandpass", 1400, 2, 0, sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = f1[i] + 0.6 * f2[i] + 0.15 * y[i];
  return out;
}

function join(parts) {
  if (parts.length === 1) return parts[0];
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

export const ENGINES = ["auto", "kokoro", "system", "fake"];

/**
 * @param {"auto"|"kokoro"|"system"|"fake"} name
 * @param {{ log?: (msg: string) => void }} opts
 */
export function createEngine(name = "auto", { log = () => {} } = {}) {
  if (!ENGINES.includes(name)) throw new Error(`Unknown engine "${name}". Use one of: ${ENGINES.join(", ")}`);
  let mode = name;
  return {
    get name() {
      return mode;
    },
    /** @param {string} text @param {object} voice the character's `voice` block */
    async synth(text, voice) {
      if (!text.trim()) return new Float32Array(0);
      if (mode === "fake") return fakeSynth(text, voice);
      if (mode === "kokoro" || mode === "auto") {
        try {
          const out = await kokoroSynth(text, voice, log);
          mode = "kokoro";
          return out;
        } catch (err) {
          if (err.code !== "KOKORO_MISSING") throw err;
          if (mode === "kokoro") {
            throw new Error(`kokoro-js is not installed. Run \`npm install\` in the plugin folder, or pass --engine system.`);
          }
          log("kokoro-js is not installed — falling back to the system voice (run `npm install` in the plugin folder for the good voices)");
          mode = "system";
        }
      }
      return systemSynth(text, voice);
    },
  };
}
