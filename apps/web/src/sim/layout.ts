import type { BoxType, BraceKind, HandleKind, TerminalKind } from '../state/store';
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

/** Free air a port's open inner end needs before a wall: about one slot height (one diameter for a tube), at least 3 cm. */
export const portEndGap = (size: number) => Math.max(0.03, size);

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
  // Hardware reaching inside: the terminal's cup or studs at the back, recessed handle cups on
  // the sides. A plane is kept off them where its bars or dowels would cross them.
  const hitsPlane = (x0: number, x1: number, y0: number, y1: number) => {
    const g = BRACE_GAP;
    if (kind === 'dowel') return dowelYs.some((yd) => y0 - g < yd + DOWEL_D / 2 && y1 + g > yd - DOWEL_D / 2);
    const w = window!;
    const inOuter = x1 + g > -geo.wi / 2 && x0 - g < geo.wi / 2 && y1 + g > bottom && y0 - g < top;
    if (!inOuter) return false;
    if (barsOnly) return y0 - g < bottom + w.bar || y1 + g > top - w.bar;
    // A frame: everything but its opening.
    return !(x0 - g >= -w.w / 2 && x1 + g <= w.w / 2 && y0 - g >= bottom + w.bar && y1 + g <= top - w.bar);
  };
  const term = geo.terminal;
  // Only hardware that fits: what does not is reported on its own, not blamed on the braces too.
  if (term?.fits && term.inside > 0 && term.panel === 'back') {
    const cos = Math.cos(geo.backAngle);
    const y0 = term.y - (term.body.h / 2) * cos, y1 = term.y + (term.body.h / 2) * cos;
    if (hitsPlane(term.x - term.body.w / 2, term.x + term.body.w / 2, y0, y1)) keep.push({ a: depthAt(geo, y1) - term.inside, b: geo.di, what: 'ขั้วต่อลำโพง' });
  } else if (term?.fits && term.inside > 0 && hitsPlane(-geo.wi / 2, -geo.wi / 2 + term.inside, term.y - term.body.h / 2, term.y + term.body.h / 2)) {
    keep.push({ a: term.z - t - term.body.w / 2, b: term.z - t + term.body.w / 2, what: 'ขั้วต่อลำโพง' });
  }
  const hd = geo.handles;
  if (hd?.fits && hd.hole && hd.inside > 0 && hitsPlane(geo.wi / 2 - hd.inside, geo.wi / 2, hd.y - hd.hole.h / 2, hd.y + hd.hole.h / 2)) {
    keep.push({ a: hd.z - hd.hole.w / 2 - t, b: hd.z + hd.hole.w / 2 - t, what: 'มือจับฝัง' });
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

// ---- hardware: speaker terminal and handles -----------------------------------------------------

/**
 * Sizes of the speaker terminal, m. None of them comes from a datasheet: the cup's 80 × 80 mm
 * cut-out is the seed's own estimate (materials.json, terminal_cup, "ตรวจกับสินค้าจริง"); its
 * 100 mm plate and 40 mm depth, and the posts' Ø 10 mm holes 19 mm apart (the usual pitch of a
 * dual banana plug) are typical sizes chosen here. The UI and the BOM say they are estimates.
 */
export const TERMINAL_SPEC: Record<TerminalKind, {
  /** Plate on the outside face (posts: the room their knobs need), across × up. */
  plate: [number, number];
  /** Rectangular cut-out (cup), or null for round post holes. */
  hole: [number, number] | null;
  /** Post holes: diameter and centre-to-centre pitch. */
  postD: number; pitch: number;
  /** From the outside face to the back of the cup (or the end of a post stud with its lug). */
  depth: number;
}> = {
  cup: { plate: [0.1, 0.1], hole: [0.08, 0.08], postD: 0, pitch: 0, depth: 0.04 },
  posts: { plate: [0.05, 0.03], hole: null, postD: 0.01, pitch: 0.019, depth: 0.03 }
};

/**
 * Handle sizes, m, typical of what is sold for speaker cabinets — estimates, not a product's
 * datasheet (the BOM says "ตรวจกับสินค้าจริง"). A bar handle is 200 mm long on two screws 170 mm
 * apart and stands 35 mm off the panel; a recessed cup has a 200 × 135 mm flange over a
 * 180 × 115 mm cut-out and is 80 mm deep. Both lie along the depth of the side panel.
 */
export const HANDLE_SPEC = {
  surface: { plate: [0.2, 0.03] as [number, number], screwPitch: 0.17, standOff: 0.035 },
  recessed: { plate: [0.2, 0.135] as [number, number], hole: [0.18, 0.115] as [number, number], depth: 0.08 }
} as const;
/** Gap between the top of a handle's plate and the top edge of the side panel, m. */
export const HANDLE_TOP_GAP = 0.02;
/** Wall of a rear port tube round its bore, m (unknown until the tube is bought: a PVC-like estimate). */
const PORT_WALL = 0.01;

/** Air the terminal takes, m³: the part of the cup (or the two post studs) inside the inner face. */
export function terminalVolume(kind: TerminalKind, t: number): number {
  const s = TERMINAL_SPEC[kind] ?? TERMINAL_SPEC.cup;
  const inside = Math.max(0, s.depth - t);
  return s.hole ? s.hole[0] * s.hole[1] * inside : 2 * Math.PI * (s.postD / 2) ** 2 * inside;
}
/** Air two recessed handle cups take, m³ (bar handles take none). */
export function handleVolume(kind: HandleKind, t: number): number {
  if (kind !== 'recessed') return 0;
  const s = HANDLE_SPEC.recessed;
  return 2 * s.hole[0] * s.hole[1] * Math.max(0, s.depth - t);
}

/** Length of the back board, m: between top and bottom, up the lean on a wedge (as the cut list draws it). */
export const backLength = (geo: Pick<BoxGeometry, 'hx' | 't' | 'dx' | 'dxTop'>) => {
  const sideH = geo.hx - 2 * geo.t;
  return Math.hypot(sideH, (geo.dx - geo.dxTop) * (sideH / geo.hx));
};
/** Inside depth at a height y above the outside floor, m (a wedge is shallower higher up). */
export const depthAt = (geo: Pick<BoxGeometry, 'di' | 'diTop' | 'hi' | 't'>, y: number) =>
  geo.di - (geo.di - geo.diTop) * Math.min(1, Math.max(0, (y - geo.t) / geo.hi));
/** Outside depth of a side panel at a height y above the outside floor, m. */
const outerDepthAt = (geo: Pick<BoxGeometry, 'dx' | 'dxTop' | 'hx'>, y: number) => geo.dx - (geo.dx - geo.dxTop) * (y / geo.hx);

/** Distance from a point to a rectangle (0 inside it). */
const toRect = (px: number, py: number, x0: number, x1: number, y0: number, y1: number) =>
  Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));

