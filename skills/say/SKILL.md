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

Tuning by ear — when the user says a voice is too much, too little, too dark, creepy, robotic:

- `--ramp` plays the line at intensity 0 → 0.35 → 0.7 → 1 back-to-back so they can say which one they liked.
- `--intensity 0.5` (or `--dry` for the raw voice) scales the character's whole effect chain.
- `--voice am_puck` swaps the Kokoro base voice (`am_`/`bm_` male, `af_`/`bf_` female; American/British).
- `--sfx spoken` makes the voice *say* "Brraaap." instead of the synthesized burp — cartoon style. Bake it in with `"sfxMode": "spoken"` at the top level of the character's JSON.
- Once they pick, bake it into the character's JSON (`voice.effects`, `voice.kokoro`) so `/converse` uses it too. Rules of thumb: pitch down + reverb + gravel reads as *creepy*; pitch up + presence peaks + light distortion reads as *manic*.

Afterwards print `**Name:** line` and the WAV path. Nothing else.
