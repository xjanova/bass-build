import { AIR_20C, type Air } from './air';
import { cx, div, type Cx } from './complex';
import type { Driver } from './driver';
import {
  compliance, OUTSIDE, resistance, seriesBranch,
  type DriverElement, type Element, type Network, type NodeId
} from './network';

const TAU = 2 * Math.PI;

/** Default end correction for a port: one flanged end (0.85 r) + one free end (0.61 r). */
export const DEFAULT_END_CORRECTION = 1.463;

export interface PortSpec {
  /** Open cross-section of ONE port, m². */
  area: number;
  /** Number of identical ports (default 1). */
  count?: number;
  /** End correction as a multiple of the equivalent radius √(A/π). */
  endCorrection?: number;
}

export interface PassiveRadiatorSpec {
  sd: number; // m²
  mmp: number; // kg, including any added mass
  cmp: number; // m/N
  qmp?: number; // mechanical Q (default 10)
  count?: number;
}

/** All volumes are NET air volumes in m³; frequencies in Hz. */
export type BoxDesign =
  | { type: 'free-air' }
  | { type: 'sealed'; vb: number; ql?: number; stuffing?: number }
  | { type: 'vented'; vb: number; fb: number; port: PortSpec; ql?: number; qp?: number; stuffing?: number }
  | { type: 'pr'; vb: number; pr: PassiveRadiatorSpec; ql?: number; stuffing?: number }
  | { type: 'bp4'; vr: number; vf: number; fb: number; port: PortSpec; ql?: number; qp?: number }
  | { type: 'bp6'; vr: number; fbr: number; portR: PortSpec; vf: number; fbf: number; portF: PortSpec; ql?: number; qp?: number }
  | { type: 'isobaric'; vb: number; coupling?: number; ql?: number; vent?: { fb: number; port: PortSpec; qp?: number } };

export interface DriveSpec {
  /** RMS volts across the whole driver load. Takes precedence over watts. */
  volts?: number;
  /** Amplifier power into the nominal load. */
  watts?: number;
  /** Nominal impedance of the whole load; defaults to driver zNom (or Re) with wiring applied. */
  nominalOhms?: number;
}

export interface SystemSpec {
  driver: Driver;
  /** Identical drivers sharing the same chambers (default 1). Isobaric uses 2 by definition. */
  count?: number;
  wiring?: 'parallel' | 'series';
  box: BoxDesign;
  drive: DriveSpec;
  /** Subsonic / high-pass filter on the source. */
  highpass?: { fc: number; order: 2 | 4 };
  air?: Air;
}

export interface PortInfo {
  label: string;
  area: number;
  count: number;
  /** Acoustic length including end corrections, m. */
  effectiveLength: number;
  /** Length to cut, m. Negative means the area is too small for this tuning. */
  physicalLength: number;
  tuning: number;
}

export interface BuildInfo {
  /** Sealed / isobaric system resonance and Q (no Le, no losses). */
  fc?: number;
  qtc?: number;
  ports: PortInfo[];
  /** Characteristic low frequency used to pick the passband reference. */
  fChar: number;
  bandpass: boolean;
  voltsPerDriver: number;
  totalVolts: number;
  nominalOhms: number;
}

/** Butterworth high-pass response H(jω). */
export function butterworthHighpass(fc: number, order: 2 | 4): (w: number) => Cx {
  const wc = TAU * fc;
  return (w) => {
    const s = w / wc; // normalised jω → j·s
    if (order === 2) {
      // s²/(s² + √2 s + 1) with s → j s
      return div(cx(-s * s), cx(1 - s * s, Math.SQRT2 * s));
    }
    // (s⁴)/(s⁴ + 2.6131 s³ + 3.4142 s² + 2.6131 s + 1)
    const s2 = s * s;
    return div(cx(s2 * s2), cx(s2 * s2 - 3.4142 * s2 + 1, 2.6131 * s - 2.6131 * s2 * s));
  };
}

