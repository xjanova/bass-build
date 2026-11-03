import { buildNetwork } from '@bassbuild/physics';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import { sanitizeDesign } from '../src/data/compare';
import type { DampingMaterialDto, DriverDto } from '../src/data/types';
import { fieldLimit, problemsFor, type BuildCtx } from '../src/sim/buildable';
import { driverFromDto, panelModes, sizeBox, suggestDesign, toSpec, type BoxGeometry } from '../src/sim/model';
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

/** What the breakdown says the net air is: the shell less everything else in it. */
const netFromParts = (g: BoxGeometry) => {
  const v = g.volume;
  return v.shellL - v.driversL - v.portsL - v.boardsL - v.bracesL - v.tunnelL - v.extraL + g.shortL;
};

describe('box sizes set by hand', () => {
  it('a free box is laid out from its volume, with nothing left over or missing', () => {
    const g = geoOf(base);
    expect(g.shape).toBe('box');
    expect(g.dxTop).toBe(g.dx);
    expect(g.extraL).toBe(0);
    expect(g.shortL).toBe(0);
    expect(g.dimConflict).toBeNull();
    expect(g.capacityL).toBeNull();
    expect(netFromParts(g)).toBeCloseTo(base.vbL, 6);
  });

  it('a side held at a size gets that size; the others share the volume', () => {
    const g = geoOf({ ...sealed, wMode: 'fixed', wMm: 800 });
    expect(g.wx * 1000).toBeCloseTo(800, 6);
    expect(netFromParts(g)).toBeCloseTo(120, 6);
    expect(codes({ ...sealed, wMode: 'fixed', wMm: 800 })).toEqual([]);
  });

  it('a side kept under a size stays under it', () => {
    const free = geoOf(sealed);
    const limit = Math.round(free.wx * 1000) - 60;
    const g = geoOf({ ...sealed, wMode: 'max', wMm: limit });
    expect(g.wx * 1000).toBeLessThanOrEqual(limit + 1e-6);
    expect(g.dimConflict).toBeNull();
    expect(netFromParts(g)).toBeCloseTo(120, 6);
  });

  it('a width too narrow for the driver cannot be built, and says what it needs', () => {
    const d: Design = { ...sealed, wMode: 'fixed', wMm: 300 };
    const g = geoOf(d);
    expect(g.dimConflict?.axis).toBe(0);
    expect(g.dimConflict!.need * 1000).toBeGreaterThan(300);
    const p = problemsFor(d, ctx);
    expect(p.map((x) => x.code)).toContain('space');
    expect(p.map((x) => x.code)).not.toContain('too-small');
    expect(p.find((x) => x.code === 'space')!.text).toContain('300 มม.');
  });

  it('three sides set hold a known volume: more is unbuildable, less leaves room to fill', () => {
    const sized = { wMode: 'fixed', wMm: 700, hMode: 'fixed', hMm: 550, dMode: 'fixed', dMm: 550 } as const;
    const g = geoOf({ ...sealed, ...sized });
    expect(g.capacityL).not.toBeNull();
    const cap = g.capacityL!;
    // 0.664 × 0.514 × 0.514 m inside, less the driver and the brace.
    expect(cap).toBeGreaterThan(150);
    expect(cap).toBeLessThan(176);
    expect(codes({ ...sealed, ...sized, vbL: Math.ceil(cap) + 5 })).toContain('space');
    const small = geoOf({ ...sealed, ...sized, vbL: 100 });
    expect(small.extraL).toBeCloseTo(cap - 100, 0);
    expect(codes({ ...sealed, ...sized, vbL: 100 })).toEqual([]);
    // The volume slider stops where the box is full.
    const lim = fieldLimit('vbL', { ...sealed, ...sized, vbL: 100 }, ctx);
    expect(lim.around![1]).toBeLessThanOrEqual(cap);
    expect(lim.around![1]).toBeGreaterThan(cap - 2);
    expect(lim.aboveWhy).toContain('ขนาดที่กำหนด');
  });

  it('the suggested box fits the sizes set by hand', () => {
    const sized: Design = { ...base, boxType: 'vented', wMode: 'fixed', wMm: 700, hMode: 'max', hMm: 600, dMode: 'max', dMm: 520 };
    const s = suggestDesign(sized, ctx.driver, ctx.dto, damping);
    const d = { ...sized, ...s.patch };
    expect(s.flags).not.toContain('unbuildable');
    expect(codes(d)).toEqual([]);
    const g = geoOf(d);
    expect(g.hx * 1000).toBeLessThanOrEqual(600 + 1e-6);
    expect(g.dx * 1000).toBeLessThanOrEqual(520 + 1e-6);
    expect(d.vbL).toBeLessThan(base.vbL); // the free suggestion would not have fitted
  });
});

