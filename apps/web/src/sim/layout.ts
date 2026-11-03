import type { BoxType } from '../state/store';
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
export const baffleBottom = (geo: BoxGeometry) => (geo.slotH > 0 ? geo.t + geo.slotH + geo.t : geo.t);

/** Drivers (and an odd passive radiator) across the front baffle, centred as one row. */
export function frontRow(geo: BoxGeometry, boxType: BoxType, count: number): RowItem[] {
  const drivers = boxType === 'bp4' || boxType === 'bp6' ? 0 : boxType === 'isobaric' ? 1 : count;
  const prs = boxType === 'pr' ? geo.prLayout.front : 0;
  const items = Array.from({ length: drivers + prs }, (_, i) => i >= drivers
    ? { r: geo.prRadius, cut: geo.prRadius * 0.9, passive: true }
    : { r: geo.driverRadius, cut: geo.cutoutRadius, passive: false });
  const width = items.reduce((a, it) => a + 2 * it.r, 0) + ROW_GAP * Math.max(0, items.length - 1);
  let cursor = -width / 2;
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

/** Slot port boards: the ceiling run along the floor and the riser folded up the back (0 when none). */
export function slotBoards(geo: BoxGeometry): { run: number; riser: number } {
  if (geo.slotH <= 0) return { run: 0, riser: 0 };
  const run = Math.min(geo.portLength, geo.frontDepth - geo.slotH - 0.01);
  const rest = geo.portLength - run;
  const room = geo.shape === 'wedge' ? Math.hypot(geo.hi, geo.di - geo.diTop) - geo.slotH - geo.t : geo.hi - geo.slotH - geo.t;
  return { run, riser: rest > 0.02 ? Math.min(rest, room) : 0 };
}