/** Top of the front port band along the floor (slot ceiling, or the row of tubes), m above the outside floor; 0 without one. */
const portBandTop = (geo: BoxGeometry) => (geo.slotH > 0 ? geo.t + geo.slotH + geo.t : geo.tubes ? geo.tubes.y + geo.tubes.od / 2 : 0);

/**
 * What a block of hardware reaching into the box would hit, or null: `xs` are its sides across
 * (from the centre line), `y0..y1` its height above the outside floor, `a..b` its depth behind the
 * baffle's inner face. Checked: every driver's basket (a cone from the cut-out to a magnet half the
 * frame's radius, the brace layout's estimate) or a front passive radiator's travel, the band-pass
 * divider and its drivers, the isobaric inner baffle and its driver, and a slot riser with the
 * channel behind it (plus its mouth's end gap above it). Braces are laid out afterwards round it.
 */
function insideHit(geo: BoxGeometry, boxType: BoxType, count: number, x0: number, x1: number, y0: number, y1: number, a: number, b: number): string | null {
  const t = geo.t;
  const near = (px: number, py: number) => toRect(px, py, x0, x1, y0, y1);
  /** A basket from radius r0 at depth `from` narrowing to r1 at `from + depth`: does it reach the block? */
  const basket = (px: number, py: number, r0: number, r1: number, from: number, depth: number) => {
    const lo = Math.max(a, from), hi = Math.min(b, from + depth);
    const dist = near(px, py);
    for (let s = lo; s <= hi + 1e-9; s += 0.005) if (dist < r0 + ((r1 - r0) * (s - from)) / depth + BRACE_GAP) return true;
    return false;
  };
  for (const it of frontRow(geo, boxType, count)) {
    const hit = it.passive ? basket(it.x, geo.driverY, it.r, it.r, -t, t + 0.03) : basket(it.x, geo.driverY, geo.cutoutRadius, 0.5 * geo.driverRadius, -t, geo.driverDepth);
    if (hit) return it.passive ? 'PR หน้าตู้' : 'โครงลำโพง';
  }
  const bandpass = boxType === 'bp4' || boxType === 'bp6';
  const span = (p: number, q: number) => b > p - BRACE_GAP && a < q + BRACE_GAP;
  if (bandpass) {
    if (span(geo.frontDepth - 0.03, geo.frontDepth + t)) return 'แผ่นกั้นห้อง';
    for (const x of innerRow(geo, boxType, count)) if (basket(x, geo.driverY, geo.cutoutRadius, 0.5 * geo.driverRadius, geo.frontDepth, geo.driverDepth)) return 'โครงลำโพง';
  }
  if (boxType === 'isobaric') {
    const zb = innerBaffleZ(geo);
    if (span(zb, zb + t)) return 'แผงยึดลำโพงตัวใน';
    for (const x of innerRow(geo, boxType, count)) if (basket(x, geo.driverY, geo.cutoutRadius, 0.5 * geo.driverRadius, zb, geo.driverDepth)) return 'โครงลำโพง';
  }
  const slot = slotBoards(geo);
  if (slot.riser > 0) {
    // The riser stands one slot height in front of the back (or the divider), up to its open top.
    const rTop = t + geo.slotH + t + slot.riser;
    const back = bandpass ? geo.frontDepth : depthAt(geo, y1);
    // Up a wedge the riser leans, so it takes a little more depth measured level.
    if (y0 < rTop + portEndGap(geo.slotH) && span(back - (geo.slotH + t) / Math.cos(geo.backAngle), back)) return 'ท่อสลอตที่พับขึ้น';
  }
  return null;
}

