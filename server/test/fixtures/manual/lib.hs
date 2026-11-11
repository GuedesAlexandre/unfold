import UnfoldRuntime
import qualified UnfoldPrelude as U

main :: IO ()
main = runMain $ print (U.foldr root (+) 0 (U.map root (*2) [1,2,3]))
