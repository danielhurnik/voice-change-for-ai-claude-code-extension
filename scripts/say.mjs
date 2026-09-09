#!/usr/bin/env node
// Say one line in a character's voice. Handy for testing and tuning voices.
//
//   node scripts/say.mjs <character> "text to say" [--engine auto|kokoro|system] [--no-play] [--out <dir>]
//   node scripts/say.mjs --list

import path from "node:path";
import { describeCharacters, loadCharacters, resolveCharacter } from "./lib/characters.mjs";
import { playFile } from "./lib/play.mjs";
import { outputDir, renderLine, seconds, slugify, timestamp, writeWav } from "./lib/render.mjs";
import { createEngine } from "./lib/tts.mjs";

const log = (msg) => process.stderr.write(`${msg}\n`);

async function main() {
  const argv = process.argv.slice(2);
  const opts = { engine: "auto", play: true, out: null, characters: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-play") opts.play = false;
    else if (a === "--engine") opts.engine = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--characters") opts.characters.push(argv[++i]);
    else if (a === "--list") opts.list = true;
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  const chars = loadCharacters(opts.characters);
  if (opts.list || positional.length < 2) {
    log(`Usage: node scripts/say.mjs <character> "text" [--engine auto|kokoro|system] [--no-play]\n`);
    log(describeCharacters(chars));
    process.exit(opts.list ? 0 : 1);
  }
  const [who, ...rest] = positional;
  const character = resolveCharacter(chars, who);
  if (!character) throw new Error(`Unknown character "${who}". Known: ${[...chars.keys()].join(", ")}`);
  const text = rest.join(" ");

  const engine = createEngine(opts.engine, { log });
  const audio = await renderLine(engine, character, text);
  const file = writeWav(path.join(outputDir(opts.out), `${timestamp()}-${character.id}-${slugify(text)}.wav`), audio);
  log(`${character.name}: ${text}`);
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
