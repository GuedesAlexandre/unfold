import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import type { Trace } from '@unfold/shared/trace';
import './theme.css';
import { CallTree } from './components/CallTree';
import { buildSteps, stateAt } from './model/steps';
import fibJson from '../test/fixtures/fib-trace.json';

// Démo minimale (remplacée par l'App à la tâche 10).
function Demo() {
  const trace = fibJson as unknown as Trace;
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const steps = useMemo(() => buildSteps(trace, expanded, false), [trace, expanded]);
  const [k, setK] = useState(Number(new URLSearchParams(location.search).get("k") ?? 0));
  const state = useMemo(() => stateAt(trace, steps, k), [trace, steps, k]);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8 }}>
        <button onClick={() => setK((x) => Math.max(0, x - 1))}>Précédent</button>{' '}
        <button onClick={() => setK((x) => Math.min(steps.length, x + 1))}>Suivant</button> {k}/{steps.length}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CallTree trace={trace} steps={steps} state={state} expanded={expanded} expandAll={false}
          onToggleLib={(id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
