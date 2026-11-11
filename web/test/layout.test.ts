import { describe, expect, test } from 'vitest';
import type { Call, Trace } from '@unfold/shared/trace';
import { buildSteps } from '../src/model/steps';
import { layoutForSteps, layoutTree } from '../src/model/layout';
import fibJson from './fixtures/fib-trace.json';

const fib = fibJson as unknown as Trace;
const num = (v: string) => ({ t: 'num' as const, v });
const list = (...xs: string[]) => ({ t: 'list' as const, items: xs.map(num), rest: 'end' as const });
const mk = (id: number, parent: number, enter: number, exit: number, args: Call['args'], result: Call['result']): Call =>
  ({ id, parent, enter, exit, name: 'qsort', kind: 'user', args, result });
const tr = (calls: Call[]): Trace => ({ version: 1, language: 'haskell', status: 'ok', stdout: '', diagnostics: [], calls });

// qsort [3,1,2] -> qsort [1,2] (-> qsort [] , qsort [2] (-> [] , [])) , qsort []
const qsort = tr([
  mk(1, 0, 1, 20, [list('3', '1', '2')], list('1', '2', '3')),
  mk(2, 1, 2, 13, [list('1', '2')], list('1', '2')),
  mk(3, 2, 3, 4, [list()], list()),
  mk(4, 2, 5, 12, [list('2')], list('2')),
  mk(5, 4, 6, 7, [list()], list()),
  mk(6, 4, 8, 9, [list()], list()),
  mk(7, 1, 14, 15, [list()], list()),
]);

// tailles variables pour provoquer des cas de parent plus large que ses enfants
const size = (c: Call) => ({ w: 30 + (c.id % 3) * 40, h: 24 + (c.id % 2) * 10 });
const all = (t: Trace) => new Set(t.calls.map((c) => c.id));

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe.each([['fib', fib], ['qsort', qsort]])('layoutTree %s', (_n, trace) => {
  const lay = layoutTree(trace, all(trace), size);
  test('un rectangle par nœud visible, à la taille demandée', () => {
    expect(lay.size).toBe(trace.calls.length);
    for (const c of trace.calls) expect(lay.get(c.id)).toMatchObject(size(c));
  });
  test('aucun chevauchement', () => {
    const r = [...lay.entries()];
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++)
      expect(overlaps(r[i]![1], r[j]![1]), `${r[i]![0]} / ${r[j]![0]}`).toBe(false);
  });
  test('parent centré sur ses enfants (±1 px)', () => {
    for (const c of trace.calls) {
      const kids = trace.calls.filter((k) => k.parent === c.id).map((k) => lay.get(k.id)!);
      if (!kids.length) continue;
      const p = lay.get(c.id)!;
      const mid = (Math.min(...kids.map((k) => k.x)) + Math.max(...kids.map((k) => k.x + k.w))) / 2;
      expect(Math.abs(p.x + p.w / 2 - mid)).toBeLessThanOrEqual(1);
    }
  });
  test('espacement vertical de 40 px entre niveaux', () => {
    for (const c of trace.calls) {
      const p = lay.get(c.id)!;
      for (const k of trace.calls.filter((k) => k.parent === c.id)) {
        const ch = lay.get(k.id)!;
        expect(ch.y).toBeGreaterThanOrEqual(p.y + p.h + 40);
      }
    }
  });
});

test('feuilles écartées d\'au moins 16 px', () => {
  const lay = layoutTree(fib, all(fib), () => ({ w: 40, h: 20 }));
  const leaves = fib.calls.filter((c) => !fib.calls.some((k) => k.parent === c.id)).map((c) => lay.get(c.id)!)
    .sort((a, b) => a.x - b.x);
  for (let i = 1; i < leaves.length; i++) expect(leaves[i]!.x - (leaves[i - 1]!.x + leaves[i - 1]!.w)).toBeGreaterThanOrEqual(16);
});

test('seuls les nœuds visibles sont placés', () => {
  const lay = layoutTree(fib, new Set([1, 2, 7]), size);
  expect([...lay.keys()].sort()).toEqual([1, 2, 7]);
});

test('les positions ne dépendent pas de l\'étape : calculées sur les étapes complètes', () => {
  const steps = buildSteps(fib, new Set(), false);
  const a = layoutForSteps(fib, steps, size);
  const b = layoutForSteps(fib, steps, size);
  expect(a).toEqual(b);
  expect(a.size).toBe(9);
  // mêmes positions que le placement sur l'ensemble des appels
  expect(a).toEqual(layoutTree(fib, all(fib), size));
});

test('lib repliée : ses enfants ne sont pas placés', () => {
  const t = tr([
    { ...mk(1, 0, 1, 6, [], num('1')), kind: 'lib', name: 'foldr' },
    mk(2, 1, 2, 3, [], num('1')),
  ]);
  const steps = buildSteps(t, new Set(), false);
  expect([...layoutForSteps(t, steps, size).keys()]).toEqual([1]);
});

import { layoutValue, isTreeValue, nodeSize } from '../src/model/valueLayout';
test('tailles de valeurs : liste = une case par élément, thunk = case grise', () => {
  const l = layoutValue(list('1', '2', '3'));
  expect(l.parts.filter((p) => p.p === 'sub')).toHaveLength(3);
  expect(layoutValue({ t: 'thunk' }).parts.some((p) => p.p === 'rect' && p.cls === 'todo')).toBe(true);
  expect(isTreeValue({ t: 'con', name: 'Node', args: [{ t: 'con', name: 'Leaf', args: [] }, num('3'), { t: 'con', name: 'Leaf', args: [] }] })).toBe(true);
  expect(isTreeValue({ t: 'con', name: 'Just', args: [num('1')] })).toBe(false);
  // la taille réserve le résultat : identique avant/après retour (la trace est complète)
  expect(nodeSize(qsort.calls[0]!).w).toBeGreaterThan(nodeSize({ ...qsort.calls[0]!, result: undefined }).w);
});
