import { AIR_20C, type Air } from './air';
import { simulate } from './analysis';
import type { BoxDesign, FillSpec, SystemSpec } from './designs';
import type { Driver } from './driver';

const TAU = 2 * Math.PI;

export type AlignmentType = 'sealed' | 'vented' | 'pr' | 'bp4' | 'bp6' | 'isobaric';

/** Why a suggested box is only a compromise for this driver. */
export type AlignmentFlag =
  /** Qts ≥ 0.62: a Butterworth sealed box would be huge, so a higher Qtc was used. */
  | 'qts-high-for-sealed'
  /** Qts > 0.5: outside the range the vented formulas were fitted to. */
  | 'qts-high-for-vented'
  /** Qts < 0.2: a vented box this small and high-tuned gives little bass. */
  | 'qts-low-for-vented'
  /** EBP > 100 (or Qts < 0.3): a Butterworth closed box is tiny and tuned high — not this driver's box. */
  | 'qts-low-for-sealed'
  /** No port that fits keeps the air below the target speed. */
  | 'port-velocity'
  /** Even the narrowest port that reaches the tuning is longer than the box can hold. */
  | 'port-too-long'
  /** The recipe's box was bigger than allowed: the largest allowed box was used (vented boxes retuned). */
  | 'volume-capped'
  /** The recipe's box was too small to hold the hardware: it was enlarged (vented boxes retuned). */
  | 'volume-raised';

export interface AlignmentRequest {
  driver: Driver;
  type: AlignmentType;
  /** Identical drivers sharing the chambers. Isobaric always uses one pair. */
  count?: number;
  wiring?: 'parallel' | 'series';
  watts: number;
  highpass?: SystemSpec['highpass'];
  fill?: FillSpec;
  /** Suspension compliance of each passive radiator, m/N (default 0.3 mm/N). */
  prCompliance?: number;
  /** Peak port air speed to aim for at `watts`, m/s (default 17). */
  targetPortVelocity?: number;
  /** Longest port that fits (or is still practical), m (default 1.2). */
  maxPortLength?: number;
  /** Same for the rear-chamber port of a 6th-order band-pass (default: maxPortLength). */
  maxRearPortLength?: number;
  /** Net volume limits of the main (rear) chamber, m³ — e.g. the UI range, or what the driver needs to fit. */
  minVolume?: number;
  maxVolume?: number;
  air?: Air;
}

export type AlignmentRecipe = 'butterworth' | 'qb3' | 'qb3-pr' | 'geddes-bp4' | 'qb3-bp6';

export interface Alignment {
  box: BoxDesign;
  recipe: AlignmentRecipe;
  /** Short name of the recipe used, e.g. "Butterworth Qtc 0.707". */
  name: string;
  /** Target Qtc for the sealed recipes. */
  qtc?: number;
  flags: AlignmentFlag[];
}

/**
 * A sensible starting box for a driver, from textbook alignments:
 * sealed/isobaric — Qtc 0.707 (Small); vented/PR — Keele's QB3 fit
 * (Vb = 15·Qts^2.87·Vas, Fb = 0.42·Fs·Qts^-0.9); 4th-order band-pass — Geddes S = 0.7
 * (Vf = (2·S·Qts)²·Vas, rear chamber at Qbc 0.707, Fb = rear-box fc); 6th-order band-pass —
 * QB3 rear chamber with the front chamber tuned an octave higher.
 * Ports are then sized: the narrowest port that keeps the air below the target speed at the
 * requested power, or — when that one would be too long — the widest port that still fits.
 */
