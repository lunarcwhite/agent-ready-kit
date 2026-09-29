# Agent Ready Kit

## System Architecture

**Document:** architecture.md  
**Status:** Draft v1  
**Product:** Agent Ready Kit  
**Architecture Style:** Modular Monolith  
**Primary Interface:** Web SaaS  
**Primary Workload:** AI-assisted project specification and compilation

---

# 1. Architecture Goals

The architecture must support the primary Agent Ready Kit pipeline:

```text id="3j0j1x"
Idea
  ↓
Discovery
  ↓
Decisions
  ↓
Project Knowledge
  ↓
Specifications
  ↓
Validation
  ↓
Readiness
  ↓
Task Planning
  ↓
Agent Kit
```

The architecture must prioritize:

- consistency between project artifacts;
- explicit structured knowledge;
- traceability;
- explainable AI behavior;
- recoverable AI operations;
- controlled specification updates;
- low operational complexity;
- reasonable LLM cost;
- future extensibility.

---

# 2. Architectural Principle

The most important architectural rule is:

> **Markdown documents are compiled artifacts. Structured Project Knowledge is the source of truth.**

The system must never depend on generated Markdown as the primary representation of project state.

Canonical state lives in structured records.

Generated documents are projections of that state.

---

# 3. Architecture Style

The MVP should use a:

> **Modular Monolith**

rather than microservices.

Conceptually:

```text id="49rntn"
┌──────────────────────────────────────────┐
│              Web Application             │
├──────────────────────────────────────────┤
│                                          │
│ Project                                  │
│ Discovery                                │
│ Decisions                                │
│ Knowledge                                │
│ Specifications                           │
│ Validation                               │
│ Readiness                                │
│ Tasks                                    │
│ Export                                   │
│ AI Orchestration                         │
│                                          │
├──────────────────────────────────────────┤
│              PostgreSQL                  │
└──────────────────────────────────────────┘
```

Reasons:

- MVP development speed;
- simple deployment;
- transactional consistency;
- easier debugging;
- fewer infrastructure dependencies;
- lower hosting cost.

Module boundaries should still be explicit so modules can be separated later if scale requires it.

---

# 4. Proposed Technology Stack

The initial recommended stack is:

### Application

**Next.js + TypeScript**

Used for:

- frontend;
- server-side application logic;
- API endpoints;
- authenticated workspace.

### Database

**PostgreSQL**

Used for canonical structured project state.

### ORM

**Drizzle ORM**

Used for:

- typed database access;
- schema migrations;
- relational queries.

### Authentication

Use a managed authentication solution compatible with the deployment environment.

The architecture must isolate authentication behind the application identity layer so the provider can be replaced.

### UI

**React + Tailwind CSS**

with a reusable component system.

### AI

Provider abstraction layer supporting one initial LLM provider while avoiding provider-specific business logic.

### Object Storage

Optional for MVP.

Required later for:

- uploaded references;
- generated archives;
- project assets.

### ZIP Generation

Agent Kits should be generated dynamically from canonical project data and compiled artifacts.

---

# 5. Deployment Model

MVP deployment should remain compatible with inexpensive serverless or managed infrastructure.

Conceptually:

```text id="b8m6gz"
Browser
   │
   ▼
Next.js Application
   │
   ├──────── PostgreSQL
   │
   └──────── LLM Provider
```

Additional infrastructure should only be introduced when justified.

---

# 6. Core Domain Modules

The application should be separated into the following logical modules.

```text id="j1l5jp"
Project
Discovery
Decision
Knowledge
Specification
Validation
Readiness
Task
Agent Kit
AI Orchestration
Identity
```

These are logical boundaries inside the modular monolith.

---

# 7. Project Module

Responsibilities:

- create project;
- update project;
- archive project;
- maintain project lifecycle;
- maintain readiness state;
- coordinate project-level operations.

A project acts as the aggregate root for most product data.

Conceptually:

