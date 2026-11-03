import { buildNetwork } from '@bassbuild/physics';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import { sanitizeDesign } from '../src/data/compare';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../src/data/types';
import { fitBraces, problemsFor, type BuildCtx } from '../src/sim/buildable';
import { blueprintFor, cutListCsv, partsFor } from '../src/sim/blueprint';
import { BRACE_GAP, BRACE_WINDOW_MIN, braceBottom, bracePlan, braceSpan, DOWEL_D, dowelRows, freeSpan, innerBaffleZ, prHoleRadius, sideRow, slotBoards } from '../src/sim/layout';
import { braceVolume, buildProblems, driverFromDto, panelModes, sizeBox, suggestDesign, toSpec, type BoxGeometry } from '../src/sim/model';
import { DEFAULT_DESIGN, type BoxType, type Design } from '../src/state/store';

const drivers = (seed.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }) as DriverDto);
const damping = (materials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }) as DampingMaterialDto);
const mdf = { ...(materials.panelMaterials[0] as unknown as PanelMaterialDto), id: 1 };
const dto = drivers.find((d) => d.model === '18BMA-2000S')!;
const r = driverFromDto(dto);
if (!r.ok) throw new Error('incomplete');
const ctx: BuildCtx = { dto, driver: r.driver, damping };
const geoOf = (d: Design): BoxGeometry => sizeBox(d, dto, buildNetwork(toSpec(d, r.driver, damping)), mdf);
const codes = (d: Design) => problemsFor(d, ctx).map((p) => p.code);
/** The suggested (buildable) box of a type for the test driver. */
const boxOf = (type: BoxType, extra: Partial<Design> = {}): Design => {
  const start = { ...DEFAULT_DESIGN, boxType: type, ...extra };
  return { ...start, ...suggestDesign(start, r.driver, dto, damping).patch };
};
const vented = boxOf('vented');
const braced = (d: Design, braceKind: Design['braceKind'], braceCount = 1): Design => ({ ...d, braceKind, braceCount });

/** The side, back and top (1,1) modes as panelModes computed them before bracing was modelled. */
function unbraced(g: BoxGeometry) {
  const e = mdf.eGpa! * 1e9, rho = mdf.densityKgM3!, nu = mdf.poisson ?? 0.25, h = g.t;
  const bend = (e * h ** 3) / (12 * (1 - nu * nu));
  const f11 = (a: number, b: number) => (Math.PI / 2) * Math.sqrt(bend / (rho * h)) * (1 / (a * a) + 1 / (b * b));
  return { side: f11((g.di + g.diTop) / 2, g.hi), back: f11(g.wi, Math.hypot(g.hi, g.di - g.diTop)), top: f11(g.wi, g.diTop) };
}

