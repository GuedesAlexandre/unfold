import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Call, Diagnostic, Span, Trace, Value } from '@unfold/shared/trace';
import { run } from '../process';
import type { Tracer } from './types';

const tracerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tracer-haskell');

const GHC_FLAGS = ['-O0', '-package', 'ghc-heap', '-fno-omit-yields', '-rtsopts', '-with-rtsopts=-M512m'];
const TOOL_LIMITS = { timeoutMs: 120_000, maxOutput: 1_000_000 };
const MAX_STEPS = 5000;
const TIMEOUT_MS = 10_000;
const KILL_MS = 15_000;
const MAX_STDOUT = 100_000;

const MSG_NO_MAIN = 'Ton programme doit définir `main`, par exemple : `main = print (maFonction 5)`';
const MSG_INSTRUMENT = "Unfold n'a pas réussi à instrumenter ce programme";
const MSG_NO_LIB = 'Les fonctions de bibliothèque (map, sum…) ne sont pas tracées pour ce programme : il les utilise sur autre chose que des listes.';
const MSG_STDIN = 'Les entrées clavier (getLine…) ne sont pas encore supportées';
const MSG_TRUNCATED = 'La sortie dépasse 100 Ko : elle a été tronquée.';
const MSG_NO_TRACE = "Unfold n'a pas réussi à lire la trace d'exécution";
/** GHC's error code for "The IO action `main' is not defined in module `Main'". */
const GHC_NO_MAIN = 67120;

// ---------------------------------------------------------------------------
// The instrumenter executable

let binPromise: Promise<string> | undefined;

/**
 * Path of `unfold-instrument`, built once per process (`cabal build`, then `cabal list-bin`).
 * `UNFOLD_INSTRUMENT_BIN` gives an already built one (tests' global setup).
 */
export function instrumenterBin(): Promise<string> {
  const built = process.env.UNFOLD_INSTRUMENT_BIN;
  if (built) return Promise.resolve(built);
  binPromise ??= (async () => {
    const limits = { cwd: tracerDir, timeoutMs: 1_800_000, maxOutput: 1_000_000 };
    const b = await run('cabal', ['build', '-v0', 'exe:unfold-instrument'], limits);
    if (b.code !== 0) throw new Error(`cabal build → ${b.code}\n${b.stderr}`);
    const l = await run('cabal', ['list-bin', '-v0', 'unfold-instrument'], limits);
    if (l.code !== 0) throw new Error(`cabal list-bin → ${l.code}\n${l.stderr}`);
    return l.stdout.trim();
  })();
  binPromise.catch(() => { binPromise = undefined; });
  return binPromise;
}

// ---------------------------------------------------------------------------
// GHC diagnostics (`-fdiagnostics-as-json`: one JSON object per line of stderr)

interface GhcPos { line: number; column: number }
interface GhcDiagnostic {
  span: { start: GhcPos; end: GhcPos } | null;
  severity: string; code?: number | null; message: string[] | string;
}

/**
 * GHC column (1-based, counted in characters, a tab advancing to the next column 8k+1)
 * → 1-based column in UTF-16 code units of `line`.
 */
function utf16Col(line: string, ghcCol: number): number {
  let g = 1;
  let u = 1;
  for (const ch of line) {
    if (g >= ghcCol) return u;
    g = ch === '\t' ? (Math.floor((g - 1) / 8) + 1) * 8 + 1 : g + 1;
    u += ch.length;
  }
  return u + Math.max(ghcCol - g, 0);
}

