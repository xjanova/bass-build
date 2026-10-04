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

/**
 * Constrained-layer damping sheets: thickness as sold, and how much loss factor they add per unit
 * of sheet-to-panel thickness ratio. A thin sheet on a thick wall adds little (≈0.01–0.03 on 18 mm MDF).
 */
const CLD: Record<string, { thicknessMm: number; etaPerRatio: number }> = {
  butyl_cld: { thicknessMm: 2, etaPerRatio: 0.15 },
  bitumen_cld: { thicknessMm: 3, etaPerRatio: 0.1 }
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
  const eta = eta0 + Math.min(0.08, sheet.etaPerRatio * (sheet.thicknessMm / d.thicknessMm));
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
  /** Share of the inside depth taken by a band-pass rear chamber (by volume); 0 otherwise. */
  rearFraction: number;
  /** Inside depth the front port can run in: the whole box, or a band-pass front chamber. */
  frontDepth: number;
  /** Round port of a 6th-order band-pass rear chamber, out through the back panel. */
  rearPort: { y: number; radius: number; length: number; room: number; fits: boolean } | null;
  /** Driver centre height above the box bottom, m. */
  driverY: number;
  driverRadius: number;
  cutoutRadius: number;
  /** Outer (frame) radius of a passive radiator, from its Sd. */
  prRadius: number;
  /** Passive radiators in the front row (0 or 1) and on each side panel (pairs face apart). */
  prLayout: { front: number; perSide: number };
  /**
   * Litres of inside space the box needs beyond the requested volume because the drivers, ports
   * or magnets do not fit otherwise (0 when they fit). The extra must be filled with blocks.
   */
  oversizeL: number;
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
  const net = L(d.vbL) + (d.boxType === 'bp4' || d.boxType === 'bp6' ? L(d.vfL) : 0);
  const bandpassBox = d.boxType === 'bp4' || d.boxType === 'bp6';
  // Boards inside the box take volume too: band-pass divider, isobaric mounting baffle.
  const innerBoards = bandpassBox || d.boxType === 'isobaric' ? 1 : 0;

  // What has to fit inside: a row of drivers / passive radiators across the baffle (or on a
  // band-pass divider), their height plus the slot, and the magnet depth (two in an isobaric pair).
  const bandpassType = d.boxType === 'bp4' || d.boxType === 'bp6';
  const prRadius = Math.sqrt((d.prSdCm2 * 1e-4) / Math.PI) / 0.82;
  // Pairs of passive radiators go on the side panels facing apart (their pushes cancel, as in
  // most commercial PR subwoofers); an odd one sits in the front row next to the drivers.
  const prs = d.boxType === 'pr' ? d.prCount : 0;
  const prLayout = { front: prs % 2, perSide: Math.floor(prs / 2) };
  const rowDiameters = [
    ...Array(bandpassType ? d.count : d.boxType === 'isobaric' ? 1 : d.count).fill(outer),
    ...Array(prLayout.front).fill(2 * prRadius)
  ];
  const needW = rowDiameters.reduce((a, b) => a + b, 0) + 0.03 * Math.max(0, rowDiameters.length - 1) + 0.04;
  const tallest = Math.max(outer, prs ? 2 * prRadius : 0);
  const rf = bandpassType ? d.vbL / (d.vbL + d.vfL) : 1;
  // A centimetre more than the magnet clearance check below asks for, so the two never disagree.
  const needD = Math.max(
    bandpassType ? (depth + 0.03 + t) / rf : d.boxType === 'isobaric' ? 2 * depth + 0.06 : depth + 0.03,
    prLayout.perSide ? prLayout.perSide * 2 * prRadius + 0.03 * (prLayout.perSide - 1) + 0.04 : 0
  );
  // An isobaric pair needs a tunnel the size of one driver around the inner unit, on top of Vb.
  const tunnel = d.boxType === 'isobaric' ? (outer + 0.04) * (outer + 0.04) * (depth + 0.03) : 0;

  // Two passes: the slot's wall board volume (width × thickness × length) needs the width first.
  let hi = 0, wi = 0, di = 0, oversizeL = 0;
  for (let pass = 0, width = 0; pass < 2; pass++) {
    const portVol = (res?.info.ports ?? []).reduce((s, p) => {
      const len = Math.min(1.5, Math.max(0, p.physicalLength));
      // A slot along the floor has one board wall; a round tube about a tenth extra.
      const wall = p === front && width > 0 ? width * t * len : p.area * len * 0.1;
      return s + p.area * p.count * len + wall;
    }, 0);
    const gross = net + tunnel + drivers * L(dto?.displacementL ?? 3) + portVol + innerBoards * (width || 1.25 * Math.cbrt(net)) * Math.cbrt(net) * t + 0.001;
    // Start from W:H:D = 1.25 : 1 : 0.8, then raise any side below its minimum and share the
    // rest of the volume among the sides that are still free.
    const k = Math.cbrt(gross / (1.25 * 0.8));
    const dims = [1.25 * k, k, 0.8 * k];
    const fixed = [false, false, false];
    for (let it = 0; it < 4; it++) {
      const slot = front ? front.area / dims[0] : 0;
      const mins = [needW, tallest + 0.03 + (front ? slot + t : 0), needD];
      let changed = false;
      dims.forEach((v, j) => { if (!fixed[j] && v < mins[j]) { dims[j] = mins[j]; fixed[j] = true; changed = true; } });
      if (!changed) break;
      const free = [0, 1, 2].filter((j) => !fixed[j]);
      if (!free.length) break;
      const s = Math.pow(gross / (dims[0] * dims[1] * dims[2]), 1 / free.length);
      free.forEach((j) => { dims[j] *= s; });
    }
    [wi, hi, di] = dims;
    oversizeL = Math.max(0, (wi * hi * di - gross) * 1000);
    width = wi;
  }
  const slotH = front ? front.area / wi : 0;
  const usableBottom = t + (front ? slotH + t : 0);
  const driverY = usableBottom + (hi + t - usableBottom) / 2;
  const fits = hi - (front ? slotH + t : 0) >= outer + 0.01;
  const bandpass = d.boxType === 'bp4' || d.boxType === 'bp6';
  // The divider sits where it splits the inside by the two net volumes.
  const rearFraction = bandpass ? d.vbL / (d.vbL + d.vfL) : 0;
  // The divider board itself sits on the rear-chamber side.
  const frontDepth = bandpass ? di * (1 - rearFraction) : di;
  // Where the magnet must fit: behind the baffle, in a band-pass rear chamber, or behind a clamped pair.
  const magnetClear = bandpass
    ? di * rearFraction - t - depth >= 0.02
    : d.boxType === 'isobaric'
      ? di - 2 * depth - 0.03 >= 0.02
      : di - depth - (front && portLen > di - slotH - 0.03 ? slotH + t : 0) >= 0.02;
  const portFold: BoxGeometry['portFold'] = !front ? 'none' : portLen <= 0 ? 'impossible' : portLen <= frontDepth - 0.03 ? 'straight' : portLen <= frontDepth + hi - 0.06 ? 'L' : 'impossible';
  const rp = d.boxType === 'bp6' ? res?.info.ports.find((p) => p.label === 'rear port') : undefined;
  const rearPort: BoxGeometry['rearPort'] = rp ? (() => {
    const radius = Math.sqrt(rp.area / Math.PI);
    const room = di * rearFraction - t - 0.03;
    const length = rp.physicalLength;
    return { y: t + radius + 0.02, radius, length, room, fits: length > 0 && length <= room + hi - 2 * radius - 0.06 };
  })() : null;
  const wx = wi + 2 * t, hx = hi + 2 * t, dx = di + 2 * t;
  // Outside panels, the slot board, bracing (about half a panel) and any divider / inner baffle.
  const panelAreaM2 = 2 * wx * dx + 2 * wx * hi + 2 * di * hi + (front ? wi * Math.min(1.5, portLen) : 0) + 0.5 * wi * hi + innerBoards * wi * hi;
  const density = material?.densityKgM3 ?? 750;
  return {
    wx, hx, dx, wi, hi, di, t, slotH, portLength: portLen, portFold, rearFraction, frontDepth, rearPort, driverY,
    driverRadius: outer / 2, cutoutRadius: (dto?.cutoutMm ?? outer * 900) / 2000, prRadius, prLayout, oversizeL,
    fits, magnetClear, panelAreaM2,
    // Damping sheets go on the walls, not the baffle (about a fifth of the panel area).
    weightKg: panelAreaM2 * t * density + panelAreaM2 * 0.8 * sheetKgM2,
    sheets: Math.max(1, Math.ceil((panelAreaM2 * 1.2) / (1.22 * 2.44)))
  };
}

