-- | META.json: what the instrumenter knows about the original source, indexed
-- by the ids written into the generated code (function, site, equation ids).
-- Spans and texts refer to the code as the user wrote it.
module Unfold.Meta
  ( Span (..)
  , FunMeta (..)
  , EqMeta (..)
  , Meta (..)
  , emptyMeta
  , renderMeta
  ) where

import Data.Char (ord)
import Data.List (intercalate)
import Numeric (showHex)

-- | Lines and columns 1-based, @endCol@ exclusive. Columns count UTF-16 code
-- units of the original line (as the web editor does): a tab is 1, a
-- character outside the BMP is 2 (GHC's own columns differ on both).
data Span = Span {spLine, spCol, spEndLine, spEndCol :: !Int}

data FunMeta = FunMeta
  { fmName :: String
  , fmKind :: String -- ^ "user" | "lambda" | "method"
  , fmDef :: Maybe Span
  }

data EqMeta = EqMeta
  { emFid :: Int
  , emEqSpan :: Maybe Span
  , emRhsSpan :: Maybe Span
  , emRhsText :: String
  , emEqText :: String
  }

-- | Entries in reverse order of their ids.
data Meta = Meta
  { mFunctions :: [(Int, FunMeta)]
  , mSites :: [(Int, Maybe Span)]
  , mEquations :: [(Int, EqMeta)]
  }

emptyMeta :: Meta
emptyMeta = Meta [] [] []

renderMeta :: Meta -> String
renderMeta m =
  obj
    [ ("functions", obj [(show i, fun f) | (i, f) <- reverse (mFunctions m)])
    , ("sites", obj [(show i, obj [("appSpan", jspan s)]) | (i, s) <- reverse (mSites m)])
    , ("equations", obj [(show i, equation e) | (i, e) <- reverse (mEquations m)])
    ]
  where
    fun f = obj [("name", jstr (fmName f)), ("kind", jstr (fmKind f)), ("defSpan", jspan (fmDef f))]
    equation e =
      obj
        [ ("fid", show (emFid e))
        , ("eqSpan", jspan (emEqSpan e))
        , ("rhsSpan", jspan (emRhsSpan e))
        , ("rhsText", jstr (emRhsText e))
        , ("eqText", jstr (emEqText e))
        ]

obj :: [(String, String)] -> String
obj kvs = "{" ++ intercalate "," [jstr k ++ ":" ++ v | (k, v) <- kvs] ++ "}"

jspan :: Maybe Span -> String
jspan Nothing = "null"
jspan (Just (Span l c el ec)) =
  obj [("line", show l), ("col", show c), ("endLine", show el), ("endCol", show ec)]

jstr :: String -> String
jstr s = '"' : concatMap esc s ++ "\""
  where
    esc '"' = "\\\""
    esc '\\' = "\\\\"
    esc '\n' = "\\n"
    esc '\r' = "\\r"
    esc '\t' = "\\t"
    esc ch
      | o < 0x20 = "\\u" ++ replicate (4 - length h) '0' ++ h
      | otherwise = [ch]
      where
        o = ord ch
        h = showHex o ""
