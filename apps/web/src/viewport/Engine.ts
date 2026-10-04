import type { Cx } from '@bassbuild/physics';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import * as THREE from 'three/webgpu';
import type { BoxGeometry } from '../sim/model';
import type { BoxType, Mode, OverlayId } from '../state/store';
import { Balloon, PanelVibe, PortArrows, Smoke, WavePlane } from './effects';
import { buildEnclosure, type DriverParts, type Enclosure } from './enclosure';
import { looksFor, type Finish } from './finishes';
import { buildRoom } from './room';
import { iron, smokeTexture, tempToT } from './textures';

/** Oscillation state at the generator frequency, from the lumped model. */
export interface Osc {
  coneX: Cx; // peak cone displacement, m (complex)
  prX: Cx | null; // peak passive-radiator displacement, m
  portV: Cx | null; // peak outward air velocity at the port mouth, m/s
  coneU: Cx; // RMS volume velocity of the front-radiating cone(s)
  portU: Cx | null; // RMS outward volume velocity of the port / PR
}

export interface EngineInput {
  geo: BoxGeometry;
  geoKey: string;
  boxType: BoxType;
  finish: Finish;
  /** Panel material key; drives the look of the 'raw' finish. */
  material: string;
  count: number;
  prCount: number;
  driverDepth: number;
  mode: Mode;
  overlays: Record<OverlayId, boolean>;
  genHz: number;
  slow: number;
  playing: boolean;
  osc: Osc | null;
  portPeak: number;
  splAtGen: number;
  thermal: { tvc: number; tmag: number } | null;
  f11: number;
  /** Relative wall vibration amplitude (1 = bare panel; damping sheets make it smaller). */
  vibAmp: number;
}

const re = (z: Cx, wt: number) => z.re * Math.cos(wt) - z.im * Math.sin(wt);

