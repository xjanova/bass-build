import { buildNetwork } from '@bassbuild/physics';
import { describe, expect, it } from 'vitest';
import seed from '../../../data/seed/drivers.json';
import materials from '../../../data/seed/materials.json';
import { sanitizeDesign } from '../src/data/compare';
import type { DampingMaterialDto, DriverDto } from '../src/data/types';
import { blueprintFor, partsFor, type Hole, type Part } from '../src/sim/blueprint';
import { fitHardware, problemsFor, type BuildCtx } from '../src/sim/buildable';
import { backLength, EDGE_WOOD, HANDLE_SPEC, slotBoards, TERMINAL_SPEC, terminalPlan } from '../src/sim/layout';
import { buildProblems, driverFromDto, sizeBox, suggestDesign, toSpec, type BoxGeometry } from '../src/sim/model';
import { DEFAULT_DESIGN, type BoxType, type Design } from '../src/state/store';

const drivers = (seed.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }) as DriverDto);
const damping = (materials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }) as DampingMaterialDto);
const ctxOf = (model: string): BuildCtx => {
  const dto = drivers.find((d) => d.model === model)!;
  const r = driverFromDto(dto);
  if (!r.ok) throw new Error('incomplete');
  return { dto, driver: r.driver, damping };
};
const ctx = ctxOf('18BMA-2000S');
const geoOf = (d: Design, c: BuildCtx = ctx): BoxGeometry => sizeBox(d, c.dto, buildNetwork(toSpec(d, c.driver, damping)), undefined);
const codes = (d: Design, c: BuildCtx = ctx) => problemsFor(d, c).map((p) => p.code);
/** The suggested (buildable) box of a type for a driver. */
const boxOf = (type: BoxType, extra: Partial<Design> = {}, c: BuildCtx = ctx): Design => {
  const start = { ...DEFAULT_DESIGN, boxType: type, ...extra };
  return { ...start, ...suggestDesign(start, c.driver, c.dto, damping).patch };
};
const byId = (ps: Part[], id: string) => ps.find((p) => p.id === id)!;
const termHoles = (p: Part) => p.holes.filter((h) => h.kind === 'terminal');
/** Every hole inside its board with wood round it (rectangles and circles alike). */
const inside = (p: Part, h: Hole) => {
  const rx = h.d ? h.d / 2 : h.w! / 2, ry = h.d ? h.d / 2 : h.h! / 2;
  return h.x - rx >= EDGE_WOOD * 1000 - 1e-6 && h.x + rx <= p.w - EDGE_WOOD * 1000 + 1e-6 && h.y - ry >= EDGE_WOOD * 1000 - 1e-6 && h.y + ry <= p.h - EDGE_WOOD * 1000 + 1e-6;
};
const sealed = boxOf('sealed');
/** A vented box whose slot runs straight (a short port): nothing folds up the back. */
const straight: Design = { ...boxOf('vented'), fbHz: 45, portAreaCm2: 300 };

describe('stored designs', () => {
  it('new hardware fields default for old saves and only take known choices', () => {
    const { terminal: _t, handles: _h, ...old } = DEFAULT_DESIGN;
    const s = sanitizeDesign(old, DEFAULT_DESIGN);
    expect(s.terminal).toBe('cup');
    expect(s.handles).toBe('none');
    expect(sanitizeDesign({ terminal: 'posts', handles: 'recessed' }, DEFAULT_DESIGN)).toMatchObject({ terminal: 'posts', handles: 'recessed' });
    expect(sanitizeDesign({ terminal: 'speakon', handles: 'rope' }, DEFAULT_DESIGN)).toMatchObject({ terminal: 'cup', handles: 'none' });
    expect(sanitizeDesign({ terminal: 1, handles: true }, DEFAULT_DESIGN)).toMatchObject({ terminal: 'cup', handles: 'none' });
  });
});

