import type { SimResult } from '@bassbuild/physics';
import type { ReactNode } from 'react';
import type { Conf, ResultKey } from '../sim/confidence';
import type { BoxGeometry } from '../sim/model';
import { useApp } from '../state/store';
import { ConfDot } from './Conf';

const speedColor = (v: number) => (v > 30 ? '#f0abfc' : v > 17 ? '#fcd34d' : '#bef264');

/** A headline number; clicking it opens the formula notebook at the formula behind it (none when there is no number). */
function Tile({ entry, label, conf, children }: { entry: string | null; label: string; conf: Conf | null; children: ReactNode }) {
  const { openNotebook } = useApp();
  if (!entry) return <div className="tile">{children}</div>;
  return (
    <button type="button" className="tile" title={`ดูสูตรของ${label}`} onClick={() => openNotebook(entry)}>
      {children}
      <span className="tile-conf"><ConfDot conf={conf} /></span>
    </button>
  );
}

/** The six headline numbers of the current design, shown next to the graphs. */
export function ResultTiles({ res, geo, xmax, conf }: { res: SimResult; geo: BoxGeometry | null; xmax: number | null; conf: Record<ResultKey, Conf> }) {
  const { design: d } = useApp();
  const m = res.metrics;
  const sealedLike = d.boxType === 'sealed' || d.boxType === 'isobaric';
  const tuning = (() => {
    // Fc/Qtc describe a closed box; a band-pass also has one (its rear chamber) but what matters there is the port.
    if (sealedLike && res.info.qtc !== undefined && res.info.fc !== undefined) return { k: 'Fc', v: res.info.fc.toFixed(1), u: `Hz · Qtc ${res.info.qtc.toFixed(2)}`, entry: 'fc' };
    if (m.tuningDip) return { k: 'จูน', v: m.tuningDip.f.toFixed(1), u: 'Hz (จุดเว้าอิมพีแดนซ์)', entry: 'tuning' };
    return { k: 'จูน', v: d.fbHz.toString(), u: 'Hz (ตั้งไว้)', entry: 'portLength' };
  })();
  const over = xmax !== null && m.excursionMax.mm > xmax;
  const hasPort = res.info.ports.length > 0;
  return (
    <div className="tiles" aria-label="ผลลัพธ์หลัก (กดเพื่อดูสูตร)">
      <Tile entry="f3" label="F3" conf={conf.f3}><div className="k"><span>F3</span></div><div className="v">{m.f3 ? m.f3.toFixed(0) : '—'}</div><div className="u">{m.f3High ? `ถึง ${m.f3High.toFixed(0)} Hz` : 'Hz (−3 dB)'}</div></Tile>
      <Tile entry={tuning.entry} label={tuning.k} conf={conf.tuning}><div className="k"><span>{tuning.k}</span></div><div className="v">{tuning.v}</div><div className="u">{tuning.u}</div></Tile>
      <Tile entry="splMax" label="SPL สูงสุด" conf={conf.splMax}><div className="k"><span>SPL สูงสุด</span></div><div className="v">{m.splMax.toFixed(1)}</div><div className="u">dB ที่ 1 ม.</div></Tile>
      <Tile entry="excursion" label="ระยะชัก" conf={conf.excursion}>
        <div className="k"><span>ระยะชัก</span><span className="u">{xmax ? `Xmax ${xmax}` : ''}</span></div>
        <div className="v" style={{ color: over ? '#f0abfc' : '#c4b5fd' }}>{m.excursionMax.mm.toFixed(1)}<small> มม.</small></div>
        <div className="bar"><i style={{ width: `${Math.min(100, xmax ? (m.excursionMax.mm / xmax) * 100 : 0)}%`, background: over ? '#f0abfc' : '#c4b5fd' }} /></div>
      </Tile>
      <Tile entry={hasPort ? 'portVelocity' : null} label="ลมในท่อ" conf={hasPort ? conf.portVelocity : null}>
        <div className="k"><span>ลมในท่อ</span></div>
        <div className="v" style={{ color: speedColor(m.portVelocityMax.ms) }}>{hasPort ? m.portVelocityMax.ms.toFixed(1) : '—'}{hasPort && <small> m/s</small>}</div>
        <div className="bar"><i style={{ width: `${Math.min(100, (m.portVelocityMax.ms / 40) * 100)}%`, background: speedColor(m.portVelocityMax.ms) }} /></div>
      </Tile>
      <Tile entry={hasPort ? 'portLength' : null} label="ท่อ" conf={hasPort ? conf.portLength : null}>
        <div className="k"><span>ท่อยาว</span></div><div className="v">{geo && geo.portFold !== 'none' ? (geo.portLength * 100).toFixed(0) : '—'}</div>
        <div className="u">{geo?.portFold === 'L' ? 'ซม. · พับตัว L' : geo?.portFold === 'straight' ? 'ซม. · ตรง' : geo?.portFold === 'impossible' ? 'ซม. · ใส่ในตู้ไม่ได้' : 'ไม่มีท่อ'}</div>
      </Tile>
    </div>
  );
}
