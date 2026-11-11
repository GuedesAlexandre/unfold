import { rm } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { instrument, instrumentAndRun, runghcOriginal, type Meta } from './instrumentHelpers';
import type { RawCall, RawTrace } from './runtimeHelpers';

const FIXTURES = ['fib.hs', 'qsort.hs', 'localgo.hs', 'nosig.hs', 'shadowing.hs', 'tree.hs', 'lambda.hs', 'features.hs', 'misc.hs',
  'utf8.hs', 'wildcards.hs', 'columns.hs', 'puns.hs'];

const nameOf = (meta: Meta, c: RawCall) => meta.functions[c.fid].name;
const callsNamed = (raw: RawTrace, meta: Meta, name: string) => raw.calls.filter(c => nameOf(meta, c) === name);
const childrenOf = (raw: RawTrace, id: number) => raw.calls.filter(c => c.parent === id).sort((a, b) => a.id - b.id);

/** Names along the chain of only children starting at `c`. */
function chain(raw: RawTrace, meta: Meta, c: RawCall): string[] {
  const names = [nameOf(meta, c)];
  let kids = childrenOf(raw, c.id);
  while (kids.length === 1) {
    names.push(nameOf(meta, kids[0]));
    kids = childrenOf(raw, kids[0].id);
  }
  return names;
}

describe('sécurité : même sortie que runghc sur l’original', () => {
  for (const f of FIXTURES) {
    test(f, async () => {
      const { stdout, meta, source } = await instrumentAndRun(f);
      expect(stdout).toBe(await runghcOriginal(f));
      // every site of META is in the generated code, and only those
      const inCode = [...source.matchAll(/UnfoldRuntime\.Ctx\s+\S+\s+(\d+)/g)].map(m => m[1]).sort();
      expect(inCode).toEqual(Object.keys(meta.sites).sort());
    });
  }
});

test('fib 4', async () => {
  const { raw, meta } = await instrumentAndRun('fib.hs');
  expect(raw.status).toBe('ok');
  expect(raw.calls).toHaveLength(9);
  expect(raw.calls.filter(c => c.parent === 0)).toHaveLength(1);
  const root = raw.calls.find(c => c.parent === 0)!;
  expect(meta.equations[root.eq!].rhsText).toBe('fib (n-1) + fib (n-2)');
  expect(meta.equations[root.eq!].eqText).toBe('fib n = fib (n-1) + fib (n-2)');
  expect(meta.equations[root.eq!].rhsSpan).toEqual({ line: 4, col: 9, endLine: 4, endCol: 30 });
  const kids = childrenOf(raw, root.id);
  // line 4: `fib n = fib (n-1) + fib (n-2)`
  expect(kids.map(k => meta.sites[k.site].appSpan!.col)).toEqual([9, 21]);
  expect(meta.sites[kids[0].site].appSpan).toEqual({ line: 4, col: 9, endLine: 4, endCol: 18 });
  expect(meta.functions[root.fid]).toEqual({
    name: 'fib', kind: 'user', defSpan: { line: 2, col: 1, endLine: 4, endCol: 30 },
  });
  expect(root.args).toEqual([{ t: 'num', v: '4' }]);
  expect(root.result).toEqual({ t: 'num', v: '3' });
  const leaves = raw.calls.filter(c => c.args[0].t === 'num' && c.args[0].v === '0');
  expect(leaves.map(c => meta.equations[c.eq!].eqText)).toEqual(['fib 0 = 0', 'fib 0 = 0']);
});

test('qsort avec where : petits/grands ne sont pas des nœuds', async () => {
  const { raw, meta } = await instrumentAndRun('qsort.hs');
  expect(Object.values(meta.functions).map(f => f.name)).toEqual(['qsort']);
  expect(raw.calls).toHaveLength(17);
  expect(raw.calls.filter(c => c.parent === 0)).toHaveLength(1);
  const ids = new Set(raw.calls.map(c => c.id));
  for (const c of raw.calls) if (c.parent !== 0) expect(ids.has(c.parent)).toBe(true);
  const root = raw.calls.find(c => c.parent === 0)!;
  expect(meta.equations[root.eq!].rhsText).toBe('qsort petits ++ [p] ++ qsort grands');
  expect(childrenOf(raw, root.id)).toHaveLength(2);
});

test('go local dans let : parent = l’appel qui contient le let', async () => {
  const { raw, meta } = await instrumentAndRun('localgo.hs');
  const sums = callsNamed(raw, meta, 'sumTo');
  expect(sums.map(c => c.parent)).toEqual([0, 0]);
  expect(sums.map(c => c.args)).toEqual([[{ t: 'num', v: '3' }], [{ t: 'num', v: '2' }]]);
  expect(sums.map(s => chain(raw, meta, s))).toEqual([
    ['sumTo', 'go', 'go', 'go', 'go'],
    ['sumTo', 'go', 'go', 'go'],
  ]);
  expect(raw.calls).toHaveLength(9);
});

