export type DatabaseErrorCategory = "configuration" | "connection" | "migration" | "query";

export class DatabaseError extends Error {
  readonly category: DatabaseErrorCategory;

  constructor(category: DatabaseErrorCategory, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseError";
    this.category = category;
  }
}

// Driver errors may embed hosts, users, or connection strings.
// Propagate only the short pg error code (e.g. ECONNREFUSED, 3D000),
// never the raw message, so secrets cannot leak into logs or responses.
export function toDatabaseError(category: DatabaseErrorCategory, cause: unknown): DatabaseError {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String((cause as { code: unknown }).code)
      : undefined;
  return new DatabaseError(category, `Database ${category} failed${code ? ` (${code})` : ""}.`, {
    cause,
  });
}

// True when the cause chain bottoms out at a PostgreSQL unique violation
// (23505), however deeply drizzle wraps it. Shared by domain modules that
// map duplicate inserts to friendly validation errors instead of leaking
// driver internals.
export function isUniqueViolationError(error: unknown, depth = 0): boolean {
  if (depth > 3 || typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === "23505") return true;
  return "cause" in error
    ? isUniqueViolationError((error as { cause?: unknown }).cause, depth + 1)
    : false;
}
