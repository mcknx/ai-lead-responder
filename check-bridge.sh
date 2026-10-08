#!/usr/bin/env bash
set -e
out=$(curl -sf -X POST localhost:8788/reply -H 'content-type: application/json' -d '{"prompt":"Reply with exactly: pong"}')
echo "$out" | grep -qi pong && echo "bridge ok" || { echo "FAIL: $out"; exit 1; }
curl -sf localhost:8788/leads | head -c 1 | grep -q '\[' && echo "leads ok"
