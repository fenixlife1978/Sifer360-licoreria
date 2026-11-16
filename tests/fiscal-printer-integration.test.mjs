import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
const electronMain = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

test('la configuración fiscal se guarda por caja dentro del estado SQLite', () => {
  assert.match(main, /fiscalPrinters\[box\]=p/);
  assert.match(main, /fiscalPrinterJobs:S\.fiscalPrinterJobs/);
  assert.match(main, /fiscalPrinterJobs=d\.fiscalPrinterJobs/);
});

test('la modalidad máquina fiscal falla de forma segura si no hay adaptador listo', () => {
  assert.match(main, /const fiscalMode=dualMode\?documentChoice==='FISCAL':\(printMode==='FISCAL_PRINTER'\|\|\(printMode==='LEGACY'&&S\.cfg\.fiscalTipo==='MAQUINA_FISCAL'\)\)/);
  assert.match(main, /if\(!diagnostic\.ready\)/);
  assert.match(main, /fiscalPrinterTestBridge\(fiscalProfile\)/);
  assert.match(main, /unresolvedFiscalJobs\.length/);
  assert.match(main, /saleSnapshot/);
  assert.match(main, /data-fiscal-reconcile/);
  assert.match(main, /data-fiscal-not-issued/);
  assert.match(main, /La venta quedó sin confirmar en el POS/);
});

test('la intención de emisión se persiste antes de llamar al dispositivo', () => {
  const journalAt = main.indexOf("const journal=await save();", main.indexOf('let fiscalJob=null'));
  const emitAt = main.indexOf('fiscalPrinterEmitInvoice(fiscalProfile,fiscalInvoice)', journalAt);
  assert.ok(journalAt >= 0 && emitAt > journalAt);
  assert.match(main, /idempotencyKey/);
  assert.match(main, /status:'pending'/);
});

