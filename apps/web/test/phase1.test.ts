import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import type { DampingMaterialDto, DriverDto } from '../src/data/types';
import { freeSlot, readSlots, sanitizeDesign } from '../src/data/compare';
import { driverDoubt, resultConfidence } from '../src/sim/confidence';
import { calc, parse } from '../src/sim/expr';
import { buildEntries, notebookVars, num, type NotebookCtx } from '../src/sim/formulas';
import {
  ampLimits, driverFromDto, fillFor, maxOutputFor, measuredWiring, panelModes, ratedWatts, simulate, sizeBox, summarize, toSpec,
  wallDamping, warningsFor, wireOhms
} from '../src/sim/model';
import { LAB_GRID } from '../src/sim/wizard';
import { DEFAULT_DESIGN, type Design } from '../src/state/store';

const drivers = (seed.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }) as DriverDto);
const damping = (materials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }) as DampingMaterialDto);
const byModel = (model: string) => drivers.find((d) => d.model === model)!;

describe('formula language', () => {
  const vars = { Fs: 30, Vas: 100, Vb: 50, N: 1 };

  it('follows the usual precedence, with ^ right-associative and above unary minus', () => {
    expect(calc('1 + 2 * 3', {})).toEqual({ ok: true, value: 7 });
    expect(calc('2 ^ 3 ^ 2', {})).toEqual({ ok: true, value: 512 });
    expect(calc('-2 ^ 2', {})).toEqual({ ok: true, value: -4 });
    expect(calc('2 ^ -1', {})).toEqual({ ok: true, value: 0.5 });
    expect(calc('(1 + 2) * 3', {})).toEqual({ ok: true, value: 9 });
    expect(calc('1.5e3 / 3', {})).toEqual({ ok: true, value: 500 });
  });

  it('reads variables without regard to case, plus pi and e and the math signs people paste', () => {
    const r = calc('fs * sqrt(1 + n*vas/VB)', vars);
    expect(r.ok && r.value).toBeCloseTo(30 * Math.sqrt(3), 12);
    expect(calc('2 × pi ÷ 2 − 1', {})).toEqual({ ok: true, value: Math.PI - 1 });
    expect(calc('ln(e)', {})).toEqual({ ok: true, value: 1 });
    expect(calc('max(1, Fs, 3)', vars)).toEqual({ ok: true, value: 30 });
  });

  it('explains mistakes in Thai with where they are', () => {
    const missing = calc('Fs * (1 + 2', vars);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain('วงเล็บปิด');
    const unknown = calc('Fs * Qx', vars);
    expect(!unknown.ok && unknown.error).toBe('ไม่มีตัวแปร Qx');
    expect(!unknown.ok && unknown.pos).toBe(5);
    expect(calc('foo(2)', {}).ok).toBe(false);
    expect(calc('sqrt(1, 2)', {}).ok).toBe(false);
    expect(calc('1 / 0', {}).ok).toBe(false);
    expect(calc('sqrt(-1)', {}).ok).toBe(false);
    expect(calc('2 $ 3', {}).ok).toBe(false);
    expect(calc('', {}).ok).toBe(false);
  });

  it('never evaluates code and refuses oversized or deeply nested input', () => {
    expect(calc('constructor', {}).ok).toBe(false);
    expect(calc('alert(1)', {}).ok).toBe(false);
    expect(calc('1+'.repeat(200) + '1', {}).ok).toBe(false); // longer than 300 characters
    expect(() => parse('('.repeat(60) + '1' + ')'.repeat(60))).toThrowError(/ลึกเกินไป/);
    expect(() => parse('-'.repeat(60) + '1')).toThrowError(/ลึกเกินไป/);
  });
});

describe('dual voice coils in the lab', () => {
  it('knows which wiring each seed DVC was measured in, and guesses from the impedance when not told', () => {
    expect(measuredWiring(byModel('12W6v3-D4'))).toEqual({ wiring: 'series', known: true });
    expect(measuredWiring(byModel('MP 300 D4.3'))).toEqual({ wiring: 'parallel', known: true });
    expect(measuredWiring({ ...byModel('MP 300 D4.3'), coilWiring: null })).toEqual({ wiring: 'parallel', known: false });
    expect(measuredWiring({ ...byModel('12W6v3-D4'), coilWiring: null })).toEqual({ wiring: 'series', known: false });
  });

  it('re-expresses the driver for the chosen wiring and leaves single-coil drivers alone', () => {
    const dto = byModel('P3D4-12');
    const s = driverFromDto(dto, 'series');
    const p = driverFromDto(dto, 'parallel');
    const one = driverFromDto(dto, 'single');
    if (!s.ok || !p.ok || !one.ok) throw new Error('incomplete');
    expect(p.driver.re).toBeCloseTo(s.driver.re / 4, 9);
    expect(p.driver.zNom).toBeCloseTo(2, 9);
    expect(one.driver.qes).toBeCloseTo(2 * s.driver.qes, 9);
    expect(ratedWatts(dto, { coilWiring: 'single' })).toBe((dto.peW ?? 0) / 2);
    const svc = drivers.find((d) => d.coil === 'SVC')!;
    const a = driverFromDto(svc, 'parallel'), b = driverFromDto(svc);
    expect(a.ok && b.ok && a.driver.re === b.driver.re).toBe(true);
  });
});

