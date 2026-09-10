#!/usr/bin/env node
// Exercises everything except the real TTS model: a synthetic "voice" (buzzy vowel with syllables)
// is pushed through every character's effect chain and the sound effects, and the results are
// written to out/selftest/ so you can listen. Fails loudly on NaNs, silence or wrong durations.
//
//   node scripts/selftest.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyEffects, concat, pitchShift, scaleEffects, silence, timeStretch } from "./lib/effects.mjs";
import { loadCharacters, resolveCharacter } from "./lib/characters.mjs";
import { renderLine, outputDir, writeWav, seconds } from "./lib/render.mjs";
import { parseLine, SFX, synthSfx } from "./lib/sfx.mjs";
import { chunkText, createEngine, fakeSynth } from "./lib/tts.mjs";
import { decodeWav, encodeWav, SAMPLE_RATE } from "./lib/wav.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fakeVoice = (text) => fakeSynth(text);
const fakeEngine = createEngine("fake");

function stats(x) {
  let peak = 0, sum = 0;
  for (let i = 0; i < x.length; i++) {
    assert.ok(Number.isFinite(x[i]), "non-finite sample");
    peak = Math.max(peak, Math.abs(x[i]));
    sum += x[i] * x[i];
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, x.length)) };
}

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("wav");
check("encode/decode round-trip", () => {
  const x = fakeVoice("hello there");
  const back = decodeWav(encodeWav(x)).samples;
  assert.equal(back.length, x.length);
  let maxErr = 0;
  for (let i = 0; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(back[i] - x[i]));
  assert.ok(maxErr < 1e-3, `round-trip error ${maxErr}`);
});

console.log("effects");
check("timeStretch changes duration, not level", () => {
  const x = fakeVoice("a fairly long sentence for stretching");
  const y = timeStretch(x, 1.5);
  assert.ok(Math.abs(y.length - x.length * 1.5) < 2, "stretched length");
  const a = stats(x), b = stats(y);
  assert.ok(b.rms > a.rms * 0.5 && b.rms < a.rms * 2, `rms ${a.rms} → ${b.rms}`);
});
check("pitchShift keeps duration (±2%)", () => {
  const x = fakeVoice("pitch me up and down please");
  for (const st of [-12, -5, 4, 9]) {
    const y = pitchShift(x, st);
    assert.ok(Math.abs(y.length - x.length) / x.length < 0.02, `semitones ${st}: ${x.length} → ${y.length}`);
    stats(y);
  }
});
check("every effect type runs", () => {
  const x = fakeVoice("run every effect once");
  const all = [
    { type: "pitch", semitones: -3 }, { type: "pitch", semitones: 7, keepDuration: false }, { type: "speed", factor: 1.2 },
    { type: "ringmod", freq: 30 }, { type: "distortion", drive: 2 }, { type: "bitcrush", bits: 6, downsample: 3 },
    { type: "lowpass", freq: 3000 }, { type: "highpass", freq: 200 }, { type: "bandpass", freq: 1000 },
    { type: "peak", freq: 2500, gainDb: 4 }, { type: "reverb", mix: 0.3 }, { type: "vibrato" }, { type: "chorus" },
    { type: "tremolo" }, { type: "echo" }, { type: "compress" }, { type: "gravel" }, { type: "crackle" },
    { type: "telephone" }, { type: "gain", db: -3 }, { type: "normalize" },
  ];
  for (const fx of all) {
    const s = stats(applyEffects(x, [fx]));
    assert.ok(s.rms > 1e-4, `${fx.type} produced silence`);
  }
  assert.throws(() => applyEffects(x, [{ type: "nope" }]), /Unknown effect/);
});
check("intensity scales the chain: 0 is untouched, 0.5 runs, 1.5 runs", () => {
  const x = fakeVoice("scale me");
  const chain = [{ type: "pitch", semitones: 4 }, { type: "gravel", amount: 0.5 }, { type: "reverb", mix: 0.3 }, { type: "lowpass", freq: 2000 }];
  assert.equal(applyEffects(x, chain, SAMPLE_RATE, { intensity: 0 }), x);
  const half = scaleEffects(chain, 0.5);
  assert.equal(half[0].semitones, 2);
  assert.equal(half[1].amount, 0.25);
  assert.equal(half[2].mix, 0.15);
  assert.equal(half[3].freq, 6500);
  stats(applyEffects(x, chain, SAMPLE_RATE, { intensity: 0.5 }));
  stats(applyEffects(x, chain, SAMPLE_RATE, { intensity: 1.5 }));
});

