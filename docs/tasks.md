# Agent Ready Kit

## Implementation Plan

**Document:** tasks.md
**Status:** Draft v1
**Product:** Agent Ready Kit
**Project Phase:** MVP
**Execution Strategy:** Dependency-driven, milestone-based
**Primary Goal:** Build an implementation-ready MVP that transforms a software idea into a validated Agent Kit for downstream coding agents.

---

# 1. Purpose

This document defines the implementation plan for the Agent Ready Kit MVP.

It translates the product, architecture, database, agent, soul, and design specifications into executable engineering work.

The implementation order follows dependency structure rather than document order.

---

# 2. Source of Truth

Implementation must follow the project specifications.

```text
Product behavior
→ PRD.md

System architecture
→ architecture.md

Persistence
→ database-schema.md

AI orchestration
→ agents.md

AI behavior
→ soul.md

UX and interaction
→ design.md

Execution
→ tasks.md
```

If specifications conflict, implementation should not silently choose one.

The conflict must be resolved in the project specification first.

---

# 3. Implementation Principles

## TASK-PRINCIPLE-001

Canonical structured project state is implemented before rich document generation.

## TASK-PRINCIPLE-002

AI output must never directly mutate authoritative project state.

## TASK-PRINCIPLE-003

Deterministic rules should be implemented before equivalent LLM reasoning.

## TASK-PRINCIPLE-004

Every state-changing AI operation must produce structured validated output.

## TASK-PRINCIPLE-005

Stable identifiers must survive regeneration.

## TASK-PRINCIPLE-006

Specifications are compiled from project state.

They are not the primary source of truth.

## TASK-PRINCIPLE-007

Important user decisions remain authoritative.

## TASK-PRINCIPLE-008

Every MUST requirement must eventually have implementation-task coverage.

---

# 4. Task Status

Supported planning statuses:

```text
PENDING
READY
BLOCKED
REVIEW_REQUIRED
DONE
```

Definitions:

### PENDING

Task exists but dependencies have not yet been evaluated or completed.

### READY

All dependencies are satisfied and implementation can begin.

### BLOCKED

A dependency or unresolved product decision prevents implementation.

### REVIEW_REQUIRED

Implementation or specification needs human review.

### DONE

Acceptance criteria and Definition of Done are satisfied.

---

# 5. Priority

Tasks use:

```text
P0 — MVP critical
P1 — MVP important
P2 — Optional MVP enhancement
```

P0 tasks are required for a valid Agent Ready Kit MVP.

---

# 6. Milestone Overview

```text
M0  Repository & Engineering Foundation

M1  Identity & Project Workspace

M2  Canonical Project State

M3  Discovery Engine

M4  AI Infrastructure & Orchestration

M5  Project Knowledge

M6  Specification Compiler

M7  Validation & Assumption Engine

M8  Agent Readiness

M9  Task Planner

M10 Agent Kit Compiler & Export

M11 Product UX Integration

M12 Quality, Security & Production Readiness
```

Dependency overview:

```text
M0
 ↓
M1
 ↓
M2
 ├─────────────┐
 ↓             ↓
M3            M4
 └──────┬──────┘
        ↓
       M5
        ↓
       M6
        ↓
       M7
        ↓
       M8
        ↓
       M9
        ↓
      M10
        ↓
      M11
        ↓
      M12
```

Some UI work can proceed in parallel once the corresponding domain contracts stabilize.

---

# 7. M0 — Repository & Engineering Foundation

## Goal

Create a stable application foundation before implementing product behavior.

---

# TASK-001 — Initialize Application Repository

**Status:** DONE
**Priority:** P0
**Milestone:** M0

## Objective

Create the base application repository using the architecture-approved technology stack.

## Depends On

None.

## References

```text
architecture.md
Project Structure
Technology Stack
Deployment Architecture
```

## Requirements

The repository must include:

- application source;
- dependency management;
- environment configuration;
- test configuration;
- linting;
- formatting;
- build scripts;
- local development instructions.

## Acceptance Criteria

- [ ] Application runs locally.
- [ ] Production build succeeds.
- [ ] Test runner executes.
- [ ] Linter executes.
- [ ] Formatter is configured.
- [ ] Environment variables are documented.
- [ ] `.env.example` or equivalent exists.
- [ ] Secrets are excluded from version control.

## Definition of Done

- [ ] Code committed.
- [ ] Build passes.
- [ ] Tests pass.
- [ ] Lint passes.
- [ ] README contains local setup instructions.

---

# TASK-002 — Establish Application Module Boundaries

**Status:** DONE
**Priority:** P0
**Milestone:** M0

## Depends On

```text
TASK-001
```

## Objective

Create the high-level source organization defined by `architecture.md`.

## Requirements

Separate concerns for at least:

```text
Projects
Discovery
Decisions
Knowledge
Specifications
Validation
Readiness
Tasks
AI
Exports
Shared infrastructure
```

Exact directory naming follows the selected framework.

## Acceptance Criteria

- [ ] Domain boundaries are visible in source structure.
- [ ] AI provider code is not mixed with domain logic.
- [ ] export packaging is isolated from specification generation.
- [ ] readiness calculation is isolated from AI services.
- [ ] shared infrastructure has clear boundaries.

## Definition of Done

- [ ] Module structure documented.
- [ ] No circular module dependencies introduced.
- [ ] Tests/build pass.

---

# TASK-003 — Configure Database Infrastructure

**Status:** DONE
**Priority:** P0
**Milestone:** M0

## Depends On

```text
TASK-001
```

## References

```text
database-schema.md
architecture.md
```

## Objective

Configure the application's primary persistence layer.

## Requirements

Implement:

- database connection;
- migrations;
- migration execution workflow;
- development database configuration;
- test database strategy;
- timestamps;
- UUID/stable primary-key strategy according to architecture.

## Acceptance Criteria

- [ ] Fresh database can be created from migrations.
- [ ] Migrations can run in CI/test environment.
- [ ] Application can establish a database connection.
- [ ] Database errors are handled safely.
- [ ] Test isolation works.

---

# TASK-004 — Establish Stable Identifier Service

**Status:** DONE
**Priority:** P0
**Milestone:** M0

## Depends On

```text
TASK-003
```

## Objective

Implement deterministic stable identifiers for project artifacts.

## Identifier Families

At minimum:

```text
DEC-*
FR-*
ENT-*
ARC-*
SCREEN-*
TASK-*
```

## Code Format

Decision codes use a category infix: `DEC-AUTH-001`.
This is distinct from the dot-notation `decision_key` used in logic
(e.g. `authentication.required`); both are persisted (see
database-schema.md §11). Issue codes use `ISSUE-xxx`;
assumption codes use `ASM-xxx`.

## Requirements

Identifiers must:

- be unique inside their project namespace;
- remain stable when ordering changes;
- not depend on array index;
- not be generated by an LLM;
- support future traceability.

## Acceptance Criteria

- [ ] IDs are generated deterministically by application logic.
- [ ] Existing IDs survive document regeneration.
- [ ] Duplicate IDs cannot be created.
- [ ] Unit tests cover identifier generation.

---

# TASK-005 — Configure Background Job Infrastructure

**Status:** DONE
**Priority:** P1
**Milestone:** M0

## Depends On

```text
TASK-001
```

## Objective

Provide execution infrastructure for AI operations that should not block the main request lifecycle.

## Candidate Operations

```text
specification generation
semantic validation
task generation
Agent Kit generation
```

## Acceptance Criteria

- [ ] Jobs can be queued.
- [ ] Job status can be persisted.
- [ ] Failed jobs expose a recoverable state.
- [ ] Duplicate execution can be prevented where required.
- [ ] Retry policy exists.

If the chosen MVP architecture intentionally uses synchronous operations, document the decision and preserve an interface that allows background execution later.

---

# 8. M1 — Identity & Project Workspace

## Goal

Allow authenticated users to create and manage isolated projects.

---

# TASK-010 — Implement User Authentication

**Status:** DONE
**Priority:** P0
**Milestone:** M1

## Depends On

```text
TASK-001
TASK-003
```

## References

```text
PRD.md
architecture.md
database-schema.md
design.md
```

## Objective

Implement authentication for Agent Ready Kit users.

## Requirements

- users can authenticate using Email+password and Google OAuth via the managed authentication abstraction (MVP default, per spec-decisions.md D-A01);
- unauthenticated users cannot access private projects;
- session handling follows the architecture specification;
- logout is supported.

## Acceptance Criteria

