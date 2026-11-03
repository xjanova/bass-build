import type { BoxType, BraceKind } from '../state/store';
import type { BoxGeometry } from './model';

/**
 * Where things sit on the boards, shared by the 3D model and the blueprint so the drawing always
 * matches what is on screen. Lengths in m; x across the box from its centre line.
 */

/** One hole in the front row: a driver, or a passive radiator in the front row. */
export interface RowItem { x: number; /** Frame radius. */ r: number; /** Hole radius cut in the board. */ cut: number; passive: boolean }

/** Gap between frames in a row, m. */
export const ROW_GAP = 0.03;

/** Height where the front baffle starts: above the slot port and its ceiling board, or on the floor. */
export const baffleBottom = (geo: Pick<BoxGeometry, 't' | 'slotH'>) => (geo.slotH > 0 ? geo.t + geo.slotH + geo.t : geo.t);

/** Drivers (and an odd passive radiator) across the front baffle as one row, centred on the box or where it was placed. */
export function frontRow(geo: BoxGeometry, boxType: BoxType, count: number): RowItem[] {
  const drivers = boxType === 'bp4' || boxType === 'bp6' ? 0 : boxType === 'isobaric' ? 1 : count;
  const prs = boxType === 'pr' ? geo.prLayout.front : 0;
  const items = Array.from({ length: drivers + prs }, (_, i) => i >= drivers
    ? { r: geo.prRadius, cut: geo.prRadius * 0.9, passive: true }
    : { r: geo.driverRadius, cut: geo.cutoutRadius, passive: false });
  const width = items.reduce((a, it) => a + 2 * it.r, 0) + ROW_GAP * Math.max(0, items.length - 1);
  let cursor = geo.rowX - width / 2;
  return items.map((it) => { const x = cursor + it.r; cursor += 2 * it.r + ROW_GAP; return { ...it, x }; });
}

/** Drivers hidden inside on a band-pass divider (or the isobaric inner one), x of each centre. */
export function innerRow(geo: BoxGeometry, boxType: BoxType, count: number): number[] {
  const n = boxType === 'isobaric' ? 1 : boxType === 'bp4' || boxType === 'bp6' ? count : 0;
  const spacing = 2 * geo.driverRadius + ROW_GAP;
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);
}

/** Passive radiators on each side panel, z of each centre (0 = middle of the depth). */
export const sideRow = (geo: BoxGeometry): number[] =>
  Array.from({ length: geo.prLayout.perSide }, (_, i) => (i - (geo.prLayout.perSide - 1) / 2) * (2 * geo.prRadius + ROW_GAP));

/** Wood that must stay round a cut-out, and between it and the slot port, m. */
export const EDGE_WOOD = 0.01;

/** Lowest a driver frame may reach: above the slot mouth or the row of tube holes (0 when the baffle is clear). */
export const frameFloor = (geo: BoxGeometry) =>
  geo.tubes ? geo.tubes.y + geo.tubes.od / 2 + EDGE_WOOD / 2 : geo.slotH > 0 ? baffleBottom(geo) : 0;

/**
 * Why the front row cannot sit where it is, or null when it fits: every cut-out needs wood round
 * it inside the baffle board, and no frame may cover the slot port's mouth or hang off the box.
 */
export function rowProblem(geo: BoxGeometry, boxType: BoxType, count: number): { side: 'left' | 'right' | 'top' | 'bottom' | 'slot'; by: number } | null {
  const row = frontRow(geo, boxType, count);
  if (!row.length) return null;
  const y = geo.driverY;
  const left = Math.min(...row.map((it) => Math.min(it.x - it.cut + geo.wi / 2 - EDGE_WOOD, it.x - it.r + geo.wx / 2)));
  const right = Math.min(...row.map((it) => Math.min(geo.wi / 2 - EDGE_WOOD - it.x - it.cut, geo.wx / 2 - it.x - it.r)));
  const top = Math.min(...row.map((it) => Math.min(geo.hx - geo.t - EDGE_WOOD - y - it.cut, geo.hx - y - it.r)));
  const bottom = Math.min(...row.map((it) => Math.min(y - it.cut - baffleBottom(geo) - EDGE_WOOD, y - it.r)));
  const slot = geo.slotH > 0 || geo.tubes ? Math.min(...row.map((it) => y - it.r - frameFloor(geo))) : Infinity;
  const worst = ([['left', left], ['right', right], ['top', top], ['bottom', bottom], ['slot', slot]] as const).reduce((a, b) => (b[1] < a[1] ? b : a));
  return worst[1] < -1e-6 ? { side: worst[0], by: -worst[1] } : null;
}

