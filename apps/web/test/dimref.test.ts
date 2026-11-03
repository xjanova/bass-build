import { buildNetwork } from '@bassbuild/physics';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import { sanitizeDesign } from '../src/data/compare';
import type { DampingMaterialDto, DriverDto } from '../src/data/types';
import { problemsFor, type BuildCtx } from '../src/sim/buildable';
import { convertDims, DIM_RANGE, dimRange, driverFromDto, sidesIn, sizeBox, suggestDesign, switchDims, toSpec, type BoxGeometry } from '../src/sim/model';
import { DEFAULT_DESIGN, useApp, type Design } from '../src/state/store';

const drivers = (seed.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }) as DriverDto);
const damping = (materials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }) as DampingMaterialDto);
const ctxOf = (model: string): BuildCtx => {
  const dto = drivers.find((d) => d.model === model)!;
  const r = driverFromDto(dto);
  if (!r.ok) throw new Error('incomplete');
  return { dto, driver: r.driver, damping };
};
const ctx = ctxOf('18BMA-2000S');
const geoOf = (d: Design): BoxGeometry => sizeBox(d, ctx.dto, buildNetwork(toSpec(d, ctx.driver, damping)), undefined);
const codes = (d: Design) => problemsFor(d, ctx).map((p) => p.code);
const base: Design = { ...DEFAULT_DESIGN, ...suggestDesign(DEFAULT_DESIGN, ctx.driver, ctx.dto, damping).patch };
const sealed: Design = { ...base, boxType: 'sealed', vbL: 120 };
const mm = (m: number) => m * 1000;

const sized = { wMode: 'fixed', wMm: 700, hMode: 'fixed', hMm: 550, dMode: 'fixed', dMm: 550 } as const;

describe('sizes entered as inside sizes', () => {
  it('a box gets those inside sizes, and two panels more outside', () => {
    const d: Design = { ...sealed, ...sized, vbL: 100, dimRef: 'inner' };
    const g = geoOf(d);
    expect(mm(g.wi)).toBeCloseTo(700, 6);
    expect(mm(g.hi)).toBeCloseTo(550, 6);
    expect(mm(g.di)).toBeCloseTo(550, 6);
    expect(mm(g.wx)).toBeCloseTo(700 + 2 * d.thicknessMm, 6);
    expect(mm(g.hx)).toBeCloseTo(550 + 2 * d.thicknessMm, 6);
    expect(mm(g.dx)).toBeCloseTo(550 + 2 * d.thicknessMm, 6);
    expect(sidesIn(g, 'inner').map(mm)).toEqual([g.wi, g.hi, g.di].map(mm));
    // The same box entered from outside holds the same air.
    const t2 = 2 * d.thicknessMm;
    const o = geoOf({ ...d, dimRef: 'outer', wMm: 700 + t2, hMm: 550 + t2, dMm: 550 + t2 });
    expect(o.capacityL!).toBeCloseTo(g.capacityL!, 6);
    expect(codes(d)).toEqual([]);
  });

  it('a wedge takes the number as its inside floor depth', () => {
    const w: Design = { ...sealed, shape: 'wedge', wedgeTopPct: 50, dimRef: 'inner', dMode: 'fixed', dMm: 500 };
    const g = geoOf(w);
    expect(g.shape).toBe('wedge');
    expect(mm(g.di)).toBeCloseTo(500, 6);
    expect(mm(g.diTop)).toBeCloseTo(250, 6);
    // Outside: the baffle in front, the leaning back measured level behind.
    expect(mm(g.dx)).toBeGreaterThan(500 + 2 * w.thicknessMm);
    // Entering that outside floor depth instead gives the same box.
    const o = geoOf({ ...w, dimRef: 'outer', dMm: mm(g.dx) });
    expect(mm(o.di)).toBeCloseTo(500, 3);
    expect(mm(o.dx)).toBeCloseTo(mm(g.dx), 3);
  });

  it('a thicker panel keeps the inside and grows the outside (and the reverse for outside sizes)', () => {
    const inner: Design = { ...sealed, ...sized, vbL: 100, dimRef: 'inner' };
    const a = geoOf(inner), b = geoOf({ ...inner, thicknessMm: 25 });
    expect(mm(b.wi)).toBeCloseTo(mm(a.wi), 6);
    expect(mm(b.di)).toBeCloseTo(mm(a.di), 6);
    expect(mm(b.wx - a.wx)).toBeCloseTo(14, 6);
    expect(mm(b.dx - a.dx)).toBeCloseTo(14, 6);
    const outer: Design = { ...inner, dimRef: 'outer' };
    const c = geoOf(outer), e = geoOf({ ...outer, thicknessMm: 25 });
    expect(mm(e.wx)).toBeCloseTo(mm(c.wx), 6);
    expect(mm(c.wi - e.wi)).toBeCloseTo(14, 6);
    // A wedge's inside floor depth holds too.
    const w: Design = { ...sealed, shape: 'wedge', wedgeTopPct: 50, dimRef: 'inner', dMode: 'fixed', dMm: 500 };
    const w1 = geoOf(w), w2 = geoOf({ ...w, thicknessMm: 25 });
    expect(mm(w2.di)).toBeCloseTo(500, 6);
    expect(w2.dx).toBeGreaterThan(w1.dx);
  });
});

