{-# LANGUAGE GADTs, RankNTypes, ScopedTypeVariables, TypeApplications #-}
-- | Instrumentation of the user's functions.
--
-- Every traced function @f@ (alphanumeric name, at least one pattern; top
-- level, @where@ or @let@) becomes three bindings:
--
-- > f       :: <original type>                 -- fallback alias, dynamic parent
-- > f a1 … an = UnfoldRuntime.callDyn fid [val a1, …] (\c -> f__u c a1 … an)
-- > f__w    :: <context> => Ctx -> <type>      -- lexical parent
-- > f__w ctx a1 … an = UnfoldRuntime.call ctx fid [val a1, …] (\c -> f__u c a1 … an)
-- > f__u    :: <context> => Int -> <type>      -- the original equations
-- > f__u c <patterns> | <guards> = UnfoldRuntime.eq c eqid (<rewritten rhs>)
--
-- An occurrence of @f@ in scope (not shadowed) becomes
-- @(f__w (UnfoldRuntime.Ctx c sid))@, @c@ being the id of the enclosing traced
-- call (0 in @main@ and other top-level values). Any occurrence left alone
-- still refers to the alias, which compiles and is traced with the dynamic
-- parent: leaving an occurrence alone is always safe, rewriting one under a
-- binder of the same name is not. Hence every construct that binds names is
-- handled explicitly, and constructs this module does not know are left
-- untouched.
--
-- Lambdas (@\\p1 … pk -> e@) become calls of a node named @λ@.
module Unfold.Rewrite (instrumentModule) where

import Control.Monad.Trans.State.Strict (State, gets, modify', runState)
import Data.Char (isSpace)
import Data.Data (Data, gmapM, gmapQ, cast, (:~:) (..), eqT)
import qualified Data.IntMap.Strict as IM
import Data.List (isPrefixOf, sortBy)
import qualified Data.Map.Strict as Map
import Data.Maybe (isJust)
import Data.Set (Set)
import qualified Data.Set as Set
import GHC.Data.Bag (bagToList, listToBag)
import GHC.Hs
import GHC.Types.Basic (Boxity (..), Origin (..), appPrec)
import GHC.Types.Fixity (LexicalFixity (..))
import GHC.Types.Name.Occurrence (isSymOcc, mkDataOcc, mkTcOcc, mkVarOcc, occNameString)
import GHC.Types.Name.Reader (RdrName (..), isUnqual, mkRdrQual, mkRdrUnqual, rdrNameOcc)
import GHC.Types.SrcLoc

import Unfold.Meta

--------------------------------------------------------------------------------
-- Configuration, scope, state

data Cfg = Cfg
  { cResolved :: Set RealSrcSpan -- ^ operators of the chains whose grouping is explicit
  , cLines :: IM.IntMap String -- ^ source lines, 1-based
  , cPre :: String -- ^ prefix of generated variables (no user name starts with it)
  , cSufW, cSufU :: String -- ^ suffixes of the generated functions
  , cMonoLocal :: Bool -- ^ MonoLocalBinds is on
  }

data Env = Env
  { eCfg :: Cfg
  , eScope :: Map.Map String RdrName -- ^ traced functions in scope → their @__w@ name
  , eParent :: Maybe RdrName -- ^ variable holding the current call id; Nothing = 0
  }

data St = St {sFid, sSid, sEq :: !Int, sMeta :: Meta}

type RW = State St

-- | Rewrite the module; Left "no-main" if it has no top-level @main@.
-- Arguments: MonoLocalBinds on?, operators of the resolved chains, source text.
instrumentModule :: Bool -> Set RealSrcSpan -> String -> HsModule GhcPs -> Either String (HsModule GhcPs, Meta)
instrumentModule monoLocal resolved src m
  | not hasMain = Left "no-main"
  | otherwise = Right (m {hsmodDecls = decls', hsmodImports = hsmodImports m ++ runtimeImports}, sMeta st)
  where
    decls = hsmodDecls m
    hasMain = or [isMain (fun_id b) | L _ (ValD _ b@FunBind{}) <- decls]
    names = Set.fromList [occNameString (rdrNameOcc n) | n <- collect @RdrName m]
    traced = [occNameString (rdrNameOcc n) | b <- collect @(HsBind GhcPs) m, Just n <- [tracedName b]]
    pre = firstOf [p | p <- "_unfold" : ["_unfold" ++ show i | i <- [1 :: Int ..]], not (any (p `isPrefixOf`) (Set.toList names))]
    (sw, su) =
      firstOf
        [ (w, u)
        | i <- "" : map show [1 :: Int ..]
        , let w = "__w" ++ i
              u = "__u" ++ i
        , all (\t -> Set.notMember (t ++ w) names && Set.notMember (t ++ u) names) traced
        ]
    cfg = Cfg resolved (IM.fromList (zip [1 ..] (lines src))) pre sw su monoLocal
    topTraced = [n | L _ (ValD _ b) <- decls, Just n <- [tracedName b]]
    env0 = Env cfg (Map.fromList [(key n, wName cfg n) | n <- topTraced]) Nothing
    trSet = Set.fromList (map key topTraced)
    (decls', st) = runState (concat <$> mapM (rwTopDecl env0 trSet) decls) (St 1 1 1 emptyMeta)

-- | First element of an infinite list.
firstOf :: [a] -> a
firstOf = foldr const (error "firstOf: empty")

runtimeImports :: [LImportDecl GhcPs]
runtimeImports =
  [ noLocA (simpleImportDecl rtMod) {ideclQualified = QualifiedPre}
  , -- for the @Int@ of the @__u@ signatures, whatever the user's Prelude
    noLocA (simpleImportDecl (mkModuleName "Data.Int")) {ideclQualified = QualifiedPre, ideclAs = Just (noLocA rtMod)}
  ]

rtMod :: ModuleName
rtMod = mkModuleName "UnfoldRuntime"

isMain :: LIdP GhcPs -> Bool
isMain (L _ n) = isUnqual n && occNameString (rdrNameOcc n) == "main"

key :: RdrName -> String
key = occNameString . rdrNameOcc

-- | A traced function: alphanumeric, unqualified, at least one pattern.
tracedName :: HsBind GhcPs -> Maybe RdrName
tracedName FunBind {fun_id = L _ n, fun_matches = MG _ (L _ (L _ Match {m_pats = _ : _} : _))}
  | isUnqual n, not (isSymOcc (rdrNameOcc n)) = Just n
tracedName _ = Nothing

wName, uName :: Cfg -> RdrName -> RdrName
wName cfg n = mkRdrUnqual (mkVarOcc (key n ++ cSufW cfg))
uName cfg n = mkRdrUnqual (mkVarOcc (key n ++ cSufU cfg))

gen :: Cfg -> String -> RdrName
gen cfg s = mkRdrUnqual (mkVarOcc (cPre cfg ++ s))

lookupTraced :: Env -> RdrName -> Maybe RdrName
lookupTraced env n
  | isUnqual n = Map.lookup (key n) (eScope env)
  | otherwise = Nothing

-- | Remove the names bound by some patterns from the scope. A record
-- wildcard binds names we cannot see: then nothing is rewritten below it.
shadowPats :: [LPat GhcPs] -> Env -> Env
shadowPats pats env
  | any (isJust . rec_dotdot) (collect @(HsRecFields GhcPs (LPat GhcPs)) pats) = env {eScope = Map.empty}
  | otherwise = shadow (patsBinders pats) env

shadow :: [RdrName] -> Env -> Env
shadow ns env = env {eScope = foldr (Map.delete . key) (eScope env) ns}

-- | Names bound by patterns (over-approximation: any variable pattern inside).
patsBinders :: Data a => a -> [RdrName]
patsBinders ps = concatMap binder (collect @(Pat GhcPs) ps)
  where
    binder (VarPat _ n) = [unLoc n]
    binder (AsPat _ n _) = [unLoc n]
    binder (NPlusKPat _ n _ _ _ _) = [unLoc n]
    binder _ = []

--------------------------------------------------------------------------------
-- Ids and META

newFid :: FunMeta -> RW Int
newFid f = do
  i <- gets sFid
  modify' (\s -> s {sFid = i + 1, sMeta = (sMeta s) {mFunctions = (i, f) : mFunctions (sMeta s)}})
  pure i

newSite :: Cfg -> SrcSpan -> RW Int
newSite cfg sp = do
  i <- gets sSid
  modify' (\s -> s {sSid = i + 1, sMeta = (sMeta s) {mSites = (i, toSpan cfg sp) : mSites (sMeta s)}})
  pure i

newEq :: EqMeta -> RW Int
newEq e = do
  i <- gets sEq
  modify' (\s -> s {sEq = i + 1, sMeta = (sMeta s) {mEquations = (i, e) : mEquations (sMeta s)}})
  pure i

-- | META span of a GHC span: columns converted to UTF-16 code units.
toSpan :: Cfg -> SrcSpan -> Maybe Span
toSpan cfg = fmap (toSpanR cfg) . realSpan

toSpanR :: Cfg -> RealSrcSpan -> Span
toSpanR cfg s =
  Span (srcSpanStartLine s) (utf16Col cfg (startOf s)) (srcSpanEndLine s) (utf16Col cfg (endOf s))

-- | 1-based column in UTF-16 code units of a (line, GHC column) position.
-- GHC counts one column per code point and moves a tab to the next multiple of 8.
utf16Col :: Cfg -> (Int, Int) -> Int
utf16Col cfg (l, c) = 1 + sum [if fromEnum ch > 0xFFFF then 2 else 1 | ch <- take (charIndex c line) line]
  where
    line = IM.findWithDefault "" l (cLines cfg)

-- | Character index in a line of a GHC column.
charIndex :: Int -> String -> Int
charIndex c = go 1 0
  where
    go col i rest
      | col >= c = i
      | otherwise = case rest of
          [] -> i
          ch : rest' -> go (if ch == '\t' then ((col - 1) `div` 8 + 1) * 8 + 1 else col + 1) (i + 1) rest'

realSpan :: SrcSpan -> Maybe RealSrcSpan
realSpan (RealSrcSpan s _) = Just s
realSpan _ = Nothing

-- | Source text between two positions (line, GHC column; end exclusive).
slice :: Cfg -> (Int, Int) -> (Int, Int) -> String
slice cfg (l1, c1) (l2, c2)
  | l1 == l2 = cut c2 (drop' c1 (line l1))
  | otherwise = unlines' ([drop' c1 (line l1)] ++ map line [l1 + 1 .. l2 - 1] ++ [take' c2 (line l2)])
  where
    line l = IM.findWithDefault "" l (cLines cfg)
    unlines' = foldr1 (\a b -> a ++ "\n" ++ b)
    drop' c s = drop (charIndex c s) s
    take' c s = take (charIndex c s) s
    cut c s = take (charIndex c (line l1) - charIndex c1 (line l1)) s

startOf, endOf :: RealSrcSpan -> (Int, Int)
startOf s = (srcSpanStartLine s, srcSpanStartCol s)
endOf s = (srcSpanEndLine s, srcSpanEndCol s)

trim :: String -> String
trim = reverse . dropWhile isSpace . reverse . dropWhile isSpace

--------------------------------------------------------------------------------
-- Declarations and bindings

rwTopDecl :: Env -> Set String -> LHsDecl GhcPs -> RW [LHsDecl GhcPs]
rwTopDecl env tr (L l d) = case d of
  ValD x b -> map (\(L l' b') -> L (if isGoodSrcSpan (locA l') then l' else l) (ValD x b')) <$> rwBind env True (L l b)
  SigD x s -> pure [L l (SigD x s') | s' <- splitSig (eCfg env) tr s]
  _ -> pure [L l d]

-- | Rewrite one binding; a traced function yields its three bindings.
--
-- Under MonoLocalBinds, a local value binding is generalised only if it is
-- closed; rewriting its occurrences would make it mention the enclosing call
-- id, so it is left alone (its occurrences go through the aliases).
rwBind :: Env -> Bool -> LHsBind GhcPs -> RW [LHsBind GhcPs]
rwBind env top lb@(L l b) = case b of
  _ | not top, cMonoLocal (eCfg env), Nothing <- tracedName b -> pure [lb]
  FunBind {fun_matches = mg}
    | Just n <- tracedName b -> traceFun env l n b
    | top && isMain (fun_id b) -> one <$> rwMatchesWith env WrapMain mg
    | [] <- matchPats mg -> one <$> rwMatchesWith env NoWrap mg
    | otherwise -> pure [lb] -- user operator: Task 5
    where
      one mg' = [L l (FunBind (fun_ext b) (fun_id b) mg')]
  PatBind {pat_rhs = rhs} -> do
    rhs' <- rwGRHSs env NoWrap rhs
    pure [L l b {pat_rhs = rhs'}]
  _ -> pure [lb]
  where
    matchPats (MG _ (L _ (L _ mt : _))) = m_pats mt
    matchPats _ = []

data Wrap = NoWrap | WrapMain | WrapEq Int RdrName (Maybe RealSrcSpan) -- ^ fid, call id var, match span

-- | Rewrite the bodies of a function binding's equations (no patterns to shadow
-- for nullary bindings and @main@).
rwMatchesWith :: Env -> Wrap -> MatchGroup GhcPs (LHsExpr GhcPs) -> RW (MatchGroup GhcPs (LHsExpr GhcPs))
rwMatchesWith env wrap (MG x (L la ms)) = MG x . L la <$> mapM one ms
  where
    one (L lm mt) = do
      g <- rwGRHSs (shadowPats (m_pats mt) env) wrap (m_grhss mt)
      pure (L lm mt {m_grhss = g})

traceFun :: Env -> SrcSpanAnnA -> RdrName -> HsBind GhcPs -> RW [LHsBind GhcPs]
traceFun env l n b = do
  let cfg = eCfg env
      MG mx (L la ms) = fun_matches b
      arity = case ms of
        L _ mt : _ -> length (m_pats mt)
        [] -> 0
      args = [gen cfg ("_a" ++ show i) | i <- [1 .. arity]]
      c = gen cfg "_c"
      ctxV = gen cfg "_ctx"
      w = wName cfg n
      u = uName cfg n
      body = par (lam [c] (apps (var u) (map var (c : args))))
  fid <- newFid (FunMeta (key n) "user" (toSpan cfg (locA l)))
  ms' <- mapM (traceMatch env fid c u) ms
  pure
    [ L l (simpleFun n args (apps (var (rt "callDyn")) [intE fid, valList args, body]))
    , noLocA (simpleFun w (ctxV : args) (apps (var (rt "call")) [var ctxV, intE fid, valList args, body]))
    , noLocA (FunBind (fun_ext b) (noLocA u) (MG mx (L la ms')))
    ]

traceMatch :: Env -> Int -> RdrName -> RdrName -> LMatch GhcPs (LHsExpr GhcPs) -> RW (LMatch GhcPs (LHsExpr GhcPs))
traceMatch env fid c u (L lm mt) = do
  let env' = (shadowPats (m_pats mt) env) {eParent = Just c}
      ctxt = case m_ctxt mt of
        FunRhs {} -> FunRhs (noLocA u) Prefix NoSrcStrict
        other -> other
  g <- rwGRHSs env' (WrapEq fid c (realSpan (locA lm))) (m_grhss mt)
  pure (L lm mt {m_ctxt = ctxt, m_pats = nlVarPat c : map (parenthesizePat appPrec) (m_pats mt), m_grhss = g})

simpleFun :: RdrName -> [RdrName] -> LHsExpr GhcPs -> HsBind GhcPs
simpleFun n params rhs =
  FunBind
    { fun_ext = noExtField
    , fun_id = noLocA n
    , fun_matches = MG FromSource (noLocA [noLocA (Match noAnn (FunRhs (noLocA n) Prefix NoSrcStrict) (map nlVarPat params) (simpleGRHSs rhs))])
    }

simpleGRHSs :: LHsExpr GhcPs -> GRHSs GhcPs (LHsExpr GhcPs)
simpleGRHSs rhs = GRHSs emptyComments [noLocA (GRHS noAnn [] rhs)] (EmptyLocalBinds noExtField)

-- | One signature per name; a traced name also gets the @__w@ and @__u@ ones.
splitSig :: Cfg -> Set String -> Sig GhcPs -> [Sig GhcPs]
splitSig cfg tr (TypeSig x ns ty)
  | any ((`Set.member` tr) . key . unLoc) ns = concatMap one ns
  where
    one ln@(L _ n)
      | key n `Set.member` tr =
          [ TypeSig x [ln] ty
          , TypeSig x [noLocA (wName cfg n)] (addArg (tyCon "Ctx") ty)
          , TypeSig x [noLocA (uName cfg n)] (addArg (tyCon "Int") ty)
          ]
      | otherwise = [TypeSig x [ln] ty]
    tyCon s = nlHsTyVar NotPromoted (mkRdrQual rtMod (mkTcOcc s))
splitSig _ _ s = [s]

-- | Add an argument in front of a signature's type, after its foralls and contexts.
addArg :: LHsType GhcPs -> LHsSigWcType GhcPs -> LHsSigWcType GhcPs
addArg a (HsWC x (L l (HsSig x' bndrs body))) = HsWC x (L l (HsSig x' bndrs (go body)))
  where
    go (L l' (HsForAllTy x'' tele t)) = L l' (HsForAllTy x'' tele (go t))
    go (L l' (HsQualTy x'' ctx t)) = L l' (HsQualTy x'' ctx (go t))
    go (L l' (HsParTy x'' t)) = L l' (HsParTy x'' (go t))
    go t = nlHsFunTy a t

-- | Scope of a binding group: its traced functions are added, its other binders shadow.
bindsEnv :: Env -> HsLocalBinds GhcPs -> Env
bindsEnv env (HsValBinds _ (ValBinds _ binds _)) = foldl add env (bagToList binds)
  where
    add e (L _ b) = case tracedName b of
      Just n -> e {eScope = Map.insert (key n) (wName (eCfg env) n) (eScope e)}
      Nothing -> case b of
        FunBind {fun_id = L _ n} -> shadow [n] e
        PatBind {pat_lhs = p} -> shadowPats [p] e
        _ -> e
bindsEnv env _ = env

-- | Rewrite a binding group (its scope @env@ comes from 'bindsEnv').
rwLocalBinds :: Env -> HsLocalBinds GhcPs -> RW (HsLocalBinds GhcPs)
rwLocalBinds env (HsValBinds x (ValBinds y binds sigs)) = do
  let ordered = sortBy (\a b -> leftmost_smallest (getLocA a) (getLocA b)) (bagToList binds)
      tr = Set.fromList [key n | L _ b <- ordered, Just n <- [tracedName b]]
  binds' <- concat <$> mapM (rwBind env False) ordered
  pure (HsValBinds x (ValBinds y (listToBag binds') [L l s' | L l s <- sigs, s' <- splitSig (eCfg env) tr s]))
rwLocalBinds _ b = pure b

--------------------------------------------------------------------------------
-- Right-hand sides, guards, statements

rwGRHSs :: Env -> Wrap -> GRHSs GhcPs (LHsExpr GhcPs) -> RW (GRHSs GhcPs (LHsExpr GhcPs))
rwGRHSs env wrap (GRHSs x grhss binds) = do
  let env' = bindsEnv env binds
      firstStart = case grhss of
        g : _ -> realSpan (getLocA g)
        [] -> Nothing
  grhss' <- mapM (rwGRHS env' wrap firstStart) grhss
  binds' <- rwLocalBinds env' binds
  pure (GRHSs x grhss' binds')

rwGRHS :: Env -> Wrap -> Maybe RealSrcSpan -> LGRHS GhcPs (LHsExpr GhcPs) -> RW (LGRHS GhcPs (LHsExpr GhcPs))
rwGRHS env wrap firstGrhs (L lg (GRHS x guards body)) = do
  mEq <- case wrap of
    WrapEq fid c mspan -> do
      let cfg = eCfg env
          rhs = realSpan (getLocA body)
          grhs = realSpan (locA lg)
          (eqSpan, eqText) = case (mspan, rhs, grhs, firstGrhs) of
            (Just ms, Just r, Just g, Just g1)
              | null guards -> (Just (mkRealSrcSpan (realSrcSpanStart ms) (realSrcSpanEnd r)), slice cfg (startOf ms) (endOf r))
              | otherwise ->
                  ( Just (mkRealSrcSpan (realSrcSpanStart g) (realSrcSpanEnd r))
                  , trim (slice cfg (startOf ms) (startOf g1)) ++ " " ++ slice cfg (startOf g) (endOf r)
                  )
            _ -> (Nothing, "")
      eid <- newEq (EqMeta fid (toSpanR cfg <$> eqSpan) (toSpanR cfg <$> rhs) (maybe "" (\r -> slice cfg (startOf r) (endOf r)) rhs) eqText)
      pure (Just (c, eid))
    _ -> pure Nothing
  (env', guards') <- rwStmts env guards
  body' <- rwE env' body
  let body'' = case (wrap, mEq) of
        (_, Just (c, eid)) -> apps (var (rt "eq")) [var c, intE eid, par body']
        (WrapMain, _) -> apps (var (rt "runMain")) [par body']
        _ -> body'
  pure (L lg (GRHS x guards' body''))

-- | Statements of a guard, @do@ block or comprehension, in order: each one
-- sees the binders of the previous ones.
rwStmts :: Env -> [ExprLStmt GhcPs] -> RW (Env, [ExprLStmt GhcPs])
rwStmts env [] = pure (env, [])
rwStmts env (L l s : rest) = do
  (env', s') <- case s of
    BindStmt x p e -> do
      e' <- rwE env e
      pure (shadowPats [p] env, BindStmt x p e')
    BodyStmt x e a b -> do
      e' <- rwE env e
      pure (env, BodyStmt x e' a b)
    LastStmt x e a b -> do
      e' <- rwE env e
      pure (env, LastStmt x e' a b)
    LetStmt x binds -> do
      let env1 = bindsEnv env binds
      binds' <- rwLocalBinds env1 binds
      pure (env1, LetStmt x binds')
    -- unknown statement: left alone, and nothing is rewritten after it
    _ -> pure (env {eScope = Map.empty}, s)
  (env'', rest') <- rwStmts env' rest
  pure (env'', L l s' : rest')

simpleStmt :: ExprLStmt GhcPs -> Bool
simpleStmt (L _ s) = case s of
  BindStmt {} -> True
  BodyStmt {} -> True
  LastStmt {} -> True
  LetStmt {} -> True
  _ -> False

--------------------------------------------------------------------------------
-- Expressions

rwE :: Env -> LHsExpr GhcPs -> RW (LHsExpr GhcPs)
rwE env e@(L l ex) = case ex of
  HsVar _ (L _ n) | Just w <- lookupTraced env n -> occ env w <$> newSite cfg (locA l)
  HsApp {} -> rwApp env e
  HsAppType {} -> rwApp env e
  HsPar x inner -> L l . HsPar x <$> rwE env inner
  OpApp x a op b
    | Just w <- tracedOp op, resolvedOp op -> do
        a' <- rwE env a
        sid <- newSite cfg (locA l)
        b' <- rwE env b
        pure (L l (HsPar noAnn (apps (occ env w sid) [par a', par b'])))
    | otherwise -> do
        a' <- rwE env a
        b' <- rwE env b
        pure (L l (OpApp x a' op b'))
  SectionL x a op
    | Just w <- tracedOp op, not (isChain a) || resolvedOp op -> do
        a' <- rwE env a
        sid <- newSite cfg (locA l)
        pure (L l (HsPar noAnn (apps (occ env w sid) [par a'])))
    | otherwise -> (\a' -> L l (SectionL x a' op)) <$> rwE env a
  SectionR x op b
    | Just w <- tracedOp op, not (isChain b) || resolvedOp op -> do
        sid <- newSite cfg (locA l)
        b' <- rwE env b
        let s = gen cfg "_s"
            y = gen cfg "_x"
        -- (`f` b) = \y -> f y b, b shared between the calls
        pure (L l (HsPar noAnn (apps (par (lam [s, y] (apps (occ env w sid) [var y, var s]))) [par b'])))
    | otherwise -> L l . SectionR x op <$> rwE env b
  HsLam x LamSingle mg -> rwLambda env e x mg
  HsLam x v mg -> L l . HsLam x v <$> rwMatches env mg
  HsCase x scrut mg -> do
    scrut' <- rwE env scrut
    L l . HsCase x scrut' <$> rwMatches env mg
  HsMultiIf x grhss -> L l . HsMultiIf x <$> mapM (rwGRHS env NoWrap Nothing) grhss
  HsLet x binds body -> do
    let env' = bindsEnv env binds
    binds' <- rwLocalBinds env' binds
    body' <- rwE env' body
    -- parenthesised: printed across lines, a @let … in@ that starts a @do@
    -- statement would have its @in@ at the statement's column
    pure (L l (HsPar noAnn (L l (HsLet x binds' body'))))
  HsDo x flav (L ls stmts)
    | simpleFlavour flav, all simpleStmt stmts -> L l . HsDo x flav . L ls . snd <$> rwStmts env stmts
    | otherwise -> pure e
  -- constructs that bind nothing: rewrite the expressions inside
  NegApp {} -> generic
  ExplicitTuple {} -> generic
  ExplicitSum {} -> generic
  HsIf {} -> generic
  ExplicitList {} -> generic
  RecordCon {} -> generic
  RecordUpd {} -> generic
  HsGetField {} -> generic
  ExprWithTySig {} -> generic
  ArithSeq {} -> generic
  HsPragE {} -> generic
  _ -> pure e
  where
    generic = L l <$> gmapM (walk env) ex
    cfg = eCfg env
    tracedOp (L _ (HsVar _ (L _ n))) = lookupTraced env n
    tracedOp _ = Nothing
    resolvedOp op = maybe False (`Set.member` cResolved cfg) (realSpan (getLocA op))
    simpleFlavour f = case f of
      DoExpr _ -> True
      ListComp -> True
      MonadComp -> True
      _ -> False

isChain :: LHsExpr GhcPs -> Bool
isChain (L _ OpApp {}) = True
isChain (L _ NegApp {}) = True
isChain _ = False

-- | Generic descent through constructs that bind nothing: stops at every
-- expression (handed to 'rwE') and never enters patterns or binding groups.
walk :: forall d. Data d => Env -> d -> RW d
walk env x
  | Just Refl <- eqT @d @(LHsExpr GhcPs) = rwE env x
  | Just Refl <- eqT @d @(LPat GhcPs) = pure x
  | Just Refl <- eqT @d @(HsLocalBinds GhcPs) = pure x
  | Just Refl <- eqT @d @(MatchGroup GhcPs (LHsExpr GhcPs)) = pure x
  | Just Refl <- eqT @d @(ExprLStmt GhcPs) = pure x
  -- a pun (@C {f}@) is printed as its label: a rewrite there would not show
  | Just Refl <- eqT @d @(HsRecField GhcPs (LHsExpr GhcPs)), hfbPun x = pure x
  | Just Refl <- eqT @d @(HsRecUpdField GhcPs GhcPs), hfbPun x = pure x
  | otherwise = gmapM (walk env) x

-- | Application: when its head is a traced function, the site spans the
-- whole application (@fib (n-1)@).
rwApp :: Env -> LHsExpr GhcPs -> RW (LHsExpr GhcPs)
rwApp env e@(L l _) = case spineHead e of
  (L _ (HsVar _ (L _ n)), False) | Just w <- lookupTraced env n -> do
    sid <- newSite (eCfg env) (locA l)
    args (occ env w sid) e
  (L _ (HsVar _ (L _ n)), True) | isJust (lookupTraced env n) -> args (fst (spineHead e)) e
  _ -> case e of
    L _ (HsApp x f a) -> L l <$> (HsApp x <$> rwE env f <*> rwE env a)
    L _ (HsAppType x f t) -> (\f' -> L l (HsAppType x f' t)) <$> rwE env f
    _ -> rwE env e
  where
    -- the head replaced by @hd@, the arguments rewritten
    args hd (L l' (HsApp x f a)) = do
      f' <- args hd f
      a' <- rwE env a
      pure (L l' (HsApp x f' a'))
    args hd (L l' (HsAppType x f t)) = (\f' -> L l' (HsAppType x f' t)) <$> args hd f
    args hd _ = pure hd

-- | Head of an application spine, and whether the spine has a type
-- application (@f \@Int x@ must keep @f@: the alias has the original type).
spineHead :: LHsExpr GhcPs -> (LHsExpr GhcPs, Bool)
spineHead (L _ (HsApp _ f _)) = spineHead f
spineHead (L _ (HsAppType _ f _)) = (fst (spineHead f), True)
spineHead e = (e, False)

-- | Case alternatives, @\\case@, @\\cases@: patterns shadow, nothing is traced.
rwMatches :: Env -> MatchGroup GhcPs (LHsExpr GhcPs) -> RW (MatchGroup GhcPs (LHsExpr GhcPs))
rwMatches env = rwMatchesWith env NoWrap

-- | @\\p1 … pk -> e@ becomes
-- @\\a1 … ak -> call (Ctx c sid) fid [val a1, …] (\\c -> case (ai, …) of (pi, …) -> e')@
-- where only the non-variable patterns go through the @case@ (a variable
-- pattern is its own argument).
rwLambda :: Env -> LHsExpr GhcPs -> XLam GhcPs -> MatchGroup GhcPs (LHsExpr GhcPs) -> RW (LHsExpr GhcPs)
rwLambda env (L l _) x mg = case mg of
  MG mx (L la [L lm mt@Match {m_pats = pats@(_ : _), m_grhss = GRHSs gx [L lg (GRHS grx [] body)] (EmptyLocalBinds ex)}]) -> do
    let cfg = eCfg env
        c = gen cfg "_c"
        argName i p = case unLoc p of
          VarPat _ (L _ v) -> (v, Nothing)
          WildPat _ -> (gen cfg ("_l" ++ show i), Nothing)
          _ -> (gen cfg ("_l" ++ show i), Just p)
        named = zipWith argName [1 :: Int ..] pats
        names = map fst named
        matched = [(v, p) | (v, Just p) <- named]
        env' = (shadowPats pats env) {eParent = Just c}
    fid <- newFid (FunMeta "λ" "lambda" (toSpan cfg (locA l)))
    sid <- newSite cfg (locA l)
    body' <- rwE env' body
    let grhss b = GRHSs gx [L lg (GRHS grx [] b)] (EmptyLocalBinds ex)
        inner = case matched of
          [] -> body'
          [(v, p)] -> caseOf (var v) p
          _ -> caseOf (mkLHsVarTuple (map fst matched) noAnn) (nlTuplePat (map snd matched) Boxed)
        caseOf scrut p = noLocA (HsCase noAnn scrut (MG mx (L la [L lm mt {m_ctxt = CaseAlt, m_pats = [p], m_grhss = grhss body'}])))
        call = apps (var (rt "call")) [ctxE env sid, intE fid, valList names, par (lam [c] inner)]
    pure (L l (HsLam x LamSingle (MG mx (L la [L lm mt {m_pats = map nlVarPat names, m_grhss = grhss call}]))))
  _ -> L l . HsLam x LamSingle <$> rwMatches env mg

--------------------------------------------------------------------------------
-- Building expressions

rt :: String -> RdrName
rt = mkRdrQual rtMod . mkVarOcc

var :: RdrName -> LHsExpr GhcPs
var = nlHsVar

intE :: Int -> LHsExpr GhcPs
intE = nlHsIntLit . fromIntegral

par :: LHsExpr GhcPs -> LHsExpr GhcPs
par = nlHsPar

-- | @f a b …@, each argument parenthesised if needed.
apps :: LHsExpr GhcPs -> [LHsExpr GhcPs] -> LHsExpr GhcPs
apps = foldl (\f a -> noLocA (HsApp noExtField f (parenthesizeHsExpr appPrec a)))

lam :: [RdrName] -> LHsExpr GhcPs -> LHsExpr GhcPs
lam ns = mkHsLam (map nlVarPat ns)

valList :: [RdrName] -> LHsExpr GhcPs
valList ns = nlList [apps (var (rt "val")) [var n] | n <- ns]

ctxE :: Env -> Int -> LHsExpr GhcPs
ctxE env sid = apps (var (mkRdrQual rtMod (mkDataOcc "Ctx"))) [maybe (intE 0) var (eParent env), intE sid]

-- | A rewritten occurrence: @(f__w (UnfoldRuntime.Ctx c sid))@.
occ :: Env -> RdrName -> Int -> LHsExpr GhcPs
occ env w sid = par (apps (var w) [ctxE env sid])

--------------------------------------------------------------------------------

collect :: forall b a. (Data a, Data b) => a -> [b]
collect x = maybe [] pure (cast x) ++ concat (gmapQ (collect @b) x)
