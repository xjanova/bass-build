import * as THREE from 'three/webgpu';

/** Deterministic PRNG so textures look the same on every machine. */
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * Procedural wood grain: a three-stop base gradient with wavy dark (and some light) grain lines.
 * Placeholder until the ChatGPT-generated textures arrive.
 */
export function woodTexture(seed: number, base: [string, string, string], dark: string, light: string, size = 1024): THREE.CanvasTexture {
  const [c, x] = canvas(size);
  const g = x.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, base[0]); g.addColorStop(0.5, base[1]); g.addColorStop(1, base[2]);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const r = rng(seed);
  const lines = Math.round(size * 0.29);
  for (let i = 0; i < lines; i++) {
    const y0 = (i * size) / lines + r() * 3, a = 0.08 + r() * 0.22, p1 = r() * 6, p2 = r() * 6, a1 = 2 + r() * 7, a2 = 0.5 + r() * 2;
    x.strokeStyle = r() < 0.2 ? `${light}${(a * 0.6).toFixed(3)})` : `${dark}${a.toFixed(3)})`;
    x.lineWidth = 0.6 + r() * 2;
    x.beginPath();
    for (let xx = 0; xx <= size; xx += 8) {
      const y = y0 + Math.sin(xx * 0.004 + p1) * a1 + Math.sin(xx * 0.027 + p2) * a2;
      if (xx) x.lineTo(xx, y); else x.moveTo(xx, y);
    }
    x.stroke();
  }
  return finish(c);
}

/** Walnut veneer, the default decor. */
export const walnutTexture = () => woodTexture(11, ['#5d3b22', '#482b18', '#613f25'], 'rgba(24,11,4,', 'rgba(150,100,62,');

/** Flat base with random flecks: MDF dust, particle-board chips, concrete pores. */
export function speckleTexture(seed: number, base: string, flecks: string[], count: number, maxSize: number): THREE.CanvasTexture {
  const [c, x] = canvas(512);
  x.fillStyle = base; x.fillRect(0, 0, 512, 512);
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    x.fillStyle = flecks[Math.floor(r() * flecks.length)];
    const w = 0.6 + r() * maxSize, h = 0.6 + r() * maxSize * 0.6;
    x.save();
    x.translate(r() * 512, r() * 512);
    x.rotate(r() * Math.PI);
    x.fillRect(-w / 2, -h / 2, w, h);
    x.restore();
  }
  return finish(c);
}

/** 2×2 twill carbon-fibre weave. */
export function carbonTexture(): THREE.CanvasTexture {
  const [c, x] = canvas(256);
  const cell = 16;
  for (let j = 0; j < 256 / cell; j++) for (let i = 0; i < 256 / cell; i++) {
    const across = ((i + j) >> 1) % 2 === 0;
    const g = across ? x.createLinearGradient(i * cell, 0, (i + 1) * cell, 0) : x.createLinearGradient(0, j * cell, 0, (j + 1) * cell);
    g.addColorStop(0, '#0b0d10'); g.addColorStop(0.5, '#2a2f37'); g.addColorStop(1, '#0b0d10');
    x.fillStyle = g;
    x.fillRect(i * cell, j * cell, cell, cell);
  }
  return finish(c);
}

/** Fine parallel streaks: brushed metal, or the layer lines of a 3D print. */
export function streakTexture(seed: number, base: string, streak: string, gap: number, jitter: number): THREE.CanvasTexture {
  const [c, x] = canvas(512);
  x.fillStyle = base; x.fillRect(0, 0, 512, 512);
  const r = rng(seed);
  for (let y = 0; y < 512; y += gap) {
    x.globalAlpha = 0.25 + r() * jitter;
    x.fillStyle = streak;
    x.fillRect(0, y + r() * jitter, 512, 0.5 + r() * gap * 0.4);
  }
  x.globalAlpha = 1;
  return finish(c);
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
