// Characters are JSON files: characters/*.json in the plugin, plus any directory the user adds.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_CAST = ["mad-scientist", "nervous-teen"];

/** Directories searched for character files, first match wins. */
export function characterDirs(extra = []) {
  const dirs = [...extra];
  if (process.env.VOICE_CHANGE_CHARACTERS) dirs.push(...process.env.VOICE_CHANGE_CHARACTERS.split(path.delimiter));
  if (process.env.CLAUDE_PLUGIN_DATA) dirs.push(path.join(process.env.CLAUDE_PLUGIN_DATA, "characters"));
  dirs.push(path.join(os.homedir(), ".config", "voice-change-for-ai", "characters"));
  dirs.push(path.join(PLUGIN_ROOT, "characters"));
  return dirs.filter((d) => d && fs.existsSync(d));
}

function validate(c, file) {
  for (const key of ["id", "name", "voice"]) {
    if (!c[key]) throw new Error(`${file}: character is missing "${key}"`);
  }
  if (!Array.isArray(c.voice.effects)) c.voice.effects = [];
  if (!Array.isArray(c.aliases)) c.aliases = [];
  return c;
}

/** @returns {Map<string, object>} id → character */
export function loadCharacters(extraDirs = []) {
  const chars = new Map();
  for (const dir of characterDirs(extraDirs)) {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      const file = path.join(dir, entry);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (err) {
        throw new Error(`${file}: ${err.message}`);
      }
      const c = validate(parsed, file);
      if (!chars.has(c.id)) chars.set(c.id, { ...c, file });
    }
  }
  return chars;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Find a character by id, name or alias. Returns undefined when nothing matches. */
export function resolveCharacter(chars, token) {
  const t = norm(token);
  if (!t) return undefined;
  if (chars.has(t)) return chars.get(t);
  for (const c of chars.values()) {
    if (norm(c.name) === t) return c;
    if (c.aliases.some((a) => norm(a) === t)) return c;
  }
  return undefined;
}

export function describeCharacters(chars) {
  return [...chars.values()]
    .map((c) => `${c.id.padEnd(16)} ${c.name.padEnd(12)} ${c.tagline || ""}${c.aliases.length ? `  (aliases: ${c.aliases.join(", ")})` : ""}`)
    .join("\n");
}
