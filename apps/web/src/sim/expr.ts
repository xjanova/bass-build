/**
 * The formula notebook's own expression language: numbers, variables, + − × ÷ ^, brackets and a
 * fixed set of functions. A small recursive-descent parser — user text is never handed to eval or
 * Function, and its size and nesting are capped so a pasted monster cannot hang the page.
 */

export type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string; pos: number }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[]; pos: number };

export class ExprError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(message);
  }
}

export const MAX_LENGTH = 300;
const MAX_DEPTH = 40;

const FUNCS: Record<string, { n: [number, number]; f: (...a: number[]) => number }> = {
  sqrt: { n: [1, 1], f: Math.sqrt },
  abs: { n: [1, 1], f: Math.abs },
  log: { n: [1, 1], f: Math.log10 },
  log10: { n: [1, 1], f: Math.log10 },
  ln: { n: [1, 1], f: Math.log },
  exp: { n: [1, 1], f: Math.exp },
  sin: { n: [1, 1], f: Math.sin },
  cos: { n: [1, 1], f: Math.cos },
  tan: { n: [1, 1], f: Math.tan },
  round: { n: [1, 2], f: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d },
  min: { n: [1, 8], f: Math.min },
  max: { n: [1, 8], f: Math.max },
  pow: { n: [2, 2], f: Math.pow }
};
export const FUNCTION_NAMES = Object.keys(FUNCS);
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok = { t: 'num'; v: number; pos: number } | { t: 'id'; v: string; pos: number } | { t: 'op'; v: string; pos: number } | { t: 'end'; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]), pos: i }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0], pos: i }); i += id[0].length; continue; }
    // Typed or pasted math signs read as their ASCII meaning.
    const op = ({ '×': '*', '·': '*', '÷': '/', '−': '-', '–': '-' } as Record<string, string>)[ch] ?? ch;
    if ('+-*/^(),'.includes(op)) { out.push({ t: 'op', v: op, pos: i }); i++; continue; }
    throw new ExprError(`ไม่รู้จักเครื่องหมาย "${ch}"`, i);
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

export function parse(src: string): Node {
  if (src.length > MAX_LENGTH) throw new ExprError(`สูตรยาวเกิน ${MAX_LENGTH} ตัวอักษร`, MAX_LENGTH);
  if (!src.trim()) throw new ExprError('ยังไม่ได้พิมพ์สูตร', 0);
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = toks[p]; return t.t === 'op' && t.v === v; };
  const expect = (v: string, what: string) => {
    if (!isOp(v)) throw new ExprError(`ขาด ${what}`, peek().pos);
    p++;
  };
  const enter = () => { if (++depth > MAX_DEPTH) throw new ExprError('ซ้อนวงเล็บลึกเกินไป', peek().pos); };

  const expr = (): Node => {
    enter();
    let a = term();
    while (isOp('+') || isOp('-')) { const op = (toks[p++] as { v: '+' | '-' }).v; a = { k: 'bin', op, a, b: term() }; }
    depth--;
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (isOp('*') || isOp('/')) { const op = (toks[p++] as { v: '*' | '/' }).v; a = { k: 'bin', op, a, b: unary() }; }
    return a;
  };
  // −2^2 is −(2^2), and 2^−1 works: the exponent is itself a unary.
  const unary = (): Node => {
    if (isOp('-')) { p++; enter(); const a = unary(); depth--; return { k: 'neg', a }; }
    if (isOp('+')) { p++; return unary(); }
    return power();
  };
  const power = (): Node => {
    const a = atom();
    if (isOp('^')) { p++; enter(); const b = unary(); depth--; return { k: 'bin', op: '^', a, b }; }
    return a;
  };
  const atom = (): Node => {
    const t = peek();
    if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
    if (t.t === 'id') {
      p++;
      if (isOp('(')) {
        const fn = FUNCS[t.v.toLowerCase()];
        if (!fn) throw new ExprError(`ไม่รู้จักฟังก์ชัน ${t.v}`, t.pos);
        p++;
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(expr());
          while (isOp(',')) { p++; args.push(expr()); }
        }
        expect(')', 'วงเล็บปิด )');
        if (args.length < fn.n[0] || args.length > fn.n[1]) {
          throw new ExprError(`${t.v} ต้องการ ${fn.n[0] === fn.n[1] ? fn.n[0] : `${fn.n[0]}–${fn.n[1]}`} ค่า`, t.pos);
        }
        return { k: 'call', fn: t.v.toLowerCase(), args, pos: t.pos };
      }
      return { k: 'var', name: t.v, pos: t.pos };
    }
    if (t.t === 'op' && t.v === '(') { p++; const a = expr(); expect(')', 'วงเล็บปิด )'); return a; }
    throw new ExprError(t.t === 'end' ? 'สูตรจบไม่สมบูรณ์' : `ไม่คาดว่าจะเจอ "${t.v}" ตรงนี้`, t.pos);
  };

  const tree = expr();
  if (peek().t !== 'end') {
    const t = peek() as { v: string | number; pos: number };
    throw new ExprError(`ไม่คาดว่าจะเจอ "${t.v}" ตรงนี้`, t.pos);
  }
  return tree;
}

/** Variables are matched without regard to case, so "fs" and "Fs" are the same. */
export function evaluate(node: Node, vars: Record<string, number>): number {
  const lower = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  const run = (n: Node): number => {
    switch (n.k) {
      case 'num': return n.v;
      case 'neg': return -run(n.a);
      case 'var': {
        const v = lower.get(n.name.toLowerCase()) ?? CONSTS[n.name.toLowerCase()];
        if (v === undefined) throw new ExprError(`ไม่มีตัวแปร ${n.name}`, n.pos);
        return v;
      }
      case 'bin': {
        const a = run(n.a), b = run(n.b);
        return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b);
      }
      case 'call': return FUNCS[n.fn].f(...n.args.map(run));
    }
  };
  return run(node);
}

/** Parse and evaluate in one go: a number, or a Thai message and where it went wrong. */
export function calc(src: string, vars: Record<string, number>): { ok: true; value: number } | { ok: false; error: string; pos: number } {
  try {
    const value = evaluate(parse(src), vars);
    if (!Number.isFinite(value)) return { ok: false, error: Number.isNaN(value) ? 'คำนวณไม่ได้ (เช่น รากของค่าติดลบ)' : 'ผลเป็นอนันต์ (เช่น หารด้วยศูนย์)', pos: 0 };
    return { ok: true, value };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message, pos: e.pos };
    throw e;
  }
}
