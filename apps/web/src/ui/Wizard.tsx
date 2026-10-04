import { useEffect, useMemo, useState } from 'react';
import { freeSlot } from '../data/compare';
import { driverFromDto, maxOutputFor, simulate, sizeBox, summarize, SUGGEST_FLAG_TEXT, toSpec } from '../sim/model';
import { GOALS, LAB_GRID, TYPE_TH, VEHICLES, type Candidate, type Goal, type Vehicle, type WizardResult } from '../sim/wizard';
import type { WizardJob, WizardReply } from '../sim/wizard.worker';
import { useApp } from '../state/store';
import { Icon } from './icons';
import { LineChart } from './LineChart';
import { DriverOptions } from './RightPanel';

const COLORS = ['#22d3ee', '#a3e635', '#fbbf24', '#e879f9', '#a78bfa', '#f472b6', '#94a3b8', '#fb923c', '#5eead4', '#fda4af', '#c4b5fd', '#fde68a', '#93c5fd'];
const SHOWN = 6;
const LIMIT_TH = { excursion: 'ระยะชัก (Xmax)', port: 'ลมในท่อ 30 m/s', power: 'พิกัดกำลังลำโพง' } as const;
const LIMIT_RANGE = [2, 1000] as const;

/** On a phone the results sit under the choices: bring them into view. */
const reveal = (selector: string) => {
  if (window.innerWidth <= 760) requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
};
const hz = (v: number | null) => (v == null ? '—' : `${v.toFixed(v < 100 ? 1 : 0)} Hz`);
const ceilTo = (v: number, s: number) => Math.ceil(v / s) * s;

type Progress = { done: number; total: number };

/**
 * The page is unmounted whenever the user steps over to the lab; keep the last choices and the last
 * run so coming back to try the second box does not start from scratch.
 */
let lastChoice: { drvId: number | null; count: number; goal: Goal | null; vehicle: Vehicle; limitOn: boolean; limitText: string; view: 'spl' | 'max' } | null = null;
let lastRun: { key: string; result: WizardResult; sel: string | null } | null = null;

/**
 * Quick design by goal: pick a driver and what the box is for, and every box type (plus smaller,
 * bigger, louder and flatter variants) is built with the lab's own suggestion pipeline, simulated
 * and ranked in a worker. Any one of them opens in the lab.
 */
