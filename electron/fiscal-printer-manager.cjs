'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const PnpProtocol = require('./pnp-protocol.cjs');
const execFileAsync = promisify(execFile);

const PROVIDERS = Object.freeze({
  hka:{id:'hka',label:'The Factory HKA',sdkFiles:['TfhkaNet.dll','tfhkaif.dll','IntTFHKA.exe'],sdkGroups:[['TfhkaNet.dll','tfhkaif.dll']],models:['HKA80','HKA112','HKA80PP9','HKA112PP9','HKA CR2050','Bixolon SRP-812','Bixolon SRP-270','Bixolon SRP-350','Dascom Tally','Star Micronics','Citizen','Custom']},
  bematech:{id:'bematech',label:'Bematech',sdkFiles:['BemaFI32.dll','BemaFI64.dll','BemaFI32.ini'],sdkGroups:[['BemaFI32.dll','BemaFI64.dll']],models:['MP-4000 TH FI','MP-4200 TH FI','MP-4000 FI']},
  epson:{id:'epson',label:'Epson Fiscal',sdkFiles:['EpsonFiscalInterface.dll'],sdkGroups:[['EpsonFiscalInterface.dll']],models:['Epson Fiscal compatible (confirmar modelo exacto)']},
  quorion:{id:'quorion',label:'Quorion',sdkFiles:['QProg.dll'],sdkGroups:[['QProg.dll']],models:['QPrint','CR20']},
  aclas:{id:'aclas',label:'Aclas',sdkFiles:['AclasSDK.dll'],sdkGroups:[['AclasSDK.dll']],models:['Aclas fiscal compatible (confirmar modelo exacto)']},
  pnp:{id:'pnp',label:'PNP / Desarrollos PNP',sdkFiles:['pnpdll.dll','pnpdll64.dll'],sdkGroups:[['pnpdll.dll','pnpdll64.dll']],models:['PF-SUNMI','PF-220A','PF-220DA','PF-220II','PF-300A','PF-300II','PF-950A','PF-675A','PFT88A']}
  ,hasar:{id:'hasar',label:'Hasar',sdkFiles:[],sdkGroups:[],models:['Hasar fiscal compatible (confirmar modelo y SDK con distribuidor)']}
});
const USB_SERIAL_DRIVERS = Object.freeze([
  {id:'prolific',label:'Prolific PL2303',vendorId:'067B'},
  {id:'ftdi',label:'FTDI VCP',vendorId:'0403'},
  {id:'silabs',label:'Silicon Labs CP210x',vendorId:'10C4'}
]);
function cleanText(value,max=160){return String(value==null?'':value).trim().slice(0,max);}
function providerInfo(id){const p=PROVIDERS[cleanText(id,30).toLowerCase()];if(!p)throw new Error('Fabricante fiscal no reconocido.');return p;}
function normalizeProfile(input={}){
  const provider=providerInfo(input.provider);
  const port=cleanText(input.port,12).toUpperCase();
  if(port&&!/^COM[1-9]\d{0,2}$/.test(port))throw new Error('El puerto debe tener formato COM1, COM2, etc.');
  const baudRate=Number(input.baudRate||9600);
  if(!Number.isInteger(baudRate)||baudRate<300||baudRate>921600)throw new Error('Velocidad serial no válida.');
  const dataBits=Number(input.dataBits||8);if(![7,8].includes(dataBits))throw new Error('Bits de datos no válidos.');
  const stopBits=Number(input.stopBits||1);if(![1,2].includes(stopBits))throw new Error('Bits de parada no válidos.');
  const parity=cleanText(input.parity||'none',10).toLowerCase();if(!['none','even','odd','mark','space'].includes(parity))throw new Error('Paridad serial no válida.');
  const sdkPaths={};for(const filename of provider.sdkFiles){const candidate=cleanText(input.sdkPaths&&input.sdkPaths[filename],1024);if(candidate)sdkPaths[filename]=path.resolve(candidate);}
  const bridgePath=cleanText(input.bridgePath,1024);
  return {provider:provider.id,model:cleanText(input.model,120),port,baudRate,dataBits,stopBits,parity,timeoutMs:Math.min(60000,Math.max(1000,Number(input.timeoutMs)||8000)),bridgePath:bridgePath?path.resolve(bridgePath):'',sdkPaths,enabled:input.enabled===true};
}
function getSdkStatus(profile){
  const normalized=normalizeProfile(profile),provider=providerInfo(normalized.provider);
  const files=provider.sdkFiles.map(filename=>{const filePath=normalized.sdkPaths[filename]||'';let exists=false;try{exists=!!filePath&&fs.statSync(filePath).isFile();}catch{}return{filename,path:filePath,exists};});
  let bridgeExists=false;try{bridgeExists=!!normalized.bridgePath&&fs.statSync(normalized.bridgePath).isFile();}catch{}
  const groups=(provider.sdkGroups||[]).map(group=>({alternatives:group,present:group.some(filename=>files.some(file=>file.filename===filename&&file.exists))})); const sdkReady=groups.every(group=>group.present); return {provider:provider.id,providerLabel:provider.label,model:normalized.model,files,groups,bridgePath:normalized.bridgePath,bridgeExists,ready:!!normalized.port&&bridgeExists&&sdkReady,note:bridgeExists?'Puente localizado; falta comprobar que implemente sifer-fiscal-bridge/v1.':'No hay adaptador fiscal ejecutable configurado. Seleccione el puente oficial o autorizado del fabricante.'};
}
async function listSerialPorts(options={}){
  const platform=options.platform||process.platform;if(platform!=='win32')return{supported:false,ports:[],message:'La detección de puertos COM está disponible en Windows.'};
  const exec=options.execFileAsync||execFileAsync;
  const script="$ErrorActionPreference='Stop'; $ports=@(); try { $ports=Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { [PSCustomObject]@{ port=([regex]::Match($_.Name,'COM\\d+').Value); name=$_.Name; status=$_.Status; instanceId=$_.PNPDeviceID } } } catch {}; if($ports.Count -eq 0){ $ports=[System.IO.Ports.SerialPort]::GetPortNames() | ForEach-Object { [PSCustomObject]@{port=$_;name=$_;status='Unknown';instanceId=''} } }; ConvertTo-Json -InputObject @($ports) -Compress";
  try{const{stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,timeout:8000,maxBuffer:1048576});let parsed=JSON.parse(String(stdout||'[]').trim()||'[]');if(!Array.isArray(parsed))parsed=[parsed];const seen=new Set();const ports=parsed.filter(x=>x&&/^COM[1-9]\d{0,2}$/i.test(String(x.port||''))).map(x=>{const instanceId=String(x.instanceId||'');const match=instanceId.match(/VID_([0-9A-F]{4})/i);const vendorId=match?match[1].toUpperCase():'';const driver=USB_SERIAL_DRIVERS.find(d=>d.vendorId===vendorId);return{port:String(x.port).toUpperCase(),name:cleanText(x.name||x.port,240),status:cleanText(x.status||'Unknown',40),vendorId,driverId:driver?driver.id:''};}).filter(x=>!seen.has(x.port)&&seen.add(x.port));return{supported:true,ports,message:ports.length?'':'Windows no detectó puertos seriales. Compruebe el cable y el controlador USB-Serial.'};}catch(error){return{supported:true,ports:[],message:'No se pudieron enumerar los puertos COM: '+(error.message||String(error))};}
}
async function testSerialPort(profile,options={}){
  const p=normalizeProfile(profile);if(!p.port)throw new Error('Seleccione un puerto COM antes de probar la conexión.');if((options.platform||process.platform)!=='win32')throw new Error('La prueba directa de puertos COM requiere Windows.');
  const exec=options.execFileAsync||execFileAsync;
  const parityName=p.parity[0].toUpperCase()+p.parity.slice(1);
  const stopName=p.stopBits===1?'One':'Two';
  const script="$ErrorActionPreference='Stop'; " +
    "$p=[System.IO.Ports.SerialPort]::new('"+p.port+"',"+p.baudRate+",[System.IO.Ports.Parity]::"+parityName+","+p.dataBits+",[System.IO.Ports.StopBits]::"+stopName+"); " +
    "try { $p.ReadTimeout="+p.timeoutMs+"; $p.WriteTimeout="+p.timeoutMs+"; $p.Open(); if(-not $p.IsOpen){ throw 'El puerto no abrió.' }; $p.Close(); 'OK' } " +
    "finally { if($p -and $p.IsOpen){$p.Close();$p.Dispose()} }";
  try{const{stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,timeout:p.timeoutMs+3000,maxBuffer:65536});if(!String(stdout).includes('OK'))throw new Error('Windows no confirmó la apertura del puerto.');return{ok:true,port:p.port,baudRate:p.baudRate,message:'Puerto abierto y cerrado correctamente. No se enviaron comandos fiscales.'};}catch(error){throw new Error('No se pudo abrir '+p.port+': '+(error.message||String(error)));}
}
function runBridge(profile,action,payload={},options={}){
  const p=normalizeProfile(profile),bridgePath=p.bridgePath;
  if(!bridgePath||!fs.existsSync(bridgePath)||!fs.statSync(bridgePath).isFile())throw new Error('No está instalado/configurado el puente fiscal autorizado para este fabricante.');
  const timeoutMs=options.timeoutMs||p.timeoutMs;
  const request={protocol:'sifer-fiscal-bridge/v1',action,requestId:cleanText(payload.requestId||crypto.randomUUID(),120),config:p,payload};
  return new Promise((resolve,reject)=>{
    const child=spawn(bridgePath,[],{windowsHide:true,shell:false,cwd:path.dirname(bridgePath),stdio:['pipe','pipe','pipe']});let stdout='',stderr='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>{try{child.kill();}catch{}finish(new Error('Tiempo de espera agotado. El resultado fiscal puede ser incierto; no reintente hasta consultar la impresora.'));},timeoutMs);
    child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');if(stdout.length>1048576){try{child.kill();}catch{}finish(new Error('La respuesta del adaptador excede el límite permitido.'));}});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8').slice(0,8000);});
    child.on('error',error=>finish(error));
    child.on('close',code=>{if(settled)return;let response;try{response=JSON.parse(stdout.trim());}catch{return finish(new Error('El adaptador fiscal no devolvió JSON válido. '+stderr.slice(0,1000)));}if(code!==0||response.ok!==true)return finish(new Error(cleanText(response.message||stderr||('El adaptador terminó con código '+code),1200)));if(response.protocol!=='sifer-fiscal-bridge/v1')return finish(new Error('Versión de protocolo incompatible del adaptador fiscal.'));finish(null,response);});
    child.stdin.end(JSON.stringify(request)+'\n');
  });
}
async function emitInvoice(profile,invoice,options={}){
  if(!invoice||typeof invoice!=='object'||Array.isArray(invoice))throw new Error('Datos de factura inválidos.');
  const requestId=cleanText(invoice.idempotencyKey,120);if(!requestId)throw new Error('La emisión fiscal exige una clave de idempotencia persistida antes del envío.');
  const response=await runBridge(profile,'emitInvoice',{...invoice,requestId},options);
  const fiscalDocumentNumber=cleanText(response.fiscalDocumentNumber||response.documentNumber,80),fiscalSerial=cleanText(response.fiscalSerial||response.serialNumber,100);
  if(!fiscalDocumentNumber||!fiscalSerial)throw new Error('El adaptador no confirmó número de documento fiscal y serial de máquina. No se considera emitida.');
  return{ok:true,fiscalDocumentNumber,fiscalSerial,authorization:cleanText(response.authorization,200),raw:response};
}

