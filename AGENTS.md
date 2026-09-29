# Agent Ready Kit

## Coding Agent Instructions

**File:** `AGENTS.md`  
**Applies To:** Entire repository  
**Project:** Agent Ready Kit  
**Product Type:** AI-assisted software specification SaaS  
**Implementation Phase:** MVP

---

# 1. Purpose

This file defines how coding agents must work inside the Agent Ready Kit repository.

It is an execution contract for coding agents such as:

- OpenAI Codex;
- Claude Code;
- Cursor;
- Gemini CLI;
- other compatible coding agents.

This file does **not** define the AI agents implemented inside Agent Ready Kit.

Internal product AI behavior is defined in:

```text
docs/agents.md
```

The purpose of this file is to ensure that coding agents implement the project consistently with its approved product specifications.

---

# 2. Project Mission

Agent Ready Kit transforms a software idea into structured, validated, implementation-ready context for coding agents.

The fundamental workflow is:

```text
IDEA
  ↓
DISCOVERY
  ↓
DECISIONS
  ↓
PROJECT KNOWLEDGE
  ↓
SPECIFICATIONS
  ↓
VALIDATION
  ↓
READINESS
  ↓
TASK PLANNING
  ↓
AGENT KIT
```

The product does not merely generate documents.

Its primary responsibility is to progressively reduce ambiguity until another coding agent can implement the target project without making major unsupported product assumptions.

---

# 3. Core Product Principle

The most important principle in this repository is:

> **Human decides. Agent Ready Kit clarifies. Coding agent executes.**

Implementation must preserve this separation.

Agent Ready Kit may:

- analyze;
- recommend;
- interpret;
- normalize;
- validate;
- explain;
- compile;
- plan.

It must not silently replace important human decisions.

---

# 4. North-Star Engineering Objective

Every implementation decision should support the product's north-star objective:

> **Reduce the number and significance of assumptions a coding agent must make while implementing a software project.**

Do not optimize primarily for:

- document length;
- number of AI features;
- visual novelty;
- generated prose volume;
- autonomous behavior.

Optimize for:

```text
clarity
consistency
traceability
explicit decisions
controlled assumptions
implementation usefulness
```

---

# 5. Repository Source of Truth

The repository specifications are organized as:

```text
AGENTS.md

docs/
├── PRD.md
├── architecture.md
├── database-schema.md
├── agents.md
├── soul.md
├── design.md
└── tasks.md
```

Each file has a distinct responsibility.

---

# 6. Specification Responsibilities

## `docs/PRD.md`

Defines:

```text
WHAT the product must do.
```

Use it for:

- product scope;
- functional requirements;
- product principles;
- user workflows;
- MVP boundaries;
- feature requirements.

---

## `docs/architecture.md`

Defines:

```text
HOW the system is architected.
```

Use it for:

- system boundaries;
- module responsibilities;
- technology decisions;
- AI orchestration architecture;
- transaction boundaries;
- versioning;
- caching;
- background processing;
- failure handling.

---

## `docs/database-schema.md`

Defines:

```text
HOW persistent state is represented.
```

Use it for:

- tables;
- fields;
- relationships;
- constraints;
- indexes;
- persistence invariants;
- canonical versus derived state.

---

## `docs/agents.md`

Defines:

```text
HOW AI capabilities inside Agent Ready Kit behave.
```

Use it for:

- agent responsibilities;
- AI boundaries;
- structured outputs;
- orchestration;
- model routing;
- context building;
- prompt architecture;
- hallucination controls.

Do not confuse this file with root `AGENTS.md`.

---

## `docs/soul.md`

Defines:

```text
HOW Agent Ready Kit's AI should behave toward users.
```

Use it for:

- behavioral principles;
- communication style;
- uncertainty;
- recommendation behavior;
- human authority;
- assumption discipline;
- epistemic humility.

---

## `docs/design.md`

Defines:

```text
HOW the product should behave and feel in the interface.
```

Use it for:

- screens;
- workflows;
- information hierarchy;
- interaction patterns;
- responsive behavior;
- component concepts;
- loading/error states;
- accessibility.

---

## `docs/tasks.md`

Defines:

```text
WHAT should be implemented next.
```

Use it for:

- implementation tasks;
- dependencies;
- milestones;
- acceptance criteria;
- Definition of Done;
- implementation sequencing.

---

# 7. Specification Priority

No single document should be interpreted in isolation.

When implementing a task, use this hierarchy:

```text
Product intent
    ↓
PRD requirements
    ↓
Architecture constraints
    ↓
Database / AI / Design specifications
    ↓
Active implementation task
```

`tasks.md` defines execution order.

It does not override product requirements.

A task is an implementation projection of the specifications.

---

# 8. Specification Conflict Rule

If two specifications appear to conflict:

**Do not silently choose one.**

