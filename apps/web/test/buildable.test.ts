import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import type { DampingMaterialDto, DriverDto } from '../src/data/types';
import { buildableChoices, fieldLimit, limitsFor, nearestBuildable, problemsFor, type BuildCtx } from '../src/sim/buildable';
import { driverFromDto, mountOf, slotPortRoom, suggestDesign } from '../src/sim/model';
import { DEFAULT_DESIGN, type Design } from '../src/state/store';

const drivers = (seed.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }) as DriverDto);
const damping = (materials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }) as DampingMaterialDto);
const ctxOf = (model: string): BuildCtx => {
  const dto = drivers.find((d) => d.model === model)!;
  const r = driverFromDto(dto);
  if (!r.ok) throw new Error('incomplete');
  return { dto, driver: r.driver, damping };
};

describe('what makes a box impossible to build', () => {
  const ctx = ctxOf('18BMA-2000S');
  const vented: Design = { ...DEFAULT_DESIGN, ...suggestDesign(DEFAULT_DESIGN, ctx.driver, ctx.dto, damping).patch };

  it('the suggested box can be built', () => {
    expect(problemsFor(vented, ctx)).toEqual([]);
  });

  it('a port shorter than the baffle is thick cannot be built', () => {
    // A tiny port at a high tuning wants less length than the 18 mm panel.
    const codes = problemsFor({ ...vented, portAreaCm2: 5, fbHz: 90 }, ctx).map((p) => p.code);
    expect(codes).toContain('port-short');
  });

  it('a port longer than the box can hold folded once cannot be built', () => {
    const codes = problemsFor({ ...vented, portAreaCm2: 1500, fbHz: 15 }, ctx).map((p) => p.code);
    expect(codes).toContain('port-long');
  });

  it('a box too small for the driver and its magnet cannot be built', () => {
    const codes = problemsFor({ ...vented, boxType: 'sealed', vbL: 10 }, ctx).map((p) => p.code);
    expect(codes).toContain('too-small');
  });

  it('a port end needs one slot height of free air before the wall', () => {
    const r = slotPortRoom(0.5, 0.6, 0.1);
    expect(r.straight).toBeCloseTo(0.4, 12);
    expect(r.folded).toBeCloseTo(0.5 + 0.6 - 0.1 - 0.1, 12);
    expect(slotPortRoom(0.5, 0.6, 0.01).straight).toBeCloseTo(0.47, 12); // at least 3 cm
  });

  it('estimates a missing mounting size from the nominal size instead of assuming a 15-inch driver', () => {
    const small = mountOf({ ...ctx.dto, sizeIn: 6.5, outerMm: null, depthMm: null, displacementL: null, cutoutMm: null });
    expect(small.outer).toBeCloseTo(6.5 * 0.0254 * 1.02, 9);
    expect(small.depth).toBeLessThan(0.1);
    expect(small.displacementL).toBeLessThan(0.6);
    expect(small.estimated).toEqual(['ขอบนอก', 'ความลึก', 'รูเจาะ', 'ปริมาตรแทนที่']);
    expect(mountOf(ctx.dto).estimated).not.toContain('ขอบนอก');
  });
});

