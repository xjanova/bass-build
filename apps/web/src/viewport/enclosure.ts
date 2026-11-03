import * as THREE from 'three/webgpu';
import type { ResolvedShape } from '../sim/driverShape';
import { baffleBottom, frontRow, innerRow, sideRow, slotBoards } from '../sim/layout';
import type { BoxGeometry } from '../sim/model';
import type { BoxType } from '../state/store';
import type { Looks } from './finishes';

export interface DriverParts {
  root: THREE.Group;
  moving: THREE.Group; // cone + dust cap + inner surround, translated by excursion
  cone: THREE.Mesh;
  cap: THREE.Mesh;
  surround: THREE.Mesh;
  frame: THREE.Mesh;
  magnet: THREE.Mesh;
  /** Basket and magnet, behind the mounting plane. */
  rear: THREE.Group;
}

export interface Enclosure {
  group: THREE.Group;
  shell: THREE.Mesh[]; // outer panels (decor + baffle)
  baffle: THREE.Mesh;
  internals: THREE.Group; // port panels, brace, stuffing, inner drivers — shown in x-ray
  edges: THREE.LineSegments;
  drivers: DriverParts[]; // visible (front-mounted) drivers
  hiddenDrivers: DriverParts[]; // band-pass / isobaric inner drivers
  passiveRadiators: DriverParts[];
  portMouth: { y: number; z: number; width: number; height: number } | null;
  /** Round rear-chamber port on the back panel of a 6th-order band-pass. */
  rearPortMouth: { y: number; z: number; radius: number } | null;
  sources: { cone: THREE.Vector3; port: THREE.Vector3 | null; port2: THREE.Vector3 | null };
  sideCenter: (side: -1 | 1) => THREE.Vector3;
  dispose: () => void;
}

const portMat = () => new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.95 });

/** A driver's measured shape plus the user's photos, already cut to textures (see data/photos.ts). */
export interface DriverLook {
  shape: ResolvedShape;
  front?: HTMLCanvasElement | null;
  rear?: HTMLCanvasElement | null;
  side?: HTMLCanvasElement | null;
}

/** Proportions for a part known only by its outer radius (passive radiators, unknown drivers). */
function genericShape(R: number, depth: number): ResolvedShape {
  const coneR = 0.8 * R, surroundW = 0.13 * R;
  return {
    outerR: R, cutoutR: 0.9 * R, coneR, surroundW, dustcapR: 0.36 * coneR, coneDepth: Math.min(0.32 * coneR, depth * 0.6),
    flange: 0.006 + 0.02 * R, magnetR: 0.5 * R, magnetH: 0.3 * depth, depth, boltHoles: R < 0.1 ? 4 : 8, boltR: 0.95 * R, estimated: []
  };
}

