import { AIR_20C, DEFAULT_END_CORRECTION, type Driver, type FillSpec, type MaxOutput, type SimResult } from '@bassbuild/physics';
import type { DriverDto, PanelMaterialDto } from '../data/types';
import type { Design } from '../state/store';
import type { Conf, ResultKey } from './confidence';
import {
  ampLimits, ampOutputOhms, AWG_MM2, COPPER_RHO, isDvc, MAX_PORT_MS, measuredWiring, ratedWatts, thermalAt, wireOhms,
  type BoxGeometry, type WallDamping
} from './model';

/**
 * The formula notebook: every headline number with the formula behind it, the values put in,
 * the unit and where the formula comes from. Built from the same state the lab draws, so the
 * numbers here are the numbers on screen.
 */
export interface Entry {
  id: string;
  group: string;
  title: string;
  /** Symbolic form, e.g. "fc = Fs · √(1 + α)". */
  formula: string;
  /** The same with the current values put in, ending in the result. */
  subst: string;
  value: number | null;
  unit: string;
  ref: string;
  note?: string;
  /** Confidence of the result this entry explains (headline results only). */
  conf?: Conf;
}

export interface NotebookCtx {
  d: Design;
  dto: DriverDto | undefined;
  /** The driver as wired (a DVC already re-expressed for the chosen coil wiring). */
  driver: Driver | null;
  res: SimResult | null;
  geo: BoxGeometry | null;
  material: PanelMaterialDto | undefined;
  wall: WallDamping;
  modes: { side: number; back: number };
  max: MaxOutput | null;
  fill: FillSpec;
  conf: Record<ResultKey, Conf>;
}

/** Up to `sig` significant digits, no trailing zeros, no exponent for everyday sizes. */
export function num(v: number | null | undefined, sig = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(2).replace('e', '×10^');
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return String(Number(v.toFixed(Math.min(8, digits))));
}

const TAU = 2 * Math.PI;
const REF = {
  thiele: 'Thiele, “Loudspeakers in Vented Boxes”, JAES 1971',
  smallClosed: 'Small, “Closed-Box Loudspeaker Systems, Part I”, JAES 1972',
  smallVented: 'Small, “Vented-Box Loudspeaker Systems, Part I”, JAES 1973',
  smallDirect: 'Small, “Direct-Radiator Loudspeaker System Analysis”, JAES 1972',
  keele: 'สูตรประมาณ QB3 ของ D. B. Keele Jr. (ใช้แพร่หลายใน WinISD/ตำรา DIY)',
  geddes: 'Geddes, “An Introduction to Band-Pass Loudspeaker Systems”, JAES 1989',
  beranek: 'Beranek, “Acoustics” (1954) · Levine & Schwinger, Phys. Rev. 1948 (ปลายท่อลอย 0.61r)',
  leissa: 'Leissa, “Vibration of Plates”, NASA SP-160 (1969)',
  gas: 'กฎแก๊สอุดมคติ · Kinsler et al., “Fundamentals of Acoustics”',
  copper: 'IEC 60028: ทองแดงอบอ่อน 1.7241×10⁻⁸ Ω·m ที่ 20 °C · สัมประสิทธิ์อุณหภูมิ 0.00393 /K',
  lumped: 'วงจรเทียบ 3 โดเมน (ไฟฟ้า–กล–อะคูสติก) แก้แบบ nodal ที่ทุกความถี่ (Small 1972; Beranek 1954)',
  piston: 'ลูกสูบแผ่เสียงในครึ่งทรงกลม (half space): p = ωρ|U|/(2πr) · Kinsler et al.'
};

