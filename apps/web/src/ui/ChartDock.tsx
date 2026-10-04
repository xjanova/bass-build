import type { SimResult } from '@bassbuild/physics';
import { useApp, type ChartId } from '../state/store';
import type { BoxGeometry } from '../sim/model';
import { LineChart } from './LineChart';
import { ResultTiles } from './ResultTiles';

const TABS: [ChartId, string][] = [['spl', 'SPL'], ['imp', 'อิมพีแดนซ์'], ['exc', 'ระยะชัก'], ['vel', 'ความเร็วลม'], ['gd', 'Group delay']];

const ceilTo = (v: number, s: number) => Math.ceil(v / s) * s;
const maxIn = (arr: number[], freqs: number[], lo: number, hi: number) => arr.reduce((m, v, i) => (freqs[i] >= lo && freqs[i] <= hi && v > m ? v : m), 0);

export function ChartDock({ res, geo, xmax, watts, ghostLabel }: { res: SimResult; geo: BoxGeometry | null; xmax: number | null; watts: number; ghostLabel: string }) {
  const { chart, setChart, ghost: saved, setGhost } = useApp();
  const ghost = saved?.curves;
  const c = res.curves;
  const m = res.metrics;
  const f = c.freqs;
  const hasPort = res.info.ports.length > 0;
  const excHi = Math.max(30, ceilTo(maxIn(c.excursionMm, f, 15, 200) * 1.25, 10));
  const velHi = Math.max(40, ceilTo(m.portVelocityMax.ms * 1.2, 10));
  const zHi = ceilTo(Math.max(...c.impedance) * 1.15, 10);
  const splHi = ceilTo(m.splMax + 6, 10);

  const big = (() => {
    switch (chart) {
      case 'spl': return { title: `SPL ที่ 1 ม. (dB) · ${watts} W`, unit: 'dB', values: c.spl, g: ghost?.spl, color: '#22d3ee', yMin: splHi - 60, yMax: splHi, marker: m.f3 ? { f: m.f3, label: `F3 ${m.f3.toFixed(0)} Hz` } : null, thresholds: [] };
      case 'imp': return { title: 'อิมพีแดนซ์ (Ω)', unit: 'Ω', values: c.impedance, g: ghost?.impedance, color: '#fbbf24', yMin: 0, yMax: zHi, marker: m.tuningDip ? { f: m.tuningDip.f, label: `จูน ${m.tuningDip.f.toFixed(1)} Hz` } : null, thresholds: [] };
      case 'exc': return { title: 'ระยะชัก (มม.) · เส้นม่วงแดง = Xmax', unit: 'มม.', values: c.excursionMm, g: ghost?.excursionMm, color: '#a78bfa', yMin: 0, yMax: excHi, marker: null, thresholds: xmax ? [{ value: xmax, color: '#e879f9' }] : [] };
      case 'vel': return { title: 'ความเร็วลมในท่อ (m/s) · เกณฑ์ 17 และ 30', unit: 'm/s', values: c.portVelocity, g: ghost?.portVelocity, color: '#a3e635', yMin: 0, yMax: velHi, marker: null, thresholds: [{ value: 17, color: '#fbbf24' }, { value: 30, color: '#e879f9' }] };
      case 'gd': return { title: 'Group delay (ms)', unit: 'ms', values: c.groupDelayMs, g: ghost?.groupDelayMs, color: '#94a3b8', yMin: 0, yMax: Math.max(20, ceilTo(maxIn(c.groupDelayMs, f, 15, 300) * 1.2, 10)), marker: null, thresholds: [] };
    }
  })();

  return (
    <section className="dock glass" aria-label="กราฟผลทดสอบ">
      <div className="dock-head">
        {TABS.map(([id, label]) => (
          <button key={id} className="tabbtn" aria-pressed={chart === id} onClick={() => setChart(id)}>{label}</button>
        ))}
        <div className="right">
          {saved && <span className="ghostlabel" title={saved.label}><span style={{ width: 18, flex: 'none', borderTop: '1.5px dashed #e2e8f0' }} />เส้นเทียบ: {saved.label}</span>}
          <button className="ghostbtn" onClick={() => setGhost({ curves: c, label: ghostLabel })}>เก็บเป็นเส้นเทียบ</button>
          <button className="ghostbtn" style={{ background: 'transparent', color: 'var(--muted)' }} onClick={() => setGhost(null)} disabled={!ghost}>ล้าง</button>
        </div>
      </div>
      <div className="dock-body">
      <ResultTiles res={res} geo={geo} xmax={xmax} />
      <div className="charts">
        <LineChart big freqs={f} title={big.title} unit={big.unit} yMin={big.yMin} yMax={big.yMax} marker={big.marker} thresholds={big.thresholds}
          series={[{ values: big.values, color: big.color, fill: true, glow: true }, ...(big.g ? [{ values: big.g, color: '#e2e8f0', dashed: true }] : [])]} />
        <LineChart freqs={f} title="ระยะชัก (มม.)" unit="มม." yMin={0} yMax={excHi} thresholds={xmax ? [{ value: xmax, color: '#e879f9' }] : []}
          series={[{ values: c.excursionMm, color: '#a78bfa', fill: true, glow: true }]} />
        {hasPort
          ? <LineChart freqs={f} title="ลมในท่อ (m/s)" unit="m/s" yMin={0} yMax={velHi} thresholds={[{ value: 17, color: '#fbbf24' }, { value: 30, color: '#e879f9' }]}
              series={[{ values: c.portVelocity, color: '#a3e635', fill: true, glow: true }]} />
          : <LineChart freqs={f} title="อิมพีแดนซ์ (Ω)" unit="Ω" yMin={0} yMax={zHi} series={[{ values: c.impedance, color: '#fbbf24', fill: true, glow: true }]} />}
      </div>
      </div>
    </section>
  );
}
