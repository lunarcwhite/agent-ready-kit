# Agent Ready Kit

## Database Schema

**Document:** database-schema.md  
**Status:** Draft v1  
**Database:** PostgreSQL  
**ORM:** Drizzle ORM  
**Architecture:** Modular Monolith  
**Primary Principle:** Structured Project Knowledge is the canonical source of truth.

---

# 1. Database Goals

Database Agent Ready Kit harus mendukung:

- multi-user SaaS;
- project ownership;
- adaptive discovery;
- conversation history;
- structured decisions;
- decision dependencies;
- canonical project knowledge;
- requirements;
- specification compilation;
- section-level versioning;
- assumptions;
- validation issues;
- traceability;
- task planning;
- task dependencies;
- AI operation tracking;
- Agent Kit export;
- future repository integration.

Database harus menjaga pemisahan antara:

```text id="k7edfj"
Conversation
Decision
Knowledge
Specification
Task
Export
```

Kelima konsep tersebut tidak boleh dilebur menjadi satu JSON document besar.

---

# 2. General Conventions

Primary keys menggunakan:

```text id="kwup7q"
UUID
```

Semua tabel utama memiliki:

```text id="j4b1pq"
id
created_at
updated_at
```

Jika relevan, gunakan:

```text id="4ckxjj"
deleted_at
```

untuk soft deletion.

Gunakan PostgreSQL `jsonb` untuk data fleksibel, tetapi domain relationship penting tetap menggunakan relational structure.

---

# 3. High-Level Entity Map

```text id="m3wpvu"
users
  │
  └── projects
        │
        ├── discovery_sessions
        │      └── discovery_messages
        │
        ├── discovery_nodes
        │
        ├── decisions
        │      └── decision_dependencies
        │
        ├── knowledge_items
        │
        ├── requirements
        │
        ├── specification_documents
        │      ├── specification_sections
        │      └── specification_versions
        │
        ├── assumptions
        │
        ├── validation_issues
        │
        ├── traceability_links
        │
        ├── milestones
        │      └── tasks
        │             └── task_dependencies
        │
        ├── ai_operations
        │
        └── exports
```

---

# 4. users

Represents SaaS users.

```text id="z2vpj7"
users

id                  uuid PK
email               varchar UNIQUE
name                varchar nullable
avatar_url          text nullable

created_at          timestamptz
updated_at          timestamptz
```

Authentication-provider-specific fields should preferably not dominate this table.

External identity mapping may be handled separately if required by the selected auth provider.

---

# 5. projects

Represents a software project being prepared.

```text id="xg6j89"
projects

id                  uuid PK
user_id             uuid FK → users.id

name                varchar
slug                varchar
description         text nullable

lifecycle_state     enum
discovery_level     enum

readiness_score     integer default 0
state_version       integer default 1

created_at          timestamptz
updated_at          timestamptz
deleted_at          timestamptz nullable
```

Recommended lifecycle states:

```text id="57g4kn"
DISCOVERY
DRAFT
NEEDS_REVIEW
IMPLEMENTATION_READY
```

Recommended discovery levels:

```text id="p5i3kb"
INITIAL
QUICK_DRAFT
DETAILED
AGENT_READY
```

---

# 6. Project State Version

`state_version` increments whenever canonical project state meaningfully changes.

Example:

```text id="rm6bqp"
state_version = 14
```

An export can therefore record:

```text id="u1h7k3"
generated_from_state_version = 14
```

This allows Agent Ready Kit to know exactly which project state produced an Agent Kit.

---

# 7. project_inputs

Stores initial project information.

```text id="l8mftf"
project_inputs

id                  uuid PK
project_id          uuid FK → projects.id

idea                text
target_users        text nullable
constraints         text nullable
references          jsonb nullable

created_at          timestamptz
updated_at          timestamptz
```

This preserves the user's original idea separately from normalized project knowledge.

---

# 8. discovery_sessions

Represents a Discovery conversation session.

```text id="bx5ec7"
discovery_sessions

id                  uuid PK
project_id          uuid FK → projects.id

status              enum
started_at          timestamptz
completed_at        timestamptz nullable

created_at          timestamptz
updated_at          timestamptz
```

Status:

```text id="9hdwdm"
ACTIVE
COMPLETED
ABANDONED
```

A project may have multiple Discovery sessions.

---

# 9. discovery_messages

Stores raw conversation history.