- [ ] User can authenticate.
- [ ] User can log out.
- [ ] Protected routes reject unauthenticated access.
- [ ] Session survives valid page navigation.
- [ ] Invalid sessions are handled safely.
- [ ] Authentication tests pass.

---

# TASK-011 — Implement Project Persistence

**Status:** DONE
**Priority:** P0
**Milestone:** M1

## Depends On

```text
TASK-003
TASK-010
```

## References

```text
FR-001
database-schema.md
```

## Objective

Implement the Project aggregate and persistence operations.

## Requirements

Project stores at minimum:

```text
owner
name
initial idea
lifecycle state
current project-state version
created timestamp
updated timestamp
```

Optional idea-capture fields should follow the schema.

## Acceptance Criteria

- [ ] Projects belong to one authenticated owner.
- [ ] Users cannot access projects owned by another user.
- [ ] Project can be created.
- [ ] Project can be retrieved.
- [ ] Project can be updated according to MVP rules.
- [ ] Project ownership is enforced server-side.

---

# TASK-012 — Implement Project List

**Status:** DONE
**Priority:** P0
**Milestone:** M1

## Depends On

```text
TASK-011
```

## References

```text
SCREEN-003
design.md
```

## Objective

Display projects belonging to the authenticated user.

## Acceptance Criteria

- [ ] Only owned projects appear.
- [ ] Project name is visible.
- [ ] Lifecycle state is visible.
- [ ] Readiness can be displayed when available.
- [ ] Last-updated information is visible.
- [ ] Empty state includes Create Project action.
- [ ] Loading and error states exist.

---

# TASK-013 — Implement Project Creation Flow

**Status:** DONE
**Priority:** P0
**Milestone:** M1

## Depends On

```text
TASK-011
```

## References

```text
FR-001
SCREEN-004
design.md
```

## Objective

Allow users to create a project from an initial software idea.

## Inputs

Required:

```text
project name
idea
```

Optional:

```text
target users
constraints
references
preferred stack
```

## Acceptance Criteria

- [ ] Required fields are validated.
- [ ] Optional inputs use progressive disclosure.
- [ ] Project owner is assigned automatically.
- [ ] Initial lifecycle state is valid.
- [ ] Successful creation starts the analysis/discovery workflow.
- [ ] Unauthorized creation is impossible.

---

# TASK-014 — Implement Project Authorization Policies

**Status:** DONE
**Priority:** P0
**Milestone:** M1

## Depends On

```text
TASK-010
TASK-011
```

## Objective

Centralize project authorization.

## Acceptance Criteria

- [ ] Read access checks project ownership.
- [ ] Update access checks project ownership.
- [ ] Delete/archive operations check project ownership.
- [ ] Nested resources cannot bypass project authorization.
- [ ] Authorization tests cover cross-user access attempts.

---

# 9. M2 — Canonical Project State

## Goal

Build the structured state model that becomes the real source of truth.

This milestone is foundational.

Document generation must not become the canonical model.

---

# TASK-020 — Implement Project State Versioning

**Status:** DONE
**Priority:** P0
**Milestone:** M2

## Depends On

```text
TASK-011
```

## Objective

Track meaningful canonical project-state changes.

## Requirements

Each accepted meaningful state change increments or creates a project-state version according to the architecture.

## Acceptance Criteria

- [ ] Current state version is available.
- [ ] State-changing operations create version metadata.
- [ ] AI failures do not increment approved state.
- [ ] Historical versions can be referenced by generated artifacts.
- [ ] Version operations are transaction-safe.

---

# TASK-021 — Implement Decision Domain Model

**Status:** DONE
**Priority:** P0
**Milestone:** M2

## Depends On

```text
TASK-003
TASK-004
TASK-011
```

## References

```text
FR-020
FR-021
FR-022
database-schema.md
```

## Objective

Persist structured project decisions.

## Decision Statuses

```text
UNRESOLVED
RECOMMENDED
CONFIRMED
DEFERRED
NOT_APPLICABLE
```

## Acceptance Criteria

- [ ] Decision has stable ID.
- [ ] Decision belongs to a project.
- [ ] Category is stored.
- [ ] Current value can be stored structurally.
- [ ] Rationale can be stored.
- [ ] Source/provenance can be stored.
- [ ] Impact classification can be stored.
- [ ] Status is validated.
- [ ] Decision history can be determined.

---

# TASK-022 — Implement Decision Dependency Model

**Status:** DONE
**Priority:** P0
**Milestone:** M2

## Depends On

```text
TASK-021
```

## Objective

Represent deterministic relationships between decisions.

## Example

```text
payment.required = false

causes:

subscription.model
payment.provider
invoice.strategy

→ NOT_APPLICABLE
```

## Acceptance Criteria

- [ ] Dependencies can be registered.
- [ ] Dependent decisions can become not applicable.
- [ ] Re-enabling a parent decision reopens relevant child decisions safely.
- [ ] Cyclic dependencies are rejected or detected.
- [ ] Dependency logic is covered by unit tests.

---

# TASK-023 — Implement Requirement Domain Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M2

## Depends On

```text
TASK-004
TASK-011
```

## Objective

Store stable implementation-relevant requirements independently from generated prose.

## Requirements

Requirement records support:

```text
stable ID
title
description
priority
type
status
acceptance criteria
source
```

## Acceptance Criteria

- [ ] FR identifiers remain stable.
- [ ] MUST/SHOULD/COULD or architecture-approved priority scheme is supported.
- [ ] Acceptance criteria are structured.
- [ ] Requirement can reference source decisions/knowledge.
- [ ] Requirements can be superseded without ID reuse.

---

# TASK-024 — Implement Traceability Links

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M2

## Depends On

```text
TASK-021
TASK-023
```

## Objective

Allow canonical artifacts to reference each other.

## Link Examples

```text
DEC → FR
FR → ENT
FR → ARC
FR → SCREEN
FR → TASK
```

## Acceptance Criteria

- [ ] Links store source and target.
- [ ] Invalid cross-project links are rejected.
- [ ] Duplicate links are prevented.
- [ ] Links can be queried in both directions.
- [ ] Deleted/superseded objects are handled safely.

---

# TASK-025 — Implement Provenance Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M2

## Depends On

```text
TASK-021
TASK-023
```

## Objective

Track where important project knowledge originated.

## Provenance Types

At minimum:

```text
USER_EXPLICIT
USER_IMPLIED
AI_RECOMMENDED
AI_ASSUMED
SYSTEM_DERIVED
```

## Canonical Mapping (per spec-decisions.md D-A02)

`decisions.source_type` × `decisions.confidence` maps to provenance as:

```text
USER × EXPLICIT          → USER_EXPLICIT
USER × INFERRED          → USER_IMPLIED
AI_RECOMMENDATION × any  → AI_RECOMMENDED
AI_INFERENCE × any       → AI_ASSUMED
SYSTEM × any             → SYSTEM_DERIVED
```

`soul.md` §8 vocabulary maps as:
CONFIRMED → USER_EXPLICIT, INFERRED → USER_IMPLIED,
ASSUMED → AI_ASSUMED, RECOMMENDED → AI_RECOMMENDED,
UNRESOLVED → no provenance (decision stays UNRESOLVED).

## Acceptance Criteria

- [ ] Provenance is attachable to canonical objects.
- [ ] User-confirmed state is distinguishable from AI proposals.
- [ ] Assumptions cannot masquerade as explicit user facts.
- [ ] Provenance can be displayed in the UI.

---

# 10. M3 — Discovery Engine

## Goal

Transform project creation into adaptive structured discovery.

---

# TASK-030 — Implement Discovery Domain Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M3

## Depends On

```text
TASK-011
TASK-021
```

## Objective

Persist Discovery Map state.

## Domains

Support at least:

```text
Product
Features
Access
Data
UX
Technical
Integrations
AI
Non-Functional
```

## Acceptance Criteria

- [ ] Discovery domain state is persisted.
- [ ] Domain can be UNKNOWN, PARTIAL, RESOLVED, or NOT_APPLICABLE (canonical, see database-schema.md §10).
- [ ] Discovery progress survives sessions.
- [ ] Relevant decisions can be associated with discovery nodes.
- [ ] Discovery Map is project-scoped.

---

# TASK-031 — Implement Discovery Level Calculation

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M3

## Depends On

```text
TASK-030
```

## Objective

Determine whether the project has enough information for:

```text
INITIAL
QUICK_DRAFT
DETAILED
AGENT_READY
```

(canonical levels, see database-schema.md §5)

## Acceptance Criteria

