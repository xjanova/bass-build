import {
  buildNetwork, checkConsistency, completeDriver, driverInputFromDto, DriverError, maxOutput, rewireCoils, simulate, solveAt, suggestAlignment,
  type AlignmentFlag, type AlignmentRecipe, type AlignmentRequest, type BoxDesign, type CoilWiring, type Driver, type FillSpec,
  type BuildInfo, type MaxOutput, type OutputLimits, type SimResult, type Solution, type SystemSpec
} from '@bassbuild/physics';
import type { SlotSummary } from '../data/compare';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../data/types';
import type { BoxShape, BraceKind, Design, DimRef } from '../state/store';
import { braceBar, braceCountOf, bracePlan, braceSpan, BRACE_WINDOW_MIN, DOWEL_D, dowelRows, freeSpan, NO_BRACES, rowProblem, sidePrBars, type BracePlan } from './layout';
import { tubeOf } from '../data/hardware';

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

/** The setting that holds the front port's total area (a 6th-order band-pass's front port is its second). */
export const frontAreaKey = (d: Pick<Design, 'boxType'>): 'portAreaCm2' | 'port2AreaCm2' => (d.boxType === 'bp6' ? 'port2AreaCm2' : 'portAreaCm2');

/** Most round tubes a front port is made of. */
export const MAX_TUBES = 8;
/** Wood kept below and above the row of tube holes at the bottom of the baffle, m. */
export const TUBE_EDGE = 0.015;

/**
 * Round tubes making the front port, or null for a slot (or a box without a front port). The
 * count is the front port area divided by one tube's bore, rounded, so every existing setting,
 * suggestion and limit on the area keeps working.
 */
export function roundTubes(d: Pick<Design, 'boxType' | 'portStyle' | 'tubeKey' | 'tubeIdMm' | 'portAreaCm2' | 'port2AreaCm2'>): { count: number; id: number; od: number; area: number } | null {
  if (d.portStyle !== 'round' || !(d.boxType === 'vented' || d.boxType === 'bp4' || d.boxType === 'bp6')) return null;
  const id = Math.max(0.01, d.tubeIdMm / 1000);
  const od = Math.max(id + 0.002, (tubeOf(d.tubeKey)?.odMm ?? d.tubeIdMm + 8) / 1000);
  const area = Math.PI * (id / 2) ** 2;
  const count = Math.min(MAX_TUBES, Math.max(1, Math.round(cm2(d[frontAreaKey(d)]) / area)));
  return { count, id, od, area };
}