/**
 * Where the front row's centre may go (offset from the centre line, height above the floor, m)
 * with every cut-out inside the baffle and every frame on the box and clear of the slot port;
 * null when it cannot fit anywhere.
 */
export function rowRange(geo: BoxGeometry, boxType: BoxType, count: number): { x: [number, number]; y: [number, number] } | null {
  const row = frontRow(geo, boxType, count);
  if (!row.length) return null;
  const off = row.map((it) => ({ ...it, o: it.x - geo.rowX }));
  const bottom = baffleBottom(geo);
  const x: [number, number] = [
    Math.max(...off.map((it) => Math.max(-geo.wi / 2 + EDGE_WOOD + it.cut, -geo.wx / 2 + it.r) - it.o)),
    Math.min(...off.map((it) => Math.min(geo.wi / 2 - EDGE_WOOD - it.cut, geo.wx / 2 - it.r) - it.o))
  ];
  const y: [number, number] = [
    Math.max(...off.map((it) => Math.max(bottom + EDGE_WOOD + it.cut, it.r, frameFloor(geo) + it.r))),
    Math.min(...off.map((it) => Math.min(geo.hx - geo.t - EDGE_WOOD - it.cut, geo.hx - it.r)))
  ];
  return x[0] <= x[1] + 1e-9 && y[0] <= y[1] + 1e-9 ? { x, y } : null;
}

/** What `braceBottom` needs to know: the panel, the slot height and the row of round tubes. */
export type BraceBase = Pick<BoxGeometry, 't' | 'slotH'> & { tubes: { y: number; od: number } | null };
/** Where the braces start: on the slot ceiling, above the row of tubes, or on the floor (m). */
export const braceBottom = (geo: BraceBase) => (geo.tubes ? geo.tubes.y + geo.tubes.od / 2 + EDGE_WOOD : baffleBottom(geo));
/**
 * Height a brace plane spans, from `braceBottom` up to the underside of the top, m. The volume
 * breakdown and the layout both count dowel rows and size window bars from this one number.
 */
export const braceSpan = (geo: BraceBase & { hi: number }) => geo.hi + geo.t - braceBottom(geo);

/** Slot port boards: the ceiling run along the floor and the riser folded up the back (0 when none). */
export function slotBoards(geo: BoxGeometry): { run: number; riser: number } {
  if (geo.slotH <= 0) return { run: 0, riser: 0 };
  const run = Math.min(geo.portLength, geo.frontDepth - geo.slotH - 0.01);
  const rest = geo.portLength - run;
  const room = geo.shape === 'wedge' ? Math.hypot(geo.hi, geo.di - geo.diTop) - geo.slotH - geo.t : geo.hi - geo.slotH - geo.t;
  return { run, riser: rest > 0.02 ? Math.min(rest, room) : 0 };
}

// ---- bracing ------------------------------------------------------------------------------------

/** Width of the bars round a window brace, m (each frame is one panel thick). */
export const BRACE_BAR = 0.05;
/** Smallest window a frame keeps open (each way), m: less and the frame would seal off the drivers' pocket. */
export const BRACE_WINDOW_MIN = 0.04;
/** Narrowest bar a frame may shrink to in a small box, m (a thinner strip is not worth gluing in). */
export const BRACE_BAR_MIN = 0.02;
/**
 * Bar width of a window frame in a box `wi` wide whose planes span `span`: 50 mm, narrowed in a
 * small box so a window of at least BRACE_WINDOW_MIN stays open; null when even the narrowest bars
 * would leave less. A frame is never laid out as a solid board: glued all round, a solid board
 * splits the box into two sealed chambers and the driver would load only the small one in front.
 */
export const braceBar = (wi: number, span: number): number | null => {
  const bar = Math.min(BRACE_BAR, (Math.min(wi, span) - BRACE_WINDOW_MIN) / 2);
  return bar >= BRACE_BAR_MIN - 1e-9 ? bar : null;
};
/**
 * With passive radiators in the side panels a frame's side bars would run over their holes, so
 * each window plane is built as two cross bars instead: one under the top, one on the floor (or
 * the slot ceiling). They hold the top, not the sides.
 */
