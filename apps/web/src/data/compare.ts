import type { Curves } from '@bassbuild/physics';
import type { BoxType, Design } from '../state/store';

/** Up to three saved designs drawn over the lab's graphs and set side by side in a table. */
export type SlotId = 'A' | 'B' | 'C';
export const SLOT_IDS: SlotId[] = ['A', 'B', 'C'];
export const SLOT_COLOR: Record<SlotId, string> = { A: '#f472b6', B: '#f8fafc', C: '#fb923c' };

/** The numbers the comparison table shows, frozen when the slot was saved. */
export interface SlotSummary {
  boxType: BoxType;
  /** Net air (main or rear chamber) and, for a band-pass, the front chamber, L. */
  vbL: number;
  vfL: number | null;
  /** Fc of a closed box, or the box tuning, Hz. */
  tuning: number | null;
  tuningKind: 'fc' | 'fb';
  qtc: number | null;
  f3: number | null;
  f3High: number | null;
  f10: number | null;
  splMax: number;
  excursionMm: number;
  xmaxMm: number | null;
  portMs: number | null;
  zMin: number;
  /** Outside size, mm, and empty weight, kg. */
  dims: [number, number, number] | null;
  weightKg: number | null;
  watts: number;
  drivers: number;
  /** Mean of the loudest reachable level over 30–80 Hz, dB (null when no limit is known). */
  loud: number | null;
}

export interface Slot {
  label: string;
  design: Design;
  driverId: number | null;
  driverName: string;
  curves: Curves;
  /** Loudest reachable level at each frequency, dB (same grid as curves). */
  maxSpl: number[] | null;
  summary: SlotSummary;
  savedAt: number;
}

const KEY = 'bassbuild.compare.v1';
const EMPTY: Record<SlotId, Slot | null> = { A: null, B: null, C: null };

const isNumArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' || x === null);

/** A stored slot is used only if it still has the shape the graphs need (it may come from an older build). */
function valid(v: unknown): v is Slot {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<Slot>;
  const c = s.curves as Partial<Curves> | undefined;
  return typeof s.label === 'string' && !!s.design && typeof s.design === 'object' && !!s.summary && typeof s.summary === 'object'
    && !!c && isNumArray(c.freqs) && c.freqs.length > 1
    && (['spl', 'impedance', 'excursionMm', 'portVelocity', 'groupDelayMs'] as const).every((k) => isNumArray(c[k]) && c[k]!.length === c.freqs!.length);
}

export function readSlots(): Record<SlotId, Slot | null> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...EMPTY };
    for (const id of SLOT_IDS) if (valid(parsed?.[id])) out[id] = parsed[id] as Slot;
    return out;
  } catch {
    return { ...EMPTY };
  }
}

export function writeSlots(slots: Record<SlotId, Slot | null>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(slots));
  } catch {
    // Private mode or full storage: the comparison still works until the page is closed.
  }
}

const ENUMS: Partial<Record<keyof Design, readonly string[]>> = {
  boxType: ['sealed', 'vented', 'pr', 'bp4', 'bp6', 'isobaric'],
  wiring: ['parallel', 'series'],
  coilWiring: ['series', 'parallel', 'single'],
  finish: ['walnut', 'oak', 'teak', 'black', 'raw'],
  shape: ['box', 'wedge'],
  dimRef: ['outer', 'inner'],
  wMode: ['auto', 'fixed', 'max'],
  hMode: ['auto', 'fixed', 'max'],
  dMode: ['auto', 'fixed', 'max'],
  rowMode: ['auto', 'manual'],
  portStyle: ['slot', 'round']
};

/**
 * A stored design merged over `base` field by field: only values of the right type (finite
 * numbers, known choices) are taken, so storage edited by hand or written by another build
 * cannot put the lab into a state it cannot draw.
 */
export function sanitizeDesign(raw: unknown, base: Design): Design {
  const out: Record<string, unknown> = { ...base };
  if (!raw || typeof raw !== 'object') return base;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in base)) continue;
    const def = (base as unknown as Record<string, unknown>)[k];
    const allowed = ENUMS[k as keyof Design];
    if (allowed ? typeof v === 'string' && allowed.includes(v) : typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  return out as unknown as Design;
}

/** First empty slot, or null when all three are taken. */
export const freeSlot = (slots: Record<SlotId, Slot | null>): SlotId | null => SLOT_IDS.find((id) => !slots[id]) ?? null;
