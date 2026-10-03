import {
  completeDriver, driverInputFromDto, DriverError, simulate, solveAt,
  type BoxDesign, type Driver, type SimResult, type Solution, type SystemSpec
} from '@bassbuild/physics';
import type { DriverDto, PanelMaterialDto } from '../data/types';
import type { Design } from '../state/store';

const cm2 = (v: number) => v * 1e-4;
const L = (v: number) => v * 1e-3;

export function toBox(d: Design): BoxDesign {
  switch (d.boxType) {
    case 'sealed': return { type: 'sealed', vb: L(d.vbL), ql: d.ql, stuffing: d.stuffing };
    case 'vented': return { type: 'vented', vb: L(d.vbL), fb: d.fbHz, port: { area: cm2(d.portAreaCm2) }, ql: d.ql, stuffing: d.stuffing };
    case 'pr': return {
      type: 'pr', vb: L(d.vbL), ql: d.ql, stuffing: d.stuffing,
      pr: { sd: cm2(d.prSdCm2), mmp: d.prMassG / 1000, cmp: d.prCmsMmN / 1000, qmp: 10, count: d.prCount }
    };
    case 'bp4': return { type: 'bp4', vr: L(d.vbL), vf: L(d.vfL), fb: d.fbHz, port: { area: cm2(d.portAreaCm2) }, ql: d.ql };
    case 'bp6': return {
      type: 'bp6', vr: L(d.vbL), fbr: d.fbHz, portR: { area: cm2(d.portAreaCm2) },
      vf: L(d.vfL), fbf: d.fb2Hz, portF: { area: cm2(d.port2AreaCm2) }, ql: d.ql
    };
    case 'isobaric': return { type: 'isobaric', vb: L(d.vbL), coupling: 0.001, ql: d.ql };
  }
}

export function toSpec(d: Design, driver: Driver): SystemSpec {
  return {
    driver,
    count: d.count,
    wiring: d.wiring,
    box: toBox(d),
    drive: { watts: d.watts },
    highpass: d.subsonic ? { fc: d.subsonicHz, order: 4 } : undefined
  };
}

export type DriverResult = { ok: true; driver: Driver } | { ok: false; missing: string[] };

export function driverFromDto(dto: DriverDto | undefined): DriverResult {
  if (!dto) return { ok: false, missing: ['driver'] };
  try {
    return { ok: true, driver: completeDriver(driverInputFromDto(dto)) };
  } catch (e) {
    if (e instanceof DriverError) return { ok: false, missing: e.missing };
    throw e;
  }
}

// ---- enclosure sizing ---------------------------------------------------------------------

export interface BoxGeometry {
  /** External and internal dimensions, m. W = width (x), H = height (y), D = depth (z). */
  wx: number; hx: number; dx: number;
  wi: number; hi: number; di: number;
  t: number;
  /** Slot port along the bottom of the front baffle (0 when there is no front port). */
  slotH: number;
  portLength: number;
  portFold: 'none' | 'straight' | 'L' | 'impossible';
  /** Driver centre height above the box bottom, m. */
  driverY: number;
  driverRadius: number;
  cutoutRadius: number;
  fits: boolean;
  magnetClear: boolean;
  panelAreaM2: number;
  weightKg: number;
  sheets: number;
}

export function sizeBox(d: Design, dto: DriverDto | undefined, res: SimResult | null, material: PanelMaterialDto | undefined): BoxGeometry {
  const t = d.thicknessMm / 1000;
  const drivers = d.boxType === 'isobaric' ? 2 : d.count;
  const outer = (dto?.outerMm ?? 390) / 1000;
  const depth = (dto?.depthMm ?? 190) / 1000;
  const front = res?.info.ports.find((p) => p.label === 'port' || p.label === 'front port');
  const portLen = front ? Math.max(0, front.physicalLength) : 0;
  const portVol = (res?.info.ports ?? []).reduce((s, p) => s + p.area * p.count * Math.min(1.5, Math.max(0, p.physicalLength)) * 1.3, 0);
  const net = L(d.vbL) + (d.boxType === 'bp4' || d.boxType === 'bp6' ? L(d.vfL) : 0);
  const gross = net + drivers * L(dto?.displacementL ?? 3) + portVol + 0.001;

  let hi = Math.cbrt(gross / (1.25 * 0.8));
  let wi = 1.25 * hi;
  let di = 0.8 * hi;
  const slotGuess = front ? front.area / wi : 0;
  const needH = outer + 0.03 + (front ? slotGuess + t : 0);
  if (hi < needH) {
    hi = needH;
    di = Math.sqrt(gross / (hi * 1.5625));
    wi = 1.5625 * di;
  }
  const slotH = front ? front.area / wi : 0;
  const usableBottom = t + (front ? slotH + t : 0);
  const driverY = usableBottom + (hi + t - usableBottom) / 2;
  const fits = hi - (front ? slotH + t : 0) >= outer + 0.01;
  const magnetClear = di - depth - (front && portLen > di - slotH - 0.03 ? slotH + t : 0) >= 0.02;
  const portFold: BoxGeometry['portFold'] = !front ? 'none' : portLen <= 0 ? 'impossible' : portLen <= di - 0.03 ? 'straight' : portLen <= di + hi - 0.06 ? 'L' : 'impossible';
  const wx = wi + 2 * t, hx = hi + 2 * t, dx = di + 2 * t;
  const panelAreaM2 = 2 * wx * dx + 2 * wx * hi + 2 * di * hi + (front ? wi * Math.min(1.5, portLen) : 0) + 0.5 * wi * hi;
  const density = material?.densityKgM3 ?? 750;
  return {
    wx, hx, dx, wi, hi, di, t, slotH, portLength: portLen, portFold, driverY,
    driverRadius: outer / 2, cutoutRadius: (dto?.cutoutMm ?? outer * 900) / 2000,
    fits, magnetClear, panelAreaM2,
    weightKg: panelAreaM2 * t * density,
    sheets: Math.max(1, Math.ceil((panelAreaM2 * 1.2) / (1.22 * 2.44)))
  };
}

