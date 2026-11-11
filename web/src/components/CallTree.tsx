import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Call, Trace } from '@unfold/shared/trace';
import { childrenOf, type Step, type ViewState } from '../model/steps';
import { layoutForSteps, type Rect } from '../model/layout';
import { LIB_BTN, nodeContent, nodeSize, NODE_PAD_X } from '../model/valueLayout';
import { FONT } from '../model/valueLayout';
import { VLView } from './ValueView';

export interface CallTreeProps {
  trace: Trace;
  steps: Step[];
  state: ViewState;
  expanded: ReadonlySet<number>;
  expandAll: boolean;
  onToggleLib: (id: number) => void;
  onSelect?: (id: number) => void;
}

type Status = 's-wait' | 's-done' | 's-idle' | 's-fail' | 's-failrel';

interface NodeProps {
  call: Call; rect: Rect; status: Status; current: boolean; done: boolean; open: boolean;
  onToggleLib: (id: number) => void; onSelect?: (id: number) => void;
}

const NodeView = memo(function NodeView({ call, rect, status, current, done, open, onToggleLib, onSelect }: NodeProps) {
  const n = useMemo(() => nodeContent(call), [call]);
  const body = n.lib ? LIB_BTN : 0;
  const cy = rect.h / 2;
  return (
    <g className={`node ${status}${current ? ' current' : ''}`} transform={`translate(${rect.x} ${rect.y})`}
      onClick={() => onSelect?.(call.id)}>
      <rect className="box" width={rect.w} height={rect.h} rx={6} />
      {n.lib && (
        <g className="toggle" transform={`translate(${NODE_PAD_X - 2} ${cy - 8})`} role="button"
          aria-label={open ? 'Replier' : 'Déplier'}
          onClick={(e) => { e.stopPropagation(); onToggleLib(call.id); }}>
          <rect width={14} height={16} rx={3} />
          <text x={7} y={8} textAnchor="middle" dominantBaseline="central" fontSize={FONT}>{open ? '▾' : '▸'}</text>
        </g>
      )}
      <g transform={`translate(${NODE_PAD_X + body} ${cy - n.label.h / 2})`}><VLView l={n.label} /></g>
      {done && n.result && (
        <g transform={`translate(${NODE_PAD_X + body + n.label.w + 10.8} ${cy - n.result.h / 2})`}><VLView l={n.result} /></g>
      )}
    </g>
  );
});

function statusOf(id: number, c: Call, s: ViewState): Status {
  if (s.failed.has(id)) return c.error?.origin ? 's-fail' : 's-failrel';
  if (s.done.has(id)) return 's-done';
  return s.visible.has(id) ? 's-wait' : 's-idle';
}

interface Xf { x: number; y: number; k: number }

export function CallTree({ trace, steps, state, expanded, expandAll, onToggleLib, onSelect }: CallTreeProps) {
  const layout = useMemo(() => layoutForSteps(trace, steps, nodeSize), [trace, steps]);
  const calls = useMemo(() => new Map(trace.calls.map((c) => [c.id, c])), [trace]);
  const kids = useMemo(() => childrenOf(trace), [trace]);
  const bounds = useMemo(() => {
    let w = 0, h = 0;
    for (const r of layout.values()) { w = Math.max(w, r.x + r.w); h = Math.max(h, r.y + r.h); }
    return { w, h };
  }, [layout]);

  const svgRef = useRef<SVGSVGElement>(null);
  const [xf, setXf] = useState<Xf>({ x: 20, y: 20, k: 1 });
  const [dragging, setDragging] = useState(false);
  const xfRef = useRef(xf); xfRef.current = xf;

  // recentrage sur l'appel courant (ou ajustement de l'ensemble s'il n'y en a pas)
  const cur = state.current !== null ? layout.get(state.current) : undefined;
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const vw = el.clientWidth, vh = el.clientHeight;
    if (cur) {
      const k = xfRef.current.k;
      setXf({ k, x: vw / 2 - (cur.x + cur.w / 2) * k, y: vh / 2 - (cur.y + cur.h / 2) * k });
    } else {
      const k = Math.min(1, (vw - 40) / Math.max(1, bounds.w));
      setXf({ k, x: Math.max(20, (vw - bounds.w * k) / 2), y: 20 });
    }
  }, [cur, bounds]);

  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      setXf((t) => {
        const k = Math.min(3, Math.max(0.15, t.k * Math.exp(-e.deltaY * 0.0015)));
        const f = k / t.k;
        return { k, x: px - (px - t.x) * f, y: py - (py - t.y) * f };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest('.toggle')) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setXf((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  };
  const endDrag = () => { drag.current = null; setDragging(false); };

  const toggle = useCallback((id: number) => onToggleLib(id), [onToggleLib]);

  const edges: JSX.Element[] = [];
  const nodes: JSX.Element[] = [];
  for (const [id, r] of layout) {
    const c = calls.get(id)!;
    for (const k of kids.get(id) ?? []) {
      const kr = layout.get(k.id);
      if (!kr) continue;
      const x1 = r.x + r.w / 2, y1 = r.y + r.h, x2 = kr.x + kr.w / 2, y2 = kr.y;
      edges.push(<path key={k.id} className="edge" d={`M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`}
        opacity={state.visible.has(k.id) ? 1 : 0.35} />);
    }
    nodes.push(<NodeView key={id} call={c} rect={r} status={statusOf(id, c, state)} current={state.current === id}
      done={state.done.has(id)} open={expandAll || expanded.has(id)} onToggleLib={toggle} onSelect={onSelect} />);
  }

  return (
    <svg ref={svgRef} className={`call-tree${dragging ? ' dragging' : ''}`} onPointerDown={onPointerDown}
      onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} role="img" aria-label="Arbre des appels">
      <g className="world" style={{ transform: `translate(${xf.x}px, ${xf.y}px) scale(${xf.k})` }}>
        {edges}{nodes}
      </g>
    </svg>
  );
}