export const sidePrBars = (boxType: BoxType, perSide: number) => boxType === 'pr' && perSide > 0;
/** Hole a passive radiator needs cut in its panel, as a radius, m (its frame is 10 % wider and sits outside). */
export const prHoleRadius = (geo: Pick<BoxGeometry, 'prRadius'>) => geo.prRadius * 0.9;
/**
 * Dowel diameter, m. 25 mm round wood is a common hardware-store size, chosen here, not taken from
 * any datasheet: the blueprint asks the builder to measure the dowel they buy.
 */
export const DOWEL_D = 0.025;
/** Air and glue room kept between a brace and anything else inside the box, m. */
export const BRACE_GAP = 0.01;
export const MAX_BRACES = 3;
/** Brace planes a design asks for, 1–3 (stored designs may carry anything). */
export const braceCountOf = (n: number) => Math.min(MAX_BRACES, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
/** Dowels in each plane, by the height they span: two (at a third and two thirds up), one in a low box. */
export const dowelRows = (span: number) => (span >= 0.15 ? 2 : 1);
/** Where the isobaric inner driver's mounting board starts: its front face, depth behind the baffle's inside face, m. */
export const innerBaffleZ = (geo: BoxGeometry) => geo.driverDepth + 0.03 - geo.t;

export interface BracePlan {
  kind: BraceKind;
  /** Planes asked for (0 with no bracing). */
  count: number;
  /**
   * Centre of every plane that found a clear spot, front to back, as a depth behind the inside face
   * of the baffle, m. Planes run parallel to the baffle and the back, from `bottom` to `top`.
   */
  zs: number[];
  /** Thickness of one plane along the depth: one panel for a window frame, one dowel. */
  thick: number;
  /** Bottom and top of every plane, m above the outside floor. */
  bottom: number;
  top: number;
  /**
   * Window frames: their bar width and opening (centred, bars all round). null for other kinds,
   * and for a box too small for a frame with an opening (every plane is then missing).
   */
  window: { w: number; h: number; bar: number } | null;
  /**
   * Window planes built as two cross bars (top and bottom, no side bars) because passive
   * radiators sit in the side panels; they hold the top but not the sides.
   */
  barsOnly: boolean;
  /** Dowel brace: centre height of each dowel in a plane, m above the outside floor. */
  dowelYs: number[];
  /** Planes that found no clear spot, and what the first of them would have hit (Thai). */
  missing: number;
  blockedBy: string | null;
  /**
   * Lines along the depth where the side panels are held (window frames and dowels) and the top
   * panel (window frames and cross bars: dowels run side to side and miss it), m. Only the braces:
   * a band-pass divider or an isobaric inner baffle is not counted, so an unbraced box keeps the
   * unbraced numbers exactly and the panel estimate stays on the safe (lower) side.
   */
  sideHeld: number[];
  topHeld: number[];
}

/** No bracing: what a box gets before its brace plan is laid out. */
export const NO_BRACES: BracePlan = { kind: 'none', count: 0, zs: [], thick: 0, bottom: 0, top: 0, window: null, barsOnly: false, dowelYs: [], missing: 0, blockedBy: null, sideHeld: [], topHeld: [] };

interface Keepout { a: number; b: number; what: string }

/**
 * Lays the brace planes out along the depth: evenly spaced over the inside depth (a wedge's over its
 * shallow top depth, so every plane stays inside the leaning back — the rule the single brace always
 * had), then each plane that would hit something is moved to the nearest clear depth. What a plane
 * must stay clear of:
 * - every driver's basket and magnet, modelled as a cone from the cut-out down to a magnet half the
 *   frame's radius (an estimate). A window frame may sit where the basket passes through its opening;
 *   dowels cross the middle of the box, so they go where they miss the basket (usually behind it);
 * - the band-pass divider (with the driver frame in front of it), the isobaric tunnel and inner
 *   baffle, the slot port's riser, a bp6 rear port tube and the holes of side passive radiators
 *   (a window plane there is two cross bars, which only have to clear the holes at their ends).
 * The slot ceiling and the round front tubes are below `braceBottom`, so they never meet a brace.
 * A plane that finds no clear depth is counted in `missing` and becomes a build problem: moving it
 * further would leave the panel it is meant to hold as free as before, so the builder decides.
 */
export function bracePlan(geo: BoxGeometry, boxType: BoxType, count: number, kind: BraceKind, n: number): BracePlan {
  const t = geo.t;
  const bottom = braceBottom(geo), top = geo.hx - t;
  const span = top - bottom;
  const bar = braceBar(geo.wi, span);
  const window = bar !== null ? { w: geo.wi - 2 * bar, h: span - 2 * bar, bar } : null;
  const barsOnly = kind === 'window' && sidePrBars(boxType, geo.prLayout.perSide);
  const rows = dowelRows(span);
  const dowelYs = kind === 'dowel' ? Array.from({ length: rows }, (_, i) => bottom + (span * (i + 1)) / (rows + 1)) : [];
  const bandpass = boxType === 'bp4' || boxType === 'bp6';
  const none: BracePlan = { ...NO_BRACES, bottom, top };
  if (kind === 'none') return none;
  const want = braceCountOf(n);
  const thick = kind === 'dowel' ? DOWEL_D : t;
  if (kind === 'window' && !window) {
    // No frame with an opening fits this cross-section, and a solid one would seal the driver in.
    return { ...none, kind, count: want, thick, missing: want, blockedBy: 'ตู้เล็กเกินกว่าจะเจาะช่องโครงค้ำ' };
  }

  /** Does a plane at `s` behind a mounting face clear a basket centred at (x, y), radius r0 there narrowing to r1 at `depth`? */
  const clears = (s: number, x: number, y: number, r0: number, r1: number, depth: number) => {
    if (s >= depth) return true;
    const rad = r0 + ((r1 - r0) * s) / depth;
    if (kind === 'window') {
      const b = window!.bar;
      return (barsOnly || Math.abs(x) + rad + BRACE_GAP <= geo.wi / 2 - b) && y - rad - BRACE_GAP >= bottom + b && y + rad + BRACE_GAP <= top - b;
    }
    return dowelYs.every((yd) => Math.abs(yd - y) >= rad + DOWEL_D / 2 + BRACE_GAP);
  };
  /** Depth behind the mounting face from which on a plane clears the basket (the basket narrows). */
  const clearFrom = (x: number, y: number, r0: number, r1: number, depth: number) => {
    for (let s = 0; s < depth; s += 0.002) if (clears(s, x, y, r0, r1, depth)) return s;
    return depth;
  };
  const keep: Keepout[] = [];
  const mounts = (z0: number, xs: { x: number; r0: number; r1: number; depth: number }[], what: string) => {
    for (const it of xs) {
      const s = clearFrom(it.x, geo.driverY, it.r0, it.r1, it.depth);
      if (s > 0) keep.push({ a: z0, b: z0 + s, what });
    }
  };
  /** A driver's basket: the cut-out behind the frame, narrowing to a magnet about half the frame's radius (estimate). */
  const basket = (x: number) => ({ x, r0: geo.cutoutRadius, r1: 0.5 * geo.driverRadius, depth: geo.driverDepth });
  // Front row: baskets start at the outside face of the baffle; a passive radiator has no basket,
  // only its diaphragm moving in by a few centimetres.
  mounts(-t, frontRow(geo, boxType, count).map((it) => (it.passive ? { x: it.x, r0: it.r, r1: it.r, depth: t + 0.03 } : basket(it.x))), 'ลำโพง');
  if (bandpass) {
    // The driver frame and its cone's travel stand a few centimetres in front of the divider.
    keep.push({ a: geo.frontDepth - 0.03, b: geo.frontDepth + t, what: 'แผ่นกั้นห้อง' });
    mounts(geo.frontDepth, innerRow(geo, boxType, count).map(basket), 'ลำโพงบนแผ่นกั้น');
  }
  if (boxType === 'isobaric') {
    const zb = innerBaffleZ(geo);
    keep.push({ a: 0, b: zb + t, what: 'อุโมงค์ลำโพงประกบ' });
    mounts(zb, innerRow(geo, boxType, count).map(basket), 'ลำโพงตัวใน');
  }
  const wedge = geo.shape === 'wedge';
  const slot = slotBoards(geo);
  // A plain box's riser stands one slot height in front of the back (or the divider).
  if (slot.riser > 0 && !wedge) keep.push({ a: geo.frontDepth - geo.slotH - t, b: geo.frontDepth, what: 'ท่อสลอตที่พับขึ้น' });
  if (boxType === 'pr' && geo.prLayout.perSide > 0) {
    // Where a plane meets the side panel (the ends of the cross bars, the dowel sockets) it must
    // stay clear of each radiator's hole, centred half-way up: a hole of radius R reaches
    // ±√(R² − dy²) along the depth at a height dy from its centre.
    const yc = geo.hx / 2;
    const ends: [number, number, number][] = barsOnly
      ? [[bottom, bottom + window!.bar, 0], [top - window!.bar, top, 0]]
      : dowelYs.map((yd): [number, number, number] => [yd, yd, DOWEL_D / 2]);
    for (const [y0, y1, pad] of ends) {
      const dy = Math.max(0, y0 - yc, yc - y1);
      const reach = prHoleRadius(geo) + pad + BRACE_GAP;
      if (dy >= reach) continue;
      const half = Math.sqrt(reach * reach - dy * dy);
      for (const z of sideRow(geo)) { const c = geo.dx / 2 - t - z; keep.push({ a: c - half, b: c + half, what: 'PR ข้างตู้' }); }
    }
  }
  if (geo.rearPort) {
    const rp = geo.rearPort;
    const run = Math.max(0.02, Math.min(rp.length, rp.room));
    const hit = kind === 'window'
      ? rp.y - rp.radius < bottom + window!.bar + BRACE_GAP && rp.y + rp.radius > bottom - BRACE_GAP
      : dowelYs.some((yd) => Math.abs(yd - rp.y) < rp.radius + DOWEL_D / 2 + BRACE_GAP);
    if (hit) keep.push({ a: geo.di - run, b: geo.di, what: 'ท่อหลัง' });
  }
  // A wedge's planes stay inside its top depth (and in front of a riser leaning up the back).
  const room = wedge ? geo.diTop - (slot.riser > 0 ? (geo.slotH + t) / Math.cos(geo.backAngle) : 0) : geo.di;
  const pad = thick / 2 + BRACE_GAP;
  // Clear stretches for a plane's centre, cut down by every keep-out widened by half a plane.
  const cutOut = (free: [number, number][], a: number, b: number) => free.flatMap(([lo, hi]): [number, number][] =>
    b <= lo || a >= hi ? [[lo, hi]] : [...(a > lo ? [[lo, a] as [number, number]] : []), ...(b < hi ? [[b, hi] as [number, number]] : [])]);
  let free: [number, number][] = room - pad > pad ? [[pad, room - pad]] : [];
  for (const k of keep) free = cutOut(free, k.a - pad, k.b + pad);
  const ideal = wedge ? geo.diTop : geo.di;
  const zs: number[] = [];
  let missing = 0, blockedBy: string | null = null;
  for (let i = 1; i <= want; i++) {
    const z0 = (i * ideal) / (want + 1);
    let best: number | null = null;
    for (const [lo, hi] of free) { const z = Math.min(hi, Math.max(lo, z0)); if (best === null || Math.abs(z - z0) < Math.abs(best - z0)) best = z; }
    if (best === null) {
      missing++;
      // Name what took the room: the obstacle at (or else nearest) where the plane belonged.
      const near = [...keep].sort((p, q) => Math.max(0, p.a - z0, z0 - p.b) - Math.max(0, q.a - z0, z0 - q.b))[0];
      blockedBy ??= near?.what ?? 'ความลึกตู้';
      continue;
    }
    zs.push(best);
    // The next plane keeps a gap from this one.
    free = cutOut(free, best - thick - BRACE_GAP, best + thick + BRACE_GAP);
  }
  zs.sort((a, b) => a - b);
  return {
    kind, count: want, zs, thick, bottom, top, window: kind === 'window' ? window : null, barsOnly, dowelYs, missing, blockedBy,
    // Cross bars meet the sides only at their ends; dowels run side to side and never touch the top.
    sideHeld: barsOnly ? [] : [...zs],
    topHeld: kind === 'window' ? [...zs] : []
  };
}

/**
 * Bays of a panel along the depth between the lines where it is held, inside depth from the baffle's
 * inside face (0) to `depth`, m. With nothing inside, one bay the whole depth.
 */
export function bays(held: number[], depth: number): [number, number][] {
  const lines = [0, ...held.filter((z) => z > 0 && z < depth).sort((a, b) => a - b), depth];
  return lines.slice(1).map((b, i) => [lines[i], b]);
}

/** Longest free span of a panel along the depth, m (the whole depth when nothing holds it). */
export const freeSpan = (held: number[], depth: number) => Math.max(...bays(held, depth).map(([a, b]) => b - a));
