import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge-safe middleware: uses only authConfig (no db/bcrypt). The `authorized`
// callback gates protected routes and redirects to /login when needed.
export default NextAuth(authConfig).auth;

export const config = {
  // Run on everything except static assets and the auth API routes.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
