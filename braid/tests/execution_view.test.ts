import { describe, expect, it } from 'vitest';
import {
  checklistProgress,
  defaultExecuteTasks,
  formatActivityPlain,
  formatDiffStatsPlain,
  renderActivityFeed,
  renderChecklist,
  renderDisabledInput,
  renderExecutionPipeline,
  renderTabBar,
  renderThinkingBadge,
  renderTotalBar,
  summarizeTotals,
  type ActivityEvent,
} from '../tui/execution_view.js';
import { initialPipeline } from '../tui/pipeline_status.js';
import { C, stripAnsi } from '../tui/theme.js';
import { countDiff } from '../agents/executor/implementation_pass.js';

const events: ActivityEvent[] = [
  { kind: 'read', path: 'auth/session.ts', loc: 128, ts: '00:13:41' },
  { kind: 'create', path: 'auth/middleware.ts', added: 86, removed: 0, ts: '00:14:07' },
  { kind: 'edit', path: 'routes/user.ts', detail: 'validation', added: 31, removed: 4, ts: '00:14:31' },
];

describe('execution_view: activity feed', () => {
  it('prefixes read/create/edit with distinct icons + functional color', () => {
    const rows = renderActivityFeed(events, 100);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('◎');
    expect(rows[0]).toContain(C.blueGray);
    expect(rows[1]).toContain('⊞');
    expect(rows[1]).toContain(C.green);
    expect(rows[2]).toContain('✎');
    expect(rows[2]).toContain(C.amber);
  });

  it('right-aligns diff stats git-style (+green −red, reads show loc)', () => {
    expect(formatDiffStatsPlain(events[1]!)).toBe('+86 -0');
    expect(formatDiffStatsPlain(events[2]!)).toBe('+31 -4');
    expect(formatDiffStatsPlain(events[0]!)).toBe('128 loc');
    const plain = events.map(formatActivityPlain).join('\n');
    expect(plain).toContain('Reading auth/session.ts');
    expect(plain).toContain('Creating auth/middleware.ts');
  });

  it('fits narrow terminals without exceeding width', () => {
    for (const row of renderActivityFeed(events, 40)) {
      expect(stripAnsi(row).length).toBeLessThanOrEqual(40);
    }
  });
});

describe('execution_view: totals + checklist + chrome', () => {
  it('summarizes cumulative files/added/removed', () => {
    expect(summarizeTotals(events)).toEqual({ files: 3, added: 117, removed: 4 });
  });

  it('renders the thin total bar with green/red convention', () => {
    const bar = stripAnsi(renderTotalBar(events, 80));
    expect(bar).toContain('3 files changed');
    expect(bar).toContain('+117');
    expect(bar).toContain('−4');
  });

  it('renders terminal checklist states (done/active/todo)', () => {
    const tasks = defaultExecuteTasks(32, 13);
    expect(tasks).toHaveLength(6);
    expect(checklistProgress(tasks)).toEqual({ done: 2, total: 6 });
    const rows = renderChecklist(tasks, 80);
    expect(stripAnsi(rows[0]!)).toContain('Generate file manifest');
    expect(rows[0]).toContain('✓');
    expect(rows[2]).toContain('◐');
    expect(rows[3]).toContain('○');
  });

  it('shows thinking badge only while reasoning', () => {
    expect(renderThinkingBadge(false)).toBeNull();
    expect(stripAnsi(renderThinkingBadge(true)!)).toContain('Thinking');
  });

  it('renders the minimal tab bar with Terminal active', () => {
    const bar = stripAnsi(renderTabBar(100));
    for (const t of ['Problems', 'Output', 'Debug Console', 'Terminal']) {
      expect(bar).toContain(t);
    }
  });

  it('restyles the pipeline reference-chat: gray labels, green dots, no purple', () => {
    const p = initialPipeline();
    p.plan = 'completed';
    p.review = 'completed';
    p.approval = 'completed';
    p.execute = 'running';
    const line = renderExecutionPipeline(p, 120);
    expect(line).toContain('●');
    expect(line).toContain(C.pipelineDone);
    expect(line).not.toContain('\x1b[38;5;140m');
  });

  it('renders the muted disabled input + pipeline note', () => {
    const [bar, note] = renderDisabledInput(80);
    expect(stripAnsi(bar!)).toContain('Type a message or / for commands...');
    expect(stripAnsi(note!)).toContain('Pipeline running — input available after Execute.');
  });
});

describe('executor countDiff', () => {
  it('counts added/removed lines set-wise', () => {
    const oldSrc = 'a\nb\nc\n';
    const newSrc = 'a\nb2\nc\nd\n';
    expect(countDiff(oldSrc, newSrc)).toEqual({ added: 2, removed: 1 });
    expect(countDiff('x\n', 'x\n')).toEqual({ added: 0, removed: 0 });
  });
});
