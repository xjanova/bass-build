import { tubeOf } from '../data/hardware';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../data/types';
import type { Design } from '../state/store';
import { TERMINAL_CUP } from '../data/hardware';
import { baffleBottom, braceBottom, DOWEL_D, frontRow, HANDLE_SPEC, innerRow, sideRow, slotBoards, TERMINAL_SPEC } from './layout';
import { BRACE_BARS_TH, BRACE_TH, HANDLE_TH, TERMINAL_TH, type BoxGeometry } from './model';

/**
 * The cutting and assembly drawings for a laid-out box: every board with its size, holes and
 * angled edges, the boards nested onto stock sheets, a bill of materials and the build order.
 * Built from the same geometry and layout as the 3D model, in millimetres.
 */

export interface Hole {
  kind: 'driver' | 'pr' | 'port' | 'window' | 'dowel' | 'terminal' | 'handle';
  /** Drilled part-way from the inside face (a dowel socket), not through the board. */
  blind?: boolean;
  /** Centre from the board's left edge and from its bottom edge, as drawn (mm). */
  x: number;
  y: number;
  /** Circle diameter, or rectangle width and height (mm). */
  d?: number;
  w?: number;
  h?: number;
  label: string;
}

export interface Part {
  id: string;
  name: string;
  qty: number;
  /** Size as drawn: across (w) and up (h), mm. */
  w: number;
  h: number;
  t: number;
  /** Outline when not a rectangle (wedge sides), mm from the bottom-left corner. */
  outline?: [number, number][];
  holes: Hole[];
  /** Edges cut at an angle off square, degrees. */
  bevels: { edge: 'top' | 'bottom'; deg: number }[];
  note?: string;
  /** Shown on the outside of the box (takes the finish). */
  face: boolean;
}

export interface Placement { part: string; label: string; x: number; y: number; w: number; h: number; rotated: boolean }
export interface Sheet { w: number; h: number; parts: Placement[]; usedM2: number }

export interface BomLine { item: string; qty: string; note?: string }

/** Round dowels for dowel bracing: bought as rod and cut, not nested on the sheets. */
export interface DowelCut { qty: number; /** Cut length, mm (inside width plus the two sockets). */ length: number; d: number; note: string }

export interface Blueprint {
  parts: Part[];
  dowels: DowelCut | null;
  sheets: Sheet[];
  /** Boards longer than a stock sheet: they must be joined (not nested). */
  oversize: string[];
  bom: BomLine[];
  steps: string[];
  totals: { boardM2: number; sheetM2: number; jointM: number; screws: number; waste: number };
}

/** Saw kerf allowed between parts on a sheet, mm. */
export const KERF = 3;
/** Clean edge trimmed off the factory edge of a sheet, mm. */
export const TRIM = 5;
/** Screws every this many mm along a glued joint. */
const SCREW_PITCH = 150;

