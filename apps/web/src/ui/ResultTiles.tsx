import type { SimResult } from '@bassbuild/physics';
import type { BoxGeometry } from '../sim/model';
import { useApp } from '../state/store';

const speedColor = (v: number) => (v > 30 ? '#f0abfc' : v > 17 ? '#fcd34d' : '#bef264');

/** The six headline numbers of the current design, shown next to the graphs. */
export function ResultTiles({ res, geo, xmax }: { res: SimResult; geo: BoxGeometry | null; xmax: number | null }) {
  const { design: d } = useApp();
  const m = res.metrics;
  const sealedLike = d.boxType === 'sealed' || d.boxType === 'isobaric';
  const tuning = (() => {
    // Fc/Qtc describe a closed box; a band-pass also has one (its rear chamber) but what matters there is the port.
    if (sealedLike && res.info.qtc !== undefined && res.info.fc !== undefined) return { k: 'Fc', v: res.info.fc.toFixed(1), u: `Hz · Qtc ${res.info.qtc.toFixed(2)}` };
    if (m.tuningDip) return { k: 'จูน', v: m.tuningDip.f.toFixed(1), u: 'Hz (จุดเว้าอิมพีแดนซ์)' };
    return { k: 'จูน', v: d.fbHz.toString(), u: 'Hz (ตั้งไว้)' };
  })();
  const over = xmax !== null && m.excursionMax.mm > xmax;
  const hasPort = res.info.ports.length > 0;
  const good = <span className="dot" title="ระดับวิศวกรรม" style={{ background: 'var(--good)', width: 6, height: 6 }} />;
  return (
    <div className="tiles" aria-label="ผลลัพธ์หลัก">
      <div className="tile"><div className="k"><span>F3</span>{good}</div><div className="v">{m.f3 ? m.f3.toFixed(0) : '—'}</div><div className="u">{m.f3High ? `ถึง ${m.f3High.toFixed(0)} Hz` : 'Hz (−3 dB)'}</div></div>
      <div className="tile"><div className="k"><span>{tuning.k}</span>{good}</div><div className="v">{tuning.v}</div><div className="u">{tuning.u}</div></div>
      <div className="tile"><div className="k"><span>SPL สูงสุด</span>{good}</div><div className="v">{m.splMax.toFixed(1)}</div><div className="u">dB ที่ 1 ม.</div></div>
      <div className="tile"><div className="k"><span>ระยะชัก</span><span className="u">{xmax ? `Xmax ${xmax}` : ''}</span></div><div className="v" style={{ color: over ? '#f0abfc' : '#c4b5fd' }}>{m.excursionMax.mm.toFixed(1)}<small> มม.</small></div>
        <div className="bar"><i style={{ width: `${Math.min(100, xmax ? (m.excursionMax.mm / xmax) * 100 : 0)}%`, background: over ? '#f0abfc' : '#c4b5fd' }} /></div></div>
      <div className="tile"><div className="k"><span>ลมในท่อ</span></div><div className="v" style={{ color: speedColor(m.portVelocityMax.ms) }}>{hasPort ? m.portVelocityMax.ms.toFixed(1) : '—'}{hasPort && <small> m/s</small>}</div>
        <div className="bar"><i style={{ width: `${Math.min(100, (m.portVelocityMax.ms / 40) * 100)}%`, background: speedColor(m.portVelocityMax.ms) }} /></div></div>
      <div className="tile"><div className="k"><span>ท่อยาว</span></div><div className="v">{geo && geo.portFold !== 'none' ? (geo.portLength * 100).toFixed(0) : '—'}</div>
        <div className="u">{geo?.portFold === 'L' ? 'ซม. · พับตัว L' : geo?.portFold === 'straight' ? 'ซม. · ตรง' : geo?.portFold === 'impossible' ? 'ซม. · ใส่ในตู้ไม่ได้' : 'ไม่มีท่อ'}</div></div>
    </div>
  );
}