Do not:

- invent a compromise;
- follow whichever file was read last;
- change product behavior;
- modify architecture implicitly;
- hide the inconsistency inside implementation.

Instead:

1. identify the conflicting statements;
2. determine whether one is clearly outdated from repository context;
3. if not safely resolvable, stop the affected decision;
4. report the conflict;
5. request clarification.

Unrelated implementation work may continue if the conflict does not affect it.

---

# 9. Missing Requirement Rule

If implementation requires a meaningful product decision that is not specified:

**Do not invent it.**

Examples:

```text
authentication strategy
authorization semantics
billing behavior
data ownership
deletion policy
AI authority
critical retry semantics
privacy behavior
major architecture choices
```

Instead:

```text
identify missing decision
explain why implementation depends on it
request clarification
```

Minor implementation details may be chosen autonomously when they:

- do not alter product behavior;
- do not create meaningful architectural commitments;
- are easily reversible;
- follow existing repository conventions.

---

# 10. Human Authority

Confirmed product decisions are authoritative.

A coding agent must not change a confirmed decision because another implementation seems:

```text
easier
cleaner
more modern
more scalable
more familiar
```

A better alternative may be proposed.

It must not be silently implemented.

---

# 11. MVP Scope Discipline

This repository currently targets the MVP.

Do not implement deferred functionality unless explicitly requested.

Deferred areas include:

```text
existing repository analysis
GitHub synchronization
GitLab synchronization
source-code generation
autonomous coding
pull request creation
deployment automation
CI/CD management
team collaboration
organization workspaces
repository drift detection
code → specification synchronization
IDE integrations
project-management integrations
```

Do not build infrastructure for speculative future requirements unless the current architecture explicitly requires an extension point.

---

# 12. Architecture Style

The MVP uses a:

> **Modular Monolith**

Do not introduce:

```text
microservices
distributed workflows
event infrastructure
separate deployment services
graph databases
vector databases
Kubernetes
```

unless the architecture specification is intentionally changed.

Internal domain events may exist.

They should initially remain simple and in-process unless otherwise specified.

---

# 13. Technology Baseline

Follow the approved architecture.

Current baseline:

```text
Next.js
TypeScript
PostgreSQL
Drizzle ORM
React
Tailwind CSS
Managed authentication behind an identity abstraction
Provider-neutral AI integration
```

Do not replace major technology choices without an explicit architecture decision.

---

# 14. Module Boundaries

Keep major product concerns separated.

Expected conceptual modules include:

```text
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

Avoid large generic service layers containing unrelated domain behavior.

Prefer:

```text
domain-oriented modules
```

over:

```text
utils/
services/
helpers/
```

that become dumping grounds.

---

# 15. Dependency Direction

Business rules should not depend directly on:

```text
React
HTTP
AI provider SDKs
database driver details
ZIP implementation
UI components
```

Infrastructure should implement interfaces required by domain/application layers.

Prefer:

```text
Domain
   ↑
Application
   ↑
Infrastructure / Interface
```

where practical within the selected framework.

Do not create abstraction solely for abstraction's sake.

---

# 16. Canonical State Principle

One of the most important architecture rules is:

> **Markdown documents are compiled artifacts. Structured Project Knowledge is the source of truth.**

Never make generated Markdown the authoritative state for:

- decisions;
- requirements;
- entities;
- assumptions;
- validation;
- readiness;
- tasks;
- traceability.

The conceptual direction must remain:

```text
Structured State
      ↓
Specification Compiler
      ↓
Markdown
```

Never:

```text
Markdown
   ↓
parse back into authoritative project state
```

unless a future explicitly approved feature introduces that workflow.

---

# 17. Canonical vs Derived Data

Always distinguish:

### Canonical

User-approved or system-authoritative structured state.

Examples:

```text
decisions
requirements
knowledge
entities
assumptions
```

### Derived

Data calculated or compiled from canonical state.

Examples:

```text
readiness score
specification prose
coverage summary
export package
```

Derived data must not silently become authoritative.

---

# 18. Stable Identifier Rule

Stable identifiers are part of the product contract.

Examples:

```text
FR-014
DEC-AUTH-003
ENT-002
ARC-008
SCREEN-004
TASK-021
```

Never generate stable IDs using:

- array positions;
- display order;
- random LLM output;
- document line numbers.

IDs must be created by deterministic application logic.

Once assigned to a surviving concept, an identifier should remain stable.

---

# 19. Never Reuse Semantic IDs

If:

```text
FR-014
```

is removed or superseded, do not later assign `FR-014` to an unrelated requirement.

Stable identifiers are part of historical traceability.

---

# 20. Traceability

Important implementation objects should remain traceable.

Conceptually:

```text
Decision
   ↓
Requirement
   ↓
Architecture
   ↓
