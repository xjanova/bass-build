import type { Limiter, MaxOutput, SimResult } from '@bassbuild/physics';
import { useEffect, useState } from 'react';
import { SLOT_COLOR, SLOT_IDS, type Slot, type SlotId } from '../data/compare';
import type { Conf, ResultKey } from '../sim/confidence';
import { MAX_PORT_MS, type BoxGeometry } from '../sim/model';
import { useApp, type BoxType, type ChartId } from '../state/store';
import { ConfDot } from './Conf';
import { LineChart, type Series } from './LineChart';
import { ResultTiles } from './ResultTiles';

const TABS: [ChartId, string][] = [['spl', 'SPL'], ['imp', 'อิมพีแดนซ์'], ['exc', 'ระยะชัก'], ['vel', 'ความเร็วลม'], ['gd', 'Group delay'], ['max', 'ดังสุดที่ทำได้'], ['cmp', 'เทียบ A/B/C']];

export const LIMIT_COLOR: Record<Limiter, string> = { excursion: '#a78bfa', port: '#a3e635', thermal: '#fb923c', 'amp-voltage': '#f472b6', 'amp-current': '#fda4af' };
export const LIMIT_TH: Record<Limiter, string> = { excursion: 'ระยะชัก', port: `ลมในท่อ ${MAX_PORT_MS} m/s`, thermal: 'พิกัดความร้อน', 'amp-voltage': 'แอมป์ clip', 'amp-current': 'กระแสแอมป์' };
const TYPE_TH: Record<BoxType, string> = { sealed: 'ตู้ปิด', vented: 'ตู้เปิด', pr: 'PR', bp4: 'BP4', bp6: 'BP6', isobaric: 'Isobaric' };

const ceilTo = (v: number, s: number) => Math.ceil(v / s) * s;
const maxIn = (arr: number[], freqs: number[], lo: number, hi: number) => arr.reduce((m, v, i) => (freqs[i] >= lo && freqs[i] <= hi && v > m ? v : m), 0);

/** One line per limiter: the max-SPL curve where that limit sets the level (joined to its neighbour). */
function limiterSeries(max: MaxOutput): Series[] {
  const used = [...new Set(max.limitedBy.filter((x): x is Limiter => x !== null))];
  return used.map((by) => ({
    values: max.maxSpl.map((v, i) => (max.limitedBy[i] === by || max.limitedBy[i - 1] === by ? v : NaN)),
    color: LIMIT_COLOR[by], glow: true
  }));
}