export function buildNetwork(spec: SystemSpec): { net: Network; info: BuildInfo } {
  const air = spec.air ?? AIR_20C;
  const rc2 = air.rho * air.c * air.c;
  const d = spec.driver;
  const box = spec.box;
  const n = box.type === 'isobaric' ? 2 : Math.max(1, Math.round(spec.count ?? 1));
  const wiring = spec.wiring ?? 'parallel';
  const unitOhms = d.zNom ?? d.re;
  const nominalOhms = spec.drive.nominalOhms ?? (wiring === 'parallel' ? unitOhms / n : unitOhms * n);
  const totalVolts = spec.drive.volts ?? Math.sqrt((spec.drive.watts ?? 1) * nominalOhms);
  const voltsPerDriver = wiring === 'parallel' ? totalVolts : totalVolts / n;

  const elements: Element[] = [];
  let nodes = 1;
  const node = (): NodeId => nodes++;
  const ports: PortInfo[] = [];
  const cab = (v: number, stuffing = 0) => (v / rc2) * (1 + 0.4 * Math.min(1, Math.max(0, stuffing)));

  const addChamber = (label: string, nd: NodeId, c: number, ql: number, fRef: number) => {
    elements.push(compliance(label, nd, OUTSIDE, c));
    elements.push({ ...resistance(`${label} leak`, nd, OUTSIDE, ql / (TAU * fRef * c)), radiator: { id: 'leak' } });
  };
  const addPort = (label: string, nd: NodeId, c: number, fb: number, port: PortSpec, qp: number, radiatorId: string) => {
    const count = Math.max(1, Math.round(port.count ?? 1));
    const wb = TAU * fb;
    const mTotal = 1 / (wb * wb * c); // all ports in parallel
    const mOne = mTotal * count;
    const effectiveLength = (mOne * port.area) / air.rho;
    const physicalLength = effectiveLength - (port.endCorrection ?? DEFAULT_END_CORRECTION) * Math.sqrt(port.area / Math.PI);
    ports.push({ label, area: port.area, count, effectiveLength, physicalLength, tuning: fb });
    for (let i = 0; i < count; i++) {
      elements.push(seriesBranch(`${label}${count > 1 ? ` ${i + 1}` : ''}`, nd, OUTSIDE, { m: mOne, r: (wb * mOne) / qp }, {
        radiator: { id: radiatorId }, area: port.area
      }));
    }
  };
  const addDriver = (label: string, front: NodeId, rear: NodeId, radiate: boolean): void => {
    const e: DriverElement = { kind: 'driver', label, driver: d, front, rear, volts: voltsPerDriver };
    if (radiate && front === OUTSIDE) e.frontRadiator = { id: 'cone' };
    if (radiate && rear === OUTSIDE) e.rearRadiator = { id: 'cone-rear' };
    elements.push(e);
  };

  let fc: number | undefined;
  let qtc: number | undefined;
  let fChar = d.fs;
  let bandpass = false;
  const qlDefault = 10;
  const qpDefault = 100;

  switch (box.type) {
    case 'free-air': {
      // Infinite baffle: rear radiation is assumed to go elsewhere, so only the front counts.
      for (let i = 0; i < n; i++) elements.push({ kind: 'driver', label: `driver ${i + 1}`, driver: d, front: OUTSIDE, rear: OUTSIDE, volts: voltsPerDriver, frontRadiator: { id: 'cone' } });
      break;
    }
    case 'sealed': {
      const b = node();
      const c = cab(box.vb, box.stuffing);
      const alpha = (n * d.vas) / ((c * rc2));
      fc = d.fs * Math.sqrt(1 + alpha);
      qtc = d.qts * Math.sqrt(1 + alpha);
      fChar = fc;
      for (let i = 0; i < n; i++) addDriver(`driver ${i + 1}`, OUTSIDE, b, true);
      addChamber('box', b, c, box.ql ?? qlDefault, fc);
      break;
    }
    case 'vented': {
      const b = node();
      const c = cab(box.vb, box.stuffing);
      for (let i = 0; i < n; i++) addDriver(`driver ${i + 1}`, OUTSIDE, b, true);
      addChamber('box', b, c, box.ql ?? qlDefault, box.fb);
      addPort('port', b, c, box.fb, box.port, box.qp ?? qpDefault, 'port');
      fChar = Math.max(d.fs, box.fb);
      break;
    }
    case 'pr': {
      const b = node();
      const c = cab(box.vb, box.stuffing);
      for (let i = 0; i < n; i++) addDriver(`driver ${i + 1}`, OUTSIDE, b, true);
      const pr = box.pr;
      const count = Math.max(1, Math.round(pr.count ?? 1));
      const sp2 = pr.sd * pr.sd;
      const fp = 1 / (TAU * Math.sqrt(pr.mmp * pr.cmp));
      const rmp = (TAU * fp * pr.mmp) / (pr.qmp ?? 10);
      for (let i = 0; i < count; i++) {
        elements.push(seriesBranch(`passive radiator ${i + 1}`, b, OUTSIDE, { m: pr.mmp / sp2, c: pr.cmp * sp2, r: rmp / sp2 }, {
          radiator: { id: 'pr' }, area: pr.sd
        }));
      }
      // Box + PR tuning ≈ frequency where the PR mass resonates with the parallel stiffness.
      const fbApprox = (1 / TAU) * Math.sqrt((1 / c + 1 / (pr.cmp * sp2 * count)) / (pr.mmp / sp2 / count));
      addChamber('box', b, c, box.ql ?? qlDefault, fbApprox);
      fChar = Math.max(d.fs, fbApprox);
      break;
    }
    case 'bp4': {
      const r = node();
      const f = node();
      const cr = cab(box.vr);
      const cf = cab(box.vf);
      for (let i = 0; i < n; i++) addDriver(`driver ${i + 1}`, f, r, false);
      const alpha = (n * d.vas) / (cr * rc2);
      fc = d.fs * Math.sqrt(1 + alpha);
      qtc = d.qts * Math.sqrt(1 + alpha);
      addChamber('rear chamber', r, cr, box.ql ?? qlDefault, fc);
      addChamber('front chamber', f, cf, box.ql ?? qlDefault, box.fb);
      addPort('port', f, cf, box.fb, box.port, box.qp ?? qpDefault, 'port');
      fChar = Math.max(fc, box.fb);
      bandpass = true;
      break;
    }
    case 'bp6': {
      const r = node();
      const f = node();
      const cr = cab(box.vr);
      const cf = cab(box.vf);
      for (let i = 0; i < n; i++) addDriver(`driver ${i + 1}`, f, r, false);
      addChamber('rear chamber', r, cr, box.ql ?? qlDefault, box.fbr);
      addChamber('front chamber', f, cf, box.ql ?? qlDefault, box.fbf);
      addPort('rear port', r, cr, box.fbr, box.portR, box.qp ?? qpDefault, 'port-rear');
      addPort('front port', f, cf, box.fbf, box.portF, box.qp ?? qpDefault, 'port');
      fChar = Math.max(box.fbr, box.fbf);
      bandpass = true;
      break;
    }
    case 'isobaric': {
      const k = node(); // coupling chamber between the two drivers
      const b = node();
      const c = cab(box.vb);
      const ck = cab(box.coupling ?? 0.001);
      addDriver('outer driver', OUTSIDE, k, true);
      addDriver('inner driver', k, b, false);
      elements.push(compliance('coupling chamber', k, OUTSIDE, ck));
      // The compound driver behaves like one with Vas/2, so α uses Vas/2.
      const alpha = (d.vas / 2) / (c * rc2);
      if (box.vent) {
        addChamber('box', b, c, box.ql ?? qlDefault, box.vent.fb);
        addPort('port', b, c, box.vent.fb, box.vent.port, box.vent.qp ?? qpDefault, 'port');
        fChar = Math.max(d.fs, box.vent.fb);
      } else {
        fc = d.fs * Math.sqrt(1 + alpha);
        qtc = d.qts * Math.sqrt(1 + alpha);
        addChamber('box', b, c, box.ql ?? qlDefault, fc);
        fChar = fc;
      }
      break;
    }
  }

  const net: Network = { nodeCount: nodes, elements };
  if (spec.highpass) net.sourceGain = butterworthHighpass(spec.highpass.fc, spec.highpass.order);
  return { net, info: { fc, qtc, ports, fChar, bandpass, voltsPerDriver, totalVolts, nominalOhms } };
}
