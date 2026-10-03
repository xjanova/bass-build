import { Ema, initGpu, setText, showError, type Gpu } from './gpu';

/**
 * Feasibility spike for the smoke mode: a D3Q19 lattice Boltzmann solver (regularised BGK +
 * Smagorinsky LES) running entirely on the GPU. Scene: a closed box driven by a piston, a slot
 * port through the front wall, open air outside with a sponge layer, and smoke (a passive dye)
 * released at the port mouth.
 */

const PRESETS: Record<string, [number, number, number]> = { s: [128, 48, 32], m: [256, 96, 64], l: [320, 120, 96] };
const C_SOUND = 343;
const DOMAIN_M = 1.28; // physical length of the domain along x
const WG = 128;

const COMMON = /* wgsl */ `
struct Params {
  nx: u32, ny: u32, nz: u32, n: u32,
  tau0: f32, smag: f32, amp: f32, omega: f32,
  outX: u32, spongeW: u32, dyeDecay: f32, spongeMax: f32,
};
`;

const STEP_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> fin: array<f32>;
@group(0) @binding(2) var<storage, read_write> fout: array<f32>;
@group(0) @binding(3) var<storage, read> flags: array<u32>;
@group(0) @binding(4) var<storage, read_write> vel: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> counter: array<u32>;

var<private> CX: array<i32, 19> = array<i32, 19>(0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0);
var<private> CY: array<i32, 19> = array<i32, 19>(0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1);
var<private> CZ: array<i32, 19> = array<i32, 19>(0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1);
var<private> WQ: array<f32, 19> = array<f32, 19>(
  0.33333334,
  0.055555556, 0.055555556, 0.055555556, 0.055555556, 0.055555556, 0.055555556,
  0.027777778, 0.027777778, 0.027777778, 0.027777778, 0.027777778, 0.027777778,
  0.027777778, 0.027777778, 0.027777778, 0.027777778, 0.027777778, 0.027777778);
var<private> OPP: array<u32, 19> = array<u32, 19>(0u, 2u, 1u, 4u, 3u, 6u, 5u, 8u, 7u, 10u, 9u, 12u, 11u, 14u, 13u, 16u, 15u, 18u, 17u);

fn cvec(q: u32) -> vec3<f32> { return vec3<f32>(f32(CX[q]), f32(CY[q]), f32(CZ[q])); }

