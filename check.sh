#!/usr/bin/env bash
set -e
before=$(docker exec va-pg psql -U va -d va -t -A -c "select count(*) from leads")
out=$(curl -sf -X POST localhost:5678/webhook/lead -H 'content-type: application/json' \
  -d '{"name":"Ana Cruz","email":"ana@example.com","message":"Hi, do you do teeth whitening on Saturdays? How much?"}')
echo "$out"
echo "$out" | grep -q '"reply"' || { echo "FAIL: no reply"; exit 1; }
after=$(docker exec va-pg psql -U va -d va -t -A -c "select count(*) from leads")
[ "$after" -gt "$before" ] && echo "p1 ok: row saved" || { echo "FAIL: no row"; exit 1; }
