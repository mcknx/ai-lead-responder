// node bridge.mjs -> :8788. POST /reply {prompt} -> `claude -p` (local Claude Code CLI). GET / form, GET /sheet lead sheet, GET /leads rows.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
const run = (cmd, args, input) => new Promise((ok, no) => {
  const p = execFile(cmd, args, { maxBuffer: 1e7, timeout: 120e3 }, (e, out) => (e ? no(e) : ok(out)));
  if (input) p.stdin.end(input);
});
createServer(async (req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { "content-type": type }); res.end(body); };
  try {
    if (req.method === "POST" && req.url === "/reply") {
      let b = ""; for await (const c of req) b += c;
      const { prompt } = JSON.parse(b);
      const text = (await run("claude", ["-p", "--model", "opus"], prompt)).trim();
      return send(200, "application/json", JSON.stringify({ text }));
    }
    if (req.url === "/leads") {
      const csv = await run("docker", ["exec", "va-pg", "psql", "-U", "va", "-d", "va", "-t", "-A", "-c",
        "select coalesce(json_agg(l order by id desc),'[]') from leads l"]);
      return send(200, "application/json", csv.trim());
    }
    if (req.url === "/" || req.url === "/form") return send(200, "text/html", readFileSync(dir + "form.html"));
    if (req.url === "/sheet") return send(200, "text/html", readFileSync(dir + "sheet.html"));
    send(404, "text/plain", "not found");
  } catch (e) { send(500, "text/plain", String(e)); }
}).listen(8788, () => console.log("bridge :8788"));
