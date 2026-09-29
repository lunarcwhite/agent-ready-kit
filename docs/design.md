# Agent Ready Kit

## Product Design & UX Specification

**Document:** design.md  
**Status:** Draft v1  
**Product:** Agent Ready Kit  
**Platform:** Desktop-first responsive web application  
**Design Direction:** Modern developer tool, calm, structured, precise  
**Primary Principle:** Complexity should exist in the system, not in the user's experience.

---

# 1. Design Objective

Agent Ready Kit mengelola domain yang secara alami kompleks:

- discovery;
- decisions;
- assumptions;
- requirements;
- specifications;
- validation;
- traceability;
- readiness;
- implementation tasks;
- export.

UI tidak boleh membuat kompleksitas internal tersebut terasa seperti enterprise project-management software.

Tujuan desain adalah membuat perjalanan:

```text
Idea
  ↓
Discovery
  ↓
Understanding
  ↓
Specification
  ↓
Validation
  ↓
Implementation Ready
  ↓
Export
```

terasa sebagai satu workflow yang jelas.

---

# 2. Product Experience Principle

User seharusnya tidak merasa:

> "Saya sedang mengisi dokumentasi software."

User seharusnya merasa:

> "Saya sedang menjelaskan apa yang ingin saya bangun, dan sistem membantu saya membuatnya semakin jelas."

Ini adalah perbedaan UX yang fundamental.

---

# 3. Primary UX Goal

Setiap halaman harus membantu user menjawab salah satu dari empat pertanyaan:

```text
Where am I?

What does the system understand?

What still needs my attention?

What should I do next?
```

Jika sebuah halaman tidak menjawab salah satu pertanyaan tersebut, keberadaannya perlu dipertanyakan.

---

# 4. Product Personality

Visual experience harus terasa:

```text
Calm
Precise
Technical
Intelligent
Trustworthy
Focused
Modern
```

Hindari kesan:

```text
Playful AI toy
Generic SaaS dashboard
Enterprise admin panel
Overly futuristic AI interface
Documentation editor
ChatGPT clone
```

---

# 5. Design Inspiration

Visual direction dapat mengambil kualitas dari produk developer-oriented modern seperti:

```text
Linear
Vercel
Raycast
GitHub
Notion
Resend
Supabase
```

Bukan untuk menyalin tampilan mereka.

Yang diambil adalah prinsip:

- typography yang bersih;
- hierarchy kuat;
- restrained color;
- whitespace yang terukur;
- subtle borders;
- fast interaction;
- command-oriented UX;
- progressive disclosure;
- information density yang terkendali.

---

# 6. Visual Philosophy

Gunakan:

```text
neutral surfaces
subtle borders
small radius
high information clarity
limited accent color
minimal shadows
strong typography hierarchy
```

Avoid:

```text
large gradient backgrounds
glassmorphism everywhere
oversized cards
excessive rounded corners
decorative illustrations
constant glowing AI elements
```

Agent Ready Kit adalah working tool.

Visual design harus membantu konsentrasi.

---

# 7. Color System

Gunakan neutral-first palette.

Conceptually:

```text
Background
Primary Surface
Secondary Surface
Border
Primary Text
Secondary Text
Muted Text
Accent
Success
Warning
Danger
Info
```

Accent color digunakan secara hemat untuk:

```text
primary action
active navigation
focus
important progress
selected state
```

Semantic colors digunakan untuk status, bukan dekorasi.

---

# 8. Status Color Semantics

Consistent semantic mapping:

```text
Green
Confirmed
Resolved
Ready
Completed

Amber
Recommended
Needs Review
Warning
Partial

Red
Blocker
Conflict
Failed
Critical

Blue
Informational
In Progress
System Activity

Gray
Unknown
Deferred
Not Applicable
Inactive
```

Jangan menggunakan warna berbeda untuk konsep yang sama di halaman berbeda.

---

# 9. Typography

Gunakan sans-serif modern yang sangat readable.

Typography hierarchy:

```text
Page Title
Section Heading
Card Heading
Body
Metadata
Label
Code / Identifier
```

Stable IDs seperti:

```text
FR-014
DEC-AUTH-001
TASK-023
ENT-004
```

sebaiknya menggunakan monospace styling ringan.

---

# 10. Density

Agent Ready Kit adalah productivity application.

Desktop UI boleh cukup dense.

Target:

```text
lebih padat daripada consumer SaaS
lebih ringan daripada enterprise admin panel
```

Gunakan compact rows untuk:

- decisions;
- requirements;
- issues;
- assumptions;
- tasks.

Gunakan large cards hanya untuk high-level summary.

---

# 11. Application Shell

Desktop structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ Top Bar                                                     │
├───────────────┬─────────────────────────────────────────────┤
│               │                                             │
│ Project       │                                             │
│ Sidebar       │              Main Workspace                 │
│               │                                             │
│               │                                             │
└───────────────┴─────────────────────────────────────────────┘
```

Recommended sidebar width:

```text
240–260px
```

Sidebar dapat collapse pada viewport lebih kecil.

---

# 12. Global Top Bar

Top bar berisi konteks global, bukan navigation utama.

Conceptually:

```text
[ARK] Agent Ready Kit     StoryForge        86% Ready    [⌘K] [User]
```

Elements:

- product logo;
- current project;
- project readiness indicator;
- command/search trigger;
- user menu.

Optional later:

- notifications;
- sync status.

---

# 13. Project Sidebar

Recommended structure:

```text
OVERVIEW

Overview

DEFINE

Discovery
Decisions

SPECIFY

Product
Architecture
Data
Design
AI

VALIDATE