```text id="vuy6p6"
Project
│
├── Discovery
├── Decisions
├── Knowledge
├── Specifications
├── Issues
├── Tasks
└── Exports
```

---

# 8. Discovery Module

The Discovery module manages the structured interview process.

Responsibilities:

- analyze initial idea;
- maintain discovery state;
- determine unresolved areas;
- generate next questions;
- process answers;
- extract decisions;
- extract knowledge;
- calculate discovery progress.

The module must not treat conversation history as canonical project state.

---

# 9. Discovery Map

Each project maintains a Discovery Map.

Conceptually:

```text id="y0mzvk"
Discovery Map

Product
├── problem
├── goals
├── users
└── scope

Features
├── core
├── workflows
└── business rules

Access
├── authentication
├── roles
└── permissions

Data
├── entities
├── relationships
└── lifecycle

UX
Technical
Integrations
AI
Non-functional
```

Each node can have a state such as:

```text id="rluq3u"
UNKNOWN
PARTIAL
RESOLVED
NOT_APPLICABLE
```

The Discovery Engine uses this map to determine what should be asked next.

---

# 10. Discovery Question Selection

Question selection should be deterministic where possible and AI-assisted where useful.

Conceptually:

```text id="dl9ypf"
candidate topics
      ↓
dependency filtering
      ↓
remove resolved topics
      ↓
impact prioritization
      ↓
LLM question formulation
      ↓
next discovery question
```

The LLM should primarily formulate natural questions and interpret answers.

It should not independently control the entire discovery state machine.

---

# 11. Decision Module

The Decision module stores explicit project decisions.

A Decision should contain concepts such as:

```text id="a4ohk4"
id
project_id
decision_key
category
title
value
rationale
status
impact
source
confidence
version
```

Example:

```text id="f7nyr5"
decision_key:
authentication.required

value:
true

status:
CONFIRMED

source:
USER

impact:
HIGH
```

---

# 12. Decision Graph

Dependencies between decisions should be represented explicitly.

Example:

```text id="is6tzw"
authentication.required
        │
        ├── true
        │     ↓
        │ authentication.methods
        │
        └── false
              ↓
          auth subtree
          NOT_APPLICABLE
```

The graph enables:

- conditional discovery;
- impact analysis;
- validation;
- question prioritization.

For MVP, graph relationships can remain relational records rather than requiring a graph database.

PostgreSQL is sufficient.

---

# 13. Knowledge Module

Project Knowledge represents normalized understanding derived from confirmed information.

Knowledge must be separated from raw conversation.

Example conceptual structure:

```text id="6oh8km"
Project Knowledge

product
users
features
business_rules
access
data
ux
technical
integrations
ai
non_functional
```

Knowledge entries should retain provenance.

Example:

```text id="m8z8zo"
knowledge:
Users require persistent private workspaces.

sources:
DEC-AUTH-001
DEC-USER-003

confidence:
CONFIRMED
```

---

# 14. Knowledge Representation

Do not store the entire Project Knowledge only as one giant JSON document.

Use a hybrid approach:

### Relational records

For:

- decisions;
- requirements;
- entities;
- relationships;
- tasks;
- issues;
- traceability.

### JSON/JSONB

For:

- flexible structured content;
- AI extraction payloads;
- metadata;
- configuration;
- less rigid domain details.

This provides flexibility without losing queryability.

---

# 15. Conversation Storage

Discovery conversations should be stored separately.

Conceptually:

```text id="s82p4x"
Discovery Session
      │
      ├── User Message
      ├── Assistant Message
      ├── User Message
      └── Assistant Message
```

Conversation is evidence and interaction history.

It is not the authoritative project specification.

---

# 16. Answer Processing Pipeline

When a user answers a Discovery question:

```text id="w9j1h8"
User Answer
     ↓
AI Extraction
     ↓
Structured Candidate Changes
     ↓
Schema Validation
     ↓
Decision Rules
     ↓
Knowledge Update
     ↓
Discovery Map Update
     ↓
Impact Detection
```

The LLM must return structured output.

Free-form AI output should not directly mutate canonical project state.

