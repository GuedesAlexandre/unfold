{-# LANGUAGE ScopedTypeVariables, BangPatterns #-}
{-# LANGUAGE LambdaCase #-}
module Main where

import Data.List (sortBy)

-- user operator: not traced in this task
infixl 6 |+|
(|+|) :: Int -> Int -> Int
a |+| b = a + b * 2

-- infix definition and infix uses
infixr 5 `ajoute`
ajoute :: Int -> [Int] -> [Int]
x `ajoute` xs = x : xs

-- fixity unknown to the instrumenter (bound twice, declared once):
-- the chain stays as parsed and goes through the alias
infixl 6 `combine`
combine :: Int -> Int -> Int
combine a b = a * 10 + b

separe :: Int -> Int

plus, fois :: Int -> Int -> Int
plus a b = a + b
fois a b = a * b

classer :: Int -> String
classer n
  | n < petit = "petit"
  | n < grand = "moyen"
  | otherwise = "grand"
  where
    petit = 10
    grand = 100

compter :: Int -> Int -> Int
compter !acc 0 = acc
compter !acc n = compter (acc + n) (n - 1)

paresseux :: (Int, Int) -> Int
paresseux ~(_, _) = 42

premier :: Maybe Int -> Int
premier (Just x) | x > 0 = x
premier _ = 0

additionneur :: Int -> Int -> Int
additionneur n = \m -> n + m

maxListe :: forall a. Ord a => [a] -> a
maxListe (x:xs) = go x xs
  where
    go :: a -> [a] -> a
    go m [] = m
    go m (y:ys) = go (if y > m then y else m) ys
maxListe [] = error "vide"

longueur :: [b] -> Int
longueur = foldr (\_ n -> n + 1) 0

nats :: Int -> [Int]
nats n = n : nats (n + 1)

class Forme a where
  aire :: a -> Int
  description :: a -> String
  description x = "aire " ++ show (aire x) ++ " / " ++ show (plus 1 1)

data Carre = Carre Int

instance Forme Carre where
  aire (Carre c) = fois c c

signe :: Int -> String
signe = \case
  0 -> "zero"
  n | n > 0 -> "positif"
  _ -> "negatif"

autre :: Int -> Int
autre n = n + combine 1 2
  where
    combine x y = x - y

separe x = x + 1

main :: IO ()
main = do
  print (1 `ajoute` 2 `ajoute` [])
  print (1 `combine` 2 `combine` 3, autre 5)
  print (3 |+| 4 |+| 5)
  print (map (`plus` 1) [1, 2], map (2 `fois`) [3])
  print (map classer [5, 50, 500])
  print (compter 0 10)
  print (paresseux undefined)
  print (premier (Just 3), premier (Just (-1)), premier Nothing)
  print (additionneur 3 4)
  print (maxListe [3, 9, 2 :: Int])
  print (longueur "abc")
  print (take 5 (nats 1))
  print (description (Carre 3))
  print (map signe [0, 5, -5])
  print (sortBy (\a b -> compare b a) [1, 3, 2 :: Int])
  let carre y = y * y
  print (carre 7, separe 1)
