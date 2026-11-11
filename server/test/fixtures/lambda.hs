appliquer :: (Int -> Int) -> Int -> Int
appliquer f x = f (f x)

sommePaires :: [(Int, Int)] -> [Int]
sommePaires ps = map (\(a, b) -> a + b) ps

main :: IO ()
main = do
  print (appliquer (\n -> n * 2) 5)
  print (sommePaires [(1, 2), (3, 4)])
