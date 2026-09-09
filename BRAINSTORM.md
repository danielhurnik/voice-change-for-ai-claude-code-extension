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
