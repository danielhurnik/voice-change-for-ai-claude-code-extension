---
name: say
description: Say one line out loud in one of the plugin's character voices (mad scientist, nervous teen, demon overlord, movie trailer, chipmunk, robot, ghost, narrator, old-time radio). Use when the user runs /say, asks to hear a sentence in a character's voice, or wants to test or tune a voice.
argument-hint: "[character] [text]"
allowed-tools: Bash
---

# /say — one line, one voice

Arguments given: `$ARGUMENTS`

- The first word is the character: an `id`, `name` or alias from `${CLAUDE_PLUGIN_ROOT}/characters/` (`node "${CLAUDE_PLUGIN_ROOT}/scripts/say.mjs" --list` prints them). If it matches nothing, use `mad-scientist` and treat the whole argument string as the text.
- The rest is the text. If no text was given, write one line in that character's `style` about whatever this session is doing right now.

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/say.mjs" mad-scientist "L-listen, kid. *burp* The cache key is the whole problem."
```

Sound effects go inline as `*burp*`, `*belch*`, `*sigh*`, `*gulp*`, `*cough*`, `*hiccup*`. The first run downloads the ~90 MB voice model once. If it prints `kokoro-js is not installed`, run `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"` and retry, or add `--engine system` for the OS voice.

Afterwards print `**Name:** line` and the WAV path. Nothing else.