describe('speaker terminal', () => {
  it('a cup goes low and centred on the back panel: a rectangular cut-out inside the board, in the BOM and the steps', () => {
    const g = geoOf(sealed);
    expect(codes(sealed)).toEqual([]);
    expect(g.terminal.panel).toBe('back');
    expect(g.terminal.x).toBe(0);
    // As low as its plate allows on a box with nothing along the floor.
    expect(g.terminal.s).toBeCloseTo(TERMINAL_SPEC.cup.plate[1] / 2, 9);
    const bp = blueprintFor({ d: sealed, geo: g, dto: ctx.dto, material: undefined, damping });
    const back = byId(bp.parts, 'back');
    const [h] = termHoles(back);
    expect(termHoles(back)).toHaveLength(1);
    expect(h.w).toBeCloseTo(80, 6);
    expect(h.h).toBeCloseTo(80, 6);
    expect(h.x).toBeCloseTo(back.w / 2, 6);
    expect(inside(back, h)).toBe(true);
    expect(bp.parts.filter((p) => p.id !== 'back').flatMap(termHoles)).toEqual([]);
    const line = bp.bom.find((l) => l.item.includes('ถ้วย'))!;
    expect(line.qty).toBe('1 ชุด');
    expect(line.note).toContain('ตรวจกับสินค้าจริง');
    expect(line.note).toContain('ประมาณ');
    expect(bp.steps.some((s) => s.includes('ขั้วต่อ 80 × 80'))).toBe(true);
  });

  it('binding posts are two Ø 10 mm holes 19 mm apart, an estimate', () => {
    const d = { ...sealed, terminal: 'posts' as const };
    const g = geoOf(d);
    const holes = termHoles(byId(partsFor(d, g), 'back'));
    expect(holes).toHaveLength(2);
    expect(holes.every((h) => h.d === 10)).toBe(true);
    expect(Math.abs(holes[0].x - holes[1].x)).toBeCloseTo(19, 6);
    const line = blueprintFor({ d, geo: g, dto: ctx.dto, material: undefined, damping }).bom.find((l) => l.item.includes('binding post'))!;
    expect(line.note).toContain('ประมาณ');
    // The studs take next to no air; the cup's body takes what reaches past the inner face.
    expect(g.volume.terminalL).toBeLessThan(0.01);
    expect(geoOf(sealed).volume.terminalL).toBeCloseTo(0.08 * 0.08 * (TERMINAL_SPEC.cup.depth - sealed.thicknessMm / 1000) * 1000, 9);
  });

  it('a slot along the floor keeps it above the slot ceiling', () => {
    const g = geoOf(straight);
    expect(codes(straight)).toEqual([]);
    expect(slotBoards(g).riser).toBe(0);
    expect(g.terminal.panel).toBe('back');
    const bottomOfCup = g.terminal.y - TERMINAL_SPEC.cup.hole![1] / 2;
    expect(bottomOfCup).toBeGreaterThan(g.t + g.slotH + g.t);
  });

  it('a 6th-order band-pass: clear of the rear port hole on the back', () => {
    const d = boxOf('bp6');
    expect(codes(d)).toEqual([]);
    const g = geoOf(d);
    const back = byId(partsFor(d, g), 'back');
    const port = back.holes.find((h) => h.kind === 'port')!;
    for (const h of termHoles(back)) {
      expect(inside(back, h)).toBe(true);
      // Nearest point of the cut-out to the port's centre stays outside the port hole.
      const dx = Math.max(h.x - h.w! / 2 - port.x, 0, port.x - (h.x + h.w! / 2));
      const dy = Math.max(h.y - h.h! / 2 - port.y, 0, port.y - (h.y + h.h! / 2));
      expect(Math.hypot(dx, dy)).toBeGreaterThan(port.d! / 2 + 10);
    }
  });

  it('a wedge: on the leaning back, measured up the board', () => {
    const d = { ...sealed, shape: 'wedge' as const, wedgeTopPct: 60 };
    const g = geoOf(d);
    expect(codes(d)).toEqual([]);
    expect(g.terminal.panel).toBe('back');
    expect(g.terminal.s + TERMINAL_SPEC.cup.plate[1] / 2).toBeLessThanOrEqual(backLength(g) + 1e-9);
    expect(g.terminal.y).toBeCloseTo(g.t + g.terminal.s * Math.cos(g.backAngle), 9);
    const back = byId(partsFor(d, g), 'back');
    expect(back.h).toBeCloseTo(backLength(g) * 1000, 6);
    for (const h of termHoles(back)) expect(inside(back, h)).toBe(true);
  });

  it('a slot folded up the whole back: on the left side panel instead, low, in front of the riser', () => {
    const d = boxOf('vented');
    const g = geoOf(d);
    const slot = slotBoards(g);
    expect(slot.riser).toBeGreaterThan(0);
    // No room left above the riser's open top on the back.
    expect(terminalPlan(g, d.boxType, d.count, 'cup').panel).toBe('side');
    expect(codes(d)).toEqual([]);
    expect(g.terminal.panel).toBe('side');
    expect(g.terminal.y - TERMINAL_SPEC.cup.hole![1] / 2).toBeGreaterThan(g.t + g.slotH + g.t);
    expect(g.terminal.z - g.t + TERMINAL_SPEC.cup.hole![0] / 2).toBeLessThan(g.di - g.slotH - g.t);
    const ps = partsFor(d, g);
    expect(byId(ps, 'side').qty).toBe(1);
    expect(termHoles(byId(ps, 'side'))).toEqual([]);
    const left = byId(ps, 'side-left');
    expect(termHoles(left)).toHaveLength(1);
    for (const h of termHoles(left)) expect(inside(left, h)).toBe(true);
    expect(termHoles(byId(ps, 'back'))).toEqual([]);
  });

  it('nowhere to put it is a build problem with a Thai reason', () => {
    const g = geoOf(sealed);
    const narrow = { ...g, wi: 0.07 };
    const plan = terminalPlan(narrow, 'sealed', 1, 'cup');
    expect(plan.fits).toBe(false);
    const p = buildProblems(sealed, ctx.dto, { ...g, terminal: plan }).find((x) => x.code === 'terminal')!;
    expect(p.text).toContain('ผนังหลังแคบ');
    expect(p.text).toContain('หลักคู่');
  });
});

