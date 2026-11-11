import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { run } from '../src/process';
import { instrumentBin, roundtrip, roundtripAndRun, runghcOriginal } from './instrumentHelpers';

test('aller-retour : même sortie que l’original', async () => {
  const out = await roundtripAndRun('operators.hs');
  expect(out).toBe(await runghcOriginal('operators.hs'));
});

test('priorités résolues : chaque OpApp est parenthésé selon le Rapport', async () => {
  const { source } = await roundtrip('operators.hs');
  const flat = source.replace(/\s+/g, ' ');
  for (const expected of [
    '(x : (xs ++ ys))',
    '((1 + (2 * 3)) - 4)',
    '(2 ^ (3 ^ 2))',
    '((- 2) + 3)',
    '([1, 2] ++ ([3] ++ [4]))',
    '((10 `div` 3) * 2)',
    '(not True || (False && True))',
    '((f . g) $ 5)',
    '([1] <+> ([2, 3] <+> [4, 5]))',
    '((length xs * 2) + 1)',
    '(- (2 ^ 2))',
    '((10 - 3) - 2)',
    '(p |- (q |- r))',
    '(f $ (g $ (5 + (1 * 2))))',
    '(x : (1 : (map (* 2) xs ++ ([((length ys `mod` 2) + 7)] ++ ys))))',
    '(((sum (map (subtract 1) ys) == 2) && (3 `elem` ys)) || null xs)',
  ]) expect(flat).toContain(expected);
});

test('erreur d’analyse : code 2 et message sur stderr', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'unfold-rt-'));
  try {
    const input = path.join(dir, 'Bad.hs');
    await writeFile(input, 'main = print (1 +\n');
    const r = await run(await instrumentBin(), ['--roundtrip', input, path.join(dir, 'Out.hs')], {
      cwd: dir, timeoutMs: 60_000, maxOutput: 100_000,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/Bad\.hs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
