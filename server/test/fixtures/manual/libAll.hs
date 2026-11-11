import Prelude hiding (map, filter, foldr, foldl, length, sum, product, reverse, concat, zip, take, drop, elem, replicate)
import qualified Prelude as P
import UnfoldRuntime
import qualified UnfoldPrelude as U

main :: IO ()
main = runMain $ do
  let xs = [3, 1, 4, 1, 5, 9, 2, 6] :: [Int]
  print (U.map root (+1) xs == P.map (+1) xs)
  print (U.filter root even xs == P.filter even xs)
  print (U.foldr root (-) 0 xs == P.foldr (-) 0 xs)
  print (U.foldl root (-) 0 xs == P.foldl (-) 0 xs)
  print (U.length root xs == P.length xs)
  print (U.sum root xs == P.sum xs, U.product root xs == P.product xs)
  print (U.append root xs [7, 8] == xs ++ [7, 8])
  print (U.reverse root xs == P.reverse xs)
  print (U.concat root [xs, [], [1]] == P.concat [xs, [], [1]])
  print (U.zip root xs "abc" == P.zip xs "abc")
  print (U.take root 3 xs == P.take 3 xs, U.take root (-1) xs == P.take (-1) xs)
  print (U.drop root 3 xs == P.drop 3 xs, U.drop root 99 xs == P.drop 99 xs)
  print (U.elem root 9 xs == P.elem 9 xs, U.elem root 7 xs == P.elem 7 xs)
  print (U.replicate root 3 'x' == P.replicate 3 'x')
  print (P.map fst U.libNames, P.map snd U.libNames)