Entity / Screen
   ↓
Task
```

Not every object requires every link.

But links that exist must remain explicit and queryable.

Do not encode important relationships only inside prose.

---

# 21. AI Boundary

LLM output is **untrusted input**.

Never allow model output to directly mutate authoritative project state.

Required flow:

```text
AI Output
   ↓
Structured Schema
   ↓
Schema Validation
   ↓
Identifier Validation
   ↓
Business Rule Validation
   ↓
Candidate Change
   ↓
Application / Human Approval Rules
   ↓
Canonical State
```

Skipping this boundary is an architecture violation.

---

# 22. Structured AI Output

State-changing or state-proposing AI capabilities must prefer structured output.

Do not rely on parsing arbitrary Markdown from an LLM when a structured schema can represent the operation.

Examples requiring structured output:

```text
idea analysis
answer interpretation
knowledge proposals
assumption detection
semantic validation
task planning
change impact analysis
```

Human-facing prose may be generated after structured meaning is established.

---

# 23. AI Must Not Own Business Rules

Use deterministic application code for:

```text
authorization
state transitions
identifier generation
decision dependencies
task dependencies
readiness calculation
versioning
staleness
rate limits
usage limits
transactions
export packaging
```

Use AI for:

```text
semantic interpretation
ambiguity detection
recommendation
specification writing
semantic consistency analysis
task decomposition
```

When deterministic logic can reliably solve a problem, prefer deterministic logic.

---

# 24. AI Provider Isolation

Product modules must not depend directly on a specific AI provider.

Use the provider abstraction defined by architecture.

Conceptually:

```text
AI Capability
      ↓
AI Orchestrator
      ↓
Provider Interface
      ↓
Provider Adapter
```

Provider-specific behavior belongs inside adapters.

---

# 25. Prompt Versioning

Prompts are application artifacts.

Every production AI capability should have:

```text
stable prompt key
prompt version
expected output schema
```

AI operations should record the prompt version used.

Do not maintain important production prompts as arbitrary inline strings scattered through application code.

---

# 26. Context Discipline

Do not send the entire project to every AI operation.

Context must be capability-specific.

Use:

```text
Essential
Recommended
Optional
```

context layers where defined.

Goals:

```text
better relevance
lower latency
lower cost
lower hallucination surface
better privacy
```

---

# 27. AI Failure Rule

An AI failure must never corrupt previously approved project state.

If generation fails:

```text
existing approved state remains valid
operation becomes failed
user receives recoverable error
retry may occur according to policy
```

Never partially persist an unvalidated AI response.

---

# 28. AI Retry Rule

Retries must be:

```text
bounded
idempotent where applicable
observable
limited to recoverable failures
```

Do not create uncontrolled recursive retries.

---

# 29. AI Cost Awareness

Treat AI usage as a production resource.

Avoid:

- duplicate generation;
- unnecessarily large context;
- stronger models for trivial transformations;
- regenerating unchanged sections;
- calling AI for deterministic calculations.

Use dependency fingerprints and caching where specified.

---

# 30. Discovery Architecture

Discovery is not generic chat.

The application owns:

```text
Discovery Map
topic eligibility
priority
decision state
dependencies
completion
```

AI owns:

```text
question formulation
answer interpretation
semantic extraction
```

The application chooses **what needs clarification**.

AI helps determine **how to ask and understand it**.

---

# 31. Discovery Question Selection

Question selection should prioritize unresolved topics using the product's deterministic prioritization model.

Conceptually:

```text
Impact
×
Dependencies
×
Uncertainty
×
MVP Relevance
```

Do not let the LLM freely wander between topics.

---

# 32. Answer Interpretation

A single user answer may resolve multiple project decisions.

The interpreter should support:

```text
explicit decisions
reasonable inference
assumptions
unknowns
```

These categories must remain distinguishable.

Example:

User:

```text
Tidak perlu login, aplikasi cuma saya sendiri yang pakai
dan datanya cukup disimpan di browser.
```

Possible structured interpretation:

```text
authentication.required = false
user_model = single_user
storage = local_browser
collaboration = NOT_APPLICABLE
```

This is preferable to storing only the original conversation message.

---

# 33. Conversation Is Evidence

Discovery conversation history is useful evidence.

It is not the canonical project model.

Never make downstream features depend exclusively on reconstructing project state from chat history.

---

# 34. Decision States

Support the approved decision states:

```text
UNRESOLVED
RECOMMENDED
CONFIRMED
DEFERRED
NOT_APPLICABLE
```

Do not collapse:

```text
RECOMMENDED
```

into:

```text
CONFIRMED
```

without valid confirmation rules.

---

# 35. Provenance

Important knowledge should preserve its origin.

At minimum distinguish concepts equivalent to:

```text
User Explicit
User Implied
AI Recommended
AI Assumed
System Derived
```

Never display AI assumptions as if they were direct user statements.

---

# 36. Assumptions

Assumptions are first-class records.

Do not hide them inside generated prose.

Important assumptions should be:

```text
identifiable
impact-rated
traceable
resolvable
```

Resolution may include:

```text
Confirm
Replace
Defer
Reject
```

---

# 37. Specification Compilation

Specifications should be generated from relevant structured state.

Each specification section should know enough about its dependencies to support staleness detection.

Preferred conceptual model:

```text
Canonical State
     ↓
