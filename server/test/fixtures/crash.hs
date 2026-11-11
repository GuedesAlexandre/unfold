diviser :: Int -> Int -> Int
diviser x y = x `div` y

calculer :: Int -> Int
calculer n = diviser 10 n + 1

main :: IO ()
main = do
  putStrLn "avant"
  print (calculer 0)
