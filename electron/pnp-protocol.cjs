'use strict';

// PNP fiscal wire-protocol framing (manual v5.4). Transport is intentionally
// separate so the codec can be tested without a fiscal printer attached.
const STX = 0x02;
const ETX = 0x03;
const FS = 0x1c;
const CONTINUE = 0x12;
const MIN_SEQUENCE = 0x20;
const MAX_SEQUENCE = 0x7f;

function assertSequence(value) {
  const sequence = Number(value);
  if (!Number.isInteger(sequence) || sequence < MIN_SEQUENCE || sequence > MAX_SEQUENCE) {
    throw new Error('La secuencia PNP debe estar entre 0x20 y 0x7F.');
  }
  return sequence;
}

function encodeField(value) {
  const text = String(value == null ? '' : value);
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x20 || code > 0xff || code === FS || code === STX || code === ETX) {
      throw new Error('Campo PNP contiene caracteres de control o fuera de Latin-1.');
    }
  }
  // PNP v5.4 represents an unused/empty field with DEL (0x7F), not a zero-length field.
  return text === '' ? Buffer.from([0x7f]) : Buffer.from(text, 'latin1');
}

function encodeCommand(command, fields = [], sequence = MIN_SEQUENCE) {
  const seq = assertSequence(sequence);
  const cmd = Number(command);
  if (!Number.isInteger(cmd) || cmd < 0x30 || cmd > 0xaf) throw new Error('Código de comando PNP no válido.');
  if (!Array.isArray(fields)) throw new Error('Los campos del comando PNP deben ser una lista.');
  const chunks = [Buffer.from([STX, seq, cmd])];
  for (const field of fields) chunks.push(Buffer.from([FS]), encodeField(field));
  chunks.push(Buffer.from([ETX]));
  const body = Buffer.concat(chunks);
  let checksum = 0;
  for (const byte of body) checksum = (checksum + byte) & 0xffff;
  const bcc = Buffer.from(checksum.toString(16).toUpperCase().padStart(4, '0'), 'ascii');
  return Buffer.concat([body, bcc]);
}


function assertTextField(value, maxLength, label) {
  const text = String(value == null ? '' : value);
  if (text.length > maxLength) throw new Error(label + ' excede el máximo de ' + maxLength + ' caracteres.');
  encodeField(text);
  return text;
}

function assertDecimalField(value, pattern, label) {
  const text = String(value == null ? '' : value);
  if (!pattern.test(text)) throw new Error(label + ' no cumple el formato numérico del protocolo PNP.');
  return text;
}

// Command builders mirror the published PNP v5.4 field order. They only
// construct frames; they never open a port or emit a fiscal document.
function createFiscalOpenInvoice(input = {}, sequence = MIN_SEQUENCE) {
  const customerName = assertTextField(input.customerName, 38, 'Razón social del comprador');
  const customerRif = assertTextField(input.customerRif, 12, 'RIF del comprador');
  return encodeCommand(0x40, [customerName, customerRif, '', '', '', '', '', '', ''], sequence);
}

function createFiscalText(input = {}, sequence = MIN_SEQUENCE) {
  const text = assertTextField(input.text, 40, 'Texto fiscal');
  const auditFlag = input.auditFlag == null ? '' : String(input.auditFlag);
  if (!['', 'S'].includes(auditFlag)) throw new Error('Indicador de cinta de auditoría no válido.');
  return encodeCommand(0x41, [text, auditFlag], sequence);
}

function createFiscalItem(input = {}, sequence = MIN_SEQUENCE) {
  const description = assertTextField(input.description, 20, 'Descripción del renglón');
  const quantity = assertDecimalField(input.quantity, /^\d{1,4}\.\d{3}$/, 'Cantidad');
  const amount = assertDecimalField(input.amount, /^\d{1,6}\.\d{2}$/, 'Monto del ítem');
  const taxRate = assertDecimalField(input.taxRate, /^\.\d{4}$/, 'Tasa imponible');
  const qualifier = String(input.qualifier == null ? 'M' : input.qualifier);
  if (!['M', 'm'].includes(qualifier)) throw new Error('Calificador de renglón PNP no válido.');
  return encodeCommand(0x42, [description, quantity, amount, taxRate, qualifier, '', '', ''], sequence);
}

function createFiscalSubtotal(sequence = MIN_SEQUENCE) {
  return encodeCommand(0x43, ['', ''], sequence);
}

function createFiscalSerialQuery(sequence = MIN_SEQUENCE) {
  return encodeCommand(0x80, [], sequence);
}