fn feq(q: u32, rho: f32, u: vec3<f32>) -> f32 {
  let cu = dot(cvec(q), u);
  return WQ[q] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * dot(u, u));
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let fl = flags[i];
  if (fl == 1u || fl == 2u) {
    for (var q = 0u; q < 19u; q++) { fout[q * P.n + i] = WQ[q]; }
    vel[i] = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    return;
  }
  let x = i32(i % P.nx);
  let y = i32((i / P.nx) % P.ny);
  let z = i32(i / (P.nx * P.ny));
  // The piston is a moving wall (Ladd bounce-back): it stays in place but carries velocity uw.
  let uw = vec3<f32>(P.amp * sin(P.omega * f32(counter[0])), 0.0, 0.0);

  // Pull streaming with half-way bounce-back on solid neighbours; outside the domain = air at rest.
  var f: array<f32, 19>;
  var rho = 0.0;
  var mom = vec3<f32>(0.0);
  for (var q = 0u; q < 19u; q++) {
    let sx = x - CX[q];
    let sy = y - CY[q];
    let sz = z - CZ[q];
    var v: f32;
    if (sx < 0 || sy < 0 || sz < 0 || sx >= i32(P.nx) || sy >= i32(P.ny) || sz >= i32(P.nz)) {
      v = WQ[q];
    } else {
      let j = u32(sx) + P.nx * (u32(sy) + P.ny * u32(sz));
      let fj = flags[j];
      if (fj == 1u) { v = fin[OPP[q] * P.n + i]; }
      else if (fj == 2u) { v = fin[OPP[q] * P.n + i] + 6.0 * WQ[q] * dot(cvec(q), uw); }
      else { v = fin[q * P.n + j]; }
    }
    f[q] = v;
    rho += v;
    mom += v * cvec(q);
  }
  rho = max(rho, 0.2);
  var u = mom / rho;
  let speed = length(u);
  if (speed > 0.25) { u = u * (0.25 / speed); }

  // Second-moment non-equilibrium stress, used by both the regularisation and the LES model.
  var pxx = 0.0; var pyy = 0.0; var pzz = 0.0; var pxy = 0.0; var pxz = 0.0; var pyz = 0.0;
  for (var q = 0u; q < 19u; q++) {
    let neq = f[q] - feq(q, rho, u);
    let c = cvec(q);
    pxx += c.x * c.x * neq; pyy += c.y * c.y * neq; pzz += c.z * c.z * neq;
    pxy += c.x * c.y * neq; pxz += c.x * c.z * neq; pyz += c.y * c.z * neq;
  }
  let qn = sqrt(pxx * pxx + pyy * pyy + pzz * pzz + 2.0 * (pxy * pxy + pxz * pxz + pyz * pyz));
  let tau = 0.5 * (P.tau0 + sqrt(P.tau0 * P.tau0 + 18.0 * 1.41421356 * P.smag * qn / rho));
  let keep = 1.0 - 1.0 / tau;

  var s = 0.0;
  if (u32(x) >= P.outX) {
    let d = min(min(min(i32(P.nx) - 1 - x, y), min(i32(P.ny) - 1 - y, z)), i32(P.nz) - 1 - z);
    if (d < i32(P.spongeW)) { s = P.spongeMax * (1.0 - f32(d) / f32(P.spongeW)); }
  }
  for (var q = 0u; q < 19u; q++) {
    let c = cvec(q);
    let reg = WQ[q] * 4.5 * ((c.x * c.x - 0.33333334) * pxx + (c.y * c.y - 0.33333334) * pyy + (c.z * c.z - 0.33333334) * pzz
      + 2.0 * (c.x * c.y * pxy + c.x * c.z * pxz + c.y * c.z * pyz));
    var post = feq(q, rho, u) + keep * reg;
    if (s > 0.0) { post = mix(post, WQ[q], s); }
    fout[q * P.n + i] = post;
  }
  vel[i] = vec4<f32>(u, rho);
}
`;

const DYE_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> dIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> dOut: array<f32>;
@group(0) @binding(3) var<storage, read> vel: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> flags: array<u32>;

fn at(x: i32, y: i32, z: i32) -> f32 {
  let cx = clamp(x, 0, i32(P.nx) - 1);
  let cy = clamp(y, 0, i32(P.ny) - 1);
  let cz = clamp(z, 0, i32(P.nz) - 1);
  return dIn[u32(cx) + P.nx * (u32(cy) + P.ny * u32(cz))];
}

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let fl = flags[i];
  if (fl == 1u || fl == 2u) { dOut[i] = 0.0; return; }
  if (fl == 3u) { dOut[i] = 1.0; return; }
  let x = f32(i % P.nx);
  let y = f32((i / P.nx) % P.ny);
  let z = f32(i / (P.nx * P.ny));
  // Semi-Lagrangian advection: trace one step back along the flow and sample trilinearly.
  let p = vec3<f32>(x, y, z) - vel[i].xyz;
  let b = floor(p);
  let t = p - b;
  let ix = i32(b.x); let iy = i32(b.y); let iz = i32(b.z);
  let c00 = mix(at(ix, iy, iz), at(ix + 1, iy, iz), t.x);
  let c10 = mix(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), t.x);
  let c01 = mix(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), t.x);
  let c11 = mix(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), t.x);
  dOut[i] = mix(mix(c00, c10, t.y), mix(c01, c11, t.y), t.z) * P.dyeDecay;
}
`;

const TICK_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> counter: array<u32>;
@compute @workgroup_size(1)
fn main() { counter[0] = counter[0] + 1u; }
`;

const RENDER_WGSL = /* wgsl */ `
struct R { nx: u32, ny: u32, nz: u32, n: u32, slice: u32, mode: u32, uScale: f32, pScale: f32 };
@group(0) @binding(0) var<uniform> RP: R;
@group(0) @binding(1) var<storage, read> vel: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> dye: array<f32>;
@group(0) @binding(3) var<storage, read> flags: array<u32>;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4<f32>(p[vi], 0.0, 1.0);
  o.uv = (p[vi] + vec2<f32>(1.0)) * 0.5;
  return o;
}

fn idx(x: u32, y: u32) -> u32 { return x + RP.nx * (y + RP.ny * RP.slice); }

fn velAt(x: i32, y: i32) -> vec2<f32> {
  let cx = u32(clamp(x, 0, i32(RP.nx) - 1));
  let cy = u32(clamp(y, 0, i32(RP.ny) - 1));
  return vel[idx(cx, cy)].xy;
}

