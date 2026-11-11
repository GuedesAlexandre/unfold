pair 0 = True
pair n = impair (n - 1)

impair 0 = False
impair n = pair (n - 1)

compte xs = aller xs 0
  where
    aller [] acc = acc
    aller (y:ys) acc = retour ys (acc + y)
    retour [] acc = acc
    retour (y:ys) acc = aller ys (acc * y)

main = do
  print (impair (3 :: Int))
  print (compte [1, 2, 3, 4 :: Int])
