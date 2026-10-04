import { AIR_20C } from './air';
import { abs, add, arg, cx, expj, mul, scale, ZERO, type Cx } from './complex';
import { buildNetwork, type BuildInfo, type SystemSpec } from './designs';
import { solve, type Solution } from './network';

const TAU = 2 * Math.PI;
const P_REF = 2e-5;

export interface SimOptions {
  fMin?: number;
  fMax?: number;
  points?: number;
  /** Listening distance, m (default 1). */
  distance?: number;
  /** 'half' = 2π (box on the floor / large baffle), 'full' = 4π free field. */
  space?: 'half' | 'full';
}

export interface Curves {
  freqs: number[];
  /** Sound pressure level at `distance`, dB SPL. */
  spl: number[];
  /** Unwrapped phase of the pressure, degrees. */
  phase: number[];
  groupDelayMs: number[];
  /** Electrical input impedance of the whole load, Ω. */
  impedance: number[];
  impedancePhase: number[];
  /** Peak cone excursion of the busiest driver, mm. */
  excursionMm: number[];
  /** Peak air velocity in the fastest port, m/s (0 when there is no port). */
  portVelocity: number[];
}

export interface Metrics {
  /** Passband reference level the -3/-6/-10 dB points are measured from. */
  referenceSpl: number;
  f3: number | null;
  f6: number | null;
  f10: number | null;
  /** Upper -3 dB point (band-pass designs only). */
  f3High: number | null;
  splMax: number;
  excursionMax: { mm: number; f: number };
  portVelocityMax: { ms: number; f: number };
  /** Lowest impedance above 10 Hz: the load the amplifier must drive. */
  impedanceMin: { ohms: number; f: number };
  /** Dip between the twin impedance peaks of a vented/PR system ≈ box tuning. */
  tuningDip: { ohms: number; f: number } | null;
}

export interface SimResult {
  curves: Curves;
  metrics: Metrics;
  info: BuildInfo;
}

export function logFrequencies(fMin: number, fMax: number, points: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < points; i++) out.push(fMin * Math.pow(fMax / fMin, i / (points - 1)));
  return out;
}

/** Far-field pressure (RMS, complex) from all radiators at `distance` on axis. */
export function pressureAt(sol: Solution, opts: SimOptions = {}, air = AIR_20C): Cx {
  const r = opts.distance ?? 1;
  const omega = opts.space === 'full' ? 4 * Math.PI : 2 * Math.PI;
  const k = sol.w / air.c;
  let p = ZERO;
  for (const rad of sol.radiators) {
    let dist = r;
    if (rad.position) {
      const [x, y, z] = rad.position;
      dist = Math.hypot(x, y, r - z);
    }
    const term = mul(rad.u, expj(-k * (dist - r)));
    p = add(p, scale(term, r / dist));
  }
  return mul(cx(0, (sol.w * air.rho) / (omega * r)), p);
}

const totalImpedance = (sol: Solution, wiring: 'parallel' | 'series'): Cx => {
  // Identical drivers: parallel → Z/n, series → sum. Isobaric pairs can be wired either way too.
  const z = sol.drivers.map((d) => d.zin);
  if (z.length === 1) return z[0];
  if (wiring === 'series') return z.reduce((a, b) => add(a, b), ZERO);
  let y = ZERO;
  for (const zi of z) {
    const d = zi.re * zi.re + zi.im * zi.im;
    y = add(y, cx(zi.re / d, -zi.im / d));
  }
  const d = y.re * y.re + y.im * y.im;
  return cx(y.re / d, -y.im / d);
};

export function simulate(spec: SystemSpec, opts: SimOptions = {}): SimResult {
  const air = spec.air ?? AIR_20C;
  const { net, info } = buildNetwork(spec);
  const freqs = logFrequencies(opts.fMin ?? 10, opts.fMax ?? 500, opts.points ?? 240);
  const wiring = spec.wiring ?? 'parallel';
  const curves: Curves = { freqs, spl: [], phase: [], groupDelayMs: [], impedance: [], impedancePhase: [], excursionMm: [], portVelocity: [] };
  const rawPhase: number[] = [];

  for (const f of freqs) {
    const sol = solve(net, TAU * f);
    const p = pressureAt(sol, opts, air);
    curves.spl.push(20 * Math.log10(Math.max(abs(p), 1e-12) / P_REF));
    rawPhase.push(arg(p));
    const z = totalImpedance(sol, wiring);
    curves.impedance.push(abs(z));
    curves.impedancePhase.push((arg(z) * 180) / Math.PI);
    curves.excursionMm.push(Math.max(...sol.drivers.map((d) => abs(d.x))) * Math.SQRT2 * 1000);
    let v = 0;
    for (const ps of sol.passives) if (ps.area && ps.label.includes('port')) v = Math.max(v, (abs(ps.u) / ps.area) * Math.SQRT2);
    curves.portVelocity.push(v);
  }
  // Unwrap phase and differentiate for group delay.
  for (let i = 1; i < rawPhase.length; i++) {
    while (rawPhase[i] - rawPhase[i - 1] > Math.PI) rawPhase[i] -= TAU;
    while (rawPhase[i] - rawPhase[i - 1] < -Math.PI) rawPhase[i] += TAU;
  }
  curves.phase = rawPhase.map((ph) => (ph * 180) / Math.PI);
  for (let i = 0; i < freqs.length; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(freqs.length - 1, i + 1);
    curves.groupDelayMs.push((-(rawPhase[b] - rawPhase[a]) / (TAU * (freqs[b] - freqs[a]))) * 1000);
  }
  return { curves, metrics: computeMetrics(spec, info, curves, opts), info };
}

