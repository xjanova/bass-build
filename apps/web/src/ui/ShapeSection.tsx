import { useState } from 'react';
import { AXIS_TH, BRACE_TH, buildProblems, dimRange, RANGES, REF_TH, shapeFor, sidesIn, switchDims, type BoxGeometry, type DimAxis } from '../sim/model';
import { useApp, type DimMode, type DimRef, type Design } from '../state/store';
import { NumField } from './NumField';

const MODE_TH: Record<DimMode, string> = { auto: 'อัตโนมัติ', fixed: 'กำหนด', max: 'ไม่เกิน' };
const KEYS = [['wMode', 'wMm'], ['hMode', 'hMm'], ['dMode', 'dMm']] as const satisfies readonly (readonly [keyof Design, keyof Design])[];

const mm = (m: number) => Math.round(m * 1000);
const litres = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));

/**
 * Outline and size of the box. Each side is laid out from the volume, held at a size, or kept
 * under a size (the space in a car boot, a shelf), entered as the outside size (what has to fit)
 * or the inside size (what a plan gives); the other follows from the panels and the physics keeps
 * the net volume set above.
 */
export function ShapeSection({ geo }: { geo: BoxGeometry | null }) {
  const { design: d, patchDesign, drivers, driverId } = useApp();
  const dto = drivers.find((x) => x.id === driverId);
  // The sizes' own problem, repeated here: the panel is scrolled to this section when it is edited.
  const problems = geo ? buildProblems(d, dto, geo) : [];
  const space = problems.find((p) => p.code === 'space');
  const place = problems.find((p) => p.code === 'placement');
  const wedgeOk = shapeFor({ ...d, shape: 'wedge' }) === 'wedge';
  const wedge = geo?.shape === 'wedge';
  const ref: DimRef = d.dimRef === 'inner' ? 'inner' : 'outer';
  const rangeOf = (axis: DimAxis) => dimRange(d, geo, axis, ref);
  // The design a switch was refused for: the note goes away as soon as anything changes.
  const [refused, setRefused] = useState<{ d: Design; axes: DimAxis[] } | null>(null);
  const sides = geo ? sidesIn(geo, ref) : null;
  const outside = geo ? sidesIn(geo, 'outer') : null;
  const setMode = (axis: DimAxis, mode: DimMode) => {
    const [mk, vk] = KEYS[axis];
    // Leaving "auto" starts from the size the box has now, so nothing jumps.
    const [lo, hi] = rangeOf(axis);
    const from = d[mk] === 'auto' && sides ? Math.min(hi, Math.max(lo, mm(sides[axis]))) : d[vk];
    patchDesign({ [mk]: mode, [vk]: from });
  };
  // Re-enter the numbers the other way in one step, so the box keeps its size (and one undo brings it
  // back); a number the other side cannot take refuses the switch instead of resizing the box.
  const setRef = (to: DimRef) => {
    if (to === ref) return;
    const { patch, blocked } = switchDims(d, geo, to);
    if (blocked.length) { setRefused({ d, axes: blocked }); return; }
    setRefused(null);
    patchDesign(patch);
  };
  const refusedNote = refused && refused.d === d
    ? `สลับไม่ได้: ${refused.axes.map((a) => (a === 2 && wedge ? 'ลึกที่พื้น' : AXIS_TH[a])).join(' ')} เกินช่วงที่กรอกได้เมื่อวัด${REF_TH[ref === 'inner' ? 'outer' : 'inner']}`
    : null;
  const bp = d.boxType === 'bp4' || d.boxType === 'bp6';
  const fillUp = () => {
    if (!geo) return;
    const extra = Math.floor(geo.extraL);
    if (extra < 1) return;
    if (!bp) { patchDesign({ vbL: Math.min(RANGES.vbL[1], d.vbL + extra) }); return; }
    const rear = Math.round((extra * d.vbL) / (d.vbL + d.vfL));
    patchDesign({ vbL: Math.min(RANGES.vbL[1], d.vbL + rear), vfL: Math.min(RANGES.vfL[1], d.vfL + extra - rear) });
  };
  const v = geo?.volume;
  const rows: [string, number][] = v ? ([
    ['ลำโพง (ปริมาตรแทนที่)', v.driversL], ['ท่อและแผ่นท่อ', v.portsL], ['แผ่นกั้น / แผงยึดลำโพงใน', v.boardsL],
    ['อุโมงค์ลำโพงประกบ', v.tunnelL], [BRACE_TH[d.braceKind], v.bracesL], ['ที่ว่างเกิน (ต้องใส่บล็อก)', v.extraL]
  ] as [string, number][]).filter(([, x]) => x >= 0.05) : [];

  return (
    <>
      <div className="section-title sub" id="dims">ทรงและขนาดตู้</div>
      <div className="seg" role="group" aria-label="ทรงตู้">
        <button aria-pressed={!wedge} onClick={() => patchDesign({ shape: 'box' })}>สี่เหลี่ยม</button>
        <button aria-pressed={wedge} disabled={!wedgeOk} onClick={() => patchDesign({ shape: 'wedge' })}
          title={wedgeOk ? 'ผนังหลังเอียง ด้านบนตื้นกว่าด้านล่าง เข้าหลังเบาะหรือท้ายรถได้' : 'ทรงลิ่มใช้ได้กับตู้ปิดและตู้เปิด'}>ทรงลิ่ม (หลังเบาะ/ท้ายรถ)</button>
      </div>
      {d.shape === 'wedge' && !wedgeOk && <div className="loadline muted">ทรงลิ่มใช้ได้กับตู้ปิดและตู้เปิด ตู้แบบนี้จึงวางเป็นสี่เหลี่ยม</div>}
      {wedge && (
        <div className="field">
          <div className="field-head"><label htmlFor="wtop">ด้านบนลึก (ภายใน)</label><output htmlFor="wtop">{d.wedgeTopPct}% ของด้านล่าง</output></div>
          <input id="wtop" type="range" min={20} max={95} step={5} value={d.wedgeTopPct} onChange={(e) => patchDesign({ wedgeTopPct: Number(e.target.value) })} />
        </div>
      )}
      <div className="field-head ref-row">
        <span id="dimref-l">ขนาดที่กรอก</span>
        <div className="seg" role="group" aria-labelledby="dimref-l">
          {(['outer', 'inner'] as const).map((k) => (
            <button key={k} aria-pressed={ref === k} onClick={() => setRef(k)}
              title={k === 'outer' ? 'วัดรวมความหนาแผง: ขนาดที่ต้องวางลงในรถหรือชั้น' : 'วัดระหว่างแผ่น: ขนาดตามแบบ ด้านในคงที่ ด้านนอกเปลี่ยนตามความหนาแผง'}>{REF_TH[k]}</button>
          ))}
        </div>
      </div>
      {refusedNote && <div className="limit-note" role="status">{refusedNote}</div>}
      {([0, 1, 2] as const).map((axis) => {
        const [mk, vk] = KEYS[axis];
        const mode = d[mk] as DimMode;
        const name = axis === 2 && wedge ? 'ลึกที่พื้น' : AXIS_TH[axis];
        return (
          <div className="field-head" key={axis}>
            <label htmlFor={`dim${axis}`}>{name} ({REF_TH[ref]})</label>
            <span className="pair">
              <select id={`dim${axis}`} className="mini" value={mode} onChange={(e) => setMode(axis, e.target.value as DimMode)}>
                {(Object.keys(MODE_TH) as DimMode[]).map((k) => <option key={k} value={k}>{MODE_TH[k]}</option>)}
              </select>
              {mode === 'auto'
                ? <span className="fixed mono">{sides && outside ? `${mm(sides[axis])} มม.${ref === 'inner' ? ` (นอก ${mm(outside[axis])})` : ''}` : '—'}</span>
                : <NumField id={`dim${axis}v`} label={`${name} ${REF_TH[ref]} ${MODE_TH[mode]}`} value={d[vk] as number} min={rangeOf(axis)[0]} max={rangeOf(axis)[1]} unit="มม." onChange={(x) => patchDesign({ [vk]: x })} />}
            </span>
          </div>
        );
      })}
      {geo && (
        <div className="loadline muted">
          <span>ได้จริง{ref === 'inner' ? ' ภายใน' : ''} <b>{mm(sides![0])} × {mm(sides![1])} × {mm(sides![2])} มม.</b>{wedge ? <> · ด้านบนลึก <b>{mm(ref === 'inner' ? geo.diTop : geo.dxTop)}</b> · หลังเอียง {(geo.backAngle * 180 / Math.PI).toFixed(0)}°</> : null}</span>
          {/* Inside numbers still have to fit the car: the outside is what gets measured there. */}
          {ref === 'inner' && <span>ภายนอก <b>{mm(geo.wx)} × {mm(geo.hx)} × {mm(geo.dx)} มม.</b>{wedge ? <> · บน <b>{mm(geo.dxTop)}</b></> : null}</span>}
          {geo.capacityL !== null && !geo.dimConflict && <span>ขนาด{REF_TH[ref]}นี้ใส่ได้สุทธิราว <b>{Math.floor(geo.capacityL)} L</b></span>}
        </div>
      )}
      {space && <div className="limit-note" role="status">{space.text}</div>}
      {geo && geo.extraL >= 1 && (
        <button type="button" className="linkbtn" onClick={fillUp} title="เพิ่มปริมาตรสุทธิให้เต็มขนาดที่กำหนด แทนการใส่บล็อก">
          ใช้ปริมาตรเต็มตู้ (+{Math.floor(geo.extraL)} L)
        </button>
      )}
      {geo && d.boxType !== 'bp4' && d.boxType !== 'bp6' && <>
        <div className="field-head">
          <label htmlFor="rowmode">ตำแหน่งลำโพงบนแผงหน้า</label>
          <span className="pair">
            <select id="rowmode" className="mini" value={d.rowMode} onChange={(e) => patchDesign(e.target.value === 'auto'
              ? { rowMode: 'auto' }
              // Start from where the row is now, so nothing jumps.
              : { rowMode: 'manual', rowXMm: Math.round(geo.rowX * 1000), rowYMm: Math.round(geo.driverY * 1000) })}>
              <option value="auto">กึ่งกลาง</option><option value="manual">วางเอง</option>
            </select>
            {d.rowMode === 'manual' && <button type="button" className="linkbtn" onClick={() => patchDesign({ rowMode: 'auto' })}>จัดกลาง</button>}
          </span>
        </div>
        {d.rowMode === 'manual' && (
          <div className="field-head">
            <label htmlFor="rowx">เลื่อนซ้าย/ขวา · สูงจากพื้น</label>
            <span className="pair">
              <NumField id="rowx" label="เลื่อนจากกึ่งกลาง (ลบ = ซ้าย)" value={d.rowXMm} min={-1500} max={1500} unit="มม." onChange={(x) => patchDesign({ rowXMm: x })} />
              <NumField id="rowy" label="ศูนย์กลางลำโพงสูงจากพื้น" value={d.rowYMm} min={20} max={3000} unit="มม." onChange={(x) => patchDesign({ rowYMm: x })} />
            </span>
          </div>
        )}
        {d.rowMode === 'manual' && place && <div className="limit-note" role="status">{place.text}</div>}
      </>}
      {v && (
        <details className="volbreak">
          <summary>ปริมาตรแยกรายการ · ภายในตู้ {litres(v.shellL)} L → สุทธิ {litres(v.netL)} L</summary>
          <table>
            <tbody>
              <tr><td>ภายในตู้ (ระหว่างแผ่น)</td><td className="mono">{litres(v.shellL)} L</td></tr>
              {rows.map(([label, x]) => <tr key={label}><td>− {label}</td><td className="mono">{litres(x)} L</td></tr>)}
              {geo!.shortL >= 0.05 && <tr className="short"><td>+ ขาด (ขนาดที่กำหนดเล็กไป)</td><td className="mono">{litres(geo!.shortL)} L</td></tr>}
              <tr className="sum"><td>= ปริมาตรสุทธิ{bp ? ' (ห้องหลัง + ห้องหน้า)' : ''}</td><td className="mono">{litres(v.netL)} L</td></tr>
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
