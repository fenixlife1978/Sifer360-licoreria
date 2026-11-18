export function calculateStraightLineDepreciation({ costMinor, residualMinor = 0, usefulLifeMonths, monthsAlreadyDepreciated = 0 }) {
  const cost = Number(costMinor), residual = Number(residualMinor), life = Number(usefulLifeMonths), completed = Number(monthsAlreadyDepreciated);
  if (!Number.isSafeInteger(cost) || cost <= 0 || !Number.isSafeInteger(residual) || residual < 0 || residual >= cost) {
    throw new Error('El costo y el valor residual del activo no son válidos.');
  }
  if (!Number.isInteger(life) || life < 1 || life > 1200 || !Number.isInteger(completed) || completed < 0 || completed > life) {
    throw new Error('La vida útil o los meses depreciados no son válidos.');
  }
  if (completed >= life) return 0;
  const base = cost - residual;
  const regular = Math.floor(base / life);
  return completed === life - 1 ? base - regular * (life - 1) : regular;
}
