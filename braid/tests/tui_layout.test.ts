import { describe, expect, it } from 'vitest';
import {
  charWidth,
  computeCursor,
  computeLayout,
  displayWidth,
  fitLine,
  padTo,
  wrapVisual,
} from '../tui/layout.js';
import { renderHome } from '../tui/home.js';
import { renderMarkdown } from '../tui/markdown.js';
import { initialPipeline } from '../tui/pipeline_status.js';
import { TuiApp } from '../tui/app.js';

describe('layout geometry', () => {
  it('uses a 3–4 col margin and never touches either edge', () => {
    for (const cols of [40, 60, 80, 100, 160, 240]) {
      const L = computeLayout(cols, 30);
      expect(L.margin).toBeGreaterThanOrEqual(3);
      expect(L.margin).toBeLessThanOrEqual(4);
      expect(L.margin).toBe(cols >= 100 ? 4 : 3);
      expect(L.boxLeft).toBe(L.margin); // input shares the content boundary
      expect(L.margin + L.contentWidth + L.rightMargin).toBeLessThanOrEqual(cols);
      expect(L.boxLeft + L.boxWidth + L.rightMargin).toBeLessThanOrEqual(cols);
      expect(L.innerWidth).toBe(L.boxWidth - 4);
    }
  });

  it('clamps tiny/odd terminal sizes to safe minimums', () => {
    const L = computeLayout(10, 5);
    expect(L.cols).toBe(40);
    expect(L.rows).toBe(16);
    expect(L.contentWidth).toBeGreaterThanOrEqual(20);
  });
});

describe('display width', () => {
  it('counts ASCII as 1 and ignores ANSI codes', () => {
    expect(displayWidth('hello')).toBe(5);
    expect(displayWidth('\x1b[1mhi\x1b[0m')).toBe(2);
    expect(displayWidth('\x1b[48;2;0;0;0m  \x1b[0m')).toBe(2);
  });

  it('counts CJK and emoji as 2, tabs expand', () => {
    expect(charWidth('中')).toBe(2);
    expect(displayWidth('a中b')).toBe(4);
    expect(displayWidth('😀')).toBe(2);
    expect(displayWidth('\t')).toBe(2);
    expect(displayWidth('│─╭')).toBe(3); // box drawing stays single-width
  });

  it('fitLine never exceeds the target visible width', () => {
    expect(displayWidth(fitLine('abcdef', 4))).toBeLessThanOrEqual(4);
    expect(fitLine('abcdef', 4)).toContain('…');
    expect(fitLine('ab', 10)).toBe('ab');
    expect(fitLine('\x1b[1mabcdef\x1b[0m', 4)).toContain('…');
    // Wide chars are not split mid-glyph.
    expect(displayWidth(fitLine('a中bcd', 4))).toBeLessThanOrEqual(4);
  });

  it('padTo pads styled strings to an exact visible width', () => {
    expect(displayWidth(padTo('\x1b[1mhi\x1b[0m', 5))).toBe(5);
    expect(padTo('abcdef', 3)).toBe('abcdef'); // never truncates
  });
});

describe('input wrapping + cursor math', () => {
  it('wraps visual rows without splitting wide chars', () => {
    expect(wrapVisual([''], 10)).toEqual(['']);
    expect(wrapVisual(['abcdefghij'], 10)).toEqual(['abcdefghij']);
    expect(wrapVisual(['abcdefghijk'], 10)).toEqual(['abcdefghij', 'k']);
    const rows = wrapVisual(['a中bcdefghij'], 10);
    expect(rows[0]).toBe('a中bcdefgh');
    expect(rows.join('')).toBe('a中bcdefghij');
  });

  it('maps empty input to the start of the editable area', () => {
    expect(computeCursor('', 0, 80)).toEqual({ visRow: 0, visCol: 0 });
  });

  it('maps mid-line, end-of-line and multiline cursors', () => {
    expect(computeCursor('hello', 2, 80)).toEqual({ visRow: 0, visCol: 2 });
    expect(computeCursor('hello', 5, 80)).toEqual({ visRow: 0, visCol: 5 });
    expect(computeCursor('ab\ncd', 5, 80)).toEqual({ visRow: 1, visCol: 2 });
    expect(computeCursor('ab\ncd', 3, 80)).toEqual({ visRow: 1, visCol: 0 });
    expect(computeCursor('a\n\nb', 3, 80)).toEqual({ visRow: 2, visCol: 1 });
  });

  it('handles wrap boundaries and wide chars', () => {
    // Cursor exactly at a wrap edge belongs at the next row start.
    const c = computeCursor('abcdefghij', 10, 10);
    expect(c.visRow).toBe(1);
    expect(c.visCol).toBe(0);
    // Wide char advances two columns.
    expect(computeCursor('a中', 2, 80)).toEqual({ visRow: 0, visCol: 3 });
    // Emoji (surrogate pair) counts as one step of width 2.
    expect(computeCursor('a😀b', 4, 80)).toEqual({ visRow: 0, visCol: 4 });
  });

  it('clamps out-of-range cursors into the buffer', () => {
    expect(computeCursor('hi', 99, 80)).toEqual({ visRow: 0, visCol: 2 });
    expect(computeCursor('hi', -5, 80)).toEqual({ visRow: 0, visCol: 0 });
  });
});

