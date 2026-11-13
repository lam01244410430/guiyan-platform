#!/bin/bash
# Guiyan — smoke test for the containerized stack (phase 8).
#
# Usage (run on the host, stack started FIRST — this script does NOT start it):
#   cp .env.example .env        # fill DEMO_PASSWORD/ADMIN_PASSWORD; the
#                               # WECHAT_MINI_* dummy values in the template
#                               # (fake APPID + 32-zero APPSECRET fixture)
#                               # are what check 28 expects; leave AWS_* empty
#                               # for check 29 (503 = storage not configured)
#   docker compose -p guiyan-p8-smoke up -d --build
#   ./scripts/smoke-docker.sh [project]   # default project: guiyan-p8-smoke
#
# The script checks the 3 containers are healthy, runs the 31 checks in the
# plan Appendix A against the stack, prints PASS/FAIL per check and exits
# non-zero if any check fails. Check 31 tears the stack down (down -v) and
# verifies no project containers/volumes remain. All curl calls are direct
# (no background processes left behind). Target is a disposable stack with a
# fresh DB — never run it against the live Vercel/Neon deployment.
set -u

PROJECT="${1:-guiyan-p8-smoke}"
BASE="${BASE:-http://127.0.0.1:3001}"
DEMO_PASSWORD="${DEMO_PASSWORD:-demo123}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
PASS=0
FAIL=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ok()   { PASS=$((PASS + 1)); echo "PASS $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL $1"; }

# jval "['key']" / jlen "['key']" — read a value / list length from $TMP/body.
jval() { python3 -c "import json;print(json.load(open('$TMP/body'))$1)" 2>/dev/null; }
jlen() { python3 -c "import json;print(len(json.load(open('$TMP/body'))$1))" 2>/dev/null; }
has()  { grep -q "$1" "$TMP/body"; }

# get PATH [token] — GET, body to $TMP/body, prints the HTTP code.
get() {
  if [ -n "${2:-}" ]; then
    curl -s --max-time 30 -o "$TMP/body" -w "%{http_code}" -H "Authorization: Bearer $2" "$BASE$1"
  else
    curl -s --max-time 30 -o "$TMP/body" -w "%{http_code}" "$BASE$1"
  fi
}
# geth PATH [token] — like get, but response headers go to $TMP/hdr.
geth() {
  if [ -n "${2:-}" ]; then
    curl -s --max-time 30 -D "$TMP/hdr" -o "$TMP/body" -w "%{http_code}" -H "Authorization: Bearer $2" "$BASE$1"
  else
    curl -s --max-time 30 -D "$TMP/hdr" -o "$TMP/body" -w "%{http_code}" "$BASE$1"
  fi
}
# post PATH JSON [token] — POST with a JSON body, prints the HTTP code.
post() {
  if [ -n "${3:-}" ]; then
    curl -s --max-time 30 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $3" -d "$2" "$BASE$1"
  else
    curl -s --max-time 30 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$2" "$BASE$1"
  fi
}
# wait_api — poll /api/health until 200 (max ~60s); used after `restart api`.
wait_api() {
  for _ in $(seq 1 30); do
    [ "$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$BASE/api/health")" = "200" ] && return 0
    sleep 2
  done
  return 1
}

# --- Precondition: 3 containers healthy (api + db + redis). ---
echo "== stack $PROJECT: waiting for 3 containers healthy =="
HEALTHY=0
for _ in $(seq 1 24); do
  N="$(docker compose -p "$PROJECT" ps --format '{{.Status}}' 2>/dev/null | grep -c "(healthy)")"
  if [ "$N" = "3" ]; then HEALTHY=1; break; fi
  sleep 5
done
if [ "$HEALTHY" != "1" ]; then
  echo "FAIL 0 containers healthy (expected 3 healthy)"
  docker compose -p "$PROJECT" ps --format '{{.Name}} {{.Status}}'
  exit 1
fi
echo "OK 0 containers healthy (3/3)"

# 1. health
CODE="$(get /api/health)"
if [ "$CODE" = "200" ] && has '"ok":true' && has '"mode":"postgres"'; then ok "1 GET /api/health 200 postgres"; else bad "1 GET /api/health (code=$CODE)"; fi

