// Films the real P1 flow headless: title card → form (live Claude call, uncut) → lead sheet → flow diagram → end card.
// node capture.mjs   (needs bridge :8788, n8n :5678, va-pg; truncates `leads` first)
// Writes $OUT/raw.webm + $OUT/run.json (event marks in seconds since the page opened ≈ video t=0).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");

const OUT = process.env.OUT || "/tmp/va-demo";
const BASE = "http://localhost:8788";
const LEAD = { name: "Ana Cruz", email: "ana@example.com", message: "Hi, do you do teeth whitening on Saturdays? How much?" };
const SIZE = { width: 1280, height: 720 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const here = new URL(".", import.meta.url).pathname;

// Flow diagram straight from workflow.json: follow connections from the node nobody points at.
function flowHtml() {
  const wf = JSON.parse(readFileSync(here + "../workflow.json", "utf8"));
  const targets = new Set(Object.values(wf.connections).flatMap((c) => c.main.flat().map((x) => x.node)));
  const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));
  const order = [wf.nodes.find((n) => !targets.has(n.name))];
  while (wf.connections[order.at(-1).name]) order.push(byName[wf.connections[order.at(-1).name].main[0][0].node]);
  const kind = { webhook: "Webhook trigger", httpRequest: "HTTP → Claude", postgres: "Postgres insert", respondToWebhook: "Respond to webhook" };
  const boxes = order.map((n, i) => `${i ? '<div class="arr" style="animation-delay:' + (2.4 + i * 1.8) + 's">→</div>' : ""}
    <div class="box" style="animation-delay:${2.4 + i * 1.8}s"><div class="k">${i + 1}</div><b>${n.name}</b><span>${kind[n.type.split(".").pop()] || n.type}</span></div>`).join("");
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#f3f7fa;color:#0f2a3d;font:16px -apple-system,Segoe UI,Roboto,sans-serif}
  h2{margin:0 0 6px;font-size:30px;text-align:center} p{margin:0 0 44px;text-align:center;color:#5b7083}
  .row{display:flex;align-items:center;gap:14px}
  .box{width:220px;padding:22px 18px;background:#fff;border:2px solid #dde5ec;border-radius:14px;text-align:center;opacity:.35;animation:on .5s forwards}
  .box b{display:block;font-size:19px;margin:8px 0 4px} .box span{color:#5b7083;font-size:14px}
  .k{width:30px;height:30px;margin:0 auto;border-radius:50%;background:#0e7c86;color:#fff;display:grid;place-items:center;font-weight:700}
  .arr{font-size:30px;color:#0e7c86;opacity:.2;animation:on2 .5s forwards}
  @keyframes on{to{opacity:1;border-color:#0e7c86;box-shadow:0 8px 24px rgba(14,124,134,.18)}} @keyframes on2{to{opacity:1}}
  </style><div><h2>${wf.name.replace(/^VA P1 — /, "")}: the n8n workflow</h2><p>Rendered from workflow.json · ${order.length} nodes</p><div class="row">${boxes}</div></div>`;
}
const card = (eyebrow, title, sub) => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#0f2a3d;color:#fff;font:18px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center}
  .e{letter-spacing:.18em;text-transform:uppercase;color:#7fd3da;font-size:15px;font-weight:600} h1{font-size:50px;margin:14px 0 12px;line-height:1.15} p{color:#b9c8d4;margin:0}
  </style><div><div class="e">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div>`;

// Visible cursor + ring (Playwright's mouse is invisible on video). Both pointer-events:none.
const cursorJs = () => {
  if (document.getElementById("__cur")) return;
  const mk = (id, css) => Object.assign(document.body.appendChild(Object.assign(document.createElement("div"), { id })).style, { position: "fixed", pointerEvents: "none", zIndex: 2147483646, ...css });
  mk("__cur", { width: "20px", height: "20px", borderRadius: "50%", background: "rgba(20,20,20,.9)", boxShadow: "0 0 0 5px rgba(255,255,255,.85),0 3px 10px rgba(0,0,0,.4)", left: "60%", top: "75%", transition: "left .6s cubic-bezier(.4,0,.2,1),top .6s cubic-bezier(.4,0,.2,1)" });
  mk("__ring", { border: "3px solid #EF621C", borderRadius: "14px", boxShadow: "0 0 0 6px rgba(239,98,28,.18)", opacity: 0, transition: "all .5s cubic-bezier(.4,0,.2,1)" });
};
async function point(page, loc, hold = 800, ring = false) {
  let b; // the sheet re-renders its rows every 3 s, so a box can come back null mid-swap
  for (let i = 0; i < 10 && !(b = await loc.boundingBox()); i++) await wait(100);
  await page.evaluate(([b, ring]) => {
    // with a ring, park the cursor on the ring's corner so it never covers the text being shown
    Object.assign(document.getElementById("__cur").style, ring ? { left: b.x + b.width - 4 + "px", top: b.y + b.height - 4 + "px" } : { left: b.x + b.width / 2 - 10 + "px", top: b.y + b.height / 2 - 10 + "px" });
    if (ring) Object.assign(document.getElementById("__ring").style, { left: b.x - 8 + "px", top: b.y - 8 + "px", width: b.width + 10 + "px", height: b.height + 10 + "px", opacity: 1 });
  }, [b, ring]);
  await wait(hold);
}

let browser, ctx;
const run = { lead: LEAD, marks: {} };
try {
  execFileSync("docker", ["exec", "va-pg", "psql", "-U", "va", "-d", "va", "-c", "truncate leads restart identity"]);
  mkdirSync(OUT + "/raw", { recursive: true });
  browser = await chromium.launch({ headless: true });
  ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: OUT + "/raw", size: SIZE } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const mark = (k) => (run.marks[k] = +((Date.now() - t0) / 1000).toFixed(2));

  await page.setContent(card("Bayview Dental · a fictional clinic", "After-hours leads,<br>answered in seconds", "AI lead responder · n8n + Claude + Postgres"));
  mark("title"); await wait(9000);

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.locator("h1").waitFor(); await page.evaluate(cursorJs); mark("form"); await wait(1200);
  for (const [k, sel] of [["name", "input[name=name]"], ["email", "input[name=email]"], ["message", "textarea[name=message]"]]) {
    await point(page, page.locator(sel), 700); await page.locator(sel).click();
    await page.locator(sel).pressSequentially(LEAD[k], { delay: k === "message" ? 45 : 70 });
  }
  if ((await page.locator("textarea[name=message]").inputValue()) !== LEAD.message) throw new Error("message did not stick");
  await point(page, page.locator("#b"), 900);
  // Receipt for the wait: elapsed since Send, recomputed each paint, frozen when the reply lands.
  await page.evaluate(() => {
    const t = performance.now(), el = document.body.appendChild(document.createElement("div"));
    Object.assign(el.style, { position: "fixed", top: "76px", right: "18px", padding: "7px 14px", borderRadius: "10px", background: "rgba(14,17,22,.9)", color: "#E6EDF3", font: "600 15px ui-monospace,Menlo,monospace", pointerEvents: "none", zIndex: 2147483647 });
    const id = setInterval(() => { el.textContent = `live Claude call · ${((performance.now() - t) / 1000).toFixed(1)} s`; if (document.querySelector(".who")) { clearInterval(id); el.textContent += " ✓"; } }, 100);
  });
  await page.locator("#b").click(); mark("sent");
  await page.locator(".who").waitFor({ timeout: 120_000 }); mark("replied");
  run.reply = await page.locator(".msg").innerText();
  run.savedText = await page.locator(".saved").innerText();
  run.replySeconds = +(run.marks.replied - run.marks.sent).toFixed(1);
  await wait(600); await point(page, page.locator(".msg"), 13000, true);

  await page.goto(BASE + "/sheet", { waitUntil: "domcontentloaded" });
  await page.locator("tr.new", { hasText: LEAD.name }).waitFor({ timeout: 15_000 }); await page.evaluate(cursorJs); mark("sheet");
  await wait(1500); await point(page, page.locator("tr.new td.reply"), 11000, true);

  await page.setContent(flowHtml()); mark("flow"); await wait(12000);
  await page.setContent(card("Built by", "McKeen Asma", "AI Automation VA · n8n")); mark("end"); await wait(6000);
  mark("stop");
} catch (e) { run.error = String(e); console.error(e); process.exitCode = 1; }
finally {
  const v = ctx && ctx.pages()[0]?.video();
  await ctx?.close(); await browser?.close(); // close is what writes the webm
  if (v) renameSync(await v.path(), OUT + "/raw.webm");
  writeFileSync(OUT + "/run.json", JSON.stringify(run, null, 2));
  console.log(JSON.stringify(run, null, 2));
}
