import {
  checkConsistency, completeDriver, driverInputFromDto, DriverError, simulate, solveAt, suggestAlignment,
  type AlignmentFlag, type AlignmentRecipe, type BoxDesign, type Driver, type FillSpec, type SimResult, type Solution, type SystemSpec
} from '@bassbuild/physics';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../data/types';
import type { Design } from '../state/store';

const cm2 = (v: number) => v * 1e-4;
const L = (v: number) => v * 1e-3;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- damping materials ------------------------------------------------------------------------

/**
 * What a completely filled box does with each fill: apparent-volume gain (isothermal effect) and
 * absorption Q. Estimates from the stuffing literature, ordered by flow resistivity — not
 * measurements, so the UI marks the result as approximate.
 */
const FILL: Record<string, { gain: number; qa: number }> = {
  polyfill: { gain: 0.25, qa: 6 },
  wool: { gain: 0.3, qa: 5 },
  fiberglass_24k: { gain: 0.2, qa: 5 },
  rockwool_60k: { gain: 0.15, qa: 4 },
  melamine: { gain: 0.12, qa: 6 },
  pu_foam: { gain: 0.1, qa: 7 },
  felt: { gain: 0.05, qa: 8 }
};
const FILL_BY_KIND: Record<string, { gain: number; qa: number }> = { fiber: FILL.polyfill, foam: FILL.pu_foam, felt: FILL.felt };

export const isFill = (m: DampingMaterialDto) => m.kind !== 'cld';

export function fillFor(d: Design, damping: DampingMaterialDto[]): FillSpec {
  if (d.stuffing <= 0) return { stuffing: 0 };
  const m = damping.find((x) => x.key === d.fillKey);
  const k = FILL[d.fillKey] ?? (m?.kind ? FILL_BY_KIND[m.kind] : undefined) ?? FILL.polyfill;
  // Absorption adds up like parallel losses: a half-full box has twice the Qa of a full one.
  return { stuffing: d.stuffing, stuffingGain: k.gain, qa: k.qa / d.stuffing };
}

/** Constrained-layer damping sheets: thickness as sold, and the loss factor they add to a wood panel. */
const CLD: Record<string, { thicknessMm: number; eta: number }> = {
  butyl_cld: { thicknessMm: 2, eta: 0.12 },
  bitumen_cld: { thicknessMm: 3, eta: 0.08 }
};

export interface WallDamping { massKgM2: number; eta: number; f11Factor: number; ampFactor: number }

/** Effect of a damping sheet on the panels: extra mass lowers the panel modes, extra loss shrinks them. */
export function wallDamping(d: Design, panel: PanelMaterialDto | undefined, damping: DampingMaterialDto[]): WallDamping {
  const eta0 = panel?.lossFactor ?? 0.03;
  const sheet = CLD[d.cldKey];
  const m = damping.find((x) => x.key === d.cldKey);
  if (!sheet || !m) return { massKgM2: 0, eta: eta0, f11Factor: 1, ampFactor: 1 };
  const massKgM2 = ((m.densityKgM3 ?? 1600) * sheet.thicknessMm) / 1000;
  const panelMass = (panel?.densityKgM3 ?? 750) * (d.thicknessMm / 1000);
  const eta = eta0 + sheet.eta;
  return { massKgM2, eta, f11Factor: Math.sqrt(panelMass / (panelMass + massKgM2)), ampFactor: eta0 / eta };
}

