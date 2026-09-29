# Agent Ready Kit

## AI Agents & Orchestration Specification

**Document:** agents.md  
**Status:** Draft v1  
**Product:** Agent Ready Kit  
**Purpose:** Define AI responsibilities, deterministic services, orchestration rules, boundaries, and handoffs.

---

# 1. Purpose

Agent Ready Kit uses multiple specialized AI capabilities to progressively transform an ambiguous software idea into an implementation-ready project specification.

The system must not behave as one unrestricted "super agent."

Instead, AI responsibilities are divided by concern.

The architecture follows:

```text
User
  ↓
Application
  ↓
Orchestrator
  │
  ├── Specialized AI Capabilities
  │
  └── Deterministic Domain Services
  ↓
Validated Structured Output
  ↓
Canonical Project State
```

The application, not the LLM, owns the project lifecycle.

---

# 2. Core Principle

The primary AI principle is:

> **AI interprets and proposes. Application rules validate and control. Human decisions remain authoritative.**

AI is responsible for semantic work.

Application code is responsible for deterministic state management.

---

# 3. What Counts as an Agent

An Agent Ready Kit agent is a specialized AI capability with:

- a specific objective;
- bounded context;
- defined inputs;
- structured outputs;
- explicit constraints;
- known downstream consumers.

An agent is not necessarily a continuously running autonomous process.

Most MVP agents are invoked for a single bounded operation.

---

# 4. What Should NOT Be an Agent

The following should remain deterministic application services:

```text
Authentication
Authorization
Decision dependency resolution
Project state transitions
Database persistence
Specification versioning
Staleness propagation
Task dependency resolution
Readiness calculation
Code generation for IDs
Rate limiting
Usage accounting
ZIP creation
Export packaging
```

AI may provide input to these systems but does not control them.

---

# 5. AI System Overview

The MVP AI system consists conceptually of:

```text
                    AI ORCHESTRATOR
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
       ▼                  ▼                  ▼
   Discovery         Knowledge         Specification
    Agents            Agents             Agents
       │                  │                  │
       └──────────────────┼──────────────────┘
                          ▼
                     Validation
                          │
                          ▼
                    Task Planning
                          │
                          ▼
                  Execution Context
                       Compiler
```

Not every box requires a different model.

Agents represent logical roles, not necessarily separate infrastructure.

---

# 6. Agent Catalog

MVP AI capabilities:

```text
A-001 Idea Analyst
A-002 Discovery Interviewer
A-003 Answer Interpreter
A-004 Knowledge Curator

A-010 Product Specification Compiler
A-011 Architecture Specification Compiler
A-012 Data Model Compiler
A-013 Design Specification Compiler
A-014 Product Agent Designer
A-015 Soul Designer

A-020 Semantic Validator
A-021 Assumption Analyzer
A-022 Change Impact Analyzer

A-030 Task Planner

A-040 Context Compiler
A-041 Agent Instruction Compiler
```

Agent Kit packaging itself remains deterministic.

---

# 7. A-001 — Idea Analyst

## Objective

Transform the user's initial software idea into an initial structured understanding.

## Input

```text
project name
idea
target users (optional)
constraints (optional)
references (optional)
preferred stack (optional)
```

## Responsibilities

Identify:

- product category;
- likely problem;
- likely users;
- explicitly stated capabilities;
- constraints;
- technical preferences;
- relevant discovery domains;
- obvious unknowns;
- potential assumptions.

## Must NOT

- silently confirm architecture;
- silently select major technologies;
- invent business rules;
- declare the project implementation-ready.

## Output

Structured payload conceptually:

```json
{
  "summary": "...",
  "knownFacts": [],
  "candidateKnowledge": [],
  "candidateDecisions": [],
  "unknownDomains": [],
  "assumptions": []
}
```

## Downstream

Results initialize:

- Discovery Map;
- candidate knowledge;
- candidate decisions;
- assumption inventory.

---

# 8. A-002 — Discovery Interviewer

## Objective

Ask the most useful next question.

The objective is not:

> Ask every possible software-planning question.

