import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AIR_20C, abs, butterworthHighpass, checkConsistency, completeDriver, driverInputFromDto, maxOutput,
  referenceEfficiency, rewireCoils, simulate, solveAt, suggestAlignment, type Driver, type SystemSpec
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

describe('wiring', () => {
  it('an isobaric pair in series shows twice the coil impedance, not half', () => {
    const z = (wiring: 'series' | 'parallel') => simulate({ driver: ideal, wiring, box: { type: 'isobaric', vb: 0.025 }, drive: { volts: 2.83 } }, { fMin: 150, fMax: 300, points: 20 }).metrics.impedanceMin.ohms;
    near(z('series'), 4 * z('parallel'), 0.02);
    expect(z('series')).toBeGreaterThan(ideal.re * 1.9);
  });

  it('finds the worst excursion anywhere in the simulated range', () => {
    const res = simulate({ driver: ideal, box: { type: 'vented', vb: 0.1, fb: 30, port: { area: 0.01 } }, drive: { watts: 100 } }, { fMin: 10, fMax: 500, points: 200 });
    expect(res.metrics.excursionMax.mm).toBeCloseTo(Math.max(...res.curves.excursionMm), 9);
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
    const { a, res } = run('bp4');
    if (a.box.type !== 'bp4') throw new Error('expected a band-pass box');
    expect(res.metrics.f3).not.toBeNull();
    expect(res.metrics.f3High!).toBeGreaterThan(res.metrics.f3! * 2);
    // S = 0.7 is the maximally flat case: no dip at the tuning between the two humps.
    const { freqs, spl } = res.curves;
    const i = freqs.findIndex((f) => f >= (a.box as { fb: number }).fb);
    expect(Math.max(...spl) - spl[i]).toBeLessThan(0.5);
  });

  it('flags a low-Qts driver for sealed and returns the shortest port when none fits', () => {
    const pa = completeDriver({ fs: 40, qts: 0.22, qms: 8, vas: 0.12, re: 5.3, sd: 0.12, le: 0 });
    expect(run('sealed', pa).a.flags).toContain('qts-low-for-sealed');
    // Every port that reaches the tuning is at least 2 cm long, so a 2 cm limit cannot be met.
    const tight = suggestAlignment({ driver: ideal, type: 'vented', watts: 100, maxPortLength: 0.02 });
    expect(tight.flags).toContain('port-too-long');
    if (tight.box.type !== 'vented') throw new Error('expected a vented box');
    const len = simulate({ driver: ideal, box: tight.box, drive }, { points: 40 }).info.ports[0].physicalLength;
    expect(len).toBeLessThan(0.2); // the shortest that reaches the tuning, not the longest tried
  });

  it('keeps the box inside the allowed volume and retunes it for a flat response', () => {
    const big = completeDriver({ fs: 22, qts: 0.57, qms: 6, vas: 0.156, re: 6.4, sd: 0.085, le: 0 });
    // Above Qts 0.5 the QB3 fit runs away (≈470 L here); the box is held to 1.5 × Vas instead.
    const free = suggestAlignment({ driver: big, type: 'vented', watts: 100 });
    if (free.box.type !== 'vented') throw new Error('expected a vented box');
    expect(free.box.vb).toBeCloseTo(1.5 * 0.156, 9);
    const a = suggestAlignment({ driver: big, type: 'vented', watts: 100, maxVolume: 0.2 });
    if (a.box.type !== 'vented') throw new Error('expected a vented box');
    expect(a.flags).toContain('volume-capped');
    expect(a.box.vb).toBeCloseTo(0.2, 9);
    const res = simulate({ driver: big, box: a.box, drive }, { points: 200 });
    expect(res.metrics.splMax - res.metrics.referenceSpl).toBeLessThan(1.5);
    const raised = suggestAlignment({ driver: ideal, type: 'sealed', watts: 100, minVolume: 0.12 });
    expect(raised.flags).toContain('volume-raised');
    if (raised.box.type !== 'sealed') throw new Error('expected a sealed box');
    expect(raised.box.vb).toBeCloseTo(0.12, 9);
  });

  it('flags a high-Qts driver instead of pretending it suits every box', () => {
    const floppy = completeDriver({ fs: 30, qts: 0.7, qms: 6, vas: 0.1, re: 4, sd: 0.05, le: 0 });
    expect(run('sealed', floppy).a.flags).toContain('qts-high-for-sealed');
    expect(run('vented', floppy).a.flags).toContain('qts-high-for-vented');
  });

  it('builds variants: any Qtc, a given volume (retuned flat) and a given tuning', () => {
    const at = (qtc: number) => suggestAlignment({ driver: ideal, type: 'sealed', watts: 100, qtc });
    const q05 = at(0.5);
    near(simulate({ driver: ideal, box: q05.box, drive }, { points: 60 }).info.qtc!, 0.5, 0.005);
    // Asking for a Qtc the driver cannot reach falls back to the high-Qts recipe and says so.
    expect(at(ideal.qts * 0.9).flags).toContain('qts-high-for-sealed');
    const given = suggestAlignment({ driver: ideal, type: 'sealed', watts: 100, volume: 0.05 });
    near(given.qtc!, simulate({ driver: ideal, box: given.box, drive }, { points: 60 }).info.qtc!, 0.005);

    const qb3 = suggestAlignment({ driver: ideal, type: 'vented', watts: 100 });
    const bigger = suggestAlignment({ driver: ideal, type: 'vented', watts: 100, volume: (qb3.box as { vb: number }).vb * 1.6 });
    const r = simulate({ driver: ideal, box: bigger.box, drive }, { points: 200 });
    expect(r.metrics.splMax - r.metrics.referenceSpl).toBeLessThanOrEqual(1.05);
    expect(bigger.tuning!).toBeLessThan(qb3.tuning!); // a bigger box tunes lower
    const tuned = suggestAlignment({ driver: ideal, type: 'vented', watts: 100, tuning: 45 });
    expect(tuned.tuning).toBe(45);
    expect((tuned.box as { fb: number }).fb).toBe(45);
    const loud = suggestAlignment({ driver: ideal, type: 'bp4', watts: 100, bandpassS: 1 });
    const flat = suggestAlignment({ driver: ideal, type: 'bp4', watts: 100 });
    expect((loud.box as { vf: number }).vf).toBeGreaterThan((flat.box as { vf: number }).vf);
    expect(loud.name).toBe('Geddes S 1.0');
  });
});