let pnpSequence = 0x20;
async function testPnpFiscalStatus(profile, options = {}) {
  const p = normalizeProfile(profile);
  if (p.provider !== 'pnp') throw new Error('La consulta de estado PNP solo aplica al ecosistema PNP.');
  if (!p.port) throw new Error('Seleccione el puerto COM de la impresora PNP.');
  if ((options.platform || process.platform) !== 'win32') throw new Error('La consulta PNP directa requiere Windows.');
  pnpSequence = pnpSequence >= 0x7f ? 0x20 : pnpSequence + 1;
  const sequence = pnpSequence;
  const request = PnpProtocol.createStatusQuery(sequence);
  const hex = request.toString('hex');
  const parityName = p.parity[0].toUpperCase() + p.parity.slice(1);
  const stopName = p.stopBits === 1 ? 'One' : 'Two';
  const script = "$ErrorActionPreference='Stop'; " +
    "$p=[System.IO.Ports.SerialPort]::new('" + p.port + "'," + p.baudRate + ",[System.IO.Ports.Parity]::" + parityName + "," + p.dataBits + ",[System.IO.Ports.StopBits]::" + stopName + "); " +
    "try { $p.ReadTimeout=250; $p.WriteTimeout=" + p.timeoutMs + "; $p.Open(); $p.DiscardInBuffer(); " +
    "$hex='" + hex + "'; $bytes=New-Object byte[] ($hex.Length/2); for($i=0;$i -lt $bytes.Length;$i++){ $bytes[$i]=[Convert]::ToByte($hex.Substring($i*2,2),16) }; " +
    "$p.Write($bytes,0,$bytes.Length); $stream=New-Object System.IO.MemoryStream; $deadline=[DateTime]::UtcNow.AddMilliseconds(" + p.timeoutMs + "); $etxEnd=0; " +
    "while([DateTime]::UtcNow -lt $deadline){ try{$v=$p.ReadByte()}catch [System.TimeoutException]{continue}; if($v -eq 18){$deadline=$deadline.AddMilliseconds(800);continue}; " +
    "$stream.WriteByte([byte]$v); if($v -eq 3 -and $etxEnd -eq 0){$etxEnd=$stream.Length}; if($etxEnd -gt 0 -and $stream.Length -ge ($etxEnd+4)){break} }; " +
    "if($etxEnd -eq 0 -or $stream.Length -lt ($etxEnd+4)){throw 'La impresora no devolvió una trama PNP completa.'}; " +
    "[Console]::WriteLine([Convert]::ToBase64String($stream.ToArray())) } finally { if($p -and $p.IsOpen){$p.Close()}; if($p){$p.Dispose()} }";
  const exec = options.execFileAsync || execFileAsync;
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const { stdout } = await exec('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded], { windowsHide:true, timeout:p.timeoutMs+4000, maxBuffer:65536 });
    const output = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
    if (!output) throw new Error('Windows no devolvió datos de la impresora.');
    const response = PnpProtocol.decodeFrame(Buffer.from(output, 'base64'));
    PnpProtocol.validateResponse(response, { sequence, command:0x38 });
    if (response.fields.length < 12) throw new Error('La respuesta de estado PNP está incompleta.');
    if (!/^[0-9A-Fa-f]{4}$/.test(response.fields[0]) || !/^[0-9A-Fa-f]{4}$/.test(response.fields[1])) throw new Error('La impresora devolvió estados no válidos.');
    return {
      ok:true, provider:'pnp', model:p.model, port:p.port, sequence,
      printerStatus:response.fields[0], fiscalStatus:response.fields[1],
      lastSequence:response.fields[2], currentStatus:response.fields[3],
      lastCommand:response.fields[4], fiscalDate:response.fields[5],
      fiscalTime:response.fields[6], invoicesSinceZ:response.fields[7],
      currentInvoice:response.fields[9], lastZ:response.fields[11],
      message:'La impresora PNP respondió a la consulta de estado de solo lectura. No se emitió factura ni reporte.'
    };
  } catch (error) {
    throw new Error('No se pudo consultar el estado fiscal PNP: ' + (error.message || String(error)));
  }
}
\nmodule.exports={PROVIDERS,USB_SERIAL_DRIVERS,normalizeProfile,getSdkStatus,listSerialPorts,testSerialPort,testPnpFiscalStatus,runBridge,emitInvoice};