The objective is:

> Reduce important uncertainty with minimal user effort.

## Inputs

Relevant subset of:

```text
Discovery Map
confirmed decisions
unresolved decisions
important knowledge
open assumptions
project scope
previous question
recent conversation context
```

## Question Selection

The application determines eligible discovery topics.

The agent formulates the actual question.

Conceptually:

```text
Application:

Eligible topics:
1. authentication
2. collaboration
3. persistence

Highest priority:
authentication

          ↓

Discovery Interviewer:

"Apakah pengguna perlu memiliki akun,
atau aplikasi dapat digunakan tanpa login?"
```

This prevents the LLM from arbitrarily controlling discovery order.

---

# 9. Discovery Interview Style

Questions should:

- be concise;
- explain technical terms when necessary;
- avoid unnecessary jargon;
- present meaningful options when useful;
- show a recommendation when appropriate;
- allow custom answers;
- avoid asking already answered questions.

Preferred interaction:

```text
How should users sign in?

Recommended:
Google + Email

Why:
Provides convenient login while keeping
an email fallback.

○ Google + Email
○ Google only
○ Email only
○ No authentication
○ Something else
```

---

# 10. Discovery Recommendation Rules

AI may recommend an option when:

- there is enough context;
- tradeoffs are understood;
- recommendation materially reduces user effort.

The recommendation must include rationale.

The recommendation remains:

```text
RECOMMENDED
```

until explicitly or implicitly accepted by the user.

---

# 11. A-003 — Answer Interpreter

## Objective

Convert a user's natural-language discovery answer into structured candidate changes.

This is one of the most important agents.

## Example

User:

> Login pakai Google saja. Saya tidak mau user mengurus password.

Output:

```json
{
  "decisions": [
    {
      "key": "authentication.required",
      "value": true,
      "confidence": "EXPLICIT"
    },
    {
      "key": "authentication.methods",
      "value": ["GOOGLE"],
      "confidence": "EXPLICIT"
    },
    {
      "key": "authentication.password",
      "value": false,
      "confidence": "INFERRED"
    }
  ],
  "assumptions": [],
  "unresolved": []
}
```

The application validates this payload before applying it.

---

# 12. Answer Interpreter Rules

The Answer Interpreter must distinguish:

### Explicit

Directly stated by the user.

### Inferred

Logically implied with strong confidence.

### Assumed

Plausible but not supported strongly enough.

Assumed information must not silently become a confirmed decision.

---

# 13. Multi-Decision Extraction

The Answer Interpreter should extract multiple decisions from one answer when justified.

Example:

> Ini aplikasi pribadi. Tidak perlu login dan semua data cukup disimpan di browser.

Potential extraction:

```text
multi_user = false
authentication.required = false
storage.type = local
account.required = false
collaboration = NOT_APPLICABLE
```

This prevents redundant questioning.

---

# 14. A-004 — Knowledge Curator

## Objective

Transform validated decisions and user statements into normalized Project Knowledge.

The Knowledge Curator does not generate documentation.

It maintains conceptual understanding.

## Inputs

```text
confirmed decisions
accepted recommendations
validated answer extraction
existing knowledge
requirements
```

## Output

Structured knowledge changes:

```json
{
  "create": [],
  "update": [],
  "supersede": [],
  "sources": []
}
```

---

# 15. Knowledge Curator Responsibilities

The agent should:

- normalize duplicate information;
- consolidate related facts;
- preserve semantic meaning;
- maintain provenance;
- identify knowledge that became stale;
- avoid unnecessary prose duplication.

Example:

Three decisions about authentication may become one coherent knowledge item describing the authentication model.

---

# 16. Knowledge Curator Boundary

The agent may propose:

```text
knowledge update
```

but the application determines:

```text
whether update is valid
which records change
state version increment
dependency invalidation
```

---

# 17. Specification Compiler Family

Specifications use specialized compilers because different documents require different reasoning.

```text
Project Knowledge
      │
      ├── Product Compiler
      ├── Architecture Compiler
      ├── Data Compiler
      ├── Design Compiler
      ├── Product Agent Designer
      └── Soul Designer
```