describe('amplifier, cable and the loudest the box can play', () => {
  const dto = byModel('18BMA-2000S');
  const drv = driverFromDto(dto);
  if (!drv.ok) throw new Error('incomplete');
  const run = (d: Design) => simulate(toSpec(d, drv.driver, damping), LAB_GRID);

  it('sizes the cable and the amplifier from their ratings', () => {
    // 10 m of 12 AWG: 2 × 10 × 1.7241e-8 / 3.31e-6 ≈ 0.104 Ω.
    expect(wireOhms({ wireM: 10, wireAwg: 12 })).toBeCloseTo(0.1042, 3);
    expect(wireOhms({ wireM: 0, wireAwg: 12 })).toBe(0);
    const amp = ampLimits({ amp: true, ampW: 1000, ampOhms: 4, ampMinOhms: 2 })!;
    expect(amp.volts).toBeCloseTo(Math.sqrt(4000), 9);
    expect(amp.amps).toBeCloseTo(Math.sqrt(4000) / 2, 9);
    expect(ampLimits({ amp: false, ampW: 1000, ampOhms: 4, ampMinOhms: 2 })).toBeNull();
  });

  it('warns when the amplifier clips or the cable eats the power', () => {
    const d: Design = { ...DEFAULT_DESIGN, watts: 2000, amp: true, ampW: 500, ampOhms: 8, wireM: 15, wireAwg: 18 };
    const res = run(d);
    const text = warningsFor(d, dto, res, sizeBox(d, dto, res, undefined)).map((w) => w.text).join('\n');
    expect(text).toContain('clip');
    expect(text).toContain('สายลำโพง 15 ม.');
  });

  it('puts the amplifier limit into the loudest-it-can-play curve only when it is the tightest', () => {
    const weak: Design = { ...DEFAULT_DESIGN, watts: 100, amp: true, ampW: 100, ampOhms: 8 };
    const m = maxOutputFor(weak, dto, run(weak));
    const i = LAB_GRID.points - 40;
    expect(m.limitedBy[i]).toBe('amp-voltage');
    const ideal = maxOutputFor({ ...weak, amp: false }, dto, run({ ...weak, amp: false }));
    expect(ideal.limitedBy[i]).toBe('thermal');
    expect(ideal.maxSpl[i]).toBeGreaterThan(m.maxSpl[i] + 10);
  });
});

describe('confidence badges', () => {
  const dto = byModel('18BMA-2000S');
  const drv = driverFromDto(dto);
  if (!drv.ok) throw new Error('incomplete');

  it('is engineering for a clean datasheet driver and says why it drops to an estimate', () => {
    const res = simulate(toSpec(DEFAULT_DESIGN, drv.driver, damping), LAB_GRID);
    const clean = resultConfidence({ ...DEFAULT_DESIGN, stuffing: 0 }, dto, res, null);
    expect(clean.f3.level).toBe('eng');
    expect(clean.maxSpl.level).toBe('est');
    expect(clean.panelModes.level).toBe('est');
    const filled = resultConfidence({ ...DEFAULT_DESIGN, boxType: 'sealed', stuffing: 0.5 }, dto, res, null);
    expect(filled.f3.level).toBe('est');
    expect(filled.f3.why).toContain('ใย');
    const sample = { ...dto, sourceKind: 'sample' };
    expect(resultConfidence(DEFAULT_DESIGN, sample, res, null).splMax.why).toContain('ตัวอย่าง');
  });

  it('flags a datasheet whose numbers disagree', () => {
    expect(driverDoubt({ ...dto, qts: (dto.qts ?? 0.4) * 1.5 })).toContain('ขัดกันเอง');
    expect(driverDoubt(dto)).toBeNull();
  });
});

