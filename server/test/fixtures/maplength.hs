module Main where

import qualified Data.Map as M

double :: Int -> Int
double x = 2 * x

main :: IO ()
main = do
  let m = M.fromList [(1 :: Int, "a"), (2, "b")]
  print (length m, sum (M.fromList [(1 :: Int, 3 :: Int), (2, 4)]), elem "a" m)
  print (map double [1, 2])
