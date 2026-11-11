import type { Trace } from '@unfold/shared/trace';

/** A language's tracer: source code in, common `Trace` out (never throws for the user's code). */
export interface Tracer {
  language: Trace['language'];
  run(code: string): Promise<Trace>;
}
