/**
 * Send a Full Auto notification email via Resend.
 * Used by /critiq-full-auto (run start + phase summary) and ad-hoc.
 *
 *   MAIL_SUBJECT="..." MAIL_BODY_FILE=/path/to/body.txt node scripts/notify-email.mjs
 *   (or)  node scripts/notify-email.mjs "Subject" "Body text"
 *
 * Loads .env.local locally; reads RESEND_API_KEY, EMAIL_FROM, EMAIL_RECIPIENT.
 */
import { Resend } from "resend";
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const key = process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY;
if (!key) {
  console.error("✗ No RESEND_API_KEY / AUTH_RESEND_KEY — cannot send email.");
  process.exit(1);
}
const to = process.env.EMAIL_RECIPIENT ?? "felix@firstlap.dev";
const fromRaw = process.env.EMAIL_FROM ?? "notifications@critiq.firstlap.dev";
const from = fromRaw.includes("<") ? fromRaw : `Critiq <${fromRaw}>`;

const subject =
  process.env.MAIL_SUBJECT ?? process.argv[2] ?? "Critiq Full Auto update";
const body = process.env.MAIL_BODY_FILE
  ? readFileSync(process.env.MAIL_BODY_FILE, "utf8")
  : (process.env.MAIL_BODY ?? process.argv[3] ?? "(no body)");

const resend = new Resend(key);
const { data, error } = await resend.emails.send({ from, to, subject, text: body });
if (error) {
  console.error("✗ SEND FAILED:", JSON.stringify(error));
  process.exit(1);
}
console.log("✓ email sent to", to, "id:", data?.id);