Dependency Projection
     ↓
Specification Section
     ↓
Rendered Markdown
```

---

# 38. Incremental Regeneration

Do not regenerate every specification whenever one decision changes.

When possible:

```text
changed dependency
      ↓
affected sections
      ↓
mark stale
      ↓
generate proposed update
      ↓
review / accept
```

Unaffected sections should remain stable.

---

# 39. Non-Destructive Change

A changed decision should not silently rewrite all downstream artifacts.

Use:

```text
CURRENT
STALE
PROPOSED
REVIEW_REQUIRED
```

or the approved equivalent.

High-impact downstream changes should be visible before replacing approved content.

---

# 40. Validation Philosophy

Validation has two layers.

## Deterministic Validation

Use code for:

```text
missing required fields
broken references
dependency violations
coverage gaps
invalid state transitions
circular dependencies
```

## Semantic Validation

Use AI for:

```text
contradictory meaning
ambiguous requirements
inconsistent specifications
hidden implementation assumptions
```

Do not use AI as a replacement for deterministic integrity checks.

---

# 41. Validation Issues

Validation findings must be persistent structured records.

Severity:

```text
BLOCKER
HIGH
MEDIUM
LOW
INFO
```

A `BLOCKER` must have real consequences.

Do not label ordinary suggestions as blockers.

---

# 42. Readiness

Agent Readiness must remain explainable.

The system must be able to answer:

```text
Why is this project not ready?
```

without:

```text
Because the AI scored it 72%.
```

Readiness must be based on deterministic criteria.

AI may provide supporting analysis.

AI does not decide the readiness state.

---

# 43. Readiness Dimensions

Maintain the approved dimensions:

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

Changes to readiness criteria are product changes and should not be introduced casually during implementation.

---

# 44. Lifecycle

Current lifecycle:

```text
DISCOVERY
DRAFT
NEEDS_REVIEW
IMPLEMENTATION_READY
```

Lifecycle transitions must be controlled by application rules.

A project may regress from `IMPLEMENTATION_READY` when meaningful later changes introduce new unresolved blockers.

---

# 45. Task Planning

Implementation plans generated by Agent Ready Kit must contain executable work.

A useful task contains:

```text
stable ID
objective
dependencies
references
implementation notes
acceptance criteria
Definition of Done
```

Avoid generated tasks such as:

```text
Build backend
Implement frontend
Add AI
Finish authentication
```

unless they are intentionally milestone-level objects rather than executable tasks.

---

# 46. Task Dependency Rules

Task readiness is derived from dependencies.

Conceptually:

```text
PENDING
  ↓
all dependencies satisfied
  ↓
READY
```

If dependencies are incomplete:

```text
BLOCKED
```

Do not use AI intuition to determine whether dependencies are complete.

---

# 47. Agent Kit

The generic Agent Kit is canonical.

Conceptual output:

```text
project-name/
├── README.md
├── AGENTS.md
├── context.md
├── docs/
│   ├── PRD.md
│   ├── architecture.md
│   ├── database-schema.md
│   ├── design.md
│   ├── agents.md
│   ├── soul.md
│   └── tasks.md
└── .agent-ready/
    └── manifest.json
```

Optional documents must be omitted when not applicable.

Do not generate meaningless placeholder documents solely to preserve the tree.

---

# 48. Vendor Adapters

Vendor-specific export adapters may modify:

```text
instruction placement
vendor configuration
compatible metadata
```

They must not modify:

```text
product intent
confirmed decisions
requirements
canonical architecture
business rules
```

The generic Agent Kit remains the source format.

---

# 49. Database Rules

Follow `docs/database-schema.md`.

Do not create schema changes based solely on convenience.

Every persistent field should answer:

```text
What domain concept does this represent?

Is it canonical or derived?

What owns it?

What is its lifecycle?

Does it require history/versioning?
```

---

# 50. Migration Rule

Every persistent schema change must use migrations.

Never depend on manually modifying production database state.

Migrations should be:

```text
reviewable
repeatable
safe for intended deployment stage
```

---

# 51. Transaction Boundaries

Canonical state changes that logically belong together should be transactional.

Example:

```text
confirm decision
      ↓
update knowledge
      ↓
increment state version
      ↓