const mm = (m: number) => m * 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Every board of the box, mirroring how the 3D model builds it (sides between top and bottom, back and baffle between the sides). */
export function partsFor(d: Design, geo: BoxGeometry): Part[] {
  const t = mm(geo.t);
  const wx = mm(geo.wx), hx = mm(geo.hx), dx = mm(geo.dx), dxTop = mm(geo.dxTop), wi = mm(geo.wi), hi = mm(geo.hi);
  const wedge = geo.shape === 'wedge';
  const lean = (geo.backAngle * 180) / Math.PI;
  const parts: Part[] = [];
  const bevel = (edge: 'top' | 'bottom') => (wedge ? [{ edge, deg: r1(lean) }] : []);

  parts.push({ id: 'bottom', name: 'พื้น', qty: 1, w: wx, h: dx, t, holes: [], bevels: bevel('top'), face: true, note: wedge ? 'ขอบหลัง (ด้านบนในแบบ) ตัดเอียงตามผนังหลัง' : undefined });
  parts.push({ id: 'top', name: 'ฝาบน', qty: 1, w: wx, h: dxTop, t, holes: [], bevels: bevel('top'), face: true, note: wedge ? 'ขอบหลัง (ด้านบนในแบบ) ตัดเอียงตามผนังหลัง' : undefined });

  // Sides, drawn from the left of the box: x = depth from the front edge, y = up from the bottom panel.
  const sideH = hx - 2 * t;
  const depthAt = (y: number) => dx - (dx - dxTop) * (y / hx);
  const prHoles: Hole[] = d.boxType === 'pr' ? sideRow(geo).map((z, i) => ({
    kind: 'pr', x: dx / 2 - mm(z), y: hx / 2 - t, d: mm(2 * geo.prRadius * 0.9), label: `PR ${i + 1}`
  })) : [];
  // Dowel sockets: blind holes on the inside face, half a panel deep (x from the front edge).
  const br = geo.braces;
  const dowels = br.kind === 'dowel' ? br.zs : [];
  const sockets: Hole[] = dowels.flatMap((z, i) => br.dowelYs.map((y, j): Hole => ({
    kind: 'dowel', blind: true, x: t + mm(z), y: mm(y) - t, d: mm(DOWEL_D), label: `เดือย ${i + 1}.${j + 1}`
  })));
  // Handles: a recessed cup's cut-out in both sides (the same spot from the front edge); bar
  // handles cut nothing, their screw positions go in the note.
  const hd = geo.handles;
  const handleHoles: Hole[] = hd?.hole ? [{ kind: 'handle', x: mm(hd.z), y: mm(hd.y) - t, w: mm(hd.hole.w), h: mm(hd.hole.h), label: 'มือจับฝัง (ประมาณ)' }] : [];
  // A terminal pushed off the back by a folded slot goes on the left side only: the sides then differ.
  const term = geo.terminal;
  const onSide = term.panel === 'side';
  const termHoles = (x: number, y: number): Hole[] => term.hole
    ? [{ kind: 'terminal', x, y, w: mm(term.hole.w), h: mm(term.hole.h), label: 'ขั้วต่อ (ประมาณ)' }]
    : term.posts.map((dxp, i): Hole => ({ kind: 'terminal', x: x + mm(dxp), y, d: mm(term.postD), label: i ? 'ขั้ว −' : 'ขั้ว +' }));
  const sideNote = (left: boolean | null) => [
    // With both kinds of hole, say which rule is for which: the PR holes go through and match
    // left and right; the sockets are blind on the inside faces, so they mirror.
    wedge ? 'ทรงคางหมู ซ้ายกับขวากลับด้านกัน' : prHoles.length ? `${sockets.length || handleHoles.length ? 'รู PR ' : ''}ซ้ายกับขวาเจาะเหมือนกัน (PR หันออกคนละข้าง)` : null,
    !wedge && handleHoles.length ? 'ช่องมือจับซ้ายกับขวาเจาะที่เดียวกัน (วัดจากขอบหน้า)' : null,
    sockets.length ? `รูบอดเดือยเจาะด้านใน ลึก ${Math.round(t / 2)} มม. ระยะวัดจากขอบหน้า ซ้ายกับขวาเจาะกลับด้านกัน (ไม่ทะลุ)` : null,
    hd && !hd.hole ? `มือจับติดผิว: สกรู 2 ตัว ห่างขอบหน้า ${hd.screws.map((z) => Math.round(mm(z))).join(' / ')} มม. สูงจากขอบล่างแผ่น ${Math.round(mm(hd.y) - t)} มม. (ไม่ต้องเจาะช่อง)` : null,
    left === true ? 'รูขั้วต่ออยู่แผ่นซ้ายเท่านั้น (มองจากหน้าตู้) เพราะท่อสลอตพับขึ้นเต็มผนังหลัง' : left === false ? 'ไม่มีรูขั้วต่อ' : null
  ].filter(Boolean).join(' · ') || undefined;
  const side = (id: string, name: string, qty: number, holes: Hole[], left: boolean | null): Part => ({
    id, name, qty, w: wedge ? depthAt(t) : dx, h: sideH, t, holes, bevels: [], face: true,
    outline: wedge ? [[0, 0], [depthAt(t), 0], [depthAt(hx - t), sideH], [0, sideH]] : undefined,
    note: sideNote(left)
  });
  const sideHoles = [...prHoles, ...handleHoles, ...sockets];
  if (onSide) {
    parts.push(side('side', 'ผนังข้างขวา', 1, sideHoles, false));
    parts.push(side('side-left', 'ผนังข้างซ้าย', 1, [...sideHoles, ...termHoles(mm(term.z), mm(term.y) - t)], true));
  } else parts.push(side('side', 'ผนังข้าง', 2, sideHoles, null));

  // Back: between the sides and between top and bottom; a wedge's runs up the lean.
  const backLen = wedge ? Math.hypot(sideH, (dx - dxTop) * (sideH / hx)) : sideH;
  const backHoles: Hole[] = geo.rearPort ? [{ kind: 'port', x: wi / 2, y: mm(geo.rearPort.y) - t, d: mm(2 * geo.rearPort.radius), label: 'ท่อหลัง (ขนาดใน)' }] : [];
  // The terminal, measured up the board (up the lean on a wedge).
  if (!onSide) backHoles.push(...termHoles(wi / 2 + mm(term.x), mm(term.s)));
  parts.push({
    id: 'back', name: 'ผนังหลัง', qty: 1, w: wi, h: backLen, t, holes: backHoles, bevels: wedge ? [{ edge: 'top', deg: r1(lean) }, { edge: 'bottom', deg: r1(lean) }] : [], face: false,
    note: !onSide && wedge ? 'ระยะรูขั้วต่อวัดตามแนวเอียงของแผ่น' : undefined
  });

  // Front baffle above the slot port, with the driver / passive radiator row.
  const bottom = mm(baffleBottom(geo));
  const bh = hx - t - bottom;
  const row = frontRow(geo, d.boxType, d.count);
  parts.push({
    id: 'baffle', name: 'แผงหน้า', qty: 1, w: wi, h: bh, t, bevels: [], face: true,
    holes: row.map((it, i): Hole => ({
      kind: it.passive ? 'pr' : 'driver', x: wi / 2 + mm(it.x), y: mm(geo.driverY) - bottom, d: mm(2 * it.cut),
      label: it.passive ? 'PR' : row.filter((x) => !x.passive).length > 1 ? `ลำโพง ${i + 1}` : 'ลำโพง'
    })).concat((geo.tubes?.xs ?? []).map((x, i, xs): Hole => ({
      kind: 'port', x: wi / 2 + mm(x), y: mm(geo.tubes!.y) - bottom, d: mm(geo.tubes!.od), label: xs.length > 1 ? `ท่อ ${i + 1}` : 'ท่อ'
    })))
  });

  // Slot port: a ceiling board from the front, and the riser folded up the back when it is long.
  const slot = slotBoards(geo);
  if (geo.slotH > 0) {
    parts.push({ id: 'port-ceiling', name: 'เพดานท่อสลอต', qty: 1, w: wi, h: mm(slot.run + geo.t), t, holes: [], bevels: [], face: false, note: `วางสูงจากพื้นใน ${Math.round(mm(geo.slotH))} มม. ขอบหน้าเสมอแผงหน้า` });
    if (slot.riser > 0) parts.push({ id: 'port-riser', name: 'แผ่นท่อพับขึ้น', qty: 1, w: wi, h: mm(slot.riser), t, holes: [], bevels: [], face: false, note: `ขนานผนังหลัง ห่าง ${Math.round(mm(geo.slotH))} มม.` });
  }

  // Inside boards: the band-pass divider (drivers on it) or the isobaric inner baffle.
  const inner = innerRow(geo, d.boxType, d.count);
  if (d.boxType === 'bp4' || d.boxType === 'bp6') {
    const base = t + (geo.slotH > 0 ? mm(geo.slotH) + t : 0);
    parts.push({
      id: 'divider', name: 'แผ่นกั้นห้อง', qty: 1, w: wi, h: hx - t - base, t, bevels: [], face: false,
      holes: inner.map((x, i) => ({ kind: 'driver', x: wi / 2 + mm(x), y: mm(geo.driverY) - base, d: mm(2 * geo.cutoutRadius), label: inner.length > 1 ? `ลำโพง ${i + 1}` : 'ลำโพง' })),
      note: `ห่างผนังหลังด้านใน ${Math.round(mm(geo.di * geo.rearFraction) - t)} มม.`
    });
  }
  if (d.boxType === 'isobaric') {
    parts.push({
      id: 'inner-baffle', name: 'แผงยึดลำโพงตัวใน', qty: 1, w: wi, h: hi, t, bevels: [], face: false,
      holes: inner.map((x) => ({ kind: 'driver', x: wi / 2 + mm(x), y: mm(geo.driverY) - t, d: mm(2 * geo.cutoutRadius), label: 'ลำโพงตัวใน' })),
      note: 'ลำโพงตัวในหันหน้าชนหลังลำโพงตัวหน้า'
    });
  }

  // Window braces where the layout put them: boards with a window cut out (bars all round, 50 mm or
  // narrower in a small box), or pairs of cross bars beside side passive radiators. The layout never
  // places a frame without its window (a solid board would seal the driver into a pocket).
  if (br.kind === 'window' && br.zs.length && br.window) {
    const braceH = hx - t - mm(braceBottom(geo));
    const win = br.window;
    const at = `ห่างแผงหน้าด้านใน ${br.zs.map((z) => Math.round(mm(z))).join(' / ')} มม. (ถึงกลางแผ่น)`;
    parts.push(br.barsOnly
      ? {
        id: 'brace', name: BRACE_BARS_TH, qty: 2 * br.zs.length, w: wi, h: mm(win.bar), t, bevels: [], face: false, holes: [],
        note: `ชุดละ 2 คาน: คานบนชิดฝาบน คานล่างชิด${geo.slotH > 0 ? 'เพดานท่อสลอต' : geo.tubes ? 'พื้นเหนือท่อ' : 'พื้น'} · ${at} · ไม่มีคานข้างเพราะผนังข้างมี PR`
      }
      : {
        id: 'brace', name: BRACE_TH.window, qty: br.zs.length, w: wi, h: braceH, t, bevels: [], face: false,
        holes: [{ kind: 'window', x: wi / 2, y: braceH / 2, w: mm(win.w), h: mm(win.h), label: 'ช่องหน้าต่าง' }],
        note: `${at}${win.bar < 0.05 - 1e-9 ? ` · ขอบกว้าง ${Math.round(mm(win.bar))} มม. (ตู้เล็ก แคบลงให้ช่องเหลือ)` : ''}`
      });
  }

  return parts;
}

