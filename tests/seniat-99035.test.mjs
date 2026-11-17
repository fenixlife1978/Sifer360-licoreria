import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function harness(records, rif='J-12345678-9') {
  const source=await readFile(new URL('../public/main.js',import.meta.url),'utf8');
  const start=source.indexOf('function exportSeniatTxt(periodo){');
  const end=source.indexOf('\nfunction printComprobanteRetencion',start);
  assert.ok(start>=0&&end>start,'exportSeniatTxt must exist');
  const downloads=[],messages=[];
  const context={
    S:{cfg:{rif,rate:100,retIvaPct:75},retencionesIva:records},
    window:{prompt:()=> '202610'},
    msg:(message)=>messages.push(message),
    r2:value=>Math.round((Number(value)+Number.EPSILON)*100)/100,
    downloadBlob:(name,body,type)=>downloads.push({name,body,type}),
    Date,Number,String,Math
  };
  vm.runInNewContext(source.slice(start,end)+'\nglobalThis.runExport=exportSeniatTxt;',context);
  return {run:context.runExport,downloads,messages};
}

const validRecord={
  id:'20261000000001',ts:Date.UTC(2026,9,15,12),periodo:'202610',
  supplier:{rif:'V-12345678-9'},docProv:'FAC-100',ctrlProv:'00-0000100',
  base:100,iva:16,pct:75,rate:100,retainedBs:1200
};

test('SENIAT 99035 exports exactly 16 TAB-delimited columns and filters the requested period',async()=>{
  const h=await harness([validRecord,{...validRecord,id:'20260900000002',periodo:'202609',ts:Date.UTC(2026,8,15,12)}]);
  h.run('202610');
  assert.equal(h.downloads.length,1);
  const rows=h.downloads[0].body.split('\r\n');
  assert.equal(rows.length,1);
  const fields=rows[0].split('\t');
  assert.equal(fields.length,16);
  assert.deepEqual(Array.from(fields.slice(0,8)),['J-12345678-9','202610','2026-10-15','C','01','V-12345678-9','FAC-100','00-0000100']);
  assert.equal(fields[14],'16.00');
  assert.equal(h.downloads[0].name,'RetencionesIVA_J-12345678-9_202610.txt');
});

test('SENIAT 99035 refuses invalid RIF and missing affected document for credit/debit notes',async()=>{
  const badRif=await harness([validRecord],'12345678');
  badRif.run('202610');
  assert.equal(badRif.downloads.length,0);
  assert.match(badRif.messages.join(' '),/RIF del agente/);
  const badNote=await harness([{...validRecord,seniatDocType:'03'}]);
  badNote.run('202610');
  assert.equal(badNote.downloads.length,0);
  assert.match(badNote.messages.join(' '),/documento afectado/);
});

test('SENIAT 99035 rejects invalid period and never downloads an empty or malformed declaration',async()=>{
  const h=await harness([validRecord]);
  h.run('202613');
  assert.equal(h.downloads.length,0);
  assert.match(h.messages.join(' '),/Período inválido/);
  const empty=await harness([]);
  empty.run('202610');
  assert.equal(empty.downloads.length,0);
  assert.match(empty.messages.join(' '),/No hay comprobantes/);
});
