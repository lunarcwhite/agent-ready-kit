# Agent Ready Kit

Transform a software idea into structured, validated, implementation-ready context for coding agents.

> **Human decides. Agent Ready Kit clarifies. Coding agent executes.**

Specifications: [AGENTS.md](AGENTS.md) · `docs/PRD.md` · `docs/architecture.md` · `docs/database-schema.md` · `docs/agents.md` · `docs/soul.md` · `docs/design.md` · `docs/tasks.md`

## Tech stack (MVP baseline)

Next.js + TypeScript · React + Tailwind CSS · PostgreSQL + Drizzle ORM · managed auth behind identity abstraction · provider-neutral AI integration.

## Prerequisites

- Node.js >= 20.18 (check `.nvmrc` if present)
- npm 10+
- PostgreSQL 15+ (required from TASK-003 onwards; not needed for TASK-001)

## Local setup

```bash
cp env.example .env   # fill in values; .env is git-ignored, never commit secrets
npm install
npm run dev            # http://localhost:3000
```

Health check: `GET /api/health` → `{"status":"ok"}`.

## Commands

| Command                              | Purpose                 |
| ------------------------------------ | ----------------------- |
| `npm run dev`                        | Local dev server        |
| `npm run build`                      | Production build        |
| `npm start`                          | Serve production build  |
| `npm test`                           | Unit tests (vitest)     |
| `npm run lint`                       | ESLint                  |
| `npm run format`                     | Prettier check          |
| `npm run typecheck`                  | TypeScript `--noEmit`   |
| `npm run db:generate` / `db:migrate` | Drizzle (from TASK-003) |

## Environment variables

Documented in [env.example](env.example) (the `.env.example` equivalent). Server secrets (`DATABASE_URL`, `*_SECRET`, `AI_API_KEY`) must stay server-side — never `NEXT_PUBLIC_`, never in logs, exports, or AI context.

## Project structure

Framework conventions apply; domain module boundaries (projects, discovery, decisions,
knowledge, specifications, validation, readiness, tasks, AI, exports) land in TASK-002
per `docs/architecture.md` §62.