/**
 * Nests the boards onto stock sheets with the MaxRects method (best short-side fit, boards may
 * be turned): each board goes where it leaves the least leftover along its shorter side, which
 * keeps the off-cuts large. Every board is padded by one kerf on its right and top.
 */
export function nest(parts: Part[], sheetW: number, sheetH: number): { sheets: Sheet[]; oversize: string[] } {
  // One kerf of slack at the far edges: the last board in a row needs no cut after it.
  const usableW = sheetW - 2 * TRIM + KERF, usableH = sheetH - 2 * TRIM + KERF;
  const items = parts.flatMap((p) => Array.from({ length: p.qty }, (_, i) => ({ part: p.id, label: p.qty > 1 ? `${p.name} ${i + 1}` : p.name, w: p.w, h: p.h })))
    .sort((a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h));
  type Rect = { x: number; y: number; w: number; h: number };
  const oversize: string[] = [];
  const sheets: { free: Rect[]; parts: Placement[] }[] = [];
  const contains = (a: Rect, b: Rect) => b.x >= a.x - 1e-9 && b.y >= a.y - 1e-9 && b.x + b.w <= a.x + a.w + 1e-9 && b.y + b.h <= a.y + a.h + 1e-9;
  const cut = (free: Rect[], u: Rect): Rect[] => {
    const out: Rect[] = [];
    for (const f of free) {
      if (u.x >= f.x + f.w || u.x + u.w <= f.x || u.y >= f.y + f.h || u.y + u.h <= f.y) { out.push(f); continue; }
      if (u.x > f.x) out.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h });
      if (u.x + u.w < f.x + f.w) out.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - u.x - u.w, h: f.h });
      if (u.y > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y });
      if (u.y + u.h < f.y + f.h) out.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - u.y - u.h });
    }
    // Drop free rectangles that sit inside another.
    return out.filter((r, i) => r.w > 1e-6 && r.h > 1e-6 && !out.some((o, j) => j !== i && contains(o, r) && (!contains(r, o) || j < i)));
  };
  const bestIn = (free: Rect[], w: number, h: number) => {
    let best: { r: Rect; w: number; h: number; rot: boolean; short: number; long: number } | null = null;
    for (const r of free) for (const [bw, bh, rot] of [[w, h, false], [h, w, true]] as [number, number, boolean][]) {
      if (bw > r.w + 1e-9 || bh > r.h + 1e-9) continue;
      const short = Math.min(r.w - bw, r.h - bh), long = Math.max(r.w - bw, r.h - bh);
      if (!best || short < best.short - 1e-9 || (Math.abs(short - best.short) <= 1e-9 && long < best.long)) best = { r, w: bw, h: bh, rot, short, long };
    }
    return best;
  };
  for (const it of items) {
    const w = it.w + KERF, h = it.h + KERF;
    if (!((w <= usableW && h <= usableH) || (h <= usableW && w <= usableH))) { oversize.push(it.label); continue; }
    let sheet = sheets.find((s) => bestIn(s.free, w, h));
    if (!sheet) { sheet = { free: [{ x: 0, y: 0, w: usableW, h: usableH }], parts: [] }; sheets.push(sheet); }
    const b = bestIn(sheet.free, w, h)!;
    sheet.parts.push({ part: it.part, label: it.label, x: TRIM + b.r.x, y: TRIM + b.r.y, w: b.w - KERF, h: b.h - KERF, rotated: b.rot });
    sheet.free = cut(sheet.free, { x: b.r.x, y: b.r.y, w: b.w, h: b.h });
  }
  return {
    sheets: sheets.map((s) => ({ w: sheetW, h: sheetH, parts: s.parts, usedM2: s.parts.reduce((a, p) => a + (p.w * p.h) / 1e6, 0) })),
    oversize
  };
}

