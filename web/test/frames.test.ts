import { describe, expect, test } from 'vitest';
import type { Call, Trace, Value } from '@unfold/shared/trace';
import { buildSteps, stateAt } from '../src/model/steps';
import { callLabel, formatValue } from '../src/model/format';
import { frameText, stepCaption } from '../src/model/frames';
import fibJson from './fixtures/fib-trace.json';

const fib = fibJson as unknown as Trace;
const num = (v: string): Value => ({ t: 'num', v });
const call = (id: number): Call => fib.calls.find((c) => c.id === id)!;
const tr = (calls: Call[]): Trace => ({ version: 1, language: 'haskell', status: 'ok', stdout: '', diagnostics: [], calls });

describe('formatValue', () => {
  test('listes', () => {
    expect(formatValue({ t: 'list', items: [num('1'), num('2')], rest: 'end' })).toBe('[1,2]');
    expect(formatValue({ t: 'list', items: [num('1')], rest: 'thunk' })).toBe('[1,…]');
    expect(formatValue({ t: 'list', items: [num('1')], rest: 'cut' })).toBe('[1,…]');
    expect(formatValue({ t: 'list', items: [], rest: 'end' })).toBe('[]');
  });
  test('chaînes', () => {
    expect(formatValue({ t: 'str', v: 'ab', rest: 'end' })).toBe('"ab"');
    expect(formatValue({ t: 'str', v: 'ab', rest: 'thunk' })).toBe('"ab…"');
  });
  test('constructeurs, tuples, unité', () => {
    const leaf: Value = { t: 'con', name: 'Feuille', args: [] };
    expect(formatValue({ t: 'con', name: 'Noeud', args: [leaf, num('1'), leaf] })).toBe('Noeud Feuille 1 Feuille');
    const n1: Value = { t: 'con', name: 'Noeud', args: [leaf, num('1'), leaf] };
    expect(formatValue({ t: 'con', name: 'Noeud', args: [n1, num('-2'), leaf] })).toBe('Noeud (Noeud Feuille 1 Feuille) (-2) Feuille');
    expect(formatValue({ t: 'con', name: '(,)', args: [num('1'), { t: 'con', name: 'True', args: [] }] })).toBe('(1,True)');
    expect(formatValue({ t: 'con', name: '(,,)', args: [num('1'), num('2'), num('3')] })).toBe('(1,2,3)');
    expect(formatValue({ t: 'con', name: '()', args: [] })).toBe('()');
  });
  test('divers', () => {
    expect(formatValue({ t: 'thunk' })).toBe('?');
    expect(formatValue({ t: 'fun' })).toBe('<fonction>');
    expect(formatValue({ t: 'cut' })).toBe('…');
    expect(formatValue({ t: 'opaque', desc: 'IORef' })).toBe('<IORef>');
    expect(formatValue({ t: 'char', v: 'a' })).toBe("'a'");
  });
});

describe('callLabel', () => {
  test('cas', () => {
    expect(callLabel(call(1))).toBe('fib 4');
    expect(callLabel({ ...call(1), kind: 'lambda', name: '\\x' , args: [num('3')] })).toBe('λ 3');
    const l = (xs: string[]): Value => ({ t: 'list', items: xs.map(num), rest: 'end' });
    expect(callLabel({ ...call(1), name: '++', kind: 'lib', args: [l(['1']), l(['2'])] })).toBe('++ [1] [2]');
    expect(callLabel({ ...call(1), name: 'f', args: [num('-1'), { t: 'con', name: 'Just', args: [num('1')] }] })).toBe('f (-1) (Just 1)');
  });
});

