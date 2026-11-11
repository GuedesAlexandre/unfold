module Main where

import Prelude hiding (sum)

-- a record field named like a library function
data Stats = Stats {sum :: Int, count :: Int}

moyenne :: Stats -> Int
moyenne s = sum s `div` count s

-- parameters and local values named like library functions
aire :: Int -> Int -> Int
aire length filter = length * filter

total :: [Int] -> Int
total xs = let reverse = 100 in reverse + foldr (+) 0 xs

compte :: [a] -> Int
compte ys = take
  where
    take = length ys * 2

main :: IO ()
main = do
  print (moyenne (Stats {sum = 10, count = 4}))
  print (aire 3 4, total [1, 2], compte "abc")
  print (map (\map -> map + 1) [1, 2 :: Int])
