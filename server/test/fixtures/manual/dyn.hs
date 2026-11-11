import UnfoldRuntime

f :: Ctx -> Int -> Int
f ctx n = call ctx 1 [val n] (\_ -> g n)

g :: Int -> Int
g n = callDyn 2 [val n] (\_ -> n + 1)

main :: IO ()
main = runMain (print (f root 1 + g 5))
