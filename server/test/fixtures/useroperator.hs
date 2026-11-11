module Main where

infixl 6 <+>
(<+>) :: Int -> Int -> Int
a <+> b = a * 10 + b

-- prefix definition, default fixity
(|>) :: [Int] -> Int -> [Int]
(|>) xs x = xs ++ [x]

main :: IO ()
main = do
  print (1 <+> 2 <+> 3)
  print (map (<+> 1) [1, 2], map (2 <+>) [3])
  print ((<+>) 4 5)
  print (foldr (<+>) 0 [1, 2, 3])
  print ([1] |> 2 |> 3)
