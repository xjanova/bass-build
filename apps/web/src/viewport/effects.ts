import { abs, clamp, cos, float, fract, length, max, mix, positionWorld, sin, smoothstep, step, uniform, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { bays } from '../sim/layout';
import type { BoxGeometry } from '../sim/model';

/**
 * Pressure field on a horizontal slice from up to three monopoles (cone, front port or passive
 * radiator, rear port of a 6th-order band-pass) using the complex volume velocities from the
 * lumped model: p(r,t) = Re{A e^{j(ωt − kr)}} / r. Physically consistent wavelength and phase
 * between the sources, but no box diffraction (that is FDTD's job).
 */
export class WavePlane {
  readonly mesh: THREE.Mesh;
  private readonly phase = uniform(0);
  private readonly k = uniform(1);
  private readonly s1 = uniform(new THREE.Vector3());
  private readonly a1 = uniform(new THREE.Vector2());
  private readonly s2 = uniform(new THREE.Vector3());
  private readonly a2 = uniform(new THREE.Vector2());
  private readonly s3 = uniform(new THREE.Vector3());
  private readonly a3 = uniform(new THREE.Vector2());
  private readonly norm = uniform(1);

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const src = (s: typeof this.s1, a: typeof this.a1) => {
      const r = max(length(positionWorld.sub(s)), float(0.12));
      const ph = this.phase.sub(this.k.mul(r));
      return a.x.mul(cos(ph)).sub(a.y.mul(sin(ph))).div(r);
    };
    const v = clamp(src(this.s1, this.a1).add(src(this.s2, this.a2)).add(src(this.s3, this.a3)).mul(this.norm), -1, 1);
    const pos = mix(vec3(0.133, 0.827, 0.933), vec3(0.92, 0.99, 1.0), v.mul(v));
    // Isobars every 1/6 of full scale: at bass frequencies the whole slice breathes in phase,
    // and the lines are what shows the pressure falling off with distance.
    const iso = float(1).sub(smoothstep(0.0, 0.07, abs(fract(v.mul(6).add(0.5)).sub(0.5))));
    mat.colorNode = mix(vec3(0.231, 0.51, 0.965), pos, step(0.0, v));
    mat.opacityNode = abs(v).mul(0.26).add(iso.mul(0.32)).add(0.015);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 2;
  }

  /** Complex source strengths (any common scale) at positions in world metres; null = silent. */
  setSources(sources: ({ at: THREE.Vector3; a: [number, number] } | null)[], k: number, y: number, centerZ: number): void {
    const slots: [typeof this.s1, typeof this.a1][] = [[this.s1, this.a1], [this.s2, this.a2], [this.s3, this.a3]];
    let total = 0;
    slots.forEach(([sv, av], i) => {
      const src = sources[i];
      if (src) { sv.value.copy(src.at); av.value.set(src.a[0], src.a[1]); total += Math.hypot(...src.a); } else av.value.set(0, 0);
    });
    this.k.value = k;
    this.norm.value = total > 0 ? 0.55 / total : 0;
    this.mesh.position.set(0, y, centerZ);
  }

  setPhase(wt: number): void { this.phase.value = wt; }
}

/** Arrows at the slot mouth whose length and direction follow the instantaneous port velocity. */
export class PortArrows {
  readonly group = new THREE.Group();
  private readonly arrows: THREE.ArrowHelper[] = [];
  constructor() {
    for (let i = 0; i < 7; i++) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.1, 0xbef264, 0.04, 0.025);
      this.arrows.push(a);
      this.group.add(a);
    }
  }
  update(mouth: { y: number; z: number; width: number } | null, v: number, vPeak: number): void {
    this.group.visible = !!mouth && vPeak > 0.2;
    if (!mouth || !this.group.visible) return;
    const len = (0.32 * v) / Math.max(20, vPeak);
    this.arrows.forEach((a, i) => {
      const x = (-0.5 + (i + 0.5) / this.arrows.length) * mouth.width * 0.9;
      const l = Math.abs(len);
      if (l < 0.01) { a.visible = false; return; }
      a.visible = true;
      a.setDirection(new THREE.Vector3(0, 0, Math.sign(len)));
      a.position.set(x, mouth.y, len >= 0 ? mouth.z + 0.004 : mouth.z + 0.004 + l);
      a.setLength(l, Math.min(0.05, l * 0.4), Math.min(0.03, l * 0.25));
    });
  }
}

interface Puff { t0: number; v0: number; seed: number }

/**
 * Smoke at the port: a "breathing" haze displaced by the true air displacement (v/ω, falling
 * off with distance) plus vortex pairs shed on each outflow when the stroke is long enough to
 * separate (ξ > 0.4·slot height). Phenomenological; the LBM solver replaces it in phase 7.
 */
export class Smoke {
  readonly mesh: THREE.InstancedMesh;
  private puffs: Puff[] = [];
  private prevV = 0;
  private readonly haze: [number, number, number][] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private seed = 3;
  private static readonly MAX = 900;

