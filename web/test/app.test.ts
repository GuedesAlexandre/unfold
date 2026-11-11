import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Call, Diagnostic, Trace } from '@unfold/shared/trace';
import { runCode } from '../src/api';
import { statusBanners } from '../src/model/banners';
import { enterIndex, highlightSpan, isStale, remapPosition } from '../src/model/session';
import { buildSteps } from '../src/model/steps';

const tr = (extra: Partial<Trace> = {}, calls: Call[] = []): Trace => ({
  version: 1, language: 'haskell', status: 'ok', stdout: '', diagnostics: [], calls, ...extra,
});
const mk = (id: number, parent: number, enter: number, exit: number, extra: Partial<Call> = {}): Call =>
  ({ id, parent, enter, exit, name: `f${id}`, kind: 'user', args: [], ...extra });
const span = (line: number) => ({ line, col: 1, endLine: line, endCol: 5 });

describe('runCode', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })));

  test('envoie le code et renvoie la trace', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(tr()), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await expect(runCode('main = pure ()')).resolves.toMatchObject({ status: 'ok' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/run');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ language: 'haskell', code: 'main = pure ()' });
  });
  test('erreur HTTP : message du serveur', async () => {
    reply(413, { error: 'Programme trop long' });
    await expect(runCode('x')).rejects.toThrow('Programme trop long');
  });
  test('erreur HTTP sans message', async () => {
    reply(500, {});
    await expect(runCode('x')).rejects.toThrow('Erreur du serveur (HTTP 500)');
  });
  test('réponse non JSON', async () => {
    reply(502, '<html>Bad gateway</html>');
    await expect(runCode('x')).rejects.toThrow('Réponse illisible du serveur (HTTP 502)');
  });
  test('JSON inattendu', async () => {
    reply(200, { hello: 1 });
    await expect(runCode('x')).rejects.toThrow('Réponse inattendue du serveur');
  });
  test('serveur injoignable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(runCode('x')).rejects.toThrow('Impossible de joindre le serveur Unfold');
  });
});

describe('statusBanners', () => {
  test('ok sans message : rien ; avec message : information', () => {
    expect(statusBanners(tr())).toEqual([]);
    expect(statusBanners(tr({ message: 'Les fonctions de bibliothèque ne sont pas tracées' })))
      .toEqual([{ tone: 'info', text: 'Les fonctions de bibliothèque ne sont pas tracées' }]);
  });
  test('limite : étapes, temps, ou seulement le message', () => {
    expect(statusBanners(tr({ status: 'limit', limitReached: 'steps' })))
      .toEqual([{ tone: 'warn', text: 'Arrêté après 5 000 étapes — ce qui a été tracé reste visible' }]);
    expect(statusBanners(tr({ status: 'limit', limitReached: 'time', message: 'La sortie dépasse 100 Ko' }))).toEqual([
      { tone: 'warn', text: 'Arrêté après 10 s — ce qui a été tracé reste visible' },
      { tone: 'info', text: 'La sortie dépasse 100 Ko' },
    ]);
    expect(statusBanners(tr({ status: 'limit', message: 'La sortie dépasse 100 Ko' })))
      .toEqual([{ tone: 'warn', text: 'La sortie dépasse 100 Ko' }]);
  });
  test('plantage : le message en rouge', () => {
    expect(statusBanners(tr({ status: 'runtime-error', message: 'Prelude.head: empty list' })))
      .toEqual([{ tone: 'error', text: 'Prelude.head: empty list' }]);
  });
  test('no-main, erreur interne : le message', () => {
    expect(statusBanners(tr({ status: 'no-main', message: 'Il manque main' }))).toEqual([{ tone: 'warn', text: 'Il manque main' }]);
    expect(statusBanners(tr({ status: 'internal-error', message: 'boum' }))).toEqual([{ tone: 'warn', text: 'boum' }]);
  });
  test('compilation : titre et erreurs seulement (pas les avertissements)', () => {
    const err: Diagnostic = { span: span(3), severity: 'error', message: 'parse error' };
    const warn: Diagnostic = { span: span(1), severity: 'warning', message: 'unused' };
    expect(statusBanners(tr({ status: 'compile-error', diagnostics: [warn, err] })))
      .toEqual([{ tone: 'error', text: 'Le code ne compile pas', diagnostics: [err] }]);
  });
});

describe('session', () => {
  test('modifier le code invalide la trace ; revenir au même code la rétablit', () => {
    const run = { code: 'a', trace: tr() };
    expect(isStale('a', null)).toBe(false);
    expect(isStale('a', run)).toBe(false);
    expect(isStale('ab', run)).toBe(true);
  });
  test('surlignage : eqSpan, sinon defSpan, sinon rien', () => {
    expect(highlightSpan(mk(1, 0, 1, 2, { eqSpan: span(4), defSpan: span(2) }))).toEqual(span(4));
    expect(highlightSpan(mk(1, 0, 1, 2, { defSpan: span(2) }))).toEqual(span(2));
    expect(highlightSpan(mk(1, 0, 1, 2, { kind: 'lib' }))).toBeNull();
    expect(highlightSpan(undefined)).toBeNull();
  });
  test('enterIndex et remapPosition au repli', () => {
    // f1 → lib f2 → f3
    const t = tr({}, [mk(1, 0, 1, 6), mk(2, 1, 2, 5, { kind: 'lib' }), mk(3, 2, 3, 4)]);
    const open = buildSteps(t, new Set([2]), false); // e1 e2 e3 x3 x2 x1
    const shut = buildSteps(t, new Set(), false);    // e1 e2 x2 x1
    expect(enterIndex(open, 3)).toBe(3);
    expect(enterIndex(shut, 3)).toBeNull();
    expect(remapPosition(t, open, 3, shut)).toBe(2); // e3 disparaît → entrée de f2
    expect(remapPosition(t, open, 5, shut)).toBe(3); // x2 conservé
    expect(remapPosition(t, shut, 3, open)).toBe(5);
    expect(remapPosition(t, shut, 0, open)).toBe(1);
  });
});
