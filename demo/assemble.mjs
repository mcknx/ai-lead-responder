// Cuts raw.webm by the run's own marks, lays the pocket-tts narration on top, burns captions + chapter tracker → p1-demo.mp4.
// node assemble.mjs   (after: say.py lines.json $OUT/voices  and  node capture.mjs)
// Nothing is sped up or trimmed inside a live shot: the form→reply wait plays in real time with its on-page timer.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = process.env.OUT || "/tmp/va-demo";
const C = Number(process.env.CLIP_START || 0.3); // video t = mark − C (measured: form page first frame 8.87 s vs mark 9.14 s)
const here = new URL(".", import.meta.url).pathname;
const run = JSON.parse(readFileSync(OUT + "/run.json", "utf8"));
if (run.error) throw new Error("capture failed: " + run.error);
const voice = Object.fromEntries(JSON.parse(readFileSync(OUT + "/voices/manifest.json", "utf8")).map((v) => [v.id, v]));
const m = run.marks;

// [narration id, src start, src end, out duration rule, chapter]
// live = play the whole source span; hold = static screen, sized to the voice (+air), never longer than what was filmed.
const segs = [
  ["1-hook", m.title, m.form, "hold", 0],
  ["2-form", m.form, m.sent, "live", 1],
  ["3-wait", m.sent, m.replied, "live", 2],
  ["4-reply", m.replied, m.sheet, "hold", 2],
  ["5-sheet", m.sheet, m.flow, "hold", 3],
  ["6-flow", m.flow, m.end, "hold", 4],
  ["7-end", m.end, m.stop, "hold", 5],
];
const CHAPTERS = ["The problem", "Visitor asks", "AI replies", "Lead sheet", "Workflow", "Built by"];
const AIR = { "4-reply": 3.5, "5-sheet": 3, "6-flow": 2, "7-end": 1.2 }; // reading time after the voice stops
// A live shot is never padded or frozen: if its voice outlasts it, the voice runs on into the next shot,
// and the next voice waits for it. Holds are sized so their own voice + reading air fits.
const VO = 0.4; // narration starts this far into its shot
let t = 0, vEnd = 0;
const plan = segs.map(([id, a, b, kind, ch]) => {
  const src = b - a, vs = Math.max(t + VO, vEnd + 0.3), vSec = voice[id].seconds;
  const dur = kind === "live" ? src : Math.max(vs + vSec + (AIR[id] ?? 0.8) - t, 1);
  const p = { id, ss: +Math.max(0, a - C).toFixed(3), src: +Math.min(src, dur).toFixed(3), dur: +dur.toFixed(2), at: +t.toFixed(2), vs: +vs.toFixed(2), ch };
  t += p.dur; vEnd = vs + vSec;
  return p;
});
const total = +t.toFixed(2);
console.table(plan);
if (total < 60 || total > 90) throw new Error(`planned ${total}s, outside 60–90`);

// ── captions (timed from the voice manifest) + chapter tracker, one ASS file
const ts = (s) => { const cs = Math.round(s * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
const wrap = (s) => { const out = [""]; for (const w of s.replace(/[{}]/g, "").split(/\s+/)) (out.at(-1) + " " + w).trim().length > 58 ? out.push(w) : (out[out.length - 1] = (out.at(-1) + " " + w).trim()); return out.slice(0, 3).join("\\N"); };
const TOP = { "4-reply": 1 }; // the reply bubble sits at the bottom of the frame, so its caption goes on top
const ev = [];
for (const p of plan) {
  ev.push(`Dialogue: 0,${ts(p.vs)},${ts(p.vs + voice[p.id].seconds + 0.4)},Sub,,0,0,${TOP[p.id] ? 58 : 0},,${TOP[p.id] ? "{\\an8}" : ""}${wrap(voice[p.id].text.replace("V A", "VA"))}`);
  const chips = CHAPTERS.map((c, i) => (i === p.ch ? `{\\c&H1C62EF&\\b1}● ${c}{\\r}` : i < p.ch ? `{\\c&H8B8B8B&}● ${c}{\\r}` : `{\\c&HC8C8C8&}○ ${c}{\\r}`)).join("   ");
  ev.push(`Dialogue: 1,${ts(p.at)},${ts(p.at + p.dur)},Track,,0,0,0,,${chips}`);
}
writeFileSync(OUT + "/subs.ass", `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Sub,Helvetica,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H330A0D13,-1,0,0,0,100,100,0,0,3,10,0,2,70,70,30,1
Style: Track,Helvetica,17,&H00FFFFFF,&H00FFFFFF,&H00000000,&H400A0D13,0,0,0,0,100,100,0,0,3,7,0,8,20,20,12,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${ev.join("\n")}
`);

// ── picture: trim each shot, pad holds by cloning the last frame, concat, burn subs
const norm = "scale=1280:720,fps=30,setsar=1,format=yuv420p";
const vf = plan.map((p, i) => `[0:v]trim=start=${p.ss.toFixed(3)}:duration=${p.src.toFixed(3)},setpts=PTS-STARTPTS,${norm},tpad=stop_mode=clone:stop_duration=${(p.dur - p.src + 0.05).toFixed(3)},trim=duration=${p.dur}[v${i}]`);
const af = plan.map((p, i) => `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(p.vs * 1000)}:all=1[a${i}]`);
const graph = [...vf, `${plan.map((_, i) => `[v${i}]`).join("")}concat=n=${plan.length}:v=1:a=0,ass=${OUT}/subs.ass[v]`,
  ...af, `${plan.map((_, i) => `[a${i}]`).join("")}amix=inputs=${plan.length}:duration=longest:normalize=0,apad=whole_dur=${total},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`].join(";");
const dest = here + "p1-demo.mp4";
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", OUT + "/raw.webm", ...plan.flatMap((p) => ["-i", voice[p.id].file]),
  "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
  "-t", String(total), "-movflags", "+faststart", dest], { stdio: "inherit" });
console.log(`wrote ${dest} · planned ${total}s · reply took ${run.replySeconds}s (shown uncut)`);