Issues
Readiness

EXECUTE

Tasks

SHIP

Agent Kit
```

Do not expose every internal database concept.

For example:

```text
knowledge_items
traceability_links
specification_sections
```

are internal implementation concepts and should not automatically become navigation items.

---

# 14. Contextual Badges

Sidebar items may display meaningful counts:

```text
Discovery       7
Decisions       3
Issues          4
Tasks          32
```

But only when counts are actionable.

Do not turn sidebar into notification noise.

---

# 15. Project Lifecycle Indicator

Lifecycle should be visible but not dominant.

Example:

```text
Discovery
   ●────────○────────○────────○
 Discovery   Draft    Review    Ready
```

Possible states:

```text
DISCOVERY
DRAFT
NEEDS REVIEW
IMPLEMENTATION READY
```

This communicates progress better than readiness percentage alone.

---

# 16. Global Command Palette

Keyboard shortcut:

```text
⌘K
Ctrl+K
```

Potential actions:

```text
Go to Discovery
Open Decisions
Search requirement
Search task
Generate specifications
Run validation
Export Agent Kit
```

Later it may support:

```text
Resolve DEC-AUTH-002
Open FR-014
Open TASK-031
```

This becomes especially useful for larger projects.

---

# 17. Project List

After login:

```text
Projects                                      [New Project]

Search projects...

┌─────────────────────────────────────────────┐
│ StoryForge                                  │
│ AI-assisted novel writing workspace         │
│                                             │
│ NEEDS REVIEW                       86%       │
│                                             │
│ 4 issues · 7 unresolved decisions           │
│                                             │
│ Updated 2h ago                              │
└─────────────────────────────────────────────┘
```

Cards should emphasize:

- project identity;
- current lifecycle;
- readiness;
- next unresolved work.

Do not overload with technical metadata.

---

# 18. Empty Project State

First-time experience:

```text
No projects yet

Turn your software idea into an
implementation-ready project specification.

[Create your first project]
```

Secondary explanation:

```text
Agent Ready Kit will guide you through discovery,
specification, validation, and implementation planning.
```

Avoid giant onboarding tours.

Let workflow teach the product.

---

# 19. New Project Flow

Project creation should be intentionally simple.

Screen:

```text
What do you want to build?

Project name
[ StoryForge                         ]

Describe your idea
┌───────────────────────────────────┐
│ I want to build an application... │
│                                   │
└───────────────────────────────────┘

Optional

Target users
Constraints
References
Preferred stack

                         [Start Discovery]
```

The large idea input is the primary element.

---

# 20. Progressive Optional Inputs

Optional fields should initially remain collapsed.

Example:

```text
+ Add target users
+ Add constraints
+ Add references
+ Add preferred stack
```

This prevents the first screen from feeling like a requirements form.

---

# 21. Idea Analysis Transition

After project submission:

```text
Understanding your idea...

✓ Identifying product type
✓ Extracting known requirements
● Mapping important unknowns
○ Preparing discovery
```

This communicates meaningful work.

Avoid fake progress bars with arbitrary percentages.

---

# 22. Initial Understanding Review

Before Discovery begins, show what the system understood.

Example:

```text
Here's what I understand so far

Product

AI-assisted novel writing application

Primary users

Independent novel writers

Core capabilities

• Create writing projects
• Plan stories
• Manage characters
• AI-assisted writing

Constraint

• Low-cost hosting

Still unclear

• Authentication
• Collaboration
• AI provider
• Export
• Data ownership

[Looks right — continue]

Something is wrong?
[Edit understanding]
```

This is an important trust checkpoint.

---

# 23. Discovery Workspace

Discovery is one of the most important screens.

Desktop layout:

```text
┌───────────────────────┬───────────────────────────┐
│                       │                           │
│ Discovery Progress    │ Conversation              │
│                       │                           │
│ Product          ✓    │                           │
│ Users            ✓    │ AI question               │
│ Features         ●    │                           │
│ Access           ○    │ User answer               │
│ Data             ○    │                           │
│ UX               ○    │                           │
│ Technical        ○    │                           │
│ Integrations     ○    │                           │
│ Security         ○    │                           │
│                       │ [Answer...]               │
└───────────────────────┴───────────────────────────┘
```

Discovery must not feel like generic chat.

The structured progress panel makes the purpose visible.

---

# 24. Discovery Progress

Show categories and their states.

Example:

```text
Discovery

Product               Complete
Users                 Complete
Features              In progress
Access                Not started
Data                  Not started
UX                    Not started
Technical             Not started
Integrations          Not applicable
AI                    Partial
Security              Not started
```

Compact icon representation may be used.

---

# 25. Discovery Levels

At the top:

```text
Discovery Level

✓ Quick Draft
● Detailed
○ Agent Ready
```

Supporting copy:

```text
You already have enough information to
generate an initial specification.

7 important decisions remain before Agent Ready.
```

This allows the user to stop before perfect completeness.

---

# 26. Discovery Conversation

Conversation style should be clean.

Avoid decorative AI avatars on every message.

Example:

```text
Agent Ready Kit

Will this application be used only by individual
writers, or should multiple people collaborate on
the same writing project?

Recommended for MVP

Individual projects only

This keeps permissions and collaboration outside
the first release.

[Individual only]

[Collaborative]

[Something else]
```

User may click an option or type naturally.

---

# 27. Recommended Choice

Recommendation must be visually distinct without appearing pre-decided.

Example:

```text
┌─────────────────────────────────────────┐
│ Recommended                             │
│                                         │
│ ● Individual projects only              │
│                                         │
│ Keeps MVP simpler and avoids team       │
│ permissions and invitations.            │
└─────────────────────────────────────────┘
```

Actions:

```text
[Use recommendation]

