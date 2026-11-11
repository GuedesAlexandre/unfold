import UnfoldRuntime

data Arbre = Feuille | Noeud Arbre Int Arbre deriving Show

ident :: Ctx -> a -> a
ident ctx x = call ctx 1 [val x] (\_ -> x)

main :: IO ()
main = runMain $ do
  print (ident root (Noeud Feuille 1 Feuille, "ab"))
  print (ident root True)