export function suggestAlignment(req: AlignmentRequest): Alignment {
  const d = req.driver;
  const air = req.air ?? AIR_20C;
  const rc2 = air.rho * air.c * air.c;
  const n = req.type === 'isobaric' ? 1 : Math.max(1, Math.round(req.count ?? 1));
  // Isobaric pair = one compound driver with half the Vas; n drivers in one box = n·Vas.
  const vas = req.type === 'isobaric' ? d.vas / 2 : d.vas * n;
  const fill = req.fill ?? {};
  // The isobaric box model takes no fill, so its volume must not be shrunk for one.
  const gain = req.type === 'isobaric' ? 1 : 1 + (fill.stuffingGain ?? 0.4) * Math.min(1, Math.max(0, fill.stuffing ?? 0));
  const flags: AlignmentFlag[] = [];

  const sealedVolume = (qtc: number) => vas / ((qtc / d.qts) ** 2 - 1);
  const keele = () => {
    if (d.qts > 0.5) flags.push('qts-high-for-vented');
    if (d.qts < 0.2) flags.push('qts-low-for-vented');
    return { vb: 15 * d.qts ** 2.87 * vas, fb: 0.42 * d.fs * d.qts ** -0.9 };
  };

  const spec = (box: BoxDesign): SystemSpec => ({
    driver: d, count: n, wiring: req.wiring, box, drive: { watts: req.watts }, highpass: req.highpass, air
  });

  /** Keeps a net volume inside [minVolume, maxVolume] and says which way it had to move. */
  const clampVolume = (net: number): { net: number; moved: 'capped' | 'raised' | null } => {
    if (req.maxVolume && net > req.maxVolume) { flags.push('volume-capped'); return { net: req.maxVolume, moved: 'capped' }; }
    if (req.minVolume && net < req.minVolume) { flags.push('volume-raised'); return { net: req.minVolume, moved: 'raised' }; }
    return { net, moved: null };
  };

  /**
   * Off-recipe vented box: scan Fb from 0.5 to 2.5 × Fs and keep the tuning with the lowest F3
   * whose response does not rise more than 1 dB above the passband.
   */
  const bestTuning = (net: number): number => {
    let best = { fb: 0.42 * d.fs * d.qts ** -0.9, f3: Infinity };
    for (let i = 0; i <= 40; i++) {
      const fb = d.fs * (0.5 + 0.05 * i);
      const res = simulate(spec({ type: 'vented', vb: net, fb, port: { area: 0.15 * d.sd * n }, ...fill }), { fMin: 10, fMax: 300, points: 90 });
      if (res.metrics.f3 === null || res.metrics.splMax - res.metrics.referenceSpl > 1) continue;
      if (res.metrics.f3 < best.f3) best = { fb, f3: res.metrics.f3 };
    }
    return best.fb;
  };

  /**
   * QB3 box and tuning, or the nearest allowed box retuned. vb is net volume. Above Qts 0.5 the
   * QB3 fit runs away (a 15" car sub would get ~470 L at 16 Hz), so the box is held to 1.5 × Vas
   * and retuned for a flat response instead.
   */
  const ventedBox = (): { vb: number; fb: number } => {
    const k = keele();
    const runaway = d.qts > 0.5 && k.vb > 1.5 * vas;
    const c = clampVolume((runaway ? 1.5 * vas : k.vb) / gain);
    // A smaller box than the recipe needs a new tuning; a bigger one (grown to hold the hardware
    // or a wider port) keeps the recipe's Fb, so growing it does not move the port around.
    return { vb: c.net, fb: c.moved === 'capped' || runaway ? bestTuning(c.net) : k.fb };
  };

  /**
   * Port length grows with area while air speed falls, so walk the area up from small: the first
   * area that is slow enough wins; if the port outgrows `maxPortLength` first, keep the widest
   * one that still fitted.
   */
  const sizePorts = (make: (area: number) => BoxDesign): BoxDesign => {
    const target = req.targetPortVelocity ?? 17;
    const maxLen = req.maxPortLength ?? 1.2;
    const maxRear = req.maxRearPortLength ?? maxLen;
    const limit = (label: string) => (label === 'rear port' ? maxRear : maxLen);
    let area = Math.max(5e-4, 0.02 * d.sd * n);
    let fitting: BoxDesign | null = null;
    let shortest: BoxDesign | null = null;
    for (let i = 0; i < 60; i++, area *= 1.12) {
      const box = make(area);
      const res = simulate(spec(box), { fMin: 10, fMax: 300, points: 90 });
      if (res.info.ports.some((p) => p.physicalLength < 0.02)) continue; // too narrow to reach this tuning at all
      shortest ??= box;
      if (res.info.ports.some((p) => p.physicalLength > limit(p.label))) break;
      fitting = box;
      if (res.metrics.portVelocityMax.ms <= target) return box;
    }
    if (fitting) { flags.push('port-velocity'); return fitting; }
    // Port length grows with area, so the first port that reached the tuning is the shortest one.
    flags.push('port-too-long');
    return shortest ?? make(area);
  };

  switch (req.type) {
    case 'sealed':
    case 'isobaric': {
      let qtc = 0.707;
      if (d.qts >= 0.62) { qtc = d.qts * 1.15; flags.push('qts-high-for-sealed'); }
      if (d.fs / d.qes > 100 || d.qts < 0.3) flags.push('qts-low-for-sealed');
      const vb = clampVolume(sealedVolume(qtc) / gain).net;
      const box: BoxDesign = req.type === 'sealed'
        ? { type: 'sealed', vb, ...fill }
        : { type: 'isobaric', vb };
      return { box, recipe: 'butterworth', name: `Butterworth Qtc ${qtc.toFixed(2)}`, qtc, flags };
    }
    case 'vented': {
      const { vb, fb } = ventedBox();
      const box = sizePorts((area) => ({ type: 'vented', vb, fb, port: { area }, ...fill }));
      return { box, recipe: 'qb3', name: 'QB3 (Keele)', flags };
    }
    case 'pr': {
      const { vb, fb } = ventedBox();
      const count = 2;
      const sd = d.sd * n; // two radiators, each as large as all the drivers together
      // Air spring each radiator feels: the net volume times the fill gain.
      const kBox = (rc2 * count * sd * sd) / (vb * gain);
      // A soft suspension (a quarter of the air spring) keeps the radiator's own resonance — and
      // the notch it puts in the response — well below Fb.
      const cmp = req.prCompliance ?? 1 / (0.25 * kBox);
      const mmp = (kBox + 1 / cmp) / (TAU * fb) ** 2;
      const box: BoxDesign = { type: 'pr', vb, pr: { sd, mmp, cmp, count }, ...fill };
      return { box, recipe: 'qb3-pr', name: 'QB3 (Keele) + 2 PR', flags };
    }
    case 'bp4': {
      const qbc = Math.max(0.707, d.qts * 1.15);
      const vr = clampVolume(sealedVolume(qbc)).net;
      const vf = (2 * 0.7 * d.qts) ** 2 * vas;
      const fb = (qbc / d.qts) * d.fs;
      const box = sizePorts((area) => ({ type: 'bp4', vr, vf, fb, port: { area } }));
      return { box, recipe: 'geddes-bp4', name: 'Geddes S 0.7', flags };
    }
    case 'bp6': {
      const k = keele();
      const fb = k.fb;
      const vr = clampVolume(k.vb).net;
      const vb = vr;
      const vf = 0.5 * vb;
      const fbf = 2 * fb;
      const box = sizePorts((area) => ({
        type: 'bp6', vr, fbr: fb, portR: { area }, vf, fbf, portF: { area }
      }));
      return { box, recipe: 'qb3-bp6', name: 'QB3 rear + front an octave up', flags };
    }
  }
}
