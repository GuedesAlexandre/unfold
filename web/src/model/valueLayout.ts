import type { Call, Value } from '@unfold/shared/trace';
import { formatValue, needsParens } from './format';

/** Mesure pure (sans DOM) : police monospace 12 px, largeur de caractère fixe. */
export const CW = 7.2;
export const LH = 20;       // hauteur d'une ligne de texte
export const FONT = 12;
const CELL_PAD = 4;

export type Part =
  | { p: 'text'; x: number; y: number; text: string; cell: boolean; muted?: boolean }
  | { p: 'rect'; x: number; y: number; w: number; h: number; cls: 'cell' | 'todo' | 'dot'; title?: string }
  | { p: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { p: 'sub'; x: number; y: number; l: VL };
export interface VL { w: number; h: number; parts: Part[] }

const textVL = (text: string, cell: boolean, muted = false): VL =>
  ({ w: text.length * CW, h: LH, parts: [{ p: 'text', x: 0, y: LH / 2, text, cell, muted }] });

/** Place `items` côte à côte, centrés verticalement. */
function inline(items: VL[], gap: number): VL {
  const h = Math.max(LH, ...items.map((i) => i.h));
  const parts: Part[] = [];
  let x = 0;
  items.forEach((l, i) => {
    if (i) x += gap;
    parts.push({ p: 'sub', x, y: (h - l.h) / 2, l });
    x += l.w;
  });
  return { w: x, h, parts };
}

const isTuple = (n: string) => /^\(,+\)$/.test(n);

/**
 * Heuristique « type récursif » (on ne connaît pas les types, seulement les valeurs) : un `con`
 * (non tuple) est dessiné en arbre s'il a un argument `con` de même nom, ou si au moins deux de
 * ses arguments sont des constructeurs sans argument identiques (ex. `Node Leaf 3 Leaf`).
 */
export function isTreeValue(v: Value): boolean {
  if (v.t !== 'con' || isTuple(v.name) || v.args.length === 0) return false;
  const cons = v.args.filter((a): a is Extract<Value, { t: 'con' }> => a.t === 'con' && !isTuple(a.name));
  if (cons.some((a) => a.name === v.name)) return true;
  const nullary = cons.filter((a) => a.args.length === 0).map((a) => a.name);
  return nullary.some((n, i) => nullary.indexOf(n) !== i);
}

const TREE_GAP = 8, TREE_LEVEL = 18, MAX_STR = 40;
interface TNode { name: string; leaf: boolean; rest: Value[]; kids: TNode[] }
const isCon = (a: Value): a is Extract<Value, { t: 'con' }> => a.t === 'con' && !isTuple(a.name);
function toTNode(v: Extract<Value, { t: 'con' }>): TNode {
  return {
    name: v.name, leaf: v.args.length === 0,
    rest: v.args.filter((a) => !isCon(a)),
    kids: v.args.filter(isCon).map(toTNode),
  };
}
function leafNames(n: TNode, acc: Set<string>): Set<string> {
  if (n.leaf) acc.add(n.name);
  for (const k of n.kids) leafNames(k, acc);
  return acc;
}
/**
 * Arbre dessiné : chaque nœud montre son constructeur (et ses arguments non récursifs, thunk = case
 * grise). Si toutes les feuilles nullaires portent le même nom, elles sont des points, avec une
 * légende sous l'arbre et un <title> ; sinon chaque feuille est une petite boîte nommée.
 */
function treeVL(root: TNode): VL {
  const parts: Part[] = [];
  const names = leafNames(root, new Set());
  const sharedLeaf = names.size === 1 ? [...names][0]! : null;
  const go = (n: TNode, x0: number, y: number): { w: number; cx: number; h: number } => {
    const dot = n.leaf && sharedLeaf !== null;
    const label = dot ? null : inline([textVL(n.name, true), ...n.rest.map((a) => argVL(a, true))], CW);
    const nw = label ? label.w + 10 : 10;
    const nh = label ? Math.max(LH + 2, label.h + 2) : 10;
    const kids: { w: number; cx: number; h: number }[] = [];
    let cur = x0;
    for (const k of n.kids) { const r = go(k, cur, y + nh + TREE_LEVEL); kids.push(r); cur += r.w + TREE_GAP; }
    const kidsW = kids.length ? cur - TREE_GAP - x0 : 0;
    const cx = kids.length ? (kids[0]!.cx + kids[kids.length - 1]!.cx) / 2 : x0 + nw / 2;
    const nx = cx - nw / 2;
    if (!label) parts.push({ p: 'rect', x: nx, y, w: nw, h: nh, cls: 'dot', title: n.name });
    else {
      parts.push({ p: 'rect', x: nx, y, w: nw, h: nh, cls: 'cell' });
      parts.push({ p: 'sub', x: nx + 5, y: y + (nh - label.h) / 2, l: label });
    }
    for (const k of kids) parts.push({ p: 'line', x1: cx, y1: y + nh, x2: k.cx, y2: y + nh + TREE_LEVEL });
    return { w: Math.max(nw, kidsW), cx, h: nh + (kids.length ? TREE_LEVEL + Math.max(...kids.map((k) => k.h)) : 0) };
  };
  const r = go(root, 1, 1);
  const extent = (p: Part): [number, number] => p.p === 'line' ? [Math.min(p.x1, p.x2), Math.max(p.x1, p.x2)]
    : p.p === 'text' ? [p.x, p.x + p.text.length * CW]
    : p.p === 'sub' ? [p.x, p.x + p.l.w] : [p.x, p.x + p.w];
  const minX = Math.min(...parts.map((p) => extent(p)[0]));
  if (minX !== 0) for (const p of parts) { if (p.p === 'line') { p.x1 -= minX; p.x2 -= minX; } else p.x -= minX; }
  let w = Math.max(...parts.map((p) => extent(p)[1])) + 1;
  let h = r.h + 2;
  if (sharedLeaf !== null) {
    const legend = `● = ${sharedLeaf}`;
    parts.push({ p: 'text', x: 0, y: h + LH / 2, text: legend, cell: false, muted: true });
    h += LH; w = Math.max(w, legend.length * CW);
  }
  return { w, h, parts };
}

/** Argument d'un `con` (entre parenthèses s'il le faut). */
function argVL(a: Value, cell: boolean): VL {
  return needsParens(a) && a.t === 'con' && !isTreeValue(a)
    ? inline([textVL('(', cell), layoutValue(a, cell), textVL(')', cell)], 1)
    : layoutValue(a, cell);
}

/** Disposition d'une valeur. `cell` : la valeur est déjà dans une case (texte en couleur de case). */
export function layoutValue(v: Value, cell = false): VL {
  switch (v.t) {
    case 'thunk': {
      const w = 'non calculé'.length * CW + 8;
      return { w, h: LH, parts: [{ p: 'rect', x: 0, y: 1, w, h: LH - 2, cls: 'todo' },
        { p: 'text', x: 4, y: LH / 2, text: 'non calculé', cell: false, muted: true }] };
    }
    case 'cut': return textVL('…', cell);
    case 'str': {
      const cutText = v.v.length > MAX_STR;
      return textVL(`"${cutText ? v.v.slice(0, MAX_STR) : v.v}${cutText || v.rest !== 'end' ? '…' : ''}"`, cell);
    }
    case 'list': {
      if (v.items.length === 0 && v.rest === 'end') return textVL('[]', cell);
      const cells: VL[] = v.items.map((it) => boxed(layoutValue(it, true)));
      if (v.rest === 'thunk') cells.push(layoutValue({ t: 'thunk' }));
      else if (v.rest === 'cut') cells.push(boxed(textVL('…', true)));
      return inline(cells, 2);
    }
    case 'con': {
      if (isTreeValue(v)) return treeVL(toTNode(v));
      if (isTuple(v.name)) {
        const items: VL[] = [textVL('(', cell)];
        v.args.forEach((a, i) => { if (i) items.push(textVL(',', cell)); items.push(layoutValue(a, cell)); });
        items.push(textVL(')', cell));
        return inline(items, 2);
      }
      const items: VL[] = [textVL(v.name, cell)];
      for (const a of v.args) items.push(argVL(a, cell));
      return inline(items, CW);
    }
    default: return textVL(formatValue(v), cell);
  }
}

function boxed(l: VL): VL {
  const w = l.w + 2 * CELL_PAD, h = l.h + 2;
  return { w, h, parts: [{ p: 'rect', x: 0, y: 0, w, h, cls: 'cell' }, { p: 'sub', x: CELL_PAD, y: 1, l }] };
}

// ---- Contenu d'un nœud de l'arbre ----
export const NODE_PAD_X = 8, NODE_PAD_Y = 4, LIB_BTN = 18;
export interface NodeContent { title: string; label: VL; result: VL | null; w: number; h: number; lib: boolean }

/**
 * Contenu final d'un nœud (nom, arguments, `= résultat`). La taille réserve toujours la place du
 * résultat, même avant le retour de l'appel, pour que le nœud ne change pas de taille.
 */
export function nodeContent(c: Call): NodeContent {
  const name = c.kind === 'lambda' ? 'λ' : c.name;
  const items = [textVL(name, false), ...c.args.map((a) => layoutValue(a))];
  const label = inline(items, CW);
  const result = c.result ? inline([textVL('=', false), layoutValue(c.result)], CW) : null;
  const lib = c.kind === 'lib';
  const body = result ? inline([label, result], CW * 1.5) : label;
  return { title: callTitle(c), label, result, lib, w: body.w + 2 * NODE_PAD_X + (lib ? LIB_BTN : 0), h: Math.max(28, body.h + 2 * NODE_PAD_Y) };
}
const callTitle = (c: Call) => [name0(c), ...c.args.map(formatValue)].join(' ');
const name0 = (c: Call) => (c.kind === 'lambda' ? 'λ' : c.name);
export const nodeSize = (c: Call) => { const n = nodeContent(c); return { w: n.w, h: n.h }; };