- [ ] Calculation is deterministic.
- [ ] Levels have explicit criteria.
- [ ] UI can explain what remains for the next level.
- [ ] AI does not arbitrarily assign discovery level.

---

# TASK-032 — Implement Discovery Topic Prioritization

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M3

## Depends On

```text
TASK-022
TASK-030
```

## Objective

Select the highest-value unresolved discovery topic.

## Conceptual Factors

```text
Impact
Dependencies
Uncertainty
MVP relevance
```

## Acceptance Criteria

- [ ] Resolved topics are excluded.
- [ ] Not-applicable topics are excluded.
- [ ] Blocking/high-impact topics receive higher priority.
- [ ] Selection is deterministic given the same project state.
- [ ] AI does not independently choose arbitrary topics.

---

# TASK-033 — Implement Discovery Conversation Persistence

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M3

## Depends On

```text
TASK-030
```

## Objective

Persist discovery questions, answers, and their relationship to structured interpretation.

## Acceptance Criteria

- [ ] Question text is stored.
- [ ] User answer is stored.
- [ ] Associated discovery topic is stored.
- [ ] AI operation reference can be stored.
- [ ] Interpretation result can be linked.
- [ ] Conversation history is project-scoped.

---

# TASK-034 — Implement Discovery Workspace UI

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M3

## Depends On

```text
TASK-030
TASK-031
TASK-033
```

## References

```text
SCREEN-007
design.md
```

## Objective

Implement the structured Discovery interface.

## Acceptance Criteria

- [ ] Current question is prominent.
- [ ] User can select suggested options.
- [ ] User can enter natural-language answers.
- [ ] Discovery progress is visible.
- [ ] Discovery level is visible.
- [ ] Resume state works after navigation/reload.
- [ ] Loading/error states exist.

AI question generation is integrated after M4.

---

# 11. M4 — AI Infrastructure & Orchestration

## Goal

Provide safe, observable, provider-neutral AI execution.

---

# TASK-040 — Implement AI Provider Abstraction

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M4

## Depends On

```text
TASK-001
```

## References

```text
agents.md
architecture.md
```

## Objective

Create provider-neutral interfaces for model execution.

## Acceptance Criteria

- [ ] Domain code does not depend directly on provider SDKs.
- [ ] Model can be configured per operation.
- [ ] Structured output is supported.
- [ ] Provider errors are normalized.
- [ ] Timeouts are handled.
- [ ] Secrets remain server-side.

---

# TASK-041 — Implement Prompt Registry

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M4

## Depends On

```text
TASK-040
```

## Objective

Store and version prompts by capability.

## Requirements

Every prompt includes:

```text
prompt key
version
role
objective
boundaries
output schema
quality criteria
```

## Acceptance Criteria

- [ ] Prompt key is stable.
- [ ] Prompt version is recorded.
- [ ] AI operations record used prompt version.
- [ ] Prompt updates do not rewrite historical operations.

---

# TASK-042 — Implement Structured Output Validation

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M4

## Depends On

```text
TASK-040
```

## Objective

Validate state-changing AI responses against strict schemas.

## Acceptance Criteria

- [ ] Invalid payload cannot mutate canonical state.
- [ ] Validation errors are recorded.
- [ ] One bounded repair attempt can be performed when appropriate.
- [ ] Persistent invalid output marks operation failed.
- [ ] Unit tests cover malformed payloads.

---

# TASK-043 — Implement AI Operation Ledger

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M4

## Depends On

```text
TASK-003
TASK-040
TASK-041
```

## Objective

Record AI invocation metadata.

## Record

```text
project
capability
operation type
provider
model
prompt version
state version
status
latency
input usage
output usage
cost metadata where available
failure metadata
```

## Acceptance Criteria

- [ ] Successful operations are recorded.
- [ ] Failed operations are recorded.
- [ ] Sensitive secrets are not persisted.
- [ ] Records are scoped to project/user authorization.
- [ ] Operation history supports debugging.

---

# TASK-044 — Implement Context Builder

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M4

## Depends On

```text
TASK-021
TASK-023
TASK-025
```

## Objective

Build capability-specific context projections.

## Context Priority

```text
Essential
Recommended
Optional
```

## Acceptance Criteria

- [ ] Each capability defines required context.
- [ ] Unrelated project history is excluded by default.
- [ ] Confirmed information is distinguishable from assumptions.
- [ ] Context respects project authorization.
- [ ] Context can be inspected in tests.

---

# TASK-045 — Implement AI Orchestrator

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M4

## Depends On

```text
TASK-040
TASK-041
TASK-042
TASK-043
TASK-044
```

## Objective

Coordinate bounded AI operations.

## Responsibilities

```text
select capability
build context
select prompt
select model
execute
validate output
record operation
handle bounded retry
return structured result
```

## Acceptance Criteria

- [ ] Orchestrator does not directly persist canonical business state.
- [ ] AI operation is traceable.
- [ ] Invalid responses are rejected.
- [ ] Provider failures preserve approved state.
- [ ] Retry behavior is bounded.
- [ ] Tests use provider mocks/fakes.

---

# TASK-046 — Implement AI Usage Guardrails

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M4

## Depends On

```text
TASK-043
TASK-045
```

## Objective

Prevent accidental runaway cost and repeated operations.

## Requirements

Implement MVP-appropriate:

```text
rate limits
operation limits
duplicate-operation protection
context-size limits
timeout limits
```

## Acceptance Criteria

- [ ] User cannot trigger uncontrolled repeated expensive operations.
- [ ] Duplicate submissions are idempotent where appropriate.
- [ ] Limits produce understandable errors.
- [ ] Usage can be inspected operationally.

---

# TASK-047 — Implement AI Result Caching/Fingerprints

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M4

## Depends On

```text
TASK-043
TASK-044
```

## Objective

Avoid repeating equivalent AI work.

## Acceptance Criteria

- [ ] Relevant input state produces dependency fingerprint.
- [ ] Prompt version participates in cache validity.
- [ ] Changed dependency invalidates cached result.
- [ ] Cache never causes stale confirmed state to overwrite newer state.

---

# 12. M5 — Project Knowledge

## Goal

Convert discovery and decisions into normalized canonical understanding.

---

# TASK-050 — Implement Idea Analyst

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M5

## Depends On

```text
TASK-013
TASK-045
```

## References

```text
A-001
FR-002
agents.md
```

## Objective

Analyze the initial idea after project creation.

## Acceptance Criteria

- [ ] Produces structured output.
- [ ] Extracts explicit facts.
- [ ] Identifies unknown areas.
- [ ] Identifies candidate decisions.
- [ ] Identifies assumptions separately.
- [ ] Does not silently confirm major decisions.
- [ ] Failure leaves project creation intact.

---

# TASK-051 — Implement Initial Understanding Review

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M5

## Depends On

```text
TASK-050
```

## References

```text
SCREEN-006
design.md
```

## Objective

Allow user to review what the Idea Analyst understood.

## Acceptance Criteria

- [ ] Product summary is shown.
- [ ] Known users are shown.
- [ ] capabilities are shown.
- [ ] constraints are shown.
- [ ] unclear areas are shown.
- [ ] User can confirm understanding.
- [ ] User can correct incorrect interpretation.
- [ ] Confirmation initializes canonical discovery state.

---

# TASK-052 — Implement Discovery Interviewer

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M5

## Depends On

```text
TASK-032
TASK-045
TASK-051
```

## References

```text
A-002
agents.md
soul.md
```

## Objective

Generate the next user-facing question for the topic selected by deterministic discovery logic.

## Acceptance Criteria

- [ ] Receives selected topic from application.
- [ ] Does not independently reorder Discovery Map.
- [ ] Produces concise question.
- [ ] Can produce meaningful options.
- [ ] Recommendation is clearly identified.
- [ ] Recommendation includes rationale.
- [ ] Custom answer remains possible.

---

# TASK-053 — Implement Answer Interpreter

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M5

## Depends On

```text
TASK-045
TASK-052
```

## References

```text
A-003
agents.md
```

## Objective

Translate natural-language discovery answers into structured candidate changes.

## Acceptance Criteria

- [ ] Explicit decisions are classified correctly.
- [ ] Inferences are distinguishable.
- [ ] Assumptions remain assumptions.
- [ ] Multiple decisions can be extracted from one answer.
- [ ] Unsupported decisions are not silently invented.
- [ ] Output uses strict schema.
- [ ] Invalid identifiers are rejected.
- [ ] Tests include representative natural-language answers.

---

