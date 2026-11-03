import { buildNetwork } from '@bassbuild/physics';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import { sanitizeDesign } from '../src/data/compare';
import type { DampingMaterialDto, DriverDto } from '../src/data/types';
import { problemsFor, type BuildCtx } from '../src/sim/buildable';
import { partsFor } from '../src/sim/blueprint';
import { baffleBottom, frontRow, rowProblem, rowRange } from '../src/sim/layout';
import { driverFromDto, sizeBox, suggestDesign, toSpec, type BoxGeometry } from '../src/sim/model';
import { DEFAULT_DESIGN, type Design } from '../src/state/store';

const drivers = (seed.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }) as DriverDto);
const damping = (materials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }) as DampingMaterialDto);
const dto = drivers.find((d) => d.model === '18BMA-2000S')!;
const r = driverFromDto(dto);
if (!r.ok) throw new Error('incomplete');
const ctx: BuildCtx = { dto, driver: r.driver, damping };
const geoOf = (d: Design): BoxGeometry => sizeBox(d, dto, buildNetwork(toSpec(d, r.driver, damping)), undefined);
const codes = (d: Design) => problemsFor(d, ctx).map((p) => p.code);
const vented: Design = { ...DEFAULT_DESIGN, ...suggestDesign(DEFAULT_DESIGN, r.driver, dto, damping).patch };
const sealed: Design = { ...vented, boxType: 'sealed', vbL: 200 };

describe('driver row placed by hand', () => {
  it('auto keeps the row centred, wherever the hand-set numbers point', () => {
    const g = geoOf({ ...sealed, rowXMm: 300, rowYMm: 50 });
    expect(g.rowX).toBe(0);
    expect(g.driverY).toBe(g.autoDriverY);
    expect(codes(sealed)).toEqual([]);
  });

  it('moves the row and its holes in the blueprint', () => {
    const auto = geoOf(sealed);
    const d: Design = { ...sealed, rowMode: 'manual', rowXMm: 40, rowYMm: Math.round(auto.autoDriverY * 1000) - 30 };
    const g = geoOf(d);
    expect(g.rowX).toBeCloseTo(0.04, 9);
    expect(g.driverY).toBeCloseTo(auto.autoDriverY - 0.03, 3);
    expect(frontRow(g, d.boxType, d.count)[0].x).toBeCloseTo(0.04, 9);
    const hole = partsFor(d, g).find((p) => p.id === 'baffle')!.holes[0];
    const autoHole = partsFor(sealed, auto).find((p) => p.id === 'baffle')!.holes[0];
    expect(hole.x - autoHole.x).toBeCloseTo(40, 6);
    expect(autoHole.y - hole.y).toBeCloseTo(30, 0);
    expect(codes(d)).toEqual([]);
  });

  it('a row hanging off the baffle cannot be built, and says which edge', () => {
    const g = geoOf(sealed);
    const right = { ...sealed, rowMode: 'manual' as const, rowXMm: Math.round(g.wx * 500), rowYMm: Math.round(g.autoDriverY * 1000) };
    expect(rowProblem(geoOf(right), right.boxType, right.count)?.side).toBe('right');
    expect(codes(right)).toContain('placement');
    const high = { ...sealed, rowMode: 'manual' as const, rowXMm: 0, rowYMm: Math.round(g.hx * 1000) };
    expect(rowProblem(geoOf(high), high.boxType, high.count)?.side).toBe('top');
    expect(problemsFor(high, ctx).find((p) => p.code === 'placement')!.text).toContain('ล้นขอบบน');
  });

  it('a frame may not cover the slot port mouth', () => {
    const g = geoOf(vented);
    const low = { ...vented, rowMode: 'manual' as const, rowXMm: 0, rowYMm: Math.round((baffleBottom(g) + g.driverRadius) * 1000) - 5 };
    expect(rowProblem(geoOf(low), low.boxType, low.count)?.side).toBe('slot');
    const ok = { ...low, rowYMm: low.rowYMm + 10 };
    expect(codes(ok)).not.toContain('placement');
  });

  it('in a wedge the magnet is checked where the driver sits', () => {
    // A tall box, so the driver can be raised well above the middle.
    const wedge: Design = { ...sealed, shape: 'wedge', wedgeTopPct: 20, hMode: 'fixed', hMm: 1100 };
    const g = geoOf(wedge);
    expect(codes(wedge)).toEqual([]);
    // Raised to the top of the baffle the box is too shallow behind it.
    const raised = { ...wedge, rowMode: 'manual' as const, rowYMm: Math.round((g.hx - g.t - g.cutoutRadius - 0.012) * 1000) };
    expect(codes(raised)).toContain('magnet');
    expect(codes(raised)).not.toContain('placement');
  });

  it('band-pass drivers sit on the divider and ignore the hand placement', () => {
    const bp: Design = { ...vented, boxType: 'bp4', rowMode: 'manual', rowXMm: 500, rowYMm: 20 };
    const g = geoOf(bp);
    expect(g.rowX).toBe(0);
    expect(g.driverY).toBe(g.autoDriverY);
  });

  it('the drag range keeps the row buildable right up to its edges', () => {
    for (const d of [sealed, vented, { ...vented, boxType: 'pr' as const, prCount: 1 }]) {
      const g = geoOf(d);
      const range = rowRange(g, d.boxType, d.count)!;
      expect(range.x[0]).toBeLessThan(0);
      expect(range.x[1]).toBeGreaterThan(0);
      expect(range.y[0]).toBeLessThanOrEqual(g.autoDriverY + 1e-9);
      expect(range.y[1]).toBeGreaterThanOrEqual(g.autoDriverY - 1e-9);
      // Every corner of the range is buildable; a millimetre past it is not.
      for (const x of range.x) for (const y of range.y) {
        const at = { ...d, rowMode: 'manual' as const, rowXMm: x < 0 ? Math.ceil(x * 1000) : Math.floor(x * 1000), rowYMm: y < g.autoDriverY ? Math.ceil(y * 1000) : Math.floor(y * 1000) };
        expect(rowProblem(geoOf(at), at.boxType, at.count), `${d.boxType} ${x} ${y}`).toBeNull();
      }
      const past = { ...d, rowMode: 'manual' as const, rowXMm: Math.floor(range.x[1] * 1000) + 2, rowYMm: Math.round(g.autoDriverY * 1000) };
      expect(rowProblem(geoOf(past), past.boxType, past.count)?.side).toBe('right');
    }
  });

  it('a stored placement is taken only when valid', () => {
    expect(sanitizeDesign({ rowMode: 'manual', rowXMm: -25 }, DEFAULT_DESIGN)).toMatchObject({ rowMode: 'manual', rowXMm: -25 });
    expect(sanitizeDesign({ rowMode: 'floating' }, DEFAULT_DESIGN).rowMode).toBe('auto');
  });
});