  constructor(texture: THREE.Texture) {
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, Smoke.MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < 90; i++) this.haze.push([this.rnd() - 0.5, this.rnd() - 0.5, this.rnd()]);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  }

  private rnd(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  update(t: number, w: number, vPeak: number, vNow: number, phase: number, mouth: { y: number; z: number; width: number; height: number } | null, camera: THREE.Camera): void {
    let n = 0;
    if (mouth && vPeak > 0.05) {
      const xi = vPeak / w; // peak air displacement at the mouth, m
      if (this.prevV <= 0 && vNow > 0 && xi > 0.4 * mouth.height && this.puffs.length < 16) this.puffs.push({ t0: t, v0: 0.45 * vPeak, seed: this.rnd() * 100 });
      this.prevV = vNow;
      const life = Math.max(0.03, 6 / (w / (2 * Math.PI)));
      this.puffs = this.puffs.filter((p) => t - p.t0 < life && t >= p.t0);
      this.q.copy(camera.quaternion);
      const xiT = xi * Math.sin(w * t + phase);
      for (const r of this.haze) {
        const dist = 0.02 + r[2] * 0.22;
        const fall = Math.min(1, Math.pow(mouth.height / (dist + mouth.height), 2));
        this.put(n++, r[0] * mouth.width, mouth.y + r[1] * 0.08, mouth.z + dist + xiT * fall * 0.9, 0.06, 0.08);
      }
      for (const p of this.puffs) {
        const age = t - p.t0, u = age / life, tau = life * 0.35;
        const trav = p.v0 * tau * (1 - Math.exp(-age / tau));
        const rc = mouth.height * 0.35 + trav * 0.12;
        const rot = (p.v0 / Math.max(0.02, mouth.height)) * age;
        for (let k = 0; k < 44 && n < Smoke.MAX; k++) {
          const top = k < 22 ? 1 : -1, idx = k % 22;
          const x = (-0.5 + (idx + 0.5) / 22) * mouth.width * 0.92;
          const ang = p.seed + idx * 0.7 + top * rot;
          this.put(n++, x, mouth.y + top * (mouth.height * 0.5 + rc * Math.sin(ang)), mouth.z + 0.01 + trav + rc * Math.cos(ang), 0.04 + trav * 0.3, 0.32 * (1 - u));
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private put(i: number, x: number, y: number, z: number, size: number, alpha: number): void {
    this.p.set(x, y, z);
    this.s.set(size, size, size);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.setColorAt(i, this.c.setScalar(Math.max(0, alpha)));
  }
}

/** Far-field directivity of a rigid piston: |2 J1(ka sinθ)/(ka sinθ)|, drawn as a wire balloon. */
export class Balloon {
  readonly lines: THREE.LineSegments;
  constructor() {
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.4 }));
  }
  update(f: number, pistonRadius: number, center: THREE.Vector3, c = 343): void {
    const ka = (2 * Math.PI * f * pistonRadius) / c;
    const j1 = (x: number) => { let s = 0, term = x / 2; for (let k = 0; k < 14; k++) { s += term; term *= -(x * x) / (4 * (k + 1) * (k + 2)); } return s; };
    const R = (th: number) => {
      const u = ka * Math.sin(th);
      const d = Math.abs(u < 1e-6 ? 1 : (2 * j1(u)) / u);
      return 0.45 * Math.max(0.12, 1 + (20 * Math.log10(Math.max(d, 1e-4))) / 30);
    };
    const pts: number[] = [];
    const pt = (th: number, ph: number) => {
      const r = R(th);
      return [center.x + r * Math.sin(th) * Math.cos(ph), center.y + r * Math.sin(th) * Math.sin(ph), center.z + r * Math.cos(th)];
    };
    const seg = (a: number[], b: number[]) => pts.push(...a, ...b);
    for (let k = 0; k < 6; k++) { const ph = (k / 6) * Math.PI; for (let i = 0; i < 48; i++) seg(pt((i / 48) * 2 * Math.PI, ph), pt(((i + 1) / 48) * 2 * Math.PI, ph)); }
    for (const th of [0.5, 1.0, Math.PI / 2, 2.1, 2.6]) for (let i = 0; i < 40; i++) seg(pt(th, (i / 40) * 2 * Math.PI), pt(th, ((i + 1) / 40) * 2 * Math.PI));
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry();
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
}

/** First bending mode (1,1) of the side panel, displacement greatly exaggerated. */
export class PanelVibe {
  readonly mesh: THREE.Mesh;
  // Fine enough for one hump in each bay between up to three braces.
  private readonly N = 32;
  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1, this.N, this.N);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array((this.N + 1) * (this.N + 1) * 3), 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  }
  update(geo: BoxGeometry, side: -1 | 1, phase: number, amp = 1): void {
    const g = this.mesh.geometry as THREE.PlaneGeometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const A = 0.02;
    const t = geo.t;
    const held = geo.braces?.sideHeld ?? [];
    for (let j = 0; j <= this.N; j++) {
      const v = j / this.N;
      // Braces hold the panel along lines: each bay between them bends on its own, neighbours in
      // opposite phase (as the first mode of a plate over several supports does).
      const outer = geo.dx + (geo.dxTop - geo.dx) * v;
      const row = bays(held, outer - 2 * t);
      for (let i = 0; i <= this.N; i++) {
        const idx = j * (this.N + 1) + i;
        const u = i / this.N;
        const z = u * outer - t;
        const bay = row.findIndex(([a, b]) => z >= a && z <= b);
        const along = bay >= 0 ? Math.sin((Math.PI * (z - row[bay][0])) / Math.max(1e-6, row[bay][1] - row[bay][0])) * (bay % 2 ? -1 : 1) : 0;
        const w = along * Math.sin(Math.PI * v) * Math.sin(phase) * amp;
        // Spread over the side panel at each height (a wedge's side narrows towards the top).
        pos.setXYZ(idx, side * (geo.wx / 2 + 0.003 + A * w), v * geo.hx, geo.dx / 2 - u * (geo.dx + (geo.dxTop - geo.dx) * v));
        const k = Math.abs(w);
        if (w >= 0) col.setXYZ(idx, 0.65 * k + 0.1, 0.55 * k + 0.05, 0.98 * k + 0.15);
        else col.setXYZ(idx, 0.18 * k + 0.05, 0.83 * k + 0.08, 0.75 * k + 0.1);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    g.computeBoundingSphere();
  }
}