They consume the same canonical project state from different perspectives.

---

# 18. A-010 — Product Specification Compiler

## Output

`PRD.md`

## Primary Inputs

```text
vision
problem
users
goals
scope
features
business rules
constraints
functional requirements
non-functional requirements
success criteria
```

## Responsibilities

Produce implementation-relevant product specification.

The compiler must not invent technical architecture unless required to explain an existing confirmed constraint.

---

# 19. PRD Compiler Rules

Every important functional capability should map to a stable requirement.

Example:

```text
FR-014 — Create Project
```

The compiler must preserve existing requirement IDs.

It should not renumber requirements merely because document ordering changes.

---

# 20. A-011 — Architecture Specification Compiler

## Output

`architecture.md`

## Inputs

```text
requirements
technical decisions
constraints
integrations
security requirements
deployment requirements
data requirements
AI requirements
```

## Responsibilities

Describe:

- architecture style;
- application boundaries;
- modules;
- services;
- integrations;
- data flows;
- deployment;
- technical constraints;
- important architectural decisions.

---

# 21. Architecture Compiler Boundary

If architecture decisions remain unresolved, the compiler should expose them.

It must not silently decide:

```text
microservices vs monolith
database provider
authentication provider
deployment provider
```

unless they are explicitly delegated to AI recommendation and accepted.

---

# 22. A-012 — Data Model Compiler

## Output

`database-schema.md`

## Inputs

```text
domain entities
entity attributes
relationships
business rules
ownership rules
retention
architecture
requirements
```

## Responsibilities

Translate domain understanding into implementation-oriented persistence design.

It should identify:

- tables/collections;
- fields;
- relationships;
- constraints;
- indexes where justified;
- lifecycle rules.

---

# 23. Domain vs Persistence

The Data Model Compiler must understand:

```text
Domain Entity
≠
Database Table
```

For example:

```text
Domain:
Subscription

Implementation may involve:

subscriptions
subscription_events
usage_periods
```

The compiler performs this translation explicitly.

---

# 24. A-013 — Design Specification Compiler

## Output

`design.md`

## Inputs

```text
users
product goals
features
workflows
screens
branding preferences
accessibility requirements
responsive requirements
```

## Responsibilities

Define implementation-relevant UI/UX expectations.

This includes:

- design direction;
- information architecture;
- navigation;
- screens;
- layouts;
- components;
- interaction behavior;
- empty states;
- loading states;
- error states;
- responsive behavior.

---

# 25. Design Compiler Boundary

The Design Compiler creates a design specification.

It does not generate production frontend code.

---

# 26. A-014 — Product Agent Designer

## Output

`agents.md` inside the exported project.

This is distinct from this document.

This agent is only invoked when the software being designed contains its own AI agents.

## Example

For an AI novel-writing application:

```text
Story Planner Agent
Character Consistency Agent
Writing Assistant
```

## Responsibilities

Define:

- role;
- objective;
- context;
- inputs;
- outputs;
- tools;
- boundaries;
- handoffs.

If the target application has no meaningful agentic functionality, this compiler is not required.

---

# 27. A-015 — Soul Designer

## Output

`soul.md`

Only applicable when an application-level AI capability benefits from stable behavioral principles or personality.

## Responsibilities

Define:

- identity;
- behavioral principles;
- tone;
- interaction philosophy;
- boundaries;
- decision principles.

It should not duplicate technical instructions from `agents.md`.

---

# 28. Soul Applicability

`soul.md` is optional.

Examples where it may be useful:

```text
writing companion
learning coach
creative collaborator
customer-facing assistant
role-based agent
```

Examples where it may not be needed:

```text
expense tracker
inventory dashboard
basic CRUD SaaS
```

---

# 29. A-020 — Semantic Validator

## Objective

Find semantic problems that deterministic validators cannot reliably detect.

## Examples

Detect:

```text
PRD says projects are private.

Design describes a public project directory.
```

Or:

```text
Requirement says permanent account deletion.

Architecture describes indefinite user-data retention.
```

