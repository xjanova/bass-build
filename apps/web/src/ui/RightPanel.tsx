import type { Driver } from '@bassbuild/physics';
import { useEffect, useState } from 'react';
import type { DriverDto } from '../data/types';
import { isFill, RANGES, SUGGEST_FLAG_TEXT, suggestDesign, type Warning } from '../sim/model';
import { useApp, type BoxType, type Design } from '../state/store';
import type { Finish } from '../viewport/finishes';
import { Icon } from './icons';

const TYPES: [BoxType, string][] = [['sealed', 'ตู้ปิด'], ['vented', 'ตู้เปิด'], ['pr', 'PR'], ['bp4', 'BP4'], ['bp6', 'BP6'], ['isobaric', 'Isobaric']];
const FINISHES: [Finish, string][] = [['walnut', 'วีเนียร์วอลนัท'], ['oak', 'วีเนียร์โอ๊ก'], ['teak', 'วีเนียร์สัก'], ['black', 'ทำสีดำซาติน'], ['raw', 'ผิววัสดุจริง']];

function Slider({ id, label, value, range, step = 1, fmt, onChange }: {
  id: string; label: string; value: number; range: readonly [number, number]; step?: number; fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="field-head"><label htmlFor={id}>{label}</label><output htmlFor={id}>{fmt(value)}</output></div>
      <input id={id} type="range" min={range[0]} max={range[1]} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

const WARN_COLOR = { bad: '#f0abfc', warn: '#fcd34d', info: '#67e8f9' } as const;

const closest = (options: number[], v: number) => options.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), options[0] ?? v);

/**
 * Thickness to use after a material change: keep the current one when the new material comes in
 * a similar range, otherwise fall back towards the usual 18 mm — so a trip through 3 mm aluminium
 * does not leave an MDF box at 9 mm.
 */
const thicknessFor = (options: number[], v: number) =>
  options.length && v >= Math.min(...options) && v <= Math.max(...options) ? closest(options, v) : closest(options, 18);