export function toBox(d: Design, fill: FillSpec = { stuffing: d.stuffing }): BoxDesign {
  const tubes = roundTubes(d);
  // Area of one front port and how many there are.
  const frontPort = (areaCm2: number) => (tubes ? { area: tubes.area, count: tubes.count } : { area: cm2(areaCm2) });
  switch (d.boxType) {
    case 'sealed': return { type: 'sealed', vb: L(d.vbL), ql: d.ql, ...fill };
    case 'vented': return { type: 'vented', vb: L(d.vbL), fb: d.fbHz, port: frontPort(d.portAreaCm2), ql: d.ql, ...fill };
    case 'pr': return {
      type: 'pr', vb: L(d.vbL), ql: d.ql, ...fill,
      pr: { sd: cm2(d.prSdCm2), mmp: d.prMassG / 1000, cmp: d.prCmsMmN / 1000, qmp: 10, count: d.prCount }
    };
    case 'bp4': return { type: 'bp4', vr: L(d.vbL), vf: L(d.vfL), fb: d.fbHz, port: frontPort(d.portAreaCm2), ql: d.ql };
    case 'bp6': return {
      type: 'bp6', vr: L(d.vbL), fbr: d.fbHz, portR: { area: cm2(d.portAreaCm2) },
      vf: L(d.vfL), fbf: d.fb2Hz, portF: frontPort(d.port2AreaCm2), ql: d.ql
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
    drive: { watts: d.watts, seriesOhms: seriesOhms(d) },
    highpass: d.subsonic ? { fc: d.subsonicHz, order: 4 } : undefined
  };
}

export type DriverResult = { ok: true; driver: Driver } | { ok: false; missing: string[] };

export const isDvc = (dto: DriverDto | undefined) => dto?.coil === 'DVC';

/**
 * Coil wiring a dual-voice-coil driver's T/S refer to. Datasheets that do not say are guessed
 * from the nominal impedance (dual 4 Ω subs quoting 8 Ω are in series, 2 Ω in parallel), and the
 * UI marks that guess as an estimate.
 */
export function measuredWiring(dto: DriverDto): { wiring: 'series' | 'parallel'; known: boolean } {
  if (dto.coilWiring === 'series' || dto.coilWiring === 'parallel') return { wiring: dto.coilWiring, known: true };
  const z = dto.zNom ?? (dto.re ? dto.re * 1.15 : 4);
  return { wiring: z >= 4 ? 'series' : 'parallel', known: false };
}

/** The driver as the physics needs it; a DVC driver is re-expressed for the coil wiring chosen. */
export function driverFromDto(dto: DriverDto | undefined, coilWiring?: CoilWiring): DriverResult {
  if (!dto) return { ok: false, missing: ['driver'] };
  try {
    const base = completeDriver(driverInputFromDto(dto));
    if (!coilWiring || !isDvc(dto)) return { ok: true, driver: base };
    return { ok: true, driver: rewireCoils(base, measuredWiring(dto).wiring, coilWiring) };
  } catch (e) {
    if (e instanceof DriverError) return { ok: false, missing: e.missing };
    throw e;
  }
}

/** Pe of one driver as wired: with one coil of a DVC left open only half the coil does the work. */
export const ratedWatts = (dto: DriverDto | undefined, d: Pick<Design, 'coilWiring'>): number | null =>
  dto?.peW ? (isDvc(dto) && d.coilWiring === 'single' ? dto.peW / 2 : dto.peW) : null;

// ---- amplifier and speaker cable --------------------------------------------------------------------

/** American Wire Gauge → copper cross-section, mm². */
export const AWG_MM2: Record<number, number> = { 18: 0.823, 16: 1.31, 14: 2.08, 12: 3.31, 10: 5.26, 8: 8.37, 6: 13.3, 4: 21.2, 2: 33.6, 0: 53.5 };
/** Annealed copper at 20 °C, Ω·m (IEC 60028). */
export const COPPER_RHO = 1.7241e-8;

/** Both conductors of the cable (out and back), Ω. */
export const wireOhms = (d: Pick<Design, 'wireM' | 'wireAwg'>): number =>
  d.wireM > 0 ? (2 * d.wireM * COPPER_RHO) / ((AWG_MM2[d.wireAwg] ?? 3.31) * 1e-6) : 0;

/** Amplifier output impedance from its damping factor, Ω (0 for an ideal source). */
export const ampOutputOhms = (d: Pick<Design, 'amp' | 'ampOhms' | 'dampingFactor'>): number =>
  d.amp && d.dampingFactor > 0 ? d.ampOhms / d.dampingFactor : 0;

export const seriesOhms = (d: Design): number => ampOutputOhms(d) + wireOhms(d);

/**
 * A simple amplifier: it clips at the voltage that gives its rated power into the rated load,
 * and it can supply that voltage into loads down to its minimum rated load — so the current limit
 * is Vclip / Rmin (ideal power doubling down to Rmin).
 */
export function ampLimits(d: Pick<Design, 'amp' | 'ampW' | 'ampOhms' | 'ampMinOhms'>): { volts: number; amps: number } | null {
  if (!d.amp || d.ampW <= 0 || d.ampOhms <= 0) return null;
  const volts = Math.sqrt(d.ampW * d.ampOhms);
  return { volts, amps: volts / Math.max(0.1, Math.min(d.ampMinOhms, d.ampOhms)) };
}

/** Peak port air speed the "loudest it can play" graph allows: past 30 m/s the port chuffs and compresses. */
export const MAX_PORT_MS = 30;

/** Every known limit on how loud the design can play. */
export function outputLimitsFor(d: Design, dto: DriverDto | undefined, res: SimResult): OutputLimits {
  const n = d.boxType === 'isobaric' ? 2 : d.count;
  const pe = ratedWatts(dto, d);
  const amp = ampLimits(d);
  return {
    xmaxMm: dto?.xmaxMm ?? null,
    portMs: res.info.ports.length ? MAX_PORT_MS : null,
    thermalVolts: pe ? Math.sqrt(pe * n * res.info.nominalOhms) : null,
    ampVolts: amp?.volts ?? null,
    ampAmps: amp?.amps ?? null
  };
}

export const maxOutputFor = (d: Design, dto: DriverDto | undefined, res: SimResult): MaxOutput => maxOutput(res, outputLimitsFor(d, dto, res));

// ---- enclosure sizing ---------------------------------------------------------------------

/**
 * Mounting size of the driver, m (displacement in L). Datasheets often leave some out; those are
 * estimated from the nominal size with the medians of the datasheet set (outer ≈ 1.02 × the
 * nominal inches, depth ≈ 0.46 × outer, cutout ≈ 0.9 × outer, displacement ≈ 2.5 L × (size/12")³)
 * and listed in `estimated` so the UI can say so.
 */
export function mountOf(dto: DriverDto | undefined): { outer: number; depth: number; cutout: number; displacementL: number; estimated: string[] } {
  const estimated: string[] = [];
  const fromSd = dto?.sdCm2 ? (2 * Math.sqrt((dto.sdCm2 * 1e-4) / Math.PI)) / 0.82 : null;
  let outer = dto?.outerMm ? dto.outerMm / 1000 : null;
  if (!outer) { outer = dto?.sizeIn ? dto.sizeIn * 0.0254 * 1.02 : fromSd ?? 0.39; estimated.push('ขอบนอก'); }
  let depth = dto?.depthMm ? dto.depthMm / 1000 : null;
  if (!depth) { depth = outer * 0.46; estimated.push('ความลึก'); }
  let cutout = dto?.cutoutMm ? dto.cutoutMm / 1000 : null;
  if (!cutout) { cutout = outer * 0.9; estimated.push('รูเจาะ'); }
  let displacementL = dto?.displacementL ?? null;
  if (!displacementL) { displacementL = 2.5 * (outer / (12 * 0.0254 * 1.02)) ** 3; estimated.push('ปริมาตรแทนที่'); }
  return { outer, depth, cutout, displacementL, estimated };
}

/** Free air a port's open inner end needs before a wall: about one slot height (one diameter for a tube), at least 3 cm. */
export const portEndGap = (size: number) => Math.max(0.03, size);

/**
 * Longest slot port a chamber `depth` deep and `hi` tall can hold, measured on the centreline:
 * straight along the floor, or folded once up the back wall (the riser is as thick as the slot).
 */
export function slotPortRoom(depth: number, hi: number, slotH: number): { straight: number; folded: number } {
  const gap = portEndGap(slotH);
  return { straight: depth - gap, folded: depth + hi - slotH - gap };
}

/** Where the inside of the shell goes, L: the net air the design asks for plus everything else in the box. */
export interface VolumeBreakdown {
  /** Inside of the shell (between the panels). */
  shellL: number;
  /** Drivers' own displacement (basket and magnet). */
  driversL: number;
  /** Air inside the ports plus the boards that make them. */
  portsL: number;
  /** Band-pass divider or isobaric mounting baffle. */
  boardsL: number;
  /** Braces (window frames or dowels). */
  bracesL: number;
  /** Tunnel around the inner driver of an isobaric pair. */
  tunnelL: number;
  /** Space beyond what the design needs, to be filled with blocks (or added to the volume). */
  extraL: number;
  /** Net air the physics uses (Vb, plus Vf for a band-pass). */
  netL: number;
}

/** Outside dimension a rule applies to: 0 = width, 1 = height, 2 = depth (at the floor for a wedge). */
export type DimAxis = 0 | 1 | 2;

export interface BoxGeometry {
  /** External and internal dimensions, m. W = width (x), H = height (y), D = depth (z). */
  wx: number; hx: number; dx: number;
  wi: number; hi: number; di: number;
  t: number;
  /** Outline actually laid out ('wedge' only for sealed and vented boxes). */
  shape: BoxShape;
  /** Depth at the top, outside and inside (equal to dx / di for a plain box). dx and di are at the floor. */
  dxTop: number;
  diTop: number;
  /** Back panel lean from vertical, rad (0 for a plain box). */
  backAngle: number;
  /** Slot port along the bottom of the front baffle (0 when there is no slot). */
  slotH: number;
  /** Round tubes through the bottom of the baffle instead of a slot: bore, outside size, centre height and x of each, m. */
  tubes: { count: number; id: number; od: number; y: number; xs: number[] } | null;
  portLength: number;
  /** 'short': the port would be shorter than the baffle is thick, so this tuning cannot be reached. */
  portFold: 'none' | 'straight' | 'L' | 'impossible' | 'short';
  /** Longest front port this box can hold (folded once), m. */
  portMaxLength: number;
  /** Share of the inside depth taken by a band-pass rear chamber (by volume); 0 otherwise. */
  rearFraction: number;
  /** Inside depth the front port can run in: the whole box, or a band-pass front chamber. */
  frontDepth: number;
  /** Round port of a 6th-order band-pass rear chamber, out through the back panel. */
  rearPort: { y: number; radius: number; length: number; room: number; maxLength: number; fits: boolean } | null;
  /** Driver centre height above the box bottom, m (set by hand, or centred on the baffle). */
  driverY: number;
  /** Front row centre offset from the box centre line, m (0 unless placed by hand). */
  rowX: number;
  /** Where the layout would centre the front row: height above the box bottom, m. */
  autoDriverY: number;
  driverRadius: number;
  cutoutRadius: number;
  /** Mounting depth of one driver (frame face to the back of the magnet), m: datasheet or estimate (see mountOf). */
  driverDepth: number;
  /** Bracing as laid out along the depth (positions, what holds each panel). */
  braces: BracePlan;
  /** Outer (frame) radius of a passive radiator, from its Sd. */
  prRadius: number;
  /** Passive radiators in the front row (0 or 1) and on each side panel (pairs face apart). */
  prLayout: { front: number; perSide: number };
  /**
   * Litres of inside space the box needs beyond the requested volume because the drivers, ports
   * or magnets do not fit otherwise (0 when they fit). The extra must be filled with blocks.
   */
  oversizeL: number;
  /** Litres of inside space left over because the sizes set by hand are bigger than the design needs. */
  extraL: number;
  /** Litres the sizes set by hand fall short of what the design needs (0 when it fits). */
  shortL: number;
  /**
   * A side whose contents need more than the size set (or allowed) for it, m, both measured the
   * way the sizes were entered (`ref`: outside, or inside; a wedge's depth at the floor).
   */
  dimConflict: { axis: DimAxis; need: number; limit: number; ref: DimRef } | null;
  /** Largest net volume the sizes set by hand can hold, L (null while any side is free). */
  capacityL: number | null;
  volume: VolumeBreakdown;
  fits: boolean;
  magnetClear: boolean;
  panelAreaM2: number;
  /** Outside volume, L. */
  outerL: number;
  weightKg: number;
  sheets: number;
}

/** The outline a design gets: a wedge only where its contents are simple enough (sealed, vented). */
export const shapeFor = (d: Pick<Design, 'shape' | 'boxType'>): BoxShape =>
  d.shape === 'wedge' && (d.boxType === 'sealed' || d.boxType === 'vented') ? 'wedge' : 'box';

/** What each kind of bracing is called in the volume breakdown, the 3D tree and the blueprint. */
export const BRACE_TH: Record<BraceKind, string> = { none: 'ไม่มีโครงค้ำ', window: 'โครงค้ำแบบหน้าต่าง', dowel: 'เดือยค้ำ (ไม้กลม)' };
/** A window plane built as two cross bars (beside side passive radiators). */
export const BRACE_BARS_TH = 'คานค้ำ (บน-ล่าง)';

/**
 * Air the bracing takes, m³, for planes `span` high (see `braceSpan`: the slot or tube band below
 * the braces is left out, as the layout does): a window frame is two bars across and two up (5 cm
 * wide, narrower in a small box, see `braceBar`), one panel thick, or only the two bars across
 * when side passive radiators leave no room for side bars; a dowel plane is its row of round
 * dowels across the inside width, counted by the same rule as the layout.
 */
export function braceVolume(kind: BraceKind, n: number, wi: number, span: number, t: number, barsOnly = false): number {
  if (kind === 'none') return 0;
  const planes = braceCountOf(n);
  if (kind === 'dowel') return planes * dowelRows(span) * Math.PI * (DOWEL_D / 2) ** 2 * wi;
  const bar = braceBar(wi, span);
  // No frame fits (a build problem): nothing is glued in.
  if (bar === null) return 0;
  return planes * (2 * wi + (barsOnly ? 0 : 2 * Math.max(0, span - 2 * bar))) * bar * t;
}
/** Density assumed for dowel wood (a medium hardwood), kg/m³: an estimate, only used for the box weight. */
const DOWEL_KG_M3 = 650;

/**
 * Wedge profile from its inside floor depth `b`, inside height `h` and top/floor ratio `r`:
 * the back panel leans forward, and its thickness measured level is t / cos(lean).
 */
function wedgeOutline(b: number, h: number, r: number, t: number) {
  const run = b * (1 - r);
  const slope = run / h;
  const cos = h / Math.hypot(h, run);
  return {
    top: r * b,
    angle: Math.atan2(run, h),
    /** Outside depth at the floor and at the top. */
    outerFloor: t + b + slope * t + t / cos,
    outerTop: t + r * b - slope * t + t / cos
  };
}

/** Inside floor depth of a wedge whose outside floor depth is `outer` (the lean depends on it, so iterate). */
function wedgeFloorFor(outer: number, h: number, r: number, t: number): number {
  let b = outer - 2 * t;
  for (let i = 0; i < 8; i++) b -= (wedgeOutline(b, h, r, t).outerFloor - outer) / (1 + (1 - r) * t / h);
  return Math.max(0.01, b);
}

/** Top depth over floor depth, inside, as sizeBox uses it (a plain box is a wedge with r = 1). */
const wedgeRatio = (d: Pick<Design, 'shape' | 'boxType' | 'wedgeTopPct'>) => (shapeFor(d) === 'wedge' ? clamp(d.wedgeTopPct / 100, 0.2, 1) : 1);

/**
 * One side's size, m, re-measured from outside to inside or back (`hi`: the inside height, which
 * a wedge's lean needs). Widths and heights differ by two panels; a wedge's floor depth by the
 * baffle plus the leaning back measured level at the floor.
 */
export function convertSide(axis: DimAxis, v: number, from: DimRef, to: DimRef, t: number, wedgeR: number, hi: number): number {
  if (from === to) return v;
  if (axis < 2 || wedgeR >= 1) return to === 'inner' ? v - 2 * t : v + 2 * t;
  return to === 'inner' ? wedgeFloorFor(v, hi, wedgeR, t) : wedgeOutline(v, hi, wedgeR, t).outerFloor;
}

/** The laid-out box measured the way the sizes are entered: [width, height, floor depth], m. */
export const sidesIn = (geo: BoxGeometry, ref: DimRef): [number, number, number] =>
  ref === 'inner' ? [geo.wi, geo.hi, geo.di] : [geo.wx, geo.hx, geo.dx];

/**
 * The hand-set sizes re-entered the other way (`to`), so the box keeps its size when the user
 * switches between outside and inside numbers. Each number is converted as a number (a "max" limit
 * stays the same limit, not the size the box has now), with the current inside height for a
 * wedge's lean; whole millimetres, as the fields take them.
 */
export function convertDims(d: Design, geo: Pick<BoxGeometry, 'hi'> | null, to: DimRef): Partial<Design> {
  if (d.dimRef === to) return {};
  const t = d.thicknessMm / 1000;
  const r = wedgeRatio(d);
  // Without a laid-out box (no driver yet) the height field is the best guess at the inside height.
  const hi = geo?.hi ?? Math.max(0.05, d.hMm / 1000 - (d.dimRef === 'inner' ? 0 : 2 * t));
  const one = (axis: DimAxis, mm: number) => Math.max(1, Math.round(convertSide(axis, mm / 1000, d.dimRef, to, t, r, hi) * 1000));
  return { dimRef: to, wMm: one(0, d.wMm), hMm: one(1, d.hMm), dMm: one(2, d.dMm) };
}

/** Outside sizes a hand-set side may take, mm. */
export const DIM_RANGE = [80, 3000] as const;
/** Smallest inside number a field takes, mm (a thick panel can leave little of DIM_RANGE's minimum). */
const INNER_FLOOR_MM = 10;

/**
 * The range one hand-set side's field takes, mm, measured `ref`. Inside ranges are DIM_RANGE
 * re-measured through the current panels (and a wedge's lean), so both references cover the
 * very same boxes and a switch never has to squeeze a number into a narrower range.
 */
export function dimRange(d: Design, geo: Pick<BoxGeometry, 'hi'> | null, axis: DimAxis, ref: DimRef): [number, number] {
  if (ref === 'outer') return [DIM_RANGE[0], DIM_RANGE[1]];
  const t = d.thicknessMm / 1000;
  const r = wedgeRatio(d);
  const hi = geo?.hi ?? Math.max(0.05, d.hMm / 1000 - (d.dimRef === 'inner' ? 0 : 2 * t));
  const at = (mm: number) => Math.round(convertSide(axis, mm / 1000, 'outer', 'inner', t, r, hi) * 1000);
  return [Math.max(INNER_FLOOR_MM, at(DIM_RANGE[0])), Math.max(INNER_FLOOR_MM, at(DIM_RANGE[1]))];
}

/**
 * Switching the reference as the shape section does it: the converted numbers, or the hand-set
 * sides (not "auto") whose converted number falls outside the other reference's range. Those are
 * refused rather than clamped, since clamping would quietly resize the box the switch promises
 * to keep. A millimetre over is rounding (the wedge's lean) and is taken back in.
 */
export function switchDims(d: Design, geo: Pick<BoxGeometry, 'hi'> | null, to: DimRef): { patch: Partial<Design>; blocked: DimAxis[] } {
  const p = convertDims(d, geo, to);
  if (!('dimRef' in p)) return { patch: {}, blocked: [] };
  const keys = [['wMode', 'wMm'], ['hMode', 'hMm'], ['dMode', 'dMm']] as const;
  const blocked: DimAxis[] = [];
  const patch: Partial<Design> = { ...p };
  ([0, 1, 2] as const).forEach((axis) => {
    const [mk, vk] = keys[axis];
    const [lo, hi] = dimRange(d, geo, axis, to);
    const v = p[vk] as number;
    const fit = Math.min(hi, Math.max(lo, v));
    // An "auto" side's number is not used (leaving auto starts from the laid-out size), so keep it in range.
    if (d[mk] !== 'auto' && Math.abs(fit - v) > 1) blocked.push(axis);
    patch[vk] = fit;
  });
  return blocked.length ? { patch: {}, blocked } : { patch, blocked };
}

/** Lays the box out around its contents. Only the ports of `res` are used, so a bare network build will do. */
export function sizeBox(d: Design, dto: DriverDto | undefined, res: { info: Pick<BuildInfo, 'ports'> } | null, material: PanelMaterialDto | undefined, sheetKgM2 = 0): BoxGeometry {
  const t = d.thicknessMm / 1000;
  const shape = shapeFor(d);
  const wedge = shape === 'wedge';
  // Older stored designs have no bracing fields: they had one window brace.
  const braceKind: BraceKind = d.braceKind ?? 'window';
  const braceN = braceCountOf(d.braceCount ?? 1);
  // Top depth over floor depth, inside; a plain box is a wedge with r = 1.
  const r = wedge ? clamp(d.wedgeTopPct / 100, 0.2, 1) : 1;
  const drivers = d.boxType === 'isobaric' ? 2 : d.count;
  const mount = mountOf(dto);
  const outer = mount.outer;
  const depth = mount.depth;
  const front = res?.info.ports.find((p) => p.label === 'port' || p.label === 'front port');
  const portLen = front ? Math.max(0, front.physicalLength) : 0;
  const tube = front ? roundTubes(d) : null;
  const slotted = !!front && !tube;
  /** Height the front port takes off the bottom of the baffle: the slot and its ceiling board, or the tube row. */
  const portBand = (width: number) => (tube ? tube.od + 2 * TUBE_EDGE : slotted ? front!.area / width + t : 0);
  const tubeRowW = tube ? tube.count * tube.od + 0.02 * (tube.count - 1) + 0.04 : 0;
  // A band-pass driver fires into the front chamber: leave room for the cone's travel.
  const coneTravel = ((dto?.xmechMm ?? (dto?.xmaxMm ? dto.xmaxMm * 1.5 : 15)) / 1000) + 0.015;
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
  const barsOnly = braceKind === 'window' && sidePrBars(d.boxType, prLayout.perSide);
  const rowDiameters = [
    ...Array(bandpassType ? d.count : d.boxType === 'isobaric' ? 1 : d.count).fill(outer),
    ...Array(prLayout.front).fill(2 * prRadius)
  ];
  const needW = Math.max(rowDiameters.reduce((a, b) => a + b, 0) + 0.03 * Math.max(0, rowDiameters.length - 1) + 0.04, tubeRowW);
  const tallest = Math.max(outer, prs ? 2 * prRadius : 0);
  const rf = bandpassType ? d.vbL / (d.vbL + d.vfL) : 1;
  // A centimetre more than the magnet clearance check below asks for, so the two never disagree.
  const needD = Math.max(
    bandpassType ? Math.max((depth + 0.03 + t) / rf, coneTravel / (1 - rf)) : d.boxType === 'isobaric' ? 2 * depth + 0.06 : depth + 0.03,
    prLayout.perSide ? prLayout.perSide * 2 * prRadius + 0.03 * (prLayout.perSide - 1) + 0.04 : 0
  );
  // An isobaric pair needs a tunnel the size of one driver around the inner unit, on top of Vb.
  const tunnel = d.boxType === 'isobaric' ? (outer + 0.04) * (outer + 0.04) * (depth + 0.03) : 0;

  // Sizes set by hand, m (null = free), measured outside or inside as the user chose.
  const ref: DimRef = d.dimRef === 'inner' ? 'inner' : 'outer';
  const rules = ([[d.wMode, d.wMm], [d.hMode, d.hMm], [d.dMode, d.dMm]] as const).map(([mode, mm]) => (mode === 'auto' ? null : { mode, v: mm / 1000 }));
  // The solver works on inside width, inside height and inside mean depth; a hand-set depth is
  // the floor depth (a wedge is deepest there). Inside sizes hold whatever the panels are, so a
  // thicker panel grows the outside; outside sizes hold, so it shrinks the inside.
  const toInner = (j: DimAxis, v: number, hiNow: number) => {
    const inside = convertSide(j, v, ref, 'inner', t, r, hiNow);
    return j === 2 ? (inside * (1 + r)) / 2 : inside;
  };
  /** An inside size the solver works on, measured the way the rules are. */
  const toRef = (j: DimAxis, v: number, hiNow: number) => convertSide(j, j === 2 ? (2 * v) / (1 + r) : v, 'inner', ref, t, r, hiNow);
  /** Height of the magnet's top edge as a share of the inside height (where a wedge is shallowest for it). */
  const magnetShare = (hiNow: number, band: number) => {
    const bottom = band;
    return Math.min(1, (bottom + (hiNow - bottom) / 2 + outer / 4) / hiNow);
  };

  // Two passes: the slot's wall board volume (width × thickness × length) needs the width first.
  let hi = 0, wi = 0, m = 0, oversizeL = 0, extraL = 0, shortL = 0, capacityL: number | null = null;
  let dimConflict: BoxGeometry['dimConflict'] = null;
  let parts = { drivers: 0, ports: 0, boards: 0, braces: 0 };
  for (let pass = 0, width = 0, height = 0; pass < 2; pass++) {
    const portVol = (res?.info.ports ?? []).reduce((s, p) => {
      const len = Math.min(1.5, Math.max(0, p.physicalLength));
      // A slot along the floor has one board wall; a round tube about a tenth extra.
      const wall = p === front && tube ? ((tube.od ** 2 - tube.id ** 2) * Math.PI / 4) * len * p.count
        : p === front && width > 0 ? width * t * len : p.area * len * 0.1;
      return s + p.area * p.count * len + wall;
    }, 0);
    const guessW = width || 1.25 * Math.cbrt(net);
    const guessH = height || Math.cbrt(net);
    // The braces' height as the layout will measure it: above the slot ceiling or the tube row.
    const span = braceSpan({ t, hi: guessH, slotH: slotted ? front!.area / guessW : 0, tubes: tube ? { y: t + TUBE_EDGE + tube.od / 2, od: tube.od } : null });
    parts = {
      drivers: drivers * L(mount.displacementL),
      ports: portVol,
      boards: innerBoards * guessW * Math.cbrt(net) * t,
      braces: braceVolume(braceKind, braceN, guessW, span, t, barsOnly)
    };
    const gross = net + tunnel + parts.drivers + parts.ports + parts.boards + parts.braces;
    // Start from W:H:D = 1.25 : 1 : 0.8 (sides set by hand at their size), then raise any side
    // below its minimum, hold any side above its limit, and share the rest of the volume among
    // the sides that are still free.
    const k = Math.cbrt(gross / (1.25 * 0.8));
    const dims = [1.25 * k, k, 0.8 * k];
    const held: ('' | 'min' | 'user')[] = ['', '', ''];
    const rescale = () => {
      const free = [0, 1, 2].filter((j) => !held[j]);
      if (!free.length) return;
      const s = Math.pow(gross / (dims[0] * dims[1] * dims[2]), 1 / free.length);
      free.forEach((j) => { dims[j] *= s; });
    };
    rules.forEach((rule, j) => { if (rule?.mode === 'fixed') { dims[j] = Math.max(0.01, toInner(j as DimAxis, rule.v, dims[1])); held[j] = 'user'; } });
    rescale();
    let conflict: BoxGeometry['dimConflict'] = null;
    for (let it = 0; it < 12; it++) {
      const slot = slotted ? front!.area / dims[0] : 0;
      const band = portBand(dims[0]);
      // A slot too long to run straight folds up the back wall and takes that depth from the magnet
      // (round tubes run straight back under the driver).
      const floorDepth = (2 * dims[2]) / (1 + r);
      const fold = slotted && portLen > floorDepth - portEndGap(slot) && !bandpassType && d.boxType !== 'isobaric' ? slot + t : 0;
      // A wedge is shallowest at the top: the magnet needs its depth where its top edge sits.
      const atMagnet = 1 - (1 - r) * magnetShare(dims[1], band);
      const mins = [needW, tallest + 0.03 + band, ((needD + fold) / atMagnet) * ((1 + r) / 2)];
      let changed = false;
      conflict = null;
      dims.forEach((v, j) => {
        const rule = rules[j];
        const cap = rule ? Math.max(0.01, toInner(j as DimAxis, rule.v, dims[1])) : Infinity;
        if (mins[j] > cap + 1e-6) conflict = { axis: j as DimAxis, need: toRef(j as DimAxis, mins[j], dims[1]), limit: rule!.v, ref };
        // A side set by hand follows its size (a wedge's depth limit moves with the height);
        // the contents win when they need more.
        const target = rule?.mode === 'fixed' ? Math.max(cap, mins[j]) : null;
        if (target !== null && Math.abs(v - target) > 1e-6) { dims[j] = target; changed = true; }
        if (target !== null) { held[j] = mins[j] > cap + 1e-6 ? 'min' : 'user'; return; }
        // A side already held at its minimum is raised again if that minimum grew (the slot gets
        // taller when the box gets narrower, and so on).
        if (v < mins[j] - 1e-6) { dims[j] = mins[j]; held[j] = 'min'; changed = true; }
        else if (v > cap + 1e-6) { dims[j] = Math.max(cap, mins[j]); held[j] = 'user'; changed = true; }
      });
      if (!changed) break;
      rescale();
    }
    [wi, hi, m] = dims;
    // The slot height follows the final width; make sure the baffle above it still fits the row.
    const minH = tallest + 0.03 + portBand(wi);
    if (hi < minH) { hi = minH; held[1] = 'min'; }
    const shell = wi * hi * m;
    const surplus = (shell - gross) * 1000;
    // Left-over space is the contents' fault when any side had to grow for them, else the hand-set sizes'.
    oversizeL = surplus > 1e-3 && held.includes('min') ? surplus : 0;
    extraL = surplus > 1e-3 && !held.includes('min') ? surplus : 0;
    // Rounding dust is neither: the same 1 mL floor as the two above.
    shortL = surplus < -1e-3 ? -surplus : 0;
    dimConflict = conflict;
    capacityL = rules.every(Boolean)
      ? Math.max(0, (toInner(0, rules[0]!.v, hi) * toInner(1, rules[1]!.v, hi) * toInner(2, rules[2]!.v, hi) - (gross - net)) * 1000)
      : null;
    width = wi;
    height = hi;
  }
  const di = (2 * m) / (1 + r);
  const outline = wedge ? wedgeOutline(di, hi, r, t) : null;
  const diTop = r * di;
  const slotH = slotted ? front!.area / wi : 0;
  const band = portBand(wi);
  const usableBottom = t + band;
  const autoDriverY = usableBottom + (hi + t - usableBottom) / 2;
  const manual = d.rowMode === 'manual' && !bandpassType;
  const driverY = manual ? d.rowYMm / 1000 : autoDriverY;
  const rowX = manual ? d.rowXMm / 1000 : 0;
  const fits = hi - band >= outer + 0.01;
  const bandpass = d.boxType === 'bp4' || d.boxType === 'bp6';
  // The divider sits where it splits the inside by the two net volumes.
  const rearFraction = bandpass ? d.vbL / (d.vbL + d.vfL) : 0;
  // The divider board itself sits on the rear-chamber side.
  const frontDepth = bandpass ? di * (1 - rearFraction) : di;
  // Up a wedge's back the riser runs along the leaning panel.
  const backRun = Math.hypot(hi, di - diTop);
  // Where the magnet must fit: behind the baffle, in a band-pass rear chamber, or behind a clamped pair.
  // Round tubes run straight back (no elbows); a slot can fold once up the back.
  const room = tube ? (() => { const s = frontDepth - portEndGap(tube.id); return { straight: s, folded: s }; })() : slotPortRoom(frontDepth, backRun, slotH);
  // Depth where the magnet's top edge actually sits (a wedge is shallower higher up).
  const magnetDepth = di * (1 - (1 - r) * Math.min(1, Math.max(0, (driverY - t + outer / 4) / hi)));
  const magnetClear = bandpass
    ? di * rearFraction - t - depth >= 0.02
    : d.boxType === 'isobaric'
      ? di - 2 * depth - 0.03 >= 0.02
      : magnetDepth - depth - (slotted && portLen > room.straight ? slotH + t : 0) >= 0.02;
  // A port can never be shorter than the panel it goes through.
  const portFold: BoxGeometry['portFold'] = !front ? 'none' : front.physicalLength < t ? 'short' : portLen <= room.straight ? 'straight' : portLen <= room.folded ? 'L' : 'impossible';
  const rp = d.boxType === 'bp6' ? res?.info.ports.find((p) => p.label === 'rear port') : undefined;
  const rearPort: BoxGeometry['rearPort'] = rp ? (() => {
    // A round tube through the back panel into the rear chamber, bent up once if it must be.
    const radius = Math.sqrt(rp.area / Math.PI);
    const gap = portEndGap(2 * radius);
    const straight = di * rearFraction - t - gap;
    const maxLength = straight + hi - 2 * radius - gap;
    const length = rp.physicalLength;
    return { y: t + radius + 0.02, radius, length, room: straight, maxLength, fits: length >= t && length <= maxLength };
  })() : null;
  const wx = wi + 2 * t, hx = hi + 2 * t;
  const dx = outline ? outline.outerFloor : di + 2 * t;
  const dxTop = outline ? outline.outerTop : dx;
  // Outside panels (top, bottom, baffle, back along its lean, two sides), the slot board, the
  // window braces (about half a board each once the window is cut out; cross bars only their own
  // area) and any divider / inner baffle.
  const braceBoards = braceKind === 'window' ? (barsOnly ? parts.braces / t : braceN * 0.5 * wi * hi) : 0;
  const panelAreaM2 = wx * (dx + dxTop) + wx * hi + wx * backRun + hi * (di + diTop) + (slotted ? wi * Math.min(1.5, portLen) : 0) + braceBoards + innerBoards * wi * hi;
  const density = material?.densityKgM3 ?? 750;
  const lit = (v: number) => v * 1000;
  const volume: VolumeBreakdown = {
    shellL: lit(wi * hi * m), driversL: lit(parts.drivers), portsL: lit(parts.ports), boardsL: lit(parts.boards), bracesL: lit(parts.braces),
    tunnelL: lit(tunnel), extraL: oversizeL + extraL, netL: lit(net)
  };
  const geo: BoxGeometry = {
    wx, hx, dx, wi, hi, di, t, shape, dxTop, diTop, backAngle: outline?.angle ?? 0,
    slotH, tubes: tube ? { count: tube.count, id: tube.id, od: tube.od, y: t + TUBE_EDGE + tube.od / 2, xs: Array.from({ length: tube.count }, (_, i) => (i - (tube.count - 1) / 2) * (tube.od + 0.02)) } : null,
    portLength: portLen, portFold, portMaxLength: front ? room.folded : 0, rearFraction, frontDepth, rearPort, driverY, rowX, autoDriverY,
    driverRadius: outer / 2, cutoutRadius: mount.cutout / 2, driverDepth: depth, braces: NO_BRACES, prRadius, prLayout, oversizeL, extraL, shortL, dimConflict, capacityL, volume,
    fits, magnetClear, panelAreaM2, outerL: lit(wx * hx * (dx + dxTop) / 2),
    // Damping sheets go on the walls, not the baffle (about a fifth of the panel area).
    weightKg: panelAreaM2 * t * density + panelAreaM2 * 0.8 * sheetKgM2 + (braceKind === 'dowel' ? parts.braces * DOWEL_KG_M3 : 0),
    sheets: Math.max(1, Math.ceil((panelAreaM2 * 1.2) / (1.22 * 2.44)))
  };
  // The braces are laid out last: where they may go depends on everything else inside.
  geo.braces = bracePlan(geo, d.boxType, d.count, braceKind, braceN);
  return geo;
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
 * Lowest bending mode (1,1) of the side panel (the one drawn in the vibration view), the back
 * panel and the top, simply supported Kirchhoff plates — conservative: clamped edges would sit
 * about 1.8× higher.
 *
 * Bracing: a brace plane is glued to the panels it touches, so it acts as one more supported edge
 * and the panel's free span along the depth becomes the longest bay between the baffle, the
 * planes and the back — depth/(n+1) for n evenly spaced planes. A window frame touches both sides
 * and the top; dowels run side to side and hold only the sides (their point fixings are taken as
 * a line, so a dowel-braced side is somewhat optimistic). Cross bars (a window plane in a box with
 * side passive radiators) hold only the top. A band-pass divider or isobaric inner baffle is not
 * counted as a support, so an unbraced box of any type gets exactly the unbraced numbers (and the
 * estimate stays on the low side). The planes run parallel to the back, so they never touch it:
 * the back keeps its whole width × height (bracing it would need a brace from the baffle to the back).
 */
export function panelModes(geo: BoxGeometry, material: PanelMaterialDto | undefined, f11Factor = 1): { side: number; back: number; top: number } {
  const e = (material?.eGpa ?? 3.5) * 1e9;
  const rho = material?.densityKgM3 ?? 750;
  const nu = material?.poisson ?? 0.25;
  const h = geo.t;
  const bend = (e * h * h * h) / (12 * (1 - nu * nu));
  const f11 = (a: number, b: number) => (Math.PI / 2) * Math.sqrt(bend / (rho * h)) * (1 / (a * a) + 1 / (b * b)) * f11Factor;
  // A wedge's side is a trapezoid (taken at its mean depth); its back panel runs up the lean.
  const held = geo.braces ?? NO_BRACES;
  return {
    side: f11(freeSpan(held.sideHeld, (geo.di + geo.diTop) / 2), geo.hi),
    back: f11(geo.wi, Math.hypot(geo.hi, geo.di - geo.diTop)),
    top: f11(geo.wi, freeSpan(held.topHeld, geo.diTop))
  };
}

// ---- warnings ---------------------------------------------------------------------------------

export interface Warning { level: 'info' | 'warn' | 'bad'; text: string; /** The box cannot be built as set. */ build?: boolean }

export const fmtOhms = (z: number) => (z >= 10 ? z.toFixed(0) : String(Number(z.toFixed(z < 2 ? 2 : 1))));

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
  const peWired = ratedWatts(dto, d);
  if (pe && peWired && perDriver > peWired) {
    out.push({ level: 'bad', text: `กำลังต่อดอก ${Math.round(perDriver)} W เกินพิกัด ${Math.round(peWired)} W${peWired < pe ? ' (ใช้คอยล์ขดเดียว พิกัดเหลือครึ่งเดียว)' : ''} วอยซ์คอยล์จะร้อนจัด` });
  }
  const amp = ampLimits(d);
  const zn = res.info.nominalOhms;
  if (amp) {
    const ampMax = (amp.volts * amp.volts) / zn;
    if (d.watts > ampMax * 1.001) out.push({ level: 'bad', text: `แอมป์ ${d.ampW} W @ ${d.ampOhms} Ω ให้ได้ราว ${Math.round(ampMax)} W ที่โหลด ${fmtOhms(zn)} Ω ตั้งไว้ ${d.watts} W จึง clip (สัญญาณแตก) ลดกำลังหรือเปลี่ยนการต่อสาย` });
    if (zn < d.ampMinOhms * 0.999) out.push({ level: 'bad', text: `โหลดรวม ${fmtOhms(zn)} Ω ต่ำกว่าที่แอมป์รับได้ (${d.ampMinOhms} Ω) แอมป์จะร้อนหรือตัดการทำงาน ลองต่อสายแบบอื่น` });
    else if (res.metrics.impedanceMin.ohms < d.ampMinOhms * 0.8) out.push({ level: 'warn', text: `อิมพีแดนซ์จริงตกถึง ${res.metrics.impedanceMin.ohms.toFixed(1)} Ω ที่ ${res.metrics.impedanceMin.f.toFixed(0)} Hz ต่ำกว่าโหลดต่ำสุดของแอมป์ (${d.ampMinOhms} Ω) แอมป์อาจจำกัดกระแสช่วงนั้น` });
  }
  const rw = wireOhms(d);
  if (rw > 0 && rw / zn > 0.05) out.push({ level: 'warn', text: `สายลำโพง ${d.wireM} ม. เบอร์ ${d.wireAwg} AWG มีความต้านทาน ${rw.toFixed(2)} Ω (${((rw / zn) * 100).toFixed(0)}% ของโหลด) เสียกำลังและเบสหลวม ควรใช้สายใหญ่ขึ้นหรือสั้นลง` });
  if (dto && isDvc(dto) && !measuredWiring(dto).known) out.push({ level: 'info', text: `ลำโพงนี้ไม่ระบุว่าค่า T/S วัดตอนต่อคอยล์แบบไหน จึงเดาว่า${measuredWiring(dto).wiring === 'series' ? 'อนุกรม' : 'ขนาน'}จากอิมพีแดนซ์ แก้ได้ในคลังลำโพง` });
  if (m.portVelocityMax.ms > 60) out.push({ level: 'bad', text: `ท่อเล็กเกินไป ลมในท่อ ${m.portVelocityMax.ms.toFixed(0)} m/s เกินช่วงที่สูตรเชิงเส้นใช้ได้ ของจริงลมจะอั้น (port compression) เสียงหายและมีเสียงลมแรง ควรขยายท่อ` });
  else if (m.portVelocityMax.ms > 30) out.push({ level: 'bad', text: `ลมในท่อ ${m.portVelocityMax.ms.toFixed(1)} m/s เกิน 30 m/s เสียงลมจะชัด ควรขยายท่อ` });
  else if (m.portVelocityMax.ms > 17) out.push({ level: 'warn', text: `ลมในท่อ ${m.portVelocityMax.ms.toFixed(1)} m/s เกินเกณฑ์ 17 m/s อาจได้ยินเสียงลม` });
  if (xmax && m.excursionMax.mm > xmax) {
    const below = res.info.ports.length > 0 && m.excursionMax.f < (res.info.ports[0]?.tuning ?? 0);
    out.push({ level: 'bad', text: `ระยะชัก ${m.excursionMax.mm.toFixed(1)} มม. เกิน Xmax ${xmax} มม. ที่ ${m.excursionMax.f.toFixed(0)} Hz${below && !d.subsonic ? ' (ต่ำกว่าจูน) เปิด Subsonic ช่วยได้' : ' ลดกำลังหรือเพิ่มปริมาตร'}` });
  }
  // What makes the box impossible to build comes first among the geometry messages.
  for (const p of buildProblems(d, dto, geo)) out.push({ level: 'bad', text: p.text, build: true });
  if (geo.extraL > 0.5) out.push({ level: 'info', text: `ขนาดที่กำหนดใหญ่กว่าที่ตู้นี้ต้องการราว ${Math.round(geo.extraL)} L ต้องใส่บล็อกไม้ให้เต็ม หรือกด "ใช้ปริมาตรเต็มตู้" ในหัวข้อทรงและขนาด` });
  // With the amplifier modelled, its own minimum-load check above replaces this general one.
  if (!amp && m.impedanceMin.ohms < 2) out.push({ level: 'warn', text: `อิมพีแดนซ์ต่ำสุด ${m.impedanceMin.ohms.toFixed(1)} Ω แอมป์ต้องรับโหลดต่ำได้` });
  return out;
}

// ---- can it be built? ---------------------------------------------------------------------------

export type BuildCode = 'port-short' | 'port-long' | 'rear-port-short' | 'rear-port-long' | 'too-small' | 'magnet' | 'baffle' | 'space' | 'placement' | 'brace';

export const AXIS_TH = ['กว้าง', 'สูง', 'ลึก'] as const;
/** How the hand-set sizes are measured, as the UI and messages name it. */
export const REF_TH: Record<DimRef, string> = { outer: 'ภายนอก', inner: 'ภายใน' };
const mmTxt = (m: number) => String(Math.round(m * 1000));
export interface BuildProblem { code: BuildCode; text: string }

const cmTxt = (m: number) => (m * 100).toFixed(m < 0.1 ? 1 : 0);
/** Two lengths in cm, with a decimal when whole centimetres would make them look equal. */
const cmPair = (a: number, b: number): [string, string] => (cmTxt(a) === cmTxt(b) ? [(a * 100).toFixed(1), (b * 100).toFixed(1)] : [cmTxt(a), cmTxt(b)]);

/**
 * Collisions that make a box impossible to build as set (not merely a poor box): a port shorter
 * than its panel or longer than the box can hold, a box too small for the driver, its magnet and
 * ports, a magnet against the back wall. The lab keeps its sliders out of these.
 */
export function buildProblems(d: Design, dto: DriverDto | undefined, geo: BoxGeometry): BuildProblem[] {
  const out: BuildProblem[] = [];
  const t = geo.t;
  const guessed = mountOf(dto).estimated.filter((x) => x !== 'รูเจาะ');
  const note = guessed.length ? ` (ไม่มี${guessed.join(' ')}ของลำโพงใน datasheet จึงประมาณจากขนาดนิ้ว)` : '';
  if (geo.portFold === 'short') out.push({ code: 'port-short', text: `ท่อต้องยาวอย่างน้อยเท่าความหนาแผง ${d.thicknessMm} มม. แต่ความถี่จูนนี้ต้องการท่อสั้นกว่านั้น (พื้นที่ท่อเล็กไปหรือจูนสูงไป)` });
  if (geo.portFold === 'impossible') {
    const [len, max] = cmPair(geo.portLength, geo.portMaxLength);
    out.push({ code: 'port-long', text: geo.tubes
      ? `ท่อกลมยาว ${len} ซม. แต่ตู้นี้ลึกพอสำหรับท่อตรงแค่ ${max} ซม. (ปลายท่อต้องห่างผนังหลัง ${cmTxt(portEndGap(geo.tubes.id))} ซม.) ใช้ท่อเล็กลง ลดจำนวนท่อ หรือเปลี่ยนเป็นท่อสลอต`
      : `ท่อยาว ${len} ซม. แต่ตู้นี้ใส่ได้ยาวสุด ${max} ซม. (พับหนึ่งครั้ง ปลายท่อต้องห่างผนัง ${cmTxt(portEndGap(geo.slotH))} ซม.)` });
  }
  if (geo.rearPort && !geo.rearPort.fits) {
    out.push(geo.rearPort.length < t
      ? { code: 'rear-port-short', text: `ท่อหลังต้องยาวอย่างน้อยเท่าความหนาแผง ${d.thicknessMm} มม. (พื้นที่ท่อหลังเล็กไปหรือจูนสูงไป)` }
      : { code: 'rear-port-long', text: `ท่อหลังยาว ${cmPair(geo.rearPort.length, Math.max(0, geo.rearPort.maxLength)).join(' ซม. แต่ห้องหลังใส่ได้ยาวสุด ')} ซม.` });
  }
  // When a hand-set size is what blocks the contents, the 'space' message below says so instead.
  if (geo.oversizeL > 0.5 && !geo.dimConflict) {
    const what = ['ลำโพง', 'แม่เหล็ก', ...(geo.portFold !== 'none' || geo.rearPort ? ['ท่อ'] : []), ...(d.boxType === 'pr' ? ['แผ่น PR'] : [])];
    out.push({ code: 'too-small', text: `ตู้ ${d.vbL} L${d.boxType === 'bp4' || d.boxType === 'bp6' ? ` + ${d.vfL} L` : ''} เล็กเกินกว่าจะใส่${what.join(' ')}ได้ ต้องใหญ่ขึ้นอีกราว ${Math.ceil(geo.oversizeL)} L${note}` });
  }
  if (geo.dimConflict) {
    const c = geo.dimConflict;
    const rule = [d.wMode, d.hMode, d.dMode][c.axis];
    const what = c.axis === 0 ? (geo.tubes ? 'ลำโพงหรือท่อกลมเรียงกัน' : 'ลำโพงเรียงกัน') : c.axis === 1 ? `ลำโพง${geo.slotH || geo.tubes ? 'และท่อ' : ''}` : `แม่เหล็ก${geo.portFold === 'L' ? 'และท่อที่พับ' : ''}`;
    out.push({ code: 'space', text: `ด้าน${AXIS_TH[c.axis]}${c.axis === 2 && geo.shape === 'wedge' ? 'ที่พื้น' : ''} (${REF_TH[c.ref]}) ต้องอย่างน้อย ${mmTxt(c.need)} มม. เพื่อใส่${what} แต่${rule === 'fixed' ? 'กำหนดไว้' : 'จำกัดไว้ไม่เกิน'} ${mmTxt(c.limit)} มม.${note}` });
  } else if (geo.shortL > 0.5) {
    const cap = geo.capacityL;
    out.push({ code: 'space', text: `ขนาดที่กำหนด (${REF_TH[d.dimRef === 'inner' ? 'inner' : 'outer']}) ใส่ปริมาตรได้${cap !== null ? `ราว ${Math.floor(cap)} L` : 'ไม่พอ'} แต่ตู้นี้ต้องการ ${d.vbL}${d.boxType === 'bp4' || d.boxType === 'bp6' ? ` + ${d.vfL}` : ''} L (ขาดราว ${Math.ceil(geo.shortL)} L) ลดปริมาตรหรือขยายขนาด` });
  }
  const place = d.rowMode === 'manual' ? rowProblem(geo, d.boxType, d.count) : null;
  if (place) {
    const where = { left: 'ล้นขอบซ้าย', right: 'ล้นขอบขวา', top: 'ล้นขอบบน', bottom: 'ล้นขอบล่าง', slot: geo.tubes ? 'ขอบลำโพงทับรูท่อ' : 'ขอบลำโพงบังปากท่อ' }[place.side];
    out.push({ code: 'placement', text: `ตำแหน่งลำโพงที่วางเอง${where} ${Math.ceil(place.by * 1000)} มม. (รูเจาะต้องเหลือไม้รอบอย่างน้อย 10 มม.) ลากกลับเข้ามาหรือกด "จัดกลาง"` });
  }
  if (!geo.magnetClear) out.push({ code: 'magnet', text: `ท้ายแม่เหล็กชนผนังหลังหรือท่อ${note}` });
  const br = geo.braces;
  if (br && br.missing > 0) {
    const placed = br.count - br.missing;
    out.push(br.kind === 'window' && !br.window
      ? { code: 'brace', text: `${BRACE_TH.window}ใส่ไม่ได้ ตู้เล็กเกินกว่าจะเจาะช่องโครงค้ำ (ช่องต้องเหลืออย่างน้อย ${Math.round(BRACE_WINDOW_MIN * 1000)} มม. ถ้าติดเป็นแผ่นเต็มจะปิดลำโพงไว้ในช่องเล็ก) ใช้เดือยหรือไม่ใส่โครงค้ำ` }
      : { code: 'brace', text: `${BRACE_TH[br.kind]} ${br.count} ชุด${placed ? ` ใส่ได้แค่ ${placed} ชุด ที่เหลือ` : ''}ไม่มีที่วาง (ติด${br.blockedBy ?? 'ของในตู้'}) ลดจำนวนชุด เปลี่ยนแบบโครงค้ำ หรือขยายตู้${note}` });
  }
  if (!geo.fits) out.push({ code: 'baffle', text: 'แผงหน้าเตี้ยกว่าหน้ากว้างลำโพง' });
  return out;
}

// ---- suggested box -------------------------------------------------------------------------------

export type SuggestFlag = AlignmentFlag | 'clamped' | 'unbuildable' | 'space-capped' | 'braces-reduced';

export const SUGGEST_FLAG_TEXT: Record<SuggestFlag, string> = {
  'qts-high-for-sealed': 'Qts สูง ตู้ปิดแบบ Qtc 0.707 จะใหญ่มาก จึงใช้ Qtc สูงขึ้น ลำโพงนี้เหมาะกับตู้ใหญ่หรือติดผนัง (free-air)',
  'qts-high-for-vented': 'Qts เกิน 0.5 อยู่นอกช่วงที่สูตรตู้เปิดใช้ได้ดี ช่วงทุ้มอาจโป่ง',
  'qts-low-for-vented': 'Qts ต่ำมาก ตู้เปิดจะเล็กและจูนสูง เบสน้อย ลองตู้ BP6',
  'port-velocity': 'ท่อที่ลมไม่เกิน 17 m/s ยาวเกินกว่าจะพับใส่ตู้นี้ได้ จึงใช้ท่อกว้างที่สุดที่ยังใส่ได้ ถ้าลมยังแรงไป ลดกำลังขับ ขยายตู้ หรือเปลี่ยนเป็น PR',
  'port-too-long': 'แม้ท่อที่แคบที่สุดที่จูนได้ก็ยาวเกินกว่าจะใส่ตู้นี้ ความถี่จูนต่ำมากเทียบกับขนาดตู้ ลองตู้ PR (แผ่นเปล่าไม่ต้องมีท่อ) หรือจูนสูงขึ้น',
  'qts-low-for-sealed': 'ลำโพงนี้ Qts ต่ำ (EBP สูง) ตู้ปิดแบบ Butterworth จะเล็กมากและเบสหายไปมาก ลำโพงแบบนี้ทำมาสำหรับตู้เปิด แบนด์พาส หรือฮอร์น',
  'volume-capped': 'ตู้ตามสูตรใหญ่เกินช่วงที่ตั้งได้ จึงใช้ตู้ใหญ่สุดที่ตั้งได้ แล้วหาความถี่จูนที่ได้เบสลึกสุดโดยไม่โป่ง',
  'volume-raised': 'ตู้ตามสูตรเล็กเกินกว่าจะใส่ลำโพง แม่เหล็ก และท่อได้ (หรือแคบจนลมในท่อแรง) จึงขยายตู้โดยคงความถี่จูนเดิม',
  clamped: 'บางค่าเกินช่วงของแถบเลื่อน จึงถูกตัดให้อยู่ในช่วง',
  unbuildable: 'หาขนาดที่สร้างได้จริงสำหรับตู้แบบนี้ไม่เจอ (ท่อหรือลำโพงชนกัน) ลองตู้แบบอื่น',
  'space-capped': 'ตู้ตามสูตรใหญ่เกินขนาดที่กำหนดไว้ จึงใช้ตู้ใหญ่สุดที่ใส่ในขนาดนั้นได้',
  'braces-reduced': 'ไม่มีที่วางโครงค้ำครบตามที่ตั้งไว้ จึงลดจำนวนชุด (หรือไม่ใส่โครงค้ำ) แทนการขยายตู้ ปริมาตรจึงยังตามสูตร'
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

/** Subsonic corners the UI offers. */
export const SUBSONIC_HZ = [15, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 45] as const;
const nearestSubsonic = (hz: number) => SUBSONIC_HZ.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));

