'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const PROVIDERS = Object.freeze({
  hka:{id:'hka',label:'The Factory HKA',sdkFiles:['TfhkaNet.dll','tfhkaif.dll','IntTFHKA.exe'],models:['HKA80','HKA112','HKA80PP9','HKA112PP9','HKA CR2050','Bixolon SRP-812','Bixolon SRP-270','Bixolon SRP-350','Dascom Tally','Star Micronics','Citizen','Custom']},
  bematech:{id:'bematech',label:'Bematech',sdkFiles:['BemaFI32.dll','BemaFI64.dll','BemaFI32.ini'],models:['MP-4000 TH FI','MP-4200 TH FI','MP-4000 FI']},
  epson:{id:'epson',label:'Epson Fiscal',sdkFiles:['EpsonFiscalInterface.dll'],models:['Epson Fiscal compatible (confirmar modelo exacto)']},
  quorion:{id:'quorion',label:'Quorion',sdkFiles:['QProg.dll'],models:['QPrint','CR20']},
  aclas:{id:'aclas',label:'Aclas',sdkFiles:['AclasSDK.dll'],models:['Aclas fiscal compatible (confirmar modelo exacto)']},
  pnp:{id:'pnp',label:'PNP / Desarrollos PNP',sdkFiles:['PnpFiscal.dll'],models:['PF-SUNMI','Otros modelos compatibles confirmados por fabricante']}
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
  return {provider:provider.id,providerLabel:provider.label,model:normalized.model,files,bridgePath:normalized.bridgePath,bridgeExists,ready:!!normalized.port&&bridgeExists&&files.some(x=>x.exists),note:bridgeExists?'Puente localizado; falta comprobar el protocolo sifer-fiscal-bridge/v1.':'No hay adaptador fiscal ejecutable configurado. Seleccione el puente oficial o autorizado del fabricante.'};
}
async function listSerialPorts(options={}){
  const platform=options.platform||process.platform;if(platform!=='win32')return{supported:false,ports:[],message:'La detección de puertos COM está disponible en Windows.'};
  const exec=options.execFileAsync||execFileAsync;
  const script="$ErrorActionPreference='Stop'; $ports=@(); try { $ports=Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { [PSCustomObject]@{ port=([regex]::Match($_.Name,'COM\\d+').Value); name=$_.Name; status=$_.Status } } } catch {}; if($ports.Count -eq 0){ $ports=[System.IO.Ports.SerialPort]::GetPortNames() | ForEach-Object { [PSCustomObject]@{port=$_;name=$_;status='Unknown'} } }; ConvertTo-Json -InputObject @($ports) -Compress";
  try{const{stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,timeout:8000,maxBuffer:1048576});let parsed=JSON.parse(String(stdout||'[]').trim()||'[]');if(!Array.isArray(parsed))parsed=[parsed];const seen=new Set();const ports=parsed.filter(x=>x&&/^COM[1-9]\d{0,2}$/i.test(String(x.port||''))).map(x=>({port:String(x.port).toUpperCase(),name:cleanText(x.name||x.port,240),status:cleanText(x.status||'Unknown',40)})).filter(x=>!seen.has(x.port)&&seen.add(x.port));return{supported:true,ports,message:ports.length?'':'Windows no detectó puertos seriales. Compruebe el cable y el controlador USB-Serial.'};}catch(error){return{supported:true,ports:[],message:'No se pudieron enumerar los puertos COM: '+(error.message||String(error))};}
}
async function testSerialPort(profile,options={}){
  const p=normalizeProfile(profile);if(!p.port)throw new Error('Seleccione un puerto COM antes de probar la conexión.');if((options.platform||process.platform)!=='win32')throw new Error('La prueba directa de puertos COM requiere Windows.');
  const exec=options.execFileAsync||execFileAsync;
  const script="$ErrorActionPreference='Stop'; $p=[System.IO.Ports.SerialPort]::new('"+p.port+"',"+p.baudRate+',[System.IO.Ports.Parity]::'+p.parity[0].toUpperCase()+p.parity.slice(1)+','+p.dataBits+',[System.IO.Ports.StopBits]::'+(p.stopBits===1?'One':'Two')+'); try { $p.ReadTimeout='+p.timeoutMs+'; $p.WriteTimeout='+p.timeoutMs+'; $p.Open(); if(-not $p.IsOpen){ throw ''El puerto no abrió.'' }; $p.Close(); ''OK'' } finally { if($p -and $p.IsOpen){$p.Close();$p.Dispose()} }';
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
module.exports={PROVIDERS,USB_SERIAL_DRIVERS,normalizeProfile,getSdkStatus,listSerialPorts,testSerialPort,runBridge,emitInvoice};
