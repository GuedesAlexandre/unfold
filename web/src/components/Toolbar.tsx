import { EXAMPLES } from '../examples';

interface ToolbarProps {
  running: boolean;
  expandAll: boolean;
  onRun: () => void;
  onExample: (code: string) => void;
  onExpandAll: (on: boolean) => void;
}

export function Toolbar({ running, expandAll, onRun, onExample, onExpandAll }: ToolbarProps) {
  return (
    <header className="toolbar">
      <strong className="brand">Unfold</strong>
      <button type="button" className="run" disabled={running} onClick={onRun} title="Exécuter (Ctrl+Entrée)">
        {running ? 'Exécution…' : '▶ Exécuter'}
      </button>
      <select value="" aria-label="Exemples" onChange={(e) => {
        const ex = EXAMPLES.find((x) => x.name === e.target.value);
        if (ex) onExample(ex.code);
      }}>
        <option value="" disabled>Exemples</option>
        {EXAMPLES.map((ex) => <option key={ex.name} value={ex.name}>{ex.name}</option>)}
      </select>
      <label className="switch">
        <input type="checkbox" checked={expandAll} onChange={(e) => onExpandAll(e.target.checked)} /> Tout déplier
      </label>
      <span className="hint">Ctrl+Entrée pour exécuter · ← → pour avancer</span>
    </header>
  );
}