/** Range of every slider the suggestion writes to; RightPanel uses the same table. */
export const RANGES = {
  vbL: [2, 600], fbHz: [15, 90], portAreaCm2: [5, 1500], vfL: [2, 400], fb2Hz: [30, 150], port2AreaCm2: [5, 1500],
  prSdCm2: [30, 2000], prMassG: [5, 2000], watts: [1, 5000]
} as const satisfies Partial<Record<keyof Design, readonly [number, number]>>;

/** Off-recipe requests the goal wizard makes: another Qtc, box size, tuning or band-pass S, or less room. */
export type SuggestVariant = Pick<AlignmentRequest, 'qtc' | 'volume' | 'tuning' | 'bandpassS' | 'maxVolume'>;

/** A textbook starting box for the selected driver and box type, as a patch of UI values. */
export function suggestDesign(
  d: Design, driver: Driver, dto: DriverDto | undefined, damping: DampingMaterialDto[], variant: SuggestVariant = {}
): { patch: Partial<Design>; name: string; flags: SuggestFlag[] } {
  const n = d.boxType === 'isobaric' ? 2 : d.count;
  const flags: SuggestFlag[] = [];
  // Volumes round up: a box rounded down could no longer hold what it was grown to hold.
  const roundFor = (key: keyof typeof RANGES, v: number, step: number) => (key === 'vbL' || key === 'vfL' ? Math.ceil(v / step - 1e-9) : Math.round(v / step)) * step;
  const fit = (key: keyof typeof RANGES, v: number, step: number) => {
    const [lo, hi] = RANGES[key];
    const r = roundFor(key, v, step);
    if (r < lo || r > hi) flags.push('clamped');
    return clamp(r, lo, hi);
  };
  const watts = dto?.peW ? fit('watts', dto.peW * n, 1) : d.watts;
  const withFill = d.boxType === 'sealed' || d.boxType === 'vented' || d.boxType === 'pr';
  const { maxVolume, ...recipe } = variant;
  const base: Omit<Parameters<typeof suggestAlignment>[0], 'type'> = {
    driver, count: d.count, wiring: d.wiring, watts, highpass: d.subsonic ? { fc: d.subsonicHz, order: 4 as const } : undefined,
    fill: withFill ? fillFor(d, damping) : undefined, minPortLength: Math.max(0.02, d.thicknessMm / 1000 + 0.005), ...recipe
  };
  /** UI values for a suggested box; `fit` rounds and clamps to the slider ranges. */
  const patchFor = (b: BoxDesign, fit: (key: keyof typeof RANGES, v: number, step: number) => number): Partial<Design> => {
    switch (b.type) {
      case 'sealed':
      case 'isobaric':
        return { vbL: fit('vbL', b.vb * 1000, 1) };
      case 'vented':
        return { vbL: fit('vbL', b.vb * 1000, 1), fbHz: fit('fbHz', b.fb, 0.5), portAreaCm2: fit('portAreaCm2', b.port.area * 1e4, 5) };
      case 'pr':
        return {
          vbL: fit('vbL', b.vb * 1000, 1), prSdCm2: fit('prSdCm2', b.pr.sd * 1e4, 5), prMassG: fit('prMassG', b.pr.mmp * 1000, 5),
          prCmsMmN: b.pr.cmp * 1000, prCount: b.pr.count ?? 1
        };
      case 'bp4':
        return { vbL: fit('vbL', b.vr * 1000, 1), vfL: fit('vfL', b.vf * 1000, 1), fbHz: fit('fbHz', b.fb, 0.5), portAreaCm2: fit('portAreaCm2', b.port.area * 1e4, 5) };
      case 'bp6':
        return {
          vbL: fit('vbL', b.vr * 1000, 1), fbHz: fit('fbHz', b.fbr, 0.5), portAreaCm2: fit('portAreaCm2', b.portR.area * 1e4, 5),
          vfL: fit('vfL', b.vf * 1000, 1), fb2Hz: fit('fb2Hz', b.fbf, 0.5), port2AreaCm2: fit('port2AreaCm2', b.portF.area * 1e4, 5)
        };
      default:
        return {};
    }
  };
  const quiet = (key: keyof typeof RANGES, v: number, step: number) => clamp(roundFor(key, v, step), RANGES[key][0], RANGES[key][1]);
  const mainVolume = (b: BoxDesign) => (b.type === 'bp4' || b.type === 'bp6' ? b.vr : 'vb' in b ? b.vb : 0);

  // 1) size the box within the slider range; 2) limit the ports to what that box can hold;
  // 3) when the box cannot hold the driver, magnet and ports, grow it until it can.
  // Sizes set by hand on every side hold only so much: never suggest a box that will not go in.
  const bpType = d.boxType === 'bp4' || d.boxType === 'bp6';
  const capL = sizeBox(d, dto, buildNetwork(toSpec(d, driver, damping)), undefined).capacityL;
  const spaceMax = capL !== null ? (Math.max(RANGES.vbL[0], capL * (bpType ? 0.6 : 1) - 1)) / 1000 : Infinity;
  const limits = { maxVolume: Math.min(RANGES.vbL[1] / 1000, maxVolume ?? Infinity, spaceMax) };
  const first = suggestAlignment({ ...base, ...limits, type: d.boxType });
  const fb = first.box;
  // Later rounds grow the box from the requested one; pin its tuning so they do not rescan it.
  if (recipe.volume && first.tuning) base.tuning = first.tuning;
  // Ported boxes get a subsonic filter at about 0.8 × Fb (below tuning the box stops loading the
  // cone); size the ports with that filter in place, or port speed and excursion are judged
  // against a filter the design will not have.
  const subsonicFor = (b: BoxDesign): number | null => {
    const prTuning = b.type === 'pr'
      ? (1 / (2 * Math.PI)) * Math.sqrt((b.pr.sd * b.pr.sd * (b.pr.count ?? 1) * 1.2041 * 343.24 ** 2 / b.vb + 1 / b.pr.cmp) / b.pr.mmp)
      : null;
    const tuning = b.type === 'vented' ? b.fb : b.type === 'bp4' ? b.fb * 0.75 : b.type === 'bp6' ? b.fbr : prTuning;
    return tuning ? nearestSubsonic(0.8 * tuning) : null;
  };
  const hp = subsonicFor(fb);
  if (hp) base.highpass = { fc: hp, order: 4 };
  const bp = fb.type === 'bp4' || fb.type === 'bp6';
  const litres = 1000 * (bp ? fb.vr + fb.vf : mainVolume(fb));
  const room = portRoom(litres, bp ? fb.vr / (fb.vr + fb.vf) : 0);
  let ports = { maxPortLength: Math.min(1.2, room.front), maxRearPortLength: Math.min(1.2, room.rear) };
  // Port room for a main chamber of `net` m³, keeping the band-pass front/rear split of the recipe.
  const frontShare = fb.type === 'bp4' || fb.type === 'bp6' ? fb.vf / fb.vr : 0;
  const portRoomFor = (net: number) => {
    const r = portRoom(net * 1000 * (1 + frontShare), frontShare ? 1 / (1 + frontShare) : 0);
    return { maxPortLength: Math.min(1.2, r.front), maxRearPortLength: Math.min(1.2, r.rear) };
  };
  let a = suggestAlignment({ ...base, ...limits, ...ports, type: d.boxType });
  // Growing the box retunes it, which changes the port, which changes the box — a few rounds settle it.
  for (let round = 0; round < 5; round++) {
    const trial = { ...d, watts, ...patchFor(a.box, quiet) };
    const geo = sizeBox(trial, dto, simulate(toSpec(trial, driver, damping), { fMin: 10, fMax: 300, points: 60 }), undefined);
    if (geo.oversizeL <= 0.5) break;
    a = suggestAlignment({ ...base, ...limits, ...ports, minVolume: mainVolume(a.box) + (geo.oversizeL * 1.5 + 2) / 1000, type: d.boxType });
  }
  // The port room above was an estimate; measure the box actually laid out and, if a port does
  // not fit, size the ports again within that real room (keeping any volume already grown).
  for (let round = 0; round < 3; round++) {
    const t = { ...d, watts, ...patchFor(a.box, quiet) };
    const g = sizeBox(t, dto, simulate(toSpec(t, driver, damping), { fMin: 10, fMax: 300, points: 60 }), undefined);
    const frontBad = g.portFold === 'impossible' && g.portLength > 0;
    const rearBad = !!g.rearPort && !g.rearPort.fits && g.rearPort.length > 0;
    if (!frontBad && !rearBad) break;
    ports = {
      maxPortLength: Math.min(ports.maxPortLength, 0.95 * g.portMaxLength),
      maxRearPortLength: g.rearPort ? Math.min(ports.maxRearPortLength, 0.95 * g.rearPort.maxLength) : ports.maxRearPortLength
    };
    a = suggestAlignment({ ...base, ...limits, ...ports, minVolume: mainVolume(a.box), type: d.boxType });
  }
  // Still too much air through the widest port that fits? A bigger box has room for a wider port
  // (same tuning): try up to three steps of +30 %, keeping one only if the bass stays flat.
  if (a.box.type === 'vented' || a.box.type === 'bp6') {
    const speedOf = (x: typeof a) => {
      const t = { ...d, watts, ...patchFor(x.box, quiet) };
      return simulate(toSpec(t, driver, damping), { fMin: 10, fMax: 300, points: 90 }).metrics;
    };
    let m = speedOf(a);
    for (let step = 0; step < 3 && m.portVelocityMax.ms > 30; step++) {
      const vol = mainVolume(a.box) * 1.3;
      if (vol * 1000 > RANGES.vbL[1]) break;
      const bigger = suggestAlignment({ ...base, ...limits, ...ports, ...portRoomFor(vol), minVolume: vol, type: d.boxType });
      const mb = speedOf(bigger);
      if (mb.splMax - mb.referenceSpl > 1.5 || mb.portVelocityMax.ms >= m.portVelocityMax.ms) break;
      a = bigger;
      m = mb;
    }
  }
  flags.unshift(...a.flags.map((f): SuggestFlag => (f === 'volume-capped' && spaceMax <= Math.min(RANGES.vbL[1] / 1000, maxVolume ?? Infinity) ? 'space-capped' : f)));
  const b = a.box;
  const patch: Partial<Design> = { watts, ...patchFor(b, fit) };
  // Last word on building it. With the tuning fixed, a bigger chamber needs a shorter port and has
  // more room for it, so: a box too small for its contents is topped up by what is missing; a port
  // that will not fit gets a bigger chamber (the front one for a band-pass front port); a port
  // shorter than its panel gets a wider port, which is longer. Each step only ever grows.
  const frontArea = frontAreaKey(d);
  let built = false;
  for (let round = 0; round < 12; round++) {
    const t = { ...d, ...patch };
    const g = sizeBox(t, dto, buildNetwork(toSpec(t, driver, damping)), undefined);
    const codes = new Set(buildProblems(t, dto, g).map((x) => x.code));
    if (!codes.size) { built = true; break; }
    const grow = (key: 'vbL' | 'vfL' | 'portAreaCm2' | 'port2AreaCm2', by: number) => {
      const before = patch[key] ?? d[key];
      patch[key] = fit(key, before * by + (key === 'vbL' || key === 'vfL' ? 1 : 5), key === 'vbL' || key === 'vfL' ? 1 : 5);
      return patch[key] !== before;
    };
    let moved = false;
    if (codes.has('space') && !g.dimConflict && g.shortL > 0.5) {
      // The sizes set by hand cannot hold it all: shrink the chambers to what they hold.
      const k = Math.max(0.3, 1 - (g.shortL + 1) / (g.volume.netL + 1e-9));
      for (const key of bpType ? (['vbL', 'vfL'] as const) : (['vbL'] as const)) {
        const before = patch[key] ?? d[key];
        patch[key] = clamp(Math.floor(before * k), RANGES[key][0], RANGES[key][1]);
        moved = patch[key] !== before || moved;
      }
      if (!flags.includes('space-capped')) flags.push('space-capped');
    }
    if (codes.has('space') && g.dimConflict?.axis === 1 && g.slotH > 0) {
      // The slot port takes height off the baffle: a narrower port is a lower slot.
      const before = patch[frontArea] ?? d[frontArea];
      patch[frontArea] = clamp(Math.floor((before * 0.85) / 5) * 5, RANGES[frontArea][0], RANGES[frontArea][1]);
      moved = patch[frontArea] !== before || moved;
      if (!flags.includes('space-capped')) flags.push('space-capped');
    }
    if (codes.has('port-short')) moved = grow(frontArea, 1.25) || moved;
    if (codes.has('rear-port-short')) moved = grow('portAreaCm2', 1.25) || moved;
    if (codes.has('too-small') || codes.has('magnet')) {
      const before = patch.vbL ?? d.vbL;
      patch.vbL = fit('vbL', before + Math.max(1, g.oversizeL) + 1, 1);
      moved = patch.vbL !== before || moved;
    }
    if (codes.has('port-long')) moved = grow(d.boxType === 'bp4' || d.boxType === 'bp6' ? 'vfL' : 'vbL', 1.15) || moved;
    if (codes.has('rear-port-long')) moved = grow('vbL', 1.15) || moved;
    if (codes.has('too-small') || codes.has('magnet') || codes.has('port-long') || codes.has('rear-port-long')) {
      if (!flags.includes('volume-raised')) flags.push('volume-raised');
    }
    // Braces with nowhere to go never change the volume (that would change the sound only to make
    // room for a brace): once nothing else is left to fix, keep the planes that fit, or none.
    if (codes.has('brace') && (codes.size === 1 || !moved)) {
      const br = g.braces;
      const placed = br.count - br.missing;
      if (placed > 0) patch.braceCount = placed;
      else patch.braceKind = 'none';
      if (!flags.includes('braces-reduced')) flags.push('braces-reduced');
      moved = true;
    }
    if (!moved) break; // every lever is at the end of its slider
  }
  if (!built) {
    const t = { ...d, ...patch };
    if (buildProblems(t, dto, sizeBox(t, dto, buildNetwork(toSpec(t, driver, damping)), undefined)).length) flags.push('unbuildable');
  }
  // A closed box keeps loading the cone below fc, so it keeps whatever subsonic the user had.
  const finalHp = subsonicFor(b);
  if (finalHp) Object.assign(patch, { subsonic: true, subsonicHz: finalHp });
  return { patch, name: RECIPE_TH[a.recipe] + (a.qtc ? ` (Qtc ${a.qtc.toFixed(2)})` : ''), flags: [...new Set(flags)] };
}

