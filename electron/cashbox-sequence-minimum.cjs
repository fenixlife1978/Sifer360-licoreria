function maxPlusOne(items, valueOf) {
  let max = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const value = Number(valueOf(item));
    if (Number.isSafeInteger(value) && value > max) max = value;
  }
  if (max >= Number.MAX_SAFE_INTEGER) throw new Error('Se agotó el rango seguro de numeración para esta caja y operación.');
  return max + 1;
}

function suffixNumber(value) {
  const suffix = String(value || '').split('-').pop();
  const number = Number(suffix);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function getCashboxSequenceMinimum(state = {}, cashboxId, operationType) {
  const cashbox = String(cashboxId || '');
  const operation = String(operationType || '');
  const rows = (key, fallback = false) => (Array.isArray(state[key]) ? state[key] : []).filter(item =>
    String(item && item.cashbox || (fallback ? '01' : '')) === cashbox
  );
  if (operation === 'invoice') return maxPlusOne(rows('sales', true), item => item.no);
  if (operation === 'control') return maxPlusOne(rows('sales', true), item => suffixNumber(item.ctrlNo));
  if (operation === 'z') return maxPlusOne(rows('cortesZ'), item => suffixNumber(item.id));
  if (operation === 'void') return maxPlusOne(rows('sales', true), item => item.voidNo);
  if (operation === 'purchase') return maxPlusOne(rows('purchases'), item => item.no);
  if (operation === 'count') return maxPlusOne(rows('counts'), item => Number(item.sequence) || suffixNumber(item.id));
  if (operation === 'cxc') return maxPlusOne(rows('cxc'), item => Number(item.sequence) || suffixNumber(item.id));
  if (operation === 'cxp') return maxPlusOne(rows('cxp'), item => Number(item.sequence) || suffixNumber(item.id));
  if (operation === 'cashea') return maxPlusOne(rows('casheaMovimientos'), item => Number(item.sequence) || suffixNumber(item.id));
  if (operation === 'cxc-payment' || operation === 'cxp-payment') {
    const collection = operation === 'cxc-payment' ? 'cxc' : 'cxp';
    const payments = (Array.isArray(state[collection]) ? state[collection] : []).flatMap(document =>
      (Array.isArray(document && document.payments) ? document.payments : []).filter(payment =>
        String(payment.cashbox || document.cashbox || '01') === cashbox
      )
    );
    return maxPlusOne(payments, payment => payment.cashboxSequence);
  }
  if (operation === 'currency-exchange') return maxPlusOne(rows('cambiosDivisas'), item => item.sequence);
  if (operation === 'movement') return maxPlusOne(rows('movimientosCaja'), item => item.sequence);
  if (operation === 'refund' || operation === 'return') return maxPlusOne(rows('returns'), item => Number(item.returnNo) || Number(item.sequence));
  const retention = /^retention-(\d{6})$/.exec(operation);
  if (retention) {
    const period = retention[1];
    return maxPlusOne(rows('retencionesIva').filter(item => String(item.periodo || '') === period), item => Number(item.sequence) || Number(String(item.id || '').slice(-8)));
  }
  return 1;
}

module.exports = { getCashboxSequenceMinimum };
