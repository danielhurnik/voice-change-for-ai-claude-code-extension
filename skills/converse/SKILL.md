---
name: converse
description: Perform a spoken comedy dialogue between two characters (mad-scientist grandpa, nervous teen, demon overlord, movie-trailer voice, robot, ghost…) about a topic — or about whatever this session is working on — out loud through the speakers. Use when the user runs /converse or asks for characters to argue, discuss, explain, roast or narrate something in silly voices.
argument-hint: "[characterA] [characterB] [topic]"
allowed-tools: Read, Glob, Bash
---

# /converse — a tiny radio play about your code

Arguments given: `$ARGUMENTS`

## 1. Cast

The characters live in `${CLAUDE_PLUGIN_ROOT}/characters/*.json`. Glob them and read the ones you need — each has `id`, `name`, `aliases`, `tagline` and, most importantly, `style`.

- The first two argument words that match an `id`, `name` or alias are the cast (`rick morty`, `demon narrator`, `robot ghost`…). Fewer than two matches → default cast `mad-scientist` and `nervous-teen`.
- Everything after the cast is the topic. No topic → the thing this session is about right now: the bug being chased, the diff just written, the last question asked. No session context at all → pick a fight every developer has had (tabs vs spaces, "let's rewrite it in Rust", "it works on my machine").

## 2. Script

Write 8–14 lines. Rules:

- Each line obeys its character's `style` exactly. That *is* the joke — do not soften it, do not make them polite.
- Be technically right underneath the bit. The smart character's diagnosis must be real, correct advice for the actual topic; the naive character's questions are the ones a junior would really ask.
- Spoken lines are short — under 25 words. `...` and ` — ` make pauses.
- Sound effects go inline as `*burp*`, `*belch*`, `*sigh*`, `*gulp*`, `*cough*` or `*hiccup*` — they get synthesized. They can interrupt a word (`node_mo *burp* dules`) if the character's style says so. Never at the very start of a line. Anything in `(parentheses)` is a stage direction: not spoken, use sparingly.
- A `narrator` line to set the scene at the start is optional and usually worth it.

Comedy rhythm — this is what makes it a bit instead of a lecture:

- **Escalate.** Each exchange raises the stakes or the absurdity a notch; the last third should be noticeably more unhinged than the first.
- **One running gag.** Plant something small early (a wrong assumption, a flask, a dimension number) and call it back at least once.
- **Interrupt.** The confident character cuts the other one off; the anxious one trails off. Lines can end mid-thought with `—`.
- **The fix is real.** Bury the actual correct answer inside the bit, said fast, as if it's obvious. The listener should be able to act on it afterwards.
- **Button.** End on the one line that lands — usually the confident character's contempt slipping into affection, or the anxious one being accidentally right. Never end on an explanation.

## 3. Perform

One command, script on stdin:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/perform.mjs" - << 'EOF'
{
  "title": "why the docker build is slow",
  "lines": [
    { "character": "narrator", "text": "A garage. Tuesday. The build has been running for eleven minutes." },
    { "character": "mad-scientist", "text": "L-listen, kid. You copy node_modules *burp* before you run npm install. Every layer, every time." },
    { "character": "nervous-teen", "text": "Aw jeez... is that, like, bad?" }
  ]
}
EOF
```

It synthesizes every line in that character's voice, starts playing after the first line is ready, saves a WAV, and prints the path.

- The first run downloads the ~90 MB voice model. Tell the user it can take a minute; it only happens once.
- If it prints `kokoro-js is not installed`, run `npm install --prefix "${CLAUDE_PLUGIN_ROOT}"` and retry. If that isn't possible, add `--engine system` — the OS voice, worse but instant.
- If it prints `No audio player found`, give the user the WAV path so they can play it themselves.
- Unknown character in the script → the error lists the known ids. Fix the id, don't invent characters.
- Voices too much / too little? Add `--intensity 0.5` (or `1.5`) to scale every character's effect chain, `--dry` for raw voices. To tune one character by ear, use the `say` skill's `--ramp` and `--voice` options, then bake the result into its JSON.

## 4. Transcript

After the command, print the script as `**Name:** line` (the character's `name`, not its id) so the user can read along, then the WAV path on its own line. Do not explain the joke and do not add commentary.