or choose another option.
```

Never auto-confirm important decisions merely because they are recommended.

---

# 28. Answer Interpretation Feedback

When one answer produces multiple decisions, briefly expose what was understood.

User:

```text
Tidak perlu login. Ini hanya dipakai sendiri dan
semua data cukup di browser.
```

System response:

```text
Understood

✓ Single-user application
✓ Authentication not required
✓ Local browser storage
✓ Collaboration not applicable

[Continue]
```

User can click:

```text
Review
```

if interpretation is wrong.

This creates trust in structured extraction.

---

# 29. Discovery Side Inspector

Optional right-side inspector on wide screens:

```text
CURRENT UNDERSTANDING

Authentication
Not required

Users
Single user

Storage
Local

Collaboration
Not applicable
```

Do not show the entire project state.

Only show context relevant to the current discovery area.

---

# 30. Discovery Resume

When returning later:

```text
Continue Discovery

You completed 18 decisions.

7 important decisions remain.

Last topic:
Data persistence

[Continue where I left off]
```

Do not force the user to reread conversation history.

---

# 31. Decision Center

Decision Center is a structured view of important project decisions.

Layout:

```text
Decisions                         24 confirmed · 7 unresolved

[All] [Unresolved] [Recommended] [Confirmed] [Deferred]

Search decisions...

ACCESS

Authentication required
Confirmed
Yes

Authentication methods
Needs decision
—

TECHNICAL

Database
Recommended
PostgreSQL

Deployment
Confirmed
Vercel
```

---

# 32. Decision Row

Each decision row should show:

```text
Title
Current value
Status
Impact
```

Example:

```text
Authentication method

Google OAuth

CONFIRMED        HIGH

User confirmed during Discovery

                                      [View]
```

Avoid showing database-like fields unless requested.

---

# 33. Decision Detail

Drawer or page:

```text
Authentication Method

DEC-AUTH-003

Status
Confirmed

Decision
Google OAuth

Why
Users should not need to manage passwords.

Impact
High

Source
Discovery

Confirmed
24 Sep 2026

Affected

Architecture        Authentication
Design              Login
Tasks               3 tasks
```

Actions:

```text
[Change decision]
```

Changing a confirmed high-impact decision should open impact review.

---

# 34. Decision Change Flow

User selects:

```text
Google OAuth
    ↓
Email + Google
```

Before applying:

```text
This decision affects:

Architecture          1 section
Design                2 sections
Tasks                 3 tasks

Changing this decision will mark these
areas for review.

[Cancel] [Continue]
```

The user should understand impact before committing.

---

# 35. Project Overview

Overview is a control center, not a marketing dashboard.

Recommended structure:

```text
StoryForge

NEEDS REVIEW                                    86%

Your project is almost implementation-ready.
4 issues need attention.

[Continue Review]
```

Then:

```text
Readiness

Product            100%
Features            96%
Business Rules      84%
Data                91%
UX                  78%
Architecture        95%
Security            71%
Execution           82%
```

Then:

```text
Needs Attention

1 Blocker
3 High priority issues
7 unresolved decisions
2 high-impact assumptions
```

Then:

```text
Next best action

Resolve authentication session policy

This affects:
Architecture · Security · Tasks

[Resolve]
```

---

# 36. Next Best Action

This is a key UX concept.

Instead of making users decide what to do next, the system should provide one primary recommendation.

Examples:

```text
Continue Discovery
Resolve 1 blocker
Review specification changes
Generate tasks
Export Agent Kit
```

This is recommendation, not forced navigation.

---

# 37. Specification Workspace

Specifications should not initially look like editable Markdown files.

Layout:

```text
SPECIFICATIONS

Product
Architecture
Data
Design
AI
```

Selected:

```text
Product Specification

CURRENT · v3

Overview
Users
Scope
Requirements
Business Rules
Constraints
```

Sections are independently manageable.

---

# 38. Specification Status

Document header:

```text
Product Specification

CURRENT

Version 3
Generated from project state 28

[View history] [Regenerate]
```

If stale:

```text
Product Specification

UPDATE AVAILABLE

3 sections are affected by recent decisions.

[Review changes]
```

Avoid vague "out of sync" messaging.

Explain what changed.

---

# 39. Specification Section

Example:

```text
Authentication

CURRENT

Users must authenticate before accessing their
workspace.

Supported methods:

• Google OAuth

Unauthenticated users may access:

• Landing page
• Login

Sources

DEC-AUTH-001
DEC-AUTH-003
FR-008
```

Source references may be collapsed by default.

---

# 40. Raw Markdown

Users may want to inspect final Markdown.

Provide:

```text
[Structured] [Markdown]
```

Structured is default.

Markdown is secondary.

This reinforces:

> Documents are projections, not canonical state.

---

# 41. Manual Editing Philosophy

Do not turn specification pages into unrestricted document editors.

If users freely rewrite generated Markdown, canonical state and rendered specification can diverge.

Preferred interaction:

```text
Suggest change
Edit source decision
Edit requirement
```

For purely editorial wording, allow section-level text adjustment without changing canonical meaning.

---

# 42. Specification Change Review

When a decision causes updates:

```text
Review Specification Changes

Authentication strategy changed

Architecture

Authentication

- Google OAuth only
+ Google OAuth and email/password

Design

Login

+ Add email field
+ Add password field
+ Add forgot-password action

Tasks

+ TASK-032 Password authentication
+ TASK-033 Password reset
```

Actions:

```text
[Accept All]

or

