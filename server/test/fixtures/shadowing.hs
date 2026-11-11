module Main where

import Prelude hiding (map)

map :: (a -> b) -> [a] -> [b]
map _ [] = []
map g (x:xs) = g x : map g xs

double :: Int -> Int
double x = x * 2

-- a parameter named like a traced function
f :: Int -> Int
f map = map + 1

-- case alternative binder
g :: [Int] -> Int
g xs = case xs of
  (double : _) -> double + 100
  [] -> 0

-- list comprehension generator
h :: Int -> [Int]
h n = [double | double <- [n, n + 1]]

-- let value
k :: Int -> Int
k n = let double = n - 1 in double * 3

-- do bind
l :: Int -> IO Int
l n = do
  double <- return (n + 5)
  return (double * 2)

-- lambda parameter
lam :: Int -> Int
lam = \double -> double + 7

-- where value, shared by guards
w :: Int -> Int
w n
  | n > 0 = double + n
  | otherwise = double - n
  where
    double = 1000

-- as-pattern
asp :: [Int] -> Int
asp double@(_ : _) = length double
asp [] = 0

main :: IO ()
main = do
  print (f 1, g [5], h 3, k 4)
  r <- l 1
  print r
  print (lam 1, w 2, w (-2), asp [1, 2])
  print (map double [1, 2, 3])
