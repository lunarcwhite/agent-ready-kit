# Agent Ready Kit — SaaS Screen Blueprint v1.0

> Authority note (per spec-decisions.md D-00): this file is a
> supplementary UI illustration. If it conflicts with `design.md`,
> `PRD.md`, `tasks.md`, or `database-schema.md`, those documents win.
> Lifecycle, readiness dimensions, severity, and navigation follow the
> canonical definitions. `TASK-xxx` codes in this file are illustrative
> target-project examples in the `UTASK-xxx` namespace (per D-A10b).

## 0. Design Direction

### Core UX principle

User datang dengan:

> "Saya punya ide aplikasi."

Dan keluar dengan:

> "Saya punya project yang siap diberikan kepada AI coding agent."

User tidak perlu memahami:
- Project Knowledge Graph
- Decision Graph
- Specification Engine
- Consistency Engine

Semua kompleksitas tersebut berada di belakang UI.

### Primary navigation

Marketing:

- Home
- How it works
- Pricing
- Sign in
- Get started

Authenticated application:

- Projects
- Settings
- Account

Inside project (canonical navigation, per design.md §13):

- Overview
- Discovery
- Decisions
- Specification (Product, Architecture, Data, Design, AI)
- Issues
- Tasks
- Readiness
- Agent Kit (Export)

---

# 1. Landing Page

## Purpose

Menjelaskan value proposition dalam kurang dari satu menit dan membawa user ke Create Project.

## Hero

Headline:

> Build software your AI agent can actually understand.

Subheadline:

> Turn an idea into a structured, validated, implementation-ready project for AI coding agents.

Primary CTA:

> Start Building

Secondary CTA:

> See How It Works

## Visual

Tampilkan alur:

```text
Your Idea
    ↓
Discovery
    ↓
Specification
    ↓
Validation
    ↓
Agent-Ready Kit
    ↓
AI Coding Agent
```

Jangan menampilkan dashboard yang terlalu kompleks pada hero.

## Section: Problem

Headline:

> AI coding agents are powerful. Ambiguous requirements aren't.

Tiga masalah:

- Missing requirements
- Conflicting specifications
- Too many assumptions

## Section: How It Works

Tiga tahap:

### 01. Explain your idea

Talk with an AI product architect.

### 02. Make decisions

Resolve product and technical decisions.

### 03. Export

Get an implementation-ready Agent Kit.

## Section: Output

Visualisasi:

```text
my-project/
├── AGENTS.md
├── context.md
└── docs/
    ├── PRD.md
    ├── architecture.md
    ├── database-schema.md
    ├── design.md
    ├── agents.md
    ├── soul.md
    └── tasks.md
```

## CTA

> Ready to build?

[ Start Your Project ]

---

# 2. Sign Up / Sign In

## Purpose

Login sesederhana mungkin.

MVP:

- Email
- Password
- Google OAuth

Setelah login:

```text
No projects yet

Let's turn your first idea into an
Agent Ready project.

[ Create Project ]
```

---

# 3. Projects Dashboard

Route:

`/projects`

## Layout

```text
┌─────────────────────────────────────────────────────┐
│ Agent Ready Kit                    Account ▾        │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Your Projects                         [ + New ]     │
│                                                     │
│ ┌───────────────────────────────────────────────┐   │
│ │ InvoiceFlow                                  │   │
│ │ Invoice management for freelancers           │   │
│ │                                               │   │
│ │ Readiness 78%      24 tasks      Updated 2h  │   │
│ │ ███████████████░░░                           │   │
│ └───────────────────────────────────────────────┘   │
│                                                     │
│ ┌───────────────────────────────────────────────┐   │
│ │ StoryForge                                   │   │
│ │ AI-assisted novel writing                    │   │
│ │                                               │   │
│ │ Readiness 42%      Discovery in progress     │   │
│ └───────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Project card states

### Discovery

```text
Discovery in progress
```

### Draft

```text
Draft in progress
```

### Needs Review

```text
3 issues need attention
```

### Implementation Ready

```text
Implementation Ready ✓
```

(Card states mirror the canonical lifecycle:
DISCOVERY, DRAFT, NEEDS REVIEW, IMPLEMENTATION READY.)

---

# 4. Create Project

Route:

`/projects/new`

## Screen

```text
Create your project

