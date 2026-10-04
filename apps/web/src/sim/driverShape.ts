import type { DriverDto, DriverShape } from '../data/types';
import { mountOf } from './model';

/**
 * The driver's geometry for its 3D model and drawings, in metres. Every part the user measured is
 * used as measured; the rest is estimated from the mounting size and Sd with proportions typical
 * of woofers, and listed in `estimated` (Thai labels) so the UI can ask for those measurements.
 */
export interface ResolvedShape {
  outerR: number;
  cutoutR: number;
  /** Effective cone radius: to the middle of the surround (where Sd is measured). */
  coneR: number;
  surroundW: number;
  dustcapR: number;
  coneDepth: number;
  flange: number;
  magnetR: number;
  magnetH: number;
  /** Mounting depth: front of the flange to the back of the magnet. */
  depth: number;
  boltHoles: number;
  boltR: number;
  estimated: string[];
}

/** Measured fields, with their Thai labels, units and limits (the server checks the same ranges). */
export const SHAPE_FIELDS: { key: keyof DriverShape; label: string; letter: string; min: number; max: number; unit: string; how: string }[] = [
  { key: 'coneMm', letter: 'A', label: 'กรวย (ถึงกลางขอบยาง)', min: 10, max: 1500, unit: 'มม.', how: 'วัดจากกลางขอบยางฝั่งหนึ่งไปอีกฝั่ง ผ่านจุดศูนย์กลาง (ใช้คำนวณ Sd ได้)' },
  { key: 'surroundMm', letter: 'B', label: 'ความกว้างขอบยาง', min: 1, max: 200, unit: 'มม.', how: 'จากขอบในถึงขอบนอกของขอบยาง' },
  { key: 'dustcapMm', letter: 'C', label: 'ฝาครอบกลาง', min: 5, max: 600, unit: 'มม.', how: 'เส้นผ่านศูนย์กลางฝาครอบกันฝุ่น' },
  { key: 'coneDepthMm', letter: 'D', label: 'ความลึกกรวย', min: 1, max: 600, unit: 'มม.', how: 'วางไม้บรรทัดพาดขอบยาง วัดลงไปถึงขอบฝาครอบ' },
  { key: 'flangeMm', letter: 'E', label: 'ความหนาขอบโครง', min: 1, max: 60, unit: 'มม.', how: 'ความหนาของขอบโครงตรงที่ขันน็อต' },
  { key: 'magnetMm', letter: 'F', label: 'แม่เหล็ก', min: 10, max: 800, unit: 'มม.', how: 'เส้นผ่านศูนย์กลางแม่เหล็กส่วนที่ใหญ่สุด' },
  { key: 'magnetHeightMm', letter: 'G', label: 'ความสูงแม่เหล็ก', min: 5, max: 400, unit: 'มม.', how: 'จากแผ่นหน้าถึงแผ่นท้ายแม่เหล็ก' },
  { key: 'boltHoles', letter: 'H', label: 'จำนวนรูน็อต', min: 0, max: 32, unit: 'รู', how: 'นับรูยึดบนขอบโครง' },
  { key: 'boltCircleMm', letter: 'I', label: 'วงรูน็อต', min: 10, max: 1600, unit: 'มม.', how: 'จากศูนย์กลางรูน็อตฝั่งหนึ่งไปอีกฝั่ง' }
];

const mm = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v / 1000 : null);

export function resolveShape(dto: DriverDto | undefined): ResolvedShape {
  const mount = mountOf(dto);
  const s = dto?.shape ?? {};
  const estimated: string[] = mount.estimated.filter((x) => x === 'ขอบนอก' || x === 'ความลึก');
  const pick = (v: number | null, est: number, label: string) => { if (v !== null) return v; estimated.push(label); return est; };
  const outerR = mount.outer / 2;
  const fromSd = dto?.sdCm2 ? Math.sqrt((dto.sdCm2 * 1e-4) / Math.PI) : null;
  const flange = pick(mm(s.flangeMm), 0.006 + 0.02 * outerR, 'ขอบโครง');
  const surroundW = pick(mm(s.surroundMm), 0.13 * outerR, 'ขอบยาง');
  // The surround's outer edge has to stay inside the frame.
  const coneR = Math.min(pick(mm(s.coneMm) !== null ? mm(s.coneMm)! / 2 : null, fromSd ?? 0.8 * outerR, 'กรวย'), outerR - surroundW / 2 - 0.004);
  const dustcapR = Math.min(pick(mm(s.dustcapMm) !== null ? mm(s.dustcapMm)! / 2 : null, 0.36 * coneR, 'ฝาครอบ'), coneR - surroundW / 2 - 0.005);
  const depth = mount.depth;
  const magnetH = Math.min(pick(mm(s.magnetHeightMm), 0.3 * depth, 'ความสูงแม่เหล็ก'), depth - flange - 0.005);
  const coneDepth = Math.min(pick(mm(s.coneDepthMm), 0.32 * coneR, 'ความลึกกรวย'), depth - magnetH - flange);
  const magnetR = pick(mm(s.magnetMm) !== null ? mm(s.magnetMm)! / 2 : null, 0.5 * outerR, 'แม่เหล็ก');
  const holes = typeof s.boltHoles === 'number' && s.boltHoles >= 0 ? Math.round(s.boltHoles) : (estimated.push('รูน็อต'), outerR < 0.1 ? 4 : 8);
  const cutoutR = mount.cutout / 2;
  const boltR = pick(mm(s.boltCircleMm) !== null ? mm(s.boltCircleMm)! / 2 : null, (outerR + Math.min(cutoutR, outerR - 0.01)) / 2, 'วงรูน็อต');
  return { outerR, cutoutR, coneR, surroundW, dustcapR, coneDepth, flange, magnetR, magnetH, depth, boltHoles: holes, boltR, estimated: [...new Set(estimated)] };
}

/** Sd from a measured cone diameter, cm². */
export const sdFromCone = (coneMm: number) => Math.PI * (coneMm / 20) ** 2;
