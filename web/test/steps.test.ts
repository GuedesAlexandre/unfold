import { describe, expect, test } from 'vitest';
import type { Call, Trace } from '@unfold/shared/trace';
import { buildSteps, childrenOf, stateAt, type Step } from '../src/model/steps';
import fibJson from './fixtures/fib-trace.json';

const fib = fibJson as unknown as Trace;
const rootId = 1;

const mk = (id: number, parent: number, enter: number, exit: number | undefined, extra: Partial<Call> = {}): Call => ({
  id, parent, enter, ...(exit === undefined ? {} : { exit }), name: `f${id}`, kind: 'user', args: [], ...extra,
});
const tr = (calls: Call[], extra: Partial<Trace> = {}): Trace => ({
  version: 1, language: 'haskell', status: 'ok', stdout: '', diagnostics: [], calls, ...extra,
});
const seq = (s: Step[]) => s.map((x) => `${{ enter: 'e', exit: 'x', error: 'r' }[x.kind]}${x.callId}`).join(' ');

describe('childrenOf', () => {
  test('enfants triés par enter', () => {
    const m = childrenOf(fib);
    expect(m.get(1)!.map((c) => c.id)).toEqual([2, 7]);
    expect(m.get(2)!.map((c) => c.id)).toEqual([3, 6]);
    expect(m.get(0)!.map((c) => c.id)).toEqual([1]);
  });
});

describe('buildSteps', () => {
  test('fib 4 : 18 étapes, enter/exit imbriqués', () => {
    const s = buildSteps(fib, new Set(), false);
    expect(s).toHaveLength(18);
    expect(s[0]).toEqual({ kind: 'enter', callId: rootId });
    expect(s.at(-1)).toEqual({ kind: 'exit', callId: rootId });
    expect(seq(s)).toBe('e1 e2 e3 e4 x4 e5 x5 x3 e6 x6 x2 e7 e8 x8 e9 x9 x7 x1');
  });

  test('lib repliée : descendants absents ; dépliée : présents', () => {
    const t = tr([
      mk(1, 0, 1, 8),
      mk(2, 1, 2, 7, { kind: 'lib', name: 'map' }),
      mk(3, 2, 3, 4, { kind: 'lambda' }),
      mk(4, 2, 5, 6, { kind: 'lambda' }),
    ]);
    expect(seq(buildSteps(t, new Set(), false))).toBe('e1 e2 x2 x1');
    expect(seq(buildSteps(t, new Set([2]), false))).toBe('e1 e2 e3 x3 e4 x4 x2 x1');
    expect(seq(buildSteps(t, new Set(), true))).toBe('e1 e2 e3 x3 e4 x4 x2 x1');
  });

  test('erreur : étape error pour l’origine et ses ancêtres', () => {
    const t = tr([
      mk(1, 0, 1, undefined, { error: { message: 'boom', origin: false } }),
      mk(2, 1, 2, undefined, { error: { message: 'boom', origin: false } }),
      mk(3, 2, 3, undefined, { error: { message: 'boom', origin: true } }),
    ], { status: 'runtime-error' });
    expect(seq(buildSteps(t, new Set(), false))).toBe('e1 e2 e3 r3 r2 r1');
  });

  test('appel jamais revenu (limite) : enter sans exit', () => {
    const t = tr([mk(1, 0, 1, undefined), mk(2, 1, 2, undefined)], { status: 'limit', limitReached: 'steps' });
    expect(seq(buildSteps(t, new Set(), false))).toBe('e1 e2');
  });
});

describe('stateAt', () => {
  const steps = buildSteps(fib, new Set(), false);

  test('k = 0 : état vide', () => {
    const v = stateAt(fib, steps, 0);
    expect(v.visible.size).toBe(0);
    expect(v.current).toBeNull();
    expect(v.stack).toEqual([]);
  });

  test('pile et couleurs après 7 étapes (fib 0 vient de revenir)', () => {
    const v = stateAt(fib, steps, 7);
    expect(v.stack).toEqual([1, 2, 3]);
    expect(v.current).toBe(5);
    expect([...v.done].sort()).toEqual([4, 5]);
    expect([...v.visible].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(v.failed.size).toBe(0);
  });

  test('fin : tout est terminé, pile vide', () => {
    const v = stateAt(fib, steps, steps.length);
    expect(v.stack).toEqual([]);
    expect(v.done.size).toBe(9);
  });

  test('erreur : failed contient l’origine et ses ancêtres', () => {
    const t = tr([
      mk(1, 0, 1, undefined, { error: { message: 'boom', origin: false } }),
      mk(2, 1, 2, undefined, { error: { message: 'boom', origin: false } }),
      mk(3, 2, 3, undefined, { error: { message: 'boom', origin: true } }),
    ], { status: 'runtime-error' });
    const s = buildSteps(t, new Set(), false);
    expect([...stateAt(t, s, 3).failed]).toEqual([]);
    const v4 = stateAt(t, s, 4);
    expect([...v4.failed]).toEqual([3]);
    expect(v4.stack).toEqual([1, 2]);
    const v = stateAt(t, s, s.length);
    expect([...v.failed].sort()).toEqual([1, 2, 3]);
    expect(v.stack).toEqual([]);
    expect(v.done.size).toBe(0);
  });

  test('appel jamais revenu : reste sur la pile', () => {
    const t = tr([mk(1, 0, 1, undefined), mk(2, 1, 2, undefined)], { status: 'limit', limitReached: 'steps' });
    const v = stateAt(t, buildSteps(t, new Set(), false), 2);
    expect(v.stack).toEqual([1, 2]);
    expect(v.done.size).toBe(0);
  });
});