# TASK-054 — Implement Candidate Change Review & Application

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M5

## Depends On

```text
TASK-021
TASK-022
TASK-025
TASK-053
```

## Objective

Validate and apply interpreted discovery changes.

## Acceptance Criteria

- [ ] Candidate changes are validated before persistence.
- [ ] High-impact recommendations remain unconfirmed until accepted.
- [ ] Explicit user decisions can become confirmed.
- [ ] Decision dependencies execute.
- [ ] Provenance is recorded.
- [ ] Project state version updates atomically.
- [ ] Failed transaction leaves previous state intact.

---

# TASK-055 — Implement Knowledge Domain Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M5

## Depends On

```text
TASK-020
TASK-025
```

## Objective

Persist normalized Project Knowledge.

## Knowledge Categories

At minimum:

```text
Vision
Users
Personas
Features
Constraints
Business Rules
Entities
Integrations
Technical Decisions
Design Decisions
AI Behavior
Non-Functional Requirements
```

## Acceptance Criteria

- [ ] Knowledge item belongs to a project.
- [ ] Knowledge has provenance.
- [ ] Knowledge supports active/superseded state.
- [ ] Knowledge can reference source decisions.
- [ ] Duplicate conceptual knowledge can be detected/merged.
- [ ] Current knowledge can be queried efficiently.

---

# TASK-056 — Implement Knowledge Curator

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M5

## Depends On

```text
TASK-045
TASK-054
TASK-055
```

## References

```text
A-004
agents.md
```

## Objective

Normalize validated decisions and statements into Project Knowledge.

## Acceptance Criteria

- [ ] Curator returns structured proposals.
- [ ] Application validates proposals.
- [ ] Duplicate knowledge is consolidated.
- [ ] Provenance is preserved.
- [ ] Superseded knowledge is retained historically.
- [ ] Confirmed decisions are not overwritten by weaker AI inference.

---

# TASK-057 — Implement Discovery Interpretation Summary

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M5

## Depends On

```text
TASK-053
TASK-054
```

## Objective

Show users what was extracted from an answer.

## Example

```text
Understood

✓ Authentication not required
✓ Single-user application
✓ Local browser storage
✓ Collaboration not applicable
```

## Acceptance Criteria

- [ ] Summary reflects actual persisted candidate changes.
- [ ] User can review relevant decisions.
- [ ] UI never claims a change was saved when persistence failed.

---

# TASK-058 — Implement Decision Center UI

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M5

## Depends On

```text
TASK-021
TASK-025
TASK-054
```

## References

```text
SCREEN-008
SCREEN-009
design.md
```

## Acceptance Criteria

- [ ] Decisions can be filtered by status.
- [ ] Current value is visible.
- [ ] Provenance is inspectable.
- [ ] Impact classification is visible.
- [ ] User can confirm recommendations.
- [ ] User can change decisions.
- [ ] High-impact changes trigger impact review when available.

---

# 13. M6 — Specification Compiler

## Goal

Compile canonical project state into versioned implementation-oriented specifications.

---

# TASK-060 — Implement Specification Domain Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-020
TASK-055
```

## Objective

Persist specification artifacts and sections independently from canonical knowledge.

## Acceptance Criteria

- [ ] Specification type is stored.
- [ ] Version is stored.
- [ ] Source project-state version is stored.
- [ ] Sections can be individually identified.
- [ ] Current and historical versions are distinguishable.
- [ ] Staleness can be represented.

---

# TASK-061 — Implement Specification Dependency Tracking

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-024
TASK-060
```

## Objective

Track which canonical objects influence each specification section.

## Acceptance Criteria

- [ ] Section can reference decisions/requirements/knowledge.
- [ ] Changed dependency marks affected section stale.
- [ ] Unaffected sections remain current.
- [ ] Staleness propagation is deterministic.

---

# TASK-062 — Implement Product Specification Compiler

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-023
TASK-045
TASK-055
TASK-060
```

## References

```text
A-010
FR-040
```

## Objective

Compile `PRD.md` from canonical project state.

## Acceptance Criteria

- [ ] Existing FR identifiers are preserved.
- [ ] Unknowns remain explicit.
- [ ] AI does not invent major product behavior.
- [ ] Requirement priorities are preserved.
- [ ] Output references source state version.
- [ ] Markdown can be rendered deterministically from approved content.

---

# TASK-059 — Implement README Compiler, Architecture Component & Screen Models

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-004
TASK-011
```

## References

```text
database-schema.md
```

## Objective

Persist `ARC-*` architecture components and `SCREEN-*` screens with
stable codes (per spec-decisions.md D-C08, D-C09), and generate the
export `README.md` that orients coding agents.

## Acceptance Criteria

- [ ] Architecture component has stable `ARC-*` code unique per project.
- [ ] Screen has stable `SCREEN-*` code unique per project.
- [ ] Both support DRAFT, CONFIRMED, DEFERRED, SUPERSEDED, REMOVED status.
- [ ] Codes survive regeneration and are never reused after removal.
- [ ] Export README renders reading order and source-of-truth locations
      (per spec-decisions.md D-A07).
- [ ] Unit tests cover code generation.

---

# TASK-063 — Implement Architecture Specification Compiler

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-045
TASK-055
TASK-059
TASK-060
```

## References

```text
A-011
FR-041
```

## Acceptance Criteria

- [ ] Architecture reflects confirmed requirements and constraints.
- [ ] Unresolved architecture decisions remain visible.
- [ ] Major technologies are not silently selected.
- [ ] Important architecture concepts receive stable ARC identifiers via TASK-059.
- [ ] Source state version is stored.

---

# TASK-064 — Implement Data Specification Compiler

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-023
TASK-045
TASK-055
TASK-060
TASK-063
```

## References

```text
A-012
FR-042
```

## Acceptance Criteria

- [ ] Domain entities map to persistence structures.
- [ ] Entity identifiers remain stable.
- [ ] Relationships are explicit.
- [ ] Important constraints are explicit.
- [ ] Ownership rules are represented.
- [ ] Required indexes can be documented.
- [ ] Unresolved persistence questions remain explicit.

---

# TASK-065 — Implement Design Specification Compiler

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-023
TASK-045
TASK-055
TASK-059
TASK-060
```

## References

```text
A-013
FR-043
```

## Acceptance Criteria

- [ ] Core workflows are represented.
- [ ] Important screens receive stable SCREEN identifiers.
- [ ] Loading states are represented.
- [ ] Empty states are represented.
- [ ] Error states are represented.
- [ ] Responsive expectations are represented.
- [ ] Design does not invent unsupported product behavior.

---

# TASK-066 — Implement Optional Product Agent Specification Compiler

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M6

## Depends On

```text
TASK-045
TASK-055
TASK-060
```

## References

```text
A-014
FR-044
```

## Objective

Generate exported `agents.md` only for target applications that contain meaningful AI-agent behavior.

## Acceptance Criteria

- [ ] Applicability can be determined.
- [ ] Non-AI projects do not receive fabricated agent architecture.
- [ ] Agent roles have explicit boundaries.
- [ ] Output remains distinct from Agent Ready Kit's internal `agents.md`.

---

# TASK-067 — Implement Optional Soul Compiler

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M6

## Depends On

```text
TASK-045
TASK-055
TASK-060
```

## References

```text
A-015
FR-045
```

## Acceptance Criteria

- [ ] Soul applicability is evaluated.
- [ ] Non-applicable projects can omit `soul.md`.
- [ ] Soul defines behavior rather than duplicating technical agent instructions.
- [ ] Output uses confirmed project intent.

---

# TASK-068 — Implement Specification Workspace UI

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-060
TASK-062
TASK-063
TASK-064
TASK-065
```

## References

```text
SCREEN-010
SCREEN-011
SCREEN-012
SCREEN-013
SCREEN-014
design.md
```

## Acceptance Criteria

- [ ] Structured view is default.
- [ ] Markdown view is available.
- [ ] Current/stale state is visible.
- [ ] Specification version is visible.
- [ ] Source references can be inspected.
- [ ] User can navigate between specification types.
- [ ] Historical/current distinction is clear.

---

# TASK-069 — Implement Incremental Specification Regeneration

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M6

## Depends On

```text
TASK-061
TASK-062
TASK-063
TASK-064
TASK-065
```

## Objective

Regenerate affected specification sections without rewriting unaffected sections.

## Acceptance Criteria

- [ ] Changed dependencies identify affected sections.
- [ ] Unaffected sections preserve current version/content.
- [ ] Proposed changes can be reviewed.
- [ ] Stable identifiers remain unchanged when concepts remain unchanged.
- [ ] Regeneration failure preserves last approved specification.