describe('bracing and the panel modes', () => {
  it('no bracing reproduces the unbraced formula exactly (plain box and wedge)', () => {
    for (const d of [vented, boxOf('sealed', { shape: 'wedge', wedgeTopPct: 60 })]) {
      const g = geoOf(braced(d, 'none'));
      expect(g.braces.zs).toEqual([]);
      const m = panelModes(g, mdf);
      expect(m.side).toBe(unbraced(g).side);
      expect(m.back).toBe(unbraced(g).back);
    }
  });

  it('the default is one window brace at mid-depth: the side bay halves and its mode rises', () => {
    expect(DEFAULT_DESIGN.braceKind).toBe('window');
    expect(DEFAULT_DESIGN.braceCount).toBe(1);
    const g = geoOf(vented);
    expect(g.braces.zs).toHaveLength(1);
    expect(g.braces.zs[0]).toBeCloseTo(g.di / 2, 9);
    expect(freeSpan(g.braces.sideHeld, g.di)).toBeCloseTo(g.di / 2, 9);
    const none = panelModes(geoOf(braced(vented, 'none')), mdf);
    const one = panelModes(g, mdf);
    expect(one.side).toBeGreaterThan(none.side * 1.5);
  });

  // The same box with other bracing laid into it (a design change would also resize the box a little).
  const base = geoOf(vented);
  const rebrace = (kind: Design['braceKind'], n: number): BoxGeometry => ({ ...base, braces: bracePlan(base, vented.boxType, vented.count, kind, n) });

  it('more window braces: evenly spaced, the side and top modes keep rising, the back does not change', () => {
    let last = panelModes(rebrace('none', 1), mdf);
    for (const n of [1, 2, 3]) {
      const g = rebrace('window', n);
      expect(g.braces.zs).toHaveLength(n);
      const m = panelModes(g, mdf);
      expect(m.side).toBeGreaterThan(last.side);
      expect(m.top).toBeGreaterThan(last.top);
      expect(m.back).toBeCloseTo(last.back, 9);
      last = m;
    }
    // Nothing in the way (a sealed box, no slot riser at the back): the planes sit at depth/(n+1) steps.
    const g3 = geoOf(braced(boxOf('sealed'), 'window', 3));
    expect(g3.braces.zs).toHaveLength(3);
    g3.braces.zs.forEach((z, i) => expect(z).toBeCloseTo(((i + 1) * g3.di) / 4, 9));
    expect(freeSpan(g3.braces.sideHeld, g3.di)).toBeCloseTo(g3.di / 4, 9);
    // The real design change agrees on the trend.
    expect(panelModes(geoOf(braced(vented, 'window', 3)), mdf).side).toBeGreaterThan(panelModes(geoOf(braced(vented, 'window', 2)), mdf).side);
  });

  it('dowels hold the sides but not the top', () => {
    const none = panelModes(rebrace('none', 1), mdf);
    const g = rebrace('dowel', 2);
    const m = panelModes(g, mdf);
    expect(g.braces.zs).toHaveLength(2);
    expect(g.braces.dowelYs).toHaveLength(dowelRows(g.braces.top - g.braces.bottom));
    expect(m.side).toBeGreaterThan(none.side);
    expect(m.top).toBe(none.top);
    expect(g.braces.topHeld).toEqual([]);
  });

  it('no bracing is the unbraced formula for every box type (inside boards are not counted as supports)', () => {
    for (const type of ['sealed', 'vented', 'pr', 'bp4', 'bp6', 'isobaric'] as const) {
      const g = geoOf(braced(boxOf(type), 'none'));
      expect(g.braces.sideHeld).toEqual([]);
      expect(g.braces.topHeld).toEqual([]);
      const m = panelModes(g, mdf), u = unbraced(g);
      expect(m.side, type).toBe(u.side);
      expect(m.back, type).toBe(u.back);
      expect(m.top, type).toBe(u.top);
    }
  });
});