/** Parse GHC's JSON diagnostics; GHC's end column is already exclusive (checked on GHC 9.10.3). */
function parseDiagnostics(stderr: string, code: string): { diagnostics: Diagnostic[]; noMain: boolean[] } {
  const lines = code.split('\n');
  const diagnostics: Diagnostic[] = [];
  const noMain: boolean[] = [];
  for (const text of stderr.split('\n')) {
    if (!text.startsWith('{')) continue;
    let d: GhcDiagnostic;
    try {
      d = JSON.parse(text) as GhcDiagnostic;
    } catch {
      continue;
    }
    const start = d.span?.start ?? { line: 1, column: 1 };
    const end = d.span?.end ?? start;
    const span: Span = {
      line: start.line, col: utf16Col(lines[start.line - 1] ?? '', start.column),
      endLine: end.line, endCol: utf16Col(lines[end.line - 1] ?? '', end.column),
    };
    const message = Array.isArray(d.message) ? d.message.join('\n') : String(d.message);
    diagnostics.push({ span, severity: d.severity === 'Warning' ? 'warning' : 'error', message });
    noMain.push(d.code === GHC_NO_MAIN);
  }
  return { diagnostics, noMain };
}

// ---------------------------------------------------------------------------
// Raw trace (runtime) + META (instrumenter) → Trace

interface RawCall {
  id: number; parent: number; site: number; fid: number; eq: number | null; dyn: boolean;
  enter: number; exit: number | null; args: Value[]; result: Value | null;
  error: { message: string; origin: boolean } | null;
}
interface RawTrace {
  status: 'ok' | 'runtime-error' | 'limit'; limit: 'steps' | 'time' | null;
  message: string | null; calls: RawCall[];
}
interface Meta {
  functions: Record<string, { name: string; kind: Call['kind']; defSpan: Span | null }>;
  sites: Record<string, { appSpan: Span | null }>;
  equations: Record<string, { eqSpan: Span | null; rhsSpan: Span | null; rhsText: string; eqText: string }>;
}

function mergeCall(c: RawCall, meta: Meta): Call {
  const f = meta.functions[c.fid];
  if (!f) throw new Error(`fonction ${c.fid} absente de META`);
  const appSpan = meta.sites[c.site]?.appSpan;
  const e = c.eq === null ? undefined : meta.equations[c.eq];
  return {
    id: c.id, parent: c.parent,
    ...(c.dyn && { parentApprox: true as const }),
    enter: c.enter,
    ...(c.exit !== null && { exit: c.exit }),
    name: f.name, kind: f.kind,
    ...(f.defSpan && { defSpan: f.defSpan }),
    ...(appSpan && { appSpan }),
    ...(e?.eqSpan && { eqSpan: e.eqSpan }),
    ...(e?.rhsSpan && { rhsSpan: e.rhsSpan }),
    ...(e && { rhsText: e.rhsText, eqText: e.eqText }),
    args: c.args,
    ...(c.result !== null && { result: c.result }),
    ...(c.error !== null && { error: c.error }),
  };
}

/** Does the program read standard input? */
const readsStdin = (code: string) =>
  /\b(getLine|getContents|getChar|interact|readLn|isEOF|hGetLine|hGetContents|hGetChar|stdin)\b/.test(code);

// ---------------------------------------------------------------------------

function trace(status: Trace['status'], rest: Partial<Trace> = {}): Trace {
  const t: Trace = { version: 1, language: 'haskell', status, stdout: '', diagnostics: [], calls: [] };
  return Object.assign(t, rest);
}