/** Area of a board's face, m² (its outline when it has one). */
export function partArea(p: Part): number {
  if (!p.outline) return (p.w * p.h) / 1e6;
  let a = 0;
  p.outline.forEach(([x0, y0], i) => { const [x1, y1] = p.outline![(i + 1) % p.outline!.length]; a += x0 * y1 - x1 * y0; });
  return Math.abs(a) / 2 / 1e6;
}

export interface BlueprintInput {
  d: Design;
  geo: BoxGeometry;
  dto: DriverDto | undefined;
  material: (PanelMaterialDto & { sheetWMm?: number | null; sheetHMm?: number | null; pricePerSheetThb?: number | null }) | undefined;
  damping: DampingMaterialDto[];
}

/** Dowels to cut for dowel bracing (null for other bracing): one per socket pair, the inside width plus both sockets. */
export function dowelsFor(geo: BoxGeometry): DowelCut | null {
  const br = geo.braces;
  if (br.kind !== 'dowel' || !br.zs.length) return null;
  const t = mm(geo.t);
  return {
    qty: br.zs.length * br.dowelYs.length,
    length: Math.round(mm(geo.wi) + t),
    d: mm(DOWEL_D),
    note: `${br.zs.length} ชุด ชุดละ ${br.dowelYs.length} ท่อน · ห่างแผงหน้าด้านใน ${br.zs.map((z) => Math.round(mm(z))).join(' / ')} มม. · สูงจากพื้นนอก ${br.dowelYs.map((y) => Math.round(mm(y))).join(' / ')} มม. · ปลายละ ${Math.round(t / 2)} มม. เข้ารูบอดผนังข้าง`
  };
}

