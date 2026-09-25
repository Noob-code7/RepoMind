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
npm run demo           # state-machine walk (no LLM calls)
```

## CLI (headless pipeline)

```bash
npx tsx cli.ts plan --project demo --prd ./prd.txt [--mock] [--feedback "..."]
npx tsx cli.ts run  --project demo --prd ./prd.txt [--mock] [--auto-approve] [--smoke-only]
```

- `plan` runs Plan → Review → Gate 1, saving `plan.json` + `manifest.json`.
- `run` runs the full loop through Report → Gate 2, saving `report.json`.
- `--mock` runs fully offline with deterministic demo models (no API keys).
- `--auto-approve` passes both human gates without prompting.
- `--smoke-only` skips spawning vitest (real fs smoke check only); default
  uses the real runner. Exit codes: 0 ok · 1 error · 2 Gate 1 reject · 3 Gate 2 loop.

## Interactive `braid` command

```bash
npm link          # exposes the global `braid` command (run once)
braid             # full-screen interactive TUI — the primary experience
braid plan --project demo --prd ./prd.txt --mock   # argv CLI still works
```

Bare `braid` opens a Codex-style workspace: welcome screen, scrollable
conversation area, pipeline bar (`Plan → Review → Approval → Execute →
Debug → Report` with pending/running/completed/failed/awaiting-approval),
persistent multiline input, searchable `/` command menu, and a status bar
(model · mode · project · pipeline). It renders on the terminal's alternate
screen, so repaints never pollute your scrollback; on exit you land back on
the main screen with a one-line session recap. Pass `--no-alt-screen` to
render inline instead (screen-reader / tmux-friendly escape hatch).

- **Tab / Shift+Tab** cycles modes `chat → plan → review → build → debug →
  report` — history, project context and execution state are preserved.
  `Ctrl+T` opens the mode-selection menu. Empty Enter runs the current mode.
- **Slash commands:** `/help` `/plan` `/review` `/build` `/test` `/debug`
  `/report` `/model` `/status` `/files` `/clear` `/exit` — plus compat
  aliases `/execute` `/run` `/quit` `/mode` `/prd <file>` `/project <name>`
  `/mock` `/smoke`. Typing `/` filters the menu; ↑↓ navigate, Enter selects,
  Esc dismisses.
- **Input:** `Enter` sends, `Ctrl+J` inserts a newline (multiline), `↑/↓`
  navigates history, `PgUp/PgDn` scrolls. Paste a PRD or its file path
  directly in **chat** mode.
- **Approval gates stay explicit:** Gate 1 (plan) and Gate 2 (report) offer
  keyboard-accessible approve / revise / cancel. Revisions require feedback,
  folded into the next planning pass. Nothing destructive runs on mode switch.
- **Sessions persist** to `~/.braid_session.json` — restart `braid` to resume
  the project, mode, PRD buffer and flags. `Ctrl+C` cancels a running op
  (press again to exit); the terminal is always restored on exit.
- Long operations show a spinner + live file progress without freezing input;
  starting a second stage while busy is refused instead of overlapping.
- Presentation lives in `tui/` and only calls existing pipeline modules —
  `cli.ts plan|run` behavior is unchanged for scripting/CI.

## Layout

- `shared/` — schemas (`types.ts`), LLM router (`llm_client.ts`), env config
- `orchestrator/` — state machine, manifest store/diff, digest, loop controller
- `agents/{planner,reviewer,executor,debugger,reporter}/` — single-responsibility LLM modules
- `human_gate/` — two approval checkpoints
- `generated_projects/` — one subfolder per built project
- `tests/` — orchestrator, manifest_diff, ast_patcher, implementation_pass, tui
- `tui/` — interactive terminal app (modes, slash menu, markdown, session, pipeline bar)
- `ui/` — minimal PRD input + gates + report view
