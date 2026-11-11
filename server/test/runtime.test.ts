import { expect, test } from 'vitest';
import { compileAndRunManual } from './runtimeHelpers';

test('fib 4 : 9 appels, parents lexicaux, résultats', async () => {
  const { stdout, raw } = await compileAndRunManual('fib.hs');
  expect(stdout.trim()).toBe('3');
  expect(raw.calls).toHaveLength(9);
  const c1 = raw.calls.find(c => c.id === 1)!;
  expect(raw.calls.every(c => c.dyn === false)).toBe(true);
  expect(c1.parent).toBe(0); expect(c1.args).toEqual([{ t: 'num', v: '4' }]); expect(c1.result).toEqual({ t: 'num', v: '3' });
  expect(c1.eq).toBe(3);
  expect(raw.calls.filter(c => c.parent === 1).map(c => c.args[0])).toEqual([{ t: 'num', v: '3' }, { t: 'num', v: '2' }]);
  expect(raw.calls.filter(c => c.parent === 1).map(c => c.site)).toEqual([10, 11]);
  expect(raw.calls.every(c => c.exit! > c.enter)).toBe(true);
});

test('liste paresseuse : rien de forcé', async () => {
  const { stdout, raw } = await compileAndRunManual('lazy.hs');
  expect(stdout.trim()).toBe('[1,2,3]');
  expect(raw.calls[0].result).toEqual({ t: 'list', items: [{ t: 'num', v: '1' }, { t: 'num', v: '2' }, { t: 'num', v: '3' }], rest: 'thunk' });
  expect(raw.calls).toHaveLength(3);
});

test('plantage : origine et propagation, sortie conservée', async () => {
  const { stdout, raw } = await compileAndRunManual('crash.hs');
  expect(stdout).toContain('avant');
  expect(raw.status).toBe('runtime-error'); expect(raw.message).toContain('boum');
  const errs = raw.calls.filter(c => c.error);
  expect(errs.filter(c => c.error!.origin).map(c => c.fid)).toEqual([2]);
  expect(errs.filter(c => !c.error!.origin)).toHaveLength(1);
});

test('limite d’étapes', async () => {
  const { raw } = await compileAndRunManual('limit.hs', [], { UNFOLD_MAX_STEPS: '50' });
  expect(raw.status).toBe('limit'); expect(raw.limit).toBe('steps'); expect(raw.calls.length).toBe(50);
});

test('chaîne, tuple, Bool, constructeur utilisateur', async () => {
  const { raw } = await compileAndRunManual('values.hs');
  const F = { t: 'con', name: 'Feuille', args: [] };
  expect(raw.calls[0].args[0]).toEqual({ t: 'con', name: '(,)', args: [
    { t: 'con', name: 'Noeud', args: [F, { t: 'num', v: '1' }, F] },
    { t: 'str', v: 'ab', rest: 'end' }] });
  expect(raw.calls[1].args[0]).toEqual({ t: 'con', name: 'True', args: [] });
});

test('callDyn : parent = appel en cours, 0 hors appel', async () => {
  const { stdout, raw } = await compileAndRunManual('dyn.hs');
  expect(stdout.trim()).toBe('8');
  const byFid = (fid: number) => raw.calls.filter(c => c.fid === fid).map(c => c.parent);
  expect(byFid(2)).toEqual([1, 0]);
  expect(raw.calls.map(c => [c.fid, c.dyn])).toEqual([[1, false], [2, true], [2, true]]);
});

test('foldr/map tracés, mêmes résultats que Prelude', async () => {
  const { stdout, raw } = await compileAndRunManual('lib.hs', ['UnfoldPrelude.hs']);
  expect(stdout.trim()).toBe('12');
  const top = raw.calls.filter(c => c.parent === 0).map(c => c.fid).sort((a, b) => a - b);
  expect(top).toEqual([-3, -1]);
  const foldr = raw.calls.find(c => c.fid === -3 && c.parent === 0)!;
  expect(raw.calls.some(c => c.fid === -3 && c.parent === foldr.id)).toBe(true);
  expect(raw.calls.every(c => c.fid > 0 || c.fid >= -15)).toBe(true);
  expect(raw.calls.every(c => c.eq === null || c.eq <= -100 || c.eq > 0)).toBe(true);
});

test('fonctions de liste tracées : paresse préservée', async () => {
  const { stdout } = await compileAndRunManual('libLazy.hs', ['UnfoldPrelude.hs']);
  expect(stdout.trim().split('\n')).toEqual(['[2,4,6]', 'True', "[(1,'a'),(2,'b')]", 'True']);
});

test('fonctions de liste tracées : identiques à Prelude', async () => {
  const { stdout } = await compileAndRunManual('libAll.hs', ['UnfoldPrelude.hs']);
  const lines = stdout.trim().split('\n');
  expect(lines.slice(0, -1).join(' ')).not.toContain('False');
  expect(lines[lines.length - 1]).toBe(
    '(["map","filter","foldr","foldl","length","sum","product","++","reverse","concat","zip","take","drop","elem","replicate"],[-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-11,-12,-13,-14,-15])');
});