export function blueprintFor({ d, geo, dto, material, damping }: BlueprintInput): Blueprint {
  const parts = partsFor(d, geo);
  const dowels = dowelsFor(geo);
  const br = geo.braces;
  const sheetW = material?.sheetWMm ?? 1220, sheetH = material?.sheetHMm ?? 2440;
  const { sheets, oversize } = nest(parts, sheetW, sheetH);
  const boardM2 = parts.reduce((a, p) => a + partArea(p) * p.qty, 0);
  const t = mm(geo.t);
  // Glued joints: every edge of the shell boards meets another board (each joint shared by two).
  const SHELL = ['bottom', 'top', 'side', 'side-left', 'back', 'baffle'];
  const shell = parts.filter((p) => SHELL.includes(p.id));
  const jointM = shell.reduce((a, p) => a + p.qty * (2 * (p.w + p.h)), 0) / 2 / 1000;
  const inside = parts.filter((p) => !SHELL.includes(p.id));
  const insideM = inside.reduce((a, p) => a + p.qty * 2 * p.w, 0) / 1000; // each inside board glued along two long edges
  const screws = Math.ceil(((jointM + insideM) * 1000) / SCREW_PITCH / 10) * 10;
  const matName = material?.nameTh ?? material?.name ?? 'MDF';
  const drivers = d.boxType === 'isobaric' ? 2 : d.count;
  const bom: BomLine[] = [
    {
      item: `แผ่น ${matName} หนา ${d.thicknessMm} มม. (${sheetW} × ${sheetH} มม.)`, qty: `${sheets.length} แผ่น`,
      note: [material?.pricePerSheetThb ? `ราว ${Math.round(material.pricePerSheetThb * sheets.length).toLocaleString('th-TH')} บาท` : null, oversize.length ? `${oversize.join(', ')} ยาวเกินแผ่น ต้องต่อ` : null].filter(Boolean).join(' · ') || undefined
    },
    { item: dto ? `ลำโพง ${dto.brand} ${dto.model}` : 'ลำโพง', qty: `${drivers} ดอก`, note: `รูเจาะ Ø ${Math.round(mm(2 * geo.cutoutRadius))} มม.${dto?.cutoutMm ? '' : ' (ประมาณ ตรวจกับลำโพงจริงก่อนเจาะ)'}` },
    { item: 'สกรูยึดลำโพง / T-nut', qty: `${drivers * (dto?.shape?.boltHoles ?? 8)} ตัว`, note: dto?.shape?.boltHoles ? undefined : 'จำนวนรูยึดประมาณ 8 รูต่อดอก' }
  ];
  if (d.boxType === 'pr') bom.push({ item: `แผ่น PR (Sd ${d.prSdCm2} ซม.² มวล ${d.prMassG} ก.)`, qty: `${d.prCount} ตัว`, note: `รูเจาะ Ø ${Math.round(mm(2 * geo.prRadius * 0.9))} มม.` });
  if (geo.tubes) {
    const tb = geo.tubes;
    const tube = tubeOf(d.tubeKey);
    bom.push({
      item: `${tube?.name ?? 'ท่อกลม'} (นอก Ø ${Math.round(mm(tb.od))} · ใน Ø ${Math.round(mm(tb.id))} มม.)`,
      qty: `${tb.count} ท่อ × ยาว ${Math.round(mm(geo.portLength))} มม.`,
      note: `รวม ${(tb.count * geo.portLength).toFixed(2)} ม. · ความยาวคิดจากไส้ใน ${Math.round(mm(tb.id))} มม. วัดไส้ในท่อจริงแล้วแก้ในแล็บก่อนตัด · ปลายท่อเสมอหน้าแผง`
    });
  }
  if (geo.rearPort) {
    const id = mm(2 * geo.rearPort.radius);
    bom.push({ item: `ท่อกลม ขนาดใน Ø ${Math.round(id)} มม.`, qty: `ยาว ${Math.round(mm(geo.rearPort.length))} มม.`, note: 'ท่อ PVC ไส้ในต่างกันตามชั้นคุณภาพ วัดไส้ในจริงแล้วคำนวณความยาวใหม่ถ้าไม่ตรง · เจาะรูผนังหลังตามขนาดนอกของท่อ' });
  }
  bom.push(
    { item: 'กาวไม้ (PVA)', qty: `ราว ${Math.max(100, Math.ceil(((jointM + insideM) * 20) / 50) * 50)} มล.`, note: 'ประมาณ 20 มล. ต่อเมตรรอยต่อ' },
    { item: `สกรูไม้ ยาว ≈ ${Math.round((2.5 * t) / 5) * 5} มม.`, qty: `${screws} ตัว`, note: `ทุก ${SCREW_PITCH} มม. ตามรอยต่อ (รอยต่อรวม ${(jointM + insideM).toFixed(1)} ม.)` },
    { item: 'ซิลิโคน / กาวยาแนวด้านใน', qty: `${(jointM).toFixed(1)} ม.`, note: 'ยาแนวทุกรอยต่อด้านในกันรั่ว' },
    { item: 'เทปโฟมกันรั่วรอบขอบลำโพง', qty: `${(((frontRow(geo, d.boxType, d.count).reduce((a, it) => a + 2 * Math.PI * it.r, 0) + innerRow(geo, d.boxType, d.count).length * 2 * Math.PI * geo.driverRadius) * 1.1)).toFixed(1)} ม.` }
  );
  bom.push(terminalLine(geo), ...handleLines(geo));
  if (d.stuffing > 0 && (d.boxType === 'sealed' || d.boxType === 'vented' || d.boxType === 'pr')) {
    const fill = damping.find((x) => x.key === d.fillKey);
    const lo = fill?.fillGPerLMin, hi2 = fill?.fillGPerLMax;
    const perL = lo && hi2 ? (lo + hi2) / 2 : lo ?? hi2 ?? null;
    bom.push({ item: fill?.nameTh ?? fill?.name ?? 'ใยซับเสียง', qty: perL ? `ราว ${Math.round(perL * d.vbL * d.stuffing)} ก.` : `${Math.round(d.stuffing * 100)}% ของตู้`, note: perL ? `${perL} ก./ลิตร × ${d.vbL} L × ${Math.round(d.stuffing * 100)}% (ยัดหลวม ๆ ห้ามอุดปากท่อ)` : undefined });
  }
  if (dowels) {
    bom.push({
      item: `ไม้กลม (เดือย) Ø ${dowels.d} มม.`, qty: `${dowels.qty} ท่อน × ยาว ${dowels.length} มม.`,
      note: `รวม ${((dowels.qty * dowels.length) / 1000).toFixed(2)} ม. · Ø ${dowels.d} มม. เป็นขนาดที่หาซื้อได้ทั่วไป ไม่ใช่ค่าที่ยืนยัน วัดเดือยจริงแล้วเจาะรูบอดให้พอดี · ใช้ไม้เนื้อแข็ง`
    });
  }
  const cld = damping.find((x) => x.key === d.cldKey);
  if (cld) bom.push({ item: cld.nameTh ?? cld.name, qty: `${(geo.panelAreaM2 * 0.8).toFixed(2)} ม.²`, note: 'ติดผนังด้านใน ยกเว้นแผงหน้า' });

  const lean = ((geo.backAngle * 180) / Math.PI).toFixed(1);
  const has = (id: string) => parts.some((p) => p.id === id);
  const steps = [
    `ตัดแผ่นตามรายการตัด ตรวจขนาดและฉากทุกแผ่น${geo.shape === 'wedge' ? ` ผนังข้างตัดเป็นคางหมู และขอบที่ชนผนังหลังตัดเอียง ${lean}°` : ''}`,
    ...(geo.tubes ? [`ตัดท่อ ${geo.tubes.count} ท่อ ยาวท่อละ ${Math.round(mm(geo.portLength))} มม. ลบคมปลายท่อด้านใน แล้วเจาะรูท่อที่แผงหน้า Ø ${Math.round(mm(geo.tubes.od))} มม. ให้ท่อสวมพอดี`] : []),
    `เจาะรูลำโพงที่${has('divider') ? 'แผ่นกั้นห้อง' : has('inner-baffle') ? 'แผงหน้าและแผงยึดลำโพงตัวใน' : 'แผงหน้า'} Ø ${Math.round(mm(2 * geo.cutoutRadius))} มม. ตามระยะในแบบ${d.boxType === 'pr' ? ' และรู PR' : ''}${geo.rearPort ? ' · เจาะรูท่อหลังที่ผนังหลัง' : ''} · ทาบลำโพงจริงก่อนเจาะ`,
    `เจาะรู${terminalHoleText(geo)} ที่${geo.terminal.panel === 'side' ? 'ผนังข้างซ้าย' : 'ผนังหลัง'}${geo.handles?.hole ? ` และช่องมือจับฝัง ${Math.round(mm(geo.handles.hole.w))} × ${Math.round(mm(geo.handles.hole.h))} มม. ที่ผนังข้างทั้งสอง` : ''} ตามระยะในแบบ · ทาบของจริงก่อนเจาะ (ขนาดในแบบเป็นค่าประมาณ)`,
    ...(dowels ? [`ตัดเดือย ${dowels.qty} ท่อน ยาว ${dowels.length} มม. แล้วเจาะรูบอด Ø ${dowels.d} มม. ลึก ${Math.round(t / 2)} มม. ด้านในผนังข้างทั้งสองตามแบบ (ซ้ายกับขวากลับด้านกัน ห้ามเจาะทะลุ)`] : []),
    dowels
      ? 'ทากาวแล้วยึดผนังข้างแผ่นแรกบนพื้น ทากาวเดือยใส่รูบอดให้สุด แล้วประกบผนังข้างอีกแผ่นให้เดือยเข้ารู ใช้ฉากจับให้ตั้งตรง'
      : 'ทากาวแล้วยึดผนังข้างทั้งสองบนพื้น ใช้ฉากจับให้ตั้งตรง',
    ...(has('port-ceiling') ? [`ติดเพดานท่อสลอตสูงจากพื้นใน ${Math.round(mm(geo.slotH))} มม. ตลอดความกว้าง${has('port-riser') ? ' แล้วติดแผ่นท่อพับขึ้นที่ปลายท่อ' : ''}`] : []),
    ...(has('divider') ? ['ติดแผ่นกั้นห้องพร้อมลำโพงตามระยะในแบบ ยาแนวรอบให้สนิท (สองห้องต้องไม่รั่วถึงกัน)'] : []),
    ...(has('inner-baffle') ? ['ยึดลำโพงตัวในบนแผงยึด แล้วติดแผงยึดเข้าตู้ หันหน้าชนหลังลำโพงตัวหน้า'] : []),
    ...(has('brace') ? [br.barsOnly
      ? `ติด${BRACE_BARS_TH} ${br.zs.length} ชุด (ชุดละคานบนกับคานล่าง) ห่างแผงหน้าด้านใน ${br.zs.map((z) => Math.round(mm(z))).join(' / ')} มม. (ถึงกลางคาน) ทากาวขอบยาวและปลายทั้งสองที่ชนผนัง ปลายคานต้องไม่ทับรู PR`
      : `ติด${BRACE_TH.window} ${br.zs.length} ชุด ห่างแผงหน้าด้านใน ${br.zs.map((z) => Math.round(mm(z))).join(' / ')} มม. (ถึงกลางแผ่น) ทากาวทุกขอบที่ชนผนัง`] : []),
    `ติดผนังหลัง${geo.rearPort ? ' สอดท่อหลังเข้าห้องหลัง' : ''} แล้วติด${TERMINAL_TH[geo.terminal.kind]}${geo.terminal.panel === 'side' ? 'ที่ผนังข้างซ้าย' : ''} ทาซิลิโคนรอบขั้วกันรั่ว`,
    'ยาแนวซิลิโคนทุกรอยต่อด้านใน ปล่อยให้แห้ง',
    ...(d.stuffing > 0 ? ['ใส่ใยซับเสียงตามปริมาณในรายการวัสดุ ไม่อุดปากท่อหรือหลังลำโพง'] : []),
    geo.tubes ? 'ติดฝาบนและแผงหน้า สอดท่อเข้ารูให้ปลายเสมอหน้าแผง ยึดด้วยกาวหรือซิลิโคนรอบท่อ ขัดขอบ แล้วทำผิว' : 'ติดฝาบนและแผงหน้า ขัดขอบ แล้วทำผิว',
    'เดินสายจากขั้วต่อถึงลำโพง ติดเทปโฟมรอบขอบ ยึดลำโพง แล้วกดกรวยเบา ๆ ฟังว่ามีลมรั่วหรือไม่',
    ...(geo.handles ? [geo.handles.hole
      ? 'ใส่มือจับฝังทั้งสองข้าง ทาซิลิโคนรอบขอบถ้วยกันรั่ว แล้วขันสกรูยึด'
      : `ยึดมือจับติดผิวข้างละชิ้น สกรูห่างขอบหน้า ${geo.handles.screws.map((z) => Math.round(mm(z))).join(' / ')} มม. สูงจากพื้นนอก ${Math.round(mm(geo.handles.y))} มม. เจาะนำก่อนขันสกรู`] : [])
  ];
  const sheetM2 = (sheets.length * sheetW * sheetH) / 1e6;
  return {
    parts, dowels, sheets, oversize, bom, steps,
    totals: { boardM2, sheetM2, jointM: jointM + insideM, screws, waste: sheetM2 > 0 ? 1 - boardM2 / sheetM2 : 0 }
  };
}

