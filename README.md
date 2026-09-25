# Braid — Autonomous Multi-Model SDLC Agent

> Takes a single PRD → Plan → Review → (human gate) → Execute (chunked
> two-pass generation) → Debug (real test runner) → Report → (human gate)
> → Done, looping back to Plan when the human is unsatisfied.

Core innovation: the Execute stage's **chunked, two-pass generation engine**
(skeleton pass → manifest diff → digest → per-file implementation →
diff again → capped self-loop repair via AST-aware patches) produces large
multi-file codebases without silently dropping files or corrupting existing
logic.

## Non-negotiables

- `orchestrator/` is **deterministic code, never an LLM call**.
- Every manifest file ends **written + verified, or flagged failed**. Nothing dropped.
- Revisions to existing files use **targeted patches**, never full rewrites.
- Two human gates: after Review, after Report.
- Verification by **real test runner**, never LLM vibes.

## Quickstart

```bash
cp .env.example .env   # fill in stage API keys
npm install
npm run build          # tsc --noEmit
npm test               # vitest run
npm run demo           # headless pipeline (CLI-first; UI is thin)
```

## Layout

- `shared/` — schemas (`types.ts`), LLM router (`llm_client.ts`), env config
- `orchestrator/` — state machine, manifest store/diff, digest, loop controller
- `agents/{planner,reviewer,executor,debugger,reporter}/` — single-responsibility LLM modules
- `human_gate/` — two approval checkpoints
- `generated_projects/` — one subfolder per built project
- `tests/` — orchestrator, manifest_diff, ast_patcher
- `ui/` — minimal PRD input + gates + report view