describe('home + markdown respect the shared margin', () => {
  it('home lines fit the terminal and honor the margin', () => {
    for (const cols of [40, 80, 120]) {
      const L = computeLayout(cols, 30);
      const out = renderHome({ cols, pipeline: initialPipeline(), margin: L.margin });
      for (const line of out.split('\n')) {
        expect(displayWidth(line)).toBeLessThanOrEqual(cols);
        if (line.trim().length > 0) {
          expect(line.startsWith(' '.repeat(L.margin))).toBe(true);
        }
      }
    }
  });

  it('markdown wraps prose to the content width', () => {
    const L = computeLayout(80, 30);
    const out = renderMarkdown(
      'Hello world this is a long paragraph that must wrap within the content width given',
      L.contentWidth,
    );
    for (const line of out.split('\n')) {
      expect(displayWidth(line)).toBeLessThanOrEqual(L.contentWidth);
    }
  });
});

describe('rendered frame geometry (captured stdout)', () => {
  function captureFrame(setup: (app: TuiApp) => void): { frame: string; cursor: string | null } {
    const app = new TuiApp({ project: 'layout-probe', noAltScreen: true });
    setup(app);
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      chunks.push(String(s));
      return true;
    };
    try {
      (app as unknown as { rawActive: boolean }).rawActive = true;
      (app as unknown as { render: () => void }).render();
      (app as unknown as { rawActive: boolean }).rawActive = false;
    } finally {
      process.stdout.write = orig as typeof process.stdout.write;
    }
    const frame = chunks.join('');
    // The frame contains fill-loop positions too — the cursor placement is
    // the LAST absolute position emitted.
    const matches = [...frame.matchAll(/\x1b\[(\d+);(\d+)H/g)];
    const m = matches[matches.length - 1];
    return { frame, cursor: m ? `${m[1]},${m[2]}` : null };
  }

  // Vitest has no TTY: termSize() falls back to 100x30 → margin 4.
  const COLS = 100;
  const ROWS = 30;
  const MARGIN = 4;

  it('parks an empty-input cursor at the start of the editable area', () => {
    const { cursor } = captureFrame(() => {});
    // boxTop = 30-(3+1+1) = 25 → content row 26, col = 4+3 = 7.
    expect(cursor).toBe('26,7');
  });

  it('places the cursor immediately after typed text and tracks arrows', () => {
    const { cursor } = captureFrame((app) => {
      const a = app as unknown as { buffer: string; cursor: number };
      a.buffer = 'hello';
      a.cursor = 5;
    });
    expect(cursor).toBe('26,12');
  });

  it('positions multiline cursors on the correct visual row', () => {
    // Two-row buffer → 4-tall box (top row 24); cursor on 2nd content row.
    const { cursor } = captureFrame((app) => {
      const a = app as unknown as { buffer: string; cursor: number };
      a.buffer = 'ab\ncd';
      a.cursor = 5;
    });
    expect(cursor).toBe('26,9');
  });

  it('fills the home frame exactly with the cursor on the input row', () => {
    // Regression: counted chrome once exceeded emitted lines (phantom
    // pipeline row on home + off-by-one box math), stranding the cursor on
    // the status line (the "m" of the model name) instead of the input.
    const { frame, cursor } = captureFrame(() => {});
    const start = frame.lastIndexOf('\x1b[H');
    expect(start).toBeGreaterThan(-1);
    // eslint-disable-next-line no-control-regex
    const body = frame.slice(start + 4).replace(/\x1b\[[?0-9;]*[A-Za-z]/g, '');
    const lines = body.split('\n');
    // tab + 23 conv + 3 box + status + hint rows, plus the trailing tail.
    expect(lines.length).toBe(30);
    const inputRow = lines.findIndex((l) => l.includes('Ask anything'));
    expect(inputRow).toBeGreaterThan(0);
    // 1-based frame row of the placeholder content line, inside the box.
    expect(cursor).toBe(`${inputRow + 1},7`);
  });

  it('never emits a line wider than the terminal', () => {
    const { frame } = captureFrame((app) => {
      const a = app as unknown as { messages: unknown[] };
      a.messages.push(
        { role: 'user', text: 'x'.repeat(300), mode: 'chat' },
        { role: 'assistant', text: '# Title\n\n' + 'word '.repeat(100), mode: 'chat' },
      );
    });
    // eslint-disable-next-line no-control-regex
    const text = frame
      .replace(/\x1b\[(\d+;\d+)?H/g, '\n')
      .replace(/\x1b\[[?0-9;]*[A-Za-z]/g, '');
    for (const line of text.split('\n')) {
      expect(displayWidth(line)).toBeLessThanOrEqual(COLS);
    }
    expect(ROWS).toBe(30);
    expect(MARGIN).toBe(4);
  });

  it('keeps conversation text off the left edge', () => {
    const { frame } = captureFrame((app) => {
      const a = app as unknown as { messages: unknown[] };
      a.messages.push({ role: 'user', text: 'hello', mode: 'build' });
    });
    // eslint-disable-next-line no-control-regex
    const text = frame.replace(/\x1b\[[?0-9;]*[A-Za-z]/g, '');
    const lines = text.split('\n').filter((l) => l.trim().length > 0 && l.trim() !== '·');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const leading = line.length - line.trimStart().length;
      // Background fill rows are all spaces; content starts at the margin.
      if (displayWidth(line.trim()) < COLS - MARGIN) {
        expect(leading).toBeGreaterThanOrEqual(MARGIN);
      }
    }
  });
});
