import sampleDrivers from '../../../../data/seed/drivers.sample.json';
import sampleMaterials from '../../../../data/seed/materials.json';
import type { DampingMaterialDto, DriverDto, PanelMaterialDto } from './types';

/**
 * The C# server owns the database. When it is not running (e.g. viewing the web build alone)
 * the app falls back to the bundled seed data so it still works, and says so on screen.
 * The public website is built with VITE_STATIC=1: there is no server behind it, so it goes
 * straight to the bundled data without probing /api.
 */
export type Source = 'server' | 'offline' | 'bundled';

const STATIC_SITE = import.meta.env.VITE_STATIC === '1';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

const bundledDrivers = (): DriverDto[] =>
  (sampleDrivers.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }));

const bundledPanels = (): PanelMaterialDto[] =>
  (sampleMaterials.panelMaterials as unknown as Omit<PanelMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }));

const bundledDamping = (): DampingMaterialDto[] =>
  (sampleMaterials.dampingMaterials as unknown as Omit<DampingMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }));

export async function loadDrivers(signal?: AbortSignal): Promise<{ drivers: DriverDto[]; source: Source }> {
  if (STATIC_SITE) return { drivers: bundledDrivers(), source: 'bundled' };
  try {
    return { drivers: await getJson<DriverDto[]>('/api/drivers', signal), source: 'server' };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return { drivers: bundledDrivers(), source: 'offline' };
  }
}

export async function loadPanelMaterials(signal?: AbortSignal): Promise<PanelMaterialDto[]> {
  if (STATIC_SITE) return bundledPanels();
  try {
    return await getJson<PanelMaterialDto[]>('/api/materials/panels', signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return bundledPanels();
  }
}

export async function loadDampingMaterials(signal?: AbortSignal): Promise<DampingMaterialDto[]> {
  if (STATIC_SITE) return bundledDamping();
  try {
    return await getJson<DampingMaterialDto[]>('/api/materials/damping', signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return bundledDamping();
  }
}