export function buildEntries(ctx: NotebookCtx): Entry[] {
  const { d, dto, driver: dr, res, geo, material, wall, modes, max, fill, conf } = ctx;
  const out: Entry[] = [];
  const add = (e: Entry) => out.push(e);
  const air = AIR_20C;
  const rc2 = air.rho * air.c * air.c;
  const n = d.boxType === 'isobaric' ? 2 : d.count;
  const bp = d.boxType === 'bp4' || d.boxType === 'bp6';
  const sealedLike = d.boxType === 'sealed' || d.boxType === 'isobaric';
  const withFill = d.boxType === 'sealed' || d.boxType === 'vented' || d.boxType === 'pr';
  const g = withFill ? (fill.stuffingGain ?? 0.4) * Math.min(1, Math.max(0, fill.stuffing ?? 0)) : 0;
  const m = res?.metrics;

  // ---- air ---------------------------------------------------------------------------------------
  add({ id: 'rho', group: 'อากาศ', title: 'ความหนาแน่นอากาศ ρ', formula: 'ρ = p / (R·T)', subst: `= 101325 / (287.05 × 293.15) = ${num(air.rho)}`, value: air.rho, unit: 'kg/m³', ref: REF.gas, note: 'อากาศแห้ง 20 °C ระดับน้ำทะเล' });
  add({ id: 'c', group: 'อากาศ', title: 'ความเร็วเสียง c', formula: 'c = 331.3 · √(T / 273.15)', subst: `= 331.3 × √(293.15 / 273.15) = ${num(air.c)}`, value: air.c, unit: 'm/s', ref: REF.gas });

  // ---- driver ------------------------------------------------------------------------------------
  if (dr) {
    const g1 = 'ลำโพง';
    add({ id: 'qts', group: g1, title: 'Q รวมของลำโพง Qts', formula: 'Qts = Qes · Qms / (Qes + Qms)', subst: `= ${num(dr.qes)} × ${num(dr.qms)} / (${num(dr.qes)} + ${num(dr.qms)}) = ${num(dr.qts)}`, value: dr.qts, unit: '', ref: REF.thiele });
    add({ id: 'vas', group: g1, title: 'ปริมาตรเทียบความแข็งช่วงล่าง Vas', formula: 'Vas = ρc² · Sd² · Cms', subst: `= ${num(rc2)} × ${num(dr.sd)}² × ${num(dr.cms)} = ${num(dr.vas * 1000)} L`, value: dr.vas * 1000, unit: 'L', ref: REF.smallClosed });
    add({ id: 'fs', group: g1, title: 'ความถี่เรโซแนนซ์ Fs', formula: 'Fs = 1 / (2π · √(Mms · Cms))', subst: `= 1 / (2π × √(${num(dr.mms)} × ${num(dr.cms)})) = ${num(dr.fs)}`, value: dr.fs, unit: 'Hz', ref: REF.thiele });
    add({ id: 'bl', group: g1, title: 'แรงขับมอเตอร์ Bl', formula: 'Bl = √(2π · Fs · Mms · Re / Qes)', subst: `= √(2π × ${num(dr.fs)} × ${num(dr.mms)} × ${num(dr.re)} / ${num(dr.qes)}) = ${num(dr.bl)}`, value: dr.bl, unit: 'T·m', ref: REF.smallDirect });
    const ebp = dr.fs / dr.qes;
    add({ id: 'ebp', group: g1, title: 'EBP (บอกว่าเหมาะตู้แบบไหน)', formula: 'EBP = Fs / Qes', subst: `= ${num(dr.fs)} / ${num(dr.qes)} = ${num(ebp, 3)}`, value: ebp, unit: '', ref: REF.smallVented, note: 'ต่ำกว่า ~50 เหมาะตู้ปิด · สูงกว่า ~100 เหมาะตู้เปิด แบนด์พาส ฮอร์น' });
    const eta0 = ((4 * Math.PI ** 2) / air.c ** 3) * dr.fs ** 3 * dr.vas / dr.qes;
    add({ id: 'eta0', group: g1, title: 'ประสิทธิภาพอ้างอิง η0', formula: 'η0 = (4π² / c³) · Fs³ · Vas / Qes', subst: `= (4π² / ${num(air.c)}³) × ${num(dr.fs)}³ × ${num(dr.vas)} / ${num(dr.qes)} = ${num(eta0 * 100, 3)} %`, value: eta0 * 100, unit: '%', ref: REF.smallDirect });
    const half = 10 * Math.log10((air.rho * air.c) / (TAU * 4e-10));
    add({ id: 'sens', group: g1, title: 'ความไว 1 W / 1 ม. (ครึ่งทรงกลม)', formula: 'SPL = 10·log10(ρc / (2π·p_ref²)) + 10·log10(η0)', subst: `= ${num(half)} + 10·log10(${num(eta0, 3)}) = ${num(half + 10 * Math.log10(eta0))} dB`, value: half + 10 * Math.log10(eta0), unit: 'dB', ref: REF.smallDirect, note: 'p_ref = 20 µPa · คิดจาก T/S จึงอาจต่างจากตัวเลขโฆษณาของผู้ผลิต' });
    if (dto && isDvc(dto)) {
      const mw = measuredWiring(dto);
      const k = { series: 'อนุกรม', parallel: 'ขนาน', single: 'ขดเดียว' } as const;
      const fRe = (mw.wiring === 'parallel' ? 1 : 1 / 4) * (d.coilWiring === 'series' ? 4 : d.coilWiring === 'single' ? 2 : 1);
      add({
        id: 'dvc', group: g1, title: 'ลำโพงวอยซ์คอยล์คู่ (DVC)',
        formula: 'เทียบกับต่อขนาน: อนุกรม Re×4 Le×4 Bl×2 · ขดเดียว Re×2 Bl×1 · Qes = 2π·Fs·Mms·Re / Bl²',
        subst: `วัดแบบ${k[mw.wiring]}${mw.known ? '' : ' (เดา)'} → ใช้แบบ${k[d.coilWiring]}: Re = ${num(dto.re)} × ${num(fRe)} = ${num(dr.re)} Ω · Qes = ${num(dr.qes)}`,
        value: dr.re, unit: 'Ω', ref: 'คอยล์สองขดบนแกนเดียวถือว่าคัปปลิงสนิท (สัดส่วนเดียวกับที่ datasheet ของ Hertz/Dayton ระบุ)',
        note: d.coilWiring === 'single' ? 'ใช้ขดเดียว: Qes เพิ่มเป็น 2 เท่า และพิกัดกำลังเหลือครึ่งหนึ่ง' : 'อนุกรมกับขนาน Qes เท่ากัน ต่างกันแค่อิมพีแดนซ์'
      });
    }
  }

  // ---- box -------------------------------------------------------------------------------------
  if (dr && res && m) {
    const g2 = 'ตู้';
    if (withFill && g > 0) {
      add({ id: 'vfill', group: g2, title: 'ปริมาตรเสมือนเมื่อยัดใย', formula: 'Vb′ = Vb · (1 + g · s)', subst: `= ${d.vbL} × (1 + ${num(fill.stuffingGain ?? 0.4)} × ${num(fill.stuffing ?? 0)}) = ${num(d.vbL * (1 + g))} L`, value: d.vbL * (1 + g), unit: 'L', ref: 'Leach, “Electroacoustic-analogous circuit models for filled enclosures”, JAES 1989', note: 'g = ปริมาตรที่เพิ่มเมื่อยัดเต็มของใยชนิดนี้ (ประมาณ) · s = สัดส่วนที่ยัด', conf: { level: 'est', why: 'ค่า g ของใยแต่ละชนิดเป็นค่าประมาณจากงานวิจัย' } });
    }
    if (sealedLike || d.boxType === 'bp4') {
      const vasEff = d.boxType === 'isobaric' ? dr.vas / 2 : dr.vas * n;
      const vb = (d.vbL / 1000) * (d.boxType === 'sealed' ? 1 + g : 1);
      const alpha = vasEff / vb;
      const label = d.boxType === 'bp4' ? ' (ห้องหลัง)' : '';
      add({ id: 'alpha', group: g2, title: `อัตราส่วนความแข็ง α${label}`, formula: d.boxType === 'isobaric' ? 'α = (Vas / 2) / Vb' : 'α = n · Vas / Vb', subst: `= ${num(vasEff * 1000)} / ${num(vb * 1000)} = ${num(alpha)}`, value: alpha, unit: '', ref: REF.smallClosed, note: d.boxType === 'isobaric' ? 'ลำโพงประกบคู่ทำตัวเหมือนลำโพงเดียวที่ Vas ครึ่งหนึ่ง' : undefined });
      if (res.info.fc !== undefined) add({ id: 'fc', group: g2, title: `ความถี่เรโซแนนซ์ของระบบ Fc${label}`, formula: 'fc = Fs · √(1 + α)', subst: `= ${num(dr.fs)} × √(1 + ${num(alpha)}) = ${num(res.info.fc)}`, value: res.info.fc, unit: 'Hz', ref: REF.smallClosed, conf: conf.tuning });
      if (res.info.qtc !== undefined) {
        const qtsEff = res.info.qtc / Math.sqrt(1 + alpha);
        add({ id: 'qtc', group: g2, title: `Q ของระบบ Qtc${label}`, formula: "Qtc = Qts′ · √(1 + α)", subst: `= ${num(qtsEff)} × √(1 + ${num(alpha)}) = ${num(res.info.qtc)}`, value: res.info.qtc, unit: '', ref: REF.smallClosed, note: res.info.seriesOhms > 0 ? 'Qts′ รวมผลความต้านทานแอมป์และสายแล้ว (ดูหัวข้อไฟฟ้า)' : 'Qtc 0.707 = Butterworth (เรียบสุด) · 0.5 = transient ดีสุด · มากกว่า 1 = เบสโป่ง' });
        if (sealedLike && res.info.fc !== undefined) {
          const q = res.info.qtc;
          const a = 1 / (q * q) - 2;
          const f3 = res.info.fc * Math.sqrt((a + Math.sqrt(a * a + 4)) / 2);
          add({ id: 'f3sealed', group: g2, title: 'F3 ของตู้ปิดจากสูตรปิด', formula: 'f3 = fc · √[(1/Qtc² − 2 + √((1/Qtc² − 2)² + 4)) / 2]', subst: `= ${num(res.info.fc)} × √[(${num(a)} + √(${num(a)}² + 4)) / 2] = ${num(f3)}`, value: f3, unit: 'Hz', ref: REF.smallClosed, note: `ผลจำลองให้ ${num(m.f3 ?? NaN)} Hz (ต่างกันได้เล็กน้อยจาก Le ความสูญเสีย และ Subsonic)` });
        }
      }
    }
    if (m.f3 !== null) {
      add({ id: 'f3', group: g2, title: 'F3 (จุดตก −3 dB)', formula: 'F3 = ความถี่ต่ำสุดที่ SPL ขึ้นถึง (ระดับอ้างอิง − 3 dB)', subst: `ระดับอ้างอิง ${num(m.referenceSpl)} dB → ${num(m.referenceSpl - 3)} dB ที่ ${num(m.f3)} Hz${m.f3High ? ` · ด้านบนตกที่ ${num(m.f3High)} Hz` : ''}`, value: m.f3, unit: 'Hz', ref: REF.lumped, note: bp ? 'แบนด์พาสใช้ยอดสูงสุดเป็นระดับอ้างอิง' : 'ระดับอ้างอิง = ระดับช่วงกลางเมื่อไม่มี Le และไม่มี Subsonic (ช่วงที่มวลกรวยคุม)', conf: conf.f3 });
    }
    if (d.boxType === 'vented' || d.boxType === 'pr' || d.boxType === 'bp6') {
      const qb3vb = 15 * dr.qts ** 2.87 * dr.vas * n;
      const qb3fb = 0.42 * dr.fs * dr.qts ** -0.9;
      add({ id: 'qb3', group: g2, title: 'ตู้เปิดแนะนำ QB3', formula: 'Vb = 15 · Qts^2.87 · Vas · n · Fb = 0.42 · Fs · Qts^−0.9', subst: `Vb = 15 × ${num(dr.qts)}^2.87 × ${num(dr.vas * n * 1000)} = ${num(qb3vb * 1000)} L · Fb = 0.42 × ${num(dr.fs)} × ${num(dr.qts)}^−0.9 = ${num(qb3fb)} Hz`, value: qb3fb, unit: 'Hz', ref: REF.keele, note: 'สูตรประมาณ ใช้ได้ดีช่วง Qts 0.2–0.5' });
    }
    if (d.boxType === 'bp4') {
      const s = d.vfL / 1000 / (dr.vas * n);
      add({ id: 'geddes', group: g2, title: 'ค่า S ของแบนด์พาส 4th order', formula: 'S = √(Vf / Vas) / (2 · Qts)', subst: `= √(${d.vfL} / ${num(dr.vas * n * 1000)}) / (2 × ${num(dr.qts)}) = ${num(Math.sqrt(s) / (2 * dr.qts))}`, value: Math.sqrt(s) / (2 * dr.qts), unit: '', ref: REF.geddes, note: 'S 0.7 เรียบกว้าง · S 1.0 ดังขึ้นแต่แคบลง' });
    }
    if (m.tuningDip && !sealedLike) {
      add({ id: 'tuning', group: g2, title: 'ความถี่จูนจริง (จุดเว้าอิมพีแดนซ์)', formula: 'Fb ≈ ความถี่ต่ำสุดของอิมพีแดนซ์ระหว่างยอดคู่', subst: `${num(m.tuningDip.ohms)} Ω ที่ ${num(m.tuningDip.f)} Hz${d.boxType !== 'pr' ? ` (ตั้งไว้ ${d.fbHz} Hz)` : ''}`, value: m.tuningDip.f, unit: 'Hz', ref: REF.smallVented, conf: conf.tuning });
    }
    // Ports: Leff = N·A·c² / ((2πFb)²·V) from the port mass resonating with the chamber.
    for (const p of res.info.ports) {
      const v = p.label === 'rear port' ? d.vbL : p.label === 'front port' || d.boxType === 'bp4' ? d.vfL : d.vbL * (1 + g);
      const r = Math.sqrt(p.area / Math.PI);
      const id = p.label === 'rear port' ? 'portLengthRear' : 'portLength';
      add({
        id, group: g2, title: `ความยาวท่อ${p.label === 'rear port' ? 'หลัง' : p.label === 'front port' ? 'หน้า' : ''}`,
        formula: 'L = N·A·c² / ((2π·Fb)² · V) − 1.463·r ,  r = √(A/π)',
        subst: `= ${p.count} × ${num(p.area)} × ${num(air.c)}² / ((2π × ${num(p.tuning)})² × ${num(v / 1000)}) − ${DEFAULT_END_CORRECTION} × ${num(r)} = ${num(p.physicalLength * 100)} ซม.`,
        value: p.physicalLength * 100, unit: 'ซม.', ref: REF.beranek,
        note: 'end correction 1.463r = ปลายติดแผง 0.85r + ปลายลอยในตู้ 0.61r · ท่อสลอตชิดผนังจริงจะสั้นกว่านี้เล็กน้อย', conf: id === 'portLength' ? conf.portLength : undefined
      });
    }
    if (res.info.ports.length) {
      add({ id: 'portVelocity', group: g2, title: 'ความเร็วลมในท่อสูงสุด', formula: 'v = √2 · |U| / A', subst: `${num(m.portVelocityMax.ms)} m/s ที่ ${num(m.portVelocityMax.f)} Hz (${d.watts} W)`, value: m.portVelocityMax.ms, unit: 'm/s', ref: `${REF.lumped} · เกณฑ์ 17 m/s ≈ 5% ของความเร็วเสียง (เริ่มได้ยินเสียงลม)`, conf: conf.portVelocity });
    }
    add({ id: 'excursion', group: g2, title: 'ระยะชักสูงสุด', formula: 'x = √2 · |U| / (ω · Sd)', subst: `${num(m.excursionMax.mm)} มม. ที่ ${num(m.excursionMax.f)} Hz${dto?.xmaxMm ? ` · Xmax ${dto.xmaxMm} มม. (${num((m.excursionMax.mm / dto.xmaxMm) * 100, 3)}%)` : ''}`, value: m.excursionMax.mm, unit: 'มม.', ref: REF.lumped, conf: conf.excursion });
    add({ id: 'splMax', group: g2, title: 'SPL สูงสุดช่วง 15–200 Hz', formula: 'SPL = 20·log10(p / 20 µPa) ,  p = ω·ρ·|ΣU| / (2π·r)', subst: `= ${num(m.splMax)} dB ที่ 1 ม. (${d.watts} W)`, value: m.splMax, unit: 'dB', ref: REF.piston, note: 'ΣU = ผลรวมเชิงเฟสของลมจากกรวย ท่อ และ PR', conf: conf.splMax });
  }

  // ---- electrical --------------------------------------------------------------------------------
  if (dr && res) {
    const g3 = 'ไฟฟ้าและแอมป์';
    const unit = dr.zNom ?? dr.re;
    const zn = res.info.nominalOhms;
    add({ id: 'zload', group: g3, title: 'โหลดรวม (อิมพีแดนซ์ระบุ)', formula: d.wiring === 'parallel' ? 'Z = Zดอก / n (ขนาน)' : 'Z = Zดอก × n (อนุกรม)', subst: `= ${num(unit)} ${d.wiring === 'parallel' ? '/' : '×'} ${n} = ${num(zn)} Ω`, value: zn, unit: 'Ω', ref: 'กฎของโอห์ม' });
    add({ id: 'volts', group: g3, title: 'แรงดันขับ', formula: 'V = √(P · Z)', subst: `= √(${d.watts} × ${num(zn)}) = ${num(res.info.totalVolts)} V RMS`, value: res.info.totalVolts, unit: 'V', ref: 'กำลัง = V² / Z (คิดที่อิมพีแดนซ์ระบุ แบบเดียวกับ WinISD)' });
    const rw = wireOhms(d);
    if (d.wireM > 0) add({ id: 'rwire', group: g3, title: 'ความต้านทานสายลำโพง', formula: 'R = 2 · L · ρ_cu / A', subst: `= 2 × ${d.wireM} × ${num(COPPER_RHO)} / ${num((AWG_MM2[d.wireAwg] ?? 3.31) * 1e-6)} = ${num(rw)} Ω`, value: rw, unit: 'Ω', ref: REF.copper, note: `สาย ${d.wireAwg} AWG = ${AWG_MM2[d.wireAwg]} มม.² · คูณ 2 เพราะไปและกลับ` });
    if (d.amp) add({ id: 'rout', group: g3, title: 'อิมพีแดนซ์ขาออกของแอมป์', formula: 'Rout = Rระบุ / DF', subst: `= ${d.ampOhms} / ${d.dampingFactor} = ${num(ampOutputOhms(d))} Ω`, value: ampOutputOhms(d), unit: 'Ω', ref: 'นิยาม damping factor (DF) ที่โหลดระบุ' });
    const rsPer = res.info.seriesOhms * (d.wiring === 'parallel' ? n : 1 / n);
    if (res.info.seriesOhms > 0) {
      const qes = dr.qes * (dr.re + rsPer) / dr.re;
      add({ id: 'qesEff', group: g3, title: 'Qes เมื่อรวมแอมป์และสาย', formula: d.wiring === 'parallel' ? "Qes′ = Qes · (Re + n·Rs) / Re" : "Qes′ = Qes · (Re + Rs/n) / Re", subst: `= ${num(dr.qes)} × (${num(dr.re)} + ${num(rsPer)}) / ${num(dr.re)} = ${num(qes)}`, value: qes, unit: '', ref: REF.smallDirect, note: 'Rs = แอมป์ + สาย · ลำโพงขนาน n ดอกแบ่งกระแสผ่าน Rs เดียวกัน จึงเหมือนแต่ละดอกเห็น n·Rs' });
    }
    const amp = ampLimits(d);
    if (amp) {
      add({ id: 'ampClip', group: g3, title: 'จุด clipping ของแอมป์', formula: 'Vclip = √(Pระบุ · Rระบุ) ,  Pที่โหลดนี้ = Vclip² / Z ,  Imax = Vclip / Rต่ำสุด', subst: `Vclip = √(${d.ampW} × ${d.ampOhms}) = ${num(amp.volts)} V · ได้ ${num((amp.volts * amp.volts) / zn)} W ที่ ${num(zn)} Ω · Imax = ${num(amp.amps)} A`, value: amp.volts, unit: 'V', ref: 'แอมป์ในอุดมคติที่กำลังเพิ่มเท่าตัวเมื่อโหลดลดครึ่ง จนถึงโหลดต่ำสุดที่ระบุ', note: 'แอมป์จริงมักให้น้อยกว่านี้ที่โหลดต่ำ (แหล่งจ่ายตก)' });
    }
    if (max) {
      const f = res.curves.freqs;
      let best = { db: -Infinity, f: 0, i: -1 };
      f.forEach((x, i) => { if (x >= 20 && x <= 200 && max.maxSpl[i] > best.db) best = { db: max.maxSpl[i], f: x, i }; });
      const by = best.i >= 0 ? max.limitedBy[best.i] : null;
      const byTh = { excursion: 'ระยะชัก', port: `ลมในท่อ ${MAX_PORT_MS} m/s`, thermal: 'พิกัดความร้อน', 'amp-voltage': 'แอมป์ clip', 'amp-current': 'กระแสแอมป์' } as const;
      const pe = ratedWatts(dto, d);
      add({
        id: 'maxSpl', group: g3, title: 'ดังสุดที่ทำได้ (Max SPL)',
        formula: 'Max SPL = SPL(V0) + 20·log10(Vmax / V0) ,  Vmax = min(V0·Xmax/x, V0·30/v, √(Pe·n·Z)/|H|, Vclip/|H|, V0·Imax/I)',
        subst: best.i >= 0 ? `ยอด ${num(best.db)} dB ที่ ${num(best.f)} Hz · ติด${by ? byTh[by] : '—'}${pe ? ` · Pe ${num(pe)} W × ${n} ดอก` : ''}` : 'ยังไม่มีขีดจำกัดให้คิด (ไม่มี Xmax และ Pe)',
        value: best.i >= 0 ? best.db : null, unit: 'dB', ref: `${REF.lumped} · ระบบเชิงเส้น ทุกเส้นโตตามแรงดัน`,
        note: '|H| = อัตราขยายของ Subsonic (ตัดสัญญาณก่อนเข้าแอมป์ ช่วงที่ถูกตัดจึงมีเหลือ)', conf: conf.maxSpl
      });
    }
  }

  // ---- panels and build -------------------------------------------------------------------------------
  if (geo) {
    const g4 = 'ผนังและการสร้าง';
    const e = (material?.eGpa ?? 3.5) * 1e9;
    const rho = material?.densityKgM3 ?? 750;
    const nu = material?.poisson ?? 0.25;
    const D = (e * geo.t ** 3) / (12 * (1 - nu * nu));
    add({
      id: 'panelSide', group: g4, title: 'โหมดแรกของผนังข้าง f(1,1)',
      formula: 'f11 = (π/2) · √(D / (ρ·h)) · (1/a² + 1/b²) ,  D = E·h³ / (12·(1 − ν²))',
      subst: `D = ${num(e)} × ${num(geo.t)}³ / (12 × (1 − ${num(nu)}²)) = ${num(D)} N·m · f11 = ${num(modes.side)} Hz${wall.f11Factor < 1 ? ` (แผ่นซับแรงสั่นถ่วง ×${num(wall.f11Factor, 3)})` : ''}`,
      value: modes.side, unit: 'Hz', ref: REF.leissa, note: `ผนังหลังซึ่งกว้างสุด ≈ ${num(modes.back)} Hz · ${material?.nameTh ?? material?.name ?? 'MDF'} E ${num(e / 1e9)} GPa ρ ${rho} kg/m³`, conf: conf.panelModes
    });
    const vol = geo.volume;
    const less = ([[vol.driversL, 'ลำโพง'], [vol.portsL, 'ท่อ'], [vol.boardsL, 'แผ่นกั้น'], [vol.tunnelL, 'อุโมงค์'], [vol.bracesL, 'โครงค้ำ'], [vol.extraL, 'บล็อก']] as [number, string][]).filter(([x]) => x >= 0.05);
    add({
      id: 'netVolume', group: g4, title: 'ปริมาตรสุทธิจากขนาดตู้',
      formula: geo.shape === 'wedge' ? 'Vสุทธิ = Wi · Hi · (Dล่าง + Dบน)/2 − Vลำโพง − Vท่อ − Vโครงค้ำ − …' : 'Vสุทธิ = Wi · Hi · Di − Vลำโพง − Vท่อ − Vโครงค้ำ − …',
      subst: `= ${num(geo.wi)} × ${num(geo.hi)} × ${geo.shape === 'wedge' ? `(${num(geo.di)} + ${num(geo.diTop)})/2` : num(geo.di)} ม.³ = ${num(vol.shellL)} L${less.map(([x, k]) => ` − ${num(x)} (${k})`).join('')}${geo.shortL >= 0.05 ? ` + ${num(geo.shortL)} (ขาด)` : ''} = ${num(vol.netL)} L`,
      value: vol.netL, unit: 'L', ref: 'ขนาดภายใน = ภายนอก − ความหนาแผ่น 2 ด้าน · โครงค้ำแบบหน้าต่างกว้าง 5 ซม. · ท่อคิดทั้งอากาศในท่อและแผ่นที่ทำท่อ', conf: conf.size
    });
    add({ id: 'weight', group: g4, title: 'น้ำหนักตู้เปล่า', formula: 'm = Aแผ่นรวม · t · ρ (+ แผ่นซับแรงสั่น)', subst: `= ${num(geo.panelAreaM2)} × ${num(geo.t)} × ${rho}${wall.massKgM2 ? ` + ${num(geo.panelAreaM2 * 0.8)} × ${num(wall.massKgM2)}` : ''} = ${num(geo.weightKg)} กก.`, value: geo.weightKg, unit: 'กก.', ref: 'พื้นที่แผ่น = ผนัง 6 ด้าน + แผ่นท่อ + โครงค้ำราวครึ่งแผ่น + แผ่นกั้นภายใน', conf: conf.size });
  }
  if (dr && dto?.peW) {
    const per = d.watts / n;
    const t = thermalAt(per, ratedWatts(dto, d), 1e9);
    add({ id: 'reHot', group: 'ผนังและการสร้าง', title: 'Re เมื่อคอยล์ร้อน (เปิดยาว)', formula: 'Re(T) = Re · (1 + 0.00393 · (T − 25)) ,  ดังลดลง = 20·log10(Re(T) / Re)', subst: `คอยล์ ≈ ${num(t.tvc, 3)} °C → Re ×${num(t.reRise, 3)} · ดังลดลง ${num(20 * Math.log10(t.reRise), 2)} dB ที่ ${num(per)} W ต่อดอก`, value: t.reRise, unit: '×', ref: REF.copper, note: 'โมเดลความร้อน 2 จุด: ยิ่งเปิดใกล้พิกัดยิ่งร้อน (≈110 K ที่พิกัด)', conf: conf.thermal });
  }
  return out;
}

