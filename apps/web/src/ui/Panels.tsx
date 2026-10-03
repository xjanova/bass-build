import type { BoxGeometry } from '../sim/model';
import { useApp, type OverlayId } from '../state/store';
import { Icon, Logo, ICONS } from './icons';

export function TopBar({ modelCode }: { modelCode: string }) {
  const { mode, setMode } = useApp();
  return (
    <header className="topbar">
      <div className="brand"><Logo /><b>BASS BUILD</b><span className="tag">LAB</span></div>
      <div className="project"><span className="mono">{modelCode}</span><span className="chip" style={{ padding: '1px 6px', borderRadius: 4 }}>Rev A</span></div>
      <nav className="tabs" aria-label="โหมดหลัก">
        <button className="tab" aria-pressed={mode === 'design'} onClick={() => setMode('design')}>ออกแบบ</button>
        <button className="tab" aria-pressed={mode === 'lab'} onClick={() => setMode('lab')}>แล็บทดสอบ</button>
        <button className="tab" disabled title="มาในเฟส 5">AI สุ่มตู้</button>
        <button className="tab" disabled title="มาในเฟส 3">พิมพ์เขียว</button>
        <button className="tab" disabled title="มาในเฟส 1">คลังข้อมูล</button>
      </nav>
      <span className="chip"><span className="dot" style={{ background: 'var(--lime)' }} />WebGPU</span>
    </header>
  );
}

const TOOLS: [keyof typeof ICONS, string][] = [
  ['select', 'เลือก'], ['box', 'ทรงตู้'], ['drill', 'เจาะรู'], ['port', 'ท่อ'], ['divider', 'แผ่นกั้น'],
  ['brace', 'โครงค้ำ'], ['fill', 'ยัดใย'], ['measure', 'วัดระยะ'], ['mic', 'ไมค์เสมือน'], ['smoke', 'ปล่อยควัน']
];

export function LeftPanel({ geo, modelCode }: { geo: BoxGeometry | null; modelCode: string }) {
  const { tool, setTool, design: d, genHz, setGen, slow, setSlow, playing, togglePlay, materials } = useApp();
  const mat = materials.find((m) => m.key === d.materialKey);
  return (
    <section className="left-panel glass" aria-label="เครื่องมือและโครงสร้างงาน">
      <div className="section-title">เครื่องมือ</div>
      <div className="toolgrid">
        {TOOLS.map(([icon, label]) => (
          <button key={icon} aria-label={label} title={`${label} (เครื่องมือแก้รูปทรงมาในเฟส 2)`} aria-pressed={tool === icon} onClick={() => setTool(icon)}><Icon name={icon} size={20} width={1.6} /></button>
        ))}
      </div>
      <div className="section-title" style={{ marginTop: 4 }}>โครงสร้างงาน</div>
      <div className="tree">
        <div className="root"><span className="sw" style={{ background: 'var(--cyan)' }} /><span style={{ flex: 1 }}>ตู้ {modelCode}</span><span className="mono" style={{ fontSize: 11, color: 'var(--cyan-soft)' }}>{d.vbL} L</span></div>
        <div><span className="sw" style={{ background: '#334155' }} />แผงหน้า · {mat?.nameTh ?? 'MDF'} ดำซาติน {d.thicknessMm} มม.</div>
        <div><span className="sw" style={{ background: '#7c4a2a' }} />ผนัง · วีเนียร์วอลนัท {d.thicknessMm} มม.</div>
        <div><span className="sw" style={{ background: '#94a3b8', borderRadius: '50%' }} />ลำโพง × {d.boxType === 'isobaric' ? 2 : d.count}</div>
        <div><span className="sw" style={{ background: 'var(--lime)' }} />{geo && geo.portFold !== 'none' ? `ท่อสลอต ${Math.round(geo.wi * 1000)} × ${Math.round(geo.slotH * 1000)} มม.` : 'ไม่มีท่อหน้า'}</div>
        <div><span className="sw" style={{ background: '#64748b' }} />โครงค้ำแบบหน้าต่าง</div>
        <div><span className="sw" style={{ background: '#e2e8f0', borderRadius: '50%' }} />ใยโพลีเอสเตอร์ {Math.round(d.stuffing * 100)}%</div>
        <div><span className="sw" style={{ background: '#f472b6', borderRadius: '50%' }} />ไมค์เสมือน · ระยะ 1 ม.</div>
      </div>
      <div className="gen">
        <div className="field-head"><label htmlFor="gen" className="section-title" style={{ color: 'var(--muted)' }}>สัญญาณ sine</label><output htmlFor="gen" style={{ fontSize: 15 }}>{genHz} Hz</output></div>
        <input id="gen" type="range" min={20} max={400} step={1} value={genHz} onChange={(e) => setGen(Number(e.target.value))} />
        <div className="gen-row">
          <button className="play" aria-label={playing ? 'หยุดชั่วคราว' : 'เล่น'} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} size={16} width={2} /></button>
          {[1, 10, 100, 1000].map((v) => <button key={v} aria-pressed={slow === v} onClick={() => setSlow(v)}>×{v}</button>)}
        </div>
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>สโลว์โมชัน ×{slow} — คลื่นเสียงจริงเร็วเกินกว่าตาจะเห็น</div>
      </div>
    </section>
  );
}

