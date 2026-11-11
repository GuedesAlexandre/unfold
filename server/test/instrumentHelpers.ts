import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Span } from '@unfold/shared/trace';
import { run, type RunResult } from '../src/process';
import type { RawTrace } from './runtimeHelpers';

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

/**
 * Path of the built `unfold-instrument`: built by the global setup
 * (`UNFOLD_INSTRUMENT_BIN`), otherwise `cabal build` once per test process.
 */
export function instrumentBin(): Promise<string> {
  const built = process.env.UNFOLD_INSTRUMENT_BIN;
  if (built) return Promise.resolve(built);
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

export interface Meta {
  functions: Record<string, { name: string; kind: 'user' | 'lambda' | 'method'; defSpan: Span | null }>;
  sites: Record<string, { appSpan: Span | null }>;
  equations: Record<string, {
    fid: number; eqSpan: Span | null; rhsSpan: Span | null; rhsText: string; eqText: string;
  }>;
}

/** Run `unfold-instrument IN OUT META` on a fixture (or on given source text) in a fresh directory. */
export async function instrument(fixture: string, source?: string): Promise<{
  dir: string; result: RunResult; out: string; metaPath: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'unfold-in-'));
  const input = path.join(dir, 'In.hs');
  if (source === undefined) await copyFile(path.join(fixturesDir, fixture), input);
  else await writeFile(input, source);
  const out = path.join(dir, 'Main.hs');
  const metaPath = path.join(dir, 'meta.json');
  const result = await run(await instrumentBin(), [input, out, metaPath], { cwd: dir, ...LIMITS });
  return { dir, result, out, metaPath };
}

/**
 * Instrument a fixture, compile it with the runtime (same flags as the server),
 * run it with `UNFOLD_TRACE`; returns stdout, the raw trace, META and the generated source.
 */
export async function instrumentAndRun(fixture: string): Promise<{
  stdout: string; raw: RawTrace; meta: Meta; source: string;
}> {
  const { dir, result, out, metaPath } = await instrument(fixture);
  try {
    if (result.code !== 0) throw new Error(`unfold-instrument ${fixture} → ${result.code}\n${result.stderr}`);
    await copyFile(path.join(tracerDir, 'runtime/UnfoldRuntime.hs'), path.join(dir, 'UnfoldRuntime.hs'));
    const source = await readFile(out, 'utf8');
    await must('ghc', [
      '-O0', '-package', 'ghc-heap', '-fno-omit-yields', '-rtsopts', '-with-rtsopts=-M512m',
      '-outputdir', dir, '-o', path.join(dir, 'prog'), out,
    ], dir).catch((e: Error) => { throw new Error(`${e.message}\n--- generated ${fixture} ---\n${source}`); });
    const tracePath = path.join(dir, 'trace.json');
    const r = await run(path.join(dir, 'prog'), [], { cwd: dir, env: { UNFOLD_TRACE: tracePath }, ...LIMITS });
    if (r.code !== 0) throw new Error(`instrumented ${fixture} → ${r.code}\n${r.stderr}`);
    const raw = JSON.parse(await readFile(tracePath, 'utf8')) as RawTrace;
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Meta;
    return { stdout: r.stdout, raw, meta, source };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
