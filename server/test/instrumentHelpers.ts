import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, type RunResult } from '../src/process';

const here = path.dirname(fileURLToPath(import.meta.url));
export const tracerDir = path.resolve(here, '../../tracer-haskell');
export const fixturesDir = path.join(here, 'fixtures');

const LIMITS = { timeoutMs: 600_000, maxOutput: 10_000_000 };

async function must(cmd: string, args: string[], cwd: string): Promise<string> {
  const r = await run(cmd, args, { cwd, ...LIMITS });
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} → ${r.code}\n${r.stderr}`);
  return r.stdout;
}

let binPromise: Promise<string> | undefined;

/** `cabal build` once per test process, then the path of the built `unfold-instrument`. */
export function instrumentBin(): Promise<string> {
  binPromise ??= (async () => {
    await must('cabal', ['build', '-v0', 'exe:unfold-instrument'], tracerDir);
    return (await must('cabal', ['list-bin', '-v0', 'unfold-instrument'], tracerDir)).trim();
  })();
  return binPromise;
}

/** Standard output of `runghc` on the untouched fixture. */
export async function runghcOriginal(fixture: string): Promise<string> {
  return must('runghc', [path.join(fixturesDir, fixture)], fixturesDir);
}

/**
 * Run `unfold-instrument --roundtrip` on a fixture; returns the printed source
 * and the result of `runghc` on it (which may fail).
 */
export async function roundtrip(fixture: string): Promise<{ source: string; result: RunResult }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'unfold-rt-'));
  try {
    const input = path.join(dir, 'In.hs');
    const output = path.join(dir, 'Out.hs');
    await copyFile(path.join(fixturesDir, fixture), input);
    await must(await instrumentBin(), ['--roundtrip', input, output], dir);
    const source = await readFile(output, 'utf8');
    const result = await run('runghc', [output], { cwd: dir, ...LIMITS });
    return { source, result };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function roundtripAndRun(fixture: string): Promise<string> {
  const { result } = await roundtrip(fixture);
  if (result.code !== 0) throw new Error(`runghc on the round-tripped ${fixture} → ${result.code}\n${result.stderr}`);
  return result.stdout;
}