describe('wedge box', () => {
  const wedge: Design = { ...sealed, shape: 'wedge', wedgeTopPct: 50 };

  it('keeps its floor depth and leans its back; the inside still holds the volume', () => {
    const g = geoOf(wedge);
    expect(g.shape).toBe('wedge');
    expect(g.diTop / g.di).toBeCloseTo(0.5, 9);
    expect(g.dxTop).toBeLessThan(g.dx);
    expect(g.backAngle).toBeGreaterThan(0);
    // Same slope outside and inside: the back panel is one flat board.
    expect((g.dx - g.dxTop) / g.hx).toBeCloseTo((g.di - g.diTop) / g.hi, 9);
    expect(g.volume.shellL).toBeCloseTo(g.wi * g.hi * ((g.di + g.diTop) / 2) * 1000, 6);
    expect(netFromParts(g)).toBeCloseTo(120, 6);
    expect(codes(wedge)).toEqual([]);
  });

  it('is deep enough at the magnet even when the top is shallow', () => {
    const steep = geoOf({ ...wedge, wedgeTopPct: 20 });
    expect(steep.magnetClear).toBe(true);
    // The magnet's top edge sits above the middle, where the box is shallower than at the floor.
    expect(steep.di).toBeGreaterThan(geoOf(sealed).di);
  });

  it('a held floor depth is the outside depth at the floor', () => {
    const g = geoOf({ ...wedge, dMode: 'fixed', dMm: 520 });
    expect(g.dx * 1000).toBeCloseTo(520, 3);
  });

  it('a vented wedge folds its port up the leaning back', () => {
    const v: Design = { ...base, shape: 'wedge', wedgeTopPct: 60 };
    const g = geoOf(v);
    expect(g.shape).toBe('wedge');
    expect(g.portMaxLength).toBeCloseTo(g.di - Math.max(0.03, g.slotH) + Math.hypot(g.hi, g.di - g.diTop) - g.slotH, 9);
  });

  it('only sealed and vented boxes take the wedge outline', () => {
    expect(geoOf({ ...base, boxType: 'bp4', shape: 'wedge' }).shape).toBe('box');
    expect(geoOf({ ...base, boxType: 'pr', shape: 'wedge' }).shape).toBe('box');
  });

  it('panel modes use the trapezoid side and the leaning back', () => {
    const g = geoOf(wedge);
    const box = { ...g, shape: 'box' as const, diTop: g.di, dxTop: g.dx };
    const m = panelModes(g, undefined), mb = panelModes(box, undefined);
    expect(m.side).toBeGreaterThan(mb.side); // a shorter mean depth is stiffer
    expect(m.back).toBeLessThan(mb.back); // a longer back is floppier
  });
});

describe('undo and redo', () => {
  it('steps back and forward through design changes', () => {
    const st = useApp.getState();
    st.patchDesign({ vbL: 50 }, { history: false });
    const start = useApp.getState().past.length;
    st.patchDesign({ vbL: 60 });
    st.patchDesign({ fbHz: 33 });
    expect(useApp.getState().past.length).toBe(start + 2);
    useApp.getState().undo();
    expect(useApp.getState().design.fbHz).not.toBe(33);
    expect(useApp.getState().design.vbL).toBe(60);
    useApp.getState().undo();
    expect(useApp.getState().design.vbL).toBe(50);
    useApp.getState().redo();
    expect(useApp.getState().design.vbL).toBe(60);
    // A new change drops what was undone.
    useApp.getState().patchDesign({ ql: 7 });
    expect(useApp.getState().future).toEqual([]);
  });

  it('a slider drag is one step, and a change that changes nothing is none', () => {
    const st = useApp.getState();
    st.patchDesign({ watts: 100 }, { history: false });
    const n = useApp.getState().past.length;
    for (const w of [110, 120, 130, 140]) useApp.getState().patchDesign({ watts: w });
    expect(useApp.getState().past.length).toBe(n + 1);
    useApp.getState().patchDesign({ watts: 140 });
    expect(useApp.getState().past.length).toBe(n + 1);
    useApp.getState().undo();
    expect(useApp.getState().design.watts).toBe(100);
  });

  it('the rest of a drag folds into the step its first move opened', () => {
    const st = useApp.getState();
    st.patchDesign({ rowXMm: 0 }, { history: false });
    const n = useApp.getState().past.length;
    st.patchDesign({ rowMode: 'manual', rowXMm: 10, rowYMm: 300 });
    for (const x of [20, 30, 40]) useApp.getState().patchDesign({ rowMode: 'manual', rowXMm: x, rowYMm: 300 }, { merge: true });
    expect(useApp.getState().past.length).toBe(n + 1);
    useApp.getState().undo();
    expect(useApp.getState().design.rowXMm).toBe(0);
  });
});

describe('stored designs', () => {
  it('take the new outline and size fields only when they are valid', () => {
    const ok = sanitizeDesign({ shape: 'wedge', wMode: 'max', wMm: 700, dMode: 'fixed' }, DEFAULT_DESIGN);
    expect([ok.shape, ok.wMode, ok.wMm, ok.dMode]).toEqual(['wedge', 'max', 700, 'fixed']);
    const bad = sanitizeDesign({ shape: 'sphere', hMode: 'big', hMm: 'tall' }, DEFAULT_DESIGN);
    expect([bad.shape, bad.hMode, bad.hMm]).toEqual(['box', 'auto', DEFAULT_DESIGN.hMm]);
  });
});