describe('formula notebook', () => {
  const dto = byModel('RS225-8');
  const drv = driverFromDto(dto);
  if (!drv.ok) throw new Error('incomplete');
  const ctxFor = (d: Design): NotebookCtx => {
    const res = simulate(toSpec(d, drv.driver, damping), LAB_GRID);
    const geo = sizeBox(d, dto, res, undefined);
    const wall = wallDamping(d, undefined, damping);
    return { d, dto, driver: drv.driver, res, geo, material: undefined, wall, modes: panelModes(geo, undefined, wall.f11Factor), max: maxOutputFor(d, dto, res), fill: fillFor(d, damping), conf: resultConfidence(d, dto, res, geo) };
  };

  it('shows exactly the numbers the lab shows', () => {
    // No subsonic and an airtight box: the closed form leaves out both.
    const sealed = ctxFor({ ...DEFAULT_DESIGN, boxType: 'sealed', vbL: 20, stuffing: 0, subsonic: false, ql: 1e6 });
    const e = Object.fromEntries(buildEntries(sealed).map((x) => [x.id, x]));
    expect(e.fc.value).toBe(sealed.res!.info.fc);
    expect(e.qtc.value).toBe(sealed.res!.info.qtc);
    expect(e.f3.value).toBe(sealed.res!.metrics.f3);
    // The closed-form F3 agrees with the simulation (which also has Le) to within a few per cent.
    expect(Math.abs(e.f3sealed.value! - sealed.res!.metrics.f3!) / sealed.res!.metrics.f3!).toBeLessThan(0.05);

    const vented = ctxFor({ ...DEFAULT_DESIGN, vbL: 30, fbHz: 35, portAreaCm2: 40, stuffing: 0.3 });
    const v = Object.fromEntries(buildEntries(vented).map((x) => [x.id, x]));
    // The port formula in the notebook reproduces the physics' own port length.
    expect(v.portLength.value!).toBeCloseTo(vented.res!.info.ports[0].physicalLength * 100, 6);
    expect(v.portLength.subst).toContain(num(vented.res!.info.ports[0].physicalLength * 100));
    expect(v.vfill).toBeDefined();
    for (const x of buildEntries(vented)) { expect(x.ref.length).toBeGreaterThan(5); expect(x.formula.length).toBeGreaterThan(3); }
  });

  it('gives user formulas the same values', () => {
    const ctx = ctxFor({ ...DEFAULT_DESIGN, boxType: 'sealed', vbL: 20, stuffing: 0 });
    const vars = Object.fromEntries(notebookVars(ctx).map((x) => [x.name, x.value]));
    const r = calc('Fs * sqrt(1 + N*Vas/Vb)', vars);
    expect(r.ok && r.value).toBeCloseTo(ctx.res!.info.fc!, 9);
  });

  it('formats numbers for reading', () => {
    expect(num(1234.567)).toBe('1235');
    expect(num(0.70712)).toBe('0.7071');
    expect(num(null)).toBe('—');
    expect(num(1.5e-7)).toContain('×10^');
  });
});

describe('comparison slots', () => {
  it('summarises a design for the table and finds the first free slot', () => {
    const dto = byModel('18BMA-2000S');
    const drv = driverFromDto(dto);
    if (!drv.ok) throw new Error('incomplete');
    const res = simulate(toSpec(DEFAULT_DESIGN, drv.driver, damping), LAB_GRID);
    const geo = sizeBox(DEFAULT_DESIGN, dto, res, undefined);
    const s = summarize(DEFAULT_DESIGN, dto, res, geo, maxOutputFor(DEFAULT_DESIGN, dto, res));
    expect(s.f3).toBe(res.metrics.f3);
    expect(s.portMs).toBe(res.metrics.portVelocityMax.ms);
    expect(s.dims).toHaveLength(3);
    expect(s.loud).not.toBeNull();
    // Without browser storage (as here) the slots simply start empty.
    expect(readSlots()).toEqual({ A: null, B: null, C: null });
    expect(freeSlot({ A: null, B: null, C: null })).toBe('A');
  });

  it('opens a stored design only with values the lab can draw', () => {
    const d = sanitizeDesign({ boxType: 'horn', vbL: 'big', fbHz: Infinity, watts: 500, finish: 'oak', coilWiring: 'parallel', extra: 1 }, DEFAULT_DESIGN);
    expect(d.boxType).toBe(DEFAULT_DESIGN.boxType);
    expect(d.vbL).toBe(DEFAULT_DESIGN.vbL);
    expect(d.fbHz).toBe(DEFAULT_DESIGN.fbHz);
    expect([d.watts, d.finish, d.coilWiring]).toEqual([500, 'oak', 'parallel']);
    expect('extra' in d).toBe(false);
    expect(sanitizeDesign(null, DEFAULT_DESIGN)).toBe(DEFAULT_DESIGN);
  });
});
