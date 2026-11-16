// OTP 60s resend countdown (2026-11-16, Lam): after a code is sent
// successfully, the send button counts down 60s before it can be pressed
// again, on BOTH the change-email and change-phone tabs. The server
// already enforces the 60s rule (429 if too soon); the UI mirrors it.
// A new i18n key otpResendIn carries the countdown label in zh/vi/en
// (H5 481 -> 482 keys/language; th/ms/id stay 82).
// Source-grep assertions only, no server and no database needed.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const userJsx = fs.readFileSync(
  path.join(repoDir, "web", "assets", "js", "UserDashboard.jsx"),
  "utf-8",
);
const dataJs = fs.readFileSync(
  path.join(repoDir, "web", "assets", "js", "data.js"),
  "utf-8",
);

test("otp countdown state: one remaining-seconds counter per channel", () => {
  assert.ok(userJsx.includes("const [emailOtpLeft, setEmailOtpLeft] = useState(0);"), "email countdown state exists");
  assert.ok(userJsx.includes("const [phoneOtpLeft, setPhoneOtpLeft] = useState(0);"), "phone countdown state exists");
  assert.ok(userJsx.includes("const otpTimers = useRef({});"), "countdown timers are kept in a ref");
});

test("otp countdown runs 60s, one tick per second, stops at 0", () => {
  assert.ok(userJsx.includes("function startOtpCountdown(channel)"), "countdown starter exists");
  assert.ok(userJsx.includes("setLeft(60);"), "countdown starts at 60 seconds");
  assert.ok(userJsx.includes("}, 1000);"), "countdown ticks once per second");
  assert.ok(userJsx.includes("return prev - 1;"), "each tick drops one second");
  assert.ok(userJsx.includes("if (prev <= 1) { clearInterval(otpTimers.current[channel]); delete otpTimers.current[channel]; return 0; }"), "countdown stops at 0 and clears its timer");
  assert.ok(
    userJsx.includes("useEffect(() => () => { Object.values(otpTimers.current).forEach((id) => clearInterval(id)); }, []);"),
    "timers are cleared when the dashboard unmounts",
  );
});

test("otp countdown starts only on a successful send, both channels", () => {
  const sendAt = userJsx.indexOf('apiPost("/api/account/send-otp"');
  const emailAt = userJsx.indexOf('startOtpCountdown("email")');
  const phoneAt = userJsx.indexOf('startOtpCountdown("phone")');
  const catchAt = userJsx.indexOf(".catch(function (e)", sendAt);
  assert.ok(sendAt > 0 && emailAt > sendAt && emailAt < catchAt, "email countdown starts in the send success branch");
  assert.ok(phoneAt > sendAt && phoneAt < catchAt, "phone countdown starts in the send success branch");
  assert.ok(!userJsx.slice(catchAt, catchAt + 400).includes("startOtpCountdown"), "no countdown starts on a send error");
});

test("otp send buttons disable during the countdown and show the seconds", () => {
  assert.ok(
    userJsx.includes('disabled={emailOtpBusy || emailOtpLeft > 0} onClick={() => doSendOtp("email")}>{emailOtpLeft > 0 ? fmt(t("otpResendIn"), { n: emailOtpLeft }) : t("otpSend")}</button>'),
    "email send button disables during the countdown and shows the remaining seconds",
  );
  assert.ok(
    userJsx.includes('disabled={phoneOtpBusy || phoneOtpLeft > 0} onClick={() => doSendOtp("phone")}>{phoneOtpLeft > 0 ? fmt(t("otpResendIn"), { n: phoneOtpLeft }) : t("otpSend")}</button>'),
    "phone send button disables during the countdown and shows the remaining seconds",
  );
});

test("otp countdown label is translated in zh/vi/en", () => {
  assert.ok(dataJs.includes('otpResendIn:"{n}s 后重新获取"'), "zh countdown label exists");
  assert.ok(dataJs.includes('otpResendIn:"Gửi lại sau {n}s"'), "vi countdown label exists");
  assert.ok(dataJs.includes('otpResendIn:"Resend in {n}s"'), "en countdown label exists");
});
