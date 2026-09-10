// Voice mode = "read the chat aloud". Settings live in one JSON file; the runtime dir holds the
// speaking lock (so two messages never talk over each other), the stop flag, and a marker that
// keeps the Stop hook from re-reading a /converse transcript that was just performed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = process.env.VOICE_CHANGE_CONFIG_DIR || path.join(os.homedir(), ".config", "voice-change-for-ai");
export const MODE_FILE = path.join(CONFIG_DIR, "voice-mode.json");
export const RUNTIME_DIR = process.env.VOICE_CHANGE_RUNTIME_DIR || path.join(os.tmpdir(), "voice-change-for-ai");
export const LOG_FILE = path.join(RUNTIME_DIR, "speak.log");

const LOCK_DIR = path.join(RUNTIME_DIR, "speaking.lock");
const STOP_FILE = path.join(RUNTIME_DIR, "stop");
const PERFORMANCE_MARK = path.join(RUNTIME_DIR, "last-performance");

export const DEFAULTS = {
  enabled: false,
  claude: "mad-scientist",
  user: "nervous-teen",
  speakUser: true,
  persona: false,
  intensity: 1,
  maxChars: 1000,
  userMaxChars: 400,
  engine: "auto",
};

export function readMode() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(MODE_FILE, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeMode(mode) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const next = { ...DEFAULTS, ...mode };
  fs.writeFileSync(MODE_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function log(msg) {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // logging is best-effort
  }
}

export function markPerformance() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(PERFORMANCE_MARK, String(Date.now()));
}

export function recentPerformance(withinMs = 120000) {
  try {
    return Date.now() - Number(fs.readFileSync(PERFORMANCE_MARK, "utf8")) < withinMs;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for the speaking lock. Returns false if it could not be had in time. */
export async function acquireLock({ timeoutMs = 180000, staleMs = 300000 } = {}) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      fs.writeFileSync(path.join(LOCK_DIR, "pid"), String(process.pid));
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(LOCK_DIR).mtimeMs > staleMs) {
          fs.rmSync(LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch {
        // lock vanished between checks — loop and try again
      }
      if (Date.now() - started > timeoutMs) return false;
      await sleep(200);
    }
  }
}

export function releaseLock() {
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

export function isSpeaking() {
  try {
    return Date.now() - fs.statSync(LOCK_DIR).mtimeMs < 300000;
  } catch {
    return false;
  }
}

/** Ask every speaker that started before now to stop. */
export function requestStop() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(STOP_FILE, String(Date.now()));
}

export function stopRequested(startedAt) {
  try {
    return Number(fs.readFileSync(STOP_FILE, "utf8")) > startedAt;
  } catch {
    return false;
  }
}
