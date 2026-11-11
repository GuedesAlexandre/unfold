qsort :: [Int] -> [Int]
qsort [] = []
qsort (p:xs) = qsort petits ++ [p] ++ qsort grands
  where
    petits = filter (< p) xs
    grands = filter (>= p) xs

main :: IO ()
main = print (qsort [3, 1, 4, 1, 5, 9, 2, 6])
