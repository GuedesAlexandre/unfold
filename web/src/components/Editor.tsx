import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import MonacoEditor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import type { Diagnostic, Span } from '@unfold/shared/trace';

// Monaco est fourni par le paquet npm (aucun CDN) ; seul le worker de base est nécessaire.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export interface EditorHandle { goTo(line: number, col: number): void }

interface EditorProps {
  code: string;
  onChange: (code: string) => void;
  onRun: () => void;
  diagnostics: Diagnostic[];
  highlight: Span | null; // 1-based, endCol exclusif (même convention que Monaco)
}

function useDark(): boolean {
  const q = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return dark;
}

const range = (s: Span) => new monaco.Range(s.line, s.col, s.endLine, s.endCol);

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor({ code, onChange, onRun, diagnostics, highlight }, ref) {
  const dark = useDark();
  const [ed, setEd] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef(onRun); runRef.current = onRun;
  const deco = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useImperativeHandle(ref, () => ({
    goTo(line, col) {
      if (!ed) return;
      ed.setPosition({ lineNumber: line, column: col });
      ed.revealPositionInCenterIfOutsideViewport({ lineNumber: line, column: col });
      ed.focus();
    },
  }), [ed]);

  useEffect(() => {
    const model = ed?.getModel(); if (!model) return;
    monaco.editor.setModelMarkers(model, 'ghc', diagnostics.map((d) => ({
      startLineNumber: d.span.line, startColumn: d.span.col,
      endLineNumber: d.span.endLine, endColumn: d.span.endCol, message: d.message,
      severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    })));
  }, [ed, diagnostics]);

  useEffect(() => {
    if (!ed) return;
    deco.current ??= ed.createDecorationsCollection();
    if (!highlight) { deco.current.clear(); return; }
    deco.current.set([{ range: range(highlight), options: { className: 'hl-span', linesDecorationsClassName: 'hl-gutter' } }]);
    ed.revealRangeInCenterIfOutsideViewport(range(highlight));
  }, [ed, highlight]);

  return (
    <MonacoEditor
      value={code}
      language="plaintext"
      theme={dark ? 'vs-dark' : 'vs'}
      onChange={(v) => onChange(v ?? '')}
      options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, tabSize: 2, automaticLayout: true }}
      onMount={(e) => {
        e.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
        setEd(e);
      }}
    />
  );
});
