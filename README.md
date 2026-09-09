# voice-change-for-ai

A Claude Code plugin that performs comedy dialogues about your code, out loud, in
silly character voices. Ask for a mad-scientist grandpa and a nervous teenager to
argue about your Docker build, and thirty seconds later your speakers are doing it.

```
/converse rick morty why is my docker build so slow
```

> **Narrator:** A garage. Tuesday. The build has been running for eleven minutes.
> **Doc:** L-listen, kid. You copy node_modules *burp* before you run npm install. Every layer, every time.
> **Kid:** Aw jeez... is that, like, bad?
> **Doc:** In dimension C-137 they shipped it to prod, kid. Now it's a tourist attraction.
> **Kid:** Okay, okay — so... put the install before the copy? So the layer caches?
> **Doc:** ...Yeah. Yeah, kid. Don't let it go to your head.

Everything runs on your machine. No API keys, no servers, no cost: the voices are
a small open-weight neural TTS model (Kokoro-82M) and the "voice changer" is a
pure-JavaScript effects engine — pitch shift, growl, ring modulation, reverb, echo,
bitcrusher, vinyl crackle and a synthesized burp.

## Install

In Claude Code:

```
/plugin marketplace add danielhurnik/voice-change-for-ai-claude-code-extension
/plugin install voice-change-for-ai@voice-change
```

Or, to hack on it, clone the repo and start Claude Code with the plugin loaded:

```bash
git clone https://github.com/danielhurnik/voice-change-for-ai-claude-code-extension
cd voice-change-for-ai-claude-code-extension
npm install
claude --plugin-dir .
```

### First run

- **Dependencies.** Claude Code installs the plugin's npm dependencies automatically
  when it installs the plugin. If that timed out (they are big — the ONNX runtime
  ships binaries for every platform), run `npm install` in the plugin folder once.
