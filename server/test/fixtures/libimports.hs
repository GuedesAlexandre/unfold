{-# LANGUAGE GADTs #-}
module Main where

import Prelude hiding (filter)
import qualified Prelude as P
import Data.Map (filter, fromList, toList)
import qualified Data.Set as S

-- a GADT matched in an instance method (type refinement in the alternatives)
data E a where
  I :: Int -> E Int
  B :: Bool -> E Bool
  Add :: E Int -> E Int -> E Int

class Eval f where
  eval :: f a -> a

instance Eval E where
  eval (I n) = n
  eval (B b) = b
  eval (Add x y) = eval x + eval y

-- an operator with guards falling through to the next equation
(?) :: Int -> Int -> Int
a ? b
  | a > b = a
x ? _ = x * 100

main :: IO ()
main = do
  -- Data.Map's filter, the Prelude's through a qualified name
  print (toList (filter even (fromList [(1 :: Int, 2 :: Int), (2, 3)])))
  print (P.filter odd [1 .. 6 :: Int], P.map negate [1, 2 :: Int])
  print (S.toList (S.map (* 2) (S.fromList [3, 1, 2 :: Int])), S.size (S.fromList "abca"))
  print (eval (Add (I 2) (I 3)), eval (B True))
  print (5 ? 3, 1 ? 3)