# 2. resources — 62 items; keep the first id for later checks.
CODE="$(get /api/resources)"
RID="$(jval "['resources'][0]['id']")"
if [ "$CODE" = "200" ] && [ "$(jlen "['resources']")" = "62" ]; then ok "2 GET /api/resources 200, 62 items"; else bad "2 GET /api/resources (code=$CODE, count=$(jlen "['resources']"))"; fi

# 3. resources?sort=hot
CODE="$(get "/api/resources?sort=hot")"
if [ "$CODE" = "200" ]; then ok "3 GET /api/resources?sort=hot 200"; else bad "3 GET /api/resources?sort=hot (code=$CODE)"; fi

# 4. resource detail
CODE="$(get "/api/resources/$RID")"
if [ "$CODE" = "200" ]; then ok "4 GET /api/resources/$RID 200"; else bad "4 GET /api/resources/$RID (code=$CODE)"; fi

# 5. categories — 10
CODE="$(get /api/categories)"
if [ "$CODE" = "200" ] && [ "$(jlen "['categories']")" = "10" ]; then ok "5 GET /api/categories 200, 10 categories"; else bad "5 GET /api/categories (code=$CODE, count=$(jlen "['categories']"))"; fi

# 6. assistant (rule fallback or ai — never 5xx)
CODE="$(get "/api/assistant?q=hi")"
if [ "$CODE" = "200" ]; then ok "6 GET /api/assistant?q=hi 200"; else bad "6 GET /api/assistant?q=hi (code=$CODE)"; fi

# 7. home — built dist (hashed asset, no .jsx)
CODE="$(get /)"
if [ "$CODE" = "200" ] && has '/assets/main-' && ! has '\.jsx'; then ok "7 GET / 200, dist hashed asset"; else bad "7 GET / (code=$CODE)"; fi

# 8. user page
CODE="$(get /user.html)"
if [ "$CODE" = "200" ]; then ok "8 GET /user.html 200"; else bad "8 GET /user.html (code=$CODE)"; fi

# 9. admin login page
CODE="$(get /admin/)"
if [ "$CODE" = "200" ] && has '管理后台'; then ok "9 GET /admin/ 200, admin login"; else bad "9 GET /admin/ (code=$CODE)"; fi

# 10. admin dashboard page
CODE="$(get /admin/dashboard.html)"
if [ "$CODE" = "200" ]; then ok "10 GET /admin/dashboard.html 200"; else bad "10 GET /admin/dashboard.html (code=$CODE)"; fi

# 11. /admin.html is a 404 (dist has no such file)
CODE="$(get /admin.html)"
if [ "$CODE" = "404" ]; then ok "11 GET /admin.html 404"; else bad "11 GET /admin.html (code=$CODE, want 404)"; fi

# 12. demo login — 200 + token
CODE="$(post /api/auth/login "{\"username\":\"demo\",\"password\":\"$DEMO_PASSWORD\"}")"
DEMO_TOKEN="$(jval "['token']")"
if [ "$CODE" = "200" ] && [ -n "$DEMO_TOKEN" ] && [ "$DEMO_TOKEN" != "None" ]; then ok "12 POST /api/auth/login demo 200 + token"; else bad "12 POST /api/auth/login demo (code=$CODE)"; fi

# 13. wrong password — 401 (1 failed attempt only; lock is 5/hour)
CODE="$(post /api/auth/login '{"username":"demo","password":"wrongpass"}')"
if [ "$CODE" = "401" ]; then ok "13 POST /api/auth/login wrong password 401"; else bad "13 POST /api/auth/login wrong password (code=$CODE, want 401)"; fi

# 14. admin stats as admin — fresh DB: 139 / 310 / 62 / 34
CODE="$(post /api/auth/login "{\"username\":\"admin\",\"password\":\"$ADMIN_PASSWORD\"}")"
ADMIN_TOKEN="$(jval "['token']")"
CODE="$(get /api/admin/stats "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jval "['users']")" = "139" ] && [ "$(jval "['orders']")" = "310" ] && [ "$(jval "['resources']")" = "62" ] && [ "$(jval "['demands']")" = "34" ]; then
  ok "14 GET /api/admin/stats as admin 200, 139/310/62/34"
