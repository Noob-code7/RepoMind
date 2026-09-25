/**
 * ui/app.tsx — Thin wiring: PRD input → Gate 1 → (pipeline runs CLI-first)
 * → Gate 2 → report view. The orchestration logic is the deliverable;
 * this file only renders the stage components into #root.
 */
import { PRDInput } from './components/PRDInput.js';
import { GateApproval } from './components/GateApproval.js';
import { ReportView } from './components/ReportView.js';
import type { CycleReport } from '../shared/types.js';

export type UiStage =
  | { kind: 'prd' }
  | { kind: 'gate_review'; summary: string }
  | { kind: 'gate_report'; report: CycleReport }
  | { kind: 'done'; report: CycleReport };

export function renderApp(
  stage: UiStage,
  handlers: {
    onSubmit: (project: string, prd: string) => void;
    onDecision: (approved: boolean, feedback?: string) => void;
  },
): string {
  switch (stage.kind) {
    case 'prd':
      return PRDInput({ onSubmit: handlers.onSubmit });
    case 'gate_review':
      return GateApproval({
        title: 'Gate 1 — approve the plan',
        summary: stage.summary,
        onDecision: handlers.onDecision,
      });
    case 'gate_report':
      return (
        ReportView({ report: stage.report }) +
        GateApproval({
          title: 'Gate 2 — satisfied?',
          summary: 'Approve to finish, or request changes to loop back to PLAN.',
          onDecision: handlers.onDecision,
        })
      );
    case 'done':
      return ReportView({ report: stage.report });
  }
}

/** Browser mount point (no-op under node/tsx). */
if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = renderApp(
      { kind: 'prd' },
      {
        onSubmit: (project, prd) => {
          void project;
          void prd;
          root.setAttribute('data-stage', 'submitted');
        },
        onDecision: () => undefined,
      },
    );
  }
}
