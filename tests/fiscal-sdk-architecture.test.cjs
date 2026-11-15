const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BinaryArchitecture = require('../electron/binary-architecture.cjs');
const FiscalPrinterManager = require('../electron/fiscal-printer-manager.cjs');

function makePe(machine, corFlags = null) {
  const optionalSize = machine === 0x8664 || machine === 0xAA64 ? 240 : 224;
  const buffer = Buffer.alloc(1024);
  buffer.writeUInt16LE(0x5A4D, 0);
  buffer.writeUInt32LE(0x80, 0x3C);
  buffer.write('PE\0\0', 0x80, 'ascii');
  const coff = 0x84;
  buffer.writeUInt16LE(machine, coff);
  buffer.writeUInt16LE(corFlags === null ? 0 : 1, coff + 2);
  buffer.writeUInt16LE(optionalSize, coff + 16);
  const optional = coff + 20;
  buffer.writeUInt16LE(machine === 0x8664 || machine === 0xAA64 ? 0x20B : 0x10B, optional);
  if (corFlags !== null) {
    const directory = optional + (machine === 0x8664 || machine === 0xAA64 ? 112 : 96);
    buffer.writeUInt32LE(0x2000, directory + 14 * 8);
    buffer.writeUInt32LE(72, directory + 14 * 8 + 4);
    const section = optional + optionalSize;
    buffer.writeUInt32LE(0x100, section + 8);
    buffer.writeUInt32LE(0x2000, section + 12);
    buffer.writeUInt32LE(0x100, section + 16);
    buffer.writeUInt32LE(0x300, section + 20);
    buffer.writeUInt32LE(corFlags, 0x300 + 16);
  }
  return buffer;
}

function withTempFiles(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sifer-arch-'));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  const paths = {};
  for (const [name, data] of Object.entries(files)) {
    paths[name] = path.join(dir, name);
    fs.writeFileSync(paths[name], data);
  }
  return paths;
}

test('detecta PE x86, x64 y ARM64 sin inferir por el nombre del archivo', () => {
  assert.equal(BinaryArchitecture.inspectPeBuffer(makePe(0x014C)).architecture, 'x86');
  assert.equal(BinaryArchitecture.inspectPeBuffer(makePe(0x8664)).architecture, 'x64');
  assert.equal(BinaryArchitecture.inspectPeBuffer(makePe(0xAA64)).architecture, 'arm64');
});

test('reconoce ensamblados .NET AnyCPU y los distingue de x86 requerido', () => {
  assert.equal(BinaryArchitecture.inspectPeBuffer(makePe(0x014C, 0x00000001)).architecture, 'anycpu');
  assert.equal(BinaryArchitecture.inspectPeBuffer(makePe(0x014C, 0x00000003)).architecture, 'x86');
});

test('rechaza archivos sin cabecera PE verificable', () => {
  const result = BinaryArchitecture.inspectPeBuffer(Buffer.from('no es una DLL'));
  assert.equal(result.architecture, 'unknown');
  assert.equal(result.format, 'unknown');
});

test('bloquea configuración cuando el puente x64 solo tiene SDK nativo x86', t => {
  const files = withTempFiles(t, {
    'bridge.exe': makePe(0x8664),
    'BemaFI32.dll': makePe(0x014C)
  });
  const status = FiscalPrinterManager.getSdkStatus({
    provider:'bematech', model:'MP-4000 TH FI', port:'COM4',
    bridgePath:files['bridge.exe'], sdkPaths:{'BemaFI32.dll':files['BemaFI32.dll']}
  });
  assert.equal(status.bridgeArchitecture.architecture, 'x64');
  assert.equal(status.files.find(file => file.filename === 'BemaFI32.dll').architecture.architecture, 'x86');
  assert.equal(status.architectureVerified, false);
  assert.equal(status.ready, false);
  assert.match(status.note, /arquitectura/i);
});

