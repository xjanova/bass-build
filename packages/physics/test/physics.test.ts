import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AIR_20C, abs, butterworthHighpass, checkConsistency, completeDriver, driverInputFromDto,
  referenceEfficiency, simulate, solveAt, suggestAlignment, type Driver, type SystemSpec
} from '../src';

const rc2 = AIR_20C.rho * AIR_20C.c * AIR_20C.c;
const near = (a: number, b: number, rel: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(rel);

/** Idealised driver for alignment tests: Qts 0.383 (B4), no inductance, almost lossless suspension. */
const ideal: Driver = completeDriver({ fs: 30, qts: 0.383, qms: 100, vas: 0.1, re: 4, sd: 0.05, le: 0 });
const lossless = { ql: 1e9, qp: 1e9 };

describe('driver model', () => {
  it('derives missing parameters consistently', () => {
    const d = completeDriver(driverInputFromDto({ fs: 32, qes: 0.419, qms: 6, vasL: 100.4, re: 3.4, sdCm2: 855, leMh: 1.8 }), { rho: 1.18, c: 343 });
    near(d.bl, 20.2, 0.01);
    near(d.mms, 0.25, 0.01);
    near(d.qts, 0.392, 0.005);
    expect(d.le).toBeCloseTo(0.0018, 6);
  });

  it('reports which parameters are missing', () => {
    expect(() => completeDriver({ fs: 30, qts: 0.4 })).toThrowError(/missing/);
  });

  it('flags the deliberately wrong Qts in the SQ-12 sample and passes the others', () => {
    const seed = JSON.parse(readFileSync(new URL('../../../data/seed/drivers.sample.json', import.meta.url), 'utf8')) as { drivers: Record<string, number>[] };
    for (const dto of seed.drivers) {
      const checks = checkConsistency(driverInputFromDto(dto), { rho: 1.18, c: 343 });
      const bad = checks.filter((c) => !c.ok).map((c) => c.id);
      if ((dto as unknown as { model: string }).model === 'SQ-12') expect(bad).toEqual(['qts']);
      else expect(bad).toEqual([]);
    }
  });
});

describe('sealed box', () => {
  // Butterworth (Qtc 0.707): f3 equals fc.
  const alpha = Math.pow(0.707 / ideal.qts, 2) - 1;
  const spec: SystemSpec = { driver: ideal, box: { type: 'sealed', vb: ideal.vas / alpha, ...lossless }, drive: { volts: 2.83 } };
  const res = simulate(spec, { fMin: 5, fMax: 1000, points: 600 });

  it('matches the closed-form fc and Qtc', () => {
    near(res.info.fc!, ideal.fs * Math.sqrt(1 + alpha), 1e-9);
    near(res.info.qtc!, 0.707, 1e-3);
  });

  it('puts the -3 dB point at fc for a Butterworth alignment', () => {
    near(res.metrics.f3!, res.info.fc!, 0.01);
  });

  it('peaks the impedance at fc', () => {
    let best = { z: 0, f: 0 };
    res.curves.freqs.forEach((f, i) => { if (res.curves.impedance[i] > best.z) best = { z: res.curves.impedance[i], f }; });
    near(best.f, res.info.fc!, 0.01);
  });

  it('gives static excursion F/k well below resonance', () => {
    const low = simulate(spec, { fMin: 1, fMax: 2, points: 2 });
    const vb = ideal.vas / alpha;
    const k = 1 / ideal.cms + (ideal.sd * ideal.sd * rc2) / vb;
    const xPeak = (Math.SQRT2 * 2.83 * ideal.bl) / ideal.re / k;
    near(low.curves.excursionMm[0] / 1000, xPeak, 0.01);
  });

  it('reproduces the η0 sensitivity in the mass-controlled band', () => {
    const oneWatt = simulate({ ...spec, drive: { volts: Math.sqrt(ideal.re) } });
    expect(Math.abs(oneWatt.metrics.referenceSpl - referenceEfficiency(ideal).spl1w1m)).toBeLessThan(0.2);
  });
});

describe('vented box', () => {
  // Thiele B4: Qts 0.383, Vb = Vas/√2, Fb = Fs → f3 = Fs and a maximally flat passband.
  const spec: SystemSpec = { driver: ideal, box: { type: 'vented', vb: ideal.vas / Math.SQRT2, fb: ideal.fs, port: { area: 0.01 }, ...lossless }, drive: { volts: 2.83 } };
  const res = simulate(spec, { fMin: 5, fMax: 1000, points: 800 });

  it('puts f3 at Fs for the B4 alignment', () => {
    near(res.metrics.f3!, ideal.fs, 0.015);
  });

  it('has no passband ripple above f3', () => {
    const ref = res.metrics.referenceSpl;
    res.curves.freqs.forEach((f, i) => { if (f > res.metrics.f3! * 1.05 && f < 300) expect(res.curves.spl[i] - ref).toBeLessThan(0.3); });
  });

  it('dips the impedance at the tuning frequency (with realistic losses)', () => {
    const lossy = simulate({ ...spec, box: { type: 'vented', vb: ideal.vas / Math.SQRT2, fb: ideal.fs, port: { area: 0.01 } } }, { fMin: 10, fMax: 200, points: 800 });
    near(lossy.metrics.tuningDip!.f, ideal.fs, 0.03);
  });

  it('computes a port length from area and tuning', () => {
    const port = res.info.ports[0];
    const vb = ideal.vas / Math.SQRT2;
    const leffExpected = (rc2 * 0.01) / (Math.pow(2 * Math.PI * ideal.fs, 2) * vb * AIR_20C.rho);
    near(port.effectiveLength, leffExpected, 1e-9);
    expect(port.physicalLength).toBeLessThan(port.effectiveLength);
  });

  it('conserves volume velocity: radiated flow equals the box compliance current', () => {
    const sol = solveAt(spec, 40);
    const total = sol.radiators.reduce((s, r) => ({ re: s.re + r.u.re, im: s.im + r.u.im }), { re: 0, im: 0 });
    const vb = ideal.vas / Math.SQRT2;
    const cab = vb / rc2;
    const w = 2 * Math.PI * 40;
    // flow into the compliance = -jωC·p (outside is the reference, node pressure p)
    const p = sol.pressures[1];
    const intoC = { re: w * cab * p.im, im: -w * cab * p.re };
    near(abs(total), abs(intoC), 1e-6);
  });

  it('reduces excursion below tuning with a subsonic filter', () => {
    const real = completeDriver({ fs: 32, qes: 0.419, qms: 6, vas: 0.1004, re: 3.4, sd: 0.0855, le: 0.0018, zNom: 4 });
    const base: SystemSpec = { driver: real, box: { type: 'vented', vb: 0.1, fb: 32, port: { area: 0.024 } }, drive: { watts: 1000 } };
    const without = simulate(base);
    const withSub = simulate({ ...base, highpass: { fc: 25, order: 4 } });
    expect(without.metrics.excursionMax.mm).toBeGreaterThan(30);
    expect(withSub.metrics.excursionMax.mm).toBeLessThan(19);
  });
});

describe('other topologies', () => {
  it('isobaric pair in half the volume tunes like one driver in the full volume', () => {
    const single = simulate({ driver: ideal, box: { type: 'sealed', vb: 0.05 }, drive: { volts: 2.83 } }, { fMin: 10, fMax: 300, points: 600 });
    const iso = simulate({ driver: ideal, box: { type: 'isobaric', vb: 0.025, coupling: 0.0005 }, drive: { volts: 2.83 } }, { fMin: 10, fMax: 300, points: 600 });
    near(iso.info.fc!, single.info.fc!, 1e-9);
    const peak = (r: typeof single) => r.curves.freqs[r.curves.impedance.indexOf(Math.max(...r.curves.impedance))];
    near(peak(iso), peak(single), 0.03);
  });

  it('band-pass 4th order rolls off on both sides and reports both corners', () => {
    const res = simulate({ driver: ideal, box: { type: 'bp4', vr: 0.04, vf: 0.03, fb: 50, port: { area: 0.01 } }, drive: { volts: 2.83 } }, { fMin: 10, fMax: 500, points: 500 });
    const peak = Math.max(...res.curves.spl);
    expect(peak - res.curves.spl[0]).toBeGreaterThan(20);
    expect(peak - res.curves.spl[res.curves.spl.length - 1]).toBeGreaterThan(15);
    expect(res.metrics.f3).not.toBeNull();
    expect(res.metrics.f3High).not.toBeNull();
    expect(res.metrics.f3High!).toBeGreaterThan(res.metrics.f3!);
  });

  it('passive radiator box produces a tuning dip and finite output', () => {
    const res = simulate({
      driver: ideal,
      // Lossless so the dip can be compared with the closed-form tuning.
      box: { type: 'pr', vb: 0.07, pr: { sd: 0.05, mmp: 0.4, cmp: 0.0005, qmp: 1e6 }, ql: 1e9 },
      drive: { volts: 2.83 }
    }, { fMin: 10, fMax: 300, points: 600 });
    expect(res.curves.spl.every(Number.isFinite)).toBe(true);
    // Box + PR tuning: √((1/Cab + 1/Cap)/Map) / 2π
    const cab = 0.07 / rc2, sp2 = 0.05 * 0.05, cap = 0.0005 * sp2, map = 0.4 / sp2;
    const fp = Math.sqrt((1 / cab + 1 / cap) / map) / (2 * Math.PI);
    near(res.metrics.tuningDip!.f, fp, 0.02);
  });

  it('band-pass 6th order with two ports simulates', () => {
    const res = simulate({
      driver: ideal,
      box: { type: 'bp6', vr: 0.05, fbr: 35, portR: { area: 0.008 }, vf: 0.03, fbf: 70, portF: { area: 0.01 } },
      drive: { volts: 2.83 }
    });
    expect(res.info.ports).toHaveLength(2);
    expect(res.curves.spl.every(Number.isFinite)).toBe(true);
  });
});

describe('subsonic filter', () => {
  it('is -3 dB at the corner for both orders', () => {
    for (const order of [2, 4] as const) {
      const h = butterworthHighpass(25, order)(2 * Math.PI * 25);
      expect(20 * Math.log10(abs(h))).toBeCloseTo(-3.01, 1);
    }
  });
});

describe('box filling', () => {
  const sealed = (extra: object) => simulate({ driver: ideal, box: { type: 'sealed', vb: 0.05, ...extra }, drive: { volts: 2.83 } }, { fMin: 10, fMax: 500, points: 400 });

  it('lowers fc as the fill makes the box look bigger', () => {
    const res = sealed({ stuffing: 1, stuffingGain: 0.25 });
    // α = Vas / (Vb · 1.25)
    near(res.info.fc!, ideal.fs * Math.sqrt(1 + ideal.vas / (0.05 * 1.25)), 1e-9);
    expect(res.info.fc!).toBeLessThan(sealed({}).info.fc!);
  });

  it('absorption lowers the impedance peak without adding output', () => {
    const plain = sealed({});
    const damped = sealed({ qa: 4 });
    expect(Math.max(...damped.curves.impedance)).toBeLessThan(Math.max(...plain.curves.impedance) - 1);
    // Well above fc the box no longer matters, and the absorber must not radiate.
    const hi = plain.curves.freqs.findIndex((f) => f > 300);
    expect(Math.abs(damped.curves.spl[hi] - plain.curves.spl[hi])).toBeLessThan(0.1);
  });
});

describe('suggested alignments', () => {
  const drive = { watts: 100 };
  const run = (type: Parameters<typeof suggestAlignment>[0]['type'], driver: Driver = ideal) => {
    const a = suggestAlignment({ driver, type, ...drive });
    return { a, res: simulate({ driver, box: a.box, drive }, { fMin: 10, fMax: 500, points: 400 }) };
  };

  it('sealed lands on Qtc 0.707', () => {
    const { res } = run('sealed');
    near(res.info.qtc!, 0.707, 0.005);
  });

  it('vented follows Keele and keeps the port air below the target', () => {
    const { a, res } = run('vented');
    if (a.box.type !== 'vented') throw new Error('expected a vented box');
    near(a.box.vb, 15 * ideal.qts ** 2.87 * ideal.vas, 1e-9);
    near(a.box.fb, 0.42 * ideal.fs * ideal.qts ** -0.9, 1e-9);
    expect(res.metrics.portVelocityMax.ms).toBeLessThanOrEqual(17);
    expect(a.flags).toEqual([]);
  });

  it('passive radiators tune near the vented Fb and reach a similar F3', () => {
    const pr = run('pr');
    const vented = run('vented');
    if (vented.a.box.type !== 'vented') throw new Error('expected a vented box');
    near(pr.res.metrics.tuningDip!.f, vented.a.box.fb, 0.12);
    near(pr.res.metrics.f3!, vented.res.metrics.f3!, 0.12);
  });

  it('4th-order band-pass is flat between two corners', () => {
    const { res } = run('bp4');
    expect(res.metrics.f3).not.toBeNull();
    expect(res.metrics.f3High!).toBeGreaterThan(res.metrics.f3! * 2);
    expect(res.metrics.splMax - res.metrics.referenceSpl).toBeLessThan(1);
  });

  it('flags a high-Qts driver instead of pretending it suits every box', () => {
    const floppy = completeDriver({ fs: 30, qts: 0.7, qms: 6, vas: 0.1, re: 4, sd: 0.05, le: 0 });
    expect(run('sealed', floppy).a.flags).toContain('qts-high-for-sealed');
    expect(run('vented', floppy).a.flags).toContain('qts-high-for-vented');
  });
});