test('no permite anular localmente una factura que ya emitió una máquina fiscal', () => {
  assert.match(main, /s\.fiscal\)\{msg\('Esta factura ya fue emitida por una máquina fiscal/);
});

test('Electron expone las acciones fiscales solo mediante IPC del proceso principal', () => {
  for (const method of ['fiscalPrinterOpenDownload','fiscalPrinterListPorts','fiscalPrinterSelectFile','fiscalPrinterStatus','fiscalPrinterTestPort','fiscalPrinterTestPnp','fiscalPrinterTestBridge','fiscalPrinterEmitInvoice']) {
    assert.ok(preload.includes(method), 'Falta método preload: ' + method);
  }
  assert.match(electronMain, /FiscalPrinterManager\.emitInvoice/);
  assert.match(electronMain, /FiscalPrinterManager\.testSerialPort/);
  assert.match(electronMain, /FiscalPrinterManager\.testPnpFiscalStatus/);
});

test('el asistente ofrece modo fiscal, ticket interno no fiscal y operación sin impresora', () => {
  assert.match(main, /function printerSetupWizardDlg\(\)/);
  assert.match(main, /value="FISCAL_PRINTER"/);
  assert.match(main, /value="INTERNAL_THERMAL"/);
  assert.match(main, /value="NO_PRINTER"/);
  assert.match(main, /fPrintMode/);
  assert.match(main, /NO VÁLIDO COMO FACTURA FISCAL/);
  assert.match(main, /TICKET DE VENTA/);
  assert.match(main, /Sin impresora configurada/);
  assert.match(main, /printSetupCompleted/);
});

test('los tickets internos no reservan número de control fiscal ni generan emisión fiscal', () => {
  assert.match(main, /const internalTicketMode=dualMode\?documentChoice==='TICKET':\(printMode==='INTERNAL_THERMAL'\|\|printMode==='NO_PRINTER'\)/);
  assert.match(main, /const ctrlNext=internalTicketMode\?null:await nextCajaSequence\('control',currentCaja\(\)\)/);
  assert.match(main, /docType:internalTicketMode\?'TICKET-INTERNO':'01-FACTURA'/);
  assert.match(main, /concept:\(internalTicketMode\?'Ticket de venta':'Factura de venta'\)/);
});

test('el modo interno muestra una advertencia inequívoca y nunca simula un número de control fiscal', () => {
  const ticketAt = main.indexOf('function ticketText(s)');
  const ticketEnd = main.indexOf('function showTicket(s)', ticketAt);
  const ticket = main.slice(ticketAt, ticketEnd);
  assert.match(ticket, /TICKET DE VENTA/);
  assert.match(ticket, /NO VÁLIDO COMO FACTURA FISCAL/);
  assert.match(ticket, /internalTicket\?\[\]:\[row\('Nº Control:/);
  assert.match(main, /const noPrinter=s\.documentMode==='NO_PRINTER'/);
  assert.match(main, /if\(noPrinter\)\{msg\('Esta instalación está configurada sin impresora/);
  assert.match(main, /document\.body\.classList\.add\('printing-ticket-80mm'\)/);
});

test('el asistente inicial se abre después del primer inicio de sesión del administrador', () => {
  const access = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');
  assert.match(access, /dispatchEvent\(new CustomEvent\('sifer:authenticated'/);
  assert.match(main, /addEventListener\('sifer:authenticated'/);
  assert.match(main, /event\.detail\.role==='admin'/);
  assert.doesNotMatch(main, /function restoreWorkspaceAfterReload\(\)[\s\S]{0,220}printerSetupWizardDlg/);
});

test('los tickets internos quedan fuera de libros fiscales y del débito mensual de IVA', () => {
  assert.match(main, /function isFiscalSale\(sale\)\{return !!sale&&sale\.docType!=='TICKET-INTERNO'&&!\['INTERNAL_THERMAL','NO_PRINTER'\]\.includes\(sale\.documentMode\);\}/);
  assert.match(main, /if\(!isFiscalSale\(s\)\|\|!filterPeriod\(s\.ts\)\)return false;/);
  assert.match(main, /isFiscalSale\(x\)&&!x\.void&&enPeriodoSeniat\(x\.ts\)/);
  assert.match(main, /isFiscalSale\(x\)&&!x\.void&&enPeriodoFiscal\(x\.ts\)/);
});

test('el modo interno deja explícita la modalidad sin emisión fiscal', () => {
  assert.match(main, /value="NO_FISCAL_INTERNAL"/);
  assert.match(main, /S\.cfg\.fiscalTipo=\(choice==='FISCAL_PRINTER'\|\|choice==='DUAL_PRINTER'\)\?'MAQUINA_FISCAL':'NO_FISCAL_INTERNAL'/);
  assert.match(main, /if\(S\.cfg\.printMode==='INTERNAL_THERMAL'\|\|S\.cfg\.printMode==='NO_PRINTER'\)S\.cfg\.fiscalTipo='NO_FISCAL_INTERNAL'/);
});

test('las descargas externas solo pueden abrir destinos oficiales permitidos', () => {
  assert.match(electronMain, /fiscal-printer:open-download/);
  assert.match(electronMain, /const downloads = \{/);
  assert.match(electronMain, /if \(!url\) throw new Error\('Descarga no reconocida/);
  assert.match(electronMain, /shell\.openExternal\(url\)/);
  assert.match(main, /data-fiscal-download="pnpSdk32"/);
  assert.match(main, /data-fiscal-download="prolific"/);
});


test('la configuración fiscal expone fuentes públicas Bematech y protocolo PNP con destinos cerrados', () => {
  assert.match(electronMain, /bematech: 'https:\/\/posvenezuela\.com\/librerias-dll\//);
  assert.match(electronMain, /bematechDownloads: 'https:\/\/posvenezuela\.com\/descargas-2\//);
  assert.match(electronMain, /pnpProtocol: 'https:\/\/desarrollospnp\.com\/archivos\/PROTOCOLO0141\.pdf'/);
  assert.match(main, /data-fiscal-download="bematech"/);
  assert.match(main, /data-fiscal-download="pnpProtocol"/);
});


test('la configuración fiscal incluye descargas Bematech separadas para MP-4000 y MP-4200', () => {
  assert.match(electronMain, /bematechMP4200: 'https:\/\/posvenezuela\.com\/descargas-mp4200\//);
  assert.match(main, /data-fiscal-download="bematechMP4200"/);
  assert.match(main, /DLL y driver Bematech MP-4200/);
});
