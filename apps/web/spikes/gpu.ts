/** Shared WebGPU bootstrap and stats panel for the solver spikes. */
export interface Gpu {
  device: GPUDevice;
  adapterName: string;
  limits: { maxStorage: number; maxBuffer: number };
}

export async function initGpu(): Promise<Gpu> {
  if (!('gpu' in navigator)) throw new Error('เบราว์เซอร์นี้ไม่มี WebGPU (ลองใช้ Chrome หรือ Edge รุ่นล่าสุด)');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('ไม่พบการ์ดจอที่ใช้ WebGPU ได้');
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBuffersPerShaderStage: Math.min(8, adapter.limits.maxStorageBuffersPerShaderStage)
    }
  });
  device.lost.then((info) => showError(`การ์ดจอหลุดการเชื่อมต่อ: ${info.message}`));
  const info = adapter.info;
  const adapterName = [info.vendor, info.architecture, info.description].filter(Boolean).join(' · ') || 'unknown adapter';
  return {
    device,
    adapterName,
    limits: { maxStorage: adapter.limits.maxStorageBufferBindingSize, maxBuffer: adapter.limits.maxBufferSize }
  };
}

export function showError(msg: string): void {
  const el = document.getElementById('error');
  if (el) { el.textContent = msg; el.hidden = false; }
}

/** Exponential moving average so the readout does not flicker. */
export class Ema {
  private v = 0;
  private started = false;
  constructor(private readonly k = 0.1) {}
  push(x: number): number {
    this.v = this.started ? this.v + this.k * (x - this.v) : x;
    this.started = true;
    return this.v;
  }
  get value(): number { return this.v; }
}

export function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
