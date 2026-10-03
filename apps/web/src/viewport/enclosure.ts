import * as THREE from 'three/webgpu';
import type { BoxGeometry } from '../sim/model';
import type { BoxType } from '../state/store';

export interface DriverParts {
  root: THREE.Group;
  moving: THREE.Group; // cone + dust cap + inner surround, translated by excursion
  cone: THREE.Mesh;
  cap: THREE.Mesh;
  surround: THREE.Mesh;
  frame: THREE.Mesh;
  magnet: THREE.Mesh;
}

export interface Enclosure {
  group: THREE.Group;
  shell: THREE.Mesh[]; // outer panels (walnut + baffle)
  baffle: THREE.Mesh;
  internals: THREE.Group; // port panels, brace, stuffing, inner drivers — shown in x-ray
  edges: THREE.LineSegments;
  drivers: DriverParts[]; // visible (front-mounted) drivers
  hiddenDrivers: DriverParts[]; // band-pass / isobaric inner drivers
  passiveRadiators: DriverParts[];
  portMouth: { y: number; z: number; width: number; height: number } | null;
  sources: { cone: THREE.Vector3; port: THREE.Vector3 | null };
  sideCenter: (side: -1 | 1) => THREE.Vector3;
  dispose: () => void;
}

export interface Looks {
  walnut: THREE.Texture;
}

const baffleMat = () => new THREE.MeshPhysicalMaterial({ color: 0x121418, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 });
const portMat = () => new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.95 });

function walnutMat(tex: THREE.Texture, u: number, v: number): THREE.MeshStandardMaterial {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(u / 0.9, v / 0.9);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0 });
}

/** One loudspeaker (or passive radiator) facing +z, outer radius R, centred at the origin. */
function buildDriver(R: number, depth: number, passive: boolean): DriverParts {
  const root = new THREE.Group();
  const moving = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.35, metalness: 0.7 });
  const frame = new THREE.Mesh(new THREE.RingGeometry(0.88 * R, R, 72), metal);
  frame.position.z = 0.004;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.995 * R, 0.004, 8, 96), new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.3, metalness: 0.9 }));
  rim.position.z = 0.006;
  const surround = new THREE.Mesh(new THREE.TorusGeometry(0.81 * R, 0.075 * R, 18, 96), new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.35, clearcoat: 0.4 }));
  surround.scale.z = 0.6;
  surround.position.z = 0.002;
  const profile = [new THREE.Vector2(0.74 * R, 0), new THREE.Vector2(0.6 * R, -0.13 * R), new THREE.Vector2(0.45 * R, -0.25 * R), new THREE.Vector2(0.3 * R, -0.34 * R)];
  const coneGeo = new THREE.LatheGeometry(profile, 72);
  coneGeo.rotateX(Math.PI / 2);
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshStandardMaterial({ color: passive ? 0x2a2f38 : 0x1c2028, roughness: 0.85, side: THREE.DoubleSide }));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.31 * R, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.32), new THREE.MeshPhysicalMaterial({ color: 0x2a3039, roughness: 0.3, clearcoat: 0.8 }));
  cap.rotation.x = Math.PI / 2;
  cap.position.z = -0.34 * R - 0.13 * R;
  cap.scale.set(1, 1, 1);
  moving.add(cone, cap);
  const magnet = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * R, 0.5 * R, 0.26 * R, 48), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.6 }));
  magnet.rotation.x = Math.PI / 2;
  magnet.position.z = -depth + 0.13 * R;
  magnet.visible = !passive;
  root.add(frame, rim, surround, moving, magnet);
  if (!passive) {
    const bolt = new THREE.SphereGeometry(0.008, 10, 8);
    const boltMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.3, metalness: 0.9 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.39;
      const b = new THREE.Mesh(bolt, boltMat);
      b.position.set(Math.cos(a) * 0.94 * R, Math.sin(a) * 0.94 * R, 0.008);
      root.add(b);
    }
  }
  return { root, moving, cone, cap, surround, frame, magnet };
}

