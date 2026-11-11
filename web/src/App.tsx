import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runCode } from './api';
import { EXAMPLES } from './examples';
import { statusBanners } from './model/banners';
import { buildSteps, stateAt } from './model/steps';
import { stepCaption } from './model/frames';
import { enterIndex, highlightSpan, isStale, remapPosition, type Run } from './model/session';
import { Toolbar } from './components/Toolbar';
import { Editor, type EditorHandle } from './components/Editor';
import { CallTree } from './components/CallTree';
import { CallStack } from './components/CallStack';
import { Controls } from './components/Controls';

const PLAY_MS = 600;

interface Nav { expanded: ReadonlySet<number>; expandAll: boolean; k: number }

/** Les flèches appartiennent déjà à cet élément (éditeur, curseur, menu…). */
const ownsArrows = (t: EventTarget | null) =>
  t instanceof Element && (t.closest('.monaco-editor') !== null || /^(SELECT|TEXTAREA)$/.test(t.tagName)
    || (t instanceof HTMLInputElement && t.type !== 'checkbox'));

export function App() {
  const [code, setCode] = useState(EXAMPLES[0]!.code);
  const [run, setRun] = useState<Run | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState<Nav>({ expanded: new Set(), expandAll: false, k: 0 });
  const [playing, setPlaying] = useState(false);
  const editorRef = useRef<EditorHandle>(null);

  const trace = run?.trace ?? null;
  const steps = useMemo(() => (trace ? buildSteps(trace, nav.expanded, nav.expandAll) : []), [trace, nav.expanded, nav.expandAll]);
  const state = useMemo(() => (trace ? stateAt(trace, steps, nav.k) : null), [trace, steps, nav.k]);
  const stale = isStale(code, run);
  const n = steps.length;

  const traceRef = useRef(trace); traceRef.current = trace;
  const stepsRef = useRef(steps); stepsRef.current = steps;

  const doRun = useCallback(async () => {
    if (running) return;
    setRunning(true); setPlaying(false); setError(null);
    try {
      const t = await runCode(code);
      setRun({ code, trace: t });
      setNav((p) => ({ expanded: new Set(), expandAll: p.expandAll, k: buildSteps(t, new Set(), p.expandAll).length > 0 ? 1 : 0 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [code, running]);

  const go = useCallback((k: number) => setNav((p) => ({ ...p, k: Math.min(Math.max(k, 1), stepsRef.current.length) })), []);

  /** Change le pliage en gardant l'étape affichée (ou l'appel replié qui la contient). */
  const refold = useCallback((f: (p: Nav) => Pick<Nav, 'expanded' | 'expandAll'>) => setNav((p) => {
    const t = traceRef.current;
    const q = f(p);
    if (!t) return { ...p, ...q };
    const next = buildSteps(t, q.expanded, q.expandAll);
    return { ...q, k: remapPosition(t, buildSteps(t, p.expanded, p.expandAll), p.k, next) };
  }), []);

  const onToggleLib = useCallback((id: number) => refold((p) => {
    const e = new Set(p.expanded);
    if (e.has(id)) e.delete(id); else e.add(id);
    return { expanded: e, expandAll: p.expandAll };
  }), [refold]);
  const onExpandAll = useCallback((on: boolean) => refold((p) => ({ expanded: p.expanded, expandAll: on })), [refold]);
  const goToCall = useCallback((id: number) => {
    const i = enterIndex(stepsRef.current, id);
    if (i !== null) { setPlaying(false); go(i); }
  }, [go]);

  // lecture automatique
  useEffect(() => {
    if (!playing) return;
    if (nav.k >= n) { setPlaying(false); return; }
    const t = setTimeout(() => go(nav.k + 1), PLAY_MS);
    return () => clearTimeout(t);
  }, [playing, nav.k, n, go]);

  // clavier : Ctrl+Entrée (hors éditeur, qui a sa propre commande), ← →
  const runRef = useRef(doRun); runRef.current = doRun;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (!(e.target instanceof Element && e.target.closest('.monaco-editor'))) { e.preventDefault(); void runRef.current(); }
        return;
      }
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || ownsArrows(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      setPlaying(false);
      setNav((p) => {
        const k = p.k + (e.key === 'ArrowRight' ? 1 : -1);
        return { ...p, k: Math.min(Math.max(k, 1), stepsRef.current.length) };
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = trace && state?.current != null ? trace.calls.find((c) => c.id === state.current) : undefined;
  const highlight = stale ? null : highlightSpan(current);
  const banners = trace ? statusBanners(trace) : [];

  return (
    <div className="app">
      <Toolbar running={running} expandAll={nav.expandAll} onRun={() => void doRun()}
        onExample={setCode} onExpandAll={onExpandAll} />
      <main className="main">
        <section className="left">
          <Editor ref={editorRef} code={code} onChange={setCode} onRun={() => void doRun()}
            diagnostics={trace?.diagnostics ?? []} highlight={highlight} />
        </section>
        <section className="right">
          {error && <div className="banner error">{error}</div>}
          {banners.map((b, i) => (
            <div key={i} className={`banner ${b.tone}`}>
              <div>{b.text}</div>
              {b.diagnostics && b.diagnostics.length > 0 && (
                <ul className="diags">
                  {b.diagnostics.map((d, j) => (
                    <li key={j}>
                      <button type="button" onClick={() => editorRef.current?.goTo(d.span.line, d.span.col)}>
                        <span className="diag-pos">Ligne {d.span.line}, colonne {d.span.col}</span>
                        <pre>{d.message}</pre>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {!trace ? (
            <div className="empty">Écris du code ou choisis un exemple, puis clique sur ▶ Exécuter.</div>
          ) : (
            <div className={`viz${stale ? ' stale' : ''}`}>
              <div className="viz-row">
                <div className="tree-wrap">
                  <CallTree trace={trace} steps={steps} state={state!} expanded={nav.expanded} expandAll={nav.expandAll}
                    onToggleLib={onToggleLib} onSelect={goToCall} />
                </div>
                <CallStack trace={trace} state={state!} onGoTo={goToCall} />
              </div>
              <Controls k={nav.k} n={n} playing={playing} onGo={(k) => { setPlaying(false); go(k); }}
                onTogglePlay={() => { if (!playing && nav.k >= n) go(1); setPlaying(!playing); }} />
              <p className="caption">{nav.k >= 1 && n > 0 ? stepCaption(trace, steps, nav.k - 1) : 'Aucune étape à afficher.'}</p>
              <details className="stdout" open>
                <summary>Sortie du programme</summary>
                <pre>{trace.stdout || '(rien)'}</pre>
              </details>
              {stale && (
                <div className="stale-overlay">
                  <button type="button" onClick={() => void doRun()} disabled={running}>Code modifié — relance ▶</button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
