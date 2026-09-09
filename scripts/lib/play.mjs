// Cross-platform WAV playback through whatever the OS has. Resolves to the player used, or null.

import { spawn } from "node:child_process";

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

function candidates(file) {
  if (process.env.VOICE_CHANGE_PLAYER) return [[process.env.VOICE_CHANGE_PLAYER, [file]]];
  switch (process.platform) {
    case "darwin":
      return [["afplay", [file]]];
    case "win32":
      return [["powershell", ["-NoProfile", "-NonInteractive", "-Command", `(New-Object Media.SoundPlayer ${psq(file)}).PlaySync()`]]];
    default:
      return [
        ["paplay", [file]],
        ["pw-play", [file]],
        ["aplay", ["-q", file]],
        ["ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", file]],
        ["play", ["-q", file]],
      ];
  }
}

/** @returns {Promise<string|null>} the command that played the file, or null if none worked */
export function playFile(file) {
  return new Promise((resolve) => {
    const list = candidates(file);
    const attempt = (i) => {
      if (i >= list.length) return resolve(null);
      const [cmd, args] = list[i];
      let settled = false;
      const child = spawn(cmd, args, { stdio: "ignore" });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        if (err.code === "ENOENT") attempt(i + 1);
        else resolve(null);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) resolve(cmd);
        else attempt(i + 1);
      });
    };
    attempt(0);
  });
}

/** Sequential playback queue so line N plays while line N+1 is still being synthesized. */
export function createPlayer() {
  let queue = Promise.resolve();
  let failed = false;
  let used = null;
  return {
    enqueue(file) {
      queue = queue.then(async () => {
        if (failed) return;
        const cmd = await playFile(file);
        if (cmd) used = cmd;
        else failed = true;
      });
    },
    async finish() {
      await queue;
      return { failed, used };
    },
  };
}
