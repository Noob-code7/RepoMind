/**
 * brand/cli_mark.ts
 * Compact, terminal-friendly ASCII/Unicode DNA helix motion engine for Braid CLI.
 * Renders crisp flowing strands in terminal stdout at 16–32px with ANSI colors.
 */
import { BraidAnimationState } from './types.js';

// ANSI 24-bit TrueColor sequences for Braid palette
export const ANSI_IVORY = '\x1b[38;2;245;244;239m';
export const ANSI_PEACH = '\x1b[38;2;240;157;121m';
export const ANSI_MUTED = '\x1b[38;2;165;163;157m';
export const ANSI_FAINT = '\x1b[38;2;90;88;84m';
export const ANSI_SAGE = '\x1b[38;2;121;184;143m';
export const ANSI_RUST = '\x1b[38;2;217;108;92m';
export const ANSI_BOLD = '\x1b[1m';
export const ANSI_RESET = '\x1b[0m';

/**
 * 6-line high-resolution DNA helix animation frames.
 * The strands continuously travel and weave through each other.
 */
export const DNA_FRAMES = [
  // Frame 0: Crossing node center
  [
    `     ${ANSI_IVORY}╭╮${ANSI_RESET}`,
    `    ${ANSI_PEACH}╱${ANSI_RESET}  ${ANSI_IVORY}╲${ANSI_RESET}`,
    `    ${ANSI_IVORY}╲${ANSI_RESET}  ${ANSI_PEACH}╱${ANSI_RESET}`,
    `     ${ANSI_PEACH}╳${ANSI_RESET}`,
    `    ${ANSI_PEACH}╱${ANSI_RESET}  ${ANSI_IVORY}╲${ANSI_RESET}`,
    `    ${ANSI_IVORY}╲${ANSI_RESET}  ${ANSI_PEACH}╱${ANSI_RESET}`,
    `     ${ANSI_IVORY}╰╯${ANSI_RESET}`,
  ],
  // Frame 1: Wave traveling downward
  [
    `    ${ANSI_IVORY}╭──╮${ANSI_RESET}`,
    `   ${ANSI_PEACH}╱${ANSI_RESET}    ${ANSI_IVORY}╲${ANSI_RESET}`,
    `   ${ANSI_IVORY}╲${ANSI_RESET}    ${ANSI_PEACH}╱${ANSI_RESET}`,
    `    ${ANSI_IVORY}╲${ANSI_RESET}  ${ANSI_PEACH}╱${ANSI_RESET}`,
    `     ${ANSI_PEACH}╳${ANSI_RESET}`,
    `    ${ANSI_PEACH}╱${ANSI_RESET}  ${ANSI_IVORY}╲${ANSI_RESET}`,
    `    ${ANSI_IVORY}╰──╯${ANSI_RESET}`,
  ],
  // Frame 2: Maximum strand separation (Planning state)
  [
    `   ${ANSI_PEACH}╱${ANSI_RESET}      ${ANSI_IVORY}╲${ANSI_RESET}`,
    `  ${ANSI_PEACH}│${ANSI_RESET}        ${ANSI_IVORY}│${ANSI_RESET}`,
    `   ${ANSI_PEACH}╲${ANSI_RESET}      ${ANSI_IVORY}╱${ANSI_RESET}`,
    `    ${ANSI_PEACH}╲${ANSI_RESET}    ${ANSI_IVORY}╱${ANSI_RESET}`,
    `     ${ANSI_IVORY}╲${ANSI_RESET}  ${ANSI_PEACH}╱${ANSI_RESET}`,
    `      ${ANSI_IVORY}╳${ANSI_RESET}`,
    `     ${ANSI_IVORY}╱${ANSI_RESET}  ${ANSI_PEACH}╲${ANSI_RESET}`,
  ],
  // Frame 3: Inverted crossing
  [
    `     ${ANSI_PEACH}╭╮${ANSI_RESET}`,
    `    ${ANSI_IVORY}╱${ANSI_RESET}  ${ANSI_PEACH}╲${ANSI_RESET}`,
    `    ${ANSI_PEACH}╲${ANSI_RESET}  ${ANSI_IVORY}╱${ANSI_RESET}`,
    `     ${ANSI_IVORY}╳${ANSI_RESET}`,
    `    ${ANSI_IVORY}╱${ANSI_RESET}  ${ANSI_PEACH}╲${ANSI_RESET}`,
    `    ${ANSI_PEACH}╲${ANSI_RESET}  ${ANSI_IVORY}╱${ANSI_RESET}`,
    `     ${ANSI_PEACH}╰╯${ANSI_RESET}`,
  ],
  // Frame 4: Second wave pulse
  [
    `    ${ANSI_PEACH}╭──╮${ANSI_RESET}`,
    `   ${ANSI_IVORY}╱${ANSI_RESET}    ${ANSI_PEACH}╲${ANSI_RESET}`,
    `   ${ANSI_PEACH}╲${ANSI_RESET}    ${ANSI_IVORY}╱${ANSI_RESET}`,
    `    ${ANSI_PEACH}╲${ANSI_RESET}  ${ANSI_IVORY}╱${ANSI_RESET}`,
    `     ${ANSI_IVORY}╳${ANSI_RESET}`,
    `    ${ANSI_IVORY}╱${ANSI_RESET}  ${ANSI_PEACH}╲${ANSI_RESET}`,
    `    ${ANSI_PEACH}╰──╯${ANSI_RESET}`,
  ],
  // Frame 5: Symmetric completion mark (Success state)
  [
    `     ${ANSI_IVORY}╭╮${ANSI_RESET}`,
    `    ${ANSI_IVORY}╱  ╲${ANSI_RESET}`,
    `    ${ANSI_IVORY}╲  ╱${ANSI_RESET}`,
    `     ${ANSI_PEACH}╳${ANSI_RESET}`,
    `    ${ANSI_IVORY}╱  ╲${ANSI_RESET}`,
    `    ${ANSI_IVORY}╲  ╱${ANSI_RESET}`,
    `     ${ANSI_IVORY}╰╯${ANSI_RESET}`,
  ],
];