function parsePnpAmount(value, label) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Monto PNP no válido en ' + label + '.');
  const amount = Number(text);
  if (!Number.isFinite(amount)) throw new Error('Monto PNP no numérico en ' + label + '.');
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// The v5.4 SUB_CF response has 17 fields: printer/fiscal status, two unused
// fields, exempt/base/tax buckets, perceived tax, taxable base and invoice total.
function parseFiscalSubtotal(response) {
  if (!response || response.command !== 0x43 || !Array.isArray(response.fields) || response.fields.length < 17) {
    throw new Error('La respuesta SUBTOTAL PNP está incompleta; no se cerrará la factura.');
  }
  const f = response.fields;
  return {
    printerStatus: f[0], fiscalStatus: f[1], exempt: parsePnpAmount(f[4], 'venta exenta'),
    baseA: parsePnpAmount(f[5], 'base A'), rateA: f[6], taxA: parsePnpAmount(f[7], 'IVA A'),
    baseB: parsePnpAmount(f[8], 'base B'), rateB: f[9], taxB: parsePnpAmount(f[10], 'IVA B'),
    baseC: parsePnpAmount(f[11], 'base C'), rateC: f[12], taxC: parsePnpAmount(f[13], 'IVA C'),
    perceivedTax: parsePnpAmount(f[14], 'impuesto percibido'),
    base: parsePnpAmount(f[15], 'base total'), total: parsePnpAmount(f[16], 'total factura')
  };
}

function reconcileFiscalSubtotal(subtotal, expected = {}, tolerance = 0.02) {
  const expectedBase = parsePnpAmount(expected.base, 'base esperada');
  const expectedTotal = parsePnpAmount(expected.total, 'total esperado');
  const deltaBase = Math.round((subtotal.base - expectedBase) * 100) / 100;
  const deltaTotal = Math.round((subtotal.total - expectedTotal) * 100) / 100;
  if (Math.abs(deltaBase) > tolerance || Math.abs(deltaTotal) > tolerance) {
    throw new Error('Los totales de la impresora PNP no coinciden con el POS (base: ' + subtotal.base.toFixed(2) + ' vs. ' + expectedBase.toFixed(2) + '; total: ' + subtotal.total.toFixed(2) + ' vs. ' + expectedTotal.toFixed(2) + '). Factura no cerrada; requiere conciliación.');
  }
  return { ok: true, deltaBase, deltaTotal };
}

function createFiscalCloseInvoice(input = {}, sequence = MIN_SEQUENCE) {
  const mode = String(input.mode == null ? 'T' : input.mode);
  if (!['A', 'B', 'T', 'U'].includes(mode)) throw new Error('Calificador de cierre fiscal PNP no válido.');
  let foreignCurrencyAmount = '';
  if (mode === 'B' || mode === 'U') {
    foreignCurrencyAmount = assertDecimalField(input.foreignCurrencyAmount, /^\d{1,10}\.\d{2}$/, 'Monto pagado en divisas para IGTF');
  } else if (input.foreignCurrencyAmount != null && String(input.foreignCurrencyAmount) !== '') {
    throw new Error('El monto en divisas solo aplica a los cierres PNP B o U.');
  }
  return encodeCommand(0x45, [mode, foreignCurrencyAmount], sequence);
}

function decodeFrame(input) {
  const frame = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (frame.length < 8 || frame[0] !== STX) throw new Error('Trama PNP incompleta o sin STX.');
  const etxAt = frame.indexOf(ETX, 3);
  if (etxAt < 0 || frame.length !== etxAt + 5) throw new Error('Trama PNP sin ETX/BCC completo.');
  const sequence = assertSequence(frame[1]);
  const command = frame[2];
  if (command < 0x30) throw new Error('Comando de respuesta PNP no válido.'); // The v5.4 serial-identity response is documented as 0xBB.
  const bccText = frame.subarray(etxAt + 1).toString('ascii');
  if (!/^[0-9A-Fa-f]{4}$/.test(bccText)) throw new Error('BCC PNP no tiene cuatro dígitos hexadecimales.');
  let checksum = 0;
  for (const byte of frame.subarray(0, etxAt + 1)) checksum = (checksum + byte) & 0xffff;
  if (checksum !== parseInt(bccText, 16)) throw new Error('BCC PNP incorrecto; la respuesta no es confiable.');
  const payload = frame.subarray(3, etxAt);
  const fields = [];
  // PNP places the field separator immediately after the command byte.
  let start = payload[0] === FS ? 1 : 0;
  for (let i = start; i <= payload.length; i++) {
    if (i === payload.length || payload[i] === FS) {
      const value = payload.subarray(start, i).toString('latin1');
      fields.push(value === '\x7f' ? '' : value);
      start = i + 1;
    }
  }
  const response = { sequence, command, fields };
  response.error = fields.some(field => /ERROR/i.test(field));
  return response;
}

function createStatusQuery(sequence = MIN_SEQUENCE) {
  return encodeCommand(0x38, ['N'], sequence);
}

function validateResponse(response, expected = {}) {
  if (!response || typeof response !== 'object') throw new Error('Respuesta PNP no válida.');
  if (expected.sequence != null && response.sequence !== expected.sequence) throw new Error('La secuencia de respuesta PNP no coincide con la solicitud.');
  if (expected.command != null && response.command !== expected.command) throw new Error('El comando de respuesta PNP no coincide con la solicitud.');
  if (response.error) throw new Error('La impresora PNP rechazó el comando: ' + response.fields.join(' | '));
  return response;
}

module.exports = { STX, ETX, FS, CONTINUE, encodeCommand, decodeFrame, createStatusQuery, createFiscalOpenInvoice, createFiscalText, createFiscalItem, createFiscalSubtotal, createFiscalCloseInvoice, createFiscalSerialQuery, parseFiscalSubtotal, reconcileFiscalSubtotal, validateResponse };