export function toBox(d: Design, fill: FillSpec = { stuffing: d.stuffing }): BoxDesign {
  switch (d.boxType) {
    case 'sealed': return { type: 'sealed', vb: L(d.vbL), ql: d.ql, ...fill };
    case 'vented': return { type: 'vented', vb: L(d.vbL), fb: d.fbHz, port: { area: cm2(d.portAreaCm2) }, ql: d.ql, ...fill };
    case 'pr': return {
      type: 'pr', vb: L(d.vbL), ql: d.ql, ...fill,
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

export function toSpec(d: Design, driver: Driver, damping: DampingMaterialDto[] = []): SystemSpec {
  return {
    driver,
    count: d.count,
    wiring: d.wiring,
    box: toBox(d, fillFor(d, damping)),
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

export function sizeBox(d: Design, dto: DriverDto | undefined, res: SimResult | null, material: PanelMaterialDto | undefined, sheetKgM2 = 0): BoxGeometry {
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
    // Damping sheets go on the walls, not the baffle (about a fifth of the panel area).
    weightKg: panelAreaM2 * t * density + panelAreaM2 * 0.8 * sheetKgM2,
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
export function panelMode(geo: BoxGeometry, material: PanelMaterialDto | undefined, f11Factor = 1): number {
  const e = (material?.eGpa ?? 3.5) * 1e9;
  const rho = material?.densityKgM3 ?? 750;
  const nu = material?.poisson ?? 0.25;
  const h = geo.t;
  const bend = (e * h * h * h) / (12 * (1 - nu * nu));
  const [a, b] = geo.wi > geo.di ? [geo.wi, geo.hi] : [geo.di, geo.hi];
  return (Math.PI / 2) * Math.sqrt(bend / (rho * h)) * (1 / (a * a) + 1 / (b * b)) * f11Factor;
}

// ---- warnings ---------------------------------------------------------------------------------

export interface Warning { level: 'info' | 'warn' | 'bad'; text: string }

const CHECK_TEXT: Record<string, string> = {
  qts: 'Qts ไม่ตรงกับที่คำนวณจาก Qes และ Qms',
  vas: 'Vas ไม่ตรงกับที่คำนวณจาก Sd และ Cms',
  qes: 'Qes ไม่ตรงกับที่คำนวณจาก Fs, Mms, Re และ Bl',
  fs: 'Fs ไม่ตรงกับที่คำนวณจาก Mms และ Cms'
};

export function warningsFor(d: Design, dto: DriverDto | undefined, res: SimResult, geo: BoxGeometry): Warning[] {
  const out: Warning[] = [];
  if (dto) {
    for (const c of checkConsistency(driverInputFromDto(dto)).filter((x) => !x.ok)) {
      const shown = (v: number) => (c.id === 'vas' ? `${(v * 1000).toFixed(0)} L` : c.id === 'fs' ? `${v.toFixed(1)} Hz` : v.toFixed(2));
      out.push({ level: 'warn', text: `สเปกลำโพงขัดกันเอง: ${CHECK_TEXT[c.id]} (ให้มา ${shown(c.stored)} · คำนวณได้ ${shown(c.computed)}) ตรวจ datasheet ก่อนเชื่อผล` });
    }
  }
  const m = res.metrics;
  const xmax = dto?.xmaxMm ?? null;
  const pe = dto?.peW ?? null;
  const perDriver = d.watts / (d.boxType === 'isobaric' ? 2 : d.count);
  if (pe && perDriver > pe) out.push({ level: 'bad', text: `กำลังต่อดอก ${Math.round(perDriver)} W เกินพิกัด ${pe} W วอยซ์คอยล์จะร้อนจัด` });
  if (m.portVelocityMax.ms > 60) out.push({ level: 'bad', text: `ท่อเล็กเกินไป ลมในท่อ ${m.portVelocityMax.ms.toFixed(0)} m/s เกินช่วงที่สูตรเชิงเส้นใช้ได้ ของจริงลมจะอั้น (port compression) เสียงหายและมีเสียงลมแรง ควรขยายท่อ` });
  else if (m.portVelocityMax.ms > 30) out.push({ level: 'bad', text: `ลมในท่อ ${m.portVelocityMax.ms.toFixed(1)} m/s เกิน 30 m/s เสียงลมจะชัด ควรขยายท่อ` });
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

// ---- suggested box -------------------------------------------------------------------------------

export type SuggestFlag = AlignmentFlag | 'clamped';

export const SUGGEST_FLAG_TEXT: Record<SuggestFlag, string> = {
  'qts-high-for-sealed': 'Qts สูง ตู้ปิดแบบ Qtc 0.707 จะใหญ่มาก จึงใช้ Qtc สูงขึ้น ลำโพงนี้เหมาะกับตู้ใหญ่หรือติดผนัง (free-air)',
  'qts-high-for-vented': 'Qts เกิน 0.5 อยู่นอกช่วงที่สูตรตู้เปิดใช้ได้ดี ช่วงทุ้มอาจโป่ง',
  'qts-low-for-vented': 'Qts ต่ำมาก ตู้เปิดจะเล็กและจูนสูง เบสน้อย ลองตู้ BP6',
  'port-velocity': 'ท่อที่ลมไม่เกิน 17 m/s ยาวเกินกว่าจะพับใส่ตู้นี้ได้ จึงใช้ท่อกว้างที่สุดที่ยังใส่ได้ ถ้าลมยังแรงไป ลดกำลังขับ ขยายตู้ หรือเปลี่ยนเป็น PR',
  clamped: 'บางค่าเกินช่วงของแถบเลื่อน จึงถูกตัดให้อยู่ในช่วง'
};

const RECIPE_TH: Record<AlignmentRecipe, string> = {
  butterworth: 'Butterworth',
  qb3: 'QB3 ของ Keele',
  'qb3-pr': 'QB3 ของ Keele + PR 2 ตัว',
  'geddes-bp4': 'แบนด์พาส Geddes S = 0.7',
  'qb3-bp6': 'ห้องหลัง QB3 + ห้องหน้าจูนสูงขึ้นหนึ่งอ็อกเทฟ'
};

/**
 * Longest port the box can hold folded once (an L along the floor and up the back), using the
 * same proportions sizeBox lays the box out with (W:H:D = 1.25 : 1 : 0.8).
 */
function portRoom(netLitres: number): number {
  const hi = Math.cbrt((netLitres / 1000) * 1.15);
  return Math.max(0.1, 1.8 * hi - 0.08);
}

/** Range of every slider the suggestion writes to; RightPanel uses the same table. */
export const RANGES = {
  vbL: [2, 300], fbHz: [15, 90], portAreaCm2: [5, 1500], vfL: [2, 200], fb2Hz: [30, 150], port2AreaCm2: [5, 1500],
  prSdCm2: [30, 2000], prMassG: [5, 2000], watts: [1, 5000]
} as const satisfies Partial<Record<keyof Design, readonly [number, number]>>;

/** A textbook starting box for the selected driver and box type, as a patch of UI values. */
export function suggestDesign(d: Design, driver: Driver, dto: DriverDto | undefined, damping: DampingMaterialDto[]): { patch: Partial<Design>; name: string; flags: SuggestFlag[] } {
  const n = d.boxType === 'isobaric' ? 2 : d.count;
  const flags: SuggestFlag[] = [];
  const fit = (key: keyof typeof RANGES, v: number, step: number) => {
    const [lo, hi] = RANGES[key];
    const r = Math.round(v / step) * step;
    if (r < lo || r > hi) flags.push('clamped');
    return clamp(r, lo, hi);
  };
  const watts = dto?.peW ? fit('watts', dto.peW * n, 1) : d.watts;
  const withFill = d.boxType === 'sealed' || d.boxType === 'vented' || d.boxType === 'pr';
  const base = { driver, count: d.count, wiring: d.wiring, watts, highpass: d.subsonic ? { fc: d.subsonicHz, order: 4 as const } : undefined, fill: withFill ? fillFor(d, damping) : undefined };
  // First pass sizes the box; the second limits the port to what that box can hold.
  const first = suggestAlignment({ ...base, type: d.boxType });
  const fb = first.box;
  const litres = 1000 * (fb.type === 'bp4' || fb.type === 'bp6' ? fb.vr + fb.vf : 'vb' in fb ? fb.vb : 0);
  const a = suggestAlignment({ ...base, type: d.boxType, maxPortLength: Math.min(1.2, portRoom(litres)) });
  flags.unshift(...a.flags);
  const b = a.box;
  const patch: Partial<Design> = { watts };
  switch (b.type) {
    case 'sealed':
    case 'isobaric':
      patch.vbL = fit('vbL', b.vb * 1000, 1);
      break;
    case 'vented':
      Object.assign(patch, { vbL: fit('vbL', b.vb * 1000, 1), fbHz: fit('fbHz', b.fb, 0.5), portAreaCm2: fit('portAreaCm2', b.port.area * 1e4, 5) });
      break;
    case 'pr':
      Object.assign(patch, {
        vbL: fit('vbL', b.vb * 1000, 1), prSdCm2: fit('prSdCm2', b.pr.sd * 1e4, 5), prMassG: fit('prMassG', b.pr.mmp * 1000, 5),
        prCmsMmN: b.pr.cmp * 1000, prCount: b.pr.count ?? 1
      });
      break;
    case 'bp4':
      Object.assign(patch, { vbL: fit('vbL', b.vr * 1000, 1), vfL: fit('vfL', b.vf * 1000, 1), fbHz: fit('fbHz', b.fb, 0.5), portAreaCm2: fit('portAreaCm2', b.port.area * 1e4, 5) });
      break;
    case 'bp6':
      Object.assign(patch, {
        vbL: fit('vbL', b.vr * 1000, 1), fbHz: fit('fbHz', b.fbr, 0.5), portAreaCm2: fit('portAreaCm2', b.portR.area * 1e4, 5),
        vfL: fit('vfL', b.vf * 1000, 1), fb2Hz: fit('fb2Hz', b.fbf, 0.5), port2AreaCm2: fit('port2AreaCm2', b.portF.area * 1e4, 5)
      });
      break;
  }
  return { patch, name: RECIPE_TH[a.recipe] + (a.qtc ? ` (Qtc ${a.qtc.toFixed(2)})` : ''), flags: [...new Set(flags)] };
}

export { simulate, solveAt, type Solution };
