import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface Series {
  values: number[];
  color: string;
  dashed?: boolean;
  fill?: boolean;
  glow?: boolean;
}

interface Props {
  freqs: number[];
  series: Series[];
  yMin: number;
  yMax: number;
  title: string;
  unit: string;
  thresholds?: { value: number; color: string }[];
  marker?: { f: number; label: string } | null;
  big?: boolean;
  /** Text under the cursor at sample i; defaults to the first series' value. */
  readout?: (i: number) => string;
}

const F_MIN = 10;
const F_MAX = 500;
const X_TICKS = [10, 20, 50, 100, 200, 500];

/** Log-frequency line chart drawn as SVG so it stays sharp at any size. */
export function LineChart({ freqs, series, yMin, yMax, title, unit, thresholds = [], marker, big, readout }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 150 });
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(60, e.contentRect.width - 36), h: Math.max(40, e.contentRect.height - 22) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const fx = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
  const fy = (y: number) => h - ((Math.min(yMax, Math.max(yMin, y)) - yMin) / (yMax - yMin)) * h;

  const paths = useMemo(() => series.map((s) => {
    // A value that is not a finite number (NaN) breaks the line: segments can be drawn separately.
    let d = '';
    let pen = false;
    for (let i = 0; i < freqs.length; i++) {
      const v = s.values[i];
      if (freqs[i] < F_MIN || freqs[i] > F_MAX || !Number.isFinite(v)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${fx(freqs[i]).toFixed(1)} ${fy(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  }), [series, freqs, w, h, yMin, yMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200].find((v) => (yMax - yMin) / v <= 5) ?? 500;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) yTicks.push(v);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = F_MIN * Math.pow(F_MAX / F_MIN, (e.clientX - rect.left) / rect.width);
    let best = 0;
    for (let i = 1; i < freqs.length; i++) if (Math.abs(freqs[i] - f) < Math.abs(freqs[best] - f)) best = i;
    setHover(best);
  };
  const main = series[0];

  return (
    <div className={`chart${big ? ' big' : ''}`} ref={box}>
      <svg width={w} height={h} role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={main?.color} stopOpacity="0.28" />
            <stop offset="1" stopColor={main?.color} stopOpacity="0" />
          </linearGradient>
          <filter id={`g${id}`} x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect x="0" y="0" width={w} height={h} rx="4" fill="rgba(2,6,12,0.4)" stroke="rgba(148,163,184,0.12)" />
        <path
          d={X_TICKS.map((f) => `M${fx(f).toFixed(1)} 0V${h}`).join('') + yTicks.map((v) => `M0 ${fy(v).toFixed(1)}H${w}`).join('')}
          stroke="rgba(148,163,184,0.1)" fill="none"
        />
        {main?.fill && paths[0] && <path d={`${paths[0]}L${w} ${h}L0 ${h}Z`} fill={`url(#f${id})`} />}
        {thresholds.map((t) => <path key={t.value} d={`M0 ${fy(t.value).toFixed(1)}H${w}`} stroke={t.color} strokeDasharray="4 4" fill="none" />)}
        {marker && <path d={`M${fx(marker.f).toFixed(1)} 0V${h}`} stroke="#f8fafc" strokeOpacity="0.55" strokeDasharray="2 3" fill="none" />}
        {series.map((s, i) => (
          <path key={i} d={paths[i]} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.4 : big ? 2 : 1.8}
            strokeDasharray={s.dashed ? '5 4' : undefined} strokeOpacity={s.dashed ? 0.6 : 1} filter={s.glow ? `url(#g${id})` : undefined} />
        ))}
        {hover !== null && <path d={`M${fx(freqs[hover]).toFixed(1)} 0V${h}`} stroke="rgba(226,232,240,0.35)" fill="none" />}
      </svg>
      <div className="title">{title}</div>
      {yTicks.map((v) => <div key={v} className="ylab" style={{ top: fy(v) - 7 }}>{Math.round(v)}</div>)}
      {X_TICKS.map((f) => <div key={f} className="xlab" style={{ left: 36 + fx(f), top: h + 3 }}>{f}</div>)}
      {marker && <div className="mark" style={{ left: 40 + fx(marker.f) }}>{marker.label}</div>}
      {hover !== null && main && (
        <div className="readout">{freqs[hover].toFixed(freqs[hover] < 100 ? 1 : 0)} Hz · {readout ? readout(hover) : Number.isFinite(main.values[hover]) ? `${main.values[hover].toFixed(1)} ${unit}` : '—'}</div>
      )}
    </div>
  );
}