describe('switching between outside and inside numbers', () => {
  const same = (a: BoxGeometry, b: BoxGeometry, tol: number) => {
    for (const k of ['wx', 'hx', 'dx', 'wi', 'hi', 'di'] as const) expect(Math.abs(mm(a[k]) - mm(b[k]))).toBeLessThanOrEqual(tol);
  };

  it('keeps a box the same size, both ways', () => {
    const d: Design = { ...sealed, wMode: 'fixed', wMm: 760, hMode: 'max', hMm: 600, dMode: 'fixed', dMm: 520 };
    const g = geoOf(d);
    const p = convertDims(d, g, 'inner');
    expect(p).toMatchObject({ dimRef: 'inner', wMm: 760 - 36, hMm: 600 - 36, dMm: 520 - 36 });
    const inner = { ...d, ...p };
    same(g, geoOf(inner), 1e-6);
    // and back to the very numbers it started from
    expect(convertDims(inner, geoOf(inner), 'outer')).toMatchObject({ dimRef: 'outer', wMm: 760, hMm: 600, dMm: 520 });
    expect(convertDims(d, g, 'outer')).toEqual({});
  });

  it('keeps a wedge the same size (to the millimetre the fields take)', () => {
    const d: Design = { ...sealed, shape: 'wedge', wedgeTopPct: 40, hMode: 'fixed', hMm: 700, dMode: 'fixed', dMm: 560 };
    const g = geoOf(d);
    const inner = { ...d, ...convertDims(d, g, 'inner') };
    expect(inner.dMm).toBe(Math.round(mm(g.di)));
    same(g, geoOf(inner), 1);
    const back = { ...inner, ...convertDims(inner, geoOf(inner), 'outer') };
    expect(Math.abs(back.dMm - 560)).toBeLessThanOrEqual(1);
  });

  it('is one undo step', () => {
    const st = useApp.getState();
    const d: Design = { ...sealed, wMode: 'fixed', wMm: 760 };
    st.patchDesign(d, { history: false });
    const n = useApp.getState().past.length;
    useApp.getState().patchDesign(convertDims(d, geoOf(d), 'inner'));
    expect(useApp.getState().past.length).toBe(n + 1);
    expect(useApp.getState().design).toMatchObject({ dimRef: 'inner', wMm: 724 });
    useApp.getState().undo();
    expect(useApp.getState().design).toMatchObject({ dimRef: 'outer', wMm: 760 });
  });
});

describe('switching at the ends of the range', () => {
  const same = (a: BoxGeometry, b: BoxGeometry, tol: number) => {
    for (const k of ['wx', 'hx', 'dx', 'wi', 'hi', 'di'] as const) expect(Math.abs(mm(a[k]) - mm(b[k]))).toBeLessThanOrEqual(tol);
  };

  it('the inside range is the outside range less the panels', () => {
    const d: Design = { ...sealed, thicknessMm: 18 };
    expect(dimRange(d, geoOf(d), 0, 'outer')).toEqual([...DIM_RANGE]);
    expect(dimRange(d, geoOf(d), 0, 'inner')).toEqual([DIM_RANGE[0] - 36, DIM_RANGE[1] - 36]);
    expect(dimRange({ ...d, thicknessMm: 25 }, null, 1, 'inner')).toEqual([DIM_RANGE[0] - 50, DIM_RANGE[1] - 50]);
  });

  it('the largest and smallest sizes switch without being clamped, both ways', () => {
    for (const [wMm, t] of [[DIM_RANGE[1], 18], [DIM_RANGE[0], 18], [DIM_RANGE[0], 25]] as const) {
      const d: Design = { ...sealed, thicknessMm: t, wMode: 'fixed', wMm };
      const g = geoOf(d);
      const s = switchDims(d, g, 'inner');
      expect(s.blocked).toEqual([]);
      expect(s.patch).toMatchObject({ dimRef: 'inner', wMm: wMm - 2 * t });
      const inner = { ...d, ...s.patch };
      same(g, geoOf(inner), 1e-6);
      const back = switchDims(inner, geoOf(inner), 'outer');
      expect(back.blocked).toEqual([]);
      expect(back.patch).toMatchObject({ dimRef: 'outer', wMm });
    }
  });

  it('a wedge floor depth at the end of the range switches to the millimetre', () => {
    const d: Design = { ...sealed, shape: 'wedge', wedgeTopPct: 40, hMode: 'fixed', hMm: 700, dMode: 'fixed', dMm: DIM_RANGE[1] };
    const g = geoOf(d);
    const s = switchDims(d, g, 'inner');
    expect(s.blocked).toEqual([]);
    const inner = { ...d, ...s.patch };
    same(g, geoOf(inner), 1);
    const back = switchDims(inner, geoOf(inner), 'outer');
    expect(back.blocked).toEqual([]);
    expect(Math.abs(back.patch.dMm! - DIM_RANGE[1])).toBeLessThanOrEqual(1);
  });

  it('refuses, instead of resizing the box, when a number has no match on the other side', () => {
    // An inside width entered at the top of the range with a thin panel, then a thicker panel.
    const d: Design = { ...sealed, thicknessMm: 25, dimRef: 'inner', wMode: 'fixed', wMm: DIM_RANGE[1] - 36 };
    const s = switchDims(d, geoOf(d), 'outer');
    expect(s.blocked).toEqual([0]);
    expect(s.patch).toEqual({});
    // A side left to "auto" does not block: its number is not used.
    const auto = { ...d, wMode: 'auto' } as const;
    const a = switchDims(auto, geoOf(auto), 'outer');
    expect(a.blocked).toEqual([]);
    expect(a.patch.wMm).toBe(DIM_RANGE[1]);
  });
});

