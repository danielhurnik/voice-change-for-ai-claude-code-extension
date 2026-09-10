#!/usr/bin/env node
// Background speaker for voice mode. Takes a text file, waits for its turn (one speaker at a time
// across processes), renders sentence chunks in the character's voice and plays them as they are
// ready. `/voice stop` aborts it between chunks and kills the current playback.
//
//   node scripts/speak.mjs <textfile> --character <id> [--intensity n] [--engine auto|kokoro|system|fake] [--no-play] [--keep]

import fs from "node:fs";
import { loadCharacters, resolveCharacter } from "./lib/characters.mjs";
import { concat, silence } from "./lib/effects.mjs";
import { createPlayer } from "./lib/play.mjs";
import { renderLine, tempWav, writeWav } from "./lib/render.mjs";
import { chunkText, createEngine } from "./lib/tts.mjs";
import { acquireLock, log, releaseLock, stopRequested } from "./lib/voice-mode.mjs";

async function main() {
  const argv = process.argv.slice(2);
  const opts = { character: "mad-scientist", intensity: 1, engine: "auto", play: true, keep: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--character") opts.character = argv[++i];
    else if (a === "--intensity") opts.intensity = Number(argv[++i]);
    else if (a === "--engine") opts.engine = argv[++i];
    else if (a === "--no-play") opts.play = false;
    else if (a === "--keep") opts.keep = true;
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  const [file] = positional;
  if (!file) throw new Error("usage: node scripts/speak.mjs <textfile> --character <id>");
  const text = fs.readFileSync(file, "utf8");
  if (!opts.keep) fs.rmSync(file, { force: true });

  const startedAt = Date.now();
  const chars = loadCharacters();
  const character = resolveCharacter(chars, opts.character);
  if (!character) throw new Error(`Unknown character "${opts.character}"`);

  const engine = createEngine(opts.engine, { log: (m) => log(`speak: ${m}`) });
  if (!(await acquireLock())) {
    log("speak: gave up waiting for the speaking lock");
    return;
  }
  const controller = new AbortController();
  const watchdog = setInterval(() => {
    if (stopRequested(startedAt)) controller.abort();
  }, 300);
  try {
    const player = opts.play ? createPlayer({ signal: controller.signal }) : null;
    let n = 0;
    for (const chunk of chunkText(text, 220)) {
      if (controller.signal.aborted) break;
      const audio = await renderLine(engine, character, chunk, { intensity: opts.intensity });
      if (!audio.length) continue;
      n++;
      if (player) player.enqueue(writeWav(tempWav(`speak-${startedAt}-${n}`), concat([audio, silence(0.15)])));
    }
    const result = player ? await player.finish() : null;
    const outcome = !result ? "rendered, no playback" : result.aborted ? "stopped" : result.failed ? "no audio player found" : `played through ${result.used}`;
    log(`speak: ${character.id} ${n} chunks, ${outcome}`);
  } finally {
    clearInterval(watchdog);
    releaseLock();
  }
}

main().catch((err) => {
  log(`speak failed: ${err.stack || err.message}`);
  releaseLock();
  process.exit(1);
});
