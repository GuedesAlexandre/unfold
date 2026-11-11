data Arbre = Feuille | Noeud Arbre Int Arbre
  deriving Show

inserer :: Int -> Arbre -> Arbre
inserer x Feuille = Noeud Feuille x Feuille
inserer x a@(Noeud g v d)
  | x < v = Noeud (inserer x g) v d
  | x > v = Noeud g v (inserer x d)
  | otherwise = a

construire :: [Int] -> Arbre
construire = foldr inserer Feuille

main :: IO ()
main = print (construire [2, 4, 1, 3])
