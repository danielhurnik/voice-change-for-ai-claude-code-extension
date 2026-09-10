#!/usr/bin/env node
// Manage voice mode ("read the chat aloud").
//
//   node scripts/voice.mjs status
//   node scripts/voice.mjs on  [--claude <character>] [--user <character>] [--no-user] [--persona]
//                              [--intensity <n>] [--max-chars <n>] [--engine auto|kokoro|system]
//   node scripts/voice.mjs set  (same options, without turning it on or off)
//   node scripts/voice.mjs off
//   node scripts/voice.mjs stop          interrupt whatever is being spoken right now
//   node scripts/voice.mjs test          speak one line as each character through the same path the hooks use

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCharacters, resolveCharacter } from "./lib/characters.mjs";
import { ENGINES } from "./lib/tts.mjs";
import { LOG_FILE, MODE_FILE, RUNTIME_DIR, isSpeaking, readMode, requestStop, writeMode } from "./lib/voice-mode.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = (msg) => process.stdout.write(`${msg}\n`);

function describe(mode, chars) {
  const name = (id) => resolveCharacter(chars, id)?.name ?? id;
  const lines = [
    `Voice mode: ${mode.enabled ? "ON" : "off"}${isSpeaking() ? " (speaking right now)" : ""}`,
    `  Claude's replies → ${name(mode.claude)} (${mode.claude})`,
    `  your messages    → ${mode.speakUser ? `${name(mode.user)} (${mode.user})` : "not read aloud"}`,
    `  persona          → ${mode.persona ? `on: Claude writes its replies in ${name(mode.claude)}'s voice` : "off: replies are read verbatim"}`,
    `  intensity ${mode.intensity} · max ${mode.maxChars} chars per reply (${mode.userMaxChars} for yours) · engine ${mode.engine}`,
    `  settings: ${MODE_FILE}`,
  ];
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] || "status";
  const chars = loadCharacters();
  let mode = readMode();

  const applyOptions = () => {
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      const value = () => argv[++i];
      if (a === "--claude" || a === "--user") {
        const v = value();
        const c = resolveCharacter(chars, v);
        if (!c) throw new Error(`Unknown character "${v}". Known: ${[...chars.keys()].join(", ")}`);
        mode[a.slice(2)] = c.id;
      } else if (a === "--no-user") mode.speakUser = false;
      else if (a === "--speak-user") mode.speakUser = true;
      else if (a === "--persona") mode.persona = true;
      else if (a === "--no-persona") mode.persona = false;
      else if (a === "--intensity") mode.intensity = Number(value());
      else if (a === "--max-chars") mode.maxChars = Number(value());
      else if (a === "--user-max-chars") mode.userMaxChars = Number(value());
      else if (a === "--engine") {
        const v = value();
        if (!ENGINES.includes(v)) throw new Error(`Unknown engine "${v}". Use one of: ${ENGINES.join(", ")}`);
        mode.engine = v;
      } else throw new Error(`Unknown option ${a}`);
    }
    if (!Number.isFinite(mode.intensity) || mode.intensity < 0) throw new Error("--intensity must be a number ≥ 0");
    if (!Number.isFinite(mode.maxChars) || mode.maxChars < 50) throw new Error("--max-chars must be at least 50");
  };

  switch (command) {
    case "status":
      out(describe(mode, chars));
      break;
    case "on":
      applyOptions();
      mode.enabled = true;
      mode = writeMode(mode);
      out(describe(mode, chars));
      out("\nEvery message from now on is read aloud as it lands. `/voice stop` interrupts, `/voice off` ends it.");
      break;
    case "set":
      applyOptions();
      mode = writeMode(mode);
      out(describe(mode, chars));
      break;
    case "off":
      requestStop();
      mode.enabled = false;
      mode = writeMode(mode);
      out("Voice mode: off. (Anything still being spoken has been stopped.)");
      break;
    case "stop":
      requestStop();
      out(isSpeaking() ? "Stopping." : "Nothing is being spoken right now.");
      break;
    case "log": {
      let text = "";
      try {
        text = fs.readFileSync(LOG_FILE, "utf8");
      } catch {
        // no log yet
      }
      out(text.trim() ? text.trim().split("\n").slice(-30).join("\n") : `No log yet (${LOG_FILE})`);
      break;
    }
    case "test": {
      fs.mkdirSync(path.join(RUNTIME_DIR, "queue"), { recursive: true });
      const lines = [
        ["user", mode.user, "Okay, okay — so if I turn this on, everything we say gets read out loud?"],
        ["claude", mode.claude, "L-listen, kid. Every message, the second it lands. And it shuts up when nobody's talking. You're welcome."],
      ];
      for (const [role, id, text] of lines) {
        const file = path.join(RUNTIME_DIR, "queue", `test-${role}-${Date.now()}.txt`);
        fs.writeFileSync(file, text);
        out(`${resolveCharacter(chars, id)?.name ?? id}: ${text}`);
        const r = spawnSync(process.execPath, [path.join(HERE, "speak.mjs"), file, "--character", id, "--intensity", String(mode.intensity), "--engine", mode.engine], { stdio: "inherit" });
        if (r.status !== 0) out(`(speaker exited with ${r.status} — see ${LOG_FILE})`);
      }
      break;
    }
    default:
      throw new Error(`Unknown command "${command}". Use: status | on | set | off | stop | test | log`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`✖ ${err.message}\n`);
  process.exit(1);
}
