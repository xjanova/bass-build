/** Stroke icons drawn on a 24×24 grid; colour follows currentColor. */
export const ICONS = {
  select: 'M5 3l14 8-6 2-2 6z',
  box: 'M12 2l9 5v10l-9 5-9-5V7z M12 12l9-5 M12 12v10 M12 12L3 7',
  drill: 'M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0z M12 2v4 M12 18v4 M2 12h4 M18 12h4',
  port: 'M3 15h18v5H3z M12 4v8 M9 9l3 3 3-3',
  divider: 'M4 4h16v16H4z M12 4v16',
  brace: 'M4 4h16v16H4z M8 8h8v8H8z',
  fill: 'M6 17a4 4 0 0 1 0.5-8A5.5 5.5 0 0 1 17 8a4.5 4.5 0 0 1 1 9z',
  measure: 'M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2',
  mic: 'M9 3h6v10H9z M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8',
  smoke: 'M4 16c3 0 3-3 6-3s3 3 6 3 M6 11c2 0 2-2 4-2s2 2 4 2 M8 20c2 0 2-2 4-2s2 2 4 2',
  wave: 'M2 12c2.5-5 5-5 7.5 0s5 5 7.5 0 3.5-4 5-2',
  air: 'M3 8h10a3 3 0 1 0-3-3 M3 12h15a3 3 0 1 1-3 3 M3 16h7',
  cloud: 'M6 18c-2 0-3-1.5-3-3s1.5-3 3-3c0-3 2-5 5-5s5 2 5 5c2 0 3.5 1.5 3.5 3S18 18 16 18z',
  ir: 'M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z M12 9v6',
  vib: 'M4 7v10 M8 4v16 M12 7v10 M16 4v16 M20 7v10',
  balloon: 'M12 3a9 9 0 1 0 0.01 0z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
  xray: 'M4 4h16v16H4z M4 4l16 16 M20 4L4 20',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14 M16 5v14',
  alert: 'M12 3l10 18H2z M12 10v5 M12 18v0.5'
} as const;

export function Icon({ name, size = 18, width = 1.7 }: { name: keyof typeof ICONS; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <circle cx="15" cy="15" r="13" stroke="#22d3ee" strokeWidth="1.6" />
      <circle cx="15" cy="15" r="8.5" stroke="#22d3ee" strokeOpacity="0.55" strokeWidth="1.4" />
      <circle cx="15" cy="15" r="3.4" fill="#22d3ee" />
    </svg>
  );
}
