import type { CoilWiring } from '@bassbuild/physics';
import { create } from 'zustand';
import type { Source } from '../data/api';
import { readSlots, sanitizeDesign, writeSlots, type Slot, type SlotId } from '../data/compare';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../data/types';
import type { Finish } from '../viewport/finishes';

export type BoxType = 'sealed' | 'vented' | 'pr' | 'bp4' | 'bp6' | 'isobaric';
export type OverlayId = 'wave' | 'air' | 'smoke' | 'ir' | 'vib' | 'balloon' | 'xray';
export type ChartId = 'spl' | 'imp' | 'exc' | 'vel' | 'gd' | 'max' | 'cmp';
export type Mode = 'design' | 'lab' | 'library' | 'wizard' | 'blueprint';
/** Box outline: a plain box, or a wedge whose back slopes forward (behind a car seat, in a boot). */
export type BoxShape = 'box' | 'wedge';
/** How one outside dimension is set: laid out from the volume, held at a size, or kept under one. */
export type DimMode = 'auto' | 'fixed' | 'max';

/** Everything the user designs, in the units the UI shows (litres, cm², Hz, W). */
export interface Design {
  boxType: BoxType;
  vbL: number; // main box, or rear chamber of a band-pass
  fbHz: number; // vented / bp4 tuning / bp6 rear tuning / isobaric vent
  portAreaCm2: number;
  vfL: number; // band-pass front chamber
  fb2Hz: number; // bp6 front tuning
  port2AreaCm2: number;
  prSdCm2: number;
  prMassG: number;
  prCmsMmN: number;
  prCount: number;
  ql: number;
  stuffing: number; // 0..1
  fillKey: string; // damping material in the box (damping_materials.key)
  cldKey: string; // damping sheet on the walls, or 'none'
  count: number;
  wiring: 'parallel' | 'series';
  /** How the two coils of each dual-voice-coil driver are wired (ignored for single-coil drivers). */
  coilWiring: CoilWiring;
  /** Signal level: amplifier output as power into the nominal load, W. */
  watts: number;
  /** Model the amplifier (clip level, current limit, output impedance); off = ideal source. */
  amp: boolean;
  ampW: number; // rated RMS power …
  ampOhms: number; // … into this load
  ampMinOhms: number; // lowest load it is rated for (sets the current limit)
  dampingFactor: number; // at ampOhms
  /** Speaker cable: one-way length (0 = ignore) and gauge. */
  wireM: number;
  wireAwg: number;
  subsonic: boolean;
  subsonicHz: number;
  materialKey: string;
  thicknessMm: number;
  finish: Finish;
  shape: BoxShape;
  /** Wedge only: inside depth at the top as a share of the inside depth at the floor, %. */
  wedgeTopPct: number;
  /** Outside width / height / depth (at the floor for a wedge): rule and size, mm. */
  wMode: DimMode; wMm: number;
  hMode: DimMode; hMm: number;
  dMode: DimMode; dMm: number;
  /** Front row of drivers: centred by the layout, or placed by hand (offset from the centre line, centre height above the floor), mm. */
  rowMode: 'auto' | 'manual';
  rowXMm: number;
  rowYMm: number;
  /** Front port: a slot along the floor, or round tubes through the baffle (count from the port area). */
  portStyle: 'slot' | 'round';
  /** Tube used for round ports (data/hardware.ts) and its measured bore, mm. */
  tubeKey: string;
  tubeIdMm: number;
}

export const DEFAULT_DESIGN: Design = {
  boxType: 'vented', vbL: 100, fbHz: 32, portAreaCm2: 240,
  vfL: 40, fb2Hz: 60, port2AreaCm2: 180,
  prSdCm2: 855, prMassG: 400, prCmsMmN: 0.3, prCount: 1, // ≈30 Hz in 100 L
  ql: 10, stuffing: 0, fillKey: 'polyfill', cldKey: 'none', count: 1, wiring: 'parallel', coilWiring: 'series',
  watts: 1000, amp: false, ampW: 1000, ampOhms: 4, ampMinOhms: 2, dampingFactor: 200, wireM: 0, wireAwg: 12,
  subsonic: true, subsonicHz: 25,
  materialKey: 'mdf', thicknessMm: 18, finish: 'walnut',
  shape: 'box', wedgeTopPct: 60, wMode: 'auto', wMm: 600, hMode: 'auto', hMm: 450, dMode: 'auto', dMm: 400,
  rowMode: 'auto', rowXMm: 0, rowYMm: 300,
  portStyle: 'slot', tubeKey: 'pvc_4', tubeIdMm: 105
};

