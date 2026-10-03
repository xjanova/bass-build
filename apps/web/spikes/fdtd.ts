import { Ema, initGpu, setText, showError, type Gpu } from './gpu';

/**
 * Feasibility spike for the wave view: linear acoustic FDTD on a staggered (Yee) grid,
 * p–v form in normalised units (ρ = c = Δx = 1, Courant S = 0.5). Scene: a box with a piston
 * "driver" on the front baffle and an optional slot port, in free field with absorbing borders.
 */

const PRESETS: Record<string, [number, number, number]> = { s: [144, 96, 96], m: [192, 128, 128], l: [288, 192, 192] };
const DOMAIN_X = 2.88; // m
const C_SOUND = 343;
const RHO = 1.2;
const S = 0.5;
const PISTON_MS = 1; // piston velocity amplitude, m/s
const WG = 128;

const COMMON = /* wgsl */ `
struct Params {
  nx: u32, ny: u32, nz: u32, n: u32,
  s: f32, amp: f32, omega: f32, spongeW: u32,
  spongeMax: f32, ramp: f32, _a: f32, _b: f32,
};
@group(0) @binding(0) var<uniform> P: Params;
fn damp(x: u32, y: u32, z: u32) -> f32 {
  let d = min(min(min(x, y), min(z, P.nx - 1u - x)), min(P.ny - 1u - y, P.nz - 1u - z));
  if (d >= P.spongeW) { return 1.0; }
  let t = f32(P.spongeW - d) / f32(P.spongeW);
  return 1.0 - P.spongeMax * t * t;
}
`;

const V_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read> p: array<f32>;
@group(0) @binding(2) var<storage, read_write> vx: array<f32>;
@group(0) @binding(3) var<storage, read_write> vy: array<f32>;
@group(0) @binding(4) var<storage, read_write> vz: array<f32>;
@group(0) @binding(5) var<storage, read> flags: array<u32>;
@group(0) @binding(6) var<storage, read> counter: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  let x = i % P.nx; let y = (i / P.nx) % P.ny; let z = i / (P.nx * P.ny);
  let fl = flags[i];
  let t = f32(counter[0]);
  let drive = P.amp * sin(P.omega * t) * min(1.0, t / P.ramp);
  let k = damp(x, y, z);
  if (x + 1u < P.nx) {
    let fj = flags[i + 1u];
    var v = 0.0;
    if (fl == 2u || fj == 2u) { v = drive; }
    else if (fl == 0u && fj == 0u) { v = (vx[i] - P.s * (p[i + 1u] - p[i])) * k; }
    vx[i] = v;
  }
  if (y + 1u < P.ny) {
    let j = i + P.nx;
    var v = 0.0;
    if (fl == 0u && flags[j] == 0u) { v = (vy[i] - P.s * (p[j] - p[i])) * k; }
    vy[i] = v;
  }
  if (z + 1u < P.nz) {
    let j = i + P.nx * P.ny;
    var v = 0.0;
    if (fl == 0u && flags[j] == 0u) { v = (vz[i] - P.s * (p[j] - p[i])) * k; }
    vz[i] = v;
  }
}
`;

const P_WGSL = COMMON + /* wgsl */ `
@group(0) @binding(1) var<storage, read_write> p: array<f32>;
@group(0) @binding(2) var<storage, read> vx: array<f32>;
@group(0) @binding(3) var<storage, read> vy: array<f32>;
@group(0) @binding(4) var<storage, read> vz: array<f32>;
@group(0) @binding(5) var<storage, read> flags: array<u32>;

@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.n) { return; }
  if (flags[i] != 0u) { p[i] = 0.0; return; }
  let x = i % P.nx; let y = (i / P.nx) % P.ny; let z = i / (P.nx * P.ny);
  var dv = vx[i] + vy[i] + vz[i];
  if (x > 0u) { dv -= vx[i - 1u]; }
  if (y > 0u) { dv -= vy[i - P.nx]; }
  if (z > 0u) { dv -= vz[i - P.nx * P.ny]; }
  p[i] = (p[i] - P.s * dv) * damp(x, y, z);
}
`;

const TICK_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> counter: array<u32>;
@compute @workgroup_size(1)
fn main() { counter[0] = counter[0] + 1u; }
`;

