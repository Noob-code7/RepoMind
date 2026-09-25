/**
 * cli.ts
 * Braid CLI — Official CLI entrypoint featuring the unified end-to-end SDLC workflow
 * and the animated flowing DNA helix motion system.
 *
 * Commands:
 *   $ braid plan [PRD.md]
 *   $ braid review [PRD.md]
 *   $ braid approve
 *   $ braid build
 *   $ braid report
 *   $ braid brand
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ANSI_BOLD,
  ANSI_FAINT,
  ANSI_IVORY,
  ANSI_MUTED,
  ANSI_PEACH,
  ANSI_RESET,
  ANSI_RUST,
  ANSI_SAGE,
  renderCliBanner,
  startCliAnimation,
} from './brand/cli_mark.js';
import { renderContextMap } from './context/renderer.js';
import { PipelineOrchestrator } from './orchestrator/pipeline_orchestrator.js';
import { setMockHandler } from './shared/llm_client.js';
import type { FileManifest } from './shared/types.js';

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'help').toLowerCase();

  switch (command) {
    case 'context': {
      await runContextCommand(args.slice(1));
      break;
    }
    case 'plan': {
      const prdPath = args[1] || 'PRD.md';
      await runPlanCommand(prdPath);
      break;
    }
    case 'review': {
      const prdPath = args[1] || 'PRD.md';
      await runReviewCommand(prdPath);
      break;
    }
    case 'approve': {
      await runApproveCommand();
      break;
    }
    case 'build': {
      await runBuildCommand();
      break;
    }
    case 'report': {
      runReportCommand();
      break;
    }
    case 'brand':
    case 'motion': {
      runBrandMotionDemo();
      break;
    }
    case 'repl':
    case 'tui': {
      const { replMain } = await import('./repl.js');
      await replMain();
      break;
    }
    case 'help':
    default: {
      printHelp();
      break;
    }
  }
}

function printHelp() {
  console.log(`
  ${ANSI_BOLD}${ANSI_IVORY}Braid${ANSI_RESET} ${ANSI_MUTED}— Autonomous Multi-Model SDLC Orchestrator${ANSI_RESET}

  ${ANSI_PEACH}Commands:${ANSI_RESET}
    ${ANSI_IVORY}repl | tui${ANSI_RESET}          Launch interactive full-screen TUI REPL
    ${ANSI_IVORY}context [PRD.md]${ANSI_RESET} Build 3-layer semantic context map (supports --json, --focus, --impact)
    ${ANSI_IVORY}plan [PRD.md]${ANSI_RESET}    Map context and generate repository-aware task DAG & manifest
    ${ANSI_IVORY}review [PRD.md]${ANSI_RESET}  Independent architectural critique of the build plan
    ${ANSI_IVORY}approve${ANSI_RESET}          Sign off on plan & generate locked execution manifest
    ${ANSI_IVORY}build${ANSI_RESET}            Engage execution boundary with two-pass generation engine
    ${ANSI_IVORY}report${ANSI_RESET}           Synthesize comprehensive PRD coverage & verification report
    ${ANSI_IVORY}brand${ANSI_RESET}            Showcase the official flowing DNA helix motion system
`);
}

async function runContextCommand(rawArgs: string[]) {
  const isJson = rawArgs.includes('--json');
  let focus: string | undefined;
  let impactTarget: string | undefined;
  let prdPath: string | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--json') {
      continue;
    } else if (arg === '--focus' && i + 1 < rawArgs.length) {
      focus = rawArgs[++i];
    } else if (arg === '--impact' && i + 1 < rawArgs.length) {
      impactTarget = rawArgs[++i];
    } else if (!arg.startsWith('--') && !prdPath) {
      prdPath = arg;
    }
  }

  let projectRoot = process.cwd();
  if (prdPath) {
    const absPrd = path.resolve(process.cwd(), prdPath);
    const prdDir = path.dirname(absPrd);
    if (fs.existsSync(path.join(prdDir, 'package.json')) && prdDir !== process.cwd()) {
      projectRoot = prdDir;
      prdPath = path.basename(absPrd);
    }
  }

  const ticker = isJson ? null : startCliAnimation('planning', 'Scanning repository...');

  try {
    const contextMap = await PipelineOrchestrator.context({
      prdPath,
      projectRoot,
      focus,
      impactTarget,
      onProgress(msg, pct) {
        if (ticker) {
          ticker.update(msg, pct);
        }
      },
    });

    if (ticker) {
      await sleep(350);
      ticker.stop('Context map synthesized.');
    }

    if (isJson) {
      console.log(JSON.stringify(contextMap, null, 2));
    } else {
      console.log(`
        ~~~
       ~   ~
        \\ /
        / \\
       ~   ~

  ${ANSI_BOLD}${ANSI_IVORY}Braid Context Map${ANSI_RESET}
`);
      console.log(renderContextMap(contextMap));
    }
  } catch (err: any) {
    if (ticker) ticker.stop('Context mapping failed.');
    console.error(`\n  ${ANSI_RUST}Context Map Error:${ANSI_RESET} ${err.message}\n`);
    process.exit(1);
  }
}

async function runPlanCommand(prdPath: string) {
  let projectRoot = process.cwd();
  let resolvedPrdPath = prdPath;
  if (prdPath) {
    const absPrd = path.resolve(process.cwd(), prdPath);
    const prdDir = path.dirname(absPrd);
    if (fs.existsSync(path.join(prdDir, 'package.json')) && prdDir !== process.cwd()) {
      projectRoot = prdDir;
      resolvedPrdPath = path.basename(absPrd);
    }
  }

  const ticker = startCliAnimation('planning', 'Analyzing repository...');

  try {
    const res = await PipelineOrchestrator.plan({
      prdPath: resolvedPrdPath,
      projectRoot,
      onProgress(msg, pct) {
        ticker.update(msg, pct);
      },
    });

    await sleep(400);
    ticker.stop('Repository mapped and plan synthesized.');

    console.log(`
  ${ANSI_BOLD}${ANSI_IVORY}Braid${ANSI_RESET}

  ${ANSI_MUTED}Analyzing repository...${ANSI_RESET}
  ${ANSI_FAINT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${ANSI_RESET}

  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}Repository mapped (${res.filesMapped} files, ${res.symbolsMapped} symbols)${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.relevantFilesCount} relevant files identified${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.requirementsCount} requirements extracted${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.tasksCount} implementation tasks${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.filesToModify} files to modify${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.filesToCreate} files to create${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.testsCount} test specifications${ANSI_RESET}

  ${ANSI_PEACH}Plan ready.${ANSI_RESET}
`);
  } catch (err: any) {
    ticker.stop('Planning failed.');
    console.error(`\n  ${ANSI_RUST}Planning Error:${ANSI_RESET} ${err.message}\n`);
    process.exit(1);
  }
}

async function runReviewCommand(prdPath: string) {
  let projectRoot = process.cwd();
  let resolvedPrdPath = prdPath;
  if (prdPath) {
    const absPrd = path.resolve(process.cwd(), prdPath);
    const prdDir = path.dirname(absPrd);
    if (fs.existsSync(path.join(prdDir, 'package.json')) && prdDir !== process.cwd()) {
      projectRoot = prdDir;
      resolvedPrdPath = path.basename(absPrd);
    }
  }

  const ticker = startCliAnimation('review', 'Checking architecture...');

  try {
    const res = await PipelineOrchestrator.review({
      prdPath: resolvedPrdPath,
      projectRoot,
      onProgress(msg, pct) {
        ticker.update(msg, pct);
      },
    });

    await sleep(400);
    ticker.stop('Review complete.');

    console.log(`
  ${ANSI_BOLD}${ANSI_IVORY}Braid Review${ANSI_RESET}

  ${ANSI_MUTED}Checking architecture...${ANSI_RESET}
  ${ANSI_MUTED}Checking requirement coverage...${ANSI_RESET}
  ${ANSI_MUTED}Checking dependencies...${ANSI_RESET}
  ${ANSI_MUTED}Checking file manifest...${ANSI_RESET}
  ${ANSI_MUTED}Checking test coverage...${ANSI_RESET}
  ${ANSI_MUTED}Checking risks...${ANSI_RESET}
  ${ANSI_FAINT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${ANSI_RESET}

  ${ANSI_PEACH}Review complete.${ANSI_RESET}

  ${ANSI_IVORY}${res.warningsCount} warnings${ANSI_RESET}
  ${ANSI_IVORY}${res.criticalCount} critical issues${ANSI_RESET}
`);

    if (res.findings.length > 0) {
      res.findings.forEach((finding, i) => {
        const color = finding.severity === 'critical' || finding.severity === 'high' ? ANSI_RUST : ANSI_PEACH;
        console.log(`  ${color}[${i + 1}] ${finding.title}${ANSI_RESET}`);
        if (finding.recommendation) {
          console.log(`      ${ANSI_MUTED}→ ${finding.recommendation}${ANSI_RESET}`);
        }
      });
      console.log(`\n  ${ANSI_MUTED}Suggested revisions available.${ANSI_RESET}\n`);
    } else {
      console.log(`  ${ANSI_SAGE}✓ 0 issues detected. Plan approved for execution.${ANSI_RESET}\n`);
    }
  } catch (err: any) {
    ticker.stop('Review failed.');
    console.error(`\n  ${ANSI_RUST}Review Error:${ANSI_RESET} ${err.message}\n`);
    process.exit(1);
  }
}

async function runApproveCommand() {
  try {
    const res = await PipelineOrchestrator.approve({
      projectRoot: process.cwd(),
      operator: 'human_operator',
    });

    console.log(`
  ${ANSI_BOLD}${ANSI_IVORY}Braid Approval${ANSI_RESET}
  ${ANSI_FAINT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${ANSI_RESET}

  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}Plan approved and locked (${res.approval.planRunId})${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}Execution manifest generated (.braid/execution_manifest.json)${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.filesQueued} files queued for execution boundary${ANSI_RESET}

  ${ANSI_PEACH}STATUS: APPROVED FOR BUILD${ANSI_RESET}
`);
  } catch (err: any) {
    console.error(`\n  ${ANSI_RUST}Approval Error:${ANSI_RESET} ${err.message}\n`);
    process.exit(1);
  }
}

async function runBuildCommand() {
  const ticker = startCliAnimation('build', 'Engaging execution boundary...');

  try {
    const res = await PipelineOrchestrator.build({
      projectRoot: process.cwd(),
      onProgress(msg, pct) {
        ticker.update(msg, pct);
      },
    });

    await sleep(400);
    ticker.stop('Build boundary engaged.');

    console.log(`
  ${ANSI_BOLD}${ANSI_IVORY}Braid Build${ANSI_RESET}

  ${ANSI_MUTED}Approved plan${ANSI_RESET}
      ${ANSI_FAINT}↓${ANSI_RESET}
  ${ANSI_MUTED}Execution manifest${ANSI_RESET}
      ${ANSI_FAINT}↓${ANSI_RESET}
  ${ANSI_MUTED}Executor interface${ANSI_RESET}

  ${ANSI_MUTED}Executing approved build manifest...${ANSI_RESET}
  ${ANSI_FAINT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${ANSI_RESET}

  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.manifest.files.length} files received at executor boundary${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.result.filesToModify} files targeted for modification${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}${res.result.filesToCreate} files targeted for creation${ANSI_RESET}
  ${ANSI_SAGE}✓${ANSI_RESET} ${ANSI_IVORY}Two-pass execution boundary ready (0 dropped files)${ANSI_RESET}

  ${ANSI_PEACH}Build complete.${ANSI_RESET}
`);
  } catch (err: any) {
    ticker.stop('Build failed.');
    console.error(`\n  ${ANSI_RUST}Build Error:${ANSI_RESET} ${err.message}\n`);
    process.exit(1);
  }
}

function runReportCommand() {
  try {
    const rep = PipelineOrchestrator.report(process.cwd());

    console.log(`
  ${ANSI_BOLD}${ANSI_IVORY}BRAID REPORT${ANSI_RESET}
  ${ANSI_FAINT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${ANSI_RESET}

  ${ANSI_MUTED}PRD coverage${ANSI_RESET}       ${ANSI_IVORY}${rep.prdCoverage}%${ANSI_RESET}
  ${ANSI_MUTED}Requirements${ANSI_RESET}       ${ANSI_IVORY}${rep.requirementsSummary}${ANSI_RESET}
  ${ANSI_MUTED}Planned tasks${ANSI_RESET}      ${ANSI_IVORY}${rep.plannedTasks}${ANSI_RESET}
  ${ANSI_MUTED}Files affected${ANSI_RESET}     ${ANSI_IVORY}${rep.filesAffected}${ANSI_RESET}
  ${ANSI_MUTED}Tests specified${ANSI_RESET}    ${ANSI_IVORY}${rep.testsSpecified}${ANSI_RESET}
  ${ANSI_MUTED}Review issues${ANSI_RESET}      ${ANSI_IVORY}${rep.reviewIssues} unresolved${ANSI_RESET}

  ${ANSI_PEACH}STATUS: ${rep.status}${ANSI_RESET}
`);
  } catch (err: any) {
    console.error(`\n  ${ANSI_RUST}Report Error:${ANSI_RESET} ${err.message}\n`);
    process.exit(1);
  }
}

function runBrandMotionDemo() {
  console.clear();
  const states = ['idle', 'planning', 'review', 'build', 'verify', 'success'] as const;
  let stateIdx = 0;
  let frame = 0;

  console.log(`\n  ${ANSI_BOLD}${ANSI_IVORY}Braid DNA Helix Motion System${ANSI_RESET} ${ANSI_MUTED}(Press Ctrl+C to exit)${ANSI_RESET}\n`);

  setInterval(() => {
    const currentState = states[stateIdx];
    const banner = renderCliBanner(
      frame,
      currentState,
      `State: ${currentState.toUpperCase()} — Two reasoning threads continuously weaving together.`,
      (frame % 20) * 5,
    );

    if (process.stdout.isTTY) {
      process.stdout.write(`\x1b[12A\x1b[0J`);
    }
    process.stdout.write(banner + '\n');
    frame++;

    if (frame % 25 === 0) {
      stateIdx = (stateIdx + 1) % states.length;
    }
  }, 160);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function installMock(project: string): void {
  let mockManifest: FileManifest | null = null;
  setMockHandler((req) => {
    if (req.stage === 'plan') {
      return JSON.stringify({
        project,
        manifest: {
          files: [
            {
              path: 'src/index.ts',
              purpose: 'entry point',
              expectedExports: ['main'],
              dependencies: ['./app.js'],
              status: 'planned',
            },
            {
              path: 'src/app.ts',
              purpose: 'core logic',
              expectedExports: ['build'],
              dependencies: [],
              status: 'planned',
            },
          ],
        },
        testStubs: [
          {
            targetFile: 'src/index.ts',
            testFile: 'tests/index.test.ts',
            description: 'main() returns "ok"',
            assertion: 'expect(main()).toBe("ok")',
          },
        ],
      });
    }
    if (req.stage === 'review') {
      return JSON.stringify({
        critiques: ['Mock review: plan is well-scoped.'],
        risks: ['Mock mode enabled — no live LLM invoked.'],
        riskScore: 0.1,
      });
    }
    if (req.stage === 'execute') {
      if (req.systemPrompt.includes('skeleton pass')) {
        if (!mockManifest) throw new Error('[mock] skeleton pass ran before manifest was set');
        const files = mockManifest.files.map((f) => ({
          path: f.path,
          code: `/** ${f.purpose} */\n` + f.expectedExports
            .map((e) => `export function ${e}(): string { throw new Error("not implemented"); }`)
            .join('\n') + '\n',
        }));
        return JSON.stringify({ files });
      }
      const m = /TARGET FILE: (\S+)/.exec(req.userPrompt);
      const target = m?.[1] ?? '';
      if (target.endsWith('src/app.ts')) return 'export function build(): string { return "ok"; }\n';
      if (target.endsWith('src/index.ts')) {
        return 'import { build } from "./app.js";\nexport function main(): string { return build(); }\n';
      }
      return 'export const ok = true;\n';
    }
    if (req.stage === 'report') {
      return JSON.stringify({
        diffSummary: `Mock demo cycle for ${project}: 2 files implemented, smoke passing.`,
        flaggedRisks: [],
      });
    }
    if (req.stage === 'triage') return JSON.stringify({ patches: [] });
    throw new Error(`[mock] Unhandled stage: ${req.stage}`);
  });
  (globalThis as Record<string, unknown>).__braidMockManifest = (m: FileManifest) => {
    mockManifest = m;
  };
}

export function setMockManifest(m: FileManifest): void {
  const setter = (globalThis as Record<string, unknown>).__braidMockManifest as
    | ((m: FileManifest) => void)
    | undefined;
  setter?.(m);
}

// Only auto-run when invoked directly as the entry point
if (
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('cli.js'))
) {
  main().catch((err) => {
    console.error('\nBraid CLI Error:', err);
    process.exit(1);
  });
}

export { main };
