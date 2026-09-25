import React, { useEffect, useRef, useState } from 'react';
import { computeBraidGeometry } from './dna_geometry.js';
import { BRAID_COLORS } from './theme.js';
import { BraidMarkProps } from './types.js';

export const BraidMark: React.FC<BraidMarkProps> = ({
  size = 48,
  state = 'idle',
  primaryColor = BRAID_COLORS.textPrimary,
  accentColor = BRAID_COLORS.accentPeach,
  speed = 1.0,
  monochrome = false,
  staticOnly = false,
  className = '',
  ariaLabel = `Braid Mark (${state})`,
}) => {
  const [paths, setPaths] = useState(() => computeBraidGeometry(0, state, speed));
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const animFrameRef = useRef<number | null>(null);

  // Check prefers-reduced-motion media query
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(media.matches);

    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  // Continuous 60fps flowing wave animation loop (strand deformation, not spinner rotation)
  useEffect(() => {
    if (staticOnly || prefersReducedMotion || state === 'success') {
      setPaths(computeBraidGeometry(0, state, speed));
      return;
    }

    const startTime = performance.now();

    const loop = (now: number) => {
      const elapsed = (now - startTime) / 1000;
      setPaths(computeBraidGeometry(elapsed, state, speed));
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [state, speed, staticOnly, prefersReducedMotion]);

  const colorA = primaryColor;
  const colorB = monochrome ? primaryColor : accentColor;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`braid-mark transition-colors duration-300 ${className}`}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <defs>
        {/* Subtle endcap soft falloff */}
        <linearGradient id={`braid-gradA-${state}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={colorA} stopOpacity="0.4" />
          <stop offset="25%" stopColor={colorA} stopOpacity="1.0" />
          <stop offset="75%" stopColor={colorA} stopOpacity="1.0" />
          <stop offset="100%" stopColor={colorA} stopOpacity="0.4" />
        </linearGradient>

        <linearGradient id={`braid-gradB-${state}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={colorB} stopOpacity="0.35" />
          <stop offset="25%" stopColor={colorB} stopOpacity="0.95" />
          <stop offset="75%" stopColor={colorB} stopOpacity="0.95" />
          <stop offset="100%" stopColor={colorB} stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* Strand B (Secondary / Under-weave thread) */}
      <path
        d={paths.strandB}
        fill="none"
        stroke={`url(#braid-gradB-${state})`}
        strokeWidth={paths.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={state === 'error' ? 0.7 : 0.9}
      />

      {/* Strand A (Primary / Over-weave thread) */}
      <path
        d={paths.strandA}
        fill="none"
        stroke={`url(#braid-gradA-${state})`}
        strokeWidth={paths.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={1.0}
      />

      {/* Micro Crossing Nodes (active in review & build states) */}
      {paths.crossNodes.map((node, i) => (
        <circle
          key={i}
          cx={node.x}
          cy={node.y}
          r={1.2}
          fill={accentColor}
          opacity={node.opacity * 0.75}
        />
      ))}
    </svg>
  );
};
