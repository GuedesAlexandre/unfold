import type { Diagnostic, Trace } from '@unfold/shared/trace';

export interface Banner { tone: 'info' | 'warn' | 'error'; text: string; diagnostics?: Diagnostic[] }

const LIMIT_TEXT = {
  steps: 'Arrêté après 5 000 étapes — ce qui a été tracé reste visible',
  time: 'Arrêté après 10 s — ce qui a été tracé reste visible',
} as const;

/** Bandeaux à afficher au-dessus de la visualisation pour une trace. */
export function statusBanners(trace: Trace): Banner[] {
  const out: Banner[] = [];
  const msg = trace.message?.trim() ? trace.message : undefined;
  switch (trace.status) {
    case 'ok':
      if (msg) out.push({ tone: 'info', text: msg });
      break;
    case 'limit':
      if (trace.limitReached) out.push({ tone: 'warn', text: LIMIT_TEXT[trace.limitReached] });
      if (msg) out.push({ tone: trace.limitReached ? 'info' : 'warn', text: msg });
      break;
    case 'runtime-error':
      out.push({ tone: 'error', text: msg ?? 'Le programme a planté' });
      break;
    case 'no-main':
    case 'internal-error':
      out.push({ tone: 'warn', text: msg ?? (trace.status === 'no-main' ? 'Pas de fonction main' : 'Erreur interne') });
      break;
    case 'compile-error':
      out.push({ tone: 'error', text: 'Le code ne compile pas', diagnostics: trace.diagnostics.filter((d) => d.severity === 'error') });
      if (msg) out.push({ tone: 'info', text: msg });
      break;
  }
  return out;
}