/** Lowest frequency at which the response first rises to `level` (log-interpolated). */
function crossingUp(freqs: number[], spl: number[], level: number): number | null {
  for (let i = 1; i < freqs.length; i++) {
    if (spl[i - 1] < level && spl[i] >= level) {
      const t = (level - spl[i - 1]) / (spl[i] - spl[i - 1]);
      return freqs[i - 1] * Math.pow(freqs[i] / freqs[i - 1], t);
    }
  }
  return spl[0] >= level ? freqs[0] : null;
}

function computeMetrics(spec: SystemSpec, info: BuildInfo, c: Curves, opts: SimOptions): Metrics {
  const f = c.freqs;
  let referenceSpl: number;
  if (info.bandpass) {
    referenceSpl = Math.max(...c.spl);
  } else {
    // Mass-controlled asymptote: same system without voice-coil inductance or filter, well above resonance.
    const ideal = buildNetwork({ ...spec, highpass: undefined, driver: { ...spec.driver, le: 0, r2: undefined, l2: undefined } });
    const sol = solve(ideal.net, TAU * info.fChar * 8);
    referenceSpl = 20 * Math.log10(abs(pressureAt(sol, opts, spec.air ?? AIR_20C)) / P_REF);
  }
  let f3High: number | null = null;
  if (info.bandpass) {
    const peak = c.spl.indexOf(Math.max(...c.spl));
    for (let i = peak + 1; i < f.length; i++) {
      if (c.spl[i] < referenceSpl - 3) {
        const t = (referenceSpl - 3 - c.spl[i - 1]) / (c.spl[i] - c.spl[i - 1]);
        f3High = f[i - 1] * Math.pow(f[i] / f[i - 1], t);
        break;
      }
    }
  }
  const inBand = (lo: number, hi: number, arr: number[]) => {
    let best = { v: -Infinity, f: f[0] };
    for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] <= hi && arr[i] > best.v) best = { v: arr[i], f: f[i] };
    return best;
  };
  // Worst case over everything simulated: an unfiltered box can over-travel below 15 Hz.
  const exc = inBand(f[0], f[f.length - 1], c.excursionMm);
  const vel = inBand(f[0], f[f.length - 1], c.portVelocity);
  let zMin = { ohms: Infinity, f: f[0] };
  for (let i = 0; i < f.length; i++) if (f[i] > 10 && c.impedance[i] < zMin.ohms) zMin = { ohms: c.impedance[i], f: f[i] };
  const peaks: number[] = [];
  for (let i = 1; i < f.length - 1; i++) if (c.impedance[i] > c.impedance[i - 1] && c.impedance[i] >= c.impedance[i + 1]) peaks.push(i);
  let tuningDip: Metrics['tuningDip'] = null;
  if (peaks.length >= 2) {
    let j = peaks[0];
    for (let i = peaks[0]; i <= peaks[1]; i++) if (c.impedance[i] < c.impedance[j]) j = i;
    tuningDip = { ohms: c.impedance[j], f: f[j] };
  }
  return {
    referenceSpl,
    f3: crossingUp(f, c.spl, referenceSpl - 3),
    f6: crossingUp(f, c.spl, referenceSpl - 6),
    f10: crossingUp(f, c.spl, referenceSpl - 10),
    f3High,
    splMax: inBand(15, 200, c.spl).v,
    excursionMax: { mm: exc.v, f: exc.f },
    portVelocityMax: { ms: Math.max(0, vel.v), f: vel.f },
    impedanceMin: zMin,
    tuningDip
  };
}

/** Complex state at one frequency, for animation (cone and port phase/amplitude). */
export function solveAt(spec: SystemSpec, f: number): Solution {
  return solve(buildNetwork(spec).net, TAU * f);
}
