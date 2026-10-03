import sampleDrivers from '../../../../data/seed/drivers.sample.json';
import sampleMaterials from '../../../../data/seed/materials.json';
import type { DriverDto, PanelMaterialDto } from './types';

/**
 * The C# server owns the database. When it is not running (e.g. viewing the web build alone)
 * the app falls back to the bundled seed data so it still works, and says so on screen.
 */
export type Source = 'server' | 'offline';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

export async function loadDrivers(signal?: AbortSignal): Promise<{ drivers: DriverDto[]; source: Source }> {
  try {
    return { drivers: await getJson<DriverDto[]>('/api/drivers', signal), source: 'server' };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const drivers = (sampleDrivers.drivers as unknown as Omit<DriverDto, 'id'>[]).map((d, i) => ({ ...d, id: i + 1 }));
    return { drivers, source: 'offline' };
  }
}

export async function loadPanelMaterials(signal?: AbortSignal): Promise<PanelMaterialDto[]> {
  try {
    return await getJson<PanelMaterialDto[]>('/api/materials/panels', signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return (sampleMaterials.panelMaterials as unknown as Omit<PanelMaterialDto, 'id'>[]).map((m, i) => ({ ...m, id: i + 1 }));
  }
}