/** The terminal's holes, in words: one rectangular cut-out, or the two post holes. */
function terminalHoleText(geo: BoxGeometry): string {
  const tr = geo.terminal;
  return tr.hole ? `ขั้วต่อ ${Math.round(mm(tr.hole.w))} × ${Math.round(mm(tr.hole.h))} มม.` : `ขั้วต่อ Ø ${Math.round(mm(tr.postD))} มม. 2 รู ห่างกัน ${Math.round(mm(TERMINAL_SPEC.posts.pitch))} มม.`;
}

/** BOM line for the terminal, with where it goes and the air it takes; every size an estimate. */
function terminalLine(geo: BoxGeometry): BomLine {
  const tr = geo.terminal;
  const where = tr.panel === 'side'
    ? `ผนังข้างซ้ายด้านล่าง (ท่อสลอตพับขึ้นเต็มผนังหลัง) ห่างขอบหน้า ${Math.round(mm(tr.z))} มม.`
    : `ผนังหลังด้านล่าง${Math.abs(tr.x) > 1e-4 ? ` เยื้องกลาง ${Math.round(mm(tr.x))} มม. (หลบ${geo.rearPort ? 'ท่อหลัง' : 'แม่เหล็ก'})` : ' กึ่งกลาง'}`;
  const vol = geo.volume.terminalL;
  return tr.kind === 'cup'
    ? {
      item: TERMINAL_CUP?.name ?? TERMINAL_TH.cup, qty: '1 ชุด',
      note: `${TERMINAL_CUP?.notes ?? 'รูเจาะประมาณ 80 × 80 มม. ตรวจกับสินค้าจริง'} · ติด${where} · กินที่ในตู้ราว ${vol.toFixed(2)} L (ประมาณจากถ้วยลึก ${Math.round(mm(TERMINAL_SPEC.cup.depth))} มม.) · ทาซิลิโคนรอบขอบ`
    }
    : {
      item: TERMINAL_TH.posts, qty: '1 คู่ (แดง/ดำ)',
      note: `${terminalHoleText(geo)} (ขนาดทั่วไป ประมาณ ตรวจกับสินค้าจริง) · ติด${where} · ใส่แหวนยางหรือซิลิโคนกันรั่ว`
    };
}