const RENDER_WGSL = /* wgsl */ `
struct R { nx: u32, ny: u32, nz: u32, slice: u32, scale: f32, _a: f32, _b: f32, _c: f32 };
@group(0) @binding(0) var<uniform> RP: R;
@group(0) @binding(1) var<storage, read> p: array<f32>;
@group(0) @binding(2) var<storage, read> flags: array<u32>;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var q = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4<f32>(q[vi], 0.0, 1.0);
  o.uv = (q[vi] + vec2<f32>(1.0)) * 0.5;
  return o;
}
@fragment
fn fs(vin: VOut) -> @location(0) vec4<f32> {
  let x = min(u32(vin.uv.x * f32(RP.nx)), RP.nx - 1u);
  let y = min(u32(vin.uv.y * f32(RP.ny)), RP.ny - 1u);
  let i = x + RP.nx * (y + RP.ny * RP.slice);
  let fl = flags[i];
  if (fl == 1u) { return vec4<f32>(0.33, 0.24, 0.16, 1.0); }
  if (fl == 2u) { return vec4<f32>(0.85, 0.9, 0.95, 1.0); }
  // Signed log scale: the box interior is ~40 dB louder than the room, linear colour would saturate.
  let a = p[i] * RP.scale;
  let v = clamp(sign(a) * log(1.0 + abs(a)) / log(301.0), -1.0, 1.0);
  let base = vec3<f32>(0.02, 0.03, 0.06);
  let col = select(mix(base, vec3<f32>(0.23, 0.51, 0.96), -v), mix(base, vec3<f32>(0.65, 0.95, 0.99), v), v > 0.0);
  return vec4<f32>(col, 1.0);
}
`;

interface Scene { flags: Uint32Array; sliceZ: number; mic: number; dx: number }

function buildScene(nx: number, ny: number, nz: number, vented: boolean): Scene {
  const dx = DOMAIN_X / nx;
  const c = (m: number) => Math.round(m / dx);
  const flags = new Uint32Array(nx * ny * nz);
  const [x0, x1] = [c(0.46), c(0.9)];
  const [y0, y1] = [c(0.69), c(1.23)];
  const [z0, z1] = [c(0.63), c(1.29)];
  const tw = Math.max(1, c(0.018));
  const dy = c(1.0), dz = c(0.96), dr = 0.17 / dx;
  for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const wall = x < x0 + tw || x > x1 - tw || y < y0 + tw || y > y1 - tw || z < z0 + tw || z > z1 - tw;
    if (!wall) continue;
    const i = x + nx * (y + ny * z);
    const front = x > x1 - tw;
    const inDriver = front && Math.hypot(y - dy, z - dz) <= dr;
    const inSlot = vented && front && y >= c(0.72) && y < c(0.76) && z >= c(0.7) && z <= c(1.22);
    if (inDriver) flags[i] = x === x1 ? 2 : 0; // one-cell piston slab at the outer face
    else if (inSlot) flags[i] = 0;
    else flags[i] = 1;
  }
  return { flags, sliceZ: dz, mic: Math.min(nx - 1, x1 + c(1.0)) + nx * (dy + ny * dz), dx };
}

interface Pipes { v: GPUComputePipeline; p: GPUComputePipeline; tick: GPUComputePipeline; render: GPURenderPipeline }

class Fdtd {
  readonly n: number;
  readonly scene: Scene;
  readonly p: GPUBuffer;
  readonly flags: GPUBuffer;
  readonly counter: GPUBuffer;
  private readonly bufs: GPUBuffer[];
  private readonly params: GPUBuffer;
  private readonly vBg: GPUBindGroup;
  private readonly pBg: GPUBindGroup;
  private readonly tickBg: GPUBindGroup;

  constructor(private readonly device: GPUDevice, private readonly pipes: Pipes, readonly nx: number, readonly ny: number, readonly nz: number, vented: boolean) {
    this.n = nx * ny * nz;
    this.scene = buildScene(nx, ny, nz, vented);
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const mk = () => device.createBuffer({ size: this.n * 4, usage });
    this.p = mk();
    const vx = mk(), vy = mk(), vz = mk();
    this.flags = mk();
    device.queue.writeBuffer(this.flags, 0, this.scene.flags);
    this.counter = device.createBuffer({ size: 16, usage });
    this.params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bufs = [this.p, vx, vy, vz, this.flags, this.counter, this.params];
    const e = (binding: number, buffer: GPUBuffer) => ({ binding, resource: { buffer } });
    this.vBg = device.createBindGroup({ layout: pipes.v.getBindGroupLayout(0), entries: [e(0, this.params), e(1, this.p), e(2, vx), e(3, vy), e(4, vz), e(5, this.flags), e(6, this.counter)] });
    this.pBg = device.createBindGroup({ layout: pipes.p.getBindGroupLayout(0), entries: [e(0, this.params), e(1, this.p), e(2, vx), e(3, vy), e(4, vz), e(5, this.flags)] });
    this.tickBg = device.createBindGroup({ layout: pipes.tick.getBindGroupLayout(0), entries: [e(0, this.counter)] });
  }

  setFrequency(f: number): void {
    const dt = (S * this.scene.dx) / C_SOUND;
    const ab = new ArrayBuffer(48);
    const u = new Uint32Array(ab);
    const fl = new Float32Array(ab);
    u[0] = this.nx; u[1] = this.ny; u[2] = this.nz; u[3] = this.n;
    fl[4] = S; fl[5] = PISTON_MS / C_SOUND; fl[6] = 2 * Math.PI * f * dt; u[7] = Math.max(8, Math.round(this.nx / 12));
    fl[8] = 0.08; fl[9] = 2 / (f * dt); // soft start over two periods
    this.device.queue.writeBuffer(this.params, 0, ab);
  }

