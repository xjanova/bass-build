import type { SimResult } from '@bassbuild/physics';
import type { DriverDto, PanelMaterialDto } from '../data/types';
import type { BoxGeometry, Warning } from '../sim/model';
import { useApp, type BoxType, type Design } from '../state/store';
import { Icon } from './icons';

const TYPES: [BoxType, string][] = [['sealed', 'ตู้ปิด'], ['vented', 'ตู้เปิด'], ['pr', 'PR'], ['bp4', 'BP4'], ['bp6', 'BP6'], ['isobaric', 'Isobaric']];

function Slider({ id, label, value, min, max, step = 1, fmt, onChange }: {
  id: string; label: string; value: number; min: number; max: number; step?: number; fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="field-head"><label htmlFor={id}>{label}</label><output htmlFor={id}>{fmt(value)}</output></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

const WARN_COLOR = { bad: '#f0abfc', warn: '#fcd34d', info: '#67e8f9' } as const;

export function RightPanel({ dto, res, geo, warnings, materials, driverError }: {
  dto: DriverDto | undefined; res: SimResult | null; geo: BoxGeometry | null; warnings: Warning[]; materials: PanelMaterialDto[]; driverError: string[] | null;
}) {
  const { drivers, driverId, selectDriver, design: d, patchDesign } = useApp();
  const p = (patch: Partial<Design>) => patchDesign(patch);
  const L = (v: number) => `${v} L`;
  const Hz = (v: number) => `${v} Hz`;
  const m = res?.metrics;
  const xmax = dto?.xmaxMm ?? null;
  const tuning = (() => {
    if (!res) return { k: 'จูน', v: '—', u: '' };
    if (res.info.qtc !== undefined && res.info.fc !== undefined) return { k: 'Fc', v: res.info.fc.toFixed(1), u: `Hz · Qtc ${res.info.qtc.toFixed(2)}` };
    if (m?.tuningDip) return { k: 'จูน', v: m.tuningDip.f.toFixed(1), u: 'Hz (จุดเว้าอิมพีแดนซ์)' };
    return { k: 'จูน', v: d.fbHz.toString(), u: 'Hz' };
  })();
  const material = materials.find((x) => x.key === d.materialKey);

  return (
    <section className="right-panel glass" aria-label="ตั้งค่าตู้และผลลัพธ์">
      <div className="field">
        <div className="field-head"><label htmlFor="drv">ลำโพง</label><span className="muted">{dto?.sourceKind === 'sample' ? 'ลำโพงตัวอย่าง' : dto?.sourceKind}</span></div>
        <select id="drv" value={driverId ?? ''} onChange={(e) => selectDriver(Number(e.target.value))}>
          {drivers.map((x) => <option key={x.id} value={x.id}>{x.model} · {x.sizeIn}" · {x.kindTh ?? x.category}</option>)}
        </select>
      </div>
      {dto && (
        <div className="params">
          <div><span>Fs</span><b>{dto.fs} Hz</b></div>
          <div><span>Qts</span><b>{dto.qts?.toFixed(2) ?? '—'}</b></div>
          <div><span>Vas</span><b>{dto.vasL?.toFixed(0) ?? '—'} L</b></div>
          <div><span>Re</span><b>{dto.re ?? '—'} Ω</b></div>
          <div><span>Xmax</span><b>{dto.xmaxMm ?? '—'} มม.</b></div>
          <div><span>Pe</span><b>{dto.peW ?? '—'} W</b></div>
        </div>
      )}
      {driverError && <div className="warn" style={{ color: '#f0abfc', background: '#f0abfc14', border: '1px solid #f0abfc55' }}><Icon name="alert" size={15} width={2} /><span>ข้อมูลลำโพงไม่พอคำนวณ ขาด: {driverError.join(', ')}</span></div>}

      <div className="seg" role="group" aria-label="ชนิดตู้">
        {TYPES.map(([id, label]) => <button key={id} aria-pressed={d.boxType === id} onClick={() => p({ boxType: id })}>{label}</button>)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <Slider id="vb" label={d.boxType.startsWith('bp') ? 'ห้องหลัง Vr' : 'ปริมาตรสุทธิ Vb'} value={d.vbL} min={10} max={300} fmt={L} onChange={(v) => p({ vbL: v })} />
        {(d.boxType === 'vented' || d.boxType === 'bp4' || d.boxType === 'bp6') && <>
          <Slider id="fb" label={d.boxType === 'bp6' ? 'จูนท่อหลัง' : 'ความถี่จูนท่อ Fb'} value={d.fbHz} min={15} max={90} step={0.5} fmt={Hz} onChange={(v) => p({ fbHz: v })} />
          <Slider id="pa" label="พื้นที่ท่อ" value={d.portAreaCm2} min={20} max={800} step={5} fmt={(v) => `${v} ซม.²`} onChange={(v) => p({ portAreaCm2: v })} />
        </>}
        {(d.boxType === 'bp4' || d.boxType === 'bp6') && <Slider id="vf" label="ห้องหน้า Vf" value={d.vfL} min={5} max={200} fmt={L} onChange={(v) => p({ vfL: v })} />}
        {d.boxType === 'bp6' && <>
          <Slider id="fb2" label="จูนท่อหน้า" value={d.fb2Hz} min={30} max={150} step={0.5} fmt={Hz} onChange={(v) => p({ fb2Hz: v })} />
          <Slider id="pa2" label="พื้นที่ท่อหน้า" value={d.port2AreaCm2} min={20} max={800} step={5} fmt={(v) => `${v} ซม.²`} onChange={(v) => p({ port2AreaCm2: v })} />
        </>}
        {d.boxType === 'pr' && <>
          <Slider id="prm" label="มวลรวม PR" value={d.prMassG} min={50} max={2000} step={10} fmt={(v) => `${v} ก.`} onChange={(v) => p({ prMassG: v })} />
          <Slider id="prn" label="จำนวน PR" value={d.prCount} min={1} max={4} fmt={(v) => `${v} ตัว`} onChange={(v) => p({ prCount: v })} />
        </>}
        {(d.boxType === 'sealed' || d.boxType === 'vented' || d.boxType === 'pr') &&
          <Slider id="st" label="ใยในตู้" value={d.stuffing} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => p({ stuffing: v })} />}
        <div className="field">
          <div className="field-head">
            <label htmlFor="pw">กำลังขับ</label>
            <button className="tabbtn" style={{ height: 22, padding: '0 8px', fontSize: 11, borderRadius: 6, border: `1px solid ${d.subsonic ? 'rgba(34,211,238,0.6)' : 'var(--line-2)'}`, background: d.subsonic ? 'rgba(34,211,238,0.14)' : 'transparent', color: d.subsonic ? 'var(--cyan-soft)' : 'var(--muted)' }}
              aria-pressed={d.subsonic} onClick={() => p({ subsonic: !d.subsonic })}>Subsonic {d.subsonicHz} Hz</button>
            <output htmlFor="pw" style={{ marginLeft: 'auto' }}>{d.watts} W</output>
          </div>
          <input id="pw" type="range" min={1} max={3000} step={1} value={d.watts} onChange={(e) => p({ watts: Number(e.target.value) })} />
        </div>
        {d.boxType !== 'isobaric' && (
          <div className="field-head">
            <label htmlFor="cnt">จำนวนลำโพง</label>
            <span style={{ display: 'flex', gap: 6 }}>
              <select id="cnt" style={{ height: 28 }} value={d.count} onChange={(e) => p({ count: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} ดอก</option>)}</select>
              <select aria-label="การต่อสาย" style={{ height: 28 }} value={d.wiring} onChange={(e) => p({ wiring: e.target.value as Design['wiring'] })}><option value="parallel">ขนาน</option><option value="series">อนุกรม</option></select>
            </span>
          </div>
        )}
        <div className="field-head">
          <label htmlFor="mat">วัสดุผนัง</label>
          <span style={{ display: 'flex', gap: 6 }}>
            <select id="mat" style={{ height: 28, maxWidth: 150 }} value={d.materialKey} onChange={(e) => {
              const mat = materials.find((x) => x.key === e.target.value);
              p({ materialKey: e.target.value, thicknessMm: mat?.thicknessesMm.includes(d.thicknessMm) ? d.thicknessMm : mat?.thicknessesMm.at(-1) ?? d.thicknessMm });
            }}>{materials.map((x) => <option key={x.key} value={x.key}>{x.nameTh ?? x.name}</option>)}</select>
            <select aria-label="ความหนา" style={{ height: 28 }} value={d.thicknessMm} onChange={(e) => p({ thicknessMm: Number(e.target.value) })}>
              {(material?.thicknessesMm ?? [18]).map((t) => <option key={t} value={t}>{t} มม.</option>)}
            </select>
          </span>
        </div>
      </div>

      {res && m && (
        <div className="tiles">
          <div className="tile"><div className="k"><span>F3</span><span className="dot" title="ระดับวิศวกรรม" style={{ background: 'var(--good)', width: 6, height: 6 }} /></div><div className="v">{m.f3 ? m.f3.toFixed(0) : '—'}</div><div className="u">{m.f3High ? `ถึง ${m.f3High.toFixed(0)} Hz` : 'Hz (−3 dB)'}</div></div>
          <div className="tile"><div className="k"><span>{tuning.k}</span><span className="dot" style={{ background: 'var(--good)', width: 6, height: 6 }} /></div><div className="v">{tuning.v}</div><div className="u">{tuning.u}</div></div>
          <div className="tile"><div className="k"><span>SPL สูงสุด</span><span className="dot" style={{ background: 'var(--good)', width: 6, height: 6 }} /></div><div className="v">{m.splMax.toFixed(1)}</div><div className="u">dB ที่ 1 ม.</div></div>
          <div className="tile"><div className="k"><span>ระยะชัก</span></div><div className="v" style={{ color: xmax && m.excursionMax.mm > xmax ? '#f0abfc' : '#c4b5fd' }}>{m.excursionMax.mm.toFixed(1)}</div>
            <div className="bar"><i style={{ width: `${Math.min(100, xmax ? (m.excursionMax.mm / xmax) * 100 : 0)}%`, background: xmax && m.excursionMax.mm > xmax ? '#f0abfc' : '#c4b5fd' }} /></div></div>
          <div className="tile"><div className="k"><span>ลมในท่อ</span></div><div className="v" style={{ color: m.portVelocityMax.ms > 30 ? '#f0abfc' : m.portVelocityMax.ms > 17 ? '#fcd34d' : '#bef264' }}>{res.info.ports.length ? m.portVelocityMax.ms.toFixed(1) : '—'}</div>
            <div className="bar"><i style={{ width: `${Math.min(100, (m.portVelocityMax.ms / 40) * 100)}%`, background: m.portVelocityMax.ms > 30 ? '#f0abfc' : m.portVelocityMax.ms > 17 ? '#fcd34d' : '#bef264' }} /></div></div>
          <div className="tile"><div className="k"><span>ท่อยาว</span></div><div className="v">{geo && geo.portFold !== 'none' ? (geo.portLength * 100).toFixed(0) : '—'}</div>
            <div className="u">{geo?.portFold === 'L' ? 'ซม. · พับตัว L' : geo?.portFold === 'straight' ? 'ซม. · ตรง' : geo?.portFold === 'impossible' ? 'ใส่ในตู้ไม่ได้' : 'ไม่มีท่อ'}</div></div>
        </div>
      )}
      {warnings.slice(0, 3).map((w, i) => (
        <div key={i} className="warn" style={{ color: WARN_COLOR[w.level], background: `${WARN_COLOR[w.level]}14`, border: `1px solid ${WARN_COLOR[w.level]}55` }}>
          <Icon name="alert" size={15} width={2} /><span>{w.text}</span>
        </div>
      ))}
    </section>
  );
}
