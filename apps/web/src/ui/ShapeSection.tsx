import { AXIS_TH, buildProblems, RANGES, shapeFor, type BoxGeometry, type DimAxis } from '../sim/model';
import { useApp, type DimMode, type Design } from '../state/store';
import { NumField } from './NumField';

const MODE_TH: Record<DimMode, string> = { auto: 'อัตโนมัติ', fixed: 'กำหนด', max: 'ไม่เกิน' };
const KEYS = [['wMode', 'wMm'], ['hMode', 'hMm'], ['dMode', 'dMm']] as const satisfies readonly (readonly [keyof Design, keyof Design])[];
/** Outside sizes a hand-set side may take, mm. */
export const DIM_RANGE = [80, 3000] as const;

const mm = (m: number) => Math.round(m * 1000);
const litres = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1));

/**
 * Outline and outside size of the box. Each side is laid out from the volume, held at a size, or
 * kept under a size (the space in a car boot, a shelf); the inside follows from the panels and the
 * physics keeps the net volume set above.
 */
export function ShapeSection({ geo }: { geo: BoxGeometry | null }) {
  const { design: d, patchDesign, drivers, driverId } = useApp();
  const dto = drivers.find((x) => x.id === driverId);
  // The sizes' own problem, repeated here: the panel is scrolled to this section when it is edited.
  const space = geo ? buildProblems(d, dto, geo).find((p) => p.code === 'space') : undefined;
  const wedgeOk = shapeFor({ ...d, shape: 'wedge' }) === 'wedge';
  const wedge = geo?.shape === 'wedge';
  const outside = (axis: DimAxis) => (geo ? [geo.wx, geo.hx, geo.dx][axis] : 0);
  const setMode = (axis: DimAxis, mode: DimMode) => {
    const [mk, vk] = KEYS[axis];
    // Leaving "auto" starts from the size the box has now, so nothing jumps.
    const from = d[mk] === 'auto' && geo ? Math.min(DIM_RANGE[1], Math.max(DIM_RANGE[0], mm(outside(axis)))) : d[vk];
    patchDesign({ [mk]: mode, [vk]: from });
  };
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
    ['อุโมงค์ลำโพงประกบ', v.tunnelL], ['โครงค้ำแบบหน้าต่าง', v.bracesL], ['ที่ว่างเกิน (ต้องใส่บล็อก)', v.extraL]
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
      {([0, 1, 2] as const).map((axis) => {
        const [mk, vk] = KEYS[axis];
        const mode = d[mk] as DimMode;
        const name = axis === 2 && wedge ? 'ลึกที่พื้น' : AXIS_TH[axis];
        return (
          <div className="field-head" key={axis}>
            <label htmlFor={`dim${axis}`}>{name} (ภายนอก)</label>
            <span className="pair">
              <select id={`dim${axis}`} className="mini" value={mode} onChange={(e) => setMode(axis, e.target.value as DimMode)}>
                {(Object.keys(MODE_TH) as DimMode[]).map((k) => <option key={k} value={k}>{MODE_TH[k]}</option>)}
              </select>
              {mode === 'auto'
                ? <span className="fixed mono">{geo ? `${mm(outside(axis))} มม.` : '—'}</span>
                : <NumField id={`dim${axis}v`} label={`${name} ${MODE_TH[mode]}`} value={d[vk] as number} min={DIM_RANGE[0]} max={DIM_RANGE[1]} unit="มม." onChange={(x) => patchDesign({ [vk]: x })} />}
            </span>
          </div>
        );
      })}
      {geo && (
        <div className="loadline muted">
          <span>ได้จริง <b>{mm(geo.wx)} × {mm(geo.hx)} × {mm(geo.dx)} มม.</b>{wedge ? <> · ด้านบนลึก <b>{mm(geo.dxTop)}</b> · หลังเอียง {(geo.backAngle * 180 / Math.PI).toFixed(0)}°</> : null}</span>
          {geo.capacityL !== null && !geo.dimConflict && <span>ขนาดนี้ใส่ได้สุทธิราว <b>{Math.floor(geo.capacityL)} L</b></span>}
        </div>
      )}
      {space && <div className="limit-note" role="status">{space.text}</div>}
      {geo && geo.extraL >= 1 && (
        <button type="button" className="linkbtn" onClick={fillUp} title="เพิ่มปริมาตรสุทธิให้เต็มขนาดที่กำหนด แทนการใส่บล็อก">
          ใช้ปริมาตรเต็มตู้ (+{Math.floor(geo.extraL)} L)
        </button>
      )}
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
