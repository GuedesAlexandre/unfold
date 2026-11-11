import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { run } from '../src/process';
import { fixturesDir, instrumentBin, roundtrip, roundtripAndRun, runghcOriginal } from './instrumentHelpers';

test('aller-retour : même sortie que l’original', async () => {
  const out = await roundtripAndRun('operators.hs');
  expect(out).toBe(await runghcOriginal('operators.hs'));
});

test('portée des déclarations infix : même sortie que l’original', async () => {
  const { source, result } = await roundtrip('scoping.hs');
  expect(result.stdout).toBe(await runghcOriginal('scoping.hs'));
  const flat = source.replace(/\s+/g, ' ');
  expect(flat).toContain('(1 <+> (2 <+> (3 + 0)))');
  expect(flat).toContain('((10 `minus` 3) `minus` 2)');
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
    // imported operators: fixities come from GHC, not from a table
    '(4 .|. (2 .&. 1))',
    '(([1] <> [2]) ++ ([3] <> [4 :: Int]))',
    '(("ab" <> "cd") ++ "ef")',
    '((Nothing <|> Just 1) <|> Just (2 :: Int))',
    '(((+ 1) <$> Nothing) <|> Just (5 :: Int))',
    '(([1, 2, 3 :: Int] & (map (+ 1) . filter odd)) & length)',
    '([1 .. 5] \\\\ (map (+ 1) [1, 2] <> [9 :: Int]))',
    // legal sections whose operand is a chain
    '((- 1) +)',
    '((1 * 2) +)',
    '(+ (2 * 3))',
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

// GHC's diagnostic code for each ill-formed fixture.
for (const [fixture, unchanged, code] of [
  ['bad-chain.hs', 'print (1 == 2 + 0 == True)', 'GHC-88747'],
  ['bad-section.hs', 'map (1 + 2 *) [3 :: Int]', 'GHC-46878'],
] as const) {
  test(`chaîne mal formée laissée telle quelle : ${fixture}`, async () => {
    const original = await run('runghc', [path.join(fixturesDir, fixture)], {
      cwd: fixturesDir, timeoutMs: 120_000, maxOutput: 100_000,
    });
    expect(original.code).not.toBe(0);
    expect(original.stderr).toContain(code);
    const { source, result } = await roundtrip(fixture);
    expect(source.replace(/\s+/g, ' ')).toContain(unchanged);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(code);
  });
}