export class Engine {
  private renderer!: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
  private controls!: OrbitControls;
  private readonly labels = new CSS2DRenderer();
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private readonly smokeTex = smokeTexture();
  private seeThrough = false;
  private enc: Enclosure | null = null;
  private key = '';
  private input: EngineInput | null = null;
  private readonly wave = new WavePlane();
  private readonly arrows = new PortArrows();
  private readonly smoke = new Smoke(this.smokeTex);
  private readonly balloon = new Balloon();
  private readonly vibe = new PanelVibe();
  private readonly mic = new THREE.Group();
  private readonly micLabel: CSS2DObject;
  private readonly airLabel: CSS2DObject;
  private readonly dims = new THREE.Group();
  private readonly ghost = new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.06, depthWrite: false });
  private readonly irShell = new THREE.MeshBasicMaterial({ color: iron(0.07) });
  private readonly irParts = { cone: new THREE.MeshBasicMaterial(), cap: new THREE.MeshBasicMaterial(), surround: new THREE.MeshBasicMaterial(), frame: new THREE.MeshBasicMaterial(), magnet: new THREE.MeshBasicMaterial() };
  private readonly originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private tPhys = 0;
  private last = performance.now();
  private irClock = 0;
  private balloonKey = '';
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private started = false;
  backend: 'webgpu' | 'webgl' = 'webgpu';

  constructor(private readonly host: HTMLElement) {
    const tag = (cls: string) => { const d = document.createElement('div'); d.className = cls; return d; };
    this.micLabel = new CSS2DObject(tag('scene-label'));
    this.airLabel = new CSS2DObject(tag('scene-label air'));
  }

  async start(): Promise<void> {
    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    await this.renderer.init();
    if (this.disposed) { this.renderer.dispose(); return; }
    this.backend = (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl';
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.host.appendChild(this.renderer.domElement);
    this.labels.domElement.style.position = 'absolute';
    this.labels.domElement.style.inset = '0';
    this.labels.domElement.style.pointerEvents = 'none';
    this.host.appendChild(this.labels.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;
    this.scene.background = new THREE.Color(0x05070b);
    this.scene.fog = new THREE.Fog(0x05070b, 6, 11);
    this.scene.add(new THREE.HemisphereLight(0xd6d2cc, 0x0b0f16, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-2.5, 3.5, 3);
    const rim = new THREE.DirectionalLight(0x22d3ee, 0.8);
    rim.position.set(2.8, 0.5, -3); // low, so it outlines the edges instead of tinting the top
    this.scene.add(key, rim, buildRoom());

    this.camera.position.set(-1.7, 1.25, 2.5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.3, 0.1);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 5.5;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.renderer.domElement.addEventListener('pointerdown', () => { this.controls.autoRotate = false; }, { once: true });

    // Virtual measurement microphone on a tripod.
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.35, metalness: 0.8 });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 12), metal);
    const capsule = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.12, 20), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.6 }));
    capsule.rotation.x = Math.PI / 2;
    this.mic.add(stand, capsule, this.micLabel);
    this.mic.userData = { stand, capsule };
    this.scene.add(this.mic, this.wave.mesh, this.arrows.group, this.smoke.mesh, this.balloon.lines, this.vibe.mesh, this.dims, this.airLabel);

    const resize = () => {
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.labels.setSize(w, h);
      this.camera.aspect = w / h;
      // Shift the projection so the box sits in the middle of the free area between the panels.
      this.camera.setViewOffset(w, h, w > 1100 ? 40 : 0, h > 600 ? 98 : 0, w, h);
      this.camera.updateProjectionMatrix();
    };
    this.ro = new ResizeObserver(resize);
    this.ro.observe(this.host);
    resize();
    this.started = true;
    if (this.input) this.update(this.input);
    this.renderer.setAnimationLoop(this.frame);
  }

  update(input: EngineInput): void {
    this.input = input;
    if (!this.started) return;
    if (input.geoKey !== this.key) this.rebuild(input);
    const enc = this.enc;
    if (!enc) return;
    const lab = input.mode === 'lab';
    const ov = input.overlays;
    const g = input.geo;
    this.wave.mesh.visible = lab && ov.wave && !!input.osc;
    this.smoke.mesh.visible = lab && ov.smoke;
    this.arrows.group.visible = lab && ov.air;
    this.balloon.lines.visible = lab && ov.balloon;
    this.vibe.mesh.visible = lab && ov.vib;
    this.dims.visible = !lab;
    this.airLabel.visible = lab && ov.air && !!enc.portMouth && input.portPeak > 0.2;
    this.mic.visible = lab;
    this.micLabel.visible = lab; // CSS2DRenderer drives display from .visible
    (this.micLabel.element as HTMLElement).textContent = `ไมค์ 1 ม. · ${input.splAtGen.toFixed(1)} dB @ ${input.genHz} Hz`;

    // Microphone 1 m in front of the baffle, at driver height.
    const { stand, capsule } = this.mic.userData as { stand: THREE.Mesh; capsule: THREE.Mesh };
    stand.scale.y = g.driverY;
    stand.position.set(0, g.driverY / 2, 0);
    capsule.position.set(0, g.driverY, -0.05);
    this.micLabel.position.set(0, g.driverY + 0.12, 0);
    this.mic.position.set(0, 0, g.dx / 2 + 1);

    const bkey = `${input.genHz}|${g.driverRadius}|${g.driverY}|${g.dx}`;
    if (bkey !== this.balloonKey) {
      this.balloonKey = bkey;
      this.balloon.update(input.genHz, g.driverRadius * 0.82, new THREE.Vector3(enc.sources.cone.x, g.driverY, g.dx / 2 + 0.02));
    }
    if (input.osc) {
      const w = 2 * Math.PI * input.genHz;
      const k = w / 343;
      // A = jωρU/2π → (−ωρ U.im, ωρ U.re)/2π; only relative scale matters for the colour map.
      const a = (u: Cx): [number, number] => [-u.im, u.re];
      this.wave.setSources(enc.sources.cone, a(input.osc.coneU), enc.sources.port ?? (enc.passiveRadiators[0] ? enc.passiveRadiators[0].root.position : null), input.osc.portU ? a(input.osc.portU) : [0, 0], k, g.driverY, g.dx / 2 + 0.6);
    }
    this.applyLooks(input);
    this.controls.target.set(0, g.hx * 0.45, 0.1);
  }

  private rebuild(input: EngineInput): void {
    this.key = input.geoKey;
    if (this.enc) {
      this.scene.remove(this.enc.group);
      this.enc.dispose();
      this.originals.clear();
    }
    const looks = looksFor(input.finish, input.material, this.textures);
    this.seeThrough = looks.seeThrough;
    this.enc = buildEnclosure(input.geo, input.boxType, input.count, input.prCount, input.driverDepth, looks);
    this.scene.add(this.enc.group);
    this.buildDims(input.geo);
  }

  private buildDims(g: BoxGeometry): void {
    this.dims.children.slice().forEach((c) => { this.dims.remove(c); (c as THREE.LineSegments).geometry?.dispose(); });
    const pts: number[] = [];
    const add = (a: THREE.Vector3, b: THREE.Vector3, off: THREE.Vector3, mm: number) => {
      const A = a.clone().add(off), B = b.clone().add(off);
      pts.push(...a.toArray(), ...A.toArray(), ...b.toArray(), ...B.toArray(), ...A.toArray(), ...B.toArray());
      const el = document.createElement('div');
      el.className = 'dim-label';
      el.textContent = `${Math.round(mm)} มม.`;
      const label = new CSS2DObject(el);
      label.position.copy(A.clone().add(B).multiplyScalar(0.5));
      this.dims.add(label);
    };
    const x = g.wx / 2, z = g.dx / 2;
    add(new THREE.Vector3(-x, 0, z), new THREE.Vector3(x, 0, z), new THREE.Vector3(0, 0, 0.2), g.wx * 1000);
    add(new THREE.Vector3(-x, 0, z), new THREE.Vector3(-x, g.hx, z), new THREE.Vector3(-0.18, 0, 0), g.hx * 1000);
    add(new THREE.Vector3(x, 0, -z), new THREE.Vector3(x, 0, z), new THREE.Vector3(0.18, 0, 0), g.dx * 1000);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.dims.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x7dd3fc })));
  }

  /** Swaps materials for x-ray and infrared without rebuilding geometry. */
  private applyLooks(input: EngineInput): void {
    const enc = this.enc!;
    const lab = input.mode === 'lab';
    const xray = lab && input.overlays.xray;
    const ir = lab && input.overlays.ir;
    const swap = (m: THREE.Mesh, mat: THREE.Material | null) => {
      if (!this.originals.has(m)) this.originals.set(m, m.material);
      m.material = mat ?? this.originals.get(m)!;
    };
    for (const m of enc.shell) swap(m, xray ? this.ghost : ir ? this.irShell : null);
    enc.edges.visible = xray;
    enc.internals.visible = xray || (this.seeThrough && !ir);
    const parts = (d: DriverParts) => [
      [d.cone, this.irParts.cone], [d.cap, this.irParts.cap], [d.surround, this.irParts.surround], [d.frame, this.irParts.frame], [d.magnet, this.irParts.magnet]
    ] as [THREE.Mesh, THREE.Material][];
    for (const d of [...enc.drivers, ...enc.hiddenDrivers]) for (const [m, mat] of parts(d)) swap(m, ir ? mat : null);
  }

  private frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const inp = this.input;
    const enc = this.enc;
    if (inp && enc) {
      if (inp.playing) this.tPhys += dt / inp.slow;
      const w = 2 * Math.PI * inp.genHz;
      const wt = w * this.tPhys;
      const lab = inp.mode === 'lab';
      if (inp.osc && lab) {
        const x = re(inp.osc.coneX, wt);
        for (const d of [...enc.drivers, ...enc.hiddenDrivers]) d.moving.position.z = x;
        if (inp.osc.prX) { const xp = re(inp.osc.prX, wt); for (const d of enc.passiveRadiators) d.moving.position.z = xp; }
        this.wave.setPhase(wt);
        const vNow = inp.osc.portV ? re(inp.osc.portV, wt) : 0;
        const vPk = inp.osc.portV ? Math.hypot(inp.osc.portV.re, inp.osc.portV.im) : 0;
        const ph = inp.osc.portV ? Math.atan2(inp.osc.portV.im, inp.osc.portV.re) : 0;
        if (this.arrows.group.visible) this.arrows.update(enc.portMouth, vNow, inp.portPeak);
        if (this.smoke.mesh.visible) this.smoke.update(this.tPhys, w, vPk, vNow, ph, enc.portMouth, this.camera);
        if (this.airLabel.visible && enc.portMouth) {
          (this.airLabel.element as HTMLElement).textContent = `ลมท่อ ${Math.abs(vNow).toFixed(1)} m/s`;
          this.airLabel.position.set(enc.portMouth.width / 2 + 0.2, enc.portMouth.y, enc.portMouth.z + 0.1);
        }
      } else {
        for (const d of [...enc.drivers, ...enc.hiddenDrivers, ...enc.passiveRadiators]) d.moving.position.z = 0;
      }
      if (this.vibe.mesh.visible) {
        const side: -1 | 1 = this.camera.position.x < 0 ? -1 : 1;
        this.vibe.update(inp.geo, side, 2 * Math.PI * inp.f11 * this.tPhys, inp.vibAmp);
      }
      this.irClock += dt;
      if (inp.thermal && this.irClock > 0.25) {
        this.irClock = 0;
        const { tvc, tmag } = inp.thermal;
        this.irParts.cap.color.copy(iron(tempToT(tvc * 0.97)));
        this.irParts.cone.color.copy(iron(tempToT(25 + (tvc - 25) * 0.45)));
        this.irParts.surround.color.copy(iron(tempToT(25 + (tvc - 25) * 0.2)));
        this.irParts.frame.color.copy(iron(tempToT(25 + (tmag - 25) * 0.6)));
        this.irParts.magnet.color.copy(iron(tempToT(tmag)));
      }
    }
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    this.ro?.disconnect();
    if (!this.started) return; // start() cleans up itself if disposal happened mid-init
    this.renderer.setAnimationLoop(null);
    this.enc?.dispose();
    this.controls?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
    });
    [...this.textures.values(), this.smokeTex].forEach((t) => t.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
