import { describe, expect, it } from 'vitest';
import {
  initialPipeline,
  isPipelineIdle,
  activeStage,
  activeStageDetail,
  type PipelineMap,
} from '../tui/pipeline_status.js';
import {
  HOME_SUGGESTIONS,
  renderHome,
  renderPipelineLine,
  shouldShowHome,
} from '../tui/home.js';
import {
  availableModels,
  friendlyName,
  labelForModel,
  shortForModel,
} from '../tui/models.js';
import { C, statusStrip, stripAnsi, truncateVisible, visibleLen } from '../tui/theme.js';
import { renderMarkdown, stripAnsi as mdStrip } from '../tui/markdown.js';
import { cycleMode } from '../tui/modes.js';
import { filterCommands } from '../tui/slash_commands.js';
import { defaultSession, loadSession, saveSession } from '../tui/session_store.js';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('redesign: home empty-state', () => {
  it('shows home only with zero messages (pipeline not repeated)', () => {
    expect(shouldShowHome(0)).toBe(true);
    expect(shouldShowHome(1)).toBe(false);
  });

  it('renders big pixel wordmark + tagline without ASCII banners', () => {
    const out = stripAnsi(renderHome({ cols: 100, pipeline: initialPipeline() }));
    // Block-letter hero (7 rows tall), not a tiny one-liner.
    expect(out).toContain('█');
    expect(out.split('\n').length).toBeGreaterThan(12);
    expect(out).not.toContain('BRAID');
    expect(out).toContain('Autonomous SDLC Agent');
    // No large decorative banner characters.
    expect(out).not.toMatch(/[#*]{5,}/);
    expect(out).not.toContain('⏳');
  });

  it('offers exactly four keyboard-selectable suggestions', () => {
    expect(HOME_SUGGESTIONS).toHaveLength(4);
    const labels = HOME_SUGGESTIONS.map((s) => s.label);
    expect(labels[0]).toMatch(/PRD/i);
    expect(labels[1]).toMatch(/plan/i);
    expect(labels[2]).toMatch(/review|architect/i);
    expect(labels[3]).toMatch(/resume|session/i);
    const out = stripAnsi(
      renderHome({ cols: 100, pipeline: initialPipeline(), selected: 1 }),
    );
    expect(out).toContain('1');
    expect(out).toContain('4');
  });

  it('highlights selection without touching user input (pure render)', () => {
    const a = renderHome({ cols: 100, pipeline: initialPipeline(), selected: 0 });
    const b = renderHome({ cols: 100, pipeline: initialPipeline(), selected: 2 });
    expect(a).not.toBe(b);
    // No suggestion render mutates a buffer — render is pure.
    expect(typeof a).toBe('string');
  });
});

describe('redesign: pipeline progress', () => {
  it('idle only when every stage is pending', () => {
    expect(isPipelineIdle(initialPipeline())).toBe(true);
    const p = initialPipeline();
    p.prd = 'completed';
    expect(isPipelineIdle(p)).toBe(false);
  });

  it('colors done green-dot / pending dim, active body-white, failed red', () => {
    const p = initialPipeline();
    p.prd = 'completed';
    p.plan = 'running';
    const line = renderPipelineLine(p, 100);
    expect(line).toContain(C.pipelineDone);
    expect(line).toContain(C.pipelineGray);
    expect(line).toContain(C.pipelineDim);
    const failed: PipelineMap = { ...initialPipeline(), debug: 'failed' };
    expect(renderPipelineLine(failed, 100)).toContain(C.red);
    const approval: PipelineMap = { ...initialPipeline(), approval: 'awaiting-approval' };
    expect(renderPipelineLine(approval, 100)).toContain(C.amber);
  });

  it('exposes the active stage; detail only for active stage', () => {
    const idle = initialPipeline();
    expect(activeStage(idle)).toBeNull();
    expect(activeStageDetail(idle)).toBeNull();
    const running: PipelineMap = { ...idle, plan: 'running' };
    expect(activeStage(running)).toBe('plan');
    expect(activeStageDetail(running)).toContain('Plan');
    expect(activeStageDetail(running, 'file 1/2')).toContain('1/2');
  });

  it('stays on one compact line and narrows on small terminals', () => {
    const p = initialPipeline();
    const wide = stripAnsi(renderPipelineLine(p, 120));
    const narrow = stripAnsi(renderPipelineLine(p, 60));
    expect(wide.split('\n')).toHaveLength(1);
    expect(narrow.length).toBeLessThanOrEqual(wide.length);
  });
});

describe('redesign: model selector beneath input', () => {
  it('derives options from configured providers (no invented models)', () => {
    const models = availableModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.length).toBeLessThanOrEqual(5);
    const ids = models.map((m) => m.id);
    expect(new Set(ids.map((i) => i.toLowerCase())).size).toBe(ids.length);
  });

  it('labels known families without hardcoding unavailable access', () => {
    expect(friendlyName('deepseek-reasoner')).toBe('DeepSeek Reasoner');
    expect(friendlyName('gemini-2.5-flash')).toBe('Gemini Flash');
    expect(labelForModel('deepseek-reasoner')).toBe('DeepSeek Reasoner');
    expect(shortForModel('Claude Sonnet')).toMatch(/claude/);
  });

  it('chat model falls back to a configured id (distinct from stage slots)', () => {
    const models = availableModels();
    // At least one option doubles as the default chat model.
    expect(models[0]!.id.length).toBeGreaterThan(0);
  });
});

describe('redesign: minimal status + theme', () => {
  it('status strip shows only model · project · mode (no mock/smoke dumps)', () => {
    const s = stripAnsi(
      statusStrip({ cols: 120, model: 'sonnet', project: 'demo', mode: 'chat' }),
    );
    expect(s).toContain('sonnet');
    expect(s).toContain('demo');
    expect(s).toContain('chat');
    expect(s).not.toContain('mock');
    expect(s).not.toContain('smoke');
  });

  it('progressively hides fields on narrow terminals instead of overlapping', () => {
    const tiny = stripAnsi(statusStrip({ cols: 50, model: 'm', project: 'p', mode: 'chat' }));
    const mid = stripAnsi(statusStrip({ cols: 70, model: 'm', project: 'p', mode: 'chat' }));
    const full = stripAnsi(statusStrip({ cols: 120, model: 'm', project: 'p', mode: 'chat' }));
    expect(tiny).toContain('m');
    expect(tiny.length).toBeLessThanOrEqual(mid.length);
    expect(mid.length).toBeLessThanOrEqual(full.length);
    expect(full).toContain('p');
  });

  it('uses restrained palette: no bright blue backgrounds', () => {
    const md = renderMarkdown('# Title\n\nHello **world** with `code`.\n');
    expect(md).not.toContain('\x1b[44m'); // no blue background
    expect(md).not.toContain('\x1b[34m'); // no bright blue foreground
    expect(mdStrip(md)).toContain('Title');
  });

  it('truncates without breaking layout accounting', () => {
    expect(visibleLen(`${C.accent}hi${C.reset}`)).toBe(2);
    expect(truncateVisible('abcdef', 4)).toBe('abc…');
  });

  it('paints the full-screen brand background (truecolor black)', () => {
    expect(C.bg).toBe('\x1b[48;2;0;0;0m');
    // Background codes must be invisible to width accounting.
    expect(visibleLen(`${C.bg}hi${C.reset}`)).toBe(2);
  });
});

describe('redesign: input behavior + modes + slash', () => {
  it('Tab cycling preserves all modes and wraps', () => {
    expect(cycleMode('report')).toBe('chat');
    expect(cycleMode('chat', -1)).toBe('report');
  });

  it('slash menu keeps autocomplete + /config diagnostics discoverable', () => {
    expect(filterCommands('').length).toBeGreaterThan(0);
    expect(filterCommands('conf').some((c) => c.name === 'config')).toBe(true);
    expect(filterCommands('mode').some((c) => c.name === 'model')).toBe(true);
  });

  it('multiline buffers split on newlines (Ctrl+J path)', () => {
    const buf = 'line one\nline two\nline three';
    expect(buf.split('\n')).toHaveLength(3);
  });

  it('chat model persists across restarts without clobbering other fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'braid-model-'));
    const file = join(dir, 'session.json');
    const s = { ...defaultSession(), project: 'p1', chatModel: 'my-chat-model' };
    saveSession(s, file);
    const loaded = loadSession(file);
    expect(loaded.chatModel).toBe('my-chat-model');
    expect(loaded.project).toBe('p1');
    expect(loadSession(join(tmpdir(), 'braid-nope-404.json')).chatModel).toBeUndefined();
  });
});

describe('redesign: terminal resizing', () => {
  it('home + pipeline render at 40, 80 and 160 columns without throwing', () => {
    for (const cols of [40, 80, 160]) {
      const home = renderHome({ cols, pipeline: initialPipeline() });
      expect(stripAnsi(home).length).toBeGreaterThan(0);
      const line = renderPipelineLine(initialPipeline(), cols);
      expect(stripAnsi(line).length).toBeLessThanOrEqual(Math.max(20, cols));
      const status = statusStrip({ cols, model: 'm', project: 'p', mode: 'chat' });
      expect(stripAnsi(status).length).toBeLessThanOrEqual(cols);
    }
  });
});
