import { instrumentBin } from './instrumentHelpers';

/**
 * Build `unfold-instrument` once, before the test files run in parallel:
 * concurrent `cabal build`s of the same project race on its build directory.
 */
export default async function setup(): Promise<void> {
  process.env.UNFOLD_INSTRUMENT_BIN = await instrumentBin();
}
