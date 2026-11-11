module Main where

-- a Foldable instance: the Foldable functions are left to the Prelude
data Arbre a = Feuille | Noeud (Arbre a) a (Arbre a)

instance Foldable Arbre where
  foldr _ z Feuille = z
  foldr f z (Noeud g v d) = foldr f (f v (foldr f z d)) g

main :: IO ()
main = do
  let t = Noeud (Noeud Feuille 1 Feuille) 2 (Noeud Feuille 3 Feuille) :: Arbre Int
  print (sum t, length t, elem 3 t, foldr (:) [] t)
  print (map (* 2) [1, 2, 3 :: Int], sum [1, 2, 3 :: Int])
