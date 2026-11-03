import { useEffect, useState } from 'react';

/**
 * A number typed freely and applied when it is a valid value in range (on every keystroke that
 * makes it one), so a half-typed "1" on the way to "1500" never snaps back.
 */
export function NumField({ id, label, value, min, max, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText((t) => (Number(t.replace(',', '.')) === value ? t : String(value))); }, [value]);
  const v = Number(text.replace(',', '.'));
  const ok = text.trim() !== '' && Number.isFinite(v) && v >= min && v <= max;
  return (
    <label className={`numfield${ok ? '' : ' bad'}`} htmlFor={id} title={ok ? undefined : `ใส่ ${min}–${max} ${unit}`}>
      <input id={id} inputMode="decimal" aria-label={label} aria-invalid={!ok} value={text}
        onChange={(e) => { setText(e.target.value); const n = Number(e.target.value.replace(',', '.')); if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n); }}
        onBlur={() => { if (!ok) setText(String(value)); }} />
      <span>{unit}</span>
    </label>
  );
}