/** Where the back of the drivers' magnets sits, as discs on the back panel's plane, with the clear depth behind them, m. */
function magnetsAtBack(geo: BoxGeometry, boxType: BoxType, count: number): { x: number; y: number; r: number; gap: (y: number) => number }[] {
  const r = 0.5 * geo.driverRadius; // magnet about half the frame's radius (estimate, as the brace layout uses)
  const bandpass = boxType === 'bp4' || boxType === 'bp6';
  // The same clear depth the magnet check in sizeBox measures.
  if (bandpass) return innerRow(geo, boxType, count).map((x) => ({ x, y: geo.driverY, r, gap: () => geo.di * geo.rearFraction - geo.t - geo.driverDepth }));
  if (boxType === 'isobaric') return [{ x: 0, y: geo.driverY, r, gap: () => geo.di - 2 * geo.driverDepth - 0.03 }];
  return frontRow(geo, boxType, count).filter((it) => !it.passive).map((it) => ({ x: it.x, y: geo.driverY, r, gap: (y: number) => depthAt(geo, y) - geo.driverDepth }));
}

export interface TerminalPlan {
  kind: TerminalKind;
  /**
   * The panel it is on: the back, or — when a slot folded up the back leaves no room there — the
   * left side panel (as seen from the front).
   */
  panel: 'back' | 'side';
  /** On the back: centre across from the centre line, and along the board from its bottom edge (up the lean on a wedge), m. */
  x: number;
  s: number;
  /** On the side: centre's depth from the front edge, m. */
  z: number;
  /** Height of the centre above the outside floor, m. */
  y: number;
  /** Plate on the outside face, and what sits inside past the inner face (cup body, or the two studs), across × up the panel, m. */
  plate: { w: number; h: number };
  body: { w: number; h: number };
  /** Cup: one rectangular cut-out. Posts: none (see `posts`). */
  hole: { w: number; h: number } | null;
  /** Posts: centre of each round hole across the panel from the terminal's centre, and their diameter, m. */
  posts: number[];
  postD: number;
  /** How far the terminal reaches inside past the panel's inner face, m. */
  inside: number;
  fits: boolean;
  /** What took the room when it does not fit (Thai). */
  blockedBy: string | null;
}

