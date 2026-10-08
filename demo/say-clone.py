"""
say.py, but in McKeen's own cloned voice (Chatterbox via mlx-audio, model loaded once).
Same input and same manifest as say.py, so assemble.mjs needs no change.

  TTS=/path/to/chatterbox-mlx-audio   # folder with mlx-audio in .venv and ../whisper/<model>.bin
  REF=/path/to/your-voice.wav           # your own reference clip; never commit it
  cd $TTS && REF=$REF HF_HUB_OFFLINE=1 .venv/bin/python <this>/say-clone.py <this>/lines.json /tmp/va-demo/voices

Silence-trim, -16 LUFS,
Whisper round-trip; a line Whisper hears <85 % of is re-rendered once. The reference clip is never copied.
"""
import json, os, re, subprocess, sys, wave
import numpy as np

TTS = os.getcwd()  # run from the TTS folder
sys.path.insert(0, TTS)
from mlx_audio.tts.utils import load_model
from mlx_audio.utils import load_audio

REF = os.environ["REF"]  # reference voice clip, passed in by env; never committed
WHISPER = f"{TTS}/../whisper/ggml-large-v3-turbo-q5_0.bin"
EXAG = 0.3  # emotion exaggeration
# spoken spelling only; captions keep the real text (manifest "text"). As written, Whisper heard "n8n" as "Aneen"/"ATN".
spoken = lambda t: re.sub(r"\bn8n\b", "N eight N", t)
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " "))


def hit_rate(text, heard):
    want, got = norm(text).split(), re.sub(r"\bva\b", "v a", norm(heard)).split()
    return sum(w in got for w in want) / max(1, len(want))


def main():
    lines_path, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    m = load_model(f"{TTS}/models/chatterbox-8bit")
    conds = m.prepare_conditionals(load_audio(REF, sample_rate=24000), 24000, EXAG)
    manifest = []
    for L in json.load(open(lines_path)):
        text = L["text"].strip()
        wav = os.path.join(out, f"{L['id']}.wav")
        for attempt in range(2):
            r = m.generate(spoken(text), conds=conds, exaggeration=EXAG, verbose=False)
            r = r if hasattr(r, "audio") else next(iter(r))
            pcm = (np.clip(np.asarray(r.audio, dtype=np.float32).reshape(-1), -1, 1) * 32767).astype("<i2")
            with wave.open(wav + ".raw.wav", "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(r.sample_rate); w.writeframes(pcm.tobytes())
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav + ".raw.wav", "-af",
                "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5",
                "-ar", "24000", wav], check=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-ar", "16000", "-ac", "1", wav + ".16k.wav"], check=True)
            heard = subprocess.run(["whisper-cli", "-m", WHISPER, "-f", wav + ".16k.wav", "-l", "en", "-nt", "-np"],
                                   capture_output=True, text=True).stdout.strip()
            hit = hit_rate(spoken(text), heard)
            if hit >= 0.85: break
        for f in (wav + ".raw.wav", wav + ".16k.wav"): os.remove(f)
        with wave.open(wav) as w: secs = w.getnframes() / w.getframerate()  # real duration from sample count
        manifest.append({"id": L["id"], "voice": "mckeen-clone", "file": wav, "seconds": round(secs, 3), "text": text})
        print(json.dumps({"id": L["id"], "seconds": round(secs, 2), "hit": round(hit, 2), "heard": heard}), file=sys.stderr, flush=True)
    json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"), indent=2)


if __name__ == "__main__":
    assert hit_rate("AI Automation V A", "AI automation VA.") == 1  # self-check of the matcher
    main()
