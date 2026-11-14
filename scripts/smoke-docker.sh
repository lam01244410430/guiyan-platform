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
# The script checks the 3 containers are healthy, runs the 65 checks in the
# plan Appendix A against the stack, prints PASS/FAIL per check and exits
# non-zero if any check fails. Check 67 tears the stack down (down -v) and
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
# patch PATH JSON [token] — PATCH with a JSON body, prints the HTTP code.
patch() {
  if [ -n "${3:-}" ]; then
    curl -s --max-time 30 -o "$TMP/body" -w "%{http_code}" -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $3" -d "$2" "$BASE$1"
  else
    curl -s --max-time 30 -o "$TMP/body" -w "%{http_code}" -X PATCH -H "Content-Type: application/json" -d "$2" "$BASE$1"
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

# 5. categories — 11 (R6-1: show-license joins the 10)
CODE="$(get /api/categories)"
if [ "$CODE" = "200" ] && [ "$(jlen "['categories']")" = "11" ]; then ok "5 GET /api/categories 200, 11 categories"; else bad "5 GET /api/categories (code=$CODE, count=$(jlen "['categories']"))"; fi

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


# 31. shop theme defaults — 200, default primaryColor #0b3d36 (R1-3)
CODE="$(get /api/shops/1/theme)"
PC="$(jval "['theme']['primaryColor']")"
if [ "$CODE" = "200" ] && [ "$PC" = "#0b3d36" ]; then ok "31 GET /api/shops/1/theme 200, default primaryColor #0b3d36"; else bad "31 GET /api/shops/1/theme (code=$CODE, primaryColor=$PC)"; fi

# 32. self-disable rejected — 400 (R1-2; the admin cannot disable itself)
CODE="$(patch /api/admin/users/1/status '{"status":"disabled"}' "$ADMIN_TOKEN")"
if [ "$CODE" = "400" ]; then ok "32 PATCH /api/admin/users/1/status disabled as admin 400 self-disable"; else bad "32 PATCH /api/admin/users/1/status disabled as admin (code=$CODE, want 400)"; fi

# 33. unknown shop theme — 404 (R1-3)
CODE="$(get /api/shops/99999/theme)"
if [ "$CODE" = "404" ]; then ok "33 GET /api/shops/99999/theme 404"; else bad "33 GET /api/shops/99999/theme (code=$CODE, want 404)"; fi

# 34. shows list — 200, empty on a fresh DB (R2-1)
CODE="$(get /api/shows)"
if [ "$CODE" = "200" ] && [ "$(jlen "['shows']")" = "0" ]; then ok "34 GET /api/shows 200, empty list"; else bad "34 GET /api/shows (code=$CODE, shows=$(jlen "['shows']"))"; fi

# 35. ticket types of an unknown performance — 404 (R2-2)
CODE="$(get /api/performances/99999/ticket-types)"
if [ "$CODE" = "404" ]; then ok "35 GET /api/performances/99999/ticket-types 404"; else bad "35 GET /api/performances/99999/ticket-types (code=$CODE, want 404)"; fi

# 36. default ticket template — 200, built-in default on a fresh DB (R2-3)
CODE="$(get /api/shops/1/ticket-template)"
TPL="$(jval "['ticket_template']['name']")"
COL="$(jval "['ticket_template']['color']")"
if [ "$CODE" = "200" ] && [ "$TPL" = "默认票面" ] && [ "$COL" = "#0b3d36" ]; then ok "36 GET /api/shops/1/ticket-template 200, built-in default template"; else bad "36 GET /api/shops/1/ticket-template (code=$CODE, name=$TPL, color=$COL)"; fi

# 37. venues — 200, 6 items on a fresh DB (R2-4: 2 demo + 4 catalog)
CODE="$(get /api/venues)"
if [ "$CODE" = "200" ] && [ "$(jlen "['venues']")" = "6" ]; then ok "37 GET /api/venues 200, 6 venues"; else bad "37 GET /api/venues (code=$CODE, venues=$(jlen "['venues']"))"; fi

# 38. seats of an unknown performance — 404 (R2-5)
CODE="$(get /api/performances/99999/seats)"
if [ "$CODE" = "404" ]; then ok "38 GET /api/performances/99999/seats 404"; else bad "38 GET /api/performances/99999/seats (code=$CODE, want 404)"; fi

# 39. member tiers — 200, 4 default tiers on a fresh DB (R3-1)
CODE="$(get /api/shops/1/member-tiers)"
if [ "$CODE" = "200" ] && [ "$(jlen "['member_tiers']")" = "4" ]; then ok "39 GET /api/shops/1/member-tiers 200, 4 tiers"; else bad "39 GET /api/shops/1/member-tiers (code=$CODE, tiers=$(jlen "['member_tiers']"))"; fi

# 40. coupons — 200, empty list on a fresh DB (R3-2)
CODE="$(get /api/admin/coupons "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jlen "['coupons']")" = "0" ]; then ok "40 GET /api/admin/coupons as admin 200, empty list"; else bad "40 GET /api/admin/coupons as admin (code=$CODE, coupons=$(jlen "['coupons']"))"; fi

