import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getEnv } from "@/config/env";
import { getDb } from "@/lib/db";
import { checkCredentials } from "./credentials";

export { LOGIN_LIMIT, LOGIN_WINDOW_SECONDS } from "./credentials";

export class LoginRateLimited extends CredentialsSignin {
  override code = "rate_limited";
}

/**
 * Auth.js v5, Credentials provider, JWT sessions in an HTTP-only SameSite=Lax cookie (Secure on
 * https). There is no registration. Every admin request re-checks the user in the database
 * (requireAdmin), so deactivating an account ends its sessions immediately.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const env = getEnv();
  return {
    secret: env.AUTH_SECRET,
    trustHost: true,
    session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
    pages: { signIn: "/admin/login", error: "/admin/login" },
    logger: {
      // A wrong password is normal operation, not an error worth logging.
      error(error) {
        // instanceof, not error.name: class names are minified in production builds.
        if (error instanceof CredentialsSignin) return;
        console.error(JSON.stringify({ level: "error", msg: "auth error", name: error.name }));
      },
    },
    providers: [
      Credentials({
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(raw, request) {
          const result = await checkCredentials(getDb(), raw, request.headers);
          if (result.kind === "rate_limited") throw new LoginRateLimited();
          return result.kind === "ok"
            ? { id: result.user.id, email: result.user.email, name: result.user.name }
            : null;
        },
      }),
    ],
    callbacks: {
      session({ session, token }) {
        if (session.user && token.sub) session.user.id = token.sub;
        return session;
      },
    },
  };
});