What are you building?

┌──────────────────────────────────────────────────┐
│ I want to build...                               │
│                                                  │
│                                                  │
└──────────────────────────────────────────────────┘

Project name
[ ______________________________ ]

Optional

Target users
[ ______________________________ ]

[ Start Discovery ]
```

## Important UX

Jangan tampilkan:

- Tech stack
- Database
- Architecture
- Authentication
- API

di sini.

Semua itu akan muncul secara kontekstual selama Discovery.

## Empty state

Placeholder:

> "Example: A SaaS that helps freelancers create invoices, track payments, and manage clients."

---

# 5. Discovery Workspace

Route:

`/projects/:id/discovery`

Ini adalah screen paling penting dalam MVP.

## Layout

```text
┌──────────────────────────────────────────────────────────┐
│ InvoiceFlow                         Understanding 46%    │
├───────────────────────┬──────────────────────────────────┤
│                       │                                  │
│ AI Architect          │ Project Understanding           │
│                       │                                  │
│ ┌───────────────────┐ │ Product                          │
│ │ AI message        │ │ ✓ Goal                           │
│ └───────────────────┘ │ ✓ Target users                  │
│                       │                                  │
│ ┌───────────────────┐ │ Features                         │
│ │ User message      │ │ ✓ Invoice management             │
│ └───────────────────┘ │ ✓ Client management              │
│                       │ ○ Payment tracking               │
│                       │                                  │
│ ┌───────────────────┐ │ Decisions                        │
│ │ AI question       │ │ ⚠ Authentication                 │
│ └───────────────────┘ │ ⚠ Payment provider               │
│                       │                                  │
│ [ Type message... ]   │ Data                             │
│                       │ ○ Entities                       │
│                       │                                  │
└───────────────────────┴──────────────────────────────────┘
```

## Chat behavior

AI harus:

1. Memahami jawaban.
2. Meng-update Project Knowledge.
3. Mengidentifikasi gap.
4. Menentukan pertanyaan berikutnya.
5. Menghindari pertanyaan yang sudah terjawab.

## AI response types

### Normal question

> Who are the primary users?

### Confirmation

> I understand that freelancers can create and send invoices. Is that correct?

### Recommendation

> I recommend using Stripe for subscription billing because...

### Decision

```text
Authentication

Which approach should we use?

○ Email + password
○ Google OAuth
○ Email + Google
○ Other
```

### Warning

> This decision affects the authentication architecture and user model.

---

# 6. Discovery Progress Panel

Progress bukan berdasarkan jumlah chat.

Gunakan knowledge coverage.

Panel ini mengukur cakupan Discovery (pemahaman per area),
bukan dimensi readiness. Dimensi readiness kanonis berjumlah 8
(Product, Features, Business Rules, Data, UX, Architecture,
Security, Execution) — lihat PRD §21.

```text
Project Understanding

Product        ✓ 100%
Users          ✓ 100%
Features       ████████░░ 80%
Business Rules ██████░░░░ 60%
UX             █████░░░░░ 50%
Technical      ████░░░░░░ 40%
Security       ███░░░░░░░ 30%
```

Di bawahnya:

```text
12 decisions resolved
4 decisions unresolved
2 important questions remaining
```

---

# 7. Discovery Completion

Ketika AI merasa informasi cukup:

```text
We have enough information to build
your first project specification.

Project understanding: 87%

✓ Product
✓ Users
✓ Core features
✓ Business model
✓ Authentication
✓ Core data

2 decisions remain optional.

[ Review Decisions ]

