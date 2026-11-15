'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const manager = require('../electron/fiscal-printer-manager.cjs');

test('registra las familias fiscales solicitadas y sus SDK esperados', () => {
  for (const id of ['hka','bematech','epson','quorion','aclas','pnp','hasar']) {
    assert.ok(manager.PROVIDERS[id], 'Falta proveedor ' + id);
    if (id !== 'hasar') assert.ok(manager.PROVIDERS[id].sdkFiles.length > 0);
  }
  assert.deepEqual(manager.USB_SERIAL_DRIVERS.map(x => x.id), ['prolific','ftdi','silabs']);
  assert.deepEqual(manager.PROVIDERS.pnp.sdkFiles, ['pnpdll.dll','pnpdll64.dll']);
  assert.deepEqual(manager.PROVIDERS.pnp.sdkGroups, [['pnpdll.dll','pnpdll64.dll']]);
  assert.ok(manager.PROVIDERS.pnp.models.includes('PFT88A'));
  assert.ok(manager.PROVIDERS.pnp.models.includes('PF-220DA'));
});

test('normaliza configuración COM y parámetros seriales', () => {
  const p = manager.normalizeProfile({provider:'hka',model:'HKA80',port:'com7',baudRate:9600,dataBits:8,parity:'none',stopBits:1});
  assert.equal(p.port, 'COM7');
  assert.equal(p.provider, 'hka');
  assert.equal(p.baudRate, 9600);
});

test('rechaza puertos COM y protocolos seriales inválidos', () => {
  assert.throws(() => manager.normalizeProfile({provider:'hka',port:'COM0'}), /COM1/);
  assert.throws(() => manager.normalizeProfile({provider:'hka',port:'COM7',baudRate:123}), /Velocidad/);
  assert.throws(() => manager.normalizeProfile({provider:'hka',parity:'invalid'}), /Paridad/);
  assert.throws(() => manager.normalizeProfile({provider:'unknown'}), /Fabricante/);
});

test('informa qué SDK está presente sin fingir que el adaptador está listo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-fiscal-'));
  try {
    const dll = path.join(dir, 'TfhkaNet.dll');
    fs.writeFileSync(dll, 'fixture');
    const status = manager.getSdkStatus({provider:'hka',port:'COM4',sdkPaths:{'TfhkaNet.dll':dll}});
    assert.equal(status.files.find(x => x.filename === 'TfhkaNet.dll').exists, true);
    assert.equal(status.bridgeExists, false);
    assert.equal(status.ready, false);
  } finally {
    fs.rmSync(dir, {recursive:true,force:true});
  }
});

test('la emisión exige clave idempotente y puente autorizado', async () => {
  await assert.rejects(() => manager.emitInvoice(
    {provider:'hka',port:'COM4'},
    {total:10}
  ), /idempotencia/);
  await assert.rejects(() => manager.emitInvoice(
    {provider:'hka',port:'COM4'},
    {idempotencyKey:'sale-01',total:10}
  ), /puente fiscal/);
});


test('consulta estado PNP mediante comando de solo lectura y valida la respuesta completa', async () => {
  const protocol = require('../electron/pnp-protocol.cjs');
  const result = await manager.testPnpFiscalStatus(
    {provider:'pnp',model:'PF-220A',port:'COM4',baudRate:9600,dataBits:8,parity:'none',stopBits:1},
    {platform:'win32',execFileAsync:async(_command,args)=>{
      const script=Buffer.from(args[args.length-1],'base64').toString('utf16le');
      const match=script.match(/\$hex='([0-9a-f]+)'/i);
      assert.ok(match,'El puente debe enviar la trama PNP codificada.');
      const request=protocol.decodeFrame(Buffer.from(match[1],'hex'));
      const response=protocol.encodeCommand(0x38,
        ['0000','0000','34','0','56','260101','120000','7','0','7','0','3'],request.sequence);
      return {stdout:response.toString('base64')};
    }}
  );
  assert.equal(result.ok,true);
  assert.equal(result.ready,true);
  assert.equal(result.currentStatusCode,0);
  assert.equal(result.printerStatus,'0000');
  assert.equal(result.fiscalStatus,'0000');
  assert.equal(result.currentInvoice,'7');
  assert.match(result.message,/solo lectura/);
});

