(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s);
const money=(n,currency)=>new Intl.NumberFormat('es-VE',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0);
const stamp=x=>{const n=Number(x?.docDateTs||x?.ts||x?.timestamp||0);if(n)return n;const p=Date.parse(x?.date||x?.fecha||'');return Number.isFinite(p)?p:0;};
const sum=(rows,fn)=>rows.reduce((n,x)=>n+(Number(fn(x))||0),0);
const outstanding=rows=>sum(rows,x=>Math.max(0,Number(x.total||0)-Number(x.paid||0)));
function show(){
 const bridge=window.SIFERAccountingBridge;
 if(!bridge||typeof bridge.getState!=='function'){alert('El estado local de SQLite todavía no está disponible. Recargue la aplicación.');return;}
 const state=bridge.getState()||{},cfg=state.cfg||{},rate=Number(cfg.rate)||0;
 const now=new Date(),monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime(),nextMonth=new Date(now.getFullYear(),now.getMonth()+1,1).getTime();
 const monthRows=rows=>(Array.isArray(rows)?rows:[]).filter(x=>!x.void&&stamp(x)>=monthStart&&stamp(x)<nextMonth);
 const sales=monthRows(state.sales),purchases=monthRows(state.purchases);
 const ivaDebitUsd=sum(sales,x=>x.iva),ivaCreditUsd=sum(purchases,x=>x.iva);
 const ivaDebitBs=sum(sales,x=>Number(x.iva||0)*Number(x.rate||rate));
 const ivaCreditBs=sum(purchases,x=>Number(x.iva||0)*Number(x.rate||rate));
 const ivaBalanceBs=ivaDebitBs-ivaCreditBs;
 const retentionPeriod=String(now.getFullYear())+String(now.getMonth()+1).padStart(2,'0');
 const retentions=(Array.isArray(state.retencionesIva)?state.retencionesIva:[]).filter(x=>String(x.periodo||'')===retentionPeriod);
 const pendingRetentions=retentions.filter(x=>x.declarada!==true&&x.pagada!==true);
 const retentionUsd=sum(pendingRetentions,x=>x.retainedUsd);
 const retentionBs=sum(pendingRetentions,x=>x.retainedBs||Number(x.retainedUsd||0)*Number(x.rate||rate));
 const igtfUsd=sum(sales,x=>x.igtf);
 const igtfBs=sum(sales,x=>Number(x.igtf||0)*Number(x.rate||rate));
 const cxc=(Array.isArray(state.cxc)?state.cxc:[]).filter(x=>!x.void);
 const cxp=(Array.isArray(state.cxp)?state.cxp:[]).filter(x=>!x.void);
 const accounting=state.accounting||{},entries=Array.isArray(accounting.entries)?accounting.entries:[];
 const posted=entries.filter(x=>x.status==='posted');
 const fmtPeriod=now.toLocaleDateString('es-VE',{month:'long',year:'numeric'});
 const fmtBs=n=>money(n,'VES'),fmtUsd=n=>money(n,'USD');
 const kpi=(label,value,sub,kind='blue')=>'<article class="acct-kpi"><span class="acct-kpi-label">'+label+'</span><strong class="acct-kpi-value '+kind+'">'+value+'</strong><small>'+sub+'</small></article>';
 const d=$('#adminDashboard'),main=$('.main'),left=$('.left');
 if(!d||!main)return;
 document.body.classList.add('accountant-mode');
 if(left)left.hidden=true;
 d.hidden=false;main.classList.add('dashboard-mode');
 d.innerHTML='<header class="acct-dash-head"><div><div class="acct-eyebrow">SIFER360 · ÁREA PROFESIONAL</div><h1>Dashboard del contador</h1><p>Resumen fiscal y contable · '+fmtPeriod+'</p></div><div class="acct-company"><b>'+String(cfg.empresa||'Empresa sin configurar').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))+'</b><span>RIF: '+String(cfg.rif||'No configurado')+'</span><span>Tasa registrada: '+(rate?rate.toLocaleString('es-VE')+' Bs./US$':'Sin tasa registrada')+'</span></div></header>'+
 '<section class="acct-kpi-grid">'+
 kpi('Ventas facturadas del mes',fmtUsd(sum(sales,x=>x.total)),fmtBs(sum(sales,x=>Number(x.total||0)*Number(x.rate||rate)))+' · '+sales.length+' documentos')+
 kpi('Débito fiscal IVA',fmtBs(ivaDebitBs),fmtUsd(ivaDebitUsd)+' · ventas del período','amber')+
 kpi('Crédito fiscal IVA',fmtBs(ivaCreditBs),fmtUsd(ivaCreditUsd)+' · compras del período','green')+
 kpi(ivaBalanceBs>=0?'IVA neto estimado por enterar':'Crédito fiscal a favor',fmtBs(Math.abs(ivaBalanceBs)),ivaBalanceBs>=0?'Débito menos crédito fiscal':'Crédito mayor que débito',ivaBalanceBs>=0?'amber':'green')+
 kpi('Retenciones IVA pendientes',fmtBs(retentionBs),fmtUsd(retentionUsd)+' · '+pendingRetentions.length+' comprobantes','amber')+
 kpi('IGTF percibido',fmtBs(igtfBs),fmtUsd(igtfUsd)+' · ventas del período','blue')+
 kpi('Cuentas por cobrar',fmtUsd(outstanding(cxc)),cxc.length+' documentos con saldo','blue')+
 kpi('Cuentas por pagar',fmtUsd(outstanding(cxp)),cxp.length+' documentos con saldo','blue')+
 '</section>'+
 '<section class="acct-dash-bottom"><article class="acct-summary-card"><h2>Actividad del período</h2><div class="acct-summary-grid"><div><b>'+sales.length+'</b><span>Facturas de venta</span></div><div><b>'+purchases.length+'</b><span>Compras registradas</span></div><div><b>'+retentions.length+'</b><span>Comprobantes de retención</span></div><div><b>'+pendingRetentions.length+'</b><span>Retenciones por revisar</span></div><div><b>'+posted.length+'</b><span>Asientos contabilizados</span></div><div><b>'+(Array.isArray(state.documents)?state.documents.length:0)+'</b><span>Soportes fiscales adjuntos</span></div></div></article><article class="acct-summary-card acct-guidance"><h2>Control profesional</h2><p>Las cifras se calculan con las operaciones registradas en la base de datos local. Revise los documentos, alícuotas, retenciones y soportes antes de preparar o presentar declaraciones.</p><p class="acct-note">El saldo de IVA es una estimación informativa del período y no sustituye la conciliación de los libros fiscales ni la revisión del contador.</p></article></section>';
}
window.SIFERAccountantDashboard={show};
})();