describe('frameText', () => {
  test('enfant en attente', () => {
    const steps = buildSteps(fib, new Set(), false);
    expect(frameText(fib, call(1), stateAt(fib, steps, 2))).toBe('fib 4 = [fib 3 ?] + fib (n-2)');
  });
  test('enfant terminé, suivant en attente', () => {
    const steps = buildSteps(fib, new Set(), false);
    // après exit de fib 3 (étape 11), enter de fib 2 (id 7) = étape 12
    expect(frameText(fib, call(1), stateAt(fib, steps, 12))).toBe('fib 4 = 2 + [fib 2 ?]');
  });
  test('rien de visible : texte source', () => {
    const steps = buildSteps(fib, new Set(), false);
    expect(frameText(fib, call(1), stateAt(fib, steps, 1))).toBe('fib 4 = fib (n-1) + fib (n-2)');
  });
  test('enfant en erreur', () => {
    const t = tr([
      { ...call(1), exit: undefined, result: undefined, error: { message: 'boom', origin: false } },
      { ...call(2), parent: 1, exit: undefined, result: undefined, error: { message: 'boom', origin: true } },
    ]);
    const steps = buildSteps(t, new Set(), false);
    expect(frameText(t, t.calls[0], stateAt(t, steps, steps.length))).toBe('fib 4 = [fib 3 ✗] + fib (n-2)');
  });
  test('repli « attend » sans appSpan dans rhsSpan (map)', () => {
    const parent: Call = { ...call(1), rhsText: undefined, exit: undefined, result: undefined };
    const child: Call = { id: 2, parent: 1, enter: 2, name: 'map', kind: 'lib', args: [{ t: 'fun' }, { t: 'list', items: [num('1')], rest: 'end' }] };
    const t = tr([parent, child]);
    const steps = buildSteps(t, new Set(), false);
    expect(frameText(t, parent, stateAt(t, steps, 2))).toBe('fib 4 attend map <fonction> [1]');
    const p2: Call = { ...parent, rhsText: 'map f xs', rhsSpan: { line: 4, col: 9, endLine: 4, endCol: 17 } };
    const c2: Call = { ...child, appSpan: { line: 9, col: 1, endLine: 9, endCol: 5 } };
    const t2 = tr([p2, c2]);
    expect(frameText(t2, p2, stateAt(t2, steps, 2))).toBe('fib 4 attend map <fonction> [1]');
  });
  test('rhs multi-ligne', () => {
    const p: Call = { ...call(1), rhsText: 'a\n  g 1 + 2', rhsSpan: { line: 4, col: 5, endLine: 5, endCol: 13 }, exit: undefined, result: undefined };
    const c: Call = { id: 2, parent: 1, enter: 2, exit: 3, name: 'g', kind: 'user', args: [num('1')], result: num('7'), appSpan: { line: 5, col: 3, endLine: 5, endCol: 6 } };
    const t = tr([p, c]);
    const steps = buildSteps(t, new Set(), false);
    expect(frameText(t, p, stateAt(t, steps, 3))).toBe('fib 4 = a\n  7 + 2');
  });
});

