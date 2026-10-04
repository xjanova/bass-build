import { suggestAlignment, type Curves, type Driver } from '@bassbuild/physics';
import type { DampingMaterialDto, DriverDto } from '../data/types';
import type { BoxType, Design } from '../state/store';
import { fillFor, simulate, sizeBox, suggestDesign, toSpec, type SuggestFlag, type SuggestVariant } from './model';

// ---- goals ----------------------------------------------------------------------------------------

export type Goal = 'deep' | 'loud' | 'small' | 'sq' | 'spl' | 'outdoor' | 'car';
export type Vehicle = 'sedan' | 'suv' | 'pickup4' | 'pickupCab';

export const GOALS: { id: Goal; th: string; desc: string; how: string }[] = [
  { id: 'deep', th: 'เบสลึก', desc: 'ลงต่ำที่สุดโดยเสียงไม่โป่ง ยอมให้ตู้ใหญ่', how: 'F3 ต่ำ (น้ำหนักมากที่สุด) · ยอดโป่งไม่เกิน 1 dB · ลมในท่อไม่เกิน 30 m/s · ตู้ใหญ่หักคะแนนเล็กน้อย' },
  { id: 'loud', th: 'ดังสุด', desc: 'ดังที่สุดช่วงเบสหลัก ไม่เกินระยะชัก ลมในท่อ และพิกัดลำโพง', how: 'ระดับดังสุดที่ทำได้จริงเฉลี่ยทั้งช่วงเบสหลัก (ไม่เกิน Xmax, ลมท่อ 30 m/s, พิกัดลำโพง) · ไม่โป่งเกิน 3 dB' },
  { id: 'small', th: 'ตู้เล็ก', desc: 'ตู้เล็กที่สุดที่ยังได้เบสพอใช้', how: 'ขนาดภายนอกเล็ก (น้ำหนักมากที่สุด) แลกกับ F3 ที่ไม่สูงเกินไป' },
  { id: 'sq', th: 'SQ ฟังเพลง', desc: 'เรียบ ตอบสนองไว (group delay ต่ำ) ไม่มีเสียงลม', how: 'F3 ต่ำ · กราฟเรียบ (โป่งไม่เกิน 0.5 dB) · group delay ไม่เกิน 1 รอบ · ลมในท่อไม่เกิน 17 m/s' },
  { id: 'spl', th: 'SPL แข่ง', desc: 'ยอดดังสุดที่ความถี่เดียว (burp) ยอมให้กราฟไม่เรียบ', how: 'ยอดดังสุดที่ทำได้จริงช่วง 25–80 Hz ไม่สนความเรียบและขนาดตู้' },
  { id: 'outdoor', th: 'กลางแจ้ง / รถแห่', desc: 'ดังช่วง 45–120 Hz ที่คนฟังกลางแจ้งได้ยิน ทนเปิดนาน', how: 'ระดับดังสุดที่ทำได้จริงเฉลี่ยช่วง 45–120 Hz · ลมในท่อไม่เกิน 25 m/s · ตู้ใหญ่หักคะแนนเล็กน้อย' },
  { id: 'car', th: 'ในรถ', desc: 'รวมผลห้องโดยสาร (cabin gain) และให้ตู้เล็กพอใส่รถ', how: 'F3 ในรถ (รวม cabin gain โดยประมาณ) · ตู้เล็ก · ดังพอ · ลมในท่อไม่เกิน 30 m/s' }
];

/** Longest inside dimension of each cabin, m: sets where cabin gain starts. */
export const VEHICLES: { id: Vehicle; th: string; lengthM: number }[] = [
  { id: 'sedan', th: 'เก๋ง', lengthM: 2.6 },
  { id: 'suv', th: 'SUV / รถตู้', lengthM: 3.2 },
  { id: 'pickup4', th: 'กระบะ 4 ประตู', lengthM: 2.2 },
  { id: 'pickupCab', th: 'กระบะแคป', lengthM: 1.6 }
];

/**
 * Cabin gain, dB: below the frequency whose half wavelength fits the cabin's longest dimension the
 * car acts as a pressure vessel and the level rises 12 dB/octave; leaks cap it near 24 dB.
 * A textbook estimate, not a measurement of any car.
 */