# 41. flash sales — 200, empty list on a fresh DB (R3-3)
CODE="$(get /api/admin/flash-sales "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jlen "['flash_sales']")" = "0" ]; then ok "41 GET /api/admin/flash-sales as admin 200, empty list"; else bad "41 GET /api/admin/flash-sales as admin (code=$CODE, flash_sales=$(jlen "['flash_sales']"))"; fi

# 42. auto coupon rules — 200, empty list on a fresh DB (R3-4)
CODE="$(get /api/admin/coupon-rules "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jlen "['coupon_rules']")" = "0" ]; then ok "42 GET /api/admin/coupon-rules as admin 200, empty list"; else bad "42 GET /api/admin/coupon-rules as admin (code=$CODE, coupon_rules=$(jlen "['coupon_rules']"))"; fi

# 43. SMS tasks — 200, empty list on a fresh DB (R3-5)
CODE="$(get /api/admin/sms-tasks "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jlen "['sms_tasks']")" = "0" ]; then ok "43 GET /api/admin/sms-tasks as admin 200, empty list"; else bad "43 GET /api/admin/sms-tasks as admin (code=$CODE, sms_tasks=$(jlen "['sms_tasks']"))"; fi

# 44. stored-value plans — 200, 3 default plans on a fresh DB (R3-6)
CODE="$(get /api/admin/stored-value-plans "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jlen "['stored_value_plans']")" = "3" ]; then ok "44 GET /api/admin/stored-value-plans as admin 200, 3 default plans"; else bad "44 GET /api/admin/stored-value-plans as admin (code=$CODE, plans=$(jlen "['stored_value_plans']"))"; fi

# 46. admin tickets — 200 as admin (R4-1; count NOT asserted: backfilled
# tickets make the count seed-dependent)
CODE="$(get /api/admin/tickets "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ]; then ok "46 GET /api/admin/tickets as admin 200"; else bad "46 GET /api/admin/tickets as admin (code=$CODE, want 200)"; fi

# 47. print logs — 200, empty list on a fresh DB (R4-2; no print has
# happened yet, so the count IS asserted, unlike the ticket list)
CODE="$(get /api/admin/print-logs "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jlen "['print_logs']")" = "0" ]; then ok "47 GET /api/admin/print-logs as admin 200, empty list"; else bad "47 GET /api/admin/print-logs as admin (code=$CODE, print_logs=$(jlen "['print_logs']"))"; fi

# 48. batch verify — 200, one bogus code -> not_found, no side
# effects (R4-3; the batch answers 200 even when every code fails)
CODE="$(post /api/verify/batch '{"codes":["GY00000000"]}' "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && has '"result":"not_found"'; then ok "48 POST /api/verify/batch as admin 200, bogus code not_found"; else bad "48 POST /api/verify/batch as admin (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 49. partial refund — route exists: refund on a missing order -> 404,
# no side effects (R4-4; the order load 404s before any write)
CODE="$(post /api/orders/999999/refund '{"reason":"smoke"}' "$ADMIN_TOKEN")"
if [ "$CODE" = "404" ]; then ok "49 POST /api/orders/999999/refund as admin 404, route exists"; else bad "49 POST /api/orders/999999/refund as admin (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 50. event aggregates — 200, empty list on a fresh DB (R5-1; no
# event has been recorded yet, so the count IS asserted)
CODE="$(get "/api/admin/event-aggregates?period=day" "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && [ "$(jlen "['event_aggregates']")" = "0" ]; then ok "50 GET /api/admin/event-aggregates as admin 200, empty list"; else bad "50 GET /api/admin/event-aggregates as admin (code=$CODE, aggregates=$(jlen "['event_aggregates']"))"; fi

