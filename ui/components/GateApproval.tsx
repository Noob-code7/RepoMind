import React, { useState } from 'react';
import { PlanOutput, ReviewOutput } from '../../shared/types.js';

interface GateApprovalProps {
  gateType: 'REVIEW' | 'REPORT';
  plan?: PlanOutput | null;
  review?: ReviewOutput | null;
  onApprove: () => void;
  onReject: (feedback: string) => void;
}

export const GateApproval: React.FC<GateApprovalProps> = ({
  gateType,
  plan,
  review,
  onApprove,
  onReject,
}) => {
  const [feedback, setFeedback] = useState('');
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);

  const handleRejectClick = () => {
    if (!showFeedbackInput) {
      setShowFeedbackInput(true);
      return;
    }
    if (!feedback.trim()) return;
    onReject(feedback.trim());
  };

  const riskScore = review?.riskScore ?? 0;
  const riskColor =
    riskScore < 0.25
      ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
      : riskScore < 0.6
      ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
      : 'text-rose-400 border-rose-500/30 bg-rose-500/10';

  return (
    <div className="card p-6 bg-slate-900 border border-indigo-500/30 rounded-xl shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {gateType === 'REVIEW' ? 'Gate 1: Pre-Execution Plan Approval' : 'Gate 2: Post-Report Satisfaction Gate'}
          </span>
          <h3 className="text-xl font-bold text-white mt-2">
            Human-in-the-Loop Governance Checkpoint
          </h3>
        </div>

        {gateType === 'REVIEW' && review && (
          <div className={`px-3 py-1.5 rounded-lg border font-mono text-xs flex items-center gap-2 ${riskColor}`}>
            <span>Risk Score:</span>
            <span className="font-bold">{(riskScore * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>

      {gateType === 'REVIEW' && plan && (
        <div className="space-y-4 mb-6 text-sm">
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Planned Manifest ({plan.manifest.files.length} files)
            </h4>
            <div className="max-h-40 overflow-y-auto space-y-1 text-xs font-mono">
              {plan.manifest.files.map((f) => (
                <div key={f.path} className="flex items-center justify-between text-slate-300">
                  <span className="text-cyan-400">{f.path}</span>
                  <span className="text-slate-500">{f.purpose}</span>
                </div>
              ))}
            </div>
          </div>

          {review && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <h5 className="text-xs font-semibold text-amber-400 uppercase mb-1">
                  Architectural Critiques ({review.critiques.length})
                </h5>
                <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
                  {review.critiques.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>

              <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                <h5 className="text-xs font-semibold text-rose-400 uppercase mb-1">
                  Flagged Risks ({review.risks.length})
                </h5>
                <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
                  {review.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {showFeedbackInput && (
        <div className="mb-4">
          <label
            htmlFor="gateFeedbackText"
            className="block text-xs font-semibold text-amber-300 mb-1"
          >
            Specify revisions or guidance for the next cycle:
          </label>
          <textarea
            id="gateFeedbackText"
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Include password hashing with bcrypt and add validation for empty passwords."
            className="w-full bg-slate-950 border border-amber-500/40 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-400 font-mono"
          />
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          id="gateApproveBtn"
          onClick={onApprove}
          className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition shadow-lg shadow-emerald-600/20"
        >
          ✓ Approve & Proceed
        </button>

        <button
          type="button"
          id="gateRejectBtn"
          onClick={handleRejectClick}
          className="py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-amber-600/20 border border-slate-700 hover:border-amber-500/50 text-slate-200 hover:text-amber-300 font-semibold text-sm transition"
        >
          {showFeedbackInput ? 'Submit Feedback & Re-plan' : '↺ Request Revisions'}
        </button>
      </div>
    </div>
  );
};
