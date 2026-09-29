// Fresh-database workflow: CREATE DATABASE if missing, then apply migrations.
// Usage: DATABASE_URL=postgresql://... node scripts/db-setup.mjs
// Error output is redacted — the URL (and its password) is never printed.
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

config({ path: [".env", ".env.local"] });

function fail(message) {
  console.error(`db-setup: ${message}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail("DATABASE_URL is not set.");

let target;
try {
  const parsed = new URL(databaseUrl);
  target = parsed.pathname.replace(/^\//, "").split("?")[0];
  if (!target) throw new Error("empty");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("unsafe characters");
} catch {
  fail("DATABASE_URL does not contain a valid database name.");
}

const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

const admin = new Client({ connectionString: adminUrl.toString() });
try {
  await admin.connect();
} catch {
  fail("could not connect to PostgreSQL server (check host, port, credentials).");
}

try {
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [target]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${target}"`);
    console.log(`db-setup: created database "${target}".`);
  } else {
    console.log(`db-setup: database "${target}" already exists.`);
  }
} catch {
  fail(`could not create database "${target}".`);
} finally {
  await admin.end();
}

try {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("db-setup: migrations applied.");
} catch {
  fail("migration failed (see drizzle/ journal for pending migrations).");
}