// ---- comparison --------------------------------------------------------------------------------

/** The numbers a saved comparison keeps (see data/compare.ts). */
export function summarize(d: Design, dto: DriverDto | undefined, res: SimResult, geo: BoxGeometry | null, max: MaxOutput | null): SlotSummary {
  const m = res.metrics;
  const sealedLike = d.boxType === 'sealed' || d.boxType === 'isobaric';
  const f = res.curves.freqs;
  const reach = max ? f.map((_, i) => i).filter((i) => f[i] >= 30 && f[i] <= 80).map((i) => max.maxSpl[i]).filter(Number.isFinite) : [];
  return {
    boxType: d.boxType,
    vbL: d.vbL,
    vfL: d.boxType === 'bp4' || d.boxType === 'bp6' ? d.vfL : null,
    tuning: sealedLike ? res.info.fc ?? null : m.tuningDip?.f ?? (d.boxType === 'pr' ? null : d.fbHz),
    tuningKind: sealedLike ? 'fc' : 'fb',
    qtc: sealedLike ? res.info.qtc ?? null : null,
    f3: m.f3, f3High: m.f3High, f10: m.f10,
    splMax: m.splMax,
    excursionMm: m.excursionMax.mm,
    xmaxMm: dto?.xmaxMm ?? null,
    portMs: res.info.ports.length ? m.portVelocityMax.ms : null,
    zMin: m.impedanceMin.ohms,
    dims: geo ? [Math.round(geo.wx * 1000), Math.round(geo.hx * 1000), Math.round(geo.dx * 1000)] : null,
    weightKg: geo ? geo.weightKg : null,
    watts: d.watts,
    drivers: d.boxType === 'isobaric' ? 2 : d.count,
    loud: reach.length ? reach.reduce((a, b) => a + b, 0) / reach.length : null
  };
}

export { simulate, solveAt, type Solution };
