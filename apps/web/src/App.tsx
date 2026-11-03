import { abs, pressureAt, type Cx } from '@bassbuild/physics';
import { useEffect, useMemo, useState } from 'react';
import { loadDampingMaterials, loadDrivers, loadPanelMaterials } from './data/api';
import { sanitizeDesign, type Slot } from './data/compare';
import { resultConfidence } from './sim/confidence';
import type { NotebookCtx } from './sim/formulas';
import { driverFromDto, fillFor, maxOutputFor, mountOf, panelModes, ratedWatts, simulate, suggestDesign, sizeBox, solveAt, summarize, thermalAt, toSpec, wallDamping, warningsFor } from './sim/model';
import { rowRange } from './sim/layout';
import { LAB_GRID } from './sim/wizard';
import { DEFAULT_DESIGN, useApp, type BoxType } from './state/store';
import { ChartDock } from './ui/ChartDock';
import { Notebook } from './ui/Notebook';
import { useDriverLook } from './ui/useDriverLook';
import { Hud, IrPanel, LeftPanel, OverlayBar, ToastHost, TopBar } from './ui/Panels';
import { RightPanel } from './ui/RightPanel';
import { LibraryView } from './ui/Library';
import { WizardView } from './ui/Wizard';
import { BlueprintView } from './ui/Blueprint';
import { Splash, TeaserDialog } from './ui/Showcase';
import type { EngineInput, Osc } from './viewport/Engine';
import { Viewport } from './viewport/Viewport';

const TYPE_CODE: Record<BoxType, string> = { sealed: 'SB', vented: 'VB', pr: 'PR', bp4: 'B4', bp6: 'B6', isobaric: 'IB' };
const IR_SPEEDUP = 20;
const TYPE_TH: Record<BoxType, string> = { sealed: 'ตู้ปิด', vented: 'ตู้เปิด', pr: 'PR', bp4: 'BP4', bp6: 'BP6', isobaric: 'Isobaric' };
const scaleCx = (z: Cx, k: number): Cx => ({ re: z.re * k, im: z.im * k });
const sumCx = (zs: Cx[]): Cx => zs.reduce((a, b) => ({ re: a.re + b.re, im: a.im + b.im }), { re: 0, im: 0 });