export function WizardView() {
  const { drivers, driverId, damping, setMode, showToast, saveSlot, slots, materials } = useApp();
  const [drvId, setDrvId] = useState<number | null>(lastChoice?.drvId ?? driverId);
  const [count, setCount] = useState(() => lastChoice?.count ?? useApp.getState().design.count);
  const [goal, setGoal] = useState<Goal | null>(lastChoice?.goal ?? null);
  const [vehicle, setVehicle] = useState<Vehicle>(lastChoice?.vehicle ?? 'sedan');
  const [limitOn, setLimitOn] = useState(lastChoice?.limitOn ?? false);
  const [limitText, setLimitText] = useState(lastChoice?.limitText ?? '60');
  const [limitL, setLimitL] = useState<number | null>(() => (lastChoice?.limitOn ? Number(lastChoice.limitText) || null : null));
  const [result, setResult] = useState<WizardResult | null>(lastRun?.result ?? null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(lastRun?.sel ?? null);
  const [view, setView] = useState<'spl' | 'max'>(lastChoice?.view ?? 'spl');
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState<Candidate | null>(null);

  const dto = drivers.find((d) => d.id === drvId) ?? drivers.find((d) => d.id === driverId);
  const limitValue = Number(limitText.replace(',', '.'));
  const limitBad = limitOn && !(limitValue >= LIMIT_RANGE[0] && limitValue <= LIMIT_RANGE[1]);

  useEffect(() => { lastChoice = { drvId, count, goal, vehicle, limitOn, limitText, view }; }, [drvId, count, goal, vehicle, limitOn, limitText, view]);
  useEffect(() => { if (lastRun) lastRun.sel = sel; }, [sel]);

  // Typing a size limit should not restart the run on every key, and a half-typed or wrong value
  // keeps the last good one instead of quietly dropping the limit.
  useEffect(() => {
    if (limitOn && limitBad) return;
    const id = window.setTimeout(() => setLimitL(limitOn ? limitValue : null), 400);
    return () => window.clearTimeout(id);
  }, [limitOn, limitBad, limitValue]);

  // Vehicle only matters in the car; changing it for another goal must not rerun anything.
  const veh: Vehicle = goal === 'car' ? vehicle : 'sedan';
  // Everything a run depends on; the same key as last time reuses that run.
  const design = useApp((st) => st.design);
  const runKey = goal && dto ? JSON.stringify([goal, dto, count, limitL, veh, damping.length, design.wiring, design.fillKey, design.stuffing,
    design.subsonic, design.subsonicHz, design.thicknessMm, design.ql, design.coilWiring, design.amp, design.ampOhms, design.dampingFactor, design.wireM, design.wireAwg]) : '';
  useEffect(() => {
    if (!goal || !dto || !damping.length) return;
    if (lastRun?.key === runKey) { setResult(lastRun.result); setProgress(null); return; }
    let w: Worker;
    try {
      w = new Worker(new URL('../sim/wizard.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setError('เบราว์เซอร์นี้เปิดตัวคำนวณเบื้องหลัง (Web Worker) ไม่ได้');
      return;
    }
    const job = Date.now();
    // A reply already queued when this run was replaced must not land on the new choice.
    let live = true;
    setProgress({ done: 0, total: 0 });
    setError(null);
    w.onmessage = (e: MessageEvent<WizardReply>) => {
      const m = e.data;
      if (!live || m.job !== job) return;
      if (m.type === 'progress') { setProgress({ done: m.done, total: m.total }); return; }
      w.terminate();
      setProgress(null);
      if (m.type === 'done') {
        setResult(m.result);
        setSel(m.result.ranked[0]?.id ?? null);
        setShowAll(false);
        lastRun = { key: runKey, result: m.result, sel: m.result.ranked[0]?.id ?? null };
      } else {
        setResult(null);
        setError(m.missing ? `ข้อมูลลำโพงไม่พอคำนวณ ขาด: ${m.missing.join(', ')} · เพิ่มค่าได้ที่คลังข้อมูล` : 'คำนวณไม่สำเร็จ ลองเลือกใหม่อีกครั้ง');
      }
    };
    w.onerror = () => { if (live) { setProgress(null); setError('คำนวณไม่สำเร็จ ลองเลือกใหม่อีกครั้ง'); } };
    const msg: WizardJob = { job, goal, design: { ...useApp.getState().design, count }, dto, damping, maxLitres: limitL, vehicle: veh };
    w.postMessage(msg);
    // A new choice (or leaving the page) stops the run that is still going.
    return () => { live = false; w.terminate(); };
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fresh = !!result && result.goal === goal && !progress;
  const ranked = result?.ranked ?? [];
  const shown = showAll ? ranked : ranked.slice(0, SHOWN);
  const current = ranked.find((c) => c.id === sel) ?? ranked[0] ?? null;
  const colorOf = (c: Candidate) => COLORS[ranked.indexOf(c) % COLORS.length];
  const g = GOALS.find((x) => x.id === goal);

  const chart = useMemo(() => {
    if (!shown.length || !current) return null;
    const pick = (c: Candidate) => (view === 'spl' ? c.curves.spl : c.curves.maxSpl);
    const f = current.curves.freqs;
    const top = Math.max(...shown.flatMap((c) => pick(c).filter((_, i) => f[i] >= 15 && f[i] <= 300)));
    const yMax = ceilTo(top + 4, 10);
    // The picked box goes first so it gets the fill and glow.
    const order = [current, ...shown.filter((c) => c.id !== current.id)];
    return {
      freqs: f, yMax, yMin: yMax - 50,
      series: order.map((c, i) => ({ values: pick(c), color: colorOf(c), fill: i === 0, glow: i === 0, dashed: i > 0 }))
    };
  }, [shown, current, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (c: Candidate) => {
    setConfirm(null);
    if (!dto) return;
    const st = useApp.getState();
    const before = { design: st.design, driverId: st.driverId };
    st.selectDriver(dto.id);
    st.patchDesign({ ...c.patch, count });
    st.setMode('lab');
    st.showToast(`เปิด ${c.label} (${c.detail}) ในแล็บแล้ว${goal === 'car' ? ' · กราฟในแล็บยังเป็นห้องโล่ง ไม่รวมผลห้องโดยสาร' : ''}`, {
      label: 'ย้อนกลับ',
      run: () => {
        const now = useApp.getState();
        if (before.driverId !== null) now.selectDriver(before.driverId);
        now.patchDesign(before.design);
      }
    });
  };
  const slot = freeSlot(slots);
  /** Keeps a candidate as comparison A, B or C: re-simulated free-field, exactly as the lab would. */
  const keepAsGhost = (c: Candidate) => {
    if (!dto || !slot) return;
    const design = { ...useApp.getState().design, ...c.patch, count };
    const drv = driverFromDto(dto, design.coilWiring);
    if (!drv.ok) return;
    const res = simulate(toSpec(design, drv.driver, damping), LAB_GRID);
    const geo = sizeBox(design, dto, res, materials.find((m) => m.key === design.materialKey));
    const max = maxOutputFor(design, dto, res);
    saveSlot(slot, {
      label: `${dto.model} · ${c.label} ${c.detail}`, design, driverId: dto.id, driverName: `${dto.brand} ${dto.model}`,
      curves: res.curves, maxSpl: max.maxSpl, summary: summarize(design, dto, res, geo, max), savedAt: Date.now()
    });
    showToast(`เก็บ ${c.label} เป็น ${slot} แล้ว · เส้นประในกราฟของแล็บ และตารางที่แท็บ "เทียบ A/B/C"`);
  };

  return (
    <section className="library wizard glass" aria-label="ออกแบบด่วนตามเป้าหมาย">
      <header className="lib-head" style={{ backgroundImage: 'url(/art/teaser-ai.webp)' }}>
        <div>
          <h2>ออกแบบด่วน</h2>
          <p>เลือกลำโพงและเป้าหมาย ระบบจะลองตู้ทุกชนิดด้วยเอนจินเดียวกับแล็บ แล้วเรียงแบบที่ตรงเป้าที่สุดให้เทียบกัน</p>
        </div>
        <div className="lib-actions">
          <button onClick={() => setMode('lab')}>กลับแล็บ</button>
        </div>
      </header>

      <div className="wiz-body">
        <div className="wiz-side">
          <div className="wiz-step"><b>1</b>ลำโพง</div>
          <select aria-label="ลำโพง" value={dto?.id ?? ''} onChange={(e) => setDrvId(Number(e.target.value))}>
            <DriverOptions drivers={drivers} />
          </select>
          {dto && (
            <div className="wiz-params mono">
              Fs {dto.fs} Hz · Qts {dto.qts?.toFixed(2) ?? '—'} · Vas {dto.vasL?.toFixed(0) ?? '—'} L · Xmax {dto.xmaxMm ?? '—'} มม. · Pe {dto.peW ?? '—'} W
            </div>
          )}
          <label className="wiz-inline">
            <span>จำนวนดอกในตู้</span>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} ดอก</option>)}
            </select>
          </label>

          <div className="wiz-step"><b>2</b>เป้าหมาย</div>
          <div className="wiz-goals" role="radiogroup" aria-label="เป้าหมาย">
            {GOALS.map((x) => (
              <button key={x.id} role="radio" aria-checked={goal === x.id} onClick={() => { setGoal(x.id); reveal('.wiz-main'); }}>
                <b>{x.th}</b><span>{x.desc}</span>
              </button>
            ))}
          </div>
          {goal === 'car' && (
            <label className="wiz-inline">
              <span>รถ</span>
              <select value={vehicle} onChange={(e) => setVehicle(e.target.value as Vehicle)}>
                {VEHICLES.map((v) => <option key={v.id} value={v.id}>{v.th}</option>)}
              </select>
            </label>
          )}

          <div className="wiz-step"><b>3</b>พื้นที่ (ไม่บังคับ)</div>
          <label className="wiz-check">
            <input type="checkbox" checked={limitOn} onChange={(e) => setLimitOn(e.target.checked)} />
            <span>จำกัดปริมาตรสุทธิรวมไม่เกิน</span>
            <input type="text" inputMode="decimal" value={limitText} disabled={!limitOn} aria-invalid={limitBad} aria-label="ปริมาตรสูงสุด (ลิตร)"
              onChange={(e) => setLimitText(e.target.value)} />
            <span>L</span>
          </label>
          {limitBad && <div className="wiz-err">ใส่ปริมาตร {LIMIT_RANGE[0]}–{LIMIT_RANGE[1]} ลิตร</div>}
          {g && <p className="wiz-how"><b>จัดอันดับจาก:</b> {g.how}</p>}
        </div>

        <div className="wiz-main">
          {!goal ? (
            <div className="wiz-empty">
              <Icon name="box" size={30} width={1.5} />
              <p>เลือกเป้าหมายทางซ้าย ระบบจะลองตู้ปิด ตู้เปิด PR แบนด์พาส และ isobaric หลายขนาด กับลำโพงนี้ แล้วเรียงแบบที่ตรงเป้าที่สุดให้</p>
            </div>
          ) : (
            <>
              <div className="wiz-bar">
                <div className="chips" role="group" aria-label="กราฟ">
                  <button aria-pressed={view === 'spl'} onClick={() => setView('spl')}>SPL ที่กำลังพิกัด</button>
                  <button aria-pressed={view === 'max'} onClick={() => setView('max')}>ดังสุดที่ทำได้จริง</button>
                </div>
                {progress ? (
                  <div className="wiz-progress" role="status">
                    กำลังคำนวณ{progress.total ? ` ${progress.done}/${progress.total} แบบ` : '…'}
                    <i style={{ width: progress.total ? `${(100 * progress.done) / progress.total}%` : '8%' }} />
                  </div>
                ) : result && (
                  <span className="muted wiz-count">
                    {ranked.length} แบบ{result.tooBig ? ` · ซ่อน ${result.tooBig} แบบที่ใหญ่เกินพื้นที่` : ''}{result.chokedPorts ? ` · ตัด ${result.chokedPorts} แบบที่ลมในท่อเกิน 60 m/s` : ''}
                  </span>
                )}
              </div>
              {error && <div className="wiz-err" role="alert">{error}</div>}
              <div className={`wiz-results${fresh ? '' : ' stale'}`}>
                {chart && current && (
                  <LineChart big freqs={chart.freqs} yMin={chart.yMin} yMax={chart.yMax} unit="dB"
                    title={view === 'spl'
                      ? `SPL ที่ 1 ม. (dB) · กำลังตามพิกัดลำโพง${result?.goal === 'car' ? ' · ในรถ รวม cabin gain (ประมาณ)' : ''}`
                      : 'ดังสุดที่ทำได้ (dB) · ไม่เกิน Xmax ลมในท่อ 30 m/s และพิกัดลำโพง'}
                    marker={current.m.f3 ? { f: current.m.f3, label: `F3 ${current.m.f3.toFixed(0)} Hz` } : null}
                    series={chart.series} />
                )}
                {result && !ranked.length && !progress && (
                  <div className="wiz-empty"><p>ไม่มีแบบที่เข้าเงื่อนไข{result.smallestL ? ` แบบที่เล็กที่สุดสำหรับลำโพงนี้ต้องใช้ราว ${Math.ceil(result.smallestL)} L ลองเพิ่มพื้นที่ที่จำกัดไว้` : ''}</p></div>
                )}
                {current && (
                  <div className="wiz-split">
                    <ol className="wiz-list">
                      {shown.map((c) => (
                        <li key={c.id}>
                          <button aria-pressed={current.id === c.id} onClick={() => { setSel(c.id); reveal('.wiz-detail'); }}>
                            <span className="rank" style={{ background: colorOf(c) }}>{ranked.indexOf(c) + 1}</span>
                            <span className="body">
                              <span className="name">{c.label} <em>{TYPE_TH[c.type]}</em></span>
                              <span className="meta">{c.detail}</span>
                              <span className="meta">F3 {hz(c.m.f3)} · ดัง {c.m.loud.toFixed(0)} dB · ตู้ {c.m.dimsCm.join('×')} ซม.</span>
                              {!!c.strengths.length && <span className="tags">{c.strengths.map((s) => <span key={s} className="tag good">{s}</span>)}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                      {ranked.length > SHOWN && (
                        <li><button className="more" onClick={() => setShowAll(!showAll)}>{showAll ? 'แสดงแค่ 6 อันดับแรก' : `ดูอีก ${ranked.length - SHOWN} แบบ`}</button></li>
                      )}
                    </ol>
                    <Detail c={current} band={result?.band ?? [0, 0]} goal={result?.goal ?? goal} xmax={dto?.xmaxMm ?? null}
                      onApply={() => setConfirm(current)} onGhost={() => keepAsGhost(current)} slot={slot} busy={!fresh} />
                  </div>
                )}
              </div>
              <p className="wiz-foot muted">
                ทุกแบบคำนวณด้วยเอนจินเดียวกับแล็บ ที่กำลังตามพิกัดลำโพง (Pe × จำนวนดอก) ระยะ 1 ม. ไม่รวมผลห้อง{goal === 'car' ? ' (ยกเว้น cabin gain ซึ่งเป็นค่าประมาณจากขนาดรถ ไม่ใช่ผลวัด)' : ''} · อันดับเป็นการชั่งน้ำหนักตามเป้าหมาย ดูตัวเลขประกอบการตัดสินใจ
              </p>
            </>
          )}
        </div>
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(null)}>
          <div className="confirm glass" role="alertdialog" aria-modal="true" aria-labelledby="wiz-apply" onClick={(e) => e.stopPropagation()}>
            <h3 id="wiz-apply">เปิด {confirm.label} ในแล็บ?</h3>
            <p>ชนิดตู้ ขนาด ท่อ และกำลังขับในแล็บตอนนี้จะถูกแทนด้วยแบบนี้{dto && dto.id !== driverId ? ` และเปลี่ยนลำโพงเป็น ${dto.brand} ${dto.model}` : ''} · กด "ย้อนกลับ" ที่แถบแจ้งเตือนเพื่อคืนค่าเดิมได้</p>
            <div className="row"><button className="primary" onClick={() => apply(confirm)}>เปิดในแล็บ</button><button autoFocus onClick={() => setConfirm(null)}>ยกเลิก</button></div>
          </div>
        </div>
      )}
    </section>
  );
}

function Detail({ c, band, goal, xmax, busy, onApply, onGhost, slot }: {
  c: Candidate; band: [number, number]; goal: Goal | null; xmax: number | null; busy: boolean; onApply: () => void; onGhost: () => void; slot: string | null;
}) {
  const m = c.m;
  const car = goal === 'car';
  return (
    <div className="wiz-detail">
      <div className="det-head">
        <div>
          <h3>{c.label}</h3>
          <div className="muted">{TYPE_TH[c.type]} · {c.detail} · ลำโพง {m.drivers} ดอก</div>
        </div>
        <div className="det-actions">
          <button className="primary" onClick={onApply} disabled={busy}>เปิดในแล็บ</button>
          <button onClick={onGhost} disabled={busy || !slot} title={slot ? `เก็บแบบนี้เป็น ${slot} ไว้เทียบกับตู้ในแล็บ` : 'ช่องเทียบ A, B, C เต็มแล้ว ลบช่องที่ไม่ใช้ในแท็บ "เทียบ A/B/C" ของแล็บก่อน'}>{slot ? `เก็บเทียบเป็น ${slot}` : 'ช่องเทียบเต็ม'}</button>
        </div>
      </div>
      <div className="det-grid">
        <div><span>ปริมาตรสุทธิ</span><b>{m.netL} L</b></div>
        <div><span>ขนาดภายนอก</span><b>{m.dimsCm.join('×')} ซม.</b></div>
        <div><span>{car ? 'F3 ในรถ' : 'F3'}</span><b>{hz(m.f3)}</b></div>
        <div><span>{car ? 'F10 ในรถ' : 'F10'}</span><b>{hz(m.f10)}</b></div>
        <div><span>ดังเฉลี่ย {Math.round(band[0])}–{Math.round(band[1])} Hz</span><b>{m.loud.toFixed(1)} dB</b></div>
        <div><span>ยอดดังสุด</span><b>{m.peak.db.toFixed(1)} dB @ {m.peak.f.toFixed(0)} Hz</b></div>
        <div><span>ความดังติดที่</span><b>{LIMIT_TH[m.limitedBy]}</b></div>
        <div><span>ลมในท่อสูงสุด</span><b>{m.portMs ? `${m.portMs.toFixed(1)} m/s` : 'ไม่มีท่อ'}</b></div>
        <div><span>Group delay สูงสุด</span><b>{m.gdCycles.toFixed(2)} รอบ</b></div>
        <div><span>{c.type === 'bp4' || c.type === 'bp6' ? 'ยุบกลางช่วง / ห่างยอด' : 'ยอดโป่งเหนือระดับ'}</span><b>{m.uneven.toFixed(1)} dB</b></div>
        <div><span>กำลังที่ใช้คิด</span><b>{m.watts} W</b></div>
      </div>
      {!xmax && <div className="fit free">ลำโพงนี้ไม่มีค่า Xmax ระดับดังสุดจึงยังไม่รวมขีดจำกัดระยะชัก</div>}
      {!!c.flags.length && (
        <ul className="wiz-notes">{c.flags.map((f) => <li key={f}>{SUGGEST_FLAG_TEXT[f]}</li>)}</ul>
      )}
    </div>
  );
}
