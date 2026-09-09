#!/usr/bin/env node
// Say one line in a character's voice. Handy for testing and tuning voices.
//
//   node scripts/say.mjs <character> "text to say" [--engine auto|kokoro|system|fake] [--no-play] [--out <dir>]
//                                                   [--intensity <0..2>] [--dry] [--ramp]
//   node scripts/say.mjs --list
//
//   --intensity 0.5   half the character's effects (0 = raw voice, 1 = as written, 1.5 = more)
//   --dry             same as --intensity 0
//   --ramp            the line four times in a row: intensity 0, 0.35, 0.7, 1 — pick by ear
//   --voice am_puck   try a different Kokoro base voice without editing the character file
//   --sfx spoken      the voice says "Brraaap." instead of the synthesized burp (default: synth)
//   --accent en-gb-scotland   pronounce with an espeak-ng accent (see ACCENTS in lib/tts.mjs); kokoro engine only

import path from "node:path";
import { concat, silence } from "./lib/effects.mjs";
import { describeCharacters, loadCharacters, resolveCharacter } from "./lib/characters.mjs";
import { playFile } from "./lib/play.mjs";
import { describeEngine, outputDir, renderLine, seconds, slugify, timestamp, writeWav } from "./lib/render.mjs";
import { ACCENTS, createEngine } from "./lib/tts.mjs";

const log = (msg) => process.stderr.write(`${msg}\n`);
const RAMP = [0, 0.35, 0.7, 1];

async function main() {
  const argv = process.argv.slice(2);
  const opts = { engine: "auto", play: true, out: null, characters: [], intensity: 1, ramp: false, list: false, voice: null, accent: null, sfxMode: undefined };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-play") opts.play = false;
    else if (a === "--engine") opts.engine = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--characters") opts.characters.push(argv[++i]);
    else if (a === "--intensity") opts.intensity = Number(argv[++i]);
    else if (a === "--dry") opts.intensity = 0;
    else if (a === "--ramp") opts.ramp = true;
    else if (a === "--voice") opts.voice = argv[++i];
    else if (a === "--sfx") opts.sfxMode = argv[++i];
    else if (a === "--accent") opts.accent = argv[++i];
    else if (a === "--list") opts.list = true;
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  if (!Number.isFinite(opts.intensity) || opts.intensity < 0) throw new Error("--intensity must be a number ≥ 0");
  const chars = loadCharacters(opts.characters);
  if (opts.list || positional.length < 2) {
    log(`Usage: node scripts/say.mjs <character> "text" [--engine auto|kokoro|system|fake] [--intensity 0.5] [--dry] [--ramp] [--voice am_puck] [--accent en-gb-scotland] [--sfx synth|spoken] [--no-play]\n`);
    log(describeCharacters(chars));
    process.exit(opts.list ? 0 : 1);
  }
  const [who, ...rest] = positional;
  const base = resolveCharacter(chars, who);
  if (!base) throw new Error(`Unknown character "${who}". Known: ${[...chars.keys()].join(", ")}`);
  const character = { ...base, voice: { ...base.voice, ...(opts.voice && { kokoro: opts.voice }), ...(opts.accent && { accent: opts.accent }) } };
  if (character.voice.accent && !(character.voice.accent in ACCENTS)) {
    throw new Error(`Unknown accent "${character.voice.accent}". Use one of: ${Object.entries(ACCENTS).map(([k, v]) => `${k} (${v})`).join(", ")}`);
  }
  const text = rest.join(" ");

  const engine = createEngine(opts.engine, { log });
  const levels = opts.ramp ? RAMP : [opts.intensity];
  const takes = [];
  for (const intensity of levels) {
    takes.push(await renderLine(engine, character, text, { intensity, sfxMode: opts.sfxMode }), silence(0.45));
    if (opts.ramp) log(`  rendered at intensity ${intensity}`);
  }
  const audio = concat(takes);
  const suffix = opts.ramp ? "-ramp" : opts.intensity === 1 ? "" : `-x${opts.intensity}`;
  const file = writeWav(path.join(outputDir(opts.out), `${timestamp()}-${character.id}-${slugify(text)}${suffix}.wav`), audio);

  log(`${character.name}: ${text}`);
  log(`Voice engine: ${describeEngine(engine, character)}${opts.ramp ? ` — intensities ${RAMP.join(" → ")}` : opts.intensity !== 1 ? ` — intensity ${opts.intensity}` : ""}`);
  if (opts.play) {
    const used = await playFile(file);
    log(used ? `Played through ${used}.` : "No audio player found — open the WAV yourself.");
  }
  log(`Saved ${file} (${seconds(audio)}s)`);
  process.stdout.write(`${file}\n`);
}

main().catch((err) => {
  log(`\n✖ ${err.message}`);
  process.exit(1);
});
