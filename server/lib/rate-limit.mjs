// Login rate limiting (Wave 5 #29) — counts FAILED logins per
// (IP, username) in a 1-hour sliding window; 5 failures locks the pair
// out with 429. Counts live in the DB (login_attempts), never in
// memory: Vercel runs many serverless instances and a restart must not
// reset the counter. Redis is not used (Upstash is not configured).
//
// THE TRANSACTION TRAP (OTP lesson, do not repeat): every request runs
// inside one transaction that ROLLS BACK when the response is >= 400
// (server/postgres.mjs). A failed login answers 401, so counting writes
// made inside the request transaction would be rolled back and the
// limiter could never trip. All counting writes below go through
// ctx.separateRequest — an independent transaction that commits on its
// own and skips the advisory lock (the outer request already holds it;
// taking it again on a second connection would deadlock). The count
// CHECK runs through ctx.separateRead for the same reason in reverse:
// a statement that errors inside the request transaction aborts the
// whole transaction (25P02), so a dead limiter table would turn every
// login into a 500 instead of failing open.
// A failed attempt is recorded for the attempted username whether or
// not the account exists, so the lock also slows username enumeration;
// the 429 check runs before the password check and reveals nothing
// about whether the account exists.

import { time } from "./http.mjs";

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 3600 * 1000;
export const LOGIN_LOCKED_MESSAGE = "登录尝试过多，请稍后再试";

export function clientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim() !== "") {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function windowStart() {
  return new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
}

export async function countLoginFailures(get, ip, username) {
  const row = await get(
    "SELECT COUNT(*) AS n FROM login_attempts WHERE ip=? AND username=? AND attempted_at>?",
    ip,
    username,
    windowStart(),
  );
  return row?.n ?? 0;
}

export async function recordLoginFailure(deps, ip, username, user) {
  await deps.separateRequest(async () => {
    await deps.run(
      "INSERT INTO login_attempts(ip,username,attempted_at) VALUES(?,?,?)",
      ip,
      username,
      time(),
    );
    const n = await countLoginFailures(deps.get, ip, username);
    // Exactly one audit row, when this failure is the one that trips
    // the lock (serial case; concurrent 5th failures may rarely
    // produce zero or two rows — the lock itself is enforced by the
    // count check at the start of login, not by the audit).
    if (n === LOGIN_MAX_FAILURES) {
      await deps.audit(user, "登录受限", `登录尝试过多: ${ip} / ${username}`);
    }
  });
}

export async function clearLoginFailures(deps, ip, username) {
  await deps.separateRequest(async () => {
    await deps.run(
      "DELETE FROM login_attempts WHERE ip=? AND username=?",
      ip,
      username,
    );
  });
}