  encode(enc: GPUCommandEncoder, steps: number): void {
    const pass = enc.beginComputePass();
    const g = Math.ceil(this.n / WG);
    for (let s = 0; s < steps; s++) {
      pass.setPipeline(this.pipes.v); pass.setBindGroup(0, this.vBg); pass.dispatchWorkgroups(g);
      pass.setPipeline(this.pipes.p); pass.setBindGroup(0, this.pBg); pass.dispatchWorkgroups(g);
      pass.setPipeline(this.pipes.tick); pass.setBindGroup(0, this.tickBg); pass.dispatchWorkgroups(1);
    }
    pass.end();
  }

  destroy(): void { this.bufs.forEach((b) => b.destroy()); }
}

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
  const rm = device.createShaderModule({ code: RENDER_WGSL });
  const pipes: Pipes = {
    v: compute(V_WGSL), p: compute(P_WGSL), tick: compute(TICK_WGSL),
    render: device.createRenderPipeline({ layout: 'auto', vertex: { module: rm, entryPoint: 'vs' }, fragment: { module: rm, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
  };
  const ru = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const micRead = device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  let micBusy = false;
  const ui = {
    res: document.getElementById('res') as HTMLSelectElement,
    freq: document.getElementById('freq') as HTMLInputElement,
    gain: document.getElementById('gain') as HTMLInputElement,
    box: document.getElementById('box') as HTMLSelectElement,
    reset: document.getElementById('reset') as HTMLButtonElement
  };
  let sim: Fdtd | null = null;
  let steps = 10;
  let frameNo = 0;
  let micPeak = 0;
  const mlups = new Ema(0.15);
  const sps = new Ema(0.15);

  const rebuild = () => {
    sim?.destroy();
    const [nx, ny, nz] = PRESETS[ui.res.value];
    sim = new Fdtd(device, pipes, nx, ny, nz, ui.box.value === 'vented');
    micPeak = 0;
    setText('cells', `${(sim.n / 1e6).toFixed(2)} ล้าน`);
    apply();
  };
  const apply = () => {
    const f = Number(ui.freq.value);
    setText('freqOut', `${f} Hz`);
    setText('gainOut', `${Number(ui.gain.value).toFixed(1)}×`);
    sim?.setFrequency(f);
  };
  Object.assign(globalThis, { __fdtd: { device, sim: () => sim } });
  ui.res.addEventListener('change', rebuild);
  ui.box.addEventListener('change', rebuild);
  ui.reset.addEventListener('click', rebuild);
  ui.freq.addEventListener('input', apply);
  ui.gain.addEventListener('input', apply);
  rebuild();

  const frame = async () => {
    const s = sim;
    if (!s) return;
    const t0 = performance.now();
    const enc = device.createCommandEncoder();
    s.encode(enc, steps);
    const ab = new ArrayBuffer(32);
    const u = new Uint32Array(ab);
    const f = new Float32Array(ab);
    u[0] = s.nx; u[1] = s.ny; u[2] = s.nz; u[3] = s.scene.sliceZ;
    // Scale so the field 1 m away sits mid-range on the log colour map and the box interior saturates.
    f[4] = (C_SOUND / PISTON_MS) * 600 * Number(ui.gain.value);
    device.queue.writeBuffer(ru, 0, ab);
    const bg = device.createBindGroup({ layout: pipes.render.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: ru } }, { binding: 1, resource: { buffer: s.p } }, { binding: 2, resource: { buffer: s.flags } }
    ] });
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(pipes.render); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
    const readMic = !micBusy && frameNo % 4 === 0;
    if (readMic) enc.copyBufferToBuffer(s.p, s.scene.mic * 4, micRead, 0, 4);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    if (readMic) {
      micBusy = true;
      micRead.mapAsync(GPUMapMode.READ).then(() => {
        const v = new Float32Array(micRead.getMappedRange().slice(0))[0];
        micRead.unmap();
        micPeak = Math.max(micPeak * 0.97, Math.abs(v) * RHO * C_SOUND * C_SOUND);
        micBusy = false;
      });
    }
    if (s === sim) {
      const dt = (S * s.scene.dx) / C_SOUND;
      const r = sps.push((steps * 1000) / ms);
      mlups.push((s.n * steps) / (ms / 1000) / 1e6);
      setText('mlups', `${mlups.value.toFixed(0)} MLUPS`);
      setText('sps', r.toFixed(0));
      setText('slow', `×${(1 / (r * dt)).toFixed(0)}`);
      setText('mic', micPeak > 0 ? `${micPeak.toFixed(2)} Pa · ${(20 * Math.log10(micPeak / Math.SQRT2 / 2e-5)).toFixed(1)} dB` : '–');
      steps = Math.max(1, Math.min(600, Math.round(steps * Math.min(1.5, Math.max(0.5, 33 / ms)))));
    }
    frameNo++;
    requestAnimationFrame(() => { frame().catch((e) => showError(String(e))); });
  };
  requestAnimationFrame(() => { frame().catch((e) => showError(String(e))); });
}

main().catch((e) => showError(String(e)));