else
  bad "14 GET /api/admin/stats as admin (code=$CODE, users=$(jval "['users']") orders=$(jval "['orders']") resources=$(jval "['resources']") demands=$(jval "['demands']"))"
fi

# 15. admin stats as demo — 403
CODE="$(get /api/admin/stats "$DEMO_TOKEN")"
if [ "$CODE" = "403" ]; then ok "15 GET /api/admin/stats as demo 403"; else bad "15 GET /api/admin/stats as demo (code=$CODE, want 403)"; fi

# 16. admin stats anonymous — 403
CODE="$(get /api/admin/stats)"
if [ "$CODE" = "403" ]; then ok "16 GET /api/admin/stats anonymous 403"; else bad "16 GET /api/admin/stats anonymous (code=$CODE, want 403)"; fi

# 17. admin demands as admin — 34; as demo — 403
CODE="$(get /api/admin/demands "$ADMIN_TOKEN")"
N="$(jlen "['demands']")"
CODE_DEMO="$(get /api/admin/demands "$DEMO_TOKEN")"
if [ "$CODE" = "200" ] && [ "$N" = "34" ] && [ "$CODE_DEMO" = "403" ]; then ok "17 GET /api/admin/demands admin 200 (34) / demo 403"; else bad "17 GET /api/admin/demands (admin code=$CODE count=$N, demo code=$CODE_DEMO)"; fi

# 18. favorites anonymous — 401
CODE="$(post /api/favorites "{\"resourceId\":$RID}")"
if [ "$CODE" = "401" ]; then ok "18 POST /api/favorites anonymous 401"; else bad "18 POST /api/favorites anonymous (code=$CODE, want 401)"; fi

# 19. demo favorite on → list contains it
CODE="$(post /api/favorites "{\"resourceId\":$RID}" "$DEMO_TOKEN")"
FAV="$(jval "['favorite']")"
CODE="$(get /api/favorites "$DEMO_TOKEN")"
IN_LIST="$(python3 -c "import json;print(any(f['id']==$RID for f in json.load(open('$TMP/body'))['favorites']))" 2>/dev/null)"
if [ "$FAV" = "True" ] && [ "$IN_LIST" = "True" ]; then ok "19 demo favorite on + in list"; else bad "19 demo favorite on (favorite=$FAV, in_list=$IN_LIST)"; fi

# 20. demo favorite off → list no longer contains it
CODE="$(post /api/favorites "{\"resourceId\":$RID}" "$DEMO_TOKEN")"
FAV="$(jval "['favorite']")"
CODE="$(get /api/favorites "$DEMO_TOKEN")"
IN_LIST="$(python3 -c "import json;print(any(f['id']==$RID for f in json.load(open('$TMP/body'))['favorites']))" 2>/dev/null)"
if [ "$FAV" = "False" ] && [ "$IN_LIST" = "False" ]; then ok "20 demo favorite off + not in list"; else bad "20 demo favorite off (favorite=$FAV, in_list=$IN_LIST)"; fi

# 21. create order (demo, 2026-12-05, qty 1) — 200/201, pending
CODE="$(post /api/orders "{\"resourceId\":$RID,\"booking_date\":\"2026-12-05\",\"quantity\":1}" "$DEMO_TOKEN")"
OID="$(jval "['id']")"
STATUS="$(jval "['status']")"
if { [ "$CODE" = "200" ] || [ "$CODE" = "201" ]; } && [ "$STATUS" = "pending" ]; then ok "21 POST /api/orders 200/201 pending (id=$OID)"; else bad "21 POST /api/orders (code=$CODE, status=$STATUS)"; fi

# 22. confirm
CODE="$(post "/api/orders/$OID/confirm" '{}' "$DEMO_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jval "['status']")" = "confirmed" ]; then ok "22 POST /api/orders/$OID/confirm 200 confirmed"; else bad "22 confirm (code=$CODE, status=$(jval "['status']"))"; fi

# 23. pay (simulated)
CODE="$(post "/api/orders/$OID/pay" '{}' "$DEMO_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jval "['status']")" = "paid" ]; then ok "23 POST /api/orders/$OID/pay 200 paid (simulated)"; else bad "23 pay (code=$CODE, status=$(jval "['status']"))"; fi

