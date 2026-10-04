import { describe, expect, it } from 'vitest';
import { blankDriver, parseCsv, parseNumber, parseWdr, toCsv } from '../src/data/importers';
import { derive, suitability, validateDraft } from '../src/data/library';
import type { DriverDto } from '../src/data/types';

// A real WinISD file (Dayton Audio UM15-22 as shipped in the MWisBest/WinISDDrivers collection), trimmed.
const WDR = `[Driver]
Brand=Dayton Audio
Model=Ultimax UM15-22
Comment=
Qts=0.472934091669455
Znom=2
Fs=19.5
Pe=800
SPL=86.5422191138038
Re=0.85
Le=0.00131
BL=7.03004245277836
Xmax=0.019
Cms=0.000238327005328752
Qms=2.4
Qes=0.589
Rms=14.2692459151731
Mms=0.279510279580754
Sd=0.08146
Vas=0.22434
Dia=0
numVC=2
Depth=0.192
Outer=0.388
DVol=0.00588013482607418
`;

describe('WinISD .wdr import', () => {
  const { drivers, warnings } = parseWdr(WDR, 'UM15-22.wdr');
  const d = drivers[0];

  it('converts SI units to the app units', () => {
    expect(warnings).toEqual([]);
    expect(d.brand).toBe('Dayton Audio');
    expect(d.model).toBe('Ultimax UM15-22');
    expect(d.vasL).toBeCloseTo(224.34, 2);
    expect(d.sdCm2).toBeCloseTo(814.6, 1);
    expect(d.xmaxMm).toBeCloseTo(19, 6);
    expect(d.leMh).toBeCloseTo(1.31, 6);
    expect(d.mmsG).toBeCloseTo(279.51, 2);
    expect(d.cmsMmPerN).toBeCloseTo(0.2383, 4);
    expect(d.outerMm).toBeCloseTo(388, 6);
    expect(d.displacementL).toBeCloseTo(5.88, 2);
    expect(d.coil).toBe('DVC');
    expect(d.sizeIn).toBe(15);
    expect(d.category).toBe('sub');
  });

  it('keeps zeros (WinISD for "unknown") out of the record', () => {
    expect(parseWdr('[Driver]\nFs=30\nXmax=0\nQts=0.4').drivers[0].xmaxMm).toBeNull();
  });

  it('agrees with WinISD on sensitivity from the same parameters', () => {
    expect(derive(d).spl1w!).toBeCloseTo(86.54, 0);
  });

  it('refuses a file without Fs', () => {
    const r = parseWdr('[Driver]\nBrand=X\nModel=Y\nQts=0.4', 'y.wdr');
    expect(r.drivers).toEqual([]);
    expect(r.warnings[0]).toContain('Fs');
  });
});

describe('CSV import / export', () => {
  it('reads quoted cells, comma decimals and Thai headers, and skips rows without Fs', () => {
    const csv = 'ยี่ห้อ;รุ่น;Fs;Qts;Vas;Sd\n"Acme; Inc";AC-8;38;0,38;22;214\nAcme;NoFs;;0,4;;\n';
    const r = parseCsv(csv);
    expect(r.drivers).toHaveLength(1);
    expect(r.drivers[0]).toMatchObject({ brand: 'Acme; Inc', model: 'AC-8', fs: 38, qts: 0.38, vasL: 22, sdCm2: 214 });
    expect(r.warnings.some((w) => w.includes('แถว 3'))).toBe(true);
  });

  it('round-trips through toCsv', () => {
    const d = { ...blankDriver(), brand: 'Brand, "Q"', model: 'M-1', fs: 31, qts: 0.41, vasL: 55, notes: 'two\nlines' };
    const back = parseCsv(toCsv([d])).drivers[0];
    expect(back).toMatchObject({ brand: 'Brand, "Q"', model: 'M-1', fs: 31, qts: 0.41, vasL: 55 });
  });

  it('keeps formula-looking names as text in Excel and reads them back unchanged', () => {
    const d = { ...blankDriver(), brand: '=HYPERLINK("x")', model: '@SUM(A1)', fs: 31 };
    const csv = toCsv([d]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`'@SUM(A1)`);
    expect(parseCsv(csv).drivers[0]).toMatchObject({ brand: '=HYPERLINK("x")', model: '@SUM(A1)' });
  });

  it('flags SI-looking Vas/Sd instead of silently using them', () => {
    expect(parseCsv('brand,model,fs,vas,sd\nA,B,30,0.06,0.05\n').warnings.join(' ')).toContain('SI');
  });

  it('parses numbers defensively', () => {
    expect(parseNumber(' 0,39 ')).toBe(0.39);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('-3')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

describe('driver checks', () => {
  const base = { ...blankDriver(), brand: 'Test', model: 'T-12', fs: 28, qts: 0.41, qms: 5.2, vasL: 62, re: 3.6, sdCm2: 480 };
  const existing = [{ ...base, id: 1 } as DriverDto];

  it('derives what a datasheet leaves out and marks it as derived', () => {
    const der = derive(base);
    expect(der.missing).toEqual([]);
    expect(der.values.qes!.derived).toBe(true);
    expect(der.values.qes!.v).toBeCloseTo((0.41 * 5.2) / (5.2 - 0.41), 6);
    expect(der.values.fs!.derived).toBe(false);
  });

  it('says what is missing when it cannot', () => {
    expect(derive({ ...blankDriver(), fs: 30 }).missing.length).toBeGreaterThan(0);
  });

  it('validates required fields, ranges and duplicates in Thai', () => {
    expect(validateDraft({ ...base, brand: ' ' }, [], null)?.field).toBe('brand');
    expect(validateDraft({ ...base, xmaxMm: 150 }, [], null)?.message).toContain('Xmax');
    expect(validateDraft({ ...base, brand: 'test', model: 't-12' }, existing, null)?.field).toBe('model');
    expect(validateDraft(base, existing, 1)).toBeNull(); // editing itself is not a duplicate
  });

  it('recommends boxes from EBP and Qts', () => {
    expect(suitability(30, 0.5)?.tone).toBe('sealed');
    expect(suitability(120, 0.3)?.tone).toBe('vented');
    expect(suitability(70, 0.4)?.tone).toBe('both');
    expect(suitability(20, 0.9)?.tone).toBe('free');
  });
});
