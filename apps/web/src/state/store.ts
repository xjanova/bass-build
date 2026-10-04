import type { Curves } from '@bassbuild/physics';
import { create } from 'zustand';
import type { Source } from '../data/api';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../data/types';
import type { Finish } from '../viewport/finishes';

export type BoxType = 'sealed' | 'vented' | 'pr' | 'bp4' | 'bp6' | 'isobaric';
export type OverlayId = 'wave' | 'air' | 'smoke' | 'ir' | 'vib' | 'balloon' | 'xray';
export type ChartId = 'spl' | 'imp' | 'exc' | 'vel' | 'gd';
export type Mode = 'design' | 'lab' | 'library' | 'wizard';

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
  watts: number;
  subsonic: boolean;
  subsonicHz: number;
  materialKey: string;
  thicknessMm: number;
  finish: Finish;
}

export const DEFAULT_DESIGN: Design = {
  boxType: 'vented', vbL: 100, fbHz: 32, portAreaCm2: 240,
  vfL: 40, fb2Hz: 60, port2AreaCm2: 180,
  prSdCm2: 855, prMassG: 400, prCmsMmN: 0.3, prCount: 1, // ≈30 Hz in 100 L
  ql: 10, stuffing: 0, fillKey: 'polyfill', cldKey: 'none', count: 1, wiring: 'parallel',
  watts: 1000, subsonic: true, subsonicHz: 25,
  materialKey: 'mdf', thicknessMm: 18, finish: 'walnut'
};

export interface Ghost { curves: Curves; label: string }
export interface Toast { id: number; text: string; action?: { label: string; run: () => void } }
export type Backend = 'webgpu' | 'webgl' | 'none';
/** Main tabs that are still on the roadmap; clicking one shows what it will do. */
export type Teaser = 'ai' | 'blueprint';

interface State {
  mode: Mode;
  drivers: DriverDto[];
  driversSource: Source | 'loading';
  materials: PanelMaterialDto[];
  damping: DampingMaterialDto[];
  driverId: number | null;
  design: Design;
  genHz: number;
  slow: number;
  playing: boolean;
  overlays: Record<OverlayId, boolean>;
  chart: ChartId;
  ghost: Ghost | null;
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
  patchDesign: (p: Partial<Design>) => void;
  setGen: (hz: number) => void;
  setSlow: (s: number) => void;
  togglePlay: () => void;
  toggleOverlay: (id: OverlayId) => void;
  setChart: (c: ChartId) => void;
  setGhost: (g: Ghost | null) => void;
  setTool: (t: string) => void;
  setBackend: (b: Backend) => void;
  showToast: (text: string, action?: Toast['action']) => void;
  dismissToast: () => void;
  setTeaser: (t: Teaser | null) => void;
}

let toastId = 0;

export const useApp = create<State>((set) => ({
  mode: 'lab',
  drivers: [],
  driversSource: 'loading',
  materials: [],
  damping: [],
  driverId: null,
  design: DEFAULT_DESIGN,
  genHz: 40,
  slow: 100,
  playing: true,
  overlays: { wave: true, air: true, smoke: true, ir: false, vib: false, balloon: false, xray: false },
  chart: 'spl',
  ghost: null,
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
  // The comparison curve survives a driver change on purpose: comparing drivers is what it is for.
  selectDriver: (driverId) => set({ driverId }),
  upsertDriver: (d) => set((s) => ({ drivers: s.drivers.some((x) => x.id === d.id) ? s.drivers.map((x) => (x.id === d.id ? d : x)) : [...s.drivers, d] })),
  removeDriver: (id) => set((s) => {
    const drivers = s.drivers.filter((x) => x.id !== id);
    // Never leave the lab pointing at a driver that is gone.
    return { drivers, driverId: s.driverId === id ? (drivers[0]?.id ?? null) : s.driverId };
  }),
  patchDesign: (p) => set((s) => ({ design: { ...s.design, ...p } })),
  setGen: (genHz) => set({ genHz }),
  setSlow: (slow) => set({ slow }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  toggleOverlay: (id) => set((s) => ({ overlays: { ...s.overlays, [id]: !s.overlays[id] } })),
  setChart: (chart) => set({ chart }),
  setGhost: (ghost) => set({ ghost }),
  setTool: (tool) => set({ tool }),
  setBackend: (backend) => set({ backend }),
  showToast: (text, action) => set({ toast: { id: ++toastId, text, action } }),
  dismissToast: () => set({ toast: null }),
  setTeaser: (teaser) => set({ teaser })
}));