# 51. member insights — 200 as admin (R5-2; the users count is NOT
# asserted: the seeded users with shop-1 orders are seed-dependent,
# only the route + shape are checked here)
CODE="$(get "/api/admin/member-insights" "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && has '"users"' && has '"suggestions"'; then ok "51 GET /api/admin/member-insights as admin 200, users + suggestions"; else bad "51 GET /api/admin/member-insights as admin (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 52. BI dashboard — 200 as admin, KPIs + top shows + 30-day series
# (R5-3; the KPI values are NOT asserted here — the npm test asserts
# they equal GET /api/admin/stats — only the route + shape are
# checked, like check 51)
CODE="$(get "/api/admin/bi" "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && has '"kpis"' && has '"top_shows"' && has '"series"'; then ok "52 GET /api/admin/bi as admin 200, kpis + top_shows + series"; else bad "52 GET /api/admin/bi as admin (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 53. analysis refresh — 200 as admin, snapshot upserted (R5-4;
# the numbers themselves are asserted by tests/r5-analysis.test.mjs
# — only the route + shape are checked here, like check 51)
CODE="$(post "/api/admin/analysis/refresh" '{"period":"day"}' "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && has '"ok":true' && has '"period":"day"'; then ok "53 POST /api/admin/analysis/refresh as admin 200, snapshot ok"; else bad "53 POST /api/admin/analysis/refresh as admin (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 54. finance ledger — 200 as admin, list shape (R5-5; the
# ledger totals themselves are asserted by
# tests/r5-alerts-ledger.test.mjs — only the route + shape are
# checked here, like check 51)
CODE="$(get "/api/admin/finance-ledger" "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && has '"ledger"'; then ok "54 GET /api/admin/finance-ledger as admin 200, ledger list"; else bad "54 GET /api/admin/finance-ledger as admin (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 55. licenses — 200, empty list on a fresh DB (R6-1; the public
# library has no registrations yet, so the count IS asserted)
CODE="$(get /api/licenses)"
if [ "$CODE" = "200" ] && [ "$(jlen "['licenses']")" = "0" ]; then ok "55 GET /api/licenses 200, empty list"; else bad "55 GET /api/licenses (code=$CODE, licenses=$(jlen "['licenses']"))"; fi

# 56. venue availability — 200, free list on a far-future date (R6-2;
# no performance exists on 2030-01-01, so the 6 seeded venues are all
# free and occupied is empty — only the route + shape are checked
# here, like check 51; the day/month semantics are asserted by
# tests/r6-venues-library.test.mjs)
CODE="$(get "/api/venues/available?date=2030-01-01")"
if [ "$CODE" = "200" ] && has '"free"' && has '"occupied"' && [ "$(jlen "['free']")" = "6" ]; then ok "56 GET /api/venues/available?date=2030-01-01 200, 6 free venues"; else bad "56 GET /api/venues/available?date=2030-01-01 (code=$CODE, free=$(jlen "['free']"))"; fi

# 57. creative goods — 200, non-empty list, category creative (R6-3;
# checks 55/56 belong to R6-1/R6-2 and land in the merged script)
CODE="$(get "/api/resources?category=creative")"
if [ "$CODE" = "200" ] && [ "$(jlen "['resources']")" -ge 1 ] && has '"category":"creative"'; then ok "57 GET /api/resources?category=creative 200, creative goods listed"; else bad "57 GET /api/resources?category=creative (code=$CODE, resources=$(jlen "['resources']"))"; fi