describe('where the braces go', () => {
  const clear = (g: BoxGeometry, a: number, b: number) => g.braces.zs.forEach((z) => {
    expect(z + g.braces.thick / 2 <= a - BRACE_GAP + 1e-9 || z - g.braces.thick / 2 >= b + BRACE_GAP - 1e-9, `plane at ${z} vs ${a}…${b}`).toBe(true);
  });

  it('a wedge keeps every plane inside its shallow top depth', () => {
    const g = geoOf(braced(boxOf('sealed', { shape: 'wedge', wedgeTopPct: 50 }), 'window', 3));
    expect(g.shape).toBe('wedge');
    expect(g.braces.zs.length).toBe(3);
    for (const z of g.braces.zs) expect(z + g.t / 2).toBeLessThan(g.diTop);
    // One brace sits where the single brace always did: halfway into the top depth.
    expect(geoOf(boxOf('sealed', { shape: 'wedge', wedgeTopPct: 50 })).braces.zs[0]).toBeCloseTo(geoOf(boxOf('sealed', { shape: 'wedge', wedgeTopPct: 50 })).diTop / 2, 9);
  });

  it('stays off the band-pass divider and the isobaric tunnel and inner driver', () => {
    for (const n of [1, 2, 3]) {
      const bp = geoOf(braced(boxOf('bp4'), 'window', n));
      clear(bp, bp.frontDepth - 0.03, bp.frontDepth + bp.t);
      const iso = geoOf(braced(boxOf('isobaric'), 'window', n));
      clear(iso, 0, innerBaffleZ(iso) + iso.t);
    }
    // Dowels cross the middle of the box: they go behind the inner driver's magnet.
    const iso = geoOf(braced(boxOf('isobaric'), 'dowel', 1));
    clear(iso, 0, innerBaffleZ(iso) + iso.driverDepth);
  });

  it('stays clear of the slot riser and of passive radiators on the side panels', () => {
    // The suggested vented box folds its slot up the back wall; the third plane moves off the riser.
    const g = geoOf(braced(vented, 'window', 3));
    expect(slotBoards(g).riser).toBeGreaterThan(0);
    expect(g.braces.zs).toHaveLength(3);
    clear(g, g.frontDepth - g.slotH - g.t, g.frontDepth);
  });

  /** Nearest distance from the centre of every side PR hole to where a plane meets the side panel. */
  const prClearance = (g: BoxGeometry) => {
    const br = g.braces, yc = g.hx / 2;
    const ends: [number, number][] = br.kind === 'dowel'
      ? br.dowelYs.map((y): [number, number] => [y - DOWEL_D / 2, y + DOWEL_D / 2])
      : [[br.bottom, br.bottom + br.window!.bar], [br.top - br.window!.bar, br.top]];
    let worst = Infinity;
    for (const z of br.zs) for (const s of sideRow(g)) for (const [y0, y1] of ends) {
      const c = g.dx / 2 - g.t - s;
      const dz = Math.max(0, Math.abs(z - c) - br.thick / 2), dy = Math.max(0, y0 - yc, yc - y1);
      worst = Math.min(worst, Math.hypot(dz, dy) - prHoleRadius(g));
    }
    return worst;
  };

  it('beside side passive radiators a window plane is two cross bars whose ends clear the PR holes', () => {
    for (const n of [1, 2, 3]) {
      const d = braced(boxOf('pr', { prCount: 2 }), 'window', n);
      const g = geoOf(d);
      expect(g.prLayout.perSide).toBe(1);
      expect(g.braces.barsOnly).toBe(true);
      expect(codes(d), `${n} planes`).toEqual([]);
      expect(g.braces.zs).toHaveLength(n);
      expect(prClearance(g)).toBeGreaterThanOrEqual(BRACE_GAP - 1e-9);
      // Cross bars hold the top, not the sides (they meet the sides only at their ends).
      expect(g.braces.sideHeld).toEqual([]);
      expect(g.braces.topHeld).toEqual(g.braces.zs);
      expect(panelModes(g, mdf).side).toBe(unbraced(g).side);
      expect(panelModes(g, mdf).top).toBeGreaterThan(unbraced(g).top);
    }
    // A front-row PR alone leaves the sides free: a full frame as usual.
    const one = geoOf({ ...boxOf('pr'), prCount: 1 });
    expect(one.prLayout.perSide).toBe(0);
    expect(one.braces.barsOnly).toBe(false);
  });

  it('dowel sockets in a side-PR box stay off the PR holes, or the dowels are a build problem', () => {
    for (const n of [1, 2]) {
      const d = braced(boxOf('pr', { prCount: 2 }), 'dowel', n);
      const g = geoOf(d);
      if (g.braces.missing) expect(codes(d)).toContain('brace');
      else expect(prClearance(g)).toBeGreaterThanOrEqual(BRACE_GAP - 1e-9);
    }
  });

  it('a brace with nowhere to go is a build problem, not a quiet overlap', () => {
    const iso = braced(boxOf('isobaric'), 'dowel', 3);
    const g = geoOf(iso);
    expect(g.braces.missing).toBeGreaterThan(0);
    const p = problemsFor(iso, ctx).find((x) => x.code === 'brace');
    expect(p?.text).toContain('เดือย');
    // Fewer planes fit.
    expect(codes(braced(boxOf('isobaric'), 'dowel', 1))).not.toContain('brace');
    // The suggestion keeps the volume it would give without bracing and drops the planes that do
    // not fit, saying so, instead of growing the box (which would change the sound) for a brace.
    const s = suggestDesign(iso, r.driver, dto, damping);
    expect(s.flags).not.toContain('unbuildable');
    expect(s.flags).toContain('braces-reduced');
    expect(s.flags).not.toContain('volume-raised');
    const fixed = { ...iso, ...s.patch };
    expect(codes(fixed)).toEqual([]);
    expect(fixed.braceKind).toBe('dowel');
    expect(fixed.braceCount).toBeLessThan(3);
    expect(fixed.vbL).toBe({ ...iso, ...suggestDesign(braced(iso, 'none'), r.driver, dto, damping).patch }.vbL);
  });
});

