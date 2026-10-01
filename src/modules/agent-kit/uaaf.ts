// UAAF (Universal AI Agent Framework) vendor preset content.
// MIT License, Copyright (c) 2026 lunarcwhite.
//
// Static scaffold files bundled with the application. These files are
// redistributed under the MIT License. The LICENSE file is included.
//
// Source: https://github.com/lunarcwhite/agentic-workflow-framework
//
// This module exports the UAAF scaffold files as AgentKitFile[] for the
// uaaf vendor preset. The content is immutable — it is never modified by
// the adapter boundary.

import type { AgentKitFile } from "./compiler";

const UAAF_FILES: AgentKitFile[] = [
  {
    path: ".ai/manifest.yaml",
    content: `schema_version: '1.0'
framework:
  name: Universal AI Agent Framework
  id: UAAF
  version: 1.0.0
protocols:
  agent: UAP-1.0
  context: CLE-1.0
  intent: IRE-1.0
  planning: APRE-1.0
  memory: MEE-1.0
  anti_slop: ASE-1.0
  verification: VEE-1.0
  reality: RCE-1.0
project:
  name: ''
  type: ''
  maturity: existing
  status: active
agent:
  autonomy_level: 2
  mode: adaptive
features:
  memory: true
  anti_slop: true
  verification: true
  replanning: true
  session_handoff: true
  traceability: true
capabilities:
  product: false
  frontend: false
  backend: false
  api: false
  database: false
  ui: false
  design_system: false
  security: false
  performance: false
  deployment: false
  mobile: false
  data: false
  testing: false
  infrastructure: false
planning:
  evidence_first: true
  max_replans_without_review: 2
quality:
  required_for_done:
  - intent
  - requirements
  - acceptance_criteria
  - verification
  - scope
anti_slop:
  enabled: true
  mode: contextual
verification:
  enabled: true
  default_evidence_depth: risk_based
sessions:
  enabled: true
  id_format: SES-YYYYMMDD-NNN
source_of_truth:
  current_implementation: repository
  state: .ai/memory/STATE.md
  memory: .ai/memory/entries
  decisions: .ai/decisions
  verification: .ai/verification
profile: full
`,
  },
  {
    path: ".ai/INDEX.md",
    content: `# UAAF Project Index

## Kernel
- \`.ai/manifest.yaml\`
- \`.ai/core/\`

## Tasks
- \`.ai/tasks/INDEX.md\`

## Memory
- \`.ai/memory/STATE.md\`
- \`.ai/memory/MEMORY.md\`

## Decisions
- \`.ai/decisions/INDEX.md\`

## Verification
- \`.ai/verification/\`

## Anti-Slop
- \`.ai/anti-slop/\`

## Sessions
- \`.ai/sessions/\`


## UAAF v1.1 extensions (optional)

When enabled, \`.ai/capabilities.yaml\` stores detected/effective capability overrides and \`.ai/context/IMPACT-GRAPH.yaml\` stores the advisory Context Impact Graph.
`,
  },
  {
    path: ".ai/anti-slop/GATES.md",
    content: `# Gates

## HARD GATE
Fabrication, fake verification, secret leakage, silent scope expansion, intent replacement, known incompleteness presented as complete.

## PURPOSE GATE
New abstraction, dependency, major refactor, decorative motion, or pattern divergence needs a concrete reason.

## QUALITY LOCK
Consistency with project naming, tokens, components, interactions, responsiveness, accessibility, and established conventions.
`,
  },
  {
    path: ".ai/AGENTS.md",
    content: `# UAAF Agent Kernel

Read \`.ai/manifest.yaml\`, \`.ai/core/*\`, \`.ai/memory/STATE.md\`, and \`.ai/INDEX.md\` before consequential work.

## Golden rules
- Understand before changing.
- Inspect before inventing.
- Search before creating.
- Reuse -> extend -> modify -> create.
- Preserve user intent.
- Never silently expand scope.
- Treat memory as hypothesis until consequential facts are verified.
- Evidence before completion claims.
- Keep changes minimal and complete.
- Persist durable knowledge and leave a useful handoff.
- Framework lifecycle records (\`.ai/memory/STATE.md\`, \`.ai/evidence/\`, \`.ai/tasks/\`) are always authorized for tracking status, blockers, and handoffs without violating task \`permitted_files\`.
- Out-of-scope defects or environment anomalies must be recorded in \`.ai/memory/STATE.md\` (or via \`python tools/uaf.py blocker\`), not left solely in chat.

Follow the active UAP lifecycle and the project manifest. Project-specific canonical sources override generic defaults within their domain.
`,
  },
  {
    path: "templates/task-contract.yaml",
    content: `id: TASK-0000
type: FEATURE
status: PLANNED
scope:
  level: FEATURE
  domains: []
  risk: LOW
intent:
  statement: ""
  confidence: UNKNOWN
  source: user
requirements: []
constraints: []
non_goals: []
acceptance_criteria: []
verification: []
expected_changes: []
change_budget: {}
context: []
decisions: []
memory_candidates: []
related: []
integrity:
  intent_hash: ""
  requirements_hash: ""
  constraints_hash: ""
  non_goals_hash: ""
`,
  },
  {
    path: "templates/evidence-receipt.yaml",
    content: `id: EVD-0000
type: evidence
subject:
  type: TASK
  id: TASK-0000
method: []
sources: []
result: ""
verified_at: null
verified_by: ""
`,
  },
  {
    path: "uaaf/LICENSE",
    content: `MIT License

Copyright (c) 2026 lunarcwhite

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
];

export function getUaafFiles(): AgentKitFile[] {
  return UAAF_FILES.map((file) => ({ ...file }));
}
