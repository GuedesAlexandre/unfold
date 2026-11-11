{-# LANGUAGE ScopedTypeVariables #-}
-- Runtime de traçage Unfold : injecté dans les programmes instrumentés.
-- Les appels sont enregistrés dans des IORef globaux ; les valeurs ne sont lues
-- (via ghc-heap) qu'après la fin du programme, sans rien forcer.
module UnfoldRuntime (Ctx (..), root, call, callDyn, eq, val, runMain) where

import Control.Exception
import Control.Monad (unless, when)
import Data.Char (chr, ord)
import Data.IORef
import qualified Data.IntMap.Strict as IM
import GHC.Exts.Heap
import GHC.Float (castWord32ToFloat, castWord64ToDouble)
import Numeric (showHex)
import System.Environment (lookupEnv)
import System.IO
import System.IO.Unsafe (unsafePerformIO)
import System.Timeout (Timeout, timeout)
import Text.Read (readMaybe)

-- | Contexte lexical : id de l'appel parent, id de site (0 = inconnu).
data Ctx = Ctx !Int !Int

root :: Ctx
root = Ctx 0 0

data Rec = Rec
  { rParent :: !Int, rSite :: !Int, rFid :: !Int, rEq :: !(Maybe Int)
  , rDyn :: !Bool -- ^ parent pris sur la pile dynamique (callDyn)
  , rEnter :: !Int, rExit :: !(Maybe Int)
  , rArgs :: [Box], rResult :: Maybe Box
  , rError :: !(Maybe (String, Bool)) }

data StepLimit = StepLimit deriving Show
instance Exception StepLimit

{-# NOINLINE callsRef #-}
callsRef :: IORef (IM.IntMap Rec)
callsRef = unsafePerformIO (newIORef IM.empty)

{-# NOINLINE stepsRef #-}
stepsRef :: IORef Int
stepsRef = unsafePerformIO (newIORef 0)

{-# NOINLINE seqRef #-}
seqRef :: IORef Int
seqRef = unsafePerformIO (newIORef 0)

{-# NOINLINE maxStepsRef #-}
maxStepsRef :: IORef Int
maxStepsRef = unsafePerformIO (newIORef 5000)

-- | Pile dynamique des appels en cours (sommet en tête).
{-# NOINLINE stackRef #-}
stackRef :: IORef [Int]
stackRef = unsafePerformIO (newIORef [])

-- | L'exception en vol a-t-elle déjà été attribuée à un appel d'origine ?
{-# NOINLINE attributedRef #-}
attributedRef :: IORef Bool
attributedRef = unsafePerformIO (newIORef False)

val :: a -> Box
val = asBox

nextSeq :: IO Int
nextSeq = atomicModifyIORef' seqRef (\n -> (n + 1, n + 1))

adjustRec :: Int -> (Rec -> Rec) -> IO ()
adjustRec i f = modifyIORef' callsRef (IM.adjust f i)

{-# NOINLINE call #-}
call :: Ctx -> Int -> [Box] -> (Int -> r) -> r
call (Ctx parent site) fid args body = unsafePerformIO (enter False parent site fid args body)

-- | Parent = appel en cours sur la pile dynamique (méthodes d'instance).
{-# NOINLINE callDyn #-}
callDyn :: Int -> [Box] -> (Int -> r) -> r
callDyn fid args body = unsafePerformIO $ do
  st <- readIORef stackRef
  enter True (case st of { (p : _) -> p; [] -> 0 }) 0 fid args body

enter :: Bool -> Int -> Int -> Int -> [Box] -> (Int -> r) -> IO r
enter dyn parent site fid args body = do
  n <- readIORef stepsRef
  mx <- readIORef maxStepsRef
  when (n >= mx) (throwIO StepLimit)
  let i = n + 1
  writeIORef stepsRef i
  e <- nextSeq
  modifyIORef' callsRef (IM.insert i (Rec parent site fid Nothing dyn e Nothing args Nothing Nothing))
  modifyIORef' stackRef (i :)
  r <- evaluate (body i) `catch` \(ex :: SomeException) -> do
    modifyIORef' stackRef (drop 1)
    unless (isLimit ex) $ do
      already <- readIORef attributedRef
      writeIORef attributedRef True
      adjustRec i (\c -> c { rError = Just (displayException ex, not already) })
    throwIO ex
  modifyIORef' stackRef (drop 1)
  x <- nextSeq
  adjustRec i (\c -> c { rExit = Just x, rResult = Just (val r) })
  pure r

isLimit :: SomeException -> Bool
isLimit ex = case (fromException ex :: Maybe StepLimit, fromException ex :: Maybe Timeout) of
  (Nothing, Nothing) -> False
  _ -> True

-- | Enregistre l'équation choisie pour l'appel `i`, renvoie `x` inchangé.
{-# NOINLINE eq #-}
eq :: Int -> Int -> a -> a
eq i e x = unsafePerformIO (adjustRec i (\c -> c { rEq = Just e }) >> pure x)

-- ---------------------------------------------------------------------------
-- Lecture des valeurs (sans rien forcer)

data Rest = REnd | RThunk | RCut
data V
  = VNum String | VChar Char | VStr String Rest | VList [V] Rest
  | VCon String [V] | VThunk | VFun | VCut | VOpaque String

maxDepth, maxItems, maxChars :: Int
maxDepth = 12
maxItems = 50
maxChars = 200

whnf :: Box -> IO Closure
whnf (Box a) = do
  c <- getClosureData a
  case c of
    IndClosure {indirectee = p} -> whnf p
    BlackholeClosure {indirectee = p} -> whnf p
    _ -> pure c

readValue :: Int -> Box -> IO V
readValue d _ | d <= 0 = pure VCut
readValue d b = whnf b >>= readClosure d

readClosure :: Int -> Closure -> IO V
readClosure d c = case c of
  ConstrClosure {name = n, ptrArgs = ps, dataArgs = ds}
    | n == ":" || n == "[]" -> readSeq d c
    | n `elem` ["I#", "IS"], [w] <- ds -> pure (VNum (show (fromIntegral w :: Int)))
    | n == "W#", [w] <- ds -> pure (VNum (show w))
    | n == "D#", [w] <- ds -> pure (VNum (show (castWord64ToDouble (fromIntegral w))))
    | n == "F#", [w] <- ds -> pure (VNum (show (castWord32ToFloat (fromIntegral w))))
    | n `elem` ["IP", "IN"] -> pure (VOpaque "grand entier")
    | n == "C#", [w] <- ds -> pure (VChar (chr (fromIntegral w)))
    | otherwise -> VCon n <$> mapM (readValue (d - 1)) ps
  ThunkClosure {} -> pure VThunk
  APClosure {} -> pure VThunk
  SelectorClosure {} -> pure VThunk
  FunClosure {} -> pure VFun
  PAPClosure {} -> pure VFun
  other -> pure (VOpaque (show (tipe (info other))))

readSeq :: Int -> Closure -> IO V
readSeq d start = do
  (heads, rest) <- spine (0 :: Int) start []
  vs <- mapM (readValue (d - 1)) heads
  let chars = [ch | VChar ch <- vs]
  pure $
    if not (null vs) && length chars == length vs
      then VStr chars rest
      else if length vs > maxItems then VList (take maxItems vs) RCut else VList vs rest
  where
    spine k c acc = case c of
      ConstrClosure {name = ":", ptrArgs = [h, t]}
        | k >= maxChars -> pure (reverse acc, RCut)
        | otherwise -> do c' <- whnf t; spine (k + 1) c' (h : acc)
      ConstrClosure {name = "[]"} -> pure (reverse acc, REnd)
      _ -> pure (reverse acc, RThunk)

-- ---------------------------------------------------------------------------
-- JSON écrit à la main

jstr :: String -> String
jstr s = '"' : concatMap esc s ++ "\""
  where
    esc '"' = "\\\""
    esc '\\' = "\\\\"
    esc '\n' = "\\n"
    esc '\r' = "\\r"
    esc '\t' = "\\t"
    esc ch
      | o < 0x20 || (o >= 0xD800 && o <= 0xDFFF) = "\\u" ++ replicate (4 - length h) '0' ++ h
      | otherwise = [ch]
      where o = ord ch
            h = showHex o ""

jrest :: Rest -> String
jrest REnd = "\"end\""
jrest RThunk = "\"thunk\""
jrest RCut = "\"cut\""

jlist :: [String] -> String
jlist xs = "[" ++ commas xs ++ "]"

commas :: [String] -> String
commas [] = ""
commas [x] = x
commas (x : xs) = x ++ "," ++ commas xs

jvalue :: V -> String
jvalue v = case v of
  VNum s -> "{\"t\":\"num\",\"v\":" ++ jstr s ++ "}"
  VChar ch -> "{\"t\":\"char\",\"v\":" ++ jstr [ch] ++ "}"
  VStr s r -> "{\"t\":\"str\",\"v\":" ++ jstr s ++ ",\"rest\":" ++ jrest r ++ "}"
  VList xs r -> "{\"t\":\"list\",\"items\":" ++ jlist (map jvalue xs) ++ ",\"rest\":" ++ jrest r ++ "}"
  VCon n as -> "{\"t\":\"con\",\"name\":" ++ jstr n ++ ",\"args\":" ++ jlist (map jvalue as) ++ "}"
  VThunk -> "{\"t\":\"thunk\"}"
  VFun -> "{\"t\":\"fun\"}"
  VCut -> "{\"t\":\"cut\"}"
  VOpaque s -> "{\"t\":\"opaque\",\"desc\":" ++ jstr s ++ "}"

jcall :: (Int, Rec) -> IO String
jcall (i, r) = do
  as <- mapM (fmap jvalue . readValue maxDepth) (rArgs r)
  res <- maybe (pure "null") (fmap jvalue . readValue maxDepth) (rResult r)
  let err = case rError r of
        Nothing -> "null"
        Just (m, o) -> "{\"message\":" ++ jstr m ++ ",\"origin\":" ++ (if o then "true" else "false") ++ "}"
      int = maybe "null" show
  pure $ "{\"id\":" ++ show i ++ ",\"parent\":" ++ show (rParent r) ++ ",\"site\":" ++ show (rSite r)
    ++ ",\"fid\":" ++ show (rFid r) ++ ",\"eq\":" ++ int (rEq r)
    ++ ",\"dyn\":" ++ (if rDyn r then "true" else "false") ++ ",\"enter\":" ++ show (rEnter r)
    ++ ",\"exit\":" ++ int (rExit r) ++ ",\"args\":" ++ jlist as ++ ",\"result\":" ++ res
    ++ ",\"error\":" ++ err ++ "}"

-- ---------------------------------------------------------------------------

envInt :: String -> Int -> IO Int
envInt k def = maybe def (maybe def id . readMaybe) <$> lookupEnv k

runMain :: IO () -> IO ()
runMain prog = do
  path <- lookupEnv "UNFOLD_TRACE"
  envInt "UNFOLD_MAX_STEPS" 5000 >>= writeIORef maxStepsRef
  ms <- envInt "UNFOLD_TIMEOUT_MS" 10000
  r <- try (timeout (ms * 1000) prog)
  writeIORef attributedRef False
  let (status, limit, msg) = case r of
        Right (Just ()) -> ("ok", Nothing, Nothing)
        Right Nothing -> ("limit", Just "time", Nothing)
        Left (ex :: SomeException)
          | Just StepLimit <- fromException ex -> ("limit", Just "steps", Nothing)
          | otherwise -> ("runtime-error", Nothing, Just (displayException ex))
  hFlush stdout `catch` \(_ :: SomeException) -> pure ()
  case path of
    Nothing -> pure ()
    Just p -> do
      cs <- IM.toAscList <$> readIORef callsRef
      js <- mapM jcall cs
      let opt = maybe "null" jstr
      withFile p WriteMode $ \h -> do
        hSetEncoding h utf8
        hPutStr h $ "{\"status\":" ++ jstr status ++ ",\"limit\":" ++ opt limit
          ++ ",\"message\":" ++ opt msg ++ ",\"calls\":" ++ jlist js ++ "}"
