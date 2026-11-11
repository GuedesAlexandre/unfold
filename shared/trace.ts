export type Span = { line: number; col: number; endLine: number; endCol: number }; // 1-based, endCol exclusif
export type Value =
  | { t: 'num'; v: string }
  | { t: 'char'; v: string }
  | { t: 'str'; v: string; rest: 'end' | 'thunk' | 'cut' }       // liste de Char
  | { t: 'list'; items: Value[]; rest: 'end' | 'thunk' | 'cut' } // rest = ce qui suit le dernier item
  | { t: 'con'; name: string; args: Value[] }                    // Bool, tuples "(,)", "()", data utilisateur
  | { t: 'thunk' } | { t: 'fun' } | { t: 'cut' } | { t: 'opaque'; desc: string };
export type CallKind = 'user' | 'lib' | 'lambda' | 'method';
export interface Call {
  id: number; parent: number;            // 0 = racine (main), absente de calls
  enter: number; exit?: number;          // numéros de séquence globaux (ordre réel)
  name: string; kind: CallKind;
  defSpan?: Span;                        // définition de la fonction
  appSpan?: Span;                        // application complète au site d'appel (ex. `fib (n-1)`) dans le corps du parent
  eqSpan?: Span; rhsSpan?: Span; rhsText?: string; // équation/garde choisie et son côté droit
  eqText?: string;                       // texte de l'équation/garde choisie (légendes)
  args: Value[]; result?: Value;         // result absent = jamais revenu
  error?: { message: string; origin: boolean };
}
export type Status = 'ok' | 'compile-error' | 'runtime-error' | 'limit' | 'no-main' | 'internal-error';
export interface Diagnostic { span: Span; severity: 'error' | 'warning'; message: string }
export interface Trace {
  version: 1; language: 'haskell' | 'c' | 'python'; status: Status;
  message?: string; stdout: string; diagnostics: Diagnostic[]; calls: Call[];
  limitReached?: 'steps' | 'time';
}
