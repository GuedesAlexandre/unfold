{-# LANGUAGE RankNTypes, ScopedTypeVariables, TypeApplications #-}
-- | Operator fixity resolution on the parsed AST.
--
-- GHC's parser does not resolve fixities: every operator chain comes out
-- left-nested and the renamer re-associates it later. This pass flattens each
-- chain of 'OpApp' / 'NegApp' and rebuilds it with the algorithm of the
-- Haskell 2010 Report (§10.6), wrapping every rebuilt 'OpApp' (and 'NegApp')
-- in 'HsPar' so that the printed program keeps its grouping whatever later
-- rewrites do to it.
module Unfold.Fixity
  ( FixityEnv
  , Assoc (..)
  , baseFixities
  , moduleFixities
  , resolveFixities
  ) where

import Data.Data (Data, cast, gmapQ, gmapT)
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Maybe (fromMaybe)
import GHC.Hs
import GHC.Types.Fixity (Fixity (..), FixityDirection (..))
import GHC.Types.Name.Occurrence (occNameString)
import GHC.Types.Name.Reader (rdrNameOcc)
import GHC.Types.SrcLoc (GenLocated (..), unLoc)

data Assoc = AssocL | AssocR | AssocN
  deriving (Eq, Show)

-- | Operator (or backticked identifier) name → (precedence, associativity).
type FixityEnv = Map String (Int, Assoc)

-- | Fixities of the Prelude / base operators we know about.
baseFixities :: FixityEnv
baseFixities = Map.fromList $ concat
  [ ops 9 AssocR ["."]
  , ops 8 AssocR ["^", "^^", "**"]
  , ops 7 AssocL ["*", "/", "div", "mod", "rem", "quot"]
  , ops 6 AssocL ["+", "-"]
  , ops 5 AssocR [":", "++"]
  , ops 4 AssocN ["==", "/=", "<", "<=", ">", ">=", "elem", "notElem"]
  , ops 4 AssocL ["<$>", "<$", "<*>", "*>", "<*"]
  , ops 3 AssocR ["&&"]
  , ops 2 AssocR ["||"]
  , ops 1 AssocL [">>", ">>="]
  , ops 1 AssocR ["=<<"]
  , ops 0 AssocR ["$", "$!", "seq"]
  , ops 9 AssocL ["!!", "!"]
  ]
  where ops p a = map (\n -> (n, (p, a)))

-- | 'baseFixities' extended (and overridden) by every @infix@/@infixl@/@infixr@
-- declaration of the module, top-level or local (where / let / class).
-- Local declarations are treated as module-wide.
moduleFixities :: HsModule GhcPs -> FixityEnv
moduleFixities m = Map.union declared baseFixities
  where
    declared = Map.fromList
      [ (occNameString (rdrNameOcc (unLoc n)), (prec, assoc dir))
      | FixitySig _ names (Fixity _ prec dir) <- collect @(FixitySig GhcPs) m
      , n <- names
      ]
    assoc InfixL = AssocL
    assoc InfixR = AssocR
    assoc InfixN = AssocN

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
  L _ OpApp{} -> resolveChain env e
  -- An already-parenthesised chain: the rebuilt chain brings its own parens.
  L _ (HsPar _ inner@(L _ OpApp{})) -> resolveChain env inner
  _ -> gmapT (transform env) e

--------------------------------------------------------------------------------
-- Report §10.6

data Tok
  = TExp (LHsExpr GhcPs)
  | TNeg (LHsExpr GhcPs -> HsExpr GhcPs)
  | TOp (LHsExpr GhcPs) (Int, Assoc)

-- | Flatten a (left-nested) chain; operands are resolved recursively.
flatten :: FixityEnv -> LHsExpr GhcPs -> [Tok]
flatten env (L _ (OpApp _ l op r)) =
  flatten env l ++ [TOp (transform env op) (fixityOf env op)] ++ flatten env r
flatten env (L _ (NegApp x e syn)) = TNeg (\e' -> NegApp x e' syn) : flatten env e
flatten env e = [TExp (resolveExpr env e)]

fixityOf :: FixityEnv -> LHsExpr GhcPs -> (Int, Assoc)
fixityOf env (L _ (HsVar _ (L _ name))) =
  Map.findWithDefault (9, AssocL) (occNameString (rdrNameOcc name)) env
fixityOf _ _ = (9, AssocL)

resolveChain :: FixityEnv -> LHsExpr GhcPs -> LHsExpr GhcPs
resolveChain env e = case parseNeg (-1, AssocN) (flatten env e) of
  Just (r, []) -> r
  -- Not resolvable (e.g. mixing non-associative operators): the program is
  -- ill-formed anyway; keep the chain as parsed and let GHC report it.
  _ -> gmapT (transform env) e

parseNeg :: (Int, Assoc) -> [Tok] -> Maybe (LHsExpr GhcPs, [Tok])
parseNeg op1 (TExp e1 : rest) = parse1 op1 e1 rest
parseNeg op1@(prec1, _) (TNeg mk : rest)
  | prec1 < 6 = do
      (r, rest') <- parseNeg (6, AssocL) rest
      parse1 op1 (par (noLocA (mk r))) rest'
parseNeg _ _ = Nothing

parse1 :: (Int, Assoc) -> LHsExpr GhcPs -> [Tok] -> Maybe (LHsExpr GhcPs, [Tok])
parse1 _ e1 [] = Just (e1, [])
parse1 op1@(prec1, fix1) e1 toks@(TOp op2e op2@(prec2, fix2) : rest)
  | prec1 == prec2 && (fix1 /= fix2 || fix1 == AssocN) = Nothing
  | prec1 > prec2 || (prec1 == prec2 && fix1 == AssocL) = Just (e1, toks)
  | otherwise = do
      (r, rest') <- parseNeg op2 rest
      parse1 op1 (par (noLocA (OpApp noAnn e1 op2e r))) rest'
parse1 _ _ _ = Nothing

par :: LHsExpr GhcPs -> LHsExpr GhcPs
par e = noLocA (HsPar noAnn e)
