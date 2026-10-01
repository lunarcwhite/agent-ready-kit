// Login screen (SCREEN-002 per design.md §catalog; blueprint §2).
// Server component: redirects already-authenticated users to /projects.
// Forms post to server actions below — no client JS, no password in
// browser storage; failure renders inline on the same page.
import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthError } from "next-auth";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { signIn } from "@/auth";
import { btnPrimary, btnSecondary, cardCls, inputCls } from "@/app/components/ui";

async function credentialsLogin(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/projects" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?error=credentials");
    throw error;
  }
}

async function googleLogin(): Promise<void> {
  "use server";
  await signIn("google", { redirectTo: "/projects" });
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; registered?: string }>;
}) {
  if (await getSessionUser()) redirect("/projects");
  const params = (await searchParams) ?? {};
  const failed = params.error === "credentials";
  const registered = params.registered === "1";

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
        <div className={`mt-6 ${cardCls} !p-6`}>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Sign in to access your workspace. No account yet?{" "}
            <Link href="/register" className="font-medium underline hover:text-zinc-900 dark:hover:text-zinc-100">
              Create one
            </Link>
            .
          </p>
          {failed && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              Invalid email or password.
            </p>
          )}
          {registered && (
            <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
              Account created. Sign in with your new credentials.
            </p>
          )}
          <form action={googleLogin} className="mt-5">
            <button type="submit" className={`${btnSecondary} w-full`}>
              Continue with Google
            </button>
          </form>
          <div className="my-5 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            or with email
            <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <form action={credentialsLogin} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email
              <input name="email" type="email" required autoComplete="email" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={inputCls}
              />
            </label>
            <button type="submit" className={`${btnPrimary} mt-1 w-full`}>
              Sign in
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-500">
          Human decides. Agent Ready Kit clarifies. Coding agent executes.
        </p>
      </main>
    </div>
  );
}