describe('dual voice coils', () => {
  // Dual 4 Ω measured with the coils in series (8 Ω), as most car-sub spec tables are.
  const dvc = completeDriver({ fs: 28, qes: 0.5, qms: 6, vas: 0.06, re: 7, le: 0.004, sd: 0.05, zNom: 8 });

  it('series and parallel share Qes; parallel has a quarter of Re and Le and half of Bl', () => {
    const par = rewireCoils(dvc, 'series', 'parallel');
    near(par.re, dvc.re / 4, 1e-12);
    near(par.le, dvc.le / 4, 1e-12);
    near(par.bl, dvc.bl / 2, 1e-12);
    near(par.qes, dvc.qes, 1e-12);
    near(par.qts, dvc.qts, 1e-12);
    expect(par.zNom).toBeCloseTo(2, 12);
    // Back again lands where it started.
    near(rewireCoils(par, 'parallel', 'series').re, dvc.re, 1e-12);
  });

  it('one coil alone doubles Qes and keeps the mechanics', () => {
    const one = rewireCoils(dvc, 'series', 'single');
    near(one.qes, 2 * dvc.qes, 1e-12);
    expect(one.qts).toBeGreaterThan(dvc.qts);
    expect(one.zNom).toBeCloseTo(4, 12);
    expect([one.fs, one.mms, one.cms, one.vas, one.qms]).toEqual([dvc.fs, dvc.mms, dvc.cms, dvc.vas, dvc.qms]);
  });

  it('gives the same acoustic output for the same power into the nominal load', () => {
    const run = (d: Driver) => simulate({ driver: d, box: { type: 'sealed', vb: 0.04 }, drive: { watts: 100 } }, { fMin: 20, fMax: 200, points: 30 });
    const s = run(dvc);
    const p = run(rewireCoils(dvc, 'series', 'parallel'));
    s.curves.spl.forEach((v, i) => expect(p.curves.spl[i]).toBeCloseTo(v, 6));
    // Same power at a quarter of the impedance: twice the current.
    near(p.curves.currentA[10], 2 * s.curves.currentA[10], 1e-6);
  });
});

