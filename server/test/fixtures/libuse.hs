module Main where

import Data.List (foldl')
import qualified Data.List as L

carre :: Int -> Int
carre x = x * x

main :: IO ()
main = do
  print (sum (map carre [1 .. 4]))
  let xs = [1, 2, 3] :: [Int]
  print (3 `elem` xs, 7 `elem` xs)
  putStrLn (reverse "abc")
  print (foldr (\x acc -> x : acc) [] [1 .. 3 :: Int])
  -- laziness: infinite lists consumed partially
  print (take 3 (map carre [1 ..]))
  print (take 4 (foldr (\x acc -> x : acc) [] [1 :: Int ..]))
  print (5 `elem` [1 :: Int ..])
  print (take 5 ([1 :: Int ..] ++ undefined))
  -- passed as arguments, partially applied
  print (zipWith map [(+ 1), (* 2)] [[1, 2], [3 :: Int]])
  print (foldr (.) id (map (+) [1, 2, 3]) (0 :: Int))
  print (concat ["a", "b"], length "hello", product [1 .. 5 :: Integer])
  print (filter even [1 .. 10 :: Int], drop 2 (zip "abcd" [1 :: Int ..]), replicate 3 'x')
  print (foldl (-) 10 [1, 2, 3 :: Int], foldl' (+) 0 [1, 2, 3 :: Int])
  -- sections of ++
  print (map (++ "!") ["a", "b"], map ("<" ++) ["c"], (++) "x" "y")
  -- qualified use through Data.List
  print (L.map succ [1, 2 :: Int], L.length [True])