/** BOM lines for the handles (none without handles). */
function handleLines(geo: BoxGeometry): BomLine[] {
  const hd = geo.handles;
  if (!hd) return [];
  if (hd.hole) {
    return [{
      item: HANDLE_TH.recessed, qty: '2 ชิ้น',
      note: `ผนังข้างละชิ้นใกล้ขอบบน · ช่องเจาะ ${Math.round(mm(hd.hole.w))} × ${Math.round(mm(hd.hole.h))} มม. ขอบ ${Math.round(mm(hd.plate.w))} × ${Math.round(mm(hd.plate.h))} มม. ลึก ${Math.round(mm(HANDLE_SPEC.recessed.depth))} มม. (ขนาดทั่วไป ประมาณ ตรวจกับสินค้าจริง) · กินที่ในตู้รวมราว ${geo.volume.handlesL.toFixed(1)} L`
    }];
  }
  return [
    {
      item: HANDLE_TH.surface, qty: '2 ชิ้น',
      note: `ผนังข้างละชิ้นใกล้ขอบบน ยาวราว ${Math.round(mm(hd.plate.w))} มม. ยื่นออกราว ${Math.round(mm(hd.standOff))} มม. (ขนาดทั่วไป ประมาณ ตรวจกับสินค้าจริง) · ไม่ต้องเจาะช่อง`
    },
    {
      item: 'สกรูยึดมือจับ', qty: '4 ตัว',
      note: `ข้างละ 2 ตัว ห่างขอบหน้า ${hd.screws.map((z) => Math.round(mm(z))).join(' / ')} มม. สูงจากพื้นนอก ${Math.round(mm(hd.y))} มม. · สั้นกว่าความหนาแผง (${Math.round(mm(geo.t))} มม.) หรือใช้น็อตทะลุกับ T-nut`
    }
  ];
}

// ---- exports ------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n0 = (v: number) => String(Math.round(v));

/** Cut list as CSV (UTF-8 with BOM so Excel shows Thai). */
export function cutListCsv(bp: Blueprint): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['ชิ้น', 'จำนวน', 'กว้าง (มม.)', 'ยาว (มม.)', 'หนา (มม.)', 'รูเจาะ', 'ตัดเอียง', 'หมายเหตุ']];
  for (const p of bp.parts) {
    rows.push([
      p.name, String(p.qty), n0(p.w), n0(p.h), n0(p.t),
      p.holes.map((h) => (h.d ? `${h.label} Ø${n0(h.d)}${h.blind ? ' (รูบอด)' : ''}` : `${h.label} ${n0(h.w!)}×${n0(h.h!)}`)).join('; '),
      p.bevels.map((b) => `${b.edge === 'top' ? 'ขอบบน' : 'ขอบล่าง'} ${b.deg}°`).join('; '),
      p.note ?? ''
    ]);
  }
  // Dowels are cut from round rod, not from the sheets: one line after the boards.
  if (bp.dowels) rows.push([`เดือยไม้กลม Ø${n0(bp.dowels.d)}`, String(bp.dowels.qty), n0(bp.dowels.d), n0(bp.dowels.length), n0(bp.dowels.d), '', '', bp.dowels.note]);
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

/** Polygon of a board as drawn (its outline, or its rectangle). */
const shapeOf = (p: Part): [number, number][] => p.outline ?? [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]];

/**
 * One board drawn to scale with its overall size, holes and their distances from the left and
 * bottom edges. Coordinates in mm with y up (flipped for SVG). `ink` is the line colour.
 */
