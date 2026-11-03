import { buildNetwork } from '@bassbuild/physics';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../src/data/types';
import { blueprintDxf, blueprintFor, cutListCsv, KERF, nest, partArea, partSvg, partsFor, sheetSvg, type Part } from '../src/sim/blueprint';
import { driverFromDto, sizeBox, suggestDesign, toSpec, type BoxGeometry } from '../src/sim/model';
import { DEFAULT_DESIGN, type BoxType, type Design } from '../src/state/store';

const drivers = (seed.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }) as DriverDto);
const damping = (materials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }) as DampingMaterialDto);
const mdf = { ...(materials.panelMaterials[0] as unknown as PanelMaterialDto), id: 1 };
const dto = drivers.find((d) => d.model === '18BMA-2000S')!;
const drv = driverFromDto(dto);
if (!drv.ok) throw new Error('incomplete');
const driver = drv.driver;

/** The suggested box of a type for the test driver, laid out. */
function boxOf(type: BoxType, extra: Partial<Design> = {}): { d: Design; geo: BoxGeometry } {
  const start = { ...DEFAULT_DESIGN, boxType: type, ...extra };
  const d = { ...start, ...suggestDesign(start, driver, dto, damping).patch };
  return { d, geo: sizeBox(d, dto, buildNetwork(toSpec(d, driver, damping)), mdf) };
}
const byId = (ps: Part[], id: string) => ps.find((p) => p.id === id)!;

describe('boards of the box', () => {
  it('a vented box: six shell boards, the slot port boards and a brace, sized as the 3D model', () => {
    const { d, geo } = boxOf('vented');
    const ps = partsFor(d, geo);
    const t = d.thicknessMm;
    expect(ps.map((p) => p.id)).toEqual(expect.arrayContaining(['bottom', 'top', 'side', 'back', 'baffle', 'port-ceiling', 'brace']));
    expect(byId(ps, 'bottom').w).toBeCloseTo(geo.wx * 1000, 6);
    expect(byId(ps, 'bottom').h).toBeCloseTo(geo.dx * 1000, 6);
    // Two side boards: one part cut twice, or a left and a right when the terminal had to go on the left side.
    expect(ps.filter((p) => p.id === 'side' || p.id === 'side-left').reduce((a, p) => a + p.qty, 0)).toBe(2);
    expect(byId(ps, 'side').h).toBeCloseTo(geo.hx * 1000 - 2 * t, 6);
    expect(byId(ps, 'back').w).toBeCloseTo(geo.wi * 1000, 6);
    // Baffle sits on the slot ceiling: floor + slot + ceiling board + baffle + top = outside height.
    expect(t + geo.slotH * 1000 + t + byId(ps, 'baffle').h + t).toBeCloseTo(geo.hx * 1000, 6);
  });

  it('every hole lies inside its board, clear of the edges', () => {
    for (const type of ['sealed', 'vented', 'pr', 'bp4', 'bp6', 'isobaric'] as const) {
      const { d, geo } = boxOf(type, type === 'pr' ? { prCount: 3 } : {});
      for (const p of partsFor(d, geo)) for (const h of p.holes) {
        const rx = h.d ? h.d / 2 : h.w! / 2, ry = h.d ? h.d / 2 : h.h! / 2;
        expect(h.x - rx, `${type} ${p.name} ${h.label}`).toBeGreaterThan(0);
        expect(h.x + rx).toBeLessThan(p.w);
        expect(h.y - ry).toBeGreaterThan(0);
        expect(h.y + ry).toBeLessThan(p.h);
      }
    }
  });

  it('band-pass and isobaric boxes get their inside boards with the drivers on them', () => {
    const bp = partsFor(...Object.values(boxOf('bp4')) as [Design, BoxGeometry]);
    expect(byId(bp, 'divider').holes.filter((h) => h.kind === 'driver')).toHaveLength(1);
    expect(byId(bp, 'baffle').holes).toHaveLength(0);
    const iso = partsFor(...Object.values(boxOf('isobaric')) as [Design, BoxGeometry]);
    expect(byId(iso, 'inner-baffle').holes).toHaveLength(1);
    expect(byId(iso, 'baffle').holes).toHaveLength(1);
    const b6 = boxOf('bp6');
    expect(byId(partsFor(b6.d, b6.geo), 'back').holes[0].kind).toBe('port');
  });

  it('a wedge has trapezoid sides and angled edges on the back, top and bottom', () => {
    const { d, geo } = boxOf('sealed', { shape: 'wedge', wedgeTopPct: 50 });
    const ps = partsFor(d, geo);
    const side = byId(ps, 'side');
    expect(side.outline).toHaveLength(4);
    expect(side.outline![2][0]).toBeLessThan(side.outline![1][0]); // shallower at the top
    expect(byId(ps, 'top').h).toBeCloseTo(geo.dxTop * 1000, 6);
    const deg = (geo.backAngle * 180) / Math.PI;
    expect(byId(ps, 'back').bevels.map((b) => b.deg)).toEqual([Math.round(deg * 10) / 10, Math.round(deg * 10) / 10]);
    expect(partArea(side)).toBeLessThan((side.w * side.h) / 1e6);
  });
});

