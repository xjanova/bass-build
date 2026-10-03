/** Properties of air used by every model. */
export interface Air {
  /** Density, kg/m³ */
  rho: number;
  /** Speed of sound, m/s */
  c: number;
}

/** Dry air at the given temperature and static pressure (ideal gas). */
export function airAt(tempC = 20, pressurePa = 101325): Air {
  const t = tempC + 273.15;
  return { rho: pressurePa / (287.05 * t), c: 331.3 * Math.sqrt(t / 273.15) };
}

/** 20 °C, sea level: ρ ≈ 1.204 kg/m³, c ≈ 343.2 m/s. */
export const AIR_20C: Air = airAt(20);
