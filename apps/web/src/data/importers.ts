import type { DriverDto } from './types';

/** A driver read from a file, before it gets an id. */
export type DriverDraft = Omit<DriverDto, 'id'>;

export interface ImportResult {
  drivers: DriverDraft[];
  /** Thai messages about rows or fields that were skipped or guessed. */
  warnings: string[];
}

const EMPTY: DriverDraft = {
  brand: '', model: '', category: 'woofer', kindTh: null, sizeIn: null,
  fs: 0, qts: null, qes: null, qms: null, vasL: null, re: null, leMh: null, bl: null, mmsG: null,
  cmsMmPerN: null, rms: null, sdCm2: null, xmaxMm: null, xmechMm: null, peW: null, splDb: null, zNom: null, coil: null,
  cutoutMm: null, outerMm: null, depthMm: null, displacementL: null,
  sourceKind: 'user', sourceUrl: null, verified: false, notes: null
};

export const blankDriver = (): DriverDraft => ({ ...EMPTY });

/** "0,39" and " 0.39 " both read as 0.39; anything not a positive finite number is null. */
export function parseNumber(s: string | null | undefined): number | null {
  if (s == null) return null;
  const v = Number(String(s).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

const KIND_TH: Record<string, string> = { sub: 'ซับวูฟเฟอร์', woofer: 'วูฟเฟอร์', mid: 'เสียงกลาง', fullrange: 'ฟูลเรนจ์', pa: 'กลางแจ้ง / รถแห่', tweeter: 'ทวีตเตอร์' };

/** Best guess of the category from size and Fs when a file does not say. */
function guessCategory(sizeIn: number | null, fs: number): DriverDraft['category'] {
  if (sizeIn !== null && sizeIn <= 6.5 && fs > 60) return 'fullrange';
  if (sizeIn !== null && sizeIn >= 12 && fs < 45) return 'sub';
  return 'woofer';
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

// ---- WinISD .wdr ----------------------------------------------------------------------------------

/**
 * WinISD driver file: an INI [Driver] section in SI units (Vas m³, Sd m², Xmax m, Le H, Mms kg,
 * Cms m/N, Outer/Depth m, DVol m³); unknown numbers are written as 0.
 */
export function parseWdr(text: string, fileName = ''): ImportResult {
  const kv = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][\w]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) kv.set(m[1].toLowerCase(), m[2]);
  }
  const n = (k: string, scale = 1) => { const v = parseNumber(kv.get(k)); return v === null ? null : v * scale; };
  const fs = n('fs');
  if (!fs) return { drivers: [], warnings: [`${fileName || 'ไฟล์ .wdr'}: ไม่พบค่า Fs จึงนำเข้าไม่ได้`] };
  const sdCm2 = n('sd', 1e4);
  // Effective cone diameter → nominal size: a 15" driver has Sd ≈ 855 cm², Dd ≈ 33 cm.
  const sizeIn = sdCm2 ? Math.round(Math.sqrt(sdCm2 / Math.PI) * 2 / 2.54 / 0.85) : null;
  const twoCoils = n('numvc') === 2;
  const d: DriverDraft = {
    ...EMPTY,
    brand: kv.get('brand') || kv.get('manufacturer') || 'ไม่ระบุยี่ห้อ',
    model: kv.get('model') || fileName.replace(/\.wdr$/i, '') || 'ไม่ระบุรุ่น',
    fs, qts: n('qts'), qes: n('qes'), qms: n('qms'),
    vasL: n('vas', 1000), re: n('re'), leMh: n('le', 1000), bl: n('bl'),
    mmsG: n('mms', 1000), cmsMmPerN: n('cms', 1000), rms: n('rms'), sdCm2,
    xmaxMm: n('xmax', 1000), peW: n('pe'), splDb: n('spl'), zNom: n('znom'),
    coil: twoCoils ? 'DVC' : 'SVC',
    outerMm: n('outer', 1000), depthMm: n('depth', 1000), displacementL: n('dvol', 1000),
    sizeIn
  };
  d.category = guessCategory(sizeIn, fs);
  d.kindTh = KIND_TH[d.category];
  const comment = kv.get('comment');
  d.notes = ['นำเข้าจากไฟล์ WinISD (.wdr)', comment ? `หมายเหตุในไฟล์: ${comment}` : '', twoCoils ? 'วอยซ์คอยล์คู่: ค่า T/S เป็นของการต่อสายตามที่บันทึกในไฟล์' : ''].filter(Boolean).join(' · ');
  for (const k of ['qts', 'qes', 'qms'] as const) if (d[k] !== null) d[k] = round(d[k]!, 4);
  return { drivers: [d], warnings: sizeIn ? [] : [`${d.brand} ${d.model}: ไม่มี Sd จึงเดาขนาดลำโพงไม่ได้`] };
}

// ---- CSV -----------------------------------------------------------------------------------------

