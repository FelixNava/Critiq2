import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config. Contains NO database/bcrypt imports so it can run in
 * middleware (edge runtime). The real providers (Credentials + Resend) and the
 * Drizzle adapter are added in `auth.ts` (Node runtime).
 */
const PUBLIC_PATHS = ["/", "/login", "/signup", "/verify", "/terms", "/privacy"];
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/recording-check",
  "/recording-lab",
];

export const authConfig = {
  trustHost: true,
  pages: {
    signIn: "/login",
    verifyRequest: "/verify",
  },
  providers: [], // populated in auth.ts
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = nextUrl;
      const isProtected = PROTECTED_PREFIXES.some(
        (p) => pathname === p || pathname.startsWith(p + "/"),
      );
      if (isProtected && !isLoggedIn) return false; // → redirect to signIn
      // Bounce logged-in users away from auth pages
      if (isLoggedIn && (pathname === "/login" || pathname === "/signup")) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // role may be undefined for adapter (magic-link) users → default rep
        token.role = (user as { role?: string }).role ?? "rep";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export { PUBLIC_PATHS, PROTECTED_PREFIXES };
