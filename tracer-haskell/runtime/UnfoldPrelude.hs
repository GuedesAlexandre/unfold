-- Bibliothèque standard tracée d'Unfold : versions « manuel » des fonctions de liste
-- du Prelude, instrumentées comme le sera une fonction utilisateur.
--
-- Chaque `f ctx ...` est un wrapper `call` (id de fonction réservé, négatif) ; les appels
-- récursifs passent `Ctx i 0` (parent = appel courant), donc la récursion est visible.
-- Les fonctions passées en argument sont appelées telles quelles (code utilisateur).
--
-- Ids de fonction : map=-1 filter=-2 foldr=-3 foldl=-4 length=-5 sum=-6 product=-7
--   append(++)=-8 reverse=-9 concat=-10 zip=-11 take=-12 drop=-13 elem=-14 replicate=-15.
-- Ids d'équation (arguments de `eq`) : -(100 * |id de fonction| + n), n = numéro de
-- l'équation (1, 2, ...) ; ex. map : -101, -102 ; replicate : -1501, -1502.
-- Les ids d'équation des fonctions utilisateur sont > 0 : aucune collision.
module UnfoldPrelude
  ( map, filter, foldr, foldl, length, sum, product, append, reverse, concat
  , zip, take, drop, elem, replicate, libNames
  ) where

import Prelude hiding
  ( map, filter, foldr, foldl, length, sum, product, reverse, concat
  , zip, take, drop, elem, replicate )
import UnfoldRuntime

libNames :: [(String, Int)]
libNames =
  [ ("map", -1), ("filter", -2), ("foldr", -3), ("foldl", -4), ("length", -5)
  , ("sum", -6), ("product", -7), ("++", -8), ("reverse", -9), ("concat", -10)
  , ("zip", -11), ("take", -12), ("drop", -13), ("elem", -14), ("replicate", -15) ]

map :: Ctx -> (a -> b) -> [a] -> [b]
map ctx f xs = call ctx (-1) [val f, val xs] $ \i -> case xs of
  [] -> eq i (-101) []
  y : ys -> eq i (-102) (f y : map (Ctx i 0) f ys)

filter :: Ctx -> (a -> Bool) -> [a] -> [a]
filter ctx p xs = call ctx (-2) [val p, val xs] $ \i -> case xs of
  [] -> eq i (-201) []
  y : ys
    | p y -> eq i (-202) (y : filter (Ctx i 0) p ys)
    | otherwise -> eq i (-203) (filter (Ctx i 0) p ys)

foldr :: Ctx -> (a -> b -> b) -> b -> [a] -> b
foldr ctx f z xs = call ctx (-3) [val f, val z, val xs] $ \i -> case xs of
  [] -> eq i (-301) z
  y : ys -> eq i (-302) (f y (foldr (Ctx i 0) f z ys))

-- Paresseux comme celui du Prelude : l'accumulateur n'est pas forcé.
foldl :: Ctx -> (b -> a -> b) -> b -> [a] -> b
foldl ctx f z xs = call ctx (-4) [val f, val z, val xs] $ \i -> case xs of
  [] -> eq i (-401) z
  y : ys -> eq i (-402) (foldl (Ctx i 0) f (f z y) ys)

length :: Ctx -> [a] -> Int
length ctx xs = call ctx (-5) [val xs] $ \i -> case xs of
  [] -> eq i (-501) 0
  _ : ys -> eq i (-502) (1 + length (Ctx i 0) ys)

-- sum/product/reverse : fold à gauche (comme le Prelude) via un assistant à accumulateur
-- dont les appels récursifs restent tracés (même id de fonction, imbriqués sous l'appel).
sum :: Num a => Ctx -> [a] -> a
sum ctx xs = call ctx (-6) [val xs] $ \i -> sumAcc (Ctx i 0) 0 xs

sumAcc :: Num a => Ctx -> a -> [a] -> a
sumAcc ctx acc xs = call ctx (-6) [val acc, val xs] $ \i -> case xs of
  [] -> eq i (-601) acc
  y : ys -> let a = acc + y in a `seq` eq i (-602) (sumAcc (Ctx i 0) a ys)

product :: Num a => Ctx -> [a] -> a
product ctx xs = call ctx (-7) [val xs] $ \i -> productAcc (Ctx i 0) 1 xs

productAcc :: Num a => Ctx -> a -> [a] -> a
productAcc ctx acc xs = call ctx (-7) [val acc, val xs] $ \i -> case xs of
  [] -> eq i (-701) acc
  y : ys -> let a = acc * y in a `seq` eq i (-702) (productAcc (Ctx i 0) a ys)

append :: Ctx -> [a] -> [a] -> [a]
append ctx xs zs = call ctx (-8) [val xs, val zs] $ \i -> case xs of
  [] -> eq i (-801) zs
  y : ys -> eq i (-802) (y : append (Ctx i 0) ys zs)

reverse :: Ctx -> [a] -> [a]
reverse ctx xs = call ctx (-9) [val xs] $ \i -> reverseAcc (Ctx i 0) [] xs

reverseAcc :: Ctx -> [a] -> [a] -> [a]
reverseAcc ctx acc xs = call ctx (-9) [val acc, val xs] $ \i -> case xs of
  [] -> eq i (-901) acc
  y : ys -> eq i (-902) (reverseAcc (Ctx i 0) (y : acc) ys)

concat :: Ctx -> [[a]] -> [a]
concat ctx xss = call ctx (-10) [val xss] $ \i -> case xss of
  [] -> eq i (-1001) []
  ys : yss -> eq i (-1002) (append (Ctx i 0) ys (concat (Ctx i 0) yss))

zip :: Ctx -> [a] -> [b] -> [(a, b)]
zip ctx xs ys = call ctx (-11) [val xs, val ys] $ \i -> case (xs, ys) of
  (a : as, b : bs) -> eq i (-1101) ((a, b) : zip (Ctx i 0) as bs)
  _ -> eq i (-1102) []

take :: Ctx -> Int -> [a] -> [a]
take ctx n xs = call ctx (-12) [val n, val xs] $ \i ->
  if n <= 0 then eq i (-1201) [] else case xs of
    [] -> eq i (-1202) []
    y : ys -> eq i (-1203) (y : take (Ctx i 0) (n - 1) ys)

drop :: Ctx -> Int -> [a] -> [a]
drop ctx n xs = call ctx (-13) [val n, val xs] $ \i ->
  if n <= 0 then eq i (-1301) xs else case xs of
    [] -> eq i (-1302) []
    _ : ys -> eq i (-1303) (drop (Ctx i 0) (n - 1) ys)

elem :: Eq a => Ctx -> a -> [a] -> Bool
elem ctx x xs = call ctx (-14) [val x, val xs] $ \i -> case xs of
  [] -> eq i (-1401) False
  y : ys
    | y == x -> eq i (-1402) True
    | otherwise -> eq i (-1403) (elem (Ctx i 0) x ys)

replicate :: Ctx -> Int -> a -> [a]
replicate ctx n x = call ctx (-15) [val n, val x] $ \i ->
  if n <= 0 then eq i (-1501) [] else eq i (-1502) (x : replicate (Ctx i 0) (n - 1) x)
