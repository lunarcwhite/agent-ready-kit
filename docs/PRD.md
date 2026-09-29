# Agent Ready Kit

## Product Requirements Document

**Product:** Agent Ready Kit  
**Document:** PRD.md  
**Status:** Draft v1  
**Product Type:** SaaS  
**Initial Audience:** Developers, indie hackers, and AI-assisted software builders  
**Primary Output:** Implementation-ready Agent Kit

---

# 1. Product Overview

Agent Ready Kit is a SaaS platform that transforms an early-stage software idea into a structured, validated, implementation-ready workspace designed for AI coding agents.

The product sits between ideation and implementation.

Instead of asking a coding agent to interpret a vague idea and make numerous undocumented assumptions, Agent Ready Kit guides the user through a structured discovery process, captures important decisions, builds a canonical project knowledge model, generates consistent specifications, identifies ambiguity and contradictions, creates an implementation plan, and exports the result as an Agent Kit.

The core product principle is:

> **Human decides. Agent Ready Kit clarifies. Coding agent executes.**

Agent Ready Kit is not intended to replace coding agents, IDEs, project management platforms, or software developers.

Its purpose is to provide those agents with significantly better implementation context.

---

# 2. Product Vision

Software development with AI coding agents should not require developers to repeatedly explain product intent, architecture, constraints, business rules, and implementation expectations.

Agent Ready Kit aims to become the preparation layer between:

**software idea → AI implementation**

The platform should progressively eliminate ambiguity until a coding agent has enough structured information to begin implementation with minimal assumptions and unnecessary clarification.

Long term, Agent Ready Kit should function as the canonical specification and context layer shared between humans and software-development agents.

---

# 3. Problem Statement

AI coding agents are increasingly capable of implementing software, but their output quality is highly dependent on the quality of the context they receive.

A typical user may begin with a request such as:

> Build an AI-powered application that helps people write novels.

This statement does not define:

- exact target users;
- application boundaries;
- authentication requirements;
- roles and permissions;
- business rules;
- core entities;
- relationships;
- AI behavior;
- external integrations;
- architecture;
- deployment constraints;
- security requirements;
- user flows;
- error states;
- acceptance criteria;
- implementation order.

When this information is absent, coding agents must either:

1. ask additional questions;
2. make assumptions;
3. implement incomplete requirements;
4. introduce architecture decisions without explicit approval;
5. create inconsistent implementations.

These hidden assumptions become increasingly expensive as the project grows.

Agent Ready Kit addresses this problem before implementation begins.

---

# 4. Product Goal

The primary goal is:

> Reduce the number and significance of assumptions an AI coding agent must make while implementing a software project.

Secondary goals include:

- produce consistent product and engineering specifications;
- expose unresolved decisions;
- detect contradictions between specifications;
- ensure requirements have implementation coverage;
- generate actionable implementation tasks;
- provide coding agents with clear operating instructions;
- preserve traceability from requirement to implementation task.

---

# 5. Non-Goals

The MVP is not intended to be:

- a cloud IDE;
- a source-code editor;
- an autonomous coding platform;
- a deployment platform;
- a CI/CD system;
- a replacement for Git;
- a Jira replacement;
- a general-purpose project management platform;
- a production monitoring system;
- a repository analysis platform;
- an existing-codebase migration tool.

Agent Ready Kit prepares projects for implementation.

The actual implementation is performed externally by coding agents or developers.

---

# 6. Target Users

## 6.1 Primary Persona

### AI-Assisted Developer

A developer, indie hacker, or technical builder who regularly uses AI coding tools.

Typical characteristics:

- understands basic software-development terminology;
- can make technical decisions when presented with options;
- frequently prototypes or builds new applications;
- uses AI coding assistants or agents;
- wants to reduce repeated prompting;
- values structured implementation plans.

Typical tools may include coding agents, AI IDEs, command-line coding agents, or similar development assistants.

---

## 6.2 Secondary Persona

### Technical Founder

A technically literate founder who understands product requirements but may not want to manually design the complete software architecture.

This persona may become more important after the MVP.

---

## 6.3 Future Persona

### Non-Technical Product Builder

A non-developer who wants to prepare a sufficiently detailed software specification before handing implementation to an AI agent or developer.

Supporting this persona will require a different discovery experience and is not the primary MVP optimization target.

---

# 7. Core Product Principles

## P-001 — Human Decision Authority

AI may recommend decisions and explain tradeoffs.

High-impact decisions should not silently become confirmed project decisions.

The user remains the authority over product intent.

---

## P-002 — Structured Knowledge Over Chat History

Conversation history must not be the canonical source of truth.

