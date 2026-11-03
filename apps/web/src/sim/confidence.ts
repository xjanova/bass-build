import { checkConsistency, driverInputFromDto, type SimResult } from '@bassbuild/physics';
import type { DriverDto } from '../data/types';
import type { Design, OverlayId } from '../state/store';
import { isDvc, measuredWiring, type BoxGeometry } from './model';

/**
 * How far each number or picture can be trusted (plan §0): engineering (a validated model with
 * good data), numerical estimate (a model, but with assumed or uncertain inputs), or
 * phenomenological picture (looks like the physics, is not computed from it).
 */
export type Level = 'eng' | 'est' | 'viz';
export interface Conf { level: Level; why: string }

export const LEVEL_TH: Record<Level, string> = { eng: 'วิศวกรรม', est: 'ประมาณเชิงตัวเลข', viz: 'ภาพเชิงปรากฏการณ์' };
export const LEVEL_COLOR: Record<Level, string> = { eng: 'var(--good)', est: '#facc15', viz: 'var(--heat)' };

export type ResultKey =
  | 'f3' | 'tuning' | 'splMax' | 'excursion' | 'portVelocity' | 'portLength'
  | 'impedance' | 'groupDelay' | 'maxSpl' | 'size' | 'panelModes' | 'thermal';

const LUMPED = 'วงจรเทียบ Thiele/Small (Modified Nodal Analysis) ตรวจกับสูตรปิดแล้ว';

/** Why the driver data itself is not datasheet-grade, or null when it is. */
export function driverDoubt(dto: DriverDto | undefined): string | null {
  if (!dto) return 'ยังไม่ได้เลือกลำโพง';
  if (dto.sourceKind === 'sample') return 'ลำโพงตัวอย่าง ไม่ใช่สินค้าจริง';
  if (dto.sourceKind === 'user' || dto.sourceKind === 'estimated') return 'ค่าลำโพงกรอกเองหรือประมาณ ยังไม่ได้ตรวจกับ datasheet';
  const bad = checkConsistency(driverInputFromDto(dto)).filter((c) => !c.ok);
  if (bad.length) return `สเปกลำโพงขัดกันเอง (${bad.map((c) => c.id.toUpperCase()).join(', ')})`;
  if (isDvc(dto) && !measuredWiring(dto).known) return 'ไม่รู้ว่า T/S วัดตอนต่อคอยล์แบบไหน จึงเดาจากอิมพีแดนซ์';
  return null;
}