describe('slider limits', () => {
  const ctx = ctxOf('18BMA-2000S');
  const vented: Design = { ...DEFAULT_DESIGN, ...suggestDesign(DEFAULT_DESIGN, ctx.driver, ctx.dto, damping).patch };

  it('stops each slider where the box stops being buildable, and says why', () => {
    const lim = limitsFor(vented, ctx);
    expect(Object.keys(lim).sort()).toEqual(['fbHz', 'portAreaCm2', 'vbL']);
    const area = lim.portAreaCm2!;
    expect(area.around).not.toBeNull();
    const [lo, hi] = area.around!;
    expect(vented.portAreaCm2).toBeGreaterThanOrEqual(lo);
    expect(vented.portAreaCm2).toBeLessThanOrEqual(hi);
    // Both edges are real: one step past each one collides, the edge itself does not.
    expect(problemsFor({ ...vented, portAreaCm2: hi }, ctx)).toEqual([]);
    expect(problemsFor({ ...vented, portAreaCm2: hi + 5 }, ctx).length).toBeGreaterThan(0);
    expect(area.aboveWhy).toContain('ท่อยาว');
    expect(problemsFor({ ...vented, portAreaCm2: lo }, ctx)).toEqual([]);
    if (lo > 5) expect(problemsFor({ ...vented, portAreaCm2: lo - 5 }, ctx).length).toBeGreaterThan(0);
    // A smaller box is out of reach too: the port gets longer and the magnet needs room.
    expect(lim.vbL!.around![0]).toBeGreaterThan(2);
    expect(lim.vbL!.belowWhy).toBeTruthy();
  });

  it('has no current stretch when the design already collides, so the slider can move out of it', () => {
    const lim = fieldLimit('portAreaCm2', { ...vented, portAreaCm2: 1500, fbHz: 15 }, ctx);
    expect(lim.around).toBeNull();
  });

  it('finds the smallest single change that makes a box buildable', () => {
    const bad = { ...vented, portAreaCm2: Math.min(1500, limitsFor(vented, ctx).portAreaCm2!.around![1] + 100) };
    expect(problemsFor(bad, ctx).length).toBeGreaterThan(0);
    const fix = nearestBuildable(bad, ctx)!;
    expect(fix).not.toBeNull();
    expect(problemsFor({ ...bad, [fix.field]: fix.value }, ctx)).toEqual([]);
  });

  it('marks select choices that would collide', () => {
    const m = buildableChoices({ ...vented, boxType: 'sealed', vbL: 120 }, ctx, 'count', [1, 2, 3, 4]);
    expect(m.get(1)).toEqual([]);
    expect(m.get(4)!.map((p) => p.code)).toContain('too-small');
  });
});

describe('suggested boxes', () => {
  it('are buildable, or say plainly that no buildable size was found', () => {
    for (const model of ['RS225-8', '12W6v3-D4', '18BMA-2000S', 'P3D4-12']) {
      const ctx = ctxOf(model);
      for (const boxType of ['sealed', 'vented', 'pr', 'bp4', 'bp6', 'isobaric'] as const) {
        const base = { ...DEFAULT_DESIGN, boxType };
        const s = suggestDesign(base, ctx.driver, ctx.dto, damping);
        const p = problemsFor({ ...base, ...s.patch }, ctx);
        if (s.flags.includes('unbuildable')) expect(p.length).toBeGreaterThan(0);
        else expect(p, `${model} ${boxType}`).toEqual([]);
      }
    }
  }, 120_000);
});

describe('real driver shape and photo marks', () => {
  it('finds the circle through three tapped points', async () => {
    const { circleFrom3 } = await import('../src/data/photos');
    const c = circleFrom3([10, 0], [0, 10], [-10, 0])!;
    expect(c.cx).toBeCloseTo(0, 9);
    expect(c.cy).toBeCloseTo(0, 9);
    expect(c.r).toBeCloseTo(10, 9);
    expect(circleFrom3([0, 0], [1, 1], [2, 2])).toBeNull();
  });

  it('uses what was measured and estimates the rest, inside the frame', async () => {
    const { resolveShape, sdFromCone } = await import('../src/sim/driverShape');
    const dto = drivers.find((d) => d.model === '18BMA-2000S')!;
    const plain = resolveShape(dto);
    expect(plain.estimated).toContain('กรวย');
    expect(plain.coneR + plain.surroundW / 2).toBeLessThan(plain.outerR);
    expect(plain.magnetH).toBeLessThan(plain.depth);
    const measured = resolveShape({ ...dto, shape: { coneMm: 400, surroundMm: 40, dustcapMm: 150, magnetMm: 220, magnetHeightMm: 60, boltHoles: 8 } });
    expect(measured.coneR).toBeCloseTo(0.2, 9);
    expect(measured.magnetR).toBeCloseTo(0.11, 9);
    expect(measured.estimated).not.toContain('กรวย');
    expect(measured.boltHoles).toBe(8);
    expect(sdFromCone(400)).toBeCloseTo(Math.PI * 20 * 20, 9);
  });
});
