// Generates data/seed/drivers.sample.json from a small set of base parameters so that every
// stored Thiele/Small value is self-consistent (except one deliberate error used to test the
// consistency checker). Run: node data/seed/gen-sample-drivers.js
const fs = require('fs');
const path = require('path');

const RHO = 1.18, C = 343, RC2 = RHO * C * C, TAU = 2 * Math.PI;
// model, sizeIn, category, kindTh, fs, mms(kg), sd(m2), re, qes, qms, leMh, xmaxMm, peW, zNom, cutoutMm, outerMm, depthMm, displacementL
const base = [
  ['SPL-15', 15, 'sub', 'ซับรถยนต์', 32, 0.25, 0.0855, 3.4, 0.419, 6.0, 1.8, 19, 1000, 4, 355, 394, 190, 6.0],
  ['SPL-12', 12, 'sub', 'ซับรถยนต์', 34, 0.19, 0.0507, 3.5, 0.5, 5.5, 1.5, 16, 600, 4, 280, 310, 160, 3.2],
  ['PA-18', 18, 'pa', 'กลางแจ้ง / รถแห่', 35, 0.2, 0.1225, 5.2, 0.34, 7.0, 1.2, 9, 1200, 8, 420, 460, 180, 7.5],
  ['PA-21', 21, 'pa', 'กลางแจ้ง / รถแห่', 30, 0.38, 0.159, 5.1, 0.37, 8.0, 1.6, 16, 1800, 8, 492, 535, 230, 11.0],
  ['HF-10', 10, 'sub', 'ซับบ้าน', 23, 0.085, 0.033, 3.2, 0.46, 4.8, 1.1, 12, 250, 4, 230, 262, 130, 1.6],
  ['HF-8', 8, 'woofer', 'วูฟเฟอร์บ้าน', 29, 0.042, 0.022, 3.3, 0.4, 3.9, 0.7, 8.5, 150, 8, 184, 210, 95, 0.8],
  ['FR-5', 5, 'fullrange', 'ฟูลเรนจ์', 62, 0.0062, 0.0088, 6.2, 0.52, 2.8, 0.12, 4.5, 40, 8, 118, 140, 70, 0.25],
  ['SQ-12', 12, 'sub', 'ซับรถ SQ', 25, 0.21, 0.049, 3.6, 0.72, 4.0, 1.4, 17, 500, 4, 280, 310, 170, 3.5]
];
const r = (v, d) => Number(v.toFixed(d));
const drivers = base.map((b) => {
  const [model, sizeIn, category, kindTh, fs, mms, sd, re, qes, qms, leMh, xmaxMm, peW, zNom, cutoutMm, outerMm, depthMm, displacementL] = b;
  const cms = 1 / (Math.pow(TAU * fs, 2) * mms);
  const vasL = RC2 * sd * sd * cms * 1000;
  const bl = Math.sqrt(TAU * fs * mms * re / qes);
  const rms = TAU * fs * mms / qms;
  const qts = qes * qms / (qes + qms);
  const eta0 = (4 * Math.PI * Math.PI / Math.pow(C, 3)) * Math.pow(fs, 3) * (vasL / 1000) / qes;
  return {
    brand: 'BASS BUILD (ตัวอย่าง)', model, category, kindTh, sizeIn,
    fs, qts: r(qts, 3), qes, qms, vasL: r(vasL, 1), re, leMh, bl: r(bl, 2), mmsG: r(mms * 1000, 1),
    cmsMmPerN: r(cms * 1000, 4), rms: r(rms, 2), sdCm2: r(sd * 1e4, 1), xmaxMm, xmechMm: null, peW,
    splDb: r(112.1 + 10 * Math.log10(eta0), 1), zNom, coil: 'SVC', cutoutMm, outerMm, depthMm, displacementL,
    rthVc: null, tauVc: null, rthMag: null, tauMag: null,
    sourceKind: 'sample', sourceUrl: null, verified: false,
    notes: 'ลำโพงสมมติสำหรับทดสอบระบบ ไม่ใช่สินค้าจริง'
  };
});
// Deliberate inconsistency: stored Qts does not match Qes and Qms. The checker must flag it.
const sq = drivers.find((d) => d.model === 'SQ-12');
sq.qts = 0.52;
sq.notes = 'ลำโพงสมมติ ตั้งค่า Qts ผิดโดยตั้งใจ เพื่อทดสอบตัวตรวจความสอดคล้องของสูตร (ค่าที่ถูกคือ 0.61)';
fs.writeFileSync(path.join(__dirname, 'drivers.sample.json'), JSON.stringify({ drivers }, null, 2) + '\n');
console.log(drivers.map((d) => `${d.model}: Vas ${d.vasL} L, Bl ${d.bl}, SPL ${d.splDb} dB, Qts ${d.qts}`).join('\n'));
