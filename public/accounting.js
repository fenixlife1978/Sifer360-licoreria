(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
const today=()=>new Date().toISOString().slice(0,10);
const emptyState=()=>({version:1,accounts:[],entries:[],fixedAssets:[],nextEntry:1,nextAsset:1,initialized:false});
let activeTab='accounts',filterText='',filterType='TODOS',selectedAccount='',dialog=null;
function bridge(){return window.SIFERAccountingBridge;}
function state(){const b=bridge();if(!b)throw new Error('El puente de persistencia de SIFER todavía no está disponible.');const s=b.getState();if(!s)throw new Error('No se pudo leer el estado operativo.');if(!s.accounting||typeof s.accounting!=='object')s.accounting=emptyState();return s.accounting;}
function save(){return bridge().save();}
async function ensureChart(){
 const a=state();if(Array.isArray(a.accounts)&&a.accounts.length)return a;
 const res=await fetch('/data/plan-cuentas-predeterminado-ven-nif.json',{cache:'no-cache'});
 if(!res.ok)throw new Error('No se pudo cargar el catálogo VEN-NIF ('+res.status+').');
 const data=await res.json();
 if(!Array.isArray(data.accounts)||data.accounts.length!==97)throw new Error('El catálogo VEN-NIF no superó la validación de integridad.');
 const codes=new Set(data.accounts.map(x=>String(x.code)));
 if(codes.size!==data.accounts.length||data.accounts.some(x=>x.parentCode&&!codes.has(String(x.parentCode))))throw new Error('El catálogo contiene códigos duplicados o padres inexistentes.');
 a.accounts=data.accounts.map(x=>({...x}));
 a.catalogSource=data.source||null;a.initialized=true;a.version=1;
 const persisted=await save();if(!persisted||!persisted.ok)throw new Error('No se pudo guardar el plan de cuentas en SQLite.');return a;
}
function accountMap(){return new Map(state().accounts.map(a=>[String(a.code),a]));}
function nextEntrySequence(a=state()){const max=(a.entries||[]).reduce((n,e)=>Math.max(n,Number(e.sequence)||Number(String(e.id||'').match(/(\d+)$/)?.[1])||0),0);return Math.max(1,Number(a.nextEntry)||1,max+1);}
function fmtAccount(a){return esc(a.code)+' · '+esc(a.name);}
function movementAccounts(){return state().accounts.filter(a=>a.isMovement);}
function totalsFor(entries,accountCode){
 let dUsd=0,cUsd=0,dBs=0,cBs=0;
 for(const e of entries)for(const l of e.lines||[])if(String(l.accountCode)===String(accountCode)){
  dUsd+=Number(l.debitUsd)||0;cUsd+=Number(l.creditUsd)||0;dBs+=Number(l.debitBs)||0;cBs+=Number(l.creditBs)||0;
 }
 return {dUsd,cUsd,dBs,cBs,balUsd:dUsd-cUsd,balBs:dBs-cBs};
}
function validEntries(){return state().entries.filter(e=>e.status==='posted');}
function accountRows(){
 const a=state(),q=filterText.toLowerCase(),accounts=a.accounts.filter(x=>(filterType==='TODOS'||x.type===filterType)&&(!q||(String(x.code)+' '+x.name).toLowerCase().includes(q)));
 return accounts.map(x=>{const t=totalsFor(validEntries(),x.code);return '<tr><td class="ac-code">'+esc(x.code)+'</td><td style="padding-left:'+Math.max(0,(x.level-1)*13)+'px">'+esc(x.name)+(x.isMovement?'':' <span class="ac-muted">· Agrupadora</span>')+'</td><td>'+esc(x.type)+'</td><td class="ac-num">'+money(t.balUsd)+'</td><td class="ac-num">'+money(t.balBs)+'</td></tr>';}).join('');
}
function tabButtons(){return [['accounts','Plan de cuentas'],['journal','Libro diario'],['ledger','Libro mayor'],['trial','Balance de comprobación'],['statements','Estados financieros'],['assets','Activos fijos'],['integration','Integración POS']].map(([id,label])=>'<button class="ac-tab '+(activeTab===id?'active':'')+'" data-tab="'+id+'">'+label+'</button>').join('');}
function accountSelect(value=''){
 return '<select class="ac-input" data-field="account"><option value="">Seleccione cuenta imputable…</option>'+movementAccounts().map(a=>'<option value="'+esc(a.code)+'" '+(String(value)===String(a.code)?'selected':'')+'>'+esc(a.code+' · '+a.name)+'</option>').join('')+'</select>';
}
function renderAccounts(){
 const types=['TODOS',...new Set(state().accounts.map(a=>a.type))];
 return '<div class="ac-tools"><input class="ac-input" id="acSearch" placeholder="Buscar por código o nombre" value="'+esc(filterText)+'"><select class="ac-input" id="acType">'+types.map(t=>'<option '+(filterType===t?'selected':'')+'>'+esc(t)+'</option>').join('')+'</select><span class="ac-muted">'+state().accounts.length+' cuentas · '+movementAccounts().length+' imputables</span></div><div class="ac-scroll"><table class="ac-table"><thead><tr><th>Código</th><th>Denominación</th><th>Tipo</th><th class="ac-num">Saldo US$</th><th class="ac-num">Saldo Bs.</th></tr></thead><tbody>'+accountRows()+'</tbody></table></div>';
}
function renderJournal(){
 const es=validEntries().slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.sequence-a.sequence);
 return '<div class="ac-tools"><button class="ac-primary" id="acNewEntry">＋ Nuevo asiento</button><span class="ac-muted">'+es.length+' asientos contabilizados · Los originales no se eliminan</span></div><div class="ac-scroll"><table class="ac-table"><thead><tr><th>Fecha</th><th>Número</th><th>Referencia</th><th>Descripción</th><th class="ac-num">Debe US$</th><th class="ac-num">Haber US$</th><th>Acción</th></tr></thead><tbody>'+ (es.map(e=>'<tr><td>'+esc(e.date)+'</td><td class="ac-code">'+esc(e.number)+'</td><td>'+esc(e.reference||'—')+'</td><td>'+esc(e.description) +(e.reversalOf?'<div class="ac-muted">Reversión de '+esc(e.reversalOf)+'</div>':'')+'</td><td class="ac-num">'+money(e.totalDebitUsd)+'</td><td class="ac-num">'+money(e.totalCreditUsd)+'</td><td><button class="ac-small" data-view-entry="'+esc(e.id)+'">Ver</button> '+(!e.reversalOf&&!es.some(x=>x.reversalOf===e.id)?'<button class="ac-small" data-reverse="'+esc(e.id)+'">Revertir</button>':'')+'</td></tr>').join('')||'<tr><td colspan="7" class="ac-empty">No hay asientos contabilizados. Registre el primero cuando disponga del soporte.</td></tr>')+'</tbody></table></div>';
}
function renderLedger(){
 const accounts=movementAccounts(),chosen=accounts.find(a=>a.code===selectedAccount)||accounts[0];if(chosen)selectedAccount=chosen.code;
 if(!chosen)return '<p class="ac-empty">No hay cuentas imputables en el catálogo.</p>';
 const rows=validEntries().flatMap(e=>(e.lines||[]).filter(l=>String(l.accountCode)===String(chosen.code)).map(l=>({e,l}))).sort((a,b)=>String(a.e.date).localeCompare(String(b.e.date))||a.e.sequence-b.e.sequence);
 let runUsd=0,runBs=0;
 const html=rows.map(({e,l})=>{runUsd+=Number(l.debitUsd||0)-Number(l.creditUsd||0);runBs+=Number(l.debitBs||0)-Number(l.creditBs||0);return '<tr><td>'+esc(e.date)+'</td><td>'+esc(e.number)+'</td><td>'+esc(e.description)+'</td><td class="ac-num">'+money(l.debitUsd)+'</td><td class="ac-num">'+money(l.creditUsd)+'</td><td class="ac-num">'+money(runUsd)+'</td><td class="ac-num">'+money(runBs)+'</td></tr>';}).join('');
 return '<div class="ac-tools"><label>Cuenta</label><select class="ac-input" id="acLedgerAccount">'+accounts.map(a=>'<option value="'+esc(a.code)+'" '+(a.code===selectedAccount?'selected':'')+'>'+esc(a.code+' · '+a.name)+'</option>').join('')+'</select></div><div class="ac-scroll"><table class="ac-table"><thead><tr><th>Fecha</th><th>Asiento</th><th>Concepto</th><th class="ac-num">Debe US$</th><th class="ac-num">Haber US$</th><th class="ac-num">Saldo US$</th><th class="ac-num">Saldo Bs.</th></tr></thead><tbody>'+(html||'<tr><td colspan="7" class="ac-empty">Esta cuenta aún no tiene movimientos contabilizados.</td></tr>')+'</tbody></table></div>';
}
function renderTrial(){
 const rows=movementAccounts().map(a=>({a,t:totalsFor(validEntries(),a.code)})).filter(x=>Math.abs(x.t.dUsd)+Math.abs(x.t.cUsd)+Math.abs(x.t.dBs)+Math.abs(x.t.cBs)>0.000001);
 const totals=rows.reduce((o,x)=>{o.du+=x.t.dUsd;o.cu+=x.t.cUsd;o.db+=x.t.dBs;o.cb+=x.t.cBs;return o;},{du:0,cu:0,db:0,cb:0});
 return '<div class="ac-tools"><span class="ac-muted">Solo asientos contabilizados. Las cuentas sin movimiento se omiten.</span><button class="ac-small" id="acExportTrial">Exportar CSV</button></div><div class="ac-scroll"><table class="ac-table"><thead><tr><th>Código</th><th>Cuenta</th><th class="ac-num">Debe US$</th><th class="ac-num">Haber US$</th><th class="ac-num">Debe Bs.</th><th class="ac-num">Haber Bs.</th></tr></thead><tbody>'+rows.map(x=>'<tr><td class="ac-code">'+esc(x.a.code)+'</td><td>'+esc(x.a.name)+'</td><td class="ac-num">'+money(x.t.dUsd)+'</td><td class="ac-num">'+money(x.t.cUsd)+'</td><td class="ac-num">'+money(x.t.dBs)+'</td><td class="ac-num">'+money(x.t.cBs)+'</td></tr>').join('')+'<tr class="ac-total"><td colspan="2">TOTALES</td><td class="ac-num">'+money(totals.du)+'</td><td class="ac-num">'+money(totals.cu)+'</td><td class="ac-num">'+money(totals.db)+'</td><td class="ac-num">'+money(totals.cb)+'</td></tr></tbody></table></div><div class="ac-check '+(Math.abs(totals.du-totals.cu)<0.01&&Math.abs(totals.db-totals.cb)<0.01?'ok':'warn')+'">'+(Math.abs(totals.du-totals.cu)<0.01&&Math.abs(totals.db-totals.cb)<0.01?'Cuadrado':'Diferencia detectada')+' · USD: '+money(totals.du-totals.cu)+' · Bs.: '+money(totals.db-totals.cb)+'</div>';
}
function render(){
 if(!dialog)return;
 const content=$('#acContent',dialog);
 content.innerHTML=activeTab==='accounts'?renderAccounts():activeTab==='journal'?renderJournal():activeTab==='ledger'?renderLedger():activeTab==='trial'?renderTrial():activeTab==='statements'?renderStatements():activeTab==='assets'?renderAssets():renderIntegration();
 dialog.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===activeTab));
}
function addLine(container,values={}){
 const row=document.createElement('tr');row.className='ac-line';
 row.innerHTML='<td>'+accountSelect(values.accountCode)+'</td><td><input class="ac-input ac-amount" data-field="debitUsd" inputmode="decimal" placeholder="0,00" value="'+(values.debitUsd??'')+'"></td><td><input class="ac-input ac-amount" data-field="creditUsd" inputmode="decimal" placeholder="0,00" value="'+(values.creditUsd??'')+'"></td><td><input class="ac-input ac-amount" data-field="debitBs" inputmode="decimal" placeholder="0,00" value="'+(values.debitBs??'')+'"></td><td><input class="ac-input ac-amount" data-field="creditBs" inputmode="decimal" placeholder="0,00" value="'+(values.creditBs??'')+'"></td><td><button type="button" class="ac-small" data-remove-line>×</button></td>';
 container.appendChild(row);return row;
}
function parseAmount(v){if(v==null||String(v).trim()==='')return 0;let s=String(v).trim();if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)&&n>=0?n:NaN;}
function showEntryForm(prefill=null){
 const a=state(),el=document.createElement('div');el.className='ac-modal';
 const lines=prefill?.lines||[{},{},];
 el.innerHTML='<div class="ac-modal-card"><div class="ac-modal-head"><b>'+(prefill?'Detalle del asiento':'Nuevo asiento contable')+'</b><button class="ac-small" id="acCloseForm">Cerrar</button></div><div class="ac-form-grid"><label>Fecha<input class="ac-input" id="acDate" type="date" value="'+esc(prefill?.date||today())+'" '+(prefill?'disabled':'')+'></label><label>Referencia<input class="ac-input" id="acReference" maxlength="80" placeholder="Factura, comprobante, soporte…" value="'+esc(prefill?.reference||'')+'" '+(prefill?'disabled':'')+'></label><label class="wide">Concepto / descripción<input class="ac-input" id="acDescription" maxlength="240" placeholder="Explique brevemente la operación" value="'+esc(prefill?.description||'')+'" '+(prefill?'disabled':'')+'></label><label>Tasa Bs./US$<input class="ac-input" id="acRate" type="number" min="0.000001" step="0.000001" value="'+esc(prefill?.rate||'')+'" placeholder="Tasa aplicable" '+(prefill?'disabled':'')+'></label></div><div class="ac-scroll"><table class="ac-table ac-entry-table"><thead><tr><th>Cuenta imputable</th><th>Debe US$</th><th>Haber US$</th><th>Debe Bs.</th><th>Haber Bs.</th><th></th></tr></thead><tbody id="acEntryLines"></tbody></table></div><div class="ac-form-foot"><span id="acEntryTotals" class="ac-muted"></span><button class="ac-small" id="acAddLine" '+(prefill?'hidden':'')+'>＋ Agregar renglón</button><button class="ac-primary" id="acPostEntry" '+(prefill?'hidden':'')+'>Contabilizar asiento</button></div><p class="ac-note">Solo se permiten cuentas imputables. Debe y Haber deben cuadrar tanto en USD como en Bs. El asiento contabilizado se conserva; las correcciones se hacen con una reversión.</p></div>';
 dialog.appendChild(el);
 const body=$('#acEntryLines',el);
 lines.forEach(l=>addLine(body,l));
 if(!prefill&&lines.length===0){addLine(body);addLine(body);}
 const updateTotals=()=>{let dU=0,cU=0,dB=0,cB=0;body.querySelectorAll('tr').forEach(r=>{const v=f=>parseAmount($('[data-field="'+f+'"]',r).value)||0;dU+=v('debitUsd');cU+=v('creditUsd');dB+=v('debitBs');cB+=v('creditBs');});$('#acEntryTotals',el).textContent='Debe/Haber US$: '+money(dU)+' / '+money(cU)+' · Bs.: '+money(dB)+' / '+money(cB);};
 body.addEventListener('input',e=>{
  const field=e.target.dataset.field;if(!field||!field.endsWith('Usd')&&!field.endsWith('Bs'))return;
  const row=e.target.closest('tr'),rate=Number($('#acRate',el).value)||0;
  if(rate>0){const counterpart=field.endsWith('Usd')?field.replace('Usd','Bs'):field.replace('Bs','Usd');const parsed=parseAmount(e.target.value);const other=$('[data-field="'+counterpart+'"]',row);if(parsed!==0&&Number.isFinite(parsed))other.value=money(field.endsWith('Usd')?parsed*rate:parsed/rate);}
  updateTotals();
 });
 body.addEventListener('click',e=>{if(e.target.closest('[data-remove-line]')){e.target.closest('tr').remove();updateTotals();}});
 $('#acAddLine',el)?.addEventListener('click',()=>{addLine(body);updateTotals();});
 $('#acCloseForm',el).addEventListener('click',()=>el.remove());
 $('#acPostEntry',el)?.addEventListener('click',async()=>{
  const date=$('#acDate',el).value,reference=$('#acReference',el).value.trim(),description=$('#acDescription',el).value.trim(),rate=Number($('#acRate',el).value);
  if(!date||!description||!Number.isFinite(rate)||rate<=0){alert('Indique fecha, concepto y tasa válida.');return;}
  const map=accountMap(),entryLines=[];
  for(const row of body.querySelectorAll('tr')){
   const accountCode=$('[data-field="account"]',row).value;
   const vals={};for(const f of ['debitUsd','creditUsd','debitBs','creditBs'])vals[f]=parseAmount($('[data-field="'+f+'"]',row).value);
   if(Object.values(vals).some(v=>!Number.isFinite(v))){alert('Hay importes no válidos.');return;}
   if(!accountCode){if(Object.values(vals).some(v=>v>0)){alert('Seleccione una cuenta imputable para cada renglón con monto.');return;}continue;}
   const account=map.get(accountCode);if(!account||!account.isMovement){alert('La cuenta seleccionada no admite movimientos.');return;}
   if(vals.debitUsd+vals.creditUsd+vals.debitBs+vals.creditBs<=0){continue;}
   if(vals.debitUsd>0&&vals.creditUsd>0||vals.debitBs>0&&vals.creditBs>0){alert('Un renglón no puede tener Debe y Haber simultáneamente en la misma moneda.');return;}
   entryLines.push({accountCode,accountName:account.name,...vals});
  }
  if(entryLines.length<2){alert('El asiento requiere al menos dos renglones imputables.');return;}
  const sum=f=>entryLines.reduce((n,l)=>n+Number(l[f]||0),0);
  const dU=sum('debitUsd'),cU=sum('creditUsd'),dB=sum('debitBs'),cB=sum('creditBs');
  if(Math.abs(dU-cU)>=0.01||Math.abs(dB-cB)>=0.01){alert('El asiento no cuadra. Debe y Haber deben coincidir en USD y Bs.');return;}
  const sequence=nextEntrySequence(a),id='ACC-'+String(sequence).padStart(6,'0');
  a.entries.push({id,number:id,sequence,date,reference,description,rate,lines:entryLines,totalDebitUsd:dU,totalCreditUsd:cU,totalDebitBs:dB,totalCreditBs:cB,status:'posted',createdAt:new Date().toISOString(),createdBy:window.SIFERAccountingBridge.getState().cfg?.cajero||'Contador'});
  a.nextEntry=sequence+1;const persisted=await save();if(!persisted||!persisted.ok){a.entries=a.entries.filter(x=>x.id!==id);a.nextEntry=sequence;alert('SQLite no confirmó el asiento. No se registró definitivamente; verifique la conexión antes de reintentar.');return;}el.remove();render();
 });
 if(prefill){const map=accountMap();body.querySelectorAll('tr').forEach((r,i)=>{const l=prefill.lines[i];if(!l)return;const sel=$('[data-field="account"]',r);sel.value=l.accountCode;sel.disabled=true;for(const f of ['debitUsd','creditUsd','debitBs','creditBs'])$('[data-field="'+f+'"]',r).disabled=true;});}
 updateTotals();
}
async function reverseEntry(id){
 const a=state(),original=a.entries.find(e=>e.id===id);if(!original)return;
 if(a.entries.some(e=>e.reversalOf===id)){alert('Este asiento ya tiene una reversión registrada.');return;}
 if(!confirm('Se creará un asiento inverso y se conservará el original. ¿Continuar?'))return;
 const sequence=nextEntrySequence(a),newId='ACC-'+String(sequence).padStart(6,'0');
 const lines=original.lines.map(l=>({...l,debitUsd:l.creditUsd,creditUsd:l.debitUsd,debitBs:l.creditBs,creditBs:l.debitBs}));
 a.entries.push({id:newId,number:newId,sequence,date:today(),reference:'REVERSIÓN '+original.number,description:'Reversión de '+original.number+' · '+original.description,rate:original.rate,lines,totalDebitUsd:original.totalCreditUsd,totalCreditUsd:original.totalDebitUsd,totalDebitBs:original.totalCreditBs,totalCreditBs:original.totalDebitBs,status:'posted',reversalOf:id,createdAt:new Date().toISOString(),createdBy:window.SIFERAccountingBridge.getState().cfg?.cajero||'Contador'});
 a.nextEntry=sequence+1;const persisted=await save();if(!persisted||!persisted.ok){a.entries=a.entries.filter(x=>x.id!==newId);a.nextEntry=sequence;alert('SQLite no confirmó la reversión. El asiento original permanece intacto.');return;}render();
}
function exportTrial(){
 const rows=movementAccounts().map(a=>({a,t:totalsFor(validEntries(),a.code)})).filter(x=>Math.abs(x.t.dUsd)+Math.abs(x.t.cUsd)+Math.abs(x.t.dBs)+Math.abs(x.t.cBs)>0.000001);
 const csv=['Código,Cuenta,Debe USD,Haber USD,Debe Bs,Haber Bs',...rows.map(x=>[x.a.code,'"'+x.a.name.replace(/"/g,'""')+'"',x.t.dUsd,x.t.cUsd,x.t.dBs,x.t.cBs].join(','))].join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='sifer360-balance-comprobacion-'+today()+'.csv';a.click();URL.revokeObjectURL(url);
}

function cashFlowTotals(entries){
 const cashAccounts=movementAccounts().filter(a=>String(a.code).startsWith('1.1.1.'));
 const cashCodes=new Set(cashAccounts.map(a=>String(a.code))),map=accountMap();
 const buckets={operating:{inUsd:0,outUsd:0,inBs:0,outBs:0},investing:{inUsd:0,outUsd:0,inBs:0,outBs:0},financing:{inUsd:0,outUsd:0,inBs:0,outBs:0}};
 for(const entry of entries){
  const lines=Array.isArray(entry.lines)?entry.lines:[];
  const cash=lines.filter(l=>cashCodes.has(String(l.accountCode)));
  if(!cash.length)continue;
  const netUsd=cash.reduce((n,l)=>n+(Number(l.debitUsd)||0)-(Number(l.creditUsd)||0),0);
  const netBs=cash.reduce((n,l)=>n+(Number(l.debitBs)||0)-(Number(l.creditBs)||0),0);
  if(Math.abs(netUsd)+Math.abs(netBs)<0.000001)continue;
  const counterparts=lines.filter(l=>!cashCodes.has(String(l.accountCode))&&(Number(l.debitUsd||0)+Number(l.creditUsd||0)+Number(l.debitBs||0)+Number(l.creditBs||0)>0));
  const accounts=counterparts.map(l=>map.get(String(l.accountCode))).filter(Boolean);
  let type='operating';
  if(accounts.some(a=>String(a.code).startsWith('1.2.')))type='investing';
  else if(accounts.some(a=>a.type==='PATRIMONIO'||String(a.code).startsWith('2.2.')||String(a.code).startsWith('3.')))type='financing';
  const bucket=buckets[type];
  if(netUsd>=0)bucket.inUsd+=netUsd;else bucket.outUsd+=Math.abs(netUsd);
  if(netBs>=0)bucket.inBs+=netBs;else bucket.outBs+=Math.abs(netBs);
 }
 return buckets;
}
function renderStatements(){
 const date=$('#acStatementDate',dialog)?.value||today(),entries=validEntries().filter(e=>String(e.date)<=date);
 const sums=type=>movementAccounts().filter(a=>a.type===type).map(a=>({a,t:totalsFor(entries,a.code)}));
 const natural=(type,t)=>type==='ACTIVO'||type==='COSTOS'||type==='GASTOS'?t.balUsd:t.cUsd-t.dUsd;
 const assets=sums('ACTIVO'),liabs=sums('PASIVO'),equity=sums('PATRIMONIO'),income=sums('INGRESOS'),costs=sums('COSTOS'),expenses=sums('GASTOS');
 const total=x=>x.reduce((n,z)=>n+natural(z.a.type,z.t),0);
 const totalAssets=total(assets),totalLiabs=total(liabs),totalEquity=total(equity);
 const profit=total(income)-total(costs)-total(expenses);
 const section=(title,rows,type)=>'<h3 class="ac-report-title">'+title+'</h3><table class="ac-table"><thead><tr><th>Código</th><th>Cuenta</th><th class="ac-num">Saldo US$</th><th class="ac-num">Saldo Bs.</th></tr></thead><tbody>'+rows.filter(x=>Math.abs(x.t.balUsd)+Math.abs(x.t.balBs)>0.000001).map(x=>{const sign=type==='ACTIVO'||type==='COSTOS'||type==='GASTOS'?1:-1;return '<tr><td class="ac-code">'+esc(x.a.code)+'</td><td>'+esc(x.a.name)+'</td><td class="ac-num">'+money(x.t.balUsd*sign)+'</td><td class="ac-num">'+money(x.t.balBs*sign)+'</td></tr>';}).join('')+'</tbody><tfoot><tr class="ac-total"><td colspan="2">Total '+title+'</td><td class="ac-num">'+money(total(rows))+'</td><td class="ac-num">'+money(rows.reduce((n,x)=>n+(type==='ACTIVO'||type==='COSTOS'||type==='GASTOS'?x.t.balBs:-x.t.balBs),0))+'</td></tr></tfoot></table>';
 const d=total(income),c=total(costs),g=total(expenses);
 return '<div class="ac-tools"><label>Fecha de corte <input type="date" class="ac-input" id="acStatementDate" value="'+esc(date)+'"></label><button class="ac-small" id="acExportStatement">Exportar estados CSV</button><span class="ac-muted">Cifras derivadas exclusivamente de asientos contabilizados hasta la fecha seleccionada.</span></div><div class="ac-report-scroll"><section class="ac-report"><h2>Estado de situación financiera</h2><p class="ac-muted">Al '+esc(date)+'</p>'+section('Activos',assets,'ACTIVO')+section('Pasivos',liabs,'PASIVO')+section('Patrimonio',equity,'PATRIMONIO')+'<div class="ac-check '+(Math.abs(totalAssets-totalLiabs-totalEquity-profit)<0.02?'ok':'warn')+'">Activo: '+money(totalAssets)+' · Pasivo + Patrimonio + resultado del período: '+money(totalLiabs+totalEquity+profit)+' USD</div></section><section class="ac-report"><h2>Estado de resultados acumulado</h2><p class="ac-muted">Desde el inicio de la contabilidad hasta '+esc(date)+'</p>'+section('Ingresos',income,'INGRESOS')+section('Costos',costs,'COSTOS')+section('Gastos',expenses,'GASTOS')+'<div class="ac-total ac-profit">Resultado acumulado: '+money(profit)+' USD · '+money(total(income.map(x=>({a:x.a,t:{balBs:x.t.balBs,dUsd:x.t.dUsd,cUsd:x.t.cUsd}})))-costs.reduce((n,x)=>n+x.t.dBs-x.t.cBs,0)-expenses.reduce((n,x)=>n+x.t.dBs-x.t.cBs,0))+' Bs.</div></section><section class="ac-report"><h2>Estado de flujos de efectivo · método directo simplificado</h2><p class="ac-muted">Movimientos reales de Debe/Haber en cuentas imputables de efectivo y bancos hasta '+esc(date)+'. La clasificación usa las cuentas de contrapartida del asiento; revise operaciones mixtas y auxiliares bancarios antes de emitir el estado definitivo.</p>'+(()=>{const flow=cashFlowTotals(entries),rows=[['Operación',flow.operating],['Inversión',flow.investing],['Financiación',flow.financing]];let netUsd=0,netBs=0;const html=rows.map(([name,x])=>{const u=x.inUsd-x.outUsd,b=x.inBs-x.outBs;netUsd+=u;netBs+=b;return '<tr><td>'+name+'</td><td class="ac-num">'+money(x.inUsd)+'</td><td class="ac-num">'+money(x.outUsd)+'</td><td class="ac-num">'+money(u)+'</td><td class="ac-num">'+money(x.inBs)+'</td><td class="ac-num">'+money(x.outBs)+'</td><td class="ac-num">'+money(b)+'</td></tr>';}).join('');return '<div class="ac-scroll"><table class="ac-table"><thead><tr><th>Actividad</th><th>Entradas US$</th><th>Salidas US$</th><th>Neto US$</th><th>Entradas Bs.</th><th>Salidas Bs.</th><th>Neto Bs.</th></tr></thead><tbody>'+html+'<tr class="ac-total"><td>Variación neta de efectivo</td><td colspan="2"></td><td class="ac-num">'+money(netUsd)+'</td><td colspan="2"></td><td class="ac-num">'+money(netBs)+'</td></tr></tbody></table></div><p class="ac-note">El estado presenta flujos contabilizados y no inventa saldos iniciales. Las transferencias entre cuentas de efectivo se excluyen del flujo neto cuando ambas cuentas están configuradas como imputables.</p>'+section('Saldos de efectivo y bancos al corte',assets.filter(x=>String(x.a.code).startsWith('1.1.1.')),'ACTIVO');})()+'</section></div>';
}

const POS_PAYMENT_METHODS=[['efUSD','Efectivo US$'],['zelle','Zelle'],['cashea','Cashea (BNPL)'],['efBs','Efectivo Bs.'],['punto','Punto de venta'],['biopago','Biopago'],['pmovil','Pago móvil'],['transf','Transferencia Bs.']];
const INTEGRATION_FIELDS=[
 ['inventory','Inventario de mercancías','1.1.4.01'],
 ['costOfSales','Costo de ventas','5.1.1.01'],
 ['receivables','Cuentas por cobrar clientes','1.1.2.01'],
 ['revenueGeneral','Ventas alícuota general','4.1.1.01'],
 ['revenueExempt','Ventas exentas/exoneradas','4.1.1.02'],
 ['vatOutput16','IVA débito fiscal 16%','2.1.2.01'],
 ['vatOutput8','IVA débito fiscal 8%','2.1.2.02'],
 ['igtfPayable','IGTF por pagar','2.1.2.06'],
 ['suppliersPayable','Proveedores nacionales','2.1.1.01'],
 ['vatInput16','IVA crédito fiscal 16%','1.1.3.01'],
 ['vatInput8','IVA crédito fiscal 8%','1.1.3.02'],
 ['vatWithholding','Retenciones IVA por enterar','2.1.2.03']
];
function integrationConfig(){const a=state();if(!a.postingConfig)a.postingConfig={paymentAccounts:{},accounts:{}};return a.postingConfig;}
function renderIntegration(){
 const cfg=integrationConfig(),movement=movementAccounts();
 const accountOptions=(value)=>'<option value="">— Sin configurar —</option>'+movement.map(a=>'<option value="'+esc(a.code)+'" '+(String(value||'')===String(a.code)?'selected':'')+'>'+esc(a.code+' · '+a.name)+'</option>').join('');
 return '<div class="ac-tools"><b>Reglas contables del POS</b><span class="ac-muted">Configure cuentas imputables reales. No se asignan bancos agrupadores automáticamente.</span></div><section class="ac-report"><h3>Contrapartida por método de cobro y pago</h3><p class="ac-note">Cada medio debe apuntar a una cuenta imputable. Para Zelle, punto de venta, Biopago, pago móvil y transferencias, seleccione la cuenta auxiliar o de liquidación que corresponda a la empresa. No use una cuenta de caja si el dinero ingresa a un banco.</p><div class="ac-form-grid">'+POS_PAYMENT_METHODS.map(([id,label])=>'<label>'+esc(label)+'<select class="ac-input" data-pay-account="'+id+'">'+accountOptions(cfg.paymentAccounts[id])+'</select></label>').join('')+'</div></section><section class="ac-report"><h3>Cuentas de operación</h3><div class="ac-form-grid">'+INTEGRATION_FIELDS.map(([key,label,defaultCode])=>'<label>'+esc(label)+'<select class="ac-input" data-integration-account="'+key+'">'+accountOptions(cfg.accounts[key]||defaultCode)+'</select></label>').join('')+'</div><p class="ac-note">Los códigos sugeridos son referencias del catálogo, no se activan hasta que el contador guarde y revise las asignaciones. Las compras con retención, tasas no contempladas o medios sin cuenta configurada permanecerán pendientes de contabilización.</p></section><div class="ac-form-foot"><button class="ac-primary" id="acSaveIntegration">Guardar configuración</button><span class="ac-muted">La configuración no modifica operaciones anteriores.</span></div>';
}
async function saveIntegration(){
 const cfg=integrationConfig();
 dialog.querySelectorAll('[data-pay-account]').forEach(el=>{if(el.value)cfg.paymentAccounts[el.dataset.payAccount]=el.value;else delete cfg.paymentAccounts[el.dataset.payAccount];});
 dialog.querySelectorAll('[data-integration-account]').forEach(el=>{if(el.value)cfg.accounts[el.dataset.integrationAccount]=el.value;else delete cfg.accounts[el.dataset.integrationAccount];});
 const persisted=await save();if(!persisted||!persisted.ok){alert('No se pudo guardar la configuración contable en SQLite.');return;}alert('Configuración contable guardada. Revise que cada cuenta corresponda al medio y operación real antes de activar la contabilización automática.');render();
}

function showAssetForm(){
 const a=state(),el=document.createElement('div');el.className='ac-modal';
 const categories=[['1.2.1.01','1.2.1.05','Mobiliario y equipos'],['1.2.1.02','1.2.1.07','Equipos de computación'],['1.2.1.03','1.2.1.06','Vehículos']];
 el.innerHTML='<div class="ac-modal-card"><div class="ac-modal-head"><b>Registrar activo fijo</b><button class="ac-small" id="acCloseAsset">Cerrar</button></div><div class="ac-form-grid"><label>Descripción<input class="ac-input" id="asName" maxlength="150" placeholder="Identificación del activo"></label><label>Fecha de adquisición<input class="ac-input" id="asDate" type="date" value="'+today()+'"></label><label>Fecha disponible para uso<input class="ac-input" id="asAvailableDate" type="date" value="'+today()+'" required></label><label>Grupo contable<select class="ac-input" id="asCategory">'+categories.map(c=>'<option value="'+c[0]+'|'+c[1]+'">'+c[2]+'</option>').join('')+'</select></label><label>Costo de adquisición US$<input class="ac-input" id="asCostUsd" type="number" min="0.01" step="0.01"></label><label>Costo de adquisición Bs.<input class="ac-input" id="asCostBs" type="number" min="0.01" step="0.01"></label><label>Vida útil (meses)<input class="ac-input" id="asLife" type="number" min="1" max="1200" value="60"></label><label>Valor residual US$<input class="ac-input" id="asResidual" type="number" min="0" step="0.01" value="0"></label><label>Valor residual Bs.<input class="ac-input" id="asResidualBs" type="number" min="0" step="0.01" value="0"></label><label>Tasa de adquisición Bs./US$<input class="ac-input" id="asRate" type="number" min="0.000001" step="0.000001"></label></div><p class="ac-note">El alta del auxiliar no contabiliza nuevamente la compra. Registre primero el asiento de adquisición o apertura correspondiente; este auxiliar permitirá controlar la depreciación.</p><div class="ac-form-foot"><button class="ac-primary" id="acSaveAsset">Guardar activo</button></div></div>';
 dialog.appendChild(el);
 $('#acCloseAsset',el).onclick=()=>el.remove();
 $('#acSaveAsset',el).onclick=async()=>{
  const name=$('#asName',el).value.trim(),date=$('#asDate',el).value,availableForUseDate=$('#asAvailableDate',el).value,[assetAccount,accumAccount]=$('#asCategory',el).value.split('|');
  const costUsd=Number($('#asCostUsd',el).value),costBs=Number($('#asCostBs',el).value),lifeMonths=Number($('#asLife',el).value),residualUsd=Number($('#asResidual',el).value)||0,residualBs=Number($('#asResidualBs',el).value)||0,rate=Number($('#asRate',el).value);
  if(!name||!date||!availableForUseDate||availableForUseDate<date||!(costUsd>0)||!(costBs>0)||!(lifeMonths>0)||!Number.isInteger(lifeMonths)||residualUsd<0||residualBs<0||residualUsd>costUsd||residualBs>costBs||!(rate>0)){alert('Complete los datos del activo con importes y vida útil válidos.');return;}
  const map=accountMap();if(!map.get(assetAccount)?.isMovement||!map.get(accumAccount)?.isMovement){alert('Las cuentas del activo no están disponibles en el plan VEN-NIF.');return;}
  const id='AF-'+String(a.nextAsset||1).padStart(5,'0');
  a.fixedAssets.push({id,name,acquisitionDate:date,availableForUseDate,assetAccount,accumulatedDepreciationAccount:accumAccount,costUsd,costBs,residualUsd,residualBs,lifeMonths,rate,monthlyUsd:(costUsd-residualUsd)/lifeMonths,monthlyBs:(costBs-residualBs)/lifeMonths,monthsDepreciated:0,lastDepreciationMonth:null,status:'active',createdAt:new Date().toISOString()});
  a.nextAsset=(Number(a.nextAsset)||1)+1;const persisted=await save();if(!persisted||!persisted.ok){a.fixedAssets=a.fixedAssets.filter(x=>x.id!==id);a.nextAsset=Math.max(1,Number(a.nextAsset)-1);alert('No se pudo guardar el activo fijo en SQLite. No se confirmó el registro.');return;}el.remove();render();
 };
}
function renderAssets(){
 const assets=state().fixedAssets||[];
 return '<div class="ac-tools"><button class="ac-primary" id="acNewAsset">＋ Registrar activo</button><span class="ac-muted">'+assets.filter(a=>a.status==='active').length+' activos · Depreciación mensual automática</span></div><div class="ac-scroll"><table class="ac-table"><thead><tr><th>Activo</th><th>Disponible para uso</th><th>Costo US$</th><th>Vida útil</th><th>Depreciado</th><th>Último período</th><th>Estado</th></tr></thead><tbody>'+ (assets.map(a=>'<tr><td><b>'+esc(a.id)+'</b><br>'+esc(a.name)+'</td><td>'+esc(a.availableForUseDate||a.acquisitionDate||'—')+'</td><td class="ac-num">'+money(a.costUsd)+'</td><td>'+a.lifeMonths+' meses</td><td>'+a.monthsDepreciated+'/'+a.lifeMonths+'</td><td>'+esc(a.lastDepreciationMonth||'—')+'</td><td>'+(a.status==='active'&&a.monthsDepreciated<a.lifeMonths?'<span class="ac-muted">Automática</span>':'<span class="ac-muted">Completado</span>')+'</td></tr>').join('')||'<tr><td colspan="7" class="ac-empty">No hay activos fijos registrados.</td></tr>')+'</tbody></table></div><p class="ac-note">El sistema contabiliza automáticamente al cierre de cada mes. Si estuvo cerrado, recupera los períodos completos pendientes al iniciar. El contador puede revisar los asientos en el diario.</p>';
}
function lastCompletedMonth(now=new Date()){
 const y=now.getFullYear(),m=now.getMonth();
 const d=new Date(y,m,0);
 return String(d.getFullYear()).padStart(4,'0')+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function depreciateAsset(id,target){
 const a=state(),asset=a.fixedAssets.find(x=>x.id===id);if(!asset||asset.status!=='active')return 0;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(target||''))return 0;
 const available=String(asset.availableForUseDate||asset.acquisitionDate||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(available))return 0;
 const start=available.slice(0,7);if(target<start)return 0;
 const periodEntries=(a.entries||[]).filter(e=>e.assetId===asset.id&&e.depreciationPeriod);
 const recorded=new Set(periodEntries.map(e=>String(e.depreciationPeriod)));
 const legacyLast=String(asset.lastDepreciationMonth||'').slice(0,7);
 let cursor=start;
 if(!recorded.size&&/^\d{4}-(0[1-9]|1[0-2])$/.test(legacyLast)&&legacyLast>=start){const y=Number(legacyLast.slice(0,4)),m=Number(legacyLast.slice(5,7));cursor=m===12?String(y+1).padStart(4,'0')+'-01':String(y).padStart(4,'0')+'-'+String(m+1).padStart(2,'0');}
 const periods=[];
 while(cursor<=target&&periods.length<=asset.lifeMonths+240){
  if(!recorded.has(cursor))periods.push(cursor);
  const y=Number(cursor.slice(0,4)),m=Number(cursor.slice(5,7));
  cursor=m===12?String(y+1).padStart(4,'0')+'-01':String(y).padStart(4,'0')+'-'+String(m+1).padStart(2,'0');
 }
 if(!periods.length)return 0;
 const recordedCount=recorded.size,alreadyUsd=periodEntries.reduce((n,e)=>n+(e.lines||[]).reduce((s,l)=>s+(Number(l.creditUsd)||0),0),0),alreadyBs=periodEntries.reduce((n,e)=>n+(e.lines||[]).reduce((s,l)=>s+(Number(l.creditBs)||0),0),0);
 const countBefore=Math.max(Number(asset.monthsDepreciated)||0,recordedCount);
 if(countBefore>=asset.lifeMonths)return 0;
 const map=accountMap(),expense=map.get('6.1.1.06'),accum=map.get(asset.accumulatedDepreciationAccount);
 if(!expense?.isMovement||!accum?.isMovement)return 0;
 let posted=0,usedUsd=alreadyUsd,usedBs=alreadyBs,count=countBefore,sequence=nextEntrySequence(a);
 for(const month of periods){
  if(count>=asset.lifeMonths)break;
  const remainingUsd=Math.max(0,Math.round((Number(asset.costUsd)-Number(asset.residualUsd)-usedUsd)*100)/100);
  const remainingBs=Math.max(0,Math.round((Number(asset.costBs)-Number(asset.residualBs)-usedBs)*100)/100);
  const debitUsd=Math.min(Math.round((Number(asset.monthlyUsd)||0)*100)/100,remainingUsd);
  const debitBs=Math.min(Math.round((Number(asset.monthlyBs)||0)*100)/100,remainingBs);
  if(!(debitUsd>0)||!(debitBs>0))break;
  const entryId='ACC-'+String(sequence).padStart(6,'0'),y=Number(month.slice(0,4)),m=Number(month.slice(5,7)),date=month+'-'+String(new Date(y,m,0).getDate()).padStart(2,'0');
  a.entries.push({id:entryId,number:entryId,sequence,date,reference:asset.id+' / '+month,description:'Depreciación mensual automática · '+asset.name,rate:debitBs/debitUsd,lines:[{accountCode:expense.code,accountName:expense.name,debitUsd,creditUsd:0,debitBs,creditBs:0},{accountCode:accum.code,accountName:accum.name,debitUsd:0,creditUsd:debitUsd,debitBs:0,creditBs:debitBs}],totalDebitUsd:debitUsd,totalCreditUsd:debitUsd,totalDebitBs:debitBs,totalCreditBs:debitBs,status:'posted',createdAt:new Date().toISOString(),createdBy:'Sistema · depreciación automática',assetId:asset.id,depreciationPeriod:month});
  usedUsd+=debitUsd;usedBs+=debitBs;count++;posted++;sequence++;
 }
 if(!posted)return 0;
 const allPeriods=[...recorded,...a.entries.filter(e=>e.assetId===asset.id&&e.depreciationPeriod).map(e=>String(e.depreciationPeriod))].sort();
 asset.monthsDepreciated=count;asset.lastDepreciationMonth=allPeriods[allPeriods.length-1]||asset.lastDepreciationMonth;
 if(count>=asset.lifeMonths||usedUsd>=asset.costUsd-asset.residualUsd-0.000001||usedBs>=asset.costBs-asset.residualBs-0.000001)asset.status='depreciated';
 a.nextEntry=sequence;return posted;
}
let automaticDepreciationBusy=false,automaticDepreciationTimer=null,automaticDepreciationNeedsSave=false;
async function runAutomaticDepreciation(){
 if(automaticDepreciationBusy||!bridge())return;
 automaticDepreciationBusy=true;
 try{
  const a=state(),target=lastCompletedMonth(),assets=a.fixedAssets||[];let total=0;
  for(const asset of assets)if(asset.status==='active')total+=depreciateAsset(asset.id,target);
  if(total)automaticDepreciationNeedsSave=true;
  if(automaticDepreciationNeedsSave){
   const persisted=await save();
   if(!persisted||!persisted.ok||!['sqlite+localStorage','desktop','sqlite-file','server-sqlite'].includes(persisted.durable))throw (persisted&&persisted.error)||new Error('SQLite local todavía no confirmó la persistencia de la depreciación; se reintentará automáticamente.');
   automaticDepreciationNeedsSave=false;
   if(dialog&&activeTab==='assets')render();
  }
 }catch(error){console.error('No se pudo completar la depreciación automática:',error);}
 finally{automaticDepreciationBusy=false;}
}
function startAutomaticDepreciation(){
 if(automaticDepreciationTimer)clearInterval(automaticDepreciationTimer);
 runAutomaticDepreciation();
 automaticDepreciationTimer=setInterval(runAutomaticDepreciation,60000);
 document.removeEventListener('visibilitychange',runAutomaticDepreciation);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)runAutomaticDepreciation();});
 window.removeEventListener('focus',runAutomaticDepreciation);
 window.addEventListener('focus',runAutomaticDepreciation);
}

function exportStatement(){
 const date=$('#acStatementDate',dialog)?.value||today(),entries=validEntries().filter(e=>e.date<=date),rows=movementAccounts().map(a=>({a,t:totalsFor(entries,a.code)}));
 const csv=['Código,Cuenta,Tipo,Saldo USD,Saldo Bs',...rows.map(x=>[x.a.code,'"'+x.a.name.replace(/"/g,'""')+'"',x.a.type,x.t.balUsd,x.t.balBs].join(','))].join('\r\n');
 const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='sifer360-estados-financieros-'+date+'.csv';link.click();URL.revokeObjectURL(url);
}

function open(){
 if(!bridge()){alert('El módulo contable no pudo conectarse con la base de datos del POS.');return;}
 ensureChart().then(()=>{
  const old=$('#siferAccountingDialog');if(old)old.remove();
  dialog=document.createElement('section');dialog.id='siferAccountingDialog';dialog.className='ac-overlay';
  dialog.innerHTML='<div class="ac-window"><header class="ac-header"><div><strong>Contabilidad VEN-NIF</strong><small>Plan de cuentas · Diario · Mayor · Balance</small></div><button id="acClose" class="ac-close">×</button></header><nav class="ac-tabs">'+tabButtons()+'</nav><main id="acContent" class="ac-content"></main><footer class="ac-footer"><span>Catálogo fuente: SICOVEN · 97 cuentas · Persistencia SQLite SIFER</span><button id="acCloseFoot" class="ac-small">Cerrar</button></footer></div>';
  document.body.appendChild(dialog);
  dialog.addEventListener('click',e=>{
   if(e.target===dialog||e.target.closest('#acClose')||e.target.closest('#acCloseFoot')){dialog.remove();dialog=null;return;}
   const tab=e.target.closest('[data-tab]');if(tab){activeTab=tab.dataset.tab;render();return;}
   if(e.target.closest('#acNewEntry')){showEntryForm();return;}
   const rev=e.target.closest('[data-reverse]');if(rev){reverseEntry(rev.dataset.reverse);return;}
   const view=e.target.closest('[data-view-entry]');if(view){const entry=state().entries.find(x=>x.id===view.dataset.viewEntry);if(entry)showEntryForm(entry);return;}
   if(e.target.closest('#acExportTrial')){exportTrial();return;}
   if(e.target.closest('#acNewAsset')){showAssetForm();return;}
   const dep=e.target.closest('[data-depreciate]');if(dep){depreciateAsset(dep.dataset.depreciate);return;}
   if(e.target.closest('#acExportStatement')){exportStatement();return;}
  });
  dialog.addEventListener('input',e=>{if(e.target.id==='acSearch'){filterText=e.target.value;const pos=e.target.selectionStart;render();const input=$('#acSearch',dialog);input.focus();input.setSelectionRange(pos,pos);}});
  dialog.addEventListener('change',e=>{if(e.target.id==='acType'){filterType=e.target.value;render();}if(e.target.id==='acLedgerAccount'){selectedAccount=e.target.value;render();}if(e.target.id==='acStatementDate'){render();}});
  render();
 }).catch(e=>alert('No se pudo iniciar Contabilidad: '+e.message));
}
window.addEventListener('sifer:ready',startAutomaticDepreciation,{once:true});
window.SIFERAccountingApp={open};
})();