// ---- thermal (voice coil / magnet) -------------------------------------------------------------

/** Two-node first-order estimate. Rth defaults to "≈110 K rise at rated power" when the datasheet is silent. */
export function thermalAt(watts: number, peW: number | null | undefined, seconds: number): { tvc: number; tmag: number; reRise: number } {
  const pe = peW && peW > 0 ? peW : 300;
  const rthVc = 110 / pe;
  const rthMag = 35 / pe;
  const tvc = 25 + watts * rthVc * (1 - Math.exp(-seconds / 15));
  const tmag = 25 + watts * rthMag * (1 - Math.exp(-seconds / 90));
  return { tvc, tmag, reRise: 1 + 0.00393 * (tvc - 25) };
}

/** Lowest bending mode of the larger side panel, simply supported (Kirchhoff plate). */
export function panelMode(geo: BoxGeometry, material: PanelMaterialDto | undefined): number {
  const e = (material?.eGpa ?? 3.5) * 1e9;
  const rho = material?.densityKgM3 ?? 750;
  const nu = material?.poisson ?? 0.25;
  const h = geo.t;
  const bend = (e * h * h * h) / (12 * (1 - nu * nu));
  const [a, b] = geo.wi > geo.di ? [geo.wi, geo.hi] : [geo.di, geo.hi];
  return (Math.PI / 2) * Math.sqrt(bend / (rho * h)) * (1 / (a * a) + 1 / (b * b));
}

// ---- warnings ---------------------------------------------------------------------------------

export interface Warning { level: 'info' | 'warn' | 'bad'; text: string }

export function warningsFor(d: Design, dto: DriverDto | undefined, res: SimResult, geo: BoxGeometry): Warning[] {
  const out: Warning[] = [];
  const m = res.metrics;
  const xmax = dto?.xmaxMm ?? null;
  const pe = dto?.peW ?? null;
  const perDriver = d.watts / (d.boxType === 'isobaric' ? 2 : d.count);
  if (pe && perDriver > pe) out.push({ level: 'bad', text: `กำลังต่อดอก ${Math.round(perDriver)} W เกินพิกัด ${pe} W วอยซ์คอยล์จะร้อนจัด` });
  if (m.portVelocityMax.ms > 30) out.push({ level: 'bad', text: `ลมในท่อ ${m.portVelocityMax.ms.toFixed(1)} m/s เกิน 30 m/s เสียงลมจะชัด ควรขยายท่อ` });
  else if (m.portVelocityMax.ms > 17) out.push({ level: 'warn', text: `ลมในท่อ ${m.portVelocityMax.ms.toFixed(1)} m/s เกินเกณฑ์ 17 m/s อาจได้ยินเสียงลม` });
  if (xmax && m.excursionMax.mm > xmax) {
    const below = res.info.ports.length > 0 && m.excursionMax.f < (res.info.ports[0]?.tuning ?? 0);
    out.push({ level: 'bad', text: `ระยะชัก ${m.excursionMax.mm.toFixed(1)} มม. เกิน Xmax ${xmax} มม. ที่ ${m.excursionMax.f.toFixed(0)} Hz${below && !d.subsonic ? ' (ต่ำกว่าจูน) เปิด Subsonic ช่วยได้' : ' ลดกำลังหรือเพิ่มปริมาตร'}` });
  }
  if (geo.portFold === 'impossible') out.push({ level: 'bad', text: geo.portLength <= 0 ? 'พื้นที่ท่อเล็กเกินไปสำหรับความถี่จูนนี้ ท่อสั้นจนติดลบ' : `ท่อยาว ${(geo.portLength * 100).toFixed(0)} ซม. ใส่ในตู้ไม่ได้ ลดพื้นที่ท่อหรือเพิ่ม Fb` });
  if (!geo.fits) out.push({ level: 'bad', text: 'แผงหน้าเตี้ยกว่าหน้ากว้างลำโพง' });
  if (!geo.magnetClear) out.push({ level: 'warn', text: 'แม่เหล็กชิดผนังหลังหรือท่อเกินไป' });
  if (m.impedanceMin.ohms < 2) out.push({ level: 'warn', text: `อิมพีแดนซ์ต่ำสุด ${m.impedanceMin.ohms.toFixed(1)} Ω แอมป์ต้องรับโหลดต่ำได้` });
  return out;
}

export { simulate, solveAt, type Solution };
