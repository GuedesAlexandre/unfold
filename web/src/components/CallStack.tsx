import { useMemo } from 'react';
import type { Trace } from '@unfold/shared/trace';
import type { ViewState } from '../model/steps';
import { frameText } from '../model/frames';

interface CallStackProps {
  trace: Trace;
  state: ViewState;
  onGoTo: (callId: number) => void; // aller à l'étape d'entrée de cet appel
}

/** Pile des appels en attente, l'appel le plus récent en haut. */
export function CallStack({ trace, state, onGoTo }: CallStackProps) {
  const calls = useMemo(() => new Map(trace.calls.map((c) => [c.id, c])), [trace]);
  const frames = [...state.stack].reverse();
  return (
    <div className="call-stack">
      <div className="panel-title">Pile d'appels</div>
      {frames.length === 0 && <div className="muted">vide</div>}
      <ol>
        {frames.map((id) => (
          <li key={id}>
            <button type="button" className={`frame${id === state.current ? ' current' : ''}`} onClick={() => onGoTo(id)}
              title="Aller à l'entrée de cet appel">
              {frameText(trace, calls.get(id)!, state)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