/** Column names people actually use (English and Thai), lower-cased without spaces/units. */
const ALIASES: Record<keyof DriverDraft, string[]> = {
  brand: ['brand', 'manufacturer', 'make', 'ยี่ห้อ', 'แบรนด์'],
  model: ['model', 'name', 'รุ่น'],
  category: ['category', 'type', 'ประเภท'],
  kindTh: ['kindth', 'ชนิด'],
  sizeIn: ['size', 'sizein', 'inch', 'inches', 'ขนาด', 'นิ้ว'],
  fs: ['fs'], qts: ['qts'], qes: ['qes'], qms: ['qms'],
  vasL: ['vas', 'vasl', 'vas(l)', 'vasliters', 'vaslitres'],
  re: ['re', 'rdc'], leMh: ['le', 'lemh', 'le(mh)'], bl: ['bl', 'bxl'],
  mmsG: ['mms', 'mmsg', 'mms(g)'], cmsMmPerN: ['cms', 'cmsmmpern', 'cms(mm/n)'], rms: ['rms'],
  sdCm2: ['sd', 'sdcm2', 'sd(cm2)', 'sd(cm²)'],
  xmaxMm: ['xmax', 'xmaxmm', 'xmax(mm)'], xmechMm: ['xmech', 'xmechmm'], peW: ['pe', 'pew', 'power', 'rms power', 'กำลัง'],
  splDb: ['spl', 'sensitivity', 'splmm', 'ความไว'], zNom: ['z', 'znom', 'impedance', 'อิมพีแดนซ์'],
  coil: ['coil', 'vc', 'voicecoil'],
  cutoutMm: ['cutout', 'cutoutmm', 'รูเจาะ'], outerMm: ['outer', 'outermm', 'diameter', 'ขอบนอก'],
  depthMm: ['depth', 'depthmm', 'mountingdepth', 'ความลึก'], displacementL: ['displacement', 'displacementl', 'ปริมาตรแทนที่'],
  sourceKind: ['sourcekind'], sourceUrl: ['url', 'source', 'sourceurl', 'ที่มา'], verified: [], notes: ['notes', 'note', 'comment', 'หมายเหตุ']
};

const CATEGORIES = ['sub', 'woofer', 'mid', 'fullrange', 'pa', 'tweeter'] as const;
const TEXT_FIELDS = new Set<keyof DriverDraft>(['brand', 'model', 'category', 'kindTh', 'coil', 'sourceKind', 'sourceUrl', 'notes']);

/** Splits one CSV line, honouring quotes; detects ; or tab separated files too. */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * CSV with a header row in the app's own units (L, cm², mm, mH, g, mm/N). Columns are matched by
 * common names; values that look SI (Vas < 2 L with Sd < 1 cm², …) are flagged rather than guessed.
 */
export function parseCsv(text: string): ImportResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { drivers: [], warnings: ['ไฟล์ CSV ต้องมีหัวตารางและข้อมูลอย่างน้อย 1 แถว'] };
  const sep = [',', ';', '\t'].map((s) => [s, lines[0].split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], sep).map((h) => h.toLowerCase().replace(/[\s_\-]/g, ''));
  const col = new Map<keyof DriverDraft, number>();
  (Object.keys(ALIASES) as (keyof DriverDraft)[]).forEach((field) => {
    const i = head.findIndex((h) => ALIASES[field].some((a) => h === a.replace(/[\s_\-]/g, '')));
    if (i >= 0) col.set(field, i);
  });
  const warnings: string[] = [];
  if (!col.has('fs')) return { drivers: [], warnings: ['ไม่พบคอลัมน์ Fs ในหัวตาราง'] };
  const unmatched = head.filter((_, i) => ![...col.values()].includes(i));
  if (unmatched.length) warnings.push(`ไม่ได้ใช้คอลัมน์: ${unmatched.join(', ')}`);
  const drivers: DriverDraft[] = [];
  lines.slice(1).forEach((line, r) => {
    const cells = splitLine(line, sep);
    const d: DriverDraft = { ...EMPTY };
    for (const [field, i] of col) {
      const raw = cells[i] ?? '';
      if (TEXT_FIELDS.has(field)) (d as Record<string, unknown>)[field] = (/^'[=+\-@\t\r]/.test(raw) ? raw.slice(1) : raw) || null;
      else if (field !== 'verified') (d as Record<string, unknown>)[field] = parseNumber(raw);
    }
    const row = r + 2;
    if (!d.fs) { warnings.push(`แถว ${row}: ไม่มีค่า Fs ข้ามแถวนี้`); return; }
    d.brand = d.brand || 'ไม่ระบุยี่ห้อ';
    d.model = d.model || `แถว ${row}`;
    if (d.vasL !== null && d.vasL < 2 && d.sdCm2 !== null && d.sdCm2 < 2) warnings.push(`แถว ${row}: Vas และ Sd ดูเป็นหน่วย SI (m³, m²) ควรแปลงเป็นลิตรและ ซม.² ก่อน`);
    const cat = (d.category ?? '').toLowerCase();
    d.category = (CATEGORIES as readonly string[]).includes(cat) ? (cat as DriverDraft['category']) : guessCategory(d.sizeIn, d.fs);
    d.kindTh = d.kindTh || KIND_TH[d.category];
    d.sourceKind = ['datasheet', 'measured', 'user', 'estimated'].includes(d.sourceKind ?? '') ? d.sourceKind : 'user';
    drivers.push(d);
  });
  return { drivers, warnings };
}

// ---- export --------------------------------------------------------------------------------------

const EXPORT_FIELDS: (keyof DriverDraft)[] = [
  'brand', 'model', 'category', 'sizeIn', 'fs', 'qts', 'qes', 'qms', 'vasL', 're', 'leMh', 'bl', 'mmsG', 'cmsMmPerN', 'rms',
  'sdCm2', 'xmaxMm', 'xmechMm', 'peW', 'splDb', 'zNom', 'coil', 'cutoutMm', 'outerMm', 'depthMm', 'displacementL', 'sourceKind', 'sourceUrl', 'notes'
];

const cell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  // A name like =HYPERLINK(...) from an imported file would run as a formula in Excel; the
  // apostrophe makes it plain text there, and parseCsv drops it again on the way back in.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV in the same columns parseCsv reads back (UTF-8 BOM so Excel shows Thai correctly). */
export function toCsv(drivers: DriverDraft[]): string {
  const rows = [EXPORT_FIELDS.join(','), ...drivers.map((d) => EXPORT_FIELDS.map((f) => cell(d[f])).join(','))];
  return '﻿' + rows.join('\r\n') + '\r\n';
}
