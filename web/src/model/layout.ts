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

  // Parcours itératifs : une trace arrêtée à la limite peut être une chaîne de 5 000 appels.
  // hauteur de chaque rangée (profondeur) -> ordonnée
  const rowH: number[] = [];
  const roots = visKids(0);
  for (const todo: [Call, number][] = roots.map((r) => [r, 0]); todo.length;) {
    const [c, d] = todo.pop()!;
    rowH[d] = Math.max(rowH[d] ?? 0, sz(c).h);
    for (const k of visKids(c.id)) todo.push([k, d + 1]);
  }
  const rowY: number[] = [];
  let y = 0;
  for (let d = 0; d < rowH.length; d++) { rowY[d] = y; y += rowH[d]! + GAP_Y; }

  // Décaler un sous-arbre : le nœud tout de suite, ses descendants à la fin (via `mod`).
  const mod = new Map<number, number>();
  const shift = (c: Call, dx: number): void => {
    out.get(c.id)!.x += dx;
    mod.set(c.id, (mod.get(c.id) ?? 0) + dx);
  };
  /** Place le sous-arbre de `c` dont le bord gauche est `left` ; renvoie le bord droit. */
  interface Frame { c: Call; d: number; left: number; ks: Call[]; i: number; cur: number }
  const place = (root: Call, left0: number): number => {
    const stack: Frame[] = [{ c: root, d: 0, left: left0, ks: visKids(root.id), i: 0, cur: left0 }];
    let ret = left0;
    while (stack.length) {
      const f = stack[stack.length - 1]!;
      if (f.i < f.ks.length) {
        const k = f.ks[f.i]!;
        stack.push({ c: k, d: f.d + 1, left: f.cur, ks: visKids(k.id), i: 0, cur: f.cur });
        continue;
      }
      stack.pop();
      const { c, d, left, ks } = f;
      const { w, h } = sz(c);
      let right = ks.length ? f.cur - GAP_X : left;
      const first = ks.length ? out.get(ks[0]!.id)! : null;
      const last = ks.length ? out.get(ks[ks.length - 1]!.id)! : null;
      const mid = first && last ? (first.x + last.x + last.w) / 2 : left + w / 2;
      let x = mid - w / 2;
      if (x < left) { const dx = left - x; for (const k of ks) shift(k, dx); x = left; right += dx; }
      out.set(c.id, { x, y: rowY[d]!, w, h });
      ret = Math.max(right, x + w);
      const p = stack[stack.length - 1];
      if (p) { p.cur = ret + GAP_X; p.i++; }
    }
    return ret;
  };
  let cur = 0;
  for (const r of roots) cur = place(r, cur) + GAP_X;
  // applique les décalages différés, de haut en bas
  for (const todo: [Call, number][] = roots.map((r) => [r, 0]); todo.length;) {
    const [c, acc] = todo.pop()!;
    out.get(c.id)!.x += acc;
    const a = acc + (mod.get(c.id) ?? 0);
    for (const k of visKids(c.id)) todo.push([k, a]);
  }
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