[Accept] [Reject]
```

per proposed change.

---

# 43. Diff Presentation

Use semantic diff.

Avoid showing raw JSON.

Text changes:

```text
- removed
+ added
```

Structured changes:

```text
Authentication Methods

Before
Google

After
Google
Email/password
```

Choose the representation that communicates meaning most clearly.

---

# 44. Data Specification

Data workspace should represent domain entities visually as structured lists.

Example:

```text
Entities

ENT-001 User
ENT-002 Project
ENT-003 Specification
ENT-004 Task
```

Selecting:

```text
ENT-002
Project

Attributes

name            string       required
slug            string       required · unique
description     text         optional
state           enum         required

Relationships

User
1 → many
Project
```

Do not require an ER diagram for MVP.

A future visualization may be added.

---

# 45. Requirements View

Within Product Specification:

```text
Requirements

[MUST 18] [SHOULD 7] [COULD 5]

FR-001
Create Project

MUST

Users can create a project by providing
a project name and software idea.

Acceptance Criteria

✓ Project name is required
✓ Idea is required
✓ User becomes project owner
✓ Discovery begins after creation

Coverage
Architecture       ARC-002
Data               ENT-002
Design             SCREEN-003
Tasks              TASK-012 · TASK-013
```

This is where traceability becomes visible and useful.

---

# 46. Traceability UX

Do not expose a giant graph by default.

Instead show contextual traceability.

Example:

```text
FR-014 Create Project

Used by

Architecture
Project Module

Data
ENT-002 Project

Design
SCREEN-004 Project Creation

Tasks
TASK-021
TASK-022
```

A graph visualization can be added later if genuinely useful.

---

# 47. Validation Issues Workspace

Layout:

```text
Issues

1 Blocker
3 High
4 Medium
7 Low

[Open] [Resolved] [Ignored]

BLOCKER

Authentication strategy incomplete

Authentication is required, but no authentication
method has been confirmed.

Affected

Architecture
Design
Security

[Resolve]
```

---

# 48. Issue Resolution

Clicking Resolve should ideally take the user directly to the decision required.

Example:

```text
Resolve Issue

Authentication method is missing.

Recommended
Google OAuth

Why
...

[Use recommendation]

Other options
○ Email/password
○ Magic link
○ Custom
```

Resolution should be actionable, not just descriptive.

---

# 49. Issue Severity Presentation

Do not make every issue visually alarming.

Use strongest visual treatment only for:

```text
BLOCKER
HIGH
```

Medium and low issues should remain quieter.

This preserves attention hierarchy.

---

# 50. Assumptions Workspace

Assumptions can live inside Validation rather than requiring top-level navigation.

Example:

```text
Assumptions

Critical       0
High           2
Medium         5
Low            8
```

Card:

```text
ASM-004

File storage strategy has not been confirmed.

HIGH

Currently assumed:
Temporary object storage

Affected:
FR-021
ARC-008
TASK-041

[Resolve]
```

---

# 51. Assumption Resolution

Options:

```text
[Confirm assumption]

[Choose another option]

[Defer]
```

Confirmation should convert the underlying assumption into appropriate confirmed knowledge or decision.

---

# 52. Readiness Workspace

Readiness deserves its own page because it is one of the product's major differentiators.

Header:

```text
Agent Readiness

86%

NEEDS REVIEW
```

Supporting copy:

```text
Your project is structurally complete,
but 4 important issues remain.
```

---

# 53. Readiness Dimensions

Example:

```text
Product

████████████████████ 100%

Features

███████████████████░ 96%

Business Rules

████████████████░░░░ 84%

Data

██████████████████░░ 91%

UX

███████████████░░░░░ 78%

Architecture

███████████████████░ 95%

Security

██████████████░░░░░░ 71%

Execution

████████████████░░░░ 82%
```

Clicking a dimension reveals its criteria.

---

# 54. Explainable Score

Example Security detail:

```text
Security — 71%

✓ Authentication required
✓ Authorization model defined
✓ Project ownership defined

○ Session policy unresolved
○ Account deletion retention unresolved
○ Rate-limit policy undefined
```

The user should never wonder why a score is 71%.

---

# 55. Readiness State

State is more important than percentage.

Possible:

```text
DISCOVERY
DRAFT
NEEDS REVIEW
IMPLEMENTATION READY
```

A project with:

```text
94%
```

but one blocker remains should still be:

```text
NEEDS REVIEW
```

not Ready.

---

# 56. Implementation Ready Moment

When all required criteria are satisfied:

```text
✓ Implementation Ready

Your project has enough confirmed context for
a coding agent to begin implementation without
making major product assumptions.

[Generate Implementation Plan]
```

This should feel meaningful but not celebratory to the point of distraction.

---

# 57. Task Workspace

> Namespace note (per spec-decisions.md D-A10b): task codes in this
> section illustrate target-project plans and belong to the `UTASK-xxx`
> namespace. They are shown as `TASK-xxx` for brevity in mockups.
> `TASK-xxx` in `tasks.md` refers to the Agent Ready Kit build plan itself.

Task workspace should resemble a focused implementation plan rather than Jira.

Default view:

```text
Implementation Plan

32 tasks
6 milestones

[Milestones] [All Tasks]
```

---

# 58. Milestone View

Example:

```text
M1 Foundation

3 / 5 ready

TASK-001   Initialize application             READY
TASK-002   Configure database                 READY
TASK-003   Configure authentication           BLOCKED
TASK-004   Configure AI provider              READY


M2 Project Workspace

TASK-005   Create Project domain model        BLOCKED
TASK-006   Implement Project API              BLOCKED
TASK-007   Implement project list             BLOCKED
```

Dependencies explain why tasks are blocked.

---

# 59. Task Detail

Example:

```text
TASK-021