/**
 * The speaker terminal, low and centred on the back panel: as low as it can go and as near the
 * centre line as it can, clear of
 * - the slot port: a riser folded up the back is a port channel the full width of the back, so the
 *   terminal goes above its open top (with the port's end gap); a slot or tube row along the floor
 *   keeps it above the port band;
 * - the 6th-order band-pass rear port hole (and its tube wall);
 * - the back of the magnets, where they come within the terminal's depth of the back.
 * The plate stays on the back board and the cut-out keeps EDGE_WOOD of wood round it; on a wedge
 * every position is measured up the leaning board. When the folded slot leaves no room on the back,
 * the terminal goes low on the left side panel instead, near the front, clear of the drivers'
 * baskets, the riser and the handles — so a long port is not made unbuildable by the terminal.
 */
export function terminalPlan(geo: BoxGeometry, boxType: BoxType, count: number, kind: TerminalKind): TerminalPlan {
  const spec = TERMINAL_SPEC[kind] ?? TERMINAL_SPEC.cup;
  const t = geo.t, cos = Math.cos(geo.backAngle);
  const len = backLength(geo);
  const half = geo.wi / 2;
  const [pw, ph] = spec.plate;
  const posts = spec.hole ? [] : [-spec.pitch / 2, spec.pitch / 2];
  // Inside the box: the cup's body, or the two studs with their lugs (5 mm round each).
  const [bw, bh] = spec.hole ?? [spec.pitch + spec.postD + 0.01, spec.postD + 0.01];
  const inside = Math.max(0, spec.depth - t);
  const bandpass = boxType === 'bp4' || boxType === 'bp6';
  const slot = slotBoards(geo);
  const riserBack = !bandpass && slot.riser > 0;
  // Lowest the inside part may start, along the board.
  let sMin = 0;
  let floorWhat: string | null = null;
  if (riserBack) {
    // A wedge's riser starts above the slot ceiling and leans with the back.
    sMin = (geo.shape === 'wedge' ? (geo.slotH + t) / cos : geo.slotH) + slot.riser + portEndGap(geo.slotH);
    floorWhat = 'ท่อสลอตที่พับขึ้นผนังหลัง';
  } else if (!bandpass && portBandTop(geo) > 0) {
    sMin = (portBandTop(geo) - t) / cos + EDGE_WOOD;
    floorWhat = geo.slotH > 0 ? 'ท่อสลอต' : 'ท่อกลม';
  }
  const rp = geo.rearPort;
  const rpS = rp ? rp.y - t : 0;
  const rpR = rp ? rp.radius + PORT_WALL + EDGE_WOOD : 0;
  const magnets = inside > 0 ? magnetsAtBack(geo, boxType, count) : [];
  const yOf = (s: number) => t + s * cos;
  const why = (x: number, s: number): string | null => {
    if (Math.abs(x) + pw / 2 > half + 1e-9 || Math.abs(x) + bw / 2 + EDGE_WOOD > half + 1e-9) return 'ผนังหลังแคบเกินไป';
    if (s - ph / 2 < -1e-9 || s - bh / 2 < EDGE_WOOD - 1e-9) return 'ผนังหลังเตี้ยเกินไป';
    if (s + ph / 2 > len + 1e-9 || s + bh / 2 + EDGE_WOOD > len + 1e-9) return floorWhat ? `ชน${floorWhat}` : 'ผนังหลังเตี้ยเกินไป';
    if (s - bh / 2 < sMin - 1e-9) return `ชน${floorWhat}`;
    if (rp && toRect(0, rpS, x - pw / 2, x + pw / 2, s - ph / 2, s + ph / 2) < rpR - 1e-9) return 'ชนรูท่อหลัง';
    for (const m of magnets) {
      const y0 = yOf(s - bh / 2), y1 = yOf(s + bh / 2);
      if (m.gap(y1) < inside + BRACE_GAP && toRect(m.x, m.y, x - bw / 2, x + bw / 2, y0, y1) < m.r + BRACE_GAP) return 'ชนท้ายแม่เหล็ก';
    }
    return null;
  };
  const sLow = Math.max(ph / 2, bh / 2 + EDGE_WOOD, sMin + bh / 2);
  // Candidate spots: centred low, then beside or above whatever is in the way.
  const xs = [0];
  const ss = [sLow];
  if (rp) { xs.push(rpR + pw / 2, -(rpR + pw / 2)); ss.push(rpS + rpR + ph / 2); }
  for (const m of magnets) {
    xs.push(m.x + m.r + BRACE_GAP + bw / 2, m.x - m.r - BRACE_GAP - bw / 2);
    ss.push((m.y + m.r + BRACE_GAP - t) / cos + bh / 2);
  }
  let best: { x: number; s: number; cost: number } | null = null;
  for (const x of xs) for (const s of ss) {
    if (s < sLow - 1e-9 || why(x, s)) continue;
    const cost = s - sLow + Math.abs(x);
    if (!best || cost < best.cost - 1e-12) best = { x, s, cost };
  }
  const base = {
    kind, plate: { w: pw, h: ph }, body: { w: bw, h: bh }, hole: spec.hole ? { w: spec.hole[0], h: spec.hole[1] } : null, posts, postD: spec.postD, inside
  };
  if (best) return { ...base, panel: 'back', x: best.x, s: best.s, z: 0, y: yOf(best.s), fits: true, blockedBy: null };
  let backWhy = why(0, sLow) ?? 'ไม่มีที่ว่างบนผนังหลัง';
  if (riserBack) {
    const side = sideTerminal(geo, boxType, count, base);
    if (side) return side;
    backWhy += ' และผนังข้างก็ไม่มีที่ว่าง';
  }
  // Nowhere: drawn centred low on the back, and reported.
  const s = Math.min(sLow, Math.max(ph / 2, len - ph / 2));
  return { ...base, panel: 'back', x: 0, s, z: 0, y: yOf(s), fits: false, blockedBy: backWhy };
}

