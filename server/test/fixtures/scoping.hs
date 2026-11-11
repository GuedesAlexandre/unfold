module Main where

import Prelude hiding ((<>))

-- top-level <> declared infixl 6; a local <> without declaration is infixl 9
infixl 6 <>
(<>) :: [Int] -> [Int] -> [Int]
a <> b = a ++ b

-- class method fixity; the instance method is not a new binding
class C a where
  (<+>) :: a -> a -> a
  infixr 5 <+>

instance C Int where
  a <+> b = a - b

main :: IO ()
main = do
  print ([1] <> [2] ++ [3])
  print (let x <> y = x * y in 2 + 3 <> 4 :: Int)
  print (1 <+> 2 <+> 3 + 0 :: Int)
  print (10 `minus` 3 `minus` 2)
  where
    minus :: Int -> Int -> Int
    minus = (-)
