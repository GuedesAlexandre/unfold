saluer :: String -> String
saluer nom = "Bonjour, " ++ nom ++ " ! Ça va ? é"

main :: IO ()
main = do
  putStrLn (saluer "Zoé")
  print (map (\x -> x * 2) [1, 2 :: Int])