/** One confidence per headline result, from the same inputs the lab uses. */
export function resultConfidence(d: Design, dto: DriverDto | undefined, res: SimResult | null, geo: BoxGeometry | null): Record<ResultKey, Conf> {
  const doubt = driverDoubt(dto);
  const fill = (d.boxType === 'sealed' || d.boxType === 'vented' || d.boxType === 'pr') && d.stuffing > 0;
  const fast = (res?.metrics.portVelocityMax.ms ?? 0) > 30;
  const pr = d.boxType === 'pr';
  /** Engineering unless one of the given doubts applies; the first doubt is the reason shown. */
  const pick = (base: string, ...doubts: (string | null | false)[]): Conf => {
    const why = doubts.filter((x): x is string => !!x);
    return why.length ? { level: 'est', why: why.join(' · ') } : { level: 'eng', why: base };
  };
  const fillWhy = fill && 'ผลของใยซับเสียงเป็นค่าประมาณจากงานวิจัย ไม่ได้วัด';
  const fastWhy = fast && 'ลมในท่อเกิน 30 m/s นอกช่วงเชิงเส้น ของจริงลมจะอั้น (port compression) ดังน้อยกว่านี้';
  const prWhy = pr && 'ค่า Q ของแผ่น PR สมมติไว้ที่ 10 (ไม่มีข้อมูลผู้ผลิต)';
  const leWhy = !!dto && dto.leMh == null && 'ไม่มีค่า Le กราฟช่วงความถี่สูงจึงประมาณ';
  return {
    f3: pick(LUMPED, doubt, fillWhy, prWhy),
    tuning: pick(d.boxType === 'sealed' || d.boxType === 'isobaric' ? 'สูตรปิดของ Small: fc = Fs·√(1+α)' : 'จุดเว้าของอิมพีแดนซ์จากวงจรเทียบ', doubt, fillWhy, prWhy),
    splMax: pick(LUMPED, doubt, fillWhy, fastWhy),
    excursion: pick(LUMPED, doubt, fillWhy, fastWhy),
    portVelocity: pick('ปริมาณลมผ่านท่อจากวงจรเทียบ หารด้วยพื้นที่ท่อ', doubt, fastWhy),
    portLength: pick('ความยาวท่อจากมวลอากาศ + end correction (0.85r ปลายมีหน้าแปลน + 0.61r ปลายลอย)', geo?.portFold === 'L' && 'ท่อพับมุม ความยาวจริงคลาดได้เล็กน้อยที่ข้อพับ'),
    impedance: pick(LUMPED, doubt, leWhy),
    groupDelay: pick(LUMPED, doubt, fillWhy),
    maxSpl: { level: 'est', why: ['ขีดความร้อนใช้กำลังพิกัดแบบ nominal ไม่รวม power compression', dto?.xmaxMm ? null : 'ลำโพงไม่มีค่า Xmax จึงไม่รวมขีดระยะชัก', doubt].filter(Boolean).join(' · ') },
    size: { level: 'est', why: `ขนาดจากสัดส่วนตั้งต้น 1.25 : 1 : 0.8 ที่ขยายให้ใส่ลำโพงและท่อได้ น้ำหนักรวมโครงค้ำ (หน้าต่างชุดละราวครึ่งแผ่น)${d.terminal === 'cup' || d.handles === 'recessed' ? ' · ที่ที่ขั้วต่อและมือจับฝังกินในตู้คิดจากขนาดทั่วไป (ประมาณ)' : ''}` },
    panelModes: { level: 'est', why: 'แผ่นสี่เหลี่ยมขอบยึดแบบ simply supported (สูตร Kirchhoff) ของจริงยึดแน่นกว่าจะสูงขึ้นได้ถึงราว 1.8 เท่า · โครงค้ำคิดเป็นเส้นยึด (เดือยยึดเป็นจุด ของจริงช่วยน้อยกว่านี้)' },
    thermal: { level: 'est', why: 'โมเดลความร้อน 2 จุด (คอยล์–แม่เหล็ก) จากกำลังพิกัด เพราะ datasheet ไม่มีค่าความต้านทานความร้อน' }
  };
}

/** Each 3D view mode, by what is behind the picture. */
export const OVERLAY_CONF: Record<OverlayId, Conf | null> = {
  wave: { level: 'viz', why: 'คลื่นจากแหล่งกำเนิดจุด 2 จุด (กรวยและปากท่อ) ใช้เฟสจากวงจรเทียบ แต่ไม่ได้แก้สมการคลื่น 3 มิติ (FDTD มาในเฟส 6)' },
  air: { level: 'est', why: 'ความเร็วลมในท่อคำนวณจากวงจรเทียบ ส่วนทิศทางลูกศรเป็นภาพประกอบ' },
  smoke: { level: 'viz', why: 'ควันเป็นภาพเชิงปรากฏการณ์ที่ขยับตามความเร็วลมที่คำนวณได้ ไม่ได้แก้สมการการไหล (LBM มาในเฟส 7)' },
  ir: { level: 'est', why: 'อุณหภูมิจากโมเดลความร้อน 2 จุดจากกำลังพิกัด สีบนตัวตู้เป็นภาพประกอบ' },
  vib: { level: 'est', why: 'ผนังสั่นด้วยโหมด (1,1) เดียวของแผ่นขอบยึดแบบ simply supported ขยายภาพเกินจริง' },
  balloon: { level: 'est', why: 'ทิศทางเสียงของลูกสูบในแผงกั้นอนันต์ ไม่รวมการเลี้ยวเบนรอบตัวตู้' },
  xray: null
};