const OVERLAYS: [OverlayId, string, string, keyof typeof ICONS][] = [
  ['wave', 'คลื่น', '#22d3ee', 'wave'], ['air', 'ลม', '#a3e635', 'air'], ['smoke', 'ควัน', '#d9f99d', 'cloud'], ['ir', 'อินฟราเรด', '#fb923c', 'ir'],
  ['vib', 'ผนังสั่น', '#a78bfa', 'vib'], ['balloon', 'ทิศทางเสียง', '#67e8f9', 'balloon'], ['xray', 'เอ็กซเรย์', '#cbd5e1', 'xray']
];

export function OverlayBar({ geo }: { geo: BoxGeometry | null }) {
  const { mode, overlays, toggleOverlay, design: d } = useApp();
  if (mode === 'design') {
    return (
      <div className="overlaybar">
        <div className="design-chips">
          <span style={{ background: 'rgba(8,47,73,0.7)', borderColor: 'rgba(125,211,252,0.35)', color: '#e0f2fe' }}>ขนาดภายนอก <b className="mono">{geo ? `${Math.round(geo.wx * 1000)} × ${Math.round(geo.hx * 1000)} × ${Math.round(geo.dx * 1000)} มม.` : '—'}</b></span>
          <span>ตู้เปล่าราว {geo ? geo.weightKg.toFixed(0) : '—'} กก.</span>
          <span>แผ่น {d.thicknessMm} มม. {geo?.sheets ?? '—'} แผ่น</span>
        </div>
      </div>
    );
  }
  return (
    <div className="overlaybar" role="toolbar" aria-label="โหมดภาพ 3 มิติ">
      {OVERLAYS.map(([id, label, color, icon]) => {
        const on = overlays[id];
        return (
          <button key={id} className="ovbtn" aria-pressed={on} onClick={() => toggleOverlay(id)}
            style={on ? { borderColor: color, background: `${color}1f`, color, boxShadow: `0 0 18px ${color}40` } : undefined}>
            <Icon name={icon} />{label}
          </button>
        );
      })}
    </div>
  );
}

export function Hud({ thermal, f11 }: { thermal: { tvc: number; tmag: number; reRise: number; seconds: number } | null; f11: number }) {
  const { mode, genHz, slow, design: d, overlays } = useApp();
  const lab = mode === 'lab';
  return (
    <div className="hud">
      <div className="sig">{lab ? `sine ${genHz} Hz · ${d.watts} W · สโลว์โมชัน ×${slow}` : 'โหมดออกแบบ · ลากเพื่อหมุนดูรอบตู้'}</div>
      <div className="note">กราฟ ตัวเลข ระยะชัก และลมในท่อ คำนวณจริงด้วยวงจรเทียบ T/S · ภาพคลื่นเป็นแหล่งกำเนิดจุด 2 จุด และควันเป็นภาพเชิงปรากฏการณ์ (โซลเวอร์ FDTD/LBM เต็มรูปแบบมาในเฟส 6–7)</div>
      <div className="legend">
        <span><span className="dot" style={{ background: 'var(--good)' }} />วิศวกรรม</span>
        <span><span className="dot" style={{ background: '#facc15' }} />ประมาณเชิงตัวเลข</span>
        <span><span className="dot" style={{ background: 'var(--heat)' }} />ภาพเชิงปรากฏการณ์</span>
      </div>
      {lab && overlays.wave && (
        <div className="legend" style={{ marginTop: 2 }}><span>ขยายตัว (−)</span><span style={{ width: 120, height: 6, borderRadius: 3, background: 'linear-gradient(90deg,#3b82f6,rgba(59,130,246,0.05) 45%,rgba(34,211,238,0.05) 55%,#a5f3fc)' }} /><span>อัดตัว (+)</span></div>
      )}
      {lab && overlays.vib && <div className="legend"><span style={{ color: '#c4b5fd' }}>โหมดผนัง (1,1) ≈ {f11.toFixed(0)} Hz · ภาพขยายเกินจริง</span></div>}
      {lab && overlays.ir && thermal && (
        <div className="irbox irfloat">
          <h4>ทดสอบความร้อน · {thermal.seconds.toFixed(0)} วินาที</h4>
          <div className="grid">
            <span>วอยซ์คอยล์ {thermal.tvc.toFixed(0)} °C</span><span>แม่เหล็ก {thermal.tmag.toFixed(0)} °C</span>
            <span>Re ร้อน ×{thermal.reRise.toFixed(2)}</span><span>ดังลดลง {(20 * Math.log10(1 / thermal.reRise)).toFixed(1)} dB</span>
          </div>
          <div className="legend" style={{ fontFamily: 'var(--mono)', color: '#fdba74' }}><span>20°</span><span style={{ flex: 1, height: 6, borderRadius: 3, background: 'linear-gradient(90deg,#080414,#460a6e,#be1e46,#f57814,#fcd23c,#fffadc)' }} /><span>190°</span></div>
          <span style={{ fontSize: 11, color: '#fdba74' }}>ค่าความร้อนประมาณจากกำลังพิกัด (ไม่มีข้อมูลความร้อนใน datasheet)</span>
        </div>
      )}
    </div>
  );
}