export interface VarDef { name: string; value: number; unit: string; desc: string }

/** Values the user's own formulas may use. Names are matched without regard to case. */
export function notebookVars(ctx: NotebookCtx): VarDef[] {
  const { d, dto, driver: dr, res, geo } = ctx;
  const out: VarDef[] = [];
  const v = (name: string, value: number | null | undefined, unit: string, desc: string) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) out.push({ name, value, unit, desc });
  };
  const n = d.boxType === 'isobaric' ? 2 : d.count;
  if (dr) {
    v('Fs', dr.fs, 'Hz', 'ความถี่เรโซแนนซ์'); v('Qts', dr.qts, '', 'Q รวม'); v('Qes', dr.qes, '', 'Q ไฟฟ้า'); v('Qms', dr.qms, '', 'Q กล');
    v('Vas', dr.vas * 1000, 'L', 'ปริมาตรเทียบ'); v('Re', dr.re, 'Ω', 'ความต้านทานคอยล์'); v('Le', dr.le * 1000, 'mH', 'ความเหนี่ยวนำคอยล์');
    v('Bl', dr.bl, 'T·m', 'แรงขับมอเตอร์'); v('Mms', dr.mms * 1000, 'g', 'มวลเคลื่อนที่'); v('Cms', dr.cms * 1000, 'mm/N', 'ความยืดหยุ่น');
    v('Sd', dr.sd * 1e4, 'cm²', 'พื้นที่กรวย'); v('Znom', dr.zNom ?? dr.re, 'Ω', 'อิมพีแดนซ์ต่อดอก (ตามการต่อคอยล์)');
  }
  v('Xmax', dto?.xmaxMm, 'mm', 'ระยะชักสูงสุด (ทางเดียว)'); v('Pe', ctx.dto ? ratedWatts(ctx.dto, d) : null, 'W', 'พิกัดกำลังต่อดอก');
  v('N', n, 'ดอก', 'จำนวนลำโพง'); v('W', d.watts, 'W', 'กำลังขับ'); v('Vb', d.vbL, 'L', d.boxType.startsWith('bp') ? 'ห้องหลัง' : 'ปริมาตรสุทธิ');
  if (d.boxType === 'bp4' || d.boxType === 'bp6') v('Vf', d.vfL, 'L', 'ห้องหน้า');
  if (d.boxType === 'vented' || d.boxType === 'bp4' || d.boxType === 'bp6') { v('Fb', d.fbHz, 'Hz', 'ความถี่จูนที่ตั้ง'); v('Ap', d.portAreaCm2, 'cm²', 'พื้นที่ท่อ'); }
  if (d.boxType === 'bp6') v('Fb2', d.fb2Hz, 'Hz', 'จูนท่อหน้า');
  if (res) {
    const m = res.metrics;
    v('Fc', res.info.fc, 'Hz', 'เรโซแนนซ์ระบบตู้ปิด'); v('Qtc', res.info.qtc, '', 'Q ระบบตู้ปิด');
    v('F3', m.f3, 'Hz', 'จุด −3 dB'); v('F10', m.f10, 'Hz', 'จุด −10 dB'); v('SPLmax', m.splMax, 'dB', 'SPL สูงสุด 15–200 Hz');
    v('Xpk', m.excursionMax.mm, 'mm', 'ระยะชักสูงสุดที่จำลอง'); v('Zmin', m.impedanceMin.ohms, 'Ω', 'อิมพีแดนซ์ต่ำสุด');
    v('V', res.info.totalVolts, 'V', 'แรงดันขับ RMS'); v('Zload', res.info.nominalOhms, 'Ω', 'โหลดรวม'); v('Rs', res.info.seriesOhms, 'Ω', 'แอมป์ + สาย');
    if (res.info.ports.length) { v('Vport', m.portVelocityMax.ms, 'm/s', 'ลมในท่อสูงสุด'); v('Lport', res.info.ports[0].physicalLength * 100, 'cm', 'ความยาวท่อ'); }
  }
  if (geo) { v('Wx', geo.wx * 100, 'cm', 'กว้างภายนอก'); v('Hx', geo.hx * 100, 'cm', 'สูงภายนอก'); v('Dx', geo.dx * 100, 'cm', 'ลึกภายนอก'); v('Mass', geo.weightKg, 'kg', 'น้ำหนักตู้เปล่า'); }
  v('rho', AIR_20C.rho, 'kg/m³', 'ความหนาแน่นอากาศ'); v('c', AIR_20C.c, 'm/s', 'ความเร็วเสียง');
  return out;
}