---

# 30. Semantic Validator Inputs

The Context Builder should provide only relevant specification sections.

Do not always compare every document against every other document.

Possible validation pairs:

```text
PRD ↔ Architecture
PRD ↔ Design
PRD ↔ Database
Architecture ↔ Database
Requirement ↔ Task
Business Rule ↔ Workflow
```

---

# 31. Semantic Validator Output

```json
{
  "issues": [
    {
      "type": "CONSISTENCY",
      "severity": "HIGH",
      "title": "...",
      "description": "...",
      "sources": [],
      "affected": [],
      "suggestedResolution": "..."
    }
  ]
}
```

The application normalizes and persists findings.

---

# 32. Validation Must Not Become Noise

The validator should avoid reporting:

- stylistic differences;
- harmless wording differences;
- speculative issues;
- low-confidence contradictions.

High signal is more valuable than a large number of findings.

---

# 33. A-021 — Assumption Analyzer

## Objective

Find hidden assumptions that may affect implementation.

Example:

```text
Requirement:
Users can upload profile images.

Missing:
storage provider
maximum size
accepted formats
deletion behavior
```

The analyzer determines which missing details materially matter.

---

# 34. Assumption Prioritization

Not every unknown becomes an assumption issue.

An assumption should generally be surfaced when it affects:

```text
architecture
data model
security
business behavior
user flow
implementation scope
external integration
cost
```

Minor cosmetic unknowns can remain unresolved.

---

# 35. A-022 — Change Impact Analyzer

## Objective

Explain the semantic impact of a changed confirmed decision.

Example:

```text
Change:

Authentication
Google only
    ↓
Google + Email/password
```

Potential output:

```text
Affected:

Architecture
- authentication strategy

Database
- password credential considerations

Design
- login form
- forgot password flow

Tasks
- authentication setup
- password reset
```

---

# 36. Change Impact Analyzer Boundary

The agent identifies semantic impact.

Deterministic dependency records remain the first source for known dependencies.

Therefore:

```text
Dependency Graph
      +
Semantic Impact Analyzer
      ↓
Impact Report
```

The AI complements the graph rather than replacing it.

---

# 37. A-030 — Task Planner

## Objective

Transform stable specifications into executable implementation work.

## Inputs

```text
requirements
architecture
database
design
dependencies
constraints
acceptance criteria
```

## Output

Structured:

```text
milestones
tasks
task dependencies
requirement links
acceptance criteria
definition of done
```

---

# 38. Task Planner Rules

A task should be:

- implementation-oriented;
- bounded;
- testable;
- traceable;
- dependency-aware.

Avoid vague tasks such as:

```text
Build dashboard
```

Prefer:

```text
TASK-021
Implement project list query and empty state
```

---

# 39. Task Granularity

Tasks should generally represent work that a coding agent can execute in one coherent implementation context.

Avoid extremes.

Too large:

```text
Build authentication system
```

Too small:

```text
Create email variable
```

Preferred:

```text
Implement Google OAuth authentication flow
```

---

# 40. Task Planner Must Preserve Requirements

A Task Planner must not simplify away important acceptance criteria.

Every MUST-level implementation requirement should have task coverage.

---

# 41. A-040 — Context Compiler

## Output

`context.md`

## Objective

Produce compact bootstrap context for a coding agent.

It should answer:

```text
What are we building?
For whom?
What is in scope?
What architecture are we using?
What constraints matter?
Where are the authoritative specifications?
What implementation phase are we in?
```

---

# 42. Context Compiler Principle

`context.md` should remain relatively small.

It is an entry point, not a duplicate PRD.

The coding agent can load detailed documents as needed.

---

# 43. A-041 — Agent Instruction Compiler

## Output

`AGENTS.md`

## Objective

Tell the coding agent how to work on the project.

This is one of the most important exported files.

---

# 44. AGENTS.md Responsibilities

It should define:

### Reading Order

Example:

```text
1. context.md
2. relevant task
3. referenced requirement
4. relevant architecture section
5. relevant database/design section
```