test('fonctions sans signature, mutuellement récursives (pair/impair)', async () => {
  const { raw, meta } = await instrumentAndRun('nosig.hs');
  const roots = raw.calls.filter(c => c.parent === 0);
  expect(roots.map(c => nameOf(meta, c))).toEqual(['impair', 'compte']);
  expect(chain(raw, meta, roots[0])).toEqual(['impair', 'pair', 'impair', 'pair']);
  expect(chain(raw, meta, roots[1])).toEqual(['compte', 'aller', 'retour', 'aller', 'retour', 'aller']);
});

test('masquage : un paramètre nommé comme une fonction tracée', async () => {
  const { raw, meta } = await instrumentAndRun('shadowing.hs');
  const count = (n: string) => callsNamed(raw, meta, n).length;
  expect(count('double')).toBe(3);
  expect(count('map')).toBe(4);
  expect([count('f'), count('g'), count('h'), count('k'), count('l'), count('w'), count('asp')])
    .toEqual([1, 1, 1, 1, 1, 2, 1]);
  expect(count('λ')).toBe(1);
  // the map calls form a chain under main
  const top = callsNamed(raw, meta, 'map').find(c => c.parent === 0)!;
  expect(chain(raw, meta, top).filter(n => n === 'map')).toHaveLength(4);
});

test('data Arbre : insertion, valeurs affichées en con', async () => {
  const { raw, meta } = await instrumentAndRun('tree.hs');
  expect(raw.calls).toHaveLength(8);
  const roots = raw.calls.filter(c => c.parent === 0);
  expect(roots).toHaveLength(4);
  for (const r of roots) {
    expect(r.result).toMatchObject({ t: 'con', name: 'Noeud' });
    // `construire = foldr inserer Feuille`: an unapplied occurrence
    expect(meta.sites[r.site].appSpan).toEqual({ line: 12, col: 20, endLine: 12, endCol: 27 });
  }
  expect(roots.flatMap(r => r.args[1].t === 'con' ? [r.args[1].name] : [])).toContain('Feuille');
  const eqs = Object.values(meta.equations);
  expect(eqs.map(e => e.eqText)).toEqual([
    'inserer x Feuille = Noeud Feuille x Feuille',
    'inserer x a@(Noeud g v d) | x < v = Noeud (inserer x g) v d',
    'inserer x a@(Noeud g v d) | x > v = Noeud g v (inserer x d)',
    'inserer x a@(Noeud g v d) | otherwise = a',
  ]);
  expect(eqs[1].rhsText).toBe('Noeud (inserer x g) v d');
  expect(eqs[1].rhsSpan).toEqual({ line: 7, col: 13, endLine: 7, endCol: 36 });
  // inserer 1 into (Noeud Feuille 3 Feuille): first guard, then a recursive call
  const one = roots.find(r => r.args[0].t === 'num' && r.args[0].v === '1')!;
  expect(meta.equations[one.eq!].rhsText).toBe('Noeud (inserer x g) v d');
  const [kid] = childrenOf(raw, one.id);
  expect(meta.sites[kid.site].appSpan).toEqual({ line: 7, col: 20, endLine: 7, endCol: 31 });
});

