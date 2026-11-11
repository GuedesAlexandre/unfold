import type { Trace } from '@unfold/shared/trace';

/** Exécute `code` (Haskell) sur le serveur local et renvoie sa trace. Rejette avec un message en français. */
export async function runCode(code: string): Promise<Trace> {
  let res: Response;
  try {
    res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'haskell', code }),
    });
  } catch {
    throw new Error('Impossible de joindre le serveur Unfold — est-il lancé ?');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Réponse illisible du serveur (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const msg = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof msg === 'string' ? msg : `Erreur du serveur (HTTP ${res.status})`);
  }
  const t = body as Partial<Trace> | null;
  if (!t || t.version !== 1 || !Array.isArray(t.calls)) throw new Error('Réponse inattendue du serveur');
  return t as Trace;
}
