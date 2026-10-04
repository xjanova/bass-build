import { buildNetwork, type Driver } from '@bassbuild/physics';
import type { DampingMaterialDto, DriverDto } from '../data/types';
import type { BoxType, Design } from '../state/store';
import { buildProblems, RANGES, sizeBox, toSpec, type BuildProblem } from './model';

/**
 * Keeps the lab's sliders inside boxes that can actually be built. For each slider, the values
 * that would collide (a port too short or too long for the box, a box too small for the driver
 * and its magnet, …) are found by scanning the slider's range with everything else held, and the
 * slider then stops at the edge of the buildable stretch it is in.
 */
export type LimitedField = 'vbL' | 'fbHz' | 'portAreaCm2' | 'vfL' | 'fb2Hz' | 'port2AreaCm2' | 'prSdCm2';

export const STEP: Record<LimitedField, number> = { vbL: 1, fbHz: 0.5, portAreaCm2: 5, vfL: 1, fb2Hz: 0.5, port2AreaCm2: 5, prSdCm2: 5 };

/** The sliders that shape each box type. */
export function fieldsFor(t: BoxType): LimitedField[] {
  switch (t) {
    case 'sealed':
    case 'isobaric': return ['vbL'];
    case 'vented': return ['vbL', 'fbHz', 'portAreaCm2'];
    case 'pr': return ['vbL', 'prSdCm2'];
    case 'bp4': return ['vbL', 'vfL', 'fbHz', 'portAreaCm2'];
    case 'bp6': return ['vbL', 'vfL', 'fbHz', 'portAreaCm2', 'fb2Hz', 'port2AreaCm2'];
  }
}

export interface BuildCtx { dto: DriverDto | undefined; driver: Driver; damping: DampingMaterialDto[] }

/** Collisions of one design; only the network's port data and the layout are needed, not a frequency sweep. */
export function problemsFor(d: Design, ctx: BuildCtx): BuildProblem[] {
  const { info } = buildNetwork(toSpec(d, ctx.driver, ctx.damping));
  return buildProblems(d, ctx.dto, sizeBox(d, ctx.dto, { info }, undefined));
}

export interface FieldLimit {
  /** Buildable stretches of the slider, inclusive, in slider units. */
  ok: [number, number][];
  /** The stretch the current value is in; null when the current value cannot be built. */
  around: [number, number] | null;
  /** Why the slider stops at each end of `around` (null where it is the slider's own end). */
  belowWhy: string | null;
  aboveWhy: string | null;
}

const SAMPLES = 48;
// Scans are pure functions of (design without the field, driver, materials): keep recent ones so
// dragging one slider only rescans the others.
const cache = new Map<string, Omit<FieldLimit, 'around' | 'belowWhy' | 'aboveWhy'> & { why: Map<number, string> }>();
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object | undefined) => { if (!o) return 0; let v = ids.get(o); if (!v) { v = nextId++; ids.set(o, v); } return v; };

function scan(field: LimitedField, d: Design, ctx: BuildCtx) {
  const { [field]: _own, ...rest } = d;
  const key = `${field}|${idOf(ctx.dto)}|${idOf(ctx.driver)}|${idOf(ctx.damping)}|${JSON.stringify(rest)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [lo, hi] = RANGES[field];
  const step = STEP[field];
  const snap = (v: number) => Math.min(hi, Math.max(lo, Math.round(v / step) * step));
  const memo = new Map<number, BuildProblem[]>();
  const test = (v: number) => {
    let p = memo.get(v);
    if (!p) { p = problemsFor({ ...d, [field]: v }, ctx); memo.set(v, p); }
    return p;
  };
  const pts = [...new Set(Array.from({ length: SAMPLES }, (_, i) => snap(lo * (hi / lo) ** (i / (SAMPLES - 1)))))].sort((a, b) => a - b);
  // Walk a boundary between a buildable and an unbuildable value down to one slider step.
  const edge = (good: number, bad: number) => {
    while (Math.abs(good - bad) > step + 1e-9) {
      const mid = snap((good + bad) / 2);
      if (mid === good || mid === bad) break;
      if (test(mid).length) bad = mid; else good = mid;
    }
    return { good, why: test(bad)[0]?.text ?? '' };
  };
  const ok: [number, number][] = [];
  const why = new Map<number, string>(); // boundary value → reason just past it
  let start: number | null = null;
  for (let i = 0; i < pts.length; i++) {
    const good = !test(pts[i]).length;
    if (good && start === null) {
      start = i === 0 ? pts[0] : (() => { const e = edge(pts[i], pts[i - 1]); why.set(e.good, e.why); return e.good; })();
    }
    if (!good && start !== null) {
      const e = edge(pts[i - 1], pts[i]);
      why.set(e.good, e.why);
      ok.push([start, e.good]);
      start = null;
    }
  }
  if (start !== null) ok.push([start, pts[pts.length - 1]]);
  const out = { ok, why };
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}

export function fieldLimit(field: LimitedField, d: Design, ctx: BuildCtx): FieldLimit {
  const { ok, why } = scan(field, d, ctx);
  const v = d[field];
  const around = ok.find(([a, b]) => v >= a - 1e-9 && v <= b + 1e-9) ?? null;
  const [lo, hi] = RANGES[field];
  return {
    ok, around,
    belowWhy: around && around[0] > lo ? why.get(around[0]) ?? null : null,
    aboveWhy: around && around[1] < hi ? why.get(around[1]) ?? null : null
  };
}

/** Limits for every slider of the current box type. */
export function limitsFor(d: Design, ctx: BuildCtx): Partial<Record<LimitedField, FieldLimit>> {
  return Object.fromEntries(fieldsFor(d.boxType).map((f) => [f, fieldLimit(f, d, ctx)]));
}

/**
 * The smallest single-slider change that makes an unbuildable design buildable (measured as a
 * ratio, so 5 L on a 20 L box counts more than on a 400 L one), or null when no one slider can.
 */
export function nearestBuildable(d: Design, ctx: BuildCtx): { field: LimitedField; value: number } | null {
  let best: { field: LimitedField; value: number; cost: number } | null = null;
  for (const field of fieldsFor(d.boxType)) {
    const v = d[field];
    for (const [a, b] of scan(field, d, ctx).ok) {
      const value = v < a ? a : v > b ? b : v;
      const cost = Math.abs(Math.log(value / v));
      if (!best || cost < best.cost) best = { field, value, cost };
    }
  }
  return best ? { field: best.field, value: best.value } : null;
}

/** What each of a select's choices would collide with (an empty list = buildable). */
export function buildableChoices<K extends keyof Design>(d: Design, ctx: BuildCtx, key: K, values: Design[K][]): Map<Design[K], BuildProblem[]> {
  return new Map(values.map((v) => [v, problemsFor({ ...d, [key]: v }, ctx)]));
}