/**
 * Compact inline 1-line DNA glyph for tight log streams.
 */
export const COMPACT_INLINE_FRAMES = [
  `${ANSI_PEACH}∿${ANSI_IVORY}≀${ANSI_PEACH}∿${ANSI_RESET}`,
  `${ANSI_IVORY}≀${ANSI_PEACH}╳${ANSI_IVORY}≀${ANSI_RESET}`,
  `${ANSI_PEACH}∿${ANSI_IVORY}≀${ANSI_PEACH}∿${ANSI_RESET}`,
  `${ANSI_IVORY}╳${ANSI_PEACH}∿${ANSI_IVORY}╳${ANSI_RESET}`,
];

/**
 * Get ASCII DNA frame by index.
 */
export function getDnaHelixFrame(frameIdx: number, state: BraidAnimationState = 'build'): string[] {
  if (state === 'success') {
    return DNA_FRAMES[5];
  }
  const idx = Math.abs(frameIdx) % (DNA_FRAMES.length - 1);
  return DNA_FRAMES[idx];
}

/**
 * Render the full Braid terminal banner with flowing DNA and progress bar.
 */
export function renderCliBanner(
  frameIdx: number,
  state: BraidAnimationState,
  statusMessage: string,
  progress = 0,
): string {
  const frame = getDnaHelixFrame(frameIdx, state);
  const totalBars = 20;
  const filledBars = Math.round((Math.max(0, Math.min(100, progress)) / 100) * totalBars);
  const emptyBars = totalBars - filledBars;

  const barStr = `${ANSI_PEACH}${'█'.repeat(filledBars)}${ANSI_FAINT}${'░'.repeat(emptyBars)}${ANSI_RESET} ${ANSI_BOLD}${Math.round(progress)}%${ANSI_RESET}`;

  return [
    '',
    ...frame,
    '',
    `  ${ANSI_BOLD}${ANSI_IVORY}Braid${ANSI_RESET} ${ANSI_MUTED}v0.1.0${ANSI_RESET}`,
    `  ${ANSI_PEACH}State:${ANSI_RESET} ${ANSI_IVORY}${state.toUpperCase()}${ANSI_RESET}`,
    '',
    `  ${ANSI_IVORY}${statusMessage}${ANSI_RESET}`,
    progress > 0 ? `  ${barStr}` : '',
    '',
  ].filter(Boolean).join('\n');
}

export interface CliTicker {
  update(statusMessage: string, progress?: number): void;
  stop(successMessage?: string): void;
}

/**
 * Start an animated terminal ticker for the given state.
 * Returns controller with update and stop methods.
 */
export function startCliAnimation(
  initialState: BraidAnimationState = 'build',
  initialMessage = 'Braid is working...',
): CliTicker {
  let frame = 0;
  let currentState = initialState;
  let currentMsg = initialMessage;
  let currentProgress = 0;
  let lineCount = 0;

  function render() {
    const output = renderCliBanner(frame, currentState, currentMsg, currentProgress);
    const lines = output.split('\n');

    // Clear previous lines if any
    if (lineCount > 0 && process.stdout.isTTY) {
      process.stdout.write(`\x1b[${lineCount}A\x1b[0J`);
    }

    process.stdout.write(output + '\n');
    lineCount = lines.length + 1;
    frame++;
  }

  // Initial draw
  render();

  const interval = setInterval(() => {
    render();
  }, 180);

  return {
    update(statusMessage: string, progress?: number) {
      currentMsg = statusMessage;
      if (typeof progress === 'number') currentProgress = progress;
    },
    stop(successMessage?: string) {
      clearInterval(interval);
      currentState = 'success';
      if (successMessage) currentMsg = successMessage;
      render();
    },
  };
}