# 58. demand matches — 200 as demo (R6-4; login required, seeded
# demand 1 is approved artist/南宁， so the list is non-empty)
CODE="$(get /api/demands/1/matches "$DEMO_TOKEN")"
if [ "$CODE" = "200" ] && has '"matches"'; then ok "58 GET /api/demands/1/matches as demo 200, matches list"; else bad "58 GET /api/demands/1/matches as demo (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 59. comments — 200, public list shape (R6-5; checks 55-58 belong to
# R6-1..R6-4 and land in the merge — the numbers are per the R6 plan.
# The seeded approved comment on resource 2 is NOT asserted here: on a
# fresh DB resource 1 has no approved comment, only the list shape.)
CODE="$(get "/api/resources/1/comments")"
if [ "$CODE" = "200" ] && has '"comments"'; then ok "59 GET /api/resources/1/comments 200, comments list"; else bad "59 GET /api/resources/1/comments (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 60. escrow contract clause — 200 as admin, contract contains the
# escrow clause (R6-6; the contract is generated from the seeded
# order 1 — only the clause is asserted here, the escrow flow itself
# is asserted by tests/r6-escrow.test.mjs)
CODE="$(get "/api/orders/1/contract" "$ADMIN_TOKEN")"
if [ "$CODE" = "200" ] && has '托管条款'; then ok "60 GET /api/orders/1/contract as admin 200, contains escrow clause"; else bad "60 GET /api/orders/1/contract as admin (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 61. IP config — 200, unset on a fresh DB (R7-1; the config frame
# ships empty — no 文小惠 design has arrived, so no name/avatar/
# greeting is set yet; the admin PATCH is asserted by
# tests/r7-ip.test.mjs)
CODE="$(get /api/ip)"
if [ "$CODE" = "200" ] && has '{}'; then ok "61 GET /api/ip 200, unset (empty object)"; else bad "61 GET /api/ip (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 62. voice text entry — 400 on an empty message (R7-2; the spoken
# transcript goes through the same assistant proxy as typed text, and
# the browser recognition itself is client-side — only the proxy's
# empty-text rejection is asserted here. Check 61 belongs to R7-1
# and lands in the merge.)
CODE="$(post "/api/assistant/chat" '{"message":"   ","language":"zh"}')"
if [ "$CODE" = "400" ]; then ok "62 POST /api/assistant/chat empty voice text 400"; else bad "62 POST /api/assistant/chat empty voice text (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 63. knowledge graph — 200, the venue resource's neighbours include
# 刘三姐 via held_at (R7-3; the graph is hand-seeded from real data
# only — Lam decision (c); the full neighbour set + the assistant
# answer are asserted by tests/r7-kg.test.mjs). Resource 1 on a fresh
# DB is 广西文化艺术中心 (the first seeded resource).
CODE="$(get "/api/kg/related/1")"
if [ "$CODE" = "200" ] && has '刘三姐' && has 'held_at'; then ok "63 GET /api/kg/related/1 200, venue neighbours include 刘三姐 via held_at"; else bad "63 GET /api/kg/related/1 (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 64. assistant R7-4 — 200 as demo, my-orders kind with a real order
# code (seeded demo orders all start with GY2026; the answer text
# carries the code). Number 62 belongs to sibling R7-2 and lands in
# the merge; 63 is R7-3 (NOT in this merge); 45 is a pre-existing gap,
# not renumbered here.
CODE="$(get "/api/assistant?q=%E6%88%91%E7%9A%84%E8%AE%A2%E5%8D%95" "$DEMO_TOKEN")"
if [ "$CODE" = "200" ] && has '"kind":"myOrders"' && has 'GY2026'; then ok "64 GET /api/assistant?q=我的订单 as demo 200, kind myOrders + real order code"; else bad "64 GET /api/assistant?q=我的订单 as demo (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 65. auto tags — 200, tag-rules include the auto folk rule and the
# ?tag= filter answers 200 with an empty list on a fresh DB (R7-5; no
# view has been recorded yet, so nobody holds the tag — the grant
# itself is asserted by tests/r7-auto-tags.test.mjs)
CODE="$(get /api/admin/tag-rules "$ADMIN_TOKEN")"
RULES_OK=0; [ "$CODE" = "200" ] && has '"id":"folk"' && has '"mode":"auto"' && RULES_OK=1
CODE="$(get "/api/admin/users?tag=%E5%96%9C%E6%AC%A2%E6%B0%91%E6%97%8F%E9%9F%B3%E4%B9%90" "$ADMIN_TOKEN")"
if [ "$RULES_OK" = "1" ] && [ "$CODE" = "200" ] && [ "$(jlen "['users']")" = "0" ]; then ok "65 tag-rules hold the folk auto rule + GET /api/admin/users?tag=喜欢民族音乐 200, empty list"; else bad "65 auto tags (rules_ok=$RULES_OK, users_code=$CODE, users=$(jlen "['users']"))"; fi

# 66. itinerary template — 200, hand-entered template for the 刘三姐
# show (resource 2 on a fresh DB): eat/parking/sleep sections, the
# verified place 中山路夜市, and no merchant link anywhere (R7-6).
CODE="$(get "/api/resources/2/itinerary")"
if [ "$CODE" = "200" ] && has '中山路夜市' && has '"parking"' && has '"sleep"' && ! has 'http'; then ok "66 GET /api/resources/2/itinerary 200, template with eat/parking/sleep, no merchant links"; else bad "66 GET /api/resources/2/itinerary (code=$CODE, body=$(cat "$TMP/body"))"; fi

# 67. teardown — down -v, then 0 project containers and 0 project volumes.
docker compose -p "$PROJECT" down -v >/dev/null 2>&1
LEFT_C="$(docker ps --format '{{.Names}}' | grep -c "$PROJECT" || true)"
LEFT_V="$(docker volume ls --format '{{.Name}}' | grep -c "^${PROJECT}_" || true)"
if [ "$LEFT_C" = "0" ] && [ "$LEFT_V" = "0" ]; then ok "67 down -v: 0 project containers, 0 project volumes"; else bad "67 down -v (containers left=$LEFT_C, volumes left=$LEFT_V)"; fi

echo "== smoke-docker: PASS $PASS / FAIL $FAIL (66 checks) =="
[ "$FAIL" = "0" ]
