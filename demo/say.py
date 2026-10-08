"""
Give the film a voice, with the model loaded once.

Loading the model per line is the trap: `uvx pocket-tts generate` cold-loads
219 MB on every call, which is why an earlier film rendered at 0.65x realtime —
slower than just reading the lines aloud. Held in memory it measures ~3.5x.

Durations are measured from the sample count, never estimated from character
length. That number sizes every shot and sets every caption's out-point
downstream, so a guess there is a guess everywhere.

  uv run --python 3.12 --with pocket-tts --with scipy \
     python say.py lines.json voices/

lines.json: [{"id": "q-01", "voice": "caro_davy", "text": "..."}, ...]
Writes <outdir>/<id>.wav and <outdir>/manifest.json with real durations.

Voices: caro_davy and marius are CC0. The DEFAULT (alba) is CC BY — it obliges
attribution. cosette and jean are CC BY-NC and cannot be used commercially.
"""

import json
import os
import sys
import time

import scipy.io.wavfile
from pocket_tts import TTSModel


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: say.py <lines.json> <outdir>", file=sys.stderr)
        return 2

    lines_path, out_dir = sys.argv[1], sys.argv[2]
    with open(lines_path) as fh:
        lines = json.load(fh)
    os.makedirs(out_dir, exist_ok=True)

    print(f"loading the model once for {len(lines)} lines…", flush=True)
    t0 = time.time()
    model = TTSModel.load_model()
    print(f"  loaded in {time.time() - t0:.1f}s", flush=True)

    # One state per voice, reused. Building it is the slow part of a voice, and
    # a film with two speakers should pay for two, not for every line.
    states: dict[str, object] = {}
    manifest = []
    spoken = 0.0
    # Started AFTER the load, so the realtime figure below is about synthesis.
    started = time.time()

    for i, line in enumerate(lines, 1):
        voice = line["voice"]
        text = (line.get("text") or "").strip()
        if not text:
            # Skipped without a manifest entry, so a blank line produces no voice
            # and no caption rather than a zero-length wav that adelay chokes on.
            print(f"  [{i}/{len(lines)}] {line['id']}: empty, skipped", flush=True)
            continue
        if voice not in states:
            states[voice] = model.get_state_for_audio_prompt(voice)

        t = time.time()
        audio = model.generate_audio(states[voice], text)
        path = os.path.join(out_dir, f"{line['id']}.wav")
        scipy.io.wavfile.write(path, model.sample_rate, audio.numpy())

        secs = len(audio) / model.sample_rate
        spoken += secs
        manifest.append(
            {"id": line["id"], "voice": voice, "file": path, "seconds": round(secs, 3), "text": text}
        )
        print(
            f"  [{i}/{len(lines)}] {line['id']:<8} {voice:<15} "
            f"{secs:5.1f}s audio in {time.time() - t:5.1f}s",
            flush=True,
        )

    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)

    wall = time.time() - started
    print(
        f"\n{len(manifest)} lines · {spoken:.1f}s of speech in {wall:.1f}s "
        f"({spoken / max(wall, 1e-9):.1f}x realtime)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