```text id="1a3ozb"
discovery_messages

id                  uuid PK
session_id          uuid FK → discovery_sessions.id

role                enum
content             text

sequence_number     integer

metadata            jsonb nullable

created_at          timestamptz
```

Role:

```text id="9jic7e"
USER
ASSISTANT
SYSTEM
```

Unique constraint:

```text id="bptqwu"
(session_id, sequence_number)
```

Conversation history is evidence, not canonical specification state.

---

# 10. discovery_nodes

Represents the current Discovery Map.

```text id="1tz6xn"
discovery_nodes

id                  uuid PK
project_id          uuid FK → projects.id

node_key            varchar
category            varchar

title               varchar
description         text nullable

status              enum

priority            integer default 0
impact              enum nullable

metadata            jsonb nullable

created_at          timestamptz
updated_at          timestamptz
```

Unique:

```text id="ywjvux"
(project_id, node_key)
```

Status:

```text id="m4z0n5"
UNKNOWN
PARTIAL
RESOLVED
NOT_APPLICABLE
```

Example:

```text id="3zmj0m"
node_key:
access.authentication

status:
RESOLVED
```

---

# 11. decisions

One of the most important tables.

```text id="txa2nq"
decisions

id                  uuid PK
project_id          uuid FK → projects.id

decision_key        varchar

decision_code       varchar

category            varchar
title               varchar

value               jsonb nullable
rationale           text nullable

status              enum
impact              enum

source_type         enum
confidence          enum

version             integer default 1

confirmed_at        timestamptz nullable

created_at          timestamptz
updated_at          timestamptz
```

Unique:

```text id="abz5kq"
(project_id, decision_key)
(project_id, decision_code)
```

