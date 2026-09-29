import { DatabaseError } from "./errors";

// Connection strings stay server-side. This module never logs the URL —
// messages below are static so a password cannot leak through an error.
export function getDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new DatabaseError(
      "configuration",
      "DATABASE_URL is not set. Copy env.example to .env and fill it in.",
    );
  }
  return url;
}

export function getDatabaseName(databaseUrl: string): string {
  let name = "";
  try {
    name = new URL(databaseUrl).pathname.replace(/^\//, "").split("?")[0] ?? "";
  } catch {
    name = "";
  }
  if (!name) {
    throw new DatabaseError("configuration", "DATABASE_URL does not contain a database name.");
  }
  return name;
}
