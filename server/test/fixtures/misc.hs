{-# LANGUAGE MultiWayIf, ViewPatterns, NamedFieldPuns, TupleSections #-}
module Main where

import qualified Data.Map as M

-- names that clash with the generated ones: other prefix / suffixes are chosen
_unfold_c :: Int
_unfold_c = 7

aide :: Int -> Int
aide n = n + _unfold_c

aide__w :: Int
aide__w = 1

-- polymorphic, no signature, used at two types
somme xs = foldr (+) 0 xs

-- multi-way if
signe :: Int -> String
signe n = if | n < 0 -> "neg" | n == 0 -> "zero" | otherwise -> "pos"

-- view pattern using a traced function (left to the alias)
premierPair :: [Int] -> Int
premierPair (filtrer -> (x : _)) = x
premierPair _ = -1

filtrer :: [Int] -> [Int]
filtrer = filter even

-- where under a case alternative, and a local function in it
decrire :: Maybe Int -> String
decrire m = case m of
  Just v -> etiquette v
    where
      etiquette k = "valeur " ++ show (aide k)
  Nothing -> "rien"

data Point = Point {px :: Int, py :: Int}

-- record construction and field puns
deplacer :: Int -> Point -> Point
deplacer d Point {px, py} = Point {px = aide px + d, py}

-- list comprehension with a let and a traced call
carres :: Int -> [(Int, Int)]
carres n = [(x, y) | x <- [1 .. n], let y = aide x, odd x]

-- partial application and composition of traced functions
compose :: Int -> Int
compose = aide . aide

-- Data.Map operators, sections over a traced function
compter :: [String] -> M.Map String Int
compter ws = M.fromListWith (+) (map (,1) ws)

-- recursion through a higher-order traced function
appliquerN :: Int -> (a -> a) -> a -> a
appliquerN 0 _ x = x
appliquerN k f x = appliquerN (k - 1) f (f x)

main :: IO ()
main = do
  print (aide 1, aide__w, somme [1, 2, 3 :: Int], somme [1.5, 2.5 :: Double])
  print (map signe [-3, 0, 3])
  print (premierPair [1, 3, 4, 5], premierPair [1])
  print (decrire (Just 2), decrire Nothing)
  let Point {px, py} = deplacer 10 (Point 1 2) in print (px, py)
  print (carres 4)
  print (compose 0)
  print (M.toList (compter (words "a b a c b a")))
  print (appliquerN 3 aide 0, appliquerN 2 (`div` 2) 100)
