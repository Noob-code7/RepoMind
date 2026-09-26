# Product Requirements Document

## Project Name (working title)

**Braid** — an autonomous, multi-model SDLC agent for large-scale code generation

*(Alt names: Weave, Loomcode, StrandOps — pick based on branding needs)*

---

## 1. Problem Statement

Existing agentic coding tools (Claude Code, Cursor Agent, OpenCode, Devin) are strong at *task-level* code generation — a function, a feature, a bug fix — but they are not built around a **complete, governed software development lifecycle**. They typically:

- Generate code in one shot without a distinct plan → review → execute → verify separation
- Struggle to scale generation across dozens or hundreds of files without losing context
- Silently drop files, break signatures, or "simplify away" correct logic when regenerating large codebases
- Offer no structured, repeatable way to loop back and iterate until a human is satisfied

There is no widely available tool that treats a PRD as a first-class input and runs it through an **auditable, multi-model SDLC pipeline** with built-in safeguards against context loss at scale.

---

## 2. Vision

Given a single PRD, the system autonomously plans, gets the plan reviewed, executes the plan into working multi-file code without dropping files or logic, tests its own output, reports results, and loops — with a human approval gate at the points that matter — until the product satisfies the original requirements.

---

## 3. Target Users

- Hackathon teams and solo builders who want to go from idea → working repo fast
- Engineering teams prototyping internal tools who want lifecycle discipline without lifecycle overhead
- Technical founders validating an MVP who need SDLC rigor but don't have a full team

---

## 4. Goals & Non-Goals

**Goals**

- Turn a PRD into a working, multi-file codebase with minimal human intervention beyond approval gates
- Guarantee no planned file is silently dropped during generation
- Preserve correctness of logic across incremental/chunked generation, even at 100+ files
- Provide a verifiable, test-backed "definition of done" for every generation cycle
- Support an agile-style loop: generate → test → report → (if unsatisfied) regenerate

**Non-Goals (v1 / hackathon scope)**

- Not a replacement for human code review before production deployment
- Not targeting arbitrary enterprise-scale monorepos (v1 targets small-to-mid apps, hundreds not thousands of files)
- Not building custom foundation models — orchestration layer only, on top of existing LLMs
- Not handling infra/deployment automation in v1 (CI/CD, cloud provisioning) — code generation and verification only

---

## 5. Core Pipeline (High-Level Flow)

```
PRD Input
   │
   ▼
[1] PLAN  ──(deep reasoning model)──► Task graph + File manifest + Test stubs
   │
   ▼
[2] REVIEW ──(independent thinking model)──► Critique + risk flags
   │
   ▼
[Human Approval Gate] ── revise? ──► back to PLAN
   │ approved
   ▼
[3] EXECUTE ──(agentic coding model + "Braid" chunked generation)──► Codebase
   │
   ▼
[4] DEBUG ──(deterministic test runner + LLM triage)──► Smoke tests, regression tests
   │
   ▼
[5] REPORT ──► Coverage vs PRD, test pass rate, manifest completeness, diff summary
   │
   ▼
[Human Satisfaction Gate] ── unsatisfied ──► loop back to PLAN (agile loop)
   │ satisfied
   ▼
 Done
```

---

## 6. Core Features

### 6.1 PRD Ingestion & Planning Engine

- Accepts a PRD (freeform text, doc upload, or structured template)
- Uses a deep-reasoning model to produce:
  - A **task graph** (ordered, dependency-aware breakdown of the build)
  - A **file manifest** — explicit list of every file to be created/modified, with purpose and expected exports
  - **Test stubs** per major function/module, defining what "correct" means before code is written

### 6.2 Independent Review Stage

- A second, architecturally distinct model reviews the plan for:
  - Missing components, unclear requirements, contradictions with the PRD
  - Feasibility and complexity risk
- Outputs a structured critique + risk score, not just prose
- Human approval gate: accept, request revisions, or send back to Planning with feedback

### 6.3 Execution Engine — "Braid" Chunked Generation

The centerpiece feature. Solves the core failure mode of large-scale agentic generation: **dropped files and compromised logic due to limited context per generation call.**

- **Two-pass generation**
  - *Skeleton pass*: generate signatures, types/interfaces, and exports for every file in the manifest in one pass (cheap, small, full-coverage)
  - *Implementation pass*: fill in each file's logic individually, with the full skeleton (not full source) plus full source of only its direct dependencies as context
