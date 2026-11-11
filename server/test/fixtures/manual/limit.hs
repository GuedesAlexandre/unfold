import UnfoldRuntime

loop :: Ctx -> Int -> Int
loop ctx n = call ctx 1 [val n] (\i -> loop (Ctx i 0) (n + 1))

main :: IO ()
main = runMain (print (loop root 0))