/** The terminal low on the left side panel, as far forward as it can go; null when it does not fit there either. */
function sideTerminal(geo: BoxGeometry, boxType: BoxType, count: number, base: Omit<TerminalPlan, 'panel' | 'x' | 's' | 'z' | 'y' | 'fits' | 'blockedBy'>): TerminalPlan | null {
  const t = geo.t;
  const { w: pw, h: ph } = base.plate, { w: bw, h: bh } = base.body;
  // Low, just above the slot ceiling (and the side's bottom edge).
  const y = Math.max(t + ph / 2, portBandTop(geo) + bh / 2 + EDGE_WOOD);
  const y0 = y - bh / 2, y1 = y + bh / 2;
  if (y1 + EDGE_WOOD > geo.hx - t || y + ph / 2 > geo.hx - t) return null;
  // From just behind the baffle backwards (depth of its centre behind the baffle's inner face):
  // brace planes start a quarter of the depth back at the earliest, so a terminal up front leaves
  // them where they belong; it moves back only past a driver's basket, never into the riser's channel.
  const lean = 1 / Math.cos(geo.backAngle);
  const backmost = depthAt(geo, y1) - (geo.slotH + t) * lean - BRACE_GAP - bw / 2;
  const hd = geo.handles;
  for (let c = EDGE_WOOD + bw / 2; c <= backmost + 1e-9; c += 0.01) {
    const z = t + c; // from the front edge
    if (z - pw / 2 < 0 || z + pw / 2 > outerDepthAt(geo, y + ph / 2)) continue;
    if (hd && toRect(hd.z, hd.y, z - pw / 2 - hd.plate.w / 2, z + pw / 2 + hd.plate.w / 2, y - ph / 2 - hd.plate.h / 2, y + ph / 2 + hd.plate.h / 2) < EDGE_WOOD) continue;
    if (base.inside > 0 && insideHit(geo, boxType, count, -geo.wi / 2, -geo.wi / 2 + base.inside, y0, y1, c - bw / 2, c + bw / 2)) continue;
    return { ...base, panel: 'side', x: -geo.wi / 2, s: 0, z, y, fits: true, blockedBy: null };
  }
  return null;
}

