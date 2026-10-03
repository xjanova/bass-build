import type { Curves } from '@bassbuild/physics';
import { create } from 'zustand';
import type { Source } from '../data/api';
import type { DriverDto, PanelMaterialDto } from '../data/types';

export type BoxType = 'sealed' | 'vented' | 'pr' | 'bp4' | 'bp6' | 'isobaric';
export type OverlayId = 'wave' | 'air' | 'smoke' | 'ir' | 'vib' | 'balloon' | 'xray';
export type ChartId = 'spl' | 'imp' | 'exc' | 'vel' | 'gd';
export type Mode = 'design' | 'lab';

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
  count: number;
  wiring: 'parallel' | 'series';
  watts: number;
  subsonic: boolean;
  subsonicHz: number;
  materialKey: string;
  thicknessMm: number;
}

export const DEFAULT_DESIGN: Design = {
  boxType: 'vented', vbL: 100, fbHz: 32, portAreaCm2: 240,
  vfL: 40, fb2Hz: 60, port2AreaCm2: 180,
  prSdCm2: 855, prMassG: 400, prCmsMmN: 0.3, prCount: 1, // ≈30 Hz in 100 L
  ql: 10, stuffing: 0, count: 1, wiring: 'parallel',
  watts: 1000, subsonic: true, subsonicHz: 25,
  materialKey: 'mdf', thicknessMm: 18
};

interface State {
  mode: Mode;
  drivers: DriverDto[];
  driversSource: Source | 'loading';
  materials: PanelMaterialDto[];
  driverId: number | null;
  design: Design;
  genHz: number;
  slow: number;
  playing: boolean;
  overlays: Record<OverlayId, boolean>;
  chart: ChartId;
  ghost: Curves | null;
  tool: string;
  setMode: (m: Mode) => void;
  setDrivers: (d: DriverDto[], source: Source) => void;
  setMaterials: (m: PanelMaterialDto[]) => void;
  selectDriver: (id: number) => void;
  patchDesign: (p: Partial<Design>) => void;
  setGen: (hz: number) => void;
  setSlow: (s: number) => void;
  togglePlay: () => void;
  toggleOverlay: (id: OverlayId) => void;
  setChart: (c: ChartId) => void;
  setGhost: (c: Curves | null) => void;
  setTool: (t: string) => void;
}

export const useApp = create<State>((set) => ({
  mode: 'lab',
  drivers: [],
  driversSource: 'loading',
  materials: [],
  driverId: null,
  design: DEFAULT_DESIGN,
  genHz: 40,
  slow: 100,
  playing: true,
  overlays: { wave: true, air: true, smoke: true, ir: false, vib: false, balloon: false, xray: false },
  chart: 'spl',
  ghost: null,
  tool: 'select',
  setMode: (mode) => set({ mode }),
  setDrivers: (drivers, source) => set((s) => ({
    drivers,
    driversSource: source,
    // Keep the current choice if it still exists; otherwise prefer the 15" sample, then the first.
    driverId: drivers.some((d) => d.id === s.driverId) ? s.driverId : (drivers.find((d) => d.model === 'SPL-15') ?? drivers[0])?.id ?? null
  })),
  setMaterials: (materials) => set({ materials }),
  selectDriver: (driverId) => set({ driverId, ghost: null }),
  patchDesign: (p) => set((s) => ({ design: { ...s.design, ...p } })),
  setGen: (genHz) => set({ genHz }),
  setSlow: (slow) => set({ slow }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  toggleOverlay: (id) => set((s) => ({ overlays: { ...s.overlays, [id]: !s.overlays[id] } })),
  setChart: (chart) => set({ chart }),
  setGhost: (ghost) => set({ ghost }),
  setTool: (tool) => set({ tool })
}));
