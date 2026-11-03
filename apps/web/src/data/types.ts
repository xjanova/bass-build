/** Shapes returned by the C# server (camelCase JSON). */

/** What to measure on a driver for its 3D model (all optional; missing ones are estimated). */
export interface DriverShape {
  coneMm?: number | null; // effective cone diameter, to the middle of the surround
  surroundMm?: number | null; // surround width
  dustcapMm?: number | null;
  coneDepthMm?: number | null; // from the surround down to the dust cap
  flangeMm?: number | null; // frame flange thickness
  magnetMm?: number | null;
  magnetHeightMm?: number | null;
  boltHoles?: number | null;
  boltCircleMm?: number | null;
}
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
  /** Geometry measured on the real driver, mm (bolt holes as a count); shapes its 3D model. */
  shape?: DriverShape | null;
  /** Link to an official product photo (shown by link only). */
  imageUrl?: string | null;
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
  /** Stock sheet size and price, when known. */
  sheetWMm?: number | null;
  sheetHMm?: number | null;
  pricePerSheetThb?: number | null;
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
