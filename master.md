# Master Build Prompt — Braid (Autonomous SDLC Agent)

*Use this prompt as-is with an agentic coding tool (Claude Code, OpenCode, Cursor Agent, etc.) to scaffold and build the hackathon project. It is self-contained: overview, scope, and exact folder/file structure are all specified so the agent doesn't need to guess.*

---

## PROMPT START

You are building **Braid**, an autonomous multi-model SDLC agent. Read the full spec below before writing any code. Build exactly what is described — do not add scope, do not skip components. Ask for clarification only if something below is genuinely contradictory; otherwise make the smallest reasonable assumption and proceed.

### 1. Project Overview (exact)

> Braid is an orchestration system that takes a single Product Requirements Document (PRD) as input and autonomously carries it through a governed software development lifecycle — Plan, Review, Execute, Debug, Report — with human approval gates at two points, and an automatic agile-style loop back to Planning when the human is unsatisfied. Its core innovation is the **Execute stage's chunked, two-pass generation engine**, which produces large, multi-file codebases from a plan without silently dropping files or corrupting existing logic — the two failure modes that make naive agentic code generation unreliable at scale. Braid treats code generation as an engineering-managed pipeline with a deterministic orchestrator at its center, not as a single unsupervised LLM call.

### 2. Non-negotiable Requirements

- The **orchestrator is deterministic code, not an LLM call** — it owns state, the file manifest, and loop control.
- Every file in the plan's manifest must end up either **written and verified**, or **explicitly flagged as failed** in the report. Nothing may be silently dropped.
- Revisions to existing correct files must use **targeted patches** (function/block-level), never a full-file regeneration, unless the file did not previously exist.
- Two human approval gates are mandatory: **after Review** (before code is written) and **after Report** (before a feature is marked done).
- Testing is performed by a **real test runner**, not by asking an LLM whether code "looks correct."

### 3. Exact Project Structure

Create this exact folder/file layout at the project root:

```
braid/
├── README.md
├── package.json                      # or pyproject.toml if Python — pick ONE stack and be consistent
├── .env.example
│
├── orchestrator/                     # Deterministic control layer — NO LLM calls live here
│   ├── state_machine.ts              # Drives Plan → Review → Execute → Debug → Report → loop
│   ├── manifest_store.ts             # Tracks planned files, statuses, dependencies (JSON-backed)
│   ├── manifest_diff.ts              # Compares planned vs. written files, requeues missing ones
│   ├── digest_store.ts               # Maintains condensed interface index of the generated codebase
│   └── loop_controller.ts            # Caps self-loop iterations, manages human gate checkpoints
│
├── agents/                           # LLM-backed modules, each with a single responsibility
│   ├── planner/
│   │   ├── planner.ts                # Calls deep-reasoning model; outputs task graph + manifest + test stubs
│   │   └── prompts/
│   │       └── plan_prompt.md
│   ├── reviewer/
│   │   ├── reviewer.ts               # Calls an architecturally different model to critique the plan
│   │   └── prompts/
│   │       └── review_prompt.md
│   ├── executor/
│   │   ├── executor.ts               # Drives the two-pass generation (see section 4)
│   │   ├── skeleton_pass.ts          # Pass 1: signatures/types/exports for every planned file
│   │   ├── implementation_pass.ts    # Pass 2: fills in logic, one file at a time, digest-fed
│   │   ├── ast_patcher.ts            # Applies block/function-level patches instead of full rewrites
│   │   └── prompts/
│   │       ├── skeleton_prompt.md
│   │       └── implementation_prompt.md
│   ├── debugger/
│   │   ├── test_runner.ts            # Deterministic: runs smoke, regression, and stub tests
│   │   └── failure_triage.ts         # LLM interprets failures, proposes patches (routed via ast_patcher)
│   └── reporter/
│       ├── reporter.ts               # Generates the per-cycle report
│       └── prompts/
│           └── report_prompt.md
│
├── human_gate/                       # Approval checkpoints
│   ├── gate_review.ts                # Gate 1: approve/revise the plan
│   └── gate_report.ts                # Gate 2: approve/loop after report
│
├── generated_projects/               # Output directory — one subfolder per project Braid builds
│   └── .gitkeep
│
├── shared/
│   ├── types.ts                      # File manifest schema, task graph schema, report schema
│   ├── llm_client.ts                 # Thin wrapper for calling different models per agent
│   └── config.ts
│
├── tests/
│   ├── orchestrator.test.ts
│   ├── manifest_diff.test.ts
│   └── ast_patcher.test.ts
│
└── ui/                                # Minimal interface for PRD input + human gates + report view
    ├── index.html
    ├── app.tsx
    └── components/
        ├── PRDInput.tsx
        ├── GateApproval.tsx
        └── ReportView.tsx
```

