'use strict';

function isSafeAutomationPath(path) {
  return typeof path === 'string' &&
    /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*){0,5}$/.test(path) &&
    !path.split('.').some(part => ['__proto__','prototype','constructor'].includes(part));
}

function extractAutomationValue(record, path) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  if (!isSafeAutomationPath(path)) throw new Error('La ruta del dato contable no es válida.');
  const parts = path.split('.');
  let value = record;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = value[part];
  }
  if (value && typeof value === 'object') throw new Error('La ruta configurada debe apuntar a un importe o código simple, no a un objeto.');
  return value;
}


function normalizeAutomationLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 20) {
    throw new Error('La regla avanzada requiere entre 2 y 20 renglones contables.');
  }
  let debitCount = 0, creditCount = 0, residualCount = 0;
  const normalized = lines.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) throw new Error('Renglón contable '+(index+1)+' inválido.');
    const side = String(line.side || '').trim().toLowerCase();
    const accountCode = String(line.accountCode || '').trim();
    const amountMode = String(line.amountMode || 'decimal').trim().toLowerCase();
    const amountPath = String(line.amountPath || '').trim();
    const thirdPartyPath = String(line.thirdPartyPath || '').trim();
    const costCenterPath = String(line.costCenterPath || '').trim();
    if (!['debit','credit'].includes(side)) throw new Error('Renglón '+(index+1)+': side debe ser debit o credit.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(accountCode)) throw new Error('Renglón '+(index+1)+': código de cuenta inválido.');
    if (!['decimal','minor','residual'].includes(amountMode)) throw new Error('Renglón '+(index+1)+': amountMode no reconocido.');
    if (amountMode === 'residual') {
      residualCount++;
      if (amountPath) throw new Error('El renglón residual no debe indicar amountPath.');
      if (index !== lines.length - 1) throw new Error('El renglón residual debe ser el último para calcular la diferencia exacta.');
    } else if (!isSafeAutomationPath(amountPath)) {
      throw new Error('Renglón '+(index+1)+': indica una ruta de importe válida.');
    }
    if (thirdPartyPath && !isSafeAutomationPath(thirdPartyPath)) throw new Error('Renglón '+(index+1)+': ruta de tercero inválida.');
    if (costCenterPath && !isSafeAutomationPath(costCenterPath)) throw new Error('Renglón '+(index+1)+': ruta de centro de costo inválida.');
    if (side === 'debit') debitCount++; else creditCount++;
    return {
      side, accountCode, amountMode, amountPath,
      thirdPartyPath, costCenterPath,
      description:String(line.description || '').trim().slice(0,180)
    };
  });
  if (!debitCount || !creditCount) throw new Error('La regla debe contener al menos un renglón Debe y uno Haber.');
  if (residualCount > 1) throw new Error('La regla solo puede contener un renglón residual.');
  return normalized;
}

function buildAutomationJournalLines({ lines, record, monetaryDecimals, decimalToMinorUnits, fallbackDescription = '' }) {
  if (typeof decimalToMinorUnits !== 'function') throw new Error('Falta el conversor monetario para la regla contable.');
  const config = normalizeAutomationLines(lines);
  let debitTotal = 0, creditTotal = 0;
  const output = [];
  for (const [index, line] of config.entries()) {
    let amountMinor;
    if (line.amountMode === 'residual') {
      amountMinor = line.side === 'debit' ? creditTotal - debitTotal : debitTotal - creditTotal;
    } else {
      const raw = extractAutomationValue(record, line.amountPath);
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        throw new Error('La ruta de importe del renglón '+(index+1)+' no existe en el documento de origen.');
      }
      amountMinor = line.amountMode === 'minor' ? Number(raw) : decimalToMinorUnits(String(raw), monetaryDecimals);
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('El importe del renglón '+(index+1)+' debe ser un entero positivo en unidades menores.');
    if (line.side === 'debit') debitTotal += amountMinor; else creditTotal += amountMinor;
    if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) throw new Error('La regla contable excede el rango monetario seguro.');
    const thirdParty = line.thirdPartyPath ? extractAutomationValue(record, line.thirdPartyPath) : null;
    const costCenter = line.costCenterPath ? extractAutomationValue(record, line.costCenterPath) : null;
    output.push({
      accountCode:line.accountCode,
      debitMinor:line.side === 'debit' ? amountMinor : 0,
      creditMinor:line.side === 'credit' ? amountMinor : 0,
      description:line.description || fallbackDescription,
      thirdPartyId:thirdParty == null || thirdParty === '' ? null : String(thirdParty).slice(0,120),
      costCenter:costCenter == null || costCenter === '' ? null : String(costCenter).slice(0,80)
    });
  }
  if (debitTotal !== creditTotal) throw new Error('La regla avanzada no cuadra: Debe '+debitTotal+', Haber '+creditTotal+'. Ajusta las rutas o agrega un renglón residual explícito.');
  return output;
}

module.exports = { extractAutomationValue, isSafeAutomationPath, normalizeAutomationLines, buildAutomationJournalLines };