export function ChartDock({ res, max, geo, xmax, watts, conf, makeSlot, loadSlot }: {
  res: SimResult; max: MaxOutput; geo: BoxGeometry | null; xmax: number | null; watts: number;
  conf: Record<ResultKey, Conf>; makeSlot: () => Slot; loadSlot: (s: Slot) => void;
}) {
  const { chart, setChart, slots, slotShown, saveSlot, toggleSlot, showToast } = useApp();
  const c = res.curves;
  const m = res.metrics;
  const f = c.freqs;
  const hasPort = res.info.ports.length > 0;
  // Saved curves only overlay when they were computed on the same frequency grid.
  const shown = SLOT_IDS.filter((id) => slots[id] && slotShown[id] && slots[id]!.curves.freqs.length === f.length);
  const overlay = (pick: (s: Slot) => number[] | null | undefined): Series[] =>
    shown.flatMap((id) => { const v = pick(slots[id]!); return v ? [{ values: v, color: SLOT_COLOR[id], dashed: true }] : []; });
  const slotMax = (pick: (s: Slot) => number[] | null | undefined) => Math.max(0, ...shown.map((id) => maxIn(pick(slots[id]!) ?? [], f, 15, 300)));

  const excHi = Math.max(30, ceilTo(Math.max(maxIn(c.excursionMm, f, 15, 200), slotMax((s) => s.curves.excursionMm)) * 1.25, 10));
  const velHi = Math.max(40, ceilTo(Math.max(m.portVelocityMax.ms, slotMax((s) => s.curves.portVelocity)) * 1.2, 10));
  const zHi = ceilTo(Math.max(...c.impedance, slotMax((s) => s.curves.impedance)) * 1.15, 10);
  const splHi = ceilTo(Math.max(m.splMax, slotMax((s) => s.curves.spl)) + 6, 10);
  const reach = max.maxSpl.filter(Number.isFinite);
  const maxHi = reach.length ? ceilTo(Math.max(maxIn(max.maxSpl.map((v) => (Number.isFinite(v) ? v : 0)), f, 10, 500), slotMax((s) => s.maxSpl)) + 4, 10) : splHi;
  // Above the bass the thermal (or amplifier) ceiling is flat: scale the power graph to that plateau.
  const plateau = max.maxWatts[f.findIndex((x) => x >= 200)] ?? NaN;

  const save = (id: SlotId) => {
    saveSlot(id, makeSlot());
    showToast(`เก็บตู้ตอนนี้เป็น ${id} แล้ว · เส้นประสี${id === 'A' ? 'ชมพู' : id === 'B' ? 'ขาว' : 'ส้ม'}ในทุกกราฟ · ดูตารางที่แท็บ "เทียบ A/B/C"`);
  };

  const big = (() => {
    switch (chart) {
      case 'imp': return { title: 'อิมพีแดนซ์ (Ω)', unit: 'Ω', main: c.impedance, slot: overlay((s) => s.curves.impedance), color: '#fbbf24', yMin: 0, yMax: zHi, marker: m.tuningDip ? { f: m.tuningDip.f, label: `จูน ${m.tuningDip.f.toFixed(1)} Hz` } : null, thresholds: [], conf: conf.impedance };
      case 'exc': return { title: 'ระยะชัก (มม.) · เส้นม่วงแดง = Xmax', unit: 'มม.', main: c.excursionMm, slot: overlay((s) => s.curves.excursionMm), color: '#a78bfa', yMin: 0, yMax: excHi, marker: null, thresholds: xmax ? [{ value: xmax, color: '#e879f9' }] : [], conf: conf.excursion };
      case 'vel': return { title: 'ความเร็วลมในท่อ (m/s) · เกณฑ์ 17 และ 30', unit: 'm/s', main: c.portVelocity, slot: overlay((s) => s.curves.portVelocity), color: '#a3e635', yMin: 0, yMax: velHi, marker: null, thresholds: [{ value: 17, color: '#fbbf24' }, { value: 30, color: '#e879f9' }], conf: conf.portVelocity };
      case 'gd': return { title: 'Group delay (ms)', unit: 'ms', main: c.groupDelayMs, slot: overlay((s) => s.curves.groupDelayMs), color: '#94a3b8', yMin: 0, yMax: Math.max(20, ceilTo(maxIn(c.groupDelayMs, f, 15, 300) * 1.2, 10)), marker: null, thresholds: [], conf: conf.groupDelay };
      default: return { title: `SPL ที่ 1 ม. (dB) · ${watts} W`, unit: 'dB', main: c.spl, slot: overlay((s) => s.curves.spl), color: '#22d3ee', yMin: splHi - 60, yMax: splHi, marker: m.f3 ? { f: m.f3, label: `F3 ${m.f3.toFixed(0)} Hz` } : null, thresholds: [], conf: conf.splMax };
    }
  })();

  return (
    <section className="dock glass" aria-label="กราฟผลทดสอบ">
      <div className="dock-head">
        {TABS.map(([id, label]) => (
          <button key={id} className="tabbtn" aria-pressed={chart === id} onClick={() => setChart(id)}>{label}</button>
        ))}
        <div className="right slots" role="group" aria-label="ตู้ที่เก็บไว้เทียบ">
          {SLOT_IDS.map((id) => {
            const s = slots[id];
            if (!s) return <button key={id} className="slotbtn empty" title={`เก็บตู้ตอนนี้เป็น ${id} เพื่อเทียบ`} onClick={() => save(id)}>+ {id}</button>;
            return (
              <button key={id} className="slotbtn" aria-pressed={slotShown[id]} title={`${id}: ${s.label} · กดเพื่อ${slotShown[id] ? 'ซ่อน' : 'แสดง'}เส้น`} onClick={() => toggleSlot(id)}
                style={{ borderColor: slotShown[id] ? SLOT_COLOR[id] : undefined }}>
                <span className="sw" style={{ borderTop: `2px dashed ${SLOT_COLOR[id]}` }} /><b>{id}</b><span className="slotname">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="dock-body">
        <ResultTiles res={res} geo={geo} xmax={xmax} conf={conf} />
        {chart === 'cmp' ? <CompareTable makeSlot={makeSlot} loadSlot={loadSlot} onSave={save} /> : chart === 'max' ? (
          <div className="charts">
            <LineChart big freqs={f} unit="dB" yMin={maxHi - 50} yMax={maxHi}
              title={reach.length ? 'ดังสุดที่ทำได้ (dB ที่ 1 ม.) · สีบอกว่าติดอะไร · เส้นประบาง = ที่กำลังตั้งไว้' : 'ดังสุดที่ทำได้: ลำโพงนี้ไม่มีค่า Xmax/Pe และไม่ได้เปิดแอมป์ จึงยังคิดไม่ได้'}
              readout={(i) => Number.isFinite(max.maxSpl[i]) ? `${max.maxSpl[i].toFixed(1)} dB · ติด${max.limitedBy[i] ? LIMIT_TH[max.limitedBy[i]!] : '—'} · ${Math.round(max.maxWatts[i])} W` : '—'}
              series={[{ values: max.maxSpl, color: '#e2e8f0', fill: true }, ...limiterSeries(max), { values: c.spl, color: '#22d3ee', dashed: true }, ...overlay((s) => s.maxSpl)]} />
            <LineChart freqs={f} title="กำลังแอมป์ที่ใช้ได้ (W)" unit="W" yMin={0} yMax={ceilTo(Math.max(10, (Number.isFinite(plateau) ? plateau : watts) * 1.6), 100)}
              thresholds={[{ value: watts, color: '#22d3ee' }]}
              series={[{ values: max.maxWatts, color: '#fb923c', fill: true, glow: true }]} />
            <div className="limit-legend">
              <ConfDot conf={conf.maxSpl} />
              {(Object.keys(LIMIT_TH) as Limiter[]).filter((k) => max.limitedBy.includes(k)).map((k) => (
                <span key={k}><i style={{ background: LIMIT_COLOR[k] }} />{LIMIT_TH[k]}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="charts">
            <LineChart big freqs={f} title={big.title} unit={big.unit} yMin={big.yMin} yMax={big.yMax} marker={big.marker} thresholds={big.thresholds}
              series={[{ values: big.main, color: big.color, fill: true, glow: true }, ...big.slot]} />
            <LineChart freqs={f} title="ระยะชัก (มม.)" unit="มม." yMin={0} yMax={excHi} thresholds={xmax ? [{ value: xmax, color: '#e879f9' }] : []}
              series={[{ values: c.excursionMm, color: '#a78bfa', fill: true, glow: true }]} />
            {hasPort
              ? <LineChart freqs={f} title="ลมในท่อ (m/s)" unit="m/s" yMin={0} yMax={velHi} thresholds={[{ value: 17, color: '#fbbf24' }, { value: 30, color: '#e879f9' }]}
                  series={[{ values: c.portVelocity, color: '#a3e635', fill: true, glow: true }]} />
              : <LineChart freqs={f} title="อิมพีแดนซ์ (Ω)" unit="Ω" yMin={0} yMax={zHi} series={[{ values: c.impedance, color: '#fbbf24', fill: true, glow: true }]} />}
            <span className="chart-conf"><ConfDot conf={big.conf} /></span>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- comparison table --------------------------------------------------------------------------------

type Ask = { id: SlotId; action: 'load' | 'replace' | 'clear' } | null;
const ASK_TEXT = { load: 'แทนตู้ในแล็บด้วยตู้นี้?', replace: 'เก็บตู้ตอนนี้ทับช่องนี้?', clear: 'ลบช่องนี้?' } as const;

// Saved summaries come from storage: treat anything that is not a finite number as missing.
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hz = (v: number | null | undefined) => (ok(v) ? `${v.toFixed(v < 100 ? 1 : 0)} Hz` : '—');
const fx = (v: number | null | undefined, d = 1, u = '') => (ok(v) ? `${v.toFixed(d)}${u}` : '—');

function CompareTable({ makeSlot, loadSlot, onSave }: { makeSlot: () => Slot; loadSlot: (s: Slot) => void; onSave: (id: SlotId) => void }) {
  const { slots, clearSlot } = useApp();
  const [ask, setAsk] = useState<Ask>(null);
  useEffect(() => {
    if (!ask) return;
    const t = window.setTimeout(() => setAsk(null), 8000);
    return () => window.clearTimeout(t);
  }, [ask]);
  // The current design, summarised exactly like a saved one so the columns line up.
  const now = makeSlot();
  const cols: { id: SlotId | 'now'; s: Slot; color: string }[] = [
    { id: 'now', s: now, color: '#22d3ee' },
    ...SLOT_IDS.filter((id) => slots[id]).map((id) => ({ id, s: slots[id]!, color: SLOT_COLOR[id] }))
  ];
  const rows: [string, (s: Slot) => string][] = [
    ['ลำโพง', (s) => `${s.driverName} × ${s.summary.drivers}`],
    ['ชนิดตู้', (s) => TYPE_TH[s.summary.boxType] ?? '—'],
    ['ปริมาตรสุทธิ', (s) => `${fx(s.summary.vbL, 0, ' L')}${ok(s.summary.vfL) ? ` + ${s.summary.vfL} L` : ''}`],
    ['จูน / Fc', (s) => `${hz(s.summary.tuning)}${ok(s.summary.qtc) ? ` · Qtc ${s.summary.qtc.toFixed(2)}` : ''}`],
    ['F3', (s) => `${hz(s.summary.f3)}${ok(s.summary.f3High) ? ` – ${hz(s.summary.f3High)}` : ''}`],
    ['F10', (s) => hz(s.summary.f10)],
    ['กำลังขับ', (s) => fx(s.summary.watts, 0, ' W')],
    ['SPL สูงสุด', (s) => fx(s.summary.splMax, 1, ' dB')],
    ['ดังสุดที่ทำได้ 30–80 Hz', (s) => fx(s.summary.loud, 1, ' dB')],
    ['ระยะชัก', (s) => `${fx(s.summary.excursionMm, 1, ' มม.')}${ok(s.summary.xmaxMm) ? ` / ${s.summary.xmaxMm}` : ''}`],
    ['ลมในท่อ', (s) => (ok(s.summary.portMs) ? fx(s.summary.portMs, 1, ' m/s') : 'ไม่มีท่อ')],
    ['อิมพีแดนซ์ต่ำสุด', (s) => fx(s.summary.zMin, 1, ' Ω')],
    ['ขนาดภายนอก', (s) => (Array.isArray(s.summary.dims) && s.summary.dims.every(ok) ? `${s.summary.dims.map((v) => Math.round(v / 10)).join(' × ')} ซม.` : '—')],
    ['น้ำหนักตู้เปล่า', (s) => fx(s.summary.weightKg, 0, ' กก.')]
  ];
  const act = (id: SlotId, action: NonNullable<Ask>['action']) => {
    setAsk(null);
    if (action === 'load') loadSlot(slots[id]!);
    else if (action === 'replace') onSave(id);
    else clearSlot(id);
  };
  return (
    <div className="cmp">
      <table>
        <thead>
          <tr>
            <th scope="col" />
            {cols.map(({ id, s, color }) => (
              <th key={id} scope="col" style={{ color }}>
                <div className="cmp-h"><span className="sw" style={{ borderTop: `2px ${id === 'now' ? 'solid' : 'dashed'} ${color}` }} />{id === 'now' ? 'ตอนนี้' : id}<span className="cmp-label" title={s.label}>{id === 'now' ? '' : s.label}</span></div>
                {id !== 'now' && (ask?.id === id ? (
                  <div className="cmp-ask"><span>{ASK_TEXT[ask.action]}</span><button className="yes" onClick={() => act(id, ask.action)}>ยืนยัน</button><button onClick={() => setAsk(null)}>ยกเลิก</button></div>
                ) : (
                  <div className="cmp-act">
                    <button onClick={() => setAsk({ id, action: 'load' })} title="เปิดตู้นี้ในแล็บเพื่อแก้ต่อ (ย้อนกลับได้)">เปิด</button>
                    <button onClick={() => setAsk({ id, action: 'replace' })} title="เก็บตู้ที่เปิดอยู่ทับช่องนี้">เก็บทับ</button>
                    <button onClick={() => setAsk({ id, action: 'clear' })} title="ลบช่องนี้">ลบ</button>
                  </div>
                ))}
              </th>
            ))}
            {SLOT_IDS.filter((id) => !slots[id]).slice(0, 1).map((id) => (
              <th key={id} scope="col"><button className="slotbtn empty" onClick={() => onSave(id)}>+ เก็บตู้ตอนนี้เป็น {id}</button></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, get]) => (
            <tr key={label}><th scope="row">{label}</th>{cols.map(({ id, s }) => <td key={id}>{get(s)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