---

# 17. Structured AI Output

AI operations that modify project state should return validated structured data.

Example conceptual payload:

```json id="1esidj"
{
  "decisions": [
    {
      "key": "authentication.required",
      "value": true,
      "confidence": "explicit"
    }
  ],
  "knowledge": [],
  "assumptions": [],
  "unresolved": []
}
```

The application validates this structure before applying it.

---

# 18. AI Orchestration Layer

All LLM calls should pass through a centralized AI orchestration layer.

```text id="ofc8nd"
Application Modules
        │
        ▼
AI Orchestrator
        │
        ├── Prompt Registry
        ├── Context Builder
        ├── Structured Output Validator
        ├── Provider Adapter
        ├── Usage Tracker
        └── Retry Policy
                │
                ▼
            LLM Provider
```

Business modules should not directly call provider SDKs.

---

# 19. AI Provider Interface

Conceptual interface:

```text id="aqn7rb"
AIProvider

generateStructured()
generateText()
streamText()
```

This allows future providers to be added without rewriting product logic.

MVP should begin with one provider.

---

# 20. Prompt Registry

Prompts should be versioned and centrally managed.

Examples:

```text id="hgnvyf"
discovery.idea-analysis.v1
discovery.extract-answer.v1
discovery.generate-question.v1

specification.prd.v1
specification.architecture.v1
specification.database.v1
specification.design.v1

validation.consistency.v1
validation.assumption.v1

task.plan.v1
```

Generated content should retain the prompt version used where useful.

This improves reproducibility and debugging.

---

# 21. Context Builder

Never send the entire project history to every LLM call.

The Context Builder determines the smallest useful context.

Example:

For a database specification request:

```text id="7rmny3"
Include:

relevant requirements
business rules
entities
relationships
ownership rules
technical constraints

Exclude:

irrelevant design copy
full conversation history
unrelated decisions
```

This is important for:

- token cost;
- latency;
- output quality.

---

# 22. Context Layers

LLM context should conceptually have four layers:

```text id="e6ghp5"
SYSTEM
Agent Ready Kit operating rules

TASK
What this AI call must accomplish

PROJECT CONTEXT
Relevant canonical knowledge

LOCAL CONTEXT
Specific requirement/question/document section
```

This prevents large uncontrolled prompts.

---

# 23. Specification Module

Specifications should be represented internally as structured specification sections.

Example:

```text id="o22k9n"
Specification

type:
PRD

sections:
- overview
- users
- goals
- requirements
- constraints
```

The rendered Markdown is generated from those sections.

This allows selective updates rather than complete document regeneration.

---

# 24. Specification Compilation

Conceptually:

```text id="0y55gj"
Project Knowledge
      ↓
Relevant Knowledge Selector
      ↓
Specification Compiler
      ↓
Structured Sections
      ↓
Markdown Renderer
```

The LLM may assist in transforming knowledge into readable prose.

The system retains structure.

---

# 25. Incremental Compilation

Changing one decision should not require regenerating every document.

Example:

```text id="yudr23"
Authentication provider changed
          ↓
Dependency Graph
          ↓
Affected sections

architecture.authentication
design.login
tasks.authentication
          ↓
Generate Proposed Patch
```

This is preferable to regenerating entire documents.

---

# 26. Specification Versioning

Every meaningful specification update should create a version.

Conceptually:

```text id="r0d13i"
PRD
v1
v2
v3
```

Versions allow:

- diff;
- rollback;
- change review;
- impact analysis.

MVP does not need Git-level complexity.

Simple version snapshots are sufficient.

---

# 27. Proposed Change Model

AI-generated modifications should first become Proposed Changes.

```text id="k3y1x9"
Canonical Specification
        │
        │ project change
        ▼
Impact Analysis
        ↓
Proposed Change
        ↓
User Review
      /     \
 Accept    Reject
   ↓
New Version
```

This enforces human control.

---

# 28. Traceability Module

Relationships between specification elements should be explicitly stored.

