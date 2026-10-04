import { useEffect, useMemo, useRef, useState } from 'react';
import { circleTexture, loadImage, sideTexture } from '../data/photos';
import type { DriverDto } from '../data/types';
import { resolveShape } from '../sim/driverShape';
import type { DriverLook } from '../viewport/enclosure';
import { useDriverMedia } from './DriverPhotos';

/**
 * Everything the 3D view needs to draw the selected driver as it really is: its measured shape and
 * the user's photos cut into textures. `key` changes whenever the model has to be rebuilt.
 */
export function useDriverLook(dto: DriverDto | undefined): { look: DriverLook; key: string } {
  const media = useDriverMedia(dto?.id ?? null);
  const shape = useMemo(() => resolveShape(dto), [dto]);
  const [tex, setTex] = useState<Omit<DriverLook, 'shape'> & { stamp: number }>({ stamp: 0 });
  const runs = useRef(0);
  useEffect(() => {
    let live = true;
    const run = ++runs.current;
    (async () => {
      const out: Omit<DriverLook, 'shape'> = {};
      for (const m of media) {
        if (!m.marks || m.angle === 'angle') continue;
        try {
          const img = await loadImage(m.blob);
          if (m.angle === 'front') out.front = circleTexture(img, m.marks);
          else if (m.angle === 'rear') out.rear = circleTexture(img, m.marks, 512);
          else if (m.angle === 'side') out.side = sideTexture(img, m.marks, shape);
          img.close();
        } catch {
          // A photo that will not decode leaves that part plain.
        }
      }
      if (live) setTex({ ...out, stamp: run });
    })();
    return () => { live = false; };
  }, [media, shape]);
  const key = `${dto?.id ?? 0}|${Object.values(shape).join(',')}|${tex.stamp}`;
  return useMemo(() => ({ look: { shape, front: tex.front, rear: tex.rear, side: tex.side }, key }), [shape, tex, key]);
}