# 24. complete
CODE="$(post "/api/orders/$OID/complete" '{}' "$DEMO_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jval "['status']")" = "completed" ]; then ok "24 POST /api/orders/$OID/complete 200 completed"; else bad "24 complete (code=$CODE, status=$(jval "['status']"))"; fi

# 25. resources twice — 2nd has X-Cache: HIT
geth /api/resources >/dev/null
geth /api/resources >/dev/null
if grep -qi '^X-Cache: HIT' "$TMP/hdr"; then ok "25 GET /api/resources 2nd X-Cache: HIT"; else bad "25 GET /api/resources 2nd X-Cache (headers: $(grep -i '^X-Cache' "$TMP/hdr" || echo none))"; fi

# 26. stop redis → 200 MISS (fail-open); start redis → still MISS
# (the api's node-redis client does not reconnect by design); restart api
# → GET twice: MISS then HIT again.
docker compose -p "$PROJECT" stop redis >/dev/null 2>&1
sleep 2
CODE="$(geth /api/resources)"
MISS1="$(grep -i '^X-Cache' "$TMP/hdr" || echo none)"
docker compose -p "$PROJECT" start redis >/dev/null 2>&1
sleep 3
CODE2="$(geth /api/resources)"
MISS2="$(grep -i '^X-Cache' "$TMP/hdr" || echo none)"
docker compose -p "$PROJECT" restart api >/dev/null 2>&1
wait_api
geth /api/resources >/dev/null
geth /api/resources >/dev/null
HIT3="$(grep -i '^X-Cache' "$TMP/hdr" || echo none)"
if [ "$CODE" = "200" ] && echo "$MISS1" | grep -qi MISS && [ "$CODE2" = "200" ] && echo "$MISS2" | grep -qi MISS && echo "$HIT3" | grep -qi HIT; then
  ok "26 stop redis 200 MISS / start redis MISS / restart api HIT again"
else
  bad "26 redis fail-open (stop: code=$CODE $MISS1; start: code=$CODE2 $MISS2; restart api: $HIT3)"
fi

# 27. wechat-mini without code — 400
CODE="$(post /api/auth/wechat-mini '{}')"
if [ "$CODE" = "400" ]; then ok "27 POST /api/auth/wechat-mini no code 400"; else bad "27 POST /api/auth/wechat-mini no code (code=$CODE, want 400)"; fi

# 28. wechat-mini fake code — 401 (not 503: proves the dummy env was read)
CODE="$(post /api/auth/wechat-mini '{"code":"fake-code-for-smoke"}')"
if [ "$CODE" = "401" ]; then ok "28 POST /api/auth/wechat-mini fake code 401 (dummy env read)"; else bad "28 POST /api/auth/wechat-mini fake code (code=$CODE, want 401 — check the stack .env has the WECHAT_MINI_* dummy values)"; fi

# 29. storage health without AWS env — 503
CODE="$(get /api/storage/health)"
if [ "$CODE" = "503" ]; then ok "29 GET /api/storage/health 503 (storage not configured)"; else bad "29 GET /api/storage/health (code=$CODE, want 503)"; fi

# 30. admin shops as admin — 200, exactly 1 shop (the main shop, R1-1)
CODE="$(get /api/admin/shops "$ADMIN_TOKEN")"
N="$(jlen "['shops']")"
if [ "$CODE" = "200" ] && [ "$N" = "1" ]; then ok "30 GET /api/admin/shops as admin 200, 1 shop"; else bad "30 GET /api/admin/shops as admin (code=$CODE, shops=$N)"; fi




# 31. teardown — down -v, then 0 project containers and 0 project volumes.
docker compose -p "$PROJECT" down -v >/dev/null 2>&1
LEFT_C="$(docker ps --format '{{.Names}}' | grep -c "$PROJECT" || true)"
LEFT_V="$(docker volume ls --format '{{.Name}}' | grep -c "^${PROJECT}_" || true)"
if [ "$LEFT_C" = "0" ] && [ "$LEFT_V" = "0" ]; then ok "31 down -v: 0 project containers, 0 project volumes"; else bad "31 down -v (containers left=$LEFT_C, volumes left=$LEFT_V)"; fi

echo "== smoke-docker: PASS $PASS / FAIL $FAIL (31 checks) =="
[ "$FAIL" = "0" ]
