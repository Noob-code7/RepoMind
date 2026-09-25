import React from 'react';
import { BraidMark } from './BraidMark.js';
import { STATE_MOTION_CONFIGS } from './dna_geometry.js';
import { BRAID_COLORS } from './theme.js';
import { BraidStatusProps } from './types.js';

export const BraidStatus: React.FC<BraidStatusProps> = ({
  state,
  size = 20,
  label,
  detail,
  showMark = true,
  className = '',
}) => {
  const cfg = STATE_MOTION_CONFIGS[state];
  const statusColor =
    state === 'success'
      ? BRAID_COLORS.successSage
      : state === 'error'
      ? BRAID_COLORS.errorTerracotta
      : state === 'build' || state === 'review'
      ? BRAID_COLORS.accentPeach
      : BRAID_COLORS.textPrimary;

  return (
    <div
      className={`inline-flex items-center gap-2.5 px-2.5 py-1.5 rounded-md border text-xs font-sans ${className}`}
      style={{
        backgroundColor: BRAID_COLORS.bgElevated,
        borderColor: BRAID_COLORS.borderSubtle,
      }}
    >
      {showMark && (
        <BraidMark
          size={size}
          state={state}
          primaryColor={statusColor}
          accentColor={statusColor}
        />
      )}

      <div className="flex items-center gap-2">
        <span
          className="font-mono text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: statusColor }}
        >
          {label || state}
        </span>

        {detail && (
          <span
            className="text-[11px] tracking-tight border-l pl-2"
            style={{
              color: BRAID_COLORS.textSecondary,
              borderColor: BRAID_COLORS.borderSubtle,
            }}
          >
            {detail}
          </span>
        )}
      </div>
    </div>
  );
};
