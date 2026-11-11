module Main where

data Arbre = Feuille | Noeud Arbre Int Arbre

instance Show Arbre where
  show Feuille = "."
  show (Noeud g v d) = "(" ++ show g ++ " " ++ show v ++ " " ++ show d ++ ")"

class Taille a where
  taille :: a -> Int
  decrire :: a -> String
  decrire x = "taille " ++ show (taille x)

instance Taille Arbre where
  taille Feuille = 0
  taille (Noeud g _ d) = taille g + 1 + taille d

data V = V Int Int

instance Eq V where
  V a b == V c d = a == c && b == d

-- point-free method: not a node
newtype N = N Int

instance Show N where
  show = const "N"

main :: IO ()
main = do
  let t = Noeud (Noeud Feuille 1 Feuille) 2 Feuille
  print t
  putStrLn (decrire t)
  print (V 1 2 == V 1 2, V 1 2 == V 2 1)
  print (N 3)
