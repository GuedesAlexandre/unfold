import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { run } from '../src/process';

const base = { cwd: tmpdir(), timeoutMs: 10_000, maxOutput: 1_000 };

test('run : code, stdout, stderr, stdin, env', async () => {
  const r = await run('sh', ['-c', 'cat; echo "$FOO" >&2; exit 3'], { ...base, stdin: 'salut', env: { FOO: 'bar' } });
  expect(r).toEqual({ code: 3, stdout: 'salut', stderr: 'bar\n', timedOut: false, truncated: false });
});

test('run : délai dépassé', async () => {
  const r = await run('sleep', ['5'], { ...base, timeoutMs: 200 });
  expect(r.timedOut).toBe(true);
  expect(r.code).toBeNull();
});

test('run : sortie tronquée', async () => {
  const r = await run('sh', ['-c', 'yes | head -c 100000'], base);
  expect(r.truncated).toBe(true);
  expect(r.stdout.length).toBeLessThanOrEqual(1_000);
});

test('run : délai dépassé, petit-enfant qui garde les tubes', async () => {
  const start = Date.now();
  const r = await run('sh', ['-c', 'sleep 30 & sleep 30'], { ...base, timeoutMs: 500 });
  expect(r.timedOut).toBe(true);
  expect(r.code).toBeNull();
  expect(Date.now() - start).toBeLessThan(2_000);
});

test('run : UTF-8 coupé entre deux morceaux', async () => {
  const r = await run('sh', ['-c', "printf '\\303'; sleep 0.1; printf '\\251'"], base);
  expect(r.stdout).toBe('é');
});
