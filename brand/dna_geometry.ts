/**
 * brand/dna_geometry.ts
 * Pure mathematical vector geometry engine for the Braid DNA/helix mark.
 * Generates smooth SVG cubic Bezier path definitions dynamically for any time t and state.
 * NO raster images, zero dependencies, crisp at any scale.
 */
import { BraidAnimationState, StateMotionConfig } from './types.js';

export const STATE_MOTION_CONFIGS: Record<BraidAnimationState, StateMotionConfig> = {
  idle: {
    periodSeconds: 4.2,
    amplitude: 13,
    separation: 0,
    wavelength: 0.052,
    divergence: 0.0,
    flowEnergy: 0.25,
    strokeWidth: 3.2,
    semanticMeaning: 'Subtle slow breathing motion — waiting calmly for input.',
  },
  planning: {
    periodSeconds: 2.8,
    amplitude: 15,
    separation: 5.5,
    wavelength: 0.048,
    divergence: 0.35,
    flowEnergy: 0.65,
    strokeWidth: 3.4,
    semanticMeaning: 'Strands separate slightly and flow independently — exploring architecture.',
  },
  review: {
    periodSeconds: 1.8,
    amplitude: 16,
    separation: 1.0,
    wavelength: 0.058,
    divergence: 0.15,
    flowEnergy: 0.85,
    strokeWidth: 3.5,
    semanticMeaning: 'Strands weave tightly at higher cadence — adversarial review in progress.',
  },
  build: {
    periodSeconds: 1.2,
    amplitude: 18,
    separation: 0,
    wavelength: 0.065,
    divergence: 0.05,
    flowEnergy: 1.0,
    strokeWidth: 3.6,
    semanticMeaning: 'Continuous flowing DNA/helix motion — two-pass execution engine active.',
  },
  verify: {
    periodSeconds: 2.2,
    amplitude: 14,
    separation: 0,
    wavelength: 0.055,
    divergence: 0.0,
    flowEnergy: 0.45,
    strokeWidth: 3.3,
    semanticMeaning: 'Controlled harmonic damping — running deterministic test verification.',
  },
  success: {
    periodSeconds: 8.0,
    amplitude: 15,
    separation: 0,
    wavelength: 0.052,
    divergence: 0.0,
    flowEnergy: 0.0, // Settled into iconic static mark
    strokeWidth: 3.5,
    semanticMeaning: 'Motion settles smoothly into the locked verified mark.',
  },
  error: {
    periodSeconds: 1.4,
    amplitude: 19,
    separation: 12.0,
    wavelength: 0.045,
    divergence: 0.8,
    flowEnergy: 0.9,
    strokeWidth: 3.2,
    semanticMeaning: 'One strand decouples outward, indicating an unhandled fault.',
  },
};

export interface StrandPoint {
  x: number;
  y: number;
}

export interface BraidStrandsPaths {
  strandA: string;
  strandB: string;
  crossNodes: Array<{ x: number; y: number; opacity: number }>;
  strokeWidth: number;
}

/**
 * Generate cubic bezier SVG path strings for Strand A and Strand B at a given time offset.
 *
 * @param t Time in seconds (e.g. performance.now() / 1000)
 * @param state Active animation state
 * @param speed Speed multiplier
 */
export function computeBraidGeometry(
  t: number,
  state: BraidAnimationState = 'idle',
  speed = 1.0,
): BraidStrandsPaths {
  const cfg = STATE_MOTION_CONFIGS[state];
  const omega = cfg.flowEnergy > 0 ? ((2 * Math.PI) / cfg.periodSeconds) * speed : 0;
  const phase = t * omega;

  // Key height milestones from y=16 to y=84
  const yStart = 16;
  const yEnd = 84;
  const steps = 6;
  const stepY = (yEnd - yStart) / steps;

  const pointsA: StrandPoint[] = [];
  const pointsB: StrandPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const y = yStart + i * stepY;
    const normY = y - 50; // -34 to +34

    // End caps gently taper towards center
    const capTaper = Math.cos((normY / 38) * (Math.PI / 2));
    const currentAmp = cfg.amplitude * Math.max(0.2, capTaper);

    const wavePhaseA = normY * cfg.wavelength + phase;
    const wavePhaseB = normY * cfg.wavelength + phase + Math.PI + cfg.divergence;

    const xA = 50 + currentAmp * Math.sin(wavePhaseA) - cfg.separation;
    const xB = 50 + currentAmp * Math.sin(wavePhaseB) + cfg.separation;

    pointsA.push({ x: Number(xA.toFixed(2)), y });
    pointsB.push({ x: Number(xB.toFixed(2)), y });
  }

  const strandA = pointsToSmoothPath(pointsA);
  const strandB = pointsToSmoothPath(pointsB);

  // Calculate nodal intersection points for subtle review/build accents
  const crossNodes: Array<{ x: number; y: number; opacity: number }> = [];
  if (state === 'review' || state === 'build') {
    for (let i = 1; i < steps; i++) {
      const pA = pointsA[i];
      const pB = pointsB[i];
      const dist = Math.abs(pA.x - pB.x);
      if (dist < 3.5) {
        crossNodes.push({
          x: Number(((pA.x + pB.x) / 2).toFixed(2)),
          y: pA.y,
          opacity: Math.max(0, 1 - dist / 3.5),
        });
      }
    }
  }

  return {
    strandA,
    strandB,
    crossNodes,
    strokeWidth: cfg.strokeWidth,
  };
}

/**
 * Convert an array of 2D control points into a continuous, smooth SVG cubic Bezier path.
 */
function pointsToSmoothPath(points: StrandPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    // Catmull-Rom to Cubic Bezier conversion
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return d;
}
