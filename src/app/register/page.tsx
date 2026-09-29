// Registration (blueprint §2: Email + Password + Google OAuth).
// Minimal by design: creates a users row with bcrypt hash, then bounces
// to /login. No auto-login — the login form is the single session entry
// point, so session creation has exactly one code path to audit.
// Validation is deliberately shallow (non-empty, email shape, ≥8 chars):
// product-level password policy is not specified; revisit if specified.
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { getDb } from "@/infrastructure/database/db";
import { users } from "@/infrastructure/database/schema";
import { getSessionUser } from "@/infrastructure/auth/identity";

async function register(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    redirect("/register?error=invalid");
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await getDb().insert(users).values({ email, passwordHash });
  } catch {
    // Unique violation (existing email, either method) or any other DB
    // failure surfaces identically: existence must not be enumerable.
    redirect("/register?error=exists");
  }
  redirect("/login?registered=1");
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  if (await getSessionUser()) redirect("/projects");
  const error = (await searchParams)?.error;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Already have one?{" "}
          <a href="/login" className="underline">
            Sign in
          </a>
          .
        </p>
      </div>
      {error === "exists" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Could not create that account. Try signing in instead.
        </p>
      )}
      {error === "invalid" && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Enter a valid email and a password of at least 8 characters.
        </p>
      )}
      <form action={register} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Create account
        </button>
      </form>
    </main>
  );
}
