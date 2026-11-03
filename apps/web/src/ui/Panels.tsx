import { useEffect } from 'react';
import { OVERLAY_CONF, type Conf, type ResultKey } from '../sim/confidence';
import { BRACE_TH, type BoxGeometry, type WallDamping } from '../sim/model';
import { useApp, type OverlayId } from '../state/store';
import { ConfDot } from './Conf';
import { Icon, Logo, ICONS } from './icons';

const BACKEND = {
  webgpu: { label: 'WebGPU', color: 'var(--lime)', title: 'การ์ดจอรันผ่าน WebGPU เต็มความเร็ว' },
  webgl: { label: 'WebGL 2', color: 'var(--amber)', title: 'เบราว์เซอร์นี้ไม่มี WebGPU จึงใช้ WebGL 2 แทน ภาพเหมือนกันแต่ช้ากว่า' },
  none: { label: 'ไม่มี 3D', color: 'var(--magenta)', title: 'เปิดภาพ 3 มิติไม่ได้ กราฟและตัวเลขยังใช้ได้' }
} as const;

export function TopBar({ modelCode }: { modelCode: string }) {
  const { mode, setMode, backend, setTeaser, openNotebook, undo, redo, past, future } = useApp();
  const b = backend ? BACKEND[backend] : null;
  return (
    <header className="topbar">
      <div className="brand"><Logo /><b>BASS BUILD</b><span className="tag">LAB</span><span className="ver mono" title={`เวอร์ชัน ${__APP_VERSION__} · บิลด์ ${__BUILD_DATE__}`}>v{__APP_VERSION__}</span></div>
      <div className="project"><span className="mono">{modelCode}</span><span className="chip" style={{ padding: '1px 6px', borderRadius: 4 }}>Rev A</span>
        <span className="history" role="group" aria-label="ประวัติการแก้">
          <button type="button" onClick={undo} disabled={!past.length} aria-label="ย้อนกลับ" title={`ย้อนกลับ (Ctrl+Z)${past.length ? ` · ${past.length} ขั้น` : ''}`}>↶</button>
          <button type="button" onClick={redo} disabled={!future.length} aria-label="ทำซ้ำ" title="ทำซ้ำ (Ctrl+Shift+Z)">↷</button>
        </span>
      </div>
      <nav className="tabs" aria-label="โหมดหลัก">
        <button className="tab" aria-pressed={mode === 'wizard'} onClick={() => setMode('wizard')}>ออกแบบด่วน</button>
        <button className="tab" aria-pressed={mode === 'design'} onClick={() => setMode('design')}>ออกแบบ</button>
        <button className="tab" aria-pressed={mode === 'lab'} onClick={() => setMode('lab')}>แล็บทดสอบ</button>
        <button className="tab soon" title="มาในเฟส 5 · ดูว่าจะทำอะไรได้" onClick={() => setTeaser('ai')}>AI สุ่มตู้</button>
        <button className="tab" aria-pressed={mode === 'blueprint'} onClick={() => setMode('blueprint')}>พิมพ์เขียว</button>
        <button className="tab" aria-pressed={mode === 'library'} onClick={() => setMode('library')}>คลังข้อมูล</button>
      </nav>
      <button className="chip nbbtn" title="สมุดสูตร: ทุกตัวเลขพร้อมสูตร ค่าที่แทน และแหล่งอ้างอิง · เขียนสูตรเองได้" onClick={() => openNotebook()}>ƒ สมุดสูตร</button>
      {b && <span className="chip backend" title={b.title}><span className="dot" style={{ background: b.color }} />{b.label}</span>}
    </header>
  );
}

const TOOLS: [keyof typeof ICONS, string][] = [
  ['select', 'เลือก'], ['box', 'ทรงตู้'], ['drill', 'เจาะรู'], ['port', 'ท่อ'], ['divider', 'แผ่นกั้น'],
  ['brace', 'โครงค้ำ'], ['fill', 'ยัดใย'], ['measure', 'วัดระยะ'], ['mic', 'ไมค์เสมือน'], ['smoke', 'ปล่อยควัน']
];

const FINISH_TH = { walnut: 'วีเนียร์วอลนัท', oak: 'วีเนียร์โอ๊ก', teak: 'วีเนียร์สัก', black: 'ทำสีดำซาติน' } as const;