export function cabinGainDb(f: number, lengthM: number): number {
  const fc = 343 / (2 * lengthM);
  return Math.min(24, 10 * Math.log10(1 + (fc / f) ** 4));
}

// ---- candidates -----------------------------------------------------------------------------------

export interface WizardInput {
  goal: Goal;
  /** The current design: count, wiring, fill, material and subsonic carry over. */
  design: Design;
  dto: DriverDto;
  driver: Driver;
  damping: DampingMaterialDto[];
  /** Most net litres the user has room for, or null. */
  maxLitres: number | null;
  vehicle: Vehicle;
}

export interface CandidateCurves {
  freqs: number[];
  /** SPL at 1 m at the suggested power (in the car when the goal is car). */
  spl: number[];
  /** Loudest the box can play at each frequency within Xmax, 30 m/s port air and the rated power. */
  maxSpl: number[];
  /** Free-field curves on the lab's frequency grid, so the box can be kept as the lab's comparison curve. */
  lab: Curves;
}

export interface CandidateMetrics {
  /** Net air inside (both chambers of a band-pass), L. */
  netL: number;
  /** Outside size of the box, L, and its outside dimensions W × H × D, cm. */
  outerL: number;
  dimsCm: [number, number, number];
  f3: number | null;
  f10: number | null;
  /** Qtc of a closed box (sealed or isobaric), else null. */
  qtc: number | null;
  /** How far the response rises above (or dips below, for a band-pass) its passband, dB. */
  uneven: number;
  /** Mean of the reachable SPL across the goal's bass band, dB. */
  loud: number;
  /** Highest reachable SPL and where, dB / Hz. */
  peak: { db: number; f: number };
  /** What sets the reachable SPL across the band. */
  limitedBy: 'excursion' | 'port' | 'power';
  /** Worst group delay in 20–200 Hz, in periods of the frequency it occurs at. */
  gdCycles: number;
  /** Peak port air speed at the suggested power, m/s (0 without a port). */
  portMs: number;
  watts: number;
  drivers: number;
}

export interface Candidate {
  id: string;
  type: BoxType;
  label: string;
  detail: string;
  /** UI values to apply, box type included. */
  patch: Partial<Design>;
  flags: SuggestFlag[];
  curves: CandidateCurves;
  m: CandidateMetrics;
  score: number;
  /** Where this box beats the rest of the set. */
  strengths: string[];
}

export interface WizardResult {
  goal: Goal;
  ranked: Candidate[];
  /** Boxes left out because they need more room than allowed. */
  tooBig: number;
  /** Boxes left out because their port air would pass 60 m/s at the rated power. */
  chokedPorts: number;
  /** Net litres of the smallest box that was left out for size, or null. */
  smallestL: number | null;
  /** Lowest/highest frequency of the band the loudness was judged on, Hz. */
  band: [number, number];
}

interface Recipe { id: string; type: BoxType; label: string; variant: SuggestVariant }

/** Frequency grid of the lab's graphs (App.tsx). */
export const LAB_GRID = { fMin: 10, fMax: 500, points: 240 } as const;

const TYPE_TH: Record<BoxType, string> = { sealed: 'ตู้ปิด', vented: 'ตู้เปิด', pr: 'PR', bp4: 'BP4', bp6: 'BP6', isobaric: 'Isobaric' };

