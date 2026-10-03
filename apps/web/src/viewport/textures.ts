import * as THREE from 'three/webgpu';

/** Deterministic PRNG so textures look the same on every machine. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** Procedural walnut veneer (placeholder until the ChatGPT-generated textures arrive). */
export function walnutTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 1024, 1024);
  g.addColorStop(0, '#5d3b22'); g.addColorStop(0.5, '#482b18'); g.addColorStop(1, '#613f25');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 1024);
  const r = rng(11);
  for (let i = 0; i < 300; i++) {
    const y0 = i * 3.45 + r() * 3, a = 0.08 + r() * 0.22, p1 = r() * 6, p2 = r() * 6, a1 = 2 + r() * 7, a2 = 0.5 + r() * 2;
    x.strokeStyle = r() < 0.2 ? `rgba(150,100,62,${(a * 0.6).toFixed(3)})` : `rgba(24,11,4,${a.toFixed(3)})`;
    x.lineWidth = 0.6 + r() * 2;
    x.beginPath();
    for (let xx = 0; xx <= 1024; xx += 8) {
      const y = y0 + Math.sin(xx * 0.004 + p1) * a1 + Math.sin(xx * 0.027 + p2) * a2;
      if (xx) x.lineTo(xx, y); else x.moveTo(xx, y);
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function smokeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(236,252,203,1)');
  g.addColorStop(0.4, 'rgba(217,249,157,0.36)');
  g.addColorStop(1, 'rgba(217,249,157,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const IRON: [number, [number, number, number]][] = [
  [0, [8, 4, 20]], [0.25, [70, 10, 110]], [0.5, [190, 30, 70]], [0.72, [245, 120, 20]], [0.9, [252, 210, 60]], [1, [255, 250, 220]]
];

/** "Iron" thermal-camera colour map, t in 0..1. */
export function iron(t: number): THREE.Color {
  const v = Math.max(0, Math.min(1, t));
  for (let i = 1; i < IRON.length; i++) {
    if (v <= IRON[i][0]) {
      const [t0, a] = IRON[i - 1];
      const [t1, b] = IRON[i];
      const k = (v - t0) / (t1 - t0);
      return new THREE.Color().setRGB((a[0] + (b[0] - a[0]) * k) / 255, (a[1] + (b[1] - a[1]) * k) / 255, (a[2] + (b[2] - a[2]) * k) / 255, THREE.SRGBColorSpace);
    }
  }
  return new THREE.Color(1, 0.98, 0.86);
}

/** Temperature (°C) → 0..1 on the 20–190 °C scale shown in the HUD. */
export const tempToT = (c: number) => (c - 20) / 170;
