import { abs, pressureAt, type Cx } from '@bassbuild/physics';
import { useEffect, useMemo, useState } from 'react';
import { loadDampingMaterials, loadDrivers, loadPanelMaterials } from './data/api';
import { driverFromDto, panelMode, simulate, sizeBox, solveAt, thermalAt, toSpec, wallDamping, warningsFor } from './sim/model';
import { useApp, type BoxType } from './state/store';
import { ChartDock } from './ui/ChartDock';
import { Hud, IrPanel, LeftPanel, OverlayBar, ToastHost, TopBar } from './ui/Panels';
import { RightPanel } from './ui/RightPanel';
import type { EngineInput, Osc } from './viewport/Engine';
import { Viewport } from './viewport/Viewport';

const TYPE_CODE: Record<BoxType, string> = { sealed: 'SB', vented: 'VB', pr: 'PR', bp4: 'B4', bp6: 'B6', isobaric: 'IB' };
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
  const drv = useMemo(() => driverFromDto(dto), [dto]);
  const spec = useMemo(() => (drv.ok ? toSpec(d, drv.driver, damping) : null), [d, drv, damping]);
  const res = useMemo(() => (spec ? simulate(spec, { fMin: 10, fMax: 500, points: 240 }) : null), [spec]);
  const material = materials.find((m) => m.key === d.materialKey);
  const wall = useMemo(() => wallDamping(d, material, damping), [d, material, damping]);
  const geo = useMemo(() => (res ? sizeBox(d, dto, res, material, wall.massKgM2) : null), [d, dto, res, material, wall]);
  const warnings = useMemo(() => (res && geo ? warningsFor(d, dto, res, geo) : []), [d, dto, res, geo]);
  const f11 = geo ? panelMode(geo, material, wall.f11Factor) : 0;

  // Burn-in clock for the infrared view: runs only while IR is on, restarts when it is switched back on.
  const [burn, setBurn] = useState(0);
  const irOn = mode === 'lab' && overlays.ir;
  useEffect(() => {
    if (!irOn) { setBurn(0); return; }
    const t0 = performance.now();
    const id = window.setInterval(() => setBurn((performance.now() - t0) / 1000), 250);
    return () => window.clearInterval(id);
  }, [irOn]);
  const thermal = useMemo(() => ({ ...thermalAt(d.watts, dto?.peW, burn), seconds: burn }), [d.watts, dto?.peW, burn]);

  const osc = useMemo<{ osc: Osc; spl: number } | null>(() => {
    if (!spec || !drv.ok) return null;
    const sol = solveAt(spec, genHz);
    const w = 2 * Math.PI * genHz;
    const driver0 = sol.drivers[0];
    const port = sol.passives.find((p) => p.label === 'port' || p.label === 'front port' || p.label.startsWith('port '));
    const pr = sol.passives.find((p) => p.label.startsWith('passive radiator'));
    const front = sol.radiators.filter((r) => r.id === 'cone');
    const out = sol.radiators.filter((r) => r.id === 'port' || r.id === 'pr');
    const toX = (u: Cx, area: number): Cx => scaleCx({ re: u.im / (w * area), im: -u.re / (w * area) }, Math.SQRT2); // u/(jωA)
    return {
      osc: {
        coneX: scaleCx(driver0.x, Math.SQRT2),
        prX: pr && pr.area ? toX(pr.u, pr.area) : null,
        portV: port && port.area ? scaleCx(port.u, Math.SQRT2 / port.area) : null,
        coneU: front.length ? sumCx(front.map((r) => r.u)) : sumCx(sol.drivers.map((x) => x.u)),
        portU: out.length ? sumCx(out.map((r) => r.u)) : null
      },
      spl: 20 * Math.log10(Math.max(abs(pressureAt(sol)), 1e-12) / 2e-5)
    };
  }, [spec, drv, genHz]);

  const modelCode = `BB-${dto?.sizeIn ?? '??'}${TYPE_CODE[d.boxType]}-${d.boxType === 'sealed' || d.boxType === 'isobaric' ? Math.round(res?.info.fc ?? 0) : Math.round(d.fbHz)}`;

  const input = useMemo<EngineInput | null>(() => {
    if (!geo) return null;
    return {
      geo,
      geoKey: [geo.wx, geo.hx, geo.dx, geo.t, geo.slotH, geo.portLength, geo.driverY, geo.driverRadius, d.boxType, d.count, d.prCount, d.finish, d.materialKey].map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join('|'),
      boxType: d.boxType, finish: d.finish, material: d.materialKey, count: d.count, prCount: d.prCount, driverDepth: (dto?.depthMm ?? 190) / 1000,
      mode, overlays, genHz, slow: s.slow, playing: s.playing,
      osc: osc?.osc ?? null,
      portPeak: res?.metrics.portVelocityMax.ms ?? 0,
      splAtGen: osc?.spl ?? 0,
      thermal: irOn ? { tvc: thermal.tvc, tmag: thermal.tmag } : null,
      f11,
      vibAmp: wall.ampFactor
    };
  }, [geo, d.boxType, d.finish, d.materialKey, d.count, d.prCount, dto?.depthMm, mode, overlays, genHz, s.slow, s.playing, osc, res, irOn, thermal, f11, wall]);

  return (
    <div className="app">
      <Viewport input={input} />
      <TopBar modelCode={modelCode} />
      {s.driversSource === 'offline' && <div className="offline">ไม่ได้เชื่อมเซิร์ฟเวอร์ C# · ใช้ข้อมูลตัวอย่างในเครื่อง</div>}
      <LeftPanel geo={geo} modelCode={modelCode} />
      <RightPanel dto={dto} driver={drv.ok ? drv.driver : null} warnings={warnings} driverError={dto && !drv.ok ? drv.missing : null} />
      <Hud f11={f11} wall={wall} />
      {irOn && <IrPanel thermal={thermal} />}
      <div className="hint">ลากเพื่อหมุน · เลื่อนล้อเพื่อซูม</div>
      <OverlayBar geo={geo} />
      {res && <ChartDock res={res} geo={geo} xmax={dto?.xmaxMm ?? null} watts={d.watts} ghostLabel={`${dto?.model ?? ''} · ${TYPE_TH[d.boxType]} ${d.vbL} L · ${d.watts} W`} />}
      <ToastHost />
    </div>
  );
}
