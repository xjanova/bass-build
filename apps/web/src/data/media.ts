import type { Source } from './api';

/**
 * The user's photos of a driver, one per angle the 3D model needs. Behind the C# server they live
 * in SQLite (driver_media); on the public website, in this browser's IndexedDB.
 */
export type Angle = 'front' | 'side' | 'rear' | 'angle';
/** Alignment marks in image fractions (0..1 of width and height), so they survive resizing. */
export interface Marks { circle?: [number, number][]; axis?: [number, number][] }
export interface MediaItem { angle: Angle; mime: string; marks: Marks | null; blob: Blob }

export const ANGLES: { id: Angle; title: string; how: string; mark: 'circle' | 'axis' | null; markHow: string; use: string }[] = [
  {
    id: 'front', title: 'หน้าตรง', mark: 'circle',
    how: 'วางลำโพงหงายบนพื้นเรียบ ถ่ายจากด้านบนให้กล้องตั้งฉากกับหน้าลำโพงพอดี ยืนห่างอย่างน้อย 1 ม. แล้วซูมให้ลำโพงเต็มกรอบราว 80% (ลดความบิดเบี้ยวของเลนส์) แสงสม่ำเสมอ ไม่มีเงาแข็ง',
    markHow: 'แตะ 3 จุดบนขอบนอกสุดของโครงลำโพง ห่างกันพอสมควร',
    use: 'เป็นผิวหน้าของโมเดล: กรวย ขอบยาง ฝาครอบ และโครง'
  },
  {
    id: 'side', title: 'ข้างตรง', mark: 'axis',
    how: 'ตะแคงลำโพงหรือวางคว่ำบนกล่อง ถ่ายจากด้านข้างระดับเดียวกับลำโพง ให้เห็นตั้งแต่หน้าโครงจนถึงท้ายแม่เหล็กในรูปเดียว กล้องตั้งฉากกับแกนลำโพง',
    markHow: 'แตะ 2 จุดบนแกนกลาง: จุดแรกที่หน้าโครง จุดที่สองที่ท้ายแม่เหล็ก',
    use: 'เป็นผิวรอบแม่เหล็ก'
  },
  {
    id: 'rear', title: 'หลังตรง', mark: 'circle',
    how: 'คว่ำลำโพงบนพื้นเรียบ ถ่ายจากด้านบนตั้งฉากกับท้ายแม่เหล็ก ให้เห็นป้ายรุ่นชัด',
    markHow: 'แตะ 3 จุดบนขอบท้ายแม่เหล็ก',
    use: 'เป็นผิวท้ายแม่เหล็ก (ป้ายรุ่น)'
  },
  {
    id: 'angle', title: 'เฉียง 45°', mark: null,
    how: 'ถ่ายเฉียงจากด้านหน้าประมาณ 45° ให้เห็นทั้งหน้าและด้านข้าง',
    markHow: '',
    use: 'รูปประจำรุ่นในคลังลำโพง'
  }
];

// ---- IndexedDB (static site) ----------------------------------------------------------------------

const DB = 'bassbuild';
const STORE = 'media';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: ['driverId', 'angle'] });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = run(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

type Row = { driverId: number; angle: Angle; mime: string; marks: Marks | null; blob: Blob };

// ---- the store ------------------------------------------------------------------------------------

const onServer = (source: Source | 'loading') => source === 'server';

export async function listMedia(driverId: number, source: Source | 'loading', signal?: AbortSignal): Promise<MediaItem[]> {
  if (onServer(source)) {
    const res = await fetch(`/api/drivers/${driverId}/media`, { signal });
    if (!res.ok) return [];
    const list = (await res.json()) as { angle: Angle; mime: string; marks: Marks | null }[];
    const items = await Promise.all(list.map(async (m) => {
      const img = await fetch(`/api/drivers/${driverId}/media/${m.angle}`, { signal });
      return img.ok ? { angle: m.angle, mime: m.mime, marks: m.marks, blob: await img.blob() } : null;
    }));
    return items.filter((x): x is MediaItem => !!x);
  }
  try {
    const rows = await tx<Row[]>('readonly', (s) => s.getAll(IDBKeyRange.bound([driverId, ''], [driverId, '￿'])) as IDBRequest<Row[]>);
    return rows.map(({ angle, mime, marks, blob }) => ({ angle, mime, marks, blob }));
  } catch {
    return []; // private mode or storage blocked: no photos, the generic model is used
  }
}

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function putMedia(driverId: number, angle: Angle, blob: Blob, marks: Marks | null, source: Source | 'loading'): Promise<{ ok: true } | { ok: false; message: string }> {
  if (onServer(source)) {
    try {
      const res = await fetch(`/api/drivers/${driverId}/media/${angle}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mime: blob.type, data: await toBase64(blob), marks })
      });
      if (res.ok) return { ok: true };
      const body = await res.json().catch(() => null);
      return { ok: false, message: body?.message ?? `บันทึกรูปไม่สำเร็จ (${res.status})` };
    } catch {
      return { ok: false, message: 'ติดต่อเซิร์ฟเวอร์ไม่ได้ บันทึกรูปไม่สำเร็จ' };
    }
  }
  try {
    await tx('readwrite', (s) => s.put({ driverId, angle, mime: blob.type, marks, blob } satisfies Row));
    return { ok: true };
  } catch {
    return { ok: false, message: 'บันทึกรูปในเบราว์เซอร์นี้ไม่ได้ (โหมดส่วนตัวหรือพื้นที่เต็ม)' };
  }
}

export async function deleteMedia(driverId: number, angle: Angle, source: Source | 'loading'): Promise<boolean> {
  if (onServer(source)) {
    try { return (await fetch(`/api/drivers/${driverId}/media/${angle}`, { method: 'DELETE' })).ok; } catch { return false; }
  }
  try { await tx('readwrite', (s) => s.delete([driverId, angle])); return true; } catch { return false; }
}