### Source of Truth

Example:

```text
Product → PRD.md
Architecture → architecture.md
Persistence → database-schema.md
UX → design.md
Execution → tasks.md
```

### Implementation Rules

Example:

```text
Do not silently change requirements.

Do not introduce architecture changes without
documenting them.

Implement only the active task scope.

Respect task dependencies.
```

### Completion Rules

Example:

```text
Run tests.
Run lint.
Verify acceptance criteria.
Do not mark incomplete work DONE.
```

---

# 45. Agent Kit Compiler

Agent Kit packaging itself should NOT be an LLM agent.

It is a deterministic application service.

```text
Approved Specifications
       +
context.md
       +
AGENTS.md
       +
manifest
       ↓
AgentKitCompiler
       ↓
ZIP
```

This guarantees reproducible export structure.

---

# 46. AI Orchestrator

The AI Orchestrator coordinates all AI operations.

Responsibilities:

```text
select capability
select prompt
build context
select model
call provider
validate response
track usage
handle retry
return structured result
```

The Orchestrator does not own business state.

---

# 47. Orchestration Flow

Example Discovery answer:

```text
User Answer
    ↓
Application
    ↓
AI Orchestrator
    ↓
Answer Interpreter
    ↓
Structured Candidate Changes
    ↓
Schema Validator
    ↓
Decision Service
    ↓
Knowledge Curator
    ↓
Canonical State
```

---

# 48. Context Builder

Each agent receives a specialized context projection.

Example:

### Discovery Interviewer

```text
project summary
relevant decisions
discovery node
recent conversation
```

### Data Model Compiler

```text
relevant requirements
business rules
domain entities
relationships
architecture constraints
```

### Task Planner

```text
requirements
architecture references
database references
design references
dependencies
```

Agents should not receive unrelated context by default.

---

# 49. Context Budget

Each operation should have a context budget.

Conceptually:

```text
Essential
Recommended
Optional
```

Context Builder fills:

```text
Essential first
↓
Recommended if budget remains
↓
Optional if useful
```

This prevents token usage from growing linearly with project history.

---

# 50. Prompt Architecture

Prompts should follow a common structure:

```text
ROLE
OBJECTIVE
BOUNDARIES
INPUT
OUTPUT SCHEMA
RULES
QUALITY CRITERIA
```

Example:

```text
ROLE
You are the Answer Interpreter.

OBJECTIVE
Extract supported project decisions.

BOUNDARY
Do not invent unsupported decisions.

OUTPUT
Return the required structured schema.
```

---

# 51. Prompt Versioning

Each prompt has:

```text
prompt_key
prompt_version
```

Example:

```text
discovery.extract-answer
1.2
```

`ai_operations` records the version.

This allows output-quality regression analysis.

---

# 52. Structured Output Requirement

Agents modifying or proposing structured project state must return machine-validated output.

Prefer:

```text
JSON Schema
```

or provider-supported structured output.

Free-form parsing should be avoided.

---

# 53. Schema Validation Failure

If model output fails validation:

```text
Model Output
     ↓
Schema Validation
     ↓ FAIL
Repair Attempt
     ↓
Validation
```

Allow a limited repair attempt.

If still invalid:

```text
AI Operation → FAILED
```

Canonical state remains unchanged.

---

# 54. Model Routing

Not all operations require the strongest available model.

Conceptually:

### Lower-cost model

Potential uses:

```text
question wording
simple extraction
summarization
classification
```

### Higher-reasoning model

Potential uses:

```text
architecture compilation
semantic consistency analysis
complex task planning
change impact reasoning
```

Routing should remain configurable.

---

# 55. Cost Awareness

Each agent operation should consider:

```text
expected value
context size
model cost
latency
```

The system should avoid calling AI when deterministic rules can produce the same result.

Example:

Do not ask an LLM:

> Does TASK-004 have a dependency on TASK-002?

when that relationship already exists in the database.

---

# 56. AI Operation Caching

AI results may be reused when:

```text
prompt version unchanged
+
input dependency fingerprint unchanged
```

Example:

```text
architecture.authentication

dependency fingerprint:
abc123

new fingerprint:
abc123

→ no regeneration
```

---

# 57. Retry Strategy

Retry only recoverable failures.

Examples:

```text
provider timeout
temporary rate limit
invalid structured output
```

Do not blindly retry:

```text
invalid application request
authorization failure
permanent provider error
```

Retries must remain idempotent.

---

# 58. Hallucination Control

The system should reduce hallucinations through:

### Structured Context

Only provide authoritative relevant information.

### Provenance

Distinguish user-confirmed facts from AI assumptions.

### Structured Output

Require evidence/reference fields when useful.

### Validation

Check returned identifiers against canonical state.

### Human Review

High-impact changes remain proposals.

---

# 59. Unknown Handling

Agents must be allowed to return:

```text
UNKNOWN
UNRESOLVED
INSUFFICIENT_INFORMATION
NOT_APPLICABLE
```

An agent should not be rewarded for filling every field.

Explicit uncertainty is preferable to fabricated certainty.

---

# 60. Conflict Handling

If AI detects conflict with confirmed user decisions:

```text
Do not overwrite.
```

Instead:

```text
create issue
or
create proposed change
```

User authority wins.

---

# 61. Human-in-the-Loop Boundaries

Human approval is required for significant decisions such as:

```text
product scope
authentication model
major architecture choice
database strategy
payment model
critical external integration
high-impact requirement removal
```

Low-impact inferred knowledge may be accepted automatically when confidence is high and the operation is reversible.

---

# 62. Agent Handoffs

Agents do not communicate through free-form conversations with each other.

They communicate through structured project state.

Bad:

```text
Architecture Agent
   ↓ chat message
Database Agent
```

Preferred:

```text
Architecture Agent
      ↓
Structured Architecture Specification
      ↓
Canonical Specification State
      ↓
Database Agent
```

This improves reproducibility.

---

# 63. No Recursive Agent Swarms for MVP

Do not implement uncontrolled agent-to-agent loops such as:

```text
Agent A asks Agent B
Agent B asks Agent C
Agent C asks Agent A
```

MVP orchestration should be explicit and application-controlled.

This prevents:

- unpredictable cost;
- difficult debugging;
- runaway loops;
- unclear authority.

---

# 64. Discovery Orchestration Example

```text
New Project
     ↓
Idea Analyst
     ↓
Discovery Map initialized
     ↓
Application chooses highest-impact node
     ↓
Discovery Interviewer
     ↓
User Answer
     ↓
Answer Interpreter
     ↓
Application validation
     ↓
Decision update
     ↓
Knowledge Curator
     ↓
Discovery Map update
     ↓
Next node
```

Repeat until the desired discovery level is reached.

---

# 65. Specification Orchestration Example

```text
Project reaches DETAILED
        ↓
Product Compiler
        ↓
Architecture Compiler
        ↓
Data Model Compiler
        ↓
Design Compiler
        ↓
Optional Product Agent Designer
        ↓
Optional Soul Designer
        ↓
Validation
```

These do not necessarily need to execute strictly sequentially.

Dependencies determine order.

---

# 66. Validation Orchestration Example

```text
Specifications
      ↓
Deterministic Validators
      ↓
Semantic Validator
      ↓
Assumption Analyzer
      ↓
Issue Normalization
      ↓
Readiness Engine
```

Readiness Engine itself remains deterministic.

---

# 67. Task Planning Orchestration

```text
Specifications sufficiently stable
       ↓
Task Planner
       ↓
Structured Task Candidates
       ↓
Schema Validation
       ↓
Dependency Validation
       ↓
Traceability Validation
       ↓
Persist Tasks
       ↓
Execution Readiness Check
```

---

# 68. Export Orchestration

```text
Approved Project State
       ↓
Context Compiler
       ↓
Agent Instruction Compiler
       ↓
Markdown Renderers
       ↓
Deterministic Agent Kit Compiler
       ↓
Target Adapter
       ↓
ZIP
```

---

# 69. Agent Evaluation

