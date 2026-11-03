import { buildNetwork } from '@bassbuild/physics';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import { sanitizeDesign } from '../src/data/compare';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../src/data/types';
import { problemsFor, type BuildCtx } from '../src/sim/buildable';
import { blueprintFor, cutListCsv, partsFor } from '../src/sim/blueprint';
import { BRACE_GAP, bracePlan, DOWEL_D, dowelRows, freeSpan, innerBaffleZ, sideRow, slotBoards } from '../src/sim/layout';
import { braceVolume, driverFromDto, panelModes, sizeBox, suggestDesign, toSpec, type BoxGeometry } from '../src/sim/model';
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
  return { side: f11((g.di + g.diTop) / 2, g.hi), back: f11(g.wi, Math.hypot(g.hi, g.di - g.diTop)) };
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

  it('a band-pass divider and an isobaric inner baffle already hold the sides', () => {
    for (const type of ['bp4', 'isobaric'] as const) {
      const g = geoOf(braced(boxOf(type), 'none'));
      expect(g.braces.sideHeld).toHaveLength(1);
      expect(panelModes(g, mdf).side).toBeGreaterThan(unbraced(g).side);
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
    const pr = geoOf(braced(boxOf('pr', { prCount: 2 }), 'window', 2));
    for (const z of sideRow(pr)) { const c = pr.dx / 2 - pr.t - z; clear(pr, c - pr.prRadius, c + pr.prRadius); }
  });

  it('a brace with nowhere to go is a build problem, not a quiet overlap', () => {
    const iso = braced(boxOf('isobaric'), 'dowel', 3);
    const g = geoOf(iso);
    expect(g.braces.missing).toBeGreaterThan(0);
    const p = problemsFor(iso, ctx).find((x) => x.code === 'brace');
    expect(p?.text).toContain('เดือย');
    // Fewer planes fit.
    expect(codes(braced(boxOf('isobaric'), 'dowel', 1))).not.toContain('brace');
    // The suggestion grows the box until the braces asked for fit.
    const s = suggestDesign(iso, r.driver, dto, damping);
    expect(s.flags).not.toContain('unbuildable');
    expect(codes({ ...iso, ...s.patch })).toEqual([]);
  });
});

describe('volume and the blueprint follow the bracing', () => {
  it('brace volume per kind and count, and the breakdown still adds up', () => {
    const one = geoOf(braced(vented, 'window', 1)).volume.bracesL;
    expect(geoOf(braced(vented, 'none')).volume.bracesL).toBe(0);
    expect(geoOf(braced(vented, 'window', 3)).volume.bracesL).toBeCloseTo(3 * one, 0);
    const g = geoOf(braced(vented, 'dowel', 2));
    expect(g.volume.bracesL).toBeCloseTo(2 * dowelRows(g.hi) * Math.PI * (DOWEL_D / 2) ** 2 * g.wi * 1000, 1);
    expect(braceVolume('window', 1, 0.5, 0.4, 0.018)).toBeCloseTo((2 * 0.5 + 2 * 0.3) * 0.05 * 0.018, 12);
    for (const kind of ['none', 'window', 'dowel'] as const) {
      const v = geoOf(braced(vented, kind, 2)).volume;
      expect(v.shellL - v.driversL - v.portsL - v.boardsL - v.bracesL - v.tunnelL - v.extraL).toBeCloseTo(v.netL, 6);
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