async function pipeline(code: string, dir: string): Promise<Trace> {
  const bin = await instrumenterBin();
  const tool = { cwd: dir, ...TOOL_LIMITS };
  await writeFile(path.join(dir, 'Main.hs'), code);

  // 2. Type-check the original, with its own pragmas.
  const check = await run('ghc', ['-fno-code', '-fdiagnostics-as-json', 'Main.hs'], tool);
  const { diagnostics, noMain } = parseDiagnostics(check.stderr, code);
  if (check.code !== 0) {
    if (check.timedOut) return trace('internal-error', { message: 'GHC ne répond pas', diagnostics });
    const errors = diagnostics.filter(d => d.severity === 'error');
    if (errors.length > 0 && diagnostics.every((d, i) => d.severity === 'warning' || noMain[i])) {
      return trace('no-main', { message: MSG_NO_MAIN, diagnostics });
    }
    if (errors.length === 0) {
      diagnostics.push({ span: { line: 1, col: 1, endLine: 1, endCol: 1 }, severity: 'error', message: check.stderr.trim() });
    }
    return trace('compile-error', { diagnostics });
  }

  // 3. Instrument.
  const instrument = (flags: string[]) => run(bin, [...flags, 'Main.hs', 'Instr.hs', 'meta.json'], tool);
  const ins = await instrument([]);
  if (ins.code === 3) return trace('no-main', { message: MSG_NO_MAIN, diagnostics });
  if (ins.code !== 0) return trace('internal-error', { message: `${MSG_INSTRUMENT}\n\n${ins.stderr}`, diagnostics });

  // 4. Compile with the runtime; if the traced library doesn't fit the program, retry without it.
  for (const f of ['UnfoldRuntime.hs', 'UnfoldPrelude.hs']) await copyFile(path.join(tracerDir, 'runtime', f), path.join(dir, f));
  const compile = () => run('ghc', [...GHC_FLAGS, '-outputdir', path.join(dir, 'build'), '-o', path.join(dir, 'prog'), 'Instr.hs'], tool);
  const messages: string[] = [];
  let ghc = await compile();
  if (ghc.code !== 0) {
    const noLib = await instrument(['--no-lib']);
    if (noLib.code !== 0) return trace('internal-error', { message: `${MSG_INSTRUMENT}\n\n${ghc.stderr}`, diagnostics });
    ghc = await compile();
    if (ghc.code !== 0) return trace('internal-error', { message: `${MSG_INSTRUMENT}\n\n${ghc.stderr}`, diagnostics });
    messages.push(MSG_NO_LIB);
  }

  // 5. Run.
  const tracePath = path.join(dir, 'trace.json');
  const exe = await run(path.join(dir, 'prog'), [], {
    cwd: dir,
    env: { UNFOLD_TRACE: tracePath, UNFOLD_MAX_STEPS: String(MAX_STEPS), UNFOLD_TIMEOUT_MS: String(TIMEOUT_MS) },
    timeoutMs: KILL_MS,
    maxOutput: MAX_STDOUT,
    stdin: '',
  });
  if (exe.truncated) messages.push(MSG_TRUNCATED);
  const message = () => (messages.length > 0 ? { message: messages.join('\n\n') } : {});
  if (exe.timedOut) return trace('limit', { limitReached: 'time', stdout: exe.stdout, diagnostics, ...message() });

  // 6. Merge the raw trace with META.
  let calls: Call[];
  let raw: RawTrace;
  try {
    raw = JSON.parse(await readFile(tracePath, 'utf8')) as RawTrace;
    const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as Meta;
    calls = raw.calls.map(c => mergeCall(c, meta));
  } catch (e) {
    const detail = exe.stderr.trim() || (e instanceof Error ? e.message : String(e));
    return trace('internal-error', { message: `${MSG_NO_TRACE}\n\n${detail}`, stdout: exe.stdout, diagnostics });
  }

  let status: Trace['status'] = raw.status;
  if (raw.status === 'runtime-error' && raw.message !== null) {
    // 7. Reading stdin (always empty here).
    messages.unshift(raw.message.includes('end of file') && readsStdin(code) ? MSG_STDIN : raw.message);
  }
  if (exe.truncated && status === 'ok') status = 'limit';
  const t = trace(status, { stdout: exe.stdout, diagnostics, calls, ...message() });
  if (raw.status === 'limit' && raw.limit !== null) t.limitReached = raw.limit;
  return t;
}

export const haskellTracer: Tracer = {
  language: 'haskell',
  async run(code) {
    let dir: string | undefined;
    try {
      dir = await mkdtemp(path.join(tmpdir(), 'unfold-run-'));
      return await pipeline(code, dir);
    } catch (e) {
      return trace('internal-error', { message: `Erreur interne d'Unfold : ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  },
};
