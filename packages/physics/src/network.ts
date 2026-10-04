import { add, abs, cx, div, mul, scale, sub, ZERO, type Cx } from './complex';
import type { Driver } from './driver';

/**
 * Acoustic nodal network (impedance analogy: pressure = across, volume velocity = through).
 * Node 0 is the outside air at reference pressure. Every enclosure topology — sealed, vented,
 * passive radiator, band-pass, isobaric, later transmission lines — is just a different set of
 * elements on the same solver, which is what lets the AI search over topologies.
 */
export type NodeId = number;
export const OUTSIDE: NodeId = 0;

export interface Radiator {
  /** Stable id used in results, e.g. "cone", "port", "pr". */
  id: string;
  /** Position in metres (box front centre = origin) for path-length summation. */
  position?: [number, number, number];
}

export interface PassiveElement {
  kind: 'passive';
  label: string;
  a: NodeId;
  b: NodeId;
  /** Admittance between a and b at angular frequency w. */
  admittance: (w: number) => Cx;
  /** Flow from a to b leaves the system and radiates (b must be OUTSIDE). */
  radiator?: Radiator;
  /** Cross-section in m², so results can report air velocity (ports). */
  area?: number;
}

export interface DriverElement {
  kind: 'driver';
  label: string;
  driver: Driver;
  /** Node the cone front faces, and the node behind it. */
  front: NodeId;
  rear: NodeId;
  /** RMS source voltage for this driver for a flat 1× source (at its terminals when `rs` is 0). */
  volts: number;
  /** Resistance between the source and this driver's terminals (amplifier output + wire), Ω. */
  rs?: number;
  frontRadiator?: Radiator;
  rearRadiator?: Radiator;
}

export type Element = PassiveElement | DriverElement;

export interface Network {
  nodeCount: number; // including OUTSIDE
  elements: Element[];
  /** Optional frequency-dependent gain applied to every driver's voltage (e.g. subsonic filter). */
  sourceGain?: (w: number) => Cx;
}

// ---- element factories (acoustic SI units) -------------------------------------------------

/** Air spring of volume V: C = V/(ρc²). */
export const compliance = (label: string, a: NodeId, b: NodeId, c: number): PassiveElement => ({
  kind: 'passive', label, a, b, admittance: (w) => cx(0, w * c)
});

export const resistance = (label: string, a: NodeId, b: NodeId, r: number): PassiveElement => ({
  kind: 'passive', label, a, b, admittance: () => cx(1 / r)
});

/** Series R + jωM (+ 1/jωC when c is given): ports, passive radiators, leaks. */
export const seriesBranch = (
  label: string, a: NodeId, b: NodeId,
  p: { m: number; r?: number; c?: number }, extra: Partial<PassiveElement> = {}
): PassiveElement => ({
  kind: 'passive', label, a, b, ...extra,
  admittance: (w) => {
    const x = w * p.m - (p.c ? 1 / (w * p.c) : 0);
    const r = p.r ?? 0;
    const d = r * r + x * x;
    return cx(r / d, -x / d);
  }
});

// ---- solver ---------------------------------------------------------------------------------

/** Voice-coil impedance: Re + jωLe, plus R2 ∥ jωL2 when the LR-2 model is given. */
export function voiceCoil(d: Driver, w: number): Cx {
  let z = cx(d.re, w * d.le);
  if (d.r2 && d.l2) {
    const jl = cx(0, w * d.l2);
    z = add(z, div(mul(jl, cx(d.r2)), add(cx(d.r2), jl)));
  }
  return z;
}

export interface DriverState {
  label: string;
  /** Cone volume velocity, positive = moving forward (m³/s RMS). */
  u: Cx;
  /** Electrical input impedance at the terminals (Ω), not counting the series resistance. */
  zin: Cx;
  /** Cone displacement (m RMS, complex). */
  x: Cx;
  /** Electrical current (A RMS). */
  i: Cx;
  volts: Cx;
}

export interface PassiveState {
  label: string;
  /** Flow from a to b (m³/s RMS). */
  u: Cx;
  area?: number;
}

export interface RadiatorFlow {
  id: string;
  u: Cx;
  position?: [number, number, number];
}

