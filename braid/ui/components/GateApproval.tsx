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

export interface GateApprovalProps {
  title: string;
  summary: string;
  onDecision: (approved: boolean, feedback?: string) => void;
}

/** GateApproval — shared approve/revise widget for both human gates. */
export function GateApproval(props: GateApprovalProps): string {
  void props;
  return h(
    'section',
    { id: 'braid-gate' },
    h('h2', null, props.title),
    h('pre', null, props.summary),
    h('button', { id: 'braid-approve' }, 'Approve'),
    h('textarea', { id: 'braid-feedback', rows: 4, cols: 72 }),
    h('button', { id: 'braid-reject' }, 'Request revisions'),
  );
}