Conceptually:

```text id="izakll"
FR-023
│
├── implemented_by → ARC-004
├── uses → ENT-003
├── represented_by → SCREEN-008
└── executed_by → TASK-031
```

Do not attempt to reconstruct all traceability by repeatedly asking the LLM.

Persist discovered relationships.

---

# 29. Validation Engine

Validation should use two mechanisms.

## Deterministic Validation

Examples:

```text id="lcb7qw"
Requirement has no task
Entity has no requirement
Confirmed decision missing required dependent decision
BLOCKER issue unresolved
```

These should be implemented with application rules.

## AI-Assisted Validation

Examples:

```text id="ymkkqs"
PRD meaning contradicts design behavior

Business rule appears inconsistent with workflow

Requirement contains meaningful ambiguity
```

Use LLM reasoning where semantic understanding is required.

---

# 30. Validation Pipeline

```text id="26mzpc"
Canonical State
      ↓
Deterministic Validators
      ↓
Semantic Validators
      ↓
Issue Normalizer
      ↓
Validation Issues
```

Validation findings become persisted records.

---

# 31. Issue Model

Conceptually:

```text id="i86ktz"
Issue

id
project_id
type
severity
title
description
source_refs
affected_refs
status
resolution
```

Status may include:

```text id="9spzav"
OPEN
RESOLVED
IGNORED
```

Ignoring significant issues should retain an audit record.

---

# 32. Assumption Engine

Assumptions should be first-class records rather than buried inside AI prose.

Conceptually:

```text id="m9dy4g"
Assumption

File storage strategy:
Object storage

Confidence:
MEDIUM

Impact:
HIGH

Affected:
FR-019
ARC-006
TASK-028
```

User resolution:

```text id="dx78dp"
Confirm
Replace
Defer
Reject
```

Confirmed assumptions become decisions/knowledge.

---

# 33. Readiness Engine

Readiness combines deterministic project state.

Conceptually:

```text id="thdmmf"
Readiness

Product
Features
Business Rules
Data
UX
Architecture
Security
Execution
```

The score should be calculated by application rules.

The LLM may identify issues but should not arbitrarily assign the final readiness score.

---

# 34. Readiness Calculation

Conceptually:

```text id="8hffvd"
Dimension Score =
resolved required items
÷
total applicable required items
```

Modifiers may account for issue severity.

Example:

```text id="i8g8l5"
BLOCKER
→ prevents IMPLEMENTATION_READY

HIGH
→ significant readiness penalty

MEDIUM
→ moderate penalty

LOW
→ informational/minor penalty
```

Exact weighting should be configurable rather than hardcoded throughout the application.

---

# 35. Task Module

Tasks are generated from stable specifications.

Task generation input includes:

- requirements;
- architecture;
- database;
- design;
- dependencies;
- acceptance criteria.

Task generation output must be structured.

---

# 36. Task Dependency Graph

Tasks may depend on other tasks.

```text id="5gk4pv"
TASK-001
   ↓
TASK-002
   ↓
TASK-003
   ├──────────┐
   ↓          ↓
TASK-004   TASK-005
   └─────┬────┘
         ↓
      TASK-006
```

The application should detect obvious circular dependencies.

---

# 37. Executable Task Selection

The system should be able to determine:

```text id="g6eox6"
Ready Tasks =
PENDING tasks
whose dependencies are DONE
```

Even if Agent Ready Kit does not execute tasks in MVP, this becomes useful information inside the exported kit.

---

# 38. Agent Kit Module

Agent Kit generation should not directly concatenate arbitrary AI responses.

Pipeline:

```text id="yshhwf"
Canonical State
      ↓
Specification Renderer
      ↓
Execution Context Compiler
      ↓
Target Adapter
      ↓
File Tree
      ↓
ZIP
```

---

# 39. Canonical Generic Kit

