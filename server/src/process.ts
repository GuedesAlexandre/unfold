import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  /** Maximum number of characters kept per stream; anything beyond is dropped and `truncated` is set. */
  maxOutput: number;
  stdin?: string;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

/** Run a process without a shell, with a time limit and bounded output capture. */
export function run(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = { stdout: '', stderr: '' };
    let truncated = false;
    let timedOut = false;

    const collect = (key: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const room = opts.maxOutput - out[key].length;
      const text = chunk.toString('utf8');
      if (text.length > room) {
        truncated = true;
        out[key] += text.slice(0, Math.max(room, 0));
      } else {
        out[key] += text;
      }
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout: out.stdout, stderr: out.stderr, timedOut, truncated });
    });

    child.stdin.on('error', () => { /* child may exit before reading stdin */ });
    child.stdin.end(opts.stdin ?? '');
  });
}