console.log("sound effects & parsing");
check("parseLine splits text, sfx and stage directions", () => {
  const segs = parseLine("L-listen, kid. *burp* You (waves arms) copy node_modules first. *really* bad. *sigh*");
  assert.deepEqual(segs, [
    { type: "text", text: "L-listen, kid." },
    { type: "sfx", name: "burp" },
    { type: "text", text: "You copy node_modules first. really bad." },
    { type: "sfx", name: "sigh" },
  ]);
});
check("every sfx synthesizes", () => {
  for (const name of Object.keys(SFX)) {
    const s = stats(synthSfx(name));
    assert.ok(s.peak > 0.5 && s.peak <= 1, `${name} peak ${s.peak}`);
  }
});
check("chunkText keeps sentences together", () => {
  const chunks = chunkText("One. Two is longer! Three? " + "x".repeat(320) + ". Four.", 300);
  assert.equal(chunks[0], "One. Two is longer! Three?");
  assert.equal(chunks.at(-1), "Four.");
});

console.log("accents");
try {
  await import("phonemizer");
  const { phonemizeWithAccent } = await import("./lib/tts.mjs");
  const text = 'About the house, right now. "I cannot believe you pushed to main."';
  const british = await phonemizeWithAccent(text, "en-gb");
  const scottish = await phonemizeWithAccent(text, "en-gb-scotland");
  check("Scottish phonemes differ from British and keep punctuation", () => {
    assert.notEqual(british, scottish);
    assert.match(scottish, /ʌuːt/, "aboot");
    assert.ok(scottish.includes(",") && scottish.includes('"') && scottish.includes("."), "punctuation kept");
    assert.doesNotMatch(scottish, /[rʉ]/, "symbols Kokoro never trained on are mapped away");
  });
} catch (err) {
  if (/Cannot find package 'phonemizer'/.test(err.message)) console.log("  - skipped (phonemizer not installed — run npm install)");
  else throw err;
}

console.log("characters");
const chars = loadCharacters();
check("all characters load and aliases resolve", () => {
  assert.ok(chars.size >= 5, "expected at least five characters");
  assert.equal(resolveCharacter(chars, "rick")?.id, "mad-scientist");
  assert.equal(resolveCharacter(chars, "Morty")?.id, "nervous-teen");
  assert.equal(resolveCharacter(chars, "Doc")?.id, "mad-scientist");
  assert.equal(resolveCharacter(chars, "scottish")?.voice.accent, "en-gb-scotland");
  assert.equal(resolveCharacter(chars, "nobody"), undefined);
});

const outDir = path.join(outputDir(), "selftest");
fs.mkdirSync(outDir, { recursive: true });
const line = "L-listen, kid. *burp* You copy node_modules before you install them. That's the whole bug.";
const rendered = [];
for (const c of chars.values()) {
  check(`render through "${c.name}" (${c.id})`, () => {});
  const audio = await renderLine(fakeEngine, c, line);
  const s = stats(audio);
  assert.ok(audio.length > SAMPLE_RATE, `${c.id}: too short`);
  assert.ok(s.rms > 0.01 && s.peak <= 0.9001, `${c.id}: rms ${s.rms} peak ${s.peak}`);
  writeWav(path.join(outDir, `${c.id}.wav`), audio);
  rendered.push(audio, silence(0.3));
}
const all = concat(rendered);
writeWav(path.join(outDir, "all-characters.wav"), all);