/** Texture coordinates by straight projection along z: the photo's circle lands on the frame's rim. */
function planarUV(geo: THREE.BufferGeometry, r: number, mirror = false): THREE.BufferGeometry {
  const p = geo.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[2 * i] = 0.5 + (mirror ? -p.getX(i) : p.getX(i)) / (2 * r);
    uv[2 * i + 1] = 0.5 + p.getY(i) / (2 * r);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function canvasTexture(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * One loudspeaker (or passive radiator) facing +z, built from its measured shape: the flange sits
 * on the baffle at z = 0, the magnet's back is at z = −depth. With a front photo, every part seen
 * from the front wears it (projected straight on, so the photo looks like the real driver); the
 * rear photo goes on the back of the magnet and the side photo around it.
 */
function buildDriver(s: ResolvedShape, passive: boolean, look?: DriverLook): DriverParts {
  const R = s.outerR;
  const root = new THREE.Group();
  const moving = new THREE.Group();
  const rear = new THREE.Group();
  const front = look?.front ? canvasTexture(look.front) : null;
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.35, metalness: 0.7 });
  const bright = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.3, metalness: 0.9 });
  const photo = (roughness: number) => new THREE.MeshStandardMaterial({ map: front, roughness, metalness: 0.05, side: THREE.DoubleSide });

  // Frame face from the surround's outer edge to the rim, on top of the flange, and the flange edge.
  const inner = s.coneR + s.surroundW / 2;
  const frame = new THREE.Mesh(planarUV(new THREE.RingGeometry(inner, R, 96, 1).translate(0, 0, s.flange), R), front ? photo(0.45) : metal);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R, R, s.flange, 96, 1, true).rotateX(Math.PI / 2).translate(0, 0, s.flange / 2), bright);
  // Surround: a half roll bulging forward, its top a little above the flange.
  const top = s.flange * 0.6;
  const surround = new THREE.Mesh(
    planarUV(new THREE.TorusGeometry(s.coneR, s.surroundW / 2, 18, 96).scale(1, 1, 0.6).translate(0, 0, top), R),
    front ? photo(0.4) : new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.35, clearcoat: 0.4 })
  );
  // Cone: from the surround's inner edge down to the dust cap, slightly curved.
  const r0 = s.coneR - s.surroundW / 2, r1 = s.dustcapR;
  const profile = [0, 0.25, 0.5, 0.75, 1].map((k) => new THREE.Vector2(r0 + (r1 - r0) * k, -s.coneDepth * Math.pow(k, 0.85)));
  const cone = new THREE.Mesh(
    planarUV(new THREE.LatheGeometry(profile, 96).rotateX(Math.PI / 2).translate(0, 0, top), R),
    front ? photo(0.8) : new THREE.MeshStandardMaterial({ color: passive ? 0x2a2f38 : 0x1c2028, roughness: 0.85, side: THREE.DoubleSide })
  );
  // Dust cap: a shallow dome on the bottom of the cone.
  const capH = 0.3 * s.dustcapR;
  const rs = (s.dustcapR * s.dustcapR + capH * capH) / (2 * capH);
  const capBase = top - s.coneDepth;
  const cap = new THREE.Mesh(
    planarUV(new THREE.SphereGeometry(rs, 48, 12, 0, Math.PI * 2, 0, Math.asin(Math.min(1, s.dustcapR / rs))).rotateX(Math.PI / 2).translate(0, 0, capBase - (rs - capH)), R),
    front ? photo(0.35) : new THREE.MeshPhysicalMaterial({ color: 0x2a3039, roughness: 0.3, clearcoat: 0.8 })
  );
  moving.add(cone, cap);

  // Behind the baffle (shown in x-ray): basket struts and the magnet with its photos.
  const side = look?.side ? canvasTexture(look.side) : null;
  if (side) { side.wrapS = THREE.MirroredRepeatWrapping; side.repeat.set(2, 1); }
  const magnetMat = side ? new THREE.MeshStandardMaterial({ map: side, roughness: 0.45, metalness: 0.3 }) : new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.4, metalness: 0.6 });
  const magnet = new THREE.Mesh(new THREE.CylinderGeometry(s.magnetR, s.magnetR, s.magnetH, 64).rotateX(Math.PI / 2).translate(0, 0, -s.depth + s.magnetH / 2), magnetMat);
  rear.add(magnet);
  if (look?.rear) {
    const back = new THREE.Mesh(planarUV(new THREE.CircleGeometry(s.magnetR * 0.999, 64).rotateY(Math.PI).translate(0, 0, -s.depth - 0.0005), s.magnetR, true),
      new THREE.MeshStandardMaterial({ map: canvasTexture(look.rear), roughness: 0.5, metalness: 0.2 }));
    rear.add(back);
  }
  if (!passive) {
    const strut = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.6 });
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const from = new THREE.Vector3(Math.cos(a) * inner * 0.97, Math.sin(a) * inner * 0.97, -0.002);
      const to = new THREE.Vector3(Math.cos(a) * s.magnetR * 0.92, Math.sin(a) * s.magnetR * 0.92, -s.depth + s.magnetH);
      const len = from.distanceTo(to);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012 + 0.03 * R, 0.004 + 0.01 * R, len), strut);
      bar.position.copy(from).add(to).multiplyScalar(0.5);
      bar.lookAt(to);
      rear.add(bar);
    }
    const bolt = new THREE.SphereGeometry(0.006 + 0.01 * R, 10, 8);
    for (let i = 0; i < s.boltHoles; i++) {
      const a = (i / s.boltHoles) * Math.PI * 2 + 0.39;
      const b = new THREE.Mesh(bolt, bright);
      b.position.set(Math.cos(a) * s.boltR, Math.sin(a) * s.boltR, s.flange);
      root.add(b);
    }
  }
  rear.visible = !passive;
  root.add(frame, rim, surround, moving, rear);
  return { root, moving, cone, cap, surround, frame, magnet, rear };
}

