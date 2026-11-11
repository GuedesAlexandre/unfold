import { memo } from 'react';
import type { Value } from '@unfold/shared/trace';
import { FONT, layoutValue, type VL } from '../model/valueLayout';

/** Dessin récursif d'une disposition (primitives SVG, à placer dans un <svg>). */
export function VLView({ l }: { l: VL }) {
  return (
    <>
      {l.parts.map((p, i) => {
        switch (p.p) {
          case 'text':
            return <text key={i} x={p.x} y={p.y} className={p.muted ? 'v-text v-muted' : p.cell ? 'v-text v-ctext' : 'v-text'}
              dominantBaseline="central" fontSize={FONT}>{p.text}</text>;
          case 'rect':
            return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.cls === 'dot' ? 5 : 3} className={`v-${p.cls}`}>{p.title && <title>{`Feuille : ${p.title}`}</title>}</rect>;
          case 'line':
            return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} className="v-line" />;
          case 'sub':
            return <g key={i} transform={`translate(${p.x} ${p.y})`}><VLView l={p.l} /></g>;
        }
      })}
    </>
  );
}

/** Valeur dans un <g> SVG (à utiliser dans un <svg>). */
export const ValueView = memo(function ValueView({ value }: { value: Value }) {
  return <VLView l={layoutValue(value)} />;
});

/** Valeur autonome : son propre <svg>, utilisable dans une page HTML (ex. cadres de pile). */
export function ValueBox({ value }: { value: Value }) {
  const l = layoutValue(value);
  return <svg width={l.w} height={l.h} style={{ verticalAlign: 'middle' }} role="img"><VLView l={l} /></svg>;
}
