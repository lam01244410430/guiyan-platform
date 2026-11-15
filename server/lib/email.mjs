// Outbound email — AWS SES via SMTP (2026-11-16, Lam). One module for all
// outbound mail: routes call sendEmail(), never a transport directly.
// Env: SES_SMTP_HOST (default email-smtp.us-west-2.amazonaws.com),
// SES_SMTP_PORT (default 587), SES_SMTP_USER, SES_SMTP_PASS, EMAIL_FROM.
// With no provider env vars set, sendEmail() reports simulated and sends
// nothing — the OTP flow keeps its old simulated behaviour, so tests and
// local dev work without credentials. Transport upgrades to STARTTLS when
// the server offers it (SES does); a stub SMTP sink without STARTTLS is
// only ever used by tests (tests/ses-email.test.mjs).
import nodemailer from "nodemailer";

const DEFAULT_HOST = "email-smtp.us-west-2.amazonaws.com";

export function emailConfigured() {
  return Boolean(
    process.env.SES_SMTP_USER &&
      process.env.SES_SMTP_PASS &&
      process.env.EMAIL_FROM,
  );
}

let transporter = null;
let testTransport = null;

// Test-only: replace the real SMTP transport with a stub
// (fn({to, subject, text, html}) => result). Used by tests/ses-email.test.mjs.
export function setEmailTransportForTest(fn) {
  testTransport = fn;
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SES_SMTP_HOST || DEFAULT_HOST,
      port: Number(process.env.SES_SMTP_PORT || 587),
      secure: false,
      // Fail fast rather than hang the request if the SMTP host is down.
      connectionTimeout: 10000,
      socketTimeout: 10000,
      auth: {
        user: process.env.SES_SMTP_USER,
        pass: process.env.SES_SMTP_PASS,
      },
    });
  }
  return transporter;
}

export async function sendEmail({ to, subject, text, html }) {
  if (testTransport) return testTransport({ to, subject, text, html });
  if (!emailConfigured()) return { sent: false, simulated: true };
  const info = await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
  return { sent: true, messageId: info.messageId };
}
