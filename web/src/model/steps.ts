import type { Call, Trace } from '@unfold/shared/trace';

export type Step = { kind: 'enter' | 'exit' | 'error'; callId: number };

export interface ViewState {
  visible: Set<number>; done: Set<number>; failed: Set<number>;
  current: number | null; stack: number[]; // racine → appel courant, appels non terminés
}

/** Enfants de chaque appel (clé 0 = racine), triés par `enter`. */
export function childrenOf(trace: Trace): Map<number, Call[]> {
  const m = new Map<number, Call[]>();
  for (const c of trace.calls) {
    const l = m.get(c.parent);
    if (l) l.push(c); else m.set(c.parent, [c]);
  }
  for (const l of m.values()) l.sort((a, b) => a.enter - b.enter);
  return m;
}

/** Étapes en ordre logique : enter, enfants (ordre d'entrée), puis exit ou error. */
export function buildSteps(trace: Trace, expanded: ReadonlySet<number>, expandAll: boolean): Step[] {
  const kids = childrenOf(trace);
  const steps: Step[] = [];
  const visit = (c: Call): void => {
    steps.push({ kind: 'enter', callId: c.id });
    if (c.kind !== 'lib' || expandAll || expanded.has(c.id)) {
      for (const k of kids.get(c.id) ?? []) visit(k);
    }
    if (c.exit !== undefined) steps.push({ kind: 'exit', callId: c.id });
    else if (c.error) steps.push({ kind: 'error', callId: c.id });
  };
  for (const r of kids.get(0) ?? []) visit(r);
  return steps;
}

/** État après application des `k` premières étapes (0 = rien, steps.length = tout). */
export function stateAt(_trace: Trace, steps: Step[], k: number): ViewState {
  const visible = new Set<number>(), done = new Set<number>(), failed = new Set<number>();
  let stack: number[] = [];
  let current: number | null = null;
  for (const s of steps.slice(0, Math.max(0, k))) {
    current = s.callId;
    visible.add(s.callId);
    if (s.kind === 'enter') { stack.push(s.callId); continue; }
    (s.kind === 'exit' ? done : failed).add(s.callId);
    stack = stack.filter((id) => id !== s.callId);
  }
  return { visible, done, failed, current, stack };
}
