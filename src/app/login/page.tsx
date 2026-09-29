// Login screen (SCREEN-002 per design.md §catalog; blueprint §2).
// Server component: redirects already-authenticated users to /projects.
// Forms post to server actions below — no client JS, no password in
// browser storage; failure renders inline on the same page.
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getSessionUser } from "@/infrastructure/auth/identity";
import { signIn } from "@/auth";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Sign in to access your workspace. No account yet?{" "}
          <a href="/register" className="underline">
            Create one
          </a>
          .
        </p>
      </div>
      {failed && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Invalid email or password.
        </p>
      )}
      {registered && (
        <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Account created — sign in with your new credentials.
        </p>
      )}
      <form action={googleLogin}>
        <button
          type="submit"
          className="w-full rounded border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          Continue with Google
        </button>
      </form>
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200" />
        or with email
        <span className="h-px flex-1 bg-zinc-200" />
      </div>
      <form action={credentialsLogin} className="flex flex-col gap-3">
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
            autoComplete="current-password"
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
