#!/usr/bin/env node
// Claude Code hook entry point — must return in well under a second.
//   UserPromptSubmit → node scripts/hook.mjs user     (speaks what you typed, as the "user" character)
//   Stop             → node scripts/hook.mjs claude   (speaks Claude's reply, as the "claude" character)
// Reads the hook's JSON from stdin, decides whether there is anything to say, hands the text to a
// detached speaker process (scripts/speak.mjs) and exits. --dry-run prints the decision instead.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCharacters, resolveCharacter } from "./lib/characters.mjs";
import { lastAssistantMessage, speakable } from "./lib/speakable.mjs";
import { RUNTIME_DIR, log, readMode, recentPerformance } from "./lib/voice-mode.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function personaContext(character) {
  return [
    `Voice mode is on: your reply will be read aloud by ${character.name} (${character.tagline || character.id}).`,
    `Write the prose of your reply in this voice: ${character.style}`,
    "Keep every command, path, code snippet and fact exactly correct and inside code blocks (code blocks are skipped when read aloud).",
    "Keep it short enough to listen to — under about 150 words unless the task genuinely needs more.",
  ].join(" ");
}

async function main() {
  const role = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (role !== "user" && role !== "claude") {
    process.stderr.write("usage: node scripts/hook.mjs user|claude [--dry-run]\n");
    process.exit(2);
  }
  const mode = readMode();
  if (!mode.enabled) return;

  let input = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) input = JSON.parse(raw);
  } catch (err) {
    log(`hook ${role}: could not parse stdin (${err.message})`);
    return;
  }

  const chars = loadCharacters();
  const character = resolveCharacter(chars, role === "user" ? mode.user : mode.claude) ?? resolveCharacter(chars, "mad-scientist");

  let text = "";
  if (role === "user") {
    if (!mode.speakUser) return finish();
    text = String(input.prompt ?? "");
    if (text.trim().startsWith("/")) return finish();
  } else {
    if (recentPerformance()) {
      log("hook claude: skipped — a /converse or /say just played, not reading its transcript back");
      return;
    }
    text = String(input.last_assistant_message ?? "");
    if (!text.trim() && input.transcript_path) {
      try {
        text = lastAssistantMessage(fs.readFileSync(input.transcript_path, "utf8"));
      } catch (err) {
        log(`hook claude: could not read transcript (${err.message})`);
      }
    }
  }

  const { text: speech, truncated } = speakable(text, { maxChars: role === "user" ? mode.userMaxChars : mode.maxChars });
  if (speech.replace(/[^a-z0-9]/gi, "").length < 2) return finish();

  if (dryRun) {
    process.stdout.write(JSON.stringify({ role, character: character.id, truncated, speech }) + "\n");
    return finish();
  }

  fs.mkdirSync(path.join(RUNTIME_DIR, "queue"), { recursive: true });
  const file = path.join(RUNTIME_DIR, "queue", `${Date.now()}-${role}-${process.pid}.txt`);
  fs.writeFileSync(file, speech);
  const args = [
    path.join(HERE, "speak.mjs"),
    file,
    "--character", character.id,
    "--intensity", String(mode.intensity),
    "--engine", mode.engine,
  ];
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  log(`hook ${role}: queued ${speech.length} chars for ${character.id} (pid ${child.pid})`);
  finish();

  // UserPromptSubmit hooks may add context for Claude by printing it
  function finish() {
    if (role === "user" && mode.persona) {
      const speaker = resolveCharacter(chars, mode.claude) ?? character;
      process.stdout.write(personaContext(speaker) + "\n");
    }
  }
}

main().catch((err) => {
  log(`hook failed: ${err.stack || err.message}`);
  process.exit(0);
});
