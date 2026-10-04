"""Checks collected datasheet drivers and writes data/seed/drivers.json.

    python data/seed/merge_drivers.py <collected.json> [<collected.json> ...]

Each input is {"drivers": [...]} in the app's units (see drivers.sample.json). A record is kept when
it has the required fields, sane ranges and an https source; records whose parameters disagree
with each other by more than 30 % (usually a unit slip such as ft³ left as litres) are rejected
and listed for a manual look. Smaller disagreements are kept — the app flags them as
"ค่าขัดกัน", because many datasheets really are a few percent inconsistent.
Existing entries in drivers.json are kept first, in their order (the web build numbers drivers by
position), and new ones are appended.
"""
import json
import math
import sys
from pathlib import Path

SEED = Path(__file__).resolve().parent / 'drivers.json'
CATEGORIES = {'sub', 'woofer', 'mid', 'fullrange', 'pa', 'tweeter'}
RHO_C2 = 1.2041 * 343.24 ** 2  # Pa, air at 20 °C (packages/physics/src/air.ts)
KEYS = ['brand', 'model', 'category', 'kindTh', 'sizeIn', 'fs', 'qts', 'qes', 'qms', 'vasL', 're', 'leMh', 'bl', 'mmsG',
        'cmsMmPerN', 'rms', 'sdCm2', 'xmaxMm', 'xmechMm', 'peW', 'splDb', 'zNom', 'coil', 'coilWiring', 'cutoutMm', 'outerMm', 'depthMm',
        'displacementL', 'rthVc', 'tauVc', 'rthMag', 'tauMag', 'shape', 'imageUrl', 'sourceKind', 'sourceUrl', 'verified', 'notes']
RANGES = {'fs': (1, 20000), 'qts': (0.05, 10), 'qes': (0.05, 10), 'qms': (0.2, 100), 'vasL': (0.01, 20000), 're': (0.1, 100),
          'sdCm2': (1, 20000), 'xmaxMm': (0, 100), 'peW': (0, 100000), 'sizeIn': (0.5, 30), 'mmsG': (0.1, 5000),
          'cmsMmPerN': (0.001, 50), 'bl': (0.1, 100), 'leMh': (0.001, 50), 'splDb': (60, 120)}


def num(d, k):
    v = d.get(k)
    return v if isinstance(v, (int, float)) and v > 0 and math.isfinite(v) else None


def checks(d):
    """(name, stored, computed) for every relation the record has enough data for."""
    out = []
    fs, qts, qes, qms = num(d, 'fs'), num(d, 'qts'), num(d, 'qes'), num(d, 'qms')
    vas, sd, cms, mms, re, bl = num(d, 'vasL'), num(d, 'sdCm2'), num(d, 'cmsMmPerN'), num(d, 'mmsG'), num(d, 're'), num(d, 'bl')
    if qts and qes and qms:
        out.append(('Qts', qts, qes * qms / (qes + qms)))
    if vas and sd and cms:
        out.append(('Vas', vas, RHO_C2 * (sd * 1e-4) ** 2 * (cms * 1e-3) * 1000))
    if fs and mms and cms:
        out.append(('Fs', fs, 1 / (2 * math.pi * math.sqrt(mms * 1e-3 * cms * 1e-3))))
    if qes and fs and mms and re and bl:
        out.append(('Qes', qes, 2 * math.pi * fs * mms * 1e-3 * re / bl ** 2))
    return out


def problems(d):
    p = []
    for k in ('brand', 'model'):
        if not isinstance(d.get(k), str) or not d[k].strip():
            p.append(f'missing {k}')
    if d.get('category') not in CATEGORIES:
        p.append(f"bad category {d.get('category')!r}")
    if not num(d, 'fs'):
        p.append('missing fs')
    if not str(d.get('sourceUrl') or '').startswith('https://'):
        p.append('sourceUrl must be https')
    if d.get('imageUrl') and not str(d['imageUrl']).startswith('https://'):
        p.append('imageUrl must be https (a link to the photo, never a copy)')
    for k, (lo, hi) in RANGES.items():
        v = d.get(k)
        if v is not None and (not isinstance(v, (int, float)) or not lo <= v <= hi):
            p.append(f'{k}={v} outside {lo}–{hi}')
    if not (num(d, 're') and num(d, 'sdCm2') and (num(d, 'vasL') or num(d, 'cmsMmPerN')) and (num(d, 'qes') or (num(d, 'qts') and num(d, 'qms')))):
        p.append('not enough T/S to simulate (needs Fs, Re, Sd, Vas or Cms, Qes or Qts+Qms)')
    for name, stored, computed in checks(d):
        if abs(stored - computed) / computed > 0.30:
            p.append(f'{name} {stored:.4g} vs {computed:.4g} from the other values (>30 %, unit slip?)')
    return p


def main(paths):
    existing = json.loads(SEED.read_text(encoding='utf-8')) if SEED.exists() else {'drivers': []}
    kept = list(existing.get('drivers', []))
    seen = {(d['brand'].lower(), d['model'].lower()) for d in kept}
    rejected, flagged, added = [], 0, 0
    for path in paths:
        for d in json.loads(Path(path).read_text(encoding='utf-8')).get('drivers', []):
            rec = {k: d.get(k) for k in KEYS}
            rec['sourceKind'], rec['verified'] = 'datasheet', False
            if isinstance(rec.get('brand'), str):
                rec['brand'], rec['model'] = rec['brand'].strip(), str(rec.get('model') or '').strip()
            bad = problems(rec)
            key = (str(rec.get('brand')).lower(), str(rec.get('model')).lower())
            if bad:
                rejected.append(f"{rec.get('brand')} {rec.get('model')} ({Path(path).name}): {'; '.join(bad)}")
                continue
            if key in seen:
                continue
            seen.add(key)
            if any(abs(s - c) / c > 0.05 for _, s, c in checks(rec)):
                flagged += 1
            kept.append(rec)
            added += 1
    existing['drivers'] = kept
    SEED.write_text(json.dumps(existing, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{SEED.name}: {len(kept)} drivers ({added} added, {flagged} with >5 % inconsistencies kept and flagged in the app)')
    if rejected:
        print(f'rejected {len(rejected)}:')
        for r in rejected:
            print('  -', r)


if __name__ == '__main__':
    main(sys.argv[1:])