Implement Project Creation

READY

Objective

Allow authenticated users to create a new project
and begin Discovery.

Implements

FR-003
FR-004

References

Architecture
ARC-002 Project Module

Data
ENT-002 Project

Design
SCREEN-004 Project Creation

Dependencies

TASK-012
TASK-014

Acceptance Criteria

□ Project name is required
□ Idea is required
□ Project owner is assigned automatically
□ Initial project state is DISCOVERY
□ User is redirected to Discovery

Definition of Done

□ Implementation complete
□ Tests pass
□ Lint passes
□ Acceptance criteria verified
```

---

# 60. Task Status

For MVP:

```text
PENDING
READY
BLOCKED
REVIEW REQUIRED
DONE
```

However, because Agent Ready Kit does not execute repository work yet, task status should primarily describe **specification/execution readiness**, not pretend to know actual implementation status.

This distinction must be clear in UI.

---

# 61. Dependency UX

Selecting:

```text
TASK-021
```

may show:

```text
Depends on

TASK-012 Database setup       READY
TASK-014 Authentication       READY

Blocks

TASK-024 Project dashboard
TASK-025 Project settings
```

No dependency graph visualization is required for MVP.

---

# 62. Generate Tasks Flow

When specifications are sufficiently mature:

```text
Ready to generate implementation plan

Agent Ready Kit will create:

• milestones
• implementation tasks
• dependencies
• requirement mappings
• acceptance criteria
• definition of done

[Generate Plan]
```

After generation:

```text
32 tasks generated

Coverage

MUST requirements       18 / 18
SHOULD requirements      7 / 7

3 tasks require review.

[Review Plan]
```

---

# 63. Agent Kit Workspace

Final navigation item:

```text
Agent Kit
```

This is the handoff workspace.

Header:

```text
Agent Kit

IMPLEMENTATION READY
```

---

# 64. Export Preparation

Example:

```text
Prepare Agent Kit

Target

● Generic
○ Codex
○ Claude Code
○ Cursor
○ Gemini CLI

Project phase

● Build from scratch

Task strategy

● Sequential
○ By milestone

Include

☑ Product specification
☑ Architecture
☑ Database
☑ Design
☑ Product AI agents
☑ Soul
☑ Tasks
☑ Context
☑ Coding-agent instructions
```

Only applicable documents should appear.

---

# 65. Export Readiness Check

Before export:

```text
Agent Kit Check

✓ Product specification current
✓ Architecture current
✓ Data specification current
✓ Design current
✓ 18 / 18 MUST requirements covered
✓ No blockers
✓ No critical assumptions

Ready to export.
```

If not ready:

```text
2 issues should be resolved before export.

[Review Issues]
```

Whether export is completely blocked should depend on severity.

---

# 66. Export Action

Primary CTA:

```text
[Generate Agent Kit]
```

Then:

```text
Generating Agent Kit

✓ Compiling context
✓ Preparing coding-agent instructions
✓ Rendering specifications
● Creating package
```

When complete:

```text
Agent Kit ready

storyforge-agent-kit.zip

Project state
v28

Generated
24 Sep 2026

[Download ZIP]
```

---

# 67. Export Contents Preview

Before or after generation:

```text
storyforge/
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

Files that are not applicable should not be artificially generated merely to preserve this exact structure.

---

# 68. Export History

Useful even in MVP:

```text
Previous Exports

v28
Generic
Today 14:32

v24
Generic
Yesterday 19:10
```

Each export records the project state version.

This makes it clear whether the current project changed after export.

---

# 69. Export Staleness

If project changes after export:

```text
Current project has changed since your last Agent Kit.

Last export
State v28

Current
State v31

3 confirmed changes

[Generate Updated Kit]
```

This prepares the UX for future Git synchronization.

---

# 70. Notifications

Avoid a complex notification center for MVP.

Use:

- inline status;
- toast for temporary success/failure;
- badges for actionable counts;
- project overview for persistent issues.

Do not duplicate the same alert everywhere.

---

# 71. Toast Usage

Good:

```text
Decision confirmed
```

```text
Specification changes accepted
```

```text
Agent Kit generated
```

Bad:

```text
You have 7 unresolved decisions
```

Persistent information belongs in the page, not a toast.

---

# 72. Loading States

Prefer skeletons for page loading.

For AI operations, show meaningful operation state.

Example:

```text
Reviewing your latest answer...
```

or:

```text
Checking specification consistency...
```

Avoid generic:

```text
AI is thinking...
```

whenever a more precise operation name exists.

---

# 73. Long AI Operations

For operations that may take several seconds:

```text
Generating architecture specification

✓ Preparing project context
● Compiling architecture
○ Validating output
```

Do not imply exact percentage unless actual progress can be measured.

---

# 74. AI Failure State

Example:

```text
Architecture generation failed

Your existing specification was not changed.

[Try again]
```

Optional:

```text
View technical details
```

for advanced users.

Never make the user wonder whether partial state was saved.

---

# 75. Empty States

Every major workspace needs a meaningful empty state.

Example Tasks:

```text
No implementation plan yet

Tasks can be generated after your core
specifications are sufficiently complete.

Current readiness
72%

[View what's missing]
```

---

# 76. Error States

Errors should answer:

```text
What happened?
Was anything changed?
What can I do now?
```

Example:

```text
We couldn't interpret that answer.

Nothing was changed.

Try rephrasing your answer or choose one of
the suggested options.

[Try again]
```

---

# 77. Destructive Actions

Project deletion:

```text
Delete StoryForge?

This will remove the project from your workspace.

The project will initially be retained for recovery
according to the platform's retention policy.

Type:

StoryForge

[Cancel] [Delete Project]
```

Avoid destructive action next to common actions.

---

# 78. Keyboard Support

Important desktop shortcuts:

```text
⌘K / Ctrl+K
Command palette

Esc
Close drawer/modal

/
Focus contextual search
```

Later:

```text
G then D
Discovery

G then T
Tasks
```

Do not overbuild shortcut systems for MVP.

---

# 79. Responsive Strategy

Primary target:

```text
Desktop
Laptop
```

Secondary:

```text
Tablet
```

Mobile should support:

```text
project overview
review decisions
continue simple discovery
view issues
```

Complex specification editing/review and task management may be less optimized on mobile.

---

# 80. Mobile Navigation

Sidebar becomes:

```text
top bar
+
navigation drawer
```

Avoid bottom navigation because the product has too many conceptual sections for a stable 4–5 item mobile tab bar.

---

# 81. Discovery on Mobile

Discovery should remain usable.

Layout becomes:

```text
Discovery                     71%

Detailed

Current topic
Features

────────────────────────────

Question

Will projects support...

[Option]
[Option]

[Type another answer...]

────────────────────────────

[View progress]
```

Progress categories move into a drawer/sheet.

---

# 82. Accessibility

Target:

```text
WCAG 2.1 AA
```

Requirements:

- sufficient contrast;
- keyboard navigation;
- visible focus state;
- semantic headings;
- proper form labels;
- ARIA where required;
- no color-only status communication;
- reduced-motion support.

---

# 83. Status Accessibility

Never rely only on:

```text
green
yellow
red
```

Always pair with text or icon:

```text
✓ Confirmed
◇ Recommended
! Blocker
? Unresolved
```

---

# 84. Motion

Motion should be subtle and functional.

Appropriate:

- drawer transitions;
- accordion expansion;
- status transition;
- loading indicator;
- diff reveal.

Avoid:

- animated gradients;
- constant floating elements;
- decorative AI pulses;
- excessive spring effects.

---

# 85. AI Presence

AI should feel integrated into the workflow rather than represented as a mascot.

Avoid a persistent:

```text
Ask AI
```

floating bubble.

Instead AI appears contextually:

```text
Recommended
Generate
Explain
Resolve
Review Changes
Continue Discovery
```

The product itself is AI-assisted.

It does not need to constantly announce that fact.

---

# 86. Trust Signals

Because AI interprets user intent, trust is crucial.

UI should expose:

```text
Confirmed by you
Recommended
Inferred
Assumed
Needs decision
```

and allow users to inspect sources where useful.

---

# 87. Source Provenance

Example:

```text
Why is this here?

Authentication is required

Source

You said:
"Setiap user punya project sendiri."

Discovery
24 Sep 2026
```

Do not display provenance everywhere by default.

Make it available on demand.

---

# 88. Advanced Detail Disclosure

Agent Ready Kit serves technical users but should not overwhelm them.

Use progressive disclosure:

```text
Default
Meaningful product information

Expanded
IDs
dependencies
source provenance
state versions
technical metadata
```

---

# 89. Developer-Friendly Details

Stable codes should be easy to copy.

Example:

```text
FR-014        [Copy]
```

Similarly:

```text
TASK-021
DEC-AUTH-003
ENT-002
```

This becomes useful when communicating with coding agents.

---

# 90. Search

Global search should eventually search:

```text
decisions
requirements
entities
issues
tasks
specifications
```

Result:

```text
FR-014
Create Project
Requirement

TASK-021
Implement Project Creation
Task

DEC-PROJECT-004
Project Ownership
Decision
```

MVP search can initially be simpler.

---

# 91. Information Architecture Summary

```text
Projects
  │
  └── Project
       │
       ├── Overview
       │
       ├── Discovery
       │
       ├── Decisions
       │
       ├── Specifications
       │    ├── Product
       │    ├── Architecture
       │    ├── Data
       │    ├── Design
       │    └── AI
       │
       ├── Validation
       │    ├── Issues
       │    └── Assumptions
       │
       ├── Readiness
       │
       ├── Tasks
       │
       └── Agent Kit
```

---

# 92. MVP Screen Inventory

### Public / Account

```text
SCREEN-001 Landing
SCREEN-002 Login
```

### Project Management

```text
SCREEN-003 Project List
SCREEN-004 Create Project
SCREEN-005 Project Overview
```

### Discovery

```text
SCREEN-006 Initial Understanding
SCREEN-007 Discovery Workspace
SCREEN-008 Decision Center
SCREEN-009 Decision Detail
```

### Specifications

```text
SCREEN-010 Product Specification
SCREEN-011 Architecture Specification
SCREEN-012 Data Specification
SCREEN-013 Design Specification
SCREEN-014 AI Specification
SCREEN-015 Specification Change Review
```

### Validation

```text
SCREEN-016 Issues
SCREEN-017 Issue Resolution
SCREEN-018 Readiness
```

### Execution

```text
SCREEN-019 Task Plan
SCREEN-020 Task Detail
```

### Export

```text
SCREEN-021 Agent Kit
SCREEN-022 Export Result
```

Some screens may be implemented as drawers or modal states rather than separate routes.

`SCREEN-*` represents product concepts, not mandatory URLs.

---

# 93. Route Recommendation

Conceptual route structure:

