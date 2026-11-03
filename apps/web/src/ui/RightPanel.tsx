import type { Driver } from '@bassbuild/physics';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { DriverDto } from '../data/types';
import { buildableChoices, limitsFor, nearestBuildable, type BuildCtx, type FieldLimit, type LimitedField } from '../sim/buildable';
import { braceCountOf, DOWEL_D, MAX_BRACES, rowProblem, rowRange } from '../sim/layout';
import { TUBES, tubeOf } from '../data/hardware';
import { ampLimits, AWG_MM2, BRACE_TH, fmtOhms, frontAreaKey, isDvc, isFill, MAX_TUBES, measuredWiring, RANGES, roundTubes, SUBSONIC_HZ, SUGGEST_FLAG_TEXT, suggestDesign, wallDamping, wireOhms, panelModes, type BoxGeometry, type Warning } from '../sim/model';
import { useApp, type BoxType, type BraceKind, type Design } from '../state/store';
import type { Finish } from '../viewport/finishes';
import { Icon } from './icons';
import { NumField } from './NumField';
import { ShapeSection } from './ShapeSection';

const GROUPS: [string, string][] = [['sub', 'ซับวูฟเฟอร์'], ['pa', 'PA / รถแห่'], ['woofer', 'วูฟเฟอร์'], ['fullrange', 'ฟูลเรนจ์'], ['mid', 'เสียงกลาง'], ['other', 'อื่น ๆ'], ['sample', 'ตัวอย่าง (ไม่ใช่สินค้าจริง)']];
const TYPES: [BoxType, string][] = [['sealed', 'ตู้ปิด'], ['vented', 'ตู้เปิด'], ['pr', 'PR'], ['bp4', 'BP4'], ['bp6', 'BP6'], ['isobaric', 'Isobaric']];
const BRACES: [BraceKind, string, string][] = [
  ['none', 'ไม่มี', 'ไม่มีโครงค้ำ ผนังข้างสั่นได้ทั้งแผ่น'],
  ['window', 'แบบหน้าต่าง', 'แผ่นเจาะช่องกลาง ขอบ 5 ซม. ยึดผนังข้างทั้งสองและฝาบน'],
  ['dowel', 'เดือย', `ไม้กลม Ø ${DOWEL_D * 1000} มม. ข้างถึงข้าง ยึดเฉพาะผนังข้าง ใช้ที่น้อยกว่า`]
];
const FINISHES: [Finish, string][] = [['walnut', 'วีเนียร์วอลนัท'], ['oak', 'วีเนียร์โอ๊ก'], ['teak', 'วีเนียร์สัก'], ['black', 'ทำสีดำซาติน'], ['raw', 'ผิววัสดุจริง']];

/** The parts of a slider's range outside its buildable stretches. */
function gaps(ok: [number, number][], [lo, hi]: readonly [number, number]): [number, number][] {
  const out: [number, number][] = [];
  let from = lo;
  for (const [a, b] of ok) { if (a > from) out.push([from, a]); from = b; }
  if (from < hi) out.push([from, hi]);
  return out;
}

/**
 * A slider that will not go where the box can no longer be built: it stops at the edge of the
 * buildable stretch it is in, says why, and marks the unbuildable parts of its track in red.
 * When the design is already unbuildable (another setting changed) it moves freely.
 */
