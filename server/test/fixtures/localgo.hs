sumTo :: Int -> Int
sumTo n =
  let go acc 0 = acc
      go acc k = go (acc + k) (k - 1)
  in go 0 n

main :: IO ()
main = print (sumTo 3 + sumTo 2)
