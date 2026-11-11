{-# LANGUAGE NamedFieldPuns #-}
data Ops = Ops {appliquer :: Int -> Int, nom :: String}

base :: Ops
base = Ops {appliquer = id, nom = "base"}

mk :: Int -> Ops
mk n = Ops {appliquer, nom = "mk"}
  where
    appliquer x = x + n

maj :: Int -> Ops
maj n = base {appliquer}
  where
    appliquer x = x * n

main :: IO ()
main = print (appliquer (mk 1) 41, appliquer (maj 2) 21, nom (mk 0))
