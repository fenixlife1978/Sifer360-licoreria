'use strict';

const crypto = require('node:crypto');

function safeText(value, max = 160) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('Metadato fiscal de origen inválido.');
  return text;
}
function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function createFiscalNetworkQueue({ store, emitInvoice, resolveProfile, now = () => new Date().toISOString() }) {
  if (!store || typeof store.getByKey !== 'function' || typeof store.insertPending !== 'function') throw new Error('El almacenamiento durable de la cola fiscal no está configurado.');
  if (typeof emitInvoice !== 'function' || typeof resolveProfile !== 'function') throw new Error('Falta el adaptador fiscal o el resolvedor de impresora.');
  let pumping = false;
  let halted = false;
  let closed = false;

  async function recover() {
    const interrupted = store.recoverProcessing(now());
    halted = !!((interrupted && interrupted.length) || (typeof store.hasUncertain === 'function' && store.hasUncertain()));
    return { interrupted: interrupted || [], blocked: halted };
  }
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Solicitud de emisión fiscal inválida.');
    const idempotencyKey = safeText(input.idempotencyKey, 180);
    if (!/^[A-Za-z0-9._:-]{8,180}$/.test(idempotencyKey)) throw new Error('La clave idempotente fiscal no tiene un formato permitido.');
    const cashbox = safeText(input.cashbox, 64);
    const cashier = safeText(input.cashier, 120);
    const station = safeText(input.station, 120);
    const sourceDeviceId = safeText(input.sourceDeviceId, 80);
    const saleId = safeText(input.saleId, 120);
    const invoice = input.invoice;
    if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice) || invoice.idempotencyKey !== idempotencyKey) throw new Error('La factura debe ser un objeto y contener la misma clave idempotente.');
    const invoiceJson = JSON.stringify(invoice);
    if (Buffer.byteLength(invoiceJson, 'utf8') > 1024 * 1024) throw new Error('La factura supera el límite de 1 MB.');
    return { idempotencyKey, cashbox, cashier, station, sourceDeviceId, saleId, invoice, invoiceJson, invoiceHash: stableHash(invoice) };
  }
  function enqueue(input) {
    const job = validate(input);
    const existing = store.getByKey(job.idempotencyKey);
    if (existing) {
      if (existing.invoice_hash !== job.invoiceHash && existing.invoiceHash !== job.invoiceHash) throw new Error('La clave idempotente ya existe con un contenido diferente. Se bloqueó para evitar una doble emisión.');
      return { job: existing, duplicate: true };
    }
    if (halted) throw new Error('La cola fiscal está bloqueada por una emisión incierta. Debe conciliarse la última operación antes de continuar.');
    const createdAt = now();
    const inserted = store.insertPending({ ...job, createdAt, status: 'pending' });
    const saved = inserted || store.getByKey(job.idempotencyKey);
    if (!saved) throw new Error('SQLite no confirmó la creación durable del trabajo fiscal.');
    queueMicrotask(() => { pump().catch(() => {}); });
    return { job: saved, duplicate: false };
  }
  async function pump() {
    if (pumping || halted || closed) return;
    pumping = true;
    try {
      while (!halted && !closed) {
        const job = store.nextPending();
        if (!job) break;
        store.markProcessing(job.id, now());
        try {
          const profile = await resolveProfile(job.cashbox);
          if (!profile || profile.enabled !== true) {
            store.markRejected(job.id, 'La caja de origen no tiene una impresora fiscal habilitada en el equipo servidor.', now());
            continue;
          }
          const invoice = typeof job.invoice_json === 'string' ? JSON.parse(job.invoice_json) : job.invoice;
          const result = await emitInvoice(profile, invoice);
          if (!result || !result.fiscalDocumentNumber || !result.fiscalSerial) throw new Error('El adaptador no confirmó serial fiscal y número de documento.');
          store.markIssued(job.id, result, now());
        } catch (error) {
          store.markUncertain(job.id, String(error && error.message || error).slice(0, 1000), now());
          halted = true;
        }
      }
    } finally {
      pumping = false;
    }
  }
  async function reconcile(idOrKey, decision, details = {}) {
    const job=get(idOrKey);
    if(!job)throw new Error('Trabajo fiscal no encontrado.');
    if(job.status!=='uncertain')throw new Error('Solo se pueden conciliar trabajos en estado incierto.');
    const at=now();
    if(decision==='issued'){
      const fiscalDocumentNumber=safeText(details.fiscalDocumentNumber,80);
      const fiscalSerial=safeText(details.fiscalSerial,80);
      const result={fiscalDocumentNumber,fiscalSerial,authorization:String(details.authorization||'').slice(0,160),manualReconciliation:true};
      store.markReconciledIssued(job.id,result,at);
    }else if(decision==='not-issued'){
      const note=safeText(details.note||'Administrador verificó físicamente que no existe documento emitido.',300);
      store.markReconciledNotIssued(job.id,note,at);
    }else{
      throw new Error('La decisión de conciliación debe ser issued o not-issued.');
    }
    halted=typeof store.hasUncertain==='function'?store.hasUncertain():false;
    if(!halted)queueMicrotask(()=>{pump().catch(()=>{});});
    return get(job.id);
  }
  function get(idOrKey) {
    return store.getByKey(idOrKey) || store.getById(idOrKey) || null;
  }
  function list(limit = 100) {
    return store.list(Math.max(1, Math.min(500, Number(limit) || 100)));
  }
  function isBlocked() { return halted; }
  function close() { closed = true; }
  return { recover, enqueue, pump, get, list, reconcile, isBlocked, close };
}
module.exports = { createFiscalNetworkQueue, stableHash };
