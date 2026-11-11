import type { Call, Span, Trace } from '@unfold/shared/trace';
import { callLabel, formatValue } from './format';
import { childrenOf, type Step, type ViewState } from './steps';

/** Décalage dans rhsText d'une position (ligne, colonne) du source. */
function offsetIn(lines: string[], rhs: Span, line: number, col: number): number {
  const l = line - rhs.line;
  let off = 0;
  for (let i = 0; i < l; i++) off += lines[i].length + 1;
  return off + (l === 0 ? col - rhs.col : col - 1);
}

const before = (aL: number, aC: number, bL: number, bC: number) => aL < bL || (aL === bL && aC < bC);

function within(s: Span, outer: Span): boolean {
  return !before(s.line, s.col, outer.line, outer.col) && !before(outer.endLine, outer.endCol, s.endLine, s.endCol);
}

/** Cadre de pile : le côté droit de l'équation, avec les appels déjà vus remplacés par leur état. */
export function frameText(trace: Trace, call: Call, state: ViewState): string {
  const kids = (childrenOf(trace).get(call.id) ?? []).filter((k) => state.visible.has(k.id));
  const label = callLabel(call);
  const waiting = kids.filter((k) => state.stack.includes(k.id));
  const rhs = call.rhsSpan;
  if (call.rhsText === undefined || !rhs) {
    return waiting.length ? `${label} attend ${callLabel(waiting[0])}` : label;
  }
  const inRhs = (k: Call) => k.appSpan !== undefined && within(k.appSpan, rhs);
  const stray = waiting.find((k) => !inRhs(k));
  if (stray) return `${label} attend ${callLabel(stray)}`;

  const text = call.rhsText;
  const lines = text.split('\n');
  const reps = kids.filter(inRhs).map((k) => {
    const s = k.appSpan!;
    const from = offsetIn(lines, rhs, s.line, s.col), to = offsetIn(lines, rhs, s.endLine, s.endCol);
    const kl = callLabel(k);
    const by = state.failed.has(k.id) ? `[${kl} ✗]`
      : state.done.has(k.id) && k.result ? formatValue(k.result)
      : `[${kl} ?]`;
    return { from, to, by };
  }).filter((r) => r.from >= 0 && r.to <= text.length && r.from < r.to).sort((a, b) => a.from - b.from);

  let out = '', pos = 0;
  for (const r of reps) {
    if (r.from < pos) continue; // chevauchement : on garde le premier
    out += text.slice(pos, r.from) + r.by;
    pos = r.to;
  }
  return `${label} = ${out}${text.slice(pos)}`;
}

/** Phrase de l'étape `steps[index]` (index 0-based, affichée « Étape index+1 »). */
export function stepCaption(trace: Trace, steps: Step[], index: number): string {
  const step = steps[index];
  const call = trace.calls.find((c) => c.id === step.callId)!;
  const head = `Étape ${index + 1} : `;
  if (step.kind === 'exit') return `${head}${callLabel(call)} renvoie ${call.result ? formatValue(call.result) : '?'}`;
  if (step.kind === 'error') return `${head}${callLabel(call)} plante — ${call.error?.message ?? ''}`;
  const parent = trace.calls.find((c) => c.id === call.parent);
  let s = `${head}${parent ? callLabel(parent) : 'main'} appelle ${callLabel(call)}`;
  if (call.eqText !== undefined && !childrenOf(trace).has(call.id)) s += ` (cas de base : ${call.eqText})`;
  return s;
}
