'use strict';

const fs = require('node:fs');

const MACHINE_ARCH = Object.freeze({
  0x014c: 'x86',
  0x8664: 'x64',
  0xAA64: 'arm64'
});

function inspectPeBuffer(data) {
  if (!Buffer.isBuffer(data) || data.length < 64) {
    return { format:'unknown', architecture:'unknown', reason:'Archivo demasiado pequeño para ser un ejecutable PE.' };
  }
  if (data.readUInt16LE(0) !== 0x5A4D) {
    return { format:'unknown', architecture:'unknown', reason:'El archivo no contiene una cabecera MZ/PE reconocible.' };
  }
  const peOffset = data.readUInt32LE(0x3C);
  if (peOffset < 64 || peOffset + 24 > data.length || data.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    return { format:'unknown', architecture:'unknown', reason:'La cabecera PE está dañada o incompleta.' };
  }
  const coffOffset = peOffset + 4;
  const machine = data.readUInt16LE(coffOffset);
  const sectionCount = data.readUInt16LE(coffOffset + 2);
  const optionalSize = data.readUInt16LE(coffOffset + 16);
  const optionalOffset = coffOffset + 20;
  if (!optionalSize || optionalOffset + optionalSize > data.length) {
    return { format:'unknown', architecture:'unknown', machine, reason:'La cabecera opcional PE está incompleta.' };
  }
  const magic = data.readUInt16LE(optionalOffset);
  const directoryOffset = magic === 0x10B ? optionalOffset + 96 : magic === 0x20B ? optionalOffset + 112 : 0;
  if (!directoryOffset) {
    return { format:'unknown', architecture:'unknown', machine, reason:'Formato PE32/PE32+ no reconocido.' };
  }

  let architecture = MACHINE_ARCH[machine] || 'unknown';
  let corFlags = null;
  if (directoryOffset + (15 * 8) <= optionalOffset + optionalSize && directoryOffset + (15 * 8) <= data.length) {
    const clrRva = data.readUInt32LE(directoryOffset + (14 * 8));
    if (clrRva > 0) {
      const sectionTable = optionalOffset + optionalSize;
      let clrOffset = -1;
      for (let i = 0; i < sectionCount; i++) {
        const section = sectionTable + (i * 40);
        if (section + 40 > data.length) break;
        const virtualSize = data.readUInt32LE(section + 8);
        const virtualAddress = data.readUInt32LE(section + 12);
        const rawSize = data.readUInt32LE(section + 16);
        const rawPointer = data.readUInt32LE(section + 20);
        const span = Math.max(virtualSize, rawSize);
        if (clrRva >= virtualAddress && clrRva < virtualAddress + span) {
          clrOffset = rawPointer + (clrRva - virtualAddress);
          break;
        }
      }
      if (clrOffset >= 0 && clrOffset + 20 <= data.length) {
        corFlags = data.readUInt32LE(clrOffset + 16);
        const ilOnly = (corFlags & 0x00000001) !== 0;
        const requires32Bit = (corFlags & 0x00000002) !== 0;
        const prefers32Bit = (corFlags & 0x00020000) !== 0;
        if (machine === 0x014C && ilOnly && !requires32Bit && !prefers32Bit) architecture = 'anycpu';
        else if (machine === 0x014C && (requires32Bit || prefers32Bit)) architecture = 'x86';
      }
    }
  }

  return {
    format:'pe',
    architecture,
    machine:'0x' + machine.toString(16).toUpperCase().padStart(4,'0'),
    optionalHeader:magic === 0x10B ? 'PE32' : 'PE32+',
    corFlags,
    reason:architecture === 'unknown' ? 'Arquitectura PE no reconocida; no se puede confirmar compatibilidad.' : ''
  };
}

function inspectBinaryArchitecture(filePath) {
  if (!filePath) return { format:'missing', architecture:'unknown', reason:'No se seleccionó archivo.' };
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { format:'unknown', architecture:'unknown', reason:'La ruta no corresponde a un archivo.' };
    if (stat.size < 64 || stat.size > 268435456) return { format:'unknown', architecture:'unknown', reason:'El tamaño del archivo no permite una inspección PE segura.' };
    return inspectPeBuffer(fs.readFileSync(filePath));
  } catch (error) {
    return { format:'unknown', architecture:'unknown', reason:'No se pudo inspeccionar el archivo: ' + (error.message || String(error)) };
  }
}

function normalizeRuntimeArchitecture(arch) {
  if (arch === 'ia32') return 'x86';
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'arm64';
  return 'unknown';
}


function normalizeWindowsArchitecture(value) {
  const arch = String(value || '').trim().toUpperCase();
  if (arch === 'AMD64' || arch === 'X64') return 'x64';
  if (arch === 'X86' || arch === 'I386') return 'x86';
  if (arch === 'ARM64' || arch === 'AARCH64') return 'arm64';
  return 'unknown';
}

function detectWindowsArchitecture(env = process.env, runtimeArch = process.arch) {
  return normalizeWindowsArchitecture(env.PROCESSOR_ARCHITEW6432 || env.PROCESSOR_ARCHITECTURE) || normalizeRuntimeArchitecture(runtimeArch);
}

function canRunBridge(osArchitecture, bridgeArchitecture) {
  if (osArchitecture === 'x64') return bridgeArchitecture === 'x64' || bridgeArchitecture === 'x86';
  if (osArchitecture === 'x86') return bridgeArchitecture === 'x86';
  if (osArchitecture === 'arm64') return bridgeArchitecture === 'arm64';
  return null;
}

function canLoadSdk(bridgeArchitecture, sdkArchitecture) {
  if (sdkArchitecture === 'anycpu') return true;
  if (bridgeArchitecture === 'anycpu' || bridgeArchitecture === 'unknown' || sdkArchitecture === 'unknown') return null;
  return bridgeArchitecture === sdkArchitecture;
}

module.exports = {
  inspectPeBuffer,
  inspectBinaryArchitecture,
  normalizeRuntimeArchitecture,
  normalizeWindowsArchitecture,
  detectWindowsArchitecture,
  canRunBridge,
  canLoadSdk
};