[ Generate Specification ]
```

Jangan memaksa 100%.

Beberapa keputusan memang dapat:

> Deferred

---

# 8. Project Overview

Route:

`/projects/:id`

Ini adalah home screen setelah Discovery.

```text
┌─────────────────────────────────────────────────────────┐
│ InvoiceFlow                             78% Ready      │
├───────────────┬─────────────────────────────────────────┤
│               │                                         │
│ Overview      │ Project Overview                        │
│ Discovery     │                                         │
│ Decisions     │ Invoice management SaaS for freelancers│
│               │                                         │
│ SPECIFICATION │ Core Features                           │
│ PRD           │ • Invoices                              │
│ Architecture  │ • Clients                               │
│ Database      │ • Payments                              │
│ Design        │                                         │
│ Agents        │ ─────────────────────────────────────── │
│ Soul          │                                         │
│               │ Readiness                                │
│ VALIDATE      │ ███████████████░░░ 78%                  │
│ Issues        │                                         │
│ Readiness     │ 3 issues require attention              │
│               │                                         │
│ EXECUTION     │ [ Review Issues ]                       │
│ Tasks         │                                         │
│               │ [ Continue ]                             │
│ EXPORT        │                                         │
│ Agent Kit     │                                          │
└───────────────┴─────────────────────────────────────────┘
```

---

# 9. Decisions Screen

Route:

`/projects/:id/decisions`

Ini menjadi pusat semua keputusan eksplisit.

## Categories

```text
Product
Business
UX
Technical
Data
Security
AI
```

## Decision card

```text
Authentication Provider

Decision:
Supabase Auth

Status:
Resolved ✓

Reason:
Simple authentication and OAuth support.

Affected:
Architecture
Database
Design
Tasks

[ Edit ]
```

## Unresolved

```text
Payment Provider

Status:
Needs decision

Why it matters:
Billing architecture depends on this choice.

[ Resolve ]
```

---

# 10. Specification Workspace

Route:

`/projects/:id/specification`

## Layout

```text
┌──────────────────────────────────────────────────────────┐
│ Specification                              All synced ✓ │
├──────────────┬───────────────────────────────────────────┤
│              │                                           │
│ PRD          │ # Product Requirements                    │
│ Architecture │                                           │
│ Database     │ Product Overview                           │
│ Design       │                                           │
│ Agents       │ InvoiceFlow helps freelancers...         │
│ Soul         │                                           │
│              │ Target Users                              │
│              │                                           │
│              │ Freelancers...                            │
│              │                                           │
│              │ Core Features                             │
│              │                                           │
│              │ 1. Invoice management                     │
│              │ 2. Client management                      │
│              │ 3. Payment tracking                      │
│              │                                           │
│              │ [ Edit ] [ Ask AI ] [ Regenerate ]       │
└──────────────┴───────────────────────────────────────────┘
```

## Important

Jangan membuat user merasa sedang menggunakan Google Docs.

Editor boleh ada, tetapi focus utama:

**review → understand → resolve → approve**

bukan:

**write everything manually.**

---

# 11. Specification Status

Setiap dokumen memiliki status.

```text
PRD
✓ Complete

Architecture
✓ Complete

Database
⚠ 2 issues

Design
✓ Complete

Agents
✓ Complete

Soul
✓ Complete
```

Klik issue membuka konteks.

---

# 12. Contextual AI Assistant

Setiap specification screen memiliki AI assistant.

Contoh user di `database-schema.md`:

> Why do we need subscriptions?

AI:

> The `subscriptions` entity is required by the subscription billing requirement in PRD section 4. It is also referenced by TASK-018.

Actions:

```text
[ View PRD ]
[ View Task ]
[ Change Decision ]
```

Jadi dokumen saling terhubung.

---

# 13. Validation / Readiness

Route:

`/projects/:id/readiness`

## Hero

```text
Agent Readiness

78%

Your project is not ready yet.

