import React from 'react';
import { CycleReport } from '../../shared/types.js';

interface ReportViewProps {
  report: CycleReport;
  onNextCycle?: () => void;
}

export const ReportView: React.FC<ReportViewProps> = ({ report }) => {
  const isComplete = report.manifestCompleteness === 100;
  const totalTests =
    report.testResults.smoke.passed +
    report.testResults.smoke.failed +
    report.testResults.regression.passed +
    report.testResults.regression.failed +
    report.testResults.stubs.passed +
    report.testResults.stubs.failed;

  const totalPassed =
    report.testResults.smoke.passed +
    report.testResults.regression.passed +
    report.testResults.stubs.passed;

  const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 100;

  return (
    <div className="card p-6 bg-slate-900 border border-slate-800 rounded-xl shadow-xl space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            Cycle Report & Verification Metrics
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Deterministic results verified by the Braid test harness and manifest diff engine.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-slate-400 font-semibold uppercase">Completeness</div>
            <div className={`text-xl font-black font-mono ${isComplete ? 'text-emerald-400' : 'text-amber-400'}`}>
              {report.manifestCompleteness}%
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400 font-semibold uppercase">Test Pass Rate</div>
            <div className="text-xl font-black font-mono text-cyan-400">
              {passRate}%
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
          <div className="text-xs font-semibold text-slate-400 uppercase">Smoke Tests</div>
          <div className="text-lg font-bold text-white mt-1">
            <span className="text-emerald-400">{report.testResults.smoke.passed} passing</span>
            {report.testResults.smoke.failed > 0 && (
              <span className="text-rose-400 ml-2">/ {report.testResults.smoke.failed} failed</span>
            )}
          </div>
        </div>

        <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
          <div className="text-xs font-semibold text-slate-400 uppercase">Stub Tests (Spec)</div>
          <div className="text-lg font-bold text-white mt-1">
            <span className="text-emerald-400">{report.testResults.stubs.passed} passing</span>
            {report.testResults.stubs.failed > 0 && (
              <span className="text-rose-400 ml-2">/ {report.testResults.stubs.failed} failed</span>
            )}
          </div>
        </div>

        <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
          <div className="text-xs font-semibold text-slate-400 uppercase">Regression Tests</div>
          <div className="text-lg font-bold text-white mt-1">
            <span className="text-emerald-400">{report.testResults.regression.passed} passing</span>
            {report.testResults.regression.failed > 0 && (
              <span className="text-rose-400 ml-2">/ {report.testResults.regression.failed} failed</span>
            )}
          </div>
        </div>
      </div>

      {/* Diff Summary */}
      <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
          Diff Summary
        </h4>
        <p className="text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap">
          {report.diffSummary}
        </p>
      </div>

      {/* PRD Coverage Matrix */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
          PRD Requirements Traceability Matrix
        </h4>
        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
              <tr>
                <th className="px-4 py-2.5">PRD Requirement</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Manifest Files</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
              {report.prdCoverage.map((item, idx) => {
                const statusBadge =
                  item.status === 'implemented'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : item.status === 'partial'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30';

                return (
                  <tr key={idx} className="hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3 font-medium text-slate-200">{item.requirement}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold uppercase ${statusBadge}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-cyan-400">
                      {item.files.join(', ') || '(none)'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Flagged Risks */}
      {report.flaggedRisks.length > 0 && (
        <div className="bg-rose-950/20 border border-rose-900/40 p-4 rounded-lg">
          <h4 className="text-xs font-semibold text-rose-400 uppercase mb-2">
            Flagged Unresolved Risks
          </h4>
          <ul className="list-disc list-inside text-xs text-rose-200/80 space-y-1">
            {report.flaggedRisks.map((risk, idx) => (
              <li key={idx}>{risk}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
