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

/**
 * Run a process without a shell, with a time limit and bounded output capture.
 * The child gets its own process group, so a timeout kills its descendants too
 * (e.g. runghc → ghc → program), and the promise settles even if one of them
 * still holds the pipes.
 */
export function run(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    const out = { stdout: '', stderr: '' };
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const collect = (key: 'stdout' | 'stderr') => (text: string) => {
      const room = opts.maxOutput - out[key].length;
      if (text.length > room) {
        truncated = true;
        out[key] += text.slice(0, Math.max(room, 0));
      } else {
        out[key] += text;
      }
    };
    child.stdout.setEncoding('utf8').on('data', collect('stdout'));
    child.stderr.setEncoding('utf8').on('data', collect('stderr'));

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout: out.stdout, stderr: out.stderr, timedOut, truncated });
    };

    const killGroup = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL'); // group already gone
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, opts.timeoutMs);

    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    // After a timeout, don't wait for `close`: a descendant may keep the pipes open.
    child.on('exit', code => {
      if (timedOut) {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(code);
      }
    });
    child.on('close', code => finish(code));

    child.stdin.on('error', () => { /* child may exit before reading stdin */ });
    child.stdin.end(opts.stdin ?? '');
  });
}
