module Main (main) where

import GHC (getSessionDynFlags, parser, runGhc)
import GHC.Driver.Config.Diagnostic (initPrintConfig)
import GHC.Driver.Ppr (showPpr, showSDoc)
import GHC.Utils.Error (pprMessages)
import System.Environment (getArgs, lookupEnv)
import System.Exit (ExitCode (..), exitWith)
import System.IO (hPutStrLn, stderr)
import System.Process (readProcess)

import Unfold.Fixity (moduleFixities, resolveFixities)

main :: IO ()
main = do
  args <- getArgs
  case args of
    ["--roundtrip", input, output] -> roundtrip input output
    _ -> do
      hPutStrLn stderr "usage: unfold-instrument --roundtrip IN.hs OUT.hs"
      exitWith (ExitFailure 64)

-- | Parse, resolve operator fixities, pretty-print.
roundtrip :: FilePath -> FilePath -> IO ()
roundtrip input output = do
  libdir <- getLibdir
  src <- readFile input
  result <- runGhc (Just libdir) $ do
    df <- getSessionDynFlags
    case parser src df input of
      (_, Left errs) -> pure (Left (showSDoc df (pprMessages (initPrintConfig df) errs)))
      (_, Right lmod) -> do
        let resolved = (\m -> resolveFixities (moduleFixities m) m) <$> lmod
        pure (Right (showPpr df resolved))
  case result of
    Left err -> hPutStrLn stderr err >> exitWith (ExitFailure 2)
    Right code -> writeFile output (code ++ "\n")

-- | GHC's libdir: @UNFOLD_GHC_LIBDIR@ if set, otherwise @ghc --print-libdir@.
getLibdir :: IO FilePath
getLibdir = do
  fromEnv <- lookupEnv "UNFOLD_GHC_LIBDIR"
  case fromEnv of
    Just dir | not (null dir) -> pure dir
    _ -> takeWhile (`notElem` "\r\n") <$> readProcess "ghc" ["--print-libdir"] ""