Important information extracted from conversations must become structured project knowledge or decisions.

---

## P-003 — Specifications Are Compiled Artifacts

Markdown documents are generated representations of project knowledge.

They are not the primary source of truth.

---

## P-004 — Explicit Assumptions

AI-generated assumptions must be identifiable.

The system should distinguish:

- confirmed information;
- accepted recommendations;
- unresolved decisions;
- assumptions;
- deferred decisions;
- not-applicable decisions.

---

## P-005 — Traceability

Important requirements should be traceable through architecture, data, design, and implementation tasks where applicable.

---

## P-006 — Non-Destructive Updates

Requirement changes must not silently overwrite user-reviewed specifications.

Affected changes should be identified and presented for review.

---

## P-007 — Vendor-Neutral Core

The canonical Agent Kit should not depend on a single coding-agent vendor.

Vendor-specific adapters may extend the generic format.

---

# 8. Core Product Flow

The canonical project lifecycle is:

Idea

→ Discovery

→ Decisions

→ Project Knowledge

→ Specifications

→ Validation

→ Readiness

→ Task Planning

→ Agent Kit

The user should be able to move backward when requirements change.

---

# 9. Project Lifecycle States

A project may have the following readiness states.

## DISCOVERY

The system does not yet understand enough about the project.

## DRAFT

Enough information exists to generate an initial specification.

## NEEDS_REVIEW

Specifications exist, but unresolved decisions, assumptions, or conflicts require attention.

## IMPLEMENTATION_READY

Critical decisions are resolved, blocking validation issues are cleared, and implementation tasks have sufficient coverage.

Implementation Ready does not mean every optional detail is defined.

It means remaining uncertainty is below the threshold required for safe implementation.

---

# 10. Project Creation

## FR-001 — Create Project

The user must be able to create a new project.

Required:

- project name;
- initial idea description.

Optional:

- target users;
- constraints;
- references;
- preferred technologies.

---

## FR-002 — Initial Idea Analysis

After project creation, the system should analyze the initial description.

It should identify:

- known facts;
- potential product category;
- likely users;
- stated constraints;
- unknown areas;
- potential assumptions.

The analysis initializes the Discovery Map.

---

# 11. Discovery Engine

## FR-010 — Adaptive Discovery

The system must conduct an adaptive AI-assisted discovery process.

Questions should depend on previous answers and project context.

The system must avoid asking questions already answered implicitly or explicitly.

---

## FR-011 — Discovery Domains

The system should evaluate relevant areas including:

### Product

- problem;
- users;
- goals;
- use cases;
- scope;
- success criteria.

### Features

- core features;
- supporting features;
- workflows;
- business rules;
- edge cases.

### Access

- authentication;
- account lifecycle;
- roles;
- permissions.

### Data

- entities;
- relationships;
- ownership;
- lifecycle;
- retention.

### UX

- information architecture;
- navigation;
- important screens;
- responsive behavior;
- empty states;
- loading states;
- error states.

### Technical

- platform;
- stack;
- architecture;
- storage;
- deployment;
- asynchronous processing.

### Integrations

- third-party APIs;
- payments;
- email;
- external storage;
- other external systems.

### AI

When relevant:

- AI capabilities;
- provider strategy;
- context strategy;
- streaming;
- cost control;
- fallback behavior;
- AI boundaries.

### Non-Functional Requirements

- security;
- performance;
- privacy;
- reliability;
- accessibility.

---

## FR-012 — Conditional Discovery

Irrelevant discovery branches must be skipped.

Example:

If billing is not required, payment-provider questions should not be asked.

---

## FR-013 — Question Prioritization

Discovery questions should prioritize high-impact uncertainty.

Priority should conceptually consider:

- implementation impact;
- dependency count;
- uncertainty;
- MVP relevance.

Questions resolving foundational decisions should generally appear before cosmetic or low-impact decisions.

---

## FR-014 — Multi-Decision Extraction

A single user answer may resolve multiple related decisions.

The system should extract all supported decisions instead of asking redundant follow-up questions.

---

## FR-015 — AI Recommendations

When appropriate, AI may present a recommended choice.

Recommendations should contain a concise rationale.

Recommendations must remain distinguishable from confirmed user decisions.

---

# 12. Discovery Progress

The system tracks an `INITIAL` state plus three progressive discovery thresholds.

## Initial

No meaningful discovery has been completed yet.
The project has no usable specification.

## Quick Draft

Enough information exists to generate an early product specification.

## Detailed

Enough information exists to generate meaningful product, architecture, database, and design specifications.

## Agent Ready

Critical implementation decisions have been resolved and validation requirements are satisfied.