```text id="0goydi"
project-name/
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

Optional files should only be generated when relevant.

---

# 40. Agent Adapter Architecture

Adapters transform the canonical kit.

```text id="gytmq3"
Generic Kit
    │
    ├── GenericAdapter
    ├── CodexAdapter
    ├── ClaudeAdapter
    ├── CursorAdapter
    └── FutureAdapter
```

Adapters must not modify canonical product decisions.

They may add:

- agent-specific instructions;
- configuration;
- file placement;
- entry-point guidance.

---

# 41. Manifest

`.agent-ready/manifest.json` should provide machine-readable metadata.

Conceptually:

```json id="3g4g77"
{
  "schemaVersion": "1.0",
  "project": {
    "id": "...",
    "name": "StoryForge"
  },
  "generatedAt": "2026-09-29T00:00:00Z",
  "sourceStateVersion": 28,
  "readiness": {
    "state": "IMPLEMENTATION_READY"
  },
  "artifacts": {
    "prd": "docs/PRD.md",
    "architecture": "docs/architecture.md",
    "database": "docs/database-schema.md",
    "design": "docs/design.md",
    "tasks": "docs/tasks.md"
  },
  "target": "generic"
}
```

(Canonical field set: see tasks.md TASK-103. Field `documents`
renamed to `artifacts`; added `generatedAt` and `sourceStateVersion`.)

The manifest establishes a foundation for future import/sync capabilities.

---

# 42. Export Generation

For MVP, ZIP files should preferably be generated on demand.

Avoid permanently storing archives unless needed.

Conceptually:

```text id="dpdrfh"
Export Request
      ↓
Load Canonical State
      ↓
Compile Latest Approved Specifications
      ↓
Generate Files
      ↓
Generate Manifest
      ↓
ZIP
      ↓
Download
```

This reduces unnecessary storage.

---

# 43. Background Jobs

Not every operation should block an HTTP request.

Potential asynchronous operations:

- large specification generation;
- complete validation;
- task-plan generation;
- large export compilation.

MVP may initially use platform-supported background execution.

Introduce dedicated queue infrastructure only when required.

---

# 44. AI Operation Model

Every significant LLM operation should be tracked.

Conceptually:

```text id="03knor"
AI Operation

type
project
provider
model
prompt_version
input_tokens
output_tokens
estimated_cost
latency
status
error
```

This is essential for SaaS economics.

---

# 45. LLM Cost Control

The system must actively control AI cost.

Strategies:

### Context Selection

Never send unnecessary full project context.

### Structured State

Use canonical structured knowledge instead of replaying entire conversations.

### Incremental Generation

Regenerate only affected sections.

### Cheap Operations First

Use deterministic rules before invoking an LLM.

### Model Routing

Architecture should allow simpler operations to use lower-cost models where appropriate.

### Caching

Stable generated outputs may be reused until their dependencies change.

### Usage Limits

Plans may enforce generation or token allowances.

---

# 46. Dependency Fingerprints

Compiled sections may store a fingerprint of their inputs.

Example:

```text id="a8i1hz"
architecture.authentication

depends on:

DEC-AUTH-001
DEC-AUTH-002
FR-004
FR-005
```

If none change:

```text id="njm9fx"
No regeneration required.
```

This can substantially reduce AI calls.

---

# 47. Staleness Detection

When underlying knowledge changes:

```text id="tfbjgx"
Knowledge Changed
      ↓
Dependency Lookup
      ↓
Affected Specification Sections
      ↓
Mark STALE
```

Example UI:

```text id="6e0cny"
Architecture

⚠ 2 sections need review
```

This is preferable to silently regenerating content.

---

# 48. Specification Status

A specification section may have:

```text id="ijvkll"
CURRENT
STALE
PROPOSED
REVIEW_REQUIRED
```

This provides granular update control.

---

# 49. Transaction Boundaries

Operations that modify canonical state should be transactional where practical.

For example:

```text id="8xg8h3"
Confirm Decision

transaction:

update decision
update dependent decision states
update knowledge
mark specifications stale
create impact records
```

The project should not end in a partially updated state.

---

# 50. Idempotency

AI operations that may retry should use operation identifiers.

Retries must avoid accidentally creating:

- duplicate decisions;
- duplicate requirements;
- duplicate tasks;
- duplicate issues.

---

# 51. Security Architecture

MVP must enforce project ownership.

Every project-scoped operation must verify that the authenticated user can access the project.

Never trust a client-provided project ID without authorization checks.

---

# 52. Sensitive Data

Users may accidentally include sensitive information during discovery.

The system should:

- minimize unnecessary logging of raw prompts;
- avoid exposing project context across accounts;
- isolate project data;
- avoid including internal system prompts in exports.

---

# 53. AI Security Boundary

LLM output is untrusted input.

Therefore:

```text id="m5r9bk"
LLM Output
   ↓
Schema Validation
   ↓
Business Rule Validation
   ↓
Application
```

Never allow arbitrary model output to directly execute application code or database commands.

---

# 54. Rate Limiting

Rate limits should exist for expensive operations such as:

- discovery messages;
- specification generation;
- validation;
- task generation;
- export regeneration.

Limits may later depend on subscription tier.

---

# 55. Observability

At minimum, the system should record:

- application errors;
- AI operation failures;
- generation latency;
- token usage;
- estimated AI cost;
- validation failures;
- export failures.

Do not depend solely on raw text logs for operational analysis.

---

# 56. Failure Recovery

AI generation can fail.

Operations should therefore support:

```text id="ur5glf"
PENDING
RUNNING
SUCCEEDED
FAILED
```

Failed operations should be retryable.

Existing approved project state must remain intact after generation failure.

---

# 57. Optimistic User Experience

Long-running generation should not lock the entire workspace.

For example:

```text id="14fx4c"
Generating architecture...

You can continue reviewing decisions.
```

Where platform constraints permit, generation should happen asynchronously.

---

# 58. Versioning Strategy

Several concepts need separate versions.

### Project State Version

Changes when canonical project state changes.

### Specification Version

Changes when an approved specification changes.

### Prompt Version

Changes when internal generation instructions change.

### Agent Kit Schema Version

Changes when export format changes.

These versions should not be conflated.

---

# 59. Internal Event Model

The modular monolith can use application-level domain events.

Examples:

```text id="t1b4fm"
DecisionConfirmed
DecisionChanged
KnowledgeUpdated
SpecificationStale
SpecificationApproved
ValidationCompleted
ProjectReady
TaskPlanGenerated
```

Initially these can be synchronous internal events.

No message broker is required for MVP.

---

# 60. Change Propagation

Example:

```text id="k0p7ak"
DecisionChanged
authentication.provider

       ↓

KnowledgeUpdater

       ↓

KnowledgeUpdated

       ↓

ImpactAnalyzer

       ↓

architecture.authentication → STALE
design.login → STALE
TASK-012 → REVIEW_REQUIRED

       ↓

Validation Engine

       ↓

New Issues if required
```

This is the core mechanism that keeps the project coherent.

---

# 61. Suggested Application Layering

Conceptually:

```text id="r9m68g"
UI
│
├── Server Actions / API
│
├── Application Services
│
├── Domain Modules
│
├── Repositories
│
└── Infrastructure
    ├── Database
    ├── AI Providers
    ├── Authentication
    └── Storage
```

Domain logic should not live primarily inside UI components.

---

# 62. Suggested Source Organization

Exact structure can evolve, but conceptually:

```text id="yd6jx3"
src/
│
├── app/
│
├── modules/
│   ├── projects/
│   ├── discovery/
│   ├── decisions/
│   ├── knowledge/
│   ├── specifications/
│   ├── validation/
│   ├── readiness/
│   ├── tasks/
│   └── agent-kit/
│
├── ai/
│   ├── providers/
│   ├── prompts/
│   ├── context/
│   ├── schemas/
│   └── orchestration/
│
├── infrastructure/
│   ├── database/
│   ├── auth/
│   └── storage/
│
└── shared/
```

The exact framework conventions should still be respected.

---

# 63. Architecture Boundary Rules

Modules may read another module through defined application interfaces.

Avoid arbitrary cross-module database manipulation.

For example:

```text id="nrcu81"
Discovery
    ↓
