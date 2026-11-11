import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Value } from '@unfold/shared/trace';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(here, '../../tracer-haskell/runtime');

export interface RawCall {
  id: number; parent: number; site: number; fid: number; eq: number | null;
  enter: number; exit: number | null; args: Value[]; result: Value | null;
  error: { message: string; origin: boolean } | null;
}
export interface RawTrace {
  status: 'ok' | 'runtime-error' | 'limit'; limit: 'steps' | 'time' | null;
  message: string | null; calls: RawCall[];
}

/** Compile `UnfoldRuntime.hs` + a hand-instrumented fixture (+ extra runtime files), run it, read the raw trace. */
export async function compileAndRunManual(
  fixture: string,
  extraFiles: string[] = [],
  env: Record<string, string> = {},
): Promise<{ stdout: string; raw: RawTrace }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'unfold-rt-'));
  try {
    await copyFile(path.join(runtimeDir, 'UnfoldRuntime.hs'), path.join(dir, 'UnfoldRuntime.hs'));
    for (const f of extraFiles) await copyFile(path.resolve(runtimeDir, f), path.join(dir, path.basename(f)));
    await copyFile(path.join(here, 'fixtures/manual', fixture), path.join(dir, fixture));
    await run('ghc', [
      '-O0', '-package', 'ghc-heap', '-fno-omit-yields', '-rtsopts', '-with-rtsopts=-M512m',
      '-outputdir', dir, '-o', path.join(dir, 'prog'), path.join(dir, fixture),
    ], { cwd: dir });
    const tracePath = path.join(dir, 'trace.json');
    const { stdout } = await run(path.join(dir, 'prog'), [], {
      cwd: dir, env: { ...process.env, UNFOLD_TRACE: tracePath, ...env },
    });
    const raw = JSON.parse(await readFile(tracePath, 'utf8')) as RawTrace;
    return { stdout, raw };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
