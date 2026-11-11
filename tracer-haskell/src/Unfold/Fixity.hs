{-# LANGUAGE RankNTypes, ScopedTypeVariables, TypeApplications #-}
-- | Operator fixity resolution on the parsed AST.
--
-- GHC's parser does not resolve fixities: every operator chain comes out
-- left-nested and the renamer re-associates it later. This pass flattens each
-- chain of 'OpApp' / 'NegApp' and rebuilds it with the algorithm of the
-- Haskell 2010 Report (§10.6), wrapping every rebuilt 'OpApp' (and 'NegApp')
-- in 'HsPar' so that the printed program keeps its grouping whatever later
-- rewrites do to it.
--
-- A chain is only regrouped when the fixity of every operator in it is known
-- ('FixityEnv'). Otherwise — or when the chain is ill-formed (Report §10.6
-- fails, or a section violates §3.5) — the chain is left exactly as parsed,
-- parentheses included, so that GHC itself resolves it or rejects it.
--
-- Known limit: fixity declarations are collected module-wide, including local
-- ones (where / let / class); a local declaration is not scoped to its
-- binding group. To stay safe, a name whose declarations disagree, or that is
-- bound more often than declared with a non-default fixity, or that is both
-- bound locally and imported with another fixity, is treated as unknown.
module Unfold.Fixity
  ( FixityEnv
  , Fix
  , Assoc (..)
  , rdrKey
  , moduleFixities
  , resolveFixities
  ) where

import Data.Data (Data, cast, gmapQ, gmapT)
import Data.Foldable (toList)
import Data.List (nub, (\\))
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe)
import GHC.Hs
import GHC.Types.Fixity (Fixity (..), FixityDirection (..))
import GHC.Types.Name.Occurrence (occNameString)
import GHC.Types.Name.Reader (RdrName (..), rdrNameOcc)
import GHC.Types.SrcLoc (GenLocated (..), unLoc)

data Assoc = AssocL | AssocR | AssocN
  deriving (Eq, Show)

-- | (precedence, associativity)
type Fix = (Int, Assoc)

-- | Operator (or backticked identifier), keyed by 'rdrKey' → its fixity.
-- A name absent from the map has an unknown fixity.
type FixityEnv = Map String Fix

-- | @M.op@ for a qualified name, @op@ otherwise.
rdrKey :: RdrName -> String
rdrKey (Qual m o) = moduleNameString m ++ "." ++ occNameString o
rdrKey r = occNameString (rdrNameOcc r)