test('permite el grupo SDK cuando existe una alternativa de arquitectura coincidente', t => {
  const files = withTempFiles(t, {
    'bridge.exe': makePe(0x8664),
    'BemaFI32.dll': makePe(0x014C),
    'BemaFI64.dll': makePe(0x8664)
  });
  const status = FiscalPrinterManager.getSdkStatus({
    provider:'bematech', model:'MP-4000 TH FI', port:'COM4',
    bridgePath:files['bridge.exe'],
    sdkPaths:{'BemaFI32.dll':files['BemaFI32.dll'],'BemaFI64.dll':files['BemaFI64.dll']}
  });
  assert.equal(status.architectureVerified, true);
  assert.equal(status.ready, true);
  assert.deepEqual(status.groups[0].compatibleFiles, ['BemaFI64.dll']);
});

test('AnyCPU puede acompañar un puente x64', t => {
  const files = withTempFiles(t, {
    'bridge.exe': makePe(0x8664),
    'BemaFI32.dll': makePe(0x014C, 0x00000001)
  });
  const status = FiscalPrinterManager.getSdkStatus({
    provider:'bematech', model:'MP-4000 TH FI', port:'COM4',
    bridgePath:files['bridge.exe'], sdkPaths:{'BemaFI32.dll':files['BemaFI32.dll']}
  });
  assert.equal(status.architectureVerified, true);
  assert.equal(status.ready, true);
});

test('no ejecuta la prueba del puente si la arquitectura SDK es incompatible', async t => {
  const files = withTempFiles(t, {
    'bridge.exe': makePe(0x8664),
    'BemaFI32.dll': makePe(0x014C)
  });
  let bridgeCalled = false;
  const result = await FiscalPrinterManager.checkFiscalReadiness({
    provider:'bematech', model:'MP-4000 TH FI', port:'COM4', enabled:true,
    bridgePath:files['bridge.exe'], sdkPaths:{'BemaFI32.dll':files['BemaFI32.dll']}
  }, { bridgeProbe:async()=>{bridgeCalled=true;return{deviceConnected:true,fiscalReady:true,canEmitFiscalDocuments:true};} });
  assert.equal(result.ready, false);
  assert.equal(bridgeCalled, false);
  assert.match(result.message, /arquitectura/i);
});

test('detecta Windows x64 cuando Electron de 32 bits corre bajo WOW64', () => {
  assert.equal(BinaryArchitecture.detectWindowsArchitecture({
    PROCESSOR_ARCHITEW6432:'AMD64', PROCESSOR_ARCHITECTURE:'x86'
  }, 'ia32'), 'x64');
});

test('no permite ejecutar puente x64 en Windows x86 ni adivina emulación ARM64', () => {
  assert.equal(BinaryArchitecture.canRunBridge('x86','x64'), false);
  assert.equal(BinaryArchitecture.canRunBridge('arm64','x64'), false);
  assert.equal(BinaryArchitecture.canRunBridge('x64','x86'), true);
});

test('resuelve un puente .NET AnyCPU al runtime x64 de Windows', t => {
  const files = withTempFiles(t, {
    'bridge.exe': makePe(0x014C, 0x00000001),
    'BemaFI64.dll': makePe(0x8664)
  });
  const status = FiscalPrinterManager.getSdkStatus({
    provider:'bematech', model:'MP-4000 TH FI', port:'COM4',
    bridgePath:files['bridge.exe'], sdkPaths:{'BemaFI64.dll':files['BemaFI64.dll']}
  });
  assert.equal(status.bridgeArchitecture.architecture, 'anycpu');
  assert.equal(status.bridgeRuntimeArchitecture, 'x64');
  assert.equal(status.bridgeRunnable, true);
  assert.equal(status.architectureVerified, true);
  assert.equal(status.ready, true);
});

test('no permite que puente AnyCPU ejecutado como x64 cargue SDK nativo x86', t => {
  const files = withTempFiles(t, {
    'bridge.exe': makePe(0x014C, 0x00000001),
    'BemaFI32.dll': makePe(0x014C)
  });
  const status = FiscalPrinterManager.getSdkStatus({
    provider:'bematech', model:'MP-4000 TH FI', port:'COM4',
    bridgePath:files['bridge.exe'], sdkPaths:{'BemaFI32.dll':files['BemaFI32.dll']}
  });
  assert.equal(status.bridgeRuntimeArchitecture, 'x64');
  assert.equal(status.architectureVerified, false);
  assert.equal(status.ready, false);
});
