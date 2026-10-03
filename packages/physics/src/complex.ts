/** Minimal complex arithmetic. Values are plain immutable objects so they can cross worker boundaries. */
export interface Cx {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Cx => ({ re, im });
export const ZERO: Cx = cx(0);
export const ONE: Cx = cx(1);

export const add = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const scale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k });
export const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
export const inv = (a: Cx): Cx => div(ONE, a);
export const neg = (a: Cx): Cx => ({ re: -a.re, im: -a.im });
export const abs = (a: Cx): number => Math.hypot(a.re, a.im);
export const arg = (a: Cx): number => Math.atan2(a.im, a.re);
/** e^{jθ} */
export const expj = (theta: number): Cx => ({ re: Math.cos(theta), im: Math.sin(theta) });
