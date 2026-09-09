#!/usr/bin/env node
// Perform a script: synthesize every line in its character's voice, play it, save the WAV.
//
//   node scripts/perform.mjs <script.json | -> [--engine auto|kokoro|system|fake] [--no-play] [--out <dir>]
//                                              [--gap <ms>] [--characters <dir>] [--intensity <0..2>] [--dry] [--sfx synth|spoken]
//
// Script format (also accepted: a bare array of lines):
//   { "title": "why the build is slow",
//     "lines": [ { "character": "mad-scientist", "text": "L-listen, kid. *burp* It's the cache." },
//                { "character": "nervous-teen",  "text": "Aw jeez, is... is that bad?", "pauseMs": 600 } ] }

import fs from "node:fs";
import path from "node:path";
import { concat, normalize, silence } from "./lib/effects.mjs";
import { describeCharacters, loadCharacters, resolveCharacter } from "./lib/characters.mjs";
import { createPlayer } from "./lib/play.mjs";
import { describeEngine, outputDir, renderLine, seconds, slugify, tempWav, timestamp, writeWav } from "./lib/render.mjs";
import { createEngine } from "./lib/tts.mjs";

const log = (msg) => process.stderr.write(`${msg}\n`);

function parseArgs(argv) {
  const opts = { engine: "auto", play: true, gap: 350, out: null, characters: [], intensity: 1, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-play") opts.play = false;
    else if (a === "--engine") opts.engine = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--gap") opts.gap = Number(argv[++i]);
    else if (a === "--characters") opts.characters.push(argv[++i]);
    else if (a === "--intensity") opts.intensity = Number(argv[++i]);
    else if (a === "--dry") opts.intensity = 0;
    else if (a === "--sfx") opts.sfxMode = argv[++i];
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  if (!Number.isFinite(opts.intensity) || opts.intensity < 0) throw new Error("--intensity must be a number ≥ 0");
  return { opts, positional };
}

function readScript(source) {
  const raw = source === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(source, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Script is not valid JSON: ${err.message}`);
  }
  const script = Array.isArray(parsed) ? { lines: parsed } : parsed;
  if (!Array.isArray(script.lines) || !script.lines.length) throw new Error('Script needs a non-empty "lines" array');
  script.lines = script.lines.map((line, i) => {
    if (typeof line === "string") {
      const m = line.match(/^\s*([^:]+):\s*(.+)$/s);
      if (!m) throw new Error(`Line ${i + 1}: expected "character: text"`);
      return { character: m[1].trim(), text: m[2].trim() };
    }
    const character = line.character ?? line.speaker;
    if (!character || typeof line.text !== "string") throw new Error(`Line ${i + 1}: needs "character" and "text"`);
    return { ...line, character };
  });
  return script;
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  if (opts.help || !positional.length) {
    log(`Usage: node scripts/perform.mjs <script.json | -> [--engine auto|kokoro|system|fake] [--no-play] [--out <dir>] [--gap <ms>] [--intensity 0.5] [--dry] [--sfx synth|spoken]\n`);
    log("Characters:\n" + describeCharacters(loadCharacters(opts.characters)));
    process.exit(opts.help ? 0 : 1);
  }

  const script = readScript(positional[0]);
  const chars = loadCharacters(opts.characters);
  const cast = script.lines.map((line, i) => {
    const c = resolveCharacter(chars, line.character);
    if (!c) throw new Error(`Line ${i + 1}: unknown character "${line.character}". Known: ${[...chars.keys()].join(", ")}`);
    return c;
  });

  const engine = createEngine(opts.engine, { log });
  const player = opts.play ? createPlayer() : null;
  const second = cast.find((c) => c !== cast[0]);
  const title = script.title || (second ? `${cast[0].name} and ${second.name}` : `${cast[0].name} monologue`);
  const slug = `${timestamp()}-${slugify(title)}`;
  const outDir = outputDir(opts.out);
  const parts = [];
  const started = Date.now();

  log(`🎙  ${title}  (${script.lines.length} lines${opts.intensity !== 1 ? `, intensity ${opts.intensity}` : ""})`);
  for (let i = 0; i < script.lines.length; i++) {
    const line = script.lines[i];
    const c = cast[i];
    const audio = await renderLine(engine, c, line.text, { intensity: opts.intensity, sfxMode: opts.sfxMode });
    if (i === 0) log(`Voice engine: ${describeEngine(engine, c)}`);
    log(`[${i + 1}/${script.lines.length}] ${c.name}: ${line.text}`);
    if (!audio.length) continue;
    const pause = silence((line.pauseMs ?? opts.gap) / 1000);
    parts.push(audio, pause);
    if (player) player.enqueue(writeWav(tempWav(`${slug}-${i + 1}`), concat([audio, pause])));
  }

  const full = normalize(concat(parts), 0.9);
  const wavFile = writeWav(path.join(outDir, `${slug}.wav`), full);
  fs.writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify({ title, ...script }, null, 2));

  let note = "";
  if (player) {
    const { failed, used } = await player.finish();
    note = failed ? "\nNo audio player found — open the WAV yourself." : `\nPlayed through ${used}.`;
  }
  log(`\nSaved ${wavFile} (${seconds(full)}s, rendered in ${((Date.now() - started) / 1000).toFixed(1)}s)${note}`);
  process.stdout.write(`${wavFile}\n`);
}

main().catch((err) => {
  log(`\n✖ ${err.message}`);
  process.exit(1);
});
