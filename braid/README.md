# Braid — Autonomous Multi-Model SDLC Agent

> Takes a single PRD through Plan → Review → human gate → Execute (chunked
> two-pass generation) → Debug (real test runner) → Report → human gate →
> Done, looping back to Plan when the human is unsatisfied.

Braid treats code generation as an engineering-managed pipeline with a
**deterministic orchestrator** at its center, not as one unsupervised LLM
call. Its core innovation is the Execute stage's chunked engine: skeleton
pass → manifest diff → digest → per-file implementation → diff again →
capped self-loop repair via AST-aware patches. Large multi-file codebases
are produced without silently dropping files or corrupting existing logic.

Non-negotiables (enforced in code, not policy):

- `orchestrator/` is deterministic code, never an LLM call.
- Every manifest file ends written and verified, or explicitly flagged failed.
- Revisions to existing files use targeted patches, never full rewrites.
- Two human approval gates: after Review, after Report.
- Verification is done by a real test runner, never by asking an LLM.

Implementation status: the full loop described here is implemented and
wired end-to-end (`cli.ts`, `tui/app.ts`). Cloud deploy, CI/CD,
multi-user collaboration, multi-language generation targets, and sandboxing
are out of scope (PRD non-goals) and not implemented.

## Contents

- [1. Overview](#1-overview)
- [2. Technology stack](#2-technology-stack)
- [3. Architecture](#3-architecture)
- [4. Repository structure](#4-repository-structure)
- [5. SDLC pipeline](#5-sdlc-pipeline)
- [6. AI model and API integrations](#6-ai-model-and-api-integrations)
- [7. Local LLM and Ollama](#7-local-llm-and-ollama)
- [8. Conversational CLI and TUI](#8-conversational-cli-and-tui)
- [9. Installation and configuration](#9-installation-and-configuration)
- [10. Data structures and persistence](#10-data-structures-and-persistence)
- [11. Testing and verification](#11-testing-and-verification)
- [12. Security and safeguards](#12-security-and-safeguards)
- [13. Roadmap and limitations](#13-roadmap-and-limitations)

## 1. Overview

Conventional assistants (Claude Code, Cursor Agent, OpenCode, Devin) excel
at task-level edits but generate in one shot: no plan/review/execute/verify
separation, context collapses past dozens of files, and regeneration
silently drops files or rewrites working logic. Braid instead takes a PRD
as first-class input and runs it through a governed, auditable pipeline.

Each stage uses the model best suited to it (deep-reasoning planner,
independent reviewer, coding executor, lightweight triage/summarizer),
while all state, sequencing, manifest accounting, and loop control stay in
plain TypeScript the models cannot override. Models return data; only the
orchestrator acts on it. Validators reject malformed model output rather
than propagating it.

A typical run: paste a PRD into the `braid` TUI (or `cli.ts run`), approve
the reviewed plan at Gate 1, watch skeleton then per-file implementation
with live progress, get a test-backed report, and either accept it or loop
back with feedback folded into the next planning pass.

## 2. Technology stack

| Technology | Version | Purpose | Used in |
| --- | --- | --- | --- |
| Node.js + TypeScript (ESM, strict, ES2022/NodeNext) | Node >= 20, TS 5.9.3 | All implementation | `cli.ts`, `repl.ts`, `orchestrator/`, `agents/`, `tui/`, `shared/` |
| `tsx` | ^4.23.15 | Run `.ts` directly, no build step for CLI/TUI | `bin/braid.js`, `npm run braid`, `npm run demo` |
| Raw-TTY terminal TUI (alternate screen, SGR mouse) | — | Interactive conversational CLI | `tui/app.ts`, `tui/layout.ts`, `tui/theme.ts`, `tui/home.ts`, `tui/markdown.ts`, `tui/execution_view.ts` |
| Deterministic state machine + JSON stores | — | Pipeline control, manifest/digest/loop accounting | `orchestrator/` |
| `openai` SDK (OpenAI-compatible `chat.completions.create`) | ^4.104.0 | OpenAI, OpenRouter, DeepSeek, Gemini transports | `shared/llm_client.ts` |
| `@anthropic-ai/sdk` (`messages.create`) | 0.32.1 | `claude-*` models | `shared/llm_client.ts` |
| Ollama native HTTP (`fetch`, `curl.exe` fallback) | — | Local models, token streaming, discovery | `shared/ollama_client.ts` |
| ElevenLabs STT/TTS + Gemini audio fallback | — | Optional voice mode | `shared/voice_service.ts` |
| `pg` connection pool | ^8.23.0 | Optional Tiger Data/TimescaleDB telemetry | `telemetry/tiger_client.ts` |
| Vitest (forks pool) | 2.1.9 | Unit tests and generated-project stub execution | `vitest.config.ts`, `tests/`, `agents/debugger/test_runner.ts` |
| `dotenv` (`config({override:true})`) | ^16.6.1 | Env-file configuration | `shared/config.ts` |
| Regex-based export/digest extraction, brace-balance patching | — | No AST dependency; targeted file edits | `orchestrator/digest_store.ts`, `agents/executor/ast_patcher.ts` |
| Minimal React web companion | — | PRD input + gate + report view (thin, not the TUI) | `ui/app.tsx`, `ui/components/` |

## 3. Architecture

Terminal input flows through presentation (`tui/`) into the existing
pipeline modules; the TUI never duplicates orchestration logic. The
deterministic orchestrator calls single-responsibility LLM agents and
validates everything they return.

```mermaid
flowchart TD
    User --> TUI["TUI (tui/app.ts, repl.ts, bin/braid.js)"]
    TUI --> Dispatcher["Input dispatcher (tui/dispatcher.ts)"]
    Dispatcher --> Chat["Conversational assistant (Ollama chat, conversation_store.ts)"]
    Dispatcher --> Router["Model router (shared/llm_client.ts, shared/config.ts)"]
    Router --> Orchestrator["Orchestrator (orchestrator/state_machine.ts, loop_controller.ts)"]
    Orchestrator --> Planner["Planner agent"]
    Orchestrator --> Reviewer["Reviewer agent"]
    Orchestrator --> Executor["Executor (skeleton + implementation + ast_patcher)"]
    Orchestrator --> Debugger["Debugger (test_runner + failure_triage)"]
    Orchestrator --> Reporter["Reporter"]
    Executor --> ManifestStore["Manifest store + diff (manifest_store.ts, manifest_diff.ts)"]
    Executor --> DigestStore["Codebase digest (digest_store.ts)"]
    Debugger --> Harness["Test harness (vitest + fs checks)"]
    Orchestrator --> Gate1["Human Gate 1 (human_gate/gate_review.ts)"]
    Orchestrator --> Gate2["Human Gate 2 (human_gate/gate_report.ts)"]
    Orchestrator --> Session["Session + artifacts (session_store.ts, generated_projects/)"]
    Orchestrator --> Telemetry["Telemetry (telemetry/, TigerDB optional)"]
```

| Component | Responsibility |
| --- | --- |
| `bin/braid.js`, `repl.ts`, `cli.ts` | Entry routing: bare `braid` → TUI; `braid plan\|run` → headless pipeline; `telemetry --run` → read-only summary |
| `tui/` | Rendering, modes, slash menu, session resume, approval overlays; calls pipeline modules only |
| `shared/llm_client.ts`, `shared/config.ts`, `shared/ollama_client.ts` | Per-stage model resolution, provider routing, keys, streaming, JSON repair |
| `orchestrator/state_machine.ts` | Pure `PLAN→REVIEW→GATE_REVIEW→EXECUTE→DEBUG→REPORT→GATE_REPORT→DONE` transitions; rejections loop to `PLAN` |
| `agents/planner`, `agents/reviewer` | Task graph + manifest + stubs; independent critique with risk score |
| `agents/executor/` | Two-pass generation plus `ast_patcher.ts` (only mutation path for existing files) |
| `orchestrator/manifest_store.ts`, `manifest_diff.ts` | JSON-backed source of truth; planned-vs-written diff, completeness % |
| `orchestrator/digest_store.ts` | Condensed signature index fed to generation calls instead of full source |
| `agents/debugger/test_runner.ts`, `failure_triage.ts` | Real vitest/fs results; LLM only proposes capped, path-constrained patches |
| `agents/reporter/reporter.ts` | Cycle report; deterministic fallback always available |
| `human_gate/` | `decideGate*` validators, summaries, readline prompts |
| `telemetry/` | Batched run/stage/file/test events to TigerDB; no-op when unconfigured |

Deterministic (no LLM): state machine, manifest store/diff, digest,
loop counters, gate validators/prompts, test runner, AST patcher,
heuristic coverage, deterministic report builder. LLM-driven: planner,
reviewer, skeleton pass, implementation pass, failure triage, report
summarization — each wrapped in validators with strict rejection.

## 4. Repository structure

```
braid/
├── bin/braid.js                 # `braid` launcher: plan|run → cli.ts, else repl.ts
├── cli.ts                       # Headless pipeline: plan | run | telemetry
├── repl.ts                      # TUI-first launcher, flags, TTY/non-TTY handling
├── package.json / package-lock.json / tsconfig.json / vitest.config.ts
├── .env.example                 # All supported variables with placeholder values
├── orchestrator/                # state_machine, manifest_store, manifest_diff,
│                                # digest_store, loop_controller (deterministic)
├── agents/planner/              # planner.ts + prompts/plan_prompt.md
├── agents/reviewer/             # reviewer.ts + prompts/review_prompt.md
├── agents/executor/             # executor, skeleton_pass, implementation_pass,
│                                # ast_patcher + prompts/
├── agents/debugger/             # test_runner.ts (real vitest), failure_triage.ts
├── agents/reporter/             # reporter.ts + prompts/report_prompt.md
├── human_gate/                  # gate_review.ts (Gate 1), gate_report.ts (Gate 2)
├── shared/                      # types, config, llm_client, ollama_client, voice_service
├── tui/                         # app, dispatcher, slash_commands, modes, models,
│                                # session_store, session_compat, conversation_store,
│                                # layout, theme, pipeline_status, execution_view,
│                                # markdown, home, telemetry_session
├── telemetry/                   # index, types, telemetry_hooks, event_pipeline,
│                                # tiger_client, analytics_service, summary_view, schema.sql
├── ui/                          # index.html, app.tsx, components/{PRDInput,
│                                # GateApproval, ReportView}.tsx (web companion)
├── tests/                       # 14 vitest suites (see §11)
└── generated_projects/          # One subfolder per built project (plan/manifest/
                                 # report JSON, gate feedback, sources, stubs)
```

`shared/types.ts` defines the cross-module contracts first so every other
module shares manifest, task-graph, review, gate, digest, test-result,
report, and patch schemas. `tui/` is presentation-only; `ui/` is an
optional web companion, not required for the CLI/TUI loop.

## 5. SDLC pipeline

`PRD → Plan → Review → Approval (Gate 1) → Execute → Debug → Report → Approval (Gate 2) → Done`, with agile loops back to Plan.

| Stage | Input → Output | Agent / model | Notes |
| --- | --- | --- | --- |
| Plan | PRD text (+ prior gate feedback) → task graph + file manifest + test stubs | `agents/planner/planner.ts`, stage `plan`, 6000 tok / 0.2 | `parseAndValidatePlan` enforces unique paths, task⊆manifest, valid deps |
| Review | PRD + plan → critiques + risks + riskScore 0–1 | `agents/reviewer/reviewer.ts`, stage `review`, 3000 tok / 0.3 | Architecturally separate model; score clamped, never prose-only |
| Gate 1 | Plan summary → approved / revise-with-feedback | `human_gate/gate_review.ts` human | Reject requires feedback; exit code 2; feedback folds into re-plan |
| Execute | Manifest snapshot → files on disk, digest, two diffs | `agents/executor/`, stage `execute` (skeleton 8000/0.1, impl 6000/0.2) | Skeleton all-files JSON → diff → digest build → per-file impl (own skeleton + digest + direct-dep sources) → diff; incomplete throws, nothing silently dropped |
| Debug | Manifest + stubs + project root → smoke/regression/stub tallies | `agents/debugger/test_runner.ts` + `failure_triage.ts` (4000/0.2) + `loop_controller.ts` | Smoke = fs existence; stubs = real per-file `vitest run`; repair = triage → `ast_patcher` → retest, capped by `MAX_SELF_LOOP_ITERATIONS` (default 3) |
| Report | Manifest + results + changed files + risks + requirements → cycle report | `agents/reporter/reporter.ts`, stage `report`, 3000/0.2 | Completeness/results pinned deterministically; LLM supplies summary/risks/coverage with template fallback |
| Gate 2 | Report summary → satisfied / loop-with-feedback | `human_gate/gate_report.ts` human | Reject writes `gate2-feedback.txt`, loops to Plan; exit code 3; agile cycles capped at 5 |

```mermaid
sequenceDiagram
    participant U as Human
    participant O as Orchestrator
    participant P as Planner
    participant R as Reviewer
    participant E as Executor
    participant D as Debugger
    participant RP as Reporter
    U->>O: PRD (+ optional feedback)
    O->>P: planProject()
    P-->>O: taskGraph + manifest + stubs
    O->>R: reviewPlan()
    R-->>O: critiques + risks + score
    O->>U: Gate 1 summary (approve / revise)
    alt rejected
        U-->>O: feedback → back to Planner
    else approved
        O->>E: skeleton → diff → digest → implementation → diff
        E-->>O: files + digest
        O->>D: runTests() (+ repair loop)
        D-->>O: smoke/regression/stub results
        O->>RP: generateReport()
        RP-->>O: completeness + coverage + diff
        O->>U: Gate 2 summary (satisfied / loop)
    end
```

## 6. AI model and API integrations

All traffic funnels through `shared/llm_client.ts`. Provider is chosen per
call by model name and key shape; per-stage overrides via `/model` or
`setModelOverride()` still route through the same rules. Models never drive
the orchestrator — they return text/JSON that validators accept or reject.

- Supported providers: `claude-*` → Anthropic SDK `messages.create`;
  everything else → OpenAI-compatible `chat.completions.create` against
  OpenRouter (`https://openrouter.ai/api/v1`), DeepSeek direct
  (`https://api.deepseek.com`), Gemini OpenAI-compat
  (`https://generativelanguage.googleapis.com/v1beta/openai/`), or OpenAI
  default. Base URLs overridable via `OPENROUTER/GEMINI/DEEPSEEK/OPENAI_BASE_URL`.
- Stage defaults (`.env.example`, `shared/config.ts`): plan and review =
  `gemini-3.8-flash`; chat, execute, triage, report = `qwen2.5-coder:7b`
  (local Ollama). Any stage can point at any routable model id.
- Routing order in `resolveProvider`: Ollama-name check → `/`-slugs and
  `google/|nvidia/|deepseek/|moonshotai/|qwen/` to OpenRouter →
  `sk-or-v1-` keys to OpenRouter → `deepseek*` to DeepSeek → `gemini|gemma`
  (or `AQ.` keys) to Gemini → OpenAI default. `apiKeyFor(stage)` walks
  stage-specific then generic key names; missing keys throw with a `.env`
  hint instead of calling anything.
- Auth: per-stage `*_API_KEY` plus `GEMINI/OPENAI/OPENROUTER/DEEPSEEK_API_KEY`
  fallbacks, loaded by `dotenv`. Keys are never logged or written to
  artifacts. `--mock` (`setMockHandler`) runs the 2-file deterministic demo
  with no network.
- Requests: `{model, messages:[system, user], max_tokens, temperature}`
  (`temperature` omitted for `deepseek-reasoner`). Chat adds project/mode
  context (§10); executor adds digest + own skeleton + direct-dependency
  sources per file; triage sends failures + digest + failing sources.
- Responses: `complete()` prefers `message.content`, falls back to
  `reasoning` for Nemotron-style models. `completeJson()` strips fences,
  slices from the first `{`/`[`, parses, and retries once with a
  JSON-only nudge. Stage validators then enforce manifest/task/deps
  consistency, path allow-lists (≤5 triage patches), skeleton-path
  membership, and expected-export presence.
- Resilience: Gemini failure with `OPENROUTER_API_KEY` set retries once via
  `nvidia/nemotron-3-ultra-550b-a55b`. Reporter failures degrade to
  `buildDeterministicReport()`; review failures degrade to a 0.5-risk
  placeholder. No generic backoff; repair/agile budgets bound all loops.
- Streaming: `completeStream({onToken, signal})` streams token-by-token for
  Ollama (`/api/chat` NDJSON) and mocks (whitespace split); cloud models
  resolve `complete()` then emit once. Aborts propagate via `AbortSignal`.

## 7. Local LLM and Ollama

Local models handle chat, execute, triage, and report by default; only plan
and review default to cloud Gemini. Base URL comes from `OLLAMA_BASE_URL`
(or `LOCAL_LLM_BASE_URL`), default `http://localhost:11434`, trailing
slashes stripped (`shared/ollama_client.ts`, `shared/config.ts`).

- Discovery: `GET {base}/api/tags → {models:[{name}]}` via
  `checkOllamaHealth()` (1200 ms `fetch`, then `curl.exe` WSL bridge);
  `listOllamaModels()` feeds the `/model` and `Ctrl+P` selectors.
- Chat: `POST {base}/api/chat` with
  `{model, messages, stream:true, options:{temperature, num_predict}}`;
  `ollama/` and `local/` prefixes are stripped. Name heuristic in
  `isOllama()`: bare `qwen*|llama*|mistral*|codellama*|phi*` or any tag with
  `:` routes locally; vendor slugs containing `/` route to OpenRouter.
- Context: recent 12 messages plus a condensed summary of older turns, PRD
  (≤2000 chars), manifest summary, and test summary
  (`tui/conversation_store.ts`), persisted per project.
- Setup: install Ollama, `ollama serve`, `ollama pull qwen2.5-coder:7b`,
  set `OLLAMA_BASE_URL` + `CHAT/EXECUTE/TRIAGE/REPORT_MODEL` in `.env`.
  Troubleshooting: unreachable base → check `ollama serve` and firewall;
  WSL fetch failures fall back to `curl.exe`; empty model list means the
  daemon is up but no models are pulled.

## 8. Conversational CLI and TUI

Launch matrix (`bin/braid.js` spawns `tsx` with stdio inherited):

```bash
braid                                            # interactive TUI (primary)
braid plan --project demo --prd ./prd.txt        # headless, scripting/CI
braid run --project demo --prd ./prd.txt --auto-approve
npx tsx cli.ts plan|run|telemetry --run <run-id> # without npm link
braid --project demo --prd ./prd.txt --smoke-only --no-alt-screen --script ./s.txt
```

Bare `braid` opens a home screen (wordmark, pipeline row, 4 numbered
suggestions, persistent multiline input, model/mode/project/pipeline status
bar) on the alternate screen; `--no-alt-screen` renders inline. Non-TTY
stdin falls back to a cooked readline loop with gates auto-approved.

Modes (`tui/modes.ts`, cycled with `Tab`/`Shift+Tab`, menu on `Ctrl+T`;
empty `Enter` runs the mode; history and project context preserved):

| Mode | Drives | Empty-Enter behavior |
| --- | --- | --- |
| `chat` | Discussion / PRD intake | Send question or append PRD text |
| `plan` | `planProject` + `reviewPlan` | Generate/inspect plan |
| `review` | `reviewPlan` on saved `plan.json` | Re-review current plan |
| `build` | `executeProject` (stage `execute`) | Execute (requires saved plan + Gate 1) |
| `debug` | `runTests` + capped `runRepairLoop` | Test suite + targeted repairs |
| `report` | `generateReport` | Regenerate/display report |

Slash commands (`tui/slash_commands.ts`, `/` filters, ↑↓ + Enter, Esc
dismisses; primary 12 shown for bare `/`):

| Command | Action |
| --- | --- |
| `/help` `/status` `/config` `/files` `/clear` `/exit` | Help grid, pipeline+diagnostics, models/flags/paths, manifest, clear display, exit |
| `/plan` `/review` `/build` `/test` `/debug` `/report` `/run` | Stage actions; `/run` chains plan→report |
| `/model [slot] [name]` `/mode [name]` | View/set per-stage models, show/set mode |
| `/prd <file>` `/project <name>` | Load PRD buffer, switch `generated_projects/<name>` |
| `/mock` `/smoke` | Offline-demo toggle (retired message in TUI), vitest skip toggle |
| `/telemetry <run-id>` `/voice [on|off]` | Recorded-run summary, voice STT/TTS toggle |
| Aliases | `/execute`=`/build`, `/quit`=`/exit`, `/q` `/h` `/?` in input handler |

Keyboard: `Enter` send/select, `Ctrl+J` newline, `↑/↓` history-or-menu,
`←/→/Home/End` + `Ctrl+A/E/U/K` editing, `PgUp/PgDn` scroll ±10, `Ctrl+P`
model selector, `Ctrl+O` tool details, `Ctrl+V` voice record, `Ctrl+C`
cancel op (double-press exits), `1-4` home suggestions, `y/1` approve,
`n/r/2` revise (feedback required), `c/3/Esc` cancel at gates.

## 9. Installation and configuration

Prerequisites: Node >= 20, npm, Git; Ollama for local default models;
one cloud key for plan/review (live path below).

```bash
git clone <repo-url> && cd braid
cp .env.example .env   # then fill in live keys (placeholders below)
npm install
npm run build          # tsc --noEmit typecheck
npm test               # vitest run
npm link               # expose global `braid` (once)
```

| Variable | Required | Example | Purpose |
| --- | --- | --- | --- |
| `OLLAMA_BASE_URL` | Local models | `http://localhost:11434` | Ollama daemon (`LOCAL_LLM_BASE_URL` fallback) |
| `CHAT_MODEL` `EXECUTE_MODEL` `TRIAGE_MODEL` `REPORT_MODEL` | Yes (defaults local) | `qwen2.5-coder:7b` | Local stages |
| `PLAN_MODEL` `REVIEW_MODEL` | Yes (live path) | `gemini-3.8-flash` | Cloud planning/review |
| `GEMINI_API_KEY` / `PLAN_API_KEY` / `REVIEW_API_KEY` | Yes (live path) | `your-gemini-api-key` | Stage keys; `apiKeyFor` falls back to generic keys |
| `OPENROUTER_API_KEY` | Optional | `your-openrouter-key` | Alternate transport + Gemini fallback |
| `OPENAI_API_KEY` `DEEPSEEK_API_KEY` `ANTHROPIC_API_KEY` | Optional | `your-*-api-key` | Alternate providers / `claude-*` |
| `ELEVENLABS_API_KEY` `ELEVENLABS_VOICE_ID` `ELEVENLABS_MODEL_ID` | Voice only | `your-elevenlabs-key` | STT (`scribe_v1`) / TTS; Gemini audio fallback needs `GEMINI_API_KEY` |
| `MAX_SELF_LOOP_ITERATIONS` | No (default 3) | `3` | Repair-loop budget; agile cap is 5 in code |
| `GENERATED_ROOT` | No (default `./generated_projects`) | `./generated_projects` | Build output root |
| `TIGER_DATABASE_URL` (+ `TIGER_TELEMETRY_ENABLED`, `TIGER_BATCH_SIZE`, `TIGER_FLUSH_INTERVAL_MS`) | Telemetry only | `postgres://user:pass@host:5432/db` | Enables TigerDB event pipeline |

Live-key quick-start (primary path):

```bash
printf 'Build a tiny task API.\nGET /tasks lists tasks.\nPOST /tasks creates a task.\n' > prd.txt
braid plan --project demo --prd ./prd.txt
# review Gate 1 summary, approve with `y`
braid run --project demo --prd ./prd.txt
# Gate 1 → Execute → Debug → Report → Gate 2; outputs under generated_projects/demo/
braid run --project demo --prd ./prd.txt --auto-approve  # non-interactive CI variant
npx tsx cli.ts telemetry --run <run-id>                  # recorded summary (needs TigerDB)
```

Offline alternative: append `--mock` (deterministic 2-file demo, no keys)
and `--smoke-only` where vitest workers cannot spawn. Exit codes: 0 ok,
1 error, 2 Gate 1 reject, 3 Gate 2 loop-back.

## 10. Data structures and persistence

Core contracts live in `shared/types.ts`: `FileManifestEntry`
(`path`, `purpose`, `expectedExports`, `dependencies`, `status` of
`planned|skeleton|implemented|verified|failed`), `TaskNode`
(`id`, `title`, `dependsOn`, `files`), `TestStub` (`file`, `name`, `code`),
`ReviewOutput` (`critiques`, `risks`, `riskScore`), `GateDecision`
(`approved`, feedback required on reject), `DigestEntry`
(`path`, `signatures`, `docstring`), `TestResults`
(`smoke|regression|stubs` × `{passed, failed}`), `CycleReport`
(`manifestCompleteness`, `testResults`, `diffSummary`, `flaggedRisks`,
`prdCoverage`), `PatchProposal` (`path`, `anchor`, `replacement`, `reason`).

```json
{ "project": "demo",
  "files": [{ "path": "src/app.ts", "purpose": "core logic",
    "expectedExports": ["build"], "dependencies": [], "status": "implemented" }] }
```

```json
{ "manifestCompleteness": 100.0,
  "testResults": { "smoke": {"passed": 1, "failed": 0},
    "regression": {"passed": 0, "failed": 0}, "stubs": {"passed": 2, "failed": 0} },
  "diffSummary": "Changed 2 file(s): src/app.ts, src/index.ts. Completeness 100.0%.",
  "flaggedRisks": [], "prdCoverage": [] }
```

Stored per project under `generated_projects/<project>/`: `prd.txt`,
`plan.json`, `manifest.json` (rewritten on every status change),
`report.json`, `results.json` (TUI debug), `conversation.json`
(`[{id, role, content, timestamp, mode}]`), `gate1/2-feedback.txt`, plus
generated sources and written stubs. Digest is in-memory (`toJSON`
serializable). Session resume is `~/.braid_session.json`
(`$BRAID_SESSION_FILE` override: project, prdPath, prdBuffer ≤200k,
feedback ≤20k, flags, mode, chatModel, voiceEnabled); history is
`~/.braid_history` (last 200). Telemetry rows go to TigerDB only when
`TIGER_DATABASE_URL` is set; otherwise all emitters no-op.

## 11. Testing and verification

```bash
npm run build   # tsc --noEmit — passes clean
npm test        # vitest run (14 suites) — 135/136 pass; 1 known failure
npm run demo    # no-LLM state-machine walk: PLAN → … → DONE
```

`tests/` covers orchestrator transitions and gate validation,
manifest diff/completeness, AST patch anchors and no-op rejection,
implementation validation (protocol-echo, dropped-export, empty rejects),
TUI slash/mode/layout/redesign, execution view, conversation context,
telemetry hooks/CLI/analytics, and voice sanitization. `vitest.config.ts`
includes `tests/**/*.test.ts` with a 15 s timeout and forks pool.

Verification of generated code is always real: fs existence (smoke),
per-stub `npx vitest run <stub> --reporter=basic` with 60 s timeout
(stubs), prior-cycle tally (regression v1), manifest completeness
(`statusCompleteness`), and keyword-overlap PRD coverage with
`implemented|partial|missing` states. `--smoke-only` skips vitest where
workers cannot spawn. Known limitation (measured, not assumed):
`tests/tui_layout.test.ts` geometry expects 30 rendered rows but produces
29 in this environment; all other suites pass.

## 12. Security and safeguards

Two explicit human gates bound every consequential transition; rejections
require written feedback and loop to re-planning instead of proceeding.
Repair patches are constrained to `allowedPaths`, ≤5 per triage round, and
applied only through `applyPatch` (block/symbol anchor + brace-balance
splice; missing anchor or no-change throws). Self-loop (default 3) and
agile (5) budgets prevent infinite regeneration. Test execution is limited
to `execFile('npx', ['vitest','run', <project-relative stub>])` from the
braid root with timeout and buffer caps — arbitrary shell commands from
models are not executed. API keys load from `.env` via `dotenv` and are
never logged, printed, or persisted to artifacts. Telemetry uses
parameterized batch inserts over a pooled `pg` client and degrades to
silent no-op when unconfigured. Not implemented (do not rely on them):
filesystem sandboxing, container isolation, or multi-user auth — path
allow-lists and human gates are the current boundary.

## 13. Roadmap and limitations

Done: full headless + TUI loop, two-pass generation with manifest
enforcement, digest-fed implementation, AST patching, real test harness
with capped repair, deterministic reporting with LLM summarization,
session/conversation persistence, per-stage model routing across
OpenAI/OpenRouter/DeepSeek/Gemini/Anthropic/Ollama, mock offline mode,
TigerDB telemetry, ElevenLabs voice with Gemini fallback.

Known limits: cloud streaming is single-emit (only Ollama and mocks truly
stream); `deepseek-reasoner` skips temperature; regression bucket reuses
the prior stub tally rather than a full suite; digest extraction is
regex-based, not a full AST; one TUI layout geometry test fails (29 vs 30
rows); generated-project language support targets small-to-mid
Node/TypeScript apps. From the PRD, still out of scope: production code
review replacement, monorepo scale, custom foundation models, and
CI/CD/cloud provisioning.