// ---- thermal (voice coil / magnet) -------------------------------------------------------------

/**
 * Two-node thermal estimate with the coil sitting on the magnet: the magnet warms slowly
 * (τ ≈ 20 min) and the coil rises above it quickly (τ ≈ 20 s). The total thermal resistance
 * defaults to "≈110 K coil rise at rated power" (70 % coil-to-magnet, 30 % magnet-to-air) when
 * the datasheet is silent.
 */
export function thermalAt(watts: number, peW: number | null | undefined, seconds: number): { tvc: number; tmag: number; reRise: number } {
  const pe = peW && peW > 0 ? peW : 300;
  const rTotal = 110 / pe;
  const tmag = 25 + watts * 0.3 * rTotal * (1 - Math.exp(-seconds / 1200));
  const tvc = tmag + watts * 0.7 * rTotal * (1 - Math.exp(-seconds / 20));
  return { tvc, tmag, reRise: 1 + 0.00393 * (tvc - 25) };
}

/**
 * Lowest bending mode (1,1) of the side panel (the one drawn in the vibration view) and of the
 * back panel (the largest unbroken one, so the lowest), simply supported Kirchhoff plates —
 * conservative: clamped edges would sit about 1.8× higher.
 */
export function panelModes(geo: BoxGeometry, material: PanelMaterialDto | undefined, f11Factor = 1): { side: number; back: number } {
  const e = (material?.eGpa ?? 3.5) * 1e9;
  const rho = material?.densityKgM3 ?? 750;
  const nu = material?.poisson ?? 0.25;
  const h = geo.t;
  const bend = (e * h * h * h) / (12 * (1 - nu * nu));
  const f11 = (a: number, b: number) => (Math.PI / 2) * Math.sqrt(bend / (rho * h)) * (1 / (a * a) + 1 / (b * b)) * f11Factor;
  return { side: f11(geo.di, geo.hi), back: f11(geo.wi, geo.hi) };
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
  if (geo.rearPort && !geo.rearPort.fits) out.push({ level: 'bad', text: geo.rearPort.length <= 0 ? 'ท่อหลังเล็กเกินไปสำหรับความถี่จูนนี้ ท่อสั้นจนติดลบ' : `ท่อหลังยาว ${(geo.rearPort.length * 100).toFixed(0)} ซม. ใส่ห้องหลังไม่ได้ ลดพื้นที่ท่อหลังหรือเพิ่มความถี่จูนท่อหลัง` });
  if (geo.oversizeL > 0.5) out.push({ level: 'bad', text: `ตู้ ${d.vbL} L เล็กเกินกว่าจะใส่ลำโพง ท่อ และแม่เหล็กได้ ตัวตู้ต้องโตขึ้นอีก ${geo.oversizeL.toFixed(0)} L แล้วเสริมไม้กินที่ให้เหลือปริมาตรเท่าที่ตั้ง หรือเพิ่มปริมาตร` });
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
 * Longest ports the box can hold folded once (an L along the floor and up the wall), using the
 * same proportions sizeBox starts from (W:H:D = 1.25 : 1 : 0.8). In a band-pass the front port
 * only has the front chamber's depth and the rear port only the rear chamber's.
 */
function portRoom(netLitres: number, rearFraction: number): { front: number; rear: number } {
  const hi = Math.cbrt((netLitres / 1000) * 1.15);
  const di = 0.8 * hi;
  return {
    front: Math.max(0.1, 0.9 * (di * (1 - rearFraction) + hi) - 0.08),
    rear: Math.max(0.1, 0.9 * (di * rearFraction + hi) - 0.15)
  };
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
  const bp = fb.type === 'bp4' || fb.type === 'bp6';
  const litres = 1000 * (bp ? fb.vr + fb.vf : 'vb' in fb ? fb.vb : 0);
  const room = portRoom(litres, bp ? fb.vr / (fb.vr + fb.vf) : 0);
  const a = suggestAlignment({ ...base, type: d.boxType, maxPortLength: Math.min(1.2, room.front), maxRearPortLength: Math.min(1.2, room.rear) });
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
