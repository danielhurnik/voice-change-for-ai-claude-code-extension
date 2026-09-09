// Turns one script line into audio: parse → synthesize text and sound effects → apply the character's
// effect chain → tidy the edges.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyEffects, concat, fade, normalize, silence } from "./effects.mjs";
import { parseLine, synthSfx } from "./sfx.mjs";
import { PLUGIN_ROOT } from "./characters.mjs";
import { encodeWav, SAMPLE_RATE } from "./wav.mjs";

/**
 * @param {{ synth: (text: string, voice: object) => Promise<Float32Array> }} engine
 * @param {object} character
 * @param {string} text
 * @param {{ intensity?: number }} [opts] 0 = the raw voice, 1 = the character's chain as written
 */
export async function renderLine(engine, character, text, { intensity = 1 } = {}) {
  const parts = [];
  for (const seg of parseLine(text)) {
    if (seg.type === "sfx") {
      parts.push(synthSfx(seg.name), silence(0.05));
    } else {
      parts.push(await engine.synth(seg.text, character.voice), silence(0.06));
    }
  }
  if (!parts.length) return new Float32Array(0);
  const processed = applyEffects(concat(parts), character.voice.effects, SAMPLE_RATE, { intensity });
  return normalize(fade(processed, 8), 0.9);
}

/** Human-readable "what actually spoke" for the logs. */
export function describeEngine(engine, character) {
  if (engine.name === "kokoro") return `kokoro (${character.voice.kokoro || "af_heart"})`;
  if (engine.name === "system") return `system voice (${process.platform})`;
  return engine.name;
}

export function outputDir(override) {
  const dir =
    override ||
    process.env.VOICE_CHANGE_OUT ||
    (process.env.CLAUDE_PLUGIN_DATA ? path.join(process.env.CLAUDE_PLUGIN_DATA, "out") : path.join(PLUGIN_ROOT, "out"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function slugify(text, fallback = "take") {
  const s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return s || fallback;
}

export function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

export function writeWav(file, samples) {
  fs.writeFileSync(file, encodeWav(samples, SAMPLE_RATE));
  return file;
}

export function tempWav(name) {
  const dir = path.join(os.tmpdir(), "voice-change-for-ai");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}-${process.pid}.wav`);
}

export const seconds = (samples) => (samples.length / SAMPLE_RATE).toFixed(1);
