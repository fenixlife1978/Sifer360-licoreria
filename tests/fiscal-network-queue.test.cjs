'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFiscalNetworkQueue } = require('../electron/fiscal-network-queue.cjs');

function makeStore(seed = []) {
  const jobs = seed.map(x => ({ ...x }));
  return {
    jobs,
    getByKey(key) { return jobs.find(x => x.idempotency_key === key) || null; },
    getById(id) { return jobs.find(x => x.id === id) || null; },
    insertPending(x) {
      const row = { id: 'job-' + (jobs.length + 1), idempotency_key:x.idempotencyKey, invoice_hash:x.invoiceHash, invoice_json:x.invoiceJson, cashbox:x.cashbox, status:'pending', ...x };
      jobs.push(row); return row;
    },
    nextPending() { return jobs.find(x => x.status === 'pending') || null; },
    markProcessing(id, at) { const x=jobs.find(j=>j.id===id); x.status='processing'; x.started_at=at; },
    markIssued(id, result, at) { const x=jobs.find(j=>j.id===id); x.status='issued'; x.result_json=JSON.stringify(result); x.finished_at=at; },
    markUncertain(id, error, at) { const x=jobs.find(j=>j.id===id); x.status='uncertain'; x.error=error; x.finished_at=at; },
    markRejected(id, error, at) { const x=jobs.find(j=>j.id===id); x.status='rejected'; x.error=error; x.finished_at=at; },
    markReconciledIssued(id, result, at) { const x=jobs.find(j=>j.id===id); x.status='issued'; x.result_json=JSON.stringify(result); x.finished_at=at; },
    markReconciledNotIssued(id, note, at) { const x=jobs.find(j=>j.id===id); x.status='rejected'; x.error=note; x.finished_at=at; },
    hasUncertain() { return jobs.some(x=>x.status==='uncertain'); },
    recoverProcessing(at) { const rows=jobs.filter(x=>x.status==='processing'); for(const x of rows){x.status='uncertain';x.error='Proceso interrumpido; requiere conciliación.';x.finished_at=at;} return rows; },
    list() { return jobs; }
  };
}
const input=(key='SIFER360-C01-00000001')=>({idempotencyKey:key,cashbox:'01',cashier:'cajero1',station:'POS-01',sourceDeviceId:'device-01',saleId:'SALE-01-1',invoice:{idempotencyKey:key,lines:[{code:'A',quantity:1}]}});

test('serializa trabajos simultáneos y nunca ejecuta dos comandos fiscales a la vez', async () => {
  const store=makeStore(); let active=0,maxActive=0,emitted=0;
  const queue=createFiscalNetworkQueue({store,resolveProfile:async()=>({enabled:true}),emitInvoice:async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,15));active--;emitted++;return{fiscalDocumentNumber:String(emitted),fiscalSerial:'SERIAL-1'};}});
  queue.enqueue(input('SIFER360-00000001')); queue.enqueue(input('SIFER360-00000002')); queue.enqueue(input('SIFER360-00000003'));
  await new Promise(r=>setTimeout(r,100));
  assert.equal(maxActive,1); assert.equal(emitted,3); assert.ok(store.jobs.every(x=>x.status==='issued'));
});

test('la misma clave idempotente devuelve el mismo trabajo y no emite dos veces', async () => {
  const store=makeStore(); let calls=0;
  const queue=createFiscalNetworkQueue({store,resolveProfile:async()=>({enabled:true}),emitInvoice:async()=>{calls++;return{fiscalDocumentNumber:'10',fiscalSerial:'SERIAL'};}});
  const first=queue.enqueue(input()); const duplicate=queue.enqueue(input());
  assert.equal(first.job.id,duplicate.job.id); assert.equal(duplicate.duplicate,true);
  await new Promise(r=>setTimeout(r,30)); assert.equal(calls,1);
});

test('una respuesta incierta bloquea el resto de la cola y no reintenta automáticamente', async () => {
  const store=makeStore(); let calls=0;
  const queue=createFiscalNetworkQueue({store,resolveProfile:async()=>({enabled:true}),emitInvoice:async()=>{calls++;throw new Error('timeout después de transmitir');}});
  queue.enqueue(input('SIFER360-00000001')); queue.enqueue(input('SIFER360-00000002'));
  await new Promise(r=>setTimeout(r,40));
  assert.equal(calls,1); assert.equal(store.jobs[0].status,'uncertain'); assert.equal(store.jobs[1].status,'pending'); assert.equal(queue.isBlocked(),true);
});

test('al reiniciar convierte processing en uncertain y bloquea reenvíos', async () => {
  const store=makeStore([{id:'job-old',idempotency_key:'SIFER360-OLD00001',invoice_hash:'x',status:'processing'}]);
  const queue=createFiscalNetworkQueue({store,resolveProfile:async()=>({enabled:true}),emitInvoice:async()=>{throw new Error('no debe ejecutarse');}});
  const recovery=await queue.recover();
  assert.equal(recovery.blocked,true); assert.equal(store.jobs[0].status,'uncertain');
  assert.throws(()=>queue.enqueue(input('SIFER360-NEW00001')),/bloqueada/);
});

