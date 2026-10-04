import { AIR_20C, type Air } from './air';

const TAU = 2 * Math.PI;

/** A complete small-signal driver model in SI units. */
export interface Driver {
  fs: number; // Hz
  qes: number;
  qms: number;
  qts: number;
  vas: number; // m³
  re: number; // Ω
  le: number; // H
  /** Optional LR-2 voice-coil extension (Wright): R2 ∥ L2 in series with Le. */
  r2?: number;
  l2?: number;
  sd: number; // m²
  mms: number; // kg, includes air load
  cms: number; // m/N
  rms: number; // kg/s
  bl: number; // T·m
  xmax?: number; // m (one way)
  pe?: number; // W, thermal rating
  zNom?: number; // Ω
}

/** Any subset of the parameters a datasheet might give. */
export type DriverInput = Partial<Omit<Driver, 'qts'>> & { qts?: number };

export class DriverError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Driver parameters incomplete: missing ${missing.join(', ')}`);
  }
}

const has = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Derives every missing Thiele/Small parameter from the ones given, using
 * Qts = QesQms/(Qes+Qms), Vas = ρc²Sd²Cms, Fs = 1/(2π√(MmsCms)),
 * Qes = 2πFsMmsRe/Bl², Qms = 2πFsMms/Rms.
 * Values that are present are never overwritten.
 */
export function completeDriver(input: DriverInput, air: Air = AIR_20C): Driver {
  const p: Record<string, number | undefined> = { ...input };
  const rc2 = air.rho * air.c * air.c;
  for (let pass = 0; pass < 6; pass++) {
    if (!has(p.qts) && has(p.qes) && has(p.qms)) p.qts = (p.qes! * p.qms!) / (p.qes! + p.qms!);
    if (!has(p.qes) && has(p.qts) && has(p.qms) && p.qms! > p.qts!) p.qes = (p.qts! * p.qms!) / (p.qms! - p.qts!);
    if (!has(p.qms) && has(p.qts) && has(p.qes) && p.qes! > p.qts!) p.qms = (p.qts! * p.qes!) / (p.qes! - p.qts!);
    if (!has(p.cms) && has(p.vas) && has(p.sd)) p.cms = p.vas! / (rc2 * p.sd! * p.sd!);
    if (!has(p.vas) && has(p.cms) && has(p.sd)) p.vas = rc2 * p.sd! * p.sd! * p.cms!;
    if (!has(p.sd) && has(p.vas) && has(p.cms)) p.sd = Math.sqrt(p.vas! / (rc2 * p.cms!));
    if (!has(p.mms) && has(p.fs) && has(p.cms)) p.mms = 1 / (Math.pow(TAU * p.fs!, 2) * p.cms!);
    if (!has(p.cms) && has(p.fs) && has(p.mms)) p.cms = 1 / (Math.pow(TAU * p.fs!, 2) * p.mms!);
    if (!has(p.fs) && has(p.mms) && has(p.cms)) p.fs = 1 / (TAU * Math.sqrt(p.mms! * p.cms!));
    if (!has(p.bl) && has(p.fs) && has(p.mms) && has(p.re) && has(p.qes)) p.bl = Math.sqrt((TAU * p.fs! * p.mms! * p.re!) / p.qes!);
    if (!has(p.qes) && has(p.fs) && has(p.mms) && has(p.re) && has(p.bl)) p.qes = (TAU * p.fs! * p.mms! * p.re!) / (p.bl! * p.bl!);
    if (!has(p.rms) && has(p.fs) && has(p.mms) && has(p.qms)) p.rms = (TAU * p.fs! * p.mms!) / p.qms!;
    if (!has(p.qms) && has(p.fs) && has(p.mms) && has(p.rms)) p.qms = (TAU * p.fs! * p.mms!) / p.rms!;
  }
  const required = ['fs', 'qes', 'qms', 'qts', 'vas', 're', 'sd', 'mms', 'cms', 'rms', 'bl'];
  const missing = required.filter((k) => !has(p[k]));
  if (missing.length) throw new DriverError(missing);
  return { ...(p as unknown as Driver), le: has(p.le) ? p.le! : 0 };
}

/** Database/UI units (litres, grams, mm, cm², mH) → SI driver input. */
export interface DriverDto {
  fs?: number | null; qts?: number | null; qes?: number | null; qms?: number | null;
  vasL?: number | null; re?: number | null; leMh?: number | null; bl?: number | null;
  mmsG?: number | null; cmsMmPerN?: number | null; rms?: number | null; sdCm2?: number | null;
  xmaxMm?: number | null; peW?: number | null; zNom?: number | null;
}

const opt = (v: number | null | undefined, k = 1): number | undefined => (v == null ? undefined : v * k);

export function driverInputFromDto(d: DriverDto): DriverInput {
  return {
    fs: opt(d.fs), qts: opt(d.qts), qes: opt(d.qes), qms: opt(d.qms),
    vas: opt(d.vasL, 1e-3), re: opt(d.re), le: opt(d.leMh, 1e-3), bl: opt(d.bl),
    mms: opt(d.mmsG, 1e-3), cms: opt(d.cmsMmPerN, 1e-3), rms: opt(d.rms), sd: opt(d.sdCm2, 1e-4),
    xmax: opt(d.xmaxMm, 1e-3), pe: opt(d.peW), zNom: opt(d.zNom)
  };
}

export interface ConsistencyCheck {
  id: 'qts' | 'vas' | 'qes' | 'fs';
  ok: boolean;
  stored: number;
  computed: number;
}

/**
 * Cross-checks stored parameters against each other. Datasheets often contain values that
 * cannot all be true at once; anything off by more than `tolerance` (relative) is flagged.
 */
export function checkConsistency(p: DriverInput, air: Air = AIR_20C, tolerance = 0.05): ConsistencyCheck[] {
  const out: ConsistencyCheck[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) / Math.abs(b) <= tolerance;
  if (has(p.qts) && has(p.qes) && has(p.qms)) {
    const computed = (p.qes * p.qms) / (p.qes + p.qms);
    out.push({ id: 'qts', ok: near(p.qts, computed), stored: p.qts, computed });
  }
  if (has(p.vas) && has(p.sd) && has(p.cms)) {
    const computed = air.rho * air.c * air.c * p.sd * p.sd * p.cms;
    out.push({ id: 'vas', ok: near(p.vas, computed), stored: p.vas, computed });
  }
  if (has(p.qes) && has(p.fs) && has(p.mms) && has(p.re) && has(p.bl)) {
    const computed = (TAU * p.fs * p.mms * p.re) / (p.bl * p.bl);
    out.push({ id: 'qes', ok: near(p.qes, computed), stored: p.qes, computed });
  }
  if (has(p.fs) && has(p.mms) && has(p.cms)) {
    const computed = 1 / (TAU * Math.sqrt(p.mms * p.cms));
    out.push({ id: 'fs', ok: near(p.fs, computed), stored: p.fs, computed });
  }
  return out;
}

/** How the two coils of a dual-voice-coil driver are connected; 'single' drives one coil and leaves the other open. */
export type CoilWiring = 'series' | 'parallel' | 'single';

/**
 * Re-expresses a dual-voice-coil driver whose T/S were measured with its coils wired `measured`
 * for the wiring `use`. The two coils share one former, so they are treated as perfectly coupled:
 * against both coils in parallel, series has 4× Re and Le and 2× Bl (the factors datasheets quote),
 * one coil alone has 2× Re, the same Le and the same Bl — so its Qes doubles. Qes is the same for
 * series and parallel (Re/Bl² does not change); the mechanical side (Fs, Mms, Cms, Rms, Vas, Qms)
 * never depends on the wiring.
 */
export function rewireCoils(d: Driver, measured: 'series' | 'parallel', use: CoilWiring): Driver {
  // Everything as "both coils in parallel" first, then out to the requested wiring.
  const toPar = measured === 'parallel' ? { z: 1, bl: 1 } : { z: 1 / 4, bl: 1 / 2 };
  const out = use === 'series' ? { re: 4, le: 4, bl: 2 } : use === 'single' ? { re: 2, le: 1, bl: 1 } : { re: 1, le: 1, bl: 1 };
  const re = d.re * toPar.z * out.re;
  const bl = d.bl * toPar.bl * out.bl;
  const qes = (TAU * d.fs * d.mms * re) / (bl * bl);
  return {
    ...d,
    re, bl, qes,
    qts: (qes * d.qms) / (qes + d.qms),
    le: d.le * toPar.z * out.le,
    r2: d.r2 === undefined ? undefined : d.r2 * toPar.z * out.le,
    l2: d.l2 === undefined ? undefined : d.l2 * toPar.z * out.le,
    zNom: d.zNom === undefined ? undefined : d.zNom * toPar.z * out.re
  };
}

/** Efficiency bandwidth product. Below ~50 suits sealed boxes, above ~100 vented/horn. */
export const ebp = (d: Pick<Driver, 'fs' | 'qes'>): number => d.fs / d.qes;

/** Reference efficiency η0 and the 1 W / 1 m half-space sensitivity it implies. */
export function referenceEfficiency(d: Pick<Driver, 'fs' | 'vas' | 'qes'>, air: Air = AIR_20C): { eta0: number; spl1w1m: number } {
  const eta0 = ((4 * Math.PI * Math.PI) / Math.pow(air.c, 3)) * Math.pow(d.fs, 3) * d.vas / d.qes;
  // 1 W acoustic into half space at 1 m: p² = ρc·W/(2πr²); 112.1 dB is this term for ρ = 1.18.
  const halfSpace = 10 * Math.log10((air.rho * air.c) / (2 * Math.PI * 2e-5 * 2e-5));
  return { eta0, spl1w1m: halfSpace + 10 * Math.log10(eta0) };
}
