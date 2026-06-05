import { hitCounter } from "./dbCounters";

export type RateResult = {
  ok: boolean;
  retryAfter: number; // seconds until the window resets
  remaining: number;
};

async function limit(
  name: string,
  id: string,
  max: number,
  windowSeconds: number,
): Promise<RateResult> {
  try {
    const { count, expiresAt } = await hitCounter(`${name}:${id}`, windowSeconds);
    const retryAfter = Math.max(
      0,
      Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
    );
    return { ok: count <= max, retryAfter, remaining: Math.max(0, max - count) };
  } catch (err) {
    // Fail OPEN: a counter/DB hiccup must not lock users out of auth. Logged so
    // we can see if it's happening. (Beta posture; revisit if abused.)
    console.error("[rateLimit] counter error:", err);
    return { ok: true, retryAfter: 0, remaining: max };
  }
}

/** Login attempts: 5 / minute / IP. */
export const authRateLimit = (ip: string) => limit("auth", ip, 5, 60);

/** Signups: 3 / minute / IP. */
export const signupRateLimit = (ip: string) => limit("signup", ip, 3, 60);

/** AI endpoints: 20 / minute / user. Wired now, used in later phases. */
export const aiRateLimit = (userId: string) => limit("ai", userId, 20, 60);

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
