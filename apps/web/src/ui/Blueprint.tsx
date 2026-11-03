import { useMemo } from 'react';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from '../data/types';
import { blueprintDxf, blueprintFor, cutListCsv, partSvg, sheetSvg, type Blueprint, type Part } from '../sim/blueprint';
import type { BoxGeometry, Warning } from '../sim/model';
import { useApp, type BoxType, type Design } from '../state/store';
import { Icon } from './icons';

const TYPE_TH: Record<BoxType, string> = { sealed: 'ตู้ปิด', vented: 'ตู้เปิด', pr: 'ตู้ PR', bp4: 'แบนด์พาส 4', bp6: 'แบนด์พาส 6', isobaric: 'Isobaric' };
const mm = (m: number) => Math.round(m * 1000);

/** Saves text as a file in the browser's downloads. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** All board drawings in one SVG, three to a row, each at full scale (1 unit = 1 mm). */
function allPartsSvg(bp: Blueprint, title: string): string {
  const gap = 60, perRow = 3;
  const cells = bp.parts.map((p) => ({ p, w: p.w + 140, h: p.h + 140 + 60 }));
  const rows: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow));
  let y = 120;
  const body: string[] = [];
  let width = 0;
  for (const row of rows) {
    let x = 0;
    const h = Math.max(...row.map((c) => c.h));
    for (const c of row) {
      body.push(`<text x="${x + 70}" y="${y + 40}" font-size="36" font-weight="700">${esc(c.p.name)} × ${c.p.qty} · หนา ${Math.round(c.p.t)} มม.</text>`);
      body.push(partSvg(c.p).replace('<svg ', `<svg x="${x}" y="${y + 60}" width="${c.w}" height="${c.h - 60}" `));
      x += c.w + gap;
    }
    width = Math.max(width, x);
    y += h + gap;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${y}" width="${width}mm" height="${y}mm" font-family="'IBM Plex Sans Thai','Noto Sans Thai',sans-serif"><rect width="100%" height="100%" fill="#fff"/><text x="0" y="60" font-size="48" font-weight="700">${esc(title)}</text>${body.join('')}</svg>`;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function holesText(p: Part) {
  if (!p.holes.length) return '—';
  return p.holes.map((h) => (h.d ? `${h.label} Ø ${Math.round(h.d)}${h.blind ? ' (รูบอด)' : ''}` : `${h.label} ${Math.round(h.w!)} × ${Math.round(h.h!)}`)).join(' · ');
}

/**
 * Cutting and assembly drawings of the box in the lab: cut list, each board to scale, the boards
 * nested on stock sheets, materials and the build order. Prints (and saves as PDF) on white.
 */