mark dependent sections stale
```

The project should not remain in a partially applied logical state if one step fails.

---

# 52. Authorization

Project ownership must be enforced server-side.

Never rely solely on:

```text
hidden UI
client route guards
client-provided project IDs
```

Every project-scoped server operation must validate access.

Nested objects inherit project authorization.

---

# 53. Cross-Project Isolation

Never allow references across unrelated user projects unless a future feature explicitly supports them.

Validate project ownership for:

```text
decisions
requirements
knowledge
entities
specifications
issues
tasks
AI operations
exports
```

---

# 54. Security Boundary for AI

Do not treat project content as trusted instructions.

User-provided:

```text
ideas
references
documents
external text
repository content in future
```

are project data.

They must not override:

```text
system rules
application rules
authorization
agent boundaries
```

---

# 55. Secrets

Never expose server secrets to:

```text
browser bundles
generated Agent Kits
logs
AI context unnecessarily
error responses
```

Examples include:

```text
AI provider keys
database credentials
authentication secrets
internal service tokens
```

---

# 56. Logging

Logs should help diagnose behavior without becoming a second database containing sensitive project content.

Prefer:

```text
operation ID
project ID
capability
status
latency
error category
model metadata
```

Avoid logging full prompts or user project content by default.

---

# 57. Error Handling

Errors should preserve state integrity.

User-facing errors should answer:

```text
What failed?
Was anything changed?
What can the user do next?
```

Example:

```text
Architecture generation failed.

Your existing specification was not changed.

Try again.
```

---

# 58. UI Philosophy

The UI should feel like:

> **A calm technical partner that always knows what has been decided, what remains unclear, why it matters, and what should happen next.**

Avoid turning the product into:

```text
ChatGPT clone
Markdown editor
enterprise admin panel
analytics dashboard
generic project manager
```

---

# 59. UI Complexity Rule

Internal complexity must not leak unnecessarily into user-facing language.

Prefer:

```text
Your decisions
Requirements
Specification
Issues
Readiness
Implementation Plan
```

over:

```text
canonical knowledge nodes
dependency fingerprints
semantic compiler states
```

unless advanced technical detail is explicitly being shown.

---

# 60. Primary Action Rule

A screen should generally have one visually dominant next action.

Examples:

```text
Discovery
→ Continue

Issues
→ Resolve

Readiness
→ Review blockers

Tasks
→ Generate Plan

