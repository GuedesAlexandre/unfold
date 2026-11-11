{-# LANGUAGE RecordWildCards #-}
data Cfg = Cfg {largeur :: Int, nom :: String}

double :: Int -> Int
double x = x * 2

render :: Cfg -> String
render Cfg {..} = nom ++ show (double largeur)

main :: IO ()
main = putStrLn (render (Cfg 3 "w"))
