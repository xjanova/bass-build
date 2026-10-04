import { useEffect, useMemo, useRef, useState } from 'react';
import { ANGLES, deleteMedia, listMedia, putMedia, type Angle, type Marks, type MediaItem } from '../data/media';
import { circleFrom3, shrinkPhoto } from '../data/photos';
import type { DriverDto } from '../data/types';
import { resolveShape, type ResolvedShape } from '../sim/driverShape';
import { useApp } from '../state/store';

/** Object URLs for blobs, revoked when the blobs change or the component goes. */
function useObjectUrls(items: MediaItem[]): Partial<Record<Angle, string>> {
  const urls = useMemo(() => Object.fromEntries(items.map((m) => [m.angle, URL.createObjectURL(m.blob)])) as Partial<Record<Angle, string>>, [items]);
  useEffect(() => () => Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return urls;
}

/** The driver's photos, reloaded whenever any photo is saved anywhere in the app. */
export function useDriverMedia(driverId: number | null): MediaItem[] {
  const { driversSource, mediaVersion } = useApp();
  const [items, setItems] = useState<MediaItem[]>([]);
  useEffect(() => {
    if (driverId === null || driversSource === 'loading') { setItems([]); return; }
    const ctrl = new AbortController();
    listMedia(driverId, driversSource, ctrl.signal).then((m) => { if (!ctrl.signal.aborted) setItems(m); }).catch(() => {});
    return () => ctrl.abort();
  }, [driverId, driversSource, mediaVersion]);
  return items;
}

/** Picture of a driver for the library: the user's 45° or front photo, else the maker's photo by link. */
export function DriverPicture({ d, media }: { d: DriverDto; media: MediaItem[] }) {
  const urls = useObjectUrls(media);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [d.imageUrl]);
  const own = urls.angle ?? urls.front;
  if (own) return <figure className="drv-pic"><img src={own} alt={`${d.brand} ${d.model}`} /><figcaption>รูปถ่ายของคุณ</figcaption></figure>;
  if (d.imageUrl && /^https:\/\//i.test(d.imageUrl) && !broken) {
    return (
      <figure className="drv-pic">
        <img src={d.imageUrl} alt={`${d.brand} ${d.model}`} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
        <figcaption>ภาพจากผู้ผลิต (แสดงจากลิงก์ต้นทาง) {d.sourceUrl && /^https?:\/\//i.test(d.sourceUrl) ? <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer">ที่มา ↗</a> : null}</figcaption>
      </figure>
    );
  }
  return null;
}

/**
 * The four photos a driver's 3D model is built from, each with how to take it and, where the
 * model needs one, a step to mark the circle (or axis) on it.
 */
export function PhotoPanel({ d, media }: { d: DriverDto; media: MediaItem[] }) {
  const { driversSource, bumpMedia, showToast } = useApp();
  const urls = useObjectUrls(media);
  const [marking, setMarking] = useState<{ angle: Angle; blob: Blob; marks: Marks | null; isNew: boolean } | null>(null);
  const [askDelete, setAskDelete] = useState<Angle | null>(null);
  const [busy, setBusy] = useState<Angle | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const picking = useRef<Angle>('front');
  const byAngle = Object.fromEntries(media.map((m) => [m.angle, m])) as Partial<Record<Angle, MediaItem>>;

  const pick = (angle: Angle) => { picking.current = angle; input.current?.click(); };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const angle = picking.current;
    if (!/^image\//.test(file.type)) { showToast('ไฟล์นี้ไม่ใช่รูปภาพ'); return; }
    setBusy(angle);
    try {
      const blob = await shrinkPhoto(file);
      const a = ANGLES.find((x) => x.id === angle)!;
      if (a.mark) setMarking({ angle, blob, marks: null, isNew: true });
      else await save(angle, blob, null);
    } catch {
      showToast('เปิดรูปนี้ไม่ได้ ลองไฟล์ JPEG หรือ PNG');
    } finally {
      setBusy(null);
    }
  };
  const save = async (angle: Angle, blob: Blob, marks: Marks | null) => {
    setBusy(angle);
    const r = await putMedia(d.id, angle, blob, marks, driversSource);
    setBusy(null);
    if (!r.ok) { showToast(r.message); return false; }
    bumpMedia();
    showToast(`บันทึกรูป${ANGLES.find((x) => x.id === angle)!.title}แล้ว · ดูในแล็บได้เลย (ผิวหน้าลำโพง${angle === 'front' ? '' : ' / แม่เหล็กในโหมดเอ็กซเรย์'})`);
    return true;
  };
  const remove = async (angle: Angle) => {
    setAskDelete(null);
    if (!(await deleteMedia(d.id, angle, driversSource))) { showToast('ลบรูปไม่สำเร็จ'); return; }
    bumpMedia();
  };

  return (
    <div className="photos">
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {ANGLES.map((a) => {
        const m = byAngle[a.id];
        const needsMarks = a.mark && m && !(a.mark === 'circle' ? m.marks?.circle?.length === 3 : m.marks?.axis?.length === 2);
        return (
          <div key={a.id} className={`photo-slot${m ? ' has' : ''}`}>
            <div className="photo-thumb">
              {m && urls[a.id] ? <img src={urls[a.id]} alt={`รูป${a.title}`} /> : <AngleGuide angle={a.id} />}
            </div>
            <div className="photo-text">
              <b>{a.title}</b>
              <span className="muted">{a.use}</span>
              {needsMarks && <span className="photo-warn">ยังไม่ได้จิ้มจุด จึงยังไม่ใช้กับโมเดล</span>}
              <details><summary>วิธีถ่าย</summary><p>{a.how}</p>{a.markHow && <p>จากนั้น{a.markHow}</p>}</details>
              <div className="photo-act">
                <button type="button" onClick={() => pick(a.id)} disabled={busy !== null}>{busy === a.id ? 'กำลังบันทึก…' : m ? 'เปลี่ยนรูป' : 'ใส่รูป'}</button>
                {m && a.mark && <button type="button" onClick={() => setMarking({ angle: a.id, blob: m.blob, marks: m.marks, isNew: false })}>จิ้มจุดใหม่</button>}
                {m && (askDelete === a.id
                  ? <span className="nb-confirm">ลบรูปนี้? <button className="danger" onClick={() => remove(a.id)}>ลบ</button><button onClick={() => setAskDelete(null)}>ยกเลิก</button></span>
                  : <button type="button" className="linkbtn" onClick={() => setAskDelete(a.id)}>ลบ</button>)}
              </div>
            </div>
          </div>
        );
      })}
      {marking && (
        <MarkDialog angle={marking.angle} blob={marking.blob} initial={marking.marks}
          onCancel={() => setMarking(null)}
          onDone={async (marks) => { if (await save(marking.angle, marking.blob, marks)) setMarking(null); }} />
      )}
    </div>
  );
}

/** Tap the points the model is aligned by: three on a circle (front rim, magnet back) or two on the axis (side). */
function MarkDialog({ angle, blob, initial, onCancel, onDone }: { angle: Angle; blob: Blob; initial: Marks | null; onCancel: () => void; onDone: (m: Marks) => void }) {
  const a = ANGLES.find((x) => x.id === angle)!;
  const need = a.mark === 'circle' ? 3 : 2;
  const [pts, setPts] = useState<[number, number][]>(() => (a.mark === 'circle' ? initial?.circle : initial?.axis) ?? []);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const circle = size && pts.length === 3 ? circleFrom3(...(pts.map(([x, y]) => [x * size.w, y * size.h]) as [[number, number], [number, number], [number, number]])) : null;
  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p: [number, number] = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    setPts((old) => (old.length >= need ? [p] : [...old, p]));
  };
  const ready = pts.length === need && (a.mark !== 'circle' || !!circle);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="markbox glass" role="dialog" aria-modal="true" aria-labelledby="mark-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="mark-title">จิ้มจุดบนรูป{a.title}</h3>
        <p className="muted">{a.markHow} ({pts.length}/{need}) · แตะอีกครั้งหลังครบเพื่อเริ่มใหม่</p>
        <div className="mark-stage" onClick={tap} role="button" aria-label={`จิ้มจุดบนรูป ${a.markHow}`} tabIndex={0}>
          <img src={url} alt="" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} draggable={false} />
          {size && (
            <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
              {circle && <circle cx={circle.cx} cy={circle.cy} r={circle.r} fill="none" stroke="#22d3ee" strokeWidth={Math.max(2, size.w / 300)} />}
              {a.mark === 'axis' && pts.length === 2 && <line x1={pts[0][0] * size.w} y1={pts[0][1] * size.h} x2={pts[1][0] * size.w} y2={pts[1][1] * size.h} stroke="#22d3ee" strokeWidth={Math.max(2, size.w / 300)} />}
              {pts.map(([x, y], i) => <circle key={i} cx={x * size.w} cy={y * size.h} r={Math.max(6, size.w / 90)} fill="#f472b6" stroke="#fff" strokeWidth={Math.max(1.5, size.w / 500)} />)}
            </svg>
          )}
        </div>
        {pts.length === 3 && !circle && <p className="photo-warn">สามจุดเกือบอยู่ในแนวเดียวกัน ลองจิ้มให้กระจายรอบวง</p>}
        <div className="row">
          <button className="primary" disabled={!ready} onClick={() => onDone(a.mark === 'circle' ? { circle: pts } : { axis: pts })}>ใช้จุดนี้</button>
          <button onClick={() => setPts([])}>เริ่มใหม่</button>
          <button onClick={onCancel}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