export function buildEnclosure(geo: BoxGeometry, boxType: BoxType, count: number, prCount: number, depth: number, looks: Looks, fill: number, look?: DriverLook | null): Enclosure {
  const g = new THREE.Group();
  g.name = 'enclosure';
  const { wx, hx, dx, wi, t, slotH } = geo;
  const R = geo.driverRadius;
  const hasFrontPort = slotH > 0;
  const driverShape = look?.shape ?? genericShape(R, depth);
  const prShape = genericShape(geo.prRadius, depth);
  const internals = new THREE.Group();
  const shell: THREE.Mesh[] = [];
  const slab = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // Shell: bottom/top/sides in the decor, back like the baffle. Sides run full depth; top/bottom full footprint.
  // A wedge keeps its floor and baffle; the top is shallower and the back leans forward between them.
  const wedge = geo.shape === 'wedge';
  const dxTop = geo.dxTop;
  /** Outside back face, z at height y (a plain box: the back wall). */
  const backZ = (y: number) => -dx / 2 + (dx - dxTop) * (y / hx);
  shell.push(slab(wx, t, dx, looks.side(wx, dx), 0, t / 2, 0));
  shell.push(slab(wx, t, dxTop, looks.side(wx, dxTop), 0, hx - t / 2, dx / 2 - dxTop / 2));
  if (wedge) {
    // Trapezoid sides between the top and bottom panels, drawn in the (z, y) plane and pushed out along x.
    for (const sx of [-1, 1]) {
      const prof = new THREE.Shape();
      prof.moveTo(dx / 2, t); prof.lineTo(dx / 2, hx - t); prof.lineTo(backZ(hx - t), hx - t); prof.lineTo(backZ(t), t); prof.lineTo(dx / 2, t);
      const side = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { depth: t, bevelEnabled: false }), looks.side(dx, hx));
      // Extruded along +z in its own frame: turn it so the profile's x becomes the box's z.
      side.rotation.y = -Math.PI / 2;
      side.position.set(sx < 0 ? -wx / 2 + t : wx / 2, 0, 0);
      g.add(side);
      shell.push(side);
    }
  } else {
    shell.push(slab(t, hx - 2 * t, dx, looks.side(dx, hx), -wx / 2 + t / 2, hx / 2, 0));
    shell.push(slab(t, hx - 2 * t, dx, looks.side(dx, hx), wx / 2 - t / 2, hx / 2, 0));
  }
  // Back panel; a 6th-order band-pass vents its rear chamber through a round port in it.
  let rearPortMouth: Enclosure['rearPortMouth'] = null;
  if (geo.rearPort) {
    const rp = geo.rearPort;
    const back = new THREE.Shape();
    back.moveTo(-wi / 2, 0); back.lineTo(wi / 2, 0); back.lineTo(wi / 2, hx - 2 * t); back.lineTo(-wi / 2, hx - 2 * t); back.lineTo(-wi / 2, 0);
    const hole = new THREE.Path();
    hole.absarc(0, rp.y - t, rp.radius, 0, Math.PI * 2, true);
    back.holes.push(hole);
    const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(back, { depth: t, bevelEnabled: false, curveSegments: 40 }), looks.front());
    panel.position.set(0, t, -dx / 2);
    g.add(panel);
    shell.push(panel);
    // The tube runs straight into the rear chamber (x-ray only); its dark inside shows through the hole.
    const run = Math.max(0.02, Math.min(rp.length, rp.room));
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(rp.radius, rp.radius, run, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x1f2937, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    tube.rotation.x = Math.PI / 2;
    tube.position.set(0, rp.y, -dx / 2 + run / 2);
    internals.add(tube);
    const inside = new THREE.Mesh(new THREE.CircleGeometry(rp.radius, 32), new THREE.MeshBasicMaterial({ color: 0x020304 }));
    inside.rotation.y = Math.PI;
    inside.position.set(0, rp.y, -dx / 2 + Math.min(0.03, run));
    g.add(inside);
    rearPortMouth = { y: rp.y, z: -dx / 2, radius: rp.radius };
  } else if (wedge) {
    // The back panel lies along the lean, between the top and bottom panels.
    const len = Math.hypot(hx - 2 * t, backZ(hx - t) - backZ(t));
    const back = slab(wi, len, t, looks.front(), 0, hx / 2, 0);
    back.rotation.x = geo.backAngle;
    // Centre of the outside face at mid-height, moved half a panel inward (along the panel's normal).
    back.position.set(0, hx / 2 - (t / 2) * Math.sin(geo.backAngle), backZ(hx / 2) + (t / 2) * Math.cos(geo.backAngle));
    shell.push(back);
  } else {
    shell.push(slab(wi, hx - 2 * t, t, looks.front(), 0, hx / 2, -dx / 2 + t / 2));
  }


  // Front baffle with real holes (drivers, passive radiators), sitting above the slot port.
  const bottomOfBaffle = baffleBottom(geo);
  const bh = hx - t - bottomOfBaffle;
  const shape = new THREE.Shape();
  shape.moveTo(-wi / 2, 0); shape.lineTo(wi / 2, 0); shape.lineTo(wi / 2, bh); shape.lineTo(-wi / 2, bh); shape.lineTo(-wi / 2, 0);
  // One row across the baffle (shared with the blueprint); passive radiators keep their own size.
  const row = frontRow(geo, boxType, count);
  const cy = geo.driverY - bottomOfBaffle;
  row.forEach((it) => {
    const hole = new THREE.Path();
    hole.absarc(it.x, cy, it.cut, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  });
  const baffleGeo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 48 });
  const baffle = new THREE.Mesh(baffleGeo, looks.front());
  baffle.position.set(0, bottomOfBaffle, dx / 2 - t);
  g.add(baffle);
  shell.push(baffle);

  const drivers: DriverParts[] = [];
  const passiveRadiators: DriverParts[] = [];
  row.forEach(({ x, passive }) => {
    const d = passive ? buildDriver(prShape, true) : buildDriver(driverShape, false, look ?? undefined);
    d.root.position.set(x, geo.driverY, dx / 2);
    g.add(d.root);
    // Basket and magnet live inside the box: only visible in x-ray.
    d.rear.removeFromParent();
    d.rear.position.set(x, geo.driverY, dx / 2);
    if (!passive) internals.add(d.rear);
    (passive ? passiveRadiators : drivers).push(d);
  });

  // Side-mounted passive radiators, surface-mounted on the outside of each side panel, facing out.
  if (boxType === 'pr') {
    for (const side of [-1, 1] as const) {
      for (const z of sideRow(geo)) {
        const d = buildDriver(prShape, true);
        d.root.rotation.y = side * Math.PI / 2;
        d.root.position.set(side * wx / 2, hx / 2, z);
        g.add(d.root);
        d.rear.removeFromParent();
        passiveRadiators.push(d);
      }
    }
  }

  // Band-pass / isobaric: drivers hidden inside, on a divider (visible in x-ray only).
  const hiddenDrivers: DriverParts[] = [];
  if (boxType === 'bp4' || boxType === 'bp6' || boxType === 'isobaric') {
    // A band-pass divider splits the inside by the two chamber volumes.
    const zDiv = boxType === 'isobaric' ? dx / 2 - depth - 0.03 : -dx / 2 + t + geo.di * geo.rearFraction;
    for (const x of innerRow(geo, boxType, count)) {
      const d = buildDriver(driverShape, false, look ?? undefined);
      d.root.position.set(x, geo.driverY, zDiv);
      internals.add(d.root);
      hiddenDrivers.push(d);
    }
    if (boxType !== 'isobaric') slab(wi, hx - 2 * t - (hasFrontPort ? slotH + t : 0), t, new THREE.MeshStandardMaterial({ color: 0x2b3442, transparent: true, opacity: 0.6 }), 0, hx / 2 + (hasFrontPort ? (slotH + t) / 2 : 0), zDiv - t / 2, internals);
  }

  // Slot port: ceiling panel from the front edge, plus an L-shaped riser when it is long.
  let portMouth: Enclosure['portMouth'] = null;
  if (hasFrontPort) {
    // In a band-pass the port lives in the front chamber only, so it folds up at the divider.
    const { run, riser } = slotBoards(geo);
    const foldZ = dx / 2 - t - geo.frontDepth + slotH + t / 2;
    const ceiling = slab(wi, t, Math.max(0.02, run + t), portMat(), 0, t + slotH + t / 2, dx / 2 - (run + t) / 2);
    shell.push(ceiling);
    const tunnel = new THREE.Mesh(new THREE.PlaneGeometry(wi, slotH), new THREE.MeshBasicMaterial({ color: 0x020304 }));
    tunnel.position.set(0, t + slotH / 2, dx / 2 - Math.max(0.03, run * 0.6));
    g.add(tunnel);
    if (riser > 0 && wedge) {
      // Up a wedge the riser leans with the back panel, one slot height inside it.
      const a = geo.backAngle;
      const len = riser;
      const y = t + slotH + t + (len / 2) * Math.cos(a);
      const board = slab(wi, len, t, portMat(), 0, y, backZ(y) + (t + slotH + t / 2) / Math.cos(a), internals);
      board.rotation.x = a;
    } else if (riser > 0) slab(wi, riser, t, portMat(), 0, t + slotH + riser / 2, foldZ, internals);
    portMouth = { y: t + slotH / 2, z: dx / 2, width: wi, height: slotH };
  }

  // Window brace and polyfill, internal only.
  const braceMat = new THREE.MeshStandardMaterial({ color: 0x64748b, transparent: true, opacity: 0.55 });
  const yA = hasFrontPort ? t + slotH + t : t;
  const innerH = hx - t - yA;
  const bar = 0.05;
  // Halfway into the shallowest part, so a wedge's brace stays inside its leaning back.
  const zB = wedge ? dx / 2 - t - geo.diTop / 2 : 0;
  slab(wi, bar, t, braceMat, 0, yA + bar / 2, zB, internals);
  slab(wi, bar, t, braceMat, 0, hx - t - bar / 2, zB, internals);
  slab(bar, innerH, t, braceMat, -wi / 2 + bar / 2, yA + innerH / 2, zB, internals);
  slab(bar, innerH, t, braceMat, wi / 2 - bar / 2, yA + innerH / 2, zB, internals);
  // Fill, drawn as many tufts as the fill amount calls for (none when the box is empty).
  const tufts = Math.round(220 * Math.min(1, Math.max(0, fill)));
  if (tufts > 0) {
    const fluff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.006, 0), new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.45 }), tufts);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < tufts; i++) {
      const y = yA + 0.04 + rnd() * (innerH - 0.08);
      // Inside depth at this height (a wedge narrows towards the top).
      const deep = geo.di - (geo.di - geo.diTop) * ((y - t) / geo.hi);
      fluff.setMatrixAt(i, m4.makeTranslation((rnd() - 0.5) * wi * 0.85, y, dx / 2 - t - 0.02 - rnd() * Math.max(0.02, deep - 0.04)));
    }
    internals.add(fluff);
  }
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
    group: g, shell, baffle, internals, edges, drivers, hiddenDrivers, passiveRadiators, portMouth, rearPortMouth,
    sources: {
      cone: new THREE.Vector3(cone0 ? cone0.root.position.x : 0, geo.driverY, dx / 2),
      port: portMouth ? new THREE.Vector3(0, portMouth.y, dx / 2) : null,
      port2: rearPortMouth ? new THREE.Vector3(0, rearPortMouth.y, -dx / 2) : null
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
