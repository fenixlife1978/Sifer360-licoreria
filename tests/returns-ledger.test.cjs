const test=require('node:test');
const assert=require('node:assert/strict');
const {returnedQuantity,prepareReturn,applyReturn}=require('../public/returns-ledger.cjs');

function fixture(){
  const sale={no:44,cashbox:'Caja 01',ts:1000,rate:100,total:116,igtf:0,credit:80,void:false,documentMode:'LEGACY',
    client:{rif:'V-12345678-9'},pays:[{id:'efUSD',amount:36},{id:'credito',amount:80}],
    lines:[
      {code:'SKU-A',desc:'Artículo A',qty:2,unitCost:4,net:100,iva:16},
      {code:'SKU-A',desc:'Artículo A segunda línea',qty:1,unitCost:5,net:10,iva:1.6}
    ]};
  const state={sales:[sale],products:[{code:'SKU-A',stock:7}],cxc:[{id:'CXC-1',saleNo:44,cashbox:'Caja 01',total:80,paid:0,payments:[]}],returns:[],kardex:[],movimientosCaja:[]};
  return {sale,state};
}

test('partial return applies credit against CxC first and restores stock only when requested',()=>{
  const {sale,state}=fixture();
  const prepared=prepareReturn({state,sale,lines:[{lineIndex:0,qty:1}],returnStock:true,reason:'Producto sin abrir'});
  assert.equal(prepared.total,58);
  assert.equal(prepared.creditApplied,58);
  assert.equal(prepared.refund,0);
  const note=applyReturn(state,prepared,{returnNo:1,now:2000,user:'admin'});
  assert.equal(note.id,'NC-Caja01-000001');
  assert.equal(state.cxc[0].total,22);
  assert.equal(state.cxc[0].paid,0);
  assert.equal(state.products[0].stock,8);
  assert.equal(state.kardex.length,1);
  assert.equal(returnedQuantity(state,sale,0),1);
});

test('return exceeding remaining CxC produces a traceable refund and cash outflow',()=>{
  const {sale,state}=fixture();
  state.cxc[0].total=20;
  const prepared=prepareReturn({state,sale,lines:[{lineIndex:0,qty:1}],returnStock:false,method:'efUSD',reason:'Devolución parcial'});
  assert.equal(prepared.creditApplied,20);
  assert.equal(prepared.refund,38);
  const note=applyReturn(state,prepared,{returnNo:2,refundNo:1,now:3000,user:'admin'});
  assert.equal(note.refund,38);
  assert.equal(state.cxc[0].total,0);
  assert.equal(state.cxc[0].paid,0);
  assert.equal(state.products[0].stock,7);
  assert.equal(state.movimientosCaja.length,1);
  assert.equal(state.movimientosCaja[0].direction,'OUT');
  assert.equal(state.movimientosCaja[0].amount,38);
});

test('electronic refunds require a reference and do not alter cash drawer',()=>{
  const {sale,state}=fixture();
  state.cxc[0].total=0;
  assert.throws(()=>prepareReturn({state,sale,lines:[{lineIndex:1,qty:1}],method:'zelle',reason:'Devolución'}),/referencia/);
  const prepared=prepareReturn({state,sale,lines:[{lineIndex:1,qty:1}],method:'zelle',reference:'Z-9988',reason:'Devolución'});
  const note=applyReturn(state,prepared,{returnNo:3,refundNo:2});
  assert.equal(note.refundReference,'Z-9988');
  assert.equal(state.movimientosCaja.length,0);
});

test('same SKU in different sale lines is tracked by original line index',()=>{
  const {sale,state}=fixture();
  const first=prepareReturn({state,sale,lines:[{lineIndex:0,qty:2}],method:'efUSD',reason:'Línea 1'});
  applyReturn(state,first,{returnNo:4,refundNo:3});
  assert.equal(returnedQuantity(state,sale,0),2);
  assert.equal(returnedQuantity(state,sale,1),0);
  assert.throws(()=>prepareReturn({state,sale,lines:[{lineIndex:0,qty:0.1}],reason:'Exceso'}),/supera lo vendido/);
  const second=prepareReturn({state,sale,lines:[{lineIndex:1,qty:1}],method:'efUSD',reason:'Línea 2'});
  assert.equal(second.total,11.6);
});

test('blocks voided, fiscal, Cashea and IGTF sales rather than faking fiscal reversals',()=>{
  const {sale,state}=fixture();
  assert.throws(()=>prepareReturn({state,sale:{...sale,void:true},lines:[{lineIndex:0,qty:1}],reason:'x'}),/anulada/);
  assert.throws(()=>prepareReturn({state,sale:{...sale,fiscal:{documentNumber:'F-1'}},lines:[{lineIndex:0,qty:1}],reason:'x'}),/impresora fiscal/);
  assert.throws(()=>prepareReturn({state,sale:{...sale,cashea:{aprobacion:'A-1'}},lines:[{lineIndex:0,qty:1}],reason:'x'}),/Cashea/);
  assert.throws(()=>prepareReturn({state,sale:{...sale,igtf:3},lines:[{lineIndex:0,qty:1}],reason:'x'}),/IGTF/);
});

test('refuses ambiguous duplicate lines, missing products and missing refund sequence',()=>{
  const {sale,state}=fixture();
  assert.throws(()=>prepareReturn({state,sale,lines:[{lineIndex:0,qty:1},{lineIndex:0,qty:1}],reason:'x'}),/No repita/);
  const prepared=prepareReturn({state,sale,lines:[{lineIndex:0,qty:1}],reason:'x'});
  delete state.products[0];
  assert.throws(()=>applyReturn(state,prepared,{returnNo:5}),/No se encontró el artículo/);
  const noCxc=fixture();noCxc.state.cxc[0].total=0;
  const refund=prepareReturn({state:noCxc.state,sale:noCxc.sale,lines:[{lineIndex:0,qty:1}],method:'efUSD',reason:'x'});
  assert.throws(()=>applyReturn(noCxc.state,refund,{returnNo:6}),/consecutivo independiente/);
});

test('revalidates CxC if its balance changes after preparing the return',()=>{
  const {sale,state}=fixture();
  const prepared=prepareReturn({state,sale,lines:[{lineIndex:0,qty:1}],method:'efUSD',reason:'Concurrent change'});
  state.cxc[0].paid=30;
  assert.throws(()=>applyReturn(state,prepared,{returnNo:7,refundNo:4}),/saldo CxC cambió/);
  assert.equal(state.products[0].stock,7);
  assert.equal(state.returns.length,0);
});

test('electronic VES refund methods preserve their currency and exchange-rate amount',()=>{
  const {sale,state}=fixture();
  state.cxc[0].total=0;
  const prepared=prepareReturn({state,sale,lines:[{lineIndex:1,qty:1}],method:'punto',reference:'POS-REF-77',reason:'Reembolso por punto'});
  assert.equal(prepared.refundCurrency,'VES');
  assert.equal(prepared.refundAmount,1160);
  const note=applyReturn(state,prepared,{returnNo:8,refundNo:5});
  assert.equal(note.refundCurrency,'VES');
  assert.equal(note.refundAmount,1160);
  assert.equal(state.movimientosCaja.length,0);
});
