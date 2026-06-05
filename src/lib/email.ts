import { Resend } from "resend";

let _resend: Resend | null = null;

function client(): Resend {
  const key = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY / AUTH_RESEND_KEY is not set");
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

const FROM = (() => {
  const addr = process.env.EMAIL_FROM ?? "notifications@critiq.firstlap.dev";
  // Add a display name if a bare address was provided.
  return addr.includes("<") ? addr : `Critiq <${addr}>`;
})();

/** Branded magic-link sign-in email. Called by the Auth.js Resend provider. */
export async function sendMagicLinkEmail({
  to,
  url,
}: {
  to: string;
  url: string;
}): Promise<void> {
  const { error } = await client().emails.send({
    from: FROM,
    to,
    subject: "Your Critiq sign-in link",
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
        <h1 style="font-size:20px;margin:0 0 8px">Sign in to Critiq</h1>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 24px">
          Click the button below to sign in. This link expires in 24 hours and can be used once.
        </p>
        <a href="${url}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:8px">
          Sign in to Critiq
        </a>
        <p style="font-size:12px;line-height:1.6;color:#94a3b8;margin:24px 0 0">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
    text: `Sign in to Critiq: ${url}\n\nThis link expires in 24 hours and can be used once. If you didn't request it, ignore this email.`,
  });
  if (error) throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
}
