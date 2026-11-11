import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Call, Trace } from '@unfold/shared/trace';
import { createServer } from '../src/index';
import { haskellTracer, instrumenterBin } from '../src/languages/haskell';
import { fixturesDir } from './instrumentHelpers';

const read = (f: string) => readFileSync(path.join(fixturesDir, f), 'utf8');
const named = (t: Trace, name: string): Call[] => t.calls.filter(c => c.name === name);

beforeAll(async () => {
  await instrumenterBin();
});

test('erreur de type → compile-error avec ligne', async () => {
  const t = await haskellTracer.run(read('typeerror.hs'));
  expect(t.status).toBe('compile-error');
  expect(t.diagnostics[0].span.line).toBe(3);
  expect(t.diagnostics[0].severity).toBe('error');
  expect(t.calls).toEqual([]);
});

test('diagnostics : colonnes en UTF-16, fin exclusive (tabulation et caractère hors BMP avant l’erreur)', async () => {
  // GHC compte les colonnes en caractères et avance les tabulations à la colonne 8k+1.
  const t = await haskellTracer.run('main :: IO ()\nmain = print (length s, g)\n\ns = "é😀" ++ True\ng =\t\'c\' && True\n');
  expect(t.status).toBe('compile-error');
  const spans = t.diagnostics.filter(d => d.severity === 'error').map(d => d.span);
  // `True` : GHC dit colonnes 13 à 17 (caractères) ; en UTF-16, 😀 compte deux unités
  expect(spans).toContainEqual({ line: 4, col: 14, endLine: 4, endCol: 18 });
  // `'c'` après une tabulation : GHC dit 9 à 12 ; dans la ligne, unités 5 à 7
  expect(spans).toContainEqual({ line: 5, col: 5, endLine: 5, endCol: 8 });
});

test('avertissements conservés quand tout va bien', async () => {
  const t = await haskellTracer.run('main :: IO ()\nmain = print (f 1)\n\nf :: Int -> Int\nf _ = 1\nf 1 = 2\n');
  expect(t.status).toBe('ok');
  expect(t.stdout).toBe('1\n');
  expect(t.diagnostics).toEqual([
    expect.objectContaining({ severity: 'warning', span: { line: 6, col: 1, endLine: 6, endCol: 8 } }),
  ]);
});

test('pas de main → no-main', async () => {
  const msg = 'Ton programme doit définir `main`, par exemple : `main = print (maFonction 5)`';
  const implicit = await haskellTracer.run('f :: Int -> Int\nf x = x + 1\n');
  expect(implicit.status).toBe('no-main');
  expect(implicit.message).toBe(msg);
  const named = await haskellTracer.run('module Outils where\n\nf :: Int -> Int\nf x = x + 1\n');
  expect(named.status).toBe('no-main');
  expect(named.message).toBe(msg);
});

test('plantage → runtime-error, origine marquée, sortie avant conservée', async () => {
  const t = await haskellTracer.run(read('crash.hs'));
  expect(t.status).toBe('runtime-error');
  expect(t.stdout).toBe('avant\n');
  expect(t.message).toMatch(/divide by zero/);
  const [div] = named(t, 'diviser');
  const [calc] = named(t, 'calculer');
  expect(div.error).toEqual({ message: expect.stringMatching(/divide by zero/), origin: true });
  expect(calc.error?.origin).toBe(false);
  expect(div.parent).toBe(calc.id);
  expect(div.result).toBeUndefined();
  expect(div.exit).toBeUndefined();
});

test('boucle sans appels → limit/time en < 16 s, sans geler', async () => {
  const start = Date.now();
  const t = await haskellTracer.run(read('spin.hs'));
  expect(t.status).toBe('limit');
  expect(t.limitReached).toBe('time');
  expect(Date.now() - start).toBeLessThan(16_000 + 60_000); // + compilation
}, 120_000);

test('sortie énorme → tronquée, status limit', async () => {
  const t = await haskellTracer.run(read('bigout.hs'));
  expect(t.status).toBe('limit');
  expect(t.stdout.length).toBeLessThanOrEqual(100_000);
  expect(t.stdout.length).toBeGreaterThan(50_000);
  expect(t.stdout.startsWith('1\n2\n3\n')).toBe(true);
}, 120_000);