Each important AI capability should eventually have evaluation datasets.

Examples:

### Answer Interpreter

Measure:

```text
decision extraction precision
decision extraction recall
unsupported inference rate
```

### Semantic Validator

Measure:

```text
true contradiction detection
false positive rate
severity accuracy
```

### Task Planner

Measure:

```text
requirement coverage
dependency correctness
task granularity
acceptance-criteria coverage
```

---

# 70. Golden Test Projects

Maintain several representative projects for regression testing.

Examples:

```text
Simple CRUD SaaS
AI writing application
Marketplace
Personal local-only application
Subscription SaaS
Two-sided platform
```

When prompts/models change, regenerate these projects and compare results.

---

# 71. AI Quality Over Model Loyalty

Agent Ready Kit should not depend conceptually on one model provider.

The system should evaluate models based on capability.

Different providers may eventually be used for different tasks.

The domain architecture remains provider-neutral.

---

# 72. Agent Observability

For each invocation record:

```text
agent/capability
operation type
model
prompt version
input size
output size
latency
cost
success/failure
```

Where safe and useful, record quality-related metadata.

---

# 73. User-Facing AI Transparency

Users do not need to see internal prompt mechanics.

They should see meaningful distinctions:

```text
Confirmed by you
Recommended by AI
Assumed by AI
Needs decision
```

This transparency matters more than exposing model internals.

---

# 74. Error Philosophy

If an agent fails:

```text
Do not corrupt canonical state.
Do not pretend generation succeeded.
Do not silently substitute invented content.
```

Provide retry when appropriate.

The last approved specification remains usable.

---

# 75. Agent Security

Agents must never receive:

- another user's project context;
- internal credentials;
- database credentials;
- unnecessary authentication tokens;
- private system secrets.

Project context should be scoped to the authorized project.

---

# 76. Prompt Injection Consideration

User-provided references may eventually contain hostile instructions.

When external documents are introduced, their contents must be treated as project data rather than system instructions.

Conceptually:

```text
SYSTEM RULES
   >
APPLICATION TASK
   >
PROJECT DATA
   >
EXTERNAL CONTENT
```

This becomes particularly important in future repository/document import features.

---

# 77. Agent Autonomy Levels

Internally, operations can be thought of as:

### Level 0 — Deterministic

No AI.

Example:

```text
readiness calculation
```

### Level 1 — Assistive

AI recommends.

Example:

```text
technology recommendation
```

### Level 2 — Transformative

AI transforms approved information.

Example:

```text
PRD compilation
```

### Level 3 — Propositional

AI proposes changes requiring review.

Example:

```text
architecture change after requirement change
```

MVP should generally avoid unrestricted Level 4 autonomous execution.

---

# 78. Agent Responsibility Matrix

| Capability | AI | Application | Human |
|---|---|---|---|
| Understand idea | Primary | Validate | Provide |
| Select discovery topic | Assist | Primary | — |
| Formulate question | Primary | Context | Answer |
| Interpret answer | Primary | Validate | Correct |
| Confirm major decision | Recommend | Record | Primary |
| Maintain knowledge | Propose | Persist | Review |
| Generate specification | Primary | Structure/version | Review |
| Detect deterministic gap | — | Primary | Resolve |
| Detect semantic conflict | Primary | Persist | Resolve |
| Calculate readiness | — | Primary | View |
| Generate tasks | Primary | Validate | Review |
| Package ZIP | — | Primary | Download |
| Implement software | — | — | External coding agent |

---

# 79. MVP Agent Boundary

For MVP, the following AI capabilities are essential:

```text
Idea Analyst
Discovery Interviewer
Answer Interpreter
Knowledge Curator

Product Compiler
Architecture Compiler
Data Model Compiler
Design Compiler

Semantic Validator
Assumption Analyzer

Task Planner

Context Compiler
Agent Instruction Compiler
```

Conditional:

```text
Product Agent Designer
Soul Designer
```

Potentially deferred if necessary:

```text
advanced Change Impact Analyzer
```

Basic impact analysis can initially rely on deterministic dependencies.

---