export function BlueprintView({ d, geo, dto, material, damping, modelCode, warnings }: {
  d: Design; geo: BoxGeometry | null; dto: DriverDto | undefined; material: PanelMaterialDto | undefined; damping: DampingMaterialDto[];
  modelCode: string; warnings: Warning[];
}) {
  const setMode = useApp((s) => s.setMode);
  const bp = useMemo(() => (geo ? blueprintFor({ d, geo, dto, material, damping }) : null), [d, geo, dto, material, damping]);
  const blockers = warnings.filter((w) => w.build);
  const driverName = dto ? `${dto.brand} ${dto.model}` : '—';
  const title = `${modelCode} · ${TYPE_TH[d.boxType]}${geo?.shape === 'wedge' ? 'ทรงลิ่ม' : ''} · ${driverName}`;
  const file = modelCode.replace(/[^\w-]+/g, '_');
  const matName = material?.nameTh ?? material?.name ?? 'MDF';
  const net = d.boxType === 'bp4' || d.boxType === 'bp6' ? `${d.vbL} + ${d.vfL} L` : `${d.vbL} L`;

  return (
    <section className="library blueprint glass" aria-label="พิมพ์เขียว">
      <header className="lib-head" style={{ backgroundImage: 'url(/art/teaser-blueprint.webp)' }}>
        <div>
          <h2>พิมพ์เขียว</h2>
          <p>แบบตัดไม้จากตู้ในแล็บ: ขนาดทุกแผ่น รูเจาะ ผังวางบนแผ่นไม้ รายการวัสดุ และขั้นตอนประกอบ (หน่วยมิลลิเมตร)</p>
        </div>
        <div className="lib-actions bp-noprint">
          <button className="primary" onClick={() => window.print()} disabled={!bp} title="พิมพ์ หรือเลือก &quot;บันทึกเป็น PDF&quot; ในหน้าต่างพิมพ์">พิมพ์ / PDF</button>
          <button onClick={() => bp && download(`${file}-panels.svg`, allPartsSvg(bp, title), 'image/svg+xml')} disabled={!bp}>SVG</button>
          <button onClick={() => bp && download(`${file}-sheets.dxf`, blueprintDxf(bp), 'application/dxf')} disabled={!bp} title="ผังแผ่นไม้ทุกแผ่นพร้อมรูเจาะ สำหรับ CNC หรือโปรแกรม CAD">DXF</button>
          <button onClick={() => bp && download(`${file}-cutlist.csv`, cutListCsv(bp), 'text/csv')} disabled={!bp}>CSV</button>
          <button onClick={() => setMode('lab')}>กลับแล็บ</button>
        </div>
      </header>

      {!bp || !geo ? <div className="bp-body"><p className="muted">ยังไม่มีตู้ให้วาด (เลือกลำโพงที่มีค่า T/S ครบก่อน)</p></div> : (
        <div className="bp-body">
          <div className="bp-title">
            <h3>{title}</h3>
            <div className="bp-facts">
              <span>ขนาดภายนอก <b>{mm(geo.wx)} × {mm(geo.hx)} × {mm(geo.dx)}</b>{geo.shape === 'wedge' ? <> (บนลึก <b>{mm(geo.dxTop)}</b>)</> : null}</span>
              {/* Inside sizes too: a plan gives them, and the builder checks the cut box against it. */}
              <span>ขนาดภายใน <b>{mm(geo.wi)} × {mm(geo.hi)} × {mm(geo.di)}</b>{geo.shape === 'wedge' ? <> (บนลึก <b>{mm(geo.diTop)}</b>)</> : null}</span>
              <span>ปริมาตรสุทธิ <b>{net}</b></span>
              {d.boxType !== 'sealed' && d.boxType !== 'isobaric' && d.boxType !== 'pr' && <span>จูน <b>{d.fbHz}{d.boxType === 'bp6' ? ` / ${d.fb2Hz}` : ''} Hz</b></span>}
              <span>{matName} <b>{d.thicknessMm} มม.</b> · <b>{bp.sheets.length}</b> แผ่น</span>
              <span>ตู้เปล่าราว <b>{geo.weightKg.toFixed(0)} กก.</b></span>
            </div>
          </div>

          {blockers.length > 0 && (
            <div className="build-block" role="alert">
              <b><Icon name="alert" size={15} width={2} />ตู้นี้ยังสร้างจริงไม่ได้ แบบด้านล่างยังใช้ตัดไม้ไม่ได้</b>
              <ul>{blockers.map((w) => <li key={w.text}>{w.text}</li>)}</ul>
              <button type="button" className="bp-noprint" onClick={() => setMode('lab')}>กลับไปแก้ในแล็บ</button>
            </div>
          )}

          <h4>1 · รายการตัด</h4>
          <table className="bp-table">
            <thead><tr><th>ชิ้น</th><th>จำนวน</th><th>กว้าง × ยาว</th><th>หนา</th><th>รูเจาะ</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
              {bp.parts.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td className="num">{p.qty}</td>
                  <td className="num">{Math.round(p.w)} × {Math.round(p.h)}</td><td className="num">{Math.round(p.t)}</td>
                  <td>{holesText(p)}</td>
                  <td>{[...p.bevels.map((b) => `${b.edge === 'top' ? 'ขอบบน' : 'ขอบล่าง'}ตัดเอียง ${b.deg}°`), p.note].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
              {bp.dowels && (
                <tr>
                  <td>เดือยไม้กลม (ตัดจากไม้กลม ไม่อยู่ในผังแผ่น)</td><td className="num">{bp.dowels.qty}</td>
                  <td className="num">Ø {Math.round(bp.dowels.d)} × {bp.dowels.length}</td><td className="num">—</td>
                  <td>—</td><td>{bp.dowels.note}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="bp-note">ประกอบแบบชนตรง: พื้นและฝาบนเต็มขนาดตู้ ผนังข้างอยู่ระหว่างพื้นกับฝา แผงหน้าและผนังหลังอยู่ระหว่างผนังข้าง · ขนาดรูวัดจากขอบซ้ายและขอบล่างของแผ่นเมื่อมองจากด้านนอก</p>

          <h4>2 · แบบแต่ละแผ่น</h4>
          <div className="bp-parts">
            {bp.parts.map((p) => (
              <figure key={p.id} className="bp-card">
                <figcaption>{p.name} × {p.qty} <span>{Math.round(p.w)} × {Math.round(p.h)} × {Math.round(p.t)} มม.</span></figcaption>
                <div className="bp-svg" dangerouslySetInnerHTML={{ __html: partSvg(p) }} />
              </figure>
            ))}
          </div>

          <h4>3 · ผังวางบนแผ่นไม้ ({bp.sheets.length} แผ่น · เศษราว {Math.round(bp.totals.waste * 100)}%)</h4>
          {bp.oversize.length > 0 && <p className="bp-warn">{bp.oversize.join(', ')} ยาวเกินแผ่นไม้ ต้องต่อสองชิ้นหรือสั่งแผ่นใหญ่ (ไม่ได้วางในผัง)</p>}
          <div className="bp-sheets">
            {bp.sheets.map((s, i) => (
              <figure key={i} className="bp-card sheet">
                <figcaption>แผ่นที่ {i + 1} <span>{s.w} × {s.h} มม. · ใช้ {Math.round((s.usedM2 / ((s.w * s.h) / 1e6)) * 100)}%</span></figcaption>
                <div className="bp-svg" dangerouslySetInnerHTML={{ __html: sheetSvg(s, bp.parts) }} />
              </figure>
            ))}
          </div>
          <p className="bp-note">เผื่อรอยเลื่อย 3 มม. และตัดขอบแผ่นโรงงานทิ้ง 5 มม. · ผนังข้างทรงคางหมูตัดจากแผ่นสี่เหลี่ยมตามเส้นประ</p>

          <h4>4 · รายการวัสดุ</h4>
          <table className="bp-table">
            <thead><tr><th>รายการ</th><th>จำนวน</th><th>หมายเหตุ</th></tr></thead>
            <tbody>{bp.bom.map((b) => <tr key={b.item}><td>{b.item}</td><td className="num">{b.qty}</td><td>{b.note ?? '—'}</td></tr>)}</tbody>
          </table>

          <h4>5 · ขั้นตอนประกอบ</h4>
          <ol className="bp-steps">{bp.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="bp-note">สร้างโดย BASS BUILD v{__APP_VERSION__} · {new Date().toLocaleDateString('th-TH')} · ตรวจขนาดรูกับลำโพงจริงทุกครั้งก่อนเจาะ</p>
        </div>
      )}
    </section>
  );
}