console.log("voice mode");
const { speakable, lastAssistantMessage } = await import("./lib/speakable.mjs");
check("speakable strips markdown, skips code, trims long replies", () => {
  const md = "## Fix\n\nRun `npm install` then see [the docs](https://x.y/z).\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- **bold** item\n- second\n\n> quoted";
  const { text, truncated } = speakable(md);
  assert.equal(truncated, false);
  assert.doesNotMatch(text, /const a|```|\*\*|\[|\]|https?:|#/);
  assert.match(text, /Fix\. Run npm install then see the docs\./);
  assert.match(text, /1, 2\./);
  assert.match(text, /bold item\. second\. quoted\./);
  const long = speakable("Sentence one is here. ".repeat(100), { maxChars: 200 });
  assert.equal(long.truncated, true);
  assert.ok(long.text.length < 240 && long.text.endsWith("…and so on."), long.text);
});
check("lastAssistantMessage reads a JSONL transcript", () => {
  const jsonl = [
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "First" }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "x" }, { type: "text", text: "Last reply" }] } }),
    "not json",
  ].join("\n");
  assert.equal(lastAssistantMessage(jsonl), "Last reply");
});

// the hooks and the /voice CLI, in a throwaway settings directory
const tmpCfg = fs.mkdtempSync(path.join(os.tmpdir(), "voice-change-selftest-"));
const hookEnv = { ...process.env, VOICE_CHANGE_CONFIG_DIR: tmpCfg, VOICE_CHANGE_RUNTIME_DIR: path.join(tmpCfg, "runtime") };
const run = (script, args, input) => spawnSync(process.execPath, [path.join(HERE, script), ...args], { env: hookEnv, input, encoding: "utf8" });
check("voice.mjs on/set/off round-trips through the settings file", () => {
  let r = run("voice.mjs", ["on", "--claude", "hamish", "--user", "kid", "--persona", "--engine", "fake"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Voice mode: ON/);
  assert.match(r.stdout, /Hamish \(scottish-engineer\)/);
  r = run("voice.mjs", ["status"]);
  assert.match(r.stdout, /persona\s+→ on/);
  r = run("voice.mjs", ["on", "--claude", "nobody"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown character/);
});
check("hook.mjs speaks the user's prompt, skips slash commands, adds persona context", () => {
  let r = run("hook.mjs", ["user", "--dry-run"], JSON.stringify({ prompt: "why is my **build** slow?" }));
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split("\n");
  const decision = JSON.parse(lines[0]);
  assert.equal(decision.character, "nervous-teen");
  assert.equal(decision.speech, "why is my build slow?");
  assert.match(lines.slice(1).join(" "), /Voice mode is on: your reply will be read aloud by Hamish/);
  r = run("hook.mjs", ["user", "--dry-run"], JSON.stringify({ prompt: "/converse rick morty" }));
  assert.doesNotMatch(r.stdout, /"speech"/);
});
check("hook.mjs reads Claude's reply from last_assistant_message or the transcript", () => {
  let r = run("hook.mjs", ["claude", "--dry-run"], JSON.stringify({ last_assistant_message: "Done.\n\n```sh\nnpm test\n```\nAll green." }));
  assert.equal(r.status, 0, r.stderr);
  const decision = JSON.parse(r.stdout.trim());
  assert.equal(decision.character, "scottish-engineer");
  assert.equal(decision.speech, "Done. All green.");
  const transcript = path.join(tmpCfg, "transcript.jsonl");
  fs.writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "From the transcript." }] } }) + "\n");
  r = run("hook.mjs", ["claude", "--dry-run"], JSON.stringify({ transcript_path: transcript }));
  assert.equal(JSON.parse(r.stdout.trim()).speech, "From the transcript.");
});
check("speak.mjs renders a queued message end to end (fake engine, no playback)", () => {
  const file = path.join(tmpCfg, "message.txt");
  fs.writeFileSync(file, "First sentence here. Second one too!");
  const r = run("speak.mjs", [file, "--character", "doc", "--engine", "fake", "--no-play"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(file), "queue file consumed");
  const logText = fs.readFileSync(path.join(hookEnv.VOICE_CHANGE_RUNTIME_DIR, "speak.log"), "utf8");
  assert.match(logText, /mad-scientist 1 chunks, rendered, no playback/);
  assert.ok(!fs.existsSync(path.join(hookEnv.VOICE_CHANGE_RUNTIME_DIR, "speaking.lock")), "lock released");
});
check("hook.mjs is silent when voice mode is off", () => {
  assert.equal(run("voice.mjs", ["off"]).status, 0);
  const r = run("hook.mjs", ["claude", "--dry-run"], JSON.stringify({ last_assistant_message: "Hello" }));
  assert.equal(r.stdout.trim(), "");
});
fs.rmSync(tmpCfg, { recursive: true, force: true });

console.log(`\n${passed} checks passed. Listen to the fake-voice renders in ${outDir} (${seconds(all)}s total).`);