- **Manifest enforcement (deterministic, non-LLM)**
  - After each generation pass, the orchestrator diffs "planned files" vs. "files written" and automatically requeues anything missing — no reliance on the model "remembering"
- **Codebase digest / interface RAG**
  - A continuously updated condensed index (signatures, types, one-line docstrings) is fed into every generation call instead of full raw source, keeping context small even at scale
- **Structured, AST-aware edits for revisions**
  - When existing correct code needs to change, the system patches specific functions/blocks rather than regenerating whole files, so untouched logic is never silently altered
- **Self-loop ("Relf") repair cycle**
  - Runs manifest-diff and stub-test checks automatically after execution, auto-repairs failures, retries up to a capped number of iterations before surfacing to the human

### 6.4 Debug & Verification Stage

- Deterministic test runner (not LLM-based) executes:
  - Smoke tests (does it run/build at all)
  - Regression tests (does prior functionality still pass)
  - Stub tests generated in the Planning stage (does new logic meet spec)
- LLM is used only to **interpret failures** and propose targeted fixes, routed back through the AST-aware patch mechanism — not full-file regeneration

### 6.5 Reporting Stage

- Auto-generated report per cycle including:
  - PRD coverage (% of manifest implemented and passing)
  - Test pass/fail summary
  - Diff summary of what changed since last cycle
  - Flagged risks or incomplete areas
- Human satisfaction gate: approve and move to next feature, or loop the whole cycle again (agile-style) with updated feedback folded into the next Planning pass

### 6.6 Human-in-the-Loop Control Points

- Two explicit gates: after Review (before any code is written) and after Report (before considering a feature "done")
- All approvals/rejections are logged, feeding back into the next Planning pass as context

---

## 7. Success Metrics (Hackathon Demo Criteria)

| Metric | Target |
| --- | --- |
| Manifest completeness (files planned vs. written) | 100% — zero silently dropped files |
| Test pass rate after self-loop repair | ≥ 90% on first human-facing report |
| Logic preservation on revision cycles | No unrelated function bodies changed (verified via AST diff) |
| End-to-end demo | PRD → working multi-file app in a single live run |

---

## 8. Suggested Model Assignment

| Stage | Model type | Notes |
| --- | --- | --- |
| Plan | Strongest available deep-reasoning model | Produces task graph, manifest, test stubs |
| Review | A second, different reasoning/thinking model | Different model reduces correlated blind spots |
| Execute | Strong agentic coding model | Drives skeleton → implementation passes |
| Debug | Deterministic test runner + lightweight LLM triage | Tests are code, not model output |
| Report | Any capable general model | Summarization only, low risk |

---

## 9. Architecture Components

1. **Orchestrator** — deterministic state machine driving the pipeline, manifest diffing, and loop control (not an LLM)
2. **Plan/Review/Execute/Debug/Report agents** — LLM-backed modules called by the orchestrator
3. **Codebase Digest Store** — condensed interface index, updated after every write
4. **Manifest Store** — structured JSON of planned files, statuses, and dependencies
5. **Test Harness** — runs generated + stub tests deterministically
6. **Human Gate UI** — simple approve/revise/loop interface between stages

---

## 10. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Context window limits at very large file counts | Digest-based context injection instead of full source dumping |
| Model drops files mid-execution | Deterministic manifest diff + auto-requeue, independent of the model |
| Full-file regeneration silently deletes working logic | AST-aware patching instead of whole-file rewrites |
| Infinite agile loop with no convergence | Cap self-loop iterations; require explicit human sign-off to exit |
| Review model rubber-stamping the plan | Use an architecturally different model from Planning to reduce correlated errors |

---

## 11. Out of Scope for Hackathon MVP

- Multi-user collaboration on a single project
- Cloud deployment / CI/CD automation
- Support for languages/frameworks beyond an initial target stack (e.g., pick one: Node/TypeScript or Python)
- Fine-grained cost/token optimization (functional demo first)

---

## 12. Demo Script (Suggested)

1. Feed in a PRD for a small but non-trivial app (e.g., a task manager with auth)
2. Show Plan output: task graph + file manifest + test stubs
3. Show Review critique and human approval gate
4. Trigger Execute — visually show skeleton pass completing, then implementation pass filling in files
5. Show a deliberately large file count to demonstrate zero dropped files (manifest diff = 100%)
6. Run Debug stage live, show test results
7. Show Report with PRD coverage %
8. Trigger one full agile loop (e.g., request a change) to show the system re-planning and patching without breaking existing logic