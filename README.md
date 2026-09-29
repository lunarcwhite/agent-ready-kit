# Agent Ready Kit

Transform a software idea into structured, validated, implementation-ready context for coding agents.

> **Human decides. Agent Ready Kit clarifies. Coding agent executes.**

Specifications: [AGENTS.md](AGENTS.md) · `docs/PRD.md` · `docs/architecture.md` · `docs/database-schema.md` · `docs/agents.md` · `docs/soul.md` · `docs/design.md` · `docs/tasks.md`

## Tech stack (MVP baseline)

Next.js + TypeScript · React + Tailwind CSS · PostgreSQL + Drizzle ORM · managed auth behind identity abstraction · provider-neutral AI integration.

## Prerequisites

- Node.js >= 20.18 (check `.nvmrc` if present)
- npm 10+
- PostgreSQL 15+ with a `postgres` superuser (dev: `agent_ready_kit`, test: `agent_ready_kit_test`)

## Local setup

```bash
cp env.example .env   # fill in values; .env is git-ignored, never commit secrets
npm install
npm run db:setup      # create database + apply migrations (needs DATABASE_URL)
npm run dev            # http://localhost:3000
```

Health check: `GET /api/health` → `{"status":"ok"}`.

## Database

```bash
npm run db:setup         # fresh DB from migrations (create + migrate)
npm run db:generate      # generate migration from schema changes
npm run db:migrate       # apply pending migrations (also used in CI)
npm run test:integration # live-PostgreSQL suite (needs TEST_DATABASE_URL)
```

Conventions: UUID PKs + `created_at`/`updated_at` on every domain table
(`src/infrastructure/database/schema/helpers.ts`); UUIDs via `defaultRandom()`.
Tests run inside rolled-back transactions (`test-utils.ts`) so they need no
cleanup. Connection/config failures surface as redacted `DatabaseError`
(category + pg code only) — connection strings never reach logs or responses.

## Commands

| Command             | Purpose                           |
| ------------------- | --------------------------------- |
| `npm run dev`       | Local dev server                  |
| `npm run build`     | Production build                  |
| `npm start`         | Serve production build            |
| `npm test`          | Unit tests (vitest)               |
| `npm run lint`      | ESLint                            |
| `npm run format`    | Prettier check                    |
| `npm run typecheck` | TypeScript `--noEmit`             |
| `npm run db:setup`  | Create DB + migrate (fresh setup) |

| `npm run db:generate` / `db:migrate` | Drizzle schema workflow |
| `npm run test:integration` | Live-PostgreSQL suite |

## Environment variables

Documented in [env.example](env.example) (the `.env.example` equivalent). Server secrets (`DATABASE_URL`, `*_SECRET`, `AI_API_KEY`) must stay server-side — never `NEXT_PUBLIC_`, never in logs, exports, or AI context.

## Project structure

```text
src/
├── app/                          # Next.js routes (UI + API)
├── modules/                      # Domain modules (one dir per concern)
│   ├── projects/ discovery/ decisions/ knowledge/
│   ├── specifications/           # Spec generation only
│   ├── validation/ readiness/    # Readiness is deterministic, no AI here
│   ├── tasks/
│   └── agent-kit/                # Export packaging, isolated from specifications
├── ai/                           # All AI code lives here, never in modules/
│   ├── providers/ prompts/ context/ schemas/ orchestration/
├── infrastructure/               # database/ auth/ jobs/ storage/
└── shared/                       # Cross-cutting utilities only (not a domain dump)
```

Background jobs (TASK-005): `src/infrastructure/jobs/` provides queue, status,
bounded retry, and idempotency behind a `JobStore` interface. Execution is
synchronous for MVP per `docs/architecture.md` §43 — queue infra only when
proven necessary; durable persistence lands in TASK-131 without changing callers.

Dependency direction: `modules/` → `ai/` + `infrastructure/` via interfaces;
domain modules never import provider SDKs, React, or each other's tables directly
(see `AGENTS.md` §15 and `docs/architecture.md` §62–63).