/** Every box worth trying for this driver: the textbook recipes plus smaller, bigger, louder and flatter ones. */
function recipesFor(input: WizardInput): Recipe[] {
  const { driver, design } = input;
  const count = design.count;
  // QB3 size and tuning for this driver, count and fill: the yardstick the vented variants scale from.
  const qb3 = suggestAlignment({
    driver, count, wiring: design.wiring, watts: design.watts, type: 'vented',
    fill: fillFor(design, input.damping), maxVolume: 0.6
  });
  const qb3Vb = qb3.box.type === 'vented' ? qb3.box.vb : 0.05;
  const qb3Fb = qb3.tuning ?? driver.fs;
  const out: Recipe[] = [];
  const add = (id: string, type: BoxType, label: string, variant: SuggestVariant = {}) => out.push({ id, type, label, variant });
  // Sealed boxes are named after the Qtc they end up with (a box grown to fit the driver loses its target).
  if (driver.qts < 0.43) add('sealed-050', 'sealed', '', { qtc: 0.5 });
  add('sealed-071', 'sealed', '');
  if (driver.qts < 0.78) add('sealed-090', 'sealed', '', { qtc: 0.9 });
  if (driver.qts < 0.95) add('sealed-110', 'sealed', '', { qtc: 1.1 });
  add('vented-qb3', 'vented', 'ตู้เปิด QB3');
  add('vented-small', 'vented', 'ตู้เปิดเล็ก', { volume: qb3Vb * 0.6 });
  add('vented-big', 'vented', 'ตู้เปิดใหญ่ จูนต่ำ', { volume: qb3Vb * 1.6 });
  add('vented-spl', 'vented', 'ตู้เปิดจูนสูง เน้นดัง', { tuning: qb3Fb * 1.3 });
  add('pr', 'pr', 'PR 2 แผ่น');
  add('bp4', 'bp4', 'BP4 เรียบ (Geddes S 0.7)');
  add('bp4-loud', 'bp4', 'BP4 เน้นดัง (S 1.0)', { bandpassS: 1 });
  add('bp6', 'bp6', 'BP6');
  if (count <= 2) add('isobaric', 'isobaric', 'Isobaric (ลำโพง 2 ดอกซ้อน)');
  return out;
}

const log2 = Math.log2;

/** Frequency where `spl` first climbs through `level`, scanning up from the bottom. */
function crossing(freqs: number[], spl: number[], level: number): number | null {
  for (let i = 1; i < freqs.length; i++) {
    if (spl[i - 1] < level && spl[i] >= level) {
      const t = (level - spl[i - 1]) / (spl[i] - spl[i - 1]);
      return freqs[i - 1] * Math.pow(freqs[i] / freqs[i - 1], t);
    }
  }
  return spl[0] >= level ? freqs[0] : null;
}

/** Bass band the loudness is judged on: around the driver's own resonance, or fixed for outdoor and car. */
export function bandFor(goal: Goal, fs: number): [number, number] {
  if (goal === 'outdoor') return [45, 120];
  if (goal === 'car') return [30, 80];
  const lo = Math.min(80, Math.max(28, 0.9 * fs));
  return [lo, lo * 2.5];
}

