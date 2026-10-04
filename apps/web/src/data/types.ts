/** Shapes returned by the C# server (camelCase JSON). */
export interface DriverDto {
  id: number;
  brand: string;
  model: string;
  category: string;
  kindTh: string | null;
  sizeIn: number | null;
  fs: number;
  qts: number | null;
  qes: number | null;
  qms: number | null;
  vasL: number | null;
  re: number | null;
  leMh: number | null;
  bl: number | null;
  mmsG: number | null;
  cmsMmPerN: number | null;
  rms: number | null;
  sdCm2: number | null;
  xmaxMm: number | null;
  xmechMm?: number | null;
  peW: number | null;
  splDb: number | null;
  zNom: number | null;
  coil: string | null;
  /** Coil wiring a dual-voice-coil driver's T/S were measured with; null when single-coil or not stated. */
  coilWiring?: 'series' | 'parallel' | null;
  cutoutMm: number | null;
  outerMm: number | null;
  depthMm: number | null;
  displacementL: number | null;
  sourceKind: string;
  sourceUrl: string | null;
  verified: boolean;
  notes: string | null;
}

export interface PanelMaterialDto {
  id: number;
  key: string;
  name: string;
  nameTh: string | null;
  densityKgM3: number | null;
  eGpa: number | null;
  eCrossGpa: number | null;
  poisson: number | null;
  lossFactor: number | null;
  thicknessesMm: number[];
}

export interface DampingMaterialDto {
  id: number;
  key: string;
  name: string;
  nameTh: string | null;
  /** fiber / foam / felt fill the air space; cld sheets damp the panels. */
  kind: string | null;
  densityKgM3: number | null;
  flowResistivityMin: number | null;
  flowResistivityMax: number | null;
  fillGPerLMin: number | null;
  fillGPerLMax: number | null;
  porosity: number | null;
}
