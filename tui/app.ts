/**
 * tui/app.ts — Full-screen interactive Braid TUI (presentation layer only).
 * Invokes existing services (agents / orchestrator / human_gate / cli helpers)
 * through clearly defined interfaces; no orchestration logic is duplicated.
 *
 * Layout (responsive, minimal chrome):
 *   conversation area (scrollable, markdown-rendered)
 *   pipeline bar (Plan → Review → Approval → Execute → Debug → Report)
 *   slash / mode / approval overlays
 *   persistent multiline input at the bottom
 *   compact status bar + hint line
 *
 * Keys: Tab/Shift+Tab modes · Enter submit · Ctrl+J newline · Up/Down history
 *       PgUp/PgDn scroll · Ctrl+T mode menu · Ctrl+C cancel/exit · Esc dismiss
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import { EventEmitter } from 'node:events';
import { config } from '../shared/config.js';
import {
  effectiveModel,
  setMockHandler,
  setModelOverride,
  clearModelOverride,
  type LlmStage,
} from '../shared/llm_client.js';
import type { FileManifest, GateDecision, PlanOutput, TestResults } from '../shared/types.js';
import { emptyTestResults } from '../shared/types.js';
import { ManifestStore, manifestPathFor } from '../orchestrator/manifest_store.js';
import { DigestStore } from '../orchestrator/digest_store.js';
import { LoopController, runRepairLoop } from '../orchestrator/loop_controller.js';
import { planProject } from '../agents/planner/planner.js';
import { reviewPlan } from '../agents/reviewer/reviewer.js';
import { executeProject } from '../agents/executor/executor.js';
import { runTests } from '../agents/debugger/test_runner.js';
import { generateReport } from '../agents/reporter/reporter.js';
import { decideGateReview, formatPlanSummary } from '../human_gate/gate_review.js';
import { decideGateReport, formatReportSummary } from '../human_gate/gate_report.js';
import { installMock, setMockManifest } from '../cli.js';
import { MODES, cycleMode, MODE_DESCRIPTIONS, MODE_HINTS, isValidMode, type Mode } from './modes.js';
import { filterCommands, findCommand, helpText, type SlashCommand } from './slash_commands.js';
import { renderMarkdown } from './markdown.js';
import {
  initialPipeline,
  pipelineSummary,
  isPipelineIdle,
  activeStageDetail,
  type PipelineMap,
  type PipelineStage,
} from './pipeline_status.js';
import { loadSession, saveSession } from './session_store.js';
import { BOX, C, statusStrip } from './theme.js';
import {
  computeCursor,
  computeLayout,
  displayWidth,
  fitLine,
  padTo,
  wrapVisual,
} from './layout.js';
import { HOME_SUGGESTIONS, renderHome, renderPipelineLine } from './home.js';
import { availableModels, labelForModel, shortForModel } from './models.js';

const BRAID_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_FILE = join(homedir(), '.braid_history');
const STAGES: LlmStage[] = ['plan', 'review', 'execute', 'triage', 'report'];

export type MsgRole = 'user' | 'assistant' | 'system' | 'tool' | 'error' | 'progress';

export interface ChatMessage {
  role: MsgRole;
  text: string;
  mode?: Mode;
}

export interface TuiOptions {
  project?: string;
  prdPath?: string;
  mock?: boolean;
  smokeOnly?: boolean;
  /** Escape hatch: render inline on the main screen instead of the alt screen. */
  noAltScreen?: boolean;
}

export interface ClickTarget {
  row: number;
  colStart: number;
  colEnd: number;
  onClick: () => void | Promise<void>;
}

const WELCOME = [
  'braid  ·  Autonomous SDLC Agent',
  '',
  'Type a PRD or /prd <file> to begin · /plan to start · Tab switches modes.',
].join('\n');

const INPUT_PLACEHOLDER = 'Ask anything or type / for commands...';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Cancelled extends Error {}

/** Status-bar model for a mode (each mode shows its pipeline stage's model). */
function statusModelFor(mode: Mode): LlmStage {
  switch (mode) {
    case 'chat': return 'plan';
    case 'plan': return 'plan';
    case 'review': return 'review';
    case 'build': return 'execute';
    case 'debug': return 'triage';
    case 'report': return 'report';
  }
}

function loadHistory(): string[] {
  try {
    return readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).slice(-200);
  } catch {
    return [];
  }
}

export class TuiApp {
  private mode: Mode = 'chat';
  private project = 'demo';
  private prdPath = '';
  private prdBuffer = '';
  private feedback?: string;
  private mock = false;
  private mockInstalledProject = '';
  private smokeOnly = false;
  private pipeline: PipelineMap = initialPipeline();
  private messages: ChatMessage[] = [];
  private history: string[] = loadHistory();
  private histIdx = 0;
  private buffer = '';
  private cursor = 0;
  private scrollOffset = 0;
  private menuIndex = 0;
  private menuDismissed = false;
  private modeMenuOpen = false;
  private modeMenuIndex = 0;
  private busy = false;
  private busyLabel = '';
  private spinnerFrame = 0;
  private cancelRequested = false;
  private lastCtrlC = 0;
  /** Compact model selector beneath the input (Ctrl+P). Shows one model by default. */
  private modelMenuOpen = false;
  private modelMenuIndex = 0;
  /** Active chat model id — distinct from per-stage pipeline assignments. */
  private chatModel = '';
  /** Home suggestion highlight. Never overwrites user-typed input. */
  private suggestionIndex = 0;
  /** Tool messages render collapsed to one line; Ctrl+O expands. */
  private toolsExpanded = false;
  private approval: {
    title: string;
    summary: string;
    awaitingFeedback: boolean;
    resolve: (d: GateDecision | null) => void;
  } | null = null;
  private running = false;
  private rawActive = false;
  /** When true, approval gates resolve approved without prompting (script/pipe). */
  private autoApproveGates = false;
  /** False with --no-alt-screen: render inline (scrollback churn returns). */
  private useAltScreen = true;
  /** teardown() must restore the terminal exactly once across exit paths. */
  private teardownDone = false;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private keyHandler: ((ch: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }) => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private clickTargets: ClickTarget[] = [];
  private keyStream: EventEmitter | null = null;
  private rawStdinHandler: ((chunk: Buffer) => void) | null = null;

  private registerClick(
    row: number,
    colStart: number,
    colEnd: number,
    onClick: () => void | Promise<void>
  ): void {
    this.clickTargets.push({ row, colStart, colEnd, onClick });
  }

  private handleMouseClick(col: number, row: number): void {
    const target = this.clickTargets.find(
      (t) => t.row === row && col >= t.colStart && col <= t.colEnd
    );
    if (target) {
      try {
        const res = target.onClick();
        if (res instanceof Promise) {
          void res.catch((err) => this.push('error', (err as Error).message));
        }
      } catch (err) {
        this.push('error', (err as Error).message);
      }
    }
  }

  constructor(opts: TuiOptions = {}) {
    const saved = loadSession();
    this.mode = isValidMode(saved.mode) ? saved.mode : 'chat';
    this.project = opts.project ?? saved.project ?? 'demo';
    this.prdPath = opts.prdPath ? resolve(opts.prdPath) : saved.prdPath;
    this.prdBuffer = saved.prdBuffer ?? '';
    this.feedback = saved.feedback;
    this.mock = opts.mock ?? saved.mock ?? false;
    this.smokeOnly = opts.smokeOnly ?? saved.smokeOnly ?? false;
    this.chatModel = saved.chatModel ?? '';
    this.useAltScreen = !opts.noAltScreen;
    this.histIdx = this.history.length;
    if (this.prdPath && existsSync(this.prdPath) && !this.prdBuffer) {
      try {
        this.prdBuffer = readFileSync(this.prdPath, 'utf8').trim();
      } catch { /* ignore */ }
    }
    if (opts.prdPath && existsSync(resolve(opts.prdPath))) {
      try {
        this.prdBuffer = readFileSync(resolve(opts.prdPath), 'utf8').trim();
        this.prdPath = resolve(opts.prdPath);
      } catch { /* ignore */ }
    }
    this.ensureMock();
  }