export function LeftPanel({ geo, modelCode }: { geo: BoxGeometry | null; modelCode: string }) {
  const { mode, tool, setTool, showToast, design: d, genHz, setGen, slow, setSlow, playing, togglePlay, materials, damping } = useApp();
  const mat = materials.find((m) => m.key === d.materialKey);
  const matName = mat?.nameTh ?? mat?.name ?? 'MDF';
  const fill = damping.find((m) => m.key === d.fillKey);
  const cld = damping.find((m) => m.key === d.cldKey);
  const outer = d.finish === 'raw' ? `${matName} ผิวเดิม` : FINISH_TH[d.finish];
  const pick = (icon: string, label: string) => {
    if (icon === 'select') { setTool(icon); return; }
    // The box and brace tools open their settings in the right panel.
    if (icon === 'box' || icon === 'brace') {
      setTool(icon);
      document.getElementById(icon === 'box' ? 'dims' : 'braces')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // The other shape-editing tools are still to come. Say so instead of lighting up a button that does nothing.
    showToast(`เครื่องมือ "${label}" ยังไม่พร้อม (เจาะรู วางท่อ แผ่นกั้นแบบลากวาง) ตอนนี้ปรับตู้ได้จากแผงขวา`);
  };
  const ready = (icon: string) => icon === 'select' || icon === 'box' || icon === 'brace';
  return (
    <section className="left-panel glass" aria-label="เครื่องมือและโครงสร้างงาน">
      <div className="section-title">เครื่องมือ</div>
      <div className="toolgrid">
        {TOOLS.map(([icon, label]) => (
          <button key={icon} aria-label={label} title={icon === 'box' ? 'ทรงตู้ · ทรงลิ่ม ล็อกขนาดแต่ละด้าน' : icon === 'brace' ? 'โครงค้ำ · แบบและจำนวนชุด' : ready(icon) ? label : `${label} · ยังไม่พร้อม`} aria-pressed={tool === icon}
            className={ready(icon) ? undefined : 'soon'} onClick={() => pick(icon, label)}><Icon name={icon} size={20} width={1.6} /></button>
        ))}
      </div>
      <div className="section-title" style={{ marginTop: 4 }}>โครงสร้างงาน</div>
      <div className="tree">
        <div className="root"><span className="sw" style={{ background: 'var(--cyan)' }} /><span style={{ flex: 1 }}>ตู้ {modelCode}{geo?.shape === 'wedge' ? ' · ทรงลิ่ม' : ''}</span><span className="mono" style={{ fontSize: 11, color: 'var(--cyan-soft)' }}>{d.vbL} L</span></div>
        <div><span className="sw" style={{ background: '#334155' }} />แผงหน้า · {matName} {d.finish === 'raw' ? 'ผิวเดิม' : 'ทำสีดำ'} {d.thicknessMm} มม.</div>
        <div><span className="sw" style={{ background: '#7c4a2a' }} />ผนัง · {matName} {d.thicknessMm} มม. · {outer}</div>
        <div><span className="sw" style={{ background: '#94a3b8', borderRadius: '50%' }} />ลำโพง × {d.boxType === 'isobaric' ? 2 : d.count}</div>
        <div><span className="sw" style={{ background: 'var(--lime)' }} />{geo?.tubes ? `ท่อกลม ${geo.tubes.count} ท่อ · ใน Ø ${Math.round(geo.tubes.id * 1000)} มม.` : geo && geo.portFold !== 'none' ? `ท่อสลอต ${Math.round(geo.wi * 1000)} × ${Math.round(geo.slotH * 1000)} มม.` : 'ไม่มีท่อหน้า'}</div>
        <div><span className="sw" style={{ background: '#64748b' }} />{BRACE_TH[d.braceKind]}{d.braceKind !== 'none' && geo ? ` × ${geo.braces.zs.length}` : ''}</div>
        <div><span className="sw" style={{ background: '#e2e8f0', borderRadius: '50%' }} />{d.stuffing > 0 ? `${fill?.nameTh ?? fill?.name ?? 'ใยซับเสียง'} ${Math.round(d.stuffing * 100)}%` : 'ไม่ใส่ใยซับเสียง'}</div>
        {cld && <div><span className="sw" style={{ background: '#a78bfa' }} />{cld.nameTh ?? cld.name} ทุกผนัง</div>}
        <div><span className="sw" style={{ background: '#f472b6', borderRadius: '50%' }} />ไมค์เสมือน · ระยะ 1 ม.</div>
      </div>
      {mode === 'lab' && (
        <div className="gen">
          <div className="field-head"><label htmlFor="gen" className="section-title" style={{ color: 'var(--muted)' }}>สัญญาณ sine</label><output htmlFor="gen" style={{ fontSize: 15 }}>{genHz} Hz</output></div>
          <input id="gen" type="range" min={20} max={400} step={1} value={genHz} onChange={(e) => setGen(Number(e.target.value))} />
          <div className="gen-row">
            <button className="play" aria-label={playing ? 'หยุดชั่วคราว' : 'เล่น'} onClick={togglePlay}><Icon name={playing ? 'pause' : 'play'} size={16} width={2} /></button>
            {[1, 10, 100, 1000].map((v) => <button key={v} aria-pressed={slow === v} onClick={() => setSlow(v)}>×{v}</button>)}
          </div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>สโลว์โมชัน ×{slow} — คลื่นเสียงจริงเร็วเกินกว่าตาจะเห็น</div>
        </div>
      )}
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
          <button key={id} className="ovbtn" aria-pressed={on} aria-label={label} title={label} onClick={() => toggleOverlay(id)}
            style={on ? { borderColor: color, background: `${color}1f`, color, boxShadow: `0 0 18px ${color}40` } : undefined}>
            <Icon name={icon} /><span className="ovlabel">{label}</span>
            {OVERLAY_CONF[id] && <span className="ov-conf"><ConfDot conf={OVERLAY_CONF[id]} size={5} /></span>}
          </button>
        );
      })}
    </div>
  );
}