### 4. Execute Stage — Exact Behavior (Braid's core feature)

Implement `executor.ts` to run in this exact order:

1. **Skeleton pass** (`skeleton_pass.ts`): one LLM call generates signatures, types/interfaces, and exports for *every* file in the manifest. Output must be parsed and each file's skeleton written to `generated_projects/<project>/`.
2. **Manifest diff** (`manifest_diff.ts`): compare manifest file list against files actually written. Any missing file is requeued into the skeleton pass automatically, without LLM involvement in detecting the gap.
3. **Digest build** (`digest_store.ts`): after skeletons exist, build a condensed index (signatures + one-line docstrings per file) — this is what gets fed into later calls instead of full source.
4. **Implementation pass** (`implementation_pass.ts`): for each file, call the executor model with: (a) the file's own skeleton, (b) the full digest of the codebase, (c) full source of only its direct dependencies (resolved from the manifest's dependency graph). Write the completed file.
5. **Manifest diff again**: confirm every file now has real implementation, not just skeleton. Requeue any gaps.
6. **Self-loop ("Relf") repair**: run `test_runner.ts` against stub tests from the Planner. For failures, route through `failure_triage.ts` → `ast_patcher.ts` for a targeted patch (never a full-file rewrite of an existing file). Repeat steps 4–6 up to `MAX_SELF_LOOP_ITERATIONS` (config value, default 3) before surfacing to the human gate.

### 5. Report — Exact Required Fields

`reporter.ts` must emit a report containing, at minimum:

- `manifestCompleteness`: percentage of planned files written and passing
- `testResults`: pass/fail counts for smoke, regression, and stub tests
- `diffSummary`: human-readable summary of what changed this cycle
- `flaggedRisks`: anything the Reviewer or Debugger flagged that wasn't auto-resolved
- `prdCoverage`: mapping of PRD requirements to implementation status

### 6. Build Order (do these in sequence)

1. `shared/types.ts` — define all schemas first (manifest, task graph, report) so every other module has a stable contract
2. `orchestrator/` — state machine and manifest store/diff, with no LLM calls, fully unit-testable in isolation
3. `agents/planner/` — get PRD → manifest + task graph + stubs working end-to-end on a trivial PRD
4. `human_gate/gate_review.ts` — minimal approve/revise flow
5. `agents/executor/` — skeleton pass first, verify manifest diff logic against it, then implementation pass, then ast_patcher
6. `agents/debugger/` — test runner + triage
7. `agents/reporter/` — report generation
8. `human_gate/gate_report.ts` and `orchestrator/loop_controller.ts` — wire the full loop
9. `ui/` — thin interface last, once the pipeline works headless/CLI-first

### 7. Explicit Constraints for the Hackathon Timebox

- Pick **one** target stack for generated projects (recommend Node/TypeScript for fastest demo) and hardcode it — do not build multi-language support.
- Skip cloud deployment, CI/CD, and multi-user auth entirely.
- The UI can be minimal (functional over polished) — the orchestration logic is the deliverable, not the frontend.
- Prioritize getting the full loop running end-to-end on a small demo PRD before optimizing any individual stage.

## PROMPT END