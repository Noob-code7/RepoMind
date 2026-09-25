import React, { useState } from 'react';
import { BraidMark } from './BraidMark.js';
import { STATE_MOTION_CONFIGS } from './dna_geometry.js';
import { BRAID_COLORS } from './theme.js';
import { BRAID_ANIMATION_STATES, BraidAnimationState } from './types.js';

export const BraidAnimation: React.FC = () => {
  const [activeState, setActiveState] = useState<BraidAnimationState>('build');
  const [size, setSize] = useState<number>(80);
  const [speed, setSpeed] = useState<number>(1.0);
  const [monochrome, setMonochrome] = useState<boolean>(false);

  const cfg = STATE_MOTION_CONFIGS[activeState];

  return (
    <div
      className="p-8 rounded-2xl border max-w-2xl mx-auto shadow-2xl"
      style={{
        backgroundColor: BRAID_COLORS.bgSurface,
        borderColor: BRAID_COLORS.borderMedium,
      }}
    >
      <div className="flex items-center justify-between border-b pb-4 mb-6" style={{ borderColor: BRAID_COLORS.borderSubtle }}>
        <div>
          <h3 className="text-base font-semibold tracking-tight" style={{ color: BRAID_COLORS.textPrimary }}>
            Braid Motion System
          </h3>
          <p className="text-xs mt-0.5" style={{ color: BRAID_COLORS.textSecondary }}>
            Two continuous interwoven DNA strands converging into one verified codebase.
          </p>
        </div>
        <span
          className="text-[11px] font-mono font-medium px-2 py-1 rounded border"
          style={{
            backgroundColor: BRAID_COLORS.bgElevated,
            borderColor: BRAID_COLORS.borderSubtle,
            color: BRAID_COLORS.accentPeach,
          }}
        >
          60 FPS VECTOR MOTION
        </span>
      </div>

      {/* Visual Canvas Stage */}
      <div
        className="h-56 rounded-xl flex flex-col items-center justify-center relative overflow-hidden border mb-6"
        style={{
          backgroundColor: BRAID_COLORS.bgDark,
          borderColor: BRAID_COLORS.borderSubtle,
        }}
      >
        <BraidMark
          size={size}
          state={activeState}
          speed={speed}
          monochrome={monochrome}
        />

        <div className="absolute bottom-3 text-center">
          <span className="font-mono text-xs font-semibold uppercase tracking-widest" style={{ color: BRAID_COLORS.textPrimary }}>
            {activeState}
          </span>
          <p className="text-[11px] font-sans mt-0.5 max-w-sm mx-auto px-4" style={{ color: BRAID_COLORS.textSecondary }}>
            {cfg.semanticMeaning}
          </p>
        </div>
      </div>

      {/* State Switcher Pills */}
      <div className="space-y-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider mb-2" style={{ color: BRAID_COLORS.textMuted }}>
            Animation States (7)
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
            {BRAID_ANIMATION_STATES.map((st) => {
              const isActive = activeState === st;
              return (
                <button
                  key={st}
                  type="button"
                  id={`btn-state-${st}`}
                  onClick={() => setActiveState(st)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all text-center"
                  style={{
                    backgroundColor: isActive ? BRAID_COLORS.bgSubtle : BRAID_COLORS.bgElevated,
                    borderColor: isActive ? BRAID_COLORS.accentPeach : BRAID_COLORS.borderSubtle,
                    color: isActive ? BRAID_COLORS.textPrimary : BRAID_COLORS.textSecondary,
                  }}
                >
                  {st}
                </button>
              );
            })}
          </div>
        </div>

        {/* Speed & Mode Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t" style={{ borderColor: BRAID_COLORS.borderSubtle }}>
          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1">
              Mark Size: <span style={{ color: BRAID_COLORS.accentPeach }}>{size}px</span>
            </label>
            <input
              type="range"
              min="24"
              max="140"
              step="4"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full accent-[#f09d79]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono text-slate-400 mb-1">
              Cadence / Speed: <span style={{ color: BRAID_COLORS.accentPeach }}>{speed.toFixed(1)}x</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full accent-[#f09d79]"
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setMonochrome((m) => !m)}
              className="w-full py-1.5 px-3 rounded-lg border text-xs font-mono transition"
              style={{
                backgroundColor: monochrome ? BRAID_COLORS.bgSubtle : BRAID_COLORS.bgElevated,
                borderColor: monochrome ? BRAID_COLORS.textPrimary : BRAID_COLORS.borderSubtle,
                color: monochrome ? BRAID_COLORS.textPrimary : BRAID_COLORS.textSecondary,
              }}
            >
              {monochrome ? 'Monochrome (Ivory)' : 'Two-Tone (Ivory + Peach)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
