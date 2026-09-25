import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  MODES,
  cycleMode,
  isValidMode,
  modeToStage,
  MODE_DESCRIPTIONS,
} from '../tui/modes.js';
import {
  SLASH_COMMANDS,
  PRIMARY_COMMANDS,
  filterCommands,
  findCommand,
  helpText,
} from '../tui/slash_commands.js';
import { renderMarkdown, stripAnsi } from '../tui/markdown.js';
import {
  initialPipeline,
  formatPipelineBar,
  pipelineSummary,
  formatExecuteProgress,
} from '../tui/pipeline_status.js';
import {
  defaultSession,
  loadSession,
  saveSession,
} from '../tui/session_store.js';
import { toCompat } from '../tui/session_compat.js';
import { TuiApp } from '../tui/app.js';

describe('tui modes', () => {
  it('cycles through all six modes and wraps', () => {
    expect(MODES).toEqual(['chat', 'plan', 'review', 'build', 'debug', 'report']);
    expect(cycleMode('report')).toBe('chat');
    expect(cycleMode('chat', -1)).toBe('report');
    expect(cycleMode('plan')).toBe('review');
    // Full forward walk preserves every mode exactly once.
    let m = 'chat' as const;
    const seen = [m];
    for (let i = 0; i < 5; i++) {
      m = cycleMode(m) as typeof m;
      seen.push(m);
    }
    expect([...new Set(seen)]).toHaveLength(6);
  });

  it('validates modes and maps build/chat to stages', () => {
    expect(isValidMode('build')).toBe(true);
    expect(isValidMode('execute')).toBe(false); // legacy name retired
    expect(isValidMode('nope')).toBe(false);
    expect(modeToStage('build')).toBe('execute');
    expect(modeToStage('chat')).toBe('plan');
    expect(modeToStage('debug')).toBe('debug');
    for (const m of MODES) expect(MODE_DESCRIPTIONS[m].length).toBeGreaterThan(0);
  });
});

describe('tui slash commands', () => {
  it('registers all 12 required commands', () => {
    for (const name of [
      'help', 'plan', 'review', 'build', 'test',
      'debug', 'report', 'model', 'status', 'files',
      'clear', 'exit',
    ]) {
      expect(findCommand(name)?.name).toBe(name);
    }
    expect(PRIMARY_COMMANDS).toHaveLength(12);
  });

  it('filters the menu: empty → primary, prefix first, substring fallback', () => {
    expect(filterCommands('').map((c) => c.name)).toEqual(PRIMARY_COMMANDS);
    const pl = filterCommands('/pl').map((c) => c.name);
    expect(pl[0]).toBe('plan');
    expect(filterCommands('mode').some((c) => c.name === 'model')).toBe(true);
    // Case-insensitive.
    expect(findCommand('PLAN')?.name).toBe('plan');
    expect(filterCommands('zzz')).toEqual([]);
  });

  it('keeps backward-compatible aliases searchable', () => {
    expect(findCommand('execute')?.description).toMatch(/build/i);
    expect(findCommand('quit')).toBeDefined();
    expect(findCommand('run')).toBeDefined();
    expect(SLASH_COMMANDS.length).toBeGreaterThanOrEqual(19);
  });

  it('help text documents commands + keyboard shortcuts', () => {
    const h = helpText();
    for (const c of PRIMARY_COMMANDS) expect(h).toContain(`/${c}`);
    expect(h).toContain('Tab');
    expect(h).toContain('Ctrl+J');
    expect(h).toContain('Esc');
  });
});

describe('tui markdown', () => {
  it('renders headings, bold, code and lists readably', () => {
    const out = stripAnsi(renderMarkdown('# Title\n\nHello **world** with `code`.\n\n- a\n- b\n'));
    expect(out).toContain('Title');
    expect(out).toContain('Hello world with code.');
    expect(out).toContain('a');
  });

  it('keeps fenced code blocks unwrapped and delimited', () => {
    const src = 'before\n```\nconst x: string = "a very long line that must not be wrapped ".repeat(10);\n```\nafter';
    const out = renderMarkdown(src, 40);
    expect(out).toContain('const x');
    expect(out).toContain('code');
  });
});

describe('tui pipeline status', () => {
  it('starts idle and formats the seven-stage bar', () => {
    const p = initialPipeline();
    expect(pipelineSummary(p)).toBe('idle');
    const bar = formatPipelineBar(p);
    for (const label of ['PRD', 'Plan', 'Review', 'Approval', 'Execute', 'Debug', 'Report']) {
      expect(bar).toContain(label);
    }
  });

  it('summarizes running / approval / failure / done', () => {
    const p = initialPipeline();
    p.plan = 'running';
    expect(pipelineSummary(p)).toBe('running');
    p.plan = 'completed';
    p.approval = 'awaiting-approval';
    expect(pipelineSummary(p)).toBe('awaiting approval');
    p.approval = 'completed';
    p.debug = 'failed';
    expect(pipelineSummary(p)).toBe('failed');
    const done = initialPipeline();
    for (const k of Object.keys(done) as (keyof typeof done)[]) done[k] = 'completed';
    expect(pipelineSummary(done)).toBe('done');
  });

  it('formats execute progress with file counts', () => {
    expect(formatExecuteProgress({ activeFile: 'src/a.ts', completedFiles: 2, totalFiles: 8, stage: 'building' }))
      .toContain('2/8');
  });
});

describe('tui session store', () => {
  it('round-trips a session through disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'braid-sess-'));
    const file = join(dir, 'session.json');
    const s = { ...defaultSession(), project: 'demo-x', mode: 'build' as const, prdBuffer: 'hello' };
    saveSession(s, file);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.project).toBe('demo-x');
    expect(loadSession(file).project).toBe('demo-x');
    expect(loadSession(file).mode).toBe('build');
  });

  it('falls back to defaults on missing/corrupt files', () => {
    expect(loadSession(join(tmpdir(), 'braid-nope-404.json')).project).toBe('demo');
    const dir = mkdtempSync(join(tmpdir(), 'braid-sess-'));
    const file = join(dir, 'bad.json');
    saveSession(defaultSession(), file);
    // Corrupt it.
    writeFileSync(file, 'not json{{{');
    expect(loadSession(file).project).toBe('demo');
    // Unknown mode resets to chat, never throws.
    writeFileSync(file, JSON.stringify({ mode: 'execute', project: 'p' }));
    expect(loadSession(file).mode).toBe('chat');
  });

  it('maps legacy session modes for compat importers', () => {
    expect(toCompat({ ...defaultSession(), mode: 'build' }).mode).toBe('execute');
    expect(toCompat({ ...defaultSession(), mode: 'chat' }).mode).toBe('plan');
  });
});

describe('tui app shell', () => {
  it('accepts --no-alt-screen and keeps headless dispatch working', async () => {
    const app = new TuiApp({ project: 'alt-probe', noAltScreen: true });
    expect(app.snapshot.project).toBe('alt-probe');
    expect(await app.execHeadless('/status')).toBe(true);
    expect(app.snapshot.messages).toBeGreaterThan(0);
    expect(await app.execHeadless('/exit')).toBe(false);
  });

  it('headless mode switching preserves project context', async () => {
    const app = new TuiApp({ project: 'alt-probe-2' });
    expect(await app.execHeadless('/mode build')).toBe(true);
    expect(app.snapshot.mode).toBe('build');
    expect(app.snapshot.project).toBe('alt-probe-2');
  });
});
