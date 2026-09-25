/**
 * brand/types.ts
 * TypeScript interfaces and state types for the Braid visual motion system.
 */

export const BRAID_ANIMATION_STATES = [
  'idle',
  'planning',
  'review',
  'build',
  'verify',
  'success',
  'error',
] as const;

export type BraidAnimationState = (typeof BRAID_ANIMATION_STATES)[number];

export interface BraidMarkProps {
  /** Size in pixels (supports standard 16, 24, 32, 48, 64, 128, 256 or arbitrary number) */
  size?: number;
  /** Current pipeline or motion state */
  state?: BraidAnimationState;
  /** Primary strand color (defaults to warm off-white #f5f4ef) */
  primaryColor?: string;
  /** Secondary strand / accent color (defaults to subtle warm peach #f09d79 or matched ivory) */
  accentColor?: string;
  /** Speed multiplier (default: 1.0) */
  speed?: number;
  /** Monochromatic mode: renders both strands in primaryColor */
  monochrome?: boolean;
  /** Force disable animation (e.g. for print or static icons) */
  staticOnly?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Accessible label */
  ariaLabel?: string;
}

export interface BraidLoaderProps {
  state?: BraidAnimationState;
  size?: number;
  label?: string;
  sublabel?: string;
  progress?: number;
  className?: string;
}

export interface BraidStatusProps {
  state: BraidAnimationState;
  size?: number;
  label?: string;
  detail?: string;
  showMark?: boolean;
  className?: string;
}

export interface StateMotionConfig {
  /** Oscillation speed in seconds per full cycle */
  periodSeconds: number;
  /** Horizontal separation / amplitude multiplier */
  amplitude: number;
  /** Separation distance between the two strands' centers */
  separation: number;
  /** Vertical weave wavelength */
  wavelength: number;
  /** Asymmetry / strand divergence factor (0 = symmetric, >0 = independent flow) */
  divergence: number;
  /** Damping / settling factor (1 = active flow, 0 = settled static mark) */
  flowEnergy: number;
  /** Subtle stroke width breathing */
  strokeWidth: number;
  /** Description of what this state communicates */
  semanticMeaning: string;
}