---

# 14. M7 — Validation & Assumption Engine

## Goal

Detect incomplete, contradictory, unsupported, and uncovered project definitions.

---

# TASK-070 — Implement Validation Issue Domain Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M7

## Depends On

```text
TASK-020
```

## Issue Severity

```text
BLOCKER
HIGH
MEDIUM
LOW
INFO
```

## Acceptance Criteria

- [ ] Issue type is stored.
- [ ] Severity is stored.
- [ ] Affected artifacts can be linked.
- [ ] Issue can be OPEN, RESOLVED, or IGNORED according to policy.
- [ ] Resolution metadata is stored.
- [ ] Historical issue records remain auditable.

---

# TASK-071 — Implement Deterministic Completeness Validator

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M7

## Depends On

```text
TASK-021
TASK-023
TASK-055
TASK-070
```

## References

```text
FR-060
```

## Objective

Detect missing required structured information without AI.

## Examples

```text
required decision unresolved
MUST requirement without acceptance criteria
entity referenced but undefined
```

## Acceptance Criteria

- [ ] Rules are deterministic.
- [ ] Same state produces same findings.
- [ ] Duplicate issues are not created repeatedly.
- [ ] Resolved issues can reopen when regression occurs.

---

# TASK-072 — Implement Deterministic Dependency Validator

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M7

## Depends On

```text
TASK-022
TASK-024
TASK-070
```

## References

```text
FR-062
```

## Acceptance Criteria

- [ ] Broken references are detected.
- [ ] Invalid dependency states are detected.
- [ ] Circular dependencies are detected where prohibited.
- [ ] Cross-project references are rejected.

---

# TASK-073 — Implement Semantic Validator

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M7

## Depends On

```text
TASK-045
TASK-060
TASK-070
```

## References

```text
A-020
FR-061
```

## Objective

Detect meaningful semantic contradictions.

## Acceptance Criteria

- [ ] Relevant specification pairs are selected.
- [ ] Output uses structured issue schema.
- [ ] Sources are identified.
- [ ] Low-confidence stylistic differences are suppressed.
- [ ] AI findings do not directly rewrite project state.
- [ ] User can resolve detected conflicts.

---

# TASK-074 — Implement Assumption Domain Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M7

## Depends On

```text
TASK-025
TASK-070
```

## Objective

Track implementation-relevant assumptions separately from confirmed knowledge.

## Acceptance Criteria

- [ ] Assumption has stable identity.
- [ ] Impact is stored.
- [ ] Source is stored.
- [ ] Affected artifacts can be linked.
- [ ] Assumption can be confirmed, replaced, deferred, or rejected.
- [ ] Resolution updates canonical state appropriately.

---

# TASK-075 — Implement Assumption Analyzer

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M7

## Depends On

```text
TASK-045
TASK-055
TASK-074
```

## References

```text
A-021
FR-064
```

## Acceptance Criteria

- [ ] Analyzer focuses on implementation-relevant unknowns.
- [ ] Cosmetic unknowns do not create excessive noise.
- [ ] Output is structured.
- [ ] Duplicate assumptions are normalized.
- [ ] Critical/high assumptions can affect readiness.

---

# TASK-076 — Implement Requirement Coverage Validator

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M7

## Depends On

```text
TASK-023
TASK-024
TASK-070
```

## Objective

Detect missing downstream coverage.

Initially validate applicable relationships such as:

```text
FR → architecture
FR → design
FR → data
```

Task coverage becomes active after M9.

## Acceptance Criteria

- [ ] Coverage rules are configurable by requirement type.
- [ ] Not-applicable relationships do not create false issues.
- [ ] Missing mandatory coverage creates issue.
- [ ] Coverage can be inspected by requirement.

---

# TASK-077 — Implement Validation Workspace UI

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M7

## Depends On

```text
TASK-070
TASK-071
TASK-072
TASK-073
TASK-074
TASK-075
```

## References

```text
SCREEN-016
SCREEN-017
design.md
```

## Acceptance Criteria

- [ ] Issues can be filtered by severity/status.
- [ ] BLOCKER and HIGH receive appropriate prominence.
- [ ] Affected artifacts are visible.
- [ ] Resolution action is contextual.
- [ ] Assumptions are distinguishable from contradictions.
- [ ] Resolved issues can be inspected.

---

# 15. M8 — Agent Readiness

## Goal

Calculate an explainable implementation-readiness state.

---

# TASK-080 — Define Readiness Rule Registry

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M8

## Depends On

```text
TASK-071
TASK-072
TASK-074
TASK-076
```

## Dimensions

```text
Product
Features
Business Rules
Data
UX
Architecture
Security
Execution
```

## Acceptance Criteria

- [ ] Every readiness dimension has explicit criteria.
- [ ] Rule severity/weight is documented.
- [ ] Rules are deterministic.
- [ ] Blocking conditions are explicit.
- [ ] Rule versions can be tracked if needed.

---

# TASK-081 — Implement Readiness Engine

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M8

## Depends On

```text
TASK-080
```

## References

```text
FR-080
FR-081
FR-082
```

## Objective

Calculate readiness without using model intuition.

## Acceptance Criteria

- [ ] Dimension scores are reproducible.
- [ ] Overall score is reproducible.
- [ ] Blocking issue prevents IMPLEMENTATION_READY.
- [ ] Critical unresolved assumptions prevent ready state when configured.
- [ ] Calculation explanation is available.
- [ ] Same state produces same readiness.

---

# TASK-082 — Implement Project Lifecycle Transition Rules

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M8

## Depends On

```text
TASK-031
TASK-081
```

## Lifecycle

```text
DISCOVERY
DRAFT
NEEDS_REVIEW
IMPLEMENTATION_READY
```

## Acceptance Criteria

- [ ] Lifecycle transitions use deterministic criteria.
- [ ] Invalid transitions are prevented.
- [ ] A project can regress from ready if later changes introduce blockers.
- [ ] Lifecycle history is traceable.

---

# TASK-083 — Implement Readiness Workspace

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M8

## Depends On

```text
TASK-081
TASK-082
```

## References

```text
SCREEN-018
design.md
```

## Acceptance Criteria

- [ ] Overall readiness is visible.
- [ ] Lifecycle state is visible.
- [ ] Dimension scores are visible.
- [ ] Clicking dimension shows criteria.
- [ ] Missing criteria link to actionable resolution.
- [ ] Blockers remain visible even when percentage is high.

---

# TASK-084 — Implement Next Best Action Service

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M8

## Depends On

```text
TASK-031
TASK-070
TASK-081
```

## Objective

Recommend the most useful next product action.

## Candidate Actions

```text
Continue Discovery
Resolve blocker
Confirm decision
Resolve assumption
Review specification changes
Generate tasks
Export Agent Kit
```

## Acceptance Criteria

- [ ] Recommendation is deterministic.
- [ ] Blockers outrank cosmetic work.
- [ ] Recommendation explains why it matters.
- [ ] User is not forced to follow it.

---

# 16. M9 — Task Planner

## Goal

Transform stable specifications into executable implementation work.

---

# TASK-090 — Implement Implementation Task Domain Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M9

## Depends On

```text
TASK-004
TASK-023
TASK-024
```

## Task Fields

At minimum:

```text
stable ID
title
objective
planning status
priority
milestone
dependencies
requirement references
architecture references
entity references
screen references
implementation notes
acceptance criteria
definition of done
```

## Acceptance Criteria

- [ ] TASK IDs are stable.
- [ ] Dependencies can be queried.
- [ ] Task references are project-scoped.
- [ ] Acceptance criteria are structured.
- [ ] Planning status is distinct from real repository implementation status.

---

# TASK-091 — Implement Milestone Domain Model

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M9

## Depends On

```text
TASK-090
```

## Acceptance Criteria

- [ ] Milestones can contain ordered tasks.
- [ ] Milestone ordering does not override dependency rules.
- [ ] Milestone metadata is project-scoped.
- [ ] Tasks can move between milestones without losing stable IDs.

---

# TASK-092 — Implement Task Planner Agent

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M9

## Depends On

```text
TASK-045
TASK-060
TASK-090
TASK-091
```

## References

```text
A-030
FR-100
FR-101
FR-102
FR-103
FR-104
```

## Objective

Generate implementation-ready milestone/task candidates.

## Acceptance Criteria