test('lambda passée à une fonction utilisateur : nœud λ', async () => {
  const { raw, meta } = await instrumentAndRun('lambda.hs');
  const lambdas = Object.entries(meta.functions).filter(([, f]) => f.kind === 'lambda');
  expect(lambdas.map(([, f]) => f.name)).toEqual(['λ', 'λ']);
  expect(lambdas.map(([, f]) => f.defSpan!.line)).toEqual([5, 9]);
  const fidOf = (line: number) => Number(lambdas.find(([, f]) => f.defSpan!.line === line)![0]);
  const doubling = raw.calls.filter(c => c.fid === fidOf(9));
  expect(doubling.map(c => c.parent)).toEqual([0, 0]);
  expect(doubling.map(c => c.args[0]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
    .toEqual([{ t: 'num', v: '10' }, { t: 'num', v: '5' }]);
  const sp = callsNamed(raw, meta, 'sommePaires')[0];
  const pairs = raw.calls.filter(c => c.fid === fidOf(5));
  expect(pairs).toHaveLength(2);
  for (const p of pairs) expect(p.parent).toBe(sp.id);
  expect(pairs.map(p => p.result)).toEqual([{ t: 'num', v: '3' }, { t: 'num', v: '7' }]);
});

test('constructions variées : gardes, motifs, sections, infixes, paresse, classes', async () => {
  const { raw, meta, source } = await instrumentAndRun('features.hs');
  const count = (n: string) => callsNamed(raw, meta, n).length;
  // infix uses in a resolved chain become prefix calls with a lexical site
  expect(callsNamed(raw, meta, 'ajoute').map(c => c.parent)).toEqual([0, 0]);
  // unresolved chain: the operator stays infix and goes through the alias
  expect(source).toMatch(/1 `combine` 2 `combine` 3/);
  expect(count('combine')).toBe(3);
  expect(Object.values(meta.functions).filter(f => f.name === 'combine')).toHaveLength(2);
  // user operators are not traced in this task
  expect(Object.values(meta.functions).map(f => f.name)).not.toContain('|+|');
  expect(count('plus')).toBe(3);
  expect(count('fois')).toBe(2);
  expect(callsNamed(raw, meta, 'classer').map(c => meta.equations[c.eq!].rhsText))
    .toEqual(['"petit"', '"moyen"', '"grand"']);
  expect(count('compter')).toBe(11);
  expect(callsNamed(raw, meta, 'premier').map(c => meta.equations[c.eq!].rhsText)).toEqual(['x', '0', '0']);
  expect(count('nats')).toBe(5);
  expect(count('paresseux')).toBe(1);
  expect(count('additionneur')).toBe(1);
  const mx = callsNamed(raw, meta, 'maxListe')[0];
  expect(chain(raw, meta, mx)).toEqual(['maxListe', 'go', 'go', 'go']);
  expect(callsNamed(raw, meta, 'carre').map(c => c.parent)).toEqual([0]);
  expect(count('separe')).toBe(1);
  expect(count('signe')).toBe(0); // `signe = \case …` has no pattern: not a node
  expect(count('λ')).toBeGreaterThanOrEqual(4); // longueur's folding lambda (3) + sortBy's comparator
  expect(source).toMatch(/LANGUAGE LambdaCase/);
});

test('noms générés sans conflit, portées locales, vues, enregistrements', async () => {
  const { raw, meta, source } = await instrumentAndRun('misc.hs');
  // `_unfold_c` and `aide__w` are user names: other prefix and suffixes
  expect(source).toMatch(/aide__w1/);
  expect(source).toMatch(/_unfold1_c/);
  const etiq = callsNamed(raw, meta, 'etiquette');
  expect(etiq).toHaveLength(1);
  expect(nameOf(meta, raw.calls.find(c => c.id === etiq[0].parent)!)).toBe('decrire');
  const app = callsNamed(raw, meta, 'appliquerN').find(c => c.parent === 0)!;
  expect(chain(raw, meta, app).slice(0, 4)).toEqual(['appliquerN', 'appliquerN', 'appliquerN', 'appliquerN']);
  expect(callsNamed(raw, meta, 'somme')).toHaveLength(2);
  expect(callsNamed(raw, meta, 'signe')).toHaveLength(3);
});

test('locale non UTF-8 : sources, programme et META en UTF-8', async () => {
  const { stdout, meta } = await instrumentAndRun('utf8.hs', { LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C' });
  expect(stdout).toBe(await runghcOriginal('utf8.hs'));
  expect(Object.values(meta.functions).map(f => f.name)).toContain('λ');
  expect(Object.values(meta.equations).map(e => e.rhsText)).toContain('"Bonjour, " ++ nom ++ " ! Ça va ? é"');
});

test('appel par l’alias (sous un motif {..}) : dyn = true', async () => {
  const { raw, meta } = await instrumentAndRun('wildcards.hs');
  expect(callsNamed(raw, meta, 'render').map(c => c.dyn)).toEqual([false]);
  expect(callsNamed(raw, meta, 'double').map(c => c.dyn)).toEqual([true]);
});

test('colonnes en unités UTF-16 : tabulation et caractère hors BMP', async () => {
  const { raw, meta } = await instrumentAndRun('columns.hs');
  const [d] = callsNamed(raw, meta, 'double');
  // line 6: `\tputStrLn "😀" >> print (double 1)` — tab = 1 unit, emoji = 2 units
  expect(meta.sites[d.site].appSpan).toEqual({ line: 6, col: 26, endLine: 6, endCol: 34 });
});

test('programme sans main : sortie 3 et message', async () => {
  const { dir, result } = await instrument('', 'f :: Int -> Int\nf x = x + 1\n');
  try {
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('no-main');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('erreur d’analyse : sortie 2', async () => {
  const { dir, result } = await instrument('', 'main = print (1 +\n');
  try {
    expect(result.code).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