3 critical issues
5 warnings
12 checks passed
```

## Categories

Canonical readiness dimensions (8, per PRD §21):

```text
Product
██████████ 100%

Features
█████████░ 90%

Business Rules
████████░░ 80%

Data
██████████ 100%

UX
███████░░░ 70%

Architecture
████████░░ 80%

Security
██████░░░░ 60%

Execution
███████░░░ 70%
```

## Issue list

```text
BLOCKER

ISSUE-001
Payment provider undefined

Referenced by:
PRD
Architecture
Tasks

[ Resolve ]


ISSUE-002
Invoice deletion behavior undefined

[ Resolve ]


MEDIUM

ISSUE-003
Feature "Payment tracking" has no implementation task.

[ Fix ]
```

(Severity uses the canonical scale: BLOCKER, HIGH, MEDIUM, LOW, INFO.
Issue codes use `ISSUE-xxx`; assumption codes use `ASM-xxx`.)

---

# 14. Conflict Resolution Modal

Ketika user klik Resolve:

```text
Specification Conflict

Authentication

PRD:
Email + Google OAuth

Architecture:
Google OAuth only

Which behavior should the project use?

○ Email + Google OAuth
○ Google OAuth only
○ Other

[ Apply Decision ]
```

Setelah apply:

```text
Updating project...

✓ Project Knowledge
✓ PRD
✓ Architecture
✓ Design
✓ Tasks

Conflict resolved.
```

---

# 15. Tasks Screen

Route:

`/projects/:id/tasks`

## Overview

```text
Implementation Plan

7 Milestones
38 Tasks
14 Dependencies

Progress:
0 / 38
```

## Milestone

```text
01 — Foundation

TASK-001  Initialize project
TASK-002  Configure database
TASK-003  Configure authentication
TASK-004  Create user profile

02 — Invoice Management

TASK-005  Invoice data model
TASK-006  Invoice API
TASK-007  Invoice UI
TASK-008  Invoice validation
```

## Task detail

```text
TASK-007

Create Invoice UI

Status:
Pending

Depends on:
TASK-005
TASK-006

Requirements:
- User can create invoice
- Currency is required
- Client is required

Acceptance Criteria:

[ ] Invoice form renders
[ ] Validation works
[ ] Successful submission creates invoice
[ ] Error states are handled

Definition of Done:

[ ] Implementation complete
[ ] Tests pass
[ ] Lint passes

[ Edit Task ]
```

---

# 16. Task Dependency View

Tambahkan optional graph view:

```text
TASK-001
   ↓
TASK-002
   ↓
TASK-003
   ↓
TASK-004
   ├────────→ TASK-005
   │             ↓
   └────────→ TASK-006
                 ↓
              TASK-007
```

Ini sangat membantu user memahami execution plan.

---

# 17. Final Readiness Gate

Sebelum export:

```text
Agent Ready

Your project has passed the readiness checks.

Product             ✓
Requirements        ✓
Architecture        ✓
Database            ✓
Design              ✓
AI Instructions     ✓
Tasks               ✓
Consistency         ✓

Critical issues     0
Unresolved decisions 0
Orphan requirements 0

────────────────────────

38 implementation tasks
7 milestones

[ Generate Agent Kit ]
```

Kalau belum ready:

```text
Not ready yet

2 critical issues must be resolved
before generating an Agent Ready Kit.

[ Review Issues ]
```

---

# 18. Export Configuration

Route:

`/projects/:id/export`

## Step 1 — Target

```text
Where will this project be used?

● Generic AI Agent
○ Codex
○ Claude Code
○ Cursor
○ Gemini CLI
```

MVP dapat hanya mengaktifkan Generic.

## Step 2 — Project mode

```text
Project type

● New project
○ Existing project
```

Existing project dapat disabled dengan label:

> Coming soon

## Step 3 — Content

```text
Include