function Slider({ id, label, value, range, step = 1, fmt, onChange, limit }: {
  id: string; label: string; value: number; range: readonly [number, number]; step?: number; fmt: (v: number) => string; onChange: (v: number) => void;
  limit?: FieldLimit | null;
}) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 5000);
    return () => window.clearTimeout(t);
  }, [note]);
  const span = range[1] - range[0];
  const bad = limit ? gaps(limit.ok, range) : [];
  const change = (raw: number) => {
    let v = raw;
    const a = limit?.around;
    if (a && v < a[0]) { v = a[0]; setNote(limit!.belowWhy); }
    else if (a && v > a[1]) { v = a[1]; setNote(limit!.aboveWhy); }
    if (v !== value) onChange(v);
  };
  return (
    <div className="field">
      <div className="field-head"><label htmlFor={id}>{label}</label><output htmlFor={id}>{fmt(value)}</output></div>
      <input id={id} type="range" min={range[0]} max={range[1]} step={step} value={value} onChange={(e) => change(Number(e.target.value))}
        aria-describedby={note ? `${id}-note` : undefined} />
      {bad.length > 0 && (
        <div className="zones" title="ช่วงสีแดง = สร้างตู้จริงไม่ได้ (ท่อหรือลำโพงชนกัน)">
          {bad.map(([x0, x1]) => <i key={x0} style={{ left: `${((x0 - range[0]) / span) * 100}%`, width: `${Math.max(0.6, ((x1 - x0) / span) * 100)}%` }} />)}
        </div>
      )}
      {note && <div id={`${id}-note`} className="limit-note" role="status">ปรับเกินนี้ไม่ได้: {note}</div>}
    </div>
  );
}

const FIELD_TH: Record<LimitedField, string> = {
  vbL: 'ปริมาตร', vfL: 'ห้องหน้า', fbHz: 'ความถี่จูน', portAreaCm2: 'พื้นที่ท่อ', fb2Hz: 'จูนท่อหน้า', port2AreaCm2: 'พื้นที่ท่อหน้า', prSdCm2: 'ขนาด PR'
};
const FIELD_UNIT: Record<LimitedField, string> = { vbL: 'L', vfL: 'L', fbHz: 'Hz', portAreaCm2: 'ซม.²', fb2Hz: 'Hz', port2AreaCm2: 'ซม.²', prSdCm2: 'ซม.²' };

/** A select's choices as a slider limit: the run of buildable choices around the current one. */
function choiceLimit(values: number[], ok: Map<number, string | null>, current: number): FieldLimit {
  const runs: [number, number][] = [];
  for (const v of values) {
    if (ok.get(v)) continue;
    const last = runs[runs.length - 1];
    if (last && values.indexOf(last[1]) === values.indexOf(v) - 1) last[1] = v; else runs.push([v, v]);
  }
  const around = runs.find(([a, b]) => current >= a && current <= b) ?? null;
  const next = around ? values[values.indexOf(around[1]) + 1] : undefined;
  const prev = around ? values[values.indexOf(around[0]) - 1] : undefined;
  return { ok: runs, around, belowWhy: prev !== undefined ? ok.get(prev) ?? null : null, aboveWhy: next !== undefined ? ok.get(next) ?? null : null };
}

/** The driver list grouped by kind (datasheet drivers first, made-up samples last). */
export function DriverOptions({ drivers }: { drivers: DriverDto[] }) {
  return <>{GROUPS.map(([cat, label]) => {
    const items = drivers.filter((x) => (cat === 'sample' ? x.sourceKind === 'sample' : x.sourceKind !== 'sample' && (cat === 'other' ? !GROUPS.some(([c]) => c === x.category) : x.category === cat)))
      .sort((a, b) => a.brand.localeCompare(b.brand) || (a.sizeIn ?? 0) - (b.sizeIn ?? 0) || a.model.localeCompare(b.model));
    return items.length ? <optgroup key={cat} label={label}>{items.map((x) => <option key={x.id} value={x.id}>{x.brand} {x.model} · {x.sizeIn ?? '?'}"</option>)}</optgroup> : null;
  })}</>;
}

const WARN_COLOR = { bad: '#f0abfc', warn: '#fcd34d', info: '#67e8f9' } as const;

const STD_OHMS = [0.5, 1, 2, 4, 8, 16];
const DAMPING = [20, 50, 100, 200, 500, 1000];
const AWG = Object.keys(AWG_MM2).map(Number).sort((a, b) => b - a);
const COIL_TH = { series: 'อนุกรม', parallel: 'ขนาน', single: 'ใช้ขดเดียว' } as const;

/**
 * Every way n drivers (with one or two coils each) can be wired, and the load each gives — what
 * car-audio people look up to match an amplifier.
 */
function loadOptions(unitOhms: (c: Design['coilWiring']) => number, n: number, dvc: boolean) {
  const coils: Design['coilWiring'][] = dvc ? ['series', 'parallel'] : ['series'];
  const wirings: Design['wiring'][] = n > 1 ? ['parallel', 'series'] : ['parallel'];
  return coils.flatMap((coil) => wirings.map((wiring) => ({ coil, wiring, ohms: wiring === 'parallel' ? unitOhms(coil) / n : unitOhms(coil) * n })));
}

const closest = (options: number[], v: number) => options.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), options[0] ?? v);

