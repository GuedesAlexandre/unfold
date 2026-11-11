module Main where

infixr 6 <+>
(<+>) :: [Int] -> [Int] -> [Int]
a <+> b = a ++ reverse b

f :: Int -> Int
f n = n * 10

g :: Int -> Int
g n = n - 1

main :: IO ()
main = do
  let x = 0 :: Int
      xs = [1, 2] :: [Int]
      ys = [3] :: [Int]
  print (x : xs ++ ys)
  print (1 + 2 * 3 - 4 :: Int)
  print (2 ^ 3 ^ 2 :: Integer)
  print (- 2 + 3 :: Int)
  print ([1,2] ++ [3] ++ [4] :: [Int])
  print (10 `div` 3 * 2 :: Int)
  print (not True || False && True)
  print (f . g $ 5)
  print ((++ [9]) [8 :: Int])
  print (([7] ++) [8 :: Int])
  print ([1] <+> [2, 3] <+> [4, 5])
  print (length xs * 2 + 1)
  print (- 2 ^ 2 :: Int)
  print (10 - 3 - 2 :: Int)
  print (f $ g $ 5 + 1 * 2)
  print (x : 1 : map (* 2) xs ++ [length ys `mod` 2 + 7] ++ ys)
  print (sum (map (subtract 1) ys) == 2 && 3 `elem` ys || null xs)
  print (local 2 3 4)
  where
    local :: Int -> Int -> Int -> Int
    local p q r = p |- q |- r
      where
        infixr 5 |-
        (|-) :: Int -> Int -> Int
        u |- v = u - v