export function RightPanel({ dto, driver, warnings, driverError }: {
  dto: DriverDto | undefined; driver: Driver | null; warnings: Warning[]; driverError: string[] | null;
}) {
  const { drivers, driverId, selectDriver, design: d, patchDesign, materials, damping, showToast } = useApp();
  const [allWarnings, setAllWarnings] = useState(false);
  // Applying a suggestion overwrites the box, so it takes a second, explicit click.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const id = window.setTimeout(() => setConfirming(false), 6000);
    return () => window.clearTimeout(id);
  }, [confirming]);
  const p = (patch: Partial<Design>) => patchDesign(patch);
  const L = (v: number) => `${v} L`;
  const Hz = (v: number) => `${v} Hz`;
  const material = materials.find((x) => x.key === d.materialKey);
  const fills = damping.filter(isFill);
  const sheets = damping.filter((x) => !isFill(x));
  const hasFill = d.boxType === 'sealed' || d.boxType === 'vented' || d.boxType === 'pr';

  const suggest = () => {
    setConfirming(false);
    if (!driver) return;
    // Read the store directly: a click right after changing the box type must not see the old type.
    const before = useApp.getState().design;
    const s = suggestDesign(before, driver, dto, damping);
    patchDesign(s.patch);
    const notes = s.flags.map((f) => SUGGEST_FLAG_TEXT[f]).join(' · ');
    showToast(`จัดตู้ตามสูตร ${s.name}${s.patch.watts !== before.watts ? ` · ตั้งกำลังขับเท่าพิกัดลำโพง ${s.patch.watts} W` : ''}${notes ? ` · ${notes}` : ''}`,
      { label: 'ย้อนกลับ', run: () => patchDesign(before) });
  };

  const shown = allWarnings ? warnings : warnings.slice(0, 2);

  return (
    <section className="right-panel glass" aria-label="ตั้งค่าตู้และผลลัพธ์">
      <div className="rp-scroll">
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
        {confirming ? (
          <div className="suggest-confirm" role="group" aria-label="ยืนยันการจัดตู้แนะนำ">
            <span>แทนขนาดตู้ ท่อ และกำลังขับตอนนี้ด้วยค่าแนะนำ?</span>
            <button className="yes" onClick={suggest}>แทนค่า</button>
            <button onClick={() => setConfirming(false)}>ยกเลิก</button>
          </div>
        ) : (
          <button className="suggest" onClick={() => setConfirming(true)} disabled={!driver}
            title="คำนวณขนาดตู้ ความถี่จูน และท่อ จากสเปกลำโพงด้วยสูตรมาตรฐาน แล้วปรับต่อได้">
            <Icon name="box" size={15} width={2} />จัดตู้แนะนำสำหรับลำโพงนี้
          </button>
        )}

        <div className="fields">
          <Slider id="vb" label={d.boxType.startsWith('bp') ? 'ห้องหลัง Vr' : 'ปริมาตรสุทธิ Vb'} value={d.vbL} range={RANGES.vbL} fmt={L} onChange={(v) => p({ vbL: v })} />
          {(d.boxType === 'vented' || d.boxType === 'bp4' || d.boxType === 'bp6') && <>
            <Slider id="fb" label={d.boxType === 'bp6' ? 'จูนท่อหลัง' : 'ความถี่จูนท่อ Fb'} value={d.fbHz} range={RANGES.fbHz} step={0.5} fmt={Hz} onChange={(v) => p({ fbHz: v })} />
            <Slider id="pa" label={d.boxType === 'bp6' ? 'พื้นที่ท่อหลัง' : 'พื้นที่ท่อ'} value={d.portAreaCm2} range={RANGES.portAreaCm2} step={5} fmt={(v) => `${v} ซม.²`} onChange={(v) => p({ portAreaCm2: v })} />
          </>}
          {(d.boxType === 'bp4' || d.boxType === 'bp6') && <Slider id="vf" label="ห้องหน้า Vf" value={d.vfL} range={RANGES.vfL} fmt={L} onChange={(v) => p({ vfL: v })} />}
          {d.boxType === 'bp6' && <>
            <Slider id="fb2" label="จูนท่อหน้า" value={d.fb2Hz} range={RANGES.fb2Hz} step={0.5} fmt={Hz} onChange={(v) => p({ fb2Hz: v })} />
            <Slider id="pa2" label="พื้นที่ท่อหน้า" value={d.port2AreaCm2} range={RANGES.port2AreaCm2} step={5} fmt={(v) => `${v} ซม.²`} onChange={(v) => p({ port2AreaCm2: v })} />
          </>}
          {d.boxType === 'pr' && <>
            <Slider id="prs" label="ขนาด PR (Sd ต่อตัว)" value={d.prSdCm2} range={RANGES.prSdCm2} step={5} fmt={(v) => `${v} ซม.²`} onChange={(v) => p({ prSdCm2: v })} />
            <Slider id="prm" label="มวล PR ต่อตัว" value={d.prMassG} range={RANGES.prMassG} step={5} fmt={(v) => `${v} ก.`} onChange={(v) => p({ prMassG: v })} />
            <Slider id="prn" label="จำนวน PR" value={d.prCount} range={[1, 4]} fmt={(v) => `${v} ตัว`} onChange={(v) => p({ prCount: v })} />
          </>}
          <div className="field">
            <div className="field-head">
              <label htmlFor="pw">กำลังขับ</label>
              <button className={`pill${d.subsonic ? ' on' : ''}`} aria-pressed={d.subsonic} onClick={() => p({ subsonic: !d.subsonic })}>Subsonic {d.subsonicHz} Hz</button>
              <output htmlFor="pw" style={{ marginLeft: 'auto' }}>{d.watts} W</output>
            </div>
            <input id="pw" type="range" min={RANGES.watts[0]} max={RANGES.watts[1]} step={1} value={d.watts} onChange={(e) => p({ watts: Number(e.target.value) })} />
          </div>
          <div className="field-head">
            <label htmlFor={d.boxType === 'isobaric' ? 'wire' : 'cnt'}>จำนวนลำโพง</label>
            <span className="pair">
              {d.boxType === 'isobaric'
                ? <span className="fixed">2 ดอก (ประกบ)</span>
                : <select id="cnt" value={d.count} onChange={(e) => p({ count: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} ดอก</option>)}</select>}
              <select id="wire" aria-label="การต่อสาย" value={d.wiring} onChange={(e) => p({ wiring: e.target.value as Design['wiring'] })}><option value="parallel">ขนาน</option><option value="series">อนุกรม</option></select>
            </span>
          </div>

          <div className="section-title sub">วัสดุ</div>
          <div className="field-head">
            <label htmlFor="mat">ผนังตู้</label>
            <span className="pair">
              <select id="mat" style={{ maxWidth: 150 }} value={d.materialKey} onChange={(e) => {
                const mat = materials.find((x) => x.key === e.target.value);
                p({ materialKey: e.target.value, thicknessMm: thicknessFor(mat?.thicknessesMm ?? [d.thicknessMm], d.thicknessMm) });
              }}>{materials.map((x) => <option key={x.key} value={x.key}>{x.nameTh ?? x.name}</option>)}</select>
              <select aria-label="ความหนา" value={d.thicknessMm} onChange={(e) => p({ thicknessMm: Number(e.target.value) })}>
                {(material?.thicknessesMm ?? [d.thicknessMm]).map((t) => <option key={t} value={t}>{t} มม.</option>)}
              </select>
            </span>
          </div>
          <div className="field-head">
            <label htmlFor="fin">ผิวนอก</label>
            <select id="fin" value={d.finish} onChange={(e) => p({ finish: e.target.value as Finish })}>
              {FINISHES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          {hasFill && <>
            <div className="field-head">
              <label htmlFor="fill">ใยซับเสียงในตู้</label>
              <select id="fill" style={{ maxWidth: 190 }} value={d.fillKey} onChange={(e) => p({ fillKey: e.target.value })}>
                {fills.map((x) => <option key={x.key} value={x.key}>{x.nameTh ?? x.name}</option>)}
              </select>
            </div>
            <Slider id="st" label="ปริมาณใย (ผลประมาณ)" value={d.stuffing} range={[0, 1]} step={0.05} fmt={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'ไม่ใส่')} onChange={(v) => p({ stuffing: v })} />
          </>}
          <div className="field-head">
            <label htmlFor="cld">แผ่นซับแรงสั่นผนัง</label>
            <select id="cld" style={{ maxWidth: 190 }} value={d.cldKey} onChange={(e) => p({ cldKey: e.target.value })}>
              <option value="none">ไม่ติด</option>
              {sheets.map((x) => <option key={x.key} value={x.key}>{x.nameTh ?? x.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rp-results">
          <div className="warns">
            {shown.map((w, i) => (
              <div key={i} className="warn" style={{ color: WARN_COLOR[w.level], background: `${WARN_COLOR[w.level]}14`, border: `1px solid ${WARN_COLOR[w.level]}55` }}>
                <Icon name="alert" size={15} width={2} /><span>{w.text}</span>
              </div>
            ))}
            {warnings.length > 2 && (
              <button className="more" onClick={() => setAllWarnings((v) => !v)}>{allWarnings ? 'ย่อคำเตือน' : `ดูคำเตือนอีก ${warnings.length - 2} ข้อ`}</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
