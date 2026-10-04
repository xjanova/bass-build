import { useEffect, useRef, useState } from 'react';
import { useApp, type Teaser } from '../state/store';

/** What each not-yet-built main tab will do, from docs/PLAN.md. */
const TEASERS: Record<Teaser, { title: string; phase: string; lead: string; points: string[] }> = {
  ai: {
    title: 'AI สุ่มตู้',
    phase: 'มาในเฟส 5',
    lead: 'ให้ AI ลองตู้นับพันแบบด้วยฟิสิกส์ชุดเดียวกับแล็บนี้ แล้วคัดแบบที่ดีที่สุดมาให้ รวมถึงทรงแปลกที่คนไม่คิดจะลอง',
    points: [
      'ตั้งเป้าได้: เบสลึกสุด · ดังสุด · ตู้เล็กสุด · งบไม้น้อยสุด',
      'สุ่มและผสมแบบตามหลักวิวัฒนาการ ทุกแบบจำลองกับลำโพงจริงก่อนเสนอ',
      'กราฟ Pareto ให้เลือกจุดสมดุลระหว่างขนาดกับความลึกของเบส',
      'ส่งแบบที่ชอบเข้าโหมดออกแบบต่อได้ทันที'
    ]
  },
  blueprint: {
    title: 'พิมพ์เขียว',
    phase: 'มาในเฟส 3',
    lead: 'แบบตัดไม้มืออาชีพจากตู้ที่ออกแบบไว้ พร้อมชื่อรุ่นและตรา พิมพ์ไปให้ช่างได้เลย',
    points: [
      'ขนาดทุกแผ่น รูเจาะ ท่อ และโครงค้ำ พร้อมเส้นบอกระยะ',
      'ผังวางแผ่นบนไม้ 1.22 × 2.44 ม. ให้เศษน้อยที่สุด',
      'รายการวัสดุ น็อต ขั้วต่อ ใยซับเสียง และน้ำหนักรวม',
      'ส่งออก PDF · SVG · DXF'
    ]
  },
  library: {
    title: 'คลังข้อมูล',
    phase: 'มาในเฟส 1',
    lead: 'คลังลำโพงรุ่นจริงจาก datasheet พร้อมลิงก์ที่มา และวัสดุทุกชนิดที่แล็บใช้คำนวณ',
    points: [
      'เพิ่มและแก้ลำโพงเอง ระบบเติมค่า T/S ที่ขาดและเช็คว่าสเปกขัดกันไหม',
      'นำเข้าไฟล์ .wdr และ CSV',
      'ใส่รูปลำโพงแล้วได้โมเดล 3D ตามขนาดจริง',
      'ค้นตามขนาด ชนิด และงานที่ใช้'
    ]
  }
};

/** Teaser for a main tab that is still on the roadmap: picture, what it will do, which phase. */
export function TeaserDialog() {
  const { teaser, setTeaser } = useApp();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!teaser) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setTeaser(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [teaser, setTeaser]);
  if (!teaser) return null;
  const t = TEASERS[teaser];
  return (
    <div className="modal-backdrop" onClick={() => setTeaser(null)}>
      <section className="teaser glass" role="dialog" aria-modal="true" aria-labelledby="teaser-title" onClick={(e) => e.stopPropagation()}>
        <div className="teaser-art" style={{ backgroundImage: `url(/art/teaser-${teaser}.webp)` }}>
          <span className="phase">{t.phase}</span>
        </div>
        <div className="teaser-body">
          <h2 id="teaser-title">{t.title}</h2>
          <p>{t.lead}</p>
          <ul>{t.points.map((p) => <li key={p}>{p}</li>)}</ul>
          <button ref={close} className="teaser-close" onClick={() => setTeaser(null)}>กลับไปที่แล็บ</button>
        </div>
      </section>
    </div>
  );
}

/** Full-screen splash while the 3D engine starts; fades out once a render backend is up. */
export function Splash() {
  const backend = useApp((s) => s.backend);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!backend) return;
    const id = window.setTimeout(() => setGone(true), 700);
    return () => window.clearTimeout(id);
  }, [backend]);
  if (gone) return null;
  return (
    <div className={`splash${backend ? ' out' : ''}`} aria-hidden={!!backend}>
      <div className="splash-art" />
      <div className="splash-mark">
        <img src="/brand/logo-256.png" alt="" width={112} height={112} />
        <h1>BASS BUILD</h1>
        <p>แล็บออกแบบตู้ลำโพง · ฟิสิกส์จริงแบบเรียลไทม์</p>
        <div className="splash-bar"><i /></div>
      </div>
    </div>
  );
}
