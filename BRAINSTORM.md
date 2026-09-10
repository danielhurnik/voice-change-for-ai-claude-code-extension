# Brainstorm

The gag: AI text-to-speech is always calm, clean and polite. We put a voice
changer between the TTS and your ears. The AI still enunciates perfectly —
it just sounds like a demon, a chipmunk, or a guy taking your drive-thru order.

## Part 1 — where does the voice come from?

Three ways to get TTS audio we can actually mangle:

| Option | Quality | Cost | Catch |
|---|---|---|---|
| **Web Speech API** (`speechSynthesis`) | OK | Free, built into every browser | The audio never touches our code — the OS speaks directly, so we can only nudge `rate` and `pitch`. Comedy ceiling is low. |
| **In-browser neural TTS via WASM** — [Piper](https://github.com/rhasspy/piper) or [Kokoro](https://github.com/hexgrad/kokoro) running on onnxruntime-web | Genuinely good | Free | Model download (~40–90 MB, cached after first load). We get raw PCM samples — full control. |
| **Cloud TTS API** (OpenAI TTS, ElevenLabs) | Best | Paid, needs a key + a server to hide it | Running costs. Boring. |

**Leaning toward:** WASM neural TTS. It hands us a raw audio buffer, which is
exactly what a voice changer needs, and the whole thing stays a static page on
GitHub Pages with zero running cost. Web Speech API is still worth keeping as
a "v0 / instant demo" mode with the two knobs it does have.

Bonus: espeak-ng compiled to WASM is tiny and *already* sounds like a 1980s
robot. That's not a bug, that's a free preset.

## Part 2 — the voice changer (the fun part)

Everything below is doable with the Web Audio API, no libraries required for
most of it:

- **Pitch shift** — up = chipmunk, down = demon. Cheap version: resample
  (changes speed too, which is funnier anyway). Proper version: phase vocoder
  or SoundTouchJS (pitch without speed).
- **Ring modulator** — multiply the signal by a ~30 Hz sine wave. This is
  literally how the Daleks were made. One `OscillatorNode` + one `GainNode`.
- **Bitcrusher** — crush sample rate/bit depth. Old videogame / possessed
  GPS vibes.
- **Convolution reverb** — tiny impulse responses for "cathedral", "bathroom",
  "stadium announcer".
- **Bandpass + distortion** — telephone, walkie-talkie, drive-thru speaker.
- **Lowpass + slow vibrato** — underwater.
- **Pitch down + compressor + big reverb** — Movie Trailer Guy. ("In a world…")
- **Random glitch slicer** — chops and stutters the buffer. "AI having a
  breakdown."

## Part 3 — preset menu (draft)

| Preset | Recipe |
|---|---|
| 😈 Demon Overlord | pitch −7 semitones, slight detuned double, dark reverb |
| 🐿️ Helium Chipmunk | pitch +9, speed ×1.15 |
| 🤖 Dalek | ring mod 30 Hz, light distortion |
| 🎬 Movie Trailer Guy | pitch −4, compressor, huge reverb |
| 📻 Grandpa's Radio | bandpass 400–3000 Hz, vinyl crackle, mild AM wobble |
| 🌊 Underwater | lowpass 500 Hz, vibrato 0.5 Hz |
| 🍔 Drive-Thru | bandpass, distortion, intermittent static bursts |
| 👻 Ghost | chorus, long reverb, whisper mix |
| 🧪 GLaDOS-ish | subtle pitch quantization + bitcrush + flat delivery |
| 💥 AI Breakdown | random glitch slicer, escalating |

Plus manual sliders for people who want to cook their own.

## Part 4 — what shape is the product?

1. **Static web page** (MVP) — textbox → voice preset → ▶ play → "Download
   WAV". GitHub Pages, shareable with anyone.
2. **Soundboard mode** — save your best clips as buttons, one tap to replay.
3. **Shareable links** — text + preset encoded in the URL, so a link *is* the
   joke. No backend needed.
4. **"Make the AI write it too"** — a prompt box ("explain taxes as an angry
   pirate"), an LLM writes the script, the voice changer performs it. Needs an
   API key, so this is a later, optional layer.
5. **Discord bot** — `/say` in a voice channel. Different runtime entirely;
   park it for later.

## Part 5 — build order

- **v0 (one evening):** Vite + React + TS. Web Speech API with rate/pitch
  abuse + the preset UI. Proves the joke lands. Deploy to Pages immediately.
- **v1 (the real thing):** Kokoro or Piper WASM → raw buffer → Web Audio
  effect chain → all presets above → WAV export.
- **v2:** shareable URLs, soundboard, maybe the LLM script-writer.

## Open questions

- Piper vs Kokoro vs espeak-ng for v1? (quality vs download size vs comedy)
- Web page first, or is the Discord bot the actual dream?
- Name check: is the repo name final, or do we brainstorm that too?
  (candidates: `voicemangler`, `say-it-weird`, `demon-tts`, `chipmunk.exe`)

---

## Decision log

**2026-09-09 — Claude Code extension first.** Nobody's in a browser while
they're coding (or clauding). The web page idea moves to "maybe later".

**2026-09-09 — Characters, not just effects.** The product is character
*conversations*: prompt a topic, get a two-hander performed out loud
(mad-scientist grandpa × nervous teen, in a garage). Two layers:

1. **Persona text** — Claude writes the dialogue in the character's speech
   style. This is where most of the comedy lives.
2. **Archetype voices** — per-character voice recipes built from generic TTS
   plus effects (pitch, gravel, pacing, interjection samples). Evokes the
   character; is not the actor.

**Hard rule:** no cloning of real people's voices (voice actors included) —
no consent, no clone. Consented voice libraries (e.g. paid ones where the
voice owner opted in) are the only path to "real-sounding famous-ish" and
are parked as a v2-maybe.

## Extension architecture (draft)

- **Plugin skill** `/converse <charA> <charB> "<topic>"` — Claude writes the
  script, a helper voices each line with that character's preset, plays them
  in order. A little radio play about your bug.
- **Hook mode (optional)** — a Stop hook speaks each normal Claude reply in
  your chosen character's voice while you work.
- **Character = a config file** — `characters/rick-ish.json`: speech-style
  prompt + voice recipe (Piper voice model, pitch shift, sox effect chain,
  interjection samples). Easy for anyone to add their own.
- **Voice engine, all local:** Piper TTS (free, offline, per-voice models)
  → sox/ffmpeg effects → afplay/paplay/powershell audio. No server, no keys.

**2026-09-09 — v1 built.** `/converse` and `/say` skills, nine characters, a
pure-JS effects engine (pitch/WSOLA, gravel, ring mod, reverb, echo, bitcrush,
crackle, compressor, filters), synthesized *burp*/*sigh*/*gulp*/*cough*/*hiccup*,
Kokoro-82M via kokoro-js with an OS-voice fallback, cross-platform playback that
starts after the first line. Self-test runs the whole pipeline on a synthetic
voice. Not yet built: the your-own-impression cloning idea — dropped, see above.

**2026-09-09 — first real listen (Windows, Kokoro).** Lessons, so we don't
relearn them: pitch-down + octave growl + reverb = *creepy*, not manic — Doc is
now pitched slightly up with nasal/presence peaks and no reverb. The first
synthesized burp was a fart (low buzz through a lowpass); a burp needs a raspy
voice source through vowel formants with a lip-pop. `--ramp`, `--intensity`,
`--voice` and `--sfx spoken` exist for tuning by ear. Verdict from the user:
"that's really funny". Next: more voices — a character is one JSON file.

**2026-09-09 — accents.** Kokoro phonemizes with espeak-ng, which has real
accent rules (`en-gb-scotland`, Lancashire, West Midlands, Caribbean, NYC).
`voice.accent` routes a character's text through one of them via
`generate_from_ids`, so pronunciation changes, not just spelling. Hamish the
Scottish sysadmin is the first user. `ʉ` is mapped to `uː` because Kokoro
never trained on it. Untested by ear as of writing.

**2026-09-10 — voice mode (the hook mode) built.** `/voice on` registers
nothing new: the plugin's `hooks/hooks.json` always has a UserPromptSubmit
hook and a Stop hook, and both read `~/.config/voice-change-for-ai/voice-mode.json`
to decide whether to speak. Each hook hands the text to a detached
`speak.mjs`; a lock directory serialises speakers across processes; a stop
flag interrupts them; a "last performance" marker stops the Stop hook from
reading a `/converse` transcript back. `--persona` injects the reader's style
as context so Claude writes in character. Known cost: the voice model loads
in every speaker process (a few seconds per message) — a daemon would fix it.
