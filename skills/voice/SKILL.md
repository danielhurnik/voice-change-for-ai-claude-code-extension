---
name: voice
description: Voice mode — read the conversation aloud. Claude's replies are spoken by one character and the user's messages by another, each the moment it lands, silent in between. Use when the user says things like "read the chat", "voice mode", "narrate this", "read your replies out loud", "stop talking", "shut up", "be quiet", "turn the voice off", or wants to change who reads what.
argument-hint: "on | off | stop | status | on --claude <character> --user <character> [--persona]"
allowed-tools: Bash
---

# /voice — read the chat aloud

Arguments given: `$ARGUMENTS`

Everything goes through one script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" status
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" on --claude mad-scientist --user nervous-teen
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" set --claude hamish          # change settings, keep it on
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" stop                         # interrupt the current speech
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" off
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" test                         # one line per character, same path the hooks use
node "${CLAUDE_PLUGIN_ROOT}/scripts/voice.mjs" log                          # last 30 lines of the speaker log, for debugging
```

Map what the user said to a command:

- "read the chat", "voice mode", "narrate", "read this out loud" → `on`. If they named characters, pass `--claude` (who reads Claude) and `--user` (who reads them); ids, names and aliases all work — see `${CLAUDE_PLUGIN_ROOT}/characters/`. "Just your replies" → `--no-user`.
- "make it in character", "answer as Doc", "do the voice properly" → `--persona`: Claude's replies are *written* in that character's style and then spoken. Without it, replies are read verbatim in the voice.
- "stop", "shut up", "be quiet", "hold on" → `stop` (interrupts the current speech, mode stays on).
- "turn it off", "enough", "no more voices" → `off`.
- "too much / too dark / less" → `set --intensity 0.5`; "only read a bit" → `set --max-chars 400`.

Then print the script's output as-is. When turning it on, add one line: the first thing spoken will be your reply to this very message, and the first line takes a few seconds while the voice model loads.

How it works, if asked: Claude Code fires a hook when a message is submitted and another when Claude finishes replying. Each hook hands the text to a background speaker (markdown stripped, code blocks skipped, long replies trimmed at a sentence with "…and so on"). Speakers queue, so nobody talks over anybody, and nothing plays when nobody is talking. Settings live in `~/.config/voice-change-for-ai/voice-mode.json`.
