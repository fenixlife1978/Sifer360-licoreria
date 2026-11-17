'use strict';

function fail(message){throw new Error(message);}
function round2(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
function boxOf(sale){return String(sale&&sale.cashbox||'');}
function sameSale(note,sale){
  return Number(note.saleNo)===Number(sale.no)&&String(note.cashbox||'')===boxOf(sale);
}
function returnedQuantity(state,sale,lineIndex){
  return (state.returns||[]).filter(note=>sameSale(note,sale)&&!note.void)
    .reduce((sum,note)=>sum+(note.lines||[]).filter(line=>Number(line.lineIndex)===Number(lineIndex))
      .reduce((subtotal,line)=>subtotal+Number(line.qty||0),0),0);
}
function prepareReturn({state,sale,lines,returnStock=true,method='',reference='',reason='',rate}){
  if(!state||!sale)fail('No se encontró la venta original.');
  if(sale.void)fail('No se puede devolver una venta anulada.');
  if(sale.fiscal||sale.documentMode==='FISCAL'||sale.docType==='01-FACTURA-FISCAL')
    fail('La venta fue emitida por impresora fiscal. La nota de crédito debe emitirse mediante una operación fiscal autorizada; no se registrará una devolución interna.');
  if(sale.cashea||(sale.pays||[]).some(payment=>payment.id==='cashea'))
    fail('La venta tiene financiación Cashea. Debe conciliarse primero la reversión con Cashea.');
  if(Number(sale.igtf||0)>0)
    fail('La venta incluye IGTF. La devolución debe conciliar también ese impuesto; esta operación interna no lo ajustará automáticamente.');
  if(!Array.isArray(lines)||!lines.length)fail('Seleccione al menos un renglón para devolver.');
  if(!String(reason||'').trim())fail('Indique el motivo de la devolución.');
  const normalized=[];
  const seen=new Set();
  for(const input of lines){
    const lineIndex=Number(input.lineIndex),qty=Number(input.qty);
    if(!Number.isInteger(lineIndex)||lineIndex<0||lineIndex>=(sale.lines||[]).length)fail('Renglón original inválido.');
    if(seen.has(lineIndex))fail('No repita el mismo renglón en una nota; consolide su cantidad.');
    seen.add(lineIndex);
    const original=sale.lines[lineIndex];
    if(!(Number(original.qty)>0))fail('El renglón original no tiene una cantidad válida.');
    if(!(qty>0)||!Number.isFinite(qty))fail('La cantidad a devolver debe ser positiva.');
    const already=returnedQuantity(state,sale,lineIndex);
    const available=Number(original.qty)-already;
    if(qty>available+1e-8)fail('La cantidad supera lo vendido disponible para devolver en el renglón '+(lineIndex+1)+'. Disponible: '+available+'.');
    const ratio=qty/Number(original.qty);
    const base=round2(Number(original.net||0)*ratio);
    const iva=round2(Number(original.iva||0)*ratio);
    if(!Number.isFinite(base)||!Number.isFinite(iva)||base<0||iva<0)fail('El renglón original contiene importes inválidos.');
    normalized.push({lineIndex,code:String(original.code),desc:String(original.desc||''),qty,base,iva,total:round2(base+iva),unitCost:Number(original.unitCost||0)});
  }
  const total=round2(normalized.reduce((sum,line)=>sum+line.total,0));
  const box=boxOf(sale);
  if(!box)fail('La venta original no tiene caja identificable; no se puede asignar la devolución.');
  const linked=(state.cxc||[]).filter(item=>Number(item.saleNo)===Number(sale.no)&&String(item.cashbox||'')===box);
  if(linked.length>1)fail('Hay más de una CxC vinculada a la venta. Debe conciliarse manualmente.');
  const receivable=linked[0]||null;
  if(Number(sale.credit||0)>0&&!receivable)fail('La venta tiene crédito, pero no se encontró su CxC original.');
  const balance=receivable?round2(Math.max(0,Number(receivable.total||0)-Number(receivable.paid||0))):0;
  const creditApplied=round2(Math.min(total,balance));
  const refund=round2(Math.max(0,total-creditApplied));
  const validMethods=new Set(['efUSD','efBs','zelle','punto','biopago','pmovil','transf']);
  if(refund>0&&!validMethods.has(method))fail('Seleccione un método válido para el reembolso.');
  if(refund>0&&!['efUSD','efBs'].includes(method)&&!String(reference||'').trim())
    fail('El reembolso electrónico requiere número de referencia o confirmación.');
  const exchangeRate=Number(rate||sale.rate||1);
  if(!(exchangeRate>0)&&refund>0)fail('La tasa de cambio de la venta no es válida para registrar el reembolso.');
  return {
    saleNo:Number(sale.no),cashbox:box,reason:String(reason).trim(),returnStock:!!returnStock,
    lines:normalized,total,creditApplied,refund,method:refund?method:'',reference:String(reference||'').trim(),
    refundCurrency:method==='efBs'?'VES':'USD',
    refundAmount:refund?(method==='efBs'?round2(refund*exchangeRate):refund):0,
    rate:exchangeRate,receivableId:receivable&&receivable.id||null,
    receivableBefore:receivable?{total:Number(receivable.total||0),paid:Number(receivable.paid||0)}:null
  };
}
function applyReturn(state,prepared,{returnNo,refundNo,now=Date.now(),user=''}={}){
  if(!prepared||!returnNo)fail('Falta el consecutivo de la nota de crédito.');
  if(!Array.isArray(state.returns))state.returns=[];
  const sale=(state.sales||[]).find(item=>Number(item.no)===prepared.saleNo&&String(item.cashbox||'')===prepared.cashbox);
  if(!sale||sale.void)fail('La venta original ya no está disponible o fue anulada.');
  // Revalidate quantities at commit time to prevent stale dialogs or duplicate submissions.
  const fresh=prepareReturn({state,sale,lines:prepared.lines.map(line=>({lineIndex:line.lineIndex,qty:line.qty})),returnStock:prepared.returnStock,method:prepared.method,reference:prepared.reference,reason:prepared.reason,rate:prepared.rate});
  if(Math.abs(fresh.total-prepared.total)>0.01||Math.abs(fresh.creditApplied-prepared.creditApplied)>0.01||Math.abs(fresh.refund-prepared.refund)>0.01)
    fail('La venta o su saldo CxC cambió después de preparar la devolución. Vuelva a calcularla.');
  if(state.returns.some(note=>note.id==='NC-'+prepared.cashbox.replace(/\W/g,'')+'-'+String(returnNo).padStart(6,'0')))
    fail('El consecutivo de la nota de crédito ya está utilizado.');
  const note={
    id:'NC-'+prepared.cashbox.replace(/\W/g,'')+'-'+String(returnNo).padStart(6,'0'),
    sequence:Number(returnNo),saleNo:prepared.saleNo,cashbox:prepared.cashbox,ts:now,user,
    reason:prepared.reason,returnStock:prepared.returnStock,lines:prepared.lines.map(line=>({...line})),
    base:round2(prepared.lines.reduce((sum,line)=>sum+line.base,0)),
    iva:round2(prepared.lines.reduce((sum,line)=>sum+line.iva,0)),
    total:prepared.total,creditApplied:prepared.creditApplied,refund:prepared.refund,
    refundMethod:prepared.method,refundReference:prepared.reference,refundCurrency:prepared.refundCurrency,
    refundAmount:prepared.refundAmount,refundNo:prepared.refund>0?Number(refundNo||0):null
  };
  if(prepared.refund>0&&!refundNo)fail('Falta reservar el consecutivo independiente del reembolso.');
  if(prepared.returnStock){
    for(const line of prepared.lines){
      if(!(state.products||[]).some(item=>String(item.code)===line.code))
        fail('No se encontró el artículo '+line.code+' para reingresar la mercancía.');
    }
  }
  if(prepared.receivableId){
    const item=(state.cxc||[]).find(entry=>entry.id===prepared.receivableId);
    if(!item)fail('La CxC original ya no existe.');
    const newTotal=round2(Math.max(0,Number(item.total||0)-prepared.total));
    const newPaid=round2(Math.max(0,Number(item.paid||0)-prepared.refund));
    item.total=newTotal;
    item.paid=Math.min(newTotal,newPaid);
    item.creditNotes=item.creditNotes||[];
    item.creditNotes.push({id:note.id,ts:now,amount:prepared.creditApplied,refund:prepared.refund});
  }
  if(prepared.returnStock){
    for(const line of prepared.lines){
      const product=(state.products||[]).find(item=>String(item.code)===line.code);
      product.stock=round2(Number(product.stock||0)+line.qty);
      if(!Array.isArray(state.kardex))state.kardex=[];
      state.kardex.push({
        id:state.kardex.length+1,eventId:note.id+':'+line.lineIndex,ts:now,code:line.code,
        type:'DEVOLUCION',dir:'IN',doc:note.id,cashbox:prepared.cashbox,
        party:'Devolución de venta '+prepared.saleNo,qty:line.qty,stockAfter:product.stock,
        cost:line.unitCost,user
      });
    }
  }
  if(prepared.refund>0&&['efUSD','efBs'].includes(prepared.method)){
    if(!Array.isArray(state.movimientosCaja))state.movimientosCaja=[];
    state.movimientosCaja.push({
      id:'REF-'+prepared.cashbox.replace(/\W/g,'')+'-'+String(refundNo).padStart(6,'0'),
      cashbox:prepared.cashbox,sequence:Number(refundNo),ts:now,direction:'OUT',
      currency:prepared.refundCurrency,amount:prepared.refundAmount,
      reason:'Reembolso '+note.id+' · Venta '+prepared.saleNo,
      counterpartAccount:'Reembolsos a clientes',rate:prepared.rate,user
    });
  }
  state.returns.push(note);
  return note;
}
const api={returnedQuantity,prepareReturn,applyReturn};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(typeof window!=='undefined')window.SIFERReturnsLedger=api;