test('un equipo PNP que requiere Reporte Z responde pero no queda listo para facturar', async () => {
  const protocol = require('../electron/pnp-protocol.cjs');
  const result = await manager.testPnpFiscalStatus(
    {provider:'pnp',model:'PF-220A',port:'COM4'},
    {platform:'win32',execFileAsync:async(_command,args)=>{
      const script=Buffer.from(args[args.length-1],'base64').toString('utf16le');
      const match=script.match(/\$hex='([0-9a-f]+)'/i);
      const request=protocol.decodeFrame(Buffer.from(match[1],'hex'));
      const response=protocol.encodeCommand(0x38,
        ['0000','0000','34','04','56','260101','120000','7','0','7','0','3'],request.sequence);
      return {stdout:response.toString('base64')};
    }}
  );
  assert.equal(result.ok,true);
  assert.equal(result.ready,false);
  assert.equal(result.currentStatusCode,4);
  assert.match(result.statusDescription,/Reporte Z/);
  assert.match(result.message,/no está listo/);
});

test('el estado PNP marca fuera de línea, falta de papel y errores fiscales como no listo', async () => {
  const interpret = manager.interpretPnpStatus;
  assert.equal(typeof interpret,'function');
  assert.equal(interpret(['0008','0000','34','00','56','260101','120000','7','0','7','0','3']).ready,false);
  assert.equal(interpret(['4000','0000','34','00','56','260101','120000','7','0','7','0','3']).ready,false);
  assert.equal(interpret(['0000','0008','34','00','56','260101','120000','7','0','7','0','3']).ready,false);
  const nearFull=interpret(['0000','0100','34','00','56','260101','120000','7','0','7','0','3']);
  assert.equal(nearFull.ready,true);
  assert.equal(nearFull.fiscalMemoryNearFull,true);
  assert.ok(nearFull.warnings.some(x=>/próxima a llenarse/.test(x)));
});

test('la emisión PNP se bloquea antes de llamar al adaptador cuando el estado fiscal no está listo', async () => {
  const protocol = require('../electron/pnp-protocol.cjs');
  await assert.rejects(() => manager.emitInvoice(
    {provider:'pnp',model:'PF-220A',port:'COM4',bridgePath:path.join(os.tmpdir(),'bridge-no-ejecutado.exe')},
    {idempotencyKey:'sale-pnp-01',total:10},
    {platform:'win32',execFileAsync:async(_command,args)=>{
      const script=Buffer.from(args[args.length-1],'base64').toString('utf16le');
      const match=script.match(/\$hex='([0-9a-f]+)'/i);
      const request=protocol.decodeFrame(Buffer.from(match[1],'hex'));
      const response=protocol.encodeCommand(0x38,
        ['0000','0000','34','04','56','260101','120000','7','0','7','0','3'],request.sequence);
      return {stdout:response.toString('base64')};
    }}
  ),/Emisión fiscal bloqueada.*Reporte Z/);
});

test('no permite consultar PNP si se seleccionó otra familia o falta el puerto', async () => {
  await assert.rejects(()=>manager.testPnpFiscalStatus({provider:'hka',port:'COM4'},{platform:'win32'}),/solo aplica/);
  await assert.rejects(()=>manager.testPnpFiscalStatus({provider:'pnp'},{platform:'win32'}),/puerto COM/);
});

test('la detección de puertos no Windows no inventa dispositivos', async () => {
  const result = await manager.listSerialPorts({platform:'linux'});
  assert.equal(result.supported, false);
  assert.deepEqual(result.ports, []);
});