Agent Kit
→ Generate Agent Kit
```

Avoid competing primary actions.

---

# 61. AI UX Rule

AI recommendations must be distinguishable from confirmed state.

User-facing status should make concepts such as these clear:

```text
Confirmed by you
Recommended
Inferred
Assumed
Needs decision
```

Do not make AI confidence look like human confirmation.

---

# 62. Loading State Rule

For AI operations, describe the actual operation.

Prefer:

```text
Checking specification consistency...
```

over:

```text
AI is thinking...
```

Do not display fake percentage progress.

---

# 63. AI Failure UX

When an AI operation fails:

- keep existing approved content visible;
- explain that approved state was not changed;
- provide retry when appropriate;
- expose technical details only when useful.

---

# 64. Design System

Follow `docs/design.md`.

Use shared design tokens for:

```text
spacing
typography
radius
surface
border
text
semantic status
motion
breakpoints
```

Do not scatter arbitrary values across components when a token should exist.

---

# 65. Component Reuse

Reuse interaction patterns for repeated concepts.

Examples:

```text
StatusBadge
ReferenceChip
ImpactSummary
ReviewBanner
ReadinessBadge
SeverityBadge
```

Do not create visually different representations for the same semantic concept without reason.

---

# 66. Accessibility

Target:

```text
WCAG 2.1 AA
```

Core requirements:

- keyboard accessibility;
- visible focus;
- semantic HTML;
- proper labels;
- sufficient contrast;
- no color-only status communication;
- reduced-motion support where relevant.

Accessibility is part of implementation, not post-launch polish.

---

# 67. Responsive Priority

Primary:

```text
Desktop
Laptop
```

Secondary:

```text
Tablet
```

Mobile must at minimum support useful lightweight workflows defined in `design.md`.

Do not compromise desktop productivity to force every advanced workspace into a mobile-first layout.

---

# 68. Code Quality

Prefer code that is:

```text
clear
typed
testable
domain-oriented
explicit
boring where possible
```

Avoid unnecessary cleverness.

Optimize for maintainability by future humans and coding agents.

---

# 69. TypeScript

Avoid weakening the type system unnecessarily.

Do not use:

```text
any
```

as a default escape hatch.

Prefer:

```text
unknown
```

for untrusted external data followed by explicit validation.

This is especially important for AI responses.

---

# 70. Naming

Use domain terminology from the specifications.

Prefer:

```text
Decision
Requirement
Assumption
Specification
ValidationIssue
Readiness
ImplementationTask
```

Avoid creating alternate terminology for existing domain concepts without a strong reason.

Consistent language improves both human and AI comprehension of the repository.

---

# 71. Comments

Comments should explain:

```text
why
constraint
invariant
non-obvious tradeoff
```

Avoid comments that merely restate code.

Good:

```text
// IDs must survive specification regeneration because
// downstream traceability references them.
```

Bad:

```text
// Increment counter.
counter++;
```

---

# 72. Dependency Policy

Before adding a package, determine whether:

1. the problem genuinely requires a dependency;
2. the framework already provides the capability;
3. the dependency is actively maintained;
4. its size/complexity is justified;
5. it creates lock-in inconsistent with architecture.

Do not add dependencies merely to save a few lines of straightforward code.

---

# 73. Testing Strategy

Testing should prioritize product invariants and high-risk boundaries.

### Unit Tests

Use for:

```text
decision dependencies
stable IDs
state transitions
readiness
task dependencies
coverage
staleness
validation rules
```

### Integration Tests

Use for:

```text
database behavior
transactions
authorization
AI orchestration boundaries
specification persistence
export
```

### End-to-End Tests

Use for critical product journeys.

---

# 74. AI Testing

Normal CI tests must not depend on live AI providers.

Use:

```text
mock provider
fake provider
fixture responses
schema fixtures
```

Live-model evaluation should be separated from deterministic CI.

---

# 75. AI Evaluation

Maintain representative evaluation scenarios for important semantic capabilities.

Examples:

```text
ambiguous software idea
multi-decision user answer
contradictory requirements
hidden assumption
architecture recommendation
task decomposition
```

The goal is not exact prose equality.

Evaluate structural and semantic correctness.

---

# 76. Test Before Completion

Before declaring a coding task complete, run all checks relevant to the changed area.

At minimum when available:

```text
typecheck
lint
unit tests
relevant integration tests
build
```

Do not claim a test passed if it was not run.

If a check cannot be run, report that explicitly.

---

# 77. Acceptance Criteria

The acceptance criteria in `docs/tasks.md` are implementation contracts.

Before marking a task complete:

1. read every acceptance criterion;
2. verify each against implementation;
3. add or update tests where appropriate;
4. report any criterion that remains unmet.

Do not interpret "code compiles" as equivalent to task completion.

---

# 78. Definition of Done

A task is `DONE` only when:

```text
implementation complete
acceptance criteria satisfied
relevant tests pass
lint/type checks pass
architecture respected
no known critical regression introduced
```

Documentation should be updated when implementation changes an explicitly documented developer workflow.

---

# 79. Active Task Rule

Implement one coherent task or explicitly requested group of tasks at a time.

Do not opportunistically implement unrelated future tasks.

This keeps:

```text
changes reviewable
context bounded
failures attributable
progress measurable
```

---

# 80. Task Dependency Rule

Before implementing a task:

1. read its dependency list;
2. verify dependencies are actually satisfied;
3. inspect the implementation when necessary;
4. do not trust task status blindly if repository state contradicts it.

If a dependency is missing, stop the affected task and report it.

---

# 81. Task Execution Workflow

For every implementation task, follow:

```text
1. Identify active TASK-*.

2. Read the complete task.

3. Read referenced FR-* requirements.

4. Read referenced architecture sections.

5. Read relevant database / agent / design sections.

6. Inspect existing implementation.

7. Verify dependencies.

8. Plan the smallest coherent change.

9. Implement.

10. Add/update tests.

11. Run validation checks.

12. Compare result against acceptance criteria.

13. Summarize implementation and remaining issues.
```

Do not skip directly from task title to code.

---

# 82. Context Loading Strategy

Do not load every specification into working context for every task.

Use task references to determine relevant material.

Example:

```text
TASK-053
Implement Answer Interpreter
```

Likely relevant:

```text
PRD
→ FR-014

agents.md
→ A-003 Answer Interpreter

architecture.md
→ AI Orchestration

database-schema.md
→ decisions / discovery / AI operations