Users should not be forced to complete the entire discovery process before viewing an initial specification.

---

# 13. Decision System

## FR-020 — Decision Records

Important choices must be stored as structured decisions.

Each decision should support:

- identifier;
- category;
- title;
- value;
- rationale;
- source;
- impact;
- status;
- dependencies.

---

## FR-021 — Decision Status

Supported statuses should include:

- UNRESOLVED;
- RECOMMENDED;
- CONFIRMED;
- DEFERRED;
- NOT_APPLICABLE.

---

## FR-022 — Decision Dependencies

Decisions may activate, modify, or invalidate other decisions.

Example:

Authentication Required = No

may make the following decisions irrelevant:

- authentication provider;
- password recovery;
- OAuth providers.

---

## FR-023 — Decision Review

Users must be able to review important project decisions outside the chat interface.

Users should be able to inspect:

- confirmed decisions;
- recommendations;
- unresolved decisions;
- deferred decisions.

---

# 14. Project Knowledge

## FR-030 — Canonical Knowledge Model

The platform must maintain a canonical structured representation of the project.

Knowledge domains should include:

- vision;
- users;
- scope;
- features;
- business rules;
- constraints;
- entities;
- integrations;
- technical decisions;
- UX decisions;
- AI behavior;
- non-functional requirements.

---

## FR-031 — Knowledge Provenance

Knowledge items should retain their origin when practical.

Potential sources include:

- user statement;
- confirmed decision;
- accepted AI recommendation;
- AI inference.

---

## FR-032 — Confidence Classification

Information should be distinguishable as:

- Confirmed;
- Recommended;
- Assumption;
- Unresolved.

This classification should allow the system to identify hidden assumptions.

---

# 15. Requirement Identification

Functional requirements should receive stable identifiers.

Example:

FR-001  
FR-002  
FR-003

Other specification elements may use identifiers such as:

- ENT for entities;
- ARC for architectural components or decisions;
- SCREEN for major interface screens;
- TASK for implementation tasks;
- DEC for decisions.

Identifiers should remain stable whenever possible after regeneration.

---

# 16. Specification Compiler

## FR-040 — Generate Product Specification

The system must generate `PRD.md` from canonical project knowledge.

---

## FR-041 — Generate Architecture Specification

The system must generate `architecture.md`.

The document should describe implementation-relevant architecture including:

- system structure;
- application boundaries;
- major modules;
- services;
- integrations;
- data flow;
- deployment assumptions;
- relevant technical constraints.

---

## FR-042 — Generate Database Specification

The system must generate `database-schema.md`.

It should include:

- entities;
- attributes;
- relationships;
- constraints;
- indexes where relevant;
- ownership;
- lifecycle considerations.

---

## FR-043 — Generate Design Specification

The system must generate `design.md`.

It should define implementation-relevant interface expectations including:

- design direction;
- layout;
- navigation;
- screens;
- components;
- interaction patterns;
- responsive behavior;
- states;
- accessibility expectations.

---

## FR-044 — Generate AI Agent Specification

For products containing application-level AI agents, the system should generate `agents.md`.

This document describes agents that belong to the product being built.

If the project does not contain application-level agents, the document may be omitted or marked not applicable.

---

## FR-045 — Generate Agent Soul

When application-level AI behavior requires persistent personality, principles, boundaries, or behavioral guidance, the system may generate `soul.md`.

`soul.md` is not mandatory for every project.

---

# 17. Traceability System

## FR-050 — Requirement Relationships

The system should track relationships between specification elements.

Example:

FR-023

→ ARC-004  
→ ENT-003  
→ SCREEN-008  
→ TASK-031

---

## FR-051 — Requirement Coverage

The system should determine whether important requirements have corresponding implementation tasks.

---

## FR-052 — Orphan Detection

The system should detect specification elements with no apparent purpose or upstream requirement.

Example:

A database entity exists but no feature references it.

---

# 18. Validation Engine

The system must validate specifications before declaring a project implementation-ready.

---

## FR-060 — Completeness Validation

Detect important missing information.

Example:

Account deletion exists but data-deletion behavior is undefined.

---

## FR-061 — Consistency Validation

Detect conflicting specifications.

Example:

PRD defines Google-only authentication while design contains password authentication.

---

## FR-062 — Dependency Validation

Detect requirements whose dependencies are missing.

---

## FR-063 — Implementation Coverage Validation

Detect requirements that have no implementation task.

---

## FR-064 — Assumption Detection

Identify implementation-relevant information that exists only as an AI assumption.

---

# 19. Issue Severity

Validation findings should support:

- BLOCKER;
- HIGH;
- MEDIUM;
- LOW;
- INFO.

BLOCKER issues prevent Implementation Ready status.

High-impact unresolved decisions may also prevent Implementation Ready status.

---

# 20. Assumption Management

## FR-070 — Assumption Inventory

The user should be able to inspect assumptions made by the system.

Assumptions should include:

- description;
- impact;
- affected specifications;
- severity where applicable.

---

## FR-071 — Resolve Assumption

Users should be able to:

- confirm;
- replace;
- defer;
- reject

an assumption.

Resolved assumptions should update canonical project knowledge.

---

# 21. Readiness Engine

## FR-080 — Readiness Dimensions

The system should evaluate readiness across dimensions such as:

- Product;
- Features;
- Business Rules;
- Data;
- UX;
- Architecture;
- Security;
- Execution.

---

## FR-081 — Explainable Readiness

Readiness must not be an unexplained AI-generated percentage.

Users should be able to understand which issues reduce readiness.

---

## FR-082 — Implementation Ready State

The system may mark a project IMPLEMENTATION_READY when:

- no blocking validation issues remain;
- critical decisions are resolved;
- critical assumptions are resolved;
- core requirements have implementation coverage;
- implementation tasks are sufficiently defined.

---

# 22. Change Impact System

## FR-090 — Change Detection

When a confirmed decision changes, the system should identify potentially affected project knowledge and specifications.

---

## FR-091 — Impact Preview

Before applying significant generated updates, the system should show:

- affected documents;
- affected requirements;
- affected tasks;
- proposed changes.

---

## FR-092 — Controlled Update

Users should be able to:

- accept all changes;
- accept selected changes;
- reject proposed changes.

The system must avoid silently overwriting reviewed project content.

---

# 23. Task Planner

## FR-100 — Generate Implementation Plan

Once sufficient specifications exist, the system should generate an implementation plan.

---

## FR-101 — Milestones

Tasks should be organized into logical milestones where appropriate.

Example:

Foundation  
Core Product  
AI Capabilities  
Billing  
Hardening

---

## FR-102 — Task Dependencies

Tasks should explicitly identify dependencies when applicable.

---

## FR-103 — Implementation Task Structure

Each implementation task should support:

- stable identifier;
- title;
- objective;
- status;
- dependencies;
- related requirements;
- relevant architecture references;
- relevant entities;
- relevant screens;
- implementation notes;
- acceptance criteria;
- definition of done.

---

## FR-104 — Executable Task

Tasks should be sufficiently scoped for a coding agent to implement without having to reinterpret the entire product specification.

---

# 24. Generated Execution Documents

In addition to project specifications, Agent Ready Kit must generate coding-agent execution context.

---

## FR-110 — `context.md`

Generate a compact project bootstrap document containing:

- product mission;
- project scope;
- primary users;
- core capabilities;
- architecture summary;
- stack;
- important constraints;
- current implementation phase;
- specification locations.

The document should allow a coding agent to understand the project quickly before loading detailed specifications.

---

## FR-111 — `AGENTS.md`

Generate coding-agent instructions defining:

- required reading order;
- source-of-truth hierarchy;
- implementation workflow;
- task selection behavior;
- architectural boundaries;
- requirement-change rules;
- testing expectations;
- completion criteria.

`AGENTS.md` describes how a coding agent should work on the project.

It is separate from `docs/agents.md`, which describes AI agents belonging to the product itself.

---

# 25. Agent Kit

## FR-120 — Generic Agent Kit

The canonical export must be vendor-neutral.

Suggested structure:

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

Documents that do not apply to the project may be omitted.

---

## FR-121 — Manifest

The kit must contain machine-readable metadata describing (canonical field
set, see tasks.md TASK-103):

- schema version;
- project identifier;
- project name;
- generated timestamp;
- source project-state version;
- readiness state;
- included artifacts;
- artifact locations;
- export target.

---

## FR-122 — ZIP Export

MVP users must be able to download the Agent Kit as a ZIP archive.

---

# 26. Coding Agent Adapters

The architecture should allow future export adapters for different coding-agent environments.

The Generic Agent Kit remains canonical.

Adapters may modify or add instruction/configuration files without changing project intent.

Initial MVP may support:

- Generic Agent Kit;
- a limited number of explicitly supported coding-agent presets.

The system should not require vendor-specific functionality for core operation.

---

# 27. Project Workspace

The primary workspace should contain the following conceptual areas:

### Overview

Project state and readiness.

### Discovery

AI-guided discovery conversation.

### Decisions

Structured decision management.

### Specification

Product and engineering specifications.

### Issues

Validation problems and assumptions.

