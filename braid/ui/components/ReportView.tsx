/** Minimal JSX pragma (no runtime deps — thin hackathon UI). */
export function h(
  tag: string | ((props: Record<string, unknown>) => string),
  props?: Record<string, unknown> | null,
  ...children: Array<string | number | false | null | undefined>
): string {
  const body = children.flat().filter((c) => c !== false && c != null).join('');
  if (typeof tag === 'function') return tag({ ...(props ?? {}), children: body });
  const attrs = Object.entries(props ?? {})
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => ` ${k}="${String(v)}"`)
    .join('');
  return `<${tag}${attrs}>${body}</${tag}>`;
}

import type { CycleReport } from '../../shared/types.js';

/** ReportView — renders the five required report fields (§5). */
export function ReportView(props: { report: CycleReport }): string {
  const r = props.report;
  const t = r.testResults;
  return h(
    'section',
    { id: 'braid-report' },
    h('h2', null, 'Cycle report'),
    h('p', null, `Completeness: ${r.manifestCompleteness.toFixed(1)}%`),
    h('p', null, `Smoke ${t.smoke.passed}/${t.smoke.failed} · Regression ${t.regression.passed}/${t.regression.failed} · Stubs ${t.stubs.passed}/${t.stubs.failed}`),
    h('p', null, r.diffSummary),
    h('h3', null, 'Flagged risks'),
    h('ul', null, ...r.flaggedRisks.map((risk) => h('li', null, risk))),
    h('h3', null, 'PRD coverage'),
    h('ul', null, ...r.prdCoverage.map((c) => h('li', null, `[${c.status}] ${c.requirement}`))),
  );
}
