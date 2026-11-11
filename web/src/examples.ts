export interface Example { name: string; code: string }

export const EXAMPLES: Example[] = [
  {
    name: 'factorielle',
    code: `fact :: Int -> Int
fact 0 = 1
fact n = n * fact (n - 1)

main :: IO ()
main = print (fact 5)
`,
  },
  {
    name: 'fibonacci',
    code: `fib :: Int -> Int
fib 0 = 0
fib 1 = 1
fib n = fib (n - 1) + fib (n - 2)

main :: IO ()
main = print (fib 5)
`,
  },
  {
    name: "somme d'une liste",
    code: `somme :: [Int] -> Int
somme [] = 0
somme (x:xs) = x + somme xs

main :: IO ()
main = print (somme [1..5])
`,
  },
  {
    name: 'quicksort',
    code: `quicksort :: [Int] -> [Int]
quicksort [] = []
quicksort (p:xs) = quicksort petits ++ [p] ++ quicksort grands
  where
    petits = filter (< p) xs
    grands = filter (>= p) xs

main :: IO ()
main = print (quicksort [3,1,4,1,5,9,2,6])
`,
  },
  {
    name: 'arbre binaire',
    code: `data Arbre = Vide | Noeud Arbre Int Arbre

inserer :: Int -> Arbre -> Arbre
inserer x Vide = Noeud Vide x Vide
inserer x (Noeud g v d)
  | x < v     = Noeud (inserer x g) v d
  | otherwise = Noeud g v (inserer x d)

infixe :: Arbre -> [Int]
infixe Vide = []
infixe (Noeud g v d) = infixe g ++ [v] ++ infixe d

main :: IO ()
main = print (infixe (foldl (flip inserer) Vide [5,3,8,1,4]))
`,
  },
  {
    name: 'longueur bugguée',
    code: `longueur :: [a] -> Int
longueur [] = 1
longueur (_:xs) = 1 + longueur xs

main :: IO ()
main = print (longueur "abcde")
`,
  },
  {
    name: 'map/foldr',
    code: `main :: IO ()
main = print (foldr (+) 0 (map (*2) [1,2,3]))
`,
  },
];
