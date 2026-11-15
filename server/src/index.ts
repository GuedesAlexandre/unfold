import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Trace } from '@unfold/shared/trace';
import { haskellTracer, instrumenterBin } from './languages/haskell';
import type { Tracer } from './languages/types';

const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY = 1_000_000;

const tracers: Partial<Record<Trace['language'], Tracer>> = { haskell: haskellTracer };

/** Runs are handled one at a time. */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const p = queue.then(job);
  queue = p.catch(() => undefined);
  return p;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > MAX_BODY) tooBig = true;
    });
    req.on('end', () => resolve(tooBig ? null : body));
    req.on('error', reject);
  });
}

/** `POST /api/run` with `{ language, code }` → `200 Trace`. */
export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/api/health')) return send(res, 200, { ok: true });
      if (req.method !== 'POST' || req.url !== '/api/run') return send(res, 404, { error: 'Introuvable' });
      const text = await readBody(req);
      if (text === null) return send(res, 413, { error: 'Programme trop long' });
      let body: { language?: unknown; code?: unknown };
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        return send(res, 400, { error: 'Requête invalide : JSON attendu' });
      }
      const tracer = typeof body?.language === 'string' ? tracers[body.language as Trace['language']] : undefined;
      if (!tracer) return send(res, 400, { error: 'Langage non pris en charge' });
      if (typeof body.code !== 'string') return send(res, 400, { error: 'Requête invalide : `code` manquant' });
      const code = body.code;
      send(res, 200, await enqueue(() => tracer.run(code)));
    } catch (e) {
      send(res, 500, { error: `Erreur interne : ${e instanceof Error ? e.message : String(e)}` });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('Construction de unfold-instrument…');
  await instrumenterBin();
  createServer().listen(PORT, HOST, () => console.log(`Unfold écoute sur http://${HOST}:${PORT}`));
}