- **The voice model** (~90 MB) is downloaded the first time a line is spoken and
  cached in `~/.cache/voice-change-for-ai` (or the plugin's data directory). It only
  happens once. Give the first `/converse` a minute.
- **An audio player** — macOS and Windows have one built in. On Linux the plugin
  looks for `paplay`, `pw-play`, `aplay`, `ffplay` or `play`; PulseAudio/PipeWire
  desktops have `paplay` already.

Requires Node 20 or newer.

## Use

| Command | What happens |
|---|---|
| `/converse` | The default duo argues about whatever this session is working on right now |
| `/converse rick morty <topic>` | Pick the cast (any id, name or alias) and a topic |
| `/converse demon narrator roast my last commit` | Any two characters, any topic |
| `/say robot <text>` | One line in one voice — good for testing and tuning |

Claude writes the script in each character's voice, runs the performer, plays the
result, and prints the transcript plus the path of the saved WAV (send it to
whoever needs to hear it).

## The cast

| id | name | who they are | aliases |
|---|---|---|---|
| `mad-scientist` | Doc | Cynical genius grandpa scientist. Drunk on science, and also just drunk. | rick, doc, scientist, grandpa, genius |
| `nervous-teen` | Kid | Anxious teenage sidekick. Asks the question everyone is thinking. | morty, kid, teen, junior, intern, sidekick |
| `movie-trailer` | The Voice | The movie-trailer announcer. Your linter warning has never sounded so apocalyptic. | trailer, announcer, in-a-world, epic |
| `demon-overlord` | Malachar | Ancient demon lord. Weirdly good at TypeScript. | demon, overlord, villain, dark-lord, boss |
| `chipmunk` | Nibbles | Hyperactive chipmunk on a sugar high. | squirrel, helium, hyper, sugar |
| `robot` | Unit-7 | A 1960s robot. Computes the probability of your bug to two decimals. | dalek, bot, android, machine, ai |
| `narrator` | Narrator | Calm nature-documentary narrator. Observes developers in their natural habitat. | storyteller, voiceover, documentary |
| `grandpa-radio` | Gus | 1940s newsreel announcer. Calls the internet "the wireless". | radio, oldtimey, newsreel, 1940s |
| `ghost` | Whisper | Died in a production outage in 2009. Haunts the legacy code. | spirit, haunted, spooky, phantom |

## Add your own character

A character is one JSON file. Drop it in `~/.config/voice-change-for-ai/characters/`
(survives plugin updates) or in the plugin's `characters/` folder:

```json
{
  "id": "passive-aggressive-butler",
  "name": "Jeeves",
  "aliases": ["butler", "jeeves"],
  "tagline": "Impeccably polite. Devastatingly disappointed in your code.",
  "style": "An impeccably polite English butler who is deeply, quietly disappointed. Never rude, always devastating: 'Very good, sir. Shall I also delete the tests, or would sir prefer to keep up appearances?' Correct advice, delivered as a courtesy.",
  "voice": {
    "kokoro": "bm_george",
    "speed": 0.95,
    "system": { "darwin": "Daniel", "win32": "Microsoft David Desktop", "linux": "en-gb" },
    "effects": [
      { "type": "pitch", "semitones": -1 },
      { "type": "reverb", "mix": 0.1, "decay": 0.4 }
    ]
  }
}
```

- `style` is the writing prompt — this is where the character actually lives.
- `kokoro` is one of the Kokoro voices (`af_heart`, `af_bella`, `af_nicole`, `am_michael`,
  `am_onyx`, `am_puck`, `bm_george`, … — `am_` male American, `bf_` female British, and so on).
- `system` names the OS voice to use when the model isn't available. Optional.
- `effects` run in order, on the whole line, sound effects included.

### Effects

| type | params | sounds like |
|---|---|---|
| `pitch` | `semitones`, `keepDuration` (default true) | up = chipmunk, down = demon; `keepDuration: false` also speeds up/slows down |
| `speed` | `factor` | faster/slower without changing pitch |
| `gravel` | `amount` 0–1 | octave-down growl: gruff, monstrous |
| `ringmod` | `freq`, `mix` | 30 Hz = the Dalek |
| `distortion` | `drive` | rasp, megaphone |
| `bitcrush` | `bits`, `downsample` | old video game, possessed GPS |
| `lowpass` / `highpass` / `bandpass` | `freq`, `q` | muffled, thin, telephone |
| `peak` | `freq`, `q`, `gainDb` | boost presence or chest |
| `telephone` | `drive` | bandpass + distortion in one |
| `reverb` | `mix`, `decay`, `size`, `damp` | bathroom to cathedral |
| `echo` | `delayMs`, `feedback`, `mix` | canyon, haunted hallway |
| `vibrato` | `rate`, `depthMs` | nervous quiver |
| `chorus` | `rate`, `depthMs`, `mix` | ghostly doubling |
| `tremolo` | `rate`, `depth` | AM radio wobble |
| `compress` | `threshold`, `ratio` | movie-trailer punch |
| `crackle` | `amount`, `density` | vinyl pops and hiss |
| `gain` / `normalize` | `db` / `peak` | level |

Inline sound effects in any line: `*burp*`, `*belch*`, `*sigh*`, `*gulp*`, `*cough*`, `*hiccup*` — they can even interrupt a word (`node_mo *burp* dules`).
Text in `(parentheses)` is a stage direction and is not spoken.

## Command line

The skills are thin wrappers over two scripts you can run yourself:

```bash
node scripts/say.mjs doc "L-listen, kid. *burp* The cache key is the whole problem."
node scripts/say.mjs --list                       # the cast
node scripts/perform.mjs script.json              # or `-` to read the script from stdin
node scripts/selftest.mjs                         # runs everything with a synthetic voice, no model needed
```

Options: `--engine auto|kokoro|system|fake`, `--no-play`, `--out <dir>`, `--gap <ms>`,
`--characters <dir>`. Engines: `kokoro` is the neural model (default), `system` is the
OS voice (macOS `say`, Windows SAPI, Linux `espeak-ng`) — instant and robotic, `fake`
is a synthetic buzz for testing effect chains.

Environment: `VOICE_CHANGE_OUT` (where WAVs go), `VOICE_CHANGE_CACHE` (model cache),
`VOICE_CHANGE_PLAYER` (force a player command), `VOICE_CHANGE_CHARACTERS` (extra
character folders), `KOKORO_DTYPE` (`q8` default; `fp32` for a slower, cleaner voice).

## On voices

The characters are archetypes with tuned synthetic voices — a "cynical mad-scientist
grandpa", not any particular actor. The plugin does not clone real people's voices
and won't grow a feature for it: a real person's voice is theirs, and the comedy
lives in the writing anyway.

## Status

v1. The effects engine, sound effects, script parsing, character loading and both
CLIs are covered by `scripts/selftest.mjs` using a synthetic voice; the Kokoro and
OS-voice engines are wired up but their first real run on a laptop is the next step.
Planned: a hook mode that speaks every Claude reply in a chosen character, more
characters, and custom sound effects. Ideas and history in [BRAINSTORM.md](BRAINSTORM.md).
