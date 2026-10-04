import { AIR_20C, checkConsistency, completeDriver, driverInputFromDto, DriverError, type ConsistencyCheck } from '@bassbuild/physics';
import type { Source } from './api';
import type { DriverDraft } from './importers';
import type { DriverDto } from './types';

/**
 * Drivers the user adds live in the C# server's SQLite when it runs. The public website has no
 * server, so they live in this browser's localStorage instead (per browser, per device).
 */
const KEY = 'bassbuild.userDrivers.v1';
export const LOCAL_ID_BASE = 1_000_000;

export function readLocalDrivers(): DriverDto[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as DriverDto[]) : [];
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'number' && typeof d.fs === 'number') : [];
  } catch {
    return [];
  }
}

function writeLocalDrivers(list: DriverDto[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export type SaveResult = { ok: true; driver: DriverDto } | { ok: false; field?: string; message: string };

const isLocal = (source: Source | 'loading') => source !== 'server';

/** Creates (no id) or replaces a user driver, on the server or in this browser. */
export async function saveDriver(draft: DriverDraft, id: number | null, source: Source | 'loading'): Promise<SaveResult> {
  if (isLocal(source)) {
    const list = readLocalDrivers();
    const nextId = Math.max(LOCAL_ID_BASE, ...list.map((d) => d.id)) + 1;
    const driver: DriverDto = { ...draft, id: id ?? nextId };
    const updated = id === null ? [...list, driver] : list.map((d) => (d.id === id ? driver : d));
    if (!writeLocalDrivers(updated)) return { ok: false, message: 'บันทึกในเบราว์เซอร์นี้ไม่ได้ (โหมดส่วนตัวหรือพื้นที่เต็ม)' };
    return { ok: true, driver };
  }
  try {
    const res = await fetch(id === null ? '/api/drivers' : `/api/drivers/${id}`, {
      method: id === null ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(draft)
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, field: body?.field, message: body?.message ?? `บันทึกไม่สำเร็จ (${res.status})` };
    return { ok: true, driver: body as DriverDto };
  } catch {
    return { ok: false, message: 'ติดต่อเซิร์ฟเวอร์ไม่ได้ บันทึกไม่สำเร็จ' };
  }
}

export async function deleteDriver(id: number, source: Source | 'loading'): Promise<boolean> {
  if (isLocal(source)) return writeLocalDrivers(readLocalDrivers().filter((d) => d.id !== id));
  try {
    const res = await fetch(`/api/drivers/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

/** A driver the user may edit or delete: anything they entered, never the bundled datasheet set. */
export const isEditable = (d: DriverDto, source: Source | 'loading') =>
  isLocal(source) ? d.id >= LOCAL_ID_BASE : d.sourceKind === 'user' || d.sourceKind === 'measured' || d.sourceKind === 'estimated';

// ---- validation (same limits as the server's Validation.cs) --------------------------------------

const RANGES: [keyof DriverDraft, string, number, number, string][] = [
  ['fs', 'Fs', 1, 20000, 'Hz'], ['qts', 'Qts', 0.05, 10, ''], ['qes', 'Qes', 0.05, 10, ''], ['qms', 'Qms', 0.2, 100, ''],
  ['vasL', 'Vas', 0.01, 20000, 'ลิตร'], ['re', 'Re', 0.1, 100, 'โอห์ม'], ['sdCm2', 'Sd', 1, 20000, 'ตร.ซม.'],
  ['xmaxMm', 'Xmax', 0, 100, 'มม.'], ['peW', 'กำลังขับ Pe', 0, 100000, 'W'], ['sizeIn', 'ขนาดลำโพง', 0.5, 30, 'นิ้ว']
];

export function validateDraft(d: DriverDraft, others: DriverDto[], id: number | null): { field: string; message: string } | null {
  if (!d.brand.trim()) return { field: 'brand', message: 'กรอกยี่ห้อ' };
  if (!d.model.trim()) return { field: 'model', message: 'กรอกรุ่น' };
  if (!d.fs) return { field: 'fs', message: 'กรอกค่า Fs' };
  for (const [f, label, lo, hi, unit] of RANGES) {
    const v = d[f] as number | null;
    if (v !== null && (v < lo || v > hi)) return { field: f, message: `${label} ต้องอยู่ระหว่าง ${lo}–${hi}${unit ? ' ' + unit : ''}` };
  }
  const same = others.find((o) => o.id !== id && o.brand.trim().toLowerCase() === d.brand.trim().toLowerCase() && o.model.trim().toLowerCase() === d.model.trim().toLowerCase());
  if (same) return { field: 'model', message: 'มีลำโพงยี่ห้อนี้และรุ่นนี้อยู่แล้ว' };
  return null;
}

// ---- derived values ------------------------------------------------------------------------------

/** UI fields the physics can fill in, with the factor from SI to the UI unit. */
export const DERIVABLE: { field: keyof DriverDraft; si: string; scale: number; label: string; unit: string; digits: number }[] = [
  { field: 'fs', si: 'fs', scale: 1, label: 'Fs', unit: 'Hz', digits: 1 },
  { field: 'qts', si: 'qts', scale: 1, label: 'Qts', unit: '', digits: 3 },
  { field: 'qes', si: 'qes', scale: 1, label: 'Qes', unit: '', digits: 3 },
  { field: 'qms', si: 'qms', scale: 1, label: 'Qms', unit: '', digits: 2 },
  { field: 'vasL', si: 'vas', scale: 1000, label: 'Vas', unit: 'L', digits: 1 },
  { field: 're', si: 're', scale: 1, label: 'Re', unit: 'Ω', digits: 2 },
  { field: 'bl', si: 'bl', scale: 1, label: 'Bl', unit: 'T·m', digits: 2 },
  { field: 'mmsG', si: 'mms', scale: 1000, label: 'Mms', unit: 'g', digits: 1 },
  { field: 'cmsMmPerN', si: 'cms', scale: 1000, label: 'Cms', unit: 'mm/N', digits: 4 },
  { field: 'rms', si: 'rms', scale: 1, label: 'Rms', unit: 'kg/s', digits: 2 },
  { field: 'sdCm2', si: 'sd', scale: 1e4, label: 'Sd', unit: 'cm²', digits: 0 }
];

export interface Derived {
  /** Value per field and whether it was computed rather than published. */
  values: Partial<Record<keyof DriverDraft, { v: number; derived: boolean }>>;
  missing: string[];
  checks: ConsistencyCheck[];
  ebp: number | null;
  spl1w: number | null;
}

export function derive(d: DriverDraft): Derived {
  const input = driverInputFromDto(d);
  const values: Derived['values'] = {};
  let missing: string[] = [];
  try {
    const full = completeDriver(input) as unknown as Record<string, number>;
    for (const x of DERIVABLE) {
      const given = d[x.field] as number | null;
      values[x.field] = given !== null && given !== undefined ? { v: given, derived: false } : { v: full[x.si] * x.scale, derived: true };
    }
  } catch (e) {
    if (!(e instanceof DriverError)) throw e;
    missing = e.missing;
    for (const x of DERIVABLE) { const given = d[x.field] as number | null; if (given) values[x.field] = { v: given, derived: false }; }
  }
  const fs = values.fs?.v ?? null, qes = values.qes?.v ?? null, vasL = values.vasL?.v ?? null;
  const ebp = fs && qes ? fs / qes : null;
  // Half-space 1 W / 1 m from η0 = 4π²/c³ · Fs³·Vas/Qes.
  const eta0 = fs && qes && vasL ? ((4 * Math.PI ** 2) / AIR_20C.c ** 3) * fs ** 3 * (vasL / 1000) / qes : null;
  const spl1w = eta0 ? 10 * Math.log10((AIR_20C.rho * AIR_20C.c) / (2 * Math.PI * 4e-10)) + 10 * Math.log10(eta0) : null;
  return { values, missing, checks: checkConsistency(input), ebp, spl1w };
}

export const MISSING_TH: Record<string, string> = {
  fs: 'Fs', qes: 'Qes', qms: 'Qms', qts: 'Qts', vas: 'Vas', re: 'Re', sd: 'Sd', mms: 'Mms', cms: 'Cms', rms: 'Rms', bl: 'Bl'
};

/** Which boxes suit the driver, from EBP = Fs/Qes and Qts (Small's rules of thumb). */
export function suitability(ebp: number | null, qts: number | null): { text: string; tone: 'sealed' | 'both' | 'vented' | 'free' } | null {
  if (qts !== null && qts > 0.7) return { text: 'Qts สูง เหมาะติดผนัง (free-air/IB) หรือตู้ปิดใบใหญ่', tone: 'free' };
  if (ebp === null) return qts === null ? null : qts < 0.4 ? { text: 'Qts ต่ำ เหมาะตู้เปิด/แบนด์พาส', tone: 'vented' } : { text: 'Qts กลางถึงสูง เหมาะตู้ปิด', tone: 'sealed' };
  if (ebp < 50) return { text: `EBP ${ebp.toFixed(0)} — เหมาะตู้ปิด`, tone: 'sealed' };
  if (ebp > 100) return { text: `EBP ${ebp.toFixed(0)} — เหมาะตู้เปิด / แบนด์พาส / ฮอร์น`, tone: 'vented' };
  return { text: `EBP ${ebp.toFixed(0)} — ใช้ได้ทั้งตู้ปิดและตู้เปิด`, tone: 'both' };
}
