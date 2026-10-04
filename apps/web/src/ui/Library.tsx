import { useEffect, useMemo, useRef, useState } from 'react';
import { blankDriver, parseCsv, parseNumber, parseWdr, toCsv, type DriverDraft } from '../data/importers';
import { DERIVABLE, deleteDriver, derive, isEditable, MISSING_TH, saveDriver, suitability, validateDraft } from '../data/library';
import type { DriverDto } from '../data/types';
import { useApp } from '../state/store';
import { Icon } from './icons';

const CATS: [string, string][] = [['all', 'ทั้งหมด'], ['sub', 'ซับวูฟเฟอร์'], ['pa', 'PA / รถแห่'], ['woofer', 'วูฟเฟอร์'], ['fullrange', 'ฟูลเรนจ์'], ['mid', 'เสียงกลาง']];
const CAT_TH: Record<string, string> = { sub: 'ซับวูฟเฟอร์', pa: 'PA / รถแห่', woofer: 'วูฟเฟอร์', fullrange: 'ฟูลเรนจ์', mid: 'เสียงกลาง', tweeter: 'ทวีตเตอร์' };
const SIZES: [string, string, number, number][] = [['all', 'ทุกขนาด', 0, 99], ['s', '≤ 6.5"', 0, 6.5], ['m', '8–10"', 7, 10.9], ['l', '12–15"', 11, 15.9], ['xl', '18" ขึ้นไป', 16, 99]];
const SOURCES: [string, string][] = [['all', 'ทุกแหล่ง'], ['datasheet', 'จาก datasheet'], ['mine', 'ของฉัน'], ['sample', 'ตัวอย่าง']];
const KIND_LABEL: Record<string, string> = { datasheet: 'datasheet', measured: 'วัดเอง', user: 'ผู้ใช้กรอก', estimated: 'ประมาณ', sample: 'ตัวอย่าง' };

const fmt = (v: number | null | undefined, digits = 2) => (v == null ? '—' : Number(v.toFixed(digits)).toString());
const sameName = (a: { brand: string; model: string }, b: { brand: string; model: string }) =>
  a.brand.trim().toLowerCase() === b.brand.trim().toLowerCase() && a.model.trim().toLowerCase() === b.model.trim().toLowerCase();

type Editing = { draft: DriverDraft; id: number | null; title: string };