`decision_key` is the dot-notation logic key
(e.g. `authentication.required`). `decision_code` is the stable
human-facing code with category infix (e.g. `DEC-AUTH-001),
used in UI and traceability (per spec-decisions.md D-C07).

---

# 12. Decision Status

```text id="2z2qt5"
UNRESOLVED
RECOMMENDED
CONFIRMED
DEFERRED
NOT_APPLICABLE
```

---

# 13. Decision Impact

```text id="7t0jwu"
HIGH
MEDIUM
LOW
```

Three levels only (per spec-decisions.md D-CRIT). Decision impact is a
priority weight, not a readiness gate — unlike the BLOCKER validation
severity, it never blocks IMPLEMENTATION_READY by itself.

---

# 14. Decision Source

```text id="t81i6a"
USER
AI_RECOMMENDATION
AI_INFERENCE
SYSTEM
```

---

# 15. Decision Confidence

```text id="umzksj"
EXPLICIT
INFERRED
ASSUMED
```

---

# 16. decision_history

Keeps historical decision values.

```text id="b0kk23"
decision_history

id                  uuid PK
decision_id         uuid FK → decisions.id

version             integer

value               jsonb nullable
rationale           text nullable

status              enum
source_type         enum

changed_by          uuid nullable
change_reason       text nullable

created_at          timestamptz
```

This allows Agent Ready Kit to understand how important project decisions evolved.

---

# 17. decision_dependencies

Represents the Decision Graph.

```text id="7uuvcn"
decision_dependencies

id                  uuid PK
project_id          uuid FK → projects.id

source_decision_key varchar
target_decision_key varchar

condition           jsonb nullable

effect              enum

created_at          timestamptz
```

Potential effects:

```text id="81s85m"
ACTIVATE
REQUIRE
INVALIDATE
MARK_NOT_APPLICABLE
```

Example:

```text id="9a5dpd"
source:
authentication.required

condition:
value == false

target:
authentication.methods

effect:
MARK_NOT_APPLICABLE
```

Decision dependency definitions may eventually become global templates rather than project-specific records.

---

# 18. knowledge_items

Stores canonical Project Knowledge.

```text id="4dkl62"
knowledge_items

id                  uuid PK
project_id          uuid FK → projects.id

knowledge_key       varchar
domain              varchar

title               varchar
content             jsonb

confidence          enum
status              enum

created_at          timestamptz
updated_at          timestamptz
```

Unique:

```text id="k6u1gv"
(project_id, knowledge_key)
```

---

# 19. Knowledge Domains

Canonical domain set (see tasks.md §18a for the mapping from PRD FR-030,
TASK-055, and Discovery domains):

```text id="b2g8sk"
PRODUCT
USER
FEATURE
BUSINESS_RULE
ACCESS
DATA
UX
TECHNICAL
INTEGRATION
AI
NON_FUNCTIONAL
```

Output language default is `"en"` (allowed: `"en"`, `"id"`);
see `project_settings` §60 and spec-decisions.md D-A10a.
Changing output language must not change canonical intent.

---

# 20. Knowledge Status

```text id="ij1lx9"
CURRENT
STALE
SUPERSEDED
```

---

# 21. knowledge_sources

Tracks provenance.

```text id="kfz11d"
knowledge_sources

id                  uuid PK
knowledge_item_id   uuid FK → knowledge_items.id

source_type         enum
source_id           uuid nullable

created_at          timestamptz
```

Source type:

```text id="90lfkz"
DECISION
USER_MESSAGE
PROJECT_INPUT
AI_INFERENCE
REQUIREMENT
```

This lets the system answer:

> Why do we believe this?

---

# 22. requirements

Stores product requirements independently of rendered PRD text.

```text id="nnt7u1"
requirements

id                  uuid PK
project_id          uuid FK → projects.id

requirement_code    varchar

type                enum

title               varchar
description         text

priority            enum
status              enum

acceptance_criteria jsonb nullable
metadata            jsonb nullable

created_at          timestamptz
updated_at          timestamptz
```

Unique:

```text id="cc75bi"
(project_id, requirement_code)
```

Example:

```text id="vif54r"
FR-023
Delete Project
```

---

# 23. Requirement Type

```text id="a8jz4v"
FUNCTIONAL
NON_FUNCTIONAL
BUSINESS_RULE
CONSTRAINT
```

---

# 24. Requirement Status

```text id="1o2f27"
DRAFT
CONFIRMED
DEFERRED
SUPERSEDED
REMOVED
```

`SUPERSEDED` marks a requirement replaced by a newer one; its code is
never reused (per spec-decisions.md D-A06).

---

# 25. Requirement Priority

```text id="dvw5b9"
MUST
SHOULD
COULD
WONT
```

---

# 26. domain_entities

Stores important domain entities independently of database implementation.

This distinction matters.

A Product Entity such as:

```text id="5gknhc"
Project
User
Story
Character
```

exists before a physical database table is generated.

```text id="58mzqg"
domain_entities

id                  uuid PK
project_id          uuid FK → projects.id

entity_code         varchar
name                varchar
description         text nullable

ownership_model     jsonb nullable
lifecycle           jsonb nullable

status              enum

created_at          timestamptz
updated_at          timestamptz
```

Example code:

```text id="pyb6us"
ENT-001
```

---

# 27. entity_attributes

```text id="h6avrv"
entity_attributes

id                  uuid PK
entity_id           uuid FK → domain_entities.id

name                varchar
data_type           varchar

required            boolean
unique_value        boolean default false

default_value       jsonb nullable
constraints         jsonb nullable

description         text nullable

created_at          timestamptz
updated_at          timestamptz
```

---

# 28. entity_relationships

```text id="4b56l3"
entity_relationships

id                  uuid PK
project_id          uuid FK → projects.id

source_entity_id    uuid FK → domain_entities.id
target_entity_id    uuid FK → domain_entities.id

relationship_type   enum

name                varchar nullable
description         text nullable

metadata            jsonb nullable

created_at          timestamptz
```

Types:

```text id="z2y96s"
ONE_TO_ONE
ONE_TO_MANY
MANY_TO_MANY
```

---

# 29. specification_documents

Represents logical documents.

```text id="e2sm91"
specification_documents

id                  uuid PK
project_id          uuid FK → projects.id

document_type       enum

title               varchar

status              enum
current_version     integer default 1

created_at          timestamptz
updated_at          timestamptz
```

Document types:

```text id="d30sg6"
PRD
ARCHITECTURE
DATABASE_SCHEMA
DESIGN
PRODUCT_AGENTS
SOUL
TASKS
CONTEXT
AGENT_INSTRUCTIONS
```

---

# 30. Specification Document Status

```text id="5d6v8w"
DRAFT
CURRENT
STALE
REVIEW_REQUIRED
```

---

# 31. specification_sections

Specifications are divided into independently manageable sections.

```text id="q1mrgm"
specification_sections

id                  uuid PK
document_id         uuid FK → specification_documents.id

section_key         varchar
title               varchar

sort_order          integer

structured_content  jsonb nullable
rendered_content    text

status              enum

dependency_hash     varchar nullable

created_at          timestamptz
updated_at          timestamptz
```

Unique:

```text id="6q3ckk"
(document_id, section_key)
```

---

# 32. Section Status

```text id="mmtg51"
CURRENT
STALE
PROPOSED
REVIEW_REQUIRED
```

Example:

```text id="87z1py"
architecture.authentication

status:
STALE
```

---

# 33. specification_versions

Stores approved document snapshots.

```text id="m7mdp9"
specification_versions

id                  uuid PK
document_id         uuid FK → specification_documents.id

version             integer

content             text

project_state_version integer

created_at          timestamptz
```

Unique:

```text id="rmk40g"
(document_id, version)
```

This allows:

```text id="17ebwk"
PRD v1
PRD v2
PRD v3
```

without implementing Git internally.

---

# 34. section_dependencies

Tracks which canonical elements affect a specification section.

```text id="b4jws1"
section_dependencies

id                  uuid PK
section_id          uuid FK → specification_sections.id

source_type         enum
source_id           uuid

created_at          timestamptz
```

Source type examples:

```text id="8r8h24"
DECISION
KNOWLEDGE
REQUIREMENT
ENTITY
```

This is the foundation of incremental compilation.

---

# 35. proposed_changes

Stores AI-generated changes awaiting review.

```text id="q06e3h"
proposed_changes

id                  uuid PK
project_id          uuid FK → projects.id

target_type         enum
target_id           uuid

change_type         enum

previous_content    jsonb nullable
proposed_content    jsonb

reason              text nullable

status              enum

created_at          timestamptz
reviewed_at         timestamptz nullable
```

Status:

```text id="hiy89n"
PENDING
ACCEPTED
REJECTED
```

---

# 36. assumptions

Assumptions are first-class project objects.

```text id="ll4i7j"
assumptions

id                  uuid PK
project_id          uuid FK → projects.id

assumption_code     varchar

title               varchar
description         text

impact              enum
confidence          enum

source              enum

status              enum

resolution          text nullable
resolved_at         timestamptz nullable

created_at          timestamptz
updated_at          timestamptz
```

`source` records the assumption's origin (`USER_IMPLIED`,
`AI_ASSUMED`, `AI_RECOMMENDED`, `SYSTEM_DERIVED`; ratified per
TASK-074 — directly stated facts are knowledge or decisions, never
assumptions, so there is no `USER_EXPLICIT`). `confidence` is strength
of belief (`HIGH`, `MEDIUM`, `LOW`), not the EXPLICIT/INFERRED/ASSUMED
provenance scale. `resolution` keeps the human's Confirm / Reject /
Defer reason.

Unique:

```text id="xyuwml"
(project_id, assumption_code)
```

---

# 37. Assumption Status

```text id="tl8d51"
OPEN
CONFIRMED
REPLACED
DEFERRED
REJECTED
```

---

# 38. assumption_impacts

Tracks affected specification elements.

```text id="9c6jfe"
assumption_impacts

id                  uuid PK
assumption_id       uuid FK → assumptions.id

target_type         varchar
target_id           uuid

created_at          timestamptz
```

---

# 39. validation_issues

Stores Validation Engine findings.

```text id="owjq63"
validation_issues

id                  uuid PK
project_id          uuid FK → projects.id

issue_code          varchar

type                enum
severity            enum

title               varchar
description         text

status              enum

metadata            jsonb nullable

created_at          timestamptz
updated_at          timestamptz
resolved_at         timestamptz nullable
```

---

# 40. Validation Types

```text id="8kg48e"
COMPLETENESS
CONSISTENCY
DEPENDENCY
IMPLEMENTATION_COVERAGE
ASSUMPTION
ORPHAN
SECURITY
```

---

# 41. Severity

```text id="c5w48q"
BLOCKER
HIGH
MEDIUM
LOW
INFO
```

---

# 42. Issue Status

```text id="2bj44m"
OPEN
RESOLVED
IGNORED
```

---

# 43. issue_references

Links issues to affected project objects.

```text id="k7hf8a"
issue_references

id                  uuid PK
issue_id            uuid FK → validation_issues.id

reference_type      varchar
reference_id        uuid

relationship        enum

created_at          timestamptz
```

Relationship:

```text id="oboh99"
SOURCE
AFFECTED
```

---

# 44. traceability_links

Generic traceability graph.

```text id="5r1ft3"
traceability_links

id                  uuid PK
project_id          uuid FK → projects.id

source_type         varchar
source_id           uuid

target_type         varchar
target_id           uuid

relationship_type   varchar

created_at          timestamptz
```

Example:

```text id="qll7yp"
FR-023
   ↓ implemented_by
ARC-004

FR-023
   ↓ uses
ENT-003

FR-023
   ↓ executed_by
TASK-031
```

Indexes should exist on both source and target references.

---

# 45. screens

Major UI screens may be modeled independently to improve traceability.

```text id="h8az8q"
screens

id                  uuid PK
project_id          uuid FK → projects.id

screen_code         varchar
name                varchar

description         text nullable
route_hint          varchar nullable

status              enum

metadata            jsonb nullable

created_at          timestamptz
updated_at          timestamptz
```

Example:

```text id="y7ocfw"
SCREEN-004
Project Creation
```

Screen status (per spec-decisions.md D-C09):

```text id="scrstat1"
DRAFT
CONFIRMED
DEFERRED
SUPERSEDED
REMOVED
```

Unique:

```text id="scrunq1"
(project_id, screen_code)
```

---

# 45a. architecture_components

Architecture components persist the `ARC-*` stable identifiers used in
traceability (per spec-decisions.md D-C08).

```text id="arccmp1"
architecture_components

id                  uuid PK
project_id          uuid FK → projects.id

component_code      varchar

name                varchar
description         text nullable

status              enum

metadata            jsonb nullable

created_at          timestamptz
updated_at          timestamptz
```

Component status uses the same enum as screens:

```text id="arccmp2"
DRAFT
CONFIRMED
DEFERRED
SUPERSEDED
REMOVED
```

Unique:

```text id="arccmp3"
(project_id, component_code)
```

---

# 46. milestones

```text id="vg44h9"
milestones

id                  uuid PK
project_id          uuid FK → projects.id

milestone_code      varchar

title               varchar
description         text nullable

sort_order          integer
status              enum

created_at          timestamptz
updated_at          timestamptz
```

Status:

```text id="2s0l40"
PLANNED
ACTIVE
COMPLETED
```

---

# 47. tasks

```text id="dr8g31"
tasks

id                  uuid PK
project_id          uuid FK → projects.id
milestone_id        uuid FK → milestones.id nullable

task_code           varchar

title               varchar
objective           text

status              enum
priority            enum

implementation_notes text nullable

acceptance_criteria jsonb
definition_of_done  jsonb

sort_order          integer nullable

created_at          timestamptz
updated_at          timestamptz
```

Unique:

```text id="8j76b8"
(project_id, task_code)
```

---

# 48. Task Status

For MVP:

```text id="c1l91e"
PENDING
READY
BLOCKED
REVIEW_REQUIRED
DONE
```

Even though Agent Ready Kit does not execute code yet, these states prepare the format for future agent execution.

---

# 49. task_dependencies

```text id="kbb6id"
task_dependencies

id                  uuid PK

task_id             uuid FK → tasks.id
depends_on_task_id  uuid FK → tasks.id

created_at          timestamptz
```

Unique:

```text id="89usfs"
(task_id, depends_on_task_id)
```

Self-dependency must be prohibited.

Circular dependency detection should occur in application logic.

---

# 50. Task Traceability

Do not duplicate all references as task columns.

Use:

```text id="bce5mf"
traceability_links
```

Example:

```text id="8bjzvp"
TASK-023
implements
FR-014

TASK-023
uses
ENT-006

TASK-023
implements_screen
SCREEN-009
```

This makes relationships extensible.

---

# 51. readiness_snapshots

Stores explainable readiness calculations.

```text id="cd6g39"
readiness_snapshots

id                  uuid PK
project_id          uuid FK → projects.id

project_state_version integer

overall_score       integer
readiness_state     enum

dimensions          jsonb
blocking_reasons    jsonb

created_at          timestamptz
```

Example:

```json id="y88h1r"
{
  "product": 100,
  "features": 92,
  "businessRules": 80,
  "data": 94,
  "ux": 82,
  "architecture": 96,
  "security": 74,
  "execution": 88
}
```

This allows historical readiness comparison without recalculating old states.

---

# 52. ai_operations

Critical for SaaS cost tracking.

```text id="qk6oei"
ai_operations

id                  uuid PK
project_id          uuid FK → projects.id nullable
user_id             uuid FK → users.id

operation_type      varchar

capability          varchar

provider            varchar
model               varchar

prompt_key          varchar
prompt_version      varchar

project_state_version integer nullable

status              enum

input_tokens        integer nullable
output_tokens       integer nullable

estimated_cost      numeric nullable

latency_ms          integer nullable

error_code          varchar nullable
error_message       text nullable

started_at          timestamptz
completed_at        timestamptz nullable

created_at          timestamptz
```

---

# 53. AI Operation Status

```text id="pxjly1"
PENDING
RUNNING
SUCCEEDED
FAILED
```

---

# 54. AI Operation Types

Examples:

```text id="wq79fb"
IDEA_ANALYSIS
DISCOVERY_QUESTION
ANSWER_EXTRACTION
KNOWLEDGE_CURATION
SPECIFICATION_GENERATION
SPECIFICATION_PATCH
SEMANTIC_VALIDATION
ASSUMPTION_DETECTION
CHANGE_IMPACT_ANALYSIS
TASK_GENERATION
CONTEXT_COMPILATION
INSTRUCTION_COMPILATION
DESIGN_COMPILATION
PRODUCT_AGENT_COMPILATION
SOUL_COMPILATION
```

---

# 55. ai_operation_payloads

Large AI payloads should be separated from the main operations table.

```text id="og54cf"
ai_operation_payloads

id                  uuid PK
ai_operation_id     uuid FK → ai_operations.id

input_payload       jsonb nullable
output_payload      jsonb nullable

created_at          timestamptz
```

Retention may later be limited for privacy and storage reasons.

---

# 56. exports

Tracks Agent Kit generation.

```text id="l68d2j"
exports

id                  uuid PK
project_id          uuid FK → projects.id
user_id             uuid FK → users.id

target              varchar

schema_version      varchar

project_state_version integer

readiness_state     varchar nullable
included_artifacts  jsonb nullable

status              enum

file_reference      text nullable

expires_at          timestamptz nullable

created_at          timestamptz
completed_at        timestamptz nullable
```

Status:

```text id="xd0dp8"
PENDING
GENERATING
READY
FAILED
EXPIRED
```

---

# 57. Export Target

Initial:

```text id="6p12l9"
GENERIC
```

Potential future:

```text id="5mx08h"
CODEX
CLAUDE
CURSOR
GEMINI
```

---

# 58. Agent Kit Manifest

Manifest itself does not require a dedicated table.

It can be compiled from:

```text id="41p9nn"
projects
specification_documents
specification_versions
readiness_snapshots
exports
```

The resulting file:

```text id="fz0zv9"
.agent-ready/manifest.json
```

belongs to the export artifact.

---

# 59. Prompt Definitions

Prompt templates should primarily live in source control rather than the database for MVP.

Example:

```text id="xk5qka"
src/ai/prompts/

discovery/
specification/
validation/
tasks/
```

Prompt key and version are recorded in `ai_operations`.

This provides version traceability without creating an unnecessary prompt-management CMS.

---

# 60. Project Settings

Flexible project-level configuration can live in:

```text id="jrf77x"
project_settings

id                  uuid PK
project_id          uuid FK → projects.id UNIQUE

settings            jsonb

created_at          timestamptz
updated_at          timestamptz
```

`project_settings.settings` is the canonical store for project-level
preferences (per spec-decisions.md D-A05). The removed
`projects.preferred_language` and `project_inputs.preferred_stack`
columns now live here.

Possible values:

```text id="5ehitc"
preferred_language (default: "en"; allowed: "en", "id")
preferred_stack
agent target
discovery preferences
```

Do not create columns for every minor preference prematurely.

---

# 61. Future Subscription Tables

Billing is a SaaS concern but should remain separated from the project domain.

Potential future entities:

```text id="40y0gl"
subscriptions
plans
usage_quotas
usage_periods
```

For early MVP testing, billing does not need to block the core product.

---

# 62. Future Repository Integration

Do not implement yet, but reserve conceptual room for:

```text id="8obncb"
repositories
repository_snapshots
repository_files
repository_analysis
specification_drift
pull_request_validations
```

No current table should require repository integration to function.

---

# 63. Deletion Strategy

Deleting a project should cascade or archive project-owned data consistently.

Recommended MVP behavior:

```text id="4rt1nd"
Project
  ↓ soft delete

Associated data
  ↓ retained temporarily / inaccessible
```

Permanent cleanup may occur later through a retention job.

This reduces accidental destructive deletion.

---

# 64. Cascading Rules

Hard foreign-key cascading should be used carefully.

Safe candidates:

```text id="p5eg7p"
discovery_session
    → discovery_messages

task
    → task_dependencies
```

For canonical project information, application-controlled deletion may be preferable to preserve history.

---

# 65. Important Indexes

At minimum:

```text id="9s1th5"
projects.user_id

discovery_sessions.project_id
discovery_messages.session_id

discovery_nodes(project_id, node_key)

decisions(project_id, decision_key)

knowledge_items(project_id, knowledge_key)

requirements(project_id, requirement_code)

domain_entities(project_id, entity_code)

architecture_components(project_id, component_code)

screens(project_id, screen_code)

decisions(project_id, decision_code)
decision_dependencies(project_id, source_decision_key)
decision_dependencies(project_id, target_decision_key)

specification_documents(project_id, document_type)

specification_sections.document_id

validation_issues(project_id, status)

assumptions(project_id, status)

traceability_links(project_id, source_type, source_id)
traceability_links(project_id, target_type, target_id)

tasks(project_id, task_code)
task_dependencies.task_id

ai_operations(project_id)
ai_operations.user_id

exports.project_id
```

---

# 66. JSONB Usage Rules

Use JSONB when:

- shape varies meaningfully;
- fields are metadata;
- content is AI-derived but structured;
- frequent relational joins are unnecessary.

Do not use JSONB merely to avoid database design.

Bad:

```text id="qghd1r"
project.data = {
  decisions: [...],
  requirements: [...],
  tasks: [...]
}
```

Good:

```text id="w6kvkt"
decisions → relational table
requirements → relational table
tasks → relational table

decision.value → jsonb
requirement.acceptance_criteria → jsonb
```

---

# 67. Polymorphic References

Tables such as:

```text id="gqqazg"
traceability_links
issue_references
assumption_impacts
section_dependencies
```

use:

```text id="efay35"
reference_type
reference_id
```

PostgreSQL cannot enforce conventional foreign keys across multiple target tables for these references.

Therefore:

- valid reference types must be controlled by application enums;
- references must be validated by domain services;
- cleanup must be handled carefully.

This tradeoff is acceptable for the flexibility required by the traceability graph.

---

# 68. Stable Human-Readable Codes

Database UUIDs are internal.

Agent-facing references should use stable codes:

```text id="6k8z2l"
DEC-AUTH-001
FR-023
ENT-006
SCREEN-009
TASK-031
ISSUE-012
ASM-004
```

These codes appear in exported specifications.

Codes should not be reused after deletion.

---

# 69. Code Sequence Strategy

Human-readable codes should be generated per project.

Conceptually:

```text id="0fk47f"
FR-001
FR-002
FR-003
```

Do not derive these from database row counts.

Use an atomic sequence/counter mechanism to prevent duplicates.

---

# 70. project_counters

A lightweight implementation:

```text id="mtfqlo"
project_counters

id                  uuid PK
project_id          uuid FK → projects.id

counter_type        varchar
current_value       integer

updated_at          timestamptz
```

Unique:

```text id="3l4c9e"
(project_id, counter_type)
```

Example:

```text id="n18tnh"
FR     23
ENT    6
TASK   31
```

---

# 71. Transaction Example — Confirm Decision

When user confirms:

```text id="aqqvmt"
authentication.required = true
```

the transaction should conceptually:

```text id="cmzq3x"
BEGIN

update decision
insert decision_history

evaluate dependencies

update affected discovery_nodes

update canonical knowledge

increment project.state_version

mark dependent specification sections STALE

create impact records if necessary

COMMIT
```

Semantic validation can run after commit.

---

# 72. Transaction Example — Accept Proposed Specification Change

```text id="fwmldq"
BEGIN

update specification section

mark proposal ACCEPTED

increment specification version

create specification snapshot

update section dependency hash

increment project.state_version if canonical state changed

COMMIT
```

A specification wording-only change does not necessarily need to change canonical project knowledge.

---

# 73. Canonical vs Derived Data

Canonical examples:

```text id="v03vxk"
decisions
knowledge_items
requirements
domain_entities
screens
```

Derived examples:

```text id="htl2p6"
rendered specification Markdown
readiness score
compiled context.md
AGENTS.md
ZIP export
```

Derived data should be reproducible from canonical state where practical.

---

# 74. Cacheable Data

Potential cache candidates:

```text id="f7ptmr"
rendered document
readiness summary
discovery progress
compiled context
```

Cache invalidation should depend on `project.state_version` or more granular dependency hashes.

---

# 75. Data Isolation

Every project-scoped query must be constrained by authorized project access.

For MVP:

```text id="8j39lu"
project.user_id = authenticated_user.id
```

Never rely solely on a project UUID being difficult to guess.

---

# 76. Future Collaboration

Although MVP projects have one owner, avoid designing the domain in a way that makes collaboration impossible.

Future:

```text id="bspcnp"
project_members

project_id
user_id
role
```

For MVP this table can be omitted until collaboration is introduced.

---

# 77. Audit Considerations

Not every edit requires a full audit log.

Important historical information already exists through:

```text id="oq9q2e"
decision_history
specification_versions
ai_operations
exports
```

A generic audit-log system can be introduced later if enterprise requirements justify it.

---

# 78. Retention Considerations

Potentially large data:

```text id="lyh9pi"
discovery_messages
ai_operation_payloads
specification_versions
exports
```

Retention policies should eventually be configurable.

Particularly:

`ai_operation_payloads` may contain repeated project context and should not necessarily be retained forever.

---

# 79. Data Growth Expectations

The largest tables are likely to become:

```text id="aqld13"
discovery_messages
ai_operations
ai_operation_payloads
specification_versions
traceability_links
```

These should be indexed and monitored.

The core project tables should remain comparatively small.

---

# 80. MVP Schema Boundary

Required for MVP:

```text id="y6ehzl"
users
projects
project_inputs

architecture_components
```

discovery_sessions
discovery_messages
discovery_nodes

decisions
decision_history
decision_dependencies

knowledge_items
knowledge_sources

requirements

domain_entities
entity_attributes
entity_relationships

specification_documents
specification_sections
specification_versions
section_dependencies
proposed_changes

assumptions
assumption_impacts

validation_issues
issue_references

traceability_links

screens

milestones
tasks
task_dependencies

readiness_snapshots

ai_operations
ai_operation_payloads

exports

project_settings
project_counters
```

This looks substantial, but these tables represent genuinely distinct domain concepts rather than infrastructure complexity.

---

# 81. Tables Explicitly Deferred

Do not build yet:

```text id="d3nb7x"
organizations
project_members

subscriptions
billing_events

repositories
repository_files
repository_snapshots

pull_requests
code_analysis

agent_runs
agent_execution_logs

vector_embeddings
```

Introduce them only when their corresponding features exist.

---

# 82. Database Invariants

### DB-INV-001

A Decision Key is unique within a project.

### DB-INV-002

A Requirement Code is unique within a project.

### DB-INV-003

An Entity Code is unique within a project.

### DB-INV-004

A Task Code is unique within a project.

### DB-INV-005

A task cannot depend on itself.

### DB-INV-006

Only one current logical specification document of each type exists per project.

### DB-INV-007

Approved specification versions are immutable.

### DB-INV-008

Exports record the project state version from which they were produced.

### DB-INV-009

Confirmed decisions must preserve their historical value.

### DB-INV-010

AI output payloads cannot themselves be treated as canonical project state.

---

# 83. Why This Schema Matters

A simpler implementation could store:

```text id="rmp54b"
projects

id
user_id
chat_history
prd
architecture
database_schema
design
tasks
```

That would make the MVP faster to prototype.

However, it would make several core Agent Ready Kit capabilities extremely difficult:

- decision dependencies;
- assumption tracking;
- traceability;
- consistency validation;
- requirement coverage;
- incremental compilation;
- impact analysis;
- section-level regeneration;
- readiness calculation;
- future specification drift detection.

Therefore, Agent Ready Kit deliberately uses structured domain records instead of treating generated Markdown as the application database.

---

# 84. Final Data Model Principle

The database should be capable of answering questions such as:

```text id="8xvmpq"
Why does this requirement exist?

Which decision produced it?

Which database entities does it affect?

Which screen represents it?

Which architecture component implements it?

Which tasks implement it?

Which assumptions affect it?

Is its specification current?

Did it change after the last export?
```

If Agent Ready Kit can reliably answer those questions, the project is no longer merely a collection of AI-generated documents.

It has become a structured software specification that both humans and coding agents can reason about.