DecisionService

NOT

Discovery
    ↓
direct UPDATE decisions table
```

This keeps business logic centralized.

---

# 64. Future Repository Integration

The architecture should leave room for:

```text id="emf3c8"
Agent Ready Kit
      ↕
Git Repository
```

Potential future modules:

```text id="6tj4ve"
Repository
Repository Scanner
Specification Drift
Pull Request Validator
```

These are not required for MVP.

---

# 65. Future Agent Execution

Long-term:

```text id="nnc6qt"
Task
 ↓
Coding Agent
 ↓
Implementation
 ↓
Validation
 ↓
Pull Request
```

The current Task and Traceability models should therefore use stable identifiers from the beginning.

---

# 66. Major Architectural Decision

The system should NOT be designed as:

```text id="fr06t8"
Chat
 ↓
Huge Prompt
 ↓
Generate 7 Markdown files
 ↓
ZIP
```

That architecture would be easy to build but would fail the primary product promise.

The intended architecture is:

```text id="bcbvs4"
Conversation
      ↓
Structured Extraction
      ↓
Decision Graph
      ↓
Canonical Knowledge
      ↓
Specification Compiler
      ↓
Validation
      ↓
Task Planner
      ↓
Agent Kit
```

This distinction is fundamental.

---

# 67. MVP Infrastructure Philosophy

Prefer:

- one application;
- one relational database;
- one initial AI provider;
- minimal storage;
- managed authentication;
- no graph database;
- no vector database unless proven necessary;
- no message broker unless proven necessary;
- no microservices;
- no Kubernetes.

Complex infrastructure must be justified by demonstrated product needs.

---

# 68. Vector Database Decision

A vector database is **not required for the MVP**.

Canonical structured project knowledge should handle most context retrieval.

Semantic retrieval may become useful when Agent Ready Kit later supports:

- large uploaded documents;
- existing repositories;
- extensive historical specifications;
- large organizational knowledge bases.

Do not introduce vector infrastructure prematurely.

---

# 69. Architecture Quality Attributes

Priority order:

1. **Specification consistency**
2. **Data integrity**
3. **AI explainability**
4. **Maintainability**
5. **LLM cost efficiency**
6. **Reliability**
7. **Performance**
8. **Horizontal scalability**

Massive scale is not an MVP requirement.

---

# 70. Core Architectural Invariants

The following rules should remain true throughout implementation.

### INV-001

A generated Markdown document is never the only source of critical project information.

### INV-002

AI output cannot directly mutate canonical state without validation.

### INV-003

Important AI assumptions must remain discoverable.

### INV-004

Confirmed user decisions override AI recommendations.

### INV-005

Changes to canonical knowledge must invalidate affected compiled artifacts.

### INV-006

Blocking validation issues prevent Implementation Ready status.

### INV-007

Tasks must trace back to implementation requirements where applicable.

### INV-008

Vendor-specific Agent Kit adapters cannot change canonical product intent.

### INV-009

Generation failure cannot destroy the last approved specification.

### INV-010

A project export represents an explicit version of project state.

---

# 71. Architecture Summary

Agent Ready Kit is implemented as a modular SaaS application centered around structured project knowledge.

The system progressively transforms an ambiguous software idea into explicit decisions and normalized project knowledge.

That knowledge is compiled into implementation specifications.

Specifications are validated for completeness, consistency, assumptions, and implementation coverage.

Once sufficient readiness is achieved, the system generates an executable task plan and compiles the complete project into a vendor-neutral Agent Kit.

The architecture deliberately separates:

```text id="8k3wqb"
Conversation
≠
Decisions
≠
Knowledge
≠
Specifications
≠
Tasks
≠
Export
```

while maintaining traceability between them.

This separation is the foundation that allows Agent Ready Kit to provide more value than a conventional AI document generator.