tasks.md
→ TASK-053
```

Likely unnecessary:

```text
full export UI specification
all design tokens
future Git synchronization
```

Keep working context focused.

---

# 83. Repository Inspection

Before modifying an existing area:

```text
inspect
understand
then edit
```

Do not assume the repository exactly matches the specification.

The repository may contain:

- partially completed tasks;
- newer implementation details;
- migrations;
- conventions;
- tests;
- fixes not reflected in your immediate context.

Respect existing valid implementation unless the task requires changing it.

---

# 84. Existing Code Rule

Do not rewrite working code merely because you prefer another style.

Refactor when it materially improves:

```text
correctness
maintainability
testability
architecture compliance
```

or when the active task requires it.

Avoid unrelated cleanup in feature commits.

---

# 85. Scope Expansion Rule

If implementation reveals additional work:

Do not silently expand the task.

Classify it:

```text
Required to complete current task
Bug discovered
Specification gap
Future improvement
```

Only the first category should normally be absorbed automatically.

Report the others separately.

---

# 86. No Silent Requirement Changes

Never change a requirement solely to make implementation easier.

Do not transform:

```text
"must"
```

into:

```text
"should"
```

or remove acceptance criteria because implementation is difficult.

Raise the conflict instead.

---

# 87. No Fake Completion

Do not:

- mark TODO code as complete;
- hide failed tests;
- replace implementation with hardcoded demo data unless explicitly requested;
- silently skip acceptance criteria;
- claim an integration works without exercising the relevant boundary.

Partial completion should be reported as partial completion.

---

# 88. No Premature Abstraction

The MVP should remain maintainable without speculative frameworks.

Avoid building:

```text
generic workflow engine
universal plugin architecture
custom event bus
generic graph framework
internal DSL
microservice abstraction
```

unless current requirements genuinely need them.

Use the simplest architecture that preserves known extension boundaries.

---

# 89. No Premature Scale Engineering

Do not optimize for millions of users before the product loop works.

Prioritize:

```text
correctness
data integrity
AI reliability
explainability
maintainability
cost awareness
```

before extreme scale.

---

# 90. Performance

Avoid obvious inefficiencies such as:

```text
N+1 database queries
repeated AI calls
loading full project history unnecessarily
regenerating unchanged specifications
large client bundles from server-only libraries
```

Measure before introducing complex optimization.

---

# 91. Database Query Discipline

Prefer explicit, scoped queries.

Project-scoped operations should make project ownership visible in query/application boundaries.

Avoid fetching entire project graphs when only a narrow projection is required.

---

# 92. Versioning

Keep distinct concepts distinct:

```text
Project State Version
Specification Version
Prompt Version
Agent Kit / Export Version
```

Do not collapse them into one generic version number.

Each answers a different question.

---

# 93. Staleness

When upstream canonical state changes, dependent derived artifacts may become stale.

Do not automatically treat stale content as current.

The UI and domain state must be able to distinguish:

```text
CURRENT
STALE
PROPOSED
REVIEW_REQUIRED
```

where applicable.

---

# 94. Idempotency

Operations likely to be retried should be designed for idempotency.

Examples:

```text
AI generation requests
candidate application
background jobs
export generation
```

A network retry should not accidentally duplicate canonical records.

---

# 95. Background Jobs

Do not introduce asynchronous execution merely because an operation uses AI.

Use it when the operation meaningfully benefits from:

```text
non-blocking execution
retry
long-running processing
recoverability
```

Keep the initial implementation simple where synchronous execution is sufficient.

---

# 96. Export Integrity

An Agent Kit export must correspond to a known project state version.

Never create a package containing an uncontrolled mixture of artifacts compiled from different incompatible project states.

The manifest must identify the source state.

---

# 97. Generated File Integrity

Before completing an export:

verify:

```text
required files exist
manifest paths are correct
optional files follow applicability
no secrets are included
source state version is correct
generated Markdown is valid text
ZIP can be opened
```

---

# 98. README Responsibility

Repository `README.md` is for humans working on Agent Ready Kit.

It should eventually contain:

```text
project overview
local setup
environment variables
development commands
test commands
build commands
architecture/documentation links
```

Do not duplicate all specification content inside README.

---

# 99. Documentation Update Rule

Update documentation when implementation intentionally changes:

```text
developer setup
architecture
persistent model
public contract
important workflow
```

Do not update product specifications merely to rationalize an accidental implementation deviation.

Implementation should follow the specification unless the decision itself is intentionally changed.

---

# 100. Commit/Change Hygiene

When operating in a version-controlled environment:

- keep changes focused;
- avoid unrelated formatting churn;
- do not rewrite unrelated files;
- preserve user changes;
- inspect diff before completion.

Do not discard existing work without explicit authorization.

---

# 101. Destructive Operations

Do not execute destructive repository or database operations unless they are necessary and clearly authorized.

Examples requiring care:

```text
resetting database
dropping tables
rewriting migrations
force pushing
deleting branches
removing user data
```

Prefer reversible approaches.

---

# 102. User Changes

Treat existing user-authored modifications as intentional unless there is evidence otherwise.

Do not overwrite them merely because generated specifications or previous assumptions differ.

When a user modification conflicts with the active task, surface the conflict.

---

# 103. Implementation Reporting

After completing a task, report concisely:

```text
Task
What changed
Important implementation decisions
Tests/checks executed
Acceptance criteria status
Remaining issues
```

Do not produce a long narrative unless useful.

---

# 104. When Blocked

If blocked, report:

```text
Blocked task
Blocking dependency or decision
Why it matters
Relevant specification reference
Minimum clarification required
```

Do not fabricate an answer merely to continue.

---

# 105. When Uncertain

Use this hierarchy:

```text
Repository implementation
        +
