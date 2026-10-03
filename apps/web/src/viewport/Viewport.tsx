import { useEffect, useRef, useState } from 'react';
import { Engine, type EngineInput } from './Engine';

/** Hosts the Three.js engine; React only pushes new inputs, the engine owns the render loop. */
export function Viewport({ input }: { input: EngineInput | null }) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const e = new Engine(el);
    engine.current = e;
    let alive = true;
    e.start().catch((err: unknown) => {
      if (alive) setFailed(err instanceof Error ? err.message : String(err));
    });
    return () => { alive = false; e.dispose(); engine.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (input) engine.current?.update(input); }, [input]);

  return (
    <div className="viewport" ref={host} aria-label="มุมมอง 3 มิติของตู้ลำโพง ลากเพื่อหมุน เลื่อนล้อเพื่อซูม">
      {failed && <div className="webgl-note">เปิดภาพ 3 มิติไม่ได้: {failed}<br />ลองใช้ Chrome หรือ Edge รุ่นล่าสุด กราฟและตัวเลขยังใช้งานได้ปกติ</div>}
    </div>
  );
}