describe('conflicts with inside sizes', () => {
  it('a width too narrow says what inside width it needs', () => {
    const outer: Design = { ...sealed, wMode: 'fixed', wMm: 300 };
    const inner: Design = { ...outer, dimRef: 'inner' };
    const go = geoOf(outer), gi = geoOf(inner);
    expect(gi.dimConflict).toMatchObject({ axis: 0, ref: 'inner' });
    expect(go.dimConflict).toMatchObject({ axis: 0, ref: 'outer' });
    expect(mm(gi.dimConflict!.limit)).toBeCloseTo(300, 6);
    // The contents need the same inside width either way; the inside number is two panels less.
    expect(mm(gi.dimConflict!.need)).toBeCloseTo(mm(go.dimConflict!.need) - 2 * inner.thicknessMm, 6);
    const text = problemsFor(inner, ctx).find((p) => p.code === 'space')!.text;
    expect(text).toContain('(ภายใน)');
    expect(text).toContain('300 มม.');
    expect(text).toContain(`${Math.round(mm(gi.dimConflict!.need))} มม.`);
    expect(problemsFor(outer, ctx).find((p) => p.code === 'space')!.text).toContain('(ภายนอก)');
  });

  it('a wedge floor depth too shallow reports the inside floor depth', () => {
    const w: Design = { ...sealed, shape: 'wedge', wedgeTopPct: 50, dimRef: 'inner', dMode: 'fixed', dMm: 150 };
    const g = geoOf(w);
    expect(g.dimConflict).toMatchObject({ axis: 2, ref: 'inner' });
    expect(mm(g.dimConflict!.need)).toBeGreaterThan(150);
    // The box is laid out at what the magnet needs, so its inside floor depth is that need.
    expect(mm(g.di)).toBeCloseTo(mm(g.dimConflict!.need), 3);
    expect(problemsFor(w, ctx).find((p) => p.code === 'space')!.text).toContain('ที่พื้น (ภายใน)');
  });

  it('sizes too small for the volume say they are inside sizes', () => {
    const d: Design = { ...sealed, ...sized, dimRef: 'inner' };
    const cap = geoOf(d).capacityL!;
    const over = { ...d, vbL: Math.ceil(cap) + 5 };
    const p = problemsFor(over, ctx).find((x) => x.code === 'space');
    expect(p?.text).toContain('ขนาดที่กำหนด (ภายใน)');
    expect(p?.text).toContain(`${Math.floor(cap)} L`);
    // Inside sizes hold more than the same numbers taken as outside sizes.
    expect(cap).toBeGreaterThan(geoOf({ ...d, dimRef: 'outer' }).capacityL!);
  });
});

describe('stored designs', () => {
  it('take dimRef only when it is a known choice', () => {
    expect(DEFAULT_DESIGN.dimRef).toBe('outer');
    expect(sanitizeDesign({ dimRef: 'inner', wMm: 640 }, DEFAULT_DESIGN)).toMatchObject({ dimRef: 'inner', wMm: 640 });
    expect(sanitizeDesign({ dimRef: 'middle' }, DEFAULT_DESIGN).dimRef).toBe('outer');
    expect(sanitizeDesign({ dimRef: 1 }, DEFAULT_DESIGN).dimRef).toBe('outer');
    // Designs saved before the field existed keep reading their numbers as outside sizes.
    expect(sanitizeDesign({ wMode: 'fixed', wMm: 700 }, DEFAULT_DESIGN).dimRef).toBe('outer');
  });
});
