const crypto = require('node:crypto');

function mergeStateRecords(base, incoming) {
  if (!base || typeof base !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return base;
  const out = { ...base, ...incoming };
  const arrays = new Set([
    'sales','purchases','cxc','cxp','cortesZ','kardex','counts','held','lotesSudeban','movimientosCaja','rateAudit','fiscalBankOperations',
    'movements','returns','voids','openings','retentions','retencionesIva',
    'divisas','cashea','casheaMovimientos','casheaLiquidaciones','cambiosDivisas',
    'customers','clients','suppliers','products'
  ]);
  const boxScoped = new Set([
    'sales','purchases','cxc','cxp','cortesZ','counts','openings','movements','held','movimientosCaja','rateAudit',
    'returns','voids','retencionesIva','retentions','casheaMovimientos',
    'casheaLiquidaciones','cambiosDivisas'
  ]);
  const timestampValue = value => {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value !== null && value !== '') return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  for (const key of arrays) {
    if (!Array.isArray(base[key]) && !Array.isArray(incoming[key])) continue;
    const map = new Map();
    for (const item of [...(base[key] || []), ...(incoming[key] || [])]) {
      const eventIdCollections = new Set(['kardex','lotesSudeban','rateAudit','casheaLiquidaciones']);
      const id = item && (eventIdCollections.has(key) ? (item.eventId ?? item.id ?? item.uuid ?? item.no ?? item.number ?? item.code ?? item.sku) : (item.id ?? item.uuid ?? item.eventId ?? item.no ?? item.number ?? item.code ?? item.sku));
      if (id === undefined || id === null) {
        map.set(crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex'), item);
        continue;
      }
      const box = boxScoped.has(key) ? String(item.cashbox || 'sin-caja') + ':' : '';
      const identity = box + String(id);
      const old = map.get(identity);
      if (!old || timestampValue(item.updatedAt || item.ts || item.createdAt) >= timestampValue(old.updatedAt || old.ts || old.createdAt)) {
        map.set(identity, item);
      }
    }
    out[key] = [...map.values()];
  }
  return out;
}

module.exports = { mergeStateRecords };
