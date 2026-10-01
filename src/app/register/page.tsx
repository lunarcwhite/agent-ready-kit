// Registration (blueprint §2: Email + Password + Google OAuth).
// Minimal by design: creates a users row with bcrypt hash, then bounces
// to /login. No auto-login — the login form is the single session entry
// point, so session creation has exactly one code path to audit.
// Validation is deliberately shallow (non-empty, email shape, ≥8 chars):
// product-level password policy is not specified; revisit if specified.
import { redirect } from "next/navigation";
import Link from "next/link";
import bcrypt from "bcryptjs";
import { getDb } from "@/infrastructure/database/db";
import { users } from "@/infrastructure/database/schema";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { btnPrimary, cardCls, inputCls } from "@/app/components/ui";

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
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            A
          </span>
          Agent Ready Kit
        </p>
        <div className={`${cardCls} mt-6 !p-6`}>
          <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Already have one?{" "}
            <Link href="/login" className="font-medium underline hover:text-zinc-900 dark:hover:text-zinc-100">
              Sign in
            </Link>
            .
          </p>
          {error === "exists" && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              Could not create that account. Try signing in instead.
            </p>
          )}
          {error === "invalid" && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              Enter a valid email and a password of at least 8 characters.
            </p>
          )}
          <form action={register} className="mt-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email
              <input name="email" type="email" required autoComplete="email" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Password
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                At least 8 characters.
              </span>
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className={inputCls}
              />
            </label>
            <button type="submit" className={`${btnPrimary} mt-1 w-full`}>
              Create account
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
