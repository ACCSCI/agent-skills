#!/usr/bin/env python3
"""
Game Sound Effect Generator using ByteDance Seed-TTS API.

Generates game SFX from natural language text descriptions.

Authoritative API doc (always check here first on errors):
  https://docs.volcengine.com/docs/6561/2550782?lang=zh

Usage:
  python generate_sfx.py --api-key KEY --prompt "sword clash" --output sword.wav
  python generate_sfx.py --api-key KEY \
    --prompt "explosion" --output boom.wav \
    --prompt "coin collect" --output coin.wav
  python generate_sfx.py --api-key KEY --prompt "rain" --output rain.wav \
    --params '{"audio_config":{"enable_subtitle":true}}'
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
from copy import deepcopy

API_URL = "https://openspeech.bytedance.com/api/v3/tts/create"
OFFICIAL_API_DOC = "https://docs.volcengine.com/docs/6561/2550782?lang=zh"


def deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base. override values win on conflict."""
    result = deepcopy(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def generate_sfx(
    api_key: str,
    prompt: str,
    output_path: str,
    model: str = "seed-audio-1.0-multilingual",
    fmt: str = "wav",
    sample_rate: int = 40000,
    speech_rate: int = 0,
    loudness: int = 0,
    pitch: int = 0,
    reference_audio: str | None = None,
    reference_image: str | None = None,
    speaker: str | None = None,
    extra_params: dict | None = None,
    timeout: int = 120,
) -> dict:
    """Generate a sound effect and save it to output_path.

    extra_params is a dict of additional API body fields, deep-merged on top
    of the named-flag body. Use it for params not covered by named flags.
    """
    # Build body from named flags
    body: dict = {
        "model": model,
        "text_prompt": prompt,
        "audio_config": {
            "format": fmt,
            "sample_rate": sample_rate,
            "speech_rate": speech_rate,
            "loudness_rate": loudness,
            "pitch_rate": pitch,
        },
    }

    if speaker:
        body["speaker"] = speaker
    if reference_audio:
        audio_path = os.path.abspath(reference_audio)
        with open(audio_path, "rb") as f:
            body["audio_data"] = base64.b64encode(f.read()).decode("utf-8")
    if reference_image:
        img_path = os.path.abspath(reference_image)
        with open(img_path, "rb") as f:
            body["image_data"] = base64.b64encode(f.read()).decode("utf-8")

    # Deep-merge extra_params on top (extra_params wins on conflicts)
    if extra_params:
        body = deep_merge(body, extra_params)

    # Make request
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        return {
            "error": True,
            "code": e.code,
            "message": err_body,
            "hint": f"Check official API docs: {OFFICIAL_API_DOC}",
        }
    except Exception as e:
        return {"error": True, "message": str(e)}

    # Check API error
    if "code" in result and result["code"] != 0:
        return {
            "error": True,
            "code": result.get("code"),
            "message": result.get("message", "Unknown API error"),
            "hint": f"Check official API docs: {OFFICIAL_API_DOC}",
        }

    # Decode and save audio
    audio_b64 = result.get("audio")
    if not audio_b64:
        return {"error": True, "message": "No audio data in response"}

    audio_bytes = base64.b64decode(audio_b64)

    # Auto-append extension if not present
    _, ext = os.path.splitext(output_path)
    if not ext:
        ext_map = {"wav": ".wav", "mp3": ".mp3", "ogg_opus": ".ogg", "pcm": ".pcm"}
        output_path = output_path + ext_map.get(fmt, ".wav")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(audio_bytes)

    return {
        "error": False,
        "path": os.path.abspath(output_path),
        "size_bytes": len(audio_bytes),
        "duration": result.get("duration"),
        "original_duration": result.get("original_duration"),
        "format": fmt,
        "sample_rate": sample_rate,
    }


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate game sound effects with ByteDance Seed-TTS API",
        epilog=f"Official API docs: {OFFICIAL_API_DOC}",
    )
    parser.add_argument("--api-key", required=True, help="ByteDance API key (X-Api-Key header)")
    parser.add_argument("--prompt", action="append", dest="prompts", default=[],
                        help="Text prompt describing the sound effect (repeatable)")
    parser.add_argument("--output", action="append", dest="outputs", default=[],
                        help="Output file path (repeatable, pairs with --prompt)")
    parser.add_argument("--model", default="seed-audio-1.0-multilingual",
                        choices=["seed-audio-1.0-multilingual", "seed-audio-1.0"])
    parser.add_argument("--format", default="wav",
                        choices=["wav", "mp3", "ogg_opus", "pcm"])
    parser.add_argument("--sample-rate", type=int, default=40000,
                        choices=[8000, 16000, 24000, 32000, 44100, 48000])
    parser.add_argument("--speech-rate", type=int, default=0,
                        help="Speed: -50 (0.5x) to 100 (2.0x)")
    parser.add_argument("--loudness", type=int, default=0,
                        help="Volume: -50 (0.5x) to 100 (2.0x)")
    parser.add_argument("--pitch", type=int, default=0,
                        help="Pitch shift: -12 to +12 semitones")
    parser.add_argument("--reference-audio", help="Path to reference audio for timbre matching")
    parser.add_argument("--reference-image", help="Path to reference image for visual-to-audio")
    parser.add_argument("--speaker", help="Speaker/voice ID for TTS")
    parser.add_argument("--params", default=None,
                        help="Extra API body fields as JSON string. Deep-merged on top of "
                             "named flags, winning on any conflict. "
                             'Example: \'{"audio_config":{"enable_subtitle":true}}\'')
    parser.add_argument("--timeout", type=int, default=120,
                        help="Request timeout in seconds")
    return parser.parse_args()