describe('frameText : correctifs de revue', () => {
  const mkParent = (rhsText: string, endCol: number): Call => ({
    ...call(1), rhsText, rhsSpan: { line: 4, col: 1, endLine: 4, endCol }, exit: undefined, result: undefined,
  });
  const mkKid = (id: number, col: number, endCol: number, result?: Value, extra: Partial<Call> = {}): Call => ({
    id, parent: 1, enter: id, ...(result ? { exit: id + 100, result } : {}), name: 'g', kind: 'user', args: [num(String(id))],
    appSpan: { line: 4, col, endLine: 4, endCol }, ...extra,
  });
  const run = (p: Call, kids: Call[], k: number) => {
    const t = tr([p, ...kids]);
    const steps = buildSteps(t, new Set(), false);
    return frameText(t, p, stateAt(t, steps, k));
  };
  test('résultat négatif en position d\'opérateur : parenthésé', () => {
    expect(run(mkParent('2 * g 2', 8), [mkKid(2, 5, 8, num('-1'))], 3)).toBe('fib 4 = 2 * (-1)');
  });
  test('constructeur avec arguments en position d\'opérateur : parenthésé', () => {
    const v: Value = { t: 'con', name: 'Noeud', args: [num('1'), num('2')] };
    expect(run(mkParent('g 2 ++ x', 9), [mkKid(2, 1, 4, v)], 3)).toBe('fib 4 = (Noeud 1 2) ++ x');
  });
  test('résultat déjà délimité : pas de double parenthèse', () => {
    expect(run(mkParent('h (g 2)', 8), [mkKid(2, 4, 7, num('-1'))], 3)).toBe('fib 4 = h (-1)');
    expect(run(mkParent('[g 2, 3]', 9), [mkKid(2, 2, 5, num('-1'))], 3)).toBe('fib 4 = [-1, 3]');
  });
  test('même appSpan : pendant gagne', () => {
    const p = mkParent('s [g x]', 8);
    const a = mkKid(2, 4, 7, num('1')), b = mkKid(3, 4, 7);
    expect(run(p, [a, b], 4)).toBe('fib 4 = s [[g 3 ?]]');
  });
  test('même appSpan : résultats identiques ou différents', () => {
    const p = mkParent('s [g x]', 8);
    expect(run(p, [mkKid(2, 4, 7, num('1')), mkKid(3, 4, 7, num('1'))], 5)).toBe('fib 4 = s [1]');
    expect(run(p, [mkKid(2, 4, 7, num('1')), mkKid(3, 4, 7, num('2'))], 5)).toBe('fib 4 = s [g x]');
  });
  test('rhsText plus court que rhsSpan : pas d\'exception', () => {
    const p: Call = { ...mkParent('a', 8), rhsSpan: { line: 4, col: 1, endLine: 6, endCol: 3 } };
    const k = mkKid(2, 1, 2, num('1'), { appSpan: { line: 5, col: 1, endLine: 5, endCol: 2 } });
    expect(run(p, [k], 3)).toBe('fib 4 = a');
  });
  test('terminé sans résultat : texte source ; cut : …', () => {
    const p = mkParent('1 + g 2', 8);
    const k = mkKid(2, 5, 8, num('1'));
    delete (k as { result?: Value }).result;
    expect(run(p, [k], 3)).toBe('fib 4 = 1 + g 2');
    expect(run(p, [mkKid(2, 5, 8, { t: 'cut' })], 3)).toBe('fib 4 = 1 + …');
  });
  test('cas de base seulement si l\'appel est revenu', () => {
    const c: Call = { ...call(4), parent: 1, exit: undefined, result: undefined };
    const t = tr([call(1), c]);
    expect(stepCaption(t, [{ kind: 'enter', callId: 4 }], 0)).toBe('Étape 1 : fib 4 appelle fib 1');
  });
});

describe('stepCaption', () => {
  const steps = buildSteps(fib, new Set(), false);
  test('entrée avec cas de base', () => {
    expect(stepCaption(fib, steps, 3)).toBe('Étape 4 : fib 2 appelle fib 1 (cas de base : fib 1 = 1)');
  });
  test('entrée sous la racine', () => {
    expect(stepCaption(fib, steps, 0)).toBe('Étape 1 : main appelle fib 4');
  });
  test('entrée sans cas de base', () => {
    expect(stepCaption(fib, steps, 1)).toBe('Étape 2 : fib 4 appelle fib 3');
  });
  test('sortie', () => {
    expect(stepCaption(fib, steps, 4)).toBe('Étape 5 : fib 1 renvoie 1');
  });
  test('erreur', () => {
    const t = tr([{ ...call(1), exit: undefined, result: undefined, error: { message: 'Prelude.head: empty list', origin: true } }]);
    const s = buildSteps(t, new Set(), false);
    expect(stepCaption(t, s, 1)).toBe('Étape 2 : fib 4 plante — Prelude.head: empty list');
  });
});