# 80. Most Important Agent

From a product perspective, the most important AI capability is not the PRD generator.

It is:

> **Answer Interpreter + Knowledge Curator**

If these components incorrectly understand the user, every downstream document can be beautifully written and still be wrong.

Therefore these capabilities should receive particularly strong validation and testing.

---

# 81. Second Most Important Agent

The second most important capability is the:

> **Discovery Interviewer**

Poor discovery produces incomplete canonical knowledge.

The quality of downstream specifications cannot exceed the quality of the information collected upstream.

---

# 82. Specification Agents Are Downstream

This means the architecture prioritizes:

```text
Understanding
     ↓
Normalization
     ↓
Specification
```

rather than:

```text
Prompt
     ↓
Pretty Markdown
```

This distinction is fundamental to Agent Ready Kit.

---

# 83. Internal Agent Identity

Internal agents should not need elaborate fictional personalities.

Their identity should be functional.

Example:

```text
You are the Architecture Specification Compiler.

Your responsibility is to translate confirmed
project knowledge into an implementation-oriented
architecture specification.

You do not make silent product decisions.
```

Personality is less important than reliability.

---

# 84. Language Handling

Discovery should communicate in the user's chosen language.

Canonical structured identifiers remain language-neutral.

Example:

User-facing:

```text
Apakah pengguna perlu login?
```

Canonical:

```text
authentication.required
```

Generated documentation may use the project's configured output language.

---

# 85. Cross-Language Consistency

Changing output language must not change canonical project intent.

For example:

```text
FR-014
```

must remain the same requirement whether rendered in Indonesian or English.

---

# 86. Agent Kit Target Awareness

Specification agents should remain vendor-neutral.

Only the final instruction/export layer should care whether the target is:

```text
Generic
Codex
Claude Code
Cursor
Gemini CLI
```

This prevents vendor-specific behavior from contaminating canonical specifications.

---

# 87. Future Agent Capabilities

Potential future agents:

```text
Repository Analyzer
Specification Drift Analyzer
Pull Request Reviewer
Migration Planner
Test Coverage Analyzer
Security Reviewer
Deployment Planner
```

These are explicitly outside MVP.

---

# 88. Future Execution Agent

Agent Ready Kit may eventually coordinate coding agents.

Conceptually:

```text
TASK-021
   ↓
Execution Agent
   ↓
Repository
   ↓
Implementation
   ↓
Tests
   ↓
Pull Request
   ↓
Specification Validation
```

Current task and traceability models are designed so this can be added without redefining the project model.

---

# 89. Agent System Invariants

### AG-INV-001

AI cannot directly write canonical state without application validation.

### AG-INV-002

AI recommendations never override confirmed user decisions.

### AG-INV-003

Unsupported assumptions must remain identifiable.

### AG-INV-004

Agents communicate through structured state, not uncontrolled inter-agent conversations.

### AG-INV-005

Every state-changing AI operation uses structured output.

### AG-INV-006

Failed AI operations leave approved project state intact.

### AG-INV-007

Readiness is calculated by application rules, not model intuition.

### AG-INV-008

Agent Kit packaging is deterministic.

### AG-INV-009

Canonical specifications remain vendor-neutral.

### AG-INV-010

Explicit uncertainty is preferable to fabricated certainty.

---

# 90. Final Agent Philosophy

Agent Ready Kit should use AI where AI is strongest:

```text
understanding language
finding ambiguity
reasoning semantically
explaining tradeoffs
organizing information
writing specifications
decomposing work
```

It should use software where software is strongest:

```text
state
rules
authorization
dependencies
validation
versioning
transactions
calculations
packaging
```

And it should preserve human authority where humans matter most:

```text
intent
priorities
tradeoffs
scope
critical decisions
```

The resulting relationship is:

```text
HUMAN
defines intent
     ↓
AI
understands and structures
     ↓
SYSTEM
validates and maintains consistency
     ↓
AI
compiles implementation context
     ↓
CODING AGENT
executes
```

This division of responsibility is the foundation of Agent Ready Kit's AI architecture.