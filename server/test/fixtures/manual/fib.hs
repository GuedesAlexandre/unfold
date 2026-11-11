import UnfoldRuntime

fib :: Ctx -> Int -> Int
fib ctx n = call ctx 1 [val n] (\i -> go i n)
  where
    go i 0 = eq i 1 0
    go i 1 = eq i 2 1
    go i m = eq i 3 (fib (Ctx i 10) (m - 1) + fib (Ctx i 11) (m - 2))

main :: IO ()
main = runMain (print (fib root 4))