def main():
    args = parse_args()

    # Parse extra params
    extra_params = None
    if args.params:
        try:
            extra_params = json.loads(args.params)
        except json.JSONDecodeError as e:
            print(f"ERROR: Invalid JSON in --params: {e}", file=sys.stderr)
            sys.exit(1)
        if not isinstance(extra_params, dict):
            print("ERROR: --params must be a JSON object", file=sys.stderr)
            sys.exit(1)

    # Build prompt/output pairs
    pairs = []
    if args.prompts and args.outputs:
        if len(args.prompts) != len(args.outputs):
            print("ERROR: Number of --prompt and --output must match", file=sys.stderr)
            sys.exit(1)
        pairs = list(zip(args.prompts, args.outputs))
    elif args.prompts and not args.outputs:
        for i, prompt in enumerate(args.prompts):
            slug = prompt[:40].lower().replace(" ", "_").replace(",", "").replace(".", "")
            ext_map = {"wav": ".wav", "mp3": ".mp3", "ogg_opus": ".ogg", "pcm": ".pcm"}
            ext = ext_map.get(args.format, ".wav")
            pairs.append((prompt, f"sfx_{i+1}_{slug}{ext}"))
    else:
        print("ERROR: At least one --prompt is required", file=sys.stderr)
        sys.exit(1)

    results = []
    total = len(pairs)
    for i, (prompt, output) in enumerate(pairs, 1):
        label = f"[{i}/{total}]"
        print(f"{label} Generating: {prompt[:80]}{'...' if len(prompt) > 80 else ''}")
        start = time.time()

        result = generate_sfx(
            api_key=args.api_key,
            prompt=prompt,
            output_path=output,
            model=args.model,
            fmt=args.format,
            sample_rate=args.sample_rate,
            speech_rate=args.speech_rate,
            loudness=args.loudness,
            pitch=args.pitch,
            reference_audio=args.reference_audio,
            reference_image=args.reference_image,
            speaker=args.speaker,
            extra_params=extra_params,
            timeout=args.timeout,
        )

        elapsed = time.time() - start
        if result.get("error"):
            print(f"{label} FAILED after {elapsed:.1f}s: {result.get('message', 'Unknown error')}")
            if result.get("hint"):
                print(f"       Hint: {result['hint']}")
        else:
            kb = result["size_bytes"] / 1024
            print(f"{label} OK {elapsed:.1f}s → {result['path']} "
                  f"({kb:.1f} KB, {result['duration']}s, {result['sample_rate']}Hz {result['format']})")
        results.append(result)

    ok = sum(1 for r in results if not r.get("error"))
    fail = total - ok
    print(f"\nDone: {ok} succeeded, {fail} failed")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