export interface Solution {
  w: number;
  pressures: Cx[]; // per node, index 0 = outside (0)
  drivers: DriverState[];
  passives: PassiveState[];
  radiators: RadiatorFlow[];
}

/** Solves the network at one angular frequency. */
export function solve(net: Network, w: number): Solution {
  const n = net.nodeCount - 1; // unknowns (OUTSIDE excluded)
  const Y: Cx[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => ZERO));
  const I: Cx[] = Array.from({ length: n }, () => ZERO);
  const gain = net.sourceGain ? net.sourceGain(w) : cx(1);

  const stamp = (a: NodeId, b: NodeId, y: Cx) => {
    if (a > 0) Y[a - 1][a - 1] = add(Y[a - 1][a - 1], y);
    if (b > 0) Y[b - 1][b - 1] = add(Y[b - 1][b - 1], y);
    if (a > 0 && b > 0) {
      Y[a - 1][b - 1] = sub(Y[a - 1][b - 1], y);
      Y[b - 1][a - 1] = sub(Y[b - 1][a - 1], y);
    }
  };
  const inject = (node: NodeId, u: Cx) => { if (node > 0) I[node - 1] = add(I[node - 1], u); };

  // Each driver is a Thevenin source (pg, Zd) between rear and front, folded to Norton form.
  const drv = net.elements.filter((e): e is DriverElement => e.kind === 'driver').map((e) => {
    const d = e.driver;
    const k = d.bl / d.sd;
    // The series resistance sits in the electrical loop like extra coil resistance.
    const zvc = add(voiceCoil(d, w), cx(e.rs ?? 0));
    const volts = scale(gain, e.volts);
    const zm = cx(d.rms / (d.sd * d.sd), w * d.mms / (d.sd * d.sd) - 1 / (w * d.cms * d.sd * d.sd));
    const zd = add(div(cx(k * k), zvc), zm);
    const pg = div(scale(volts, k), zvc);
    const is = div(pg, zd);
    stamp(e.front, e.rear, div(cx(1), zd));
    inject(e.front, is);
    inject(e.rear, scale(is, -1));
    return { e, zd, is, zvc, volts };
  });
  for (const e of net.elements) if (e.kind === 'passive') stamp(e.a, e.b, e.admittance(w));

  const p = [ZERO, ...solveLinear(Y, I)];

  const drivers: DriverState[] = drv.map(({ e, zd, is, zvc, volts }) => {
    const u = sub(is, div(sub(p[e.front], p[e.rear]), zd));
    const vel = scale(u, 1 / e.driver.sd);
    const i = div(sub(volts, scale(vel, e.driver.bl)), zvc);
    return { label: e.label, u, zin: sub(div(volts, i), cx(e.rs ?? 0)), x: div(vel, cx(0, w)), i, volts };
  });
  const passives: PassiveState[] = [];
  const radiators: RadiatorFlow[] = [];
  let di = 0;
  for (const e of net.elements) {
    if (e.kind === 'driver') {
      const st = drivers[di++];
      if (e.frontRadiator) radiators.push({ id: e.frontRadiator.id, u: st.u, position: e.frontRadiator.position });
      if (e.rearRadiator) radiators.push({ id: e.rearRadiator.id, u: scale(st.u, -1), position: e.rearRadiator.position });
    } else {
      const u = mul(sub(p[e.a], p[e.b]), e.admittance(w));
      passives.push({ label: e.label, u, area: e.area });
      if (e.radiator) radiators.push({ id: e.radiator.id, u, position: e.radiator.position });
    }
  }
  return { w, pressures: p, drivers, passives, radiators };
}

/** Gaussian elimination with partial pivoting on a small dense complex system. */
export function solveLinear(A: Cx[][], b: Cx[]): Cx[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (abs(M[r][col]) > abs(M[piv][col])) piv = r;
    if (abs(M[piv][col]) < 1e-300) throw new Error('Singular acoustic network (a node is floating)');
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = div(M[r][col], M[col][col]);
      if (f.re === 0 && f.im === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] = sub(M[r][c], mul(f, M[col][c]));
    }
  }
  const x: Cx[] = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s = sub(s, mul(M[r][c], x[c]));
    x[r] = div(s, M[r][r]);
  }
  return x;
}
