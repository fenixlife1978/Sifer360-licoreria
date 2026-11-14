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
  return Buffer.from(text, 'latin1');
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

function decodeFrame(input) {
  const frame = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (frame.length < 8 || frame[0] !== STX) throw new Error('Trama PNP incompleta o sin STX.');
  const etxAt = frame.indexOf(ETX, 3);
  if (etxAt < 0 || frame.length !== etxAt + 5) throw new Error('Trama PNP sin ETX/BCC completo.');
  const sequence = assertSequence(frame[1]);
  const command = frame[2];
  if (command < 0x30 || command > 0xaf) throw new Error('Comando de respuesta PNP no válido.');
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
      fields.push(payload.subarray(start, i).toString('latin1'));
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

module.exports = { STX, ETX, FS, CONTINUE, encodeCommand, decodeFrame, createStatusQuery, validateResponse };