### Tasks

Implementation plan.

### Export

Agent Kit preparation and download.

The workspace, not the chat interface, is the primary product experience.

---

# 28. Dashboard

Users should be able to see their projects and relevant status information.

Each project may display:

- project name;
- lifecycle state;
- readiness;
- unresolved issue count;
- last update time.

---

# 29. AI Behavior Requirements

The AI must:

- prefer explicit knowledge over inference;
- avoid repeatedly asking resolved questions;
- identify uncertainty;
- distinguish recommendation from decision;
- avoid silently changing confirmed requirements;
- explain major recommendations;
- maintain awareness of project scope;
- prioritize implementation-impacting questions;
- preserve traceability when specifications evolve.

The AI should not attempt to maximize the number of generated documents.

Its objective is to maximize useful clarity while minimizing unnecessary user effort.

---

# 30. MVP Scope

The MVP includes:

1. User authentication.
2. Project creation and management.
3. Idea capture.
4. Initial project analysis.
5. Adaptive Discovery.
6. Structured decisions.
7. Project Knowledge.
8. Assumption tracking.
9. Specification generation.
10. PRD generation.
11. Architecture generation.
12. Database specification generation.
13. Design specification generation.
14. Optional application-agent specification.
15. Optional soul specification.
16. Validation engine.
17. Readiness engine.
18. Task planning.
19. `context.md` generation.
20. `AGENTS.md` generation.
21. Generic Agent Kit generation.
22. ZIP export.

---

# 31. Explicitly Deferred From MVP

The following should not block the initial product:

- existing repository analysis;
- GitHub synchronization;
- GitLab integration;
- repository push;
- source-code generation;
- autonomous coding;
- pull-request creation;
- deployment;
- CI/CD integration;
- multi-user collaboration;
- organization workspaces;
- repository drift detection;
- automatic synchronization from code to specification;
- IDE extensions;
- project-management integrations.

---

# 32. Future Direction

Potential post-MVP capabilities include:

### Repository Integration

Push an Agent Kit directly into a repository.

### Existing Project Import

Analyze an existing codebase and construct project knowledge.

### Specification Drift Detection

Compare implementation against canonical specifications.

### Bidirectional Sync

Update specifications when approved implementation changes occur.

### Agent Execution

Launch or coordinate coding agents directly from Agent Ready Kit.

### Pull Request Validation

Evaluate implementation against requirements and acceptance criteria.

### Team Collaboration

Allow product, design, and engineering stakeholders to participate in project decisions.

---

# 33. Success Metrics

The product should eventually measure outcomes related to implementation readiness rather than document generation volume.

Candidate metrics include:

### Discovery Completion

Percentage of projects reaching Detailed or Agent Ready state.

### Critical Assumption Count

Number of high-impact unresolved assumptions at export.

### Requirement Coverage

Percentage of implementation-relevant requirements linked to implementation tasks.

### Validation Resolution

Percentage of BLOCKER/HIGH findings resolved before export.

### Time to Agent Ready

Time between initial idea and Implementation Ready.

### Export Rate

Percentage of sufficiently developed projects exported as Agent Kits.

### Repeat Project Creation

Users who return to prepare additional projects.

Longer-term product validation should examine whether projects prepared with Agent Ready Kit require fewer clarification cycles and fewer requirement-related corrections during AI-assisted implementation.

---

# 34. North-Star Outcome

The north-star outcome is not:

> Number of documents generated.

Nor:

> Number of AI messages exchanged.

The desired outcome is:

> **A software project reaches a state where an AI coding agent can begin implementation with minimal undocumented assumptions and minimal unnecessary clarification.**

---

# 35. Canonical Product Pipeline

```text
IDEA
  ↓
DISCOVERY ENGINE
  ↓
DECISION GRAPH
  ↓
PROJECT KNOWLEDGE
  ↓
SPECIFICATION COMPILER
  ↓
ASSUMPTION + VALIDATION ENGINE
  ↓
READINESS ENGINE
  ↓
TASK PLANNER
  ↓
AGENT KIT COMPILER
  ↓
IMPLEMENTATION-READY PROJECT
```

---

# 36. Product Boundary

Agent Ready Kit owns:

**understanding what should be built and preparing sufficient context for implementation.**

The coding agent owns:

**implementing it.**

This boundary should remain clear throughout the MVP.

---

# 37. Product Promise

Agent Ready Kit should ultimately allow a user to move from:

> "I have an idea for an application."

to:

> "My project is sufficiently defined, validated, decomposed, and packaged for an AI coding agent to start building."

without requiring the user to manually construct and maintain a large collection of disconnected software-planning documents.