# Unfold — visualiseur Haskell (étape 1) : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** une app web locale où l'on écrit du Haskell à gauche et où l'on voit à droite l'arbre des appels et la pile, synchronisés, pas à pas, avec les données dans les nœuds.

**Architecture :** un serveur Node local reçoit le code. Il vérifie d'abord la compilation du code d'origine (`ghc -fno-code`). Il l'instrumente ensuite avec `unfold-instrument`, un exécutable Haskell qui utilise l'API de GHC, puis compile le résultat avec un runtime de traçage (`UnfoldRuntime.hs`) et l'exécute. Le programme s'exécute paresseusement, sans que son comportement change. Chaque appel reçoit un contexte explicite `Ctx` qui contient l'id de l'appelant lexical. En fin d'exécution, les valeurs sont lues dans le tas via `GHC.Exts.Heap`, sans jamais être forcées. Le serveur fusionne la trace brute et les métadonnées de source en une `Trace` (format commun à tous les langages). Le front React la réordonne en « ordre logique » (parcours en profondeur de l'arbre) et l'affiche.

**Tech Stack :** GHC 9.10.3 (paquets `ghc`, `ghc-heap`, `containers`, `base`, tous déjà installés : **aucune dépendance Hackage à télécharger**), cabal 3.16 ; Node 26, TypeScript, npm workspaces, `tsx`, `vitest`, `concurrently` ; Vite + React 18 + `@monaco-editor/react`.

**Spec :** `docs/superpowers/specs/2026-11-11-visualiseur-haskell-design.md`

**Preuve de faisabilité (spike jetable, 2026-11-11) :**
- l'instrumentation manuelle avec un `Ctx` explicite donne les bons parents pour `fib 4` ;
- `GHC.Exts.Heap.getClosureData` affiche `1:2:3:<non calculé>` pour une liste paresseuse, sans la forcer ;
- `GHC.parser` suivi de `showPpr` fait l'aller-retour d'un module (qsort, `where`, `let`, compréhension) et le module réimprimé produit la même sortie ;
- `ghc -fno-code -fdiagnostics-as-json` émet un objet JSON par ligne : `{"span":{"file","start":{"line","column"},"end":{…}},"severity":"Error","message":[…]}`.

## Global Constraints

- Interface et messages en **français**.
- Local uniquement : serveur sur `127.0.0.1`. Aucune isolation de sécurité n'est demandée, mais il faut des limites : environ **5 000 étapes** et **10 secondes** par exécution, mémoire limitée (`-with-rtsopts=-M512m`), arrêt forcé du processus à 15 s.
- Le comportement du programme de l'utilisateur ne doit **jamais** changer. La capture d'une valeur ne la force jamais. Garde-fou : pour chaque programme de test, la sortie standard de la version instrumentée doit être **identique** à celle de `runghc` sur l'original.
- On ne modifie jamais les types des fonctions de l'utilisateur pour pouvoir afficher leurs valeurs (pas de `Show` ajouté). L'affichage passe par l'inspection du tas.
- Le format `Trace` (`shared/trace.ts`) est commun à tous les langages, étiqueté et versionné (`version: 1`). La visualisation ne lit que ce format.
- Code accepté : un seul fichier, `base` et `containers`, et un `main` obligatoire.
- Démarrage en une commande : `npm run dev` à la racine.

## Review Focus

