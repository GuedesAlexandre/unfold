// TEMPORAIRE : démo jetable (?demo=fib|values|error|lib&k=<étapes>), remplacée par l'App à la tâche 10.
import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import type { Call, Trace, Value } from '@unfold/shared/trace';
import './theme.css';
import { CallTree } from './components/CallTree';
import { buildSteps, stateAt } from './model/steps';
import fibJson from '../test/fixtures/fib-trace.json';

const num = (v: string): Value => ({ t: 'num', v });
const con = (name: string, ...args: Value[]): Value => ({ t: 'con', name, args });
const mk = (id: number, parent: number, enter: number, exit: number | undefined, name: string, args: Value[], extra: Partial<Call> = {}): Call =>
  ({ id, parent, enter, ...(exit === undefined ? {} : { exit }), name, kind: 'user', args, ...extra });
const tr = (calls: Call[]): Trace => ({ version: 1, language: 'haskell', status: 'ok', stdout: '', diagnostics: [], calls });
const demos: Record<string, Trace> = {
  fib: fibJson as unknown as Trace,
  values: tr([
    mk(1, 0, 1, 8, 'main', [{ t: 'list', items: [num('1'), num('2')], rest: 'thunk' }, { t: 'list', items: [num('3')], rest: 'cut' }],
      { result: { t: 'str', v: 'bonjour', rest: 'end' } }),
    mk(2, 1, 2, 7, 'arbre', [con('Node', con('Node', con('A'), num('1'), con('B')), num('2'), con('C')), con('Pair', con('Red'), con('Red')), { t: 'str', v: 'x'.repeat(80), rest: 'end' }],
      { result: con('Node', con('Node', con('F'), num('1'), con('F')), { t: 'thunk' }, con('F')) }),
  ]),
  error: tr([
    mk(1, 0, 1, undefined, 'f', [num('1')], { error: { message: 'boum', origin: false } }),
    mk(2, 1, 2, undefined, 'g', [num('2')], { error: { message: 'boum', origin: false } }),
    mk(3, 2, 3, undefined, 'h', [num('0')], { error: { message: 'boum', origin: true } }),
  ]),
  lib: tr([
    mk(1, 0, 1, 6, 'f', [num('1')], { result: num('3') }),
    mk(2, 1, 2, 5, 'foldr', [num('1')], { kind: 'lib', result: num('3') }),
    mk(3, 2, 3, 4, 'g', [num('2')], { result: num('3') }),
  ]),
};

// TEMPORAIRE : ?dark=1 applique le bloc prefers-color-scheme: dark pour les captures headless.
if (new URLSearchParams(location.search).get('dark')) {
  for (const sh of Array.from(document.styleSheets)) for (const r of Array.from(sh.cssRules)) {
    if (r instanceof CSSMediaRule && r.conditionText.includes('dark')) for (const rr of Array.from(r.cssRules)) {
      if (rr instanceof CSSStyleRule) for (const n of Array.from(rr.style)) document.documentElement.style.setProperty(n, rr.style.getPropertyValue(n));
    }
  }
}

function Demo() {
  const q = new URLSearchParams(location.search);
  const trace = demos[q.get('demo') ?? 'fib']!;
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const steps = useMemo(() => buildSteps(trace, expanded, false), [trace, expanded]);
  const [k, setK] = useState(Number(q.get('k') ?? 0));
  const [sel, setSel] = useState<number | null>(null);
  const state = useMemo(() => stateAt(trace, steps, k), [trace, steps, k]);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8 }}>
        <button onClick={() => setK((x) => Math.max(0, x - 1))}>Précédent</button>{' '}
        <button onClick={() => setK((x) => Math.min(steps.length, x + 1))}>Suivant</button> {k}/{steps.length}
        {' '}<span id="sel">sélection : {sel ?? 'aucune'}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CallTree trace={trace} steps={steps} state={state} expanded={expanded} expandAll={false} onSelect={setSel}
          onToggleLib={(id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
