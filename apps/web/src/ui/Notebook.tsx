import { useEffect, useMemo, useRef, useState } from 'react';
import { calc, MAX_LENGTH } from '../sim/expr';
import { buildEntries, notebookVars, num, type Entry, type NotebookCtx } from '../sim/formulas';
import { useApp } from '../state/store';
import { ConfTag } from './Conf';

// ---- the user's own formulas (this browser only) ------------------------------------------------------

export interface UserFormula { id: string; name: string; expr: string }
const KEY = 'bassbuild.formulas.v1';
const MAX_FORMULAS = 30;
const MAX_NAME = 40;

export function readFormulas(): UserFormula[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((f): f is UserFormula => !!f && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.expr === 'string')
      .map((f) => ({ id: f.id, name: f.name.slice(0, MAX_NAME), expr: f.expr.slice(0, MAX_LENGTH) }))
      .slice(0, MAX_FORMULAS);
  } catch {
    return [];
  }
}

function writeFormulas(list: UserFormula[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const EXAMPLES: [string, string][] = [['อัตราส่วนตู้ต่อ Vas', 'Vb / Vas'], ['fc ตู้ปิด', 'Fs * sqrt(1 + N*Vas/Vb)'], ['ระยะชักเทียบ Xmax (%)', '100 * Xpk / Xmax']];

/**
 * Formula notebook: every number in the lab with its formula, the values put in and the source,
 * plus the user's own formulas over the same variables (own parser, never eval).
 */
export function Notebook({ ctx }: { ctx: NotebookCtx }) {
  const { notebook, closeNotebook, showToast } = useApp();
  const focus = notebook?.focus ?? null;
  const entries = useMemo(() => buildEntries(ctx), [ctx]);
  const vars = useMemo(() => notebookVars(ctx), [ctx]);
  const values = useMemo(() => Object.fromEntries(vars.map((v) => [v.name, v.value])), [vars]);
  const [query, setQuery] = useState('');
  const [mine, setMine] = useState<UserFormula[]>(readFormulas);
  const [name, setName] = useState('');
  const [expr, setExpr] = useState('');
  const [askDelete, setAskDelete] = useState<string | null>(null);
  const exprRef = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNotebook(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeNotebook]);
  // Opened from a number: bring its entry into view.
  useEffect(() => {
    const el = focus ? box.current?.querySelector(`[data-entry="${focus}"]`) : null;
    if (el) el.scrollIntoView({ block: 'center' });
    else box.current?.focus();
  }, [focus]);

  const q = query.trim().toLowerCase();
  const shown = q ? entries.filter((e) => `${e.title} ${e.formula} ${e.group}`.toLowerCase().includes(q)) : entries;
  const groups = [...new Set(shown.map((e) => e.group))];
  const preview = expr.trim() ? calc(expr, values) : null;

  const save = () => {
    if (!preview?.ok) return;
    if (mine.length >= MAX_FORMULAS) { showToast(`เก็บได้สูงสุด ${MAX_FORMULAS} สูตร ลบสูตรเก่าก่อน`); return; }
    const next = [...mine, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, MAX_NAME) || expr.trim(), expr: expr.trim() }];
    setMine(next);
    if (!writeFormulas(next)) showToast('บันทึกในเบราว์เซอร์นี้ไม่ได้ สูตรจะหายเมื่อปิดหน้า');
    setName('');
    setExpr('');
  };
  const remove = (id: string) => {
    const next = mine.filter((f) => f.id !== id);
    setMine(next);
    writeFormulas(next);
    setAskDelete(null);
  };
  const insert = (text: string) => {
    const el = exprRef.current;
    const at = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? at;
    const next = (expr.slice(0, at) + text + expr.slice(end)).slice(0, MAX_LENGTH);
    setExpr(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + text.length, at + text.length); });
  };

  return (
    <div className="modal-backdrop" onClick={closeNotebook}>
      <section className="notebook glass" role="dialog" aria-modal="true" aria-labelledby="nb-title" tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <header className="nb-head">
          <h3 id="nb-title">สมุดสูตร</h3>
          <input type="search" placeholder="ค้นสูตร เช่น F3, ท่อ, Qtc" aria-label="ค้นสูตร" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="x" aria-label="ปิดสมุดสูตร" onClick={closeNotebook}>×</button>
        </header>
        <p className="muted nb-intro">ทุกตัวเลขในแล็บมาจากสูตรเหล่านี้ด้วยค่าปัจจุบันของตู้ที่เปิดอยู่ · กดตัวเลขในแล็บเพื่อเปิดมาที่สูตรนั้น</p>

        <div className="nb-mine">
          <h4>สูตรของฉัน</h4>
          {mine.map((f) => {
            const r = calc(f.expr, values);
            return (
              <div key={f.id} className="nb-row">
                <span className="nb-name">{f.name}</span>
                <code>{f.expr}</code>
                <b className={r.ok ? undefined : 'nb-bad'}>{r.ok ? num(r.value, 5) : r.error}</b>
                {askDelete === f.id
                  ? <span className="nb-confirm">ลบสูตรนี้? <button className="danger" onClick={() => remove(f.id)}>ลบ</button><button onClick={() => setAskDelete(null)}>ยกเลิก</button></span>
                  : <button className="linkbtn" onClick={() => setAskDelete(f.id)}>ลบ</button>}
              </div>
            );
          })}
          <form className="nb-add" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input aria-label="ชื่อสูตร" placeholder="ชื่อ (ไม่ใส่ก็ได้)" maxLength={MAX_NAME} value={name} onChange={(e) => setName(e.target.value)} />
            <input ref={exprRef} aria-label="สูตร" className="mono" placeholder="เช่น Fs * sqrt(1 + Vas/Vb)" maxLength={MAX_LENGTH} value={expr}
              onChange={(e) => setExpr(e.target.value)} aria-invalid={!!preview && !preview.ok} aria-describedby="nb-preview" />
            <button type="submit" className="primary" disabled={!preview?.ok}>เก็บสูตร</button>
          </form>
          <div id="nb-preview" className={`nb-preview${preview && !preview.ok ? ' nb-bad' : ''}`} aria-live="polite">
            {preview ? (preview.ok ? `= ${num(preview.value, 6)}` : `${preview.error}${preview.pos > 0 ? ` (ตำแหน่งที่ ${preview.pos + 1})` : ''}`) : (
              <>ลอง: {EXAMPLES.map(([label, x]) => <button key={x} type="button" className="chipbtn" title={label} onClick={() => { setExpr(x); setName(label); }}>{x}</button>)}</>
            )}
          </div>
          <details className="nb-vars">
            <summary>ตัวแปรที่ใช้ได้ ({vars.length}) · ฟังก์ชัน sqrt log ln exp abs min max pow round sin cos · ค่าคงที่ pi e</summary>
            <div className="nb-varlist">
              {vars.map((v) => (
                <button key={v.name} type="button" className="chipbtn" title={`${v.desc} = ${num(v.value, 5)} ${v.unit}`} onClick={() => insert(v.name)}>
                  <b>{v.name}</b> {num(v.value, 4)}{v.unit ? ` ${v.unit}` : ''}
                </button>
              ))}
            </div>
          </details>
        </div>

        {groups.map((g) => (
          <div key={g} className="nb-group">
            <h4>{g}</h4>
            {shown.filter((e) => e.group === g).map((e) => <EntryCard key={e.id} e={e} focused={e.id === focus} />)}
          </div>
        ))}
        {!shown.length && <p className="muted">ไม่พบสูตรที่ตรงกับ “{query}”</p>}
      </section>
    </div>
  );
}

function EntryCard({ e, focused }: { e: Entry; focused: boolean }) {
  return (
    <article className={`nb-entry${focused ? ' focused' : ''}`} data-entry={e.id}>
      <div className="nb-entry-head">
        <span className="nb-title">{e.title}</span>
        <ConfTag conf={e.conf} />
        <b className="nb-value">{num(e.value, 4)}<small>{e.unit ? ` ${e.unit}` : ''}</small></b>
      </div>
      <code className="nb-formula">{e.formula}</code>
      <code className="nb-subst">{e.subst}</code>
      {e.note && <p className="nb-note">{e.note}</p>}
      <p className="nb-ref">อ้างอิง: {e.ref}</p>
    </article>
  );
}
