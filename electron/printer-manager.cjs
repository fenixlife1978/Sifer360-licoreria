'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

function clean(value, max = 180) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function normalizePrinterName(value) {
  const name = clean(value, 180);
  if (!name || /[\r\n\0]/.test(name)) throw new Error('Seleccione una impresora térmica válida.');
  return name;
}
function transliterate(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[—–]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E\r\n\t]/g, '?');
}
function buildEscPosPayload(text, options = {}) {
  const width = Math.max(24, Math.min(48, Number(options.columns) || 42));
  const body = transliterate(text).split(/\r?\n/).map(line => line.slice(0, width)).join('\n');
  const chunks = [
    Buffer.from([0x1B, 0x40]),                 // initialize
    Buffer.from([0x1B, 0x61, 0x00]),          // left align
    Buffer.from(body + '\n\n\n', 'ascii'),
    Buffer.from([0x1D, 0x56, 0x00])           // full cut
  ];
  return Buffer.concat(chunks);
}
async function listPrinters(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { supported: false, printers: [], message: 'La detección de impresoras está disponible en Windows.' };
  const exec = options.execFileAsync || execFileAsync;
  const script = "$ErrorActionPreference='Stop'; Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,Shared | ConvertTo-Json -Compress";
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], { windowsHide:true, timeout:10000, maxBuffer:1048576 });
    let rows = JSON.parse(String(stdout || '[]').trim() || '[]');
    if (!Array.isArray(rows)) rows = [rows];
    const printers = rows.map(row => ({
      name: clean(row.Name,180), driverName: clean(row.DriverName,180),
      portName: clean(row.PortName,120), status: clean(row.PrinterStatus,40),
      shared: row.Shared === true
    })).filter(row => row.name);
    return { supported:true, printers, message: printers.length ? '' : 'Windows no devolvió impresoras instaladas.' };
  } catch (error) {
    return { supported:true, printers:[], message:'No se pudieron consultar las impresoras de Windows: ' + clean(error.message,400) };
  }
}
async function printRaw(printerName, payload, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') throw new Error('La impresión ESC/POS directa requiere Windows.');
  const name = normalizePrinterName(printerName);
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('El contenido de impresión está vacío o excede 1 MB.');
  const exec = options.execFileAsync || execFileAsync;
  const name64 = Buffer.from(name,'utf8').toString('base64');
  const data64 = bytes.toString('base64');
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$printerName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0]))
$data = [Convert]::FromBase64String($args[1])
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class SiferRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBuf, int cbBuf, out int pcWritten);
}
"@
$handle = [IntPtr]::Zero
$docStarted = $false
try {
  if (-not [SiferRawPrinter]::OpenPrinter($printerName, [ref]$handle, [IntPtr]::Zero)) { throw "OpenPrinter falló: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $di = New-Object SiferRawPrinter+DOCINFO
  $di.pDocName = "SIFER360 Ticket"
  $di.pDataType = "RAW"
  $job = [SiferRawPrinter]::StartDocPrinter($handle, 1, $di)
  if ($job -le 0) { throw "StartDocPrinter falló: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $docStarted = $true
  if (-not [SiferRawPrinter]::StartPagePrinter($handle)) { throw "StartPagePrinter falló: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $written = 0
  if (-not [SiferRawPrinter]::WritePrinter($handle, $data, $data.Length, [ref]$written) -or $written -ne $data.Length) { throw "WritePrinter incompleto: $written/$($data.Length)" }
  if (-not [SiferRawPrinter]::EndPagePrinter($handle)) { throw "EndPagePrinter falló." }
  [SiferRawPrinter]::EndDocPrinter($handle) | Out-Null
  $docStarted = $false
  "OK:$written"
} finally {
  if ($docStarted -and $handle -ne [IntPtr]::Zero) { [SiferRawPrinter]::EndDocPrinter($handle) | Out-Null }
  if ($handle -ne [IntPtr]::Zero) { [SiferRawPrinter]::ClosePrinter($handle) | Out-Null }
}
`;
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script,name64,data64], { windowsHide:true, timeout:20000, maxBuffer:65536 });
    const result = String(stdout || '').trim();
    if (!/^OK:\d+$/.test(result)) throw new Error('Windows no confirmó la recepción completa del trabajo RAW.');
    return { ok:true, printer:name, bytes:bytes.length, message:'Trabajo ESC/POS enviado a la cola de Windows.' };
  } catch (error) {
    throw new Error('No se pudo enviar el ticket a "' + name + '": ' + clean(error.message,500));
  }
}
async function printTicket(printerName, text, options = {}) {
  const payload = buildEscPosPayload(text, options);
  return printRaw(printerName, payload, options);
}
module.exports = { normalizePrinterName, transliterate, buildEscPosPayload, listPrinters, printRaw, printTicket };