```text
/projects

/projects/new

/projects/:projectId

/projects/:projectId/discovery
/projects/:projectId/decisions

/projects/:projectId/specifications/product
/projects/:projectId/specifications/architecture
/projects/:projectId/specifications/data
/projects/:projectId/specifications/design
/projects/:projectId/specifications/ai

/projects/:projectId/issues
/projects/:projectId/readiness

/projects/:projectId/tasks

/projects/:projectId/agent-kit
```

Detail objects may use drawers and query parameters rather than dedicated routes.

---

# 94. Core Component Inventory

Application shell:

```text
AppShell
TopBar
ProjectSidebar
CommandPalette
```

Project:

```text
ProjectCard
LifecycleIndicator
ReadinessBadge
NextActionCard
```

Discovery:

```text
DiscoveryProgress
DiscoveryQuestion
RecommendationCard
AnswerComposer
InterpretationSummary
DiscoveryContextPanel
```

Decision:

```text
DecisionList
DecisionRow
DecisionStatus
DecisionDetail
DecisionImpactSummary
```

Specification:

```text
SpecificationHeader
SpecificationSection
SpecificationStatus
MarkdownPreview
SourceReferences
ChangeReview
SemanticDiff
```

Validation:

```text
IssueList
IssueCard
SeverityBadge
IssueResolution
AssumptionCard
```

Readiness:

```text
ReadinessSummary
ReadinessDimension
ReadinessCriteria
```

Tasks:

```text
MilestoneGroup
TaskRow
TaskDetail
DependencyList
CoverageSummary
```

Export:

```text
AgentTargetSelector
ExportChecklist
ExportProgress
FileTreePreview
ExportHistory
```

---

# 95. Shared UI Patterns

Use the same patterns across the product.

### Status Badge

```text
CONFIRMED
NEEDS REVIEW
BLOCKER
READY
```

### Reference Chip

```text
FR-014
TASK-021
ENT-002
```

### Impact Summary

```text
Architecture  1
Design        2
Tasks         3
```

### Review Banner

```text
3 sections need review
[Review Changes]
```

Consistency lowers cognitive load.

---

# 96. Primary CTA Rule

Each screen should ideally have one visually dominant action.

Examples:

Discovery:

```text
[Continue]
```

Issues:

```text
[Resolve]
```

Readiness:

```text
[Review blockers]
```

Tasks:

```text
[Generate Plan]
```

Agent Kit:

```text
[Generate Agent Kit]
```

Avoid multiple competing primary buttons.

---

# 97. Confirmation Rule

Do not show confirmation dialogs for reversible low-risk actions.

Use confirmation for:

- project deletion;
- high-impact decision change;
- discarding reviewed changes;
- irreversible destructive actions.

Too many confirmation dialogs reduce trust rather than improve it.

---

# 98. Autosave

User inputs should generally autosave.

Examples:

```text
discovery answers
project description
low-risk project settings
```

Show subtle state:

```text
Saved
```

Do not require a Save button on every page.

---

# 99. Review vs Edit

The product has two distinct interaction modes:

```text
Define
Review
```

Define:

```text
answer question
choose decision
edit requirement
```

Review:

```text
inspect generated specification
review change
resolve conflict
validate plan
```

UI should make this distinction understandable.

---

# 100. UX Around Canonical State

Users do not need to understand the phrase:

```text
canonical structured state
```

Instead the interface communicates:

```text
Your decisions
Your requirements
Your project understanding
```

Internal architecture should not leak unnecessarily into product language.

---

# 101. Terminology

Preferred user-facing terms:

```text
Discovery
Decision
Requirement
Specification
Issue
Assumption
Readiness
Implementation Plan
Agent Kit
```

Avoid internal terminology:

```text
knowledge item
dependency hash
canonical state
semantic compiler
project state version
```

unless shown in advanced technical detail.

---

# 102. Readiness Terminology

Use:

```text
Agent Readiness
```

rather than:

```text
AI Score
Quality Score
Project Score
```

The score specifically measures readiness for implementation handoff.

---

# 103. Export Terminology

Use:

```text
Agent Kit
```

as the product-level concept.

Use:

```text
Download ZIP
```

as the delivery mechanism.

Do not position the product as:

```text
Documentation Exporter
```

---

# 104. Onboarding Philosophy

Do not create a 10-step product tour.

Preferred onboarding:

```text
Create project
       ↓
Describe idea
       ↓
Review understanding
       ↓
Answer first discovery question
```

The product explains itself through use.

---

# 105. First Success Moment

The first meaningful success moment should happen before full specification generation.

After several discovery answers, show:

```text
Your project is becoming clearer

12 decisions resolved

Agent Ready Kit now understands:

✓ target users
✓ core workflow
✓ data ownership
✓ authentication

You can generate a Quick Draft now,
or continue toward Detailed discovery.

[Generate Quick Draft]
[Continue Discovery]
```

This gives value early.

---

# 106. Second Success Moment

After initial specification generation:

```text
Initial specification ready

Product
Architecture
Data
Design

Generated from 24 confirmed decisions.

[Review Specification]
```

This demonstrates transformation from conversation into structure.

---

# 107. Final Success Moment

```text
Implementation Ready

0 blockers
0 critical assumptions
All MUST requirements covered

Your Agent Kit is ready.

[Generate Agent Kit]
```

This is the primary completion state of the MVP.

---

# 108. Avoid Dashboard Syndrome

Do not fill Overview with:

```text
pie charts
line charts
AI usage charts
token statistics
document counts
```

unless they help the user move the project forward.

Overview should prioritize:

```text
state
readiness
issues
next action
recent meaningful changes
```

---

# 109. Avoid Chat Syndrome

Discovery uses conversation, but Agent Ready Kit is not primarily a chat application.

After information is understood, it should become structured state.