☑ AGENTS.md
☑ context.md
☑ PRD.md
☑ architecture.md
☑ database-schema.md
☑ design.md
☑ agents.md
☑ soul.md
☑ tasks.md
☑ manifest.json
```

Default semuanya terpilih.

---

# 19. Generate Screen

Setelah user klik Generate:

```text
Preparing your Agent Kit

✓ Preparing project context
✓ Building AGENTS.md
✓ Generating PRD.md
✓ Generating architecture.md
✓ Generating database-schema.md
✓ Generating design.md
✓ Generating agents.md
✓ Generating soul.md
✓ Generating tasks.md
✓ Validating references
✓ Building manifest
✓ Packaging project

Agent Kit ready.
```

Progress harus benar-benar merefleksikan pekerjaan yang dilakukan, bukan fake progress.

---

# 20. Export Complete

Ini harus menjadi completion screen yang sangat sederhana.

```text
┌─────────────────────────────────────────────┐
│                                             │
│                 ✓                           │
│                                             │
│          Your project is Agent Ready        │
│                                             │
│              InvoiceFlow                    │
│                                             │
│        38 tasks · 7 milestones              │
│        0 critical issues                    │
│                                             │
│       [ Download Agent Kit ]                │
│                                             │
│       [ View AGENTS.md ]                    │
│                                             │
│       [ Back to Project ]                   │
│                                             │
└─────────────────────────────────────────────┘
```

---

# 21. Downloaded ZIP

Final output:

```text
invoiceflow-agent-kit.zip
```

Isi:

```text
invoiceflow/
│
├── README.md
├── AGENTS.md
├── context.md
│
├── docs/
│   ├── PRD.md
│   ├── architecture.md
│   ├── database-schema.md
│   ├── design.md
│   ├── agents.md
│   ├── soul.md
│   └── tasks.md
│
└── .agent-ready/
    └── manifest.json
```

---

# 22. README.md

README harus langsung menjelaskan kepada coding agent apa yang harus dilakukan.

Struktur:

```text
# InvoiceFlow

This project was generated by Agent Ready Kit.

## Start Here

Read:

1. AGENTS.md
2. context.md
3. docs/PRD.md
4. docs/architecture.md
5. docs/tasks.md

## Implementation

Start with TASK-001.

Follow task dependencies.

Do not implement tasks out of order unless explicitly allowed.

## Source of Truth

Product:
docs/PRD.md

Architecture:
docs/architecture.md

Database:
docs/database-schema.md

Design:
docs/design.md

Execution:
docs/tasks.md
```

---

# 23. AGENTS.md

Ini adalah file paling penting untuk coding agent.

Contoh struktur:

```text
# Agent Instructions

## Project

InvoiceFlow

## Objective

Implement the software described in this Agent Ready Kit.

## Read First

- context.md
- docs/PRD.md
- docs/architecture.md
- docs/database-schema.md
- docs/design.md
- docs/tasks.md

## Rules

1. Follow the documented architecture.
2. Do not invent undocumented business rules.
3. If a requirement is ambiguous, inspect project documentation first.
4. Do not modify core architecture without justification.
5. Keep implementation aligned with the task specification.
6. Do not mark a task complete before acceptance criteria pass.

## Task Execution

Start with the first uncompleted task whose dependencies are satisfied.

## Definition of Done

...
```

---

# 24. Global Navigation

Desktop:

```text
┌──────────────────────────────────────────────┐
│ Logo       Projects              Account ▾   │
└──────────────────────────────────────────────┘
```

Inside project:

```text
┌──────────────────────────────────────────────┐
│ ← Projects    InvoiceFlow        78% Ready  │
├──────────────────────────────────────────────┤
│ Overview                                     │
│ Discovery                                    │
│ Decisions                                    │
│                                              │
│ SPECIFICATION                                │
│ PRD                                          │
│ Architecture                                 │
│ Database                                     │
│ Design                                       │
│ Agents                                       │
│ Soul                                         │
│                                              │
│ VALIDATE                                     │
│ Issues                                       │
│ Readiness                                    │
│                                              │
│ EXECUTION                                    │
│ Tasks                                        │
│                                              │
│ EXPORT                                       │
│ Agent Kit                                    │
└──────────────────────────────────────────────┘
```

---

# 25. Global States

Setiap screen harus memiliki minimal 5 state.

### Loading

```text
Generating your specification...
```

### Empty

```text
Nothing here yet.
Complete Discovery to generate this section.
```

### Success

```text
Saved ✓
```

### Warning

```text
This section may be affected by an unresolved decision.
```

### Error

```text
We couldn't generate this section.