Approved specifications
        ↓
Can the answer be determined safely?
        │
   ┌────┴────┐
   │         │
  Yes        No
   │         │
Implement   Ask
```

Do not ask questions for trivial reversible implementation details.

Do ask when ambiguity changes meaningful product behavior or architecture.

---

# 106. Preferred Engineering Behavior

The coding agent should behave like:

> A careful senior engineer implementing an already-designed product.

Not like:

> A product manager redesigning the application while coding it.

The coding agent may challenge a design when it discovers a real technical issue.

It must explain the tradeoff before changing the approved direction.

---

# 107. First Implementation Strategy

Do not attempt to build the entire product in one pass.

Use the vertical slices defined in `docs/tasks.md`.

Start with:

```text
Vertical Slice 1

Idea
 ↓
Idea Analyst
 ↓
Discovery
 ↓
User Answer
 ↓
Answer Interpreter
 ↓
Validated Decision
```

This proves the core product mechanism before investing heavily in downstream compilation.

---

# 108. Initial Execution Order

The first implementation sequence should begin with the foundation tasks defined in `docs/tasks.md`.

Conceptually:

```text
TASK-001
Initialize Application Repository

        ↓

TASK-002
Application Module Boundaries

        ↓

TASK-003
Database Infrastructure

        ↓

Foundation for subsequent domain work
```

Actual execution must still respect the dependency graph in `tasks.md`.

---

# 109. MVP Proof

The MVP is not proven when:

```text
seven Markdown documents can be generated
```

It is proven when:

```text
human intent
      ↓
structured understanding
      ↓
explicit decisions
      ↓
consistent specifications
      ↓
validated readiness
      ↓
executable tasks
      ↓
Agent Kit
```

works reliably.

---

# 110. Product Invariants

The following invariants must remain true throughout implementation.

### AGENT-IMPL-INV-001

AI output never directly mutates authoritative project state without application validation.

### AGENT-IMPL-INV-002

Confirmed user decisions are never silently replaced by AI recommendations.

### AGENT-IMPL-INV-003

Generated Markdown is never the primary source of truth.

### AGENT-IMPL-INV-004

Stable semantic identifiers survive regeneration.

### AGENT-IMPL-INV-005

Readiness is deterministic and explainable.

### AGENT-IMPL-INV-006

Project authorization is enforced server-side.

### AGENT-IMPL-INV-007

AI provider details do not leak into core domain logic.

### AGENT-IMPL-INV-008

Failed AI operations do not corrupt approved state.

### AGENT-IMPL-INV-009

High-impact changes are not silently propagated through approved artifacts.

### AGENT-IMPL-INV-010

Task completion requires acceptance-criteria verification.

### AGENT-IMPL-INV-011

MVP implementation does not silently absorb deferred product scope.

### AGENT-IMPL-INV-012

Coding agents do not invent missing product decisions to avoid asking for clarification.

---

# 111. Pre-Implementation Checklist

Before coding an active task:

```text
□ I know the active TASK-*.

□ I read its full objective.

□ I checked its dependencies.

□ I read the relevant requirements.

□ I read the relevant architecture constraints.

□ I inspected existing implementation.

□ I know the acceptance criteria.

□ I know which product invariants apply.

□ I am not introducing unrelated scope.

□ I know how I will verify completion.
```

If several of these cannot be answered, gather the missing context before implementation.

---

# 112. Completion Checklist

Before declaring the task complete:

```text
□ Implementation matches the requirement.

□ Architecture boundaries remain intact.

□ Canonical/derived state boundaries remain intact.

□ Authorization is enforced where applicable.

□ AI output is validated where applicable.

□ Stable identifiers are preserved.

□ Relevant tests were added or updated.

□ Relevant tests pass.

□ Typecheck passes.

□ Lint passes.

□ Build passes when relevant.

□ Acceptance criteria were checked individually.

□ No unrelated requirement was silently changed.

□ Remaining limitations are reported.
```

---

# 113. Final Instruction

When speed and correctness conflict, prefer correctness for:

```text
canonical project state
user decisions
data integrity
authorization
AI boundaries
traceability
readiness
```

When sophistication and simplicity conflict, prefer simplicity unless sophistication is required by a documented constraint.

When an AI-generated recommendation and a confirmed human decision conflict:

> **The confirmed human decision wins.**

When implementation and specification conflict:

> **Surface the conflict. Do not hide it.**

When information is genuinely insufficient:

> **Say that it is insufficient instead of inventing certainty.**

The coding agent's job is not to redesign Agent Ready Kit.

Its job is to faithfully turn the approved Agent Ready Kit specification into reliable software.