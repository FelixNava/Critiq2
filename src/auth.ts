import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import { db, getDb } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { sendMagicLinkEmail } from "@/lib/email";
import { authRateLimit, getClientIp } from "@/lib/rateLimit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // getDb() returns the real instance — the adapter detects the dialect from it
  // and chokes on the lazy Proxy. App queries below still use the `db` proxy.
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (creds, request) => {
        // Brute-force guard: 5 attempts / minute / IP. Exceeded → treat as a
        // failed attempt (NextAuth surfaces a generic error to the client).
        const ip = getClientIp(new Headers(request?.headers));
        const rate = await authRateLimit(ip);
        if (!rate.ok) {
          console.warn(`[auth] rate-limited login from ${ip}`);
          return null;
        }

        const email = (creds?.email as string | undefined)
          ?.toLowerCase()
          .trim();
        const password = creds?.password as string | undefined;
        if (!email || !password) return null;

        const rows = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        const user = rows[0];
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM ?? "notifications@critiq.firstlap.dev",
      sendVerificationRequest: async ({ identifier, url }) => {
        await sendMagicLinkEmail({ to: identifier, url });
      },
    }),
  ],
});
