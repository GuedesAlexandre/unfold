import type { Call, Trace } from '@unfold/shared/trace';
import { childrenOf, type Step } from './steps';

export interface Rect { x: number; y: number; w: number; h: number }
export const GAP_X = 16;
export const GAP_Y = 40;

/**
 * Placement de l'arbre : feuilles de gauche à droite (espacement 16 px), parent centré sur ses
 * enfants, 40 px entre deux niveaux. Seuls les appels de `visibleIds` sont placés.
 * Un parent plus large que la rangée de ses enfants décale cette rangée pour rester centré dessus.
 */
export function layoutTree(
  trace: Trace,
  visibleIds: ReadonlySet<number>,
  size: (c: Call) => { w: number; h: number },
): Map<number, Rect> {
  const kids = childrenOf(trace);
  const out = new Map<number, Rect>();
  const sizes = new Map<number, { w: number; h: number }>();
  const sz = (c: Call) => { let s = sizes.get(c.id); if (!s) { s = size(c); sizes.set(c.id, s); } return s; };
  const visKids = (id: number) => (kids.get(id) ?? []).filter((k) => visibleIds.has(k.id));

  // hauteur de chaque rangée (profondeur) -> ordonnée
  const rowH: number[] = [];
  const scan = (c: Call, d: number): void => {
    rowH[d] = Math.max(rowH[d] ?? 0, sz(c).h);
    for (const k of visKids(c.id)) scan(k, d + 1);
  };
  const roots = visKids(0);
  for (const r of roots) scan(r, 0);
  const rowY: number[] = [];
  let y = 0;
  for (let d = 0; d < rowH.length; d++) { rowY[d] = y; y += rowH[d]! + GAP_Y; }

  const shift = (c: Call, dx: number): void => {
    const r = out.get(c.id)!; r.x += dx;
    for (const k of visKids(c.id)) shift(k, dx);
  };
  /** Place le sous-arbre de `c` dont le bord gauche est `left` ; renvoie le bord droit. */
  const place = (c: Call, d: number, left: number): number => {
    const { w, h } = sz(c);
    const ks = visKids(c.id);
    let right = left;
    if (ks.length) {
      let cur = left;
      for (const k of ks) { cur = place(k, d + 1, cur) + GAP_X; }
      right = cur - GAP_X;
    }
    const first = ks.length ? out.get(ks[0]!.id)! : null;
    const last = ks.length ? out.get(ks[ks.length - 1]!.id)! : null;
    const mid = first && last ? (first.x + last.x + last.w) / 2 : left + w / 2;
    let x = mid - w / 2;
    if (x < left) { const dx = left - x; for (const k of ks) shift(k, dx); x = left; right += dx; }
    out.set(c.id, { x, y: rowY[d]!, w, h });
    return Math.max(right, x + w);
  };
  let cur = 0;
  for (const r of roots) cur = place(r, 0, cur) + GAP_X;
  return out;
}

/** Placement sur tous les appels atteints dans `steps` (étape finale) : stable pendant la lecture. */
export function layoutForSteps(
  trace: Trace,
  steps: readonly Step[],
  size: (c: Call) => { w: number; h: number },
): Map<number, Rect> {
  return layoutTree(trace, new Set(steps.map((s) => s.callId)), size);
}