test('un trabajo uncertain ya persistido mantiene bloqueada la cola después de reiniciar', async () => {
  const store=makeStore([{id:'job-uncertain',idempotency_key:'SIFER360-UNCERTAIN01',invoice_hash:'x',status:'uncertain'}]);
  const queue=createFiscalNetworkQueue({store,resolveProfile:async()=>({enabled:true}),emitInvoice:async()=>{throw new Error('no debe ejecutarse');}});
  const recovery=await queue.recover();
  assert.equal(recovery.blocked,true);
  assert.throws(()=>queue.enqueue(input('SIFER360-NEW00002')),/bloqueada/);
});
test('la conciliación manual de emisión verificada desbloquea la cola sin volver a imprimirla', async () => {
  const store=makeStore(); let calls=0;
  const queue=createFiscalNetworkQueue({store,resolveProfile:async()=>({enabled:true}),emitInvoice:async()=>{calls++;throw new Error('timeout');}});
  queue.enqueue(input()); await new Promise(r=>setTimeout(r,25));
  const result=await queue.reconcile('job-1','issued',{fiscalDocumentNumber:'F-99',fiscalSerial:'SER-01'});
  assert.equal(result.status,'issued'); assert.equal(calls,1); assert.equal(queue.isBlocked(),false);
});
test('la conciliación que confirma no emitida marca rechazado y libera la cola para otra operación', async () => {
  const store=makeStore(); let calls=0;
  const queue=createFiscalNetworkQueue({store,resolveProfile:async()=>({enabled:true}),emitInvoice:async()=>{calls++;throw new Error('timeout');}});
  queue.enqueue(input()); await new Promise(r=>setTimeout(r,25));
  const result=await queue.reconcile('job-1','not-issued',{note:'Verificado en el contador fiscal'});
  assert.equal(result.status,'rejected'); assert.equal(calls,1); assert.equal(queue.isBlocked(),false);
});
test('rechaza una misma clave idempotente con factura distinta', () => {
  const store=makeStore(); const queue=createFiscalNetworkQueue({store,resolveProfile:async()=>({enabled:true}),emitInvoice:async()=>({})});
  queue.enqueue(input());
  const changed=input(); changed.invoice.lines[0].quantity=2;
  assert.throws(()=>queue.enqueue(changed),/contenido diferente/);
});

test('resuelve el perfil fiscal de la caja de origen y mantiene un solo emisor entre cajas', async () => {
  const store=makeStore(); const seen=[]; let active=0,maxActive=0;
  const profiles={'01':{enabled:true,port:'COM3'},'02':{enabled:true,port:'COM7'}};
  const queue=createFiscalNetworkQueue({
    store,
    resolveProfile:async cashbox=>profiles[cashbox],
    emitInvoice:async profile=>{active++;maxActive=Math.max(maxActive,active);seen.push(profile.port);await new Promise(r=>setTimeout(r,15));active--;return{fiscalDocumentNumber:String(seen.length),fiscalSerial:'SERIAL-'+profile.port};}
  });
  const first=input('SIFER360-BOX01-0001'); first.cashbox='01';
  const second=input('SIFER360-BOX02-0001'); second.cashbox='02';
  queue.enqueue(first); queue.enqueue(second);
  await new Promise(r=>setTimeout(r,80));
  assert.deepEqual(seen,['COM3','COM7']);
  assert.equal(maxActive,1);
  assert.ok(store.jobs.every(job=>job.status==='issued'));
});


test('dos llamadas simultáneas a pump comparten un único emisor', async () => {
  const store=makeStore(); let active=0,maxActive=0,calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const queue=createFiscalNetworkQueue({
    store,
    resolveProfile:async()=>({enabled:true}),
    emitInvoice:async()=>{calls++;active++;maxActive=Math.max(maxActive,active);await gate;active--;return{fiscalDocumentNumber:String(calls),fiscalSerial:'SERIAL'};}
  });
  queue.enqueue(input('SIFER360-PUMP-0001'));
  queue.enqueue(input('SIFER360-PUMP-0002'));
  const first=queue.pump();
  const second=queue.pump();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  assert.equal(maxActive,1);
  release();
  await Promise.all([first,second]);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);
  assert.ok(store.jobs.every(job=>job.status==='issued'));
});

test('al conciliar una emisión no realizada, continúa con el siguiente trabajo pendiente', async () => {
  const store=makeStore(); let calls=0;
  const queue=createFiscalNetworkQueue({
    store,
    resolveProfile:async()=>({enabled:true}),
    emitInvoice:async(_profile,invoice)=>{
      calls++;
      if(invoice.idempotencyKey==='SIFER360-UNCERTAIN-01')throw new Error('respuesta perdida');
      return{fiscalDocumentNumber:'F-'+calls,fiscalSerial:'SERIAL'};
    }
  });
  queue.enqueue(input('SIFER360-UNCERTAIN-01'));
  queue.enqueue(input('SIFER360-PENDING-02'));
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(store.jobs[0].status,'uncertain');
  assert.equal(store.jobs[1].status,'pending');
  await queue.reconcile('job-1','not-issued',{note:'Verificación física: no se emitió documento.'});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(store.jobs[0].status,'rejected');
  assert.equal(store.jobs[1].status,'issued');
  assert.equal(calls,2);
});

test('una caja sin perfil fiscal queda rechazada y no impide procesar la siguiente caja', async () => {
  const store=makeStore(); const emitted=[];
  const queue=createFiscalNetworkQueue({
    store,
    resolveProfile:async cashbox=>cashbox==='01'?null:{enabled:true,port:'COM7'},
    emitInvoice:async profile=>{emitted.push(profile.port);return{fiscalDocumentNumber:'F-2',fiscalSerial:'SERIAL'};}
  });
  const first=input('SIFER360-NOPROFILE-01'); first.cashbox='01';
  const second=input('SIFER360-PROFILE-02'); second.cashbox='02';
  queue.enqueue(first); queue.enqueue(second);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(store.jobs[0].status,'rejected');
  assert.equal(store.jobs[1].status,'issued');
  assert.deepEqual(emitted,['COM7']);
});
