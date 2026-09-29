import type { Config } from "drizzle-kit";

// Database CLI config (TASK-003). Schema paths resolve to domain table
// modules as they land (projects in TASK-011, decisions in TASK-021, ...).
export default {
  schema: "./src/infrastructure/database/schema/*",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
} satisfies Config;
