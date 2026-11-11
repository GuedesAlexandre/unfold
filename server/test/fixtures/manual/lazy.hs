import UnfoldRuntime

nats :: Ctx -> Int -> [Int]
nats ctx n = call ctx 1 [val n] (\i -> n : nats (Ctx i 0) (n + 1))

main :: IO ()
main = runMain (print (take 3 (nats root 1)))
