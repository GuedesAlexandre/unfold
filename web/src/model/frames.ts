import type { Call, Span, Trace } from '@unfold/shared/trace';
import { callLabel, formatValue, needsParens } from './format';
import { childrenOf, type Step, type ViewState } from './steps';

const cache = new WeakMap<Trace, { kids: Map<number, Call[]>; byId: Map<number, Call> }>();
function idx(trace: Trace) {
  let e = cache.get(trace);
  if (!e) {
    e = { kids: childrenOf(trace), byId: new Map(trace.calls.map((c) => [c.id, c])) };
    cache.set(trace, e);
  }
  return e;
}

/**
 * Décalage dans rhsText d'une position (ligne, colonne) du source, ou -1 si incohérent.
 * Hypothèse : les colonnes sont des offsets UTF-16 (comme les index de chaîne JS).
 */
function offsetIn(lines: string[], rhs: Span, line: number, col: number): number {
  const l = line - rhs.line;
  if (l < 0 || l >= lines.length) return -1;
  let off = 0;
  for (let i = 0; i < l; i++) off += lines[i].length + 1;
  return off + (l === 0 ? col - rhs.col : col - 1);
}

const before = (aL: number, aC: number, bL: number, bC: number) => aL < bL || (aL === bL && aC < bC);

function within(s: Span, outer: Span): boolean {
  return !before(s.line, s.col, outer.line, outer.col) && !before(outer.endLine, outer.endCol, s.endLine, s.endCol);
}

const nearest = (t: string, from: number, step: 1 | -1): string => {
  for (let i = from; i >= 0 && i < t.length; i += step) if (!/\s/.test(t[i])) return t[i];
  return '';
};

/** Cadre de pile : le côté droit de l'équation, avec les appels déjà vus remplacés par leur état. */
export function frameText(trace: Trace, call: Call, state: ViewState): string {
  const kids = (idx(trace).kids.get(call.id) ?? []).filter((k) => state.visible.has(k.id));
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

  // Regroupe les enfants ayant le même appSpan (un même site évalué plusieurs fois).
  const groups = new Map<string, { from: number; to: number; ks: Call[] }>();
  for (const k of kids.filter(inRhs)) {
    const s = k.appSpan!;
    const from = offsetIn(lines, rhs, s.line, s.col), to = offsetIn(lines, rhs, s.endLine, s.endCol);
    if (from < 0 || to > text.length || from >= to) continue;
    const key = `${from}:${to}`;
    const g = groups.get(key);
    if (g) g.ks.push(k); else groups.set(key, { from, to, ks: [k] });
  }

  const reps: { from: number; to: number; by: string }[] = [];
  for (const g of groups.values()) {
    const pending = g.ks.find((k) => state.stack.includes(k.id));
    const failed = g.ks.find((k) => state.failed.has(k.id));
    let by: string | null = null;
    if (pending) by = `[${callLabel(pending)} ?]`;
    else if (failed) by = `[${callLabel(failed)} ✗]`;
    else if (g.ks.every((k) => state.done.has(k.id) && k.result)) {
      const texts = new Set(g.ks.map((k) => formatValue(k.result!)));
      if (texts.size === 1) {
        by = [...texts][0];
        if (needsParens(g.ks[0].result!)) {
          const b = nearest(text, g.from - 1, -1), a = nearest(text, g.to, 1);
          const delimited = '([,'.includes(b) && b !== '' && ')],'.includes(a) && a !== '';
          if (!delimited) by = `(${by})`;
        }
      }
    }
    if (by !== null) reps.push({ from: g.from, to: g.to, by });
  }
  reps.sort((a, b) => a.from - b.from || b.to - a.to);

  let out = '', pos = 0;
  for (const r of reps) {
    if (r.from < pos) continue; // chevauchement : l'appel englobant gagne
    out += text.slice(pos, r.from) + r.by;
    pos = r.to;
  }
  return `${label} = ${out}${text.slice(pos)}`;
}

/** Phrase de l'étape `steps[index]` (index 0-based, affichée « Étape index+1 »). */
export function stepCaption(trace: Trace, steps: Step[], index: number): string {
  const step = steps[index];
  const call = idx(trace).byId.get(step.callId)!;
  const head = `Étape ${index + 1} : `;
  if (step.kind === 'exit') return `${head}${callLabel(call)} renvoie ${call.result ? formatValue(call.result) : '?'}`;
  if (step.kind === 'error') return `${head}${callLabel(call)} plante — ${call.error?.message ?? ''}`;
  const parent = idx(trace).byId.get(call.parent);
  let s = `${head}${parent ? callLabel(parent) : 'main'} appelle ${callLabel(call)}`;
  if (call.eqText !== undefined && call.exit !== undefined && !idx(trace).kids.has(call.id)) s += ` (cas de base : ${call.eqText})`;
  return s;
}
