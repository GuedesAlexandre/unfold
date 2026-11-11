import type { Call, Value } from '@unfold/shared/trace';

const isTuple = (name: string) => /^\(,+\)$/.test(name);

function needsParens(v: Value): boolean {
  if (v.t === 'num') return v.v.startsWith('-');
  return v.t === 'con' && v.args.length > 0 && !isTuple(v.name);
}

function arg(v: Value): string {
  const s = formatValue(v);
  return needsParens(v) ? `(${s})` : s;
}

/** Texte court d'une valeur. */
export function formatValue(v: Value): string {
  switch (v.t) {
    case 'num': return v.v;
    case 'char': return `'${v.v}'`;
    case 'str': return `"${v.v}${v.rest === 'end' ? '' : '…'}"`;
    case 'list': {
      const parts = v.items.map(formatValue);
      if (v.rest !== 'end') parts.push('…');
      return `[${parts.join(',')}]`;
    }
    case 'con':
      if (isTuple(v.name)) return `(${v.args.map(formatValue).join(',')})`;
      return [v.name, ...v.args.map(arg)].join(' ');
    case 'thunk': return '?';
    case 'fun': return '<fonction>';
    case 'cut': return '…';
    case 'opaque': return `<${v.desc}>`;
  }
}

/** `fib 4`, `λ 3`, `++ [1] [2]`. */
export function callLabel(c: Call): string {
  const name = c.kind === 'lambda' ? 'λ' : c.name;
  return [name, ...c.args.map(arg)].join(' ');
}