describe('amplifier and wire resistance', () => {
  const box = { type: 'sealed' as const, vb: 0.05, ql: 1e9 };

  it('acts exactly like extra coil resistance and leaves the terminal impedance alone', () => {
    const rs = 0.8;
    const withRs = simulate({ driver: ideal, box, drive: { volts: 2.83, seriesOhms: rs } }, { fMin: 10, fMax: 300, points: 80 });
    const re = ideal.re + rs;
    const qes = ideal.qes * re / ideal.re;
    const fatter: Driver = { ...ideal, re, qes, qts: (qes * ideal.qms) / (qes + ideal.qms) };
    const plain = simulate({ driver: ideal, box, drive: { volts: 2.83 } }, { fMin: 10, fMax: 300, points: 80 });
    const asCoil = simulate({ driver: fatter, box, drive: { volts: 2.83 } }, { fMin: 10, fMax: 300, points: 80 });
    withRs.curves.spl.forEach((v, i) => expect(v).toBeCloseTo(asCoil.curves.spl[i], 9));
    withRs.curves.impedance.forEach((z, i) => expect(z).toBeCloseTo(plain.curves.impedance[i], 9));
    // Closed-form Qtc follows the higher effective Qts.
    near(withRs.info.qtc!, fatter.qts * Math.sqrt(1 + ideal.vas / 0.05), 1e-9);
  });

  it('is shared by parallel drivers: each sees n times as much', () => {
    const two = simulate({ driver: ideal, count: 2, box, drive: { volts: 2.83, seriesOhms: 0.5 } }, { fMin: 20, fMax: 200, points: 20 });
    const one = simulate({ driver: ideal, count: 2, box, drive: { volts: 2.83 } }, { fMin: 20, fMax: 200, points: 20 });
    // The terminal impedance of the pair is still Re/2-ish, and the series loss costs output.
    near(two.metrics.impedanceMin.ohms, one.metrics.impedanceMin.ohms, 1e-9);
    expect(two.curves.spl[15]).toBeLessThan(one.curves.spl[15] - 0.5);
  });
});

describe('maximum output', () => {
  const spec: SystemSpec = { driver: { ...ideal, xmax: 0.01 }, box: { type: 'sealed', vb: 0.05, ql: 1e9 }, drive: { watts: 100 } };
  const res = simulate(spec, { fMin: 10, fMax: 300, points: 120 });

  it('an excursion-limited piston plays ω²ρ·Sd·x / 2πr whatever the box', () => {
    const m = maxOutput(res, { xmaxMm: 10 });
    for (let i = 0; i < res.curves.freqs.length; i += 10) {
      const w = 2 * Math.PI * res.curves.freqs[i];
      const p = (w * w * AIR_20C.rho * ideal.sd * (0.01 / Math.SQRT2)) / (2 * Math.PI);
      expect(m.limitedBy[i]).toBe('excursion');
      expect(m.maxSpl[i]).toBeCloseTo(20 * Math.log10(p / 2e-5), 6);
    }
  });

  it('takes the tightest limit at each frequency', () => {
    const m = maxOutput(res, { xmaxMm: 2, thermalVolts: Math.sqrt(100 * 4) });
    const lo = res.curves.freqs.findIndex((f) => f > 12);
    const hi = res.curves.freqs.findIndex((f) => f > 200);
    expect(m.limitedBy[lo]).toBe('excursion');
    expect(m.limitedBy[hi]).toBe('thermal');
    // At the thermal limit the level is the 100 W level itself.
    expect(m.maxSpl[hi]).toBeCloseTo(res.curves.spl[hi], 9);
    expect(m.maxWatts[hi]).toBeCloseTo(100, 6);
  });

  it('an amplifier current limit caps voltage at Imax·|Z|', () => {
    const m = maxOutput(res, { ampAmps: 1 });
    const i = 60;
    expect(m.limitedBy[i]).toBe('amp-current');
    near(m.maxWatts[i], res.curves.impedance[i] ** 2 / res.info.nominalOhms, 1e-6);
  });

  it('lets a subsonic filter buy headroom below its corner', () => {
    const filtered = simulate({ ...spec, highpass: { fc: 30, order: 4 } }, { fMin: 10, fMax: 300, points: 120 });
    const m = maxOutput(filtered, { thermalVolts: 20 });
    const i = filtered.curves.freqs.findIndex((f) => f > 12);
    near(m.maxWatts[i], 400 / filtered.info.nominalOhms, 1e-6); // the amplifier output itself stays at 20 V
    expect(m.maxSpl[i]).toBeGreaterThan(filtered.curves.spl[i] + 10);
  });

  it('reports nothing when no limit is known', () => {
    const m = maxOutput(res, {});
    expect(m.maxSpl.every(Number.isNaN)).toBe(true);
    expect(m.limitedBy.every((x) => x === null)).toBe(true);
  });
});
