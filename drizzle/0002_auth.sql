-- TASK-010: identity tables (docs/database-schema.md §4).
-- `users` is the canonical SaaS user record (uuid PK per §2); the two
-- nullable auth-owned columns are documented in schema/auth.ts.
-- `accounts` holds linked OAuth identities (one row per provider account).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" varchar(255) NOT NULL,
  "name" varchar(255),
  "avatar_url" text,
  "email_verified" timestamptz,
  "password_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  CONSTRAINT "accounts_provider_pkey" PRIMARY KEY ("provider", "provider_account_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "accounts_user_id_idx" ON "accounts" ("user_id");
--> statement-breakpoint
