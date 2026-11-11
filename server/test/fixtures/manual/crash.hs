import UnfoldRuntime

f :: Ctx -> Int -> Int
f ctx n = call ctx 1 [val n] (\i -> g (Ctx i 0) n)

g :: Ctx -> Int -> Int
g ctx n = call ctx 2 [val n] (\_ -> error "boum")

main :: IO ()
main = runMain $ do
  putStrLn "avant"
  print (f root 3)