function evaluate(input: WizardInput, r: Recipe): Omit<Candidate, 'score' | 'strengths'> | null {
  const { driver, dto, damping, goal } = input;
  const start: Design = { ...input.design, boxType: r.type };
  const variant: SuggestVariant = { ...r.variant, ...(input.maxLitres ? { maxVolume: input.maxLitres / 1000 } : {}) };
  let s: ReturnType<typeof suggestDesign>;
  try {
    s = suggestDesign(start, driver, dto, damping, variant);
  } catch {
    return null; // a recipe this driver cannot reach at all (e.g. a Qtc below its Qts)
  }
  // Never offer a box that cannot be built (a port or the driver would not fit).
  if (s.flags.includes('unbuildable')) return null;
  const d: Design = { ...start, ...s.patch };
  // Same grid as the lab's own graphs, so these curves line up with it as a comparison.
  const res = simulate(toSpec(d, driver, damping), LAB_GRID);
  const geo = sizeBox(d, dto, res, undefined);
  const c = res.curves;
  const f = c.freqs;
  const car = goal === 'car' ? input.vehicle : null;
  const lengthM = VEHICLES.find((v) => v.id === car)?.lengthM ?? 0;
  const gain = (i: number) => (car ? cabinGainDb(f[i], lengthM) : 0);
  const spl = c.spl.map((v, i) => v + gain(i));

  // Reachable level: scale the rated power down wherever the cone or the port air runs out first.
  const xmax = dto.xmaxMm ?? null;
  const limits = c.spl.map((_, i) => {
    const kx = xmax && c.excursionMm[i] > 0 ? (xmax / c.excursionMm[i]) ** 2 : Infinity;
    const kp = c.portVelocity[i] > 0 ? (30 / c.portVelocity[i]) ** 2 : Infinity;
    return { k: Math.min(1, kx, kp), by: kx < Math.min(1, kp) ? 'excursion' as const : kp < 1 ? 'port' as const : 'power' as const };
  });
  const maxSpl = spl.map((v, i) => v + 10 * Math.log10(limits[i].k));

  const [lo, hi] = bandFor(goal, driver.fs);
  const inBand = f.map((x, i) => i).filter((i) => f[i] >= lo && f[i] <= hi);
  const loud = inBand.reduce((a, i) => a + maxSpl[i], 0) / Math.max(1, inBand.length);
  const tally = { excursion: 0, port: 0, power: 0 };
  inBand.forEach((i) => tally[limits[i].by]++);
  const limitedBy = (Object.keys(tally) as (keyof typeof tally)[]).reduce((a, b) => (tally[b] > tally[a] ? b : a));
  // Competition "burp" frequencies sit in the low bass.
  let peak = { db: -Infinity, f: lo };
  f.forEach((x, i) => { if (x >= 25 && x <= 80 && maxSpl[i] > peak.db) peak = { db: maxSpl[i], f: x }; });

  const ref = res.metrics.referenceSpl;
  const f3 = car ? crossing(f, spl, ref - 3) : res.metrics.f3;
  const f10 = car ? crossing(f, spl, ref - 10) : res.metrics.f10;
  let uneven = Math.max(0, res.metrics.splMax - ref);
  if (res.info.bandpass) {
    // A band-pass is referenced to its own peak, so judge it by the dip between its two humps and
    // by how far the bass band as a whole sits below that peak (2 dB is the usual roll-off at the
    // band edges): a narrow one-note band-pass shows up here, a flat wide one does not.
    let dip = 0;
    if (res.metrics.f3 && res.metrics.f3High) {
      const a = res.metrics.f3 * 1.3, b = res.metrics.f3High / 1.3;
      const mid = c.spl.filter((_, i) => f[i] >= a && f[i] <= b);
      if (mid.length) dip = ref - Math.min(...mid);
    }
    const mean = inBand.reduce((acc, i) => acc + c.spl[i], 0) / Math.max(1, inBand.length);
    uneven = Math.max(dip, ref - mean - 2);
  }
  let gdCycles = 0;
  f.forEach((x, i) => { if (x >= 20 && x <= 200) gdCycles = Math.max(gdCycles, (c.groupDelayMs[i] * x) / 1000); });

  const netL = d.boxType === 'bp4' || d.boxType === 'bp6' ? d.vbL + d.vfL : d.vbL;
  const qtc = res.info.qtc ?? 0;
  const label = r.label || (qtc < 0.6 ? 'ตู้ปิดใหญ่ เบสนุ่ม' : qtc <= 0.76 ? 'ตู้ปิด Butterworth' : 'ตู้ปิดกะทัดรัด');
  const band = res.info.bandpass && res.metrics.f3 && res.metrics.f3High ? `ช่วง ${Math.round(res.metrics.f3)}–${Math.round(res.metrics.f3High)} Hz` : null;
  const detail = [
    `${netL} L`,
    d.boxType === 'sealed' || d.boxType === 'isobaric' ? `Qtc ${qtc.toFixed(2)}` : d.boxType === 'bp6' ? `จูน ${d.fbHz}/${d.fb2Hz} Hz` : `จูน ${d.fbHz} Hz`,
    band
  ].filter(Boolean).join(' · ');
  return {
    id: r.id, type: r.type, label, detail, patch: { ...s.patch, boxType: r.type }, flags: s.flags,
    curves: { freqs: f, spl, maxSpl, lab: c },
    m: {
      netL, outerL: geo.wx * geo.hx * geo.dx * 1000,
      dimsCm: [geo.wx * 100, geo.hx * 100, geo.dx * 100].map((v) => Math.round(v)) as [number, number, number],
      f3, f10, qtc: d.boxType === 'sealed' || d.boxType === 'isobaric' ? qtc : null, uneven, loud, peak, limitedBy, gdCycles,
      portMs: res.metrics.portVelocityMax.ms, watts: d.watts, drivers: d.boxType === 'isobaric' ? 2 : d.count
    }
  };
}