export function buildEnclosure(geo: BoxGeometry, boxType: BoxType, count: number, prCount: number, depth: number, looks: Looks): Enclosure {
  const g = new THREE.Group();
  g.name = 'enclosure';
  const { wx, hx, dx, wi, t, slotH } = geo;
  const R = geo.driverRadius;
  const hasFrontPort = slotH > 0;
  const internals = new THREE.Group();
  const shell: THREE.Mesh[] = [];
  const slab = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // Shell: bottom/top/sides in walnut, back in black. Sides run full depth; top/bottom full footprint.
  shell.push(slab(wx, t, dx, walnutMat(looks.walnut, wx, dx), 0, t / 2, 0));
  shell.push(slab(wx, t, dx, walnutMat(looks.walnut, wx, dx), 0, hx - t / 2, 0));
  shell.push(slab(t, hx - 2 * t, dx, walnutMat(looks.walnut, dx, hx), -wx / 2 + t / 2, hx / 2, 0));
  shell.push(slab(t, hx - 2 * t, dx, walnutMat(looks.walnut, dx, hx), wx / 2 - t / 2, hx / 2, 0));
  shell.push(slab(wi, hx - 2 * t, t, baffleMat(), 0, hx / 2, -dx / 2 + t / 2));

  // Front baffle with real holes (drivers, passive radiators), sitting above the slot port.
  const bottomOfBaffle = hasFrontPort ? t + slotH + t : t;
  const bh = hx - t - bottomOfBaffle;
  const shape = new THREE.Shape();
  shape.moveTo(-wi / 2, 0); shape.lineTo(wi / 2, 0); shape.lineTo(wi / 2, bh); shape.lineTo(-wi / 2, bh); shape.lineTo(-wi / 2, 0);
  const frontMounted = boxType === 'bp4' || boxType === 'bp6' ? 0 : boxType === 'isobaric' ? 1 : count;
  const prs = boxType === 'pr' ? prCount : 0;
  const slots = frontMounted + prs;
  const cy = geo.driverY - bottomOfBaffle;
  const spacing = 2 * R + 0.03;
  const centers: number[] = [];
  for (let i = 0; i < slots; i++) centers.push((i - (slots - 1) / 2) * spacing);
  for (const x of centers) {
    const hole = new THREE.Path();
    hole.absarc(x, cy, geo.cutoutRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const baffleGeo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 48 });
  const baffle = new THREE.Mesh(baffleGeo, baffleMat());
  baffle.position.set(0, bottomOfBaffle, dx / 2 - t);
  g.add(baffle);
  shell.push(baffle);

  const drivers: DriverParts[] = [];
  const passiveRadiators: DriverParts[] = [];
  centers.forEach((x, i) => {
    const passive = i >= frontMounted;
    const d = buildDriver(R, depth, passive);
    d.root.position.set(x, geo.driverY, dx / 2);
    g.add(d.root);
    // magnets live inside the box: only visible in x-ray
    d.magnet.removeFromParent();
    d.magnet.position.set(x, geo.driverY, dx / 2 - depth + 0.13 * R);
    if (!passive) internals.add(d.magnet);
    (passive ? passiveRadiators : drivers).push(d);
  });

  // Band-pass / isobaric: drivers hidden inside, on a divider (visible in x-ray only).
  const hiddenDrivers: DriverParts[] = [];
  if (boxType === 'bp4' || boxType === 'bp6' || boxType === 'isobaric') {
    const n = boxType === 'isobaric' ? 1 : count;
    const zDiv = boxType === 'isobaric' ? dx / 2 - depth - 0.03 : -dx / 2 + dx * 0.45;
    for (let i = 0; i < n; i++) {
      const d = buildDriver(R, depth, false);
      d.root.position.set((i - (n - 1) / 2) * spacing, geo.driverY, zDiv);
      internals.add(d.root);
      hiddenDrivers.push(d);
    }
    if (boxType !== 'isobaric') slab(wi, hx - 2 * t - (hasFrontPort ? slotH + t : 0), t, new THREE.MeshStandardMaterial({ color: 0x2b3442, transparent: true, opacity: 0.6 }), 0, hx / 2 + (hasFrontPort ? (slotH + t) / 2 : 0), zDiv - t / 2, internals);
  }

  // Slot port: ceiling panel from the front edge, plus an L-shaped riser when it is long.
  let portMouth: Enclosure['portMouth'] = null;
  if (hasFrontPort) {
    const run = Math.min(geo.portLength, geo.di - slotH - 0.01);
    const ceiling = slab(wi, t, Math.max(0.02, run + t), portMat(), 0, t + slotH + t / 2, dx / 2 - (run + t) / 2);
    shell.push(ceiling);
    const tunnel = new THREE.Mesh(new THREE.PlaneGeometry(wi, slotH), new THREE.MeshBasicMaterial({ color: 0x020304 }));
    tunnel.position.set(0, t + slotH / 2, dx / 2 - Math.max(0.03, run * 0.6));
    g.add(tunnel);
    const rest = geo.portLength - run;
    if (rest > 0.02) slab(wi, Math.min(rest, geo.hi - slotH - t), t, portMat(), 0, t + slotH + Math.min(rest, geo.hi - slotH - t) / 2, -dx / 2 + t + slotH + t / 2, internals);
    portMouth = { y: t + slotH / 2, z: dx / 2, width: wi, height: slotH };
  }

  // Window brace and polyfill, internal only.
  const braceMat = new THREE.MeshStandardMaterial({ color: 0x64748b, transparent: true, opacity: 0.55 });
  const yA = hasFrontPort ? t + slotH + t : t;
  const innerH = hx - t - yA;
  const bar = 0.05;
  slab(wi, bar, t, braceMat, 0, yA + bar / 2, 0, internals);
  slab(wi, bar, t, braceMat, 0, hx - t - bar / 2, 0, internals);
  slab(bar, innerH, t, braceMat, -wi / 2 + bar / 2, yA + innerH / 2, 0, internals);
  slab(bar, innerH, t, braceMat, wi / 2 - bar / 2, yA + innerH / 2, 0, internals);
  const fluff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.006, 0), new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.45 }), 220);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 220; i++) fluff.setMatrixAt(i, m4.makeTranslation((rnd() - 0.5) * wi * 0.85, yA + 0.04 + rnd() * (innerH - 0.08), -dx / 2 + t + 0.02 + rnd() * geo.di * 0.35));
  internals.add(fluff);
  internals.visible = false;
  g.add(internals);

  // Wire edges of every shell panel, used by x-ray.
  shell.forEach((m) => m.updateMatrix());
  const edgeGeos = shell.map((m) => {
    const e = new THREE.EdgesGeometry(m.geometry, 20);
    e.applyMatrix4(m.matrix);
    return e;
  });
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const e of edgeGeos) pos.push(...(e.getAttribute('position').array as Float32Array));
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  edgeGeos.forEach((e) => e.dispose());
  const edges = new THREE.LineSegments(merged, new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.7 }));
  edges.visible = false;
  g.add(edges);

  const cone0 = drivers[0] ?? hiddenDrivers[0];
  return {
    group: g, shell, baffle, internals, edges, drivers, hiddenDrivers, passiveRadiators, portMouth,
    sources: {
      cone: new THREE.Vector3(cone0 ? cone0.root.position.x : 0, geo.driverY, frontMounted > 0 ? dx / 2 : dx / 2),
      port: portMouth ? new THREE.Vector3(0, portMouth.y, dx / 2) : null
    },
    sideCenter: (side) => new THREE.Vector3(side * (wx / 2 + 0.002), hx / 2, 0),
    dispose: () => g.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
        (x as THREE.MeshStandardMaterial).map?.dispose();
        x.dispose();
      });
    })
  };
}
