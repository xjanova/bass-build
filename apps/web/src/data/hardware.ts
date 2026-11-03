import seed from '../../../../data/seed/materials.json';

/** A round tube a port can be made from: PVC pipe sold by outside size, or a flared port tube sold by inside size. */
export interface Tube {
  key: string;
  name: string;
  /** Outside diameter (sets the hole), mm; estimated for port tubes sold by their bore. */
  odMm: number;
  /** Typical bore, mm: an estimate the user replaces with the measured one. */
  idMm: number;
  /** Where the sizes came from: 'od' known (PVC), 'id' known (port tube). */
  known: 'od' | 'id';
  notes: string | null;
}

interface HardwareRow { key: string; kind: string; name: string; odMm: number | null; idMm: number | null; notes?: string | null }

/**
 * PVC walls run about 4 % of the outside diameter in the common pressure classes; a flared port
 * tube's wall is about 3 mm. Both are starting points: the bore must be measured on the real tube.
 */
export const TUBES: Tube[] = ((seed as unknown as { hardware: HardwareRow[] }).hardware ?? [])
  .filter((h) => (h.kind === 'pvc_pipe' && h.odMm) || (h.kind === 'port_tube' && h.idMm))
  .map((h) => h.kind === 'pvc_pipe'
    ? { key: h.key, name: h.name, odMm: h.odMm!, idMm: h.idMm ?? Math.round(h.odMm! * 0.92), known: 'od' as const, notes: h.notes ?? null }
    : { key: h.key, name: h.name, odMm: h.odMm ?? h.idMm! + 6, idMm: h.idMm!, known: 'id' as const, notes: h.notes ?? null });

export const tubeOf = (key: string): Tube | undefined => TUBES.find((t) => t.key === key);

/** The terminal cup from the seed (name and its hole note, which is itself an estimate: "ตรวจกับสินค้าจริง"). */
export const TERMINAL_CUP: { name: string; notes: string | null } | undefined = ((seed as unknown as { hardware: HardwareRow[] }).hardware ?? [])
  .filter((h) => h.kind === 'terminal').map((h) => ({ name: h.name, notes: h.notes ?? null }))[0];
