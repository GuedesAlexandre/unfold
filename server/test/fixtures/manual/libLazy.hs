import UnfoldRuntime
import qualified UnfoldPrelude as U

main :: IO ()
main = runMain $ do
  print (U.take root 3 (U.map root (*2) [1 :: Int ..]))
  print (U.foldr root (\x r -> x > 2 || r) False [1 :: Int ..])
