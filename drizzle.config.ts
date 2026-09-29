import type { Config } from "drizzle-kit";

// Placeholder wired in TASK-003 (database infrastructure).
// ponytail: add schema paths + migrations once TASK-003 lands; keep CLI working meanwhile.
export default {
  schema: "./src/infrastructure/database/schema/*",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
} satisfies Config;