describe('handles', () => {
  it('recessed cups: a cut-out near the top of both sides, inside the board, and less room for air', () => {
    const d = { ...sealed, handles: 'recessed' as const };
    const g = geoOf(d), g0 = geoOf(sealed);
    expect(codes(d)).toEqual([]);
    const side = byId(partsFor(d, g), 'side');
    expect(side.qty).toBe(2);
    const holes = side.holes.filter((h) => h.kind === 'handle');
    expect(holes).toHaveLength(1);
    expect(holes[0].w).toBeCloseTo(HANDLE_SPEC.recessed.hole[0] * 1000, 6);
    expect(inside(side, holes[0])).toBe(true);
    // Near the top: the cut-out's top within a few centimetres of the side's top edge.
    expect(side.h - (holes[0].y + holes[0].h! / 2)).toBeLessThan(50);
    // Their air comes out of the box: same net volume, a bigger shell, and the breakdown says why.
    const cups = 2 * HANDLE_SPEC.recessed.hole[0] * HANDLE_SPEC.recessed.hole[1] * (HANDLE_SPEC.recessed.depth - g.t) * 1000;
    expect(g.volume.handlesL).toBeCloseTo(cups, 9);
    expect(g0.volume.handlesL).toBe(0);
    expect(g.volume.netL).toBe(g0.volume.netL);
    expect(g.volume.shellL - g0.volume.shellL).toBeCloseTo(cups, 1);
    const v = g.volume;
    expect(v.shellL - v.driversL - v.portsL - v.boardsL - v.bracesL - v.tunnelL - v.terminalL - v.handlesL - v.extraL).toBeCloseTo(v.netL, 6);
    const bp = blueprintFor({ d, geo: g, dto: ctx.dto, material: undefined, damping });
    const line = bp.bom.find((l) => l.item.includes('มือจับฝัง'))!;
    expect(line.qty).toBe('2 ชิ้น');
    expect(line.note).toContain('ตรวจกับสินค้าจริง');
    expect(bp.steps.some((s) => s.includes('มือจับฝัง'))).toBe(true);
  });

  it('braces move off the recessed cups', () => {
    const d = { ...sealed, handles: 'recessed' as const, braceKind: 'window' as const, braceCount: 1 };
    const g = geoOf(d);
    const hd = g.handles!;
    const a = hd.z - hd.hole!.w / 2 - g.t, b = hd.z + hd.hole!.w / 2 - g.t;
    expect(g.braces.zs).toHaveLength(1);
    for (const z of g.braces.zs) expect(z + g.t / 2 <= a || z - g.t / 2 >= b).toBe(true);
  });

  it('bar handles: no hole, screw positions in the BOM and on the side board', () => {
    const d = { ...sealed, handles: 'surface' as const };
    const g = geoOf(d);
    expect(codes(d)).toEqual([]);
    expect(g.volume.handlesL).toBe(0);
    const ps = partsFor(d, g);
    expect(ps.flatMap((p) => p.holes).filter((h) => h.kind === 'handle')).toEqual([]);
    expect(byId(ps, 'side').note).toContain('สกรู 2 ตัว');
    const bp = blueprintFor({ d, geo: g, dto: ctx.dto, material: undefined, damping });
    expect(bp.bom.find((l) => l.item.includes('ติดผิว'))!.qty).toBe('2 ชิ้น');
    const screws = bp.bom.find((l) => l.item.includes('สกรูยึดมือจับ'))!;
    expect(screws.qty).toBe('4 ตัว');
    for (const z of g.handles!.screws) expect(screws.note).toContain(String(Math.round(z * 1000)));
  });

  it('a side panel too small for recessed cups is a build problem, and smaller handles fix it', () => {
    // A steep wedge: its side panel is shallow at the top, where the handles go.
    const box: Design = { ...sealed, shape: 'wedge', wedgeTopPct: 25 };
    expect(codes(box)).toEqual([]);
    const d = { ...box, handles: 'recessed' as const };
    expect(geoOf(d).diTop).toBeLessThan(HANDLE_SPEC.recessed.hole[0]);
    expect(codes(d)).toContain('handles');
    expect(problemsFor(d, ctx).find((p) => p.code === 'handles')!.text).toContain('ผนังข้าง');
    // A 200 mm bar does not fit up there either: no handles is the change that builds.
    expect(codes({ ...d, handles: 'surface' })).toContain('handles');
    const fix = fitHardware(d, ctx)!;
    expect(fix).toEqual({ handles: 'none' });
    expect(codes({ ...d, ...fix })).toEqual([]);
    // A less steep wedge has room up top for a bar but not for the cup's cut-out: the bar is the fix.
    const mid = [30, 35, 40, 45, 50, 55, 60].map((p) => ({ ...d, wedgeTopPct: p }))
      .find((x) => codes(x).includes('handles') && !codes({ ...x, handles: 'surface' }).length);
    expect(mid).toBeDefined();
    expect(fitHardware(mid!, ctx)).toEqual({ handles: 'surface' });
  });

  it('handles that would hit side passive radiators are a build problem; a taller box clears them', () => {
    const d = boxOf('pr', { prCount: 2 });
    expect(codes(d)).toEqual([]);
    expect(geoOf(d).prLayout.perSide).toBe(1);
    for (const handles of ['recessed', 'surface'] as const) {
      const g = geoOf({ ...d, handles });
      expect(g.handles!.fits).toBe(false);
      expect(g.handles!.blockedBy).toContain('PR');
      expect(codes({ ...d, handles })).toContain('handles');
    }
    const tall = { ...d, handles: 'recessed' as const, hMode: 'fixed' as const, hMm: 900 };
    const g = geoOf(tall);
    expect(g.handles!.y - g.handles!.plate.h / 2).toBeGreaterThan(g.hx / 2 + g.prRadius);
    expect(codes(tall)).not.toContain('handles');
  });

  it('the suggested box swaps hardware that does not fit for smaller hardware, not a bigger box', () => {
    const start = { ...DEFAULT_DESIGN, boxType: 'pr' as const, prCount: 2, handles: 'recessed' as const };
    const s = suggestDesign(start, ctx.driver, ctx.dto, damping);
    expect(s.flags).toContain('hardware-reduced');
    expect(s.patch.handles).toBe('none');
    expect(codes({ ...start, ...s.patch })).toEqual([]);
    expect(s.patch.vbL).toBe(boxOf('pr', { prCount: 2 }).vbL);
  });
});
