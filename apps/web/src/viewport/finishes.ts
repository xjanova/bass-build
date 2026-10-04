import * as THREE from 'three/webgpu';
import { carbonTexture, speckleTexture, streakTexture, walnutTexture, woodTexture } from './textures';

/** Decor of the outer panels. 'raw' shows the panel material itself. */
export type Finish = 'walnut' | 'black' | 'raw';

export interface Looks {
  /** Material for a side/top/bottom panel u × v metres in size. */
  side: (u: number, v: number) => THREE.Material;
  /** Material for the front baffle and back panel. */
  front: () => THREE.Material;
  /** Clear panels: the inside of the box stays visible. */
  seeThrough: boolean;
}

interface Raw {
  tex?: () => THREE.CanvasTexture;
  /** Real-world size one texture tile covers, m. */
  tile?: number;
  color?: number;
  roughness: number;
  metalness?: number;
  clearcoat?: number;
  opacity?: number;
}

const WOOD_DARK = 'rgba(40,22,8,';
const WOOD_LIGHT = 'rgba(255,240,210,';

/** How each panel material looks unfinished. Keys match data/seed/materials.json. */
const RAW: Record<string, Raw> = {
  mdf: { tex: () => speckleTexture(3, '#9c7a55', ['#8a6a48', '#b08d66', '#7c5e3f'], 9000, 1.6), tile: 0.6, roughness: 0.85 },
  hdf: { tex: () => speckleTexture(5, '#5e4129', ['#4e3622', '#6c4c31'], 6000, 1.2), tile: 0.6, roughness: 0.6 },
  particleboard: { tex: () => speckleTexture(7, '#b8956a', ['#9a7650', '#d1b18a', '#7d5c3c', '#c8a27a'], 5000, 7), tile: 0.5, roughness: 0.92 },
  plywood: { tex: () => woodTexture(21, ['#c99d68', '#b88a56', '#cfa572'], WOOD_DARK, WOOD_LIGHT, 512), tile: 0.9, roughness: 0.7 },
  birch_ply: { tex: () => woodTexture(23, ['#e3cca4', '#d8bd92', '#e6d1ab'], 'rgba(120,90,50,', WOOD_LIGHT, 512), tile: 0.9, roughness: 0.6 },
  marine_ply: { tex: () => woodTexture(25, ['#b5764a', '#a3663c', '#ba7d52'], WOOD_DARK, WOOD_LIGHT, 512), tile: 0.9, roughness: 0.55, clearcoat: 0.3 },
  rubberwood: { tex: () => woodTexture(27, ['#d6b68c', '#c9a77b', '#dabd95'], 'rgba(110,75,40,', WOOD_LIGHT, 512), tile: 0.9, roughness: 0.55 },
  teak: { tex: () => woodTexture(29, ['#9c6a38', '#8a5a2c', '#a5733f'], WOOD_DARK, 'rgba(230,180,110,', 512), tile: 0.9, roughness: 0.45, clearcoat: 0.35 },
  pine: { tex: () => woodTexture(31, ['#e4c389', '#d9b577', '#e8ca93'], 'rgba(150,95,35,', WOOD_LIGHT, 512), tile: 0.9, roughness: 0.6 },
  acrylic: { color: 0xd6ecff, roughness: 0.04, clearcoat: 1, opacity: 0.2 },
  pla: { tex: () => streakTexture(9, '#e6e8ec', '#b8bdc6', 3, 0.5), tile: 0.25, roughness: 0.6 },
  fiberglass: { color: 0xf3f5f7, roughness: 0.25, clearcoat: 0.9 },
  carbon: { tex: carbonTexture, tile: 0.2, roughness: 0.3, clearcoat: 1 },
  aluminum: { tex: () => streakTexture(13, '#c3c9d1', '#8e959f', 2, 0.6), tile: 0.4, roughness: 0.32, metalness: 1 },
  steel: { tex: () => streakTexture(15, '#8e949c', '#5f656d', 2, 0.6), tile: 0.4, roughness: 0.42, metalness: 1 },
  concrete: { tex: () => speckleTexture(17, '#8f8e8a', ['#7a7975', '#a3a29e', '#64635f', '#b0afab'], 14000, 2.4), tile: 0.8, roughness: 0.96 }
};

/** Builds panel materials for a finish, reusing canvas textures through `cache`. */
export function looksFor(finish: Finish, materialKey: string, cache: Map<string, THREE.CanvasTexture>): Looks {
  const texture = (key: string, make: () => THREE.CanvasTexture) => {
    let t = cache.get(key);
    if (!t) { t = make(); cache.set(key, t); }
    return t;
  };
  const tiled = (base: THREE.CanvasTexture, u: number, v: number, tile: number) => {
    const t = base.clone();
    t.needsUpdate = true;
    t.repeat.set(u / tile, v / tile);
    return t;
  };
  const black = () => new THREE.MeshPhysicalMaterial({ color: 0x121418, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 });

  if (finish === 'walnut') {
    const walnut = texture('walnut', walnutTexture);
    return { side: (u, v) => new THREE.MeshStandardMaterial({ map: tiled(walnut, u, v, 0.9), roughness: 0.55, metalness: 0 }), front: black, seeThrough: false };
  }
  if (finish === 'black') {
    return { side: () => black(), front: black, seeThrough: false };
  }
  const raw = RAW[materialKey] ?? RAW.mdf;
  const make = (u: number, v: number) => {
    const opacity = raw.opacity ?? 1;
    return new THREE.MeshPhysicalMaterial({
      map: raw.tex ? tiled(texture(materialKey, raw.tex), u, v, raw.tile ?? 1) : null,
      color: raw.color ?? 0xffffff,
      roughness: raw.roughness, metalness: raw.metalness ?? 0,
      clearcoat: raw.clearcoat ?? 0, clearcoatRoughness: 0.2,
      transparent: opacity < 1, opacity, depthWrite: opacity >= 1
    });
  };
  return { side: make, front: () => make(1, 1), seeThrough: (raw.opacity ?? 1) < 0.5 };
}