export function LibraryView() {
  const { drivers, driverId, driversSource, selectDriver, setMode, showToast, upsertDriver, removeDriver } = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [size, setSize] = useState('all');
  const [src, setSrc] = useState('all');
  const [sel, setSel] = useState<number | null>(driverId);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DriverDto | null>(null);

  const list = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const [, , lo, hi] = SIZES.find((s) => s[0] === size)!;
    return drivers
      .filter((d) => cat === 'all' || d.category === cat)
      .filter((d) => size === 'all' || (d.sizeIn !== null && d.sizeIn >= lo && d.sizeIn <= hi))
      .filter((d) => src === 'all' || (src === 'mine' ? isEditable(d, driversSource) : src === 'sample' ? d.sourceKind === 'sample' : d.sourceKind === src))
      .filter((d) => words.every((w) => `${d.brand} ${d.model} ${d.kindTh ?? ''} ${d.sizeIn ?? ''}"`.toLowerCase().includes(w)))
      .sort((a, b) => (a.sourceKind === 'sample' ? 1 : 0) - (b.sourceKind === 'sample' ? 1 : 0) || a.brand.localeCompare(b.brand) || (a.sizeIn ?? 0) - (b.sizeIn ?? 0) || a.model.localeCompare(b.model));
  }, [drivers, q, cat, size, src, driversSource]);

  const current = drivers.find((d) => d.id === sel) ?? list[0] ?? null;
  const mine = drivers.filter((d) => isEditable(d, driversSource));

  const useInLab = (d: DriverDto) => {
    selectDriver(d.id);
    setMode('lab');
    showToast(`ใช้ ${d.brand} ${d.model} ในแล็บแล้ว · กด "จัดตู้แนะนำ" เพื่อได้ตู้ที่เหมาะกับลำโพงนี้`);
  };
  const exportCsv = () => {
    const blob = new Blob([toCsv(mine)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bassbuild-drivers.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const doDelete = async (d: DriverDto) => {
    setConfirmDelete(null);
    if (!(await deleteDriver(d.id, driversSource))) { showToast('ลบไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
    removeDriver(d.id);
    setSel(null);
    showToast(`ลบ ${d.brand} ${d.model} แล้ว`);
  };

  return (
    <section className="library glass" aria-label="คลังลำโพง">
      <header className="lib-head" style={{ backgroundImage: 'url(/art/teaser-library.webp)' }}>
        <div>
          <h2>คลังลำโพง</h2>
          <p>{drivers.filter((d) => d.sourceKind === 'datasheet').length} รุ่นจาก datasheet ของผู้ผลิต · ของคุณ {mine.length} รุ่น{driversSource === 'server' ? ' (เก็บในฐานข้อมูล)' : ' (เก็บในเบราว์เซอร์นี้)'}</p>
        </div>
        <div className="lib-actions">
          <button className="primary" onClick={() => setEditing({ draft: blankDriver(), id: null, title: 'เพิ่มลำโพง' })}><Icon name="box" size={15} width={2} />เพิ่มลำโพง</button>
          <button onClick={() => setImporting(true)}>นำเข้า .wdr / CSV</button>
          <button onClick={exportCsv} disabled={!mine.length} title={mine.length ? 'ส่งออกลำโพงของคุณเป็น CSV' : 'ยังไม่มีลำโพงของคุณ'}>ส่งออก CSV</button>
        </div>
      </header>

      <div className="lib-body">
        <div className="lib-list">
          <input className="lib-search" type="search" placeholder="ค้นหา ยี่ห้อ รุ่น ขนาด…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาลำโพง" />
          <div className="chips" role="group" aria-label="ประเภท">
            {CATS.map(([k, label]) => <button key={k} aria-pressed={cat === k} onClick={() => setCat(k)}>{label}</button>)}
          </div>
          <div className="pair">
            <select aria-label="ขนาด" value={size} onChange={(e) => setSize(e.target.value)}>{SIZES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
            <select aria-label="แหล่งข้อมูล" value={src} onChange={(e) => setSrc(e.target.value)}>{SOURCES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
            <span className="muted count">{list.length} รุ่น</span>
          </div>
          <ul className="lib-rows">
            {list.map((d) => {
              const flags = derive(d).checks.filter((c) => !c.ok).length;
              return (
                <li key={d.id}>
                  <button aria-pressed={current?.id === d.id} onClick={() => {
                    setSel(d.id);
                    // On a phone the details sit under the list: bring them into view.
                    if (window.innerWidth <= 760) requestAnimationFrame(() => document.querySelector('.lib-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                  }}>
                    <span className="name"><b>{d.brand}</b> {d.model}{d.id === driverId && <span className="inlab">ในแล็บ</span>}</span>
                    <span className="meta">{d.sizeIn ? `${d.sizeIn}"` : '—'} · {CAT_TH[d.category] ?? d.category} · Fs {fmt(d.fs, 1)} · Qts {fmt(d.qts)} · {d.peW ? `${d.peW} W` : '—'}</span>
                    <span className="tags">
                      <span className={`tag ${d.sourceKind}`}>{isEditable(d, driversSource) ? 'ของฉัน' : KIND_LABEL[d.sourceKind] ?? d.sourceKind}</span>
                      {flags > 0 && <span className="tag warn" title="ค่า T/S ใน datasheet ขัดกันเอง">ค่าขัดกัน</span>}
                    </span>
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="empty">ไม่พบลำโพงที่ตรงเงื่อนไข</li>}
          </ul>
        </div>

        {current ? (
          <DriverDetail d={current} editable={isEditable(current, driversSource)} inLab={current.id === driverId}
            onUse={() => useInLab(current)}
            onCopy={() => setEditing({ draft: { ...current, sourceKind: 'user', verified: false, model: `${current.model} (แก้)` }, id: null, title: 'ทำสำเนาเพื่อแก้' })}
            onEdit={() => setEditing({ draft: { ...current }, id: current.id, title: 'แก้ไขลำโพง' })}
            onDelete={() => setConfirmDelete(current)} />
        ) : <div className="lib-detail empty">เลือกลำโพงทางซ้ายเพื่อดูสเปก</div>}
      </div>

      {editing && (
        <DriverEditor editing={editing} others={drivers} onClose={() => setEditing(null)}
          onSaved={(d) => { upsertDriver(d); setSel(d.id); setEditing(null); showToast(`บันทึก ${d.brand} ${d.model} แล้ว`); }} />
      )}
      {importing && <ImportDialog existing={drivers} onClose={() => setImporting(false)} onDone={(saved) => { saved.forEach(upsertDriver); if (saved[0]) setSel(saved[0].id); setImporting(false); }} />}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="confirm glass" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="del-title">ลบ {confirmDelete.brand} {confirmDelete.model}?</h3>
            <p>ลบแล้วกู้คืนไม่ได้ ถ้าลำโพงนี้เปิดอยู่ในแล็บ แล็บจะเปลี่ยนไปใช้ลำโพงตัวแรกในคลัง</p>
            <div className="row"><button className="danger" onClick={() => doDelete(confirmDelete)}>ลบ</button><button autoFocus onClick={() => setConfirmDelete(null)}>ยกเลิก</button></div>
          </div>
        </div>
      )}
    </section>
  );
}

function DriverDetail({ d, editable, inLab, onUse, onCopy, onEdit, onDelete }: {
  d: DriverDto; editable: boolean; inLab: boolean; onUse: () => void; onCopy: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const der = useMemo(() => derive(d), [d]);
  const fit = suitability(der.ebp, der.values.qts?.v ?? null);
  const bad = der.checks.filter((c) => !c.ok);
  const row = (label: string, v: number | null | undefined, unit: string, digits = 2) => <div><span>{label}</span><b>{fmt(v, digits)}{v != null && unit ? ` ${unit}` : ''}</b></div>;
  return (
    <div className="lib-detail">
      <div className="det-head">
        <div>
          <div className="muted">{d.brand}</div>
          <h3>{d.model}</h3>
          <div className="muted">{d.kindTh ?? CAT_TH[d.category]} · {d.sizeIn ? `${d.sizeIn} นิ้ว` : 'ไม่ระบุขนาด'} · {d.zNom ? `${d.zNom} Ω` : ''} {d.coil ?? ''}</div>
        </div>
        <div className="det-actions">
          <button className="primary" onClick={onUse} disabled={inLab}>{inLab ? 'ใช้อยู่ในแล็บ' : 'ใช้ในแล็บ'}</button>
          {editable ? <><button onClick={onEdit}>แก้ไข</button><button className="danger-ghost" onClick={onDelete}>ลบ</button></> : <button onClick={onCopy}>ทำสำเนาเพื่อแก้</button>}
        </div>
      </div>

      {fit && <div className={`fit ${fit.tone}`}>{fit.text}{der.spl1w ? ` · ความไวคำนวณ ${der.spl1w.toFixed(1)} dB 1W/1m` : ''}</div>}

      <div className="det-section">ค่า Thiele/Small <span className="muted">· ค่าสีจางคำนวณจากค่าอื่น</span></div>
      <div className="det-grid">
        {DERIVABLE.map((x) => {
          const v = der.values[x.field];
          return <div key={x.field} className={v?.derived ? 'derived' : undefined} title={v?.derived ? 'คำนวณจากค่าอื่น (ไม่มีใน datasheet)' : undefined}><span>{x.label}</span><b>{fmt(v?.v, x.digits)}{v ? ` ${x.unit}` : ''}</b></div>;
        })}
        {row('Le', d.leMh, 'mH')}
      </div>
      {der.missing.length > 0 && <div className="warn" style={{ color: '#f0abfc', background: '#f0abfc14', border: '1px solid #f0abfc55' }}><Icon name="alert" size={15} width={2} /><span>ข้อมูลไม่พอคำนวณ ขาด {der.missing.map((m) => MISSING_TH[m] ?? m).join(', ')}</span></div>}
      {bad.map((c) => (
        <div key={c.id} className="warn" style={{ color: '#fcd34d', background: '#fcd34d14', border: '1px solid #fcd34d55' }}>
          <Icon name="alert" size={15} width={2} /><span>ค่าใน datasheet ขัดกันเอง: {c.id.toUpperCase()} ที่ให้มา {fmt(c.id === 'vas' ? c.stored * 1000 : c.stored, 3)} แต่คำนวณจากค่าอื่นได้ {fmt(c.id === 'vas' ? c.computed * 1000 : c.computed, 3)}{c.id === 'vas' ? ' L' : ''}</span>
        </div>
      ))}

      <div className="det-section">กำลังและระยะชัก</div>
      <div className="det-grid">
        {row('Xmax', d.xmaxMm, 'มม.', 1)}{row('Xmech', d.xmechMm, 'มม.', 1)}{row('Pe', d.peW, 'W', 0)}{row('ความไว', d.splDb, 'dB', 1)}
      </div>
      <div className="det-section">มิติติดตั้ง</div>
      <div className="det-grid">
        {row('รูเจาะ', d.cutoutMm, 'มม.', 0)}{row('ขอบนอก', d.outerMm, 'มม.', 0)}{row('ความลึก', d.depthMm, 'มม.', 0)}{row('ปริมาตรแทนที่', d.displacementL, 'L', 2)}
      </div>

      <div className="det-source">
        <span className={`tag ${d.sourceKind}`}>{editable ? 'ของฉัน' : KIND_LABEL[d.sourceKind] ?? d.sourceKind}</span>
        {d.sourceUrl && /^https?:\/\//i.test(d.sourceUrl) ? <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">ดูที่มาของข้อมูล ↗</a> : <span className="muted">ไม่มีลิงก์ที่มา</span>}
        {d.notes && <p className="muted">{d.notes}</p>}
      </div>
    </div>
  );
}

// ---- editor ----------------------------------------------------------------------------------------

type FieldDef = [keyof DriverDraft, string, string];
const GROUPS: [string, FieldDef[]][] = [
  ['Thiele/Small', [['fs', 'Fs *', 'Hz'], ['qts', 'Qts', ''], ['qes', 'Qes', ''], ['qms', 'Qms', ''], ['vasL', 'Vas', 'L'], ['re', 'Re', 'Ω'], ['leMh', 'Le', 'mH'], ['bl', 'Bl', 'T·m'], ['mmsG', 'Mms', 'g'], ['cmsMmPerN', 'Cms', 'mm/N'], ['rms', 'Rms', 'kg/s'], ['sdCm2', 'Sd', 'cm²']]],
  ['กำลังและระยะชัก', [['xmaxMm', 'Xmax', 'มม.'], ['xmechMm', 'Xmech', 'มม.'], ['peW', 'Pe', 'W'], ['splDb', 'ความไว', 'dB']]],
  ['มิติติดตั้ง', [['cutoutMm', 'รูเจาะ', 'มม.'], ['outerMm', 'ขอบนอก', 'มม.'], ['depthMm', 'ความลึก', 'มม.'], ['displacementL', 'ปริมาตรแทนที่', 'L']]]
];

const NUMERIC = new Set<string>(['sizeIn', 'zNom', ...GROUPS.flatMap(([, f]) => f.map(([k]) => k))]);
const TEXT = ['brand', 'model', 'category', 'coil', 'coilWiring', 'sourceKind', 'sourceUrl', 'notes'];

function DriverEditor({ editing, others, onClose, onSaved }: { editing: Editing; others: DriverDto[]; onClose: () => void; onSaved: (d: DriverDto) => void }) {
  const { driversSource } = useApp();
  // What is in every box as typed, so "0," can be on its way to "0,39".
  const [text, setText] = useState<Record<string, string>>(() => {
    const src = editing.draft as Record<string, unknown>;
    return Object.fromEntries([...NUMERIC, ...TEXT].map((k) => [k, src[k] == null ? '' : String(src[k])]));
  });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const initial = useRef(JSON.stringify(text));

  const draft: DriverDraft = useMemo(() => {
    const { id: _id, ...base } = editing.draft as DriverDraft & { id?: number };
    const d = { ...base } as Record<string, unknown>;
    for (const [k, v] of Object.entries(text)) d[k] = NUMERIC.has(k) ? parseNumber(v) : v;
    // Only a dual-coil driver has a coil wiring, and only the two values the physics knows.
    d.coilWiring = d.coil === 'DVC' && (text.coilWiring === 'series' || text.coilWiring === 'parallel') ? text.coilWiring : null;
    // A new category means the old Thai kind label no longer fits.
    if (d.category !== editing.draft.category || !d.kindTh) d.kindTh = CAT_TH[d.category as string] ?? null;
    return { ...(d as DriverDraft), fs: parseNumber(text.fs) ?? 0 };
  }, [text, editing.draft]);
  const der = useMemo(() => derive(draft), [draft]);
  const dirty = JSON.stringify(text) !== initial.current;

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') (dirty ? setAskDiscard(true) : onClose()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setText((t) => ({ ...t, [k]: e.target.value })); setError(null); };
  const save = async () => {
    if (saving) return;
    const clean: DriverDraft = { ...draft, brand: draft.brand.trim(), model: draft.model.trim(), sourceUrl: (draft.sourceUrl ?? '').trim() || null, notes: (draft.notes ?? '').trim() || null };
    const v = validateDraft(clean, others, editing.id);
    if (v) { setError(v); return; }
    if (clean.sourceUrl && !/^https?:\/\//i.test(clean.sourceUrl)) { setError({ field: 'sourceUrl', message: 'ลิงก์ที่มาต้องขึ้นต้นด้วย http:// หรือ https://' }); return; }
    setSaving(true);
    const r = await saveDriver(clean, editing.id, driversSource);
    setSaving(false);
    if (r.ok) onSaved(r.driver); else setError({ field: r.field, message: r.message });
  };

  const input = (k: keyof DriverDraft, label: string, unit: string, ref?: React.Ref<HTMLInputElement>) => {
    const derived = der.values[k];
    const placeholder = derived?.derived ? `คำนวณได้ ${fmt(derived.v, 3)}` : '';
    return (
      <label key={k} className={`ed-field${error?.field === k ? ' bad' : ''}`}>
        <span>{label}{unit && <em>{unit}</em>}</span>
        <input ref={ref} inputMode="decimal" value={text[k] ?? ''} placeholder={placeholder} onChange={set(k)} aria-invalid={error?.field === k} />
      </label>
    );
  };

  return (
    <div className="modal-backdrop" onClick={() => (dirty ? setAskDiscard(true) : onClose())}>
      <form className="editor glass" role="dialog" aria-modal="true" aria-labelledby="ed-title" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h3 id="ed-title">{editing.title}</h3>
        <div className="ed-grid">
          <label className={`ed-field wide${error?.field === 'brand' ? ' bad' : ''}`}><span>ยี่ห้อ *</span><input ref={first} value={text.brand ?? ''} onChange={set('brand')} /></label>
          <label className={`ed-field wide${error?.field === 'model' ? ' bad' : ''}`}><span>รุ่น *</span><input value={text.model ?? ''} onChange={set('model')} /></label>
          <label className="ed-field"><span>ประเภท</span><select value={text.category} onChange={set('category')}>{CATS.slice(1).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          {input('sizeIn', 'ขนาด', 'นิ้ว')}
          {input('zNom', 'อิมพีแดนซ์', 'Ω')}
          <label className="ed-field"><span>วอยซ์คอยล์</span><select value={text.coil || 'SVC'} onChange={set('coil')}><option value="SVC">ขดเดียว (SVC)</option><option value="DVC">ขดคู่ (DVC)</option></select></label>
          {text.coil === 'DVC' && (
            <label className="ed-field" title="ค่า Re, Le, Bl และอิมพีแดนซ์ในฟอร์มนี้เป็นของการต่อคอยล์แบบไหน (ดูใน datasheet)">
              <span>ค่า T/S วัดตอนต่อคอยล์</span>
              <select value={text.coilWiring || ''} onChange={set('coilWiring')}><option value="">ไม่ระบุ (เดาจากอิมพีแดนซ์)</option><option value="series">อนุกรม</option><option value="parallel">ขนาน</option></select>
            </label>
          )}
        </div>
        {GROUPS.map(([title, fields]) => (
          <fieldset key={title}><legend>{title}</legend><div className="ed-grid">{fields.map(([k, label, unit]) => input(k, label, unit))}</div></fieldset>
        ))}
        <fieldset><legend>ที่มา</legend>
          <div className="ed-grid">
            <label className="ed-field"><span>แหล่งข้อมูล</span><select value={text.sourceKind} onChange={set('sourceKind')}><option value="datasheet">datasheet</option><option value="measured">วัดเอง</option><option value="user">กรอกเอง</option><option value="estimated">ประมาณ</option></select></label>
            <label className={`ed-field wide${error?.field === 'sourceUrl' ? ' bad' : ''}`}><span>ลิงก์ที่มา</span><input value={text.sourceUrl ?? ''} placeholder="https://…" onChange={set('sourceUrl')} /></label>
            <label className="ed-field full"><span>หมายเหตุ</span><input value={text.notes ?? ''} onChange={set('notes')} /></label>
          </div>
        </fieldset>

        <div className="ed-status">
          {der.missing.length
            ? <span className="no">ยังคำนวณไม่ได้ ต้องการเพิ่ม: {der.missing.map((m) => MISSING_TH[m] ?? m).join(', ')} (ปกติแค่ Fs, Qts/Qes, Vas, Re, Sd ก็พอ)</span>
            : <span className="ok">พอคำนวณแล้ว · ค่าที่เว้นว่างระบบคำนวณให้ (ดูตัวเลขจางในช่อง)</span>}
          {der.checks.filter((c) => !c.ok).map((c) => <span key={c.id} className="no">ค่า {c.id.toUpperCase()} ไม่ตรงกับที่คำนวณจากค่าอื่น ({fmt(c.id === 'vas' ? c.stored * 1000 : c.stored, 3)} กับ {fmt(c.id === 'vas' ? c.computed * 1000 : c.computed, 3)}) ตรวจอีกครั้ง</span>)}
        </div>
        {error && <div className="ed-error" role="alert">{error.message}</div>}
        {askDiscard ? (
          <div className="row"><span className="muted">ทิ้งสิ่งที่แก้ไว้?</span><button type="button" className="danger" onClick={onClose}>ทิ้ง</button><button type="button" onClick={() => setAskDiscard(false)}>แก้ต่อ</button></div>
        ) : (
          <div className="row"><button type="submit" className="primary" disabled={saving}>{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button><button type="button" onClick={() => (dirty ? setAskDiscard(true) : onClose())}>ยกเลิก</button></div>
        )}
      </form>
    </div>
  );
}

// ---- import ------------------------------------------------------------------------------------------

function ImportDialog({ existing, onClose, onDone }: { existing: DriverDto[]; onClose: () => void; onDone: (saved: DriverDto[]) => void }) {
  const { driversSource, showToast } = useApp();
  const [items, setItems] = useState<{ d: DriverDraft; on: boolean; dup: boolean }[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    const found: DriverDraft[] = [];
    const warn: string[] = [];
    for (const f of [...files]) {
      if (f.size > 2_000_000) { warn.push(`${f.name}: ไฟล์ใหญ่เกิน 2 MB ข้าม`); continue; }
      const text = await f.text();
      const r = /\.wdr$/i.test(f.name) ? parseWdr(text, f.name) : parseCsv(text);
      found.push(...r.drivers);
      warn.push(...r.warnings.map((w) => (/\.wdr$/i.test(f.name) ? w : `${f.name}: ${w}`)));
    }
    if (!found.length && !warn.length) warn.push('ไม่พบข้อมูลลำโพงในไฟล์');
    setItems(found.map((d) => {
      const dup = existing.some((e) => sameName(e, d)) || found.filter((x) => sameName(x, d)).length > 1;
      return { d, dup, on: !dup };
    }));
    setWarnings(warn);
  };

  const go = async () => {
    setBusy(true);
    const saved: DriverDto[] = [];
    const failed: string[] = [];
    for (const it of items.filter((i) => i.on)) {
      const r = await saveDriver(it.d, null, driversSource);
      if (r.ok) saved.push(r.driver); else failed.push(`${it.d.brand} ${it.d.model}: ${r.message}`);
    }
    setBusy(false);
    showToast(`นำเข้า ${saved.length} รุ่น${failed.length ? ` · ไม่สำเร็จ ${failed.length} รุ่น` : ''}`);
    if (failed.length) setWarnings(failed);
    onDone(saved);
  };

  const chosen = items.filter((i) => i.on).length;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="importer glass" role="dialog" aria-modal="true" aria-labelledby="imp-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="imp-title">นำเข้าลำโพง</h3>
        <p className="muted">ไฟล์ WinISD (.wdr) หรือ CSV ที่มีหัวตาราง เช่น brand, model, fs, qts, qes, qms, vas (ลิตร), re, sd (ซม.²), xmax (มม.), pe · เลือกได้หลายไฟล์</p>
        <input type="file" accept=".wdr,.csv,.txt" multiple onChange={(e) => void read(e.target.files)} aria-label="เลือกไฟล์ลำโพง" />
        {warnings.length > 0 && <ul className="imp-warn">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        {items.length > 0 && (
          <ul className="imp-list">
            {items.map((it, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={it.on} onChange={() => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
                  <b>{it.d.brand}</b> {it.d.model} <span className="muted">· Fs {fmt(it.d.fs, 1)} · Qts {fmt(it.d.qts)} · Vas {fmt(it.d.vasL, 1)} L</span>
                  {it.dup && <span className="tag warn">มีชื่อนี้อยู่แล้ว</span>}
                  {derive(it.d).missing.length > 0 && <span className="tag warn">ข้อมูลไม่พอคำนวณ</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="primary" disabled={!chosen || busy} onClick={() => void go()}>{busy ? 'กำลังนำเข้า…' : `นำเข้า ${chosen} รุ่น`}</button>
          <button onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  );
}
