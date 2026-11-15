'use strict';

const Protocol = require('./pnp-protocol.cjs');

class PnpFiscalTransportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PnpFiscalTransportError';
    this.command = details.command == null ? null : details.command;
    this.sequence = details.sequence == null ? null : details.sequence;
    this.outcomeUnknown = details.outcomeUnknown === true;
    this.documentMayBeOpen = details.documentMayBeOpen === true;
    this.retryAllowed = false;
  }
}

function money(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(label + ' debe ser un monto no negativo.');
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function nextSequence(previous) {
  const n = Number(previous);
  if (!Number.isInteger(n) || n < 0x20 || n > 0x7f) return 0x20;
  return n >= 0x7f ? 0x20 : n + 1;
}

function buildFiscalInvoiceCommands(invoice, initialSequence = 0x20) {
  if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) throw new Error('Datos de factura PNP inválidos.');
  if (!String(invoice.idempotencyKey || '').trim()) throw new Error('La emisión PNP requiere una clave de idempotencia persistida antes del envío.');
  if (!Array.isArray(invoice.items) || invoice.items.length === 0) throw new Error('La factura PNP debe contener al menos un renglón.');
  const customerName = String(invoice.customerName || 'Consumidor final').slice(0, 38);
  const customerRif = String(invoice.customerRif || '').slice(0, 12);
  if (!customerName.trim()) throw new Error('La razón social del comprador es obligatoria.');
  let sequence = initialSequence;
  const next = () => { sequence = nextSequence(sequence); return sequence; };
  const commands = [];
  commands.push({ kind:'open', frame:Protocol.createFiscalOpenInvoice({customerName,customerRif}, next()) });
  let base = 0, total = 0;
  for (const [index, item] of invoice.items.entries()) {
    const quantity = Number(item.quantity);
    const unitPrice = money(item.unitPrice, 'Precio unitario del renglón ' + (index + 1));
    const rate = String(item.taxRate == null ? '.0000' : item.taxRate);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Cantidad inválida en el renglón ' + (index + 1) + '.');
    const lineBase = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
    if (!/^\.\d{4}$/.test(rate)) throw new Error('La tasa PNP debe expresarse como .nnnn en el renglón ' + (index + 1) + '.');
    const fraction = Number(rate);
    base += lineBase;
    total += lineBase * (1 + fraction);
    commands.push({kind:'item',frame:Protocol.createFiscalItem({
      description:String(item.description || '').slice(0,20),
      quantity:Number(quantity).toFixed(3),
      amount:unitPrice.toFixed(2),
      taxRate:rate,
      qualifier:'M'
    },next())});
  }
  base = money(base,'Base esperada');
  total = money(total,'Total esperado');
  commands.push({kind:'subtotal',frame:Protocol.createFiscalSubtotal(next()),expected:{base,total}});
  const closeMode = String(invoice.closeMode || 'T');
  const closeInput = {mode:closeMode};
  if (closeMode === 'B' || closeMode === 'U') closeInput.foreignCurrencyAmount = money(invoice.foreignCurrencyAmount,'Pago en divisas').toFixed(2);
  commands.push({kind:'close',frame:Protocol.createFiscalCloseInvoice(closeInput,next())});
  return commands;
}

async function emitFiscalInvoice(invoice, transport, options = {}) {
  if (!transport || typeof transport.exchange !== 'function') throw new Error('No hay transporte serial PNP disponible.');
  const commands = buildFiscalInvoiceCommands(invoice, options.initialSequence || 0x20);
  const responses = [];
  let opened = false;
  for (const command of commands) {
    const request = Protocol.decodeFrame(command.frame);
    let raw;
    try {
      // Exactly one write per command. Never retry a fiscal command automatically.
      raw = await transport.exchange(command.frame, {
        command:request.command, sequence:request.sequence,
        timeoutMs:options.timeoutMs || 8000
      });
    } catch (error) {
      throw new PnpFiscalTransportError(
        'Falló la comunicación PNP durante el comando 0x' + request.command.toString(16).toUpperCase() +
        '. El equipo pudo haber procesado el comando; no se reintentará automáticamente. Consulte el estado y la memoria de auditoría antes de continuar.',
        {command:request.command,sequence:request.sequence,outcomeUnknown:true,documentMayBeOpen:opened}
      );
    }
    let response;
    try {
      response = Protocol.decodeFrame(raw);
      Protocol.validateResponse(response,{sequence:request.sequence,command:request.command});
    } catch (error) {
      throw new PnpFiscalTransportError(
        'Respuesta PNP inválida o rechazada para el comando 0x' + request.command.toString(16).toUpperCase() +
        ': ' + error.message + ' No se enviarán más comandos.',
        {command:request.command,sequence:request.sequence,outcomeUnknown:false,documentMayBeOpen:opened}
      );
    }
    responses.push(response);
    if (command.kind === 'open') opened = true;
    if (command.kind === 'subtotal') {
      const subtotal = Protocol.parseFiscalSubtotal(response);
      Protocol.reconcileFiscalSubtotal(subtotal,command.expected,options.tolerance == null ? 0.02 : options.tolerance);
    }
    if (command.kind === 'close') {
      const number = String(response.fields[3] || '').trim();
      if (!number) throw new PnpFiscalTransportError(
        'La impresora respondió al cierre pero no devolvió el número de factura. No reintente; concilie el documento en la memoria de auditoría.',
        {command:request.command,sequence:request.sequence,outcomeUnknown:true,documentMayBeOpen:false}
      );
      return {ok:true,fiscalDocumentNumber:number,fiscalSerial:String(invoice.fiscalSerial || '').trim(),responses};
    }
  }
  throw new PnpFiscalTransportError('La secuencia PNP terminó sin confirmación de cierre fiscal.',{outcomeUnknown:true,documentMayBeOpen:opened});
}

module.exports = { PnpFiscalTransportError, buildFiscalInvoiceCommands, emitFiscalInvoice, nextSequence };