test('Contabilidad solo se habilita con una impresora conectada, lista y capaz de emitir',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sifer-fiscal-ready-'));
 try{
  const dll=path.join(dir,'pnpdll.dll'),bridge=path.join(dir,'bridge.exe');fs.writeFileSync(dll,'fixture');fs.writeFileSync(bridge,'fixture');
  const profile={provider:'pnp',model:'PF-220A',port:'COM4',enabled:true,bridgePath:bridge,sdkPaths:{'pnpdll.dll':dll}};
  const disabled=await manager.checkFiscalReadiness({...profile,enabled:false},{platform:'win32'});assert.equal(disabled.ready,false);
  const offline=await manager.checkFiscalReadiness(profile,{platform:'win32',pnpStatusProbe:async()=>({ready:false,message:'Fuera de línea'}),bridgeProbe:async()=>({deviceConnected:true,fiscalReady:true,canEmitFiscalDocuments:true})});assert.equal(offline.ready,false);
  const noIdentity=await manager.checkFiscalReadiness(profile,{platform:'win32',pnpStatusProbe:async()=>({ready:true}),pnpIdentityProbe:async()=>({machineSerial:''})});assert.equal(noIdentity.ready,false);
  const ready=await manager.checkFiscalReadiness(profile,{platform:'win32',pnpStatusProbe:async()=>({ready:true}),pnpIdentityProbe:async()=>({machineSerial:'PNP-REAL-01'})});assert.equal(ready.ready,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('el transporte PNP envía una sola trama y devuelve la respuesta sin reintentos', async () => {
  const protocol = require('../electron/pnp-protocol.cjs');
  const request = protocol.createStatusQuery(0x35);
  const response = protocol.encodeCommand(0x38,['0000','0000','34','00','56','260101','120000','7','0','7','0','3'],0x35);
  let calls = 0;
  const received = await manager.exchangePnpFrame({provider:'pnp',port:'COM4'},request,{platform:'win32',execFileAsync:async(_command,args)=>{
    calls++;
    const script=Buffer.from(args[args.length-1],'base64').toString('utf16le');
    assert.match(script,/SerialPort/);
    assert.match(script,/DiscardInBuffer/);
    assert.match(script,/AddMilliseconds\(800\)/);
    const match=script.match(/\$hex='([0-9a-f]+)'/i);
    assert.equal(match[1],request.toString('hex'));
    return {stdout:response.toString('base64')};
  }});
  assert.equal(calls,1);
  assert.deepEqual(protocol.decodeFrame(received).fields,protocol.decodeFrame(response).fields);
});

test('el transporte PNP rechaza plataformas no Windows antes de transmitir', async () => {
  await assert.rejects(()=>manager.exchangePnpFrame({provider:'pnp',port:'COM4'},Buffer.from([2,32,56,3,0,0,0,0]),{platform:'linux'}),/requiere Windows/);
});


test('la prueba del adaptador PNP usa protocolo nativo y confirma conexión y serial sin DLL puente', async()=>{
 const protocol=require('../electron/pnp-protocol.cjs');
 const profile={provider:'pnp',port:'COM4'};
 const result=await manager.testBridge(profile,{platform:'win32',execFileAsync:async(_command,args)=>{
  const script=Buffer.from(args[args.length-1],'base64').toString('utf16le');
  const match=script.match(/\\$hex='([0-9a-f]+)'/i);const request=protocol.decodeFrame(Buffer.from(match[1],'hex'));
  const fields=request.command===0x38?['0000','0000','34','00','56','260101','120000','7','0','7','0','3']:['0000','0000','PNP-NATIVE-01','J-12345678-9','','','',''];
  return {stdout:protocol.encodeCommand(request.command,fields,request.sequence).toString('base64')};
 }});
 assert.equal(result.protocol,'pnp-native-v5.4');assert.equal(result.deviceConnected,true);assert.equal(result.canEmitFiscalDocuments,true);assert.equal(result.serial,'PNP-NATIVE-01');
});