/**
 * Thickness to use after a material change: keep the current one when the new material comes in
 * a similar range, otherwise fall back towards the usual 18 mm — so a trip through 3 mm aluminium
 * does not leave an MDF box at 9 mm.
 */
const thicknessFor = (options: number[], v: number) =>
  options.length && v >= Math.min(...options) && v <= Math.max(...options) ? closest(options, v) : closest(options, 18);

export function RightPanel({ dto, driver, warnings, driverError, geo }: {
  dto: DriverDto | undefined; driver: Driver | null; warnings: Warning[]; driverError: string[] | null; geo: BoxGeometry | null;
}) {
  const { drivers, driverId, selectDriver, design: d, patchDesign, materials, damping, showToast, setMode, openNotebook } = useApp();
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
  // Lowest panel modes as the bracing leaves them (the same numbers as the vibration view).
  const modes = useMemo(() => (geo ? panelModes(geo, material, wallDamping(d, material, damping).f11Factor) : null), [geo, material, d, damping]);
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

  // Collisions get their own block with a fix; the list below keeps the other warnings.
  const buildIssues = warnings.filter((w) => w.build);
  const others = warnings.filter((w) => !w.build);
  const shown = allWarnings ? others : others.slice(0, 2);
  const ctx = useMemo<BuildCtx | null>(() => (driver ? { dto, driver, damping } : null), [dto, driver, damping]);
  // Scanning every slider takes a few milliseconds: let typing and dragging stay ahead of it.
  const deferred = useDeferredValue(d);
  const limits = useMemo(() => (ctx ? limitsFor(deferred, ctx) : {}), [deferred, ctx]);
  const buildable = buildIssues.length === 0;
  // Select choices that would collide are disabled, but only while the box can be built at all.
  const choices = useMemo(() => {
    if (!ctx || !buildable) return null;
    const why = <K extends 'count' | 'thicknessMm' | 'prCount' | 'portAreaCm2' | 'port2AreaCm2' | 'braceCount'>(k: K, vs: number[]) => {
      const m = buildableChoices(deferred, ctx, k, vs as Design[K][]);
      return new Map(vs.map((v) => [v, m.get(v as Design[K])?.[0]?.text ?? null] as [number, string | null]));
    };
    return {
      count: why('count', [1, 2, 3, 4]),
      thickness: why('thicknessMm', material?.thicknessesMm ?? [deferred.thicknessMm]),
      prCount: deferred.boxType === 'pr' ? why('prCount', [1, 2, 3, 4]) : null,
      braceCount: deferred.braceKind !== 'none' ? why('braceCount', Array.from({ length: MAX_BRACES }, (_, i) => i + 1)) : null,
      braceKind: new Map([...buildableChoices(deferred, ctx, 'braceKind', BRACES.map(([k]) => k))].map(([k, v]) => [k, v[0]?.text ?? null] as [BraceKind, string | null])),
      // Each tube count as the front port area it stands for.
      tubes: (() => {
        const tb = roundTubes(deferred);
        if (!tb) return null;
        const per = tb.area * 1e4;
        const m = why(frontAreaKey(deferred), Array.from({ length: MAX_TUBES }, (_, i) => (i + 1) * per));
        return new Map(Array.from({ length: MAX_TUBES }, (_, i) => [i + 1, m.get((i + 1) * per) ?? null] as [number, string | null]));
      })()
    };
  }, [deferred, ctx, buildable, material]);
  const lim = (f: LimitedField) => (buildable ? limits[f] ?? null : limits[f] ? { ...limits[f]!, around: null } : null);
  const fix = () => {
    if (!ctx) return;
    const before = useApp.getState().design;
    // A row placed off the baffle goes back to the nearest spot inside it.
    const place = geo && before.rowMode === 'manual' ? rowProblem(geo, before.boxType, before.count) : null;
    if (place && geo) {
      const range = rowRange(geo, before.boxType, before.count);
      const clampMm = (v: number, r: [number, number]) => Math.min(Math.floor(r[1] * 1000), Math.max(Math.ceil(r[0] * 1000), v));
      patchDesign(range ? { rowXMm: clampMm(before.rowXMm, range.x), rowYMm: clampMm(before.rowYMm, range.y) } : { rowMode: 'auto' });
      showToast(range ? 'ย้ายลำโพงกลับเข้ามาในแผงหน้าแล้ว' : 'แผงหน้าเล็กเกินจะวางเอง จึงจัดลำโพงกลับกึ่งกลาง', { label: 'ย้อนกลับ', run: () => patchDesign(before) });
      return;
    }
    const n = nearestBuildable(before, ctx);
    if (!n) {
      showToast('ปรับค่าเดียวแล้วยังสร้างไม่ได้ ลองกด "จัดตู้แนะนำสำหรับลำโพงนี้" เพื่อให้ระบบจัดทั้งตู้ใหม่');
      setConfirming(true);
      return;
    }
    patchDesign({ [n.field]: n.value });
    showToast(`ปรับ${FIELD_TH[n.field]}จาก ${before[n.field]} เป็น ${n.value} ${FIELD_UNIT[n.field]} ตู้สร้างได้แล้ว`, { label: 'ย้อนกลับ', run: () => patchDesign(before) });
  };

  /**
   * The front port: a slot sized by its area, or round tubes (type, measured bore, how many).
   * Tubes keep the area setting at count × bore area, so every limit and suggestion still applies.
   */
  const frontPort = (id: string, label: string) => {
    const key = frontAreaKey(d);
    const tb = roundTubes(d);
    const tube = tubeOf(d.tubeKey);
    const setTubes = (patch: Partial<Design>, count = tb?.count ?? 1) => {
      const next = { ...d, ...patch };
      p({ ...patch, [key]: Math.round(count * Math.PI * (next.tubeIdMm / 20) ** 2 * 10) / 10 });
    };
    return <>
      <div className="seg" role="group" aria-label="ชนิดท่อหน้า">
        <button aria-pressed={!tb} onClick={() => p({ portStyle: 'slot' })}>ท่อสลอต</button>
        <button aria-pressed={!!tb} onClick={() => {
          // As many tubes as the slot's area calls for, fewer when that many would not fit the box.
          const per = Math.PI * (d.tubeIdMm / 20) ** 2;
          const want = Math.min(MAX_TUBES, Math.max(1, Math.round(d[key] / per)));
          const counts = Array.from({ length: want }, (_, i) => want - i);
          const fits = ctx ? buildableChoices({ ...d, portStyle: 'round' }, ctx, key, counts.map((n) => Math.round(n * per * 10) / 10)) : null;
          const n = fits ? counts.find((c) => !fits.get(Math.round(c * per * 10) / 10)?.length) ?? want : want;
          setTubes({ portStyle: 'round' }, n);
        }}>ท่อกลม (PVC)</button>
      </div>
      {!tb ? <Slider id={id} label={label} value={d[key]} range={RANGES[key]} step={5} fmt={(v) => `${v} ซม.²`} onChange={(v) => p({ [key]: v })} limit={lim(key)} /> : <>
        <div className="field-head">
          <label htmlFor={`${id}-tube`}>ท่อ · ไส้ใน</label>
          <span className="pair">
            <select id={`${id}-tube`} className="mini" value={d.tubeKey} onChange={(e) => { const t = tubeOf(e.target.value); setTubes({ tubeKey: e.target.value, tubeIdMm: t?.idMm ?? d.tubeIdMm }); }}>
              {TUBES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <NumField id={`${id}-id`} label="ไส้ในที่วัดได้" value={d.tubeIdMm} min={20} max={300} unit="มม." onChange={(v) => setTubes({ tubeIdMm: v })} />
          </span>
        </div>
        <div className="field-head">
          <label htmlFor={`${id}-n`}>จำนวนท่อ</label>
          <span className="pair">
            <select id={`${id}-n`} className="mini" value={tb.count} onChange={(e) => setTubes({}, Number(e.target.value))}>
              {Array.from({ length: MAX_TUBES }, (_, i) => i + 1).map((n) => { const why = choices?.tubes?.get(n); return <option key={n} value={n} disabled={!!why} title={why ?? undefined}>{n} ท่อ{why ? ' · สร้างไม่ได้' : ''}</option>; })}
            </select>
          </span>
        </div>
        <div className="loadline muted">
          <span>พื้นที่รวม <b>{(tb.count * tb.area * 1e4).toFixed(0)} ซม.²</b>{geo?.tubes ? <> · ยาวท่อละ <b>{(geo.portLength * 100).toFixed(1)} ซม.</b></> : null}</span>
          {tube?.known === 'od' && <span>ไส้ในเป็นค่าประมาณ วัดท่อจริงแล้วแก้</span>}
        </div>
      </>}
    </>;
  };

  return (
    <section className="right-panel glass" aria-label="ตั้งค่าตู้และผลลัพธ์">
      <div className="rp-scroll">
        <div className="field">
          <div className="field-head">
            <label htmlFor="drv">ลำโพง</label>
            <button type="button" className="linkbtn" onClick={() => setMode('library')}>{dto?.sourceKind === 'sample' ? 'ลำโพงตัวอย่าง · ' : ''}เปิดคลัง ({drivers.length})</button>
          </div>
          <select id="drv" value={driverId ?? ''} onChange={(e) => selectDriver(Number(e.target.value))}>
            <DriverOptions drivers={drivers} />
          </select>
        </div>
        {dto && (
          <div className="params">
            <button type="button" title="ดูสูตร Fs" onClick={() => openNotebook('fs')}><span>Fs</span><b>{dto.fs} Hz</b></button>
            <button type="button" title="ดูสูตร Qts" onClick={() => openNotebook('qts')}><span>Qts</span><b>{dto.qts?.toFixed(2) ?? (driver ? driver.qts.toFixed(2) : '—')}</b></button>
            <button type="button" title="ดูสูตร Vas" onClick={() => openNotebook('vas')}><span>Vas</span><b>{dto.vasL?.toFixed(0) ?? (driver ? (driver.vas * 1000).toFixed(0) : '—')} L</b></button>
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
        <button type="button" className="linkbtn wizlink" onClick={() => setMode('wizard')}>ไม่แน่ใจว่าตู้แบบไหนดี? ให้ช่วยเทียบตามเป้าหมาย</button>
        {!buildable && (
          <div className="build-block" role="alert">
            <b><Icon name="alert" size={15} width={2} />ตู้นี้สร้างจริงไม่ได้</b>
            <ul>{buildIssues.map((w) => <li key={w.text}>{w.text}</li>)}</ul>
            <button type="button" onClick={fix} disabled={!driver}>ปรับให้สร้างได้</button>
          </div>
        )}

        <div className="fields">
          <Slider id="vb" label={d.boxType.startsWith('bp') ? 'ห้องหลัง Vr' : 'ปริมาตรสุทธิ Vb'} value={d.vbL} range={RANGES.vbL} fmt={L} onChange={(v) => p({ vbL: v })} limit={lim('vbL')} />
          {(d.boxType === 'vented' || d.boxType === 'bp4' || d.boxType === 'bp6') && <>
            <Slider id="fb" label={d.boxType === 'bp6' ? 'จูนท่อหลัง' : 'ความถี่จูนท่อ Fb'} value={d.fbHz} range={RANGES.fbHz} step={0.5} fmt={Hz} onChange={(v) => p({ fbHz: v })} limit={lim('fbHz')} />
            {d.boxType === 'bp6'
              ? <Slider id="pa" label="พื้นที่ท่อหลัง" value={d.portAreaCm2} range={RANGES.portAreaCm2} step={5} fmt={(v) => `${v} ซม.²`} onChange={(v) => p({ portAreaCm2: v })} limit={lim('portAreaCm2')} />
              : frontPort('pa', 'พื้นที่ท่อ')}
          </>}
          {(d.boxType === 'bp4' || d.boxType === 'bp6') && <Slider id="vf" label="ห้องหน้า Vf" value={d.vfL} range={RANGES.vfL} fmt={L} onChange={(v) => p({ vfL: v })} limit={lim('vfL')} />}
          {d.boxType === 'bp6' && <>
            <Slider id="fb2" label="จูนท่อหน้า" value={d.fb2Hz} range={RANGES.fb2Hz} step={0.5} fmt={Hz} onChange={(v) => p({ fb2Hz: v })} limit={lim('fb2Hz')} />
            {frontPort('pa2', 'พื้นที่ท่อหน้า')}
          </>}
          {d.boxType === 'pr' && <>
            <Slider id="prs" label="ขนาด PR (Sd ต่อตัว)" value={d.prSdCm2} range={RANGES.prSdCm2} step={5} fmt={(v) => `${v} ซม.²`} onChange={(v) => p({ prSdCm2: v })} limit={lim('prSdCm2')} />
            <Slider id="prm" label="มวล PR ต่อตัว" value={d.prMassG} range={RANGES.prMassG} step={5} fmt={(v) => `${v} ก.`} onChange={(v) => p({ prMassG: v })} />
            <Slider id="prn" label="จำนวน PR" value={d.prCount} range={[1, 4]} fmt={(v) => `${v} ตัว`} onChange={(v) => p({ prCount: v })}
              limit={choices?.prCount ? choiceLimit([1, 2, 3, 4], choices.prCount, d.prCount) : null} />
          </>}
          <div className="field">
            <div className="field-head">
              <label htmlFor="pw">กำลังขับ</label>
              <button className={`pill${d.subsonic ? ' on' : ''}`} aria-pressed={d.subsonic} onClick={() => p({ subsonic: !d.subsonic })}>Subsonic</button>
              <select className="mini" aria-label="ความถี่ Subsonic" value={d.subsonicHz} disabled={!d.subsonic} onChange={(e) => p({ subsonicHz: Number(e.target.value) })}>
                {SUBSONIC_HZ.map((hz) => <option key={hz} value={hz}>{hz} Hz</option>)}
              </select>
              <output htmlFor="pw" style={{ marginLeft: 'auto' }}>{d.watts} W</output>
            </div>
            <input id="pw" type="range" min={RANGES.watts[0]} max={RANGES.watts[1]} step={1} value={d.watts} onChange={(e) => p({ watts: Number(e.target.value) })} />
          </div>
          <div className="field-head">
            <label htmlFor={d.boxType === 'isobaric' ? 'wire' : 'cnt'}>จำนวนลำโพง</label>
            <span className="pair">
              {d.boxType === 'isobaric'
                ? <span className="fixed">2 ดอก (ประกบ)</span>
                : <select id="cnt" value={d.count} onChange={(e) => p({ count: Number(e.target.value) })}>
                    {[1, 2, 3, 4].map((n) => { const why = choices?.count.get(n); return <option key={n} value={n} disabled={!!why} title={why ?? undefined}>{n} ดอก{why ? ' · สร้างไม่ได้' : ''}</option>; })}
                  </select>}
              <select id="wire" aria-label="การต่อสาย" value={d.wiring} onChange={(e) => p({ wiring: e.target.value as Design['wiring'] })}><option value="parallel">ขนาน</option><option value="series">อนุกรม</option></select>
            </span>
          </div>
          {dto && isDvc(dto) && (
            <div className="field-head">
              <label htmlFor="coilw" title={`ค่า T/S ในคลังวัดตอนต่อคอยล์${measuredWiring(dto).wiring === 'series' ? 'อนุกรม' : 'ขนาน'}${measuredWiring(dto).known ? '' : ' (เดา)'} ระบบแปลงให้ตามการต่อที่เลือก`}>ต่อคอยล์ในดอก (DVC)</label>
              <select id="coilw" value={d.coilWiring} onChange={(e) => p({ coilWiring: e.target.value as Design['coilWiring'] })}>
                {(Object.keys(COIL_TH) as Design['coilWiring'][]).map((k) => <option key={k} value={k}>{COIL_TH[k]}</option>)}
              </select>
            </div>
          )}
          {driver && (() => {
            const n = d.boxType === 'isobaric' ? 2 : d.count;
            const unit = driver.zNom ?? driver.re;
            const total = d.wiring === 'parallel' ? unit / n : unit * n;
            const dvc = !!dto && isDvc(dto);
            // Per-driver nominal for another coil wiring: series is 4× parallel, one coil 2×.
            const parUnit = unit / (d.coilWiring === 'series' ? 4 : d.coilWiring === 'single' ? 2 : 1);
            const unitFor = (c: Design['coilWiring']) => (dvc ? parUnit * (c === 'series' ? 4 : c === 'single' ? 2 : 1) : unit);
            const options = loadOptions(unitFor, n, dvc);
            const amp = ampLimits(d);
            return (
              <div className="loadline">
                <span>โหลดรวม <b>{fmtOhms(total)} Ω</b>{n > 1 || dvc ? <> · ต่อดอก {fmtOhms(unit)} Ω</> : null}{amp ? <> · แอมป์ให้ได้ ~{Math.round((amp.volts * amp.volts) / total)} W</> : null}</span>
                {options.length > 1 && (
                  <span className="loadopts" role="group" aria-label="ทางเลือกการต่อสาย">
                    {options.map((o) => {
                      const on = o.wiring === d.wiring && (!dvc || o.coil === d.coilWiring);
                      return (
                        <button key={`${o.coil}-${o.wiring}`} type="button" className={`pill${on ? ' on' : ''}`} aria-pressed={on}
                          title={`${dvc ? `คอยล์${COIL_TH[o.coil]} · ` : ''}${n > 1 ? `ดอก${o.wiring === 'parallel' ? 'ขนาน' : 'อนุกรม'}` : ''}`}
                          onClick={() => p(dvc ? { coilWiring: o.coil, wiring: o.wiring } : { wiring: o.wiring })}>{fmtOhms(o.ohms)} Ω</button>
                      );
                    })}
                  </span>
                )}
              </div>
            );
          })()}

          <div className="section-title sub">แอมป์และสายลำโพง</div>
          <div className="field-head">
            <label htmlFor="ampw">แอมป์</label>
            <button className={`pill${d.amp ? ' on' : ''}`} aria-pressed={d.amp} onClick={() => p({ amp: !d.amp })} title="จำลองแอมป์จริง: จุด clipping กระแสสูงสุด และอิมพีแดนซ์ขาออก">{d.amp ? 'จำลองแอมป์' : 'แอมป์อุดมคติ'}</button>
            {d.amp && (
              <span className="pair" style={{ marginLeft: 'auto' }}>
                <NumField id="ampw" label="กำลังแอมป์" value={d.ampW} min={1} max={50000} unit="W" onChange={(v) => p({ ampW: v })} />
                <select aria-label="ที่โหลด" className="mini" value={d.ampOhms} onChange={(e) => p({ ampOhms: Number(e.target.value) })}>{STD_OHMS.map((o) => <option key={o} value={o}>@ {o} Ω</option>)}</select>
              </span>
            )}
          </div>
          {d.amp && (
            <div className="field-head">
              <label htmlFor="ampmin">โหลดต่ำสุด · DF</label>
              <span className="pair">
                <select id="ampmin" className="mini" value={d.ampMinOhms} onChange={(e) => p({ ampMinOhms: Number(e.target.value) })}>{STD_OHMS.map((o) => <option key={o} value={o}>{o} Ω</option>)}</select>
                <select aria-label="Damping factor" className="mini" value={d.dampingFactor} onChange={(e) => p({ dampingFactor: Number(e.target.value) })}>{DAMPING.map((v) => <option key={v} value={v}>DF {v}</option>)}</select>
              </span>
            </div>
          )}
          <div className="field-head">
            <label htmlFor="wirem">สายลำโพง</label>
            <span className="pair">
              <NumField id="wirem" label="ความยาวสาย (ทางเดียว)" value={d.wireM} min={0} max={50} unit="ม." onChange={(v) => p({ wireM: v })} />
              <select aria-label="ขนาดสาย" className="mini" value={d.wireAwg} onChange={(e) => p({ wireAwg: Number(e.target.value) })}>{AWG.map((g) => <option key={g} value={g}>{g} AWG ({AWG_MM2[g]} มม.²)</option>)}</select>
            </span>
          </div>
          {d.wireM > 0 && <div className="loadline muted">สายไป-กลับ {wireOhms(d).toFixed(3)} Ω{d.amp ? ` · แอมป์ ${(d.ampOhms / d.dampingFactor).toFixed(3)} Ω` : ''}</div>}

          <ShapeSection geo={geo} />

          <div className="section-title sub">วัสดุ</div>
          <div className="field-head">
            <label htmlFor="mat">ผนังตู้</label>
            <span className="pair">
              <select id="mat" style={{ maxWidth: 150 }} value={d.materialKey} onChange={(e) => {
                const mat = materials.find((x) => x.key === e.target.value);
                p({ materialKey: e.target.value, thicknessMm: thicknessFor(mat?.thicknessesMm ?? [d.thicknessMm], d.thicknessMm) });
              }}>{materials.map((x) => <option key={x.key} value={x.key}>{x.nameTh ?? x.name}</option>)}</select>
              <select aria-label="ความหนา" value={d.thicknessMm} onChange={(e) => p({ thicknessMm: Number(e.target.value) })}>
                {(material?.thicknessesMm ?? [d.thicknessMm]).map((t) => { const why = choices?.thickness.get(t); return <option key={t} value={t} disabled={!!why} title={why ?? undefined}>{t} มม.{why ? ' · สร้างไม่ได้' : ''}</option>; })}
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

          <div className="section-title sub" id="braces">โครงค้ำ</div>
          <div className="seg" role="group" aria-label="แบบโครงค้ำ">
            {BRACES.map(([k, label, tip]) => {
              const why = k !== d.braceKind ? choices?.braceKind.get(k) : null;
              return <button key={k} aria-pressed={d.braceKind === k} disabled={!!why} title={why ?? tip} onClick={() => p({ braceKind: k })}>{label}</button>;
            })}
          </div>
          {d.braceKind !== 'none' && (
            <div className="field-head">
              <label htmlFor="brn">จำนวนชุด (เรียงตามความลึก)</label>
              <select id="brn" className="mini" value={braceCountOf(d.braceCount)} onChange={(e) => p({ braceCount: Number(e.target.value) })}>
                {Array.from({ length: MAX_BRACES }, (_, i) => i + 1).map((n) => { const why = choices?.braceCount?.get(n); return <option key={n} value={n} disabled={!!why} title={why ?? undefined}>{n} ชุด{why ? ' · สร้างไม่ได้' : ''}</option>; })}
              </select>
            </div>
          )}
          {modes && (
            <div className="loadline muted">
              <span>ผนังข้าง ≈ <b>{modes.side.toFixed(0)} Hz</b> · ฝาบน ≈ <b>{modes.top.toFixed(0)} Hz</b> · ผนังหลัง ≈ <b>{modes.back.toFixed(0)} Hz</b> (ประมาณ)</span>
              {d.braceKind === 'dowel' && <span>เดือย Ø {DOWEL_D * 1000} มม. เป็นขนาดทั่วไป ไม่ใช่ค่าที่ยืนยัน · ไม่ช่วยฝาบน</span>}
              {d.braceKind !== 'none' && <span>โครงค้ำขนานผนังหลัง จึงไม่ช่วยผนังหลัง</span>}
            </div>
          )}
        </div>
      </div>

      {others.length > 0 && (
        <div className="rp-results">
          <div className="warns">
            {shown.map((w, i) => (
              <div key={i} className="warn" style={{ color: WARN_COLOR[w.level], background: `${WARN_COLOR[w.level]}14`, border: `1px solid ${WARN_COLOR[w.level]}55` }}>
                <Icon name="alert" size={15} width={2} /><span>{w.text}</span>
              </div>
            ))}
            {others.length > 2 && (
              <button className="more" onClick={() => setAllWarnings((v) => !v)}>{allWarnings ? 'ย่อคำเตือน' : `ดูคำเตือนอีก ${others.length - 2} ข้อ`}</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