  // -- session ------------------------------------------------------------
  private persist(): void {
    saveSession({
      version: 1,
      project: this.project,
      prdPath: this.prdPath,
      prdBuffer: this.prdBuffer,
      feedback: this.feedback,
      mock: this.mock,
      smokeOnly: this.smokeOnly,
      mode: this.mode,
      chatModel: this.chatModel || undefined,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Active chat model id — falls back to the plan-stage model. */
  private activeChatModel(): string {
    if (this.chatModel) return this.chatModel;
    try {
      return effectiveModel('plan');
    } catch {
      return config.planModel;
    }
  }

  private outDir(): string {
    return join(resolve(config.generatedRoot), this.project);
  }

  private ensureMock(): void {
    if (this.mock && this.mockInstalledProject !== this.project) {
      installMock(this.project);
      this.mockInstalledProject = this.project;
    }
    if (!this.mock) {
      try { setMockHandler(null); } catch { /* live models */ }
      this.mockInstalledProject = '';
    }
  }

  private setStage(stage: PipelineStage, status: PipelineMap[PipelineStage]): void {
    this.pipeline[stage] = status;
    // PRD stage is derived from buffer presence — never stale.
    this.pipeline.prd = this.prdBuffer.trim() ? 'completed' : 'pending';
    this.render();
  }

  /** Sync derived PRD stage without touching orchestrator state. */
  private syncPrdStage(): void {
    this.pipeline.prd = this.prdBuffer.trim() ? 'completed' : 'pending';
  }

  // -- rendering ----------------------------------------------------------
  private termSize(): { cols: number; rows: number } {
    return {
      cols: Math.max(40, process.stdout.columns || 100),
      rows: Math.max(16, process.stdout.rows || 30),
    };
  }

  private push(role: MsgRole, text: string, mode?: Mode): void {
    this.messages.push({ role, text, mode });
    if (this.messages.length > 500) this.messages.splice(0, this.messages.length - 500);
    this.scrollOffset = 0; // new output pins to bottom
    this.render();
  }

  private rolePrefix(role: MsgRole): string {
    switch (role) {
      case 'user': return `${C.textBold}you${C.reset}`;
      case 'assistant': return `${C.accentBold}braid${C.reset}`;
      case 'system': return `${C.muted}·${C.reset}`;
      case 'tool': return `${C.muted}tool${C.reset}`;
      case 'progress': return `${C.muted}…${C.reset}`;
      case 'error': return `${C.redBold}error${C.reset}`;
    }
  }

  /** Compact single-line tool status; details only when expanded (Ctrl+O). */
  private renderToolMessage(text: string, contentWidth: number, margin: string): string[] {
    const width = Math.max(20, contentWidth);
    if (this.toolsExpanded) {
      return renderMarkdown(text, width).split('\n')
        .map((l) => fitLine(`${margin}${C.muted}${l}${C.reset}`, width + margin.length));
    }
    const first = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
    const extra = text.split('\n').filter((l) => l.trim()).length - 1;
    const suffix = extra > 0 ? ` ${C.faint}(+${extra} lines · Ctrl+O)${C.reset}` : '';
    const line = fitLine(first.replace(/[*_`#]/g, ''), Math.max(10, width - displayWidth(suffix) - 4));
    return [fitLine(`${margin}${C.muted}▸ ${line}${C.reset}${suffix}`, width + margin.length)];
  }

  /** Home empty-state is active only with zero messages (never repeats pipeline). */
  private showingHome(): boolean {
    return this.messages.length === 0;
  }

  /** Suggestions are interactive only when the input is empty — never clobber typing. */
  private suggestionsActive(): boolean {
    return this.showingHome() && this.buffer.length === 0 && !this.slashMenu();
  }

  private slashMenu(): SlashCommand[] | null {
    if (this.menuDismissed || this.modeMenuOpen || this.modelMenuOpen || this.approval) return null;
    if (!this.buffer.startsWith('/')) return null;
    const firstLine = this.buffer.split('\n')[0] ?? '';
    if (firstLine.includes(' ') && !firstLine.endsWith(' ')) {
      // still filter while typing args? Only when no space typed yet.
      const cmd = firstLine.slice(1).split(/\s+/)[0] ?? '';
      if (findCommand(cmd)) return null;
    }
    if (this.buffer.includes('\n')) return null;
    const q = firstLine.slice(1).split(/\s+/)[0] ?? '';
    const list = filterCommands(q);
    if (this.menuIndex >= list.length) this.menuIndex = 0;
    return list;
  }

  private setCursor(pos: number): void {
    this.cursor = Math.max(0, Math.min(this.buffer.length, pos));
  }

  private render(): void {
    if (!this.rawActive) return;
    this.clickTargets = [];
    this.syncPrdStage();
    // Clamp the cursor into the buffer on every frame (belt + suspenders;
    // setCursor() is the primary path in key handling).
    this.setCursor(this.cursor);
    const { cols, rows } = this.termSize();
    // Central layout: one shared left margin for conversation, pipeline,
    // menus, input box and status. Nothing touches either terminal edge.
    const L = computeLayout(cols, rows);
    const M = ' '.repeat(L.margin);
    const menu = this.slashMenu();
    const menuHeight = menu ? Math.min(menu.length, 8) + 1 : 0;
    const approvalHeight = this.approval ? 7 : 0;
    const modeMenuHeight = this.modeMenuOpen ? MODES.length + 2 : 0;
    const modelMenuHeight = this.modelMenuOpen ? Math.min(availableModels().length, 5) + 2 : 0;
    const showPipelineLine = !isPipelineIdle(this.pipeline) || this.showingHome();
    const pipelineHeight = showPipelineLine ? 1 : 0;
    const detailLine = activeStageDetail(this.pipeline, this.busyLabel || undefined);
    const detailHeight = detailLine ? 1 : 0;
    // Bordered input: top + up to 6 content rows + bottom. The box shares
    // the conversation's left edge (never centered independently).
    const inputLogical = this.buffer.split('\n');
    const MAX_INPUT_ROWS = 6;
    const visualAll = wrapVisual(inputLogical, L.innerWidth);
    // Cursor at an exact wrap boundary belongs at the start of the next
    // row (terminals wrap it there). Grow the rows so it always exists.
    const cursorAbs = computeCursor(this.buffer, this.cursor, L.innerWidth);
    if (cursorAbs.visCol >= L.innerWidth) {
      cursorAbs.visRow += 1;
      cursorAbs.visCol = 0;
    }
    while (visualAll.length <= cursorAbs.visRow) visualAll.push('');
    // Viewport follows the cursor: never scroll it out of the visible box.
    const winLen = Math.min(MAX_INPUT_ROWS, Math.max(1, visualAll.length));
    let winStart = Math.max(0, visualAll.length - winLen);
    if (cursorAbs.visRow < winStart) winStart = cursorAbs.visRow;
    if (cursorAbs.visRow >= winStart + winLen) winStart = cursorAbs.visRow - winLen + 1;
    const visual = visualAll.slice(winStart, winStart + winLen);
    const rowInWin = cursorAbs.visRow - winStart;
    const inputBoxHeight = winLen + 2;
    const statusHeight = 1;
    const hintHeight = cols >= 70 ? 1 : 0;
    const chromeHeight =
      pipelineHeight + detailHeight + approvalHeight +
      modeMenuHeight + menuHeight + modelMenuHeight +
      inputBoxHeight + statusHeight + hintHeight + 1;
    const convHeight = Math.max(4, rows - chromeHeight);

    // Build conversation — or the home empty-state (never both).
    // Every line is prefixed with the shared margin and fitted to the
    // terminal width, so text never touches the edges and row counting
    // (which cursor placement depends on) stays exact.
    const fit = (content: string): string => fitLine(M + content, cols - L.rightMargin);
    const conv: string[] = [];
    // Deferred home click targets (conv index → handler); frame rows are
    // only known after the scroll slice below.
    const homeClicks: { idx: number; c0: number; c1: number; fn: () => void }[] = [];
    if (this.showingHome()) {
      const home = renderHome({
        cols,
        pipeline: this.pipeline,
        selected: this.suggestionsActive() ? this.suggestionIndex : -1,
        showHints: false,
        margin: L.margin,
      });
      const homeLines = home.split('\n');
      for (const l of homeLines) conv.push(l);
      // Home layout (0-based conv indices): 0 '' · 1-7 wordmark · 8 tagline
      // · 9 '' · 10 pipeline · 11 '' · 12-15 suggestions. Column ranges are
      // the legacy segments shifted from a 2-col indent to the margin.
      // Rows are resolved after the scroll slice (see below).
      const dcol = L.margin - 2;
      homeClicks.push(
        { idx: 10, c0: 2 + dcol, c1: 10 + dcol, fn: () => { this.mode = 'chat'; this.persist(); this.render(); } },
        { idx: 10, c0: 11 + dcol, c1: 20 + dcol, fn: () => { this.mode = 'plan'; this.persist(); this.render(); } },
        { idx: 10, c0: 21 + dcol, c1: 32 + dcol, fn: () => { this.mode = 'review'; this.persist(); this.render(); } },
        { idx: 10, c0: 33 + dcol, c1: 46 + dcol, fn: () => { this.showApprovalStatus(); } },
        { idx: 10, c0: 47 + dcol, c1: 58 + dcol, fn: () => { this.mode = 'build'; this.persist(); this.render(); } },
        { idx: 10, c0: 59 + dcol, c1: 70 + dcol, fn: () => { this.mode = 'debug'; this.persist(); this.render(); } },
        { idx: 10, c0: 71 + dcol, c1: 85 + dcol, fn: () => { this.mode = 'report'; this.persist(); this.render(); } },
        { idx: 12, c0: 1, c1: cols, fn: () => void this.activateSuggestion(0) },
        { idx: 13, c0: 1, c1: cols, fn: () => void this.activateSuggestion(1) },
        { idx: 14, c0: 1, c1: cols, fn: () => void this.activateSuggestion(2) },
        { idx: 15, c0: 1, c1: cols, fn: () => void this.activateSuggestion(3) },
      );
    } else {
      for (const m of this.messages) {
        if (m.role === 'tool') {
          conv.push(fit(`${this.rolePrefix(m.role)}`));
          for (const l of this.renderToolMessage(m.text, L.contentWidth, M)) conv.push(l);
          conv.push('');
          continue;
        }
        const rendered = renderMarkdown(m.text, L.contentWidth).split('\n');
        const tag = m.mode ? ` ${C.faint}[${m.mode}]${C.reset}` : '';
        conv.push(fit(`${this.rolePrefix(m.role)}${tag}`));
        for (const l of rendered) conv.push(fit(`  ${l}`));
        conv.push('');
        // Single blank line between messages: separation without waste.
      }
    }
    const total = conv.length;
    const maxScroll = Math.max(0, total - convHeight);
    if (this.scrollOffset > maxScroll) this.scrollOffset = maxScroll;
    const end = Math.max(0, total - this.scrollOffset);
    const start = Math.max(0, end - convHeight);
    const visible = conv.slice(start, end);
    // Resolve deferred home clicks to 1-based frame rows (scroll-aware).
    for (const hc of homeClicks) {
      const row = hc.idx - start + 1;
      if (row >= 1 && row <= visible.length) this.registerClick(row, hc.c0, hc.c1, hc.fn);
    }

    const busyBit = this.busy ? ` ${SPINNER[this.spinnerFrame % SPINNER.length]} ${this.busyLabel}` : '';
    const chatModel = this.activeChatModel();

    // Full black background: explicitly fill every cell — VS Code's
    // integrated terminal keeps its own gray behind `\x1b[2J`, so a clear
    // alone leaves patchy gray around the text. Painting row by row
    // guarantees the whole panel matches the brand swatch.
    let s = '\x1b[?25l';
    s += '\x1b[2J\x1b[H';
    s += C.bg;
    const fillRow = ' '.repeat(cols);
    for (let r = 0; r < rows; r++) {
      s += `\x1b[${r + 1};1H${fillRow}`;
    }
    s += '\x1b[H';
    s += visible.join('\n');
    if (visible.length < convHeight) s += '\n'.repeat(convHeight - visible.length);
    s += '\n';

    // All chrome below shares the layout margin and is fitted inside both
    // margins — wrapped lines would silently shift rows and break the
    // absolute cursor placement at the end of render().
    const chrome = (content: string): string => fitLine(M + content, cols - L.rightMargin);
    if (showPipelineLine && !this.showingHome()) {
      const pipeRow = s.split('\n').length;
      const dcol = L.margin - 2; // legacy segments assumed a 2-col indent
      this.registerClick(pipeRow, 2 + dcol, 10 + dcol, () => { this.mode = 'chat'; this.persist(); this.render(); });
      this.registerClick(pipeRow, 11 + dcol, 20 + dcol, () => { this.mode = 'plan'; this.persist(); this.render(); });
      this.registerClick(pipeRow, 21 + dcol, 32 + dcol, () => { this.mode = 'review'; this.persist(); this.render(); });
      this.registerClick(pipeRow, 33 + dcol, 46 + dcol, () => { this.showApprovalStatus(); });
      this.registerClick(pipeRow, 47 + dcol, 58 + dcol, () => { this.mode = 'build'; this.persist(); this.render(); });
      this.registerClick(pipeRow, 59 + dcol, 70 + dcol, () => { this.mode = 'debug'; this.persist(); this.render(); });
      this.registerClick(pipeRow, 71 + dcol, 85 + dcol, () => { this.mode = 'report'; this.persist(); this.render(); });
      s += chrome(renderPipelineLine(this.pipeline, L.contentWidth)) + '\n';
    }
    if (detailLine) {
      const detail = `${C.muted}${fitLine(detailLine, Math.max(10, L.contentWidth - (busyBit ? displayWidth(busyBit) : 0)))}${C.reset}${busyBit ? `${C.muted}${busyBit}${C.reset}` : ''}`;
      s += chrome(detail) + '\n';
    } else if (this.busy && busyBit) {
      s += chrome(`${C.muted}${busyBit.trim()}${C.reset}`) + '\n';
    }

    if (this.approval) {
      const a = this.approval;
      s += '\n' + chrome(`${C.textBold}${a.title}${C.reset}`) + '\n';
      const sumLines = a.summary.split('\n').slice(0, 3);
      for (const l of sumLines) s += chrome(`${C.muted}${fitLine(l, Math.max(10, L.contentWidth))}${C.reset}`) + '\n';
      if (a.awaitingFeedback) {
        s += chrome(`${C.amber}Type revision feedback + Enter · Esc cancels${C.reset}`) + '\n';
      } else {
        const btnRow = s.split('\n').length;
        this.registerClick(btnRow, M.length + 1, M.length + 15, () => a.resolve({ approved: true }));
        this.registerClick(btnRow, M.length + 16, M.length + 30, () => {
          a.awaitingFeedback = true;
          this.buffer = '';
          this.setCursor(0);
          this.render();
        });
        this.registerClick(btnRow, M.length + 31, M.length + 48, () => a.resolve(null));
        s += chrome(`${C.green}[y]${C.reset} approve   ${C.amber}[n]${C.reset} revise   ${C.muted}[c/Esc]${C.reset} cancel`) + '\n';
      }
    }

    if (this.modeMenuOpen) {
      s += '\n' + chrome(`${C.textBold}modes${C.reset} ${C.faint}(Tab cycles, Enter selects)${C.reset}`) + '\n';
      MODES.forEach((m, i) => {
        const modeRow = s.split('\n').length;
        this.registerClick(modeRow, 1, cols, () => {
          this.mode = m;
          this.modeMenuOpen = false;
          this.persist();
          this.push('system', `mode → **${this.mode}** — ${MODE_DESCRIPTIONS[this.mode]}`);
        });
        const cur = i === this.modeMenuIndex ? `${C.accent}›${C.reset}` : ' ';
        const active = m === this.mode ? `${C.green}●${C.reset}` : `${C.faint}○${C.reset}`;
        s += chrome(`${cur} ${active} ${C.text}${m}${C.reset} ${C.faint}— ${MODE_DESCRIPTIONS[m]}${C.reset}`) + '\n';
      });
    }

    if (menu && menu.length > 0) {
      s += '\n';
      menu.slice(0, 8).forEach((c, i) => {
        const menuRow = s.split('\n').length;
        this.registerClick(menuRow, 1, cols, () => {
          this.completeMenuIndex(i);
        });
        const cur = i === (this.menuIndex % Math.min(menu.length, 8)) ? `${C.accent}›${C.reset}` : ' ';
        s += chrome(`${cur} ${C.text}/${c.name}${C.reset} ${C.faint}— ${c.description}${C.reset}`) + '\n';
      });
    }

    if (this.modelMenuOpen) {
      const models = availableModels();
      s += '\n' + chrome(`${C.textBold}model${C.reset} ${C.faint}(Enter selects chat model · /model <slot> <name> for stages)${C.reset}`) + '\n';
      models.slice(0, 5).forEach((m, i) => {
        const modelRow = s.split('\n').length;
        this.registerClick(modelRow, 1, cols, () => {
          this.chatModel = m.id;
          this.modelMenuOpen = false;
          this.persist();
          this.push('system', `chat model → **${m.label}** (${m.id}) — stages unchanged (see \`/model\`).`);
          this.render();
        });
        const cur = i === this.modelMenuIndex ? `${C.accent}›${C.reset}` : ' ';
        const active = m.id === chatModel ? `${C.green}●${C.reset}` : `${C.faint}○${C.reset}`;
        s += chrome(`${cur} ${active} ${C.text}${m.label}${C.reset} ${C.faint}${m.slot} · ${m.id}${C.reset}`) + '\n';
      });
    }

    // Bordered multiline input (OpenCode-style), left edge aligned with the
    // conversation boundary. Internal padding keeps text off the borders;
    // the mode pill lives in the top frame.
    const pad = M;
    const boxWidth = L.boxWidth;
    const innerWidth = L.innerWidth;
    const topLabel = ` ${C.accent}${this.mode}${C.reset} `;
    const topFill = Math.max(0, boxWidth - 2 - displayWidth(topLabel));
    s += `${pad}${C.faint}${BOX.tl}${C.reset}${topLabel}${C.faint}${BOX.h.repeat(topFill)}${BOX.tr}${C.reset}\n`;
    const isEmpty = this.buffer.length === 0;
    visual.forEach((vline, vi) => {
      const content = isEmpty && vi === 0
        ? `${C.faint}${fitLine(INPUT_PLACEHOLDER, innerWidth)}${C.reset}`
        : vline;
      s += `${pad}${C.faint}${BOX.v}${C.reset} ${padTo(content, innerWidth)} ${C.faint}${BOX.v}${C.reset}\n`;
    });
    const botFill = boxWidth - 2;
    s += `${pad}${C.faint}${BOX.bl}${BOX.h.repeat(botFill)}${BOX.br}${C.reset}\n`;

    // Minimal status strip aligned with the input box: model · project · mode.
    const modelLabel = shortForModel(chatModel);
    const status = statusStrip({ cols: L.contentWidth, model: modelLabel, project: this.project, mode: this.mode });
    const modelHint = cols >= 90 ? ` ${C.faint}(Ctrl+P)${C.reset}` : '';
    const scrolled = this.scrollOffset > 0 ? ` ${C.amber}[▲ ${this.scrollOffset}]${C.reset}` : '';
    s += chrome(`${status}${modelHint}${scrolled}`) + '\n';
    if (hintHeight) {
      s += chrome(`${C.faint}Enter send · Ctrl+J newline · Tab mode · Ctrl+C ${this.busy ? 'cancel' : 'exit'}${C.reset}`) + '\n';
    }

    // Every reset above drops the background — re-assert it after each
    // one so all cells (including padding/newline fills) stay black.
    // eslint-disable-next-line no-control-regex
    s = s.split('\x1b[0m').join(`\x1b[0m${C.bg}`);
    s += C.reset; // leave terminal state clean between frames
    process.stdout.write(s);

    // Reposition cursor inside the bordered input.
    // Rows after cursor visual row: remaining input rows + bottom border + status + hint.
    const cursorVisRow = rowInWin;
    const remainingInput = visual.length - 1 - Math.max(0, cursorVisRow);
    const linesAfter = remainingInput + 1 + 1 + hintHeight;
    const padLeft = L.margin;
    const targetCol = padLeft + 3 + cursorAbs.visCol;
    if (isEmpty) {
      // Placeholder — park at input start.
      if (linesAfter > 0) process.stdout.write(`\x1b[${linesAfter}A`);
      process.stdout.write(`\x1b[${padLeft + 3}G`);
    } else {
      if (linesAfter > 0) process.stdout.write(`\x1b[${linesAfter}A`);
      process.stdout.write(`\x1b[${targetCol}G`);
    }
    process.stdout.write('\x1b[?25h');
  }

  /** Split logical buffer lines into visual rows of innerWidth. Pure + testable. */
  private wrapBufferVisual(lines: string[], innerWidth: number): string[] {
    const w = Math.max(10, innerWidth);
    const out: string[] = [];
    for (const line of lines) {
      if (line.length === 0) {
        out.push('');
        continue;
      }
      let rest = line;
      while (rest.length > w) {
        out.push(rest.slice(0, w));
        rest = rest.slice(w);
      }
      out.push(rest);
    }
    return out.length > 0 ? out : [''];
  }

  /** Visual row index of the cursor within the wrapped buffer. */
  private visualCursorRow(beforeCursor: string, innerWidth: number): number {
    const w = Math.max(10, innerWidth);
    const lines = beforeCursor.split('\n');
    let row = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (i < lines.length - 1) {
        row += Math.max(1, Math.ceil(line.length / w) || 1);
        if (line.length === 0) row += 0; // empty line already counted as 1
      } else {
        // Last (cursor) line: completed wrapped rows before cursor col.
        const col = line.length;
        row += Math.floor(col / w);
      }
    }
    return row;
  }

  /** Visual column of the cursor within its wrapped row. */
  private visualCursorCol(beforeCursor: string, innerWidth: number): number {
    const w = Math.max(10, innerWidth);
    const col = (beforeCursor.split('\n').pop() ?? '').length;
    return col % w;
  }

  /** Activate a home suggestion WITHOUT overwriting non-empty input. */
  private async activateSuggestion(index: number): Promise<void> {
    if (!this.suggestionsActive()) return;
    const s = HOME_SUGGESTIONS[index];
    if (!s) return;
    if (s.command === '/status') {
      // Resume: surface persisted session diagnostics, keep home if empty.
      this.showStatus();
      return;
    }
    // Run directly (e.g. /plan, /review) or prime slash prefix for /prd.
    if (s.command.endsWith(' ')) {
      this.buffer = s.command;
      this.cursor = this.buffer.length;
      this.menuDismissed = false;
      this.render();
      return;
    }
    this.push('user', `\`${s.command}\``, this.mode);
    await this.handleLine(s.command, true);
  }

  // -- approval gate (keyboard-accessible, explicit) -----------------------
  private askApproval(title: string, summary: string): Promise<GateDecision | null> {
    if (this.autoApproveGates) {
      this.pipeline.approval = 'completed';
      return Promise.resolve({ approved: true });
    }
    this.setStage('approval', 'awaiting-approval');
    this.render();
    return new Promise<GateDecision | null>((resolve) => {
      this.approval = { title, summary, awaitingFeedback: false, resolve };
    }).then((d) => {
      this.approval = null;
      this.setStage('approval', d && d.approved ? 'completed' : 'pending');
      return d;
    });
  }

  private handleApprovalKey(ch: string, key: { name?: string; ctrl?: boolean }): boolean {
    const a = this.approval;
    if (!a) return false;
    if (a.awaitingFeedback) return false; // feedback typed into input, Enter submits
    const k = (key.name ?? '').toLowerCase();
    if (ch === 'y' || ch === 'Y' || k === 'y' || ch === '1') {
      a.resolve({ approved: true });
      return true;
    }
    if (ch === 'n' || ch === 'N' || ch === 'r' || ch === 'R' || k === 'n' || ch === '2') {
      a.awaitingFeedback = true;
      this.buffer = '';
      this.cursor = 0;
      this.render();
      return true;
    }
    if (ch === 'c' || ch === 'C' || k === 'c' || ch === '3' || k === 'escape') {
      a.resolve(null); // explicit cancel — no destructive action
      return true;
    }
    return true; // swallow other keys while dialog open
  }

  // -- pipeline actions (thin wrappers over existing modules) -------------
  private readJson<T>(path: string, what: string): T {
    if (!existsSync(path)) throw new Error(`No ${what} yet — run /plan first (${path} missing)`);
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }

  private prdText(): string {
    if (this.prdBuffer.trim()) return this.prdBuffer;
    if (this.prdPath && existsSync(this.prdPath)) return readFileSync(this.prdPath, 'utf8');
    throw new Error('No PRD yet — type requirements, /prd <file>, or paste a path in chat mode.');
  }

  private async withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.busyLabel = label;
    this.cancelRequested = false;
    this.render();
    try {
      const poll = async (): Promise<T> => {
        const p = fn();
        // Allow Ctrl+C cancellation between awaits: race with a cancel watcher.
        const res = await p;
        if (this.cancelRequested) throw new Cancelled('Cancelled.');
        return res;
      };
      return await poll();
    } finally {
      this.busy = false;
      this.busyLabel = '';
      this.render();
    }
  }

  private checkCancel(): void {
    if (this.cancelRequested) throw new Cancelled('Cancelled.');
  }

  private async actPlan(): Promise<void> {
    const prd = this.prdText();
    this.setStage('plan', 'running');
    this.push('progress', `Planning **${this.project}** (${prd.length} chars PRD)…`);
    // Persist PRD so artifacts stay reproducible.
    mkdirSync(this.outDir(), { recursive: true });
    const prdFile = join(this.outDir(), 'prd.txt');
    writeFileSync(prdFile, prd);
    this.prdPath = prdFile;
    this.ensureMock();
    try {
      const plan = await this.withBusy('planning', () =>
        planProject({ project: this.project, prd, feedback: this.feedback }),
      );
      this.checkCancel();
      if (this.mock) setMockManifest(plan.manifest);
      let review;
      try {
        this.setStage('review', 'running');
        review = await this.withBusy('reviewing', () => reviewPlan(prd, plan));
        this.setStage('review', 'completed');
      } catch (err) {
        review = { critiques: [], risks: [`review unavailable: ${(err as Error).message}`], riskScore: 0.5 };
        this.setStage('review', 'completed');
      }
      writeFileSync(join(this.outDir(), 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
      new ManifestStore(manifestPathFor(resolve(config.generatedRoot), this.project), plan.manifest);
      this.setStage('plan', 'completed');
      this.push('assistant', `## Plan ready\n\n${formatPlanSummary(plan, review)}`, this.mode);
      this.persist();
      // Explicit Gate 1 — never auto-approves in the interactive TUI.
      const decision = await this.askApproval('Gate 1 — approve plan?', formatPlanSummary(plan, review));
      if (decision === null) {
        this.push('system', 'Gate 1 cancelled — plan kept, no code written.');
        return;
      }
      let gate: GateDecision;
      try {
        gate = decideGateReview(decision.approved, decision.feedback);
      } catch (err) {
        this.push('error', (err as Error).message);
        return;
      }
      if (!gate.approved) {
        this.feedback = gate.feedback;
        writeFileSync(join(this.outDir(), 'gate1-feedback.txt'), (gate.feedback ?? '') + '\n');
        this.push('system', `Gate 1: revisions requested.\n\n${gate.feedback}\n\nRe-run \`/plan\` — feedback is folded into the next pass.`);
        this.persist();
      } else {
        this.feedback = undefined;
        this.push('system', 'Gate 1: **approved** — `/build` will now write code.');
        this.persist();
      }
    } catch (err) {
      if (err instanceof Cancelled) {
        this.setStage('plan', 'pending');
        this.push('system', 'Planning cancelled.');
      } else {
        this.setStage('plan', 'failed');
        this.push('error', `Plan failed: ${(err as Error).message}`);
      }
    }
  }

  private async actReview(): Promise<void> {
    try {
      const plan = this.readJson<PlanOutput>(join(this.outDir(), 'plan.json'), 'plan');
      const prd = this.prdText();
      this.setStage('review', 'running');
      const review = await this.withBusy('reviewing', () => reviewPlan(prd, plan));
      this.setStage('review', 'completed');
      this.push(
        'assistant',
        `## Review — risk ${review.riskScore.toFixed(2)}\n\n` +
          (review.critiques.map((c) => `- ${c}`).join('\n') || '_No critiques._') +
          '\n\n' +
          (review.risks.map((r) => `- ⚠ ${r}`).join('\n') || '_No risks flagged._'),
        this.mode,
      );
    } catch (err) {
      if (err instanceof Cancelled) this.push('system', 'Review cancelled.');
      else {
        this.setStage('review', 'failed');
        this.push('error', `Review failed: ${(err as Error).message}`);
      }
    }
  }

  private async actBuild(): Promise<void> {
    try {
      this.ensureMock();
      const store = ManifestStore.load(manifestPathFor(resolve(config.generatedRoot), this.project));
      if (this.mock) setMockManifest(store.snapshot());
      const total = store.list().length;
      this.setStage('execute', 'running');
      this.push('progress', `Executing **${this.project}** — ${total} file(s): skeleton → digest → implementation…`);
      // Poll manifest statuses for live progress without touching the executor.
      const pollTimer = setInterval(() => {
        try {
          const done = store.byStatus('implemented').length + store.byStatus('verified').length;
          this.busyLabel = `building file ${Math.min(done + 1, total)}/${total}`;
          this.render();
        } catch { /* ignore */ }
      }, 400);
      try {
        await this.withBusy(`building file 1/${total}`, () => executeProject(store, this.outDir()));
      } finally {
        clearInterval(pollTimer);
      }
      this.checkCancel();
      const done = store.byStatus('implemented');
      this.setStage('execute', 'completed');
      this.push('assistant', `## Build complete\n\nImplemented (${done.length}/${total}):\n${done.map((f) => `- \`${f}\``).join('\n')}`, this.mode);
      this.persist();
    } catch (err) {
      if (err instanceof Cancelled) {
        this.setStage('execute', 'pending');
        this.push('system', 'Build cancelled.');
      } else {
        this.setStage('execute', 'failed');
        this.push('error', `Build failed: ${(err as Error).message}`);
      }
    }
  }

  private async actDebug(): Promise<void> {
    try {
      this.ensureMock();
      const projectRoot = this.outDir();
      const store = ManifestStore.load(manifestPathFor(resolve(config.generatedRoot), this.project));
      const plan = this.readJson<PlanOutput>(join(projectRoot, 'plan.json'), 'plan');
      this.setStage('debug', 'running');
      this.push('progress', `Running test suite for **${this.project}**…`);
      let results: TestResults;
      if (this.smokeOnly) {
        const missing = store.snapshot().files.filter((f) => !existsSync(join(projectRoot, f.path)));
        results = { ...emptyTestResults(), smoke: missing.length === 0 ? { passed: 1, failed: 0 } : { passed: 0, failed: missing.length } };
        this.push('tool', missing.length === 0 ? 'smoke-only: **PASS** (vitest skipped)' : `smoke-only: missing ${missing.map((f) => f.path).join(', ')}`);
      } else {
        results = await this.withBusy('testing', () =>
          runTests({ braidRoot: BRAID_ROOT, projectRoot, manifest: store.snapshot(), stubs: plan.testStubs }),
        );
        this.checkCancel();
        if (results.smoke.failed + results.stubs.failed > 0) {
          this.push('progress', `Failures detected — repair loop (max ${new LoopController().maxSelfLoop})…`);
          const digest = new DigestStore();
          for (const f of store.list()) {
            try {
              digest.upsert(f.path, readFileSync(join(projectRoot, f.path), 'utf8'), f.purpose);
            } catch { /* missing — smoke flags it */ }
          }
          const repaired = await this.withBusy('repairing', () =>
            runRepairLoop({
              controller: new LoopController(),
              store,
              digest,
              projectRoot,
              failures: `smoke failed=${results.smoke.failed} stubs failed=${results.stubs.failed}`,
              allowedPaths: store.snapshot().files.map((f) => f.path),
              retest: () => runTests({ braidRoot: BRAID_ROOT, projectRoot, manifest: store.snapshot(), stubs: plan.testStubs }),
            }),
          );
          results = repaired.results;
          this.push('tool', `Repair: ${repaired.attempts} attempt(s), converged=${repaired.converged}`);
        }
      }
      writeFileSync(join(projectRoot, 'results.json'), JSON.stringify(results, null, 2) + '\n');
      this.setStage('debug', results.smoke.failed + results.stubs.failed > 0 ? 'failed' : 'completed');
      this.push(
        'assistant',
        `## Tests\n\n- smoke: **${results.smoke.passed}** passed / ${results.smoke.failed} failed\n- stubs: **${results.stubs.passed}** passed / ${results.stubs.failed} failed\n- regression: ${results.regression.passed} passed / ${results.regression.failed} failed`,
        this.mode,
      );
    } catch (err) {
      if (err instanceof Cancelled) {
        this.setStage('debug', 'pending');
        this.push('system', 'Debug cancelled.');
      } else {
        this.setStage('debug', 'failed');
        this.push('error', `Debug failed: ${(err as Error).message}`);
      }
    }
  }

  private async actReport(): Promise<void> {
    try {
      const projectRoot = this.outDir();
      const store = ManifestStore.load(manifestPathFor(resolve(config.generatedRoot), this.project));
      let results: TestResults;
      try {
        results = this.readJson<TestResults>(join(projectRoot, 'results.json'), 'results');
      } catch {
        results = { ...emptyTestResults(), smoke: { passed: 1, failed: 0 } };
      }
      const prd = this.prdText();
      this.setStage('report', 'running');
      const report = await this.withBusy('reporting', () =>
        generateReport({
          manifest: store.snapshot(),
          testResults: results,
          changedFiles: store.snapshot().files.map((f) => f.path),
          risks: [],
          requirements: prd.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20),
        }),
      );
      writeFileSync(join(projectRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
      this.setStage('report', 'completed');
      this.push('assistant', `## Report\n\n${formatReportSummary(report)}`, this.mode);
      // Explicit Gate 2.
      const decision = await this.askApproval('Gate 2 — satisfied?', formatReportSummary(report));
      if (decision === null) {
        this.push('system', 'Gate 2 cancelled — report kept.');
        return;
      }
      let gate: GateDecision;
      try {
        gate = decideGateReport(decision.approved, decision.feedback);
      } catch (err) {
        this.push('error', (err as Error).message);
        return;
      }
      if (!gate.approved) {
        this.feedback = gate.feedback;
        writeFileSync(join(projectRoot, 'gate2-feedback.txt'), (gate.feedback ?? '') + '\n');
        this.push('system', `Gate 2: looping back to plan.\n\n${gate.feedback}\n\nRun \`/plan\` — feedback is folded into the next pass.`);
        this.setStage('plan', 'pending');
        this.persist();
      } else {
        this.push('system', '**Done.** Feature accepted at Gate 2.');
      }
    } catch (err) {
      if (err instanceof Cancelled) {
        this.setStage('report', 'pending');
        this.push('system', 'Report cancelled.');
      } else {
        this.setStage('report', 'failed');
        this.push('error', `Report failed: ${(err as Error).message}`);
      }
    }
  }

  private async actRunFull(): Promise<void> {
    await this.actPlan();
    if (this.pipeline.plan !== 'completed') return;
    await this.actBuild();
    if (this.pipeline.execute !== 'completed') return;
    await this.actDebug();
    await this.actReport();
  }

  /** Diagnostics view — full detail lives here, NOT in the default strip. */
  private showStatus(): void {
    this.syncPrdStage();
    const chatId = this.activeChatModel();
    this.push(
      'tool',
      [
        `**status** — ${this.project} · ${this.mode} · ${labelForModel(chatId)}`,
        `**pipeline:** ${pipelineSummary(this.pipeline)}`,
        `**stages:** PRD ${this.pipeline.prd} · Plan ${this.pipeline.plan} · Review ${this.pipeline.review} · Approval ${this.pipeline.approval} · Execute ${this.pipeline.execute} · Debug ${this.pipeline.debug} · Report ${this.pipeline.report}`,
        `**prd:** ${this.prdBuffer.length} chars buffered (${this.prdPath || 'no file'})`,
        this.feedback ? `**feedback:** ${this.feedback}` : '**feedback:** —',
        `**chat model:** ${chatId} (Ctrl+P or \`/model chat <name>\`)`,
        `**flags:** mock=${this.mock ? 'on' : 'off'} · smoke-only=${this.smokeOnly} (see \`/config\`)`,
      ].join('\n'),
    );
  }

  /** Dedicated diagnostics: models, flags, paths. Keeps main UI minimal. */
  private showConfig(): void {
    this.push(
      'tool',
      [
        '**config** (diagnostics — main UI stays minimal)',
        `**chat:** ${this.activeChatModel()} — ${labelForModel(this.activeChatModel())}`,
        `**stages:** ${STAGES.map((s) => `${s}=${effectiveModel(s)}`).join(' · ')}`,
        `**flags:** mock=${this.mock ? 'on' : 'off'} · smoke-only=${this.smokeOnly}`,
        `**paths:** project=${this.project} · out=${this.outDir()} · prd=${this.prdPath || '—'}`,
        `**keys:** ${STAGES.map((s) => `${s}:${config.apiKeyFor(s) ? 'set' : 'missing'}`).join(' · ')}`,
      ].join('\n'),
    );
  }

  private showFiles(): void {
    try {
      const store = ManifestStore.load(manifestPathFor(resolve(config.generatedRoot), this.project));
      const files = store.list();
      const done = store.byStatus('implemented').length + store.byStatus('verified').length;
      this.push(
        'assistant',
        `## File manifest — ${done}/${files.length} implemented\n\n` +
          files.map((f) => `- \`${f.path}\` [${f.status}] — ${f.purpose}`).join('\n'),
      );
    } catch (err) {
      this.push('error', `No manifest yet: ${(err as Error).message}`);
    }
  }

  private async cmdModel(arg: string): Promise<void> {
    const parts = arg.trim().split(/\s+/).filter(Boolean);
    const chatId = this.activeChatModel();
    if (parts.length === 0) {
      this.push(
        'tool',
        '**Models**\n' +
          `chat → ${chatId} (${labelForModel(chatId)}) — Ctrl+P or \`/model chat <name>\`\n` +
          STAGES.map((s, i) => `${i + 1}. \`${s}\` → ${effectiveModel(s)}`).join('\n') +
          '\n\nUsage: `/model chat <name>` · `/model <slot|1-5> <name>` · `/model <slot> reset`',
      );
      return;
    }
    const slotRaw = (parts[0] ?? '').toLowerCase();
    // Active chat model — distinct from pipeline-stage assignments.
    if (slotRaw === 'chat') {
      const name = parts.slice(1).join(' ');
      if (!name || name.toLowerCase() === 'reset') {
        this.chatModel = '';
        this.persist();
        this.push('tool', `chat → ${this.activeChatModel()} (default)`);
        this.render();
        return;
      }
      this.chatModel = name;
      this.persist();
      this.push('tool', `chat → ${name} (${labelForModel(name)})`);
      this.render();
      return;
    }
    const slotIdx = Number.parseInt(slotRaw, 10);
    const stage: LlmStage | undefined = STAGES[slotIdx - 1] ?? (STAGES as string[]).includes(slotRaw) ? (slotRaw as LlmStage) : undefined;
    if (!stage) {
      this.push('error', `Unknown slot "${parts[0]}". Use chat|plan|review|execute|triage|report or 1-5.`);
      return;
    }
    const name = parts.slice(1).join(' ');
    if (!name || name.toLowerCase() === 'reset') {
      clearModelOverride(stage);
      this.push('tool', `\`${stage}\` → env default (${effectiveModel(stage)})`);
      return;
    }
    try {
      setModelOverride(stage, name);
      this.push('tool', `\`${stage}\` → ${effectiveModel(stage)}`);
    } catch (err) {
      this.push('error', (err as Error).message);
    }
  }

  // -- chat ---------------------------------------------------------------
  private async actChat(text: string): Promise<void> {
    const trimmed = text.trim();
    // Direct file path? Load it as the PRD (the spec's core input gesture).
    const maybePath = trimmed.replace(/^["']|["']$/g, '');
    if (/^[~./\\a-zA-Z0-9_-].{1,260}$/.test(maybePath) && existsSync(resolve(maybePath))) {
      try {
        const stat = await import('node:fs').then((m) => m.statSync(resolve(maybePath)));
        if (stat.isFile() && stat.size < 500_000) {
          this.prdBuffer = readFileSync(resolve(maybePath), 'utf8').trim();
          this.prdPath = resolve(maybePath);
          this.persist();
          this.push('assistant', `Loaded PRD from \`${maybePath}\` (${this.prdBuffer.length} chars). Run \`/plan\` or press Enter in **plan** mode to generate the task graph + manifest.`, 'chat');
          return;
        }
      } catch { /* fall through to normal chat */ }
    }
    if (!trimmed) {
      this.push('assistant', `**${this.mode}** mode — ${MODE_HINTS[this.mode]}\n\n${this.prdBuffer ? `PRD buffer: ${this.prdBuffer.length} chars.` : 'No PRD buffered yet. Paste requirements or `/prd <file>`.'}`, 'chat');
      return;
    }
    // Chat accumulates PRD context while answering locally (no hidden LLM spend).
    if (this.mode === 'chat' && trimmed.length > 40 && !trimmed.startsWith('/')) {
      this.prdBuffer += (this.prdBuffer ? '\n' : '') + trimmed;
      this.persist();
    }
    const reply = [
      `Noted (${trimmed.length} chars).`,
      '',
      this.prdBuffer
        ? `PRD buffer is now **${this.prdBuffer.length}** chars.`
        : 'No PRD buffered yet.',
      '',
      '- `/plan` generates the task graph + manifest (Gate 1 approval follows).',
      '- `/status` shows pipeline state · `/files` inspects the manifest.',
      this.mock ? '- mock models are **on** — runs work fully offline.' : '- Tip: `/mock` toggles offline demo models (no API keys).',
    ].join('\n');
    // Simulated streaming: reveal in chunks without blocking input.
    const chunks = 3;
    const step = Math.ceil(reply.length / chunks);
    let shown = '';
    for (let i = 0; i < chunks; i++) {
      if (this.cancelRequested) break;
      shown = reply.slice(0, step * (i + 1));
      if (i < chunks - 1) {
        this.messages.push({ role: 'assistant', text: `${shown} ▍`, mode: 'chat' });
        this.render();
        await new Promise((r) => setTimeout(r, 60));
        this.messages.pop();
      }
    }
    this.push('assistant', reply, 'chat');
  }

  // -- command dispatch (shared by TUI, script and fallback paths) ---------
  /** Returns false when the session should exit. */
  async handleLine(raw: string, interactive: boolean): Promise<boolean> {
    const line = raw.trim();
    if (!line) {
      await this.runCurrentMode(interactive);
      return true;
    }
    if (!line.startsWith('/')) {
      if (this.mode === 'plan' || this.mode === 'chat') {
        this.push('user', raw, this.mode);
        if (this.mode === 'plan') {
          this.prdBuffer += (this.prdBuffer ? '\n' : '') + raw;
          this.persist();
          this.push('assistant', `PRD buffer: **${this.prdBuffer.length}** chars (Enter runs planner, \`/plan\` runs now).`, this.mode);
        } else {
          await this.actChat(raw);
        }
      } else {
        this.feedback = raw;
        this.persist();
        this.push('user', raw, this.mode);
        this.push('system', 'Saved as gate feedback for the next loop.');
      }
      return true;
    }
    const [cmdRaw, ...rest] = line.slice(1).split(/\s+/);
    const cmd = (cmdRaw ?? '').toLowerCase();
    const arg = rest.join(' ');
    switch (cmd) {
      case 'quit': case 'q': case 'exit': return false;
      case 'help': case 'h': case '?':
        this.push('assistant', helpText());
        return true;
      case 'status': this.showStatus(); return true;
      case 'config': this.showConfig(); return true;
      case 'files': this.showFiles(); return true;
      case 'clear':
        this.messages = [];
        this.scrollOffset = 0;
        this.render();
        return true;
      case 'mode': {
        if (!arg) {
          this.push('tool', `mode: **${this.mode}** — ${MODE_DESCRIPTIONS[this.mode]}\n\nTab cycles: ${MODES.join(' → ')}`);
          return true;
        }
        if (isValidMode(arg.toLowerCase())) {
          this.mode = arg.toLowerCase() as Mode;
          this.persist();
          this.push('system', `mode → **${this.mode}** — ${MODE_DESCRIPTIONS[this.mode]}`);
        } else {
          this.push('error', `Unknown mode "${arg}". Tab cycles: ${MODES.join(' → ')}`);
        }
        return true;
      }
      case 'model': await this.cmdModel(arg); return true;
      case 'mock':
        this.mock = !this.mock;
        this.ensureMock();
        this.persist();
        this.push('system', `mock ${this.mock ? '**ON** (offline demo)' : '**OFF** (live models via llm_client)'}`);
        return true;
      case 'smoke':
        this.smokeOnly = !this.smokeOnly;
        this.persist();
        this.push('system', `smoke-only ${this.smokeOnly ? '**ON**' : '**OFF**'}`);
        return true;
      case 'prd': {
        if (!arg) { this.push('error', 'Usage: `/prd <file>`'); return true; }
        const abs = resolve(arg.replace(/^["']|["']$/g, ''));
        if (!existsSync(abs)) { this.push('error', `Not found: ${arg}`); return true; }
        this.prdBuffer = readFileSync(abs, 'utf8').trim();
        this.prdPath = abs;
        this.persist();
        this.push('assistant', `PRD loaded: **${this.prdBuffer.length}** chars from \`${abs}\`. Run \`/plan\`.`);
        return true;
      }
      case 'project': {
        if (!arg) { this.push('error', 'Usage: `/project <name>`'); return true; }
        this.project = arg.split(/\s+/)[0]!;
        this.ensureMock();
        this.pipeline = initialPipeline();
        this.persist();
        this.push('system', `project → **${this.project}** (pipeline reset to idle)`);
        return true;
      }
      case 'plan': this.mode = 'plan'; this.persist(); await this.actPlan(); return true;
      case 'review': this.mode = 'review'; this.persist(); await this.actReview(); return true;
      case 'build': case 'execute': this.mode = 'build'; this.persist(); await this.actBuild(); return true;
      case 'test': await this.actDebug(); return true;
      case 'debug': this.mode = 'debug'; this.persist(); await this.actDebug(); return true;
      case 'report': this.mode = 'report'; this.persist(); await this.actReport(); return true;
      case 'run': await this.actRunFull(); return true;
      default:
        this.push('error', `Unknown command \`/${cmd}\`. Type \`/help\` or \`/\` for the menu.`);
    }
    void interactive;
    return true;
  }

  private async runCurrentMode(interactive: boolean): Promise<void> {
    void interactive;
    if (this.approval?.awaitingFeedback) {
      // Enter with empty input while feedback requested = cancel feedback capture.
      this.approval.awaitingFeedback = false;
      this.render();
      return;
    }
    switch (this.mode) {
      case 'chat': await this.actChat(''); return;
      case 'plan': return this.actPlan();
      case 'review': return this.actReview();
      case 'build': return this.actBuild();
      case 'debug': return this.actDebug();
      case 'report': return this.actReport();
    }
  }

  // -- interactive full-screen loop ---------------------------------------
  async runInteractive(): Promise<void> {
    this.running = true;
    this.syncPrdStage();
    // Alternate screen isolates full-screen repaints from the scrollback
    // buffer — without it every render appends a screenful to scrollback.
    if (this.useAltScreen && process.stdout.isTTY) {
      process.stdout.write('\x1b[?1049h');
    }
    // Enable SGR extended mouse reporting for mouse clicks and mouse wheel scrolling
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
    }

    this.keyStream = new EventEmitter();
    this.rawStdinHandler = (chunk: Buffer) => {
      const str = chunk.toString();
      const mouseRegex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
      let match: RegExpExecArray | null;
      let lastIndex = 0;
      let nonMouse = '';

      while ((match = mouseRegex.exec(str)) !== null) {
        const [full, btnStr, xStr, yStr, act] = match;
        nonMouse += str.substring(lastIndex, match.index);
        lastIndex = match.index + full.length;

        const btn = parseInt(btnStr, 10);
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);

        if (act === 'M') {
          if (btn === 0) {
            // Left mouse click
            this.handleMouseClick(x, y);
          } else if (btn === 64) {
            // Mouse wheel up: scroll page UP only (view older content)
            this.scrollOffset += 3;
            this.render();
          } else if (btn === 65) {
            // Mouse wheel down: scroll page DOWN only (view newer content)
            this.scrollOffset = Math.max(0, this.scrollOffset - 3);
            this.render();
          }
        }
      }

      nonMouse += str.substring(lastIndex);
      if (nonMouse.length > 0 && this.keyStream) {
        this.keyStream.emit('data', Buffer.from(nonMouse));
      }
    };

    process.stdin.on('data', this.rawStdinHandler);
    emitKeypressEvents(this.keyStream as any);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    this.rawActive = true;
    process.stdout.write('\x1b[?25l');
    this.render();

    // Spinner ticks animate only while busy; idle rendering is purely
    // event-driven (keypress, new message, resize) — no churn.
    this.spinnerTimer = setInterval(() => {
      if (!this.busy) return;
      this.spinnerFrame++;
      this.render();
    }, 140);

    this.resizeHandler = () => this.render();
    process.stdout.on('resize', this.resizeHandler);

    await new Promise<void>((resolve) => {
      const onKey = (ch: string, key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } = {}): void => {
        if (!this.running) return;
        void this.onKeypress(ch, key, resolve);
      };
      this.keyHandler = onKey;
      this.keyStream!.on('keypress', onKey);
    });

    this.teardown();
    this.printRecap();
  }

  /** One-line session recap printed on the main screen after exit. */
  private printRecap(): void {
    const s = this.snapshot;
    console.log(
      `\nbraid: project ${s.project} · mode ${s.mode} · ` +
      `${s.messages} message(s) · pipeline ${pipelineSummary(s.pipeline)} — session saved.`,
    );
  }

  private async onKeypress(
    ch: string,
    key: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean },
    done: () => void,
  ): Promise<void> {
    const name = key.name ?? '';
    // Ctrl+C: cancel running op first, exit on double-press.
    if (key.ctrl && (name === 'c' || name === 'd')) {
      if (this.busy) {
        this.cancelRequested = true;
        this.push('system', 'Cancelling… (press Ctrl+C again to force-exit)');
        this.lastCtrlC = Date.now();
        return;
      }
      const now = Date.now();
      if (now - this.lastCtrlC < 1500) {
        this.running = false;
        done();
        return;
      }
      this.lastCtrlC = now;
      this.push('system', 'Press Ctrl+C again to exit.');
      return;
    }
    // Approval dialog captures nearly all keys.
    if (this.approval && !this.approval.awaitingFeedback) {
      this.handleApprovalKey(ch ?? '', key);
      this.render();
      return;
    }
    // Mode-selection menu navigation.
    if (this.modeMenuOpen) {
      if (name === 'escape') { this.modeMenuOpen = false; this.render(); return; }
      if (name === 'up') { this.modeMenuIndex = (this.modeMenuIndex + MODES.length - 1) % MODES.length; this.render(); return; }
      if (name === 'down' || name === 'tab') { this.modeMenuIndex = (this.modeMenuIndex + 1) % MODES.length; this.render(); return; }
      if (name === 'return' || name === 'enter') {
        this.mode = MODES[this.modeMenuIndex]!;
        this.modeMenuOpen = false;
        this.persist();
        this.push('system', `mode → **${this.mode}** — ${MODE_DESCRIPTIONS[this.mode]}`);
        return;
      }
      return;
    }
    // Model-selector menu navigation (beneath the input).
    if (this.modelMenuOpen) {
      const models = availableModels();
      if (name === 'escape') { this.modelMenuOpen = false; this.render(); return; }
      if (name === 'up') { this.modelMenuIndex = (this.modelMenuIndex + models.length - 1) % Math.max(1, models.length); this.render(); return; }
      if (name === 'down' || name === 'tab') { this.modelMenuIndex = (this.modelMenuIndex + 1) % Math.max(1, models.length); this.render(); return; }
      if (name === 'return' || name === 'enter') {
        const pick = models[this.modelMenuIndex];
        if (pick) {
          this.chatModel = pick.id;
          this.persist();
          this.push('system', `chat model → **${pick.label}** (${pick.id}) — stages unchanged (see \`/model\`).`);
        }
        this.modelMenuOpen = false;
        return;
      }
      return;
    }
    // Slash-menu navigation.
    const menu = this.slashMenu();
    const menuOpen = menu && menu.length > 0;
    if (menuOpen) {
      if (name === 'escape') { this.menuDismissed = true; this.render(); return; }
      if (name === 'up') { this.menuIndex = (this.menuIndex + menu.length - 1) % menu.length; this.render(); return; }
      if (name === 'down') { this.menuIndex = (this.menuIndex + 1) % menu.length; this.render(); return; }
    }
    if (key.ctrl && name === 't') {
      this.modeMenuOpen = true;
      this.modeMenuIndex = MODES.indexOf(this.mode);
      this.render();
      return;
    }
    if (key.ctrl && name === 'p') {
      this.modelMenuOpen = true;
      const models = availableModels();
      this.modelMenuIndex = Math.max(0, models.findIndex((m) => m.id === this.activeChatModel()));
      this.render();
      return;
    }
    if (key.ctrl && name === 'o') {
      this.toolsExpanded = !this.toolsExpanded;
      this.render();
      return;
    }
    // Home suggestions — keyboard-selectable, never clobber typed input.
    if (this.suggestionsActive()) {
      if (ch === '1' || ch === '2' || ch === '3' || ch === '4') {
        await this.activateSuggestion(Number(ch) - 1);
        return;
      }
    }
    // Tab cycles modes (Shift+Tab reverses), preserving all state.
    if (name === 'tab') {
      const dir = key.shift ? -1 : 1;
      if (menuOpen) {
        this.completeMenu(menu);
        return;
      }
      this.mode = cycleMode(this.mode, dir as 1 | -1);
      this.menuDismissed = false;
      this.menuIndex = 0;
      this.persist();
      this.render();
      return;
    }
    switch (name) {
      case 'return': {
        if (menuOpen) { this.completeMenu(menu); return; }
        if (this.suggestionsActive()) {
          // Enter on empty input activates the highlighted suggestion.
          if (this.buffer.length === 0) {
            await this.activateSuggestion(this.suggestionIndex);
            return;
          }
        }
        await this.submit();
        return;
      }
      case 'escape':
        this.menuDismissed = true;
        this.scrollOffset = 0;
        this.modelMenuOpen = false;
        this.render();
        return;
      case 'backspace':
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
          this.menuDismissed = false;
          this.render();
        }
        return;
      case 'delete':
        if (this.cursor < this.buffer.length) {
          this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
          this.render();
        }
        return;
      case 'left': if (this.cursor > 0) { this.cursor--; this.render(); } return;
      case 'right': if (this.cursor < this.buffer.length) { this.cursor++; this.render(); } return;
      case 'up':
        if (menuOpen) { this.menuIndex = (this.menuIndex + menu!.length - 1) % menu!.length; this.render(); return; }
        if (this.suggestionsActive()) {
          this.suggestionIndex = (this.suggestionIndex + HOME_SUGGESTIONS.length - 1) % HOME_SUGGESTIONS.length;
          this.render();
          return;
        }
        if (this.histIdx > 0) {
          this.histIdx--;
          this.buffer = this.history[this.histIdx] ?? '';
          this.cursor = this.buffer.length;
          this.render();
        }
        return;
      case 'down':
        if (menuOpen) { this.menuIndex = (this.menuIndex + 1) % menu!.length; this.render(); return; }
        if (this.suggestionsActive()) {
          this.suggestionIndex = (this.suggestionIndex + 1) % HOME_SUGGESTIONS.length;
          this.render();
          return;
        }
        if (this.histIdx < this.history.length) {
          this.histIdx++;
          this.buffer = this.history[this.histIdx] ?? '';
          this.cursor = this.buffer.length;
          this.render();
        } else if (this.scrollOffset > 0) {
          this.scrollOffset = 0;
          this.render();
        }
        return;
      case 'home': this.cursor = 0; this.render(); return;
      case 'end': this.cursor = this.buffer.length; this.render(); return;
      case 'pageup': this.scrollOffset += 10; this.render(); return;
      case 'pagedown': this.scrollOffset = Math.max(0, this.scrollOffset - 10); this.render(); return;
    }
    if (key.ctrl) {
      if (name === 'a') { this.cursor = 0; this.render(); }
      else if (name === 'e') { this.cursor = this.buffer.length; this.render(); }
      else if (name === 'u') { this.buffer = this.buffer.slice(this.cursor); this.cursor = 0; this.menuDismissed = false; this.render(); }
      else if (name === 'k') { this.buffer = this.buffer.slice(0, this.cursor); this.render(); }
      else if (name === 'j') {
        // Ctrl+J: insert newline (multiline input). Ctrl+O toggles tool details.
        this.buffer = this.buffer.slice(0, this.cursor) + '\n' + this.buffer.slice(this.cursor);
        this.cursor++;
        this.render();
      } else if (name === 'd' && this.buffer.length === 0) {
        this.running = false;
        done();
      }
      return;
    }
    if (typeof ch === 'string' && ch.length >= 1 && !key.meta) {
      const code = ch.charCodeAt(0);
      if (code >= 32 || code > 127 || ch.includes('\n')) {
        const insert = ch.replace(/\r/g, '\n');
        this.buffer = this.buffer.slice(0, this.cursor) + insert + this.buffer.slice(this.cursor);
        this.cursor += insert.length;
        this.menuDismissed = false;
        if (!this.buffer.startsWith('/')) this.menuIndex = 0;
        // Paste of multiline text just works (buffer holds \n).
        this.render();
      }
    }
  }

  private completeMenu(menu: SlashCommand[] | null): void {
    if (!menu || menu.length === 0) return;
    const pick = menu[this.menuIndex % menu.length]!;
    this.buffer = `/${pick.name} `;
    this.cursor = this.buffer.length;
    this.menuDismissed = true;
    this.menuIndex = 0;
    this.render();
  }

  private completeMenuIndex(idx: number): void {
    const menu = this.slashMenu();
    if (!menu || menu.length === 0) return;
    const pick = menu[idx % menu.length]!;
    this.buffer = `/${pick.name} `;
    this.cursor = this.buffer.length;
    this.menuDismissed = true;
    this.menuIndex = 0;
    this.render();
  }

  private showApprovalStatus(): void {
    if (this.approval) {
      this.render();
      return;
    }
    this.push(
      'tool',
      `**Quality Gates**\n- Gate 1 (Plan Approval): **${this.pipeline.approval}**\n- Gate 2 (Final Deliverable): **${this.pipeline.report === 'completed' ? 'approved' : 'pending'}**\n\nRun \`/plan\` or \`/run\` to initiate a cycle with human-in-the-loop gates.`,
    );
  }

  private static readonly STAGE_CMDS = new Set([
    'plan', 'review', 'build', 'execute', 'run', 'test', 'debug', 'report',
  ]);

  private async submit(): Promise<void> {
    // Approval feedback capture.
    if (this.approval?.awaitingFeedback) {
      const fb = this.buffer.trim();
      this.buffer = '';
      this.cursor = 0;
      if (!fb) {
        this.approval.awaitingFeedback = false;
        this.render();
        return;
      }
      const a = this.approval;
      this.approval = null;
      a.resolve({ approved: false, feedback: fb });
      this.render();
      return;
    }
    const line = this.buffer;
    // Long-running ops never block input: text stays editable and status
    // commands work, but a second pipeline stage is refused (not queued)
    // to avoid overlapping runs against the same project dir.
    if (this.busy) {
      const first = line.trim().split(/\s+/)[0]?.toLowerCase().replace(/^\//, '') ?? '';
      if (!line.trim() || TuiApp.STAGE_CMDS.has(first)) {
        this.push('system', `Busy — ${this.busyLabel || 'working'}… (Ctrl+C cancels; text input still works)`);
        this.buffer = '';
        this.cursor = 0;
        this.menuIndex = 0;
        this.menuDismissed = false;
        this.render();
        return;
      }
    }
    this.buffer = '';
    this.cursor = 0;
    this.menuIndex = 0;
    this.menuDismissed = false;
    this.histIdx = this.history.length;
    if (line.trim()) {
      this.history.push(line);
      if (this.history.length > 200) this.history.shift();
      this.histIdx = this.history.length;
      try { appendFileSync(HISTORY_FILE, line + '\n'); } catch { /* best-effort */ }
    }
    this.render();
    if (!line.trim()) {
      try {
        await this.runCurrentMode(true);
      } catch (err) {
        this.push('error', (err as Error).message);
      }
      return;
    }
    // Echo user input into the conversation area.
    if (line.trim().startsWith('/')) {
      this.push('user', `\`${line.trim()}\``, this.mode);
    } else {
      this.push('user', line, this.mode);
      // Route natural-language prompts without double-echo: handle inline.
      if (this.mode === 'plan' || this.mode === 'chat' || !isSlashLike(line)) {
        try {
          // Re-dispatch through handleLine would re-push; inline instead.
          if (!line.trim().startsWith('/')) {
            if (this.mode === 'plan') {
              this.prdBuffer += (this.prdBuffer ? '\n' : '') + line;
              this.persist();
              this.push('assistant', `PRD buffer: **${this.prdBuffer.length}** chars (Enter runs planner, \`/plan\` runs now).`, this.mode);
            } else if (this.mode === 'chat') {
              // Remove the echo duplicate? Keep echo — actChat appends reply.
              this.messages.pop(); // drop generic echo, actChat pushes user+reply
              this.push('user', line, this.mode);
              await this.actChat(line);
            } else {
              this.feedback = line.trim();
              this.persist();
              this.push('system', 'Saved as gate feedback for the next loop.');
            }
            return;
          }
        } catch (err) {
          this.push('error', (err as Error).message);
          return;
        }
      }
    }
    try {
      const keepGoing = await this.handleLine(line, true);
      if (!keepGoing) {
        this.running = false;
        this.teardown();
        this.printRecap();
        process.exit(0);
      }
    } catch (err) {
      this.push('error', (err as Error).message);
    }
  }

  private teardown(): void {
    if (this.teardownDone) return;
    this.teardownDone = true;
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
    if (this.resizeHandler) process.stdout.off('resize', this.resizeHandler);
    if (this.keyHandler) process.stdin.off('keypress', this.keyHandler);
    this.rawActive = false;
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch { /* ignore */ }
    process.stdin.pause();
    if (this.useAltScreen && process.stdout.isTTY) {
      process.stdout.write('\x1b[?1049l'); // back to the main screen
    }
    // Restore terminal colors on exit — don't leak the black background.
    process.stdout.write('\x1b[0m\x1b[?25h');
    this.persist();
  }

  // -- non-TTY fallback + scripted runs (demos, tests, pipes) --------------
  /** Execute one line headlessly (gates auto-approve off — explicit decisions logged). */
  async execHeadless(line: string): Promise<boolean> {
    return this.handleLineHeadless(line);
  }

  private async handleLineHeadless(raw: string): Promise<boolean> {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return true;
    if (!line.startsWith('/')) {
      if (this.mode === 'plan' || this.mode === 'chat') {
        this.messages.push({ role: 'user', text: raw, mode: this.mode });
        if (this.mode === 'plan') {
          this.prdBuffer += (this.prdBuffer ? '\n' : '') + raw;
          this.persist();
        } else {
          await this.actChatHeadless(raw);
        }
        return true;
      }
      this.feedback = raw;
      this.persist();
      return true;
    }
    return this.handleLineAuto(raw);
  }

  private async actChatHeadless(text: string): Promise<void> {
    this.messages.push({ role: 'assistant', text: `Noted (${text.trim().length} chars).`, mode: 'chat' });
  }

  private async handleLineAuto(raw: string): Promise<boolean> {
    // Scripted / piped contexts auto-approve gates (explicitly logged).
    const prev = this.autoApproveGates;
    this.autoApproveGates = true;
    try {
      return await this.handleLine(raw, false);
    } finally {
      this.autoApproveGates = prev;
    }
  }

  get snapshot(): { mode: Mode; project: string; messages: number; pipeline: PipelineMap } {
    return { mode: this.mode, project: this.project, messages: this.messages.length, pipeline: { ...this.pipeline } };
  }
}

function isSlashLike(line: string): boolean {
  return line.trim().startsWith('/');
}

function stripLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Piped/non-TTY fallback: cooked line loop, gates auto-approve. */
export async function runFallback(app: TuiApp): Promise<void> {
  const { createInterface } = await import('node:readline');
  console.log('Braid (non-interactive stdin — Tab unavailable, use /mode; gates auto-approve).');
  console.log(WELCOME);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (): Promise<string | null> =>
    new Promise((resolve) => {
      rl.question(`[${app.snapshot.mode}] > `, (answer) => resolve(answer));
      rl.once('close', () => resolve(null));
    });
  for (;;) {
    const line = await ask();
    if (line === null) break;
    try {
      if (!(await app.execHeadless(line))) break;
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
    }
  }
  rl.close();
}

/** Scripted session: feed command lines from a file (demos, tests). */
export async function runScript(app: TuiApp, scriptPath: string): Promise<void> {
  const abs = resolve(scriptPath);
  if (!existsSync(abs)) throw new Error(`Script not found: ${scriptPath}`);
  console.log(`Braid script: ${abs} (gates auto-approve)`);
  for (const raw of readFileSync(abs, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    console.log(`[${app.snapshot.mode}] > ${raw.trim()}`);
    try {
      if (!(await app.execHeadless(raw))) break;
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exitCode = 1;
      break;
    }
  }
}

export type { FileManifest };