describe('nesting on stock sheets', () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w + KERF - 1e-6 && b.x < a.x + a.w + KERF - 1e-6 && a.y < b.y + b.h + KERF - 1e-6 && b.y < a.y + a.h + KERF - 1e-6;

  it('places every board once, inside the sheet, without overlapping', () => {
    const { d, geo } = boxOf('vented', { count: 2 });
    const ps = partsFor(d, geo);
    const { sheets, oversize } = nest(ps, 1220, 2440);
    expect(oversize).toEqual([]);
    const placed = sheets.flatMap((s) => s.parts);
    expect(placed).toHaveLength(ps.reduce((a, p) => a + p.qty, 0));
    for (const s of sheets) {
      for (const pl of s.parts) {
        expect(pl.x).toBeGreaterThanOrEqual(0);
        expect(pl.x + pl.w).toBeLessThanOrEqual(s.w);
        expect(pl.y + pl.h).toBeLessThanOrEqual(s.h);
        const p = byId(ps, pl.part);
        expect([pl.w, pl.h].sort()).toEqual([p.w, p.h].sort());
      }
      s.parts.forEach((a, i) => s.parts.slice(i + 1).forEach((b) => expect(overlap(a, b), `${a.label} / ${b.label}`).toBe(false)));
    }
  });

  it('uses no more sheets than the board area needs plus a little', () => {
    const { d, geo } = boxOf('sealed');
    const bp = blueprintFor({ d, geo, dto, material: mdf, damping });
    expect(bp.sheets.length).toBeLessThanOrEqual(Math.ceil(bp.totals.boardM2 / (1.22 * 2.44 * 0.75)));
    expect(bp.totals.waste).toBeGreaterThan(0);
    expect(bp.totals.waste).toBeLessThan(1);
  });

  it('a board longer than the sheet is listed, not placed', () => {
    const long: Part = { id: 'x', name: 'ยาวมาก', qty: 1, w: 300, h: 2600, t: 18, holes: [], bevels: [], face: false };
    const r = nest([long], 1220, 2440);
    expect(r.oversize).toEqual(['ยาวมาก']);
    expect(r.sheets).toHaveLength(0);
  });
});

describe('materials, steps and exports', () => {
  const { d, geo } = boxOf('vented', { stuffing: 0.5 });
  const bp = blueprintFor({ d, geo, dto, material: mdf, damping });

  it('lists the sheets, the driver, screws and the fill', () => {
    expect(bp.bom[0].qty).toBe(`${bp.sheets.length} แผ่น`);
    expect(bp.bom.some((b) => b.item.includes('18BMA-2000S'))).toBe(true);
    expect(bp.totals.screws).toBeGreaterThan(0);
    expect(bp.totals.screws % 10).toBe(0);
    expect(bp.bom.some((b) => b.item.includes('ใย'))).toBe(true);
    expect(bp.steps.length).toBeGreaterThan(6);
  });

  it('writes a CSV Excel reads as Thai, one row per board', () => {
    const csv = cutListCsv(bp);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.trim().split('\r\n')).toHaveLength(bp.parts.length + 1);
  });

  it('writes a DXF with a circle per round hole and four lines per rectangle', () => {
    const dxf = blueprintDxf(bp);
    expect(dxf.endsWith('EOF\r\n')).toBe(true);
    const circles = dxf.split('\r\n').filter((l) => l === 'CIRCLE').length;
    const round = bp.parts.reduce((a, p) => a + p.qty * p.holes.filter((h) => h.d).length, 0);
    expect(circles).toBe(round);
  });

  it('draws each board and sheet as SVG with its overall sizes', () => {
    const baffle = byId(bp.parts, 'baffle');
    const svg = partSvg(baffle);
    expect(svg).toContain(`>${Math.round(baffle.w)}<`);
    expect(svg).toContain('<circle');
    expect(sheetSvg(bp.sheets[0], bp.parts)).toContain('<rect');
  });
});