The UI should continuously reinforce this transition:

```text
Conversation
     ↓
Decision
     ↓
Specification
```

---

# 110. Avoid Document Syndrome

Likewise, Agent Ready Kit is not primarily a Markdown editor.

The user should manipulate project meaning rather than manually maintain seven interconnected documents.

Documents remain inspectable and exportable.

---

# 111. Design System Recommendation

For implementation, establish design tokens for:

```text
spacing
radius
typography
border
surface
text
semantic status
motion
breakpoints
```

Do not scatter arbitrary visual values throughout components.

---

# 112. Spacing

Use a compact 4px-based spacing system.

Conceptually:

```text
4
8
12
16
20
24
32
40
48
```

Most workspace components should live around:

```text
8–24px
```

Large 64–96px spacing should be reserved for public marketing pages, not application workspace.

---

# 113. Radius

Prefer moderate radius.

Conceptually:

```text
small controls      6px
cards               8px
large panels        10–12px
```

Avoid turning every component into a pill.

Pills are appropriate for:

```text
status
filters
small tags
```

---

# 114. Borders and Shadows

Prefer subtle border separation.

Use shadows primarily for:

```text
popover
modal
command palette
floating drawer
```

Workspace cards should not all float independently.

This keeps the interface visually calm.

---

# 115. Dark Mode

The design system should support dark mode from the token level.

However, dark mode does not need to delay MVP if implementation time is constrained.

Do not hardcode colors that make future dark mode difficult.

---

# 116. Performance UX

Navigation between already-loaded project sections should feel immediate.

Optimistic UI is appropriate for low-risk actions such as:

```text
filter changes
collapse state
minor preference changes
```

Do not optimistically display confirmed state for operations requiring AI validation.

---

# 117. AI Latency UX

When AI processing occurs, preserve user context.

Do not replace the entire screen with a loading page.

Example:

```text
Decision Center remains visible

small status:
Updating affected specifications...
```

Users should still understand where they are.

---

# 118. Background Generation

Where technically possible, longer generation should allow the user to navigate elsewhere.

Status can appear in the top bar:

```text
Generating Architecture...
```

When finished:

```text
Architecture update ready for review
```

MVP may simplify this if background jobs add too much initial complexity.

---

# 119. Project Health Language

Avoid emotionally loaded language such as:

```text
Your project is bad
Poor architecture
Weak design
```

Use factual language:

```text
3 decisions remain unresolved

2 requirements have no task coverage

Authentication conflicts with the current design
```

---

# 120. Explain Before Blocking

When an action is unavailable:

Bad:

```text
Export disabled.
```

Better:

```text
Agent Kit isn't ready yet.

Resolve 1 blocker before generating the final kit.

[View blocker]
```

Disabled states should explain themselves.

---

# 121. Flexible Export

Agent Ready Kit may allow non-ready exports for advanced users later.

If introduced:

```text
Generate Draft Kit
```

must be clearly distinguished from:

```text
Generate Agent-Ready Kit
```

The exported manifest should record readiness state.

For MVP, this can remain conservative.

---

# 122. User Control

Every meaningful AI proposal should allow appropriate user control.

Depending on context:

```text
Accept
Reject
Edit
Choose another option
Resolve later
```

Do not force users to accept generated project meaning.

---

# 123. Design Invariants

### UX-INV-001

Every project screen must make current project state understandable.

### UX-INV-002

Important AI recommendations are distinguishable from confirmed decisions.

### UX-INV-003

Assumptions are never visually presented as confirmed facts.

### UX-INV-004

Users can understand why a project is or is not implementation-ready.

### UX-INV-005

Important decision changes expose downstream impact before destructive propagation.

### UX-INV-006

Generated documents are presented as structured specifications, not as the sole project state.

### UX-INV-007

Validation issues provide a clear path toward resolution.

### UX-INV-008

The product provides a clear recommended next action without removing user control.

### UX-INV-009

AI operations never obscure whether approved state changed.

### UX-INV-010

Complex internal concepts are progressively disclosed rather than exposed by default.

---

# 124. MVP Design Boundary

Must design and implement well:

```text
Project List
Project Creation
Initial Understanding
Project Overview
Discovery
Decision Center
Specifications
Issues
Readiness
Task Plan
Agent Kit Export
```

Can remain simple:

```text
settings
profile
export history
search
mobile advanced workflows
```

Do not spend MVP design effort on:

```text
team collaboration
billing dashboard
repository browser
code viewer
agent execution console
analytics dashboards
organization management
```

---

# 125. Core User Journey

The primary journey should feel like:

```text
I have an idea
       ↓
Tell Agent Ready Kit
       ↓
It understands what I mean
       ↓
It asks only what matters
       ↓
I make important decisions
       ↓
My project becomes structured
       ↓
Specifications appear
       ↓
Problems become visible
       ↓
I resolve ambiguity
       ↓
Implementation plan appears
       ↓
Project becomes Agent Ready
       ↓
I export the Agent Kit
       ↓
Coding begins
```

---

# 126. Final Design Principle

Agent Ready Kit contains a sophisticated internal system:

```text
Discovery Engine
Decision Graph
Project Knowledge
Specification Compiler
Validation Engine
Assumption Engine
Readiness Engine
Task Planner
Agent Kit Compiler
```

The user should not experience that sophistication as complexity.

The ideal interface feels like:

> **A calm technical partner that always knows what has been decided, what remains unclear, why it matters, and what should happen next.**

The final design principle is therefore:

```text
Complex system.
Simple mental model.

Rich project state.
Focused interface.

Powerful AI.
Visible human control.

Deep specification.
Clear next action.
```