export function partSvg(p: Part, ink = '#0f172a', accent = '#0369a1'): string {
  const pad = 70;
  const W = p.w + 2 * pad, H = p.h + 2 * pad;
  const X = (x: number) => pad + x, Y = (y: number) => pad + p.h - y;
  const font = Math.max(18, Math.min(34, Math.max(p.w, p.h) / 28));
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n0(W)} ${n0(H)}" font-family="'IBM Plex Sans Thai','Noto Sans Thai',sans-serif" font-size="${n0(font)}">`);
  out.push(`<polygon points="${shapeOf(p).map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}" fill="none" stroke="${ink}" stroke-width="3"/>`);
  for (const h of p.holes) {
    if (h.d) out.push(`<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="${h.d / 2}" fill="none" stroke="${accent}" stroke-width="2.5"${h.blind ? ' stroke-dasharray="6 4"' : ''}/>`);
    else out.push(`<rect x="${X(h.x - h.w! / 2)}" y="${Y(h.y + h.h! / 2)}" width="${h.w}" height="${h.h}" fill="none" stroke="${accent}" stroke-width="2.5"/>`);
    if (h.kind === 'window') {
      out.push(`<text x="${X(h.x)}" y="${Y(h.y)}" text-anchor="middle" fill="${accent}">${esc(h.label)} ${n0(h.w!)} × ${n0(h.h!)}</text>`);
      out.push(`<text x="${X(h.x)}" y="${Y(h.y) + font + 4}" text-anchor="middle" fill="${accent}">ขอบกว้าง ${n0(h.x - h.w! / 2)}</text>`);
      continue;
    }
    // Centre mark and its distances from the left and bottom edges.
    out.push(`<path d="M${X(h.x) - 12},${Y(h.y)}h24M${X(h.x)},${Y(h.y) - 12}v24" stroke="${accent}" stroke-width="2"/>`);
    out.push(`<path d="M${X(0)},${Y(h.y)}H${X(h.x)}M${X(h.x)},${Y(0)}V${Y(h.y)}" stroke="${accent}" stroke-width="1" stroke-dasharray="6 6"/>`);
    out.push(`<text x="${X(h.x / 2)}" y="${Y(h.y) - 8}" text-anchor="middle" fill="${accent}">${n0(h.x)}</text>`);
    out.push(`<text x="${X(h.x) + 8}" y="${Y(h.y / 2)}" fill="${accent}">${n0(h.y)}</text>`);
    const size = h.d ? `Ø ${n0(h.d)}` : `${n0(h.w!)} × ${n0(h.h!)}`;
    out.push(`<text x="${X(h.x)}" y="${Y(h.y) + (h.d ? h.d / 2 : h.h! / 2) + font + 6}" text-anchor="middle" fill="${accent}">${esc(h.label)} ${size}</text>`);
  }
  // Overall width under the board, height to its left.
  out.push(`<path d="M${X(0)},${Y(0) + 30}H${X(p.w)}M${X(0)},${Y(0) + 20}v20M${X(p.w)},${Y(0) + 20}v20" stroke="${ink}" stroke-width="1.5"/>`);
  out.push(`<text x="${X(p.w / 2)}" y="${Y(0) + 30 + font}" text-anchor="middle" fill="${ink}">${n0(p.w)}</text>`);
  out.push(`<path d="M${X(0) - 30},${Y(0)}V${Y(p.h)}M${X(0) - 40},${Y(0)}h20M${X(0) - 40},${Y(p.h)}h20" stroke="${ink}" stroke-width="1.5"/>`);
  out.push(`<text x="${X(0) - 38}" y="${Y(p.h / 2)}" text-anchor="middle" fill="${ink}" transform="rotate(-90 ${X(0) - 38} ${Y(p.h / 2)})">${n0(p.h)}</text>`);
  if (p.outline) {
    // A trapezoid side: its short top edge too.
    const [, , [tx]] = p.outline;
    out.push(`<text x="${X(tx / 2)}" y="${Y(p.h) - 10}" text-anchor="middle" fill="${ink}">${n0(tx)}</text>`);
  }
  for (const b of p.bevels) out.push(`<text x="${X(p.w) - 6}" y="${b.edge === 'top' ? Y(p.h) - 10 : Y(0) + 30 + font}" text-anchor="end" fill="#b45309">ตัดเอียง ${b.deg}°</text>`);
  out.push('</svg>');
  return out.join('');
}

/** One stock sheet with its boards placed, for the saw (labels on each board). */
export function sheetSvg(s: Sheet, parts: Part[], ink = '#0f172a', fill = '#e0f2fe'): string {
  const font = 46;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${s.w + 20} ${s.h + 20}" font-family="'IBM Plex Sans Thai','Noto Sans Thai',sans-serif" font-size="${font}">`];
  out.push(`<rect x="0" y="0" width="${s.w}" height="${s.h}" fill="none" stroke="${ink}" stroke-width="4" stroke-dasharray="20 10"/>`);
  for (const pl of s.parts) {
    const p = parts.find((x) => x.id === pl.part);
    out.push(`<rect x="${pl.x}" y="${pl.y}" width="${pl.w}" height="${pl.h}" fill="${fill}" stroke="${ink}" stroke-width="3"/>`);
    if (p?.outline) {
      // Trapezoid sides are cut from their bounding board: show the cut line.
      const pts = p.outline.map(([x, y]) => (pl.rotated ? [pl.x + y, pl.y + x] : [pl.x + x, pl.y + pl.h - y]));
      out.push(`<polygon points="${pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${ink}" stroke-width="2" stroke-dasharray="12 8"/>`);
    }
    const small = Math.min(font, pl.w / 8, pl.h / 2.6);
    out.push(`<text x="${pl.x + pl.w / 2}" y="${pl.y + pl.h / 2}" text-anchor="middle" font-size="${n0(small)}" fill="${ink}">${esc(pl.label)}</text>`);
    out.push(`<text x="${pl.x + pl.w / 2}" y="${pl.y + pl.h / 2 + small * 1.1}" text-anchor="middle" font-size="${n0(small * 0.8)}" fill="${ink}">${n0(pl.w)} × ${n0(pl.h)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

/**
 * Every sheet as one DXF (R12, millimetres) for a CNC router or a CAD program: board outlines
 * and holes at their nested positions, sheets side by side. Y is up, as DXF expects.
 */
export function blueprintDxf(bp: Blueprint): string {
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => out.push('0', 'LINE', '8', layer, '10', x1.toFixed(2), '20', y1.toFixed(2), '11', x2.toFixed(2), '21', y2.toFixed(2));
  const circle = (layer: string, x: number, y: number, r: number) => out.push('0', 'CIRCLE', '8', layer, '10', x.toFixed(2), '20', y.toFixed(2), '40', r.toFixed(2));
  const poly = (layer: string, pts: [number, number][]) => pts.forEach(([x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; line(layer, x, y, x2, y2); });
  let ox = 0;
  for (const s of bp.sheets) {
    poly('SHEET', [[ox, 0], [ox + s.w, 0], [ox + s.w, s.h], [ox, s.h]]);
    for (const pl of s.parts) {
      const p = bp.parts.find((x) => x.id === pl.part);
      if (!p) continue;
      // Board coordinates (x right, y up) → sheet coordinates; a turned board swaps its axes.
      const at = (x: number, y: number): [number, number] => (pl.rotated ? [ox + pl.x + y, s.h - pl.y - x] : [ox + pl.x + x, s.h - pl.y - pl.h + y]);
      poly('CUT', shapeOf(p).map(([x, y]) => at(x, y)));
      for (const h of p.holes) {
        const [cx, cy] = at(h.x, h.y);
        // Blind sockets go on their own layer so a router does not cut them through.
        if (h.d) circle(h.blind ? 'DRILL' : 'HOLES', cx, cy, h.d / 2);
        else poly('HOLES', ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]).map(([sx, sy]) => at(h.x + (sx * h.w!) / 2, h.y + (sy * h.h!) / 2)));
      }
    }
    ox += s.w + 200;
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\r\n') + '\r\n';
}