- [ ] Output uses structured schema.
- [ ] Tasks are bounded.
- [ ] Tasks reference relevant requirements.
- [ ] Dependencies are proposed.
- [ ] Acceptance criteria are preserved.
- [ ] Definition of Done is present.
- [ ] Vague mega-tasks are avoided.
- [ ] Unsupported product requirements are not invented.

---

# TASK-093 — Implement Task Dependency Validator

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M9

## Depends On

```text
TASK-090
TASK-092
```

## Acceptance Criteria

- [ ] Circular dependencies are detected.
- [ ] Missing dependency IDs are rejected.
- [ ] Cross-project dependencies are rejected.
- [ ] READY/BLOCKED planning status can be derived.
- [ ] Dependency tests cover multi-level chains.

---

# TASK-094 — Extend Requirement Coverage to Tasks

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M9

## Depends On

```text
TASK-076
TASK-090
```

## Objective

Ensure implementation tasks cover mandatory requirements.

## Acceptance Criteria

- [ ] Every applicable MUST requirement can report task coverage.
- [ ] Missing task coverage creates validation issue.
- [ ] Requirement detail lists implementing tasks.
- [ ] Task deletion can reopen coverage issue.

---

# TASK-095 — Implement Task Plan Workspace

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M9

## Depends On

```text
TASK-090
TASK-091
TASK-093
```

## References

```text
SCREEN-019
SCREEN-020
design.md
```

## Acceptance Criteria

- [ ] Milestone view exists.
- [ ] All-task view exists.
- [ ] Task status is visible.
- [ ] Dependencies are visible.
- [ ] Requirement references are visible.
- [ ] Acceptance criteria are visible.
- [ ] Definition of Done is visible.
- [ ] Blocked reason is understandable.

---

# 17. M10 — Agent Kit Compiler & Export

## Goal

Package approved project understanding into a coding-agent-ready workspace.

---

# TASK-100 — Implement Context Compiler

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M10

## Depends On

```text
TASK-045
TASK-055
TASK-060
TASK-090
```

## References

```text
A-040
FR-110
```

## Objective

Generate compact `context.md`.

## Required Content

```text
project mission
target users
current scope
core capabilities
architecture summary
technology stack
important constraints
current project phase
source-of-truth locations
```

## Acceptance Criteria

- [ ] Context remains concise.
- [ ] Does not duplicate full PRD.
- [ ] Uses current approved project state.
- [ ] Unknowns are not invented.
- [ ] Output is understandable without UI context.

---

# TASK-101 — Implement Coding Agent Instruction Compiler

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M10

## Depends On

```text
TASK-045
TASK-090
TASK-100
```

## References

```text
A-041
FR-111
```

## Objective

Generate root-level `AGENTS.md`.

## Required Sections

```text
project orientation
reading order
source-of-truth hierarchy
task execution workflow
architecture boundaries
requirement-change policy
testing expectations
completion rules
```

## Acceptance Criteria

- [ ] `AGENTS.md` is about coding-agent behavior.
- [ ] It is distinct from target-product `docs/agents.md`.
- [ ] Coding agent knows where authoritative specs live.
- [ ] Coding agent is instructed not to silently change requirements.
- [ ] Active task workflow is explicit.

---

# TASK-102 — Implement Markdown Renderer

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M10

## Depends On

```text
TASK-060
TASK-100
TASK-101
```

## Objective

Render approved specification state into exportable Markdown.

## Acceptance Criteria

- [ ] Markdown output is deterministic for approved content.
- [ ] Stable identifiers are preserved.
- [ ] Internal-only metadata is excluded.
- [ ] UTF-8 content works.
- [ ] Optional documents can be omitted.

---

# TASK-103 — Implement Agent Kit Manifest

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M10

## Depends On

```text
TASK-020
TASK-102
```

## References

```text
FR-121
```

## Objective

Generate `.agent-ready/manifest.json`.

## Minimum Metadata

```text
schema version
project identifier
project name
generated timestamp
source project-state version
readiness state
included artifacts
artifact locations
target adapter
```

## Acceptance Criteria

- [ ] Manifest is valid JSON.
- [ ] Schema version is explicit.
- [ ] File paths match package contents.
- [ ] Source state version is correct.
- [ ] Optional artifacts are represented accurately.

---

# TASK-104 — Implement Generic Agent Kit Compiler

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M10

## Depends On

```text
TASK-102
TASK-103
```

## Objective

Assemble the canonical project package.

## Target Structure

