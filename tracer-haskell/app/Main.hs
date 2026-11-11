module Main (main) where

import Data.List (isPrefixOf, nub)
import Data.Maybe (catMaybes)
import GHC
import GHC.Data.StringBuffer (stringToStringBuffer)
import GHC.Driver.Config.Diagnostic (initPrintConfig)
import GHC.Driver.Config.Parser (initParserOpts)
import GHC.Driver.Ppr (showPpr, showSDoc)
import GHC.Driver.Session (parseDynamicFilePragma, xopt)
import qualified GHC.LanguageExtensions as LangExt
import GHC.Parser.Header (getOptions)
import GHC.Types.Fixity (Fixity (..))
import GHC.Types.Name.Occurrence (isSymOcc, occNameString)
import GHC.Types.Name.Reader (rdrNameOcc)
import GHC.Utils.Error (pprMessages)
import System.Environment (getArgs, lookupEnv)
import System.Exit (ExitCode (..), exitWith)
import System.IO (hPutStrLn, stderr)
import System.Process (readProcess)
import Data.Set (Set)

import Unfold.Fixity (Assoc (..), Fix, moduleFixities, resolveFixities)
import Unfold.Meta (renderMeta)
import Unfold.Rewrite (instrumentModule)

main :: IO ()
main = do
  args <- getArgs
  case args of
    ["--roundtrip", input, output] -> roundtrip input output
    [input, output, meta] -> instrumentFile input output meta
    _ -> do
      hPutStrLn stderr "usage: unfold-instrument [--roundtrip] IN.hs OUT.hs [META.json]"
      exitWith (ExitFailure 64)

-- | Parse, resolve operator fixities, pretty-print.
roundtrip :: FilePath -> FilePath -> IO ()
roundtrip input output = do
  code <- withResolved input $ \df _ _ lmod _ -> pure (showPpr df lmod)
  writeFile output (code ++ "\n")

-- | Instrument the user's functions; write the program and its META.
-- Exit codes: 2 parse error, 3 no @main@.
instrumentFile :: FilePath -> FilePath -> FilePath -> IO ()
instrumentFile input output metaOut = do
  r <- withResolved input $ \df src opts lmod resolved ->
    pure $ case instrumentModule (xopt LangExt.MonoLocalBinds df) resolved src (unLoc lmod) of
      Left err -> Left err
      Right (m', meta) -> Right (pragmas opts ++ showPpr df (m' <$ lmod) ++ "\n", renderMeta meta)
  case r of
    Left err -> hPutStrLn stderr err >> exitWith (ExitFailure 3)
    Right (code, meta) -> writeFile output code >> writeFile metaOut meta

-- | The file's pragmas, which the pretty-printer drops. @-Werror@ is left
-- out: the generated code may cause warnings the user's code does not.
pragmas :: [String] -> String
pragmas = concatMap one
  where
    one f
      | "-X" `isPrefixOf` f = "{-# LANGUAGE " ++ drop 2 f ++ " #-}\n"
      | "-Werror" `isPrefixOf` f = ""
      | otherwise = "{-# OPTIONS_GHC " ++ f ++ " #-}\n"

-- | Parse the file (exit 2 on a parse error), resolve operator fixities and
-- hand over: flags, source, file pragmas, resolved module, resolved operators.
withResolved
  :: FilePath
  -> (DynFlags -> String -> [String] -> Located (HsModule GhcPs) -> Set RealSrcSpan -> Ghc a)
  -> IO a
withResolved input k = do
  libdir <- getLibdir
  src <- readFile input
  result <- runGhc (Just libdir) $ do
    df0 <- getSessionDynFlags
    -- Honour the file's LANGUAGE / OPTIONS_GHC pragmas (e.g. NoImplicitPrelude).
    let (_, opts) = getOptions (initParserOpts df0) (stringToStringBuffer src) input
    (df, _, _) <- parseDynamicFilePragma df0 opts
    _ <- setSessionDynFlags df
    case parser src df input of
      (_, Left errs) -> pure (Left (showSDoc df (pprMessages (initPrintConfig df) errs)))
      (_, Right lmod) -> do
        let m = unLoc lmod
        canLookup <- importContext df m
        env <- moduleFixities (if canLookup then lookupFixity else const (pure Nothing)) m
        let (m', resolved) = resolveFixities env m
        Right <$> k df src (map unLoc opts) (m' <$ lmod) resolved
  case result of
    Left err -> hPutStrLn stderr err >> exitWith (ExitFailure 2)
    Right a -> pure a

-- | Bring the module's imports (plus the implicit Prelude) into the
-- interactive scope, so that imported operators can be looked up.
-- False if some import cannot be loaded: then no imported fixity is known.
importContext :: DynFlags -> HsModule GhcPs -> Ghc Bool
importContext df m = handleSourceError (const (setContext [] >> pure False)) $ do
  let imports = map unLoc (hsmodImports m)
      explicitPrelude = any ((== mkModuleName "Prelude") . unLoc . ideclName) imports
      prelude = [simpleImportDecl (mkModuleName "Prelude") | xopt LangExt.ImplicitPrelude df, not explicitPrelude]
  setContext (map IIDecl (prelude ++ imports))
  pure True

-- | Fixity of an operator as GHC sees it in the interactive scope;
-- Nothing if the name is not in scope (or ambiguous with differing fixities).
lookupFixity :: RdrName -> Ghc (Maybe Fix)
lookupFixity rdr = handleSourceError (const (pure Nothing)) $ do
  names <- parseName (nameText rdr)
  infos <- mapM (getInfo False) (foldr (:) [] names)
  pure $ case nub [toFix f | (_, f, _, _, _) <- catMaybes infos] of
    [fx] -> Just fx
    _ -> Nothing
  where
    toFix (Fixity _ p d) = (p, case d of InfixL -> AssocL; InfixR -> AssocR; InfixN -> AssocN)

-- | The text 'parseName' expects: @(M.+)@, @(+)@, @M.div@, @div@.
nameText :: RdrName -> String
nameText rdr = if isSymOcc occ then "(" ++ qual ++ ")" else qual
  where
    occ = rdrNameOcc rdr
    qual = case rdr of
      Qual md _ -> moduleNameString md ++ "." ++ occNameString occ
      _ -> occNameString occ

-- | GHC's libdir: @UNFOLD_GHC_LIBDIR@ if set, otherwise @ghc --print-libdir@.
getLibdir :: IO FilePath
getLibdir = do
  fromEnv <- lookupEnv "UNFOLD_GHC_LIBDIR"
  case fromEnv of
    Just dir | not (null dir) -> pure dir
    _ -> takeWhile (`notElem` "\r\n") <$> readProcess "ghc" ["--print-libdir"] ""
