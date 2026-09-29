// Auth.js v5 provider wiring (TASK-010, D-A01).
//
// Everything provider-specific lives here and only here. Domain code uses
// src/infrastructure/auth/identity.ts, which never imports this module's
// internals — only the `auth` session accessor. Provider swap = rewrite
// this file, keep the identity interface.
//
// Providers: Credentials (Email+password, bcrypt-verified against the
// users table) + Google OAuth. Strategy "jwt": required by Credentials,
// and keeps session reads DB-free. OAuth sign-in links `accounts` rows and
// stamps users.email_verified via the adapter; Credentials leaves it null.

import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { getDb } from "./infrastructure/database/db";
import { accounts, users } from "./infrastructure/database/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getDb(), { usersTable: users, accountsTable: accounts }),
  session: { strategy: "jwt" },
  // AUTH_SECRET is required in production; dev falls back to an ephemeral
  // key so `npm run dev` works out of the box (sessions simply don't
  // survive restarts without it — acceptable for local development).
  secret:
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : "dev-only-secret"),
  trustHost: true,
  providers: [
    // User's .env carries GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET; map to
    // the provider's expected clientId/clientSecret (Auth.js v5 also reads
    // AUTH_GOOGLE_ID/SECRET, which we don't use).
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim() : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const db = getDb();
        const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!row?.passwordHash) return null;
        const ok = await bcrypt.compare(password, row.passwordHash);
        if (!ok) return null;
        return { id: row.id, email: row.email, name: row.name, image: row.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user?.id) token.sub = user.id;
      // OAuth link proves email ownership — stamp it once from server
      // state (never from client input) so domain reads stay trustworthy.
      if (account?.provider === "google" && token.sub) {
        await getDb()
          .update(users)
          .set({ emailVerified: new Date() })
          .where(eq(users.id, token.sub));
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