```text
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

Optional files are omitted when not applicable.

## Acceptance Criteria

- [ ] Required files exist.
- [ ] Optional files follow applicability rules.
- [ ] Package paths match manifest.
- [ ] No internal secrets are included.
- [ ] Package can be rebuilt from the same approved state.
- [ ] Generated package is vendor-neutral.

---

# TASK-105 — Implement ZIP Export

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M10

## Depends On

```text
TASK-104
```

## References

```text
FR-122
```

## Acceptance Criteria

- [ ] ZIP is generated successfully.
- [ ] Filename is safe.
- [ ] ZIP structure is correct.
- [ ] Download requires project authorization.
- [ ] Temporary files are cleaned according to architecture.
- [ ] Large/failed export does not corrupt project state.

---

# TASK-106 — Implement Agent Target Adapter Interface

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M10

## Depends On

```text
TASK-104
```

## Objective

Create an adapter boundary for:

```text
Generic
Codex
Claude Code
Cursor
Gemini CLI
```

## MVP Rule

Generic format is canonical.

Vendor adapters may initially perform only small instruction/file-layout adaptations.

## Acceptance Criteria

- [ ] Generic package does not depend on vendor adapters.
- [ ] Adapter cannot modify canonical project specifications.
- [ ] Unsupported target gracefully falls back or is rejected.
- [ ] Adapter interface is testable independently.

---

# TASK-107 — Implement Export History

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M10

## Depends On

```text
TASK-020
TASK-105
```

## Acceptance Criteria

- [ ] Export records source state version.
- [ ] Export target is recorded.
- [ ] Generated time is recorded.
- [ ] Current project can determine whether last export is stale.
- [ ] Export history respects authorization.

---

# 18. M11 — Product UX Integration

## Goal

Connect the domain systems into the complete end-to-end product experience.

---

# TASK-110 — Implement Application Shell

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M11

## Depends On

```text
TASK-012
```

## References

```text
design.md
```

## Acceptance Criteria

- [ ] Project sidebar exists.
- [ ] Current project is visible.
- [ ] Active navigation state is clear.
- [ ] Responsive navigation works.
- [ ] User menu exists.
- [ ] Accessibility focus behavior works.

---

# TASK-111 — Implement Project Overview

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M11

## Depends On

```text
TASK-081
TASK-082
TASK-084
TASK-110
```

## References

```text
SCREEN-005
design.md
```

## Acceptance Criteria

- [ ] Lifecycle is visible.
- [ ] Readiness is visible.
- [ ] Issue summary is visible.
- [ ] Unresolved decision summary is visible.
- [ ] Next Best Action is visible.
- [ ] Overview avoids irrelevant analytics.

---

# TASK-112 — Implement Specification Change Review

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M11

## Depends On

```text
TASK-061
TASK-069
```

## References

```text
SCREEN-015
FR-090
FR-091
FR-092
```

## Objective

Allow users to review downstream specification changes caused by changed canonical state.

## Acceptance Criteria

- [ ] Affected sections are listed.
- [ ] Before/after meaning is visible.
- [ ] User can accept all changes.
- [ ] User can accept selected changes where architecture permits.
- [ ] User can reject proposed changes.
- [ ] Rejected changes do not silently mutate approved specification.

---

# TASK-113 — Implement Basic Change Impact Service

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M11

## Depends On

```text
TASK-024
TASK-061
```

## Objective

Identify known downstream effects of changed decisions.

## MVP Strategy

Use deterministic traceability/dependency relationships first.

Advanced semantic impact analysis can be added later.

## Acceptance Criteria

- [ ] Decision change lists known affected requirements.
- [ ] Affected specification sections are listed.
- [ ] Affected tasks are listed when available.
- [ ] User sees impact before high-impact change propagation.

---

# TASK-114 — Integrate Agent Kit Workspace

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M11

## Depends On

```text
TASK-083
TASK-095
TASK-105
TASK-110
```

## References

```text
SCREEN-021
SCREEN-022
design.md
```

## Acceptance Criteria

- [ ] Readiness check is visible.
- [ ] Target can be selected.
- [ ] Applicable files can be previewed.
- [ ] Agent Kit can be generated.
- [ ] ZIP can be downloaded.
- [ ] Source state version is visible.
- [ ] Stale previous export is indicated.

---

# TASK-115 — Implement Global Loading & AI Operation States

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M11

## Depends On

```text
TASK-043
TASK-110
```

## Acceptance Criteria

- [ ] User sees meaningful operation labels.
- [ ] UI avoids fake percentages.
- [ ] Long operations expose status.
- [ ] Failure explains whether state changed.
- [ ] Existing approved content remains visible when possible.

---

# TASK-116 — Implement Shared Empty/Error States

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M11

## Depends On

```text
TASK-110
```

## Acceptance Criteria

- [ ] Project empty state exists.
- [ ] Discovery empty/resume states exist.
- [ ] Specification unavailable state exists.
- [ ] Task-plan empty state exists.
- [ ] Export-not-ready state exists.
- [ ] Errors explain recovery action.

---

# TASK-117 — Implement Command Palette

**Status:** BLOCKED
**Priority:** P2
**Milestone:** M11

## Depends On

```text
TASK-110
```

## MVP Commands

```text
Go to Overview
Go to Discovery
Go to Decisions
Go to Issues
Go to Readiness
Go to Tasks
Go to Agent Kit
```

Advanced entity search may be deferred.

---

# TASK-130 — Implement Project Delete/Archive

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M1

## Depends On

```text
TASK-011
TASK-014
```

## Objective

Implement soft-delete and archive for projects (per database-schema.md §63,
spec-decisions.md D-A07/08/09).

## Acceptance Criteria

- [ ] Project soft-delete hides project-owned data without permanent removal.
- [ ] Archive makes the project read-only; restore makes it editable again.
- [ ] Delete/archive enforce project ownership (TASK-014).
- [ ] Retention cleanup is deferrable to a later job.

---

# TASK-131 — Implement Background Job Persistence

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M0

## Depends On

```text
TASK-005
```

## Objective

Persist background-job state for long-running AI operations
(per spec-decisions.md D-A07/08/09).

## Acceptance Criteria

- [ ] Job record stores status (PENDING/RUNNING/SUCCEEDED/FAILED).
- [ ] Job links to its `ai_operations` record where applicable.
- [ ] Failed jobs expose recoverable state and bounded retry.
- [ ] Duplicate execution is preventable via idempotency key.

---

# TASK-132 — Implement Proposed-Change Lifecycle

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M6

## Depends On

```text
TASK-060
TASK-061
```

## Objective

Persist and review AI-generated proposed changes before they replace
approved specifications (per spec-decisions.md D-A07/08/09).

## Acceptance Criteria

- [ ] Proposed change stores target, previous/proposed content, reason.
- [ ] Status PENDING/ACCEPTED/REJECTED is enforced.
- [ ] Accept applies the change atomically; reject leaves approved state intact.
- [ ] Stale proposals are detectable when canonical state moves on.

---

# 19. M12 — Quality, Security & Production Readiness

## Goal

Verify the MVP behaves reliably enough for real users.

---

# TASK-120 — Build Deterministic Domain Test Suite

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M12

## Depends On

Core deterministic domain services.

## Coverage

At minimum:

```text
decision dependencies
identifier generation
project state versioning
traceability
staleness propagation
validation rules
readiness calculation
task dependencies
authorization
Agent Kit manifest
```

## Acceptance Criteria

- [ ] Critical deterministic services have unit tests.
- [ ] Regression tests cover known edge cases.
- [ ] Tests do not depend on live AI providers.

---

# TASK-121 — Build AI Contract Test Suite

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M12

## Depends On

```text
TASK-045
TASK-050
TASK-052
TASK-053
TASK-056
TASK-062
TASK-063
TASK-064
TASK-065
TASK-073
TASK-075
TASK-092
```

## Objective

Test AI capabilities at their application boundaries.

## Acceptance Criteria

- [ ] Structured schemas are tested.
- [ ] Invalid outputs are rejected.
- [ ] Unsupported identifiers are rejected.
- [ ] AI failure preserves state.
- [ ] Provider is mocked for deterministic CI tests.
- [ ] Representative fixtures exist.

---

# TASK-122 — Create Golden Project Evaluation Set

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M12

## References

```text
agents.md
Agent Evaluation
```

## Projects

At minimum:

```text
Simple CRUD SaaS
AI writing application
Personal local-only application
Subscription SaaS
Two-sided platform
```

## Acceptance Criteria

- [ ] Projects contain expected discovery outcomes.
- [ ] Expected decisions are documented.
- [ ] Important specification expectations are documented.
- [ ] Prompt/model changes can be compared against the set.

---

# TASK-123 — Implement Security Review

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M12

## Depends On

Core MVP implementation.

## Review Areas

```text
authentication
authorization
project isolation
AI context isolation
secret handling
download authorization
prompt injection boundaries
input validation
rate limits
temporary export files
```

## Acceptance Criteria

- [ ] Cross-user project access is tested.
- [ ] AI context cannot contain another user's project.
- [ ] Provider secrets never reach client.
- [ ] Export endpoints enforce ownership.
- [ ] Uploaded/reference content is treated as data.
- [ ] Critical findings are resolved before launch.

---

# TASK-124 — Implement Observability

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M12

## Depends On

```text
TASK-043
TASK-105
```

## Objective

Provide operational visibility without exposing sensitive project content unnecessarily.

## Track

```text
request failures
AI operation failures
AI latency
model usage
generation failures
export failures
background-job failures
```

## Acceptance Criteria

- [ ] Errors have correlation identifiers where appropriate.
- [ ] Sensitive project data is not unnecessarily logged.
- [ ] AI failures can be traced to operation metadata.
- [ ] Export failures are diagnosable.

---

# TASK-125 — Implement AI Cost Monitoring

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M12

## Depends On

```text
TASK-043
TASK-046
```

## Objective

Measure whether the MVP can operate economically.

## Track

At minimum:

```text
AI cost per project
AI cost per capability
tokens per operation
average discovery cost
specification generation cost
task-planning cost
```

## Acceptance Criteria

- [ ] Usage can be aggregated by capability.
- [ ] Usage can be aggregated by project.
- [ ] Expensive operations can be identified.
- [ ] No billing dashboard is required for MVP.

---

# TASK-126 — Perform Accessibility Review

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M12

## References

```text
design.md
WCAG 2.1 AA target
```

## Acceptance Criteria

- [ ] Keyboard navigation works for core flow.
- [ ] Focus states are visible.
- [ ] Form controls have labels.
- [ ] Status is not communicated only through color.
- [ ] Dialog/drawer focus behavior is correct.
- [ ] Core text contrast meets target.

---

# TASK-127 — Perform Responsive UX Review

**Status:** BLOCKED
**Priority:** P1
**Milestone:** M12

## Acceptance Criteria

- [ ] Desktop workflow is fully usable.
- [ ] Laptop layout remains usable.
- [ ] Tablet navigation remains functional.
- [ ] Mobile supports project overview.
- [ ] Mobile supports simple Discovery.
- [ ] Mobile supports decision/issue review.
- [ ] Unsupported complex mobile behavior degrades gracefully.

---

# TASK-128 — Build End-to-End MVP Flow Test

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M12

## Depends On

All P0 MVP capabilities.

## Scenario

```text
Create Account
     ↓
Create Project
     ↓
Describe Idea
     ↓
Review Initial Understanding
     ↓
Complete Discovery
     ↓
Confirm Decisions
     ↓
Generate Specifications
     ↓
Resolve Validation Issues
     ↓
Reach Implementation Ready
     ↓
Generate Implementation Plan
     ↓
Generate Agent Kit
     ↓
