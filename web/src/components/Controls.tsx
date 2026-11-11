interface ControlsProps {
  k: number; n: number; // étape affichée (1..n)
  playing: boolean;
  onGo: (k: number) => void;
  onTogglePlay: () => void;
}

/** ⏮ ◀ ▶ ⏭, curseur, « Étape k / N » et lecture automatique. */
export function Controls({ k, n, playing, onGo, onTogglePlay }: ControlsProps) {
  const off = n === 0;
  return (
    <div className="controls">
      <button type="button" title="Première étape" disabled={off || k <= 1} onClick={() => onGo(1)}>⏮</button>
      <button type="button" title="Étape précédente (←)" disabled={off || k <= 1} onClick={() => onGo(k - 1)}>◀</button>
      <button type="button" title={playing ? 'Pause' : 'Lecture automatique'} disabled={off}
        onClick={onTogglePlay}>{playing ? '⏸' : '⏵'}</button>
      <button type="button" title="Étape suivante (→)" disabled={off || k >= n} onClick={() => onGo(k + 1)}>▶</button>
      <button type="button" title="Dernière étape" disabled={off || k >= n} onClick={() => onGo(n)}>⏭</button>
      <input type="range" min={1} max={Math.max(1, n)} value={Math.max(1, k)} disabled={off}
        aria-label="Étape" onChange={(e) => onGo(Number(e.target.value))} />
      <span className="step-count">Étape {k} / {n}</span>
    </div>
  );
}
