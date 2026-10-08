# AI Lead Responder (n8n + Claude)

A visitor sends a question through a clinic's website form. About 8 seconds later they get a helpful AI-written reply, and the lead plus the reply are saved to a lead sheet for the clinic.

Live case study (with the 65-second demo video): https://mckenneth.vercel.app/case-studies/ai-lead-responder/

## Architecture

The n8n workflow (`workflow.json`) is four nodes:

```
New lead (Webhook POST /webhook/lead)
  -> Draft reply (AI)   HTTP Request -> bridge.mjs /reply -> Claude
  -> Save to lead sheet Postgres: insert into leads (name, email, message, reply)
  -> Send reply         Respond to Webhook { id, reply }
```

| File | What it is |
| --- | --- |
| `workflow.json` | the n8n workflow |
| `schema.sql` | the `leads` table |
| `pg-credential.json` | n8n Postgres credential (local demo login `va`/`va`) |
| `form.html` | the clinic's enquiry form (served by the bridge at `/`) |
| `sheet.html` | the lead sheet (served at `/sheet`, reads `/leads`) |
| `bridge.mjs` | tiny local server: `/reply` calls the `claude` CLI, also serves the pages |
| `check.sh`, `check-bridge.sh` | end-to-end checks |
| `demo/` | scripts that recorded the demo video (Playwright capture, narration, ffmpeg assembly) and `p1-demo.mp4` |
| `case-study.html` | the case study page |

## How to run

Needs Docker, Node 18+, and the [Claude Code](https://claude.com/claude-code) CLI (`claude`) logged in.

```bash
cp .env.example .env            # set N8N_ENCRYPTION_KEY
docker compose up -d
docker exec -i va-pg psql -U va -d va < schema.sql

docker exec n8n n8n import:credentials --input=/demo/pg-credential.json
docker exec n8n n8n import:workflow --input=/demo/workflow.json
docker exec n8n n8n publish:workflow --id=vaP1LeadResponder
docker restart n8n               # pick up the published workflow

node bridge.mjs                  # :8788, keep it running
./check-bridge.sh                # bridge ok, leads ok
```

Open http://localhost:8788/ (form) and http://localhost:8788/sheet (lead sheet), or run the end-to-end check:

```bash
./check.sh                       # posts a test lead, expects a reply and a new row
```

The n8n editor is at http://localhost:5678 (create the owner account on first open).

## Honest notes

- This is a demo for a fictional clinic, Bayview Dental. No real patients or business.
- Claude is called through `bridge.mjs`, a small local bridge to the `claude` CLI, so the demo runs on a Claude subscription without an API key. In production, swap the "Draft reply (AI)" node for n8n's Anthropic (or OpenAI) node with an API key and drop the bridge.
- The Postgres login `va`/`va` is a local demo credential, only reachable inside Docker.
- Re-recording the video: `demo/capture.mjs` needs Playwright (`npm i playwright` or set `PW=/path/to/playwright`), `demo/say.py` uses pocket-tts, and `demo/say-clone.py` needs your own voice clip via `REF=/path/to/clip.wav` (never committed).

Built by McKeen Asma with Claude Code. MIT licence.