/** Goal score, higher is better. Octaves of F3 and doublings of box size are the common currency. */
function scoreFor(goal: Goal, m: CandidateMetrics): number {
  const f3 = log2(m.f3 ?? 200);
  const size = log2(Math.max(1, m.outerL));
  const lumpy = (above: number) => Math.max(0, m.uneven - above);
  // Port air past 30 m/s at the rated power chuffs and compresses; only an SPL contest shrugs it off.
  const chuff = (above: number) => 0.15 * Math.max(0, m.portMs - above);
  switch (goal) {
    case 'deep': return -10 * f3 - 4 * lumpy(1) - size - chuff(30);
    case 'loud': return m.loud - 0.5 * size - 2 * lumpy(3) - chuff(30);
    case 'small': return -7 * size - 5 * f3 - 2 * lumpy(2) - chuff(30);
    case 'sq': return -8 * f3 - 5 * lumpy(0.5) - 6 * Math.max(0, m.gdCycles - 1) - chuff(17) - size;
    case 'spl': return m.peak.db - 0.3 * size;
    case 'outdoor': return m.loud - 0.5 * size - 2 * lumpy(3) - chuff(25);
    case 'car': return -6 * f3 - 6 * size + 0.3 * m.loud - chuff(30);
  }
}

/** Badges for the boxes that lead the set on one measure. */
function strengthsOf(list: Omit<Candidate, 'strengths'>[]): Map<string, string[]> {
  const out = new Map<string, string[]>(list.map((c) => [c.id, []]));
  const best = (label: string, key: (c: Omit<Candidate, 'strengths'>) => number, among = list) => {
    const top = among.reduce<Omit<Candidate, 'strengths'> | null>((a, b) => (!a || key(b) > key(a) ? b : a), null);
    if (top) out.get(top.id)!.push(label);
  };
  best('เบสลึกสุด', (c) => -(c.m.f3 ?? 1e9));
  best('ดังสุด', (c) => c.m.loud);
  best('ตู้เล็กสุด', (c) => -c.m.outerL);
  // A band-pass is judged flat by the dip between its humps, which says nothing about a single-hump one.
  best('เรียบสุด', (c) => -c.m.uneven, list.filter((c) => c.type !== 'bp4' && c.type !== 'bp6'));
  best('group delay ต่ำสุด', (c) => -c.m.gdCycles);
  return out;
}

/**
 * True when two boxes came out practically the same — usually a variant pushed back onto the recipe
 * by a limit (a driver too big for the smaller box, a cap on the volume).
 */
const same = (a: Omit<Candidate, 'strengths'>, b: Omit<Candidate, 'strengths'>) => {
  if (a.type !== b.type) return false;
  if (a.m.qtc !== null && b.m.qtc !== null) return Math.abs(a.m.qtc - b.m.qtc) <= 0.06;
  return Math.abs(a.m.netL - b.m.netL) <= 0.1 * a.m.netL && Math.abs((a.patch.fbHz ?? 0) - (b.patch.fbHz ?? 0)) <= 1.5;
};

/**
 * Builds every candidate box for the goal and ranks them. `onProgress` reports after each box so a
 * worker can show progress; every box goes through the same suggestion pipeline as the lab's
 * "suggested box" button, so a box opened in the lab matches what was compared here.
 */
export function runWizard(input: WizardInput, onProgress?: (done: number, total: number) => void): WizardResult {
  const recipes = recipesFor(input);
  const made: Omit<Candidate, 'score' | 'strengths'>[] = [];
  let broken = 0;
  recipes.forEach((r, i) => {
    const c = evaluate(input, r);
    // Past 60 m/s the port model no longer holds (the air chokes); such a box is not a candidate.
    if (c && c.m.portMs > 60) broken++;
    else if (c) made.push(c);
    onProgress?.(i + 1, recipes.length);
  });
  const room = (c: (typeof made)[number]) => !input.maxLitres || c.m.netL <= input.maxLitres * 1.02;
  // Of two boxes that came out the same, keep the one that suits this goal better.
  const scored = made.map((c) => ({ ...c, score: scoreFor(input.goal, c.m) })).sort((a, b) => b.score - a.score)
    .filter((c, i, all) => !all.slice(0, i).some((x) => same(x, c)));
  const fits = scored.filter(room);
  const badges = strengthsOf(fits);
  return {
    goal: input.goal,
    ranked: fits.map((c) => ({ ...c, strengths: badges.get(c.id) ?? [] })),
    tooBig: scored.length - fits.length,
    smallestL: scored.length > fits.length ? Math.min(...scored.filter((c) => !room(c)).map((c) => c.m.netL)) : null,
    chokedPorts: broken,
    band: bandFor(input.goal, input.driver.fs)
  };
}

export { TYPE_TH };