export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }
export type Backend = 'webgpu' | 'webgl' | 'none';
/** Main tabs that are still on the roadmap; clicking one shows what it will do. */
export type Teaser = 'ai';

interface State {
  mode: Mode;
  drivers: DriverDto[];
  driversSource: Source | 'loading';
  materials: PanelMaterialDto[];
  damping: DampingMaterialDto[];
  driverId: number | null;
  design: Design;
  /** Earlier designs (most recent last) and undone ones, for undo / redo. */
  past: Design[];
  future: Design[];
  genHz: number;
  slow: number;
  playing: boolean;
  overlays: Record<OverlayId, boolean>;
  chart: ChartId;
  /** Saved designs drawn over the graphs (A/B/C), and which of them are shown. */
  slots: Record<SlotId, Slot | null>;
  slotShown: Record<SlotId, boolean>;
  /** Formula notebook: open (optionally at one entry) or closed. */
  notebook: { focus: string | null } | null;
  /** Bumped whenever a driver photo is saved or removed, so every view reloads its photos. */
  mediaVersion: number;
  tool: string;
  backend: Backend | null;
  toast: Toast | null;
  teaser: Teaser | null;
  setMode: (m: Mode) => void;
  setDrivers: (d: DriverDto[], source: Source) => void;
  setMaterials: (m: PanelMaterialDto[]) => void;
  setDamping: (m: DampingMaterialDto[]) => void;
  selectDriver: (id: number) => void;
  /** Adds or replaces a driver in the list (after it was saved). */
  upsertDriver: (d: DriverDto) => void;
  removeDriver: (id: number) => void;
  /**
   * Changes the design. `history: false` leaves no undo step (the automatic first box);
   * `merge: true` folds the change into the last step (the rest of a drag after its first move).
   */
  patchDesign: (p: Partial<Design>, opts?: { history?: boolean; merge?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  setGen: (hz: number) => void;
  setSlow: (s: number) => void;
  togglePlay: () => void;
  toggleOverlay: (id: OverlayId) => void;
  setChart: (c: ChartId) => void;
  saveSlot: (id: SlotId, slot: Slot) => void;
  clearSlot: (id: SlotId) => void;
  toggleSlot: (id: SlotId) => void;
  openNotebook: (focus?: string | null) => void;
  closeNotebook: () => void;
  bumpMedia: () => void;
  setTool: (t: string) => void;
  setBackend: (b: Backend) => void;
  showToast: (text: string, action?: Toast['action']) => void;
  dismissToast: () => void;
  setTeaser: (t: Teaser | null) => void;
}

let toastId = 0;

const SAVED_KEY = 'bassbuild.design.v1';
const HISTORY = 100;
/** Changes to the same settings this close together are one undo step (a slider drag, typing). */
const COALESCE_MS = 700;
let lastStep = { at: 0, keys: '' };

/** The design and driver left open last time (this browser only), or the defaults. */
function readSaved(): { design: Design; driverId: number | null } {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return { design: DEFAULT_DESIGN, driverId: null };
    const v = JSON.parse(raw) as { design?: unknown; driverId?: unknown };
    return { design: sanitizeDesign(v.design, DEFAULT_DESIGN), driverId: typeof v.driverId === 'number' ? v.driverId : null };
  } catch {
    return { design: DEFAULT_DESIGN, driverId: null };
  }
}
const saved = readSaved();

export const useApp = create<State>((set) => ({
  mode: 'lab',
  drivers: [],
  driversSource: 'loading',
  materials: [],
  damping: [],
  driverId: saved.driverId,
  design: saved.design,
  past: [],
  future: [],
  genHz: 40,
  slow: 100,
  playing: true,
  overlays: { wave: true, air: true, smoke: true, ir: false, vib: false, balloon: false, xray: false },
  chart: 'spl',
  slots: readSlots(),
  slotShown: { A: true, B: true, C: true },
  notebook: null,
  mediaVersion: 0,
  tool: 'select',
  backend: null,
  toast: null,
  teaser: null,
  setMode: (mode) => set({ mode }),
  setDrivers: (drivers, source) => set((s) => ({
    drivers,
    driversSource: source,
    // Keep the current choice if it still exists; otherwise start on a Thai-made 18" outdoor
    // woofer from the datasheet set (the made-up sample if the seed is missing), then the first.
    driverId: drivers.some((d) => d.id === s.driverId) ? s.driverId
      : (drivers.find((d) => d.brand === 'P.Audio' && d.model === '18BMA-2000S') ?? drivers.find((d) => d.model === 'SPL-15') ?? drivers[0])?.id ?? null
  })),
  setMaterials: (materials) => set({ materials }),
  setDamping: (damping) => set({ damping }),
  // Saved comparisons survive a driver change on purpose: comparing drivers is what they are for.
  selectDriver: (driverId) => set({ driverId }),
  upsertDriver: (d) => set((s) => ({ drivers: s.drivers.some((x) => x.id === d.id) ? s.drivers.map((x) => (x.id === d.id ? d : x)) : [...s.drivers, d] })),
  removeDriver: (id) => set((s) => {
    const drivers = s.drivers.filter((x) => x.id !== id);
    // Never leave the lab pointing at a driver that is gone.
    return { drivers, driverId: s.driverId === id ? (drivers[0]?.id ?? null) : s.driverId };
  }),
  patchDesign: (p, opts) => set((s) => {
    const design = { ...s.design, ...p };
    const changed = (Object.keys(p) as (keyof Design)[]).filter((k) => s.design[k] !== design[k]);
    if (!changed.length) return {};
    if (opts?.history === false) return { design };
    // Grouped by what the change sets, not by which values moved: a drag that sometimes moves
    // only one of its two numbers is still one step.
    const keys = Object.keys(p).sort().join(',');
    const now = Date.now();
    const same = s.past.length > 0 && (opts?.merge || (keys === lastStep.keys && now - lastStep.at < COALESCE_MS));
    lastStep = { at: now, keys };
    return { design, past: same ? s.past : [...s.past, s.design].slice(-HISTORY), future: [] };
  }),
  undo: () => set((s) => {
    const prev = s.past[s.past.length - 1];
    if (!prev) return {};
    lastStep = { at: 0, keys: '' };
    return { design: prev, past: s.past.slice(0, -1), future: [s.design, ...s.future].slice(0, HISTORY) };
  }),
  redo: () => set((s) => {
    const next = s.future[0];
    if (!next) return {};
    lastStep = { at: 0, keys: '' };
    return { design: next, past: [...s.past, s.design].slice(-HISTORY), future: s.future.slice(1) };
  }),
  setGen: (genHz) => set({ genHz }),
  setSlow: (slow) => set({ slow }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  toggleOverlay: (id) => set((s) => ({ overlays: { ...s.overlays, [id]: !s.overlays[id] } })),
  setChart: (chart) => set({ chart }),
  saveSlot: (id, slot) => set((s) => ({ slots: { ...s.slots, [id]: slot }, slotShown: { ...s.slotShown, [id]: true } })),
  clearSlot: (id) => set((s) => ({ slots: { ...s.slots, [id]: null } })),
  toggleSlot: (id) => set((s) => ({ slotShown: { ...s.slotShown, [id]: !s.slotShown[id] } })),
  openNotebook: (focus = null) => set({ notebook: { focus } }),
  closeNotebook: () => set({ notebook: null }),
  bumpMedia: () => set((s) => ({ mediaVersion: s.mediaVersion + 1 })),
  setTool: (tool) => set({ tool }),
  setBackend: (backend) => set({ backend }),
  showToast: (text, action) => set({ toast: { id: ++toastId, text, action } }),
  dismissToast: () => set({ toast: null }),
  setTeaser: (teaser) => set({ teaser })
}));

// Saved comparisons outlive a reload (this browser only).
useApp.subscribe((s, prev) => { if (s.slots !== prev.slots) writeSlots(s.slots); });

// The open design is saved as it changes, so a reload or a closed tab loses nothing.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useApp.subscribe((s, prev) => {
  if (s.design === prev.design && s.driverId === prev.driverId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const now = useApp.getState();
      localStorage.setItem(SAVED_KEY, JSON.stringify({ design: now.design, driverId: now.driverId }));
    } catch {
      // Private mode or full storage: the design still lives until the page is closed.
    }
  }, 400);
});