-- | Fixity of every operator used in the module (infix or in a section).
--
-- Candidates for a name: the module's @infix*@ declarations for it (or
-- @infixl 9@ if the module binds it without declaring a fixity), plus what
-- @lookupImported@ reports (GHC's view of the imports). A name gets a fixity
-- only when the candidates agree; a qualified name only uses the lookup.
moduleFixities :: Monad m => (RdrName -> m (Maybe Fix)) -> HsModule GhcPs -> m FixityEnv
moduleFixities lookupImported m = Map.fromList . concat <$> mapM entryFor (nubByKey ops)
  where
    ops = [n | e <- collect @(HsExpr GhcPs) m, Just n <- [opName e]]
    nubByKey = Map.elems . Map.fromList . map (\n -> (rdrKey n, n))
    entryFor n = do
      imported <- lookupImported n
      let local = case n of
            Qual _ _ -> []
            _ -> localFix (rdrKey n)
      pure $ case nub (local ++ maybe [] pure imported) of
        [fx] -> [(rdrKey n, fx)]
        _ -> []
    -- A binding without a declaration of its own is infixl 9. Declarations
    -- are not scoped, so when the name is bound more often than declared,
    -- some binding may be undeclared: add infixl 9 as a candidate.
    localFix k =
      let decls = Map.findWithDefault [] k declared
          bound = Map.findWithDefault 0 k binders
       in decls ++ [(9, AssocL) | bound > length decls]
    declared = Map.fromListWith (++)
      [ (occNameString (rdrNameOcc (unLoc n)), [(prec, assoc dir)])
      | FixitySig _ names (Fixity _ prec dir) <- collect @(FixitySig GhcPs) m
      , n <- names
      ]
    binders = Map.fromListWith (+) [(occNameString (rdrNameOcc n), 1 :: Int) | n <- moduleBinders m]
    assoc InfixL = AssocL
    assoc InfixR = AssocR
    assoc InfixN = AssocN

opName :: HsExpr GhcPs -> Maybe RdrName
opName (OpApp _ _ op _) = varName op
opName (SectionL _ _ op) = varName op
opName (SectionR _ op _) = varName op
opName _ = Nothing

varName :: LHsExpr GhcPs -> Maybe RdrName
varName (L _ (HsVar _ (L _ n))) = Just n
varName _ = Nothing

-- | Binding sites of the module, one entry per site: functions, variables
-- (patterns, lambdas), constructors, class methods. Instance methods are not
-- new bindings (they implement the class method) and are left out.
moduleBinders :: HsModule GhcPs -> [RdrName]
moduleBinders m = concat
  [ [unLoc (fun_id b) | b@FunBind{} <- collect @(HsBind GhcPs) m] \\ instanceMethods
  , concatMap patBinders (collect @(Pat GhcPs) m)
  , concatMap conBinders (collect @(ConDecl GhcPs) m)
  , [unLoc n | ClassOpSig _ _ ns _ <- collect @(Sig GhcPs) m, n <- ns]
  ]
  where
    patBinders (VarPat _ n) = [unLoc n]
    patBinders (AsPat _ n _) = [unLoc n]
    patBinders (NPlusKPat _ n _ _ _ _) = [unLoc n]
    patBinders _ = []
    conBinders c@ConDeclH98{} = [unLoc (con_name c)]
    conBinders c@ConDeclGADT{} = map unLoc (foldr (:) [] (con_names c))
    conBinders _ = []
    instanceMethods =
      [ unLoc (fun_id b)
      | d <- collect @(ClsInstDecl GhcPs) m
      , L _ b@FunBind{} <- toList (cid_binds d)
      ]

-- | Re-associate every operator chain of the module (Report §10.6); each
-- resulting 'OpApp' is wrapped in 'HsPar'.
resolveFixities :: FixityEnv -> HsModule GhcPs -> HsModule GhcPs
resolveFixities env = gmapT (transform env)

--------------------------------------------------------------------------------
-- Generic traversal

collect :: forall b a. (Data a, Data b) => a -> [b]
collect x = maybe [] pure (cast x) ++ concat (gmapQ (collect @b) x)

-- | Top-down: an expression is handed to 'resolveExpr', which takes care of
-- its own sub-expressions; anything else is traversed.
transform :: forall a. Data a => FixityEnv -> a -> a
transform env x = case cast x :: Maybe (LHsExpr GhcPs) of
  Just e -> fromMaybe x (cast (resolveExpr env e))
  Nothing -> gmapT (transform env) x

resolveExpr :: FixityEnv -> LHsExpr GhcPs -> LHsExpr GhcPs
resolveExpr env e = case e of
  L _ OpApp{} -> fromMaybe (keep env e) (resolveChain env e)
  -- An already-parenthesised chain: the rebuilt chain brings its own parens.
  L l (HsPar p inner@(L _ OpApp{})) ->
    fromMaybe (L l (HsPar p (keep env inner))) (resolveChain env inner)
  L l (SectionL x arg op) | isChain arg ->
    let toks = flatten arg ++ [TOp op, TExp op]
        legal t = case t of
          Bin i a (Leaf _) | i == opCount toks - 1 -> Just a
          _ -> Nothing
     in L l $ case resolveSection env toks legal of
          Just arg' -> SectionL x arg' (transform env op)
          Nothing -> SectionL x (keep env arg) (transform env op)
  L l (SectionR x op arg) | isChain arg ->
    let toks = [TExp op, TOp op] ++ flatten arg
        legal t = case t of
          Bin 0 (Leaf _) b -> Just b
          _ -> Nothing
     in L l $ case resolveSection env toks legal of
          Just arg' -> SectionR x (transform env op) arg'
          Nothing -> SectionR x (transform env op) (keep env arg)
  _ -> gmapT (transform env) e

isChain :: LHsExpr GhcPs -> Bool
isChain (L _ OpApp{}) = True
isChain (L _ NegApp{}) = True
isChain _ = False

-- | Leave a chain as parsed (parentheses included), only resolving inside
-- its operands.
keep :: FixityEnv -> LHsExpr GhcPs -> LHsExpr GhcPs
keep env (L l (OpApp x a op b)) = L l (OpApp x (keep env a) (transform env op) (keep env b))
keep env (L l (NegApp x a s)) = L l (NegApp x (keep env a) s)
keep env e = resolveExpr env e

--------------------------------------------------------------------------------
-- Report §10.6

data Tok
  = TExp (LHsExpr GhcPs)
  | TNeg (LHsExpr GhcPs -> HsExpr GhcPs)
  | TOp (LHsExpr GhcPs)

-- | Resolved chain; 'Bin' carries the index of its operator in the chain.
data Tree
  = Leaf (LHsExpr GhcPs)
  | Neg (LHsExpr GhcPs -> HsExpr GhcPs) Tree
  | Bin Int Tree Tree

-- | Flatten a (left-nested) chain into tokens; operands are left untouched.
flatten :: LHsExpr GhcPs -> [Tok]
flatten (L _ (OpApp _ l op r)) = flatten l ++ [TOp op] ++ flatten r
flatten (L _ (NegApp x e syn)) = TNeg (\e' -> NegApp x e' syn) : flatten e
flatten e = [TExp e]

opCount :: [Tok] -> Int
opCount toks = length [() | TOp _ <- toks]

-- | Operators of the chain, in order, with their fixities (Nothing if one is unknown).
chainOps :: FixityEnv -> [Tok] -> Maybe [(LHsExpr GhcPs, Fix)]
chainOps env toks = sequence [fmap ((,) op) (fixityOf op) | TOp op <- toks]
  where fixityOf op = varName op >>= \n -> Map.lookup (rdrKey n) env

-- | Resolve a token list: the tree and the operators it indexes.
resolveToks :: FixityEnv -> [Tok] -> Maybe (Tree, [(LHsExpr GhcPs, Fix)])
resolveToks env toks = do
  ops <- chainOps env toks
  (t, rest) <- parseNeg (-1, AssocN) (number ops toks)
  if null rest then Just (t, ops) else Nothing
  where
    number ops = go 0
      where
        go _ [] = []
        go i (TOp _ : ts) = NOp i (snd (ops !! i)) : go (i + 1) ts
        go i (TExp e : ts) = NExp e : go i ts
        go i (TNeg mk : ts) = NNeg mk : go i ts

resolveChain :: FixityEnv -> LHsExpr GhcPs -> Maybe (LHsExpr GhcPs)
resolveChain env e = do
  (t, ops) <- resolveToks env (flatten e)
  Just (build env ops t)

-- | Resolve a section's chain (operand + section operator + placeholder);
-- @legal@ picks the operand subtree out of a §3.5-legal result.
resolveSection :: FixityEnv -> [Tok] -> (Tree -> Maybe Tree) -> Maybe (LHsExpr GhcPs)
resolveSection env toks legal = do
  (t, ops) <- resolveToks env toks
  sub <- legal t
  Just (build env ops sub)

build :: FixityEnv -> [(LHsExpr GhcPs, Fix)] -> Tree -> LHsExpr GhcPs
build env ops = go
  where
    go (Leaf e) = resolveExpr env e
    go (Neg mk t) = par (noLocA (mk (go t)))
    go (Bin i a b) = par (noLocA (OpApp noAnn (go a) (transform env (fst (ops !! i))) (go b)))

par :: LHsExpr GhcPs -> LHsExpr GhcPs
par e = noLocA (HsPar noAnn e)

data NTok = NExp (LHsExpr GhcPs) | NNeg (LHsExpr GhcPs -> HsExpr GhcPs) | NOp Int Fix

type Op = (Int, Fix) -- (index, fixity); index -1 for the virtual operators

parseNeg :: Fix -> [NTok] -> Maybe (Tree, [NTok])
parseNeg op1 = parseNeg' (-1, op1)

parseNeg' :: Op -> [NTok] -> Maybe (Tree, [NTok])
parseNeg' op1 (NExp e1 : rest) = parse1 op1 (Leaf e1) rest
parseNeg' op1@(_, (prec1, _)) (NNeg mk : rest)
  | prec1 < 6 = do
      (r, rest') <- parseNeg' (-1, (6, AssocL)) rest
      parse1 op1 (Neg mk r) rest'
parseNeg' _ _ = Nothing

parse1 :: Op -> Tree -> [NTok] -> Maybe (Tree, [NTok])
parse1 _ e1 [] = Just (e1, [])
parse1 op1@(_, (prec1, fix1)) e1 toks@(NOp i2 fx2@(prec2, fix2) : rest)
  | prec1 == prec2 && (fix1 /= fix2 || fix1 == AssocN) = Nothing
  | prec1 > prec2 || (prec1 == prec2 && fix1 == AssocL) = Just (e1, toks)
  | otherwise = do
      (r, rest') <- parseNeg' (i2, fx2) rest
      parse1 op1 (Bin i2 e1 r) rest'
parse1 _ _ _ = Nothing