export interface HandlePlan {
  kind: Exclude<HandleKind, 'none'>;
  /** Centre on each side panel's outside face: depth from the front edge, and height above the outside floor, m (both sides alike). */
  z: number;
  y: number;
  /** Plate (or bar) on the outside, along the depth × up, m. */
  plate: { w: number; h: number };
  /** Recessed cup's cut-out, or null for a bar handle (screwed on, nothing cut). */
  hole: { w: number; h: number } | null;
  /** Bar handle: its two screws, depth from the front edge, at height `y`, m. */
  screws: number[];
  /** How far a cup reaches into the box past the side's inner face, m (0 for a bar). */
  inside: number;
  /** How far a bar stands off the side, m (it makes the box that much wider to carry). */
  standOff: number;
  fits: boolean;
  blockedBy: string | null;
}

/**
 * Handles on both side panels near the top, centred along the depth there (a wedge's top is
 * shallower). They must lie on the side panel (a recessed cup's cut-out inside the box with
 * EDGE_WOOD round it), stay clear of side-mounted passive radiators, and a recessed cup — which
 * reaches into the box — must not meet the other cup or anything `insideHit` checks.
 */
export function handlePlan(geo: BoxGeometry, boxType: BoxType, count: number, kind: HandleKind): HandlePlan | null {
  if (kind !== 'surface' && kind !== 'recessed') return null;
  const t = geo.t;
  const recessed = kind === 'recessed';
  const [pw, ph] = HANDLE_SPEC[kind].plate;
  const hole = recessed ? { w: HANDLE_SPEC.recessed.hole[0], h: HANDLE_SPEC.recessed.hole[1] } : null;
  const inside = recessed ? Math.max(0, HANDLE_SPEC.recessed.depth - t) : 0;
  const top = geo.hx - t - HANDLE_TOP_GAP;
  const y = top - ph / 2;
  // Centred on the inside depth at the plate's top, measured from the front edge.
  const z = t + depthAt(geo, top) / 2;
  const screws = recessed ? [] : [z - HANDLE_SPEC.surface.screwPitch / 2, z + HANDLE_SPEC.surface.screwPitch / 2];
  const out: HandlePlan = { kind, z, y, plate: { w: pw, h: ph }, hole, screws, inside, standOff: recessed ? 0 : HANDLE_SPEC.surface.standOff, fits: true, blockedBy: null };
  const fail = (what: string): HandlePlan => ({ ...out, fits: false, blockedBy: what });
  // On the side panel: the plate on its outside face (between the bottom and top panels, the front
  // edge and the back); a cup's cut-out inside the box with wood round it.
  if (y - ph / 2 < t || z - pw / 2 < EDGE_WOOD || z + pw / 2 > outerDepthAt(geo, top) - EDGE_WOOD) return fail('ผนังข้างเล็กเกินกว่าจะติดมือจับ');
  if (hole) {
    const hTop = y + hole.h / 2, hBot = y - hole.h / 2;
    if (hBot < t + EDGE_WOOD || hTop > geo.hx - t - EDGE_WOOD || z - hole.w / 2 < t + EDGE_WOOD || z + hole.w / 2 > t + depthAt(geo, hTop) - EDGE_WOOD) {
      return fail('ผนังข้างเล็กเกินกว่าจะเจาะช่องมือจับ');
    }
    if (2 * inside + 2 * BRACE_GAP > geo.wi) return fail('ตู้แคบ ถ้วยมือจับสองข้างชนกัน');
  }
  // Side passive radiators: their frames sit on the same outside faces, centred half-way up.
  if (boxType === 'pr' && geo.prLayout.perSide > 0) {
    for (const zr of sideRow(geo)) {
      if (toRect(geo.dx / 2 - zr, geo.hx / 2, z - pw / 2, z + pw / 2, y - ph / 2, y + ph / 2) < geo.prRadius + EDGE_WOOD) return fail('ชน PR ข้างตู้');
    }
  }
  if (!hole) return out;
  // Inside: each cup as a block against its side (the layout is symmetric, so one side tells).
  const a = z - hole.w / 2 - t, b = z + hole.w / 2 - t;
  const y0 = y - hole.h / 2, y1 = y + hole.h / 2;
  const hitR = insideHit(geo, boxType, count, geo.wi / 2 - inside, geo.wi / 2, y0, y1, a, b);
  const hitL = hitR ?? insideHit(geo, boxType, count, -geo.wi / 2, -geo.wi / 2 + inside, y0, y1, a, b);
  return hitL ? fail(`ถ้วยมือจับชน${hitL}`) : out;
}
