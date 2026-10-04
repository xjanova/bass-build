import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import type { DampingMaterialDto, DriverDto } from '../src/data/types';
import { driverFromDto } from '../src/sim/model';
import { cabinGainDb, GOALS, runWizard, type Goal, type WizardInput } from '../src/sim/wizard';
import { DEFAULT_DESIGN } from '../src/state/store';

const drivers = (seed.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }) as DriverDto);
const damping = (materials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }) as DampingMaterialDto);
const byModel = (model: string) => {
  const dto = drivers.find((d) => d.model === model)!;
  const r = driverFromDto(dto);
  if (!r.ok) throw new Error(`driver ${model} incomplete`);
  return { dto, driver: r.driver };
};

const input = (model: string, goal: Goal, extra: Partial<WizardInput> = {}): WizardInput => ({
  goal, design: DEFAULT_DESIGN, damping, maxLitres: null, vehicle: 'sedan', ...byModel(model), ...extra
});

describe('goal wizard', () => {
  it('ranks several different boxes for every goal', () => {
    const t0 = performance.now();
    for (const g of GOALS) {
      const r = runWizard(input('18BMA-2000S', g.id));
      expect(r.ranked.length).toBeGreaterThanOrEqual(4);
      expect(new Set(r.ranked.map((c) => c.type)).size).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < r.ranked.length; i++) expect(r.ranked[i - 1].score).toBeGreaterThanOrEqual(r.ranked[i].score);
      for (const c of r.ranked) {
        expect(Number.isFinite(c.m.loud)).toBe(true);
        expect(c.curves.maxSpl.every((v, i) => v <= c.curves.spl[i] + 1e-9)).toBe(true);
      }
    }
    // Seven goals in one go; the worker runs one at a time.
    expect(performance.now() - t0).toBeLessThan(60_000);
  }, 120_000);

  it('puts the deepest box first for deep bass and a small one first for a small box', () => {
    const deep = runWizard(input('RS225-8', 'deep')).ranked;
    const lowest = Math.min(...deep.map((c) => c.m.f3 ?? 1e9));
    expect(deep[0].m.f3!).toBeLessThan(lowest * 1.12);
    const small = runWizard(input('RS225-8', 'small')).ranked;
    const sizes = small.map((c) => c.m.outerL).sort((a, b) => a - b);
    expect(small[0].m.outerL).toBeLessThanOrEqual(sizes[Math.floor(sizes.length / 2)]);
  }, 60_000);

  it('counts cabin gain in the car and keeps every box inside the space allowed', () => {
    expect(cabinGainDb(200, 2.6)).toBeLessThan(0.5);
    expect(cabinGainDb(20, 2.6)).toBeGreaterThan(15);
    const car = runWizard(input('8W7AE-3', 'car', { maxLitres: 30 }));
    expect(car.ranked.length).toBeGreaterThan(0);
    for (const c of car.ranked) {
      expect(c.m.netL).toBeLessThanOrEqual(30 * 1.02);
      // In the car the curve is the free-field one plus cabin gain, which grows towards the bottom.
      const { freqs, spl, lab } = c.curves;
      spl.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(lab.spl[i] - 1e-9));
      const i20 = freqs.findIndex((f) => f >= 20);
      expect(spl[i20] - lab.spl[i20]).toBeGreaterThan(15);
    }
    const open = runWizard(input('8W7AE-3', 'sq', { maxLitres: 30 })).ranked;
    expect(Math.min(...car.ranked.map((c) => c.m.f3!))).toBeLessThan(Math.min(...open.map((c) => c.m.f3!)));
  }, 60_000);
});
