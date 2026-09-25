import React from 'react';
import { BraidMark } from './BraidMark.js';
import { STATE_MOTION_CONFIGS } from './dna_geometry.js';
import { BRAID_COLORS } from './theme.js';
import { BraidLoaderProps } from './types.js';

export const BraidLoader: React.FC<BraidLoaderProps> = ({
  state = 'build',
  size = 28,
  label,
  sublabel,
  progress,
  className = '',
}) => {
  const defaultLabel =
    state === 'planning'
      ? 'Analyzing repository & planning build...'
      : state === 'review'
      ? 'Reviewing plan with independent architect model...'
      : state === 'build'
      ? 'Synthesizing verified multi-file codebase...'
      : state === 'verify'
      ? 'Executing deterministic verification harness...'
      : state === 'success'
      ? 'Build verified & complete'
      : state === 'error'
      ? 'Build interrupted'
      : 'Ready';

  const displayLabel = label || defaultLabel;

  return (
    <div
      className={`inline-flex items-center gap-3.5 px-3 py-2 rounded-lg bg-[${BRAID_COLORS.bgSurface}] border border-[${BRAID_COLORS.borderSubtle}] ${className}`}
      style={{
        backgroundColor: BRAID_COLORS.bgSurface,
        borderColor: BRAID_COLORS.borderSubtle,
      }}
    >
      <BraidMark size={size} state={state} />

      <div className="flex flex-col text-left">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-medium tracking-tight font-sans"
            style={{ color: BRAID_COLORS.textPrimary }}
          >
            {displayLabel}
          </span>
          {typeof progress === 'number' && (
            <span
              className="text-[11px] font-mono font-semibold"
              style={{ color: BRAID_COLORS.accentPeach }}
            >
              {Math.round(progress)}%
            </span>
          )}
        </div>

        {sublabel && (
          <span
            className="text-[11px] font-mono tracking-tight mt-0.5"
            style={{ color: BRAID_COLORS.textSecondary }}
          >
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
};