test('take 5 [1..] fonctionne', async () => {
  const t = await haskellTracer.run(read('infinite.hs'));
  expect(t.status).toBe('ok');
  expect(t.stdout).toBe('[1,2,3,4,5]\n');
  expect(named(t, 'take').every(c => c.kind === 'lib')).toBe(true);
  expect(named(t, 'take').length).toBeGreaterThan(0);
});

test('getLine → message clair', async () => {
  const t = await haskellTracer.run(read('getline.hs'));
  expect(t.status).toBe('runtime-error');
  expect(t.message).toBe('Les entrées clavier (getLine…) ne sont pas encore supportées');
});

test('fib : appels fusionnés avec name/kind/rhsText', async () => {
  const t = await haskellTracer.run(read('fib.hs'));
  expect(t).toMatchObject({ version: 1, language: 'haskell', status: 'ok', stdout: '3\n', diagnostics: [] });
  expect(t.message).toBeUndefined();
  expect(t.limitReached).toBeUndefined();
  expect(t.calls).toHaveLength(9);
  const root = t.calls.find(c => c.parent === 0)!;
  expect(root).toEqual({
    id: root.id, parent: 0, enter: root.enter, exit: root.exit,
    name: 'fib', kind: 'user',
    defSpan: { line: 2, col: 1, endLine: 4, endCol: 30 },
    appSpan: { line: 7, col: 15, endLine: 7, endCol: 20 },
    eqSpan: { line: 4, col: 1, endLine: 4, endCol: 30 },
    rhsSpan: { line: 4, col: 9, endLine: 4, endCol: 30 },
    rhsText: 'fib (n-1) + fib (n-2)',
    eqText: 'fib n = fib (n-1) + fib (n-2)',
    args: [{ t: 'num', v: '4' }],
    result: { t: 'num', v: '3' },
  });
  expect(t.calls.filter(c => c.rhsText === '0').map(c => c.eqText)).toEqual(['fib 0 = 0', 'fib 0 = 0']);
});

test('appels par l’alias (méthodes) : parentApprox seulement pour eux', async () => {
  const t = await haskellTracer.run(read('instance.hs'));
  expect(t.status).toBe('ok');
  const approx = t.calls.filter(c => c.parentApprox);
  expect(approx.length).toBeGreaterThan(0);
  expect(approx.every(c => c.parentApprox === true)).toBe(true);
  expect(t.calls.filter(c => !c.parentApprox).every(c => !('parentApprox' in c))).toBe(true);
  // les appels de bibliothèque portent le genre lib
  expect(named(t, '++').every(c => c.kind === 'lib' && c.defSpan === undefined)).toBe(true);
});

test('bibliothèque non traçable → repli --no-lib avec message', async () => {
  const t = await haskellTracer.run(read('maplength.hs'));
  expect(t.status).toBe('ok');
  expect(t.stdout).toBe('(2,7,True)\n[2,4]\n');
  expect(t.message).toBe(
    'Les fonctions de bibliothèque (map, sum…) ne sont pas tracées pour ce programme : il les utilise sur autre chose que des listes.',
  );
  expect(named(t, 'double')).toHaveLength(2);
  expect(t.calls.every(c => c.kind !== 'lib')).toBe(true);
});

test('beaucoup d’étapes → limit/steps proprement', async () => {
  const t = await haskellTracer.run('main :: IO ()\nmain = print (sum [1..1000000])\n');
  expect(t.status).toBe('limit');
  expect(t.limitReached).toBe('steps');
  expect(t.calls.length).toBe(5000);
});

describe('HTTP', () => {
  let server: ReturnType<typeof createServer>;
  let base: string;
  beforeAll(async () => {
    server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  test('HTTP : POST /api/run renvoie une Trace', async () => {
    const res = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'haskell', code: read('fib.hs') }),
    });
    expect(res.status).toBe(200);
    const t = (await res.json()) as Trace;
    expect(t.status).toBe('ok');
    expect(t.stdout).toBe('3\n');
    expect(t.calls).toHaveLength(9);
  });

  test('HTTP : requête invalide → 400, autre route → 404', async () => {
    const bad = await fetch(`${base}/api/run`, { method: 'POST', body: '{"language":"cobol","code":""}' });
    expect(bad.status).toBe(400);
    const notJson = await fetch(`${base}/api/run`, { method: 'POST', body: 'pas du json' });
    expect(notJson.status).toBe(400);
    const missing = await fetch(`${base}/ailleurs`);
    expect(missing.status).toBe(404);
  });
});
