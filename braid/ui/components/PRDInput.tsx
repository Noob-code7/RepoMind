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

export interface PRDInputProps {
  onSubmit: (project: string, prd: string) => void;
}

/** PRDInput — project name + freeform PRD textarea. */
export function PRDInput(props: PRDInputProps): string {
  void props;
  return h(
    'form',
    { id: 'braid-prd-form' },
    h('label', null, 'Project name: ', h('input', { name: 'project', type: 'text' })),
    h('label', null, 'PRD: ', h('textarea', { name: 'prd', rows: 12, cols: 72 })),
    h('button', { type: 'submit' }, 'Plan'),
  );
}