Download ZIP
```

## Acceptance Criteria

- [ ] Entire flow completes without manual database intervention.
- [ ] State survives reloads.
- [ ] Stable IDs survive generation.
- [ ] Validation correctly blocks readiness when required.
- [ ] ZIP contains current approved project state.
- [ ] Manifest matches exported contents.
- [ ] Unauthorized project access fails.

---

# TASK-129 — Production Deployment

**Status:** BLOCKED
**Priority:** P0
**Milestone:** M12

## Depends On

```text
TASK-123
TASK-124
TASK-128
```

## Objective

Deploy the MVP according to `architecture.md`.

## Acceptance Criteria

- [ ] Production application deploys successfully.
- [ ] Database migrations run safely.
- [ ] Environment secrets are configured securely.
- [ ] AI provider configuration works.
- [ ] HTTPS is enabled.
- [ ] Health monitoring exists.
- [ ] Production smoke test passes.

---

# 18a. Knowledge Taxonomy Mapping

Before TASK-055/TASK-056, define the canonical knowledge taxonomy
mapping (per spec-decisions.md D-KNOW):

```text
PRD FR-030 (Vision, Users, Scope, Features, Business Rules,
Constraints, Entities, Integrations, Technical, UX, AI, NFR)
×
DB Knowledge Domains (PRODUCT, USER, FEATURE, BUSINESS_RULE, ACCESS,
DATA, UX, TECHNICAL, INTEGRATION, AI, NON_FUNCTIONAL)
×
TASK-055 categories (Vision, Users, Personas, Features, Constraints,
Business Rules, Entities, Integrations, Technical, Design, AI, NFR)
×
Discovery domains (Product, Features, Access, Data, UX, Technical,
Integrations, AI, Non-Functional)
```

Deliverable: one mapping table resolving synonyms
(e.g. USER↔Users↔Personas, ACCESS↔Access, DATA↔Entities) with a
single canonical domain per concept.

# 20. Optional MVP Enhancements

The following should only be implemented after all P0 work is stable.

---

# TASK-140 — Implement Specification History Viewer

**Priority:** P2

Allow users to inspect historical specification versions.

---

# TASK-141 — Implement Export History UI

**Priority:** P2

Expose previous Agent Kit exports and their project-state versions.

---

# TASK-142 — Implement Advanced Project Search

**Priority:** P2

Search:

```text
requirements
decisions
tasks
entities
issues
```

---

# TASK-143 — Implement Semantic Change Impact Analyzer

**Priority:** P2

Add `A-022 Change Impact Analyzer` on top of deterministic dependency analysis.

---

# TASK-144 — Implement Dark Mode

**Priority:** P2

Add dark mode using existing design tokens.

---

# TASK-145 — Implement Limited Vendor Export Presets

**Priority:** P2

Add initial presets for selected coding-agent environments without modifying canonical specifications.

---

# 21. Explicitly Deferred Tasks

Do not include these in MVP implementation unless product scope is intentionally changed.

```text
Existing repository import
GitHub synchronization
GitLab synchronization
Repository push
Source-code generation
Autonomous coding
Pull request creation
Pull request review
Deployment automation
CI/CD management
Multi-user project collaboration
Organization workspaces
Repository drift detection
Automatic code → specification synchronization
IDE extensions
Jira integration
Linear integration
Repository browser
Cloud IDE
Production application monitoring
```

---

# 22. Critical Path

The core critical path is:

```text
TASK-001
   ↓
TASK-003
   ↓
TASK-011
   ↓
TASK-020
   ↓
TASK-021
   ↓
TASK-030
   ↓
TASK-040–045
   ↓
TASK-050–056
   ↓
TASK-059–065
   ↓
TASK-070–076
   ↓
TASK-080–082
   ↓
TASK-090–094
   ↓
TASK-100–105
   ↓
TASK-128
   ↓
TASK-129
```

The product should resist expanding scope before this path works end-to-end.

---

# 23. Recommended Build Strategy

Do not implement every subsystem to maximum sophistication before testing the product loop.

Use vertical slices.

---

# 24. Vertical Slice 1 — Idea → Structured Decision

Implement enough to prove:

```text
Create Project
     ↓
Idea Analyst
     ↓
Discovery Question
     ↓
User Answer
     ↓
Answer Interpreter
     ↓
Decision Persisted
```

Primary tasks:

```text
TASK-001
TASK-003
TASK-010
TASK-011
TASK-013
TASK-020
TASK-021
TASK-030
TASK-040
TASK-041
TASK-042
TASK-043
TASK-044
TASK-045
TASK-050
TASK-052
TASK-053
TASK-054
```

Success criterion:

> Natural-language user intent can become validated structured state without silent unsupported assumptions.

---

# 25. Vertical Slice 2 — Decisions → Specification

Prove:

```text
Decisions
     ↓
Project Knowledge
     ↓
PRD
     ↓
Architecture
     ↓
Database
     ↓
Design
```

Primary tasks:

```text
TASK-023
TASK-024
TASK-025
TASK-055
TASK-056
TASK-060
TASK-061
TASK-062
TASK-063
TASK-064
TASK-065
```

Success criterion:

> Multiple documents remain consistent because they originate from the same structured state.

---

# 26. Vertical Slice 3 — Specification → Readiness

Prove:

```text
Specifications
     ↓
Validation
     ↓
Assumptions
     ↓
Readiness
```

Primary tasks:

```text
TASK-070
TASK-071
TASK-072
TASK-073
TASK-074
TASK-075
TASK-076
TASK-080
TASK-081
TASK-082
```

Success criterion:

> The system can explain exactly why a project is or is not implementation-ready.

---

# 27. Vertical Slice 4 — Ready → Executable Plan

Prove:

```text
Requirements
     ↓
Task Planner
     ↓
Milestones
     ↓
Dependencies
     ↓
Coverage
```

Primary tasks:

```text
TASK-090
TASK-091
TASK-092
TASK-093
TASK-094
```

Success criterion:

> Every important requirement can be traced to executable implementation work.

---

# 28. Vertical Slice 5 — Plan → Agent Kit

Prove:

```text
Project State
     ↓
Specifications
     ↓
Tasks
     ↓
context.md
     ↓
AGENTS.md
     ↓
manifest.json
     ↓
ZIP
```

Primary tasks:

```text
TASK-100
TASK-101
TASK-102
TASK-103
TASK-104
TASK-105
```

Success criterion:

> A coding agent can open the exported package and begin implementation without needing Agent Ready Kit's web UI.

---

# 29. MVP Launch Gate

The MVP must not be considered launch-ready until all conditions below are satisfied.

## Product

- [ ] User can create a project.
- [ ] User can complete structured discovery.
- [ ] User can review decisions.
- [ ] User can generate specifications.
- [ ] User can resolve meaningful validation issues.
- [ ] User can view explainable readiness.
- [ ] User can generate implementation tasks.
- [ ] User can download Agent Kit.

## Integrity

- [ ] Confirmed decisions are not silently overwritten.
- [ ] Assumptions are distinguishable.
- [ ] Stable identifiers survive regeneration.
- [ ] Invalid AI output cannot mutate canonical state.
- [ ] Project isolation is enforced.
- [ ] Failed AI operations preserve approved state.

## Quality

- [ ] Core deterministic tests pass.
- [ ] AI contract tests pass.
- [ ] End-to-end MVP test passes.
- [ ] Security review has no unresolved critical findings.

## Export

- [ ] `README.md` generated.
- [ ] `AGENTS.md` generated.
- [ ] `context.md` generated.
- [ ] `docs/PRD.md` generated.
- [ ] `docs/architecture.md` generated.
- [ ] `docs/database-schema.md` generated.
- [ ] `docs/design.md` generated.
- [ ] `docs/tasks.md` generated.
- [ ] Optional AI files follow applicability rules.
- [ ] `.agent-ready/manifest.json` generated.
- [ ] ZIP downloads successfully.

---

# 30. Definition of MVP Done

Agent Ready Kit MVP is complete when a user can begin with:

```text
"I want to build..."
```

and independently reach:

```text
Implementation Ready
```

with an exported package containing enough explicit project context for a coding agent to start implementation without inventing major product behavior.

The final proof is not:

```text
The documents look complete.
```

It is:

```text
A coding agent can begin TASK-001
with clear requirements,
known dependencies,
relevant architecture,
acceptance criteria,
and explicit boundaries.
```

---

# 31. Post-MVP Direction

After the MVP proves that structured preparation improves downstream coding execution, the next product layer can connect the specification system directly to implementation.

Potential progression:

```text
MVP
Agent Kit ZIP
       ↓
V1
Git Repository Sync
       ↓
V2
Specification Drift Detection
       ↓
V3
Coding Agent Execution
       ↓
V4
Implementation Validation
```

These future capabilities should build on the canonical state, traceability, stable identifiers, and versioning implemented in the MVP rather than replacing them.

---

# 32. Final Execution Principle

Implementation should follow this priority:

```text
Correct state
    ↓
Reliable interpretation
    ↓
Consistent specification
    ↓
Explainable validation
    ↓
Executable planning
    ↓
Reliable export
    ↓
Polish
```

Do not reverse this order.

A beautiful interface cannot compensate for unreliable project understanding.

A sophisticated document generator cannot compensate for weak canonical state.

The core product must first prove:

> **Agent Ready Kit can reliably turn human software intent into structured context that another coding agent can execute.**
