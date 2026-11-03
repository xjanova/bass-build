import { buildNetwork, simulate } from '@bassbuild/physics';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import { TUBES, tubeOf } from '../src/data/hardware';
import type { DampingMaterialDto, DriverDto } from '../src/data/types';
import { problemsFor, type BuildCtx } from '../src/sim/buildable';
import { blueprintFor, partsFor } from '../src/sim/blueprint';
import { braceBottom, rowProblem } from '../src/sim/layout';
import { driverFromDto, roundTubes, sizeBox, suggestDesign, toBox, toSpec, type BoxGeometry } from '../src/sim/model';
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
const bore = (mm: number) => Math.PI * (mm / 20) ** 2; // cm²
/** Vented box with `n` 4-inch PVC tubes of a 105 mm bore. */
const withTubes = (n: number, extra: Partial<Design> = {}): Design => ({ ...vented, portStyle: 'round', tubeKey: 'pvc_4', tubeIdMm: 105, portAreaCm2: n * bore(105), ...extra });

describe('round tube ports', () => {
  it('the tube list comes from the seed, with an estimated bore for PVC', () => {
    expect(TUBES.length).toBeGreaterThan(5);
    const pvc = tubeOf('pvc_4')!;
    expect(pvc.odMm).toBe(114);
    expect(pvc.known).toBe('od');
    expect(pvc.idMm).toBeLessThan(pvc.odMm);
  });

  it('the count comes from the port area, and the physics gets that many tubes', () => {
    const d = withTubes(3);
    expect(roundTubes(d)?.count).toBe(3);
    expect(roundTubes({ ...d, portAreaCm2: 2.6 * bore(105) })?.count).toBe(3);
    expect(roundTubes({ ...d, portAreaCm2: 1 })?.count).toBe(1);
    const box = toBox(d);
    expect(box.type === 'vented' && box.port.count).toBe(3);
    expect(box.type === 'vented' && box.port.area * 1e4).toBeCloseTo(bore(105), 9);
    expect(roundTubes({ ...d, portStyle: 'slot' })).toBeNull();
    expect(roundTubes({ ...d, boxType: 'sealed' })).toBeNull();
  });

  it('still tunes where it was set', () => {
    const d = withTubes(3);
    const res = simulate(toSpec(d, r.driver, damping), { fMin: 10, fMax: 200, points: 300 });
    expect(res.info.ports[0].count).toBe(3);
    expect(res.metrics.tuningDip!.f).toBeGreaterThan(d.fbHz * 0.9);
    expect(res.metrics.tuningDip!.f).toBeLessThan(d.fbHz * 1.1);
  });

  it('lays the tubes along the bottom of the baffle, with no slot and no fold', () => {
    const g = geoOf(withTubes(3));
    expect(g.slotH).toBe(0);
    expect(g.tubes?.count).toBe(3);
    expect(g.tubes!.od).toBeCloseTo(0.114, 9);
    expect(g.portFold === 'straight' || g.portFold === 'impossible').toBe(true);
    expect(g.portMaxLength).toBeCloseTo(g.frontDepth - Math.max(0.03, 0.105), 9);
    // The driver sits above the tube row.
    expect(g.autoDriverY - g.driverRadius).toBeGreaterThan(g.tubes!.y + g.tubes!.od / 2);
    expect(codes(withTubes(3))).toEqual([]);
  });

  it('a row of tubes wider than the box makes it wider', () => {
    const g = geoOf(withTubes(8, { tubeKey: 'pvc_6', tubeIdMm: 150, portAreaCm2: 8 * bore(150) }));
    expect(g.tubes?.count).toBe(8);
    expect(g.wi).toBeGreaterThanOrEqual(8 * 0.165 + 7 * 0.02 + 0.04 - 1e-9);
  });

  it('a tube longer than the box is deep cannot be built, and says to use a slot or fewer tubes', () => {
    const d = withTubes(8, { fbHz: 20 });
    const p = problemsFor(d, ctx).find((x) => x.code === 'port-long');
    expect(p?.text).toContain('ท่อกลม');
  });

  it('a driver frame may not cover the tube holes', () => {
    const d = withTubes(2);
    const g = geoOf(d);
    const low = { ...d, rowMode: 'manual' as const, rowYMm: Math.round((g.tubes!.y + g.driverRadius) * 1000) };
    expect(rowProblem(geoOf(low), low.boxType, low.count)?.side).toBe('slot');
  });

  it('the blueprint drills the tubes through the baffle and lists the pipe to cut', () => {
    const d = withTubes(3);
    const g = geoOf(d);
    const parts = partsFor(d, g);
    const holes = parts.find((p) => p.id === 'baffle')!.holes.filter((h) => h.kind === 'port');
    expect(holes).toHaveLength(3);
    expect(holes[0].d).toBeCloseTo(114, 6);
    expect(parts.some((p) => p.id === 'port-ceiling')).toBe(false);
    // The brace sits above the tubes, not across them.
    expect(braceBottom(g)).toBeGreaterThan(g.tubes!.y + g.tubes!.od / 2);
    const bp = blueprintFor({ d, geo: g, dto, material: undefined, damping });
    const pipe = bp.bom.find((b) => b.item.includes('PVC'));
    expect(pipe?.qty).toContain('3 ท่อ');
    expect(pipe?.qty).toContain(String(Math.round(g.portLength * 1000)));
  });

  it('a suggested box with round tubes can be built', () => {
    const start = withTubes(1);
    const s = suggestDesign(start, r.driver, dto, damping);
    const d = { ...start, ...s.patch };
    expect(s.flags).not.toContain('unbuildable');
    expect(roundTubes(d)?.count).toBeGreaterThanOrEqual(1);
    expect(codes(d)).toEqual([]);
  });
});