describe('volume and the blueprint follow the bracing', () => {
  it('brace volume per kind and count, and the breakdown still adds up', () => {
    const one = geoOf(braced(vented, 'window', 1)).volume.bracesL;
    expect(geoOf(braced(vented, 'none')).volume.bracesL).toBe(0);
    expect(geoOf(braced(vented, 'window', 3)).volume.bracesL).toBeCloseTo(3 * one, 0);
    const g = geoOf(braced(vented, 'dowel', 2));
    expect(g.volume.bracesL).toBeCloseTo(2 * g.braces.dowelYs.length * Math.PI * (DOWEL_D / 2) ** 2 * g.wi * 1000, 1);
    expect(braceVolume('window', 1, 0.5, 0.4, 0.018)).toBeCloseTo((2 * 0.5 + 2 * 0.3) * 0.05 * 0.018, 12);
    for (const kind of ['none', 'window', 'dowel'] as const) {
      const v = geoOf(braced(vented, kind, 2)).volume;
      expect(v.shellL - v.driversL - v.portsL - v.boardsL - v.bracesL - v.tunnelL - v.terminalL - v.handlesL - v.extraL).toBeCloseTo(v.netL, 6);
    }
  });

  it('window braces: one board each, at the planes laid out', () => {
    const d = braced(vented, 'window', 2);
    const g = geoOf(d);
    const brace = partsFor(d, g).find((p) => p.id === 'brace')!;
    expect(brace.qty).toBe(2);
    expect(brace.w).toBeCloseTo(g.wi * 1000, 6);
    expect(brace.holes[0].kind).toBe('window');
    const bp = blueprintFor({ d, geo: g, dto, material: mdf, damping });
    expect(bp.dowels).toBeNull();
    expect(bp.steps.some((s) => s.includes('2 ชุด'))).toBe(true);
    expect(partsFor(braced(vented, 'none'), geoOf(braced(vented, 'none'))).some((p) => p.id === 'brace')).toBe(false);
  });

  it('dowel braces: no board, a dowel cut line with sockets in both sides, and an honest size note', () => {
    const d = braced(vented, 'dowel', 2);
    const g = geoOf(d);
    const parts = partsFor(d, g);
    expect(parts.some((p) => p.id === 'brace')).toBe(false);
    const side = parts.find((p) => p.id === 'side')!;
    const sockets = side.holes.filter((h) => h.kind === 'dowel');
    expect(sockets).toHaveLength(2 * g.braces.dowelYs.length);
    expect(sockets.every((h) => h.blind)).toBe(true);
    const bp = blueprintFor({ d, geo: g, dto, material: mdf, damping });
    expect(bp.dowels!.qty).toBe(2 * g.braces.dowelYs.length);
    expect(bp.dowels!.length).toBe(Math.round(g.wi * 1000 + d.thicknessMm));
    const line = bp.bom.find((b) => b.item.includes('เดือย'))!;
    expect(line.qty).toContain(`${bp.dowels!.qty} ท่อน`);
    expect(line.note).toContain('ไม่ใช่ค่าที่ยืนยัน');
    expect(cutListCsv(bp)).toContain('เดือยไม้กลม');
    expect(bp.steps.some((s) => s.includes('รูบอด'))).toBe(true);
    // Dowels are not nested on the sheets.
    expect(bp.sheets.flatMap((s) => s.parts).some((p) => p.label.includes('เดือย'))).toBe(false);
  });

  it('stored designs: unknown bracing falls back, old ones get the window brace', () => {
    const { braceKind: _k, braceCount: _n, ...old } = DEFAULT_DESIGN;
    const back = sanitizeDesign(old, DEFAULT_DESIGN);
    expect(back.braceKind).toBe('window');
    expect(sanitizeDesign({ ...DEFAULT_DESIGN, braceKind: 'steel' }, DEFAULT_DESIGN).braceKind).toBe('window');
    expect(sanitizeDesign({ ...DEFAULT_DESIGN, braceKind: 'dowel', braceCount: 3 }, DEFAULT_DESIGN)).toMatchObject({ braceKind: 'dowel', braceCount: 3 });
  });
});

