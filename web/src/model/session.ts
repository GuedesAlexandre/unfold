import type { Call, Span, Trace } from '@unfold/shared/trace';
import type { Step } from './steps';

/** Une exécution : la trace et le code qui l'a produite. */
export interface Run { code: string; trace: Trace }

/** La trace ne correspond plus au code de l'éditeur. */
export const isStale = (code: string, run: Run | null): boolean => run !== null && run.code !== code;

/** Zone surlignée dans l'éditeur pour l'appel courant : l'équation choisie, sinon la définition. */
export const highlightSpan = (call: Call | undefined): Span | null => call?.eqSpan ?? call?.defSpan ?? null;

/** Position (1..N) de l'étape d'entrée de `callId`, ou null si elle n'est pas dans `steps`. */
export function enterIndex(steps: Step[], callId: number): number | null {
  const i = steps.findIndex((s) => s.kind === 'enter' && s.callId === callId);
  return i < 0 ? null : i + 1;
}

/**
 * Après un pliage/dépliage : position dans `next` de l'étape `prev[k-1]`. Si elle a disparu
 * (appel interne d'une fonction repliée), l'entrée de l'ancêtre visible le plus proche.
 */
export function remapPosition(trace: Trace, prev: Step[], k: number, next: Step[]): number {
  if (next.length === 0) return 0;
  const s = prev[k - 1];
  if (!s) return Math.min(Math.max(k, 1), next.length);
  const same = next.findIndex((n) => n.kind === s.kind && n.callId === s.callId);
  if (same >= 0) return same + 1;
  const byId = new Map(trace.calls.map((c) => [c.id, c]));
  for (let c = byId.get(s.callId); c; c = byId.get(c.parent)) {
    const i = enterIndex(next, c.id);
    if (i !== null) return i;
  }
  return 1;
}