export function Hud({ modes, wall, vib, conf }: { modes: { side: number; back: number; top: number }; wall: WallDamping; vib: { r: number; h: number; pk: number }; conf: Record<ResultKey, Conf> }) {
  const { mode, genHz, slow, design: d, overlays } = useApp();
  const lab = mode === 'lab';
  return (
    <div className="hud">
      <div className="sig">{lab ? `sine ${genHz} Hz · ${d.watts} W · สโลว์โมชัน ×${slow}` : 'โหมดออกแบบ · ลากเพื่อหมุนดูรอบตู้'}</div>
      {lab && <div className="note">กราฟ ตัวเลข ระยะชัก และลมในท่อ คำนวณจริงด้วยวงจรเทียบ T/S · ภาพคลื่นเป็นแหล่งกำเนิดจุด 2 จุด และควันเป็นภาพเชิงปรากฏการณ์ (โซลเวอร์ FDTD/LBM เต็มรูปแบบมาในเฟส 6–7)</div>}
      {lab && (
        <div className="legend">
          <span><span className="dot" style={{ background: 'var(--good)' }} />วิศวกรรม</span>
          <span><span className="dot" style={{ background: '#facc15' }} />ประมาณเชิงตัวเลข</span>
          <span><span className="dot" style={{ background: 'var(--heat)' }} />ภาพเชิงปรากฏการณ์</span>
        </div>
      )}
      {lab && overlays.wave && (
        <div className="legend" style={{ marginTop: 2 }}><span>ขยายตัว (−)</span><span style={{ width: 120, height: 6, borderRadius: 3, background: 'linear-gradient(90deg,#3b82f6,rgba(59,130,246,0.05) 45%,rgba(34,211,238,0.05) 55%,#a5f3fc)' }} /><span>อัดตัว (+)</span></div>
      )}
      {lab && overlays.vib && (
        <div className="legend"><span style={{ color: '#c4b5fd' }}>
          <ConfDot conf={conf.panelModes} /> ผนังข้าง (1,1) ≈ {modes.side.toFixed(0)} Hz · ฝาบน ≈ {modes.top.toFixed(0)} Hz · ผนังหลังซึ่งกว้างสุด ≈ {modes.back.toFixed(0)} Hz · ตอนนี้แรงดันในตู้ {vib.pk.toFixed(0)} Pa ที่ {genHz} Hz
          {vib.r > 0.8 && vib.r < 1.25 ? ' ใกล้เรโซแนนซ์' : ''} · ขยาย ×{vib.h.toFixed(1)}
          {wall.ampFactor < 1 ? ` (แผ่นซับแรงสั่นกดยอดเรโซแนนซ์ลง ×${(1 / wall.ampFactor).toFixed(1)})` : ''} · ภาพขยายเกินจริง
        </span></div>
      )}
      {lab && overlays.balloon && (
        <div className="legend"><span style={{ color: '#67e8f9' }}>
          ทิศทางเสียง: ลูกสูบในแผงกั้น (ประมาณ) · ka {'<'} 1 แทบรอบทิศ · ไม่รวมการเลี้ยวเบนของตู้
        </span></div>
      )}
    </div>
  );
}

export function IrPanel({ thermal, speedup, conf }: { thermal: { tvc: number; tmag: number; reRise: number; seconds: number }; speedup: number; conf: Conf }) {
  return (
    <div className="irbox irfloat">
      <h4><ConfDot conf={conf} /> ทดสอบความร้อน · จำลอง {(thermal.seconds / 60).toFixed(1)} นาที (เร่ง ×{speedup})</h4>
      <div className="grid">
        <span>วอยซ์คอยล์ {thermal.tvc.toFixed(0)} °C</span><span>แม่เหล็ก {thermal.tmag.toFixed(0)} °C</span>
        <span>Re ร้อน ×{thermal.reRise.toFixed(2)}</span><span>ดังลดลง {(20 * Math.log10(1 / thermal.reRise)).toFixed(1)} dB</span>
      </div>
      <div className="legend" style={{ fontFamily: 'var(--mono)', color: '#fdba74' }}><span>20°</span><span style={{ flex: 1, height: 6, borderRadius: 3, background: 'linear-gradient(90deg,#080414,#460a6e,#be1e46,#f57814,#fcd23c,#fffadc)' }} /><span>190°</span></div>
      <span style={{ fontSize: 11, color: '#fdba74' }}>ค่าความร้อนประมาณจากกำลังพิกัด (ไม่มีข้อมูลความร้อนใน datasheet)</span>
    </div>
  );
}

/** One message at a time, bottom centre; clears itself after a few seconds. */
export function ToastHost() {
  const { toast, dismissToast } = useApp();
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(dismissToast, toast.action ? 9000 : 5000);
    return () => window.clearTimeout(id);
  }, [toast, dismissToast]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.text}</span>
      {toast.action && <button onClick={() => { toast.action!.run(); dismissToast(); }}>{toast.action.label}</button>}
      <button className="x" aria-label="ปิด" onClick={dismissToast}>×</button>
    </div>
  );
}