describe('review fixes: side PRs, small boxes, dowel rows', () => {
  const ctxOf = (model: string): BuildCtx & { dto: DriverDto } => {
    const x = drivers.find((dd) => dd.model === model)!;
    const rr = driverFromDto(x);
    if (!rr.ok) throw new Error(model);
    return { dto: x, driver: rr.driver, damping };
  };
  const suggestFor = (c: BuildCtx, start: Design) => ({ ...start, ...suggestDesign(start, c.driver, c.dto, damping).patch });
  const geoFor = (c: BuildCtx, d: Design) => sizeBox(d, c.dto, buildNetwork(toSpec(d, c.driver, damping)), mdf);

  it('a side-PR box suggested under the default bracing builds, with the volume it gets unbraced', () => {
    const c = ctxOf('18TBW100');
    for (const count of [1, 2]) {
      const start = { ...DEFAULT_DESIGN, boxType: 'pr' as const, count, prCount: 2 };
      const s = suggestDesign(start, c.driver, c.dto, damping);
      const d = { ...start, ...s.patch };
      expect(s.flags).not.toContain('unbuildable');
      expect(s.flags).not.toContain('braces-reduced');
      expect(d.braceKind).toBe('window');
      expect(problemsFor(d, c)).toEqual([]);
      const g = geoFor(c, d);
      expect(g.braces.barsOnly).toBe(true);
      expect(g.braces.zs).toHaveLength(1);
      const unbracedVb = suggestFor(c, { ...start, braceKind: 'none' }).vbL;
      expect(Math.abs(d.vbL - unbracedVb) / unbracedVb).toBeLessThan(0.05);
      // A design stored before bracing existed loads with the window brace and still builds.
      const { braceKind: _k, braceCount: _n, ...old } = { ...d };
      expect(problemsFor(sanitizeDesign(old, DEFAULT_DESIGN), c)).toEqual([]);
    }
  });

  it('the suggestion never grows a box to make room for a brace (every seed driver, PR boxes)', () => {
    for (const x of drivers) {
      const rr = driverFromDto(x);
      if (!rr.ok) continue;
      const c = { dto: x, driver: rr.driver, damping };
      const start = { ...DEFAULT_DESIGN, boxType: 'pr' as const, prCount: 2 };
      const braced1 = suggestDesign(start, rr.driver, x, damping);
      const none = suggestFor(c, { ...start, braceKind: 'none' });
      const d = { ...start, ...braced1.patch };
      expect(d.vbL, x.model).toBeLessThanOrEqual(none.vbL);
      // Whatever the unbraced box builds, the braced suggestion builds too (with fewer braces if it must).
      if (!problemsFor(none, c).length) expect(problemsFor(d, c), x.model).toEqual([]);
    }
  }, 60_000);

  it('a small box never gets a solid brace board: narrower bars keep a window, or it is a build problem', () => {
    const cases: [string, Design['boxType'], number | null][] = [['DMA90-4', 'sealed', 2], ['RS100-8', 'vented', 3], ['PS95-8', 'isobaric', null], ['DMA90-4', 'bp4', null], ['10F/8414G10', 'sealed', null], ['10F/8414G10', 'vented', null]];
    for (const [model, boxType, vb] of cases) {
      const c = ctxOf(model);
      const s = suggestFor(c, { ...DEFAULT_DESIGN, boxType });
      const d = vb ? { ...s, vbL: vb } : s;
      const g = geoFor(c, d);
      const p = problemsFor(d, c);
      const brace = partsFor(d, g).find((x) => x.id === 'brace');
      if (g.braces.missing) expect(p.map((x) => x.code), model).toContain('brace');
      if (brace) {
        expect(brace.holes.some((h) => h.kind === 'window'), `${model} ${boxType}`).toBe(true);
        const win = brace.holes[0];
        expect(win.w! >= BRACE_WINDOW_MIN * 1000 - 1e-6 && win.h! >= BRACE_WINDOW_MIN * 1000 - 1e-6).toBe(true);
        expect(brace.note ?? '').not.toContain('แผ่นเต็ม');
      }
    }
    // A cross-section too small for any window: every plane is missing, with a clear reason.
    const g = geoOf(vented);
    const tiny = { ...g, wi: 0.07 } as BoxGeometry;
    const plan = bracePlan(tiny, 'vented', 1, 'window', 2);
    expect(plan.window).toBeNull();
    expect(plan.zs).toEqual([]);
    expect(plan.missing).toBe(2);
    const text = buildProblems(vented, dto, { ...tiny, braces: plan }).find((x) => x.code === 'brace')!.text;
    expect(text).toContain('เล็กเกินกว่าจะเจาะช่อง');
    expect(partsFor(vented, { ...tiny, braces: plan }).some((x) => x.id === 'brace')).toBe(false);
  });

  it('dowel volume counts the same rows the layout draws (from the brace span, not the inside height)', () => {
    for (const [model, boxType, vb] of [['ND105-8', 'bp4', 3], ['RS100-8', 'vented', 3], ['18BMA-2000S', 'vented', null]] as const) {
      const c = ctxOf(model);
      const s = suggestFor(c, { ...DEFAULT_DESIGN, boxType });
      for (const n of [1, 2]) {
        const d = { ...s, ...(vb ? { vbL: vb } : {}), braceKind: 'dowel' as const, braceCount: n };
        const g = geoFor(c, d);
        expect(g.braces.dowelYs).toHaveLength(dowelRows(braceSpan(g)));
        const drawn = n * g.braces.dowelYs.length * Math.PI * (DOWEL_D / 2) ** 2 * g.wi * 1000;
        // The volume is taken on the sizing pass's width (as the slot boards are), so a small box is
        // a few per cent off; a different row count would be 50 % or 100 % off.
        expect(Math.abs(g.volume.bracesL / drawn - 1), `${model} ${boxType}`).toBeLessThan(0.05);
        expect(g.braces.bottom).toBeCloseTo(braceBottom(g), 12);
      }
    }
  });

  it('cross bars in the blueprint: two per plane, no window, clear of the PR holes', () => {
    const c = ctxOf('18TBW100');
    const d = suggestFor(c, { ...DEFAULT_DESIGN, boxType: 'pr', prCount: 2, braceCount: 2 });
    const g = geoFor(c, d);
    expect(g.braces.barsOnly).toBe(true);
    const bars = partsFor(d, g).find((x) => x.id === 'brace')!;
    expect(bars.qty).toBe(2 * g.braces.zs.length);
    expect(bars.holes).toEqual([]);
    expect(bars.h).toBeCloseTo(g.braces.window!.bar * 1000, 9);
    const bp = blueprintFor({ d, geo: g, dto: c.dto, material: mdf, damping });
    expect(bp.steps.some((x) => x.includes('คานค้ำ'))).toBe(true);
    expect(geoFor(c, d).volume.bracesL).toBeCloseTo(2 * 2 * g.wi * g.braces.window!.bar * g.t * 1000, 1);
  });

  it('the side note says which holes match and which mirror when a PR box has dowels', () => {
    const d = braced(boxOf('pr', { prCount: 2 }), 'dowel', 1);
    const g = geoOf(d);
    // Only the wording is checked here: a socket pair drawn behind the radiators.
    const withSockets = { ...g, braces: { ...g.braces, zs: [g.di - 0.03] } };
    const side = partsFor(d, withSockets).find((x) => x.id === 'side')!;
    expect(side.holes.some((h) => h.kind === 'pr') && side.holes.some((h) => h.kind === 'dowel')).toBe(true);
    expect(side.note).toContain('รู PR ซ้ายกับขวาเจาะเหมือนกัน');
    expect(side.note).toMatch(/รูบอดเดือย.*ซ้ายกับขวาเจาะกลับด้านกัน/);
    // Without sockets the PR rule needs no label.
    expect(partsFor(braced(d, 'none'), geoOf(braced(d, 'none'))).find((x) => x.id === 'side')!.note).toBe('ซ้ายกับขวาเจาะเหมือนกัน (PR หันออกคนละข้าง)');
  });

  it('the lab fix takes braces out rather than resizing the box', () => {
    const iso = braced(boxOf('isobaric'), 'dowel', 3);
    const f = fitBraces(iso, ctx)!;
    expect(f).not.toBeNull();
    expect(f.vbL).toBeUndefined();
    expect(codes({ ...iso, ...f })).toEqual([]);
    expect(fitBraces(vented, ctx)).toBeNull();
  });
});