@fragment
fn fs(vin: VOut) -> @location(0) vec4<f32> {
  let x = min(u32(vin.uv.x * f32(RP.nx)), RP.nx - 1u);
  let y = min(u32(vin.uv.y * f32(RP.ny)), RP.ny - 1u);
  let i = idx(x, y);
  if (flags[i] == 1u) { return vec4<f32>(0.17, 0.2, 0.26, 1.0); }
  if (flags[i] == 2u) { return vec4<f32>(0.4, 0.85, 0.95, 1.0); }
  let v = vel[i];
  let s = clamp(length(v.xyz) / RP.uScale, 0.0, 1.0);
  let navy = vec3<f32>(0.02, 0.04, 0.08);
  var col: vec3<f32>;
  if (RP.mode == 0u) {
    let base = mix(navy, vec3<f32>(0.03, 0.22, 0.3), s * 0.8);
    let d = clamp(dye[i] * 1.3, 0.0, 1.0);
    col = mix(base, vec3<f32>(0.9, 1.0, 0.84), d);
  } else if (RP.mode == 1u) {
    col = mix(mix(navy, vec3<f32>(0.13, 0.83, 0.93), clamp(s * 1.6, 0.0, 1.0)), vec3<f32>(1.0, 1.0, 0.9), clamp(s * 2.0 - 1.0, 0.0, 1.0));
  } else if (RP.mode == 2u) {
    let p = clamp((v.w - 1.0) * RP.pScale, -1.0, 1.0);
    col = select(mix(navy, vec3<f32>(0.23, 0.51, 0.96), -p), mix(navy, vec3<f32>(0.65, 0.95, 0.99), p), p > 0.0);
  } else {
    let xi = i32(x); let yi = i32(y);
    let w = (velAt(xi + 1, yi).y - velAt(xi - 1, yi).y - velAt(xi, yi + 1).x + velAt(xi, yi - 1).x) * 0.5;
    let k = clamp(w / (RP.uScale * 0.25), -1.0, 1.0);
    col = select(mix(navy, vec3<f32>(0.18, 0.83, 0.75), -k), mix(navy, vec3<f32>(0.91, 0.47, 0.98), k), k > 0.0);
  }
  return vec4<f32>(col, 1.0);
}
`;

interface Geometry {
  flags: Uint32Array;
  outX: number;
  probe: number; // cell index at the port mouth centre
}

function buildGeometry(nx: number, ny: number, nz: number): Geometry {
  const flags = new Uint32Array(nx * ny * nz);
  const wall0 = Math.round(nx * 0.375);
  const tw = Math.max(2, Math.round(nx / 32));
  const outX = wall0 + tw;
  const sy0 = Math.round(ny * 0.42), sy1 = Math.round(ny * 0.58);
  const sz0 = Math.round(nz * 0.125), sz1 = Math.round(nz * 0.875);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + nx * (y + ny * z);
    const inSlot = y >= sy0 && y < sy1 && z >= sz0 && z < sz1;
    // Box walls; the piston sits directly on the back wall so it acts as a volume-velocity source.
    if (x < wall0 && (x <= 2 || y === 0 || z === 0 || y === ny - 1 || z === nz - 1)) flags[i] = 1;
    else if (x >= wall0 && x < outX && !inSlot) flags[i] = 1; // front baffle around the slot
    else if (x === 3) flags[i] = 2; // piston (moving wall)
    else if (x >= outX && x < outX + 2 && inSlot) flags[i] = 3; // smoke source at the port mouth
  }
  return { flags, outX, probe: outX + 1 + nx * (Math.round((sy0 + sy1) / 2) + ny * Math.round(nz / 2)) };
}

class Lbm {
  readonly n: number;
  private readonly f: GPUBuffer[];
  private readonly dye: GPUBuffer[];
  readonly vel: GPUBuffer;
  private readonly flagsBuf: GPUBuffer;
  private readonly params: GPUBuffer;
  readonly counter: GPUBuffer;
  private readonly stepBg: GPUBindGroup[];
  private readonly dyeBg: GPUBindGroup[];
  private readonly tickBg: GPUBindGroup;
  private cur = 0;
  readonly geo: Geometry;

  constructor(private readonly device: GPUDevice, private readonly pipes: Pipes, readonly nx: number, readonly ny: number, readonly nz: number) {
    this.n = nx * ny * nz;
    this.geo = buildGeometry(nx, ny, nz);
    const fBytes = this.n * 19 * 4;
    const init = new Float32Array(this.n * 19);
    const w = [1 / 3, ...Array(6).fill(1 / 18), ...Array(12).fill(1 / 36)];
    for (let q = 0; q < 19; q++) init.fill(w[q], q * this.n, (q + 1) * this.n);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.f = [0, 1].map(() => device.createBuffer({ size: fBytes, usage }));
    this.f.forEach((b) => device.queue.writeBuffer(b, 0, init));
    this.dye = [0, 1].map(() => device.createBuffer({ size: this.n * 4, usage }));
    this.vel = device.createBuffer({ size: this.n * 16, usage });
    this.flagsBuf = device.createBuffer({ size: this.n * 4, usage });
    device.queue.writeBuffer(this.flagsBuf, 0, this.geo.flags);
    this.params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counter = device.createBuffer({ size: 16, usage });
    const buf = (b: GPUBuffer) => ({ buffer: b });
    this.stepBg = [0, 1].map((k) => device.createBindGroup({
      layout: pipes.step.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: buf(this.params) }, { binding: 1, resource: buf(this.f[k]) }, { binding: 2, resource: buf(this.f[1 - k]) },
        { binding: 3, resource: buf(this.flagsBuf) }, { binding: 4, resource: buf(this.vel) }, { binding: 5, resource: buf(this.counter) }
      ]
    }));
    this.dyeBg = [0, 1].map((k) => device.createBindGroup({
      layout: pipes.dye.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: buf(this.params) }, { binding: 1, resource: buf(this.dye[k]) }, { binding: 2, resource: buf(this.dye[1 - k]) },
        { binding: 3, resource: buf(this.vel) }, { binding: 4, resource: buf(this.flagsBuf) }
      ]
    }));
    this.tickBg = device.createBindGroup({ layout: pipes.tick.getBindGroupLayout(0), entries: [{ binding: 0, resource: buf(this.counter) }] });
  }

  setParams(p: { tau0: number; smag: number; amp: number; omega: number }): void {
    const ab = new ArrayBuffer(48);
    const u = new Uint32Array(ab);
    const f = new Float32Array(ab);
    u[0] = this.nx; u[1] = this.ny; u[2] = this.nz; u[3] = this.n;
    f[4] = p.tau0; f[5] = p.smag; f[6] = p.amp; f[7] = p.omega;
    u[8] = this.geo.outX; u[9] = Math.max(6, Math.round(this.nx / 16)); f[10] = 0.9995; f[11] = 0.12;
    this.device.queue.writeBuffer(this.params, 0, ab);
  }

  encode(enc: GPUCommandEncoder, steps: number): void {
    const pass = enc.beginComputePass();
    const groups = Math.ceil(this.n / WG);
    for (let s = 0; s < steps; s++) {
      pass.setPipeline(this.pipes.step); pass.setBindGroup(0, this.stepBg[this.cur]); pass.dispatchWorkgroups(groups);
      pass.setPipeline(this.pipes.dye); pass.setBindGroup(0, this.dyeBg[this.cur]); pass.dispatchWorkgroups(groups);
      pass.setPipeline(this.pipes.tick); pass.setBindGroup(0, this.tickBg); pass.dispatchWorkgroups(1);
      this.cur = 1 - this.cur;
    }
    pass.end();
  }

  /** Dye buffer holding the most recent state. */
  get latestDye(): GPUBuffer { return this.dye[this.cur]; }
  get flags(): GPUBuffer { return this.flagsBuf; }

  destroy(): void {
    [...this.f, ...this.dye, this.vel, this.flagsBuf, this.params, this.counter].forEach((b) => b.destroy());
  }
}

interface Pipes { step: GPUComputePipeline; dye: GPUComputePipeline; tick: GPUComputePipeline; render: GPURenderPipeline }

async function main(): Promise<void> {
  let gpu: Gpu;
  try { gpu = await initGpu(); } catch (e) { showError((e as Error).message); return; }
  const { device } = gpu;
  setText('adapter', gpu.adapterName);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const ctx = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const compute = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: 'main' } });
  const renderModule = device.createShaderModule({ code: RENDER_WGSL });
  const pipes: Pipes = {
    step: compute(STEP_WGSL),
    dye: compute(DYE_WGSL),
    tick: compute(TICK_WGSL),
    render: device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    })
  };
  const renderUniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const probeRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  let probeBusy = false;

  const ui = {
    res: document.getElementById('res') as HTMLSelectElement,
    freq: document.getElementById('freq') as HTMLInputElement,
    amp: document.getElementById('amp') as HTMLInputElement,
    mode: document.getElementById('mode') as HTMLSelectElement,
    reset: document.getElementById('reset') as HTMLButtonElement
  };
  let sim: Lbm | null = null;
  let dx = 0;
  let steps = 8;
  const mlups = new Ema(0.15);
  const sps = new Ema(0.15);
  let portSpeed = 0;
  let frameNo = 0;

  const rebuild = () => {
    sim?.destroy();
    const [nx, ny, nz] = PRESETS[ui.res.value];
    sim = new Lbm(device, pipes, nx, ny, nz);
    dx = DOMAIN_M / nx;
    setText('cells', `${(sim.n / 1e6).toFixed(2)} ล้าน`);
    applyParams();
  };
  const applyParams = () => {
    if (!sim) return;
    const dt = dx / (Math.sqrt(3) * C_SOUND); // lattice sound speed 1/√3 mapped to 343 m/s
    const f = Number(ui.freq.value);
    const amp = Number(ui.amp.value);
    setText('freqOut', `${f} Hz`);
    setText('ampOut', `${amp.toFixed(2)} m/s`);
    // ν_lb is floored for stability (LES adds eddy viscosity on top); see note on the page.
    sim.setParams({ tau0: 0.5 + 3 * 0.001, smag: 0.16 * 0.16, amp: (amp * dt) / dx, omega: 2 * Math.PI * f * dt });
  };
  // Debug hook for reading GPU buffers from the console.
  Object.assign(globalThis, { __lbm: { device, sim: () => sim } });
  ui.res.addEventListener('change', rebuild);
  ui.freq.addEventListener('input', applyParams);
  ui.amp.addEventListener('input', applyParams);
  ui.reset.addEventListener('click', rebuild);
  rebuild();

  const frame = async () => {
    if (!sim) return;
    const s = sim;
    const t0 = performance.now();
    const enc = device.createCommandEncoder();
    s.encode(enc, steps);
    const ab = new ArrayBuffer(32);
    const u = new Uint32Array(ab);
    const f = new Float32Array(ab);
    u[0] = s.nx; u[1] = s.ny; u[2] = s.nz; u[3] = s.n; u[4] = Math.floor(s.nz / 2); u[5] = Number(ui.mode.value); f[6] = 0.08; f[7] = 60;
    device.queue.writeBuffer(renderUniform, 0, ab);
    const bg = device.createBindGroup({
      layout: pipes.render.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: renderUniform } }, { binding: 1, resource: { buffer: s.vel } },
        { binding: 2, resource: { buffer: s.latestDye } }, { binding: 3, resource: { buffer: s.flags } }
      ]
    });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(pipes.render); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    const readProbe = !probeBusy && frameNo % 15 === 0;
    if (readProbe) enc.copyBufferToBuffer(s.vel, s.geo.probe * 16, probeRead, 0, 16);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    if (readProbe) {
      probeBusy = true;
      probeRead.mapAsync(GPUMapMode.READ).then(() => {
        const v = new Float32Array(probeRead.getMappedRange().slice(0));
        probeRead.unmap();
        portSpeed = Math.max(portSpeed * 0.9, Math.hypot(v[0], v[1], v[2]) * Math.sqrt(3) * C_SOUND);
        probeBusy = false;
      });
    }
    if (s === sim) {
      const stepsPerSec = sps.push((steps * 1000) / ms);
      mlups.push((s.n * steps) / (ms / 1000) / 1e6);
      const dt = dx / (Math.sqrt(3) * C_SOUND);
      setText('mlups', `${mlups.value.toFixed(0)} MLUPS`);
      setText('sps', stepsPerSec.toFixed(0));
      setText('slow', `×${(1 / (stepsPerSec * dt)).toFixed(0)}`);
      setText('port', `${portSpeed.toFixed(1)} m/s`);
      // Keep each frame near 33 ms of GPU work so the page stays responsive.
      steps = Math.max(1, Math.min(400, Math.round(steps * Math.min(1.5, Math.max(0.5, 33 / ms)))));
    }
    frameNo++;
    requestAnimationFrame(() => { frame().catch((e) => showError(String(e))); });
  };
  requestAnimationFrame(() => { frame().catch((e) => showError(String(e))); });
}

main().catch((e) => showError(String(e)));
