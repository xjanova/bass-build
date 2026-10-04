import { LEVEL_COLOR, LEVEL_TH, type Conf } from '../sim/confidence';

/** The confidence badge (plan §0): a coloured dot whose tooltip says the level and why. */
export function ConfDot({ conf, size = 6 }: { conf: Conf | null | undefined; size?: number }) {
  if (!conf) return null;
  const text = `${LEVEL_TH[conf.level]} — ${conf.why}`;
  return <span className="conf" role="img" aria-label={text} title={text} style={{ background: LEVEL_COLOR[conf.level], width: size, height: size }} />;
}

/** Dot plus the level's name, for places with room to say it. */
export function ConfTag({ conf }: { conf: Conf | null | undefined }) {
  if (!conf) return null;
  return (
    <span className="conf-tag" title={conf.why} style={{ color: LEVEL_COLOR[conf.level] }}>
      <ConfDot conf={conf} />{LEVEL_TH[conf.level]}
    </span>
  );
}