/** Small drawings of each camera position, shown in an empty photo slot. */
function AngleGuide({ angle }: { angle: Angle }) {
  const s = { stroke: '#67e8f9', fill: 'none', strokeWidth: 2 } as const;
  return (
    <svg viewBox="0 0 80 60" aria-hidden="true">
      {angle === 'front' && <><circle cx="40" cy="30" r="22" {...s} /><circle cx="40" cy="30" r="15" {...s} strokeOpacity={0.6} /><circle cx="40" cy="30" r="6" {...s} /></>}
      {angle === 'rear' && <><circle cx="40" cy="30" r="22" {...s} strokeOpacity={0.4} /><circle cx="40" cy="30" r="12" {...s} /><path d="M34 30h12" {...s} /></>}
      {angle === 'side' && <><path d="M18 10v40M18 14l20 6v20l-20 6" {...s} /><rect x="38" y="20" width="22" height="20" {...s} /></>}
      {angle === 'angle' && <><ellipse cx="34" cy="30" rx="12" ry="22" {...s} /><path d="M34 8l24 8v28l-24 8" {...s} strokeOpacity={0.6} /></>}
    </svg>
  );
}

/** Cross-section of the driver drawn from its shape, with the letters of the fields to measure. */
export function DriverProfile({ d }: { d: DriverDto }) {
  const s: ResolvedShape = resolveShape(d);
  const W = 240, H = 150, pad = 14;
  const k = Math.min((W - 2 * pad) / (2 * s.outerR), (H - 2 * pad - 10) / (s.depth + s.flange + 0.01));
  const x = (r: number) => W / 2 + r * k;
  const y = (z: number) => pad + (s.flange - z) * k; // z = flange top at the top of the drawing
  const top = s.flange * 0.6;
  const coneIn = s.coneR - s.surroundW / 2;
  const half = (sign: 1 | -1) => [
    `M${x(sign * s.outerR)} ${y(s.flange)} L${x(sign * s.outerR)} ${y(0)} L${x(sign * (s.coneR + s.surroundW / 2))} ${y(0)}`,
    `M${x(sign * (s.coneR + s.surroundW / 2))} ${y(top)} Q${x(sign * s.coneR)} ${y(top + s.surroundW * 0.6)} ${x(sign * coneIn)} ${y(top)}`,
    `M${x(sign * coneIn)} ${y(top)} L${x(sign * s.dustcapR)} ${y(top - s.coneDepth)}`,
    `M${x(sign * (s.coneR + s.surroundW / 2) * 0.97)} ${y(0)} L${x(sign * s.magnetR * 0.92)} ${y(-s.depth + s.magnetH)}`
  ].join(' ');
  const capY = y(top - s.coneDepth);
  const t = { fontSize: 10, fill: '#f472b6', fontWeight: 700 } as const;
  return (
    <svg className="drv-profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="ภาพตัดลำโพงตามขนาดที่วัด">
      <g stroke="#94a3b8" strokeWidth="1.4" fill="none">
        <path d={half(1)} /><path d={half(-1)} />
        <path d={`M${x(-s.dustcapR)} ${capY} Q${x(0)} ${capY - s.dustcapR * 0.6 * k} ${x(s.dustcapR)} ${capY}`} />
        <rect x={x(-s.magnetR)} y={y(-s.depth + s.magnetH)} width={2 * s.magnetR * k} height={s.magnetH * k} fill="#334155" />
      </g>
      <text x={x(s.coneR)} y={y(top) - 6} textAnchor="middle" {...t}>A·B</text>
      <text x={x(s.dustcapR) + 4} y={capY - 2} {...t}>C</text>
      <text x={x(coneIn * 0.5) + 6} y={y(top - s.coneDepth / 2)} {...t}>D</text>
      <text x={x(s.outerR) - 2} y={y(s.flange / 2) + 3} textAnchor="end" {...t}>E</text>
      <text x={x(s.magnetR) + 3} y={y(-s.depth + s.magnetH / 2) + 3} {...t}>F·G</text>
      <text x={x(-s.boltR)} y={y(0) + 10} textAnchor="middle" {...t}>H·I</text>
    </svg>
  );
}