export function App() {
  const s = useApp();
  const { design: d, drivers, driverId, materials, damping, genHz, overlays, mode } = s;

  useEffect(() => {
    const ctrl = new AbortController();
    loadDrivers(ctrl.signal).then(({ drivers, source }) => useApp.getState().setDrivers(drivers, source)).catch(() => {});
    loadPanelMaterials(ctrl.signal).then((m) => useApp.getState().setMaterials(m)).catch(() => {});
    loadDampingMaterials(ctrl.signal).then((m) => useApp.getState().setDamping(m)).catch(() => {});
    return () => ctrl.abort();
  }, []);

  const dto = drivers.find((x) => x.id === driverId);
  // A dual-voice-coil driver is re-expressed for the coil wiring chosen in the design.
  const drv = useMemo(() => driverFromDto(dto, d.coilWiring), [dto, d.coilWiring]);
  const spec = useMemo(() => (drv.ok ? toSpec(d, drv.driver, damping) : null), [d, drv, damping]);

  // First visit: size the starting box for the starting driver instead of showing a box made for
  // some other driver. Only while the design is untouched, so nobody's work is ever replaced.
  useEffect(() => {
    const st = useApp.getState();
    if (st.design !== DEFAULT_DESIGN || !drv.ok || !dto) return;
    // Not an undo step: undoing it would bring back the default box, which is then sized again.
    st.patchDesign(suggestDesign(st.design, drv.driver, dto, st.damping).patch, { history: false });
  }, [drv, dto]);

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) step through the design's history.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      // Typing in a text box keeps the browser's own undo.
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); useApp.getState().undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); useApp.getState().redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const res = useMemo(() => (spec ? simulate(spec, LAB_GRID) : null), [spec]);
  const material = materials.find((m) => m.key === d.materialKey);
  const wall = useMemo(() => wallDamping(d, material, damping), [d, material, damping]);
  const geo = useMemo(() => (res ? sizeBox(d, dto, res, material, wall.massKgM2) : null), [d, dto, res, material, wall]);
  const warnings = useMemo(() => (res && geo ? warningsFor(d, dto, res, geo) : []), [d, dto, res, geo]);
  const max = useMemo(() => (res ? maxOutputFor(d, dto, res) : null), [d, dto, res]);
  const conf = useMemo(() => resultConfidence(d, dto, res, geo), [d, dto, res, geo]);
  const modes = geo ? panelModes(geo, material, wall.f11Factor) : { side: 0, back: 0, top: 0 };
  const f11 = modes.side;

  // Burn-in clock for the infrared view: runs only while IR is on, restarts when it is switched back
  // on. Simulated time runs 20× faster so the slow magnet warm-up shows within a minute or two.
  const [burn, setBurn] = useState(0);
  const irOn = mode === 'lab' && overlays.ir;
  useEffect(() => {
    if (!irOn) { setBurn(0); return; }
    const t0 = performance.now();
    const id = window.setInterval(() => setBurn(((performance.now() - t0) / 1000) * IR_SPEEDUP), 250);
    return () => window.clearInterval(id);
  }, [irOn]);
  // Each voice coil gets its share of the amplifier power; Pe is per driver.
  const nDrivers = d.boxType === 'isobaric' ? 2 : d.count;
  const pe = ratedWatts(dto, d);
  const thermal = useMemo(() => ({ ...thermalAt(d.watts / nDrivers, pe, burn), seconds: burn }), [d.watts, nDrivers, pe, burn]);

  const osc = useMemo<{ osc: Osc; spl: number; boxPa: Cx } | null>(() => {
    if (!spec || !drv.ok) return null;
    const sol = solveAt(spec, genHz);
    const w = 2 * Math.PI * genHz;
    const driver0 = sol.drivers[0];
    const port = sol.passives.find((p) => p.label === 'port' || p.label === 'front port' || p.label.startsWith('port '));
    const pr = sol.passives.find((p) => p.label.startsWith('passive radiator'));
    const front = sol.radiators.filter((r) => r.id === 'cone');
    const out = sol.radiators.filter((r) => r.id === 'port' || r.id === 'pr');
    const rear = sol.radiators.filter((r) => r.id === 'port-rear');
    // Loudest chamber pressure (RMS): what pushes on the walls.
    const boxPa = sol.pressures.slice(1).reduce((m, p) => (abs(p) > abs(m) ? p : m), { re: 0, im: 0 });
    const toX = (u: Cx, area: number): Cx => scaleCx({ re: u.im / (w * area), im: -u.re / (w * area) }, Math.SQRT2); // u/(jωA)
    return {
      osc: {
        coneX: scaleCx(driver0.x, Math.SQRT2),
        prX: pr && pr.area ? toX(pr.u, pr.area) : null,
        portV: port && port.area ? scaleCx(port.u, Math.SQRT2 / port.area) : null,
        // Inside a band-pass the cone faces a chamber: only the ports reach the room.
        coneU: front.length ? sumCx(front.map((r) => r.u)) : null,
        portU: out.length ? sumCx(out.map((r) => r.u)) : null,
        port2U: rear.length ? sumCx(rear.map((r) => r.u)) : null
      },
      spl: 20 * Math.log10(Math.max(abs(pressureAt(sol)), 1e-12) / 2e-5),
      boxPa
    };
  }, [spec, drv, genHz]);

  // Side panel (the one drawn) driven by the box pressure at the generator frequency: a single-mode (1,1)
  // resonator with the wall's loss factor, H = 1/√((1−r²)² + (ηr)²), r = f/f11.
  const vib = useMemo(() => {
    const r = f11 > 0 ? genHz / f11 : 0;
    const h = 1 / Math.sqrt((1 - r * r) ** 2 + (wall.eta * r) ** 2);
    const lag = Math.atan2(wall.eta * r, 1 - r * r);
    const pk = osc ? abs(osc.boxPa) * Math.SQRT2 : 0;
    // Square-root scale so a quiet wall is still visible and a resonating one does not fly off.
    const amp = Math.min(1.5, Math.max(0.05, Math.sqrt((pk * h) / 4000)));
    return { r, h, pk, amp, phase: (osc ? Math.atan2(osc.boxPa.im, osc.boxPa.re) : 0) - lag };
  }, [f11, genHz, wall.eta, osc]);

  const label = `${dto?.model ?? ''} · ${TYPE_TH[d.boxType]} ${d.vbL} L · ${d.watts} W`;
  const makeSlot = (): Slot => ({
    label, design: d, driverId, driverName: dto ? `${dto.brand} ${dto.model}` : '—',
    curves: res!.curves, maxSpl: max?.maxSpl ?? null, summary: summarize(d, dto, res!, geo, max), savedAt: Date.now()
  });
  const loadSlot = (slot: Slot) => {
    const st = useApp.getState();
    const before = { driverId: st.driverId, design: st.design };
    if (slot.driverId !== null && !st.drivers.some((x) => x.id === slot.driverId)) {
      st.showToast(`ลำโพงของตู้นี้ (${slot.driverName}) ไม่มีในคลังแล้ว จึงเปิดไม่ได้ ยังดูเส้นเทียบได้ตามเดิม`);
      return;
    }
    if (slot.driverId !== null) st.selectDriver(slot.driverId);
    // A slot saved by an older build may lack newer fields (or carry odd ones): start from the defaults.
    st.patchDesign(sanitizeDesign(slot.design, DEFAULT_DESIGN));
    st.showToast(`เปิด ${slot.label} ในแล็บแล้ว`, {
      label: 'ย้อนกลับ',
      run: () => { const now = useApp.getState(); if (before.driverId !== null) now.selectDriver(before.driverId); now.patchDesign(before.design); }
    });
  };
  const nbCtx = useMemo<NotebookCtx | null>(() => (s.notebook ? {
    d, dto, driver: drv.ok ? drv.driver : null, res, geo, material, wall, modes, max, fill: fillFor(d, damping), conf
  } : null), [s.notebook, d, dto, drv, res, geo, material, wall, modes.side, modes.back, modes.top, max, damping, conf]); // eslint-disable-line react-hooks/exhaustive-deps

  // The selected driver as measured and photographed (generic proportions where it was not).
  const driverLook = useDriverLook(dto);

  const modelCode = `BB-${dto?.sizeIn ?? '??'}${TYPE_CODE[d.boxType]}-${d.boxType === 'sealed' || d.boxType === 'isobaric' ? Math.round(res?.info.fc ?? 0) : Math.round(d.fbHz)}`;

  const fill = d.boxType === 'sealed' || d.boxType === 'vented' || d.boxType === 'pr' ? d.stuffing : 0;
  const input = useMemo<EngineInput | null>(() => {
    if (!geo) return null;
    return {
      geo,
      geoKey: [geo.wx, geo.hx, geo.dx, geo.t, geo.slotH, geo.portLength, geo.driverY, geo.driverRadius, geo.rearFraction, geo.prRadius, geo.prLayout.perSide, geo.rearPort?.radius ?? 0, geo.rearPort?.length ?? 0, geo.shape, geo.dxTop, geo.di, geo.diTop, geo.rowX, geo.braces.kind, geo.braces.zs.join(','), geo.braces.dowelYs.join(','), geo.terminal.kind, geo.terminal.panel, geo.terminal.x, geo.terminal.y, geo.terminal.z, geo.handles?.kind ?? 'none', geo.handles?.z ?? 0, geo.handles?.y ?? 0, fill, d.boxType, d.count, d.prCount, d.finish, d.materialKey, driverLook.key].map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join('|'),
      boxType: d.boxType, finish: d.finish, material: d.materialKey, count: d.count, prCount: d.prCount, driverDepth: mountOf(dto).depth,
      // Behind the library and the wizard the scene shows the box as in design mode (no lab effects to compute).
      mode: mode === 'library' || mode === 'wizard' || mode === 'blueprint' ? 'design' : mode, overlays, genHz, slow: s.slow, playing: s.playing,
      osc: osc?.osc ?? null,
      portPeak: res?.metrics.portVelocityMax.ms ?? 0,
      splAtGen: osc?.spl ?? 0,
      thermal: irOn ? { tvc: thermal.tvc, tmag: thermal.tmag } : null,
      vib: { amp: vib.amp, phase: vib.phase },
      balloon: {
        // Effective piston radius from Sd; a band-pass radiates through its port instead.
        radius: d.boxType === 'bp4' || d.boxType === 'bp6'
          ? Math.sqrt((res?.info.ports.find((p) => p.label === 'port' || p.label === 'front port')?.area ?? 0.01) / Math.PI)
          : dto?.sdCm2 ? Math.sqrt((dto.sdCm2 * 1e-4) / Math.PI) : geo.driverRadius * 0.82,
        fromPort: d.boxType === 'bp4' || d.boxType === 'bp6'
      },
      fill,
      driverLook: driverLook.look,
      editRow: mode === 'design' && s.tool === 'select' && d.boxType !== 'bp4' && d.boxType !== 'bp6',
      rowRange: rowRange(geo, d.boxType, d.count)
    };
  }, [s.tool, geo, d.boxType, d.finish, d.materialKey, d.count, d.prCount, fill, dto?.depthMm, dto?.sdCm2, mode, overlays, genHz, s.slow, s.playing, osc, res, irOn, thermal, vib, driverLook]);

  return (
    <div className="app">
      <Viewport input={input} />
      <TopBar modelCode={modelCode} />
      {s.driversSource === 'offline' && <div className="offline">ไม่ได้เชื่อมเซิร์ฟเวอร์ C# · ใช้ข้อมูลตัวอย่างในเครื่อง</div>}
      {mode === 'library' ? <LibraryView /> : mode === 'wizard' ? <WizardView /> : mode === 'blueprint' ? (
        <BlueprintView d={d} geo={geo} dto={dto} material={material} damping={damping} modelCode={modelCode} warnings={warnings} />
      ) : <>
        <LeftPanel geo={geo} modelCode={modelCode} />
        <RightPanel dto={dto} driver={drv.ok ? drv.driver : null} warnings={warnings} driverError={dto && !drv.ok ? drv.missing : null} geo={geo} />
        <Hud modes={modes} wall={wall} vib={vib} conf={conf} />
        {irOn && <IrPanel thermal={thermal} speedup={IR_SPEEDUP} conf={conf.thermal} />}
        <div className="hint">ลากเพื่อหมุน · เลื่อนล้อเพื่อซูม{mode === 'design' && d.boxType !== 'bp4' && d.boxType !== 'bp6' ? ' · ลากลำโพงเพื่อย้ายตำแหน่ง' : ''}</div>
        <OverlayBar geo={geo} />
        {res && max && <ChartDock res={res} max={max} geo={geo} xmax={dto?.xmaxMm ?? null} watts={d.watts} conf={conf} makeSlot={makeSlot} loadSlot={loadSlot} />}
      </>}
      {nbCtx && <Notebook ctx={nbCtx} />}
      <ToastHost />
      <TeaserDialog />
      <Splash />
    </div>
  );
}
