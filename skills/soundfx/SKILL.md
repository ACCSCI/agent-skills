---
name: soundfx
description: Generate sound effects from natural language descriptions using ByteDance Seed-TTS API. Use this whenever the user wants to create custom audio — SFX for games, videos, podcasts, apps, combat, magic spells, environment ambience, UI feedback, footsteps, creature sounds, explosions, weapons, or any other sound effect. Trigger when the user mentions sound effects, SFX, audio generation, sound design, or wants to create audio assets.
---

# Sound Effect Generator

Generate sound effects from natural language descriptions using the ByteDance Seed-TTS (豆包语音合成) audio generation API.

## Authoritative source

**Official API doc (always authoritative):**
`https://docs.volcengine.com/docs/6561/2550782?lang=zh`

The endpoint is `POST https://openspeech.bytedance.com/api/v3/tts/create`, documented under 音频生成HTTP (`/docs/6561/2550782`). Additional reference at `/docs/6561/1329502`.

### When errors or unexpected API behavior occur

1. **Fetch the official doc FIRST** — use WebFetch to retrieve `https://docs.volcengine.com/docs/6561/2550782?lang=zh` and any linked sub-pages
2. **Compare** the official doc against the local `generate_sfx.py` script and this SKILL.md
3. **If the official doc differs from local** — the official doc wins. Update the local script and SKILL.md to match the official spec
4. **If the official doc is ambiguous** — search the broader volcengine docs site for related pages, changelog entries, or migration guides

### Conflict resolution protocol

When local docs contradict the official online documentation:
- The online doc at `https://docs.volcengine.com/docs/6561/2550782?lang=zh` is **always authoritative**
- After verifying the official spec is correct, modify the local `scripts/generate_sfx.py` and this `SKILL.md` to align
- Keep local files concise — the online docs are the reference; locals are the quick-start cheat sheet

## Quick start

```bash
python <skill_dir>/scripts/generate_sfx.py \
  --api-key <YOUR_API_KEY> \
  --prompt "A sword clash: two metal blades striking with sharp ringing echo" \
  --output sword_clash.wav
```

Run `python <skill_dir>/scripts/generate_sfx.py --help` for all options.

## API Key

Get one from [火山引擎控制台 > API Key 管理](https://console.volcengine.com/speech/new/setting/apikeys?projectName=default). Use `X-Api-Key` header (new console). If the user's key fails, direct them to the console.

## Script reference

`scripts/generate_sfx.py` calls `POST https://openspeech.bytedance.com/api/v3/tts/create`.

### Named flags (common use)

| Flag | Description |
|------|-------------|
| `--api-key` | API Key (X-Api-Key header) |
| `--prompt` | Text description of the sound (max 3000 chars). Repeatable for batch. |
| `--output` | Output file path. Pairs with `--prompt`. |
| `--model` | `seed-audio-1.0-multilingual` (default) or `seed-audio-1.0` (CN/EN only) |
| `--format` | `wav` (default), `mp3`, `ogg_opus`, `pcm` |
| `--sample-rate` | `40000` (default), or `8000`/`16000`/`24000`/`32000`/`44100`/`48000` |
| `--speech-rate` | Speed: `-50` to `100` (default `0`) |
| `--loudness` | Volume: `-50` to `100` (default `0`) |
| `--pitch` | Pitch: `-12` to `+12` semitones (default `0`) |
| `--reference-audio` | Path to reference audio for timbre matching (wav/mp3/ogg, ≤30s, ≤10MB) |
| `--reference-image` | Path to reference image for visual-to-audio (jpeg/png/webp, ≤10MB) |
| `--speaker` | Speaker/voice ID for specific timbre |

### Flexible `--params` flag

For any API body field not covered by a named flag, pass it as a JSON string via `--params`. This is how you access newer API parameters not yet reflected in the named flags. The JSON is merged into the request body.

```bash
python <skill_dir>/scripts/generate_sfx.py \
  --api-key <KEY> \
  --prompt "rain ambience" --output rain.wav \
  --params '{"audio_config":{"enable_subtitle":true},"watermark":{"aigc_watermark":true}}'
```

Conflicts: `--params` wins over named flags when both set the same field — this lets you override any default or flag value.

### Batch generation

Repeat `--prompt` / `--output` pairs. Each generates independently:

```bash
python <skill_dir>/scripts/generate_sfx.py \
  --api-key <KEY> \
  --prompt "explosion" --output sfx/boom.wav \
  --prompt "coin collect" --output sfx/coin.wav \
  --prompt "heal spell" --output sfx/heal.wav
```

## Prompt writing

Write prompts in English for best results. Be specific about the sound source, texture, and duration.

**Combat:** "Sharp metal blade swing with a loud clang impact, medieval battle style, 2 seconds"
**Magic:** "Fireball forming with crackling energy, building whoosh, fiery burst with ember sparks fading, 3 seconds"
**Environment:** "Dripping water echoing in a stone cavern, distant wind howl, subtle chain rattles, 5 seconds"
**UI:** "Clean digital click with a bright confirmation chime, modern UI style, 1 second"
**Movement:** "Heavy boots on gravel, slow deliberate footsteps, each step crisp, 4 seconds"
**Creature:** "Deep guttural dragon roar with echoing rumble, large beast, 3 seconds"
**Guns:** "AK-47 assault rifle rapid fire, sharp crack with metallic recoil, short bursts, 1 second"

For loopable sounds: ask for tight, self-contained bursts without long tails or fading — e.g., "dry short gunshot crack, minimal echo, tight punchy transient, no tail".

## Workflow

1. Understand the game genre, art style, and specific SFX needed
2. Draft English prompts for each sound
3. Run the script with the API key
4. Report results (paths, sizes, durations)
5. If API returns errors, consult the authoritative online docs first, then fix