1. **Un nom de fonction tracée masqué par une variable locale** (`map` ou `go` réutilisé comme nom de paramètre, de variable de `do` ou de compréhension) : le programme doit quand même fonctionner. Test : `shadowing.hs` (Task 4).
2. **Un mélange d'opérateurs de priorités différentes autour de `++`** (`x : xs ++ ys`, `n * 2 + length xs`, `a ++ b ++ c`, sections `(++ ys)`) : le résultat doit être identique à l'original. Test : `operators.hs` (Task 3 pour l'aller-retour, Task 5 pour la version tracée).
3. **Des fonctions sans signature de type**, y compris locales et mutuellement récursives : elles doivent compiler et être tracées avec les bons parents. Test : `nosig.hs` (Task 4).
4. **Une erreur qui remonte à travers plusieurs appels** : seul l'appel d'origine est marqué `origin: true`, ses ancêtres sont marqués `origin: false`, et la sortie produite avant le plantage est conservée. Test : `crash.hs` (Task 1 et Task 6).
5. **Une sortie énorme ou un programme qui ne termine pas sans faire d'appels** (`let x = x + 1`, `mapM_ print [1..]`) : le serveur rend la main avec `status: 'limit'`, la sortie est tronquée à 100 Ko, et rien ne gèle. Test : `spin.hs` et `bigout.hs` (Task 6).

---

## Structure des fichiers

```
unfold/
  package.json                 # workspaces: shared, server, web ; scripts dev/test
  shared/trace.ts              # format Trace commun (types seulement)
  tracer-haskell/
    unfold-instrument.cabal    # exécutable ; deps: base, ghc, containers
    app/Main.hs                # CLI : unfold-instrument IN.hs OUT.hs META.json
    src/Unfold/Fixity.hs       # résolution des priorités d'opérateurs sur l'AST parsé
    src/Unfold/Rewrite.hs      # réécriture : Ctx, wrappers, sites, équations, lib, lambdas
    src/Unfold/Meta.hs         # métadonnées (fonctions/sites/équations → spans) en JSON
    runtime/UnfoldRuntime.hs   # call/eq/val/runMain, lecture du tas, JSON brut
    runtime/UnfoldPrelude.hs   # map/filter/foldr… tracés (kind "lib")
  server/
    src/index.ts               # HTTP : POST /api/run
    src/process.ts             # lancement de processus avec timeout et plafond de sortie
    src/languages/types.ts     # interface Tracer
    src/languages/haskell.ts   # pipeline Haskell → Trace
    test/fixtures/*.hs         # programmes de test
    test/*.test.ts
  web/
    src/model/steps.ts         # Trace → étapes en ordre logique, état à l'étape k
    src/model/frames.ts        # texte des cadres de pile + phrase de l'étape
    src/model/layout.ts        # placement de l'arbre
    src/components/*.tsx       # Editor, CallTree, CallStack, ValueView, Controls, Toolbar
    src/examples.ts
    src/App.tsx
```

---

### Task 1 : Monorepo, format `Trace`, runtime Haskell

**Files :**
- Create : `package.json`, `tsconfig.base.json`, `shared/package.json`, `shared/trace.ts`, `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `.gitignore` (`node_modules`, `dist`, `dist-newstyle`, `.superpowers`, `/tmp-runs`)
- Create : `tracer-haskell/runtime/UnfoldRuntime.hs`
- Create : `server/test/runtimeHelpers.ts`, `server/test/runtime.test.ts`, `server/test/fixtures/manual/{fib,lazy,crash,limit}.hs` (instrumentés **à la main**, comme le spike)

**Interfaces :**
- Produces (`shared/trace.ts`, exact) :
```ts
export type Span = { line: number; col: number; endLine: number; endCol: number }; // 1-based, endCol exclusif
export type Value =
  | { t: 'num'; v: string }
  | { t: 'char'; v: string }
  | { t: 'str'; v: string; rest: 'end' | 'thunk' | 'cut' }       // liste de Char
  | { t: 'list'; items: Value[]; rest: 'end' | 'thunk' | 'cut' } // rest = ce qui suit le dernier item
  | { t: 'con'; name: string; args: Value[] }                    // Bool, tuples "(,)", "()", data utilisateur
  | { t: 'thunk' } | { t: 'fun' } | { t: 'cut' } | { t: 'opaque'; desc: string };
export type CallKind = 'user' | 'lib' | 'lambda' | 'method';
export interface Call {
  id: number; parent: number;            // 0 = racine (main), absente de calls
  enter: number; exit?: number;          // numéros de séquence globaux (ordre réel)
  name: string; kind: CallKind;
  defSpan?: Span;                        // définition de la fonction
  appSpan?: Span;                        // application complète au site d'appel (ex. `fib (n-1)`) dans le corps du parent
  eqSpan?: Span; rhsSpan?: Span; rhsText?: string; // équation/garde choisie et son côté droit
  args: Value[]; result?: Value;         // result absent = jamais revenu
  error?: { message: string; origin: boolean };
}
export type Status = 'ok' | 'compile-error' | 'runtime-error' | 'limit' | 'no-main' | 'internal-error';
export interface Diagnostic { span: Span; severity: 'error' | 'warning'; message: string }
export interface Trace {
  version: 1; language: 'haskell' | 'c' | 'python'; status: Status;
  message?: string; stdout: string; diagnostics: Diagnostic[]; calls: Call[];
  limitReached?: 'steps' | 'time';
}
```
- Produces (`UnfoldRuntime.hs`, module `UnfoldRuntime`) :
  - `data Ctx = Ctx !Int !Int` (id de l'appel parent, id de site ; `0` = inconnu)
  - `root :: Ctx` (= `Ctx 0 0`)
  - `call :: Ctx -> Int -> [Box] -> (Int -> r) -> r` (2ᵉ argument : id de fonction ; le corps reçoit l'id du nouvel appel)
  - `callDyn :: Int -> [Box] -> r -> r` (parent = appel en cours sur une pile dynamique globale ; pour les méthodes d'instance)
  - `eq :: Int -> Int -> a -> a` (id de l'appel, id d'équation ; enregistre l'équation choisie et renvoie la valeur inchangée)
  - `val :: a -> Box` (= `asBox`)
  - `runMain :: IO () -> IO ()` (lit `UNFOLD_TRACE`, `UNFOLD_MAX_STEPS` (défaut 5000) et `UNFOLD_TIMEOUT_MS` (défaut 10000) ; exécute ; écrit toujours le JSON brut)
  - JSON brut écrit dans `$UNFOLD_TRACE` :
    `{"status":"ok"|"runtime-error"|"limit","limit":"steps"|"time"|null,"message":string|null,"calls":[{"id","parent","site","fid","eq":int|null,"enter","exit":int|null,"args":[Value],"result":Value|null,"error":{"message","origin"}|null}]}`
    où `Value` suit exactement le type TS ci-dessus.

- [ ] **Step 1 : Monorepo.** `package.json` racine : `"workspaces": ["shared","server","web"]`, scripts `"test": "npm -w server test && npm -w web test"`. Dans `server`, devDeps `typescript`, `tsx`, `vitest`, `@types/node`. Lancer `npm install`. Résultat attendu : installation sans erreur.

- [ ] **Step 2 : Écrire les tests qui échouent.** `server/test/runtimeHelpers.ts` fournit la fonction `compileAndRunManual(fixture: string): Promise<{ stdout: string; raw: RawTrace }>`. Elle copie `UnfoldRuntime.hs` et la fixture dans un dossier temporaire, lance `ghc -O0 -package ghc-heap -fno-omit-yields -rtsopts -with-rtsopts=-M512m`, exécute le binaire avec `UNFOLD_TRACE` et lit le JSON. Tests de `runtime.test.ts` :
```ts
test('fib 4 : 9 appels, parents lexicaux, résultats', async () => {
  const { stdout, raw } = await compileAndRunManual('fib.hs');
  expect(stdout.trim()).toBe('3');
  expect(raw.calls).toHaveLength(9);
  const c1 = raw.calls.find(c => c.id === 1)!;
  expect(c1.parent).toBe(0); expect(c1.args).toEqual([{ t: 'num', v: '4' }]); expect(c1.result).toEqual({ t: 'num', v: '3' });
  expect(raw.calls.filter(c => c.parent === 1).map(c => c.args[0])).toEqual([{ t: 'num', v: '3' }, { t: 'num', v: '2' }]);
  expect(raw.calls.every(c => c.exit! > c.enter)).toBe(true);
});
test('liste paresseuse : rien de forcé', async () => {
  const { stdout, raw } = await compileAndRunManual('lazy.hs');      // print (take 3 (nats root 1))
  expect(stdout.trim()).toBe('[1,2,3]');
  expect(raw.calls[0].result).toEqual({ t: 'list', items: [{t:'num',v:'1'},{t:'num',v:'2'},{t:'num',v:'3'}], rest: 'thunk' });
  expect(raw.calls).toHaveLength(3);
});
test('plantage : origine et propagation, sortie conservée', async () => {
  const { stdout, raw } = await compileAndRunManual('crash.hs');     // putStrLn "avant" ; f 3 → g 3 → error "boum"
  expect(stdout).toContain('avant');
  expect(raw.status).toBe('runtime-error'); expect(raw.message).toContain('boum');
  const errs = raw.calls.filter(c => c.error);
  expect(errs.filter(c => c.error!.origin).map(c => c.fid)).toEqual([/* fid de g */ 2]);
  expect(errs.filter(c => !c.error!.origin)).toHaveLength(1);
});
test('limite d’étapes', async () => {
  const { raw } = await compileAndRunManual('limit.hs');             // loop n = loop (n+1), UNFOLD_MAX_STEPS=50
  expect(raw.status).toBe('limit'); expect(raw.limit).toBe('steps'); expect(raw.calls.length).toBe(50);
});
test('chaîne, tuple, Bool, constructeur utilisateur', async () => {
  const { raw } = await compileAndRunManual('values.hs'); // ident (Noeud Feuille 1 Feuille, "ab") puis ident True, valeurs déjà évaluées par print
  const F = { t: 'con', name: 'Feuille', args: [] };
  expect(raw.calls[0].args[0]).toEqual({ t: 'con', name: '(,)', args: [
    { t: 'con', name: 'Noeud', args: [F, { t: 'num', v: '1' }, F] },
    { t: 'str', v: 'ab', rest: 'end' } ] });
  expect(raw.calls[1].args[0]).toEqual({ t: 'con', name: 'True', args: [] });
});
```

- [ ] **Step 3 : Lancer `npm -w server test`.** Résultat attendu : ÉCHEC (`UnfoldRuntime.hs` introuvable).

- [ ] **Step 4 : Implémenter `UnfoldRuntime.hs`.** Point de départ : le spike (compteurs et événements dans des `IORef` globaux `NOINLINE`, `call` qui fait `evaluate (body i)` dans `unsafePerformIO`). Décisions :
  - `call` incrémente le compteur d'étapes. Au-delà de `UNFOLD_MAX_STEPS`, il lève l'exception `StepLimit`, et ne la marque pas comme erreur d'appel.
  - En cas d'exception, `call` enregistre `error` avec `origin = True` seulement si aucun appel descendant n'a déjà enregistré cette même exception. Pour le savoir, on marque l'exception avec un drapeau global « déjà attribuée », remis à zéro quand une exception est attrapée par `runMain`.
  - `callDyn` utilise une pile dynamique globale (empilée/dépilée autour de `evaluate`) pour son parent. `call` empile aussi.
  - Lecture des valeurs dans `runMain`, **après** la fin (ou l'arrêt) du programme. Profondeur maximale 12, 50 éléments de liste au maximum, 200 caractères de chaîne au maximum. Au-delà : `cut`.
    - Constructeurs `I#`, `W#`, `IS` → `num`. `D#` / `F#` → `num` (montrer le flottant). `IP` / `IN` (grands Integer) → `opaque "grand entier"`. `C#` → `char`.
    - `:` / `[]` → `list`, ou `str` si tous les éléments affichés sont des `C#`.
    - Indirections et blackholes : on les suit.
    - `ThunkClosure` / `APClosure` / `SelectorClosure` → `thunk`.
    - `FunClosure` / `PAPClosure` → `fun`.
    - Autre → `opaque` + type de closure.
  - `runMain` : `System.Timeout.timeout` sur le programme. Il attrape `StepLimit`, le timeout et toute autre exception (`status runtime-error`, `message = displayException`). Il fait `hFlush stdout`, écrit le JSON dans tous les cas, puis sort avec le code 0.
  - Échappement JSON fait à la main (pas d'aeson).

- [ ] **Step 5 : Lancer `npm -w server test`.** Résultat attendu : SUCCÈS (5 tests).

- [ ] **Step 6 : Commit** `feat: format Trace commun et runtime de traçage Haskell`.

---

### Task 2 : Bibliothèque standard tracée (`UnfoldPrelude`)

**Files :**
- Create : `tracer-haskell/runtime/UnfoldPrelude.hs`
- Create : `server/test/fixtures/manual/lib.hs`, tests ajoutés dans `server/test/runtime.test.ts`

**Interfaces :**
- Consumes : `Ctx`, `call`, `val`, `eq` de la Task 1.
- Produces : module `UnfoldPrelude` qui exporte, pour chaque fonction `f` de la liste
  `map filter foldr foldl length sum product append reverse concat zip take drop elem replicate`,
  une version `f :: Ctx -> <type d'origine spécialisé aux listes>`. `append` remplace `++`.
  Il exporte aussi `libNames :: [(String, Int)]`, qui associe un nom affiché (`"map"`, `"++"`, …) à un id de fonction réservé. Les ids réservés vont de `-1` à `-15`, dans l'ordre de la liste ci-dessus.
  Chaque fonction est définie de façon récursive, « comme dans un manuel ». Les appels récursifs passent un `Ctx` dont le parent est l'appel courant. Ils sont donc tracés, avec le genre `lib` (le genre est déduit côté serveur des ids négatifs).

- [ ] **Step 1 : Test qui échoue.** `lib.hs` instrumenté à la main : `main = print (U.foldr root (+) 0 (U.map root (*2) [1,2,3]))`.
```ts
test('foldr/map tracés, mêmes résultats que Prelude', async () => {
  const { stdout, raw } = await compileAndRunManual('lib.hs', ['UnfoldPrelude.hs']);
  expect(stdout.trim()).toBe('12');
  const top = raw.calls.filter(c => c.parent === 0).map(c => c.fid).sort();
  expect(top).toEqual([-3, -1]);                       // foldr et map, tous deux sous la racine
  const foldr = raw.calls.find(c => c.fid === -3 && c.parent === 0)!;
  expect(raw.calls.some(c => c.fid === -3 && c.parent === foldr.id)).toBe(true); // récursion visible
});
```
(`compileAndRunManual` reçoit un 2ᵉ paramètre optionnel : la liste des fichiers runtime supplémentaires à copier.)

- [ ] **Step 2 : Lancer.** Résultat attendu : ÉCHEC.
- [ ] **Step 3 : Implémenter `UnfoldPrelude.hs`.** Chaque fonction a la même forme qu'une fonction utilisateur instrumentée : un wrapper `call`, plus un corps `f__u` qui reçoit l'id. `foldl` est paresseux comme celui de Prelude. `length`, `sum` et `product` ont des types restreints aux listes et à `Num`/`Int`, comme dans un manuel.
- [ ] **Step 4 : Lancer.** Résultat attendu : SUCCÈS.
- [ ] **Step 5 : Commit** `feat: fonctions de liste tracées`.

---

### Task 3 : `unfold-instrument` — aller-retour et résolution des priorités

**Files :**
- Create : `tracer-haskell/unfold-instrument.cabal`, `tracer-haskell/cabal.project` (`packages: .`), `tracer-haskell/app/Main.hs`, `tracer-haskell/src/Unfold/Fixity.hs`
- Create : `server/src/process.ts`, `server/test/instrumentHelpers.ts`, `server/test/roundtrip.test.ts`, `server/test/fixtures/operators.hs`

**Interfaces :**
- Produces (CLI) : `unfold-instrument --roundtrip IN.hs OUT.hs` (parse, résout les priorités, réimprime) et, à partir de la Task 4, `unfold-instrument IN.hs OUT.hs META.json`. Code de sortie 0 en cas de succès, 2 en cas d'erreur d'analyse (message sur stderr).
- Produces (Haskell) : `resolveFixities :: FixityEnv -> HsModule GhcPs -> HsModule GhcPs`. Après ce passage, chaque `OpApp` de l'AST est enveloppé dans `HsPar`, selon le regroupement défini par le Rapport Haskell (§10.6). `FixityEnv` contient la table des opérateurs de Prelude/base (`infixr 9 .`, `infixr 8 ^ ^^ **`, `infixl 7 * / div mod rem quot`, `infixl 6 + -`, `infixr 5 : ++`, `infix 4 == /= < <= > >= elem notElem`, `infixl 4 <$> <$ <*> *> <*`, `infixr 3 &&`, `infixr 2 ||`, `infixl 1 >> >>=`, `infixr 1 =<<`, `infixr 0 $ $! seq`, `infixl 9 !!`, `infixl 9 !` (Data.Map)) plus les déclarations `infix*` du module. Par défaut : `infixl 9`. La négation `NegApp` est traitée comme dans le Rapport.
- Produces (`server/src/process.ts`) : `run(cmd: string, args: string[], opts: { cwd: string; env?: Record<string,string>; timeoutMs: number; maxOutput: number; stdin?: string }): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }>`
- Produces (`server/test/instrumentHelpers.ts`) : `instrumentBin(): Promise<string>` (fait `cabal build` une fois, puis renvoie `cabal list-bin unfold-instrument`) et `runghcOriginal(fixture): Promise<string>` (sortie standard de `runghc` sur l'original).

- [ ] **Step 1 : Test qui échoue.** `operators.hs` imprime une dizaine d'expressions :
  - `x : xs ++ ys`, `1 + 2 * 3 - 4`, `2 ^ 3 ^ 2`, `- 2 + 3`, `[1,2] ++ [3] ++ [4]` ;
  - ``10 `div` 3 * 2``, `not True || False && True`, `f . g $ 5`, `(++ [9]) [8]`, `([7] ++) [8]` ;
  - un opérateur utilisateur `infixr 6 <+>`, et `length xs * 2 + 1`.
```ts
test('aller-retour : même sortie que l’original', async () => {
  const out = await roundtripAndRun('operators.hs');
  expect(out).toBe(await runghcOriginal('operators.hs'));
});
```
- [ ] **Step 2 : Lancer.** Résultat attendu : ÉCHEC (pas d'exécutable).
- [ ] **Step 3 : Implémenter.** Cabal : un exécutable, `build-depends: base, ghc, containers`, `ghc-options: -O1`. Dans `Main.hs` : `runGhc (Just libdir)` (libdir obtenu avec `ghc --print-libdir`, passé par la variable d'environnement `UNFOLD_GHC_LIBDIR` ou détecté), `GHC.parser`, `resolveFixities`, `showPpr`. Écrire l'algorithme de résolution dans `Fixity.hs` (aplatir chaque chaîne `OpApp`, puis appliquer l'algorithme du Rapport).
- [ ] **Step 4 : Lancer.** Résultat attendu : SUCCÈS.
- [ ] **Step 5 : Commit** `feat: unfold-instrument (aller-retour + priorités)`.

---

### Task 4 : Réécriture des fonctions de l'utilisateur

**Files :**
- Create : `tracer-haskell/src/Unfold/Rewrite.hs`, `tracer-haskell/src/Unfold/Meta.hs`
- Modify : `tracer-haskell/app/Main.hs` (mode normal)
- Create : `server/test/instrument.test.ts`, `server/test/fixtures/{fib,qsort,localgo,nosig,shadowing,tree,lambda}.hs`

**Interfaces :**
- Consumes : `resolveFixities` (Task 3), le runtime (Task 1).
- Produces (META.json) :
  `{"functions":{"<fid>":{"name":string,"kind":"user"|"lambda"|"method","defSpan":Span}},"sites":{"<sid>":{"appSpan":Span}},"equations":{"<eqid>":{"fid":int,"eqSpan":Span,"rhsSpan":Span,"rhsText":string}}}`.
  Les spans et `rhsText` désignent le **code d'origine**.
- Produces (forme du code généré, exacte) : pour une fonction `f` dont les équations ont `n ≥ 1` motifs,
```haskell
f :: Ctx -> <type d'origine, contexte de classes conservé devant>     -- si signature fournie
f _unfold_ctx a1 … an = UnfoldRuntime.call _unfold_ctx <fid> [UnfoldRuntime.val a1, …] (\_unfold_c -> f__u _unfold_c a1 … an)
f__u :: Int -> <type d'origine>                                       -- si signature fournie
f__u _unfold_c <motifs d'origine> | <gardes> = UnfoldRuntime.eq _unfold_c <eqid> (<corps réécrit>)
  where <liaisons réécrites>
```
  Chaque occurrence en expression d'une fonction tracée `g` en portée (non masquée) devient `(g (UnfoldRuntime.Ctx _unfold_c <sid>))`. Hors de tout appel tracé (`main`, valeurs de haut niveau), `_unfold_c` vaut `0`. `main` devient `main = UnfoldRuntime.runMain (<corps d'origine réécrit>)`. Les lambdas `\p1 … pk -> e` deviennent `\a1 … ak -> UnfoldRuntime.call (Ctx _unfold_c <sid>) <fid> [val a1 …] (\_unfold_c -> case (a1, …, ak) of (p1, …, pk) -> e')`, avec le nom affiché `λ`. Le module généré importe `UnfoldRuntime` et active `{-# LANGUAGE NoMonomorphismRestriction #-}`.
  `appSpan` d'un site = étendue de l'application la plus longue dont la tête est l'occurrence (`fib (n-1)` et pas seulement `fib`) ; pour une occurrence non appliquée (`map fib xs`), l'occurrence seule.

- [ ] **Step 1 : Tests qui échouent.** `instrumentAndRun(fixture): Promise<{ stdout: string; raw: RawTrace; meta: Meta }>` (dans `instrumentHelpers.ts`). Pour **chaque** fixture : `expect(stdout).toBe(await runghcOriginal(f))`. En plus :
```ts
test('fib 4', async () => {               // fib.hs : fib avec signature, main = print (fib 4)
  const { raw, meta } = await instrumentAndRun('fib.hs');
  expect(raw.calls).toHaveLength(9);
  expect(raw.calls.filter(c => c.parent === 0)).toHaveLength(1);
  const root = raw.calls.find(c => c.parent === 0)!;
  expect(meta.equations[root.eq!].rhsText).toBe('fib (n-1) + fib (n-2)');
  const kids = raw.calls.filter(c => c.parent === root.id);
  expect(kids.map(k => meta.sites[k.site].appSpan.col)).toEqual([/* col de `fib (n-1)` */ 9, /* col de `fib (n-2)` */ 23]);
});
test('qsort avec where : petits/grands ne sont pas des nœuds', …);   // seuls des nœuds qsort (+ filter : Task 5)
test('go local dans let : parent = l’appel qui contient le let', …);
test('fonctions sans signature, mutuellement récursives (pair/impair)', …);  // parents corrects : impair 3 → pair 2 → …
test('masquage : un paramètre nommé comme une fonction tracée', …);         // shadowing.hs : f map = map + 1, avec map :: Int
test('data Arbre : insertion, valeurs affichées en con', …);
test('lambda passée à une fonction utilisateur : nœud λ', …);
test('programme sans main : sortie 3 et message', …);                        // exit code 3, stderr "no-main"
```
  (Les colonnes exactes de `fib.hs` sont celles du fichier de test. Les écrire depuis le fichier, pas « à peu près ».)
- [ ] **Step 2 : Lancer.** Résultat attendu : ÉCHEC.
- [ ] **Step 3 : Implémenter `Rewrite.hs`.**
  - Ensemble des fonctions tracées en portée :
    - fonctions de haut niveau (`FunBind` avec au moins un motif) ;
    - fonctions locales (`where`/`let`), ajoutées à l'entrée de leur portée.
  - Masquage : sur chaque `Match` (équation, alternative de `case`, lambda), retirer de l'ensemble les noms liés par les motifs (`collectPatsBinders`). Faire de même pour les liaisons de `do`, de compréhension et de `let`, sans argument.
  - Les fonctions définies par l'utilisateur gardent leur arité syntaxique.
  - Ids attribués dans l'ordre du source à partir de 1 (fid, sid, eqid indépendants).
  - Les signatures dont le type commence par un contexte reçoivent `Ctx ->` après le contexte. Pour les signatures multiples (`f, g :: …`), séparer en une signature par nom.
  - Écrire `Meta.hs` (JSON fait à la main).
- [ ] **Step 4 : Lancer.** Résultat attendu : SUCCÈS.
- [ ] **Step 5 : Commit** `feat: instrumentation des fonctions utilisateur`.

---

### Task 5 : Réécriture des fonctions de bibliothèque, des opérateurs et des instances

**Files :**
- Modify : `tracer-haskell/src/Unfold/Rewrite.hs`
- Create : `server/test/fixtures/{libuse,useroperator,instance}.hs` ; tests ajoutés dans `server/test/instrument.test.ts`. On réutilise `operators.hs`.

**Interfaces :**
- Consumes : `UnfoldPrelude` (Task 2), la réécriture (Task 4).
- Produces :
  - Les occurrences non masquées des 15 noms de `libNames` qui ne sont pas redéfinis par l'utilisateur deviennent `(UnfoldPrelude.<f> (Ctx _unfold_c <sid>))`. Le module généré contient `import Prelude hiding (map, filter, …, (++))` et `import qualified UnfoldPrelude`. Si l'utilisateur importe ces noms depuis `Data.List`, on masque aussi ces imports.
  - Après résolution des priorités (Task 3), `l ++ r`, ``l `elem` r`` et `l <op> r` (opérateur utilisateur tracé) deviennent des applications préfixes. Sections : `(++ r)` devient `(\_unfold_x -> UnfoldPrelude.append ctx _unfold_x r)` et `(l ++)` devient `(UnfoldPrelude.append ctx l)`.
  - Méthodes d'instance écrites par l'utilisateur : le corps de chaque équation est enveloppé par `UnfoldRuntime.callDyn <fid> [val args…] (…)`, avec le genre `method`. À l'intérieur, `_unfold_c` vaut l'id renvoyé par la pile dynamique. Pour garder une forme simple, `callDyn` reçoit un corps `Int -> r`.

- [ ] **Step 1 : Tests qui échouent.**
  - Pour chaque fixture, la sortie doit être identique à celle de `runghc`.
  - `libuse.hs` (`sum (map carre [1..4])`, ``3 `elem` xs``, `reverse "abc"`, `foldr`) : les nœuds `map` et `sum` sont enfants de la racine ; le nœud `map` contient des appels récursifs `map` et des appels `carre`.
  - `operators.hs` passe toujours.
  - `useroperator.hs` : l'opérateur `<+>` est un nœud qui porte son nom.
  - `instance.hs` (`instance Show Arbre where show …` récursif) : il existe des nœuds `show` de genre `method`.
- [ ] **Step 2 : Lancer.** Résultat attendu : ÉCHEC.
- [ ] **Step 3 : Implémenter.**
- [ ] **Step 4 : Lancer.** Résultat attendu : SUCCÈS. Relancer aussi tous les tests des Tasks 1 à 4.
- [ ] **Step 5 : Commit** `feat: bibliothèque, opérateurs et instances tracés`.

---

### Task 6 : Pipeline serveur et API HTTP

**Files :**
- Create : `server/src/languages/types.ts`, `server/src/languages/haskell.ts`, `server/src/index.ts`
- Create : `server/test/pipeline.test.ts`, `server/test/fixtures/{spin,bigout,getline,typeerror,crash,infinite}.hs`

**Interfaces :**
- Consumes : `run` (Task 3), l'exécutable et le runtime (Tasks 1 à 5), META.json et le JSON brut.
- Produces :
  - `interface Tracer { language: Trace['language']; run(code: string): Promise<Trace> }`
  - `export const haskellTracer: Tracer`
  - HTTP : `POST /api/run` avec le corps `{ language: 'haskell', code: string }`, réponse `200 Trace`. Port `5174`, hôte `127.0.0.1`.
- Pipeline `haskellTracer.run(code)` :
  1. Créer un dossier temporaire et y écrire `Main.hs`.
  2. `ghc -fno-code -fdiagnostics-as-json Main.hs`. S'il y a des erreurs : renvoyer `status 'compile-error'` avec les diagnostics (on lit chaque ligne JSON de stderr et on convertit la colonne de fin, inclusive, en `endCol` exclusif). Les avertissements sont conservés dans tous les cas.
  3. `unfold-instrument Main.hs Instr.hs meta.json`. Code de sortie 3 → `status 'no-main'` avec le message « Ton programme doit définir `main`, par exemple : `main = print (maFonction 5)` ». Autre échec → `internal-error`.
  4. Compiler `Instr.hs` avec le runtime (mêmes options qu'à la Task 1). Un échec → `internal-error`, avec le message « Unfold n'a pas réussi à instrumenter ce programme » et les diagnostics bruts dans `message`.
  5. Exécuter avec `stdin` vide, un timeout dur de 15 s et une sortie limitée à 100 Ko. Si l'exécution est tuée : `status 'limit'`, `limitReached 'time'`, `calls: []`.
  6. Fusion : pour chaque appel brut, prendre `name`, `kind`, `defSpan` dans `functions[fid]` (ou dans `libNames` si `fid < 0`, avec le genre `lib`), `appSpan` dans `sites[site]`, et `eqSpan`, `rhsSpan`, `rhsText` dans `equations[eq]`.
  7. Si le message d'erreur contient `end of file` et que le programme lit l'entrée standard : message « Les entrées clavier (getLine…) ne sont pas encore supportées ».
- [ ] **Step 1 : Tests qui échouent.**
```ts
test('erreur de type → compile-error avec ligne', async () => {
  const t = await haskellTracer.run(read('typeerror.hs'));
  expect(t.status).toBe('compile-error'); expect(t.diagnostics[0].span.line).toBe(3); expect(t.calls).toEqual([]);
});
test('plantage → runtime-error, origine marquée, sortie avant conservée', …);   // crash.hs
test('boucle sans appels → limit/time en < 16 s, sans geler', …, 20000);     // spin.hs : main = print (let x = x + 1 in x :: Int)
test('sortie énorme → tronquée, status limit', …, 20000);                    // bigout.hs : mapM_ print [1..]
test('take 5 [1..] fonctionne', …);                                          // infinite.hs : stdout "[1,2,3,4,5]", status ok
test('getLine → message clair', …);
test('fib : appels fusionnés avec name/kind/rhsText', …);
test('HTTP : POST /api/run renvoie une Trace', …);                          // démarre le serveur sur un port libre
```
- [ ] **Step 2 : Lancer.** Résultat attendu : ÉCHEC.
- [ ] **Step 3 : Implémenter.** Le serveur utilise `node:http`, sans framework. Il construit l'exécutable une seule fois au démarrage (`cabal build` dans `tracer-haskell`), puis retrouve son chemin avec `cabal list-bin`. Les exécutions sont traitées une par une (file d'attente simple).
- [ ] **Step 4 : Lancer.** Résultat attendu : SUCCÈS.
- [ ] **Step 5 : Commit** `feat: pipeline Haskell et API /api/run`.

---

### Task 7 : Modèle d'étapes (ordre logique, repli de la bibliothèque)

**Files :**
- Create : `web/` (Vite React TS : `package.json`, `vite.config.ts` avec proxy `/api` → `http://127.0.0.1:5174`, `index.html`, `src/main.tsx`), `web/src/model/steps.ts`, `web/test/steps.test.ts`, `web/test/fixtures/fib-trace.json` (produite par le serveur sur `fib 4`, puis figée)

**Interfaces :**
- Consumes : `Trace`, `Call` (`shared/trace.ts`).
- Produces :
```ts
export type Step = { kind: 'enter' | 'exit' | 'error'; callId: number };
export function buildSteps(trace: Trace, expanded: ReadonlySet<number>, expandAll: boolean): Step[];
export interface ViewState {
  visible: Set<number>; done: Set<number>; failed: Set<number>;
  current: number | null; stack: number[];   // racine → appel courant, appels non terminés
}
export function stateAt(trace: Trace, steps: Step[], k: number): ViewState;
export function childrenOf(trace: Trace): Map<number, Call[]>; // triés par `enter`
```
- Ordre logique (algorithme) : parcours en profondeur depuis la racine 0. Pour chaque appel : `enter`, puis ses enfants triés par `enter` (ordre réel d'entrée), puis `exit` s'il est revenu, ou `error` s'il a une erreur. S'il n'a ni l'un ni l'autre, rien. Si un appel de genre `lib` n'est pas dans `expanded` et que `expandAll` est faux, ses descendants sont sautés, mais ses propres étapes `enter`/`exit` restent.

- [ ] **Step 1 : Tests qui échouent.**
```ts
test('fib 4 : 18 étapes, enter/exit imbriqués', () => {
  const s = buildSteps(fib, new Set(), false);
  expect(s).toHaveLength(18);
  expect(s[0]).toEqual({ kind: 'enter', callId: rootId }); expect(s.at(-1)).toEqual({ kind: 'exit', callId: rootId });
});
test('stateAt : pile et couleurs à l’étape 7', () => { /* pile = [fib4, fib3, fib1?] selon la fixture ; done contient fib2, fib1, fib0 */ });
test('lib repliée : descendants absents des étapes ; dépliée : présents', …);
test('erreur : étape error, failed contient l’origine et ses ancêtres', …);
test('appel jamais revenu (limite) : enter sans exit', …);
```
(La fixture `fib-trace.json` est générée une fois avec `curl` vers le serveur de la Task 6 et commitée. Les assertions exactes de l'étape 7 se lisent dans cette fixture.)
- [ ] **Step 2 : Lancer `npm -w web test`.** Résultat attendu : ÉCHEC.
- [ ] **Step 3 : Implémenter `steps.ts`.**
- [ ] **Step 4 : Lancer.** Résultat attendu : SUCCÈS.
- [ ] **Step 5 : Commit** `feat(web): modèle d'étapes en ordre logique`.

---

### Task 8 : Cadres de pile et phrase de l'étape

**Files :**
- Create : `web/src/model/frames.ts`, `web/src/model/format.ts`, `web/test/frames.test.ts`

**Interfaces :**
- Consumes : `Trace`, `Call`, `ViewState`, `childrenOf` (Task 7).
- Produces :
  - `formatValue(v: Value): string` (texte court : `[1,2,3,…]`, `"abc"`, `Noeud Feuille 1 Feuille`, `(1,True)`, `?` pour `thunk`, `<fonction>`)
  - `callLabel(c: Call): string` (`fib 4`, `λ 3`, `++ [1] [2]`)
  - `frameText(trace: Trace, call: Call, state: ViewState): string`
  - `stepCaption(trace: Trace, step: Step): string`
- Règles de `frameText` :
  - On part de `rhsText`. Pour chaque enfant **visible** dont l'`appSpan` est contenu dans `rhsSpan`, on remplace son texte (positions relatives à `rhsSpan`) :
    - enfant terminé → `formatValue(result)` ;
    - enfant sur la pile (en attente) → `[callLabel ?]` ;
    - enfant en erreur → `[callLabel ✗]`.
  - Les enfants non encore visibles gardent leur texte source.
  - Résultat : `callLabel(call) + ' = ' + texte`.
  - Si un enfant de la pile n'a pas d'`appSpan` dans `rhsSpan`, ou si `rhsText` est absent : `callLabel(call) + ' attend ' + callLabel(enfant)`.
- Règles de `stepCaption` (gabarits exacts) :
  - entrée sous un parent : `Étape {n} : {parent} appelle {enfant}` ;
  - entrée sous la racine : `Étape {n} : main appelle {enfant}` ;
  - si l'équation choisie n'a pas d'appel tracé : on ajoute ` (cas de base : {texte de l'équation})` ;
  - sortie : `Étape {n} : {appel} renvoie {valeur}` ;
  - erreur : `Étape {n} : {appel} plante — {message}`.
  - `{n}` est numéroté à partir de 1.
- [ ] **Step 1 : Tests qui échouent** (sur `fib-trace.json`) :
```ts
expect(frameText(fib, fib4, stateWhereFib3Pending)).toBe('fib 4 = [fib 3 ?] + fib (n-2)');
expect(frameText(fib, fib4, stateAfterFib3Done)).toBe('fib 4 = 2 + [fib 2 ?]');
expect(stepCaption(fib, enterFib1Step)).toBe('Étape 4 : fib 2 appelle fib 1 (cas de base : fib 1 = 1)');
expect(formatValue({ t: 'list', items: [{t:'num',v:'1'}], rest: 'thunk' })).toBe('[1,…]');
expect(formatValue({ t: 'str', v: 'ab', rest: 'end' })).toBe('"ab"');
```
  Ajouter un test de repli (« attend ») sur un appel passé à `map`.
  Remarque : le texte des enfants non visibles reste celui du source (`fib (n-2)`). C'est voulu, pour être fidèle : ce sont les arguments qu'on n'a pas encore évalués.
- [ ] **Step 2 à 4 : ÉCHEC → implémenter → SUCCÈS.**
- [ ] **Step 5 : Commit** `feat(web): cadres de pile et phrases`.

---

### Task 9 : Arbre SVG et affichage des valeurs

**Files :**
- Create : `web/src/model/layout.ts`, `web/test/layout.test.ts`, `web/src/components/CallTree.tsx`, `web/src/components/ValueView.tsx`, `web/src/theme.css`

**Interfaces :**
- Consumes : Tasks 7 et 8.
- Produces :
  - `layoutTree(trace: Trace, visibleIds: Set<number>, size: (c: Call) => { w: number; h: number }): Map<number, { x: number; y: number; w: number; h: number }>`. Algorithme : on place les feuilles de gauche à droite avec un espacement de 16 px, chaque parent est centré sur ses enfants, et l'espacement vertical est de 40 px. Le placement est calculé sur **tous** les nœuds visibles à la dernière étape, pour que l'arbre ne « saute » pas d'une étape à l'autre. Ceux qui ne sont pas encore atteints sont dessinés en gris.
  - `<CallTree trace state steps onToggleLib(id) />` : SVG avec zoom et déplacement (molette pour zoomer, glisser pour déplacer), recentré automatiquement sur l'appel courant.
    - Couleurs : jaune = en cours ou en attente, vert = terminé, gris = pas encore exécuté, rouge = en erreur. L'appel courant a un cadre épais.
    - Un nœud `lib` affiche un bouton ▸/▾.
  - `<ValueView value />` :
    - `list` / `str` → cases (`str` peut aussi s'afficher en texte) ;
    - `con` avec au moins un argument du même nom de type → petit arbre ;
    - autre `con` → `Nom arg…` ;
    - `thunk` → case grise « non calculé » ;
    - `cut` → `…`.
  - Chaque nœud de l'arbre affiche `nom` puis les `ValueView` de ses arguments, et `= ValueView(result)` une fois terminé (maquette validée « A »).
- [ ] **Step 1 : Tests qui échouent** (`layout.test.ts`) : aucun nœud ne se chevauche sur `fib-trace.json` ni sur une trace qsort ; un parent est centré sur ses enfants à ±1 px près ; les positions sont les mêmes pour une étape à 3 nœuds visibles et pour une étape à 9.
- [ ] **Step 2 à 4 : ÉCHEC → implémenter → SUCCÈS.**
- [ ] **Step 5 : Commit** `feat(web): arbre des appels et valeurs`.

---

### Task 10 : Écran complet

**Files :**
- Create : `web/src/App.tsx`, `web/src/components/{Editor,CallStack,Controls,Toolbar}.tsx`, `web/src/examples.ts`, `web/src/api.ts`

**Interfaces :**
- Consumes : tout ce qui précède. `api.ts` : `runCode(code: string): Promise<Trace>` (`POST /api/run`).
- Produces : l'écran de la maquette validée.
  - **Toolbar** : bouton ▶ Exécuter (`Ctrl+Entrée`), menu « Exemples », interrupteur « Tout déplier ».
  - **Disposition** : éditeur Monaco à gauche (1/3), visualisation à droite (2/3). À droite : l'arbre (flex 1) et la pile (≈ 220 px) côte à côte, puis les contrôles, puis la phrase de l'étape, puis la sortie du programme (`stdout`, repliable).
  - **Editor** : marqueurs Monaco pour `diagnostics` (erreur sur la bonne ligne) ; décoration surlignée sur l'`eqSpan` de l'appel courant, sinon sur son `defSpan`. Modifier le code invalide la trace : la visualisation est grisée avec « Code modifié — relance ▶ ».
  - **CallStack** : la pile du haut (appel courant) vers le bas, chaque cadre avec `frameText`. Clic sur un cadre → aller à l'étape d'entrée de cet appel.
  - **Controls** : ⏮ ◀ ▶ ⏭, un curseur, `Étape k / N`, les flèches ← → du clavier, et un bouton ⏵ lecture automatique (1 étape toutes les 600 ms).
  - **Bandeaux de statut** :
    - `limit` : « Arrêté après 5 000 étapes / 10 s — ce qui a été tracé reste visible » ;
    - `runtime-error` : le message en rouge ;
    - `no-main` / `internal-error` : le message ;
    - `compile-error` : « Le code ne compile pas » et la liste des erreurs (cliquer place le curseur dans l'éditeur).
  - **Exemples** (`examples.ts`, avec `main` à chaque fois) : `factorielle` (`fact 5`), `fibonacci` (`fib 5`), `somme d'une liste` (récursive à la main, `[1..5]`), `quicksort` (`[3,1,4,1,5,9,2,6]`, avec `filter` et `++`), `arbre binaire` (`data Arbre`, insertion de `[5,3,8,1,4]` puis parcours infixe), `longueur bugguée` (`longueur [] = 1` au lieu de 0, résultat faux visible), `map/foldr` (`foldr (+) 0 (map (*2) [1,2,3])`).
- [ ] **Step 1 : Vérification manuelle avec le skill `run`.** Lancer `npm run dev`, ouvrir le navigateur et vérifier :
  - chaque exemple s'exécute ;
  - `fibonacci` à l'étape où `fib 1` est appelé par `fib 2` : le nœud est encadré, la pile est correcte, la ligne `fib 1 = 1` est surlignée ;
  - `quicksort` : les cases de listes sont visibles, `filter` est replié, puis déplié après un clic ;
  - `longueur bugguée` : le résultat 6 au lieu de 5 se lit dans l'arbre ;
  - erreur de syntaxe : le marqueur apparaît sur la bonne ligne ;
  - `take 5 [1..]` : affiche `[1,2,3,4,5]` et le reste « non calculé ».
  Faire des captures d'écran.
- [ ] **Step 2 : Corriger ce qui ne va pas, puis refaire la vérification.**
- [ ] **Step 3 : Commit** `feat(web): écran complet`.

---

### Task 11 : Une commande et README

**Files :**
- Modify : `package.json` racine (scripts `dev` : `concurrently "npm -w server run dev" "npm -w web run dev"` ; `build:tracer` : `cd tracer-haskell && cabal build`, lancé avant `dev` par `predev`)
- Create : `README.md` (en français : prérequis GHC 9.10 / cabal / Node ≥ 20, `npm install`, `npm run dev`, ouvrir l'URL affichée, limites connues, ajout d'un langage = implémenter `Tracer`)

- [ ] **Step 1 :** Partir d'un clone propre (`git clone . /tmp/unfold-check`). Lancer `npm install`, puis `npm run dev`. Résultat attendu : le serveur et Vite démarrent, et l'exemple `fibonacci` fonctionne dans le navigateur.
- [ ] **Step 2 :** `npm test` à la racine. Résultat attendu : tous les tests passent.
- [ ] **Step 3 : Commit** `chore: npm run dev et README`.