[ Retry ]
```

---

# 26. AI Interaction Pattern

Hindari terlalu banyak chatbot.

AI muncul dalam tiga bentuk:

### 1. Discovery Agent

Percakapan utama.

### 2. Contextual Assistant

Membantu memahami/mengubah specification.

### 3. Resolution Assistant

Membantu menyelesaikan conflict atau missing information.

Jangan membuat:

> "AI Chat" 

sebagai fitur terpisah yang tidak jelas tujuannya.

AI selalu **context-aware**.

---

# 27. Mobile Strategy

MVP harus responsive, tetapi pengalaman utama adalah desktop.

Mobile digunakan untuk:

- melihat project;
- melihat readiness;
- membaca specification;
- menjawab decision;
- melihat task.

Discovery di mobile:

```text
Chat
+
collapsible Project Understanding
```

Jangan memaksakan dua-column desktop layout ke layar mobile.

---

# 28. MVP Screen List

Jadi MVP sebenarnya membutuhkan sekitar **13 screen utama**:

```text
PUBLIC
01. Landing
02. Sign In
03. Sign Up

APP
04. Projects Dashboard
05. Create Project

PROJECT
06. Discovery
07. Overview
08. Decisions
09. Specification
10. Tasks
11. Readiness
12. Export Configuration
13. Export Complete
```

Beberapa screen seperti conflict resolution dan task detail cukup menjadi modal/drawer.

---

# 29. Screen Hierarchy

```text
Landing
│
├── Sign Up
│
└── Sign In
      │
      ▼
Projects
│
└── Create Project
      │
      ▼
Discovery
      │
      ▼
Project
│
├── Overview
├── Discovery
├── Decisions
│
├── Specification
│   ├── PRD
│   ├── Architecture
│   ├── Database
│   ├── Design
│   ├── Agents
│   └── Soul
│
├── Tasks
├── Readiness
│
└── Export
      │
      ▼
Export Complete
      │
      ▼
Agent Ready Kit ZIP
```

---

# 30. Critical UX Rule

Ada satu rule yang harus menjadi constraint untuk seluruh UI:

> **Never make the user maintain the same information twice.**

Contoh buruk:

User sudah mengatakan:

> "Payment menggunakan Stripe."

Kemudian di Architecture screen kita meminta:

> "Choose payment provider."

Tidak boleh.

Sistem sudah tahu:

```text
payment_provider = Stripe
```

Maka Architecture otomatis menggunakan keputusan tersebut.

Jika user mengubahnya, kita melakukan **impact analysis**, bukan meminta input ulang.

---

# 31. The "Magic Moment"

Saya ingin ada satu pengalaman yang terasa sangat kuat.

User awalnya hanya menulis:

> "Saya ingin membuat SaaS invoice untuk freelancer."

Beberapa menit kemudian sistem menampilkan:

```text
Your project is taking shape.

Product
✓ Defined

Users
✓ Defined

Features
✓ Defined

Business rules
✓ Defined

Architecture
✓ Defined

Database
✓ Defined

Implementation plan
✓ 38 tasks

Conflicts
✓ 0

Agent readiness
✓ READY
```

Kemudian:

> **"Your coding agent now has enough context to start building."**

[ Generate Agent Kit ]

Itulah moment yang harus kita optimalkan.