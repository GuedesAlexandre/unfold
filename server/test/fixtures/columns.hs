double :: Int -> Int
double x = x * 2

main :: IO ()
main = do
	putStrLn "😀" >> print (double 1)
