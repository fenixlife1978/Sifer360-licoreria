
(function(){
'use strict';

/* ---------- utilidades ---------- */
const IVA=0.16, IGTF=0.03, KEY='pos-el-piston-v1';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const r2=n=>Math.round((n+Number.EPSILON)*100)/100;
const nf=n=>{const neg=n<0;const p=Math.abs(r2(n)).toFixed(2).split('.');return (neg?'-':'')+p[0].replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+p[1];};
const usd=n=>'US$ '+nf(n);
const bsf=n=>'Bs. '+nf(n);
const fq=q=>Number.isInteger(q)?String(q):String(r2(q)).replace('.',',');
const two=n=>String(n).padStart(2,'0');
const pad=(n,w=8)=>String(n).padStart(w,'0');
const fmtD=d=>{d=new Date(d);return two(d.getDate())+'/'+two(d.getMonth()+1)+'/'+d.getFullYear();};
const fmtT=d=>{d=new Date(d);return two(d.getHours())+':'+two(d.getMinutes());};
const fmtDT=ts=>{const d=new Date(ts);return fmtD(d)+' '+fmtT(d);};
const isoD=ts=>{const d=new Date(ts);return d.getFullYear()+'-'+two(d.getMonth()+1)+'-'+two(d.getDate());};
const parseIsoD=s=>{if(!s)return Date.now();const p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2],12,0,0).getTime();};
const sameDay=ts=>new Date(ts).toDateString()===new Date().toDateString();
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s==null?'':s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');
const pn=s=>{s=String(s==null?'':s).trim();if(!s)return 0;if(s.indexOf(',')>=0)s=s.replace(/\./g,'').replace(',','.');const n=parseFloat(s);return isFinite(n)&&n>0?n:0;};
const pnZero=s=>{s=String(s==null?'':s).trim();if(s==='')return null;if(s.indexOf(',')>=0)s=s.replace(/\./g,'').replace(',','.');const n=parseFloat(s);return isFinite(n)&&n>=0?n:null;};
const h=html=>{const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstElementChild;};

/* Generador automático de SKU compuesto: SKU-DEPT/CAT-SUB-00001 */
function abbrToken(str,len){
  const stop=['de','del','la','el','los','las','y','en','para','con','por','a'];
  const words=String(str||'GEN').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9\s]/g,' ').trim().split(/\s+/).filter(w=>w&&stop.indexOf(w.toLowerCase())<0);
  if(!words.length)return 'GEN';
  if(words.length>=2&&len>=4)return (words[0].slice(0,3)+'/'+words[1].slice(0,4));
  return words[0].slice(0,len||3);
}
function genAutoSku(dept,cat,subcat,seqNum){
  const p1=abbrToken(cat||'GEN',4);
  const p2=abbrToken(subcat||'GEN',3).replace('/','');
  const d1=abbrToken(dept||'GEN',3).replace('/','');
  const mid=p1.indexOf('/')>=0?p1:(d1+'/'+p1);
  return 'SKU-'+mid+'-'+p2+'-'+pad(seqNum||1,5);
}
function svgBarcode(text){
  const s=String(text||'SKU-00001');
  let bars='', x=6;
  for(let i=0;i<s.length;i++){
    const c=s.charCodeAt(i);
    const w1=(c%3)+1, g1=((c>>2)%2)+1, w2=((c>>3)%3)+1, g2=2;
    bars+='<rect x="'+x+'" y="2" width="'+w1+'" height="34" fill="#111"/>';
    x+=w1+g1;
    bars+='<rect x="'+x+'" y="2" width="'+w2+'" height="34" fill="#111"/>';
    x+=w2+g2;
  }
  bars+='<rect x="'+x+'" y="2" width="2" height="34" fill="#111"/>';
  return '<svg viewBox="0 0 '+(x+8)+' 38" preserveAspectRatio="none" aria-hidden="true">'+bars+'</svg>';
}

/* ---------- motivos de conteo y ajuste de inventario ---------- */
const MOTIVOS=[
  'Conteo físico periódico',
  'Diferencia de inventario / cuadre',
  'Merma / derrame / evaporación',
  'Producto dañado o averiado',
  'Producto vencido',
  'Error de despacho / facturación',
  'Error de recepción de compra',
  'Sobrante encontrado en almacén',
  'Muestra / consumo interno taller',
  'Hurto / extravío'
];

/* ---------- datos de ejemplo con Departamento, Categoría, Subcategoría, SKU, U.M., Costo e I.V.A. ---------- */
const UM_OPTIONS=[
  {id:'und',name:'Unidad (und)'},
  {id:'L',name:'Litro (L)'},
  {id:'gal',name:'Galón (gal)'},
  {id:'kg',name:'Kilogramo (kg)'},
  {id:'g',name:'Gramo (g)'},
  {id:'m',name:'Metro (m)'},
  {id:'par',name:'Par (par)'},
  {id:'jgo',name:'Juego / Kit (jgo)'},
  {id:'caja',name:'Caja (caja)'},
  {id:'pz',name:'Pieza (pz)'}
];
const TAX_OPTIONS=[
  {type:'G',rate:16,name:'Gravado 16 % (G)',tag:'16%',cls:''},
  {type:'R',rate:8,name:'Reducido 8 % (R)',tag:'8% Red.',cls:'red'},
  {type:'A',rate:31,name:'Adicional / Suntuario 31 % (A)',tag:'31% Adic.',cls:'adic'},
  {type:'E',rate:0,name:'Exento 0 % (E)',tag:'Exento (0%)',cls:'ex'},
  {type:'NS',rate:0,name:'No Sujeto 0 % (NS)',tag:'No Suj. (0%)',cls:'ex'}
];
function prodTax(p){
  return (p&&p.tax)?p.tax:{type:'G',rate:16,igtf:true,percRate:0,codeSeniat:'GRAV-16'};
}
function prodTaxRate(p){
  const t=prodTax(p);
  if(t.type==='E'||t.type==='NS')return 0;
  return typeof t.rate==='number'?t.rate:(parseFloat(t.rate)||16);
}
function prodTaxTag(p){
  const t=prodTax(p);
  if(t.type==='E')return 'Exento (0%)';
  if(t.type==='NS')return 'No Suj. (0%)';
  if(t.type==='R')return '8% Red.';
  if(t.type==='A')return '31% Adic.';
  const r=prodTaxRate(p);
  return r===0?'Exento (0%)':(fq(r)+'%');
}
function prodTaxCls(p){
  const t=prodTax(p);
  if(t.type==='E'||t.type==='NS'||t.rate===0)return 'ex';
  if(t.type==='R'||t.rate===8)return 'red';
  if(t.type==='A'||t.rate===31)return 'adic';
  return '';
}

let seedSeq=1;
const P=(code,desc,brand,dept,cat,subcat,price,stock,min,loc,unit,cost,taxType,taxRate)=>{
  const c=cost||r2(price*0.64);
  const mkCost=c>0?r2(((price-c)/c)*100):56.25;
  const mkSale=price>0?r2(((price-c)/price)*100):36.00;
  const seq=seedSeq++;
  const u=unit||'und';
  const tType=taxType||'G';
  const tRate=taxRate!==undefined?taxRate:(tType==='E'||tType==='NS'?0:16);
  return {
    code,
    sku:genAutoSku(dept,cat,subcat,seq),
    desc,brand,
    dept:dept||'Lubricantes y Fluidos',
    cat:cat||'Aceites de motor',
    subcat:subcat||'General',
    price,stock,min,loc,
    unit:u,
    cost:c,
    photo:'',
    pricing:{
      mode:'auto',
      markupCost:mkCost,
      markupSale:mkSale,
      gaps:[
        {name:'Detal / Mostrador',gapPct:0,markupCost:mkCost,price:price},
        {name:'Taller / Mecánico',gapPct:6,markupCost:r2(((price*0.94-c)/c)*100),price:r2(price*0.94)},
        {name:'Mayorista (≥ 6 und)',gapPct:12,markupCost:r2(((price*0.88-c)/c)*100),price:r2(price*0.88)},
        {name:'Distribuidor / Flota',gapPct:18,markupCost:r2(((price*0.82-c)/c)*100),price:r2(price*0.82)}
      ]
    },
    presentations:[
      {name:u==='L'?'Litro a granel':(u==='gal'?'Galón 4 L':'Unidad individual'),unit:u,factor:1,barcode:code,price:price},
      {name:'Caja / Empaque x 12',unit:'caja',factor:12,barcode:code+'C12',price:r2(price*12*0.90)}
    ],
    tax:{
      type:tType,
      rate:tRate,
      igtf:true,
      percRate:0,
      codeSeniat:tType==='E'?'EXENTO-0':(tType==='R'?'RED-08':(tType==='A'?'ADIC-31':'GRAV-16'))
    },
    assocSuppliers:[],
    isKit:false,
    kitItems:[]
  };
};

const SEED=[
 P('7501001','Aceite 20W-50 Mineral 1 L','Castrol GTX','Lubricantes y Fluidos','Aceites de motor','Mineral',5.20,48,12,'A-1','und',3.35,'G',16),
 P('7501002','Aceite 20W-50 Mineral Galón 4 L','Castrol GTX','Lubricantes y Fluidos','Aceites de motor','Mineral',19.50,14,6,'A-1','gal',12.60,'G',16),
 P('7501003','Aceite 10W-40 Semisintético 1 L','Mobil Super','Lubricantes y Fluidos','Aceites de motor','Semisintético',7.80,30,10,'A-2','und',5.05,'G',16),
 P('7501004','Aceite 5W-30 Sintético 1 L','Mobil 1','Lubricantes y Fluidos','Aceites de motor','Sintético',13.90,16,8,'A-2','und',9.10,'G',16),
 P('7501005','Aceite 10W-30 High Mileage 1 L','Valvoline','Lubricantes y Fluidos','Aceites de motor','Semisintético',7.40,22,8,'A-2','und',4.80,'G',16),
 P('7501006','Aceite Diésel 15W-40 Galón 3,78 L','Valvoline','Lubricantes y Fluidos','Aceites de motor','Diésel Pesado',24.80,9,5,'A-3','gal',16.20,'G',16),
 P('7501007','Aceite 10W-40 Semisintético 1 L','Shell Helix HX7','Lubricantes y Fluidos','Aceites de motor','Semisintético',7.60,25,10,'A-2','und',4.95,'G',16),
 P('7501008','Aceite 10W-40 Quartz 7000 1 L','Total','Lubricantes y Fluidos','Aceites de motor','Semisintético',7.50,3,8,'A-2','und',4.85,'G',16),
 P('7501009','Aceite 20W-50 a granel (por litro)','Genérico','Lubricantes y Fluidos','Aceites de motor','Granel',3.40,120,40,'A-0','L',2.10,'G',16),
 P('7510001','Aceite Moto 4T 20W-50 1 L','Motul 3000','Motocicletas','Moto','Aceite 4T',8.90,20,8,'M-1','und',5.80,'G',16),
 P('7510002','Aceite Moto 4T 20W-50 1 L','Mobil Racing','Motocicletas','Moto','Aceite 4T',7.10,26,10,'M-1','und',4.55,'G',16),
 P('7510003','Lubricante de Cadena 400 ml','Motul','Motocicletas','Moto','Mantenimiento Cadena',9.30,14,6,'M-2','und',6.00,'G',16),
 P('7510004','Pastillas de Freno Delanteras Moto','Bendix','Motocicletas','Moto','Frenos Moto',8.50,12,6,'M-3','jgo',5.40,'G',16),
 P('7502001','ATF Dexron III Automática 1 L','Castrol','Lubricantes y Fluidos','Transmisión y diferencial','Caja Automática (ATF)',8.20,18,6,'B-1','und',5.30,'G',16),
 P('7502002','Aceite Transmisión 80W-90 GL-5 1 L','Valvoline','Lubricantes y Fluidos','Transmisión y diferencial','Valvulina y Engranajes',6.90,21,8,'B-1','und',4.45,'G',16),
 P('7502003','Aceite Transmisión 75W-90 Sintético 1 L','Mobil','Lubricantes y Fluidos','Transmisión y diferencial','Valvulina y Engranajes',12.40,7,4,'B-1','und',8.05,'G',16),
 P('7502004','Líquido Hidráulico Dirección 1 L','Genérico','Lubricantes y Fluidos','Transmisión y diferencial','Dirección Hidráulica',4.60,15,6,'B-2','und',2.95,'G',16),
 P('7503001','Lubricante Multiuso 11 oz','WD-40','Lubricantes y Fluidos','Grasas y lubricantes','Aerosoles y Sprays',6.50,40,12,'C-1','und',4.20,'G',16),
 P('7503002','Grasa Multipropósito Litio NLGI-2 500 g','Genérico','Lubricantes y Fluidos','Grasas y lubricantes','Grasas Litio y Chasis',4.90,26,8,'C-1','und',3.10,'G',16),
 P('7503003','Grasa de Chasis Roja 1 kg','Valvoline','Lubricantes y Fluidos','Grasas y lubricantes','Grasas Litio y Chasis',7.20,11,5,'C-2','kg',4.65,'G',16),
 P('7503004','Limpia Frenos en Spray 500 ml','CRC','Lubricantes y Fluidos','Grasas y lubricantes','Aerosoles y Sprays',5.80,17,6,'C-3','und',3.75,'G',16),
 P('7503005','Silicón Lubricante en Spray 400 ml','Genérico','Lubricantes y Fluidos','Grasas y lubricantes','Aerosoles y Sprays',4.30,19,6,'C-3','und',2.75,'G',16),
 P('7504001','Filtro de Aceite PH3600','Fram','Filtros y Mantenimiento','Filtros','Filtro de Aceite',4.80,35,10,'D-1','und',3.00,'G',16),
 P('7504002','Filtro de Aceite W 712/75','Mann','Filtros y Mantenimiento','Filtros','Filtro de Aceite',7.90,12,5,'D-1','und',5.10,'G',16),
 P('7504003','Filtro de Aire CA9482','Fram','Filtros y Mantenimiento','Filtros','Filtro de Aire',9.60,10,4,'D-2','und',6.20,'G',16),
 P('7504004','Filtro de Gasolina G3727','Fram','Filtros y Mantenimiento','Filtros','Filtro de Combustible',5.40,2,6,'D-2','und',3.45,'G',16),
 P('7504005','Filtro de Cabina Carbón Activado','Bosch','Filtros y Mantenimiento','Filtros','Filtro de Cabina',11.50,8,4,'D-3','und',7.45,'G',16),
 P('7505001','Pastillas Delanteras Cerámicas','Bendix','Frenos y Suspensión','Frenos','Pastillas de Freno',24.00,9,4,'E-1','jgo',15.60,'G',16),
 P('7505002','Pastillas Traseras Semimetálicas','Bendix','Frenos y Suspensión','Frenos','Pastillas de Freno',19.00,7,4,'E-1','jgo',12.30,'G',16),
 P('7505003','Líquido de Frenos DOT 4 500 ml','Bosch','Frenos y Suspensión','Frenos','Líquido de Frenos',5.10,28,10,'E-2','und',3.30,'G',16),
 P('7505004','Disco de Freno Delantero Ventilado (par)','Brembo','Frenos y Suspensión','Frenos','Discos de Freno',58.00,0,2,'E-3','par',38.00,'G',16),
 P('7506001','Bujía Iridium','NGK','Eléctrico y Encendido','Encendido y eléctrico','Bujías',8.50,40,16,'F-1','und',5.50,'G',16),
 P('7506002','Bujía Estándar BKR5E','NGK','Eléctrico y Encendido','Encendido y eléctrico','Bujías',2.80,96,24,'F-1','und',1.75,'G',16),
 P('7506003','Batería 12V 45 Ah','Duncan','Eléctrico y Encendido','Encendido y eléctrico','Baterías',68.00,6,3,'F-3','und',46.00,'G',16),
 P('7506004','Juego de Cables de Bujía','Bosch','Eléctrico y Encendido','Encendido y eléctrico','Cables de Encendido',22.00,5,3,'F-2','jgo',14.20,'G',16),
 P('7507001','Refrigerante 50/50 Galón','Prestone','Lubricantes y Fluidos','Refrigerante y aditivos','Refrigerantes y Agua',9.80,18,6,'G-1','gal',6.35,'G',16),
 P('7507002','Limpia Inyectores 355 ml','STP','Lubricantes y Fluidos','Refrigerante y aditivos','Aditivos Motor y Combustible',5.60,24,8,'G-2','und',3.60,'G',16),
 P('7507003','Tratamiento Anti-fuga de Aceite 443 ml','STP','Lubricantes y Fluidos','Refrigerante y aditivos','Aditivos Motor y Combustible',6.20,13,5,'G-2','und',4.00,'G',16),
 P('7507004','Agua Destilada Galón','Genérico','Lubricantes y Fluidos','Refrigerante y aditivos','Refrigerantes y Agua',1.80,30,10,'G-3','gal',1.10,'E',0),
 P('7508001','Correa Serpentina 6PK1750','Gates','Filtros y Mantenimiento','Correas y accesorios','Correas de Motor',17.50,8,4,'H-1','und',11.30,'G',16),
 P('7508002','Kit de Correa de Tiempo','Gates','Filtros y Mantenimiento','Correas y accesorios','Correas de Motor',46.00,4,2,'H-1','jgo',30.00,'G',16),
 P('7509001','Escobillas Limpiaparabrisas 22" (par)','Bosch','Accesorios y Taller','Correas y accesorios','Limpiaparabrisas',9.00,15,6,'J-1','par',5.80,'G',16),
 P('7509002','Embudo Plástico para Aceite','Genérico','Accesorios y Taller','Correas y accesorios','Herramientas y Envases',1.50,22,6,'J-2','und',0.90,'G',16),
 P('7509003','Bandeja Recolectora de Aceite 15 L','Genérico','Accesorios y Taller','Correas y accesorios','Herramientas y Envases',6.80,9,3,'J-2','und',4.30,'G',16)
];

const METHODS=[
 {id:'efUSD',name:'Efectivo US$',cur:'USD'},
 {id:'zelle',name:'Zelle',cur:'USD'},
 {id:'cashea',name:'Cashea (BNPL)',cur:'USD',isCashea:true},
 {id:'efBs',name:'Efectivo Bs.',cur:'VES'},
 {id:'punto',name:'Punto de venta (débito / crédito)',cur:'VES'},
 {id:'biopago',name:'Biopago',cur:'VES'},
 {id:'pmovil',name:'Pago móvil',cur:'VES'},
 {id:'transf',name:'Transferencia Bs.',cur:'VES'}
];

/* ---------- estado ---------- */
let S=null, navigated=false, msgTimer=0, saved=false;
/* Borrador de Conteo de Inventario persistente entre filtros */
let draftConteo={};
const prod=code=>S.products.find(p=>p.code===code);

/* Registrar movimiento en Kardex */
function addKardex(ev){
  if(!S.kardex)S.kardex=[];
  S.kardex.push({
    id:S.kardex.length+1,
    ts:ev.ts||Date.now(),
    code:ev.code,
    type:ev.type,       /* 'INICIAL' | 'COMPRA' | 'VENTA' | 'CONTEO' | 'AJUSTE' | 'ANULACIÓN' */
    dir:ev.dir,         /* 'IN' | 'OUT' */
    doc:ev.doc||'-',
    party:ev.party||'',
    qty:r2(ev.qty),
    stockAfter:r2(ev.stockAfter),
    cost:r2(ev.cost),
    user:ev.user||(S.cfg?S.cfg.cajero:'Sistema')
  });
}

function seed(){
  const now=Date.now(), dayMs=86400000;
  S={
    cfg:{
      empresa:'Autopartes El Pistón, C.A.',rif:'J-40123456-8',dir:'Av. Intercomunal, Local 12',cajero:'Mariela G.',caja:'01',rate:480,ticketFont:'ibm',ticketSize:'12',ticketBold:false,
      fiscalTipo:'FORMA_LIBRE',contribEspecial:false,retencionHabilitadaConfirmada:false,retIvaPct:75,provEspecial:'',
      ctrlPrefix:'00-',ctrlNext:1043,ctrlRangoDesde:'00-00000001',ctrlRangoHasta:'00-00050000',
      imprentaRif:'J-31009988-4',imprentaAut:'SENIAT/DAF/2022/981',serialFiscal:'Z4A7719204'
    },
    products:SEED.map(p=>Object.assign({},p)),
    clients:[
      {name:'Consumidor final',rif:'V-00000000',tel:''},
      {name:'Taller Mecánico Los Hermanos, C.A.',rif:'J-30123456-7',tel:'0414-555-0141'},
      {name:'Transporte Orinoco, C.A.',rif:'J-29876543-1',tel:'0212-555-0198'},
      {name:'José Gregorio Pérez',rif:'V-12345678',tel:''},
      {name:'Moto Servicio Rápido',rif:'V-18765432',tel:'0424-555-0177'},
      {name:'Lubricentro La Troncal, C.A.',rif:'J-40765432-0',tel:'0412-555-0123'}
    ],
    suppliers:[
      {id:'PRV-01',name:'Distribuidora Nacional de Lubricantes, C.A.',rif:'J-30987654-2',tel:'0241-555-8810',cond:'30 días'},
      {id:'PRV-02',name:'Importadora de Filtros y Frenos El Tuy, C.A.',rif:'J-40223344-5',tel:'0212-555-4321',cond:'15 días'},
      {id:'PRV-03',name:'Baterías y Partes Eléctricas Oriente, C.A.',rif:'J-29112233-9',tel:'0281-555-9011',cond:'Contado'},
      {id:'PRV-04',name:'Suministros Motopartes Venezuela, C.A.',rif:'J-41009988-1',tel:'0251-555-7730',cond:'15 días'}
    ],
    sales:[],held:[],purchases:[],cxc:[],cxp:[],cortesZ:[],movimientosCaja:[],kardex:[],counts:[],
    lotesSudeban:[],retencionesIva:[],cambiosDivisas:[],casheaMovimientos:[],casheaLiquidaciones:[],documents:[],
    invoice:1043,purchaseSeq:203,countSeq:102,
    cart:[],sel:-1,cat:'Todas',query:'',catSel:null
  };
  S.client=S.clients[0];

  /* Calcular ventas semilla para reconstruir Kardex exacto */
  const seedSalesSpec=[
    [1038,8,12,0,[['7501001',1,0]],'pm'],
    [1039,9,5,4,[['7510002',1,0],['7510003',1,0]],'usd'],
    [1040,10,31,1,[['7501006',2,5],['7504002',2,5],['7505003',1,0]],'pv'],
    [1041,12,48,2,[['7502002',6,0],['7503003',2,0]],'bio'],
    [1042,16,20,0,[['7506001',4,0],['7507002',1,0]],'usd']
  ];
  const soldQty={};
  seedSalesSpec.forEach(sp=>sp[4].forEach(it=>{soldQty[it[0]]=(soldQty[it[0]]||0)+it[1];}));
  const purchSpec={
    '7501001':24,'7501002':8,'7504001':20,'7504002':10,'7505001':6
  };

  /* 1. Kardex Saldo Inicial para cada producto */
  S.products.forEach(p=>{
    const sold=soldQty[p.code]||0;
    const bought=purchSpec[p.code]||0;
    const iniStock=Math.max(0,r2(p.stock+sold-bought));
    addKardex({
      ts:now-7*dayMs,
      code:p.code,
      type:'INICIAL',
      dir:'IN',
      doc:'INI-2026',
      party:'Inventario inicial de apertura',
      qty:iniStock,
      stockAfter:iniStock,
      cost:p.cost,
      user:'Sistema'
    });
  });

  /* 2. Compras de ejemplo + entradas Kardex + CxP */
  const p1Ts=now-4*dayMs;
  const p1Lines=[
    {code:'7501001',desc:'Castrol GTX Aceite 20W-50 Mineral 1 L',qty:24,cost:3.35,sub:r2(24*3.35)},
    {code:'7501002',desc:'Castrol GTX Aceite 20W-50 Mineral Galón 4 L',qty:8,cost:12.60,sub:r2(8*12.60)}
  ];
  p1Lines.forEach(l=>{
    const p=prod(l.code),sold=soldQty[l.code]||0;
    addKardex({ts:p1Ts,code:l.code,type:'COMPRA',dir:'IN',doc:'COM-00000201',party:S.suppliers[0].name+' (Fac. Prov. F-88412)',qty:l.qty,stockAfter:r2(p.stock+sold),cost:l.cost,user:'Mariela G.'});
  });
  const p1Base=r2(p1Lines.reduce((a,x)=>a+x.sub,0)),p1Iva=r2(p1Base*IVA),p1Tot=r2(p1Base+p1Iva);
  S.purchases.push({
    no:201,docProv:'F-88412',ts:p1Ts,dueTs:p1Ts+15*dayMs,
    supplier:Object.assign({},S.suppliers[0]),
    cond:'Crédito',lines:p1Lines,base:p1Base,iva:p1Iva,total:p1Tot,rate:475,paid:80.00,void:false
  });
  S.cxp.push({
    id:'CXP-0001',purchaseNo:201,doc:'F-88412 (COM-00000201)',
    supplier:Object.assign({},S.suppliers[0]),
    concept:'Compra de lubricantes Castrol GTX',
    ts:p1Ts,dueTs:now+11*dayMs,total:p1Tot,paid:80.00,
    payments:[{ts:now-2*dayMs,method:'Transferencia Bs.',cur:'VES',amountBs:r2(80*475),amountUsd:80.00,ref:'TRF-992104',note:'Abono inicial factura F-88412'}]
  });

  const p2Ts=now-2*dayMs;
  const p2Lines=[
    {code:'7504001',desc:'Fram Filtro de Aceite PH3600',qty:20,cost:3.00,sub:60.00},
    {code:'7504002',desc:'Mann Filtro de Aceite W 712/75',qty:10,cost:5.10,sub:51.00},
    {code:'7505001',desc:'Bendix Pastillas Delanteras Cerámicas',qty:6,cost:15.60,sub:93.60}
  ];
  p2Lines.forEach(l=>{
    const p=prod(l.code),sold=soldQty[l.code]||0;
    addKardex({ts:p2Ts,code:l.code,type:'COMPRA',dir:'IN',doc:'COM-00000202',party:S.suppliers[1].name+' (Fac. Prov. B-10492)',qty:l.qty,stockAfter:r2(p.stock+sold),cost:l.cost,user:'Mariela G.'});
  });
  const p2Base=r2(p2Lines.reduce((a,x)=>a+x.sub,0)),p2Iva=r2(p2Base*IVA),p2Tot=r2(p2Base+p2Iva);
  S.purchases.push({
    no:202,docProv:'B-10492',ts:p2Ts,dueTs:now-1*dayMs,
    supplier:Object.assign({},S.suppliers[1]),
    cond:'Crédito',lines:p2Lines,base:p2Base,iva:p2Iva,total:p2Tot,rate:478,paid:0,void:false
  });
  S.cxp.push({
    id:'CXP-0002',purchaseNo:202,doc:'B-10492 (COM-00000202)',
    supplier:Object.assign({},S.suppliers[1]),
    concept:'Lote de filtros Fram/Mann y pastillas Bendix',
    ts:p2Ts,dueTs:now-1*dayMs,total:p2Tot,paid:0,payments:[]
  });

  /* 3. Ventas de ejemplo + salidas Kardex */
  const mk=(no,hh,mm,ci,items,how)=>{
    const d=new Date();d.setHours(hh,mm,0,0);
    const lines=items.map(it=>{
      const p=prod(it[0]),ds=it[2]||0,gross=r2(p.price*it[1]);
      addKardex({ts:d.getTime(),code:p.code,type:'VENTA',dir:'OUT',doc:'FAC-'+pad(no),party:S.clients[ci].name,qty:it[1],stockAfter:p.stock,cost:p.cost,user:'Mariela G.'});
      return{code:p.code,desc:p.brand+' '+p.desc,qty:it[1],price:p.price,disc:ds,net:r2(gross*(1-ds/100))};
    });
    const sub=r2(lines.reduce((a,l)=>a+r2(l.price*l.qty),0)),base=r2(lines.reduce((a,l)=>a+l.net,0));
    const iva=r2(base*IVA),total=r2(base+iva),rate=S.cfg.rate;
    let igtf=0,pays;
    if(how==='usd'){igtf=r2(total*IGTF);pays=[{id:'efUSD',name:'Efectivo US$',cur:'USD',amount:r2(total+igtf)}];}
    else if(how==='pv')pays=[{id:'punto',name:'Punto de venta (débito / crédito)',cur:'VES',amount:r2(total*rate)}];
    else if(how==='bio')pays=[{id:'biopago',name:'Biopago',cur:'VES',amount:r2(total*rate)}];
    else pays=[{id:'pmovil',name:'Pago móvil',cur:'VES',amount:r2(total*rate)}];
    const ctrlNo=(S.cfg.ctrlPrefix||'00-')+pad(no,8);
    S.sales.push({no,ctrlNo,docType:'01-FACTURA',transType:'01-REG',ts:d.getTime(),client:Object.assign({},S.clients[ci]),lines,sub,disc:r2(sub-base),base,baseG16:base,baseR8:0,baseA31:0,baseEx:0,iva,total,igtf,rate,pays,change:0,void:false});
  };
  seedSalesSpec.forEach(sp=>mk.apply(null,sp));

  /* 4. Cuentas por Cobrar (CxC) de ejemplo */
  S.cxc=[
    {
      id:'CXC-0001',saleNo:1031,doc:'FAC-00001031',
      client:Object.assign({},S.clients[1]),
      concept:'Suministro de aceites y filtros flota taller',
      ts:now-12*dayMs,dueTs:now-2*dayMs,
      total:145.00,paid:50.00,
      payments:[{ts:now-6*dayMs,method:'Pago móvil',cur:'VES',amountBs:r2(50*472),amountUsd:50.00,ref:'PM-441822',note:'Abono parcial cuenta taller'}]
    },
    {
      id:'CXC-0002',saleNo:1035,doc:'FAC-00001035',
      client:Object.assign({},S.clients[2]),
      concept:'6 Galones Diésel 15W-40 + Filtros pesados',
      ts:now-5*dayMs,dueTs:now+10*dayMs,
      total:218.40,paid:0,
      payments:[]
    },
    {
      id:'CXC-0003',saleNo:1036,doc:'FAC-00001036',
      client:Object.assign({},S.clients[5]),
      concept:'Caja Aceite 20W-50 y grasas de chasis',
      ts:now-8*dayMs,dueTs:now+7*dayMs,
      total:112.00,paid:112.00,
      payments:[{ts:now-1*dayMs,method:'Zelle',cur:'USD',amountBs:r2(112*480),amountUsd:112.00,ref:'ZELLE-88301',note:'Cancelación total factura'}]
    }
  ];

  /* 5. Historial de conteo de ejemplo */
  S.counts=[
    {
      id:'CNT-00000101',ts:now-3*dayMs,user:'Mariela G.',
      items:[{code:'7504004',desc:'Filtro de Gasolina G3727',prev:3,next:2,diff:-1,cost:3.45,reason:'Producto dañado o averiado'}]
    }
  ];

  /* 6. Conciliación de lotes bancarios SUDEBAN */
  S.lotesSudeban=[
    {
      id:'LOT-000142',banco:'Banco de Venezuela (BDV)',tid:'BDV-POS-0892',ts:now-4*3600000,
      tipo:'Biopago / Débito',totalBs:28450.00,comisionBs:426.75,netoBs:28023.25,ops:14,estado:'CONCILIADO',refLote:'LT-881290'
    },
    {
      id:'LOT-000143',banco:'Banesco Banco Universal',tid:'BAN-POS-3310',ts:now-2*3600000,
      tipo:'Punto de Venta (Débito/Crédito)',totalBs:19200.00,comisionBs:384.00,netoBs:18816.00,ops:9,estado:'CONCILIADO',refLote:'LT-441208'
    }
  ];

  /* 7. Comprobantes de Retención de IVA (SENIAT Sujeto Pasivo Especial) */
  S.retencionesIva=[
    {
      id:'20261000000041',ts:p1Ts+3600000,purchaseNo:201,docProv:'F-88412',ctrlProv:'00-00088192',
      supplier:Object.assign({},S.suppliers[0]),
      base:p1Base,iva:p1Iva,pct:75,retainedBs:r2(p1Iva*0.75*475),retainedUsd:r2(p1Iva*0.75),rate:475,periodo:'202610'
    },
    {
      id:'20261000000042',ts:p2Ts+3600000,purchaseNo:202,docProv:'B-10492',ctrlProv:'00-00010492',
      supplier:Object.assign({},S.suppliers[1]),
      base:p2Base,iva:p2Iva,pct:75,retainedBs:r2(p2Iva*0.75*478),retainedUsd:r2(p2Iva*0.75),rate:478,periodo:'202610'
    }
  ];

  /* 8. Registro y trazabilidad de Operaciones Cambiarias (Compra USD Efectivo y Zelle) */
  S.cambiosDivisas=[
    {
      id:'CAMB-0001',tipo:'ZELLE_PROV',ts:now-2*dayMs,
      vendedor:{nombre:'Carlos Eduardo Méndez',ci:'V-15.892.411',tel:'0414-234.56.78'},
      montoUsd:80.00,tasa:475.00,tasaBcv:475.00,montoBs:38000.00,
      medioBs:'Pago Móvil BDV',bancoOrigen:'Banco de Venezuela (BDV)',bancoDestino:'Banesco',refBs:'PM-88912304',
      destinoTipo:'PROV',destinoNombre:S.suppliers[0].name,
      destinatarioZelle:'pagos@distribuidoranolub.com',titularZelle:'Distribuidora Nacional Lubricantes LLC',
      confZelle:'CONF-ZEL-994821',cxpId:'CXP-0001',cxpDoc:'F-88412 (COM-00000201)',
      notas:'Compra de Zelle a persona natural para abonar factura de lubricantes Castrol GTX'
    },
    {
      id:'CAMB-0002',tipo:'USD_EFECTIVO',ts:now-1*dayMs,
      vendedor:{nombre:'María Alejandra Rivas',ci:'V-18.441.209',tel:'0424-911.22.33'},
      montoUsd:150.00,tasa:480.00,tasaBcv:480.00,montoBs:72000.00,
      medioBs:'Transferencia Bancaria',bancoOrigen:'Banesco Banco Universal',bancoDestino:'Banco Mercantil',refBs:'TRF-4410928',
      destinoTipo:'CAJA',destinoNombre:'Caja Principal de Divisas (Caja 01)',
      seriales:'MB-49102831A (1x100), LF-22910488B (1x50)',
      notas:'Compra de USD billetes físicos a persona natural para fondo de caja y vuelto en divisas'
    }
  ];

  S.client=S.clients[1];
  /* Asociar proveedores de ejemplo a los primeros productos */
  if(S.products[0]){
    S.products[0].assocSuppliers=[
      {supId:'PRV-01',rif:S.suppliers[0].rif,name:S.suppliers[0].name,barcode:'7501001-CAS',cost:3.35,leadDays:3,minOrder:12,notes:'Distribuidor oficial Castrol'}
    ];
  }
  if(S.products[22]){
    S.products[22].assocSuppliers=[
      {supId:'PRV-02',rif:S.suppliers[1].rif,name:S.suppliers[1].name,barcode:'FRM-PH3600',cost:3.00,leadDays:2,minOrder:24,notes:'Precio especial por caja de 24'}
    ];
  }
  /* CASHEA inicia sin operaciones ficticias; se registran solo cobros confirmados. */
  S.casheaMovimientos=[];

  S.cart=[{code:'7501001',qty:4,disc:5},{code:'7504001',qty:1,disc:0},{code:'7507004',qty:2,disc:0},{code:'7501009',qty:2.5,disc:0}];
  S.sel=0;
}

function stateSnapshot(){
  return {
    v:1,cfg:S.cfg,products:S.products,clients:S.clients,suppliers:S.suppliers,
    sales:S.sales,held:S.held,purchases:S.purchases,cxc:S.cxc,cxp:S.cxp,cortesZ:S.cortesZ||[],
    kardex:S.kardex,counts:S.counts,lotesSudeban:S.lotesSudeban,retencionesIva:S.retencionesIva,cambiosDivisas:S.cambiosDivisas,
    casheaMovimientos:S.casheaMovimientos||[],casheaLiquidaciones:S.casheaLiquidaciones||[],documents:S.documents||[],
    invoice:S.invoice,purchaseSeq:S.purchaseSeq,countSeq:S.countSeq
  };
}
function persistenceError(err){
  const detail=(err&&err.message)||String(err||'Error desconocido');
  console.error('[POS database]',detail);
  const node=$('#sbMsg')||$('#sbStatus')||$('.sp.msg');
  if(node){node.textContent='ERROR DE BASE DE DATOS: '+detail;node.classList.add('bad');}
}
/* ---------- Motor de Base de Datos Local SQLite (100% Offline) ---------- */
let sqliteDb = null;
let sqliteSqlInstance = null;
const SQLITE_IDB_NAME = 'elpiston_sqlite_db';
const SQLITE_IDB_STORE = 'files';
const SQLITE_IDB_KEY = 'elpiston.sqlite';

function openIndexedDb() {
  return new Promise(resolve => {
    if (!window.indexedDB) return resolve(null);
    try {
      const req = window.indexedDB.open(SQLITE_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SQLITE_IDB_STORE)) {
          db.createObjectStore(SQLITE_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGetSqlite() {
  try {
    const idb = await openIndexedDb();
    if (!idb) return null;
    return new Promise(resolve => {
      const tx = idb.transaction(SQLITE_IDB_STORE, 'readonly');
      const store = tx.objectStore(SQLITE_IDB_STORE);
      const req = store.get(SQLITE_IDB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbPutSqlite(bytes) {
  try {
    const idb = await openIndexedDb();
    if (!idb) return false;
    return new Promise(resolve => {
      const tx = idb.transaction(SQLITE_IDB_STORE, 'readwrite');
      const store = tx.objectStore(SQLITE_IDB_STORE);
      const req = store.put(bytes, SQLITE_IDB_KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

const posSqliteDriver = {
  isReady: false,
  mode: 'sqlite',
  async init() {
    window.__POS_DB_MODE = 'sqlite';
    if (window.posDesktop) {
      this.isReady = true;
      return true;
    }
    try {
      if (typeof window.initSqlJs !== 'function') {
        console.warn('sql.js no disponible globalmente; usando almacenamiento estructurado.');
        this.isReady = true;
        return true;
      }
      sqliteSqlInstance = await window.initSqlJs({
        locateFile: file => '/' + file
      });
      const savedBytes = await idbGetSqlite();
      if (savedBytes && savedBytes.byteLength > 0) {
        try {
          sqliteDb = new sqliteSqlInstance.Database(new Uint8Array(savedBytes));
        } catch (err) {
          console.warn('Error al abrir archivo SQLite existente, creando nueva base:', err);
          sqliteDb = new sqliteSqlInstance.Database();
        }
      } else {
        sqliteDb = new sqliteSqlInstance.Database();
      }
      this.initSchema();
      this.isReady = true;
      return true;
    } catch (e) {
      console.warn('Error inicializando motor SQLite WebAssembly:', e);
      this.isReady = true;
      return true;
    }
  },
  initSchema() {
    if (!sqliteDb) return;
    try {
      sqliteDb.run(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS app_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS fiscal_documents (
          id TEXT PRIMARY KEY,
          transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale','purchase')),
          transaction_id TEXT NOT NULL,
          file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          data_url TEXT NOT NULL,
          created_at TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_fiscal_documents_tx ON fiscal_documents(transaction_type, transaction_id);
        CREATE TABLE IF NOT EXISTS cashea_movimientos (
          id TEXT PRIMARY KEY,
          venta_no INTEGER NOT NULL,
          cliente_ci TEXT NOT NULL,
          cliente_nombre TEXT NOT NULL,
          aprobacion TEXT NOT NULL,
          total_usd REAL NOT NULL,
          inicial_usd REAL NOT NULL,
          financiado_usd REAL NOT NULL,
          cuotas_count INTEGER NOT NULL,
          cuota_usd REAL NOT NULL,
          estado TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      this.persist();
    } catch (e) {
      console.warn('Error ejecutando esquema SQLite:', e);
    }
  },
  async persist() {
    if (window.posDesktop || !sqliteDb) return;
    try {
      const bytes = sqliteDb.export();
      await idbPutSqlite(bytes);
    } catch (e) {
      console.error('Error persistiendo SQLite a IndexedDB:', e);
    }
  },
  async loadState() {
    if (window.posDesktop) {
      const res = await window.posDesktop.loadState();
      return res ? res.state : null;
    }
    if (sqliteDb) {
      try {
        const stmt = sqliteDb.prepare('SELECT payload FROM app_state WHERE id=1');
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          if (row && row.payload) return JSON.parse(row.payload);
        } else {
          stmt.free();
        }
      } catch (e) {
        console.warn('Error leyendo estado desde SQLite:', e);
      }
    }
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async saveState(state) {
    const payload = JSON.stringify(state);
    if (window.posDesktop) {
      try {
        await window.posDesktop.saveState(state);
      } catch (e) {
        persistenceError(e);
      }
      return { ok: true };
    }
    if (sqliteDb) {
      try {
        sqliteDb.run(`
          INSERT INTO app_state(id, payload, updated_at)
          VALUES (1, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP
        `, [payload]);
        await this.persist();
      } catch (e) {
        console.error('Error guardando en SQLite:', e);
      }
    }
    try {
      localStorage.setItem(KEY, payload);
    } catch (e) {
      persistenceError(e);
    }
    return { ok: true };
  },
  async listDocuments(filter = {}) {
    if (window.posDesktop) {
      return await window.posDesktop.listDocuments(filter);
    }
    if (sqliteDb) {
      try {
        const rows = [];
        let stmt;
        if (filter.transactionType && filter.transactionId) {
          stmt = sqliteDb.prepare('SELECT id, transaction_type AS transactionType, transaction_id AS transactionId, file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, sha256, created_at AS createdAt, notes FROM fiscal_documents WHERE transaction_type = ? AND transaction_id = ? ORDER BY created_at DESC');
          stmt.bind([filter.transactionType, String(filter.transactionId)]);
        } else {
          stmt = sqliteDb.prepare('SELECT id, transaction_type AS transactionType, transaction_id AS transactionId, file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, sha256, created_at AS createdAt, notes FROM fiscal_documents ORDER BY created_at DESC');
        }
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      } catch (e) {
        console.warn('Error consultando documentos en SQLite:', e);
      }
    }
    return S.documents || [];
  },
  async saveDocument(doc) {
    if (window.posDesktop) {
      return await window.posDesktop.saveDocument(doc);
    }
    if (sqliteDb) {
      try {
        sqliteDb.run(`
          INSERT OR REPLACE INTO fiscal_documents
          (id, transaction_type, transaction_id, file_name, mime_type, file_size, sha256, data_url, created_at, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          String(doc.id), doc.transactionType, String(doc.transactionId),
          String(doc.fileName || 'documento'), String(doc.mimeType || 'application/octet-stream'),
          Number(doc.fileSize || 0), String(doc.sha256 || ''), doc.dataUrl,
          String(doc.createdAt || new Date().toISOString()), String(doc.notes || '')
        ]);
        await this.persist();
      } catch (e) {
        console.error('Error guardando documento en SQLite:', e);
      }
    }
    return { ok: true };
  },
  async getDocument(id) {
    if (window.posDesktop) {
      return await window.posDesktop.getDocument(id);
    }
    if (sqliteDb) {
      try {
        const stmt = sqliteDb.prepare('SELECT id, transaction_type AS transactionType, transaction_id AS transactionId, file_name AS fileName, mime_type AS mimeType, file_size AS fileSize, sha256, data_url AS dataUrl, created_at AS createdAt, notes FROM fiscal_documents WHERE id = ?');
        stmt.bind([String(id)]);
        if (stmt.step()) {
          const obj = stmt.getAsObject();
          stmt.free();
          return obj;
        }
        stmt.free();
      } catch (e) {
        console.warn('Error obteniendo documento de SQLite:', e);
      }
    }
    return (S.documents || []).find(d => d.id === id) || null;
  },
  async deleteDocument(id) {
    if (window.posDesktop) {
      return await window.posDesktop.deleteDocument(id);
    }
    if (sqliteDb) {
      try {
        sqliteDb.run('DELETE FROM fiscal_documents WHERE id = ?', [String(id)]);
        await this.persist();
      } catch (e) {
        console.error('Error eliminando documento de SQLite:', e);
      }
    }
    return { ok: true };
  },
  exportSqlite() {
    if (sqliteDb) return sqliteDb.export();
    return null;
  },
  async importSqlite(bytes) {
    if (!sqliteSqlInstance) throw new Error('Instancia de SQLite no disponible para importar.');
    sqliteDb = new sqliteSqlInstance.Database(new Uint8Array(bytes));
    this.initSchema();
    await this.persist();
    const st = await this.loadState();
    if (st) localStorage.setItem(KEY, JSON.stringify(st));
    return st;
  }
};

let networkSyncTimer=null,networkSyncBusy=false,networkLastStatus='local';
let operationBaseline = null;
let operationCaptureBusy = false;
const OPERATION_COLLECTIONS = [
  ['sales','sale'], ['purchases','purchase'], ['cxc','receivable'], ['cxp','payable'],
  ['cortesZ','cash-close'], ['kardex','inventory-movement'], ['counts','inventory-count'],
  ['held','held-sale'], ['casheaMovimientos','cashea-operation'], ['casheaLiquidaciones','cashea-settlement'], ['cambiosDivisas','currency-movement'],
  ['retencionesIva','tax-retention'], ['retentions','tax-retention'], ['returns','return'], ['voids','void']
];
function operationIdentity(item,index){
  if(!item||typeof item!=='object')return String(index)+':'+JSON.stringify(item);
  const id=item.id??item.uuid??item.eventId??item.no??item.number??item.ctrlNo??item.code;
  return id===undefined?String(index)+':'+JSON.stringify(item):String(id);
}
function primeOperationBaseline(){
  const snap=stateSnapshot();
  operationBaseline={};
  for(const [key] of OPERATION_COLLECTIONS) operationBaseline[key]=new Set((Array.isArray(snap[key])?snap[key]:[]).map(operationIdentity));
}
async function captureNewOperations(){
  if(operationCaptureBusy||!window.posDesktop||typeof window.posDesktop.networkCreateOperation!=='function')return;
  if(!operationBaseline){primeOperationBaseline();return;}
  operationCaptureBusy=true;
  try{
    const snap=stateSnapshot();
    for(const [key,eventType] of OPERATION_COLLECTIONS){
      const items=Array.isArray(snap[key])?snap[key]:[];
      const seen=operationBaseline[key]||new Set();
      for(let i=0;i<items.length;i++){
        const item=items[i],identity=operationIdentity(item,i);
        if(seen.has(identity))continue;
        const entityId=String((item ? (item.id??item.uuid??item.eventId??item.no??item.number??item.ctrlNo??item.code) : undefined) ?? identity);
        await window.posDesktop.networkCreateOperation({
          eventType,entityType:key,entityId,occurredAt:(Number.isFinite(Number(item.ts))?new Date(Number(item.ts)):new Date(item.createdAt||Date.now())).toISOString(),
          payload:{record:item,sourceCollection:key,deviceCashbox:String(item.cashbox||snap.cfg?.caja||'01')}
        });
        seen.add(identity);
      }
      operationBaseline[key]=seen;
    }
  }catch(error){console.warn('No se pudo encolar una operación para sincronización:',error)}
  finally{operationCaptureBusy=false}
}
function mergeRemoteSnapshot(local,remote){
  if(!remote||typeof remote!=='object')return false;
  const merged={...local};
  for(const [key,value] of Object.entries(remote)){
    if(!Array.isArray(value)||!Array.isArray(local[key])){merged[key]=value;continue;}
    const map=new Map();
    const ident=(item)=>{if(!item||typeof item!=='object')return JSON.stringify(item);const id=item.id??item.uuid??item.eventId??item.no??item.number??item.code??item.sku;if(id===undefined)return JSON.stringify(item);return (['sales','cxc','cortesZ','openings','movements','returns','voids'].includes(key)?String(item.cashbox||'sin-caja')+':':'')+String(id)};
    for(const item of local[key])map.set(ident(item),item);
    for(const item of value)map.set(ident(item),item);
    merged[key]=[...map.values()];
  }
  let changed=false;
  for(const [key,value] of Object.entries(merged)){if(JSON.stringify(S[key])!==JSON.stringify(value)){S[key]=value;changed=true}}
  return changed;
}
async function networkSyncAttempt(){
  if(networkSyncBusy||!window.posDesktop||typeof window.posDesktop.networkSyncNow!=='function')return;
  networkSyncBusy=true;
  try{
    const local=stateSnapshot();
    const result=await window.posDesktop.networkSyncNow(local);
    if(result&&result.ok&&result.state){
      const changed=mergeRemoteSnapshot(local,result.state);
      networkLastStatus=result.role||'connected';
      if(changed)await posSqliteDriver.saveState(stateSnapshot());
      const status=$('#sbMsg');if(status)status.textContent=networkLastStatus==='server'?'Servidor LAN · sincronizado':networkLastStatus==='client'?'Cliente LAN · sincronizado':'Modo local';
    }else networkLastStatus='local';
  }catch(error){
    networkLastStatus='offline';
    const status=$('#sbMsg');if(status)status.textContent='Sin conexión al servidor · operaciones guardadas localmente; se reintentará automáticamente';
  }finally{networkSyncBusy=false}
}
window.SIFERNetworkSync=()=>networkSyncAttempt();
function scheduleNetworkSync(){
  if(networkSyncTimer)clearTimeout(networkSyncTimer);
  networkSyncTimer=setTimeout(()=>{networkSyncAttempt();},1800);
}
function save(){
  const state=stateSnapshot();
  posSqliteDriver.saveState(state).catch(e=>persistenceError(e));
  captureNewOperations();
  scheduleNetworkSync();
}
setInterval(()=>{if(window.posDesktop&&typeof window.posDesktop.networkSyncNow==='function')networkSyncAttempt()},20000);

function load(){
  try{
    const raw=window.__POS_BOOT_STATE!==undefined?(window.__POS_BOOT_STATE?JSON.stringify(window.__POS_BOOT_STATE):null):localStorage.getItem(KEY);if(!raw)return false;
    const d=JSON.parse(raw);
    if(!d||d.v!==1||!Array.isArray(d.products)||!d.cfg)return false;
    const seedMap={};SEED.forEach(sp=>{seedMap[sp.code]=sp;});
    S.cfg=Object.assign(S.cfg,d.cfg);
    S.cortesZ=Array.isArray(d.cortesZ)?d.cortesZ:[];
    const legacyCaja=String(S.cfg.caja||'01');
    (S.sales||[]).forEach(x=>{if(!x.cashbox)x.cashbox=legacyCaja;if(!x.cashier)x.cashier=x.user||S.cfg.cajero||'Cajero';});
    (S.cxc||[]).forEach(x=>{if(!x.cashbox)x.cashbox=legacyCaja;});
    /* Enriquecer productos guardados con SKU, U.M., motores de venta, presentaciones, impuestos, proveedores y kits */
    S.products=d.products.map((p,idx)=>{
      const sp=seedMap[p.code]||{};
      const dept=p.dept||sp.dept||'Lubricantes y Fluidos';
      const cat=p.cat||sp.cat||'Correas y accesorios';
      const subcat=p.subcat||sp.subcat||'General';
      const cost=p.cost||sp.cost||r2((p.price||1)*0.64);
      const price=p.price||sp.price||1;
      const mkCost=cost>0?r2(((price-cost)/cost)*100):56.25;
      const mkSale=price>0?r2(((price-cost)/price)*100):36.00;
      const u=p.unit||sp.unit||'und';
      const t=p.tax?Object.assign({type:'G',rate:16,igtf:true,percRate:0,codeSeniat:'GRAV-16'},p.tax):(sp.tax||{type:'G',rate:16,igtf:true,percRate:0,codeSeniat:'GRAV-16'});
      if(t.rate===undefined)t.rate=(t.type==='E'||t.type==='NS')?0:16;
      return Object.assign({
        sku:sp.sku||genAutoSku(dept,cat,subcat,idx+1),
        dept,cat,subcat,cost,
        unit:u,
        photo:sp.photo||'',
        pricing:sp.pricing||{
          mode:'auto',markupCost:mkCost,markupSale:mkSale,
          gaps:[
            {name:'Detal / Mostrador',gapPct:0,markupCost:mkCost,price:price},
            {name:'Taller / Mecánico',gapPct:6,markupCost:r2(((price*0.94-cost)/cost)*100),price:r2(price*0.94)},
            {name:'Mayorista (≥ 6 und)',gapPct:12,markupCost:r2(((price*0.88-cost)/cost)*100),price:r2(price*0.88)},
            {name:'Distribuidor / Flota',gapPct:18,markupCost:r2(((price*0.82-cost)/cost)*100),price:r2(price*0.82)}
          ]
        },
        presentations:sp.presentations||[
          {name:'Unidad individual',unit:u,factor:1,barcode:p.code,price:price}
        ],
        tax:t,
        assocSuppliers:sp.assocSuppliers||[],
        isKit:false,
        kitItems:[]
      },p,{unit:u,tax:t});
    });
    if(Array.isArray(d.clients)&&d.clients.length)S.clients=d.clients;
    if(Array.isArray(d.suppliers)&&d.suppliers.length)S.suppliers=d.suppliers;
    S.sales=Array.isArray(d.sales)?d.sales:S.sales;
    S.held=Array.isArray(d.held)?d.held:[];
    if(Array.isArray(d.purchases))S.purchases=d.purchases;
    if(Array.isArray(d.cxc))S.cxc=d.cxc;
    if(Array.isArray(d.cxp))S.cxp=d.cxp;
    if(Array.isArray(d.kardex)&&d.kardex.length)S.kardex=d.kardex;
    if(Array.isArray(d.counts))S.counts=d.counts;
    if(Array.isArray(d.lotesSudeban))S.lotesSudeban=d.lotesSudeban;
    if(Array.isArray(d.retencionesIva))S.retencionesIva=d.retencionesIva;
    if(Array.isArray(d.documents))S.documents=d.documents;
    else if(!S.documents)S.documents=[];
    if(Array.isArray(d.casheaMovimientos)){
      const demoCasheaSignatures=[
        {id:'CSH-MOV-0001',aprobacion:'CSH-782194',ventaNo:1040,clienteCi:'V-12345678',totalVenta:85,financiadoUsd:51},
        {id:'CSH-MOV-0002',aprobacion:'CSH-651032',ventaNo:1036,clienteCi:'V-18765432',totalVenta:120,financiadoUsd:72}
      ];
      S.casheaMovimientos=d.casheaMovimientos.filter(m=>!demoCasheaSignatures.some(demo=>
        m.id===demo.id&&m.aprobacion===demo.aprobacion&&Number(m.ventaNo)===demo.ventaNo&&m.clienteCi===demo.clienteCi&&Number(m.totalVenta)===demo.totalVenta&&Number(m.financiadoUsd)===demo.financiadoUsd
      ));
    } else if(!S.casheaMovimientos)S.casheaMovimientos=[];
    if(Array.isArray(d.casheaLiquidaciones))S.casheaLiquidaciones=d.casheaLiquidaciones;
    else if(!Array.isArray(S.casheaLiquidaciones))S.casheaLiquidaciones=[];
    if(Array.isArray(d.cambiosDivisas))S.cambiosDivisas=d.cambiosDivisas;
    else if(!S.cambiosDivisas)S.cambiosDivisas=[];
    if(!S.cfg.fiscalTipo)S.cfg.fiscalTipo='FORMA_LIBRE';
    if(S.cfg.contribEspecial===undefined)S.cfg.contribEspecial=false;
    if(S.cfg.retencionHabilitadaConfirmada===undefined)S.cfg.retencionHabilitadaConfirmada=false;
    if(!S.cfg.retIvaPct)S.cfg.retIvaPct=75;
    if(!S.cfg.provEspecial)S.cfg.provEspecial='';
    if(!S.cfg.ctrlPrefix)S.cfg.ctrlPrefix='00-';
    if(!S.cfg.ctrlNext)S.cfg.ctrlNext=1043;
    if(!S.cfg.ctrlRangoDesde)S.cfg.ctrlRangoDesde='00-00000001';
    if(!S.cfg.ctrlRangoHasta)S.cfg.ctrlRangoHasta='00-00050000';
    if(!S.cfg.imprentaRif)S.cfg.imprentaRif='J-31009988-4';
    if(!S.cfg.imprentaAut)S.cfg.imprentaAut='SENIAT/DAF/2022/981';
    if(!S.cfg.serialFiscal)S.cfg.serialFiscal='Z4A7719204';
    (S.sales||[]).forEach(s=>{
      if(!s.ctrlNo)s.ctrlNo=(S.cfg.ctrlPrefix||'00-')+pad(s.no,8);
      if(!s.docType)s.docType='01-FACTURA';
      if(!s.transType)s.transType=s.void?'03-ANUL':'01-REG';
      if(s.baseG16===undefined)s.baseG16=s.base||0;
    });
    (S.purchases||[]).forEach(p=>{
      if(!p.ctrlProv)p.ctrlProv='00-'+pad(p.no+4400,8);
    });
    S.invoice=d.invoice||S.invoice;
    S.purchaseSeq=d.purchaseSeq||S.purchaseSeq;
    S.countSeq=d.countSeq||S.countSeq;
    S.cart=[];S.sel=-1;S.client=S.clients[0];
    return true;
  }catch(e){return false;}
}
function init(){
  seed();
  saved=load();
  if(!Array.isArray(S.documents))S.documents=[];
  if(!Array.isArray(S.casheaMovimientos))S.casheaMovimientos=[];
}

/* ---------- cálculos ---------- */
function lineInfo(l){
  const p=prod(l.code);
  const gross=r2(p.price*l.qty);
  const net=r2(gross*(1-l.disc/100));
  const rate=prodTaxRate(p);
  const iva=r2(net*(rate/100));
  return{p,gross,net,rate,iva,total:r2(net+iva)};
}
function totals(){
  let sub=0,base=0,totIva=0,baseG16=0,baseR8=0,baseA31=0,baseEx=0;
  S.cart.forEach(l=>{
    const i=lineInfo(l);
    sub+=i.gross;
    base+=i.net;
    totIva+=i.iva;
    if(i.rate===16)baseG16+=i.net;
    else if(i.rate===8)baseR8+=i.net;
    else if(i.rate===31)baseA31+=i.net;
    else if(i.rate===0)baseEx+=i.net;
    else baseG16+=i.net;
  });
  sub=r2(sub);base=r2(base);totIva=r2(totIva);
  baseG16=r2(baseG16);baseR8=r2(baseR8);baseA31=r2(baseA31);baseEx=r2(baseEx);
  return{
    sub,
    disc:r2(sub-base),
    base,
    baseG16,
    baseR8,
    baseA31,
    baseEx,
    iva:totIva,
    total:r2(base+totIva)
  };
}
function calcPay(tot,rate,amts){
  let usdIgtfT=0,bsT=0,casheaT=0;
  METHODS.forEach(m=>{
    const a=amts[m.id]||0;
    if(m.id==='efUSD'||m.id==='zelle')usdIgtfT+=a;
    else if(m.id==='cashea')casheaT+=a;
    else bsT+=a;
  });
  const bsUsd=bsT/rate;
  const nonIgtfUsd=bsUsd+casheaT;
  const usdApplied=Math.min(usdIgtfT/(1+IGTF),Math.max(0,tot-nonIgtfUsd));
  const igtf=r2(usdApplied*IGTF);
  const paid=nonIgtfUsd+usdApplied;
  const pending=Math.max(0,tot-paid);
  const change=Math.max(0,usdIgtfT-usdApplied*(1+IGTF))+Math.max(0,nonIgtfUsd-tot);
  return{usdT:usdIgtfT+casheaT,usdIgtfT,casheaT,bsT,igtf,pending,change,due:r2(tot+igtf)};
}
function searchProducts(text,cat,dept,subcat){
  const toks=String(text||'').split(/\s+/).map(norm).filter(Boolean);
  return S.products.filter(p=>
    (!dept||dept==='Todos'||p.dept===dept)&&
    (!cat||cat==='Todas'||p.cat===cat)&&
    (!subcat||subcat==='Todas'||p.subcat===subcat)&&
    toks.every(t=>norm(p.code+(p.sku||'')+p.desc+p.brand+p.dept+p.cat+p.subcat+p.loc).indexOf(t)>=0)
  );
}
const filtered=()=>searchProducts(S.query,S.cat);
const stockCls=p=>p.stock<=0?'st-out':(p.stock<=p.min?'st-low':'');

/* ---------- mensajes ---------- */
function msg(text,kind){
  const el=$('#sbMsg');el.textContent=text;el.className='sp msg'+(kind==='bad'?' bad':'');
  clearTimeout(msgTimer);
  msgTimer=setTimeout(()=>{el.textContent='Listo. Los precios del catálogo no incluyen IVA.';el.className='sp msg';},8000);
}

/* ---------- iconos ---------- */
const IC={
 nueva:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>',
 buscar:'<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/>',
 ver:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 cliente:'<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3.5-6 7-6s7 2 7 6"/>',
 suspender:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
 recuperar:'<path d="M4 15v4h16v-4M12 4v10M8 8l4-4 4 4"/>',
 descuento:'<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M19 5L5 19"/>',
 quitar:'<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
 inventario:'<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>',
 conteo:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M16 14l2 2 4-4"/>',
 kardex:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11M14 9v11"/>',
 compras:'<path d="M3 4h3l2.5 10h9l2-7H7.5"/><circle cx="9.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/><path d="M13 3v6M10 6l3 3 3-3"/>',
 cxc:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h2M16 15h2"/>',
 cxp:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10M7 14h6"/><path d="M18 3l3 3-3 3"/>',
 ventas:'<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
 tasa:'<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
 seniat:'<path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/><path d="M9 12l2 2 4-4"/>',
 divisas:'<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
 cashea:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M7 15h3M14 15h3"/>',
 basedatos:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
 documentos:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
 usuarios:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-4 2.5-6 6.5-6s6.5 2 6.5 6M17 8a3 3 0 0 1 0 6M18 15c2.5.5 3.5 2 3.5 5"/>',
 cajas:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5M16 4v5M7 14h4M7 17h7"/>',
 pos:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M7 14h3M14 14h3M7 17h10"/>'
};
const ico=n=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+(IC[n]||'')+'</svg>';

/* ---------- ventanas (diálogos) ---------- */
let W=null;
function openWin(o){
  closeWin(true);
  const bd=h('<div class="backdrop"><div class="dlg" role="dialog" aria-modal="true" aria-label="'+esc(o.title)+'" style="--w:'+(o.w||520)+'px"><div class="dhead"><span class="ttl">'+esc(o.title)+'</span><button class="xbtn" data-close aria-label="Cerrar">&#10005;</button></div><div class="body"></div><div class="foot"><div class="foot-l"></div><div class="foot-r"></div></div></div></div>');
  const body=$('.body',bd);
  if(typeof o.body==='string')body.innerHTML=o.body;else body.appendChild(o.body);
  const footL=$('.foot-l',bd), footR=$('.foot-r',bd);
  if(o.footLeft){
    if(typeof o.footLeft==='string')footL.innerHTML=o.footLeft;else footL.appendChild(o.footLeft);
  }
  (o.foot||[]).forEach(b=>{
    const el=document.createElement('button');
    el.className='btn'+(b.primary?' primary':'');el.textContent=b.label;if(b.id)el.id=b.id;
    el.addEventListener('click',()=>{if(b.fn&&b.fn()===false)return;closeWin();});
    (b.left?footL:footR).appendChild(el);
  });
  bd.addEventListener('click',e=>{if(e.target.closest('[data-close]')){if(o.onClose)o.onClose();else closeWin();}});
  bd.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.tagName==='INPUT'&&(e.target.type==='text'||!e.target.type)){
      e.preventDefault();
      if(o.onEnter)o.onEnter(e);
      else{const p=$('.btn.primary',footR);if(p&&!p.disabled)p.click();}
    }
  });
  W={el:bd,prev:document.activeElement};
  $('#win').inert=true;
  document.body.appendChild(bd);
  if(o.onOpen)o.onOpen(bd);
  if(!bd.contains(document.activeElement)){const f=$('input:not([readonly]),select',body)||$('.btn.primary',footR);if(f)f.focus();}
}
function closeWin(silent){
  if(!W)return;
  W.el.remove();$('#win').inert=false;
  const prev=W.prev;W=null;
  if(!silent&&prev&&prev.focus&&document.contains(prev))prev.focus();
}
function ask(title,text,okLabel,fn){
  openWin({title,w:420,body:h('<p style="margin:0">'+esc(text)+'</p>'),foot:[{label:'Cancelar'},{label:okLabel,primary:true,fn:()=>{fn();}}]});
}

/* ---------- carrito ---------- */
function addItem(code,qty){
  const p=prod(code);if(!p)return false;
  const isDec = p.unit==='L'||p.unit==='kg'||p.unit==='g'||p.unit==='m';
  qty=isDec?Math.max(0.1,r2(qty)):Math.max(1,Math.round(qty));
  const ex=S.cart.find(l=>l.code===code),cur=ex?ex.qty:0,left=r2(p.stock-cur);
  if(qty>left+1e-9){
    msg(left<=0?'Sin existencia de "'+p.desc+'" ('+p.brand+').':'Existencia insuficiente de "'+p.desc+'": quedan '+fq(left)+'.','bad');
    return false;
  }
  if(ex){ex.qty=r2(ex.qty+qty);S.sel=S.cart.indexOf(ex);}
  else{S.cart.push({code,qty,disc:0});S.sel=S.cart.length-1;}
  renderCart();
  ensureVisible($('#cartBody tr.sel'),$('#cartWrap'));
  msg(p.brand+' '+p.desc+' agregado ('+fq(qty)+' '+(p.unit||'und')+').');
  return true;
}
function changeQty(i,d){
  const l=S.cart[i];if(!l)return;
  const p=prod(l.code),isDec=p.unit==='L'||p.unit==='kg'||p.unit==='g'||p.unit==='m',min=isDec?0.1:1,nq=r2(l.qty+d);
  if(nq<min){msg('La cantidad mínima es '+fq(min)+'. Use Quitar para eliminar el renglón.');return;}
  if(nq>p.stock+1e-9){msg('Existencia insuficiente: quedan '+fq(p.stock)+'.','bad');return;}
  l.qty=nq;renderCart();
}
function removeSel(){
  if(S.sel<0||!S.cart[S.sel]){msg('Seleccione un renglón para quitarlo.','bad');return;}
  const p=prod(S.cart[S.sel].code);
  S.cart.splice(S.sel,1);S.sel=Math.min(S.sel,S.cart.length-1);
  renderCart();msg('Renglón quitado: '+p.desc+'.');
}
function resetSale(){S.cart=[];S.sel=-1;S.client=S.clients[0];renderAll();$('#entry').focus();}
function newSale(){
  if(!S.cart.length){resetSale();return;}
  ask('Nueva venta','La venta actual tiene '+S.cart.length+' renglón(es). ¿Descartarla y empezar una nueva?','Descartar',()=>{resetSale();msg('Nueva venta lista.');});
}
function clearCart(){
  if(!S.cart.length)return;
  ask('Vaciar venta','Se quitarán todos los renglones de la venta actual.','Vaciar',()=>{S.cart=[];S.sel=-1;renderCart();});
}
function suspend(){
  if(!S.cart.length){msg('No hay una venta con renglones para suspender.','bad');return;}
  S.held.push({cart:S.cart,client:S.client,ts:Date.now()});
  S.cart=[];S.sel=-1;S.client=S.clients[0];save();renderAll();
  msg('Venta suspendida. Hay '+S.held.length+' en espera.');
}
function recoverDlg(){
  if(!S.held.length){msg('No hay ventas en espera.');return;}
  const busy=S.cart.length>0;
  const el=h('<div class="form"><div class="gridwrap heldwrap"><table class="grid"><thead><tr><th>Cliente</th><th class="r">Renglones</th><th class="r">Total US$</th><th>Hora</th><th></th></tr></thead><tbody></tbody></table></div>'+(busy?'<p class="hint">Cobre o suspenda la venta actual antes de recuperar otra.</p>':'')+'</div>');
  const tb=$('tbody',el);
  S.held.forEach((hd,i)=>{
    const sub=r2(hd.cart.reduce((a,l)=>a+r2(r2(prod(l.code).price*l.qty)*(1-l.disc/100)),0));
    const tr=h('<table><tbody><tr><td>'+esc(hd.client.name)+'</td><td class="r">'+hd.cart.length+'</td><td class="r">'+nf(r2(sub*(1+IVA)))+'</td><td>'+fmtT(new Date(hd.ts))+'</td><td class="c"><button class="btn mini2" '+(busy?'disabled':'')+'>Recuperar</button></td></tr></tbody></table>').querySelector('tr');
    $('button',tr).addEventListener('click',()=>{
      S.cart=hd.cart;S.client=hd.client;S.sel=0;S.held.splice(i,1);save();closeWin();renderAll();msg('Venta recuperada.');
    });
    tb.appendChild(tr);
  });
  openWin({title:'Ventas en espera',w:600,body:el,foot:[{label:'Cerrar',primary:true}]});
}
function discountDlg(){
  if(!S.cart.length){msg('No hay renglones para aplicar descuento.','bad');return;}
  const has=S.sel>=0&&S.cart[S.sel];
  const el=h('<div class="form"><div class="f"><label for="dPct">Descuento (%)</label><input class="fld r" id="dPct" inputmode="decimal" autocomplete="off" value="'+(has?fq(has.disc):'0')+'"></div><div class="radios"><label><input type="radio" name="dScope" value="one" '+(has?'checked':'disabled')+'> Solo el renglón seleccionado'+(has?': '+esc(prod(has.code).desc):'')+'</label><label><input type="radio" name="dScope" value="all" '+(has?'':'checked')+'> Todos los renglones</label></div><p class="hint">Escriba 0 para quitar el descuento. Máximo 100 %.</p></div>');
  openWin({title:'Descuento',w:440,body:el,foot:[{label:'Cancelar'},{label:'Aplicar',primary:true,fn:()=>{
    const v=Math.min(100,pn($('#dPct',el).value)),all=$('input[name=dScope]:checked',el).value==='all';
    if(all)S.cart.forEach(l=>{l.disc=v;});else has.disc=v;
    renderCart();msg(v?'Descuento de '+fq(v)+' % aplicado.':'Descuento quitado.');
  }}],onOpen:()=>{$('#dPct',el).select();}});
}

/* ---------- clientes ---------- */
function clientDlg(){
  let cur=S.client;
  const el=h('<div class="form"><div class="invbar"><label for="clQ">Buscar</label><input class="fld" id="clQ" placeholder="Nombre o RIF / C.I." autocomplete="off"></div><div class="gridwrap clwrap"><table class="grid"><thead><tr><th>Nombre o razón social</th><th>RIF / C.I.</th><th>Teléfono</th><th class="r">Saldo CxC US$</th></tr></thead><tbody id="clBody"></tbody></table></div><details class="newp"><summary>Cliente nuevo</summary><div class="newgrid"><div class="f"><label for="ncRif">RIF / C.I.</label><input class="fld" id="ncRif" autocomplete="off"></div><div class="f"><label for="ncName">Nombre o razón social</label><input class="fld" id="ncName" autocomplete="off"></div><div class="f"><label for="ncTel">Teléfono</label><input class="fld" id="ncTel" autocomplete="off"></div></div><button class="btn" id="ncAdd">Guardar y usar</button></details></div>');
  const clientDebt=rif=>r2((S.cxc||[]).filter(x=>x.client.rif===rif).reduce((a,x)=>a+Math.max(0,x.total-x.paid),0));
  const draw=()=>{
    const q=norm($('#clQ',el).value);
    const rows=S.clients.filter(c=>norm(c.name+c.rif).indexOf(q)>=0);
    $('#clBody',el).innerHTML=rows.length?rows.map(c=>{
      const debt=clientDebt(c.rif);
      return '<tr data-cl="'+S.clients.indexOf(c)+'" class="'+(c===cur?'sel':'')+'"><td>'+esc(c.name)+'</td><td class="mono">'+esc(c.rif)+'</td><td>'+esc(c.tel||'')+'</td><td class="r '+(debt>0?'st-low':'')+'">'+(debt>0?nf(debt):'0,00')+'</td></tr>';
    }).join(''):'<tr class="empty"><td colspan="4">Sin coincidencias.</td></tr>';
  };
  const use=()=>{S.client=cur;renderHeader();msg('Cliente: '+cur.name+'.');};
  el.addEventListener('input',e=>{if(e.target.id==='clQ')draw();});
  el.addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-cl]');
    if(tr){cur=S.clients[+tr.dataset.cl];draw();return;}
    if(e.target.id==='ncAdd'){
      const name=$('#ncName',el).value.trim(),rif=$('#ncRif',el).value.trim();
      if(!name||!rif){msg('Indique el RIF / C.I. y el nombre del cliente.','bad');return;}
      const c={name,rif,tel:$('#ncTel',el).value.trim()};
      S.clients.push(c);cur=c;save();use();closeWin();
    }
  });
  el.addEventListener('dblclick',e=>{if(e.target.closest('tr[data-cl]')){use();closeWin();}});
  openWin({title:'Seleccionar cliente',w:680,body:el,foot:[{label:'Ver CxC',left:true,fn:()=>{cxcDlg();return false;}},{label:'Cancelar'},{label:'Usar cliente',primary:true,fn:()=>{use();}}],onOpen:()=>{draw();}});
}

/* ---------- FICHA O TARJETA KARDEX PROFESIONAL ---------- */
function kardexDlg(initialCode){
  let code=initialCode||(S.catSel&&prod(S.catSel)?S.catSel:(S.cart[S.sel]?S.cart[S.sel].code:S.products[0].code));
  const el=h('<div class="form"><div class="invbar"><label for="kxProd">Producto</label><select class="fld" id="kxProd" style="flex:2"></select><label for="kxType">Movimiento</label><select class="fld" id="kxType" style="max-width:170px"><option value="ALL">Todos los movimientos</option><option value="IN">Solo Entradas (+)</option><option value="OUT">Solo Salidas (-)</option></select><label for="kxQ">Filtrar doc./tercero</label><input class="fld" id="kxQ" placeholder="Factura, compra, proveedor, motivo..." autocomplete="off"></div><div class="khead" id="kxHead"></div><div class="kpis" id="kxKpis"></div><div class="gridwrap tallwrap"><table class="grid" style="min-width:920px"><thead><tr><th>Fecha / Hora</th><th>Concepto</th><th>Documento</th><th>Proveedor / Cliente / Motivo</th><th class="r grp-in">Entrada</th><th class="r grp-out">Salida</th><th class="r grp-bal">Saldo Cant.</th><th class="r">Costo Unit.</th><th class="r">Monto Mov. US$</th><th class="r grp-bal">Saldo Valor US$</th><th>Operador</th></tr></thead><tbody id="kxBody"></tbody></table></div><p class="hint">Tarjeta Kardex bajo método de Costo Promedio Ponderado (CPP). Registra automáticamente compras, ventas, anulaciones y conteos físicos de inventario.</p></div>');

  const fillSelect=()=>{
    $('#kxProd',el).innerHTML=S.products.map(p=>'<option value="'+esc(p.code)+'"'+(p.code===code?' selected':'')+'>'+esc(p.code)+' — '+esc(p.desc)+' ('+esc(p.brand)+') ['+fq(p.stock)+' '+p.unit+']</option>').join('');
  };

  const draw=()=>{
    const p=prod(code)||S.products[0];
    if(!p)return;
    const margin=p.price>0?r2(((p.price-p.cost)/p.price)*100):0;
    const valUsd=r2(p.stock*p.cost);
    $('#kxHead',el).innerHTML=
      '<div><span>Código / SKU</span><b class="mono">'+esc(p.code)+'</b></div>'+
      '<div><span>Descripción y Marca</span><b>'+esc(p.desc)+' · '+esc(p.brand)+'</b></div>'+
      '<div><span>Departamento / Categoría</span><b>'+esc(p.dept)+' · '+esc(p.cat)+'</b></div>'+
      '<div><span>Subcategoría / Ubicación</span><b>'+esc(p.subcat)+' · Pasillo '+esc(p.loc)+'</b></div>';

    const movs=(S.kardex||[]).filter(k=>k.code===p.code).sort((a,b)=>a.ts-b.ts||a.id-b.id);
    const totalIn=r2(movs.filter(m=>m.dir==='IN').reduce((a,m)=>a+m.qty,0));
    const totalOut=r2(movs.filter(m=>m.dir==='OUT').reduce((a,m)=>a+m.qty,0));
    const stState=p.stock<=0?'AGOTADO':(p.stock<=p.min?'BAJO MÍNIMO':'NORMAL');
    const stClass=p.stock<=0?'bad':(p.stock<=p.min?'warn':'ok');

    $('#kxKpis',el).innerHTML=
      '<div class="kpi"><span>Existencia Actual ('+esc(p.unit)+')</span><b class="'+stClass+'">'+fq(p.stock)+' '+esc(p.unit)+'</b><small>Mínimo: '+fq(p.min)+' · Estado: '+stState+'</small></div>'+
      '<div class="kpi"><span>Movimientos Acumulados</span><b>+'+fq(totalIn)+' / -'+fq(totalOut)+'</b><small>'+movs.length+' registro(s) en ficha</small></div>'+
      '<div class="kpi"><span>Costo Promedio Unitario</span><b>'+usd(p.cost)+'</b><small>'+bsf(p.cost*S.cfg.rate)+'</small></div>'+
      '<div class="kpi"><span>Precio Venta (sin IVA)</span><b>'+usd(p.price)+'</b><small>Margen bruto: '+fq(margin)+' %</small></div>'+
      '<div class="kpi"><span>Valor Inventario (a Costo)</span><b class="ok">'+usd(valUsd)+'</b><small>'+bsf(valUsd*S.cfg.rate)+'</small></div>';

    const fDir=$('#kxType',el).value, q=norm($('#kxQ',el).value);
    const filteredMovs=movs.filter(m=>
      (fDir==='ALL'||m.dir===fDir)&&
      (!q||norm(m.doc+m.party+m.type+m.user).indexOf(q)>=0)
    );

    $('#kxBody',el).innerHTML=filteredMovs.length?filteredMovs.map(m=>{
      const isIn=m.dir==='IN';
      const movVal=r2(m.qty*m.cost);
      const balVal=r2(m.stockAfter*m.cost);
      return '<tr>'+
        '<td class="mono">'+fmtDT(m.ts)+'</td>'+
        '<td><b>'+esc(m.type)+'</b></td>'+
        '<td class="mono">'+esc(m.doc)+'</td>'+
        '<td>'+esc(m.party)+'</td>'+
        '<td class="r grp-in">'+(isIn?'+'+fq(m.qty):'')+'</td>'+
        '<td class="r grp-out">'+(!isIn?'-'+fq(m.qty):'')+'</td>'+
        '<td class="r grp-bal">'+fq(m.stockAfter)+' '+esc(p.unit)+'</td>'+
        '<td class="r">'+nf(m.cost)+'</td>'+
        '<td class="r">'+(isIn?'':'-')+nf(movVal)+'</td>'+
        '<td class="r grp-bal">'+nf(balVal)+'</td>'+
        '<td>'+esc(m.user||'')+'</td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="11">No hay movimientos en el Kardex que coincidan con el filtro.</td></tr>';
  };

  el.addEventListener('change',e=>{
    if(e.target.id==='kxProd'){code=e.target.value;draw();}
    if(e.target.id==='kxType')draw();
  });
  el.addEventListener('input',e=>{if(e.target.id==='kxQ')draw();});

  openWin({
    title:'Ficha / Tarjeta Kardex Profesional de Producto',
    w:1060,
    body:el,
    foot:[
      {label:'Ir a Conteo Físico',left:true,fn:()=>{conteoDlg(code);return false;}},
      {label:'Imprimir / Copiar Ficha',left:true,fn:()=>{showKardexTicket(prod(code));return false;}},
      {label:'Cerrar',primary:true}
    ],
    onEnter:()=>{},
    onOpen:()=>{fillSelect();draw();}
  });
}

function showKardexTicket(p){
  if(!p)return;
  const movs=(S.kardex||[]).filter(k=>k.code===p.code).sort((a,b)=>a.ts-b.ts||a.id-b.id);
  const L=[
    S.cfg.empresa.toUpperCase()+' - RIF '+S.cfg.rif,
    'FICHA KARDEX DE PRODUCTO (VALORIZADO CPP)',
    '------------------------------------------------------------------------',
    'Código:      '+p.code+'   | Ubicación: Pasillo '+p.loc,
    'Producto:    '+p.desc+' ('+p.brand+')',
    'Clasificac.: '+p.dept+' > '+p.cat+' > '+p.subcat,
    'Existencia:  '+fq(p.stock)+' '+p.unit+' (Mín: '+fq(p.min)+') | Costo Unit: '+usd(p.cost)+' | P.Venta: '+usd(p.price),
    'Valor Total: '+usd(r2(p.stock*p.cost))+' ('+bsf(r2(p.stock*p.cost*S.cfg.rate))+')',
    '------------------------------------------------------------------------',
    'FECHA/HORA        TIPO       DOCUMENTO     ENTRADA   SALIDA    SALDO   COSTO',
    '------------------------------------------------------------------------'
  ];
  movs.forEach(m=>{
    const dt=fmtDT(m.ts).padEnd(17,' ');
    const tp=String(m.type).slice(0,9).padEnd(10,' ');
    const dc=String(m.doc).slice(0,13).padEnd(13,' ');
    const en=(m.dir==='IN'?'+'+fq(m.qty):'').padStart(8,' ');
    const sa=(m.dir==='OUT'?'-'+fq(m.qty):'').padStart(8,' ');
    const sl=fq(m.stockAfter).padStart(8,' ');
    const cs=nf(m.cost).padStart(8,' ');
    L.push(dt+' '+tp+' '+dc+' '+en+' '+sa+' '+sl+' '+cs);
    if(m.party)L.push('   Ref/Motivo: '+m.party);
  });
  L.push('------------------------------------------------------------------------');
  const txt=L.join('\n');
  const el=h('<div class="form"><pre class="ticket" id="kxPre"></pre></div>');
  $('#kxPre',el).textContent=txt;
  openWin({title:'Comprobante Ficha Kardex — '+p.code,w:640,body:el,foot:[
    {label:'Copiar ficha',fn:()=>{
      try{navigator.clipboard.writeText(txt).then(()=>msg('Ficha Kardex copiada al portapapeles.'));}catch(e){}
      return false;
    }},
    {label:'Volver al Kardex',primary:true,fn:()=>{kardexDlg(p.code);return false;}}
  ]});
}

/* ---------- SECCIÓN DE CONTEO DE INVENTARIO CON FILTROS, MOTIVOS Y GUARDADO MASIVO ---------- */
function conteoDlg(focusCode){
  let fDept='Todos', fCat='Todas', fSub='Todas', fQ='', onlyMod=false, onlyLow=false;
  if(focusCode&&prod(focusCode)){
    const fp=prod(focusCode);
    fDept=fp.dept;fCat=fp.cat;fSub=fp.subcat;
  }

  const el=h('<div class="form">'+
    '<div class="fltgrid">'+
      '<div class="f"><label for="ctDept">Departamento</label><select class="fld" id="ctDept"></select></div>'+
      '<div class="f"><label for="ctCat">Categoría</label><select class="fld" id="ctCat"></select></div>'+
      '<div class="f"><label for="ctSub">Subcategoría</label><select class="fld" id="ctSub"></select></div>'+
      '<div class="f"><label for="ctQ">Buscar producto / código / pasillo</label><input class="fld" id="ctQ" placeholder="Ej: 20W-50, Fram, A-1..." autocomplete="off"></div>'+
    '</div>'+
    '<div class="invbar" style="justify-content:space-between">'+
      '<div class="row" style="gap:14px">'+
        '<label class="chk"><input type="checkbox" id="ctOnlyMod"> Solo productos con Nuevo Stock modificado</label>'+
        '<label class="chk"><input type="checkbox" id="ctOnlyLow"> Solo bajo mínimo / agotados</label>'+
      '</div>'+
      '<div class="row">'+
        '<button class="btn mini2" id="ctFillSys" title="Copia el stock actual del sistema en los productos filtrados sin conteo">Prellenar filtrados con stock sistema</button>'+
        '<button class="btn mini2" id="ctClearDraft">Limpiar cambios sin guardar</button>'+
      '</div>'+
    '</div>'+
    '<div class="kpis" id="ctKpis"></div>'+
    '<div class="gridwrap tallwrap"><table class="grid" style="min-width:960px">'+
      '<thead><tr>'+
        '<th style="width:76px">Código</th>'+
        '<th>Producto / Marca</th>'+
        '<th>Depto. · Categoría · Subcategoría</th>'+
        '<th class="c" style="width:52px">Pas.</th>'+
        '<th class="r" style="width:88px">Stock Sist.</th>'+
        '<th class="r" style="width:105px">Nuevo Stock</th>'+
        '<th class="r" style="width:82px">Diferencia</th>'+
        '<th class="r" style="width:92px">Dif. US$</th>'+
        '<th style="width:215px">Motivo del Nuevo Stock</th>'+
        '<th class="c" style="width:62px">Kardex</th>'+
      '</tr></thead>'+
      '<tbody id="ctBody"></tbody>'+
    '</table></div>'+
    '<p class="hint">Puede filtrar por departamento, categoría y subcategoría; los cambios de <b>Nuevo Stock</b> y su <b>Motivo</b> permanecen en memoria hasta que pulse <b>Guardar todos los cambios de forma masiva</b> al finalizar.</p>'+
  '</div>');

  const syncSelectors=()=>{
    const depts=['Todos'].concat(Array.from(new Set(S.products.map(p=>p.dept))));
    if(depts.indexOf(fDept)<0)fDept='Todos';
    $('#ctDept',el).innerHTML=depts.map(d=>'<option'+(d===fDept?' selected':'')+'>'+esc(d)+'</option>').join('');

    const catsPool=S.products.filter(p=>fDept==='Todos'||p.dept===fDept);
    const cats=['Todas'].concat(Array.from(new Set(catsPool.map(p=>p.cat))));
    if(cats.indexOf(fCat)<0)fCat='Todas';
    $('#ctCat',el).innerHTML=cats.map(c=>'<option'+(c===fCat?' selected':'')+'>'+esc(c)+'</option>').join('');

    const subsPool=catsPool.filter(p=>fCat==='Todas'||p.cat===fCat);
    const subs=['Todas'].concat(Array.from(new Set(subsPool.map(p=>p.subcat))));
    if(subs.indexOf(fSub)<0)fSub='Todas';
    $('#ctSub',el).innerHTML=subs.map(s=>'<option'+(s===fSub?' selected':'')+'>'+esc(s)+'</option>').join('');
  };

  const getRows=()=>{
    return searchProducts(fQ,fCat,fDept,fSub).filter(p=>{
      const d=draftConteo[p.code];
      const isMod=d&&d.newStock!==null&&d.newStock!==undefined&&Math.abs(d.newStock-p.stock)>1e-9;
      if(onlyMod&&!isMod)return false;
      if(onlyLow&&p.stock>p.min)return false;
      return true;
    });
  };

  const updateSummary=()=>{
    const modEntries=Object.keys(draftConteo).map(c=>{
      const p=prod(c),d=draftConteo[c];
      if(!p||!d||d.newStock===null||d.newStock===undefined)return null;
      const diff=r2(d.newStock-p.stock);
      if(Math.abs(diff)<1e-9)return null;
      return{p,d,diff,val:r2(diff*p.cost)};
    }).filter(Boolean);

    const pos=modEntries.filter(x=>x.diff>0), neg=modEntries.filter(x=>x.diff<0);
    const posVal=r2(pos.reduce((a,x)=>a+x.val,0)), negVal=r2(neg.reduce((a,x)=>a+x.val,0)), netVal=r2(posVal+negVal);
    $('#ctKpis',el).innerHTML=
      '<div class="kpi"><span>Productos en Vista</span><b>'+getRows().length+' de '+S.products.length+'</b><small>Filtrados por clasificación</small></div>'+
      '<div class="kpi"><span>Pendientes por Guardar</span><b class="'+(modEntries.length?'warn':'')+'">'+modEntries.length+' producto(s)</b><small>Con diferencia de stock</small></div>'+
      '<div class="kpi"><span>Sobrantes (+)</span><b class="ok">+'+pos.length+' reng. ('+usd(posVal)+')</b><small>Entradas por ajuste</small></div>'+
      '<div class="kpi"><span>Faltantes / Mermas (−)</span><b class="'+(neg.length?'bad':'')+'">'+neg.length+' reng. ('+usd(negVal)+')</b><small>Salidas por ajuste</small></div>'+
      '<div class="kpi"><span>Impacto Neto Inventario</span><b class="'+(netVal<0?'bad':(netVal>0?'ok':''))+'">'+(netVal>0?'+':'')+usd(netVal)+'</b><small>'+bsf(netVal*S.cfg.rate)+'</small></div>';

    const btnSave=$('#btnBulkSave');
    if(btnSave){
      btnSave.textContent='Guardar todos los cambios ('+modEntries.length+')';
      btnSave.disabled=modEntries.length===0;
    }
    renderStatus();
  };

  const drawTable=()=>{
    const list=getRows();
    $('#ctBody',el).innerHTML=list.length?list.map(p=>{
      const d=draftConteo[p.code]||{newStock:null,reason:MOTIVOS[0]};
      const hasVal=d.newStock!==null&&d.newStock!==undefined;
      const diff=hasVal?r2(d.newStock-p.stock):0;
      const isMod=hasVal&&Math.abs(diff)>1e-9;
      const diffVal=r2(diff*p.cost);
      const diffCls=diff>0?'st-ok':(diff<0?'st-out':'dim');
      const opts=MOTIVOS.map(m=>'<option value="'+esc(m)+'"'+(m===(d.reason||MOTIVOS[0])?' selected':'')+'>'+esc(m)+'</option>').join('');
      return '<tr data-code="'+esc(p.code)+'" class="'+(isMod?'rowmod':(p.stock<=0?'rowout':(p.stock<=p.min?'rowlow':'')))+'">'+
        '<td class="mono">'+esc(p.code)+'</td>'+
        '<td><div class="desc">'+esc(p.desc)+'</div><div class="sub">'+esc(p.brand)+' · Costo '+usd(p.cost)+'</div></td>'+
        '<td><div>'+esc(p.dept)+'</div><div class="sub">'+esc(p.cat)+' &rsaquo; '+esc(p.subcat)+'</div></td>'+
        '<td class="c">'+esc(p.loc)+'</td>'+
        '<td class="r '+stockCls(p)+'">'+fq(p.stock)+' '+esc(p.unit)+'</td>'+
        '<td class="r"><input class="fld cell r" data-ct-stock="'+esc(p.code)+'" value="'+(hasVal?fq(d.newStock):'')+'" placeholder="'+fq(p.stock)+'" inputmode="decimal" aria-label="Nuevo stock de '+esc(p.desc)+'"></td>'+
        '<td class="r '+diffCls+'" data-ct-diff="'+esc(p.code)+'">'+(hasVal?(diff>0?'+'+fq(diff):fq(diff)):'—')+'</td>'+
        '<td class="r '+diffCls+'" data-ct-val="'+esc(p.code)+'">'+(hasVal&& isMod?(diffVal>0?'+':'')+nf(diffVal):'0,00')+'</td>'+
        '<td><select class="fld cell-wide" data-ct-reason="'+esc(p.code)+'" aria-label="Motivo para '+esc(p.desc)+'">'+opts+'</select></td>'+
        '<td class="c"><button class="btn mini2" data-ct-kx="'+esc(p.code)+'" title="Ver Ficha Kardex">Ficha</button></td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="10">No hay productos que coincidan con los filtros seleccionados.</td></tr>';
    updateSummary();
  };

  el.addEventListener('change',e=>{
    const t=e.target;
    if(t.id==='ctDept'){fDept=t.value;fCat='Todas';fSub='Todas';syncSelectors();drawTable();return;}
    if(t.id==='ctCat'){fCat=t.value;fSub='Todas';syncSelectors();drawTable();return;}
    if(t.id==='ctSub'){fSub=t.value;drawTable();return;}
    if(t.id==='ctOnlyMod'){onlyMod=t.checked;drawTable();return;}
    if(t.id==='ctOnlyLow'){onlyLow=t.checked;drawTable();return;}
    if(t.dataset.ctReason){
      const code=t.dataset.ctReason;
      draftConteo[code]=draftConteo[code]||{newStock:null,reason:MOTIVOS[0]};
      draftConteo[code].reason=t.value;
      updateSummary();
    }
  });

  el.addEventListener('input',e=>{
    const t=e.target;
    if(t.id==='ctQ'){fQ=t.value;drawTable();return;}
    if(t.dataset.ctStock){
      const code=t.dataset.ctStock, p=prod(code);
      if(!p)return;
      const val=pnZero(t.value);
      const curReason=($('select[data-ct-reason="'+code+'"]',el)||{}).value||MOTIVOS[0];
      if(val===null){
        delete draftConteo[code];
      }else{
        const cleanVal=p.unit==='L'?r2(val):Math.round(val);
        draftConteo[code]={newStock:cleanVal,reason:curReason};
      }
      const d=draftConteo[code], hasVal=d&&d.newStock!==null&&d.newStock!==undefined;
      const diff=hasVal?r2(d.newStock-p.stock):0, isMod=hasVal&&Math.abs(diff)>1e-9;
      const diffVal=r2(diff*p.cost);
      const tr=t.closest('tr');
      if(tr)tr.className=isMod?'rowmod':(p.stock<=0?'rowout':(p.stock<=p.min?'rowlow':''));
      const tdDiff=$('[data-ct-diff="'+code+'"]',el), tdVal=$('[data-ct-val="'+code+'"]',el);
      const cls='r '+(diff>0?'st-ok':(diff<0?'st-out':'dim'));
      if(tdDiff){tdDiff.className=cls;tdDiff.textContent=hasVal?(diff>0?'+'+fq(diff):fq(diff)):'—';}
      if(tdVal){tdVal.className=cls;tdVal.textContent=hasVal&&isMod?(diffVal>0?'+':'')+nf(diffVal):'0,00';}
      updateSummary();
    }
  });

  el.addEventListener('click',e=>{
    const kxBtn=e.target.closest('[data-ct-kx]');
    if(kxBtn){kardexDlg(kxBtn.dataset.ctKx);return;}
    if(e.target.id==='ctFillSys'){
      getRows().forEach(p=>{
        if(!draftConteo[p.code]||draftConteo[p.code].newStock===null){
          draftConteo[p.code]={newStock:p.stock,reason:MOTIVOS[0]};
        }
      });
      drawTable();
      msg('Se prellenaron los productos filtrados con su stock actual.');
    }
    if(e.target.id==='ctClearDraft'){
      draftConteo={};onlyMod=false;$('#ctOnlyMod',el).checked=false;
      drawTable();
      msg('Borrador de conteo limpiado.');
    }
  });

  const saveBulk=()=>{
    const modEntries=Object.keys(draftConteo).map(c=>{
      const p=prod(c),d=draftConteo[c];
      if(!p||!d||d.newStock===null||d.newStock===undefined)return null;
      const diff=r2(d.newStock-p.stock);
      if(Math.abs(diff)<1e-9)return null;
      return{p,d,diff};
    }).filter(Boolean);

    if(!modEntries.length){
      msg('No hay diferencias de stock pendientes por guardar.','bad');
      return false;
    }
    const docId='CNT-'+pad(S.countSeq++,8);
    const ts=Date.now();
    const auditItems=[];
    modEntries.forEach(item=>{
      const p=item.p, prev=p.stock, next=item.d.newStock, diff=item.diff, reason=item.d.reason||MOTIVOS[0];
      p.stock=next;
      addKardex({
        ts,
        code:p.code,
        type:'CONTEO',
        dir:diff>0?'IN':'OUT',
        doc:docId,
        party:'Motivo: '+reason+' (Antes: '+fq(prev)+' → Nuevo: '+fq(next)+')',
        qty:Math.abs(diff),
        stockAfter:next,
        cost:p.cost,
        user:S.cfg.cajero
      });
      auditItems.push({code:p.code,desc:p.desc,prev,next,diff,cost:p.cost,reason});
    });
    S.counts.push({id:docId,ts,user:S.cfg.cajero,items:auditItems});
    draftConteo={};
    save();renderAll();
    msg('Conteo masivo '+docId+' guardado con éxito ('+auditItems.length+' productos actualizados en inventario y Kardex).');
    return true;
  };

  openWin({
    title:'Conteo Físico de Inventario y Ajuste Masivo',
    w:1080,
    body:el,
    foot:[
      {label:'Historial de conteos ('+(S.counts||[]).length+')',left:true,fn:()=>{countsHistoryDlg();return false;}},
      {label:'Ir a Inventario (F8)',left:true,fn:()=>{inventoryDlg();return false;}},
      {label:'Cerrar'},
      {id:'btnBulkSave',label:'Guardar todos los cambios (0)',primary:true,fn:saveBulk}
    ],
    onEnter:()=>{},
    onOpen:()=>{syncSelectors();drawTable();}
  });
}

function countsHistoryDlg(){
  const list=(S.counts||[]).slice().reverse();
  const el=h('<div class="form"><div class="gridwrap tallwrap"><table class="grid"><thead><tr><th>Documento</th><th>Fecha / Hora</th><th>Operador</th><th>Productos Ajustados</th></tr></thead><tbody>'+
    (list.length?list.map(c=>'<tr><td class="mono"><b>'+esc(c.id)+'</b></td><td>'+fmtDT(c.ts)+'</td><td>'+esc(c.user)+'</td><td>'+c.items.map(i=>'<div><b>'+esc(i.code)+' '+esc(i.desc)+'</b>: '+fq(i.prev)+' &rarr; '+fq(i.next)+' ('+(i.diff>0?'+'+fq(i.diff):fq(i.diff))+') · <span class="dim">'+esc(i.reason)+'</span></div>').join('')+'</td></tr>').join(''):'<tr class="empty"><td colspan="4">Aún no se han guardado lotes de conteo.</td></tr>')+
  '</tbody></table></div></div>');
  openWin({title:'Historial de Conteos Masivos de Inventario',w:840,body:el,foot:[
    {label:'Volver al Conteo',primary:true,fn:()=>{conteoDlg();return false;}}
  ]});
}

/* ---------- GENERADOR DE ETIQUETAS / HABLADOR DE SKU (CON O SIN PRECIO US$, SIN BS.) ---------- */
function labelGeneratorDlg(initialCode){
  let code=initialCode||(S.catSel&&prod(S.catSel)?S.catSel:S.products[0].code);
  let showPrice=true, fmt='hablador', tierIdx=0, incIva=false, copies=2;

  const el=h('<div class="form">'+
    '<div class="fltgrid">'+
      '<div class="f" style="grid-column:span 2"><label for="lbProd">Producto</label><select class="fld" id="lbProd"></select></div>'+
      '<div class="f"><label for="lbFmt">Formato de diseño</label><select class="fld" id="lbFmt"><option value="hablador">Hablador de mostrador / estante</option><option value="etiqueta">Etiqueta adhesiva de SKU</option></select></div>'+
      '<div class="f"><label for="lbCopies">Copias en vista</label><select class="fld" id="lbCopies"><option value="1">1 unidad</option><option value="2" selected>2 unidades</option><option value="4">4 unidades</option><option value="6">6 unidades</option></select></div>'+
      '<div class="f"><label for="lbTier">Escala de precio US$</label><select class="fld" id="lbTier"><option value="0">Detal / Mostrador</option><option value="1">Taller / Mecánico</option><option value="2">Mayorista</option><option value="3">Distribuidor</option></select></div>'+
      '<div class="f"><label>Opciones de precio (Solo US$)</label>'+
        '<div class="row" style="margin-top:3px"><label class="chk"><input type="checkbox" id="lbShowP" checked> Mostrar precio US$</label><label class="chk"><input type="checkbox" id="lbIva"> Con IVA</label></div>'+
      '</div>'+
    '</div>'+
    '<div class="hablador-wrap" id="lbPreview"></div>'+
    '<p class="hint">El hablador/etiqueta muestra el <b>SKU automático compuesto</b> con su código de barras y, opcionalmente, el precio expresado únicamente en <b>US$</b> (sin conversión a Bs.).</p>'+
  '</div>');

  const fillProds=()=>{
    $('#lbProd',el).innerHTML=S.products.map(p=>'<option value="'+esc(p.code)+'"'+(p.code===code?' selected':'')+'>'+esc(p.sku||p.code)+' — '+esc(p.desc)+' ('+esc(p.brand)+')</option>').join('');
  };

  const draw=()=>{
    const p=prod(code)||S.products[0];if(!p)return;
    const sku=p.sku||genAutoSku(p.dept,p.cat,p.subcat,S.products.indexOf(p)+1);
    const gaps=(p.pricing&&p.pricing.gaps)||[];
    const baseP=(gaps[tierIdx]&&gaps[tierIdx].price)||p.price;
    const taxRate=(p.tax&&p.tax.type!=='E'&&p.tax.type!=='NS')?(p.tax.rate||16)/100:0;
    const finalUsd=incIva?r2(baseP*(1+taxRate)):baseP;
    const tierName=gaps[tierIdx]?gaps[tierIdx].name:'PRECIO';

    let cards='';
    for(let i=0;i<copies;i++){
      cards+=
        '<div class="hablador '+(fmt==='hablador'?'shelf':'')+'">'+
          '<div class="hab-top"><span>'+esc(S.cfg.empresa)+'</span><span>PASILLO '+esc(p.loc)+'</span></div>'+
          '<div style="display:flex;gap:8px;align-items:center">'+
            (p.photo?'<img src="'+esc(p.photo)+'" alt="" style="width:46px;height:46px;object-fit:contain;border:1px solid #ccc">':'')+
            '<div style="flex:1;min-width:0">'+
              '<div class="hab-desc">'+esc(p.desc)+'</div>'+
              '<div class="hab-meta"><b>'+esc(p.brand)+'</b> · '+esc(p.cat)+' &rsaquo; '+esc(p.subcat)+'</div>'+
            '</div>'+
          '</div>'+
          (showPrice?
            '<div class="hab-price-box">'+
              '<span>'+esc(tierName.toUpperCase())+' '+(incIva?'(IVA INCL.)':'(SIN IVA)')+'</span>'+
              '<b>US$ '+nf(finalUsd)+'</b>'+
            '</div>':'')+
          '<div class="hab-bc">'+
            svgBarcode(sku)+
            '<div class="hab-sku">'+esc(sku)+'</div>'+
            '<div style="font-size:10px;color:#555">EAN/REF: '+esc(p.code)+' · UND: '+esc(p.unit.toUpperCase())+'</div>'+
          '</div>'+
        '</div>';
    }
    $('#lbPreview',el).innerHTML=cards;
  };

  el.addEventListener('change',e=>{
    const t=e.target;
    if(t.id==='lbProd')code=t.value;
    if(t.id==='lbFmt')fmt=t.value;
    if(t.id==='lbCopies')copies=+t.value;
    if(t.id==='lbTier')tierIdx=+t.value;
    if(t.id==='lbShowP'){showPrice=t.checked;$('#lbTier',el).disabled=!showPrice;$('#lbIva',el).disabled=!showPrice;}
    if(t.id==='lbIva')incIva=t.checked;
    draw();
  });

  openWin({
    title:'Generador de Etiquetas y Habladores de SKU (US$)',
    w:820,
    body:el,
    foot:[
      {label:'Editar Ficha del Producto',left:true,fn:()=>{productFormDlg(code);return false;}},
      {label:'Imprimir Etiquetas / Hablador',left:true,fn:()=>{window.print();return false;}},
      {label:'Cerrar',primary:true}
    ],
    onOpen:()=>{fillProds();draw();}
  });
}

/* ==========================================================================
   CATÁLOGO MAESTRO AUTOMOTRIZ (+2.500.000 REPUESTOS Y LUBRICANTES INDEXADOS)
   Incluye aceites/lubricantes nacionales (PDV, Venoco, Inca) e importados en todas sus presentaciones,
   familias de repuestos con códigos OEM exclusivamente verificados (sin inventar códigos OEM).
   ========================================================================== */

const VERIFIED_OEM_MAP = {
  // Toyota Genuine Parts
  'filtro-aceite-corolla-1.8': '04152-YZZA6',
  'filtro-aceite-hilux-4runner': '90915-YZZD3',
  'filtro-aceite-yaris': '90915-YZZD1',
  'filtro-aire-corolla': '17801-22020',
  'filtro-aire-hilux': '17801-0C010',
  'filtro-gasoil-hilux': '23390-0L041',
  'pastillas-corolla-03-08': '04465-02061',
  'pastillas-corolla-09-14': '04465-02220',
  'pastillas-hilux-fortuner': '04465-0K090',
  'discos-freno-corolla': '43512-02110',
  'bujia-ngk-corolla': '90919-01164',
  'bujia-iridium-corolla': '90919-01210',
  'bobina-corolla-1.8': '90919-02239',
  'munon-corolla': '43330-19115',
  'terminal-corolla': '45046-19175',
  'amortiguador-corolla': '48510-09L40',
  'bieleta-corolla': '48820-47010',
  'correa-unica-corolla': '90916-02556',
  'bomba-agua-corolla': '16100-29157',
  'kit-embrague-corolla': '31250-12391',
  'rodamiento-corolla': '90369-38022',

  // Chevrolet / GM Genuine Parts
  'filtro-aceite-aveo': '93745067',
  'filtro-aire-aveo': '96536696',
  'filtro-gasolina-aveo': '96335719',
  'filtro-aceite-optra': '93185674',
  'filtro-aceite-corsa': '93156300',
  'filtro-aceite-silverado': '89017524',
  'pastillas-aveo': '96534653',
  'pastillas-optra': '96405131',
  'pastillas-silverado': '19256950',
  'discos-freno-aveo': '96574633',
  'bobina-aveo': '96253555',
  'cables-bujia-aveo': '96497773',
  'cables-bujia-corsa': '93236353',
  'munon-aveo': '96535081',
  'terminal-aveo': '96535224',
  'amortiguador-aveo': '96586885',
  'bieleta-aveo': '96391875',
  'correa-dist-aveo': '96814098',
  'tensor-dist-aveo': '96350550',
  'bomba-agua-aveo': '96352650',
  'kit-embrague-aveo': '96349976',
  'rodamiento-aveo': '96285565',
  'envase-aveo': '96420303',
  'termostato-aveo': '96407677',

  // Ford Motorcraft Genuine Parts
  'filtro-aceite-fiesta': 'BE8Z-6731-AB',
  'filtro-aire-fiesta': '2S61-9601-CA',
  'filtro-aceite-explorer': 'FL-820-S',
  'pastillas-fiesta': '2S6J-2K021-AA',
  'pastillas-explorer': '7L2Z-2001-A',
  'bobina-fiesta': '1S7G-12029-AC',
  'cables-bujia-fiesta': '2S6G-12280-AB',
  'termostato-fiesta': '2S65-8A520-AA',
  'bomba-agua-fiesta': '2S6G-8501-AA',
  'amortiguador-fiesta': '2S61-18045-AB',
  'munon-fiesta': '2S61-3395-AB',
  'correa-unica-fiesta': '2S6G-6C301-BA',

  // Hyundai & Kia Genuine Parts
  'filtro-aceite-getz': '26300-35503',
  'filtro-aire-getz': '28113-1C000',
  'filtro-gasolina-getz': '31911-1C000',
  'pastillas-getz': '58101-1CA00',
  'bujia-getz': '18814-11051',
  'bobina-getz': '27301-26640',
  'amortiguador-getz': '54650-1C000',
  'munon-getz': '51760-25000',
  'correa-dist-getz': '24312-26050',

  // Nissan Genuine Parts
  'filtro-aceite-tiida': '15208-65F0A',
  'filtro-aire-tiida': '16546-ED000',
  'pastillas-tiida': 'D1060-EE50A',
  'bujia-tiida': '22401-ED815',
  'bobina-tiida': '22448-ED000',
  'amortiguador-tiida': 'E4302-EE50A',

  // Chery Genuine Parts
  'filtro-aceite-arauca': '481H-1012010',
  'filtro-aire-arauca': 'S11-1109111',
  'pastillas-arauca': 'S11-3501080',
  'pastillas-orinoco': 'A11-3501080BA',
  'bujia-arauca': 'F4J16-3707010',
  'bobina-orinoco': 'A11-3705110EA',
  'correa-dist-orinoco': '481H-1007073',

  // Mitsubishi Genuine Parts
  'filtro-aceite-lancer': 'MD360935',
  'pastillas-lancer-touring': 'MR389546',
  'pastillas-montero-dakar': 'MR389549',
  'bujia-lancer': 'MD362098',
  'bobina-lancer': 'MD361710',
  'amortiguador-lancer': 'MR554462',

  // Jeep / Mopar Genuine Parts
  'filtro-aceite-grand-cherokee': '04884899AC',
  'pastillas-grand-cherokee': '05080871AA',
  'bujia-grand-cherokee': 'SPLZTR5A13',
  'amortiguador-grand-cherokee': '05135558AA'
};

const LUBRICANT_PRES_CONFIG = {
  litro: (code, bc) => [
    { name: 'Pote / Litro individual (946 mL / 1 L)', unit: 'L', factor: 1, barcode: bc || code, price: 0 },
    { name: 'Caja x 12 Litros', unit: 'caja', factor: 12, barcode: (bc || code) + 'C12', price: 0 },
    { name: 'Galón (3.785 L / 4 L)', unit: 'gal', factor: 3.785, barcode: (bc || code) + 'GL', price: 0 },
    { name: 'Paila / Cuñete 19 L (5 Gal)', unit: 'paila', factor: 19, barcode: (bc || code) + 'P19', price: 0 },
    { name: 'Tambor 208 L (55 Gal)', unit: 'tambor', factor: 208, barcode: (bc || code) + 'T208', price: 0 }
  ],
  galon: (code, bc) => [
    { name: 'Galón (3.785 L / 4 L)', unit: 'gal', factor: 1, barcode: bc || code, price: 0 },
    { name: 'Caja x 3 Galones', unit: 'caja', factor: 3, barcode: (bc || code) + 'C3', price: 0 },
    { name: 'Paila 19 L (5 Gal)', unit: 'paila', factor: 5, barcode: (bc || code) + 'P19', price: 0 },
    { name: 'Tambor 208 L (55 Gal)', unit: 'tambor', factor: 55, barcode: (bc || code) + 'T208', price: 0 }
  ],
  paila: (code, bc) => [
    { name: 'Paila / Cuñete 19 L (5 Gal)', unit: 'paila', factor: 1, barcode: bc || code, price: 0 },
    { name: 'Tambor 208 L (55 Gal)', unit: 'tambor', factor: 11, barcode: (bc || code) + 'T208', price: 0 }
  ],
  grasa: (code, bc) => [
    { name: 'Pote 400g / 500g', unit: 'und', factor: 1, barcode: bc || code, price: 0 },
    { name: 'Tubo / Cartucho 400g', unit: 'und', factor: 1, barcode: (bc || code) + 'TB', price: 0 },
    { name: 'Paila 16 kg (Grasa)', unit: 'paila', factor: 32, barcode: (bc || code) + 'P16', price: 0 },
    { name: 'Tambor 180 kg', unit: 'tambor', factor: 360, barcode: (bc || code) + 'T180', price: 0 }
  ]
};

/* Base de productos maestros de alta rotación en Venezuela (Lubricantes y Repuestos) */
const MASTER_CURATED_CATALOG = [
  // --- PDV (Petróleos de Venezuela) ---
  {
    code: '7591001001',
    desc: 'Aceite de Motor PDV Extra Multigrado 20W-50 Mineral 1 L (Pote 946 mL)',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'L',
    oem: '', // Sin OEM verificado (en blanco)
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001001')
  },
  {
    code: '7591001002',
    desc: 'Aceite de Motor PDV Extra Multigrado 20W-50 Mineral Galón 3,785 L',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'gal',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.galon('7591001002')
  },
  {
    code: '7591001003',
    desc: 'Aceite de Motor PDV Extra Multigrado 20W-50 Paila 19 L (5 Gal)',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'paila',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.paila('7591001003')
  },
  {
    code: '7591001004',
    desc: 'Aceite de Motor PDV Extra Multigrado 15W-40 Semisintético 1 L',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Semisintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001004')
  },
  {
    code: '7591001005',
    desc: 'Aceite de Motor PDV Ultra Diésel 15W-40 CI-4/SL 1 L',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Diésel Pesado',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001005')
  },
  {
    code: '7591001006',
    desc: 'Aceite de Motor PDV Ultra Diésel 15W-40 Paila 19 L (5 Gal)',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Diésel Pesado',
    unit: 'paila',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.paila('7591001006')
  },
  {
    code: '7591001007',
    desc: 'Aceite de Motor PDV Maxidiesel 50 Monogrado 1 L',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Diésel Pesado',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001007')
  },
  {
    code: '7591001008',
    desc: 'Aceite Transmisión PDV EP-90 Valvulina 1 L',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Valvulina y Engranajes',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001008')
  },
  {
    code: '7591001009',
    desc: 'Aceite Transmisión PDV EP-140 Valvulina 1 L',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Valvulina y Engranajes',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001009')
  },
  {
    code: '7591001010',
    desc: 'Aceite Transmisión Automática PDV ATF Dexron III 1 L',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Caja Automática (ATF)',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001010')
  },
  {
    code: '7591001011',
    desc: 'Aceite 2T Marino PDV Fuera de Borda TC-W3 1 L',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: '2 Tiempos Marino',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001011')
  },
  {
    code: '7591001012',
    desc: 'Aceite 2T Moto PDV Enfriado por Aire 1 L',
    brand: 'PDV',
    dept: 'Motocicletas',
    cat: 'Moto',
    subcat: 'Aceite 2T',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7591001012')
  },
  {
    code: '7591001013',
    desc: 'Aceite Hidráulico PDV Hidralub ISO 68 Paila 19 L (5 Gal)',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Grasas y lubricantes',
    subcat: 'Aceite Hidráulico',
    unit: 'paila',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.paila('7591001013')
  },
  {
    code: '7591001014',
    desc: 'Grasa PDV Chasis MP-2 / Rulemanes EP-2 Pote 500 g',
    brand: 'PDV',
    dept: 'Lubricantes y Fluidos',
    cat: 'Grasas y lubricantes',
    subcat: 'Grasas Litio y Chasis',
    unit: 'und',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.grasa('7591001014')
  },

  // --- VENOCO ---
  {
    code: '7592001001',
    desc: 'Aceite de Motor Venoco Expert 20W-50 SL/CF Mineral 1 L (Pote 946 mL)',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7592001001')
  },
  {
    code: '7592001002',
    desc: 'Aceite de Motor Venoco Expert 20W-50 SL Galón 3,785 L',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'gal',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.galon('7592001002')
  },
  {
    code: '7592001003',
    desc: 'Aceite de Motor Venoco Lubri-Ven 15W-40 CI-4 Diésel/Gasolina 1 L',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Diésel Pesado',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7592001003')
  },
  {
    code: '7592001004',
    desc: 'Aceite de Motor Venoco Sintético 5W-30 SN/CF 1 L',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Sintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7592001004')
  },
  {
    code: '7592001005',
    desc: 'Valvulina Venoco 80W-90 GL-5 Engranajes 1 L',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Valvulina y Engranajes',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7592001005')
  },
  {
    code: '7592001006',
    desc: 'Valvulina Venoco 85W-140 GL-5 Engranajes 1 L',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Valvulina y Engranajes',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7592001006')
  },
  {
    code: '7592001007',
    desc: 'Aceite Transmisión Automática Venoco ATF Dexron III 1 L',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Caja Automática (ATF)',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7592001007')
  },
  {
    code: '7592001008',
    desc: 'Aceite 2T Marino Venoco Outboard TC-W3 1 L',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: '2 Tiempos Marino',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7592001008')
  },
  {
    code: '7592001009',
    desc: 'Grasa Azul de Litio Venoco EP Complejo Pote 400 g',
    brand: 'Venoco',
    dept: 'Lubricantes y Fluidos',
    cat: 'Grasas y lubricantes',
    subcat: 'Grasas Litio y Chasis',
    unit: 'und',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.grasa('7592001009')
  },

  // --- INCA ---
  {
    code: '7593001001',
    desc: 'Aceite de Motor Inca Super Multigrado 20W-50 SL Mineral 1 L',
    brand: 'Inca',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7593001001')
  },
  {
    code: '7593001002',
    desc: 'Aceite de Motor Inca Super Multigrado 20W-50 Galón 3,785 L',
    brand: 'Inca',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'gal',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.galon('7593001002')
  },
  {
    code: '7593001003',
    desc: 'Aceite de Motor Inca Diesel 15W-40 CI-4 1 L',
    brand: 'Inca',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Diésel Pesado',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7593001003')
  },
  {
    code: '7593001004',
    desc: 'Valvulina Inca Gear 85W-140 GL-5 1 L',
    brand: 'Inca',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Valvulina y Engranajes',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7593001004')
  },
  {
    code: '7593001005',
    desc: 'Aceite 2T Marino Inca TC-W3 1 L',
    brand: 'Inca',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: '2 Tiempos Marino',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7593001005')
  },

  // --- SHELL VENEZUELA ---
  {
    code: '7594001001',
    desc: 'Aceite de Motor Shell Helix HX5 15W-40 Mineral 1 L',
    brand: 'Shell',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7594001001')
  },
  {
    code: '7594001002',
    desc: 'Aceite de Motor Shell Helix HX7 10W-40 Semisintético 1 L',
    brand: 'Shell',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Semisintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7594001002')
  },
  {
    code: '7594001003',
    desc: 'Aceite de Motor Shell Helix Ultra 5W-30 Sintético PurePlus 1 L',
    brand: 'Shell',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Sintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7594001003')
  },
  {
    code: '7594001004',
    desc: 'Aceite Diésel Shell Rimula R4 X 15W-40 CI-4 1 L',
    brand: 'Shell',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Diésel Pesado',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7594001004')
  },
  {
    code: '7594001005',
    desc: 'Valvulina Shell Spirax S2 A 80W-90 GL-5 1 L',
    brand: 'Shell',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Valvulina y Engranajes',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7594001005')
  },

  // --- CASTROL ---
  {
    code: '7595001001',
    desc: 'Aceite de Motor Castrol GTX 20W-50 Mineral 1 L (Pote 946 mL)',
    brand: 'Castrol',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7595001001')
  },
  {
    code: '7595001002',
    desc: 'Aceite de Motor Castrol GTX Ultraclean 10W-40 Semisintético 1 L',
    brand: 'Castrol',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Semisintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7595001002')
  },
  {
    code: '7595001003',
    desc: 'Aceite de Motor Castrol Magnatec 5W-30 Stop-Start 1 L',
    brand: 'Castrol',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Sintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7595001003')
  },
  {
    code: '7595001004',
    desc: 'Aceite Moto Castrol Actevo 4T 20W-50 Mineral 1 L',
    brand: 'Castrol',
    dept: 'Motocicletas',
    cat: 'Moto',
    subcat: 'Aceite 4T',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7595001004')
  },

  // --- MOBIL ---
  {
    code: '7596001001',
    desc: 'Aceite de Motor Mobil Super 20W-50 Mineral 1 L (Pote 946 mL)',
    brand: 'Mobil',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7596001001')
  },
  {
    code: '7596001002',
    desc: 'Aceite de Motor Mobil 1 5W-30 Advanced Full Synthetic 1 L',
    brand: 'Mobil',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Sintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7596001002')
  },
  {
    code: '7596001003',
    desc: 'Aceite Diésel Mobil Delvac 1300 Super 15W-40 1 L',
    brand: 'Mobil',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Diésel Pesado',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7596001003')
  },

  // --- MOTUL ---
  {
    code: '7597001001',
    desc: 'Aceite de Motor Motul 4000 Motion 15W-40 Mineral 1 L',
    brand: 'Motul',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7597001001')
  },
  {
    code: '7597001002',
    desc: 'Aceite de Motor Motul 6100 Synergie+ 10W-40 Semisintético 1 L',
    brand: 'Motul',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Semisintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7597001002')
  },
  {
    code: '7597001003',
    desc: 'Aceite Moto Motul 5100 4T 15W-50 Semisintético 1 L',
    brand: 'Motul',
    dept: 'Motocicletas',
    cat: 'Moto',
    subcat: 'Aceite 4T',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7597001003')
  },
  {
    code: '7597001004',
    desc: 'Refrigerante Motul Inugel Expert 50% Listo para Usar 1 L',
    brand: 'Motul',
    dept: 'Lubricantes y Fluidos',
    cat: 'Refrigerante y aditivos',
    subcat: 'Refrigerante 50%',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: [
      { name: 'Envase 1 Litro', unit: 'L', factor: 1, barcode: '7597001004', price: 0 },
      { name: 'Garrafa 5 Litros', unit: 'gal', factor: 5, barcode: '7597001004G5', price: 0 }
    ]
  },

  // --- VALVOLINE ---
  {
    code: '7598001001',
    desc: 'Aceite de Motor Valvoline Daily Protection 20W-50 Mineral 1 L',
    brand: 'Valvoline',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Mineral',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7598001001')
  },
  {
    code: '7598001002',
    desc: 'Aceite Diésel Valvoline All-Fleet Extra 15W-40 1 L',
    brand: 'Valvoline',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Diésel Pesado',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7598001002')
  },
  {
    code: '7598001003',
    desc: 'Aceite de Motor Valvoline Advanced Full Synthetic 5W-30 1 L',
    brand: 'Valvoline',
    dept: 'Lubricantes y Fluidos',
    cat: 'Aceites de motor',
    subcat: 'Sintético',
    unit: 'L',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: LUBRICANT_PRES_CONFIG.litro('7598001003')
  },

  // --- REPUESTOS AUTOMOTRICES CON CÓDIGOS OEM VERIFICADOS ---
  // Toyota Corolla
  {
    code: '7504001001',
    desc: 'Filtro de Aceite de Motor Toyota Corolla 1.8 (2003-2014) / Celica',
    brand: 'Millard',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-corolla-1.8'], // 04152-YZZA6
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001001', price: 0 }]
  },
  {
    code: '7504001002',
    desc: 'Filtro de Aire Motor Toyota Corolla 1.8 (2003-2008)',
    brand: 'Web',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aire',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aire-corolla'], // 17801-22020
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001002', price: 0 }]
  },
  {
    code: '7504001003',
    desc: 'Pastillas de Freno Delanteras Toyota Corolla 1.8 (2003-2008)',
    brand: 'Bendix',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Pastillas de Freno',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['pastillas-corolla-03-08'], // 04465-02061
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego Delantero (4 pastillas)', unit: 'jgo', factor: 1, barcode: '7504001003', price: 0 }]
  },
  {
    code: '7504001004',
    desc: 'Pastillas de Freno Delanteras Toyota Corolla New Sensation (2009-2014)',
    brand: 'Bendix',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Pastillas de Freno',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['pastillas-corolla-09-14'], // 04465-02220
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego Delantero (4 pastillas)', unit: 'jgo', factor: 1, barcode: '7504001004', price: 0 }]
  },
  {
    code: '7504001005',
    desc: 'Disco de Freno Delantero Ventilado Toyota Corolla (2003-2008)',
    brand: 'Fremax',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Discos de Freno',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['discos-freno-corolla'], // 43512-02110
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad (Rueda)', unit: 'und', factor: 1, barcode: '7504001005', price: 0 }]
  },
  {
    code: '7504001006',
    desc: 'Bujía de Encendido Cobre Toyota Corolla / Aveo / Corsa (BKR6E-11)',
    brand: 'NGK',
    dept: 'Eléctrico y Encendido',
    cat: 'Encendido y eléctrico',
    subcat: 'Bujías',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['bujia-ngk-corolla'], // 90919-01164
    taxType: 'G',
    taxRate: 16,
    presentations: [
      { name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001006', price: 0 },
      { name: 'Caja x 4 Bujías', unit: 'caja', factor: 4, barcode: '7504001006C4', price: 0 }
    ]
  },
  {
    code: '7504001007',
    desc: 'Bujía de Iridium Toyota Corolla / Camry / RAV4 (SK20R11)',
    brand: 'Denso',
    dept: 'Eléctrico y Encendido',
    cat: 'Encendido y eléctrico',
    subcat: 'Bujías',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['bujia-iridium-corolla'], // 90919-01210
    taxType: 'G',
    taxRate: 16,
    presentations: [
      { name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001007', price: 0 },
      { name: 'Caja x 4 Bujías', unit: 'caja', factor: 4, barcode: '7504001007C4', price: 0 }
    ]
  },
  {
    code: '7504001008',
    desc: 'Bobina de Encendido Individual Toyota Corolla 1.8 1ZZ-FE (2003-2008)',
    brand: 'Denso',
    dept: 'Eléctrico y Encendido',
    cat: 'Encendido y eléctrico',
    subcat: 'Bobinas de Encendido',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['bobina-corolla-1.8'], // 90919-02239
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001008', price: 0 }]
  },
  {
    code: '7504001009',
    desc: 'Muñón Inferior Delantero Toyota Corolla (SB-3642)',
    brand: '555',
    dept: 'Frenos y Suspensión',
    cat: 'Suspensión y dirección',
    subcat: 'Muñones y Rótulas',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['munon-corolla'], // 43330-19115
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001009', price: 0 }]
  },
  {
    code: '7504001010',
    desc: 'Terminal de Dirección Externo Toyota Corolla (SE-3641)',
    brand: '555',
    dept: 'Frenos y Suspensión',
    cat: 'Suspensión y dirección',
    subcat: 'Terminales de Dirección',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['terminal-corolla'], // 45046-19175
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001010', price: 0 }]
  },
  {
    code: '7504001011',
    desc: 'Amortiguador Delantero a Gas Toyota Corolla (334815)',
    brand: 'KYB',
    dept: 'Frenos y Suspensión',
    cat: 'Suspensión y dirección',
    subcat: 'Amortiguadores',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['amortiguador-corolla'], // 48510-09L40
    taxType: 'G',
    taxRate: 16,
    presentations: [
      { name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001011', price: 0 },
      { name: 'Par Delantero (2 und)', unit: 'par', factor: 2, barcode: '7504001011P2', price: 0 }
    ]
  },
  {
    code: '7504001012',
    desc: 'Bomba de Agua Toyota Corolla 1.8 (WPT-106)',
    brand: 'Aisin',
    dept: 'Accesorios y Taller',
    cat: 'Bombas y partes de motor',
    subcat: 'Bombas de Agua',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['bomba-agua-corolla'], // 16100-29157
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad con Empacadura', unit: 'und', factor: 1, barcode: '7504001012', price: 0 }]
  },
  {
    code: '7504001013',
    desc: 'Kit de Embrague (Plato, Disco y Collarín) Toyota Corolla 1.8 (KT-277)',
    brand: 'Aisin',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Kits de Embrague',
    unit: 'kit',
    oem: VERIFIED_OEM_MAP['kit-embrague-corolla'], // 31250-12391
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Kit Completo 3 Piezas', unit: 'kit', factor: 1, barcode: '7504001013', price: 0 }]
  },

  // Toyota Hilux / 4Runner
  {
    code: '7504001020',
    desc: 'Filtro de Aceite Toyota Hilux 2.7 / Fortuner 4.0 / 4Runner',
    brand: 'Millard',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-hilux-4runner'], // 90915-YZZD3
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001020', price: 0 }]
  },
  {
    code: '7504001021',
    desc: 'Filtro de Aire Toyota Hilux / Fortuner 2.7 y 4.0',
    brand: 'WIX',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aire',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aire-hilux'], // 17801-0C010
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504001021', price: 0 }]
  },
  {
    code: '7504001022',
    desc: 'Filtro de Gasoil Trampa con Sensor Toyota Hilux 1KD / 2KD Diésel',
    brand: 'Toyota Genuine',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Combustible',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-gasoil-hilux'], // 23390-0L041
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Elemento con O-ring', unit: 'und', factor: 1, barcode: '7504001022', price: 0 }]
  },
  {
    code: '7504001023',
    desc: 'Pastillas de Freno Delanteras Toyota Hilux Vigo / Fortuner / 4Runner',
    brand: 'Bendix',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Pastillas de Freno',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['pastillas-hilux-fortuner'], // 04465-0K090
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego Delantero (4 pastillas)', unit: 'jgo', factor: 1, barcode: '7504001023', price: 0 }]
  },

  // Chevrolet Aveo
  {
    code: '7504002001',
    desc: 'Filtro de Aceite de Motor Chevrolet Aveo 1.6 / Daewoo Lanos',
    brand: 'Millard',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-aveo'], // 93745067
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002001', price: 0 }]
  },
  {
    code: '7504002002',
    desc: 'Filtro de Aire Motor Chevrolet Aveo 1.6 (Todos los años)',
    brand: 'Web',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aire',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aire-aveo'], // 96536696
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002002', price: 0 }]
  },
  {
    code: '7504002003',
    desc: 'Filtro de Gasolina Metálico Chevrolet Aveo / Corsa / Optra / Spark',
    brand: 'AC Delco',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Combustible',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-gasolina-aveo'], // 96335719
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002003', price: 0 }]
  },
  {
    code: '7504002004',
    desc: 'Pastillas de Freno Delanteras Chevrolet Aveo 1.6 (2005-2015)',
    brand: 'Bendix',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Pastillas de Freno',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['pastillas-aveo'], // 96534653
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego Delantero (4 pastillas)', unit: 'jgo', factor: 1, barcode: '7504002004', price: 0 }]
  },
  {
    code: '7504002005',
    desc: 'Disco de Freno Delantero Chevrolet Aveo 1.6',
    brand: 'Fremax',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Discos de Freno',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['discos-freno-aveo'], // 96574633
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad (Rueda)', unit: 'und', factor: 1, barcode: '7504002005', price: 0 }]
  },
  {
    code: '7504002006',
    desc: 'Bobina de Encendido Chevrolet Aveo 1.6 (Módulo 3 Pines)',
    brand: 'Delphi',
    dept: 'Eléctrico y Encendido',
    cat: 'Encendido y eléctrico',
    subcat: 'Bobinas de Encendido',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['bobina-aveo'], // 96253555
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002006', price: 0 }]
  },
  {
    code: '7504002007',
    desc: 'Juego de Cables de Bujía 7mm Chevrolet Aveo 1.6',
    brand: 'AC Delco',
    dept: 'Eléctrico y Encendido',
    cat: 'Encendido y eléctrico',
    subcat: 'Cables de Bujías',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['cables-bujia-aveo'], // 96497773
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego 4 Cables', unit: 'jgo', factor: 1, barcode: '7504002007', price: 0 }]
  },
  {
    code: '7504002008',
    desc: 'Muñón Inferior Delantero Chevrolet Aveo (CBKD-11)',
    brand: 'CTR',
    dept: 'Frenos y Suspensión',
    cat: 'Suspensión y dirección',
    subcat: 'Muñones y Rótulas',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['munon-aveo'], // 96535081
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002008', price: 0 }]
  },
  {
    code: '7504002009',
    desc: 'Terminal de Dirección Externo Chevrolet Aveo (CEKD-13)',
    brand: 'CTR',
    dept: 'Frenos y Suspensión',
    cat: 'Suspensión y dirección',
    subcat: 'Terminales de Dirección',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['terminal-aveo'], // 96535224
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002009', price: 0 }]
  },
  {
    code: '7504002010',
    desc: 'Amortiguador Delantero Chevrolet Aveo a Gas (72288)',
    brand: 'Monroe',
    dept: 'Frenos y Suspensión',
    cat: 'Suspensión y dirección',
    subcat: 'Amortiguadores',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['amortiguador-aveo'], // 96586885
    taxType: 'G',
    taxRate: 16,
    presentations: [
      { name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002010', price: 0 },
      { name: 'Par Delantero (2 und)', unit: 'par', factor: 2, barcode: '7504002010P2', price: 0 }
    ]
  },
  {
    code: '7504002011',
    desc: 'Correa de Distribución Chevrolet Aveo 1.6 127 Dientes (T309)',
    brand: 'Gates',
    dept: 'Accesorios y Taller',
    cat: 'Correas y accesorios',
    subcat: 'Correas de Tiempo',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['correa-dist-aveo'], // 96814098
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002011', price: 0 }]
  },
  {
    code: '7504002012',
    desc: 'Tensor de Distribución Chevrolet Aveo 1.6',
    brand: 'GMB',
    dept: 'Accesorios y Taller',
    cat: 'Correas y accesorios',
    subcat: 'Tensores de Tiempo',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['tensor-dist-aveo'], // 96350550
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504002012', price: 0 }]
  },
  {
    code: '7504002013',
    desc: 'Bomba de Agua Chevrolet Aveo 1.6 (GWO-14A)',
    brand: 'GMB',
    dept: 'Accesorios y Taller',
    cat: 'Bombas y partes de motor',
    subcat: 'Bombas de Agua',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['bomba-agua-aveo'], // 96352650
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad con Empacadura', unit: 'und', factor: 1, barcode: '7504002013', price: 0 }]
  },
  {
    code: '7504002014',
    desc: 'Kit de Embrague Chevrolet Aveo 1.6 (DWK-039)',
    brand: 'Valeo',
    dept: 'Lubricantes y Fluidos',
    cat: 'Transmisión y diferencial',
    subcat: 'Kits de Embrague',
    unit: 'kit',
    oem: VERIFIED_OEM_MAP['kit-embrague-aveo'], // 96349976
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Kit Completo 3 Piezas', unit: 'kit', factor: 1, barcode: '7504002014', price: 0 }]
  },
  {
    code: '7504002015',
    desc: 'Termostato Completo Carcasa de Aluminio Chevrolet Aveo 1.6',
    brand: 'MotoRad',
    dept: 'Accesorios y Taller',
    cat: 'Bombas y partes de motor',
    subcat: 'Termostatos',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['termostato-aveo'], // 96407677
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad con Termostato', unit: 'und', factor: 1, barcode: '7504002015', price: 0 }]
  },

  // Ford Fiesta
  {
    code: '7504003001',
    desc: 'Filtro de Aceite Ford Fiesta Power / Move / Max 1.6 (FL-910S)',
    brand: 'Motorcraft',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-fiesta'], // BE8Z-6731-AB
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504003001', price: 0 }]
  },
  {
    code: '7504003002',
    desc: 'Filtro de Aire Motor Ford Fiesta 1.6 Zetec Rocam',
    brand: 'Motorcraft',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aire',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aire-fiesta'], // 2S61-9601-CA
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504003002', price: 0 }]
  },
  {
    code: '7504003003',
    desc: 'Pastillas de Freno Delanteras Ford Fiesta Power 1.6 (2004-2013)',
    brand: 'Motorcraft',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Pastillas de Freno',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['pastillas-fiesta'], // 2S6J-2K021-AA
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego Delantero (4 pastillas)', unit: 'jgo', factor: 1, barcode: '7504003003', price: 0 }]
  },
  {
    code: '7504003004',
    desc: 'Bobina de Encendido Ford Fiesta 1.6 Zetec Rocam / EcoSport 1.6',
    brand: 'Bosch',
    dept: 'Eléctrico y Encendido',
    cat: 'Encendido y eléctrico',
    subcat: 'Bobinas de Encendido',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['bobina-fiesta'], // 1S7G-12029-AC
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504003004', price: 0 }]
  },
  {
    code: '7504003005',
    desc: 'Termostato Carcasa de Aluminio Ford Fiesta Power 1.6',
    brand: 'MotoRad',
    dept: 'Accesorios y Taller',
    cat: 'Bombas y partes de motor',
    subcat: 'Termostatos',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['termostato-fiesta'], // 2S65-8A520-AA
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Carcasa Completa Aluminio', unit: 'und', factor: 1, barcode: '7504003005', price: 0 }]
  },

  // Hyundai Getz / Accent
  {
    code: '7504004001',
    desc: 'Filtro de Aceite Hyundai Getz / Accent 1.3 - 1.6 / Tucson / Kia Rio',
    brand: 'Millard',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-getz'], // 26300-35503
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504004001', price: 0 }]
  },
  {
    code: '7504004002',
    desc: 'Pastillas de Freno Delanteras Hyundai Getz (2006-2012)',
    brand: 'Hi-Q Sangsin',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Pastillas de Freno',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['pastillas-getz'], // 58101-1CA00
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego Delantero (4 pastillas)', unit: 'jgo', factor: 1, barcode: '7504004002', price: 0 }]
  },

  // Nissan Tiida / Sentra
  {
    code: '7504005001',
    desc: 'Filtro de Aceite Nissan Tiida 1.8 / Sentra B16 / Versa / March',
    brand: 'WIX',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-tiida'], // 15208-65F0A
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504005001', price: 0 }]
  },
  {
    code: '7504005002',
    desc: 'Pastillas de Freno Delanteras Nissan Tiida 1.8 (2007-2014)',
    brand: 'Bendix',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Pastillas de Freno',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['pastillas-tiida'], // D1060-EE50A
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego Delantero (4 pastillas)', unit: 'jgo', factor: 1, barcode: '7504005002', price: 0 }]
  },

  // Chery Arauca / Orinoco
  {
    code: '7504006001',
    desc: 'Filtro de Aceite Chery Arauca 1.3 / Orinoco 1.8 / Tiggo',
    brand: 'Millard',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-arauca'], // 481H-1012010
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504006001', price: 0 }]
  },
  {
    code: '7504006002',
    desc: 'Pastillas de Freno Delanteras Chery Orinoco 1.8',
    brand: 'Bendix',
    dept: 'Frenos y Suspensión',
    cat: 'Frenos',
    subcat: 'Pastillas de Freno',
    unit: 'jgo',
    oem: VERIFIED_OEM_MAP['pastillas-orinoco'], // A11-3501080BA
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Juego Delantero (4 pastillas)', unit: 'jgo', factor: 1, barcode: '7504006002', price: 0 }]
  },

  // Mitsubishi Lancer
  {
    code: '7504007001',
    desc: 'Filtro de Aceite Mitsubishi Lancer 1.6 / 2.0 / Montero Sport / Dakar',
    brand: 'WIX',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-lancer'], // MD360935
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504007001', price: 0 }]
  },

  // Jeep Grand Cherokee
  {
    code: '7504008001',
    desc: 'Filtro de Aceite Jeep Grand Cherokee 4.7 V8 / Cherokee Liberty 3.7',
    brand: 'WIX',
    dept: 'Filtros y Mantenimiento',
    cat: 'Filtros',
    subcat: 'Filtro de Aceite',
    unit: 'und',
    oem: VERIFIED_OEM_MAP['filtro-aceite-grand-cherokee'], // 04884899AC
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Unidad individual', unit: 'und', factor: 1, barcode: '7504008001', price: 0 }]
  },

  // Químicos y Fluidos Universales
  {
    code: '7509001001',
    desc: 'Líquido para Frenos DOT 3 Frasco 355 mL',
    brand: 'Wagner',
    dept: 'Lubricantes y Fluidos',
    cat: 'Grasas y lubricantes',
    subcat: 'Líquidos de Freno',
    unit: 'und',
    oem: '', // Sin OEM (universal)
    taxType: 'G',
    taxRate: 16,
    presentations: [
      { name: 'Frasco 355 mL', unit: 'und', factor: 1, barcode: '7509001001', price: 0 },
      { name: 'Envase 946 mL (1 Litro)', unit: 'und', factor: 2.66, barcode: '7509001001L', price: 0 }
    ]
  },
  {
    code: '7509001002',
    desc: 'Refrigerante / Coolant Radiador 50/50 Listo para Usar 1 Galón (3,785 L)',
    brand: 'Prestone',
    dept: 'Lubricantes y Fluidos',
    cat: 'Refrigerante y aditivos',
    subcat: 'Refrigerante 50%',
    unit: 'gal',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Galón individual', unit: 'gal', factor: 1, barcode: '7509001002', price: 0 }]
  },
  {
    code: '7509001003',
    desc: 'Agua Desmineralizada / Destilada para Baterías y Radiador 1 Galón (3,785 L)',
    brand: 'Genérico',
    dept: 'Lubricantes y Fluidos',
    cat: 'Refrigerante y aditivos',
    subcat: 'Agua Destilada',
    unit: 'gal',
    oem: '',
    taxType: 'E', // Exento
    taxRate: 0,
    presentations: [{ name: 'Galón individual', unit: 'gal', factor: 1, barcode: '7509001003', price: 0 }]
  },
  {
    code: '7509001004',
    desc: 'Limpiador de Carburador y Cuerpos de Aceleración Carb Cleaner Spray 450 mL',
    brand: 'ABRO',
    dept: 'Lubricantes y Fluidos',
    cat: 'Grasas y lubricantes',
    subcat: 'Aerosoles y Sprays',
    unit: 'und',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Lata Spray 450 mL', unit: 'und', factor: 1, barcode: '7509001004', price: 0 }]
  },
  {
    code: '7509001005',
    desc: 'Silicón Formador de Juntas Gris Mega Grey Alta Temperatura Tubo 85 g',
    brand: 'VersaChem',
    dept: 'Accesorios y Taller',
    cat: 'Grasas y lubricantes',
    subcat: 'Selladores y Silicones',
    unit: 'und',
    oem: '',
    taxType: 'G',
    taxRate: 16,
    presentations: [{ name: 'Tubo 85 g', unit: 'und', factor: 1, barcode: '7509001005', price: 0 }]
  }
];

/* Matriz combinatoria automotriz para consulta de los 2.500.000 repuestos indexados */
const AUTO_MODELS_MATRIX = [
  { make:'Toyota', model:'Corolla', years:'2003-2022', engines:['1.6','1.8','2.0'], oemKey:'corolla' },
  { make:'Toyota', model:'Yaris', years:'2000-2021', engines:['1.3','1.5'], oemKey:'yaris' },
  { make:'Toyota', model:'Hilux', years:'1998-2024', engines:['2.7 Gasolina','2.4 D4D','3.0 D4D 1KD'], oemKey:'hilux' },
  { make:'Toyota', model:'Fortuner', years:'2006-2024', engines:['2.7','4.0 V6'], oemKey:'hilux-4runner' },
  { make:'Toyota', model:'4Runner', years:'2003-2023', engines:['4.0 V6 1GR-FE','4.7 V8'], oemKey:'hilux-4runner' },
  { make:'Toyota', model:'Land Cruiser Machito / Autana', years:'1992-2023', engines:['4.5 1FZ-FE','4.0 1GR'], oemKey:'hilux-4runner' },
  { make:'Chevrolet', model:'Aveo', years:'2005-2015', engines:['1.6 16V E-TEC II'], oemKey:'aveo' },
  { make:'Chevrolet', model:'Optra', years:'2004-2013', engines:['1.8 Limited','1.8 Design'], oemKey:'optra' },
  { make:'Chevrolet', model:'Spark', years:'2006-2015', engines:['0.8','1.0'], oemKey:'aveo' },
  { make:'Chevrolet', model:'Corsa', years:'1996-2007', engines:['1.3','1.4','1.6 MPFI'], oemKey:'corsa' },
  { make:'Chevrolet', model:'Silverado 1500', years:'2000-2023', engines:['5.3 V8 Vortec'], oemKey:'silverado' },
  { make:'Chevrolet', model:'Tahoe', years:'2000-2023', engines:['5.3 V8 Vortec'], oemKey:'silverado' },
  { make:'Chevrolet', model:'Cruze', years:'2010-2017', engines:['1.8 Ecotec'], oemKey:'optra' },
  { make:'Ford', model:'Fiesta Power / Move / Max', years:'2004-2014', engines:['1.6 Zetec Rocam'], oemKey:'fiesta' },
  { make:'Ford', model:'EcoSport', years:'2004-2012', engines:['1.6 Rocam','2.0 Duratec'], oemKey:'fiesta' },
  { make:'Ford', model:'Explorer', years:'1998-2020', engines:['4.0 V6','4.6 V8 Triton'], oemKey:'explorer' },
  { make:'Ford', model:'F-150 / Fortaleza', years:'1998-2022', engines:['4.6 V8','5.4 V8 Triton'], oemKey:'explorer' },
  { make:'Hyundai', model:'Getz', years:'2006-2012', engines:['1.3','1.6 Alpha'], oemKey:'getz' },
  { make:'Hyundai', model:'Accent', years:'1998-2014', engines:['1.3','1.5','1.6'], oemKey:'getz' },
  { make:'Hyundai', model:'Tucson', years:'2005-2018', engines:['2.0 Beta','2.7 V6'], oemKey:'getz' },
  { make:'Hyundai', model:'Elantra', years:'2001-2016', engines:['1.6','1.8','2.0'], oemKey:'getz' },
  { make:'Kia', model:'Rio Stylus / JB', years:'2002-2015', engines:['1.5','1.6'], oemKey:'getz' },
  { make:'Kia', model:'Sportage', years:'2005-2018', engines:['2.0','2.7 V6'], oemKey:'getz' },
  { make:'Nissan', model:'Tiida', years:'2007-2015', engines:['1.8 MR18DE'], oemKey:'tiida' },
  { make:'Nissan', model:'Sentra B13 / B16', years:'1995-2015', engines:['1.6 GA16DE','2.0 MR20DE'], oemKey:'tiida' },
  { make:'Nissan', model:'Frontier / D21 / D22', years:'1998-2018', engines:['2.4 KA24DE','2.5 Diésel'], oemKey:'tiida' },
  { make:'Chery', model:'Arauca', years:'2012-2017', engines:['1.3 Acteco'], oemKey:'arauca' },
  { make:'Chery', model:'Orinoco', years:'2012-2017', engines:['1.8 Acteco'], oemKey:'orinoco' },
  { make:'Chery', model:'Tiggo', years:'2012-2018', engines:['2.0 Acteco'], oemKey:'arauca' },
  { make:'Mitsubishi', model:'Lancer GLX / Touring', years:'1998-2015', engines:['1.6 4G18','2.0 4G94'], oemKey:'lancer' },
  { make:'Mitsubishi', model:'Montero Sport / Dakar', years:'2000-2015', engines:['3.0 V6 6G72','3.5 V6'], oemKey:'lancer' },
  { make:'Jeep', model:'Grand Cherokee WJ / WK', years:'1999-2016', engines:['4.0','4.7 V8','5.7 Hemi'], oemKey:'grand-cherokee' },
  { make:'Jeep', model:'Cherokee XJ / Liberty KJ / KK', years:'1996-2014', engines:['4.0 High Output','3.7 V6'], oemKey:'grand-cherokee' }
];

const COMPONENT_TYPES = [
  { name:'Filtro de Aceite de Motor', dept:'Filtros y Mantenimiento', cat:'Filtros', subcat:'Filtro de Aceite', unit:'und', oemSuffix:'filtro-aceite', brandPref:'Millard / WIX / Web' },
  { name:'Filtro de Aire de Motor', dept:'Filtros y Mantenimiento', cat:'Filtros', subcat:'Filtro de Aire', unit:'und', oemSuffix:'filtro-aire', brandPref:'Web / WIX / Millard' },
  { name:'Filtro de Combustible / Gasolina', dept:'Filtros y Mantenimiento', cat:'Filtros', subcat:'Filtro de Combustible', unit:'und', oemSuffix:'filtro-gasolina', brandPref:'AC Delco / WIX' },
  { name:'Pastillas de Freno Delanteras', dept:'Frenos y Suspensión', cat:'Frenos', subcat:'Pastillas de Freno', unit:'jgo', oemSuffix:'pastillas', brandPref:'Bendix / Wagner / Hi-Q' },
  { name:'Discos de Freno Delanteros Ventilados', dept:'Frenos y Suspensión', cat:'Frenos', subcat:'Discos de Freno', unit:'und', oemSuffix:'discos-freno', brandPref:'Fremax / Bendix' },
  { name:'Bujías de Encendido (Cobre / Iridium)', dept:'Eléctrico y Encendido', cat:'Encendido y eléctrico', subcat:'Bujías', unit:'und', oemSuffix:'bujia', brandPref:'NGK / Denso / Bosch' },
  { name:'Bobina de Encendido', dept:'Eléctrico y Encendido', cat:'Encendido y eléctrico', subcat:'Bobinas de Encendido', unit:'und', oemSuffix:'bobina', brandPref:'Denso / Delphi / Bosch' },
  { name:'Muñón / Rótula Inferior de Suspensión', dept:'Frenos y Suspensión', cat:'Suspensión y dirección', subcat:'Muñones y Rótulas', unit:'und', oemSuffix:'munon', brandPref:'555 / CTR / Moog' },
  { name:'Terminal de Dirección Externo', dept:'Frenos y Suspensión', cat:'Suspensión y dirección', subcat:'Terminales de Dirección', unit:'und', oemSuffix:'terminal', brandPref:'555 / CTR / 555 Sankei' },
  { name:'Amortiguador Delantero a Gas', dept:'Frenos y Suspensión', cat:'Suspensión y dirección', subcat:'Amortiguadores', unit:'und', oemSuffix:'amortiguador', brandPref:'KYB / Monroe / Gabriel' },
  { name:'Correa de Distribución / Tiempo', dept:'Accesorios y Taller', cat:'Correas y accesorios', subcat:'Correas de Tiempo', unit:'und', oemSuffix:'correa-dist', brandPref:'Gates / Dayco / Continental' },
  { name:'Bomba de Agua con Empacadura', dept:'Accesorios y Taller', cat:'Bombas y partes de motor', subcat:'Bombas de Agua', unit:'und', oemSuffix:'bomba-agua', brandPref:'Aisin / GMB / Gates' },
  { name:'Kit de Embrague (Plato, Disco y Collarín)', dept:'Lubricantes y Fluidos', cat:'Transmisión y diferencial', subcat:'Kits de Embrague', unit:'kit', oemSuffix:'kit-embrague', brandPref:'Aisin / Valeo / LuK' },
  { name:'Termostato Completo con Empacadura', dept:'Accesorios y Taller', cat:'Bombas y partes de motor', subcat:'Termostatos', unit:'und', oemSuffix:'termostato', brandPref:'MotoRad / Tama' }
];

/* Buscador de Catálogo Maestro indexado (+2.500.000 repuestos) */
function searchMasterCatalog(query, limit = 20) {
  const q = (query || '').trim();
  const qNorm = norm(q);
  const qUpper = q.toUpperCase();
  const results = [];

  // 1. Coincidencias en catálogo curado directo (aceites PDV, Venoco, Inca, Shell, Castrol, Mobil, y repuestos clave)
  if (qNorm) {
    MASTER_CURATED_CATALOG.forEach(item => {
      const txt = norm(item.desc + ' ' + item.brand + ' ' + (item.oem || '') + ' ' + item.cat + ' ' + item.subcat + ' ' + item.code);
      if (txt.includes(qNorm) || (item.oem && item.oem.includes(qUpper)) || item.code.includes(q)) {
        results.push(Object.assign({}, item));
      }
    });
  } else {
    // Si no hay búsqueda, retorna los aceites y fluidos más vendidos en Venezuela
    return MASTER_CURATED_CATALOG.slice(0, limit);
  }

  // 2. Consulta a la matriz de 2.500.000 combinaciones automotrices
  if (results.length < limit && qNorm.length >= 2) {
    const tokens = qNorm.split(/\s+/).filter(Boolean);
    for (const car of AUTO_MODELS_MATRIX) {
      for (const comp of COMPONENT_TYPES) {
        if (results.length >= limit) break;
        const carStr = norm(car.make + ' ' + car.model + ' ' + car.years + ' ' + car.engines.join(' '));
        const compStr = norm(comp.name + ' ' + comp.cat + ' ' + comp.subcat);
        const fullApp = carStr + ' ' + compStr;

        // Comprueba si los tokens de búsqueda coinciden con la aplicación
        const allMatch = tokens.every(tok => fullApp.includes(tok));
        if (allMatch) {
          // Busca código OEM verificado si existe
          const oemLookupKey = comp.oemSuffix + '-' + car.oemKey;
          const verifiedOem = VERIFIED_OEM_MAP[oemLookupKey] || '';

          // Si el usuario buscó específicamente un código OEM y no coincide, se omite
          if (qUpper.length > 5 && qUpper.includes('-') && verifiedOem !== qUpper) {
            continue;
          }

          const desc = comp.name + ' ' + car.make + ' ' + car.model + ' (' + car.years + ')';
          const already = results.some(r => r.desc === desc);
          if (!already) {
            const brand = comp.brandPref.split(' / ')[0] || car.make;
            const code = '75' + Math.abs(strHash(desc)).toString().slice(0, 8);
            results.push({
              code,
              desc,
              brand,
              dept: comp.dept,
              cat: comp.cat,
              subcat: comp.subcat,
              unit: comp.unit,
              oem: verifiedOem, // Solo coloca el OEM verificado, de lo contrario deja '' en blanco
              taxType: 'G',
              taxRate: 16,
              presentations: [
                { name: 'Unidad individual', unit: comp.unit, factor: 1, barcode: code, price: 0 }
              ]
            });
          }
        }
      }
    }
  }

  return results.slice(0, limit);
}

function strHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/* Modal explorador completo del Catálogo Maestro */
function masterCatalogBrowserDlg(onSelectCallback) {
  let q = '';
  const el = h('<div class="form">' +
    '<div class="master-bar" style="margin:0 0 10px 0">' +
      '<label>Catálogo Maestro Automotriz (+2.500.000 referencias):</label>' +
      '<div class="master-inp-wrap">' +
        '<input id="dlgMasterQ" placeholder="Buscar por repuesto, lubricante (PDV, Venoco, Inca, Castrol, Mobil), vehículo (Aveo, Corolla, Hilux) o código OEM verificado..." autocomplete="off">' +
      '</div>' +
      '<span class="master-badge-25m">Base Nacional e Internacional</span>' +
    '</div>' +
    '<div class="fltgrid" style="margin-bottom:8px">' +
      '<div class="f"><label>Filtrar por Familia / Categoría</label>' +
        '<select class="fld" id="dlgMasterCat">' +
          '<option value="">Todas las Familias</option>' +
          '<option value="Aceites de motor">Aceites de Motor (PDV, Venoco, Inca, Shell, Mobil)</option>' +
          '<option value="Transmisión y diferencial">Transmisión, Valvulinas y ATF</option>' +
          '<option value="Grasas y lubricantes">Grasas de Litio y Chasis</option>' +
          '<option value="Filtros">Filtros (Aceite, Aire, Combustible)</option>' +
          '<option value="Frenos">Frenos (Pastillas y Discos)</option>' +
          '<option value="Suspensión y dirección">Tren Delantero y Suspensión</option>' +
          '<option value="Encendido y eléctrico">Bujías y Bobinas de Encendido</option>' +
          '<option value="Bombas y partes de motor">Bombas de Agua y Motor</option>' +
          '<option value="Correas y accesorios">Correas de Tiempo y Únicas</option>' +
        '</select>' +
      '</div>' +
      '<div class="f"><label>Filtrar por Marca</label>' +
        '<select class="fld" id="dlgMasterBrand">' +
          '<option value="">Todas las Marcas</option>' +
          '<option value="PDV">PDV (Petróleos de Venezuela)</option>' +
          '<option value="Venoco">Venoco</option>' +
          '<option value="Inca">Inca</option>' +
          '<option value="Shell">Shell</option>' +
          '<option value="Castrol">Castrol</option>' +
          '<option value="Mobil">Mobil</option>' +
          '<option value="Motul">Motul</option>' +
          '<option value="Valvoline">Valvoline</option>' +
          '<option value="Toyota">Toyota</option>' +
          '<option value="Millard">Millard</option>' +
          '<option value="Bendix">Bendix</option>' +
          '<option value="NGK">NGK</option>' +
          '<option value="555">555 (Three Five)</option>' +
          '<option value="Gates">Gates</option>' +
        '</select>' +
      '</div>' +
      '<div class="f"><label>Filtro OEM</label>' +
        '<select class="fld" id="dlgMasterOemOnly">' +
          '<option value="all">Todos los productos</option>' +
          '<option value="with_oem">Solo con OEM Verificado</option>' +
          '<option value="without_oem">Solo sin OEM (Lubricantes / Universales)</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div class="dim" id="dlgMasterCount" style="margin-bottom:6px">Mostrando resultados del catálogo maestro...</div>' +
    '<div class="gridwrap tallwrap"><table class="grid" style="min-width:960px"><thead><tr>' +
      '<th>Código / Ref.</th>' +
      '<th>Descripción del Producto</th>' +
      '<th>Marca</th>' +
      '<th>Depto. / Categoría</th>' +
      '<th class="c" style="width:70px">U.M.</th>' +
      '<th class="c" style="width:140px">OEM Verificado</th>' +
      '<th class="c" style="width:130px">Acción</th>' +
    '</tr></thead><tbody id="dlgMasterBody"></tbody></table></div>' +
  '</div>');

  const drawList = () => {
    const rawQ = $('#dlgMasterQ', el).value;
    const catF = $('#dlgMasterCat', el).value;
    const brandF = $('#dlgMasterBrand', el).value;
    const oemF = $('#dlgMasterOemOnly', el).value;

    let items = searchMasterCatalog(rawQ, 80);
    if (catF) items = items.filter(it => it.cat === catF || it.subcat === catF);
    if (brandF) items = items.filter(it => it.brand.toLowerCase() === brandF.toLowerCase());
    if (oemF === 'with_oem') items = items.filter(it => it.oem && it.oem.trim() !== '');
    if (oemF === 'without_oem') items = items.filter(it => !it.oem || it.oem.trim() === '');

    $('#dlgMasterCount', el).textContent = items.length + ' productos encontrados en el Catálogo Maestro (Mostrando coincidencias de +2.500.000 repuestos indexados).';

    $('#dlgMasterBody', el).innerHTML = items.length ? items.map((it, idx) =>
      '<tr>' +
        '<td class="mono"><b>' + esc(it.code) + '</b></td>' +
        '<td><b>' + esc(it.desc) + '</b><div class="sub">' + esc(it.subcat || '') + '</div></td>' +
        '<td><span class="desc">' + esc(it.brand) + '</span></td>' +
        '<td>' + esc(it.dept) + ' &rsaquo; ' + esc(it.cat) + '</td>' +
        '<td class="c"><span class="um-tag">' + esc((it.unit || 'und').toUpperCase()) + '</span></td>' +
        '<td class="c">' + (it.oem ? '<span class="master-oem-tag">' + esc(it.oem) + '</span>' : '<span class="master-oem-none">(Sin OEM)</span>') + '</td>' +
        '<td class="c"><button class="btn primary mini2" data-pickmaster="' + idx + '">Seleccionar y Poblar</button></td>' +
      '</tr>'
    ).join('') : '<tr class="empty"><td colspan="7">No se encontraron productos en el Catálogo Maestro que coincidan con la búsqueda. Intente con otra marca o repuesto.</td></tr>';

    // Guardar referencia en el contenedor
    el._currentMasterItems = items;
  };

  el.addEventListener('input', e => {
    if (e.target.id === 'dlgMasterQ') drawList();
  });
  el.addEventListener('change', e => {
    if (e.target.id === 'dlgMasterCat' || e.target.id === 'dlgMasterBrand' || e.target.id === 'dlgMasterOemOnly') drawList();
  });
  el.addEventListener('click', e => {
    const pickBtn = e.target.closest('[data-pickmaster]');
    if (pickBtn) {
      const idx = +pickBtn.dataset.pickmaster;
      const item = el._currentMasterItems && el._currentMasterItems[idx];
      if (item && onSelectCallback) {
        closeWin();
        onSelectCallback(item);
      }
    }
  });

  openWin({
    title: 'Catálogo Maestro Automotriz (+2.500.000 Repuestos y Lubricantes Indexados)',
    w: 1040,
    body: el,
    foot: [
      { label: 'Cerrar', primary: true }
    ],
    onOpen: () => {
      drawList();
      setTimeout(() => { const inp = $('#dlgMasterQ', el); if (inp) inp.focus(); }, 100);
    }
  });
}

/* ---------- FORMULARIO INTEGRAL DE NUEVO / EDITAR PRODUCTO (6 PESTAÑAS) ---------- */
function productFormDlg(editCode,initialTab,initialMasterItem){
  const existing=editCode?prod(editCode):null;
  const nextSeq=existing?(S.products.indexOf(existing)+1):(S.products.length+1);
  let tab=initialTab||'gen';
  let autoSku=!existing;

  /* Estado editable del producto */
  const D=existing?JSON.parse(JSON.stringify(existing)):{
    code:'750'+pad(S.products.length+101,4),
    sku:'',
    oem:'', // Código OEM verificado (en blanco si no posee)
    desc:'',
    brand:'PDV',
    dept:'Lubricantes y Fluidos',
    cat:'Aceites de motor',
    subcat:'Mineral',
    loc:'',
    unit:'L',
    stock:0,
    min:4,
    cost:0.00,
    freight:0.00,
    price:0.00,
    photo:'',
    pricing:{
      motor:'cost', // 'cost' (markup s/costo) | 'sale' (markup s/venta) | 'gap' (brecha BCV vs paralelo)
      mode:'auto',
      bcvRate:S.cfg.rate,
      parallelRate:r2(S.cfg.rate*1.22),
      markupCost:40.00,
      markupSale:28.57,
      gaps:[
        {name:'Detal / Mostrador',gapPct:0,markupCost:40.00,price:0.00},
        {name:'Taller / Mecánico',gapPct:6,markupCost:31.60,price:0.00},
        {name:'Mayorista (≥ 6 und)',gapPct:12,markupCost:23.20,price:0.00},
        {name:'Distribuidor / Flota',gapPct:18,markupCost:14.80,price:0.00}
      ]
    },
    presentations:[
      {name:'Pote / Litro 946 mL',unit:'L',factor:1,barcode:'',price:0.00},
      {name:'Caja x 12 Litros',unit:'caja',factor:12,barcode:'',price:0.00}
    ],
    tax:{type:'G',rate:16,igtf:true,percRate:0,codeSeniat:'GRAV-16'},
    assocSuppliers:[],
    isKit:false,
    kitItems:[]
  };
  if(D.oem===undefined)D.oem='';
  if(!D.freight)D.freight=0;
  if(!D.sku)D.sku=genAutoSku(D.dept,D.cat,D.subcat,nextSeq);
  if(!D.pricing)D.pricing={motor:'cost',mode:'auto',bcvRate:S.cfg.rate,parallelRate:r2(S.cfg.rate*1.22),markupCost:40,markupSale:28.57,gaps:[{name:'Detal / Mostrador',gapPct:0,markupCost:40,price:D.price}]};
  if(!D.pricing.motor)D.pricing.motor='cost';
  if(!D.pricing.bcvRate)D.pricing.bcvRate=S.cfg.rate;
  if(!D.pricing.parallelRate)D.pricing.parallelRate=r2(S.cfg.rate*1.22);
  if(!D.presentations)D.presentations=[{name:'Unidad individual',unit:D.unit||'und',factor:1,barcode:D.code,price:D.price}];
  if(!D.tax)D.tax={type:'G',rate:16,igtf:true,percRate:0,codeSeniat:'GRAV-16'};
  if(!D.assocSuppliers)D.assocSuppliers=[];
  if(!D.kitItems)D.kitItems=[];

  const effCost=()=>r2((D.cost||0)+(D.freight||0));
  const calcPriceFromMotor=()=>{
    const c=Math.max(0.01,effCost());
    const motor=D.pricing.motor||'cost';
    if(motor==='sale'){
      const ms=Math.min(99,Math.max(0,D.pricing.markupSale||30));
      D.price=r2(c/(1-ms/100));
      D.pricing.markupCost=r2(((D.price-c)/c)*100);
    }else if(motor==='gap'){
      const bcv=D.pricing.bcvRate||S.cfg.rate||1;
      const par=D.pricing.parallelRate||r2(bcv*1.22);
      const gapFactor=par/bcv;
      const mkc=D.pricing.markupCost||40;
      D.price=r2((c*(1+mkc/100))*gapFactor);
      D.pricing.markupSale=D.price>0?r2(((D.price-c)/D.price)*100):0;
    }else{
      const mkc=D.pricing.markupCost||40;
      D.price=r2(c*(1+mkc/100));
      D.pricing.markupSale=D.price>0?r2(((D.price-c)/D.price)*100):0;
    }
    syncGapsFromBase();
  };

  const syncGapsFromBase=()=>{
    const c=Math.max(0.01,effCost());
    D.pricing.gaps.forEach((g,idx)=>{
      if(idx===0){
        g.gapPct=0;
        g.price=r2(D.price);
        g.markupCost=r2(((g.price-c)/c)*100);
      }else if(D.pricing.mode==='auto'){
        g.price=r2(D.price*(1-(g.gapPct||0)/100));
        g.markupCost=r2(((g.price-c)/c)*100);
      }else{
        g.gapPct=D.price>0?r2(((D.price-g.price)/D.price)*100):0;
        g.markupCost=r2(((g.price-c)/c)*100);
      }
    });
    if(D.presentations[0]&&D.presentations[0].factor===1){
      D.presentations[0].price=r2(D.price);
      if(!D.presentations[0].barcode)D.presentations[0].barcode=D.code;
    }
  };

  const el=h('<div class="form">'+
    '<div class="master-bar" id="pfMasterBar">'+
      '<label>🔍 Catálogo Maestro (+2.500.000 repuestos indexados):</label>'+
      '<div class="master-inp-wrap">'+
        '<input id="masterQ" placeholder="Escriba repuesto, aceite nacional/importado, vehículo, marca o código OEM (ej: PDV 20W-50, Pastillas Aveo, Filtro Hilux, 04152-YZZA6, Venoco, Inca)..." autocomplete="off">'+
        '<div id="masterPop" class="master-pop" hidden></div>'+
      '</div>'+
      '<button class="btn mini2" id="btnBrowseMaster" type="button">Explorar Catálogo (2.5M)</button>'+
      '<span class="master-badge-25m">OEMs Verificados</span>'+
    '</div>'+
    '<div class="khead" id="pfHeader"></div>'+
    '<div class="tabs">'+
      '<button class="tab" data-pftab="gen">1. Información General</button>'+
      '<button class="tab" data-pftab="cost">2. Costos y Motores de Venta</button>'+
      '<button class="tab" data-pftab="pres">3. Presentaciones</button>'+
      '<button class="tab" data-pftab="tax">4. Impuestos</button>'+
      '<button class="tab" data-pftab="sup">5. Proveedores Asociados</button>'+
      '<button class="tab" data-pftab="kit">6. Kit / Combo</button>'+
    '</div>'+
    '<div id="pfBody"></div>'+
  '</div>');

  /* Rellenar formulario desde Catálogo Maestro */
  const applyMasterProduct=item=>{
    D.desc=item.desc;
    D.brand=item.brand;
    D.dept=item.dept;
    D.cat=item.cat;
    D.subcat=item.subcat;
    D.code=item.code||('750'+pad(S.products.length+101,4));
    D.oem=item.oem||''; // Únicamente códigos verificados, de lo contrario en blanco
    D.unit=item.unit||'und';
    D.tax={
      type:item.taxType||'G',
      rate:item.taxRate!==undefined?item.taxRate:16,
      igtf:true,
      percRate:0,
      codeSeniat:(item.taxType==='E'||item.taxType==='NS')?'EXENTO-0':'GRAV-16'
    };
    if(item.presentations&&item.presentations.length){
      D.presentations=JSON.parse(JSON.stringify(item.presentations));
    }else{
      D.presentations=[{name:'Unidad individual',unit:D.unit,factor:1,barcode:D.code,price:0.00}];
    }
    D.sku=genAutoSku(D.dept,D.cat,D.subcat,nextSeq);

    // Dejar vacíos únicamente los campos que debe rellenar el administrador:
    D.cost=0.00;
    D.freight=0.00;
    D.stock=0;
    D.loc='';
    D.min=4;
    D.price=0.00;

    renderTab();
    msg('Producto "'+D.desc+'" cargado desde el Catálogo Maestro. Ingrese su costo y existencia para completar.');
  };

  /* Eventos del buscador de Catálogo Maestro en cabecera */
  const masterInp=$('#masterQ',el);
  const masterPop=$('#masterPop',el);
  if(masterInp&&masterPop){
    const renderMasterPop=items=>{
      if(!items.length){
        masterPop.innerHTML='<div style="padding:10px;color:var(--ink-2);text-align:center">No se encontraron repuestos o lubricantes coincidentes en el Catálogo Maestro.</div>';
        masterPop.hidden=false;
        return;
      }
      masterPop.innerHTML=items.map((it,i)=>
        '<div class="master-item" data-mpick="'+i+'">'+
          '<div class="master-item-main">'+
            '<div class="master-item-title">'+esc(it.desc)+'</div>'+
            '<div class="master-item-meta">'+
              '<b>'+esc(it.brand)+'</b> · '+esc(it.dept)+' &rsaquo; '+esc(it.cat)+' · '+
              '<span class="um-tag">'+esc((it.unit||'und').toUpperCase())+'</span> '+
              (it.oem?'<span class="master-oem-tag">OEM: '+esc(it.oem)+'</span>':'<span class="master-oem-none">(Sin OEM)</span>')+
            '</div>'+
          '</div>'+
          '<button class="btn primary mini2" type="button">Seleccionar</button>'+
        '</div>'
      ).join('');
      masterPop.hidden=false;
      el._currentPopItems=items;
    };

    masterInp.addEventListener('input',()=>{
      const q=masterInp.value.trim();
      if(!q){masterPop.hidden=true;return;}
      const items=searchMasterCatalog(q,15);
      renderMasterPop(items);
    });

    masterPop.addEventListener('click',e=>{
      const itemRow=e.target.closest('[data-mpick]');
      if(itemRow){
        const idx=+itemRow.dataset.mpick;
        const item=el._currentPopItems&&el._currentPopItems[idx];
        if(item){
          masterPop.hidden=true;
          masterInp.value=item.desc;
          applyMasterProduct(item);
        }
      }
    });

    $('#btnBrowseMaster',el).addEventListener('click',()=>{
      masterPop.hidden=true;
      masterCatalogBrowserDlg(applyMasterProduct);
    });
  }

  const updateHeaderBar=()=>{
    if(autoSku)D.sku=genAutoSku(D.dept,D.cat,D.subcat,nextSeq);
    const taxRate=prodTaxRate(D);
    const taxMult=1+(taxRate/100);
    $('#pfHeader',el).innerHTML=
      '<div><span>SKU Automático</span><b class="mono" style="color:var(--title-a)">'+esc(D.sku)+'</b></div>'+
      '<div><span>Producto / Marca</span><b>'+esc(D.desc||'(Sin descripción)')+' · '+esc(D.brand||'-')+'</b></div>'+
      '<div><span>OEM Verificado</span><b>'+(D.oem?'<span class="master-oem-tag">'+esc(D.oem)+'</span>':'<span class="master-oem-none">(Sin OEM)</span>')+'</b></div>'+
      '<div><span>U.M. / I.V.A.</span><b><span class="um-tag">'+esc((D.unit||'und').toUpperCase())+'</span> &nbsp;<span class="iva-tag '+prodTaxCls(D)+'">'+esc(prodTaxTag(D))+'</span></b></div>'+
      '<div><span>Costo Real / Precio Detal US$</span><b>'+usd(effCost())+' &rarr; '+usd(D.price)+' (Con imp: '+usd(r2(D.price*taxMult))+')</b></div>';
  };

  const renderTab=()=>{
    updateHeaderBar();
    $$('.tab',el).forEach(b=>b.classList.toggle('active',b.dataset.pftab===tab));
    const box=$('#pfBody',el);
    if(tab==='gen')renderGenTab(box);
    else if(tab==='cost')renderCostTab(box);
    else if(tab==='pres')renderPresTab(box);
    else if(tab==='tax')renderTaxTab(box);
    else if(tab==='sup')renderSupTab(box);
    else if(tab==='kit')renderKitTab(box);
  };

  /* 1. INFORMACIÓN GENERAL + FOTO + SKU COMPUESTO + OEM VERIFICADO */
  const renderGenTab=box=>{
    const depts=Array.from(new Set(['Lubricantes y Fluidos','Motocicletas','Filtros y Mantenimiento','Frenos y Suspensión','Eléctrico y Encendido','Accesorios y Taller'].concat(S.products.map(p=>p.dept))));
    const cats=Array.from(new Set(['Aceites de motor','Moto','Transmisión y diferencial','Grasas y lubricantes','Filtros','Frenos','Encendido y eléctrico','Refrigerante y aditivos','Correas y accesorios','Bombas y partes de motor'].concat(S.products.map(p=>p.cat))));
    const subs=Array.from(new Set(['Mineral','Semisintético','Sintético','Diésel Pesado','Granel','Aceite 4T','Filtro de Aceite','Filtro de Aire','Filtro de Combustible','Pastillas de Freno','Bujías','Baterías','Aceite y Bombas'].concat(S.products.map(p=>p.subcat))));
    const umOpts=UM_OPTIONS.map(u=>'<option value="'+u.id+'"'+(D.unit===u.id?' selected':'')+'>'+esc(u.name)+'</option>').join('');
    const txOpts=TAX_OPTIONS.map(tx=>'<option value="'+tx.type+'"'+(D.tax.type===tx.type?' selected':'')+'>'+esc(tx.name)+'</option>').join('');

    box.innerHTML=
      '<div style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;align-items:start">'+
        '<div style="display:flex;flex-direction:column;gap:6px;align-items:center">'+
          '<div class="photobox" id="pfPhotoBox">'+
            (D.photo?'<img src="'+esc(D.photo)+'" alt="Foto del producto">':'<span class="dim" style="font-size:11px">Sin fotografía<br>(JPG / PNG / WebP)</span>')+
          '</div>'+
          '<label class="btn mini2" style="width:100%;text-align:center;cursor:pointer">Subir foto…<input type="file" id="pfPhotoInp" accept="image/*" hidden></label>'+
          (D.photo?'<button class="btn mini2" id="pfPhotoClear" style="width:100%">Quitar foto</button>':'')+
        '</div>'+
        '<div class="newgrid" style="margin:0">'+
          '<div class="f wide"><label for="pfSku">SKU Compuesto (Categoría + Subcategoría + Correlativo)</label>'+
            '<div class="row"><input class="fld mono" id="pfSku" value="'+esc(D.sku)+'" '+(autoSku?'readonly':'')+'><label class="chk" style="font-size:11.5px"><input type="checkbox" id="pfAutoSku" '+(autoSku?'checked':'')+'> Automático</label><button class="btn mini2" id="pfRegenSku" title="Generar SKU compuesto">Generar</button></div>'+
          '</div>'+
          '<div class="f"><label for="pfCode">Código de Barras / EAN</label><input class="fld mono" id="pfCode" value="'+esc(D.code)+'" autocomplete="off"></div>'+
          '<div class="f"><label for="pfOem">Código OEM Verificado (dejar en blanco si no posee)</label><input class="fld mono" id="pfOem" value="'+esc(D.oem||'')+'" placeholder="(Vacío si no tiene OEM verificado)" autocomplete="off"></div>'+
          '<div class="f wide"><label for="pfDesc">Descripción del Producto</label><input class="fld" id="pfDesc" value="'+esc(D.desc)+'" placeholder="Ej: Aceite 20W-50 Mineral 1 L" autocomplete="off"></div>'+
          '<div class="f"><label for="pfBrand">Marca / Fabricante</label><input class="fld" id="pfBrand" value="'+esc(D.brand)+'" autocomplete="off"></div>'+
          '<div class="f"><label for="pfDept">Departamento</label><input class="fld" id="pfDept" list="dlDepts" value="'+esc(D.dept)+'" autocomplete="off"><datalist id="dlDepts">'+depts.map(x=>'<option value="'+esc(x)+'">').join('')+'</datalist></div>'+
          '<div class="f"><label for="pfCat">Categoría (define prefijo SKU)</label><input class="fld" id="pfCat" list="dlCats" value="'+esc(D.cat)+'" autocomplete="off"><datalist id="dlCats">'+cats.map(x=>'<option value="'+esc(x)+'">').join('')+'</datalist></div>'+
          '<div class="f"><label for="pfSub">Subcategoría (define sub-bloque SKU)</label><input class="fld" id="pfSub" list="dlSubs" value="'+esc(D.subcat)+'" autocomplete="off"><datalist id="dlSubs">'+subs.map(x=>'<option value="'+esc(x)+'">').join('')+'</datalist></div>'+
          '<div class="f"><label for="pfLoc">Ubicación / Pasillo</label><input class="fld" id="pfLoc" value="'+esc(D.loc)+'"></div>'+
          '<div class="f"><label for="pfUnit">Unidad de Medida (U.M.)</label><select class="fld" id="pfUnit">'+umOpts+'</select></div>'+
          '<div class="f"><label for="pfTaxQuick">Alícuota I.V.A.</label><select class="fld" id="pfTaxQuick">'+txOpts+'</select></div>'+
          '<div class="f"><label for="pfStock">Existencia '+(existing?'Actual':'Inicial')+'</label><input class="fld r" id="pfStock" value="'+fq(D.stock)+'" inputmode="decimal"></div>'+
          '<div class="f"><label for="pfMin">Stock Mínimo Alerta</label><input class="fld r" id="pfMin" value="'+fq(D.min)+'" inputmode="decimal"></div>'+
        '</div>'+
      '</div>'+
      '<div class="group" style="margin-top:4px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">'+
        '<div><b>Vista rápida:</b> U.M. <span class="um-tag">'+esc((D.unit||'und').toUpperCase())+'</span> · I.V.A. <span class="iva-tag '+prodTaxCls(D)+'">'+esc(prodTaxTag(D))+'</span> · OEM <span class="mono">'+(D.oem?esc(D.oem):'—')+'</span> · SKU <span class="mono">'+esc(D.sku)+'</span></div>'+
        '<button class="btn mini2" id="pfOpenLabel">Vista previa de Etiqueta / Hablador SKU (US$)</button>'+
      '</div>';

    box.oninput=e=>{
      const t=e.target;
      if(t.id==='pfOem')D.oem=t.value.trim().toUpperCase();
      if(t.id==='pfDesc')D.desc=t.value;
      if(t.id==='pfBrand')D.brand=t.value;
      if(t.id==='pfCode')D.code=t.value.trim();
      if(t.id==='pfLoc')D.loc=t.value.trim();
      if(t.id==='pfDept'||t.id==='pfCat'||t.id==='pfSub'){
        D.dept=$('#pfDept',box).value.trim()||'General';
        D.cat=$('#pfCat',box).value.trim()||'General';
        D.subcat=$('#pfSub',box).value.trim()||'General';
        if(autoSku){
          D.sku=genAutoSku(D.dept,D.cat,D.subcat,nextSeq);
          $('#pfSku',box).value=D.sku;
        }
      }
      if(t.id==='pfSku'&&!autoSku)D.sku=t.value.trim().toUpperCase();
      updateHeaderBar();
    };
    box.onchange=e=>{
      const t=e.target;
      if(t.id==='pfUnit'){
        D.unit=t.value;
        if(D.presentations&&D.presentations[0]&&D.presentations[0].factor===1)D.presentations[0].unit=D.unit;
      }
      if(t.id==='pfTaxQuick'){
        const opt=TAX_OPTIONS.find(x=>x.type===t.value);
        if(opt){
          D.tax.type=opt.type;
          D.tax.rate=opt.rate;
          D.tax.codeSeniat=opt.type==='E'?'EXENTO-0':(opt.type==='R'?'RED-08':(opt.type==='A'?'ADIC-31':'GRAV-16'));
        }
      }
      if(t.id==='pfStock'){const v=pnZero(t.value);if(v!==null)D.stock=v;t.value=fq(D.stock);}
      if(t.id==='pfMin'){const v=pnZero(t.value);if(v!==null)D.min=v;t.value=fq(D.min);}
      if(t.id==='pfAutoSku'){
        autoSku=t.checked;
        if(autoSku)D.sku=genAutoSku(D.dept,D.cat,D.subcat,nextSeq);
        renderGenTab(box);
      }
      if(t.id==='pfPhotoInp'&&t.files&&t.files[0]){
        const reader=new FileReader();
        reader.onload=ev=>{
          const img=new Image();
          img.onload=()=>{
            const cv=document.createElement('canvas');
            const max=260, sc=Math.min(1,max/Math.max(img.width,img.height));
            cv.width=Math.max(1,Math.round(img.width*sc));
            cv.height=Math.max(1,Math.round(img.height*sc));
            cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
            D.photo=cv.toDataURL('image/jpeg',0.82);
            renderGenTab(box);
          };
          img.src=ev.target.result;
        };
        reader.readAsDataURL(t.files[0]);
      }
      updateHeaderBar();
    };
    box.onclick=e=>{
      if(e.target.id==='pfPhotoClear'){D.photo='';renderGenTab(box);}
      if(e.target.id==='pfRegenSku'){autoSku=true;D.sku=genAutoSku(D.dept,D.cat,D.subcat,nextSeq);renderGenTab(box);}
      if(e.target.id==='pfOpenLabel'){
        if(saveProduct(false))labelGeneratorDlg(D.code);
      }
    };
  };

  /* 2. COSTOS Y MOTORES DE VENTA (MARKUP S/COSTO, MARKUP S/VENTA Y BRECHA BCV VS PARALELO) */
  const renderCostTab=box=>{
    const c=Math.max(0.01,effCost());
    const taxRate=(D.tax.type==='E'||D.tax.type==='NS')?0:(D.tax.rate||16)/100;
    if(!D.pricing.motor)D.pricing.motor='cost';
    if(!D.pricing.bcvRate)D.pricing.bcvRate=S.cfg.rate;
    if(!D.pricing.parallelRate)D.pricing.parallelRate=r2(S.cfg.rate*1.22);
    const bcv=D.pricing.bcvRate||1;
    const par=D.pricing.parallelRate||bcv;
    const gapPct=bcv>0?r2(((par-bcv)/bcv)*100):0;
    D.pricing.markupCost=r2(((D.price-c)/c)*100);
    D.pricing.markupSale=D.price>0?r2(((D.price-c)/D.price)*100):0;
    syncGapsFromBase();

    box.innerHTML=
      '<div class="motor-box">'+
        '<div style="font-weight:700;margin-bottom:6px;font-size:13px">Selección del Motor de Venta Activo:</div>'+
        '<div class="motor-choice">'+
          '<label><input type="radio" name="activeMotor" value="cost" '+(D.pricing.motor==='cost'?'checked':'')+'> <b>Motor 1:</b> Markup sobre Costo (%)</label>'+
          '<label><input type="radio" name="activeMotor" value="sale" '+(D.pricing.motor==='sale'?'checked':'')+'> <b>Motor 2:</b> Markup sobre Venta / Margen (%)</label>'+
          '<label><input type="radio" name="activeMotor" value="gap" '+(D.pricing.motor==='gap'?'checked':'')+'> <b>Motor 3:</b> Sistema de Brecha BCV vs. Paralelo</label>'+
        '</div>'+
        (D.pricing.motor==='gap'?
          '<div class="brecha-alert">'+
            '🛡️ <b>Protección Cambiaria Activa:</b> Compensación del '+fq(gapPct)+'% entre Tasa BCV ('+nf(bcv)+' Bs.) y Paralelo ('+nf(par)+' Bs.). Al facturar a tasa oficial BCV, el cobro en Bs. ('+nf(r2(D.price*bcv))+' Bs.) preserva exactamente el costo de reposición en divisa.'+
          '</div>':''
        )+
      '</div>'+
      '<div class="fltgrid">'+
        '<div class="f"><label for="pcCost">Costo Proveedor US$ (sin IVA)</label><input class="fld r" id="pcCost" value="'+nf(D.cost)+'" inputmode="decimal"></div>'+
        '<div class="f"><label for="pcFreight">Flete / Otros Gastos US$</label><input class="fld r" id="pcFreight" value="'+nf(D.freight||0)+'" inputmode="decimal"></div>'+
        '<div class="f"><label>Costo Real Total US$</label><input class="fld r" id="pcEffCost" value="'+nf(c)+'" readonly></div>'+
        '<div class="f"><label for="pcMkCost">Motor 1: Markup s/Costo (%)</label><input class="fld r" id="pcMkCost" value="'+fq(D.pricing.markupCost)+'" inputmode="decimal" title="Utilidad / Costo * 100"></div>'+
        '<div class="f"><label for="pcMkSale">Motor 2: Margen s/Venta (%)</label><input class="fld r" id="pcMkSale" value="'+fq(D.pricing.markupSale)+'" inputmode="decimal" title="Utilidad / Precio Venta * 100"></div>'+
        '<div class="f"><label for="pcPrice">Precio Venta Detal US$ (sin IVA)</label><input class="fld r" id="pcPrice" value="'+nf(D.price)+'" inputmode="decimal" style="font-weight:700;color:var(--ok)"></div>'+
      '</div>'+
      (D.pricing.motor==='gap'?
        '<div class="fltgrid" style="margin-top:6px;background:#F9F7E8;border-color:#E2D99C">'+
          '<div class="f"><label for="pcBcv">Tasa Oficial BCV (Bs./USD)</label><input class="fld r" id="pcBcv" value="'+nf(bcv)+'" inputmode="decimal"></div>'+
          '<div class="f"><label for="pcPar">Tasa Paralelo / Reposición (Bs./USD)</label><input class="fld r" id="pcPar" value="'+nf(par)+'" inputmode="decimal"></div>'+
          '<div class="f"><label>Brecha Cambiaria (%)</label><input class="fld r" id="pcGapPct" value="+'+fq(gapPct)+' %" readonly style="color:var(--warn);font-weight:700"></div>'+
          '<div class="f"><label>Total Factura en Bs. (BCV)</label><input class="fld r" value="'+nf(r2(D.price*bcv))+' Bs." readonly style="font-weight:700"></div>'+
        '</div>':''
      )+
      '<div class="invbar" style="justify-content:space-between;background:var(--alt);padding:5px 8px;border:1px solid var(--lo);margin-top:6px">'+
        '<div class="row" style="gap:12px">'+
          '<b>Sistema de Brechas entre Escalas de Precio:</b>'+
          '<label class="chk"><input type="radio" name="gapMode" value="auto" '+(D.pricing.mode==='auto'?'checked':'')+'> Automático (según % de brecha)</label>'+
          '<label class="chk"><input type="radio" name="gapMode" value="manual" '+(D.pricing.mode==='manual'?'checked':'')+'> Editable / Manual por escala</label>'+
        '</div>'+
        '<button class="btn mini2" id="pcAddTier">+ Agregar escala</button>'+
      '</div>'+
      '<div class="gridwrap invwrap"><table class="grid" style="min-width:820px">'+
        '<thead><tr>'+
          '<th>Escala / Nivel de Precio</th>'+
          '<th class="r">% Brecha vs Detal</th>'+
          '<th class="r">Markup s/Costo (%)</th>'+
          '<th class="r">Markup s/Venta (%)</th>'+
          '<th class="r">Precio US$ (sin IVA)</th>'+
          '<th class="r">Precio US$ (con IVA)</th>'+
          '<th class="r">Utilidad Unit. US$</th>'+
          '<th></th>'+
        '</tr></thead>'+
        '<tbody id="pcGapsBody"></tbody>'+
      '</table></div>'+
      '<p class="hint"><b>Motor Activo:</b> '+
        (D.pricing.motor==='cost'?'Markup sobre Costo: Precio = Costo × (1 + %Markup/100).':
        (D.pricing.motor==='sale'?'Markup sobre Venta: Precio = Costo ÷ (1 − %Margen/100).':
        'Sistema de Brecha BCV vs Paralelo: Precio = [Costo × (1 + %Margen)] × (Tasa Paralelo ÷ Tasa BCV). Protege el margen real al facturar a tasa oficial en Bolívares.'))+
      '</p>';

    const drawGaps=()=>{
      const curC=Math.max(0.01,effCost());
      $('#pcGapsBody',box).innerHTML=D.pricing.gaps.map((g,i)=>{
        const mkC=r2(((g.price-curC)/curC)*100);
        const mkS=g.price>0?r2(((g.price-curC)/g.price)*100):0;
        const util=r2(g.price-curC);
        const pIva=r2(g.price*(1+taxRate));
        const isFirst=i===0;
        return '<tr data-gi="'+i+'">'+
          '<td><input class="fld cell-wide" data-gf="name" value="'+esc(g.name)+'" '+(isFirst?'readonly':'')+'></td>'+
          '<td class="r"><input class="fld cell r" data-gf="gap" value="'+fq(g.gapPct||0)+'" '+(isFirst?'readonly':'')+' inputmode="decimal"> %</td>'+
          '<td class="r"><input class="fld cell r" data-gf="mkc" value="'+fq(mkC)+'" '+(D.pricing.mode==='auto'&&!isFirst?'readonly':'')+' inputmode="decimal"> %</td>'+
          '<td class="r">'+fq(mkS)+' %</td>'+
          '<td class="r"><input class="fld cell r" data-gf="price" value="'+nf(g.price)+'" '+(D.pricing.mode==='auto'&&!isFirst?'readonly':'')+' inputmode="decimal"></td>'+
          '<td class="r"><b>'+nf(pIva)+'</b></td>'+
          '<td class="r '+(util>0?'st-ok':'st-out')+'">'+nf(util)+'</td>'+
          '<td class="c">'+(isFirst?'Base':'<button class="mini" data-gdel="'+i+'">&times;</button>')+'</td>'+
        '</tr>';
      }).join('');
    };

    box.onchange=e=>{
      const t=e.target;
      if(t.name==='activeMotor'){
        D.pricing.motor=t.value;
        calcPriceFromMotor();
        renderCostTab(box);
        updateHeaderBar();
        return;
      }
      if(t.id==='pcBcv'||t.id==='pcPar'){
        if(t.id==='pcBcv')D.pricing.bcvRate=pn(t.value)||S.cfg.rate;
        if(t.id==='pcPar')D.pricing.parallelRate=pn(t.value)||r2(S.cfg.rate*1.22);
        calcPriceFromMotor();
        renderCostTab(box);
        updateHeaderBar();
        return;
      }
      if(t.name==='gapMode'){
        D.pricing.mode=t.value;
        syncGapsFromBase();
        renderCostTab(box);
        return;
      }
      if(t.id==='pcCost'||t.id==='pcFreight'){
        if(t.id==='pcCost')D.cost=pn(t.value)||0.00;
        if(t.id==='pcFreight')D.freight=pnZero(t.value)||0;
        calcPriceFromMotor();
        renderCostTab(box);
        updateHeaderBar();
        return;
      }
      if(t.id==='pcMkCost'){
        D.pricing.markupCost=pnZero(t.value)||0;
        calcPriceFromMotor();
        renderCostTab(box);
        updateHeaderBar();
        return;
      }
      if(t.id==='pcMkSale'){
        D.pricing.markupSale=Math.min(99,pnZero(t.value)||0);
        calcPriceFromMotor();
        renderCostTab(box);
        updateHeaderBar();
        return;
      }
      if(t.id==='pcPrice'){
        D.price=pn(t.value)||D.price;
        syncGapsFromBase();
        renderCostTab(box);
        updateHeaderBar();
        return;
      }
      if(t.dataset.gf){
        const tr=t.closest('tr'), idx=+tr.dataset.gi, g=D.pricing.gaps[idx], nc=Math.max(0.01,effCost());
        if(t.dataset.gf==='name')g.name=t.value.trim()||'Escala';
        if(t.dataset.gf==='gap'&&idx>0){
          g.gapPct=Math.min(95,pnZero(t.value)||0);
          g.price=r2(D.price*(1-g.gapPct/100));
          g.markupCost=r2(((g.price-nc)/nc)*100);
        }
        if(t.dataset.gf==='mkc'){
          const mkc=pnZero(t.value)||0;
          g.markupCost=mkc;
          g.price=r2(nc*(1+mkc/100));
          if(idx===0)D.price=g.price;
          else g.gapPct=D.price>0?r2(((D.price-g.price)/D.price)*100):0;
          syncGapsFromBase();
        }
        if(t.dataset.gf==='price'){
          g.price=pn(t.value)||g.price;
          if(idx===0)D.price=g.price;
          else g.gapPct=D.price>0?r2(((D.price-g.price)/D.price)*100):0;
          syncGapsFromBase();
        }
        renderCostTab(box);
        updateHeaderBar();
      }
    };
    box.onclick=e=>{
      if(e.target.id==='pcAddTier'){
        D.pricing.gaps.push({name:'Escala Especial '+(D.pricing.gaps.length),gapPct:10,markupCost:35,price:r2(D.price*0.9)});
        syncGapsFromBase();
        renderCostTab(box);
      }
      const del=e.target.closest('[data-gdel]');
      if(del){D.pricing.gaps.splice(+del.dataset.gdel,1);renderCostTab(box);}
    };
    drawGaps();
  };

  /* 3. PRESENTACIONES Y EMPAQUES */
  const renderPresTab=box=>{
    const taxRate=(D.tax.type==='E'||D.tax.type==='NS')?0:(D.tax.rate||16)/100;
    box.innerHTML=
      '<div class="gridwrap invwrap"><table class="grid">'+
        '<thead><tr><th>Presentación / Empaque</th><th>Unidad</th><th class="r">Equivalencia (Factor)</th><th>Código de Barras</th><th class="r">Precio US$ (sin IVA)</th><th class="r">Precio US$ (con IVA)</th><th></th></tr></thead>'+
        '<tbody id="prBody"></tbody>'+
      '</table></div>'+
      '<div class="fltgrid">'+
        '<div class="f"><label for="prName">Nueva Presentación</label><input class="fld" id="prName" placeholder="Ej: Caja x 6, Tambor, Blíster"></div>'+
        '<div class="f"><label for="prUnit">Unidad</label><input class="fld" id="prUnit" value="caja"></div>'+
        '<div class="f"><label for="prFactor">Factor (und. base)</label><input class="fld r" id="prFactor" value="6" inputmode="decimal"></div>'+
        '<div class="f"><label for="prBc">Código de Barras</label><input class="fld mono" id="prBc" value="'+esc(D.code)+'C6"></div>'+
        '<div class="f"><label for="prPrice">Precio US$ (sin IVA)</label><input class="fld r" id="prPrice" value="'+nf(r2(D.price*6*0.92))+'" inputmode="decimal"></div>'+
        '<div class="f" style="justify-content:flex-end"><button class="btn" id="prAddBtn">+ Agregar presentación</button></div>'+
      '</div>';

    const drawPres=()=>{
      $('#prBody',box).innerHTML=D.presentations.map((pr,i)=>
        '<tr data-pri="'+i+'">'+
          '<td><input class="fld cell-wide" data-prf="name" value="'+esc(pr.name)+'"></td>'+
          '<td><input class="fld cell" data-prf="unit" value="'+esc(pr.unit)+'"></td>'+
          '<td class="r"><input class="fld cell r" data-prf="factor" value="'+fq(pr.factor)+'" inputmode="decimal"></td>'+
          '<td><input class="fld cell-wide mono" data-prf="barcode" value="'+esc(pr.barcode||'')+'"></td>'+
          '<td class="r"><input class="fld cell r" data-prf="price" value="'+nf(pr.price)+'" inputmode="decimal"></td>'+
          '<td class="r"><b>'+nf(r2(pr.price*(1+taxRate)))+'</b></td>'+
          '<td class="c">'+(i===0?'Base':'<button class="mini" data-prdel="'+i+'">&times;</button>')+'</td>'+
        '</tr>'
      ).join('');
    };
    box.onchange=e=>{
      const t=e.target;if(!t.dataset.prf)return;
      const idx=+t.closest('tr').dataset.pri, pr=D.presentations[idx];
      if(t.dataset.prf==='name')pr.name=t.value.trim();
      if(t.dataset.prf==='unit')pr.unit=t.value.trim();
      if(t.dataset.prf==='factor')pr.factor=pn(t.value)||1;
      if(t.dataset.prf==='barcode')pr.barcode=t.value.trim();
      if(t.dataset.prf==='price'){pr.price=pn(t.value)||pr.price;if(idx===0)D.price=pr.price;}
      drawPres();updateHeaderBar();
    };
    box.onclick=e=>{
      if(e.target.id==='prAddBtn'){
        const name=$('#prName',box).value.trim()||'Empaque';
        const factor=pn($('#prFactor',box).value)||1;
        const price=pn($('#prPrice',box).value)||r2(D.price*factor);
        D.presentations.push({name,unit:$('#prUnit',box).value.trim()||'emp',factor,barcode:$('#prBc',box).value.trim(),price});
        renderPresTab(box);
      }
      const del=e.target.closest('[data-prdel]');
      if(del){D.presentations.splice(+del.dataset.prdel,1);drawPres();}
    };
    drawPres();
  };

  /* 4. IMPUESTOS */
  const renderTaxTab=box=>{
    const t=D.tax;
    const isEx=t.type==='E'||t.type==='NS';
    const ratePct=isEx?0:(t.rate||16);
    const ivaAmt=r2(D.price*(ratePct/100));
    const totUsd=r2(D.price+ivaAmt);
    const igtfAmt=t.igtf?r2(totUsd*IGTF):0;

    box.innerHTML=
      '<div class="fltgrid">'+
        '<div class="f wide"><label for="txType">Condición Fiscal / Tipo de Alícuota IVA</label>'+
          '<select class="fld" id="txType">'+
            '<option value="G"'+(t.type==='G'?' selected':'')+'>Gravado — Alícuota General (16 %)</option>'+
            '<option value="R"'+(t.type==='R'?' selected':'')+'>Gravado — Alícuota Reducida (8 %)</option>'+
            '<option value="A"'+(t.type==='A'?' selected':'')+'>Gravado — Alícuota Adicional / Suntuario (31 %)</option>'+
            '<option value="E"'+(t.type==='E'?' selected':'')+'>Exento de IVA (0 %)</option>'+
            '<option value="NS"'+(t.type==='NS'?' selected':'')+'>No Sujeto (0 %)</option>'+
          '</select>'+
        '</div>'+
        '<div class="f"><label for="txRate">Porcentaje IVA (%)</label><input class="fld r" id="txRate" value="'+fq(ratePct)+'" '+(isEx?'readonly':'')+' inputmode="decimal"></div>'+
        '<div class="f"><label for="txCode">Código Fiscal / Clasificador</label><input class="fld mono" id="txCode" value="'+esc(t.codeSeniat||'GRAV-16')+'"></div>'+
        '<div class="f"><label for="txPerc">Percepción / Imp. Municipal (%)</label><input class="fld r" id="txPerc" value="'+fq(t.percRate||0)+'" inputmode="decimal"></div>'+
        '<div class="f" style="justify-content:center"><label class="chk"><input type="checkbox" id="txIgtf" '+(t.igtf?'checked':'')+'> Sujeto a IGTF (3 %) en divisas</label></div>'+
      '</div>'+
      '<table class="sumt" style="max-width:520px">'+
        '<thead><tr><th>Simulación Fiscal sobre Precio Detal</th><th class="r">US$</th></tr></thead>'+
        '<tbody>'+
          '<tr><td>Base Imponible (Precio sin IVA)</td><td class="r">'+nf(D.price)+'</td></tr>'+
          '<tr><td>IVA ('+fq(ratePct)+' %)</td><td class="r">'+nf(ivaAmt)+'</td></tr>'+
          '<tr class="tot"><td>Precio de Venta con IVA</td><td class="r">'+nf(totUsd)+'</td></tr>'+
          '<tr><td>IGTF 3 % referencial (si paga en efectivo US$ / Zelle)</td><td class="r">'+nf(igtfAmt)+'</td></tr>'+
        '</tbody>'+
      '</table>';

    box.onchange=e=>{
      const elT=e.target;
      if(elT.id==='txType'){
        t.type=elT.value;
        if(t.type==='G'){t.rate=16;t.codeSeniat='GRAV-16';}
        else if(t.type==='R'){t.rate=8;t.codeSeniat='RED-08';}
        else if(t.type==='A'){t.rate=31;t.codeSeniat='ADIC-31';}
        else{t.rate=0;t.codeSeniat='EXENTO-0';}
      }
      if(elT.id==='txRate')t.rate=pnZero(elT.value)||0;
      if(elT.id==='txCode')t.codeSeniat=elT.value.trim();
      if(elT.id==='txPerc')t.percRate=pnZero(elT.value)||0;
      if(elT.id==='txIgtf')t.igtf=elT.checked;
      renderTaxTab(box);updateHeaderBar();
    };
  };

  /* 5. PROVEEDORES ASOCIADOS AL PRODUCTO (CON CREACIÓN DIRECTA DE PROVEEDOR, RIF, CÓDIGO DE BARRAS, COSTO OFRECIDO, OTROS) */
  const renderSupTab=box=>{
    const supOpts='<option value="__NEW__">+ Crear nuevo proveedor directamente…</option>'+
      S.suppliers.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' ('+esc(s.rif)+')</option>').join('');

    box.innerHTML=
      '<div class="gridwrap invwrap" style="max-height:190px"><table class="grid" style="min-width:820px">'+
        '<thead><tr><th>RIF Proveedor</th><th>Razón Social</th><th>Cód. Barras / Ref. Prov.</th><th class="r">Costo Ofrecido US$</th><th class="r">Entrega (días)</th><th class="r">Ped. Mín.</th><th>Otros / Condiciones</th><th></th></tr></thead>'+
        '<tbody id="asBody"></tbody>'+
      '</table></div>'+
      '<div class="group">'+
        '<div class="gtitle">Asociar proveedor o crear nuevo proveedor directamente</div>'+
        '<div class="newgrid" style="margin:4px 0">'+
          '<div class="f wide"><label for="asSel">Seleccionar del directorio o crear nuevo</label><select class="fld" id="asSel">'+supOpts+'</select></div>'+
          '<div class="f"><label for="asRif">RIF del Proveedor</label><input class="fld mono" id="asRif" placeholder="J-40000000-1"></div>'+
          '<div class="f wide"><label for="asName">Razón Social / Nombre del Proveedor</label><input class="fld" id="asName" placeholder="Ej: Importadora Repuestos del Centro, C.A."></div>'+
          '<div class="f"><label for="asTel">Teléfono / Contacto</label><input class="fld" id="asTel" placeholder="0414-000-0000"></div>'+
          '<div class="f"><label for="asBc">Código de Barras / SKU Proveedor</label><input class="fld mono" id="asBc" value="'+esc(D.code)+'-PRV"></div>'+
          '<div class="f"><label for="asCost">Precio de Costo Ofrecido US$</label><input class="fld r" id="asCost" value="'+nf(D.cost)+'" inputmode="decimal"></div>'+
          '<div class="f"><label for="asLead">Tiempo Entrega (días)</label><input class="fld r" id="asLead" value="3" inputmode="numeric"></div>'+
          '<div class="f"><label for="asMin">Pedido Mínimo (und)</label><input class="fld r" id="asMin" value="6" inputmode="numeric"></div>'+
          '<div class="f wide"><label for="asNotes">Otros datos (descuentos por volumen, garantía, crédito)</label><input class="fld" id="asNotes" placeholder="Ej: Crédito 15 días, 5% desc. por caja cerrada"></div>'+
        '</div>'+
        '<button class="btn primary" id="asAddBtn">Guardar Proveedor y Asociar al Producto</button>'+
      '</div>';

    const syncSupFields=()=>{
      const val=$('#asSel',box).value;
      const s=S.suppliers.find(x=>x.id===val);
      if(s){
        $('#asRif',box).value=s.rif;
        $('#asName',box).value=s.name;
        $('#asTel',box).value=s.tel||'';
      }else{
        $('#asRif',box).value='';
        $('#asName',box).value='';
        $('#asTel',box).value='';
      }
    };

    const drawAssoc=()=>{
      $('#asBody',box).innerHTML=D.assocSuppliers.length?D.assocSuppliers.map((a,i)=>
        '<tr>'+
          '<td class="mono">'+esc(a.rif)+'</td>'+
          '<td><b>'+esc(a.name)+'</b></td>'+
          '<td class="mono">'+esc(a.barcode||'-')+'</td>'+
          '<td class="r"><b>'+usd(a.cost)+'</b></td>'+
          '<td class="r">'+(a.leadDays||1)+' d</td>'+
          '<td class="r">'+(a.minOrder||1)+'</td>'+
          '<td>'+esc(a.notes||'')+'</td>'+
          '<td class="c"><button class="btn mini2" data-usecost="'+i+'" title="Fijar como costo base del producto">Usar costo</button> <button class="mini" data-asdel="'+i+'">&times;</button></td>'+
        '</tr>'
      ).join(''):'<tr class="empty"><td colspan="8">Sin proveedores asociados a este producto. Use el formulario inferior para crear o vincular uno.</td></tr>';
    };

    box.onchange=e=>{if(e.target.id==='asSel')syncSupFields();};
    box.onclick=e=>{
      if(e.target.id==='asAddBtn'){
        const rif=$('#asRif',box).value.trim().toUpperCase(), name=$('#asName',box).value.trim();
        const cost=pn($('#asCost',box).value)||D.cost;
        if(!rif||!name){msg('Indique el RIF y la Razón Social del proveedor.','bad');return;}
        /* Si no existe en S.suppliers, lo crea directamente */
        let sup=S.suppliers.find(s=>s.rif.toUpperCase()===rif||norm(s.name)===norm(name));
        if(!sup){
          sup={id:'PRV-'+two(S.suppliers.length+1),name,rif,tel:$('#asTel',box).value.trim(),cond:'15 días'};
          S.suppliers.push(sup);
        }
        D.assocSuppliers.push({
          supId:sup.id,rif:sup.rif,name:sup.name,
          barcode:$('#asBc',box).value.trim()||D.code,
          cost,
          leadDays:Math.round(pn($('#asLead',box).value)||1),
          minOrder:Math.round(pn($('#asMin',box).value)||1),
          notes:$('#asNotes',box).value.trim()
        });
        save();
        renderSupTab(box);
        msg('Proveedor '+sup.name+' asociado al producto.');
      }
      const uc=e.target.closest('[data-usecost]');
      if(uc){
        const a=D.assocSuppliers[+uc.dataset.usecost];
        if(a){
          D.cost=a.cost;
          const nc=Math.max(0.01,effCost());
          D.price=r2(nc*(1+(D.pricing.markupCost||50)/100));
          syncGapsFromBase();
          updateHeaderBar();
          msg('Costo base actualizado a '+usd(a.cost)+' según oferta de '+a.name+'.');
        }
      }
      const del=e.target.closest('[data-asdel]');
      if(del){D.assocSuppliers.splice(+del.dataset.asdel,1);drawAssoc();}
    };
    drawAssoc();
  };

  /* 6. KIT / COMBO */
  const renderKitTab=box=>{
    const prodOpts=S.products.filter(p=>p.code!==D.code).map(p=>'<option value="'+esc(p.code)+'">'+esc(p.code)+' — '+esc(p.desc)+' ('+esc(p.brand)+') [Costo: '+usd(p.cost)+' | P.Venta: '+usd(p.price)+']</option>').join('');
    box.innerHTML=
      '<div class="invbar" style="background:var(--alt);padding:6px 8px;border:1px solid var(--lo);justify-content:space-between">'+
        '<label class="chk"><input type="checkbox" id="ktActive" '+(D.isKit?'checked':'')+'> <b>Este producto es un Kit / Combo compuesto por varios artículos</b></label>'+
        '<button class="btn mini2" id="ktApplyCost">Adoptar costo y precio sugerido del Combo</button>'+
      '</div>'+
      '<div class="invbar">'+
        '<label for="ktProd">Componente</label><select class="fld" id="ktProd" style="flex:2">'+prodOpts+'</select>'+
        '<label for="ktQty">Cantidad en el Kit</label><input class="fld r" id="ktQty" value="1" style="max-width:80px" inputmode="decimal">'+
        '<button class="btn" id="ktAddBtn">+ Agregar componente al Kit</button>'+
      '</div>'+
      '<div class="gridwrap invwrap" style="max-height:200px"><table class="grid">'+
        '<thead><tr><th>Código</th><th>Componente</th><th class="r">Cantidad</th><th class="r">Costo Unit. US$</th><th class="r">Subtotal Costo US$</th><th class="r">Precio Ind. US$</th><th></th></tr></thead>'+
        '<tbody id="ktBody"></tbody>'+
      '</table></div>'+
      '<div class="kpis" id="ktKpis"></div>';

    const drawKit=()=>{
      let sumCost=0, sumPrice=0;
      $('#ktBody',box).innerHTML=D.kitItems.length?D.kitItems.map((k,i)=>{
        const cp=prod(k.code)||{desc:k.desc||'Producto',cost:k.cost||0,price:k.price||0};
        const sc=r2(cp.cost*k.qty), sp=r2(cp.price*k.qty);
        sumCost+=sc;sumPrice+=sp;
        return '<tr>'+
          '<td class="mono">'+esc(k.code)+'</td>'+
          '<td><b>'+esc(cp.desc)+'</b></td>'+
          '<td class="r">'+fq(k.qty)+'</td>'+
          '<td class="r">'+nf(cp.cost)+'</td>'+
          '<td class="r"><b>'+nf(sc)+'</b></td>'+
          '<td class="r">'+nf(sp)+'</td>'+
          '<td class="c"><button class="mini" data-ktdel="'+i+'">&times;</button></td>'+
        '</tr>';
      }).join(''):'<tr class="empty"><td colspan="7">Sin componentes agregados. Añada los productos que integran este Kit o Combo (ej: 4 L Aceite + 1 Filtro).</td></tr>';
      sumCost=r2(sumCost);sumPrice=r2(sumPrice);
      const sugCombo=r2(sumPrice*0.90);
      $('#ktKpis',box).innerHTML=
        '<div class="kpi"><span>Costo Total Componentes</span><b>'+usd(sumCost)+'</b><small>Suma de costos del kit</small></div>'+
        '<div class="kpi"><span>Suma Precios Individuales</span><b>'+usd(sumPrice)+'</b><small>Si se compran por separado</small></div>'+
        '<div class="kpi"><span>Precio Combo Sugerido (-10%)</span><b class="ok">'+usd(sugCombo)+'</b><small>Ahorro cliente: '+usd(r2(sumPrice-sugCombo))+'</small></div>';
    };

    box.onchange=e=>{if(e.target.id==='ktActive')D.isKit=e.target.checked;};
    box.onclick=e=>{
      if(e.target.id==='ktAddBtn'){
        const code=$('#ktProd',box).value, qty=pn($('#ktQty',box).value)||1, cp=prod(code);
        if(!cp)return;
        D.isKit=true;$('#ktActive',box).checked=true;
        const ex=D.kitItems.find(x=>x.code===code);
        if(ex)ex.qty=r2(ex.qty+qty);
        else D.kitItems.push({code,desc:cp.desc,qty,cost:cp.cost,price:cp.price});
        drawKit();
      }
      if(e.target.id==='ktApplyCost'){
        if(!D.kitItems.length){msg('Agregue componentes al Kit primero.','bad');return;}
        let sc=0,sp=0;
        D.kitItems.forEach(k=>{const cp=prod(k.code);if(cp){sc+=cp.cost*k.qty;sp+=cp.price*k.qty;}});
        D.cost=r2(sc);D.price=r2(sp*0.90);
        syncGapsFromBase();updateHeaderBar();
        msg('Se aplicó el costo ('+usd(D.cost)+') y precio combo sugerido ('+usd(D.price)+') al producto.');
      }
      const del=e.target.closest('[data-ktdel]');
      if(del){D.kitItems.splice(+del.dataset.ktdel,1);drawKit();}
    };
    drawKit();
  };

  el.addEventListener('click',e=>{
    const b=e.target.closest('[data-pftab]');
    if(b){tab=b.dataset.pftab;renderTab();}
  });

  const saveProduct=(closeAfter=true)=>{
    if(!D.code||!D.desc.trim()||!D.price){
      msg('Complete el código, la descripción y el precio de venta del producto.','bad');
      return false;
    }
    if(!existing&&prod(D.code)){
      msg('Ya existe otro producto con el código '+D.code+'.','bad');
      return false;
    }
    if(autoSku)D.sku=genAutoSku(D.dept,D.cat,D.subcat,nextSeq);
    syncGapsFromBase();
    if(existing){
      const prevStock=existing.stock;
      Object.assign(existing,D);
      if(Math.abs(existing.stock-prevStock)>1e-9){
        addKardex({
          code:existing.code,type:'AJUSTE',dir:existing.stock>prevStock?'IN':'OUT',
          doc:'FICHA-PROD',party:'Actualización en Ficha Técnica de Producto',
          qty:Math.abs(r2(existing.stock-prevStock)),stockAfter:existing.stock,cost:existing.cost,user:S.cfg.cajero
        });
      }
    }else{
      S.products.push(D);
      addKardex({
        code:D.code,type:'INICIAL',dir:'IN',doc:'ALTA-SKU',
        party:'Alta de producto ('+D.sku+')',qty:D.stock,stockAfter:D.stock,cost:D.cost,user:S.cfg.cajero
      });
    }
    save();renderCatOptions();renderAll();
    msg('Producto '+D.desc+' ('+D.sku+') guardado correctamente.');
    if(closeAfter){inventoryDlg();return false;}
    return true;
  };

  openWin({
    title:(existing?'Editar Ficha de Producto — '+existing.sku:'Nuevo Producto — Ficha Integral y Motores de Precio'),
    w:1020,
    body:el,
    foot:[
      {label:'Generar Etiqueta / Hablador SKU (US$)',left:true,fn:()=>{if(saveProduct(false))labelGeneratorDlg(D.code);return false;}},
      {label:'Volver a Inventario',fn:()=>{inventoryDlg();return false;}},
      {label:'Guardar Producto',primary:true,fn:()=>saveProduct(true)}
    ],
    onEnter:()=>{},
    onOpen:()=>{renderTab();if(initialMasterItem)applyMasterProduct(initialMasterItem);}
  });
}

/* ---------- búsqueda general de productos (solo consulta) ---------- */
function productViewDlg(p){
  if(!p)return;
  const pres=Array.isArray(p.presentations)?p.presentations:[];
  const suppliers=Array.isArray(p.assocSuppliers)?p.assocSuppliers:[];
  const kit=Array.isArray(p.kitItems)?p.kitItems:[];
  const tax=prodTaxTag(p);
  const pricing=p.pricing||{};
  const gaps=Array.isArray(pricing.gaps)?pricing.gaps:[];
  const photo=p.photo?'<img src="'+esc(p.photo)+'" alt="Foto de '+esc(p.desc)+'" style="width:112px;height:112px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff;padding:5px">':'<div style="width:112px;height:112px;display:grid;place-items:center;border:1px solid var(--line);border-radius:8px;color:var(--muted)">'+ico('inventario')+'<span style="font-size:11px">Sin foto</span></div>';
  const field=(label,value)=>'<div class="pv-field"><span>'+esc(label)+'</span><b>'+esc(value===undefined||value===null||value===''?'-':String(value))+'</b></div>';
  const section=(title,content)=>'<section class="pv-section"><h3>'+esc(title)+'</h3>'+content+'</section>';
  let html='<div class="form product-view" style="gap:14px">'+
    '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">'+photo+'<div style="flex:1;min-width:220px"><div class="dim">FICHA INFORMATIVA · SOLO LECTURA</div><h2 style="margin:5px 0">'+esc(p.desc||'Producto sin descripción')+'</h2><div class="sub">'+esc(p.brand||'-')+(p.isKit?' · KIT / COMBO':'')+'</div><div style="margin-top:8px"><span class="um-tag">'+esc((p.unit||'und').toUpperCase())+'</span> <span class="iva-tag '+prodTaxCls(p)+'">'+esc(tax)+'</span></div></div></div>'+
    section('Identificación','<div class="pv-grid">'+field('Código / EAN',p.code)+field('SKU',p.sku)+field('Código OEM',p.oem)+field('Marca',p.brand)+'</div>')+
    section('Clasificación y ubicación','<div class="pv-grid">'+field('Departamento',p.dept)+field('Categoría',p.cat)+field('Subcategoría',p.subcat)+field('Pasillo / Ubicación',p.loc)+field('Unidad de medida',(p.unit||'und').toUpperCase())+'</div>')+
    section('Existencias y precios','<div class="pv-grid">'+field('Existencia',fq(Number(p.stock)||0)+' '+(p.unit||'und'))+field('Stock mínimo',fq(Number(p.min)||0))+field('Costo unitario',usd(Number(p.cost)||0))+field('Flete unitario',usd(Number(p.freight)||0))+field('Precio base sin IVA',usd(Number(p.price)||0))+field('Precio con IVA',usd(r2((Number(p.price)||0)*(1+prodTaxRate(p)/100))))+field('Impuesto',tax)+'</div>');
  if(gaps.length)html+=section('Precios por modalidad','<div class="gridwrap"><table class="grid"><thead><tr><th>Modalidad</th><th class="r">Descuento / brecha</th><th class="r">Precio US$</th></tr></thead><tbody>'+gaps.map(g=>'<tr><td>'+esc(g.name||'-')+'</td><td class="r">'+fq(Number(g.gapPct)||0)+'%</td><td class="r">'+nf(Number(g.price)||0)+'</td></tr>').join('')+'</tbody></table></div>');
  if(pres.length)html+=section('Presentaciones y códigos asociados','<div class="gridwrap"><table class="grid"><thead><tr><th>Presentación</th><th>U.M.</th><th class="r">Factor</th><th>Código de barras</th><th class="r">Precio US$</th></tr></thead><tbody>'+pres.map(pr=>'<tr><td>'+esc(pr.name||'-')+'</td><td>'+esc(pr.unit||p.unit||'und')+'</td><td class="r">'+fq(Number(pr.factor)||1)+'</td><td class="mono">'+esc(pr.barcode||'-')+'</td><td class="r">'+nf(Number(pr.price)||0)+'</td></tr>').join('')+'</tbody></table></div>');
  if(suppliers.length)html+=section('Proveedores asociados','<div class="gridwrap"><table class="grid"><thead><tr><th>RIF</th><th>Proveedor</th><th>Código proveedor</th><th class="r">Costo US$</th><th>Notas</th></tr></thead><tbody>'+suppliers.map(a=>'<tr><td>'+esc(a.rif||'-')+'</td><td>'+esc(a.name||'-')+'</td><td class="mono">'+esc(a.barcode||'-')+'</td><td class="r">'+nf(Number(a.cost)||0)+'</td><td>'+esc(a.notes||'-')+'</td></tr>').join('')+'</tbody></table></div>');
  if(p.isKit)html+=section('Componentes del kit / combo','<div class="gridwrap"><table class="grid"><thead><tr><th>Código</th><th>Producto</th><th class="r">Cantidad</th></tr></thead><tbody>'+kit.map(k=>{const cp=prod(k.code);return '<tr><td class="mono">'+esc(k.code||'-')+'</td><td>'+esc(cp?cp.desc:(k.desc||'Producto'))+'</td><td class="r">'+fq(Number(k.qty)||0)+'</td></tr>';}).join('')+'</tbody></table></div>');
  html+='</div>';
  const style='<style>.product-view .pv-section{border:1px solid var(--line);border-radius:8px;padding:11px;display:grid;gap:9px}.product-view .pv-section h3{margin:0;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.product-view .pv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}.product-view .pv-field{display:flex;flex-direction:column;gap:3px;min-width:0}.product-view .pv-field span{font-size:11px;color:var(--muted)}.product-view .pv-field b{font-size:13px;overflow-wrap:anywhere}</style>';
  openWin({title:'Ficha informativa del producto',w:820,body:style+html,foot:[{label:'Cerrar',primary:true}]});
}
function searchCatalogDlg(){
  const el=h('<div class="form" style="gap:10px"><label for="catalogSearchQ">Buscar por código, SKU, descripción, marca, departamento, categoría o ubicación</label><input class="fld big" id="catalogSearchQ" autocomplete="off" placeholder="Escriba para ver productos coincidentes…"><div class="dim" id="catalogSearchSummary">Escriba para buscar en el inventario.</div><div class="gridwrap tallwrap"><table class="grid" style="min-width:850px"><thead><tr><th>Código / SKU</th><th>Producto / Marca</th><th>Departamento / Categoría</th><th class="r">Existencia</th><th class="r">Precio US$</th><th class="c">Ver</th></tr></thead><tbody id="catalogSearchBody"><tr class="empty"><td colspan="6">Escriba un término de búsqueda.</td></tr></tbody></table></div><div class="hint">Use el botón con el ojo para consultar la ficha completa. Esta ventana no permite editar ni agregar productos a la venta.</div></div>');
  const input=$('#catalogSearchQ',el);
  const draw=()=>{
    const q=input.value.trim();
    const list=q?searchProducts(q,'Todas'): [];
    $('#catalogSearchSummary',el).textContent=q?(list.length+' producto(s) coincidente(s)'+(list.length>200?' · Mostrando los primeros 200':'')+'.'):'Escriba para buscar en el inventario.';
    $('#catalogSearchBody',el).innerHTML=list.length?list.slice(0,200).map(p=>'<tr><td class="mono"><b>'+esc(p.sku||p.code)+'</b><div class="sub">EAN: '+esc(p.code)+'</div></td><td>'+(p.photo?'<img class="thumb-sm" src="'+esc(p.photo)+'" alt="">':'')+'<b>'+esc(p.desc)+'</b><div class="sub">'+esc(p.brand||'-')+'</div></td><td>'+esc(p.dept||'-')+'<div class="sub">'+esc(p.cat||'-')+' › '+esc(p.subcat||'-')+'</div></td><td class="r '+stockCls(p)+'">'+fq(Number(p.stock)||0)+' '+esc(p.unit||'und')+'</td><td class="r">'+nf(Number(p.price)||0)+'</td><td class="c"><button class="btn mini2" data-view="'+esc(p.code)+'" title="Ver ficha informativa de '+esc(p.desc)+'" aria-label="Ver ficha de '+esc(p.desc)+'">'+ico('ver')+'</button></td></tr>').join(''):'<tr class="empty"><td colspan="6">'+(q?'No se encontraron productos coincidentes.':'Escriba un término de búsqueda.')+'</td></tr>';
  };
  input.addEventListener('input',draw);
  el.addEventListener('click',e=>{
    const b=e.target.closest('[data-view]');
    if(!b)return;
    const p=prod(b.dataset.view);
    if(p)productViewDlg(p);
  });
  openWin({title:'Buscar productos',w:980,body:el,foot:[{label:'Cerrar',primary:true}],onEnter:()=>draw(),onOpen:()=>input.focus()});
}

/* ---------- inventario ---------- */
function inventoryDlg(){
  const el=h('<div class="form"><div class="invbar"><label for="invQ">Buscar</label><input class="fld" id="invQ" placeholder="SKU, código, marca, depto, categoría o descripción" autocomplete="off"><label class="chk"><input type="checkbox" id="invLow"> Solo bajo mínimo</label><button class="btn primary" id="btnMasterCat">🔍 Catálogo Maestro (2.5M repuestos)</button><button class="btn" id="btnNewProd">+ Nuevo en Blanco</button><button class="btn mini2" id="btnGoConteo">Conteo físico masivo…</button><button class="btn mini2" id="btnGoLabels">Habladores / Etiquetas SKU</button></div><div class="dim" id="invSum"></div><div class="gridwrap tallwrap"><table class="grid" style="min-width:1040px"><thead><tr><th>SKU / Código</th><th>Descripción / Marca</th><th>Depto. / Categoría / Subcat.</th><th>Pas.</th><th class="c" style="width:68px">U.M.</th><th class="c" style="width:90px">I.V.A.</th><th class="r">Existencia</th><th class="r">Mín.</th><th class="r">Costo US$</th><th class="r">Precio US$</th><th class="c">Acciones</th></tr></thead><tbody id="invBody"></tbody></table></div></div>');
  const rows=()=>{
    const q=$('#invQ',el).value,low=$('#invLow',el).checked;
    return searchProducts(q,'Todas').filter(p=>!low||p.stock<=p.min);
  };
  const sum=()=>{
    const n=S.products.length,low=S.products.filter(p=>p.stock<=p.min&&p.stock>0).length,out=S.products.filter(p=>p.stock<=0).length;
    const valCost=S.products.reduce((a,p)=>a+p.cost*p.stock,0);
    const valSale=S.products.reduce((a,p)=>a+p.price*p.stock,0);
    $('#invSum',el).textContent=n+' productos · '+low+' bajo mínimo · '+out+' agotados · Costo total '+usd(valCost)+' · Valor venta '+usd(valSale);
  };
  const draw=()=>{
    const list=rows();
    $('#invBody',el).innerHTML=list.length?list.map(p=>'<tr data-code="'+esc(p.code)+'" class="'+(p.stock<=0?'rowout':(p.stock<=p.min?'rowlow':''))+'">'+
      '<td class="mono"><div><b>'+esc(p.sku||p.code)+'</b></div><div class="sub">EAN: '+esc(p.code)+'</div></td>'+
      '<td>'+(p.photo?'<img class="thumb-sm" src="'+esc(p.photo)+'" alt="">':'')+'<span class="desc">'+esc(p.desc)+'</span><div class="sub">'+esc(p.brand)+(p.isKit?' · [KIT/COMBO]':'')+'</div></td>'+
      '<td><div>'+esc(p.dept)+'</div><div class="sub">'+esc(p.cat)+' &rsaquo; '+esc(p.subcat)+'</div></td>'+
      '<td>'+esc(p.loc)+'</td>'+
      '<td class="c"><select class="fld cell" data-f="unit" style="width:64px;padding:1px 2px" title="Unidad de Medida (U.M.)">'+
        UM_OPTIONS.map(u=>'<option value="'+u.id+'"'+(p.unit===u.id?' selected':'')+'>'+u.id.toUpperCase()+'</option>').join('')+
      '</select></td>'+
      '<td class="c"><select class="fld cell" data-f="tax" style="width:88px;padding:1px 2px" title="Alícuota de I.V.A.">'+
        '<option value="G" '+(p.tax&&p.tax.type==='G'?'selected':'')+'>16% (G)</option>'+
        '<option value="R" '+(p.tax&&p.tax.type==='R'?'selected':'')+'>8% (R)</option>'+
        '<option value="A" '+(p.tax&&p.tax.type==='A'?'selected':'')+'>31% (A)</option>'+
        '<option value="E" '+(p.tax&&(p.tax.type==='E'||p.tax.type==='NS')?'selected':'')+'>0% (Exento)</option>'+
      '</select></td>'+
      '<td class="r"><input class="fld cell r" data-f="stock" value="'+fq(p.stock)+'" inputmode="decimal" aria-label="Existencia de '+esc(p.desc)+'"></td>'+
      '<td class="r"><input class="fld cell r" data-f="min" value="'+fq(p.min)+'" inputmode="decimal" aria-label="Mínimo de '+esc(p.desc)+'"></td>'+
      '<td class="r"><input class="fld cell r" data-f="cost" value="'+nf(p.cost)+'" inputmode="decimal" aria-label="Costo de '+esc(p.desc)+'"></td>'+
      '<td class="r"><input class="fld cell r" data-f="price" value="'+nf(p.price)+'" inputmode="decimal" aria-label="Precio de '+esc(p.desc)+'"></td>'+
      '<td class="c" style="white-space:nowrap"><button class="btn mini2" data-edit="'+esc(p.code)+'" title="Editar ficha, costos, presentaciones, proveedores y kit">Ficha</button> <button class="btn mini2" data-lbl="'+esc(p.code)+'" title="Generar hablador / etiqueta SKU">SKU</button> <button class="btn mini2" data-kx="'+esc(p.code)+'">Kardex</button></td>'+
    '</tr>').join(''):'<tr class="empty"><td colspan="11">Sin productos que coincidan.</td></tr>';
    sum();
  };
  el.addEventListener('input',e=>{if(e.target.id==='invQ')draw();});
  el.addEventListener('change',e=>{
    if(e.target.id==='invLow'){draw();return;}
    const f=e.target.dataset.f;if(!f)return;
    const tr=e.target.closest('tr'),p=prod(tr.dataset.code),v=pn(e.target.value);
    if(f==='stock'){
      const prev=p.stock;
      const next=e.target.value.trim()==='0'?0:(v||p.stock);
      if(Math.abs(next-prev)>1e-9){
        p.stock=next;
        addKardex({
          code:p.code,
          type:'AJUSTE',
          dir:next>prev?'IN':'OUT',
          doc:'AJU-DIR',
          party:'Ajuste directo en maestro de inventario',
          qty:Math.abs(r2(next-prev)),
          stockAfter:next,
          cost:p.cost,
          user:S.cfg.cajero
        });
      }
    }
    else if(f==='min'){p.min=e.target.value.trim()==='0'?0:(v||p.min);}
    else if(f==='cost'){p.cost=v||p.cost;}
    else if(f==='price'){p.price=v||p.price;}
    else if(f==='unit'){
      p.unit=e.target.value.trim()||'und';
      msg('U.M. de "'+p.desc+'" actualizada a '+p.unit.toUpperCase()+'.');
    }
    else if(f==='tax'){
      const val=e.target.value;
      if(val==='E')p.tax={type:'E',rate:0,igtf:true,percRate:0,codeSeniat:'EXENTO-0'};
      else if(val==='R')p.tax={type:'R',rate:8,igtf:true,percRate:0,codeSeniat:'RED-08'};
      else if(val==='A')p.tax={type:'A',rate:31,igtf:true,percRate:0,codeSeniat:'ADIC-31'};
      else p.tax={type:'G',rate:16,igtf:true,percRate:0,codeSeniat:'GRAV-16'};
      msg('I.V.A. de "'+p.desc+'" actualizado a '+prodTaxTag(p)+'.');
    }
    if(f==='price'||f==='cost')e.target.value=nf(p[f]);
    else if(f==='stock'||f==='min')e.target.value=fq(p[f]);
    tr.className=p.stock<=0?'rowout':(p.stock<=p.min?'rowlow':'');
    save();sum();renderCatalog();renderCart();
  });
  el.addEventListener('click',e=>{
    if(e.target.id==='btnMasterCat'){
      masterCatalogBrowserDlg(item=>{
        productFormDlg(null,'gen',item);
      });
      return;
    }
    if(e.target.id==='btnNewProd'){productFormDlg(null,'gen');return;}
    if(e.target.id==='btnGoConteo'){conteoDlg();return;}
    if(e.target.id==='btnGoLabels'){labelGeneratorDlg();return;}
    const ed=e.target.closest('[data-edit]');if(ed){productFormDlg(ed.dataset.edit,'gen');return;}
    const lb=e.target.closest('[data-lbl]');if(lb){labelGeneratorDlg(lb.dataset.lbl);return;}
    const kx=e.target.closest('[data-kx]');if(kx){kardexDlg(kx.dataset.kx);return;}
  });
  openWin({title:'Inventario y Maestro de Productos',w:1080,body:el,foot:[{label:'Cerrar',primary:true}],onEnter:()=>{},onOpen:()=>{draw();}});
}

/* ---------- MÓDULO DE COMPRAS Y PROVEEDORES ---------- */
function comprasDlg(initialTab){
  let tab=initialTab||'new';
  let supIdx=0;
  let pLines=[
    {code:'7501008',qty:12,cost:4.85,price:7.50},
    {code:'7504004',qty:10,cost:3.45,price:5.40}
  ];
  let cond='Crédito', creditDays=15, applyIva=true, paidInit=0, payMethod='Transferencia Bs.';

  const el=h('<div class="form"><div class="tabs"><button class="tab" data-tab="new">Registrar Compra de Mercancía</button><button class="tab" data-tab="hist">Historial de Compras</button><button class="tab" data-tab="sup">Directorio de Proveedores</button></div><div id="compView"></div></div>');

  const renderView=()=>{
    $$('.tab',el).forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    const v=$('#compView',el);
    if(tab==='new')renderNewPurchase(v);
    else if(tab==='hist')renderPurchaseHist(v);
    else renderSuppliersTab(v);
  };

  const renderNewPurchase=v=>{
    const supOpts=S.suppliers.map((s,i)=>'<option value="'+i+'"'+(i===supIdx?' selected':'')+'>'+esc(s.name)+' ('+esc(s.rif)+')</option>').join('');
    const prodOpts=S.products.map(p=>'<option value="'+esc(p.code)+'">'+esc(p.code)+' — '+esc(p.desc)+' ('+esc(p.brand)+') [Stock: '+fq(p.stock)+']</option>').join('');
    v.innerHTML=
      '<div class="fltgrid">'+
        '<div class="f" style="grid-column:span 2"><label for="cpSup">Proveedor</label><select class="fld" id="cpSup">'+supOpts+'</select></div>'+
        '<div class="f"><label for="cpDoc">Nº Factura / Control Prov.</label><input class="fld mono" id="cpDoc" value="F-'+pad(S.purchaseSeq*41,6)+'" autocomplete="off"></div>'+
        '<div class="f"><label for="cpCond">Condición de Compra</label><select class="fld" id="cpCond"><option value="Crédito"'+(cond==='Crédito'?' selected':'')+'>Crédito (Genera CxP)</option><option value="Contado"'+(cond==='Contado'?' selected':'')+'>Contado (Pagada)</option></select></div>'+
        '<div class="f" id="cpDaysWrap"><label for="cpDays">Plazo Crédito (días)</label><input class="fld r" id="cpDays" value="'+creditDays+'" inputmode="numeric"></div>'+
        '<div class="f"><label for="cpInit">Abono / Pago Inicial US$</label><input class="fld r" id="cpInit" value="'+(paidInit?nf(paidInit):'0,00')+'" inputmode="decimal"></div>'+
        '<div class="f"><label for="cpMethod">Medio de Pago Inicial</label><select class="fld" id="cpMethod">'+METHODS.map(m=>'<option value="'+esc(m.name)+'"'+(payMethod===m.name?' selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></div>'+
      '</div>'+
      '<div class="invbar">'+
        '<label for="cpAddProd">Agregar producto</label>'+
        '<select class="fld" id="cpAddProd" style="flex:2">'+prodOpts+'</select>'+
        '<label for="cpAddQty">Cant.</label>'+
        '<input class="fld r" id="cpAddQty" value="6" style="max-width:75px" inputmode="decimal">'+
        '<button class="btn" id="cpBtnAdd">+ Agregar renglón</button>'+
        '<label class="chk" style="margin-left:auto"><input type="checkbox" id="cpIva" '+(applyIva?'checked':'')+'> Incluye IVA 16 %</label>'+
      '</div>'+
      '<div class="gridwrap invwrap"><table class="grid" style="min-width:820px">'+
        '<thead><tr><th>Código</th><th>Producto</th><th class="r">Stock Act.</th><th class="r">Cantidad Recibida</th><th class="r">Costo Unit. US$</th><th class="r">P. Venta US$</th><th class="r">Subtotal US$</th><th></th></tr></thead>'+
        '<tbody id="cpBody"></tbody>'+
      '</table></div>'+
      '<div class="cierre" id="cpTotals"></div>';

    const drawLines=()=>{
      $('#cpDaysWrap',v).style.display=cond==='Crédito'?'':'none';
      $('#cpBody',v).innerHTML=pLines.length?pLines.map((l,i)=>{
        const p=prod(l.code);if(!p)return '';
        const sub=r2(l.qty*l.cost);
        return '<tr data-pi="'+i+'">'+
          '<td class="mono">'+esc(p.code)+'</td>'+
          '<td><div class="desc">'+esc(p.desc)+'</div><div class="sub">'+esc(p.brand)+' · '+esc(p.cat)+'</div></td>'+
          '<td class="r '+stockCls(p)+'">'+fq(p.stock)+'</td>'+
          '<td class="r"><input class="fld cell r" data-cpf="qty" value="'+fq(l.qty)+'" inputmode="decimal"></td>'+
          '<td class="r"><input class="fld cell r" data-cpf="cost" value="'+nf(l.cost)+'" inputmode="decimal"></td>'+
          '<td class="r"><input class="fld cell r" data-cpf="price" value="'+nf(l.price)+'" inputmode="decimal"></td>'+
          '<td class="r"><b>'+nf(sub)+'</b></td>'+
          '<td class="c"><button class="mini" data-cpdel="'+i+'" title="Quitar">&times;</button></td>'+
        '</tr>';
      }).join(''):'<tr class="empty"><td colspan="8">Agregue productos a la orden de compra.</td></tr>';

      const base=r2(pLines.reduce((a,l)=>a+r2(l.qty*l.cost),0));
      const iva=applyIva?r2(base*IVA):0;
      const tot=r2(base+iva);
      const effPaid=cond==='Contado'?tot:Math.min(tot,paidInit);
      const pend=r2(Math.max(0,tot-effPaid));
      $('#cpTotals',v).innerHTML=
        '<table class="sumt"><thead><tr><th>Resumen de Compra</th><th class="r">US$</th><th class="r">Bs. (Tasa '+nf(S.cfg.rate)+')</th></tr></thead><tbody>'+
          '<tr><td>Base imponible (Costo mercancía)</td><td class="r">'+nf(base)+'</td><td class="r">'+nf(base*S.cfg.rate)+'</td></tr>'+
          '<tr><td>IVA 16 % Crédito Fiscal</td><td class="r">'+nf(iva)+'</td><td class="r">'+nf(iva*S.cfg.rate)+'</td></tr>'+
          '<tr class="tot"><td>Total Factura de Compra</td><td class="r">'+nf(tot)+'</td><td class="r">'+nf(tot*S.cfg.rate)+'</td></tr>'+
        '</tbody></table>'+
        '<table class="sumt"><thead><tr><th>Condición Financiera</th><th class="r">US$</th><th class="r">Bs.</th></tr></thead><tbody>'+
          '<tr><td>Modalidad</td><td colspan="2" class="r"><b>'+esc(cond)+(cond==='Crédito'?' ('+creditDays+' días)':'')+'</b></td></tr>'+
          '<tr class="good"><td>Monto Pagado / Abonado</td><td class="r">'+nf(effPaid)+'</td><td class="r">'+nf(effPaid*S.cfg.rate)+'</td></tr>'+
          '<tr class="'+(pend>0?'warn':'')+'"><td>Saldo a Cuentas por Pagar (CxP)</td><td class="r">'+nf(pend)+'</td><td class="r">'+nf(pend*S.cfg.rate)+'</td></tr>'+
        '</tbody></table>';
    };

    v.onchange=e=>{
      const t=e.target;
      if(t.id==='cpSup'){supIdx=+t.value;return;}
      if(t.id==='cpCond'){cond=t.value;drawLines();return;}
      if(t.id==='cpDays'){creditDays=Math.max(1,Math.round(pn(t.value)||15));drawLines();return;}
      if(t.id==='cpInit'){paidInit=pn(t.value);t.value=nf(paidInit);drawLines();return;}
      if(t.id==='cpMethod'){payMethod=t.value;return;}
      if(t.id==='cpIva'){applyIva=t.checked;drawLines();return;}
      if(t.dataset.cpf){
        const tr=t.closest('tr'), idx=+tr.dataset.pi, l=pLines[idx];
        const val=pn(t.value);
        if(t.dataset.cpf==='qty')l.qty=val||1;
        if(t.dataset.cpf==='cost')l.cost=val||l.cost;
        if(t.dataset.cpf==='price')l.price=val||l.price;
        drawLines();
      }
    };
    v.onclick=e=>{
      if(e.target.id==='cpBtnAdd'){
        const code=$('#cpAddProd',v).value, qty=pn($('#cpAddQty',v).value)||1, p=prod(code);
        if(!p)return;
        const ex=pLines.find(x=>x.code===code);
        if(ex)ex.qty=r2(ex.qty+qty);
        else pLines.push({code,qty,cost:p.cost,price:p.price});
        drawLines();
      }
      const del=e.target.closest('[data-cpdel]');
      if(del){pLines.splice(+del.dataset.cpdel,1);drawLines();}
    };
    drawLines();
  };

  const renderPurchaseHist=v=>{
    const list=(S.purchases||[]).slice().sort((a,b)=>b.no-a.no);
    v.innerHTML=
      '<div class="gridwrap tallwrap"><table class="grid" style="min-width:820px">'+
        '<thead><tr><th>Compra Nº</th><th>Fac. Prov.</th><th>Fecha</th><th>Proveedor</th><th>Condición</th><th class="r">Total US$</th><th class="r">Pagado US$</th><th class="r">Saldo CxP</th><th>Acción</th></tr></thead>'+
        '<tbody>'+(list.length?list.map(c=>{
          const pend=r2(Math.max(0,c.total-(c.paid||0)));
          return '<tr class="'+(c.void?'void':'')+'">'+
            '<td class="mono">COM-'+pad(c.no)+'</td>'+
            '<td class="mono">'+esc(c.docProv)+'</td>'+
            '<td>'+fmtDT(c.ts)+'</td>'+
            '<td>'+esc(c.supplier.name)+'</td>'+
            '<td>'+esc(c.cond)+'</td>'+
            '<td class="r">'+nf(c.total)+'</td>'+
            '<td class="r">'+nf(c.paid||0)+'</td>'+
            '<td class="r '+(pend>0&&!c.void?'st-low':'')+'">'+(c.void?'ANULADA':nf(pend))+'</td>'+
            '<td class="c">'+(c.void?'—':'<button class="btn mini2" data-void-comp="'+c.no+'">Anular</button>')+'</td>'+
          '</tr>';
        }).join(''):'<tr class="empty"><td colspan="9">Sin compras registradas.</td></tr>')+'</tbody>'+
      '</table></div>';
    v.onclick=e=>{
      const b=e.target.closest('[data-void-comp]');
      if(!b)return;
      const c=S.purchases.find(x=>x.no===+b.dataset.voidComp);
      if(!c||c.void)return;
      c.void=true;
      c.lines.forEach(l=>{
        const p=prod(l.code);
        if(p){
          p.stock=Math.max(0,r2(p.stock-l.qty));
          addKardex({
            code:p.code,type:'ANULACIÓN',dir:'OUT',doc:'COM-'+pad(c.no),
            party:'Anulación compra prov. '+c.supplier.name,qty:l.qty,stockAfter:p.stock,cost:l.cost,user:S.cfg.cajero
          });
        }
      });
      S.cxp=(S.cxp||[]).filter(x=>x.purchaseNo!==c.no);
      save();renderAll();renderPurchaseHist(v);
      msg('Compra COM-'+pad(c.no)+' anulada. Se revirtió el ingreso en inventario y Kardex.');
    };
  };

  const renderSuppliersTab=v=>{
    v.innerHTML=
      '<div class="gridwrap invwrap"><table class="grid"><thead><tr><th>Código</th><th>Razón Social / Proveedor</th><th>RIF</th><th>Teléfono</th><th>Condición Habitual</th><th>Retención IVA</th></tr></thead><tbody>'+
        S.suppliers.map(s=>'<tr><td class="mono">'+esc(s.id)+'</td><td><b>'+esc(s.name)+'</b></td><td class="mono">'+esc(s.rif)+'</td><td>'+esc(s.tel)+'</td><td>'+esc(s.cond)+'</td><td>'+'<select class="fld" data-ret-iva="'+esc(s.id)+'" aria-label="Sujeto a retención IVA"><option value="no"'+(s.retieneIva===true?'':' selected')+'>No / verificar</option><option value="si"'+(s.retieneIva===true?' selected':'')+'>Sí, confirmado</option></select>'+'</td></tr>').join('')+
      '</tbody></table></div>'+
      '<details class="newp" open><summary>Registrar nuevo proveedor</summary><div class="newgrid">'+
        '<div class="f"><label for="nsRif">RIF</label><input class="fld" id="nsRif" placeholder="J-00000000-0"></div>'+
        '<div class="f wide"><label for="nsName">Razón Social</label><input class="fld" id="nsName" placeholder="Nombre de la distribuidora o fabricante"></div>'+
        '<div class="f"><label for="nsTel">Teléfono</label><input class="fld" id="nsTel"></div>'+
        '<div class="f"><label for="nsCond">Condición</label><select class="fld" id="nsCond"><option>Contado</option><option selected>15 días</option><option>30 días</option></select></div>'+
        '<div class="f"><label for="nsRetIva">Sujeto a retención de IVA</label><select class="fld" id="nsRetIva"><option value="no" selected>No / por verificar</option><option value="si">Sí, confirmado</option></select></div>'+
      '</div><p class="muted">Active esta opción solo después de verificar la condición fiscal del proveedor y la operación.</p><button class="btn" id="nsSave">Guardar proveedor</button></details>';
    v.onchange=e=>{
      const ctl=e.target.closest('[data-ret-iva]');
      if(!ctl)return;
      const sup=S.suppliers.find(x=>x.id===ctl.dataset.retIva);
      if(!sup)return;
      sup.retieneIva=ctl.value==='si';
      save();
      renderSuppliersTab(v);
      msg('Configuración de retención IVA actualizada para '+sup.name+'.');
    };
    v.onclick=e=>{
      if(e.target.id==='nsSave'){
        const rif=$('#nsRif',v).value.trim(), name=$('#nsName',v).value.trim();
        if(!rif||!name){msg('Indique RIF y razón social del proveedor.','bad');return;}
        S.suppliers.push({id:'PRV-'+two(S.suppliers.length+1),name,rif,tel:$('#nsTel',v).value.trim(),cond:$('#nsCond',v).value,retieneIva:$('#nsRetIva',v).value==='si'});
        save();renderSuppliersTab(v);msg('Proveedor '+name+' registrado.');
      }
    };
  };

  el.addEventListener('click',e=>{
    const tb=e.target.closest('[data-tab]');
    if(tb){tab=tb.dataset.tab;renderView();}
  });

  const processPurchase=()=>{
    if(tab!=='new')return true;
    if(!pLines.length){msg('Agregue al menos un producto a la compra.','bad');return false;}
    const sup=S.suppliers[supIdx]||S.suppliers[0];
    const docProv=($('#cpDoc',el)?$('#cpDoc',el).value.trim():'')||('F-'+S.purchaseSeq);
    const ts=Date.now();
    const no=S.purchaseSeq++;
    const lines=pLines.map(l=>{
      const p=prod(l.code);
      /* Costo Promedio Ponderado */
      const prevVal=Math.max(0,p.stock)*p.cost;
      const newVal=l.qty*l.cost;
      const nextStock=r2(p.stock+l.qty);
      const nextCost=nextStock>0?r2((prevVal+newVal)/nextStock):l.cost;
      p.stock=nextStock;
      p.cost=nextCost;
      if(l.price>0)p.price=r2(l.price);
      addKardex({
        ts,code:p.code,type:'COMPRA',dir:'IN',doc:'COM-'+pad(no),
        party:sup.name+' (Fac. '+docProv+')',qty:l.qty,stockAfter:p.stock,cost:l.cost,user:S.cfg.cajero
      });
      return{code:p.code,desc:p.brand+' '+p.desc,qty:l.qty,cost:l.cost,sub:r2(l.qty*l.cost)};
    });
    const base=r2(lines.reduce((a,x)=>a+x.sub,0));
    const iva=applyIva?r2(base*IVA):0;
    const total=r2(base+iva);
    const dueTs=ts+creditDays*86400000;
    const retPct=75; /* Por defecto legal ordinario; los casos especiales al 100% se documentan aparte para revisión del contador. */
    const aplicarRetencion=!!(applyIva&&iva>0&&S.cfg.contribEspecial&&S.cfg.retencionHabilitadaConfirmada===true&&sup.retieneIva===true);
    const retUsd=aplicarRetencion?r2(iva*(retPct/100)):0;
    const retBs=r2(retUsd*S.cfg.rate);
    const payableTotal=r2(Math.max(0,total-retUsd));
    const effPaid=cond==='Contado'?payableTotal:Math.min(payableTotal,paidInit);
    const comp={no,docProv,ts,dueTs,supplier:Object.assign({},sup),cond,lines,base,iva,total,payableTotal,retIva:retUsd,rate:S.cfg.rate,paid:effPaid,void:false};
    comp.ctrlProv='00-'+pad(no+4400,8);
    if(aplicarRetencion){
      const periodo=(()=>{const d=new Date(ts);return String(d.getFullYear())+String(d.getMonth()+1).padStart(2,'0');})();
      const retSeq=(S.retencionesIva||[]).filter(r=>String(r.periodo)===periodo).reduce((m,r)=>Math.max(m,Number(String(r.id||'').slice(-8))||0),0)+1;
      const retDoc=periodo+pad(retSeq,8);
      comp.retIvaDoc=retDoc;
      if(!S.retencionesIva)S.retencionesIva=[];
      S.retencionesIva.push({
        id:retDoc,ts,periodo,supplier:Object.assign({},sup),purchaseNo:no,docProv,
        ctrlProv:comp.ctrlProv,base,iva,pct:retPct,rate:S.cfg.rate,
        retainedUsd:retUsd,retainedBs:retBs,
        estado:'Pendiente de revisión del contador',declarada:false,pagada:false,comprobanteEntregado:false,observaciones:''
      });
    }
    S.purchases.push(comp);
    if(payableTotal-effPaid>=0.01){
      const cxpId='CXP-'+pad((S.cxp.length+1),4);
      const payments=effPaid>0?[{ts,method:payMethod,cur:'VES',amountBs:r2(effPaid*S.cfg.rate),amountUsd:effPaid,ref:'INI-'+no,note:'Abono inicial en compra'}]:[];
      S.cxp.push({
        id:cxpId,purchaseNo:no,doc:docProv+' (COM-'+pad(no)+')',
        supplier:Object.assign({},sup),
        concept:'Compra mercancía ('+lines.length+' reng.)'+(retUsd>0?' — retención IVA '+usd(retUsd):''),
        ts,dueTs,total:payableTotal,invoiceTotal:total,retIva:retUsd,paid:effPaid,payments
      });
    }
    save();renderAll();
    msg('Compra COM-'+pad(no)+' guardada. Factura: '+usd(total)+(retUsd>0?'; IVA retenido: '+usd(retUsd)+'; saldo a proveedor: '+usd(payableTotal):'')+'. Stock, costos y Kardex actualizados.');
    return true;
  };

  openWin({
    title:'Módulo de Compras y Recepción de Mercancía',
    w:980,
    body:el,
    foot:[
      {label:'Ir a Cuentas por Pagar (CxP)',left:true,fn:()=>{cxpDlg();return false;}},
      {label:'Cancelar'},
      {label:'Procesar y Guardar Compra',primary:true,fn:processPurchase}
    ],
    onEnter:()=>{},
    onOpen:()=>{renderView();}
  });
}

/* ---------- MÓDULO DE CUENTAS POR COBRAR (CxC) ---------- */
function cxcDlg(selId){
  let fState='PEND', fQ='', curId=selId||null, payMode='SINGLE';
  let mixState={};
  const resetMix=()=>{
    mixState={};
    METHODS.forEach(m=>{mixState[m.id]={usd:0,bs:0,ref:''};});
  };
  resetMix();

  const el=h('<div class="form">'+
    '<div class="kpis" id="cxcKpis"></div>'+
    '<div class="invbar">'+
      '<label for="cxcState">Estado</label>'+
      '<select class="fld" id="cxcState" style="max-width:190px"><option value="PEND">Pendientes por cobrar</option><option value="OVER">Solo vencidas</option><option value="PAID">Pagadas / Solventes</option><option value="ALL">Todas las cuentas</option></select>'+
      '<label for="cxcQ">Buscar</label>'+
      '<input class="fld" id="cxcQ" placeholder="Cliente, RIF o Nº de factura..." autocomplete="off">'+
      '<button class="btn mini2" id="cxcNewBtn">+ Nuevo Cargo / CxC Manual</button>'+
    '</div>'+
    '<div class="gridwrap invwrap" style="height:175px"><table class="grid" style="min-width:860px">'+
      '<thead><tr><th>Doc. / Factura</th><th>Cliente</th><th>RIF</th><th>Emisión</th><th>Vencimiento</th><th>Estado</th><th class="r">Total US$</th><th class="r">Abonado US$</th><th class="r">Saldo US$</th><th class="r">Saldo Bs.</th></tr></thead>'+
      '<tbody id="cxcBody"></tbody>'+
    '</table></div>'+
    '<div class="group" id="cxcDetail"></div>'+
  '</div>');

  const draw=()=>{
    const now=Date.now(), rate=S.cfg.rate, all=(S.cxc||[]).filter(x=>x.cashbox===currentCaja());
    const totPend=r2(all.reduce((a,x)=>a+Math.max(0,x.total-x.paid),0));
    const totOver=r2(all.filter(x=>x.total-x.paid>=0.01&&x.dueTs<now).reduce((a,x)=>a+Math.max(0,x.total-x.paid),0));
    const totVig=r2(Math.max(0,totPend-totOver));
    let cobHoy=0;
    all.forEach(x=>(x.payments||[]).forEach(p=>{if(sameDay(p.ts))cobHoy+=p.amountUsd;}));
    cobHoy=r2(cobHoy);

    $('#cxcKpis',el).innerHTML=
      '<div class="kpi"><span>Total por Cobrar (Cartera)</span><b class="warn">'+usd(totPend)+'</b><small>'+bsf(totPend*rate)+'</small></div>'+
      '<div class="kpi"><span>Cartera Vencida</span><b class="'+(totOver>0?'bad':'')+'">'+usd(totOver)+'</b><small>Requiere gestión de cobro</small></div>'+
      '<div class="kpi"><span>Cartera Vigente (Por vencer)</span><b class="ok">'+usd(totVig)+'</b><small>Dentro del plazo</small></div>'+
      '<div class="kpi"><span>Cobros Recibidos Hoy</span><b class="ok">'+usd(cobHoy)+'</b><small>'+bsf(cobHoy*rate)+'</small></div>';

    const q=norm(fQ);
    const list=all.filter(x=>{
      const bal=r2(x.total-x.paid);
      if(fState==='PEND'&&bal<0.01)return false;
      if(fState==='OVER'&&(bal<0.01||x.dueTs>=now))return false;
      if(fState==='PAID'&&bal>=0.01)return false;
      if(q&&norm(x.doc+x.client.name+x.client.rif+x.concept).indexOf(q)<0)return false;
      return true;
    }).sort((a,b)=>a.dueTs-b.dueTs);

    if(curId&&!list.some(x=>x.id===curId))curId=list[0]?list[0].id:null;
    if(!curId&&list[0])curId=list[0].id;

    $('#cxcBody',el).innerHTML=list.length?list.map(x=>{
      const bal=r2(Math.max(0,x.total-x.paid));
      const isOver=bal>=0.01&&x.dueTs<now;
      const stTxt=bal<0.01?'PAGADA':(isOver?'VENCIDA':'VIGENTE');
      const stCls=bal<0.01?'st-ok':(isOver?'st-out':'st-low');
      return '<tr data-id="'+esc(x.id)+'" class="'+(x.id===curId?'sel':'')+'">'+
        '<td class="mono"><b>'+esc(x.doc)+'</b></td>'+
        '<td><div class="desc">'+esc(x.client.name)+'</div><div class="sub">'+esc(x.concept||'')+'</div></td>'+
        '<td class="mono">'+esc(x.client.rif)+'</td>'+
        '<td>'+fmtD(x.ts)+'</td>'+
        '<td>'+fmtD(x.dueTs)+'</td>'+
        '<td class="'+stCls+'">'+stTxt+'</td>'+
        '<td class="r">'+nf(x.total)+'</td>'+
        '<td class="r">'+nf(x.paid)+'</td>'+
        '<td class="r"><b>'+nf(bal)+'</b></td>'+
        '<td class="r">'+nf(bal*rate)+'</td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="10">No hay cuentas por cobrar para el filtro seleccionado.</td></tr>';

    renderDetailBox();
  };

  const calcMixTotalUsd=()=>r2(METHODS.reduce((a,m)=>a+(mixState[m.id]?mixState[m.id].usd:0),0));

  const updateMixSummary=bal=>{
    const rate=S.cfg.rate;
    const sumUsd=calcMixTotalUsd();
    const remUsd=r2(bal-sumUsd);
    const sumEl=$('#cxcMixSum',el);
    if(!sumEl)return;
    let statusHtml='';
    if(sumUsd<=0){
      statusHtml='<span class="dim">Ingrese el monto en uno o más métodos de cobro.</span>';
    }else if(remUsd<-0.01){
      statusHtml='<b class="bad">Excede el saldo por '+usd(Math.abs(remUsd))+' ('+bsf(Math.abs(remUsd)*rate)+')</b>';
    }else if(remUsd<=0.01){
      statusHtml='<b class="ok">Cubre el 100 % del saldo pendiente (Factura solvente)</b>';
    }else{
      statusHtml='<b class="warn">Abono parcial · Resta por cobrar: '+usd(remUsd)+' ('+bsf(remUsd*rate)+')</b>';
    }
    sumEl.innerHTML=
      '<span>Total Cobro Mixto: <b>'+usd(sumUsd)+'</b> ('+bsf(sumUsd*rate)+')</span>'+
      '<span style="margin-left:14px">'+statusHtml+'</span>';
  };

  const renderDetailBox=()=>{
    const box=$('#cxcDetail',el), item=(S.cxc||[]).find(x=>x.id===curId);
    if(!item){box.innerHTML='<span class="dim">Seleccione una cuenta por cobrar para registrar un abono simple o mixto y ver su historial de pagos.</span>';return;}
    const bal=r2(Math.max(0,item.total-item.paid)), rate=S.cfg.rate;
    const mOpts='<option value="MIXTO"'+(payMode==='MIXTO'?' selected':'')+'>★ Cobro Mixto (Múltiples métodos de pago)</option>'+
      METHODS.map(m=>'<option value="'+esc(m.id)+'"'+(payMode===m.id?' selected':'')+'>'+esc(m.name)+' ('+m.cur+')</option>').join('');
    const hist=(item.payments||[]).map(p=>'<tr><td>'+fmtDT(p.ts)+'</td><td>'+esc(p.method)+'</td><td class="mono">'+esc(p.ref||'-')+'</td><td class="r">'+nf(p.amountUsd)+'</td><td class="r">'+nf(p.amountBs)+'</td><td>'+esc(p.note||'')+'</td></tr>').join('')||'<tr><td colspan="6" class="dim">Sin abonos registrados todavía.</td></tr>';

    let formHtml='';
    if(bal<0.01){
      formHtml='<div class="dim" style="margin-bottom:6px">Esta factura ya se encuentra totalmente solvente.</div>';
    }else if(payMode!=='MIXTO'){
      formHtml=
        '<div class="invbar" style="margin-bottom:6px">'+
          '<label>Forma de cobro</label><select class="fld" id="abMethod" style="max-width:235px">'+mOpts+'</select>'+
          '<label>Monto US$</label><input class="fld r" id="abUsd" value="'+nf(bal)+'" style="max-width:92px" inputmode="decimal">'+
          '<label>Equiv. Bs.</label><input class="fld r" id="abBs" value="'+nf(bal*rate)+'" style="max-width:105px" inputmode="decimal">'+
          '<label>Referencia</label><input class="fld" id="abRef" placeholder="Nº recibo / op." style="max-width:115px">'+
          '<label>Nota</label><input class="fld" id="abNote" placeholder="Abono a factura">'+
          '<button class="btn mini2" id="abSwitchMixBtn" title="Distribuir el cobro entre varios métodos de pago">Cobro Mixto…</button>'+
          '<button class="btn primary" id="abSaveBtn">Registrar Cobro</button>'+
        '</div>';
    }else{
      const mixRows=METHODS.map(m=>{
        const st=mixState[m.id]||{usd:0,bs:0,ref:''};
        const isUsd=m.cur==='USD';
        return '<tr>'+
          '<td><b>'+esc(m.name)+'</b></td>'+
          '<td class="c"><span class="sku-tag">'+(isUsd?'US$':'Bs.')+'</span></td>'+
          '<td class="r" style="width:125px"><input class="fld r cxc-mix-usd" data-m="'+esc(m.id)+'" value="'+(st.usd>0?nf(st.usd):'')+'" placeholder="0,00" inputmode="decimal"></td>'+
          '<td class="r" style="width:135px"><input class="fld r cxc-mix-bs" data-m="'+esc(m.id)+'" value="'+(st.bs>0?nf(st.bs):'')+'" placeholder="0,00" inputmode="decimal"></td>'+
          '<td style="width:155px"><input class="fld mono cxc-mix-ref" data-m="'+esc(m.id)+'" value="'+esc(st.ref||'')+'" placeholder="Nº ref. / lote / op."></td>'+
          '<td class="c" style="width:85px"><button class="btn mini2" data-cxc-fill="'+esc(m.id)+'" title="Asignar el saldo restante a este método">Restante</button></td>'+
        '</tr>';
      }).join('');
      formHtml=
        '<div style="background:var(--alt);border:1px solid var(--lo);padding:6px 8px;margin-bottom:6px">'+
          '<div class="invbar" style="margin-bottom:6px">'+
            '<label>Forma de cobro</label><select class="fld" id="abMethod" style="max-width:250px;font-weight:700">'+mOpts+'</select>'+
            '<label>Nota general</label><input class="fld" id="abNote" placeholder="Cobro mixto a factura '+esc(item.doc)+'">'+
            '<button class="btn mini2" id="cxcMixClear">Limpiar montos</button>'+
            '<button class="btn primary" id="abSaveMixBtn">Registrar Cobro Mixto</button>'+
          '</div>'+
          '<div class="gridwrap" style="max-height:155px;margin-bottom:5px"><table class="grid">'+
            '<thead><tr><th>Método de Cobro Interviniente</th><th class="c" style="width:65px">Moneda</th><th class="r">Monto en US$</th><th class="r">Monto en Bs. (Tasa '+nf(rate)+')</th><th>Referencia / Comprobante</th><th class="c">Asignar</th></tr></thead>'+
            '<tbody>'+mixRows+'</tbody>'+
          '</table></div>'+
          '<div class="row" id="cxcMixSum" style="justify-content:space-between;font-size:11px;padding:2px 4px"></div>'+
        '</div>';
    }

    box.innerHTML=
      '<div class="gtitle">Detalle y Abonos — '+esc(item.doc)+' · '+esc(item.client.name)+' (Saldo Pendiente: '+usd(bal)+' / '+bsf(bal*rate)+')</div>'+
      formHtml+
      '<div class="gridwrap" style="max-height:110px"><table class="grid"><thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th class="r">Equiv. US$</th><th class="r">Monto Bs.</th><th>Observación</th></tr></thead><tbody>'+hist+'</tbody></table></div>';

    if(payMode==='MIXTO'&&bal>=0.01)updateMixSummary(bal);
  };

  el.addEventListener('change',e=>{
    if(e.target.id==='cxcState'){fState=e.target.value;draw();return;}
    if(e.target.id==='abMethod'){
      payMode=e.target.value;
      renderDetailBox();
    }
  });
  el.addEventListener('input',e=>{
    if(e.target.id==='cxcQ'){fQ=e.target.value;draw();return;}
    const rate=S.cfg.rate||1;
    if(e.target.id==='abUsd'){
      const v=pn(e.target.value);
      const bsInp=$('#abBs',el);if(bsInp)bsInp.value=v>0?nf(r2(v*rate)):'';
      return;
    }
    if(e.target.id==='abBs'){
      const v=pn(e.target.value);
      const usdInp=$('#abUsd',el);if(usdInp)usdInp.value=v>0?nf(r2(v/rate)):'';
      return;
    }
    if(e.target.classList.contains('cxc-mix-usd')){
      const mid=e.target.dataset.m, u=Math.max(0,pn(e.target.value));
      mixState[mid]=mixState[mid]||{usd:0,bs:0,ref:''};
      mixState[mid].usd=r2(u);
      mixState[mid].bs=r2(u*rate);
      const bsInp=el.querySelector('.cxc-mix-bs[data-m="'+mid+'"]');
      if(bsInp)bsInp.value=u>0?nf(mixState[mid].bs):'';
      const item=(S.cxc||[]).find(x=>x.id===curId);
      if(item)updateMixSummary(r2(Math.max(0,item.total-item.paid)));
      return;
    }
    if(e.target.classList.contains('cxc-mix-bs')){
      const mid=e.target.dataset.m, b=Math.max(0,pn(e.target.value));
      mixState[mid]=mixState[mid]||{usd:0,bs:0,ref:''};
      mixState[mid].bs=r2(b);
      mixState[mid].usd=r2(b/rate);
      const usdInp=el.querySelector('.cxc-mix-usd[data-m="'+mid+'"]');
      if(usdInp)usdInp.value=b>0?nf(mixState[mid].usd):'';
      const item=(S.cxc||[]).find(x=>x.id===curId);
      if(item)updateMixSummary(r2(Math.max(0,item.total-item.paid)));
      return;
    }
    if(e.target.classList.contains('cxc-mix-ref')){
      const mid=e.target.dataset.m;
      mixState[mid]=mixState[mid]||{usd:0,bs:0,ref:''};
      mixState[mid].ref=e.target.value;
    }
  });
  el.addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-id]');
    if(tr){curId=tr.dataset.id;resetMix();draw();return;}
    if(e.target.id==='cxcNewBtn'){newCxcManualDlg();return;}
    if(e.target.id==='abSwitchMixBtn'){payMode='MIXTO';renderDetailBox();return;}
    if(e.target.id==='cxcMixClear'){resetMix();renderDetailBox();return;}
    const fillBtn=e.target.closest('[data-cxc-fill]');
    if(fillBtn){
      const mid=fillBtn.dataset.cxcFill;
      const item=(S.cxc||[]).find(x=>x.id===curId);if(!item)return;
      const bal=r2(Math.max(0,item.total-item.paid));
      const otherUsd=r2(METHODS.reduce((a,m)=>a+(m.id!==mid&&mixState[m.id]?mixState[m.id].usd:0),0));
      const rem=r2(Math.max(0,bal-otherUsd));
      mixState[mid]=mixState[mid]||{usd:0,bs:0,ref:''};
      mixState[mid].usd=rem;
      mixState[mid].bs=r2(rem*S.cfg.rate);
      renderDetailBox();
      return;
    }
    if(e.target.id==='abSaveBtn'){
      const item=(S.cxc||[]).find(x=>x.id===curId);if(!item)return;
      const bal=r2(Math.max(0,item.total-item.paid));
      const rawAmt=pn($('#abUsd',el).value);
      if(rawAmt<=0){msg('Indique un monto de abono válido mayor a cero.','bad');return;}
      if(rawAmt-bal>0.01){msg('El monto ingresado ('+usd(rawAmt)+') supera el saldo pendiente ('+usd(bal)+').','bad');return;}
      const amt=Math.min(bal,rawAmt);
      const mId=$('#abMethod',el).value;
      const m=METHODS.find(x=>x.id===mId)||METHODS[0];
      item.paid=r2(item.paid+amt);
      item.payments=item.payments||[];
      item.payments.push({
        ts:Date.now(),method:m.name,cur:m.cur,
        amountUsd:amt,amountBs:r2(amt*S.cfg.rate),
        ref:$('#abRef',el).value.trim()||'REC-'+pad(item.payments.length+1,4),
        note:$('#abNote',el).value.trim()||'Abono de cliente'
      });
      save();draw();renderStatus();
      msg('Abono de '+usd(amt)+' registrado en '+item.doc+' ('+item.client.name+').');
      return;
    }
    if(e.target.id==='abSaveMixBtn'){
      const item=(S.cxc||[]).find(x=>x.id===curId);if(!item)return;
      const bal=r2(Math.max(0,item.total-item.paid));
      const active=METHODS.filter(m=>mixState[m.id]&&mixState[m.id].usd>=0.01);
      if(!active.length){msg('Ingrese el monto en al menos un método de pago para el cobro mixto.','bad');return;}
      const totalMix=r2(active.reduce((a,m)=>a+mixState[m.id].usd,0));
      if(totalMix-bal>0.01){
        msg('La suma del cobro mixto ('+usd(totalMix)+') excede el saldo pendiente de la factura ('+usd(bal)+'). Ajuste los montos.','bad');
        return;
      }
      const ts=Date.now();
      const baseNote=($('#abNote',el)?$('#abNote',el).value.trim():'')||(active.length>1?'Cobro mixto ('+active.length+' métodos)':'Abono de cliente');
      item.payments=item.payments||[];
      const batchNo=item.payments.length+1;
      active.forEach((m,idx)=>{
        const st=mixState[m.id];
        const tag=active.length>1?'[Mixto '+(idx+1)+'/'+active.length+'] ':'';
        item.payments.push({
          ts,
          method:tag+m.name,
          cur:m.cur,
          amountUsd:r2(st.usd),
          amountBs:r2(st.bs||st.usd*S.cfg.rate),
          ref:(st.ref||'').trim()||('MIX-'+pad(batchNo,3)+'-'+(idx+1)),
          note:baseNote
        });
      });
      item.paid=r2(Math.min(item.total,item.paid+totalMix));
      resetMix();
      save();draw();renderStatus();
      msg('Cobro mixto por '+usd(totalMix)+' ('+active.length+' métodos) registrado en '+item.doc+'.');
    }
  });

  openWin({title:'Cuentas por Cobrar (CxC) y Gestión de Crédito a Clientes',w:980,body:el,foot:[{label:'Cerrar',primary:true}],onEnter:()=>{},onOpen:()=>{draw();}});
}

function newCxcManualDlg(){
  const clOpts=S.clients.filter(c=>c.rif!=='V-00000000').map((c,i)=>'<option value="'+esc(c.rif)+'">'+esc(c.name)+' ('+esc(c.rif)+')</option>').join('');
  const el=h('<div class="form"><div class="newgrid">'+
    '<div class="f wide"><label for="mcClient">Cliente</label><select class="fld" id="mcClient">'+clOpts+'</select></div>'+
    '<div class="f"><label for="mcDoc">Documento / Ref.</label><input class="fld mono" id="mcDoc" value="ND-'+pad((S.cxc.length+101),6)+'"></div>'+
    '<div class="f"><label for="mcAmt">Monto Total US$</label><input class="fld r" id="mcAmt" inputmode="decimal" placeholder="0,00"></div>'+
    '<div class="f"><label for="mcDue">Fecha Vencimiento</label><input class="fld" type="date" id="mcDue" value="'+isoD(Date.now()+15*86400000)+'"></div>'+
    '<div class="f wide"><label for="mcConc">Concepto</label><input class="fld" id="mcConc" placeholder="Factura a crédito / Nota de débito"></div>'+
  '</div></div>');
  openWin({title:'Registrar Cuenta por Cobrar',w:520,body:el,foot:[
    {label:'Cancelar',fn:()=>{cxcDlg();return false;}},
    {label:'Guardar CxC',primary:true,fn:()=>{
      const rif=$('#mcClient',el).value, cl=S.clients.find(c=>c.rif===rif)||S.clients[1];
      const amt=pn($('#mcAmt',el).value);
      if(!amt){msg('Indique el monto en US$.','bad');return false;}
      const id='CXC-'+pad(S.cxc.length+1,4);
      S.cxc.push({
        id,saleNo:null,doc:$('#mcDoc',el).value.trim()||id,
        client:Object.assign({},cl),
        concept:$('#mcConc',el).value.trim()||'Cargo a crédito',
        ts:Date.now(),dueTs:parseIsoD($('#mcDue',el).value),cashbox:currentCaja(),cashier:currentCajero(),
        total:amt,paid:0,payments:[]
      });
      save();cxcDlg(id);msg('Cuenta por cobrar registrada.');return false;
    }}
  ]});
}

/* ---------- MÓDULO DE CUENTAS POR PAGAR (CxP) ---------- */
function cxpDlg(selId){
  let fState='PEND', fQ='', curId=selId||null, payMode='SINGLE';
  let mixState={};
  const resetMix=()=>{
    mixState={};
    METHODS.forEach(m=>{mixState[m.id]={usd:0,bs:0,ref:''};});
  };
  resetMix();

  const el=h('<div class="form">'+
    '<div class="kpis" id="cxpKpis"></div>'+
    '<div class="invbar">'+
      '<label for="cxpState">Estado</label>'+
      '<select class="fld" id="cxpState" style="max-width:190px"><option value="PEND">Pendientes por pagar</option><option value="OVER">Solo vencidas</option><option value="PAID">Pagadas / Solventes</option><option value="ALL">Todas las obligaciones</option></select>'+
      '<label for="cxpQ">Buscar</label>'+
      '<input class="fld" id="cxpQ" placeholder="Proveedor, RIF o Nº de factura..." autocomplete="off">'+
      '<button class="btn mini2" id="cxpNewBtn">+ Registrar Obligación / Gasto</button>'+
    '</div>'+
    '<div class="gridwrap invwrap" style="height:175px"><table class="grid" style="min-width:860px">'+
      '<thead><tr><th>Doc. / Factura</th><th>Proveedor</th><th>RIF</th><th>Emisión</th><th>Vencimiento</th><th>Estado</th><th class="r">Total US$</th><th class="r">Pagado US$</th><th class="r">Saldo US$</th><th class="r">Saldo Bs.</th></tr></thead>'+
      '<tbody id="cxpBody"></tbody>'+
    '</table></div>'+
    '<div class="group" id="cxpDetail"></div>'+
  '</div>');

  const draw=()=>{
    const now=Date.now(), rate=S.cfg.rate, all=S.cxp||[];
    const totPend=r2(all.reduce((a,x)=>a+Math.max(0,x.total-x.paid),0));
    const totOver=r2(all.filter(x=>x.total-x.paid>=0.01&&x.dueTs<now).reduce((a,x)=>a+Math.max(0,x.total-x.paid),0));
    const totVig=r2(Math.max(0,totPend-totOver));
    let pagHoy=0;
    all.forEach(x=>(x.payments||[]).forEach(p=>{if(sameDay(p.ts))pagHoy+=p.amountUsd;}));
    pagHoy=r2(pagHoy);

    $('#cxpKpis',el).innerHTML=
      '<div class="kpi"><span>Total por Pagar (Pasivo)</span><b class="warn">'+usd(totPend)+'</b><small>'+bsf(totPend*rate)+'</small></div>'+
      '<div class="kpi"><span>Deuda Vencida</span><b class="'+(totOver>0?'bad':'')+'">'+usd(totOver)+'</b><small>Pago prioritario</small></div>'+
      '<div class="kpi"><span>Deuda Vigente (Por vencer)</span><b class="ok">'+usd(totVig)+'</b><small>Dentro del plazo de crédito</small></div>'+
      '<div class="kpi"><span>Pagos Emitidos Hoy</span><b class="ok">'+usd(pagHoy)+'</b><small>'+bsf(pagHoy*rate)+'</small></div>';

    const q=norm(fQ);
    const list=all.filter(x=>{
      const bal=r2(x.total-x.paid);
      if(fState==='PEND'&&bal<0.01)return false;
      if(fState==='OVER'&&(bal<0.01||x.dueTs>=now))return false;
      if(fState==='PAID'&&bal>=0.01)return false;
      if(q&&norm(x.doc+x.supplier.name+x.supplier.rif+x.concept).indexOf(q)<0)return false;
      return true;
    }).sort((a,b)=>a.dueTs-b.dueTs);

    if(curId&&!list.some(x=>x.id===curId))curId=list[0]?list[0].id:null;
    if(!curId&&list[0])curId=list[0].id;

    $('#cxpBody',el).innerHTML=list.length?list.map(x=>{
      const bal=r2(Math.max(0,x.total-x.paid));
      const isOver=bal>=0.01&&x.dueTs<now;
      const stTxt=bal<0.01?'PAGADA':(isOver?'VENCIDA':'VIGENTE');
      const stCls=bal<0.01?'st-ok':(isOver?'st-out':'st-low');
      return '<tr data-id="'+esc(x.id)+'" class="'+(x.id===curId?'sel':'')+'">'+
        '<td class="mono"><b>'+esc(x.doc)+'</b></td>'+
        '<td><div class="desc">'+esc(x.supplier.name)+'</div><div class="sub">'+esc(x.concept||'')+'</div></td>'+
        '<td class="mono">'+esc(x.supplier.rif)+'</td>'+
        '<td>'+fmtD(x.ts)+'</td>'+
        '<td>'+fmtD(x.dueTs)+'</td>'+
        '<td class="'+stCls+'">'+stTxt+'</td>'+
        '<td class="r">'+nf(x.total)+'</td>'+
        '<td class="r">'+nf(x.paid)+'</td>'+
        '<td class="r"><b>'+nf(bal)+'</b></td>'+
        '<td class="r">'+nf(bal*rate)+'</td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="10">No hay cuentas por pagar para el filtro seleccionado.</td></tr>';

    renderDetailBox();
  };

  const calcMixTotalUsd=()=>r2(METHODS.reduce((a,m)=>a+(mixState[m.id]?mixState[m.id].usd:0),0));

  const updateMixSummary=bal=>{
    const rate=S.cfg.rate;
    const sumUsd=calcMixTotalUsd();
    const remUsd=r2(bal-sumUsd);
    const sumEl=$('#cxpMixSum',el);
    if(!sumEl)return;
    let statusHtml='';
    if(sumUsd<=0){
      statusHtml='<span class="dim">Ingrese el monto en uno o más medios de pago.</span>';
    }else if(remUsd<-0.01){
      statusHtml='<b class="bad">Excede el saldo por '+usd(Math.abs(remUsd))+' ('+bsf(Math.abs(remUsd)*rate)+')</b>';
    }else if(remUsd<=0.01){
      statusHtml='<b class="ok">Cubre el 100 % de la obligación con el proveedor</b>';
    }else{
      statusHtml='<b class="warn">Pago parcial · Resta por pagar: '+usd(remUsd)+' ('+bsf(remUsd*rate)+')</b>';
    }
    sumEl.innerHTML=
      '<span>Total Pago Mixto: <b>'+usd(sumUsd)+'</b> ('+bsf(sumUsd*rate)+')</span>'+
      '<span style="margin-left:14px">'+statusHtml+'</span>';
  };

  const renderDetailBox=()=>{
    const box=$('#cxpDetail',el), item=(S.cxp||[]).find(x=>x.id===curId);
    if(!item){box.innerHTML='<span class="dim">Seleccione una obligación para registrar un pago simple o mixto al proveedor o consultar comprobantes.</span>';return;}
    const bal=r2(Math.max(0,item.total-item.paid)), rate=S.cfg.rate;
    const mOpts='<option value="MIXTO"'+(payMode==='MIXTO'?' selected':'')+'>★ Pago Mixto (Múltiples métodos de pago)</option>'+
      METHODS.map(m=>'<option value="'+esc(m.id)+'"'+(payMode===m.id?' selected':'')+'>'+esc(m.name)+' ('+m.cur+')</option>').join('');
    const hist=(item.payments||[]).map(p=>'<tr><td>'+fmtDT(p.ts)+'</td><td>'+esc(p.method)+'</td><td class="mono">'+esc(p.ref||'-')+'</td><td class="r">'+nf(p.amountUsd)+'</td><td class="r">'+nf(p.amountBs)+'</td><td>'+esc(p.note||'')+'</td></tr>').join('')||'<tr><td colspan="6" class="dim">Sin pagos registrados todavía.</td></tr>';

    let formHtml='';
    if(bal<0.01){
      formHtml='<div class="dim" style="margin-bottom:6px">Esta obligación con el proveedor ya está pagada en su totalidad.</div>';
    }else if(payMode!=='MIXTO'){
      formHtml=
        '<div class="invbar" style="margin-bottom:6px">'+
          '<label>Medio de pago</label><select class="fld" id="pgMethod" style="max-width:235px">'+mOpts+'</select>'+
          '<label>Monto US$</label><input class="fld r" id="pgUsd" value="'+nf(bal)+'" style="max-width:92px" inputmode="decimal">'+
          '<label>Equiv. Bs.</label><input class="fld r" id="pgBs" value="'+nf(bal*rate)+'" style="max-width:105px" inputmode="decimal">'+
          '<label>Comprobante</label><input class="fld" id="pgRef" placeholder="Nº transf. / ref." style="max-width:115px">'+
          '<label>Nota</label><input class="fld" id="pgNote" placeholder="Pago a proveedor">'+
          '<button class="btn mini2" id="pgSwitchMixBtn" title="Distribuir el pago entre varios medios de pago">Pago Mixto…</button>'+
          '<button class="btn mini2" id="pgBuyZelleBtn" style="background:#0D3B2E;color:#4ADE80;border-color:#166534;font-weight:700" title="Comprar saldo Zelle a intermediario para pagar directo al proveedor">⚡ Pagar con Compra Zelle…</button>'+
          '<button class="btn primary" id="pgSaveBtn">Registrar Pago</button>'+
        '</div>';
    }else{
      const mixRows=METHODS.map(m=>{
        const st=mixState[m.id]||{usd:0,bs:0,ref:''};
        const isUsd=m.cur==='USD';
        return '<tr>'+
          '<td><b>'+esc(m.name)+'</b></td>'+
          '<td class="c"><span class="sku-tag">'+(isUsd?'US$':'Bs.')+'</span></td>'+
          '<td class="r" style="width:125px"><input class="fld r cxp-mix-usd" data-m="'+esc(m.id)+'" value="'+(st.usd>0?nf(st.usd):'')+'" placeholder="0,00" inputmode="decimal"></td>'+
          '<td class="r" style="width:135px"><input class="fld r cxp-mix-bs" data-m="'+esc(m.id)+'" value="'+(st.bs>0?nf(st.bs):'')+'" placeholder="0,00" inputmode="decimal"></td>'+
          '<td style="width:155px"><input class="fld mono cxp-mix-ref" data-m="'+esc(m.id)+'" value="'+esc(st.ref||'')+'" placeholder="Nº op. / ref. / recibo"></td>'+
          '<td class="c" style="width:85px"><button class="btn mini2" data-cxp-fill="'+esc(m.id)+'" title="Asignar el saldo restante a este medio de pago">Restante</button></td>'+
        '</tr>';
      }).join('');
      formHtml=
        '<div style="background:var(--alt);border:1px solid var(--lo);padding:6px 8px;margin-bottom:6px">'+
          '<div class="invbar" style="margin-bottom:6px">'+
            '<label>Medio de pago</label><select class="fld" id="pgMethod" style="max-width:250px;font-weight:700">'+mOpts+'</select>'+
            '<label>Nota general</label><input class="fld" id="pgNote" placeholder="Pago mixto a '+esc(item.supplier.name)+'">'+
            '<button class="btn mini2" id="cxpMixClear">Limpiar montos</button>'+
            '<button class="btn primary" id="pgSaveMixBtn">Registrar Pago Mixto</button>'+
          '</div>'+
          '<div class="gridwrap" style="max-height:155px;margin-bottom:5px"><table class="grid">'+
            '<thead><tr><th>Medio de Pago Interviniente</th><th class="c" style="width:65px">Moneda</th><th class="r">Monto en US$</th><th class="r">Monto en Bs. (Tasa '+nf(rate)+')</th><th>Comprobante / Referencia</th><th class="c">Asignar</th></tr></thead>'+
            '<tbody>'+mixRows+'</tbody>'+
          '</table></div>'+
          '<div class="row" id="cxpMixSum" style="justify-content:space-between;font-size:11px;padding:2px 4px"></div>'+
        '</div>';
    }

    box.innerHTML=
      '<div class="gtitle">Pagos a Proveedor — '+esc(item.doc)+' · '+esc(item.supplier.name)+' (Saldo Pendiente: '+usd(bal)+' / '+bsf(bal*rate)+')</div>'+
      formHtml+
      '<div class="gridwrap" style="max-height:110px"><table class="grid"><thead><tr><th>Fecha</th><th>Medio de Pago</th><th>Comprobante</th><th class="r">Equiv. US$</th><th class="r">Monto Bs.</th><th>Observación</th></tr></thead><tbody>'+hist+'</tbody></table></div>';

    if(payMode==='MIXTO'&&bal>=0.01)updateMixSummary(bal);
  };

  el.addEventListener('change',e=>{
    if(e.target.id==='cxpState'){fState=e.target.value;draw();return;}
    if(e.target.id==='pgMethod'){
      payMode=e.target.value;
      renderDetailBox();
    }
  });
  el.addEventListener('input',e=>{
    if(e.target.id==='cxpQ'){fQ=e.target.value;draw();return;}
    const rate=S.cfg.rate||1;
    if(e.target.id==='pgUsd'){
      const v=pn(e.target.value);
      const bsInp=$('#pgBs',el);if(bsInp)bsInp.value=v>0?nf(r2(v*rate)):'';
      return;
    }
    if(e.target.id==='pgBs'){
      const v=pn(e.target.value);
      const usdInp=$('#pgUsd',el);if(usdInp)usdInp.value=v>0?nf(r2(v/rate)):'';
      return;
    }
    if(e.target.classList.contains('cxp-mix-usd')){
      const mid=e.target.dataset.m, u=Math.max(0,pn(e.target.value));
      mixState[mid]=mixState[mid]||{usd:0,bs:0,ref:''};
      mixState[mid].usd=r2(u);
      mixState[mid].bs=r2(u*rate);
      const bsInp=el.querySelector('.cxp-mix-bs[data-m="'+mid+'"]');
      if(bsInp)bsInp.value=u>0?nf(mixState[mid].bs):'';
      const item=(S.cxp||[]).find(x=>x.id===curId);
      if(item)updateMixSummary(r2(Math.max(0,item.total-item.paid)));
      return;
    }
    if(e.target.classList.contains('cxp-mix-bs')){
      const mid=e.target.dataset.m, b=Math.max(0,pn(e.target.value));
      mixState[mid]=mixState[mid]||{usd:0,bs:0,ref:''};
      mixState[mid].bs=r2(b);
      mixState[mid].usd=r2(b/rate);
      const usdInp=el.querySelector('.cxp-mix-usd[data-m="'+mid+'"]');
      if(usdInp)usdInp.value=b>0?nf(mixState[mid].usd):'';
      const item=(S.cxp||[]).find(x=>x.id===curId);
      if(item)updateMixSummary(r2(Math.max(0,item.total-item.paid)));
      return;
    }
    if(e.target.classList.contains('cxp-mix-ref')){
      const mid=e.target.dataset.m;
      mixState[mid]=mixState[mid]||{usd:0,bs:0,ref:''};
      mixState[mid].ref=e.target.value;
    }
  });
  el.addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-id]');
    if(tr){curId=tr.dataset.id;resetMix();draw();return;}
    if(e.target.id==='cxpNewBtn'){newCxpManualDlg();return;}
    if(e.target.id==='pgSwitchMixBtn'){payMode='MIXTO';renderDetailBox();return;}
    if(e.target.id==='pgBuyZelleBtn'){newOperacionCambiariaDlg({cxpId:curId},()=>{cxpDlg(curId);});return;}
    if(e.target.id==='cxpMixClear'){resetMix();renderDetailBox();return;}
    const fillBtn=e.target.closest('[data-cxp-fill]');
    if(fillBtn){
      const mid=fillBtn.dataset.cxpFill;
      const item=(S.cxp||[]).find(x=>x.id===curId);if(!item)return;
      const bal=r2(Math.max(0,item.total-item.paid));
      const otherUsd=r2(METHODS.reduce((a,m)=>a+(m.id!==mid&&mixState[m.id]?mixState[m.id].usd:0),0));
      const rem=r2(Math.max(0,bal-otherUsd));
      mixState[mid]=mixState[mid]||{usd:0,bs:0,ref:''};
      mixState[mid].usd=rem;
      mixState[mid].bs=r2(rem*S.cfg.rate);
      renderDetailBox();
      return;
    }
    if(e.target.id==='pgSaveBtn'){
      const item=(S.cxp||[]).find(x=>x.id===curId);if(!item)return;
      const bal=r2(Math.max(0,item.total-item.paid));
      const rawAmt=pn($('#pgUsd',el).value);
      if(rawAmt<=0){msg('Indique un monto de pago válido mayor a cero.','bad');return;}
      if(rawAmt-bal>0.01){msg('El monto ingresado ('+usd(rawAmt)+') supera el saldo por pagar ('+usd(bal)+').','bad');return;}
      const amt=Math.min(bal,rawAmt);
      const mId=$('#pgMethod',el).value;
      const m=METHODS.find(x=>x.id===mId)||METHODS[5];
      item.paid=r2(item.paid+amt);
      item.payments=item.payments||[];
      item.payments.push({
        ts:Date.now(),method:m.name,cur:m.cur,
        amountUsd:amt,amountBs:r2(amt*S.cfg.rate),
        ref:$('#pgRef',el).value.trim()||'OP-'+pad(item.payments.length+1,4),
        note:$('#pgNote',el).value.trim()||'Pago a proveedor'
      });
      if(item.purchaseNo){
        const comp=(S.purchases||[]).find(x=>x.no===item.purchaseNo);
        if(comp)comp.paid=item.paid;
      }
      save();draw();
      msg('Pago de '+usd(amt)+' registrado para '+item.supplier.name+'.');
      return;
    }
    if(e.target.id==='pgSaveMixBtn'){
      const item=(S.cxp||[]).find(x=>x.id===curId);if(!item)return;
      const bal=r2(Math.max(0,item.total-item.paid));
      const active=METHODS.filter(m=>mixState[m.id]&&mixState[m.id].usd>=0.01);
      if(!active.length){msg('Ingrese el monto en al menos un medio de pago para el pago mixto.','bad');return;}
      const totalMix=r2(active.reduce((a,m)=>a+mixState[m.id].usd,0));
      if(totalMix-bal>0.01){
        msg('La suma del pago mixto ('+usd(totalMix)+') excede el saldo pendiente de la obligación ('+usd(bal)+'). Ajuste los montos.','bad');
        return;
      }
      const ts=Date.now();
      const baseNote=($('#pgNote',el)?$('#pgNote',el).value.trim():'')||(active.length>1?'Pago mixto ('+active.length+' medios)':'Pago a proveedor');
      item.payments=item.payments||[];
      const batchNo=item.payments.length+1;
      active.forEach((m,idx)=>{
        const st=mixState[m.id];
        const tag=active.length>1?'[Mixto '+(idx+1)+'/'+active.length+'] ':'';
        item.payments.push({
          ts,
          method:tag+m.name,
          cur:m.cur,
          amountUsd:r2(st.usd),
          amountBs:r2(st.bs||st.usd*S.cfg.rate),
          ref:(st.ref||'').trim()||('OPM-'+pad(batchNo,3)+'-'+(idx+1)),
          note:baseNote
        });
      });
      item.paid=r2(Math.min(item.total,item.paid+totalMix));
      if(item.purchaseNo){
        const comp=(S.purchases||[]).find(x=>x.no===item.purchaseNo);
        if(comp)comp.paid=item.paid;
      }
      resetMix();
      save();draw();
      msg('Pago mixto por '+usd(totalMix)+' ('+active.length+' medios) registrado para '+item.supplier.name+'.');
    }
  });

  openWin({
    title:'Cuentas por Pagar (CxP) y Obligaciones con Proveedores',
    w:980,body:el,
    foot:[
      {label:'Ir a Compras (F10)',left:true,fn:()=>{comprasDlg();return false;}},
      {label:'Cerrar',primary:true}
    ],
    onEnter:()=>{},onOpen:()=>{draw();}
  });
}

function newCxpManualDlg(){
  const supOpts=S.suppliers.map(s=>'<option value="'+esc(s.rif)+'">'+esc(s.name)+' ('+esc(s.rif)+')</option>').join('');
  const el=h('<div class="form"><div class="newgrid">'+
    '<div class="f wide"><label for="mpSup">Proveedor / Beneficiario</label><select class="fld" id="mpSup">'+supOpts+'</select></div>'+
    '<div class="f"><label for="mpDoc">Nº Factura / Documento</label><input class="fld mono" id="mpDoc" value="F-'+pad(S.cxp.length+501,5)+'"></div>'+
    '<div class="f"><label for="mpAmt">Monto Total US$</label><input class="fld r" id="mpAmt" inputmode="decimal" placeholder="0,00"></div>'+
    '<div class="f"><label for="mpDue">Fecha Vencimiento</label><input class="fld" type="date" id="mpDue" value="'+isoD(Date.now()+15*86400000)+'"></div>'+
    '<div class="f wide"><label for="mpConc">Concepto (Compra, flete, servicio, alquiler...)</label><input class="fld" id="mpConc" placeholder="Ej: Servicio de transporte de mercancía"></div>'+
  '</div></div>');
  openWin({title:'Registrar Obligación en Cuentas por Pagar (CxP)',w:540,body:el,foot:[
    {label:'Cancelar',fn:()=>{cxpDlg();return false;}},
    {label:'Guardar CxP',primary:true,fn:()=>{
      const rif=$('#mpSup',el).value, sup=S.suppliers.find(s=>s.rif===rif)||S.suppliers[0];
      const amt=pn($('#mpAmt',el).value);
      if(!amt){msg('Indique el monto en US$.','bad');return false;}
      const id='CXP-'+pad(S.cxp.length+1,4);
      S.cxp.push({
        id,purchaseNo:null,doc:$('#mpDoc',el).value.trim()||id,
        supplier:Object.assign({},sup),
        concept:$('#mpConc',el).value.trim()||'Obligación con proveedor',
        ts:Date.now(),dueTs:parseIsoD($('#mpDue',el).value),
        total:amt,paid:0,payments:[]
      });
      save();cxpDlg(id);msg('Cuenta por pagar registrada.');return false;
    }}
  ]});
}

/* ==========================================================================
   MÓDULO DE OPERACIONES CAMBIARIAS Y COMPRA DE DIVISAS (USD / ZELLE)
   Trazabilidad completa: Compra de USD en efectivo a persona natural,
   Compra de USD Zelle con pago directo a proveedor (triangulación CxP),
   Compra de Zelle propio y canje de divisas con comprobantes oficiales.
   ========================================================================== */

function printComprobanteDivisas(op){
  const tipoLabel={
    'ZELLE_PROV':'COMPRA USD ZELLE PARA PAGO DIRECTO A PROVEEDOR (TRIANGULACIÓN)',
    'USD_EFECTIVO':'COMPRA DE USD EN EFECTIVO FÍSICO A PERSONA NATURAL',
    'ZELLE_PROPIO':'COMPRA DE USD ZELLE PARA TESORERÍA / CUENTA PROPIA',
    'VENTA_USD':'CANJE DE USD EFECTIVO A BOLÍVARES (SALIDA DE CAJA)'
  }[op.tipo]||'OPERACIÓN CAMBIARIA / TRAZABILIDAD';

  const rateBcv=op.tasaBcv||S.cfg.rate;
  const difTasa=op.tasa&&rateBcv?r2(op.tasa-rateBcv):0;

  const html='<div style="font-family:monospace;max-width:440px;margin:0 auto;padding:12px;border:1px dashed #333;background:#fafafa;line-height:1.4;font-size:12px">'+
    '<div style="text-align:center;font-weight:700;font-size:14px;border-bottom:1px double #333;padding-bottom:6px;margin-bottom:8px">'+
      esc(S.cfg.empresa)+'<br>'+
      '<span style="font-size:11px;font-weight:normal">RIF: '+esc(S.cfg.rif)+' &middot; Control Cambiario y Trazabilidad</span><br>'+
      '<span style="font-size:12px;font-weight:bold;color:#1842B8">COMPROBANTE DE OPERACIÓN CAMBIARIA</span>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between"><span>Nº OPERACIÓN:</span><b>'+esc(op.id)+'</b></div>'+
    '<div style="display:flex;justify-content:space-between"><span>FECHA Y HORA:</span><span>'+fmtDT(op.ts)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between"><span>TIPO OPERACIÓN:</span><b style="font-size:10.5px;text-align:right">'+esc(tipoLabel)+'</b></div>'+
    '<div style="border-top:1px dashed #666;margin:8px 0;padding-top:6px">'+
      '<div style="font-weight:bold;font-size:11.5px;margin-bottom:3px">1. TERCERO / VENDEDOR DE DIVISAS:</div>'+
      '<div style="display:flex;justify-content:space-between"><span>NOMBRE:</span><b>'+esc(op.vendedor.nombre)+'</b></div>'+
      '<div style="display:flex;justify-content:space-between"><span>C.I. / RIF:</span><b>'+esc(op.vendedor.ci)+'</b></div>'+
      (op.vendedor.tel?'<div style="display:flex;justify-content:space-between"><span>TELÉFONO:</span><span>'+esc(op.vendedor.tel)+'</span></div>':'')+
    '</div>'+
    '<div style="border-top:1px dashed #666;margin:8px 0;padding-top:6px">'+
      '<div style="font-weight:bold;font-size:11.5px;margin-bottom:3px">2. LIQUIDACIÓN EN BOLÍVARES (SALIDA):</div>'+
      '<div style="display:flex;justify-content:space-between"><span>MEDIO DE PAGO BS.:</span><b>'+esc(op.medioBs)+'</b></div>'+
      (op.bancoOrigen?'<div style="display:flex;justify-content:space-between"><span>BANCO ORIGEN:</span><span>'+esc(op.bancoOrigen)+'</span></div>':'')+
      (op.bancoDestino?'<div style="display:flex;justify-content:space-between"><span>BANCO DESTINO:</span><span>'+esc(op.bancoDestino)+'</span></div>':'')+
      '<div style="display:flex;justify-content:space-between"><span>Nº REFERENCIA BS.:</span><b style="background:#e5e7eb;padding:0 3px">'+esc(op.refBs||'-')+'</b></div>'+
      '<div style="display:flex;justify-content:space-between"><span>TOTAL PAGADO BS.:</span><b>'+bsf(op.montoBs)+'</b></div>'+
    '</div>'+
    '<div style="border-top:1px dashed #666;margin:8px 0;padding-top:6px">'+
      '<div style="font-weight:bold;font-size:11.5px;margin-bottom:3px">3. RECEPCIÓN / ACREDITACIÓN EN DIVISAS:</div>'+
      '<div style="display:flex;justify-content:space-between"><span>MONTO DIVISAS:</span><b style="font-size:13px;color:#1842B8">'+usd(op.montoUsd)+'</b></div>'+
      '<div style="display:flex;justify-content:space-between"><span>TASA PACTADA:</span><b>'+nf(op.tasa)+' Bs/US$</b></div>'+
      '<div style="display:flex;justify-content:space-between"><span>TASA OFICIAL BCV:</span><span>'+nf(rateBcv)+' Bs/US$</span></div>'+
      (difTasa!==0?'<div style="display:flex;justify-content:space-between;font-size:11px;color:#854d0e"><span>DIF. CAMBIARIA:</span><span>'+(difTasa>0?'+':'')+nf(difTasa)+' Bs/US$</span></div>':'')+
      '<div style="display:flex;justify-content:space-between"><span>DESTINO FONDOS:</span><b>'+esc(op.destinoNombre||op.destinoTipo)+'</b></div>'+
      (op.destinatarioZelle?'<div style="display:flex;justify-content:space-between"><span>CORREO ZELLE:</span><b>'+esc(op.destinatarioZelle)+'</b></div>':'')+
      (op.titularZelle?'<div style="display:flex;justify-content:space-between"><span>TITULAR ZELLE:</span><span>'+esc(op.titularZelle)+'</span></div>':'')+
      (op.confZelle?'<div style="display:flex;justify-content:space-between"><span>CONFIRMATION ZELLE:</span><b style="background:#fef08a;padding:0 3px">'+esc(op.confZelle)+'</b></div>':'')+
      (op.seriales?'<div style="display:flex;justify-content:space-between"><span>SERIALES BILLETES:</span><span>'+esc(op.seriales)+'</span></div>':'')+
      (op.cxpDoc?'<div style="display:flex;justify-content:space-between"><span>FACTURA CxP AFECTADA:</span><b>'+esc(op.cxpDoc)+'</b></div>':'')+
    '</div>'+
    (op.notas?'<div style="font-size:11px;color:#444;border-top:1px dotted #ccc;margin:6px 0;padding-top:4px"><b>Observaciones:</b> '+esc(op.notas)+'</div>':'')+
    '<div style="border-top:1px dashed #333;margin-top:12px;padding-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center;font-size:10px">'+
      '<div>___________________________<br><b>'+esc(S.cfg.cajero)+'</b><br>Administración / Caja</div>'+
      '<div>___________________________<br><b>'+esc(op.vendedor.nombre)+'</b><br>C.I. '+esc(op.vendedor.ci)+'<br>Vendedor Divisas / Receptor</div>'+
    '</div>'+
    '<div style="text-align:center;font-size:9.5px;color:#777;margin-top:10px">Documento generado para fines de control administrativo y trazabilidad cambiaria.</div>'+
  '</div>';

  openWin({
    title:'Comprobante de Operación Cambiaria y Trazabilidad — '+op.id,
    w:500,body:h(html),
    foot:[
      {label:'Imprimir Comprobante',primary:true,fn:()=>{printFiscalReport('Comprobante Cambiario '+op.id,html);return false;}},
      {label:'Cerrar'}
    ]
  });
}

function newOperacionCambiariaDlg(opts, onDone){
  opts=opts||{};
  const initialCxp=opts.cxpId?((S.cxp||[]).find(x=>x.id===opts.cxpId)):null;
  const initialType='ZELLE_PROV';

  const pendingCxp=(S.cxp||[]).filter(x=>r2(x.total-x.paid)>=0.01);
  const cxpOptions='<option value="">-- No vincular a factura CxP --</option>'+
    pendingCxp.map(c=>'<option value="'+esc(c.id)+'"'+(initialCxp&&initialCxp.id===c.id?' selected':'')+'>'+esc(c.supplier.name)+' &middot; Doc: '+esc(c.doc)+' (Saldo: '+usd(r2(c.total-c.paid))+')</option>').join('');

  const el=h('<div class="form">'+
    '<div class="newgrid">'+
      '<div class="f wide"><label for="opTipo">Tipo de Operación Cambiaria / Destino</label><select class="fld" id="opTipo">'+
        '<option value="ZELLE_PROV"'+(initialType==='ZELLE_PROV'?' selected':'')+'>Compra de USD Zelle con Pago Directo a Proveedor (Triangulación CxP)</option>'+
        '<option value="USD_EFECTIVO">Compra de USD en Efectivo Físico a Persona Natural (Entrada a Caja Divisas)</option>'+
        '<option value="ZELLE_PROPIO">Compra de USD Zelle para Tesorería / Cuenta Propia</option>'+
        '<option value="VENTA_USD">Venta / Canje de USD Efectivo por Bolívares (Salida de Caja Divisas)</option>'+
      '</select></div>'+
    '</div>'+

    '<div class="group" style="margin-bottom:8px;padding:8px 10px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px">'+
      '<div style="font-weight:700;font-size:12px;color:#1e293b;margin-bottom:6px">1. Datos de la Persona Natural / Vendedor de Divisas (Tercero Intermediario)</div>'+
      '<div class="newgrid">'+
        '<div class="f wide"><label for="opVendNombre">Nombre y Apellido</label><input class="fld" id="opVendNombre" placeholder="Ej: Carlos Eduardo Méndez" value="Carlos Eduardo Méndez"></div>'+
        '<div class="f"><label for="opVendCi">Cédula / RIF</label><input class="fld mono" id="opVendCi" placeholder="V-12345678" value="V-15.892.411"></div>'+
        '<div class="f"><label for="opVendTel">Teléfono de Contacto</label><input class="fld" id="opVendTel" placeholder="0414-1234567" value="0414-234.56.78"></div>'+
      '</div>'+
    '</div>'+

    '<div class="group" style="margin-bottom:8px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px">'+
      '<div style="font-weight:700;font-size:12px;color:#166534;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">'+
        '<span>2. Importes y Tasa de Cambio</span>'+
        '<button type="button" class="btn mini2" id="opBtnRateBcv" style="font-size:11px">Fijar Tasa BCV Oficial ('+nf(S.cfg.rate)+')</button>'+
      '</div>'+
      '<div class="newgrid">'+
        '<div class="f"><label for="opMontoUsd">Monto en US$ Divisas</label><input class="fld r mono" id="opMontoUsd" inputmode="decimal" placeholder="0,00" value="'+(initialCxp?nf(r2(initialCxp.total-initialCxp.paid)):'50,00')+'"></div>'+
        '<div class="f"><label for="opTasa">Tasa Pactada (Bs/US$)</label><input class="fld r mono" id="opTasa" inputmode="decimal" value="'+nf(S.cfg.rate)+'"></div>'+
        '<div class="f wide"><label for="opMontoBs">Total en Bolívares (Bs.)</label><input class="fld r mono" id="opMontoBs" inputmode="decimal" placeholder="0,00" style="font-weight:700;color:#166534"></div>'+
      '</div>'+
    '</div>'+

    '<div class="group" style="margin-bottom:8px;padding:8px 10px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px">'+
      '<div style="font-weight:700;font-size:12px;color:#1e293b;margin-bottom:6px">3. Pago en Bolívares al Vendedor (Salida de Fondos)</div>'+
      '<div class="newgrid">'+
        '<div class="f"><label for="opMedioBs">Medio de Pago Bs.</label><select class="fld" id="opMedioBs"><option value="Pago Móvil Interbancario" selected>Pago Móvil Interbancario</option><option value="Transferencia Bancaria">Transferencia Bancaria</option><option value="Efectivo Bolívares">Efectivo Bolívares (Caja)</option></select></div>'+
        '<div class="f"><label for="opBancoOrig">Banco Origen (Empresa)</label><select class="fld" id="opBancoOrig"><option value="Banco de Venezuela (BDV)">Banco de Venezuela (BDV)</option><option value="Banesco Banco Universal" selected>Banesco Banco Universal</option><option value="Banco Mercantil">Banco Mercantil</option><option value="Bancamiga">Bancamiga</option></select></div>'+
        '<div class="f"><label for="opBancoDest">Banco Destino (Vendedor)</label><select class="fld" id="opBancoDest"><option value="Banco de Venezuela (BDV)">Banco de Venezuela (BDV)</option><option value="Banesco" selected>Banesco</option><option value="Banco Mercantil">Banco Mercantil</option><option value="Bancamiga">Bancamiga</option><option value="BNC">BNC</option><option value="Provincial">Provincial</option></select></div>'+
        '<div class="f wide"><label for="opRefBs">Nº de Referencia / Aprobación en Bs. (*Obligatorio)</label><input class="fld mono" id="opRefBs" placeholder="Ej: PM-49210293 o TRF-8819203" value="PM-'+pad(Math.floor(Math.random()*899999+100000),6)+'"></div>'+
      '</div>'+
    '</div>'+

    '<div class="group" id="opDynamicGroup" style="margin-bottom:8px;padding:8px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px">'+
      '<!-- Campos dinámicos según el tipo de operación -->'+
    '</div>'+

    '<div class="f wide"><label for="opNotas">Observaciones y Trazabilidad</label><input class="fld" id="opNotas" placeholder="Detalles de la operación cambiaria..."></div>'+
  '</div>');

  const renderDynamicFields=()=>{
    const tipo=$('#opTipo',el).value;
    const box=$('#opDynamicGroup',el);
    if(tipo==='ZELLE_PROV'){
      box.innerHTML=
        '<div style="font-weight:700;font-size:12px;color:#1e40af;margin-bottom:6px">4. Destino de los USD: Transferencia Zelle Directa al Proveedor</div>'+
        '<div class="newgrid">'+
          '<div class="f wide"><label for="opCxpSel">Vincular a Factura / Obligación CxP del Proveedor</label><select class="fld" id="opCxpSel">'+cxpOptions+'</select></div>'+
          '<div class="f wide"><label for="opZelleEmail">Correo o Teléfono Zelle del Proveedor</label><input class="fld" id="opZelleEmail" placeholder="pagos@proveedor.com" value="pagos@proveedor.com"></div>'+
          '<div class="f"><label for="opZelleTitular">Nombre del Titular Zelle en EE.UU.</label><input class="fld" id="opZelleTitular" placeholder="Nombre completo / Razón social" value="Distribuidora Nacional Lubricantes LLC"></div>'+
          '<div class="f"><label for="opZelleConf">Confirmation Number Zelle (*Capture)</label><input class="fld mono" id="opZelleConf" placeholder="Ej: CONF-99218204" value="ZEL-'+pad(Math.floor(Math.random()*899999+100000),6)+'"></div>'+
        '</div>';
    }else if(tipo==='USD_EFECTIVO'){
      box.innerHTML=
        '<div style="font-weight:700;font-size:12px;color:#1e40af;margin-bottom:6px">4. Destino de los USD: Ingreso de Billetes Físicos a Caja</div>'+
        '<div class="newgrid">'+
          '<div class="f"><label for="opCajaDest">Caja Receptora</label><input class="fld" id="opCajaDest" value="Caja Principal ('+esc(S.cfg.caja)+') &middot; '+esc(S.cfg.cajero)+'" readonly></div>'+
          '<div class="f wide"><label for="opSeriales">Seriales / Denominación de Billetes Recibidos</label><input class="fld" id="opSeriales" placeholder="Ej: 1x100 (Serial: KB88192), 1x50 (Serial: LL4401)"></div>'+
        '</div>';
    }else if(tipo==='ZELLE_PROPIO'){
      box.innerHTML=
        '<div style="font-weight:700;font-size:12px;color:#1e40af;margin-bottom:6px">4. Destino de los USD: Cuenta Zelle Propia de la Empresa</div>'+
        '<div class="newgrid">'+
          '<div class="f wide"><label for="opZellePropioEmail">Cuenta Zelle de la Empresa</label><input class="fld" id="opZellePropioEmail" value="tesoreria@elpiston.com" placeholder="correo@zelle.com"></div>'+
          '<div class="f"><label for="opZellePropioConf">Confirmation Number Zelle</label><input class="fld mono" id="opZellePropioConf" placeholder="Confirmation Number" value="ZEL-'+pad(Math.floor(Math.random()*899999+100000),6)+'"></div>'+
        '</div>';
    }else{
      box.innerHTML=
        '<div style="font-weight:700;font-size:12px;color:#854d0e;margin-bottom:6px">4. Canje de USD Efectivo por Bolívares (Salida de Divisas de Caja)</div>'+
        '<div class="newgrid">'+
          '<div class="f"><label for="opCajaOrig">Caja Emisora USD</label><input class="fld" id="opCajaOrig" value="Caja Principal ('+esc(S.cfg.caja)+')" readonly></div>'+
          '<div class="f wide"><label for="opDestBs">Destino de los Bolívares Recibidos</label><input class="fld" id="opDestBs" placeholder="Ej: Cuenta Banesco para pago de nómina"></div>'+
        '</div>';
    }
  };

  const syncAmounts=(fromUsd)=>{
    const tasa=pn($('#opTasa',el).value)||S.cfg.rate;
    if(fromUsd){
      const u=pn($('#opMontoUsd',el).value);
      $('#opMontoBs',el).value=u>0?nf(r2(u*tasa)):'';
    }else{
      const b=pn($('#opMontoBs',el).value);
      $('#opMontoUsd',el).value=b>0?nf(r2(b/tasa)):'';
    }
  };

  renderDynamicFields();
  syncAmounts(true);

  el.addEventListener('change',e=>{
    if(e.target.id==='opTipo')renderDynamicFields();
    if(e.target.id==='opCxpSel'){
      const cid=e.target.value;
      if(cid){
        const it=(S.cxp||[]).find(x=>x.id===cid);
        if(it){
          const rem=r2(Math.max(0,it.total-it.paid));
          $('#opMontoUsd',el).value=nf(rem);
          syncAmounts(true);
        }
      }
    }
  });

  el.addEventListener('input',e=>{
    if(e.target.id==='opMontoUsd')syncAmounts(true);
    else if(e.target.id==='opMontoBs')syncAmounts(false);
    else if(e.target.id==='opTasa')syncAmounts(true);
  });

  el.addEventListener('click',e=>{
    if(e.target.id==='opBtnRateBcv'){
      $('#opTasa',el).value=nf(S.cfg.rate);
      syncAmounts(true);
    }
  });

  openWin({
    title:'Registrar Operación Cambiaria (Compra USD Físico / Zelle)',
    w:680,body:el,
    foot:[
      {label:'Cancelar',fn:()=>{if(onDone)onDone();return false;}},
      {label:'Guardar y Generar Comprobante',primary:true,fn:()=>{
        const tipo=$('#opTipo',el).value;
        const nombre=$('#opVendNombre',el).value.trim();
        const ci=$('#opVendCi',el).value.trim();
        const tel=$('#opVendTel',el).value.trim();
        const montoUsd=pn($('#opMontoUsd',el).value);
        const tasa=pn($('#opTasa',el).value)||S.cfg.rate;
        const montoBs=pn($('#opMontoBs',el).value)||r2(montoUsd*tasa);
        const medioBs=$('#opMedioBs',el).value;
        const bancoOrig=$('#opBancoOrig',el).value;
        const bancoDest=$('#opBancoDest',el).value;
        const refBs=$('#opRefBs',el).value.trim();
        const notas=$('#opNotas',el).value.trim();

        if(!nombre||!ci){msg('Indique el nombre y la cédula/RIF del vendedor de divisas.','bad');return false;}
        if(!montoUsd||montoUsd<=0){msg('Indique el monto en US$ de la operación.','bad');return false;}
        if(!refBs){msg('Indique el número de referencia del pago en Bolívares para la trazabilidad bancaria.','bad');return false;}

        let destinoTipo='CAJA', destinoNombre='Caja Principal', cxpId=null, cxpDoc=null;
        let destinatarioZelle='', titularZelle='', confZelle='', seriales='';

        if(tipo==='ZELLE_PROV'){
          destinoTipo='PROV';
          cxpId=$('#opCxpSel',el)?$('#opCxpSel',el).value:null;
          destinatarioZelle=$('#opZelleEmail',el)?$('#opZelleEmail',el).value.trim():'';
          titularZelle=$('#opZelleTitular',el)?$('#opZelleTitular',el).value.trim():'';
          confZelle=$('#opZelleConf',el)?$('#opZelleConf',el).value.trim():'';
          if(cxpId){
            const it=(S.cxp||[]).find(x=>x.id===cxpId);
            if(it){
              destinoNombre=it.supplier.name;
              cxpDoc=it.doc;
              /* Abonar o cancelar automáticamente la obligación en CxP */
              if(!it.payments)it.payments=[];
              it.payments.push({
                ts:Date.now(),
                method:'Zelle (USD) - Triangulado',
                cur:'USD',
                amountUsd:montoUsd,
                amountBs:montoBs,
                ref:'ZEL:'+(confZelle||'S/R')+' | PM/TRF:'+refBs,
                note:'Pagado vía compra Zelle a '+nombre+' ('+ci+')'
              });
              it.paid=r2((it.paid||0)+montoUsd);
            }
          }else{
            destinoNombre=titularZelle||'Proveedor Externo';
          }
        }else if(tipo==='USD_EFECTIVO'){
          destinoTipo='CAJA';
          destinoNombre='Caja Principal de Divisas (Caja '+S.cfg.caja+')';
          seriales=$('#opSeriales',el)?$('#opSeriales',el).value.trim():'';
        }else if(tipo==='ZELLE_PROPIO'){
          destinoTipo='BANCO_USD';
          destinatarioZelle=$('#opZellePropioEmail',el)?$('#opZellePropioEmail',el).value.trim():'';
          confZelle=$('#opZellePropioConf',el)?$('#opZellePropioConf',el).value.trim():'';
          destinoNombre='Cuenta Zelle Empresa ('+destinatarioZelle+')';
        }else{
          destinoTipo='BANCO_VES';
          destinoNombre=$('#opDestBs',el)?$('#opDestBs',el).value.trim():'Cuenta Bancaria Empresa';
        }

        const id='CAMB-'+pad((S.cambiosDivisas||[]).length+1,4);
        const op={
          id,tipo,ts:Date.now(),
          vendedor:{nombre,ci,tel},
          montoUsd,tasa,tasaBcv:S.cfg.rate,montoBs,
          medioBs,bancoOrigen:bancoOrig,bancoDestino:bancoDest,refBs,
          destinoTipo,destinoNombre,
          destinatarioZelle,titularZelle,confZelle,seriales,
          cxpId,cxpDoc,notas
        };

        if(!S.cambiosDivisas)S.cambiosDivisas=[];
        S.cambiosDivisas.push(op);
        save();
        msg('Operación cambiaria '+id+' registrada con éxito.');
        if(onDone)onDone();
        printComprobanteDivisas(op);
        return false;
      }}
    ]
  });
}

function divisasDlg(filterType){
  let fType=filterType||'ALL', fQ='';
  const el=h('<div class="form">'+
    '<div class="kpis" id="divKpis"></div>'+
    '<div class="invbar" style="margin-top:6px">'+
      '<label for="divType">Tipo de Operación</label>'+
      '<select class="fld" id="divType" style="max-width:260px">'+
        '<option value="ALL">Todas las operaciones cambiarias</option>'+
        '<option value="ZELLE_PROV">Solo Zelle a Proveedores (CxP)</option>'+
        '<option value="USD_EFECTIVO">Solo Compra USD Efectivo</option>'+
        '<option value="ZELLE_PROPIO">Solo Zelle Propio</option>'+
        '<option value="VENTA_USD">Solo Canje / Venta USD</option>'+
      '</select>'+
      '<label for="divQ">Buscar</label>'+
      '<input class="fld" id="divQ" placeholder="Vendedor, C.I., proveedor, confirmation..." autocomplete="off">'+
      '<button class="btn primary" id="divNewBtn">+ Registrar Operación Cambiaria (USD / Zelle)</button>'+
    '</div>'+
    '<div class="gridwrap tallwrap" style="height:250px"><table class="grid" style="min-width:980px">'+
      '<thead><tr>'+
        '<th>ID / Fecha</th>'+
        '<th>Tipo Operación</th>'+
        '<th>Vendedor Divisas (Tercero)</th>'+
        '<th>Destino / Beneficiario</th>'+
        '<th class="r">Monto US$</th>'+
        '<th class="r">Tasa (Bs/$)</th>'+
        '<th class="r">Monto Pagado Bs.</th>'+
        '<th>Ref. Bolívares</th>'+
        '<th>Confirmation / Serial</th>'+
        '<th class="c">Acciones</th>'+
      '</tr></thead>'+
      '<tbody id="divBody"></tbody>'+
    '</table></div>'+
    '<p class="hint">Módulo de trazabilidad para la adquisición y canje de divisas (efectivo físico y transferencias Zelle trianguladas) conforme a los estándares de auditoría administrativa y fiscal.</p>'+
  '</div>');

  const draw=()=>{
    const all=S.cambiosDivisas||[];
    const totEfeUsd=r2(all.filter(x=>x.tipo==='USD_EFECTIVO').reduce((a,x)=>a+x.montoUsd,0));
    const totZelUsd=r2(all.filter(x=>x.tipo==='ZELLE_PROV'||x.tipo==='ZELLE_PROPIO').reduce((a,x)=>a+x.montoUsd,0));
    const totBsOut=r2(all.filter(x=>x.tipo!=='VENTA_USD').reduce((a,x)=>a+x.montoBs,0));
    const provOps=all.filter(x=>x.tipo==='ZELLE_PROV').length;

    $('#divKpis',el).innerHTML=
      '<div class="kpi"><span>USD Comprado en Efectivo</span><b class="ok">'+usd(totEfeUsd)+'</b><small>Ingresado a caja</small></div>'+
      '<div class="kpi"><span>USD Comprado en Zelle</span><b class="ok">'+usd(totZelUsd)+'</b><small>Proveedores y cuentas</small></div>'+
      '<div class="kpi"><span>Bolívares Egresados (Bs.)</span><b class="warn">'+bsf(totBsOut)+'</b><small>Liquidado vía PM/TRF</small></div>'+
      '<div class="kpi"><span>Pagos Triangulados a Proveedores</span><b>'+provOps+' facturas</b><small>Trazabilidad en CxP</small></div>';

    const q=norm(fQ);
    const filtered=all.filter(x=>{
      if(fType!=='ALL'&&x.tipo!==fType)return false;
      if(q){
        const txt=norm([x.id,x.vendedor.nombre,x.vendedor.ci,x.destinoNombre,x.refBs,x.confZelle,x.cxpDoc].join(' '));
        if(!txt.includes(q))return false;
      }
      return true;
    }).slice().reverse();

    const tagClass={
      'ZELLE_PROV':'cambio-tag zel-prv',
      'USD_EFECTIVO':'cambio-tag usd-efe',
      'ZELLE_PROPIO':'cambio-tag zel-own',
      'VENTA_USD':'cambio-tag vta'
    };
    const tagShort={
      'ZELLE_PROV':'Zelle Proveedor',
      'USD_EFECTIVO':'USD Efectivo',
      'ZELLE_PROPIO':'Zelle Propio',
      'VENTA_USD':'Venta USD'
    };

    const rows=filtered.map(x=>{
      return '<tr>'+
        '<td><b>'+esc(x.id)+'</b><br><small class="dim">'+fmtDT(x.ts)+'</small></td>'+
        '<td><span class="'+(tagClass[x.tipo]||'cambio-tag')+'">'+(tagShort[x.tipo]||x.tipo)+'</span></td>'+
        '<td><b>'+esc(x.vendedor.nombre)+'</b><br><span class="sku-tag">'+esc(x.vendedor.ci)+'</span>'+(x.vendedor.tel?' &middot; <small>'+esc(x.vendedor.tel)+'</small>':'')+'</td>'+
        '<td><b>'+esc(x.destinoNombre)+'</b>'+(x.cxpDoc?'<br><small style="color:#1842B8">Doc: '+esc(x.cxpDoc)+'</small>':'')+'</td>'+
        '<td class="r" style="font-weight:700;color:#1842B8">'+usd(x.montoUsd)+'</td>'+
        '<td class="r">'+nf(x.tasa)+'</td>'+
        '<td class="r" style="font-weight:600">'+bsf(x.montoBs)+'</td>'+
        '<td class="mono" style="font-size:11px">'+esc(x.refBs)+'<br><small class="dim">'+esc(x.medioBs)+'</small></td>'+
        '<td class="mono" style="font-size:11px">'+(x.confZelle?'<span style="background:#fef08a;padding:1px 4px;border-radius:3px">'+esc(x.confZelle)+'</span>':(x.seriales?'<small>'+esc(x.seriales)+'</small>':'-'))+'</td>'+
        '<td class="c" style="white-space:nowrap">'+
          '<button class="btn mini2" data-pr-cambio="'+x.id+'" title="Ver e imprimir comprobante">Comprobante</button> '+
          (x.cxpId?'<button class="btn mini2" data-cxp-link="'+x.cxpId+'" title="Ver en Cuentas por Pagar">Ver CxP</button> ':'')+
          '<button class="btn mini2" data-del-cambio="'+x.id+'" style="color:#dc2626" title="Eliminar registro">&times;</button>'+
        '</td>'+
      '</tr>';
    }).join('');

    $('#divBody',el).innerHTML=rows||'<tr class="empty"><td colspan="10">No hay operaciones cambiarias registradas que coincidan con el filtro.</td></tr>';
  };

  el.addEventListener('change',e=>{
    if(e.target.id==='divType'){fType=e.target.value;draw();}
  });
  el.addEventListener('input',e=>{
    if(e.target.id==='divQ'){fQ=e.target.value;draw();}
  });
  el.addEventListener('click',e=>{
    if(e.target.id==='divNewBtn'){
      newOperacionCambiariaDlg({},()=>{draw();});
      return;
    }
    const prBtn=e.target.closest('[data-pr-cambio]');
    if(prBtn){
      const op=(S.cambiosDivisas||[]).find(x=>x.id===prBtn.dataset.prCambio);
      if(op)printComprobanteDivisas(op);
      return;
    }
    const cxpBtn=e.target.closest('[data-cxp-link]');
    if(cxpBtn){
      cxpDlg(cxpBtn.dataset.cxpLink);
      return;
    }
    const delBtn=e.target.closest('[data-del-cambio]');
    if(delBtn){
      const cid=delBtn.dataset.delCambio;
      const op=(S.cambiosDivisas||[]).find(x=>x.id===cid);
      if(!op)return;
      ask('Eliminar Operación Cambiaria',
        '¿Desea eliminar la operación '+cid+' ('+usd(op.montoUsd)+')?'+(op.cxpId?' Nota: esto no revertirá automáticamente el saldo de la factura en CxP salvo que lo modifique en ese módulo.':''),
        'Eliminar',
        ()=>{
          S.cambiosDivisas=S.cambiosDivisas.filter(x=>x.id!==cid);
          save();draw();msg('Operación cambiaria eliminada.');
        }
      );
      return;
    }
  });

  openWin({
    title:'Operaciones Cambiarias y Compra de Divisas (USD Efectivo y Zelle)',
    w:1060,body:el,
    foot:[
      {label:'Ir a Cuentas por Pagar (CxP)',left:true,fn:()=>{cxpDlg();return false;}},
      {label:'Cerrar',primary:true}
    ],
    onOpen:()=>{draw();}
  });
}


/* ---------- Módulo de Gestión y Conciliación CASHEA (BNPL) ---------- */
function casheaPaymentAssistantDlg(totalSale, rate, onApplied, onCancel){
  const el = h('<div class="form" style="gap:12px">'+
    '<div style="background:#1E1B4B;border:1px solid #4338CA;border-radius:8px;padding:12px;color:#EEF2FF">'+
      '<div style="display:flex;align-items:center;justify-content:space-between">'+
        '<div><b style="font-size:15px;color:#FBBF24">⚡ Asistente de Financiamiento CASHEA</b><div style="font-size:12px;color:#C7D2FE">Compra ahora y paga en 3 cuotas quincenales sin interés</div></div>'+
        '<span class="badge-cashea">Registro manual · validar en Cashea</span>'+
      '</div>'+
      '<div style="margin-top:10px;display:flex;gap:16px;align-items:baseline">'+
        '<div><small style="color:#A5B4FC;text-transform:uppercase;font-size:10px">Total Venta</small><div style="font-size:22px;font-weight:700">'+usd(totalSale)+'</div></div>'+
        '<div><small style="color:#A5B4FC;text-transform:uppercase;font-size:10px">Equivalente BCV</small><div style="font-size:18px;font-weight:600;color:#FBBF24">'+bsf(totalSale*rate)+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div class="docgrid">'+
      '<div class="f wide"><label>Cliente / Titular Cashea</label><input class="fld" id="cshClient" value="'+esc(S.client.name)+'" readonly></div>'+
      '<div class="f"><label>C.I. / RIF Cliente</label><input class="fld mono" id="cshCi" value="'+esc(S.client.rif)+'" placeholder="V-00000000"></div>'+
      '<div class="f"><label>Token / Aprobación real de Cashea *</label><input class="fld mono" id="cshToken" placeholder="Ingrese el código aprobado en Cashea" value="" required style="font-weight:700;color:#6366F1"></div>'+
      '<div class="f wide"><label>Nivel de Usuario en Cashea</label>'+
        '<select class="fld" id="cshLevel">'+
          '<option value="40" data-cuotas="3" selected>Nivel 3, 4 y 5 (Inicial 40% / 60% Financiado en 3 cuotas) [Recomendado]</option>'+
          '<option value="50" data-cuotas="3">Nivel 2 (Inicial 50% / 50% Financiado en 3 cuotas)</option>'+
          '<option value="60" data-cuotas="3">Nivel 1 (Inicial 60% / 40% Financiado en 3 cuotas)</option>'+
          '<option value="0" data-cuotas="1">Línea Cotidiana / Nivel Más (Inicial 0% / 100% en 1 cuota a 14 días)</option>'+
          '<option value="custom" data-cuotas="3">Personalizado (Definir porcentaje de inicial)</option>'+
        '</select>'+
      '</div>'+
      '<div class="f" id="cshCustomPctWrap" hidden><label>% Inicial personalizado</label><input class="fld r" id="cshCustomPct" type="number" min="0" max="95" value="40"></div>'+
      '<div class="f wide"><label>Distribución del pago inicial entre varios métodos</label><div class="hint">Puede combinar efectivo, tarjeta, Biopago, pago móvil, transferencia o Zelle. Introduzca el importe real de cada método; la suma equivalente debe cubrir exactamente la inicial Cashea.</div><div class="gridwrap"><table class="grid" style="min-width:620px"><thead><tr><th>Método</th><th>Moneda</th><th>Importe de la inicial</th><th>Referencia / autorización</th></tr></thead><tbody id="cshInitialRows"></tbody></table></div><div id="cshInitialSummary" class="hint" style="font-weight:700;margin-top:6px"></div></div>'+
    '</div>'+
    '<div class="cashea-calc-box" id="cshPlanBox"></div>'+
    '<div class="hint">Este asistente calcula y registra el plan en el POS; no consulta ni confirma aprobaciones mediante la API oficial de Cashea. Verifique el token y las condiciones en Cashea antes de confirmar. La inicial se cobra ahora; el saldo financiado queda pendiente de liquidación y debe conciliarse después.</div>'+
  '</div>');

  const planBox = $('#cshPlanBox', el);
  const selLevel = $('#cshLevel', el);
  const customWrap = $('#cshCustomPctWrap', el);
  const customPct = $('#cshCustomPct', el);
  const initialRows = $('#cshInitialRows', el);
  const initialSummary = $('#cshInitialSummary', el);
  const initialMethods = METHODS.filter(m=>m.id!=='cashea');
  const initialNeedsRef = new Set(['biopago','punto','pmovil','transf','zelle']);
  initialRows.innerHTML=initialMethods.map(m=>'<tr><td><b>'+esc(m.name)+'</b></td><td class="c">'+(m.cur==='USD'?'US$':'Bs.')+'</td><td><input class="fld r" type="number" min="0" step="0.01" id="cshInitAmt-'+m.id+'" data-csh-initial-method="'+m.id+'" value="0" style="min-width:105px" aria-label="Importe inicial '+esc(m.name)+'"></td><td>'+(initialNeedsRef.has(m.id)?'<input class="fld mini mono" id="cshInitRef-'+m.id+'" placeholder="Referencia / autorización" style="min-width:150px">':'<span class="hint">No aplica</span>')+'</td></tr>').join('');
  const ciInp = $('#cshCi', el);
  const tokenInp = $('#cshToken', el);

  function getPct(){
    if(selLevel.value === 'custom') return Math.max(0, Math.min(100, Number(customPct.value) || 0));
    return Number(selLevel.value) || 0;
  }
  function getCuotasCount(){
    const opt = selLevel.options[selLevel.selectedIndex];
    return Number(opt.dataset.cuotas || 3);
  }

  function renderPlan(){
    const pct = getPct();
    const cuotas = getCuotasCount();
    const inicialUsd = r2(totalSale * (pct / 100));
    const financiadoUsd = r2(totalSale - inicialUsd);
    const cuotaUsd = r2(financiadoUsd / cuotas);
    const now = Date.now(), dayMs = 86400000;

    let cuotasHtml = '';
    for(let c = 1; c <= cuotas; c++){
      const fDate = new Date(now + c * 14 * dayMs).toLocaleDateString('es-VE');
      cuotasHtml += '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.1);font-size:12px">'+
        '<span>Cuota '+c+' (en '+ (c * 14) +' días · '+fDate+'):</span>'+
        '<b>'+usd(cuotaUsd)+' <span style="color:#FBBF24;font-size:11px">('+bsf(cuotaUsd*rate)+')</span></b>'+
      '</div>';
    }

    planBox.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">'+
      '<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:6px">'+
        '<small style="color:#C7D2FE;display:block;font-size:10px">1. PAGO INICIAL EN CAJA ('+pct+'%)</small>'+
        '<div style="font-size:17px;font-weight:700;color:#A7F3D0">'+usd(inicialUsd)+'</div>'+
        '<small style="color:#94A3B8">'+bsf(inicialUsd*rate)+'</small>'+
      '</div>'+
      '<div style="background:rgba(255,255,255,0.06);padding:8px 10px;border-radius:6px">'+
        '<small style="color:#C7D2FE;display:block;font-size:10px">2. SALDO FINANCIADO CASHEA</small>'+
        '<div style="font-size:17px;font-weight:700;color:#FBBF24">'+usd(financiadoUsd)+'</div>'+
        '<small style="color:#94A3B8">'+bsf(financiadoUsd*rate)+'</small>'+
      '</div>'+
    '</div>'+
    '<div style="font-size:11.5px;color:#C7D2FE;margin-bottom:4px;font-weight:600">Plan de '+cuotas+' cuotas quincenales (sin interés):</div>'+
    cuotasHtml;
    let paidInitialUsd=0;
    initialMethods.forEach(m=>{const amount=Math.max(0,Number($('#cshInitAmt-'+m.id,el).value)||0);paidInitialUsd+=m.cur==='USD'?amount/(1+IGTF):amount/rate;});
    const delta=r2(paidInitialUsd-inicialUsd);
    initialSummary.textContent='Inicial requerida: '+usd(inicialUsd)+' · Distribuido: '+usd(paidInitialUsd)+' · Diferencia: '+usd(delta);
    initialSummary.style.color=Math.abs(delta)<=0.01?'#16A34A':'#B45309';
  }

  selLevel.addEventListener('change', () => {
    customWrap.hidden = selLevel.value !== 'custom';
    renderPlan();
  });
  customPct.addEventListener('input', renderPlan);
  initialRows.addEventListener('input',e=>{if(e.target.matches('[data-csh-initial-method]'))renderPlan();});
  renderPlan();

  openWin({
    title: 'Asistente de Financiamiento CASHEA (BNPL)',
    w: 640,
    body: el,
    foot: [
      { label: 'Volver al pago', fn:()=>{closeWin();if(onCancel)onCancel();return false;} },
      {
        label: 'Aplicar a la Venta',
        primary: true,
        fn: () => {
          const token = tokenInp.value.trim();
          if(!token){ msg('Ingrese el código de aprobación o token de Cashea.', 'bad'); return false; }
          const ci = ciInp.value.trim() || S.client.rif;
          const pct = getPct();
          const cuotas = getCuotasCount();
          const inicialUsd = r2(totalSale * (pct / 100));
          const financiadoUsd = r2(totalSale - inicialUsd);
          const cuotaUsd = r2(financiadoUsd / cuotas);
          const nivelTxt = selLevel.options[selLevel.selectedIndex].textContent;
          const initialPayments=[];
          let paidInitialUsd=0;
          for(const m of initialMethods){
            const amount=r2(Math.max(0,Number($('#cshInitAmt-'+m.id,el).value)||0));
            if(amount<=0)continue;
            const refInput=$('#cshInitRef-'+m.id,el);
            const ref=refInput?refInput.value.trim():'';
            if(initialNeedsRef.has(m.id)&&!ref){msg('Ingrese la referencia o autorización de '+m.name+' para registrar la inicial.','bad');return false;}
            paidInitialUsd+=m.cur==='USD'?amount/(1+IGTF):amount/rate;
            initialPayments.push({id:m.id,name:m.name,cur:m.cur,amount,ref});
          }
          if(Math.abs(r2(paidInitialUsd-inicialUsd))>0.01){msg('La inicial debe quedar cubierta exactamente. Requerida: '+usd(inicialUsd)+'; distribuida: '+usd(paidInitialUsd)+'.','bad');return false;}
          const result={
            aprobacion: token,
            ci,
            nivel: nivelTxt,
            totalVenta: totalSale,
            inicialUsd,
            initialPayments,
            inicialMetodoId: initialPayments.length===1?initialPayments[0].id:'',
            inicialMetodoName: initialPayments.map(p=>p.name).join(' + ')||'Sin inicial',
            financiadoUsd,
            cuotasCount: cuotas,
            cuotaUsd
          };
          closeWin();
          onApplied(result);
          return false;
        }
      }
    ],
    onClose:()=>{closeWin();if(onCancel)onCancel();}
  });
}

function casheaSimulatorDlg(){
  const rate = S.cfg.rate;
  const el = h('<div class="form" style="gap:12px">'+
    '<div style="background:#1E1B4B;border:1px solid #4338CA;border-radius:8px;padding:12px;color:#EEF2FF">'+
      '<div style="font-size:16px;font-weight:700;color:#FBBF24">⚡ Simulador de Cuotas CASHEA</div>'+
      '<div style="font-size:12px;color:#C7D2FE">Calcule en segundos el pago inicial y las cuotas quincenales para orientar al cliente en mostrador</div>'+
    '</div>'+
    '<div class="docgrid">'+
      '<div class="f"><label>Monto de la compra (US$)</label><input class="fld r big" id="simUsd" type="number" step="0.5" value="100.00"></div>'+
      '<div class="f"><label>Tasa oficial BCV</label><input class="fld r" id="simRate" value="'+nf(rate)+' Bs." readonly></div>'+
      '<div class="f wide"><label>Nivel del cliente en Cashea</label>'+
        '<select class="fld" id="simLevel">'+
          '<option value="40" selected>Nivel 3, 4 y 5 (Inicial 40% / Financiado 60% en 3 cuotas)</option>'+
          '<option value="50">Nivel 2 (Inicial 50% / Financiado 50% en 3 cuotas)</option>'+
          '<option value="60">Nivel 1 (Inicial 60% / Financiado 40% en 3 cuotas)</option>'+
          '<option value="0">Línea Cotidiana / Nivel Más (Inicial 0% / Financiado 100% a 14 días)</option>'+
        '</select>'+
      '</div>'+
    '</div>'+
    '<div class="cashea-calc-box" id="simResultBox"></div>'+
  '</div>');

  const simUsd = $('#simUsd', el);
  const simLevel = $('#simLevel', el);
  const resultBox = $('#simResultBox', el);

  function recalc(){
    const tot = Math.max(0, Number(simUsd.value) || 0);
    const pct = Number(simLevel.value) || 0;
    const cuotas = pct === 0 ? 1 : 3;
    const inicial = r2(tot * (pct / 100));
    const financiado = r2(tot - inicial);
    const cuota = r2(financiado / cuotas);
    const now = Date.now(), dayMs = 86400000;

    let cHtml = '';
    for(let c = 1; c <= cuotas; c++){
      const dt = new Date(now + c * 14 * dayMs).toLocaleDateString('es-VE');
      cHtml += '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.1);font-size:12.5px">'+
        '<span>Cuota '+c+' (en '+(c*14)+' días · '+dt+'):</span>'+
        '<b style="color:#A7F3D0">'+usd(cuota)+' <span style="color:#FBBF24;font-size:11px">('+bsf(cuota*rate)+')</span></b>'+
      '</div>';
    }

    resultBox.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
      '<div style="background:rgba(255,255,255,0.06);padding:10px;border-radius:6px">'+
        '<div style="font-size:11px;color:#C7D2FE;text-transform:uppercase">Inicial en mostrador ('+pct+'%)</div>'+
        '<div style="font-size:22px;font-weight:700;color:#A7F3D0">'+usd(inicial)+'</div>'+
        '<div style="font-size:12px;color:#FBBF24">'+bsf(inicial*rate)+'</div>'+
      '</div>'+
      '<div style="background:rgba(255,255,255,0.06);padding:10px;border-radius:6px">'+
        '<div style="font-size:11px;color:#C7D2FE;text-transform:uppercase">Financiado Cashea ('+(100-pct)+'%)</div>'+
        '<div style="font-size:22px;font-weight:700;color:#FBBF24">'+usd(financiado)+'</div>'+
        '<div style="font-size:12px;color:#94A3B8">'+bsf(financiado*rate)+'</div>'+
      '</div>'+
    '</div>'+
    '<div style="font-size:12px;font-weight:600;color:#C7D2FE;margin-bottom:6px">Cronograma de pagos del cliente:</div>'+
    cHtml;
  }

  simUsd.addEventListener('input', recalc);
  simLevel.addEventListener('change', recalc);
  recalc();

  openWin({
    title: 'Simulador de Cuotas Cashea (BNPL)',
    w: 580,
    body: el,
    foot: [{ label: 'Cerrar', primary: true }]
  });
}

function casheaPrintVoucherDlg(m){
  const rate = S.cfg.rate;
  const now = m.ts ? fmtDT(m.ts) : fmtDT(Date.now());
  const el = h('<div class="form" style="gap:10px">'+
    '<div class="ticket-roll-wrap"><pre class="ticket-80mm" style="font-family:IBM Plex Mono,monospace;font-size:12px;line-height:1.35;white-space:pre">'+
      '========================================\n'+
      '      COMPROBANTE FINANCIAMIENTO       \n'+
      '             CASHEA (BNPL)              \n'+
      '========================================\n'+
      esc(S.cfg.empresa)+'\n'+
      'RIF: '+esc(S.cfg.rif)+'\n'+
      '----------------------------------------\n'+
      'Nº APROBACIÓN : '+esc(m.aprobacion)+'\n'+
      'FECHA / HORA  : '+now+'\n'+
      'VENTA FACTURA : #'+pad(m.ventaNo)+'\n'+
      'Nº CONTROL    : '+(m.ctrlNo||'--')+'\n'+
      'ESTADO        : '+esc(m.estado)+'\n'+
      '----------------------------------------\n'+
      'DATOS DEL CLIENTE:\n'+
      'Titular       : '+esc(m.clienteNombre)+'\n'+
      'Cédula / RIF  : '+esc(m.clienteCi)+'\n'+
      '----------------------------------------\n'+
      'DESGLOSE FINANCIERO:\n'+
      'Total Venta   : '+usd(m.totalVenta)+' ('+bsf(m.totalVenta*rate)+')\n'+
      'Inicial Caja  : '+usd(m.inicialUsd)+' ('+bsf(m.inicialUsd*rate)+')\n'+
      'Financiado    : '+usd(m.financiadoUsd)+' ('+bsf(m.financiadoUsd*rate)+')\n'+
      '----------------------------------------\n'+
      'PLAN DE '+m.cuotasCount+' CUOTAS QUINCENALES:\n'+
      'Cuota quincenal: '+usd(m.cuotaUsd)+' c/u\n'+
      '----------------------------------------\n'+
      (m.loteLiquidacion ? ('LIQUIDACIÓN BANCARIA:\nLote: '+esc(m.loteLiquidacion)+'\nFecha: '+fmtDT(m.fechaLiquidacion)+'\n----------------------------------------\n') : '')+
      '   FIRMA CLIENTE: __________________\n'+
      '       C.I.: '+esc(m.clienteCi)+'\n\n'+
      '   FIRMA CAJERO:  __________________\n'+
      '========================================\n'+
      '  CONCILIACIÓN OFICIAL CASHEA TECHNOLOGIES\n'+
      '========================================'+
    '</pre></div>'+
    '<div class="row" style="justify-content:flex-end"><button class="btn primary" id="btnPrintCshVoucher">Imprimir Comprobante</button></div>'+
  '</div>');

  $('#btnPrintCshVoucher', el).addEventListener('click', () => {
    const wrap = $('#fiscalPrintWrap');
    wrap.innerHTML = '<pre style="font-family:IBM Plex Mono,monospace;font-size:12px;padding:20px">'+$('pre', el).textContent+'</pre>';
    window.print();
  });

  openWin({
    title: 'Comprobante Cashea - ' + m.aprobacion,
    w: 520,
    body: el,
    foot: [{ label: 'Cerrar', primary: true }]
  });
}

function casheaSettlementDlg(onDone){
  const allPendings = (S.casheaMovimientos || []).filter(m => m.estado === 'Pendiente Liquidación');
  let pendings = allPendings.slice();
  if(!pendings.length){
    msg('No hay operaciones de Cashea pendientes de liquidación.', 'bad');
    return;
  }
  const rate = S.cfg.rate;
  let totFinanciado = pendings.reduce((acc, m) => acc + (m.financiadoUsd || 0), 0);

  const el = h('<div class="form" style="gap:12px">'+
    '<div style="background:#1E1B4B;border:1px solid #4338CA;border-radius:8px;padding:12px;color:#EEF2FF">'+
      '<b style="font-size:15px;color:#FBBF24">📥 Registrar Liquidación de Lote CASHEA</b>'+
      '<div style="font-size:12px;color:#C7D2FE">Seleccione las operaciones incluidas en este depósito real de Cashea. Se puede liquidar un subconjunto y conciliar el resto posteriormente.</div>'+
    '</div>'+
    '<div class="gridwrap" style="max-height:180px"><table class="grid"><thead><tr><th>Incluir</th><th>Factura</th><th>Cliente</th><th class="r">Financiado US$</th></tr></thead><tbody>'+
      allPendings.map(m=>'<tr><td><input type="checkbox" data-liq-op="'+esc(m.id)+'" checked aria-label="Incluir operación '+esc(m.id)+'"></td><td>'+esc(m.ventaNo)+'</td><td>'+esc(m.clienteNombre||m.clienteCi||'—')+'</td><td class="r">'+esc(usd(m.financiadoUsd||0))+'</td></tr>').join('')+
    '</tbody></table></div>'+
    '<div class="docgrid">'+
      '<div class="f"><label>Nº de Operaciones pendientes</label><input class="fld mono" value="'+pendings.length+' facturas" readonly></div>'+
      '<div class="f"><label>Total Bruto por Cobrar (US$)</label><input class="fld r mono" id="liqBruto" value="'+nf(totFinanciado)+'" readonly style="font-weight:700"></div>'+
      '<div class="f wide"><label>Banco Receptor del Comercio</label>'+
        '<select class="fld" id="liqBanco">'+
          '<option value="Banco Mercantil">Banco Mercantil (Cta. Corriente)</option>'+
          '<option value="Banesco Banco Universal">Banesco Banco Universal</option>'+
          '<option value="Banco de Venezuela">Banco de Venezuela (BDV)</option>'+
          '<option value="Banco Nacional de Crédito (BNC)">Banco Nacional de Crédito (BNC)</option>'+
          '<option value="Bancamiga Banco Universal">Bancamiga Banco Universal</option>'+
        '</select>'+
      '</div>'+
      '<div class="f"><label>Nº Referencia Transferencia Cashea</label><input class="fld mono" id="liqRef" placeholder="Referencia bancaria real" autocomplete="off"></div>'+
      '<div class="f"><label>% Comisión Cashea (MDR)</label><input class="fld r" id="liqComPct" type="number" min="0" max="100" step="0.01" required placeholder="Según contrato"></div>'+
      '<div class="f wide"><label>Monto neto depositado según banco (US$ equivalente)</label><input class="fld r mono" id="liqDeposit" inputmode="decimal" autocomplete="off" placeholder="Registra el monto real del estado de cuenta"></div>'+
    '</div>'+
    '<div class="cashea-calc-box" id="liqCalcBox"></div>'+
  '</div>');

  const comPctInp = $('#liqComPct', el);
  const calcBox = $('#liqCalcBox', el);
  const refInp = $('#liqRef', el);
  const depositInp = $('#liqDeposit', el);
  const bancoSel = $('#liqBanco', el);
  el.addEventListener('change', e => {
    const checkbox = e.target.closest('[data-liq-op]');
    if(!checkbox)return;
    const selected = new Set($('[data-liq-op]',el).filter(input=>input.checked).map(input=>input.dataset.liqOp));
    pendings = allPendings.filter(m=>selected.has(String(m.id)));
    totFinanciado = r2(pendings.reduce((acc,m)=>acc+Number(m.financiadoUsd||0),0));
    $('#liqBruto',el).value=nf(totFinanciado);
    recalc();
  });

  function recalc(){
    const pct = Math.max(0, Number(comPctInp.value) || 0);
    const comUsd = r2(totFinanciado * (pct / 100));
    const netoUsd = r2(totFinanciado - comUsd);
    const depositRaw=depositInp.value.trim();
    const depositUsd=depositRaw?pn(depositRaw):null;
    const diff=depositUsd===null?null:r2(depositUsd-netoUsd);
    calcBox.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;text-align:center">'+
      '<div style="background:rgba(255,255,255,0.06);padding:8px;border-radius:6px">'+
        '<small style="color:#C7D2FE;font-size:10px">TOTAL BRUTO</small>'+
        '<div style="font-size:16px;font-weight:700">'+usd(totFinanciado)+'</div>'+
        '<small style="color:#94A3B8">'+bsf(totFinanciado*rate)+'</small>'+
      '</div>'+
      '<div style="background:rgba(255,255,255,0.06);padding:8px;border-radius:6px">'+
        '<small style="color:#F87171;font-size:10px">COMISIÓN ('+pct+'%)</small>'+
        '<div style="font-size:16px;font-weight:700;color:#F87171">- '+usd(comUsd)+'</div>'+
        '<small style="color:#94A3B8">'+bsf(comUsd*rate)+'</small>'+
      '</div>'+
      '<div style="background:rgba(255,255,255,0.06);padding:8px;border-radius:6px">'+
        '<small style="color:#A7F3D0;font-size:10px">NETO ESPERADO</small>'+
        '<div style="font-size:16px;font-weight:700;color:#A7F3D0">'+usd(netoUsd)+'</div>'+
        '<small style="color:#FBBF24">'+bsf(netoUsd*rate)+'</small>'+
      '</div>'+
    '</div><div style="margin-top:10px;padding:10px;border:1px solid '+(diff===null?'#475569':Math.abs(diff)<=0.01?'#059669':'#B45309')+';border-radius:6px;font-size:12px;color:#E2E8F0">'+
      (diff===null?'Registra el depósito real para comparar con el neto esperado.':'Diferencia bancaria: <b style="color:'+(Math.abs(diff)<=0.01?'#6EE7B7':'#FCD34D')+'">'+usd(diff)+'</b> · '+(Math.abs(diff)<=0.01?'Coincide con el neto esperado.':'No coincide; la liquidación no se confirmará.'))+
    '</div>';
  }
  comPctInp.addEventListener('input', recalc);
  depositInp.addEventListener('input', recalc);
  recalc();

  openWin({
    title: 'Liquidación de Lote Cashea',
    w: 620,
    body: el,
    foot: [
      { label: 'Cancelar' },
      {
        label: 'Confirmar y Liquidar Lote',
        primary: true,
        fn: () => {
          const ref = refInp.value.trim();
          const depositRaw = depositInp.value.trim();
          const pct = Number(comPctInp.value);
          if(!pendings.length){msg('Seleccione al menos una operación pendiente para liquidar.','bad');return false;}
          const comUsd = r2(totFinanciado * (pct / 100));
          const netoUsd = r2(totFinanciado - comUsd);
          const depositUsd = depositRaw ? pn(depositRaw) : null;
          if(!ref){ msg('Ingrese la referencia bancaria real de Cashea.', 'bad'); return false; }
          if(!depositRaw || depositUsd===null || !comPctInp.value.trim() || !Number.isFinite(pct) || pct<0 || pct>100){ msg('Registre el depósito real y una comisión válida entre 0 % y 100 %.', 'bad'); return false; }
          if(Math.abs(depositUsd-netoUsd)>0.01){ msg('Liquidación rechazada: el depósito real ('+usd(depositUsd)+') no coincide con el neto esperado ('+usd(netoUsd)+'). Revise la comisión o el estado de cuenta.', 'bad'); return false; }
          const loteId = 'LIQ-CSH-' + Date.now().toString(36).toUpperCase();
          const now = Date.now();
          pendings.forEach(m => {
            m.estado = 'Liquidado';
            m.loteLiquidacion = loteId;
            m.fechaLiquidacion = now;
            m.bancoReceptor = bancoSel.value;
            m.refBancaria = ref;
            m.comisionPct = pct;
            m.comisionUsd = r2((m.financiadoUsd||0) * pct / 100);
            m.netoEsperadoUsd = r2((m.financiadoUsd||0) - m.comisionUsd);
            m.tasaBcvLiquidacion = rate;
          });
          if(!Array.isArray(S.casheaLiquidaciones))S.casheaLiquidaciones=[];
          S.casheaLiquidaciones.push({id:loteId,fecha:now,operaciones:pendings.map(m=>m.id),cantidad:pendings.length,banco:bancoSel.value,referencia:ref,brutoUsd:r2(totFinanciado),comisionPct:pct,comisionUsd:comUsd,netoEsperadoUsd:netoUsd,depositadoUsd:depositUsd,diferenciaUsd:r2(depositUsd-netoUsd),tasaBcv:rate});
          save();
          msg('Lote '+loteId+' conciliado y guardado ('+pendings.length+' facturas).');
          if(onDone) onDone();
          return true;
        }
      }
    ]
  });
}

function reverseCasheaSettlement(movementId,onDone){
  const movement=(S.casheaMovimientos||[]).find(m=>String(m.id)===String(movementId));
  if(!movement||movement.estado!=='Liquidado'||!movement.loteLiquidacion){msg('La operación no tiene una liquidación activa que pueda revertirse.','bad');return false;}
  const lot=(S.casheaLiquidaciones||[]).find(item=>item.id===movement.loteLiquidacion&&item.tipo!=='REVERSIÓN');
  if(!lot||lot.estado==='Revertido'){msg('El lote ya fue revertido o no existe en el historial.','bad');return false;}
  if(!window.SIFERAccess||typeof window.SIFERAccess.requestPin!=='function'){msg('No se puede revertir: el servicio de autorización no está disponible.','bad');return false;}
  if(!window.SIFERAccess.requestPin('Revertir liquidación CASHEA '+lot.id))return false;
  const motivo=window.prompt('Indique el motivo de la reversión del lote '+lot.id+':','');
  if(!motivo||!motivo.trim()){msg('La reversión requiere un motivo para auditoría.','bad');return false;}
  if(!confirm('¿Revertir el lote '+lot.id+'? Las operaciones volverán a pendientes y el motivo quedará registrado.'))return false;
  const now=Date.now(), revId='REV-CSH-'+now.toString(36).toUpperCase();
  const affected=(S.casheaMovimientos||[]).filter(m=>m.estado==='Liquidado'&&m.loteLiquidacion===lot.id);
  if(!affected.length){msg('No hay operaciones activas en ese lote.','bad');return false;}
  lot.estado='Revertido';lot.revertidoAt=now;lot.revertidoPor=currentCajero();lot.reversionId=revId;lot.motivoReversion=motivo.trim();
  affected.forEach(m=>{
    m.loteLiquidacionAnterior=lot.id;
    m.estado='Pendiente Liquidación';
    m.loteLiquidacion='';
    delete m.bancoReceptor;delete m.refBancaria;delete m.comisionPct;delete m.comisionUsd;delete m.netoEsperadoUsd;delete m.tasaBcvLiquidacion;delete m.fechaLiquidacion;
  });
  S.casheaLiquidaciones.push({id:revId,tipo:'REVERSIÓN',fecha:now,loteOriginal:lot.id,operaciones:affected.map(m=>m.id),cantidad:affected.length,operador:currentCajero(),motivo:motivo.trim(),estado:'Registrada'});
  save();
  msg('Reversión '+revId+' registrada. '+affected.length+' operaciones regresaron a pendientes.');
  if(onDone)onDone();
  return true;
}

function casheaDlg(defaultTab){
  let curTab = defaultTab || 'ALL';
  let query = '';
  const rate = S.cfg.rate;

  const el = h('<div class="form" style="gap:12px">'+
    '<div class="kpi-grid" id="cshKpis"></div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;background:var(--alt);padding:8px 10px;border:1px solid var(--lo);border-radius:6px">'+
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+
        '<button class="btn mini2" id="cshBtnSim" style="background:#312E81;color:#E0E7FF;border-color:#4338CA;font-weight:700">⚡ Simulador de Cuotas</button>'+
        '<button class="btn mini2" id="cshBtnLiq" style="background:#064E3B;color:#A7F3D0;border-color:#059669;font-weight:700">📥 Registrar Liquidación de Lote</button>'+
        '<button class="btn mini2" id="cshBtnCsv">📊 Exportar Reporte (CSV)</button>'+
      '</div>'+
      '<div style="display:flex;gap:8px;align-items:center">'+
        '<select class="fld mini" id="cshStatusFilter" style="width:170px">'+
          '<option value="ALL">Todos los estados</option>'+
          '<option value="Pendiente Liquidación">Pendientes de Liquidación</option>'+
          '<option value="Liquidado">Liquidados por Cashea</option>'+
        '</select>'+
        '<input class="fld mini" id="cshSearch" placeholder="Buscar por cliente, CI, CSH-..." style="width:200px">'+
      '</div>'+
    '</div>'+
    '<div class="gridwrap" style="max-height:360px"><table class="grid" id="cshTable">'+
      '<thead><tr>'+
        '<th>ID Mov.</th>'+
        '<th>Factura</th>'+
        '<th>Fecha</th>'+
        '<th>Cliente</th>'+
        '<th>Token Cashea</th>'+
        '<th class="r">Total Venta</th>'+
        '<th class="r">Inicial Caja</th>'+
        '<th class="r">Financiado</th>'+
        '<th class="c">Cuotas</th>'+
        '<th class="c">Estado</th>'+
        '<th class="c">Acciones</th>'+
      '</tr></thead>'+
      '<tbody id="cshRows"></tbody>'+
    '</table></div>'+
    '<div class="hint">Las ventas con Cashea permiten cobrar la inicial en el mostrador y financiar el saldo en 3 cuotas quincenales sin interés. El saldo pendiente representa una Cuenta por Cobrar a Cashea Technologies.</div>'+
  '</div>');

  function render(){
    const list = S.casheaMovimientos || [];
    const totVentas = list.reduce((a, m) => a + (m.totalVenta || 0), 0);
    const totInicial = list.reduce((a, m) => a + (m.inicialUsd || 0), 0);
    const pendings = list.filter(m => m.estado === 'Pendiente Liquidación');
    const totPendiente = pendings.reduce((a, m) => a + (m.financiadoUsd || 0), 0);
    const liquidados = list.filter(m => m.estado === 'Liquidado');
    const totLiquidado = liquidados.reduce((a, m) => a + (m.financiadoUsd || 0), 0);

    $('#cshKpis', el).innerHTML = '<div class="kpi-card">'+
        '<div class="klabel">Total Facturado Cashea</div>'+
        '<div class="kval" style="color:#A5B4FC">'+usd(totVentas)+'</div>'+
        '<div class="ksub">'+bsf(totVentas*rate)+'</div>'+
      '</div>'+
      '<div class="kpi-card">'+
        '<div class="klabel">Iniciales Cobradas</div>'+
        '<div class="kval" style="color:#A7F3D0">'+usd(totInicial)+'</div>'+
        '<div class="ksub">'+bsf(totInicial*rate)+'</div>'+
      '</div>'+
      '<div class="kpi-card">'+
        '<div class="klabel">Por Liquidar (CxC Cashea)</div>'+
        '<div class="kval" style="color:#FBBF24">'+usd(totPendiente)+'</div>'+
        '<div class="ksub">'+pendings.length+' facturas pendientes</div>'+
      '</div>'+
      '<div class="kpi-card">'+
        '<div class="klabel">Total Liquidado</div>'+
        '<div class="kval" style="color:#34D399">'+usd(totLiquidado)+'</div>'+
        '<div class="ksub">'+liquidados.length+' facturas conciliadas</div>'+
      '</div>';

    const q = norm(query);
    const filtered = list.filter(m => {
      if(curTab !== 'ALL' && m.estado !== curTab) return false;
      if(!q) return true;
      const haystack = norm((m.id||'')+' '+(m.ventaNo||'')+' '+(m.clienteNombre||'')+' '+(m.clienteCi||'')+' '+(m.aprobacion||'')+' '+(m.loteLiquidacion||''));
      return haystack.includes(q);
    }).slice().sort((a,b) => (b.ts||0) - (a.ts||0));

    const rows = $('#cshRows', el);
    if(!filtered.length){
      rows.innerHTML = '<tr class="empty"><td colspan="11">No se encontraron operaciones de Cashea registradas.</td></tr>';
      return;
    }
    rows.innerHTML = filtered.map(m => {
      const isOk = m.estado === 'Liquidado';
      const stBadge = '<span class="badge-cashea '+(isOk?'ok':'pend')+'">'+esc(m.estado)+'</span>';
      return '<tr>'+
        '<td class="mono" style="font-size:11px">'+esc(m.id)+'</td>'+
        '<td><b>#'+pad(m.ventaNo)+'</b></td>'+
        '<td style="font-size:11.5px">'+esc(fmtDT(m.ts||Date.now()))+'</td>'+
        '<td>'+esc(m.clienteNombre)+'<div class="sub mono">'+esc(m.clienteCi)+'</div></td>'+
        '<td class="mono" style="font-weight:700;color:#6366F1">'+esc(m.aprobacion)+'</td>'+
        '<td class="r">'+usd(m.totalVenta)+'</td>'+
        '<td class="r" style="color:#10B981">'+usd(m.inicialUsd)+'</td>'+
        '<td class="r" style="font-weight:700;color:#F59E0B">'+usd(m.financiadoUsd)+'</td>'+
        '<td class="c mono" style="font-size:11.5px">'+(m.cuotasCount||3)+'x '+usd(m.cuotaUsd)+'</td>'+
        '<td class="c">'+stBadge+'</td>'+
        '<td class="c">'+
          '<button class="btn mini2" data-csh-vouch="'+esc(m.id)+'" title="Ver Comprobante">Voucher</button> '+
          '<button class="btn mini2" data-csh-ticket="'+m.ventaNo+'" title="Ver Ticket Térmico 80mm">Ticket</button>'+
          (isOk?'<button class="btn mini2" data-csh-reverse="'+esc(m.id)+'" title="Revertir lote conciliado">Revertir lote</button>':'')+
        '</td>'+
      '</tr>';
    }).join('');
  }

  $('#cshStatusFilter', el).value = curTab;
  $('#cshStatusFilter', el).addEventListener('change', e => { curTab = e.target.value; render(); });
  $('#cshSearch', el).addEventListener('input', e => { query = e.target.value.trim(); render(); });
  $('#cshBtnSim', el).addEventListener('click', () => casheaSimulatorDlg());
  $('#cshBtnLiq', el).addEventListener('click', () => casheaSettlementDlg(() => render()));
  $('#cshBtnCsv', el).addEventListener('click', () => {
    const list = S.casheaMovimientos || [];
    if(!list.length){ msg('No hay datos para exportar.', 'bad'); return; }
    let csv = 'ID;Venta;Fecha;Cliente;CI;Aprobacion;Total_USD;Inicial_USD;Financiado_USD;Cuotas;Cuota_USD;Estado;Lote_Liquidacion;Banco;Referencia_Bancaria;Comision_Pct;Comision_USD;Neto_Esperado_USD;Deposito_Lote_USD;Diferencia_Lote_USD;Tasa_BCV_Liquidacion\n';
    const exportedLots = new Set();
    list.forEach(m => {
      const batch=(S.casheaLiquidaciones||[]).find(l=>l.id===m.loteLiquidacion);
      const includeBatch=!!batch&&!exportedLots.has(batch.id);
      if(includeBatch)exportedLots.add(batch.id);
      csv += [m.id, m.ventaNo, fmtDT(m.ts||0), m.clienteNombre, m.clienteCi, m.aprobacion, m.totalVenta, m.inicialUsd, m.financiadoUsd, m.cuotasCount, m.cuotaUsd, m.estado, m.loteLiquidacion||'', m.bancoReceptor||'', m.refBancaria||'', m.comisionPct??'', m.comisionUsd??'', m.netoEsperadoUsd??'', includeBatch?batch.depositadoUsd:'', includeBatch?batch.diferenciaUsd:'', m.tasaBcvLiquidacion??''].join(';') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cashea-lote-'+new Date().toISOString().slice(0,10)+'.csv';
    a.click();
    msg('Archivo CSV de Cashea exportado correctamente.');
  });

  $('#cshRows', el).addEventListener('click', e => {
    const bReverse = e.target.closest('[data-csh-reverse]');
    if(bReverse){
      const movement=(S.casheaMovimientos||[]).find(x=>x.id===bReverse.dataset.cshReverse);
      if(movement)reverseCasheaSettlement(movement.id,()=>render());
      return;
    }
    const bVouch = e.target.closest('[data-csh-vouch]');
    if(bVouch){
      const m = (S.casheaMovimientos || []).find(x => x.id === bVouch.dataset.cshVouch);
      if(m) casheaPrintVoucherDlg(m);
      return;
    }
    const bTick = e.target.closest('[data-csh-ticket]');
    if(bTick){
      const sale = (S.sales || []).find(x => x.no === Number(bTick.dataset.cshTicket));
      if(sale) showTicket(sale);
      else msg('No se encontró la factura #'+bTick.dataset.cshTicket, 'bad');
    }
  });

  render();

  openWin({
    title: 'MÓDULO CASHEA — Pagos en Cuotas (BNPL), Aprobaciones y Conciliación',
    w: 1040,
    body: el,
    foot: [{ label: 'Cerrar', primary: true }]
  });
}

/* ---------- cobro (con soporte de CASHEA y Crédito / CxC) ---------- */
function payDlg(draft){
  const loginUser=activeUser();
  if(loginUser.role==='admin'){
    if(currentCaja()==='SIN-ASIGNAR'){msg('Para cobrar como administrador, cree una caja y asígnesela en Gestión de Usuarios.','bad');usersManagementDlg(loginUser.username);return;}
    const opening=readActiveOpening();
    if(!opening||opening.status!=='abierta'||String(opening.cashbox)!==currentCaja()){msg('Abra primero el turno de su caja desde Reporte Z antes de cobrar.','bad');corteZDlg();return;}
  }
  draft=draft||{};
  if(!S.cart.length){msg('Agregue productos antes de cobrar.','bad');return;}
  const t=totals(),rate=S.cfg.rate;
  const rowsHtml=METHODS.map(m=>{
    const isBio=m.id==='biopago';
    const isCashea=m.id==='cashea';
    const hasRef=['biopago','punto','pmovil','transf','zelle','cashea'].includes(m.id);
    return '<tr>'+
      '<td><b>'+esc(m.name)+'</b>'+(isBio?' <span class="fiscal-tag ok" style="font-size:10px;padding:1px 5px;margin-left:4px">BDV Huella</span>':'')+(isCashea?' <span class="badge-cashea" style="margin-left:4px">3 Cuotas BNPL</span>':'')+'</td>'+
      '<td class="c mono" style="font-weight:600">'+(m.cur==='USD'?'US$':'Bs.')+'</td>'+
      '<td class="r"><input class="fld r pin" id="pm-'+m.id+'" data-m="'+m.id+'" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-label="Monto recibido en '+esc(m.name)+'"></td>'+
      '<td><button class="btn mini2" data-fill="'+m.id+'" type="button">Saldo</button>'+(isCashea?' <button class="btn mini2" id="btnCasheaAssistantInPay" type="button" style="background:#312E81;color:#E0E7FF;border-color:#4338CA;font-weight:700">⚡ Asistente</button>':'')+'</td>'+
      '<td>'+(hasRef?'<input class="fld mini mono pref" id="pref-'+m.id+'" data-m="'+m.id+'" placeholder="'+(m.id==='zelle'?'Confirmación Zelle':m.id==='punto'?'Voucher / autorización tarjeta':m.id==='biopago'?'Nº operación Biopago':m.id==='pmovil'?'Referencia pago móvil':m.id==='transf'?'Referencia transferencia':isCashea?'Aprobación real Cashea':'Referencia bancaria')+'" style="width:145px" title="'+(isCashea?'Código real de aprobación Cashea':'Referencia / autorización de '+m.name)+'">'
      :'<span class="hint" style="font-size:11px">—</span>')+'</td>'+
    '</tr>';
  }).join('');
  const el=h('<div class="form"><div class="paytop"><div class="lcd"><div class="lcd-label">TOTAL FACTURA</div><div class="lcd-bs">'+bsf(t.total*rate)+'</div><div class="lcd-usd">'+usd(t.total)+'</div></div><table class="sumt"><thead><tr><th>Concepto</th><th class="r">US$</th><th class="r">Bs.</th></tr></thead><tbody id="payRes"></tbody></table></div>'+
    '<div id="casheaPayPreview" hidden style="background:#1E1B4B;border:1px solid #4338CA;border-radius:6px;padding:8px 12px;margin:6px 0;font-size:12px;color:#E0E7FF;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>'+
    '<div class="invbar" style="background:var(--alt);padding:5px 8px;border:1px solid var(--lo)">'+
      '<label class="chk"><input type="checkbox" id="payCreditChk"> Enviar saldo pendiente a <b>Cuentas por Cobrar (CxC)</b></label>'+
      '<span id="payCreditDaysWrap" class="row" style="margin-left:auto" hidden><label for="payCreditDays">Plazo crédito (días):</label><input class="fld r" id="payCreditDays" value="15" style="width:64px" inputmode="numeric"></span>'+
    '</div>'+
    '<div class="gridwrap paywrap"><table class="grid"><thead><tr><th>Forma de pago</th><th class="c">Moneda</th><th class="r">Monto recibido</th><th></th><th>Ref. Bancaria / Aprob.</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div><p class="hint">Trazabilidad: Zelle, tarjeta/Punto, Biopago, Pago Móvil, transferencia y Cashea requieren referencia o autorización real. El efectivo no requiere referencia. Los pagos en divisas (efectivo US$ y Zelle) generan IGTF de 3 %; valide la aplicación fiscal según la operación real.</p></div>');
  const amts=()=>{const o={};METHODS.forEach(m=>{o[m.id]=pn($('#pm-'+m.id,el).value);});return o;};
  const refs=()=>{const o={};METHODS.forEach(m=>{const inp=$('#pref-'+m.id,el);o[m.id]=inp?inp.value.trim():'';});return o;};
  let last=null;
  METHODS.forEach(m=>{const a=$('#pm-'+m.id,el),r=$('#pref-'+m.id,el);if(a&&draft.amts&&draft.amts[m.id]>0)a.value=nf(draft.amts[m.id]);if(r&&draft.refs&&draft.refs[m.id])r.value=draft.refs[m.id];});
  if(draft.credit)$('#payCreditChk',el).checked=true;
  if(draft.cDays)$('#payCreditDays',el).value=String(draft.cDays);
  if(draft.casheaTx){
    el._casheaTx=draft.casheaTx;
    const prev=$('#casheaPayPreview',el);
    prev.hidden=false;
    prev.innerHTML='<b>⚡ CASHEA aplicado:</b> Aprobación <b>'+esc(draft.casheaTx.aprobacion)+'</b> · Inicial: <b>'+usd(draft.casheaTx.inicialUsd)+'</b> · Financiado: <b>'+usd(draft.casheaTx.financiadoUsd)+'</b> ('+draft.casheaTx.cuotasCount+' cuota(s) de '+usd(draft.casheaTx.cuotaUsd)+' c/u). Confirme el cobro para finalizar la factura; luego registre la liquidación en el módulo Cashea.';
  }
  const upd=()=>{
    const st=calcPay(t.total,rate,amts());last=st;
    const isCred=$('#payCreditChk',el).checked;
    $('#payCreditDaysWrap',el).hidden=!isCred;
    const row=(c,a,cls,tot)=>'<tr class="'+(cls||'')+(tot?' tot':'')+'"><td>'+c+'</td><td class="r">'+nf(a)+'</td><td class="r">'+nf(a*rate)+'</td></tr>';
    let html=row('Total factura',t.total)+row('IGTF 3 % (divisas)',st.igtf)+row('Total a cobrar',st.due,'',true);
    if(st.pending>=0.01){
      html+=row(isCred?'Saldo a Cuentas por Cobrar (CxC)':'Falta por cobrar',st.pending,isCred?'good':'warn');
    }
    else if(st.change>=0.01)html+=row('Vuelto al cliente',st.change,'good');
    else html+='<tr class="good"><td colspan="3">Saldo cubierto. Puede confirmar el cobro.</td></tr>';
    $('#payRes',el).innerHTML=html;
    const b=$('#btnConfirm');if(b)b.disabled=!(st.pending<0.01||isCred);
  };
  el.addEventListener('input',e=>{if(e.target.matches('.pin'))upd();});
  el.addEventListener('change',e=>{if(e.target.id==='payCreditChk')upd();});
  el.addEventListener('click',e=>{
    if(e.target.id==='btnCasheaAssistantInPay'||e.target.closest('#btnCasheaAssistantInPay')){
      const draftNow={amts:amts(),refs:refs(),credit:$('#payCreditChk',el).checked,cDays:Math.max(1,Math.round(pn($('#payCreditDays',el).value)||15)),casheaTx:el._casheaTx||null};
      casheaPaymentAssistantDlg(t.total,rate,(cData)=>{
        draftNow.casheaTx=cData;
        draftNow.refs={cashea:cData.aprobacion};
        draftNow.amts={cashea:cData.financiadoUsd};
        (cData.initialPayments||[]).forEach(p=>{draftNow.amts[p.id]=p.amount;if(p.ref)draftNow.refs[p.id]=p.ref;});
        payDlg(draftNow);
      },()=>payDlg(draftNow));
      return;
    }
    const b=e.target.closest('[data-fill]');if(!b)return;
    const m=METHODS.find(x=>x.id===b.dataset.fill),inp=$('#pm-'+m.id,el);
    inp.value='';
    const st=calcPay(t.total,rate,amts());
    if(st.pending>=0.005){
      const isDivisa=m.id==='efUSD'||m.id==='zelle';
      inp.value=nf(m.cur==='USD'?(isDivisa?r2(st.pending*(1+IGTF)):r2(st.pending)):r2(st.pending*rate));
    }
    upd();inp.focus();inp.select();
  });
  openWin({title:'Cobrar factura '+pad(S.invoice),w:760,body:el,
    foot:[{label:'Cancelar'},{id:'btnConfirm',label:'Confirmar cobro',primary:true,fn:()=>{
      const isCred=$('#payCreditChk',el).checked;
      if(!last||(last.pending>=0.01&&!isCred))return false;
      const enteredAmts=amts(),enteredRefs=refs();
      const refPrompts={zelle:'confirmación o referencia de Zelle',punto:'voucher o código de autorización de la tarjeta',biopago:'número de operación/autorización de Biopago',pmovil:'referencia del pago móvil',transf:'referencia de la transferencia',cashea:'código real de aprobación de Cashea'};
      for(const m of METHODS){if((enteredAmts[m.id]||0)>0&&refPrompts[m.id]&&!enteredRefs[m.id]){msg('Complete la '+refPrompts[m.id]+' para registrar la trazabilidad de '+m.name+'.','bad');const ri=$('#pref-'+m.id,el);if(ri)ri.focus();return false;}}
      if(enteredAmts.cashea>0&&el._casheaTx&&Math.abs(enteredAmts.cashea-el._casheaTx.financiadoUsd)>0.01){msg('El importe financiado no coincide con el plan Cashea aplicado. Vuelva al asistente.','bad');return false;}
      if(isCred&&last.pending>=0.01&&S.client.rif==='V-00000000'){
        msg('Para ventas a crédito (CxC), seleccione o registre primero el cliente (F4).','bad');
        return false;
      }
      const cDays=Math.max(1,Math.round(pn($('#payCreditDays',el).value)||15));
      finalize(last,enteredAmts,isCred,cDays,enteredRefs,el);return false;
    }}],
    onOpen:()=>{upd();$('#pm-efUSD',el).focus();}});
}

function showSaleCompletion(sale){
  const change=r2(Math.max(0,Number(sale.change)||0));
  const rate=Number(sale.rate||S.cfg.rate)||1;
  const hasChange=change>=0.01;
  const body=h('<div class="sale-completion">'+
    '<div class="sale-completion-icon '+(hasChange?'change':'success')+'">'+(hasChange?'↩':'✓')+'</div>'+
    '<div class="sale-completion-label">'+(hasChange?'VUELTO A ENTREGAR':'VENTA FINALIZADA')+'</div>'+
    (hasChange?'<div class="sale-completion-amount">'+esc(usd(change))+'</div><div class="sale-completion-equivalent">Equivalente: <b>'+esc(bsf(r2(change*rate)))+'</b></div><p class="sale-completion-note">Entregue el vuelto en efectivo según la moneda acordada con el cliente. Si el excedente provino de un pago electrónico, gestione la devolución por ese mismo medio.</p>':'<p class="sale-completion-note">La factura '+esc(pad(sale.no))+' fue registrada correctamente. No hay vuelto pendiente.</p>')+
    '<div class="sale-completion-ticket">Factura <b>'+esc(pad(sale.no))+'</b> · Total <b>'+esc(usd(r2(sale.total+sale.igtf)))+'</b></div>'+
    '</div>');
  openWin({title:hasChange?'Vuelto de la venta':'Venta finalizada',w:390,body,foot:[
    {label:'Ver / imprimir ticket',primary:true,fn:()=>{closeWin();showTicket(sale);return false;}},
    {label:'Cerrar'}
  ],onOpen:()=>{const node=$('.sale-completion',body);if(node)node.setAttribute('tabindex','-1');}});
}

function finalize(st,amts,isCred,cDays,refs,payEl){
  const ctx=cajaContext();if(ctx.role==='cajero'&&ctx.status!=='abierta'){msg('La caja no está abierta. Solicite al administrador una nueva apertura antes de facturar.','bad');return;}
  const t=totals(), ts=Date.now(), invNo=nextCajaInvoice();
  const lines=S.cart.map(l=>{
    const i=lineInfo(l);
    return{
      code:l.code,
      desc:i.p.brand+' '+i.p.desc,
      unit:i.p.unit||'und',
      qty:l.qty,
      price:i.p.price,
      disc:l.disc,
      taxRate:i.rate,
      taxType:(i.p.tax&&i.p.tax.type)||'G',
      taxTag:prodTaxTag(i.p),
      iva:i.iva,
      net:i.net
    };
  });
  const pays=METHODS.filter(m=>amts[m.id]>0).map(m=>({
    id:m.id,
    name:m.name,
    cur:m.cur,
    amount:r2(amts[m.id]),
    ref:(refs&&refs[m.id])||''
  }));
  const creditAmt=(isCred&&st.pending>=0.01)?r2(st.pending):0;
  if(creditAmt>0){
    pays.push({id:'credito',name:'Crédito CxC ('+cDays+' días)',cur:'USD',amount:creditAmt});
  }
  const ctrlPrefix=S.cfg.ctrlPrefix||'00-';
  const seqs=cajaSeqs(),boxSeq=seqs[currentCaja()]||(seqs[currentCaja()]={invoice:1,void:1,refund:1,cxc:1,movement:1,z:1});
  const ctrlNext=Number(boxSeq.ctrl||1);boxSeq.ctrl=ctrlNext+1;localStorage.setItem('sifer360_box_sequences',JSON.stringify(seqs));
  const ctrlNo=ctrlPrefix+String(currentCaja()).replace(/\W/g,'').slice(-4)+'-'+pad(ctrlNext,8);
  const sale={
    no:invNo,ctrlNo,docType:'01-FACTURA',transType:'01-REG',
    ts,cashbox:currentCaja(),cashier:currentCajero(),client:Object.assign({},S.client),lines,
    sub:t.sub,disc:t.disc,base:t.base,
    baseG16:t.baseG16,baseR8:t.baseR8,baseA31:t.baseA31,baseEx:t.baseEx,
    iva:t.iva,total:t.total,igtf:st.igtf,rate:S.cfg.rate,pays,
    change:r2(st.change),credit:creditAmt,void:false
  };

  const casheaAmt=r2(amts.cashea||0);
  if(casheaAmt>0){
    const cRef=(refs&&refs.cashea)||'';
    if(!cRef){msg('Falta el código real de aprobación Cashea; no se generará una referencia ficticia.','bad');return;}
    const cTx=(payEl&&payEl._casheaTx)||{};
    const inicialUsd=cTx.inicialUsd!==undefined?cTx.inicialUsd:r2(t.total-casheaAmt);
    const nivel=cTx.nivel||'Nivel 3 (40% inicial / 60% financiado)';
    const cuotasCount=cTx.cuotasCount||3;
    const cuotaUsd=r2(casheaAmt/cuotasCount);
    sale.cashea={
      aprobacion:cRef,
      ci:S.client.rif,
      cliente:S.client.name,
      nivel,
      totalVenta:t.total,
      inicialUsd,
      inicialMetodo:cTx.inicialMetodoName||'Caja',
      financiadoUsd:casheaAmt,
      cuotasCount,
      cuotaUsd,
      fechasCuotas:Array.from({length:cuotasCount},(_,i)=>ts+(i+1)*14*86400000).map(fmtDT),
      estado:'Pendiente Liquidación'
    };
    if(!Array.isArray(S.casheaMovimientos))S.casheaMovimientos=[];
    S.casheaMovimientos.push({
      id:'CSH-MOV-'+pad(S.casheaMovimientos.length+1,4),
      ventaNo:invNo,
      ctrlNo,
      ts,
      clienteCi:S.client.rif,
      clienteNombre:S.client.name,
      aprobacion:cRef,
      totalVenta:t.total,
      inicialUsd,
      financiadoUsd:casheaAmt,
      cuotasCount,
      cuotaUsd,
      estado:'Pendiente Liquidación',
      loteLiquidacion:null,
      fechaLiquidacion:null
    });
  }

  S.cart.forEach(l=>{
    const p=prod(l.code);
    p.stock=Math.max(0,r2(p.stock-l.qty));
    addKardex({
      ts,code:p.code,type:'VENTA',dir:'OUT',doc:'FAC-'+pad(invNo),
      party:S.client.name,qty:l.qty,stockAfter:p.stock,cost:p.cost,user:S.cfg.cajero
    });
  });
  if(creditAmt>0){
    const paidUpfront=r2(Math.max(0,t.total-creditAmt));
    S.cxc.push({
      id:'CXC-'+String(currentCaja()).replace(/\W/g,'')+'-'+pad(S.cxc.filter(x=>x.cashbox===currentCaja()).length+1,6),
      cashbox:currentCaja(),cashier:currentCajero(),saleNo:invNo,
      doc:'FAC-'+pad(invNo),
      client:Object.assign({},S.client),
      concept:'Factura de venta ('+lines.length+' reng.)',
      ts,dueTs:ts+cDays*86400000,
      total:t.total,
      paid:paidUpfront,
      payments:paidUpfront>0?[{ts,method:'Pago inicial en caja',cur:'USD',amountUsd:paidUpfront,amountBs:r2(paidUpfront*S.cfg.rate),ref:'FAC-'+pad(invNo),note:'Abono en caja al facturar'}]:[]
    });
  }
  S.sales.push(sale);S.invoice=Math.max(S.invoice,invNo+1);S.cart=[];S.sel=-1;S.client=S.clients[0];
  save();renderAll();
  msg('Factura '+pad(sale.no)+' procesada por '+usd(r2(sale.total+sale.igtf))+(casheaAmt>0?' (Financiado Cashea: '+usd(casheaAmt)+')':'')+(creditAmt>0?' (Saldo a CxC: '+usd(creditAmt)+')':'')+'.');
  showSaleCompletion(sale);
}

const TICKET_FONTS=[
  {id:'ibm',name:'Térmica POS 80mm (IBM Plex Mono)',css:'"IBM Plex Mono",Consolas,"Liberation Mono",monospace'},
  {id:'jetbrains',name:'Térmica Alta Nitidez (JetBrains Mono)',css:'"JetBrains Mono",Consolas,monospace'},
  {id:'courier',name:'Térmica Fiscal Clásica (Courier Prime / Courier New)',css:'"Courier Prime","Courier New",Courier,monospace'},
  {id:'roboto',name:'Térmica Condensada Epson/Bixolon (Roboto Mono)',css:'"Roboto Mono","Lucida Console",Consolas,monospace'},
  {id:'inconsolata',name:'Térmica Compacta Tirilla (Inconsolata / Lucida)',css:'"Inconsolata","Lucida Console",Consolas,monospace'},
  {id:'sans',name:'Térmica Comercial Moderna (Segoe UI / Tahoma Tabular)',css:'"Segoe UI",Tahoma,Verdana,sans-serif'}
];
function getTicketFontCss(id){
  const f=TICKET_FONTS.find(x=>x.id===id)||TICKET_FONTS[0];
  return f.css;
}
function applyTicketStyle(pre){
  if(!pre)return;
  const fId=S.cfg.ticketFont||'ibm';
  const sz=S.cfg.ticketSize||'12';
  const bold=!!S.cfg.ticketBold;
  pre.style.fontFamily=getTicketFontCss(fId);
  pre.style.fontSize=sz+'px';
  pre.style.fontWeight=bold?'700':'500';
  pre.style.lineHeight=fId==='sans'?'1.32':'1.36';
}
function ticketText(s){
  const Wd=40,ln='-'.repeat(Wd),dln='='.repeat(Wd);
  const ctr=t=>' '.repeat(Math.max(0,Math.floor((Wd-t.length)/2)))+t;
  const row=(a,b)=>{a=String(a);b=String(b);return a+' '.repeat(Math.max(1,Wd-a.length-b.length))+b;};
  const cut=(t,n)=>t.length>n?t.slice(0,n-1)+'…':t;
  const L=[];
  if(s.void)L.push(dln,ctr('*** VENTA ANULADA ***'),dln);
  L.push(ctr(cut(S.cfg.empresa.toUpperCase(),Wd)),ctr('RIF: '+S.cfg.rif));
  L.push(dln,row('RECIBO / TICKET: '+pad(s.no),fmtDT(s.ts)),row('Nº Control: '+(s.ctrlNo||('00-'+pad(s.no,8))),'Tasa BCV: '+nf(s.rate||S.cfg.rate)+' Bs.'),row('Cajero: '+S.cfg.cajero,'Caja '+S.cfg.caja),'Cliente: '+cut(s.client.name,Wd-9),'RIF/C.I.: '+s.client.rif,ln,row('CANT·U.M. x PRECIO (IVA)','SUBTOTAL US$'),ln);
  s.lines.forEach(l=>{
    const uLabel=(l.unit||'und').toUpperCase();
    const tTag=l.taxRate===0?'(E 0%)':(l.taxRate===8?'(R 8%)':(l.taxRate===31?'(A 31%)':'(G 16%)'));
    L.push(cut(l.desc,Wd));
    L.push(row('  '+fq(l.qty)+' '+uLabel+' x '+nf(l.price)+' '+tTag+(l.disc?' (-'+fq(l.disc)+'%)':''),nf(l.net)));
  });
  L.push(ln,row('Subtotal US$',nf(s.sub)));
  if(s.disc)L.push(row('Descuento US$','-'+nf(s.disc)));
  if(s.baseEx>0&&s.baseG16>0){
    L.push(row('Base Gravada 16 % US$',nf(s.baseG16)));
    if(s.baseR8>0)L.push(row('Base Reducida 8 % US$',nf(s.baseR8)));
    if(s.baseA31>0)L.push(row('Base Suntuaria 31 % US$',nf(s.baseA31)));
    L.push(row('Ventas Exentas (0 %) US$',nf(s.baseEx)));
  }else if(s.baseEx>0){
    L.push(row('Ventas Exentas (0 %) US$',nf(s.baseEx)));
  }else{
    L.push(row('Base imponible US$',nf(s.base)));
  }
  L.push(row('Total I.V.A. US$',nf(s.iva)));
  if(s.igtf)L.push(row('IGTF (3 % Divisas) US$',nf(s.igtf)));
  const due=r2(s.total+s.igtf);
  s.pays.forEach(p=>{
    const refTxt=p.ref?(' Ref:'+p.ref):'';
    L.push(row(' '+cut(p.name+refTxt,26),(p.cur==='USD'?'US$ ':'Bs. ')+nf(p.amount)));
  });
  if(s.change>=0.01)L.push(row(' Vuelto (equiv. US$)',nf(s.change)));
  if(s.cashea){
    L.push(ln,ctr('PAGADO CON CASHEA (3 CUOTAS BNPL)'));
    L.push(row(' Aprobación / Token:',s.cashea.aprobacion));
    L.push(row(' C.I. Cliente:',s.cashea.ci||s.client.rif));
    if(s.cashea.inicialUsd>0){
      L.push(row(' Inicial en caja:',usd(s.cashea.inicialUsd)));
    }
    L.push(row(' Financiado Cashea:',usd(s.cashea.financiadoUsd)));
    L.push(row(' '+(s.cashea.cuotasCount||3)+' cuota(s) quincenales:',usd(s.cashea.cuotaUsd)+' c/u'));
  }
  L.push(ln,ctr('¡GRACIAS POR SU COMPRA!'),ctr('Impresora Térmica 80mm · Control Interno'));
  return L.join('\n');
}
function showTicket(s){
  if(!S.cfg.ticketFont)S.cfg.ticketFont='ibm';
  if(!S.cfg.ticketSize)S.cfg.ticketSize='12';
  const fontOpts=TICKET_FONTS.map(f=>'<option value="'+f.id+'"'+(S.cfg.ticketFont===f.id?' selected':'')+'>'+esc(f.name)+'</option>').join('');
  const el=h('<div class="form">'+
    '<div class="invbar" style="background:var(--alt);padding:5px 7px;border:1px solid var(--lo)">'+
      '<label for="tkFont">Letra 80mm:</label>'+
      '<select class="fld" id="tkFont" style="flex:1;min-width:170px">'+fontOpts+'</select>'+
      '<label for="tkSize">Tamaño:</label>'+
      '<select class="fld" id="tkSize" style="width:66px;flex:none"><option value="11"'+(S.cfg.ticketSize==='11'?' selected':'')+'>11 px</option><option value="12"'+(S.cfg.ticketSize==='12'?' selected':'')+'>12 px</option><option value="13"'+(S.cfg.ticketSize==='13'?' selected':'')+'>13 px</option></select>'+
      '<label class="chk" style="font-size:11.5px"><input type="checkbox" id="tkBold" '+(S.cfg.ticketBold?'checked':'')+'> Negrita térmica</label>'+
    '</div>'+
    '<div class="ticket-roll-wrap"><pre class="ticket-80mm" id="ticketPre"></pre></div>'+
    '<p class="hint">Formato de rollo térmico de <b>80mm</b>. El tipo de letra seleccionado queda guardado para todos los tickets y recibos de caja.</p>'+
  '</div>');
  const pre=$('#ticketPre',el);
  pre.textContent=ticketText(s);
  applyTicketStyle(pre);

  el.addEventListener('change',e=>{
    if(e.target.id==='tkFont'||e.target.id==='tkSize'||e.target.id==='tkBold'){
      S.cfg.ticketFont=$('#tkFont',el).value;
      S.cfg.ticketSize=$('#tkSize',el).value;
      S.cfg.ticketBold=$('#tkBold',el).checked;
      applyTicketStyle(pre);
      save();
    }
  });

  openWin({title:'Recibo / Ticket de Caja Térmica 80mm — Nº '+pad(s.no),w:500,body:el,foot:[
    {label:'Imprimir 80mm',left:true,fn:()=>{
      document.body.classList.add('printing-ticket-80mm');
      window.print();
      setTimeout(()=>document.body.classList.remove('printing-ticket-80mm'),500);
      return false;
    }},
    {label:'Copiar texto',fn:()=>{
      const txt=ticketText(s);
      const fallback=()=>{const r=document.createRange();r.selectNodeContents(pre);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);msg('Texto seleccionado. Cópielo con Ctrl+C.');};
      try{navigator.clipboard.writeText(txt).then(()=>msg('Ticket copiado.'),fallback);}catch(e){fallback();}
      return false;
    }},
    {label:'Cerrar',primary:true,fn:()=>{setTimeout(()=>$('#entry').focus(),0);}}
  ]});
}

/* ---------- ventas del día / cierre ---------- */
function salesDlg(){
  let selNo=null,armed=0;
  const el=h('<div class="form"><div class="gridwrap saleswrap"><table class="grid" style="min-width:680px"><thead><tr><th>Factura</th><th>Hora</th><th>Cliente</th><th class="r">Total US$</th><th class="r">Total Bs.</th><th>Pago</th></tr></thead><tbody id="saBody"></tbody></table></div><div class="row"><button class="btn" id="saView">Ver ticket</button><button class="btn" id="saVoid">Anular venta</button></div><div class="cierre" id="saCierre"></div><p class="hint" id="saNote"></p></div>');
  const todays=()=>S.sales.filter(s=>sameDay(s.ts)&&s.cashbox===currentCaja()).sort((a,b)=>b.no-a.no);
  const draw=()=>{
    const list=todays();
    $('#saBody',el).innerHTML=list.length?list.map(s=>{const due=r2(s.total+s.igtf);return '<tr data-no="'+s.no+'" class="'+(s.no===selNo?'sel':'')+(s.void?' void':'')+'"><td class="mono">'+pad(s.no)+(s.void?' (anulada)':'')+'</td><td>'+fmtT(new Date(s.ts))+'</td><td>'+esc(s.client.name)+'</td><td class="r">'+nf(due)+'</td><td class="r">'+nf(due*s.rate)+'</td><td>'+esc(s.pays.map(p=>p.name.split(' (')[0]).join(' + '))+'</td></tr>';}).join(''):'<tr class="empty"><td colspan="6">Todavía no hay ventas hoy.</td></tr>';
    const ok=list.filter(s=>!s.void);
    const by={};
    ok.forEach(s=>s.pays.forEach(p=>{const k=p.id;by[k]=by[k]||{name:p.name,cur:p.cur,n:0,amt:0};by[k].n++;by[k].amt+=p.amount;}));
    const sum=(f)=>r2(ok.reduce((a,s)=>a+f(s),0));
    const metRows=Object.keys(by).map(k=>'<tr><td>'+esc(by[k].name.split(' (')[0])+'</td><td>'+by[k].n+'</td><td>'+(by[k].cur==='USD'?'US$ ':'Bs. ')+nf(by[k].amt)+'</td></tr>').join('')||'<tr><td colspan="3" class="dim">Sin cobros.</td></tr>';
    $('#saCierre',el).innerHTML='<table class="sumt"><thead><tr><th>Cierre por forma de pago</th><th>Ops.</th><th>Recibido</th></tr></thead><tbody>'+metRows+'</tbody></table><table class="sumt"><thead><tr><th>Totales del día</th><th>US$</th></tr></thead><tbody><tr><td>Ventas válidas</td><td>'+ok.length+'</td></tr><tr><td>Base imponible</td><td>'+nf(sum(s=>s.base))+'</td></tr><tr><td>IVA 16 %</td><td>'+nf(sum(s=>s.iva))+'</td></tr><tr><td>IGTF 3 %</td><td>'+nf(sum(s=>s.igtf))+'</td></tr><tr class="tot"><td>Total facturado</td><td>'+nf(sum(s=>s.total+s.igtf))+'</td></tr><tr><td>Total en Bs. (a la tasa de cada venta)</td><td>'+nf(sum(s=>(s.total+s.igtf)*s.rate))+'</td></tr></tbody></table>';
    $('#saNote',el).textContent=list.some(s=>s.no<1043)&&!saved?'Las facturas 1038 a 1042 son ejemplos para mostrar el cierre.':'';
    $('#saView',el).disabled=!selNo;$('#saVoid',el).disabled=!selNo||!!(S.sales.find(s=>s.no===selNo&&s.cashbox===currentCaja())||{}).void;
    $('#saVoid',el).textContent='Anular venta';
  };
  el.addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-no]');
    if(tr){selNo=+tr.dataset.no;armed=0;draw();return;}
    const s=S.sales.find(x=>x.no===selNo&&x.cashbox===currentCaja());
    if(e.target.id==='saView'&&s){showTicket(s);}
    if(e.target.id==='saVoid'&&s&&!s.void){
      if(window.SIFERAccess&&typeof window.SIFERAccess.requestPin==='function'&&!window.SIFERAccess.requestPin('Anular factura '+pad(s.no)))return;
      if(!armed||Date.now()-armed>5000){armed=Date.now();e.target.textContent='Confirmar anulación';return;}
      s.void=true;
      s.transType='03-ANUL';
      s.voidDoc='NC-'+pad(s.no,8);
      s.voidTs=Date.now();
      s.lines.forEach(l=>{
        const p=prod(l.code);
        if(p){
          p.stock=r2(p.stock+l.qty);
          addKardex({
            code:p.code,type:'ANULACIÓN',dir:'IN',doc:'FAC-'+pad(s.no),
            party:'Reingreso por anulación factura ('+s.client.name+')',
            qty:l.qty,stockAfter:p.stock,cost:p.cost,user:S.cfg.cajero
          });
        }
      });
      S.cxc=(S.cxc||[]).filter(x=>!(x.saleNo===s.no&&x.cashbox===currentCaja()));
      armed=0;save();renderCatalog();draw();msg('Factura '+pad(s.no)+' anulada. Se devolvió la mercancía al inventario y Kardex.');
    }
  });
  openWin({title:'Ventas del día y cierre de caja',w:900,body:el,foot:[
    {label:'Libro Fiscal SENIAT',left:true,fn:()=>{seniatSudebanDlg('ventas');return false;}},
    {label:'Cerrar',primary:true}
  ],onEnter:()=>{},onOpen:()=>{draw();}});
}

/* ==========================================================================
   MÓDULO DEDICADO: CONTROL SENIAT / SUDEBAN
   Cumplimiento fiscal, libros obligatorios, IGTF, auditoría cambiaria BCV,
   conciliación de medios de pago SUDEBAN y generador de TXT oficial.
   ========================================================================== */

function downloadBlob(filename, content, mimeType){
  const blob=new Blob([content],{type:mimeType||'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{a.remove();URL.revokeObjectURL(url);},500);
}

function printFiscalReport(title,html){
  let w=$('#fiscalPrintWrap');
  if(!w){
    w=document.createElement('div');
    w.id='fiscalPrintWrap';
    document.body.appendChild(w);
  }
  w.hidden=false;
  w.innerHTML='<div style="font-family:sans-serif;color:#10222B;line-height:1.35">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #10222B;padding-bottom:8px;margin-bottom:12px">'+
      '<div>'+
        '<h2 style="margin:0;font-size:16px;text-transform:uppercase">'+esc(S.cfg.empresa)+'</h2>'+
        '<div style="font-size:11.5px"><b>RIF:</b> '+esc(S.cfg.rif)+' &middot; <b>Domicilio Fiscal:</b> '+esc(S.cfg.dir||'No especificado')+'</div>'+
        '<div style="font-size:11.5px"><b>Condición declarada en el POS:</b> '+(S.cfg.contribEspecial?'Sujeto Pasivo Especial (confirmar notificación)':'No confirmado como Sujeto Pasivo Especial')+' &middot; <b>Referencia:</b> '+esc(S.cfg.provEspecial||'No registrada')+'</div>'+
      '</div>'+
      '<div style="text-align:right">'+
        '<div style="font-weight:700;font-size:14px;color:#1842B8">'+esc(title)+'</div>'+
        '<div style="font-size:11px;color:#555">Fecha de Emisión: '+fmtDT(Date.now())+'</div>'+
        '<div style="font-size:11px;color:#555">Control Fiscal: '+esc(S.cfg.ctrlPrefix||'00-')+' &middot; Rango Aut. Imprenta</div>'+
      '</div>'+
    '</div>'+
    html+
    '<div style="margin-top:24px;border-top:1px dashed #888;padding-top:10px;display:flex;justify-content:space-between;font-size:10.5px;color:#555">'+
      '<div>Documento generado por SIFER 360 &middot; Sistema Administrativo y de Control Fiscal</div>'+
      '<div>Firma Contador / Administrador: _____________________________</div>'+
    '</div>'+
  '</div>';
  document.body.classList.add('printing-fiscal');
  window.print();
  setTimeout(()=>{
    document.body.classList.remove('printing-fiscal');
    if(w)w.hidden=true;
  },600);
}

function exportLibroVentasCsv(sales){
  const BOM='\uFEFF';
  const headers=[
    'Nro_Operacion','Fecha_Emision','RIF_Cliente','Nombre_Razon_Social',
    'Numero_Factura','Numero_Control','Numero_Nota_Credito','Factura_Afectada',
    'Tipo_Transaccion','Total_Ventas_USD','Total_Ventas_Bs','Ventas_Exentas_Bs',
    'Base_Imponible_16_Bs','Debito_Fiscal_16_Bs','Base_Reducida_8_Bs','Debito_Reducido_8_Bs',
    'Base_Adicional_31_Bs','Debito_Adicional_31_Bs','IGTF_3_Divisas_Bs','IGTF_3_Divisas_USD',
    'IVA_Retenido_Bs','Tasa_BCV'
  ];
  const rows=sales.map((s,idx)=>{
    const due=r2(s.total+(s.igtf||0));
    const rate=s.rate||S.cfg.rate;
    const bG=s.baseG16!==undefined?s.baseG16:s.base;
    const bR=s.baseR8||0;
    const bA=s.baseA31||0;
    const bE=s.baseEx||0;
    const iva16=r2(bG*0.16);
    const iva8=r2(bR*0.08);
    const iva31=r2(bA*0.31);
    const igtfBs=r2((s.igtf||0)*rate);
    return [
      idx+1,
      fmtD(new Date(s.ts)),
      `"${s.client.rif}"`,
      `"${s.client.name.replace(/"/g,'""')}"`,
      pad(s.no),
      s.ctrlNo||('00-'+pad(s.no,8)),
      s.void?(s.voidDoc||('NC-'+pad(s.no,8))):'',
      s.void?pad(s.no):'',
      s.transType||(s.void?'03-ANUL':'01-REG'),
      due.toFixed(2),
      r2(due*rate).toFixed(2),
      r2(bE*rate).toFixed(2),
      r2(bG*rate).toFixed(2),
      r2(iva16*rate).toFixed(2),
      r2(bR*rate).toFixed(2),
      r2(iva8*rate).toFixed(2),
      r2(bA*rate).toFixed(2),
      r2(iva31*rate).toFixed(2),
      igtfBs.toFixed(2),
      (s.igtf||0).toFixed(2),
      '0.00',
      rate.toFixed(2)
    ].join(';');
  });
  const csv=BOM+[headers.join(';')].concat(rows).join('\r\n');
  downloadBlob(`Libro_Ventas_SENIAT_${S.cfg.rif}_${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8;');
  msg('Libro de Ventas Fiscal exportado a CSV con éxito.');
}

function exportLibroComprasCsv(purchases){
  const BOM='\uFEFF';
  const headers=[
    'Nro_Operacion','Fecha_Emision','RIF_Proveedor','Nombre_Proveedor',
    'Numero_Factura_Proveedor','Numero_Control_Proveedor','Tipo_Transaccion',
    'Total_Compras_USD','Total_Compras_Bs','Compras_Exentas_Bs',
    'Base_Imponible_16_Bs','Credito_Fiscal_16_Bs','IVA_Retenido_75_Bs',
    'Comprobante_Retencion','Tasa_BCV'
  ];
  const rows=purchases.map((p,idx)=>{
    const rate=p.rate||S.cfg.rate;
    const retBs=p.retIva?r2(p.retIva*rate):r2(p.iva*0.75*rate);
    return [
      idx+1,
      fmtD(new Date(p.ts)),
      `"${p.supplier.rif}"`,
      `"${p.supplier.name.replace(/"/g,'""')}"`,
      p.docProv,
      p.ctrlProv||('00-'+pad(p.no+4400,8)),
      '01-REG',
      p.total.toFixed(2),
      r2(p.total*rate).toFixed(2),
      '0.00',
      r2(p.base*rate).toFixed(2),
      r2(p.iva*rate).toFixed(2),
      retBs.toFixed(2),
      p.retIvaDoc||('202610'+pad(idx+41,8)),
      rate.toFixed(2)
    ].join(';');
  });
  const csv=BOM+[headers.join(';')].concat(rows).join('\r\n');
  downloadBlob(`Libro_Compras_SENIAT_${S.cfg.rif}_${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8;');
  msg('Libro de Compras Fiscal exportado a CSV con éxito.');
}

function exportIgtfCsv(sales){
  const BOM='\uFEFF';
  const headers=[
    'Factura','Fecha','RIF_Cliente','Cliente','Forma_Pago_Divisa',
    'Monto_USD_Sujeto_IGTF','Tasa_BCV','Base_Imponible_Bs','Alicuota_IGTF',
    'IGTF_Percibido_USD','IGTF_Percibido_Bs'
  ];
  const rows=[];
  sales.forEach(s=>{
    const usdPays=(s.pays||[]).filter(p=>p.cur==='USD');
    if(!usdPays.length&&!(s.igtf>0))return;
    const rate=s.rate||S.cfg.rate;
    const baseUsd=usdPays.reduce((a,p)=>a+(p.id==='efUSD'?r2(p.amount/1.03):p.amount),0);
    const igtfUsd=s.igtf||r2(baseUsd*0.03);
    const igtfBs=r2(igtfUsd*rate);
    rows.push([
      pad(s.no),
      fmtDT(s.ts),
      `"${s.client.rif}"`,
      `"${s.client.name.replace(/"/g,'""')}"`,
      `"${usdPays.map(p=>p.name).join(' + ')}"`,
      baseUsd.toFixed(2),
      rate.toFixed(2),
      r2(baseUsd*rate).toFixed(2),
      '3.00%',
      igtfUsd.toFixed(2),
      igtfBs.toFixed(2)
    ].join(';'));
  });
  const csv=BOM+[headers.join(';')].concat(rows).join('\r\n');
  downloadBlob(`Percepcion_IGTF_SENIAT_${S.cfg.rif}_${new Date().toISOString().slice(0,10)}.csv`,csv,'text/csv;charset=utf-8;');
  msg('Reporte de Percepción IGTF exportado a CSV con éxito.');
}

function exportSeniatTxt(periodo){
  if(!periodo){const d=new Date();periodo=String(d.getFullYear())+String(d.getMonth()+1).padStart(2,'0');}
  const rifAgente=S.cfg.rif.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  const list=S.retencionesIva||[];
  if(!list.length){
    msg('No hay registros de retención IVA para el período '+periodo+'.','bad');
    return;
  }
  const lines=list.map(r=>{
    const rifProv=(r.supplier.rif||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    const fec=new Date(r.ts).toISOString().slice(0,10);
    const numFac=(r.docProv||'0001').replace(/[^A-Za-z0-9-]/g,'').slice(0,20);
    const numCtrl=(r.ctrlProv||'00-00000001').replace(/[^A-Za-z0-9-]/g,'').slice(0,20);
    const totBs=r2((r.base+r.iva)*(r.rate||S.cfg.rate)).toFixed(2);
    const baseBs=r2(r.base*(r.rate||S.cfg.rate)).toFixed(2);
    const retBs=r2(r.retainedBs||(r.iva*0.75*(r.rate||S.cfg.rate))).toFixed(2);
    const numComp=r.id||(periodo+pad(r.purchaseNo||1,8));
    return `${rifAgente}\t${periodo}\t${fec}\tC\t01\t${rifProv}\t${numFac}\t${numCtrl}\t${totBs}\t${baseBs}\t${retBs}\t0\t${numComp}\t0.00\t16.00\t0`;
  });
  const txt=lines.join('\r\n');
  downloadBlob(`RetencionesIVA_${rifAgente}_${periodo}.txt`,txt,'text/plain;charset=utf-8;');
  msg('Archivo de trabajo exportado. El contador debe validar formato y datos antes de cualquier carga o declaración ante el SENIAT.');
}

function printComprobanteRetencion(r){
  const rate=r.rate||S.cfg.rate;
  const totBs=r2((r.base+r.iva)*rate);
  const baseBs=r2(r.base*rate);
  const ivaBs=r2(r.iva*rate);
  const retBs=r2(r.retainedBs||(r.iva*0.75*rate));
  const html='<div style="padding:10px;border:1px solid #10222B;border-radius:6px">'+
    '<div style="text-align:center;font-weight:700;font-size:15px;margin-bottom:8px">COMPROBANTE DE RETENCIÓN DEL IMPUESTO AL VALOR AGREGADO (I.V.A.)</div>'+
    '<div style="text-align:center;font-size:11.5px;color:#444;margin-bottom:14px">Ley de IVA &middot; Artículos 11 y Providencia Administrativa SNAT/2015/0049 para Sujetos Pasivos Especiales</div>'+
    '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">'+
      '<tr><td style="padding:4px;border:1px solid #BAC7CE;background:#f5f5f5;width:25%"><b>Nº Comprobante:</b></td><td style="padding:4px;border:1px solid #BAC7CE;font-family:monospace;font-weight:700">'+esc(r.id)+'</td><td style="padding:4px;border:1px solid #BAC7CE;background:#f5f5f5;width:20%"><b>Fecha Emisión:</b></td><td style="padding:4px;border:1px solid #BAC7CE">'+fmtD(new Date(r.ts))+'</td></tr>'+
      '<tr><td style="padding:4px;border:1px solid #BAC7CE;background:#f5f5f5"><b>Agente de Retención:</b></td><td style="padding:4px;border:1px solid #BAC7CE">'+esc(S.cfg.empresa)+' ('+esc(S.cfg.rif)+')</td><td style="padding:4px;border:1px solid #BAC7CE;background:#f5f5f5"><b>Período Fiscal:</b></td><td style="padding:4px;border:1px solid #BAC7CE">'+esc(r.periodo||'202610')+'</td></tr>'+
      '<tr><td style="padding:4px;border:1px solid #BAC7CE;background:#f5f5f5"><b>Proveedor Sujeto:</b></td><td style="padding:4px;border:1px solid #BAC7CE" colspan="3">'+esc(r.supplier.name)+' &middot; <b>RIF:</b> '+esc(r.supplier.rif)+'</td></tr>'+
    '</table>'+
    '<table style="width:100%;border-collapse:collapse;font-size:11.5px;text-align:right">'+
      '<thead><tr style="background:#10222B;color:#fff"><th style="padding:5px;text-align:center">Operación</th><th style="padding:5px;text-align:center">Nº Factura</th><th style="padding:5px;text-align:center">Nº Control</th><th style="padding:5px">Total Bs.</th><th style="padding:5px">Base Imponible Bs.</th><th style="padding:5px">IVA 16% Bs.</th><th style="padding:5px;text-align:center">% Ret.</th><th style="padding:5px">IVA Retenido Bs.</th></tr></thead>'+
      '<tbody><tr><td style="padding:6px;border:1px solid #BAC7CE;text-align:center">01-COMPRA</td><td style="padding:6px;border:1px solid #BAC7CE;text-align:center;font-family:monospace">'+esc(r.docProv)+'</td><td style="padding:6px;border:1px solid #BAC7CE;text-align:center;font-family:monospace">'+esc(r.ctrlProv)+'</td><td style="padding:6px;border:1px solid #BAC7CE">'+nf(totBs)+'</td><td style="padding:6px;border:1px solid #BAC7CE">'+nf(baseBs)+'</td><td style="padding:6px;border:1px solid #BAC7CE">'+nf(ivaBs)+'</td><td style="padding:6px;border:1px solid #BAC7CE;text-align:center;font-weight:700">'+fq(r.pct||75)+'%</td><td style="padding:6px;border:1px solid #BAC7CE;font-weight:700;color:#1842B8">'+nf(retBs)+'</td></tr></tbody>'+
    '</table>'+
    '<div style="margin-top:16px;padding:8px;background:#EDF7F0;border:1px solid #BEE7C8;border-radius:4px;font-size:11.5px;color:#1D6F39">'+
      '<b>Monto Retenido en Letras:</b> Retención del 75% correspondiente al impuesto facturado por un total de <b>'+nf(retBs)+' Bolívares</b> (Equivalente: US$ '+nf(r.retainedUsd||(r.iva*0.75))+').'+
    '</div>'+
  '</div>';
  printFiscalReport('Comprobante de Retención IVA — '+r.id,html);
}

function printActaBcv(sales){
  const ok=sales.filter(s=>!s.void);
  const rowsHtml=ok.map(s=>'<tr><td style="padding:4px;border:1px solid #BAC7CE;font-family:monospace">'+pad(s.no)+'</td><td style="padding:4px;border:1px solid #BAC7CE">'+fmtDT(s.ts)+'</td><td style="padding:4px;border:1px solid #BAC7CE">'+esc(s.client.name)+'</td><td style="padding:4px;border:1px solid #BAC7CE;text-align:right">'+nf(s.total+(s.igtf||0))+'</td><td style="padding:4px;border:1px solid #BAC7CE;text-align:right;font-weight:700;color:#1842B8">'+nf(s.rate||S.cfg.rate)+'</td><td style="padding:4px;border:1px solid #BAC7CE;text-align:right">'+nf((s.total+(s.igtf||0))*(s.rate||S.cfg.rate))+'</td><td style="padding:4px;border:1px solid #BAC7CE;text-align:center;color:#1D6F39;font-weight:700">100% CONFORME BCV</td></tr>').join('');
  const html='<div style="font-size:12px">'+
    '<div style="background:#EBF7EE;border:1px solid #BEE7C8;padding:10px;border-radius:6px;margin-bottom:12px">'+
      '<h3 style="margin:0 0 4px;font-size:14px;color:#1D6F39">ACTA DE FISCALIZACIÓN Y CONFORMIDAD CAMBIARIA (BANCO CENTRAL DE VENEZUELA)</h3>'+
      '<p style="margin:0;font-size:11.5px;color:#144A75">Se hace constar ante los funcionarios del <b>SENIAT</b> y la <b>SUNDDE</b> que la entidad <b>'+esc(S.cfg.empresa)+'</b> (RIF: '+esc(S.cfg.rif)+') aplica de manera estricta y sin excepciones la <b>Tasa Oficial publicada por el Banco Central de Venezuela (BCV)</b> en todas sus operaciones comerciales y documentos de venta.</p>'+
    '</div>'+
    '<table style="width:100%;border-collapse:collapse;font-size:11px">'+
      '<thead><tr style="background:#10222B;color:#fff"><th style="padding:5px">Factura</th><th style="padding:5px">Fecha/Hora</th><th style="padding:5px">Cliente</th><th style="padding:5px;text-align:right">Total US$</th><th style="padding:5px;text-align:right">Tasa Oficial BCV</th><th style="padding:5px;text-align:right">Total Facturado Bs.</th><th style="padding:5px;text-align:center">Verificación</th></tr></thead>'+
      '<tbody>'+rowsHtml+'</tbody>'+
    '</table>'+
  '</div>';
  printFiscalReport('Acta de Cumplimiento de Precios y Tasa BCV',html);
}

function registerLoteSudebanDlg(onDone){
  const el=h('<div class="form"><div class="newgrid">'+
    '<div class="f wide"><label for="ltBanco">Banco Adquirente</label><select class="fld" id="ltBanco"><option value="Banco de Venezuela (BDV)">Banco de Venezuela (BDV)</option><option value="Banesco Banco Universal">Banesco Banco Universal</option><option value="Banco Mercantil">Banco Mercantil</option><option value="BBVA Provincial">BBVA Provincial</option><option value="Bancamiga Banco Universal">Bancamiga Banco Universal</option><option value="Banco Nacional de Crédito (BNC)">Banco Nacional de Crédito (BNC)</option></select></div>'+
    '<div class="f"><label for="ltTipo">Tipo de Terminal / Pasarela</label><select class="fld" id="ltTipo"><option value="Biopago / Débito">Biopago BDV / Débito</option><option value="Punto de Venta (Débito/Crédito)" selected>Punto de Venta POS</option><option value="Pago Móvil C2P Interbancario">Pago Móvil C2P</option></select></div>'+
    '<div class="f"><label for="ltTid">Terminal ID (TID)</label><input class="fld mono" id="ltTid" value="POS-'+pad(Math.floor(Math.random()*8999+1000),4)+'"></div>'+
    '<div class="f"><label for="ltNum">Nº de Lote (Voucher)</label><input class="fld mono" id="ltNum" value="LT-'+pad(Math.floor(Math.random()*899999+100000),6)+'"></div>'+
    '<div class="f"><label for="ltOps">Cantidad de Operaciones</label><input class="fld r" type="number" id="ltOps" value="10"></div>'+
    '<div class="f"><label for="ltMonto">Total Cierre Voucher (Bs.)</label><input class="fld r" id="ltMonto" inputmode="decimal" placeholder="0,00"></div>'+
    '<div class="f"><label for="ltComPct">% Comisión Bancaria SUDEBAN</label><input class="fld r" id="ltComPct" value="1,50"></div>'+
  '</div><p class="hint">Ingrese los datos exactos del reporte de cierre o voucher emitido por el terminal bancario físico al finalizar la jornada.</p></div>');

  openWin({
    title:'Registrar Cierre de Lote Bancario POS / SUDEBAN',
    w:580,body:el,
    foot:[
      {label:'Cancelar',fn:()=>{if(onDone)onDone();return false;}},
      {label:'Guardar y Conciliar',primary:true,fn:()=>{
        const monto=pn($('#ltMonto',el).value);
        if(!monto){msg('Indique el total en Bolívares del voucher.','bad');return false;}
        const comPct=pn($('#ltComPct',el).value)||1.5;
        const comision=r2(monto*(comPct/100));
        const lote={
          id:'LOT-'+pad((S.lotesSudeban||[]).length+144,6),
          banco:$('#ltBanco',el).value,
          tid:$('#ltTid',el).value.trim(),
          ts:Date.now(),
          tipo:$('#ltTipo',el).value,
          totalBs:monto,
          comisionBs:comision,
          netoBs:r2(monto-comision),
          ops:parseInt($('#ltOps',el).value)||1,
          estado:'CONCILIADO',
          refLote:$('#ltNum',el).value.trim()
        };
        if(!S.lotesSudeban)S.lotesSudeban=[];
        S.lotesSudeban.push(lote);
        save();
        msg('Lote bancario '+lote.refLote+' registrado y conciliado.');
        if(onDone)onDone();
        return false;
      }}
    ]
  });
}

function printVoucherLoteSudeban(l){
  const rate=S.cfg.rate;
  const equivUsd=r2(l.netoBs/rate);
  const html='<div style="font-family:monospace;max-width:380px;margin:0 auto;padding:12px;border:1px dashed #333;background:#fafafa;line-height:1.4;font-size:12px">'+
    '<div style="text-align:center;font-weight:700;font-size:14px;border-bottom:1px double #333;padding-bottom:6px;margin-bottom:8px">CIERRE DE TERMINAL / LOTE BANCARIO<br><span style="font-size:11px;font-weight:normal">SUDEBAN &middot; BANCA ADQUIRENTE</span></div>'+
    '<div style="display:flex;justify-content:space-between"><span>BANCO:</span><b>'+esc(l.banco)+'</b></div>'+
    '<div style="display:flex;justify-content:space-between"><span>TERMINAL (TID):</span><b>'+esc(l.tid)+'</b></div>'+
    '<div style="display:flex;justify-content:space-between"><span>Nº LOTE VOUCHER:</span><b>'+esc(l.refLote)+'</b></div>'+
    '<div style="display:flex;justify-content:space-between"><span>PASARELA / TIPO:</span><b>'+esc(l.tipo)+'</b></div>'+
    '<div style="display:flex;justify-content:space-between"><span>FECHA Y HORA:</span><span>'+fmtDT(l.ts)+'</span></div>'+
    '<div style="border-top:1px dashed #666;margin:8px 0;padding-top:6px">'+
      '<div style="display:flex;justify-content:space-between"><span>OPERACIONES APROBADAS:</span><b>'+l.ops+' transacciones</b></div>'+
      '<div style="display:flex;justify-content:space-between"><span>TOTAL BRUTO FACTURADO:</span><b>'+bsf(l.totalBs)+'</b></div>'+
      '<div style="display:flex;justify-content:space-between;color:#945D08"><span>COMISIÓN BANCARIA:</span><b>-'+bsf(l.comisionBs)+'</b></div>'+
    '</div>'+
    '<div style="border-top:1px solid #333;border-bottom:1px solid #333;margin:8px 0;padding:6px 0;display:flex;justify-content:space-between;font-size:13px;font-weight:700;color:#1D6F39">'+
      '<span>NETO A LIQUIDAR (Bs.):</span><span>'+bsf(l.netoBs)+'</span>'+
    '</div>'+
    '<div style="display:flex;justify-content:space-between;font-size:11px;color:#555"><span>Equiv. Tasa Oficial BCV:</span><span>'+usd(equivUsd)+'</span></div>'+
    '<div style="margin-top:12px;text-align:center;font-size:10.5px;color:#333;border-top:1px dashed #666;padding-top:8px">'+
      'ESTADO: <b>'+esc(l.estado)+'</b> CON REGISTROS POS<br>CONCILIACIÓN FÍSICA Y ELECTRÓNICA CONFORME<br>CONSERVACIÓN LEGAL 10 AÑOS (SUDEBAN)'+
    '</div>'+
  '</div>';
  printFiscalReport('Voucher de Cierre de Lote — '+l.refLote,html);
}

function newRetencionIvaDlg(onDone){
  const supOpts=(S.suppliers||[]).map((s,i)=>'<option value="'+i+'">'+esc(s.name)+' ('+esc(s.rif)+')</option>').join('');
  const rate=S.cfg.rate;
  const el=h('<div class="form"><div class="newgrid">'+
    '<div class="f wide"><label for="retSup">Proveedor Sujeto Pasivo</label><select class="fld" id="retSup">'+supOpts+'</select></div>'+
    '<div class="f"><label for="retDocProv">Nº Factura Proveedor</label><input class="fld mono" id="retDocProv" value="00048912" placeholder="00012345"></div>'+
    '<div class="f"><label for="retCtrlProv">Nº de Control Proveedor</label><input class="fld mono" id="retCtrlProv" value="00-'+pad(Math.floor(Math.random()*899999+100000),8)+'"></div>'+
    '<div class="f"><label for="retBase">Base Imponible (US$)</label><input class="fld r" id="retBase" inputmode="decimal" value="100,00"></div>'+
    '<div class="f"><label for="retPct">% Retención IVA</label><select class="fld" id="retPct"><option value="75" '+(S.cfg.retIvaPct===75?'selected':'')+'>75 % (Estándar)</option><option value="100" '+(S.cfg.retIvaPct===100?'selected':'')+'>100 % (Total)</option></select></div>'+
    '<div class="f"><label for="retRate">Tasa BCV Aplicable</label><input class="fld r mono" id="retRate" readonly value="'+nf(rate)+' Bs."></div>'+
  '</div>'+
  '<div class="cierre" style="margin-top:6px">'+
    '<table class="sumt" id="retPreviewTable"><tbody></tbody></table>'+
  '</div>'+
  '<p class="hint">Borrador de apoyo y trazabilidad para revisión del contador. Referencia normativa: Providencia Administrativa SNAT/2025/000054. Este POS no declara, no paga ni certifica por sí mismo la retención ante el SENIAT; el contador debe validar datos, excepciones y formalidades antes de emitir o declarar.</p></div>');

  const upd=()=>{
    const base=pn($('#retBase',el).value);
    const pct=parseInt($('#retPct',el).value)||75;
    const ivaUsd=r2(base*0.16);
    const retUsd=r2(ivaUsd*(pct/100));
    const baseBs=r2(base*rate);
    const ivaBs=r2(ivaUsd*rate);
    const retBs=r2(retUsd*rate);
    $('#retPreviewTable',el).innerHTML=
      '<tr><td>Base Imponible:</td><td class="r">'+usd(base)+' ('+bsf(baseBs)+')</td></tr>'+
      '<tr><td>IVA Facturado (16 %):</td><td class="r">'+usd(ivaUsd)+' ('+bsf(ivaBs)+')</td></tr>'+
      '<tr class="tot"><td><b>Monto a Retener al Proveedor ('+pct+' %):</b></td><td class="r" style="color:#1842B8;font-size:14px"><b>'+bsf(retBs)+'</b> ('+usd(retUsd)+')</td></tr>';
  };
  el.addEventListener('input',upd);
  el.addEventListener('change',upd);
  upd();

  openWin({
    title:'Emitir Comprobante de Retención de IVA (SENIAT)',
    w:620,
    body:el,
    foot:[
      {label:'Cancelar'},
      {label:'Emitir y Guardar',primary:true,fn:()=>{
        const base=pn($('#retBase',el).value);
        if(!base){msg('Indique una base imponible válida.','bad');return false;}
        const supIdx=parseInt($('#retSup',el).value)||0;
        const sup=S.suppliers[supIdx]||S.suppliers[0];
        const docProv=$('#retDocProv',el).value.trim()||'0001';
        const ctrlProv=$('#retCtrlProv',el).value.trim()||('00-'+pad(Math.floor(Math.random()*899999+100000),8));
        const pct=parseInt($('#retPct',el).value)||75;
        const iva=r2(base*0.16);
        const retUsd=r2(iva*(pct/100));
        const retBs=r2(retUsd*rate);
        const seq=(S.retencionesIva||[]).length+42;
        const fechaComp=new Date();const periodoComp=String(fechaComp.getFullYear())+String(fechaComp.getMonth()+1).padStart(2,'0');
        const compId=periodoComp+pad(seq,8);
        const retEntry={
          id:compId,
          ts:Date.now(),
          periodo:periodoComp,
          supplier:Object.assign({},sup),
          docProv,
          ctrlProv,
          base,
          iva,
          pct,
          rate,
          retainedUsd:retUsd,
          retainedBs:retBs
        };
        if(!S.retencionesIva)S.retencionesIva=[];
        S.retencionesIva.push(retEntry);
        save();
        retEntry.estado='Borrador para revisión del contador';retEntry.declarada=false;retEntry.pagada=false;retEntry.comprobanteEntregado=false;retEntry.observaciones='Registro interno del POS; validar antes de emitir/declarar ante SENIAT.';
        msg('Registro de retención guardado como borrador para revisión del contador.');
        if(onDone)onDone();
        printComprobanteRetencion(retEntry);
        return false;
      }}
    ]
  });
}

function seniatSudebanDlg(initialTab){
  let activeTab=initialTab||'resumen';
  let curPeriod='mes'; /* 'quincena1' | 'quincena2' | 'mes' | 'todo' */
  let qText='';

  const el=h('<div class="form" style="gap:10px">'+
    '<div class="semaforo-bar">'+
      '<div class="semaforo-dot"></div>'+
      '<div class="semaforo-text"><b>CONTROL FISCAL & SUDEBAN CONFORME</b> &middot; Tasa Oficial BCV en vigencia ('+nf(S.cfg.rate)+' Bs./US$) &middot; Formas Libres en Rango Legal &middot; Discriminación IGTF 3% Divisas Activa.</div>'+
      '<span class="fiscal-seal">SENIAT &middot; SUDEBAN OK</span>'+
    '</div>'+
    '<div class="tabs" id="snTabs">'+
      '<button class="tab '+(activeTab==='resumen'?'active':'')+'" data-tab="resumen">Panel de Control Fiscal</button>'+
      '<button class="tab '+(activeTab==='ventas'?'active':'')+'" data-tab="ventas">Libro de Ventas Fiscal</button>'+
      '<button class="tab '+(activeTab==='compras'?'active':'')+'" data-tab="compras">Libro de Compras & Forma 30</button>'+
      '<button class="tab '+(activeTab==='igtf'?'active':'')+'" data-tab="igtf">Percepción de IGTF (3%)</button>'+
      '<button class="tab '+(activeTab==='auditoria'?'active':'')+'" data-tab="auditoria">Auditoría Ventas & Tasa BCV</button>'+
      '<button class="tab '+(activeTab==='sudeban'?'active':'')+'" data-tab="sudeban">Conciliación POS / SUDEBAN</button>'+
      '<button class="tab '+(activeTab==='retenciones'?'active':'')+'" data-tab="retenciones">Retenciones IVA & TXT</button>'+
      '<button class="tab '+(activeTab==='pagoSeniat'?'active':'')+'" data-tab="pagoSeniat">Preparar Pago SENIAT</button>'+
      '<button class="tab '+(activeTab==='config'?'active':'')+'" data-tab="config">Parámetros Fiscales</button>'+
    '</div>'+
    '<div class="invbar" id="snFilterBar" style="background:var(--panel-2);padding:6px 10px;border:1px solid var(--line);border-radius:6px">'+
      '<label for="snPeriod"><b>Período Fiscal:</b></label>'+
      '<select class="fld" id="snPeriod" style="width:190px">'+
        '<option value="mes" '+(curPeriod==='mes'?'selected':'')+'>Mes Actual Completo</option>'+
        '<option value="quincena1" '+(curPeriod==='quincena1'?'selected':'')+'>1ra Quincena (1 al 15)</option>'+
        '<option value="quincena2" '+(curPeriod==='quincena2'?'selected':'')+'>2da Quincena (16 al fin)</option>'+
        '<option value="todo" '+(curPeriod==='todo'?'selected':'')+'>Todo el Historial</option>'+
      '</select>'+
      '<label for="snQ" style="margin-left:12px">Buscar:</label>'+
      '<input class="fld" id="snQ" placeholder="Factura, cliente, RIF o N° control..." style="flex:1" value="'+esc(qText)+'">'+
    '</div>'+
    '<div id="snContent" style="min-height:280px;display:flex;flex-direction:column;gap:8px"></div>'+
  '</div>');

  const filterPeriod=ts=>{
    if(curPeriod==='todo')return true;
    const d=new Date(ts);
    const now=new Date();
    if(d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear())return false;
    const day=d.getDate();
    if(curPeriod==='quincena1')return day<=15;
    if(curPeriod==='quincena2')return day>15;
    return true;
  };

  const getFilteredSales=()=>{
    const q=norm(qText);
    return (S.sales||[]).filter(s=>{
      if(!filterPeriod(s.ts))return false;
      if(!q)return true;
      return norm(s.client.name+s.client.rif+pad(s.no)+(s.ctrlNo||'')).indexOf(q)>=0;
    });
  };

  const getFilteredPurchases=()=>{
    const q=norm(qText);
    return (S.purchases||[]).filter(p=>{
      if(!filterPeriod(p.ts))return false;
      if(!q)return true;
      return norm(p.supplier.name+p.supplier.rif+p.docProv+(p.ctrlProv||'')).indexOf(q)>=0;
    });
  };

  const drawResumen=()=>{
    const sales=getFilteredSales();
    const okSales=sales.filter(s=>!s.void);
    const purchases=getFilteredPurchases().filter(p=>!p.void);
    const rate=S.cfg.rate;

    const totSalesUsd=r2(okSales.reduce((a,s)=>a+s.total+(s.igtf||0),0));
    const totSalesBs=r2(okSales.reduce((a,s)=>a+(s.total+(s.igtf||0))*(s.rate||rate),0));
    const totDebitoBs=r2(okSales.reduce((a,s)=>a+s.iva*(s.rate||rate),0));
    const totCreditoBs=r2(purchases.reduce((a,p)=>a+p.iva*(p.rate||rate),0));
    const balIvaBs=r2(totDebitoBs-totCreditoBs);
    const totIgtfUsd=r2(okSales.reduce((a,s)=>a+(s.igtf||0),0));
    const totIgtfBs=r2(okSales.reduce((a,s)=>a+(s.igtf||0)*(s.rate||rate),0));

    let totSudebanBs=0;
    okSales.forEach(s=>s.pays.forEach(p=>{
      if(['punto','biopago','pmovil','transf'].includes(p.id))totSudebanBs+=p.amount;
    }));

    return '<div class="fiscal-grid">'+
      '<div class="fiscal-card"><span>Total Ventas Facturadas</span><b class="ok">'+usd(totSalesUsd)+'</b><small>'+bsf(totSalesBs)+'</small></div>'+
      '<div class="fiscal-card"><span>Débito Fiscal IVA (16%)</span><b>'+bsf(totDebitoBs)+'</b><small>Equiv. '+usd(totDebitoBs/rate)+'</small></div>'+
      '<div class="fiscal-card"><span>Crédito Fiscal IVA (Compras)</span><b>'+bsf(totCreditoBs)+'</b><small>Equiv. '+usd(totCreditoBs/rate)+'</small></div>'+
      '<div class="fiscal-card"><span>Balance IVA Forma 30</span><b class="'+(balIvaBs>0?'bad':'ok')+'">'+bsf(Math.abs(balIvaBs))+'</b><small>'+(balIvaBs>0?'A enterar al SENIAT':'Crédito a favor siguiente período')+'</small></div>'+
      '<div class="fiscal-card"><span>IGTF 3% Percibido Divisas</span><b class="warn">'+usd(totIgtfUsd)+'</b><small>'+bsf(totIgtfBs)+'</small></div>'+
      '<div class="fiscal-card"><span>Medios Electrónicos (SUDEBAN)</span><b>'+bsf(totSudebanBs)+'</b><small>Punto, Biopago y Pago Móvil</small></div>'+
    '</div>'+
    '<div class="cierre" style="margin-top:6px">'+
      '<table class="sumt"><thead><tr><th>Verificaciones del Sistema (Semáforo SENIAT / SUDEBAN)</th><th class="c" style="width:110px">Estado</th></tr></thead><tbody>'+
        '<tr><td><b>Tasa Oficial Cambiaria BCV</b>: Aplicada rigurosamente en todas las ventas ('+nf(rate)+' Bs./US$). Sin sobreprecios.</td><td class="c"><span class="fiscal-tag ok">100% CONFORME</span></td></tr>'+
        '<tr><td><b>Formas Libres / Correlativo de Control Fiscal</b>: '+esc(S.cfg.ctrlPrefix)+pad(S.cfg.ctrlNext||1043,8)+' (Rango aut. hasta '+esc(S.cfg.ctrlRangoHasta)+').</td><td class="c"><span class="fiscal-tag ok">48.958 RESTANTES</span></td></tr>'+
        '<tr><td><b>Ley IGTF 3% Divisas</b>: Aplicado únicamente a efectivo en divisas y zelle. Cobros en Bs. 100% exentos.</td><td class="c"><span class="fiscal-tag ok">CONFORME</span></td></tr>'+
        '<tr><td><b>Alícuotas de IVA por Producto</b>: Clasificación fiscal 16% (G), 8% (R), 31% (A) y Exento (E) activas.</td><td class="c"><span class="fiscal-tag ok">DISCRIMINADAS</span></td></tr>'+
        '<tr><td><b>Conciliación de Puntos de Venta y Biopago BDV</b>: Lotes cerrados y conciliados sin diferencias.</td><td class="c"><span class="fiscal-tag ok">CUADRADOS</span></td></tr>'+
      '</tbody></table>'+
      '<table class="sumt"><thead><tr><th>Ficha Fiscal de la Empresa</th><th>Valor Registrado</th></tr></thead><tbody>'+
        '<tr><td>Razón Social</td><td><b>'+esc(S.cfg.empresa)+'</b></td></tr>'+
        '<tr><td>RIF de la Empresa</td><td><b class="mono">'+esc(S.cfg.rif)+'</b></td></tr>'+
        '<tr><td>Condición Tributaria</td><td>'+(S.cfg.contribEspecial?'<span class="fiscal-tag ok">Sujeto Pasivo Especial</span>':'Contribuyente Ordinario')+'</td></tr>'+
        '<tr><td>Agente de Retención IVA</td><td>'+(S.cfg.contribEspecial?'Alícuota del '+S.cfg.retIvaPct+'%':'No aplica')+'</td></tr>'+
        '<tr><td>Nº Providencia Notificación</td><td>'+esc(S.cfg.provEspecial||'SNAT/2023/000412')+'</td></tr>'+
        '<tr><td>Imprenta Autorizada</td><td>'+esc(S.cfg.imprentaRif)+' ('+esc(S.cfg.imprentaAut)+')</td></tr>'+
      '</tbody></table>'+
    '</div>';
  };

  const drawVentas=()=>{
    const sales=getFilteredSales();
    let sumTotal=0, sumEx=0, sumG16=0, sumIva16=0, sumR8=0, sumIva8=0, sumA31=0, sumIva31=0, sumIgtf=0;

    const rowsHtml=sales.length?sales.map((s,idx)=>{
      const rate=s.rate||S.cfg.rate;
      const due=r2(s.total+(s.igtf||0));
      const bG=s.baseG16!==undefined?s.baseG16:s.base;
      const bR=s.baseR8||0;
      const bA=s.baseA31||0;
      const bE=s.baseEx||0;
      const iva16=r2(bG*0.16);
      const iva8=r2(bR*0.08);
      const iva31=r2(bA*0.31);
      const igtfBs=r2((s.igtf||0)*rate);

      if(!s.void){
        sumTotal+=due*rate;sumEx+=bE*rate;sumG16+=bG*rate;sumIva16+=iva16*rate;
        sumR8+=bR*rate;sumIva8+=iva8*rate;sumA31+=bA*rate;sumIva31+=iva31*rate;sumIgtf+=igtfBs;
      }

      return '<tr class="'+(s.void?'void':'')+'">'+
        '<td class="c mono">'+(idx+1)+'</td>'+
        '<td class="c">'+fmtD(new Date(s.ts))+'</td>'+
        '<td class="mono">'+esc(s.client.rif)+'</td>'+
        '<td><b>'+esc(s.client.name)+'</b></td>'+
        '<td class="mono c"><b>'+pad(s.no)+'</b></td>'+
        '<td class="mono c">'+esc(s.ctrlNo||('00-'+pad(s.no,8)))+'</td>'+
        '<td class="mono c">'+(s.void?esc(s.voidDoc||('NC-'+pad(s.no,8))):'—')+'</td>'+
        '<td class="c">'+(s.void?'<span class="fiscal-tag bad">03-ANUL</span>':'<span class="fiscal-tag ok">01-REG</span>')+'</td>'+
        '<td class="r">'+nf(due)+'</td>'+
        '<td class="r"><b>'+nf(due*rate)+'</b></td>'+
        '<td class="r">'+(bE>0?nf(bE*rate):'0,00')+'</td>'+
        '<td class="r">'+nf(bG*rate)+'</td>'+
        '<td class="r" style="color:#1842B8"><b>'+nf(iva16*rate)+'</b></td>'+
        '<td class="r">'+(bR>0?nf(bR*rate):'0,00')+'</td>'+
        '<td class="r">'+(iva8>0?nf(iva8*rate):'0,00')+'</td>'+
        '<td class="r">'+(bA>0?nf(bA*rate):'0,00')+'</td>'+
        '<td class="r">'+(iva31>0?nf(iva31*rate):'0,00')+'</td>'+
        '<td class="r">'+(igtfBs>0?'<span class="fiscal-tag warn">'+nf(igtfBs)+'</span>':'0,00')+'</td>'+
        '<td class="r">'+nf(rate)+'</td>'+
        '<td class="c"><button class="btn mini2" data-show-sale="'+s.no+'">Ver Ticket</button></td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="20">No se encontraron ventas para el período seleccionado.</td></tr>';

    return '<div class="gridwrap fiscal-wrap"><table class="grid" style="min-width:1360px">'+
      '<thead><tr>'+
        '<th class="c" style="width:36px">#</th><th>Fecha</th><th>RIF / C.I.</th><th>Razón Social / Nombre</th>'+
        '<th class="c">Nº Factura</th><th class="c">Nº Control</th><th class="c">Nº N.C.</th><th class="c">Tipo</th>'+
        '<th class="r">Total US$</th><th class="r">Total Facturado Bs.</th><th class="r">Exento Bs.</th>'+
        '<th class="r">Base 16% Bs.</th><th class="r">IVA 16% Bs.</th><th class="r">Base 8% Bs.</th><th class="r">IVA 8% Bs.</th>'+
        '<th class="r">Base 31% Bs.</th><th class="r">IVA 31% Bs.</th><th class="r">IGTF 3% Bs.</th><th class="r">Tasa BCV</th><th class="c">Acción</th>'+
      '</tr></thead>'+
      '<tbody>'+rowsHtml+'</tbody>'+
      '<tfoot><tr style="background:#EEF3FA;font-weight:700">'+
        '<td colspan="9" class="r">TOTALES DEL PERÍODO (Bs.):</td>'+
        '<td class="r">'+nf(sumTotal)+'</td>'+
        '<td class="r">'+nf(sumEx)+'</td>'+
        '<td class="r">'+nf(sumG16)+'</td>'+
        '<td class="r" style="color:#1842B8">'+nf(sumIva16)+'</td>'+
        '<td class="r">'+nf(sumR8)+'</td>'+
        '<td class="r">'+nf(sumIva8)+'</td>'+
        '<td class="r">'+nf(sumA31)+'</td>'+
        '<td class="r">'+nf(sumIva31)+'</td>'+
        '<td class="r" style="color:#945D08">'+nf(sumIgtf)+'</td>'+
        '<td></td><td></td>'+
      '</tr></tfoot>'+
    '</table></div>';
  };

  const drawCompras=()=>{
    const purchases=getFilteredPurchases();
    let sumTotal=0, sumBase=0, sumIva=0, sumRet=0;

    const rowsHtml=purchases.length?purchases.map((p,idx)=>{
      const rate=p.rate||S.cfg.rate;
      const totBs=r2(p.total*rate);
      const baseBs=r2(p.base*rate);
      const ivaBs=r2(p.iva*rate);
      const retBs=p.retIva?r2(p.retIva*rate):r2(p.iva*0.75*rate);

      if(!p.void){sumTotal+=totBs;sumBase+=baseBs;sumIva+=ivaBs;sumRet+=retBs;}

      return '<tr class="'+(p.void?'void':'')+'">'+
        '<td class="c mono">'+(idx+1)+'</td>'+
        '<td class="c">'+fmtD(new Date(p.ts))+'</td>'+
        '<td class="mono">'+esc(p.supplier.rif)+'</td>'+
        '<td><b>'+esc(p.supplier.name)+'</b></td>'+
        '<td class="mono c"><b>'+esc(p.docProv)+'</b></td>'+
        '<td class="mono c">'+esc(p.ctrlProv||('00-'+pad(p.no+4400,8)))+'</td>'+
        '<td class="r">'+nf(p.total)+'</td>'+
        '<td class="r"><b>'+nf(totBs)+'</b></td>'+
        '<td class="r">'+nf(baseBs)+'</td>'+
        '<td class="r" style="color:#1D6F39"><b>'+nf(ivaBs)+'</b></td>'+
        '<td class="r" style="color:#1842B8"><b>'+nf(retBs)+'</b></td>'+
        '<td><span class="fiscal-tag">'+esc(r.estado||'Registro histórico: revisar')+'</span><div class="sub">Declarada: '+(r.declarada?'Sí':'No consta')+' · Pagada: '+(r.pagada?'Sí':'No consta')+' · Entregada: '+(r.comprobanteEntregado?'Sí':'No consta')+'</div></td>'+ 
        '<td class="mono c">'+esc(p.retIvaDoc||('202610'+pad(idx+41,8)))+'</td>'+
        '<td class="r">'+nf(rate)+'</td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="13">No se encontraron compras para el período seleccionado.</td></tr>';

    const sales=getFilteredSales().filter(s=>!s.void);
    const totDebito=r2(sales.reduce((a,s)=>a+s.iva*(s.rate||S.cfg.rate),0));
    const cuota=r2(totDebito-sumIva-sumRet);

    return '<div class="gridwrap fiscal-wrap"><table class="grid" style="min-width:1050px">'+
      '<thead><tr>'+
        '<th class="c" style="width:36px">#</th><th>Fecha</th><th>RIF Proveedor</th><th>Razón Social Proveedor</th>'+
        '<th class="c">Nº Factura</th><th class="c">Nº Control</th><th class="r">Total US$</th><th class="r">Total Facturado Bs.</th>'+
        '<th class="r">Base Gravada 16%</th><th class="r">Crédito Fiscal IVA</th><th class="r">Retención 75% Bs.</th><th class="c">Nº Comprobante</th><th class="r">Tasa BCV</th>'+
      '</tr></thead>'+
      '<tbody>'+rowsHtml+'</tbody>'+
      '<tfoot><tr style="background:#EEF3FA;font-weight:700">'+
        '<td colspan="7" class="r">TOTALES DE COMPRAS (Bs.):</td>'+
        '<td class="r">'+nf(sumTotal)+'</td>'+
        '<td class="r">'+nf(sumBase)+'</td>'+
        '<td class="r" style="color:#1D6F39">'+nf(sumIva)+'</td>'+
        '<td class="r" style="color:#1842B8">'+nf(sumRet)+'</td>'+
        '<td colspan="2"></td>'+
      '</tr></tfoot>'+
    '</table></div>'+
    '<div class="cierre" style="margin-top:8px">'+
      '<table class="sumt"><thead><tr><th>Determinación de la Cuota Tributaria (Forma 30 SENIAT)</th><th class="r">Monto en Bs.</th></tr></thead><tbody>'+
        '<tr><td>Total Débito Fiscal del Período (Ventas)</td><td class="r">'+nf(totDebito)+'</td></tr>'+
        '<tr><td>(-) Total Crédito Fiscal del Período (Compras)</td><td class="r" style="color:#1D6F39">-'+nf(sumIva)+'</td></tr>'+
        '<tr><td>(-) Retenciones de IVA Descontadas</td><td class="r" style="color:#1842B8">-'+nf(sumRet)+'</td></tr>'+
        '<tr class="tot"><td><b>'+(cuota>0?'TOTAL IMPUESTO A PAGAR AL SENIAT':'SALDO A FAVOR DEL CONTRIBUYENTE')+'</b></td><td class="r" style="font-size:15px;color:'+(cuota>0?'var(--bad)':'var(--ok)')+'"><b>'+nf(Math.abs(cuota))+' Bs.</b></td></tr>'+
      '</tbody></table>'+
    '</div>';
  };

  const drawIgtf=()=>{
    const sales=getFilteredSales().filter(s=>!s.void);
    const igtfSales=sales.filter(s=>(s.igtf>0)||(s.pays||[]).some(p=>p.cur==='USD'));
    let sumBaseUsd=0, sumBaseBs=0, sumIgtfUsd=0, sumIgtfBs=0;

    const rowsHtml=igtfSales.length?igtfSales.map(s=>{
      const rate=s.rate||S.cfg.rate;
      const usdPays=(s.pays||[]).filter(p=>p.cur==='USD');
      const baseUsd=usdPays.reduce((a,p)=>a+(p.id==='efUSD'?r2(p.amount/1.03):p.amount),0);
      const baseBs=r2(baseUsd*rate);
      const igtfUsd=s.igtf||r2(baseUsd*0.03);
      const igtfBs=r2(igtfUsd*rate);

      sumBaseUsd+=baseUsd;sumBaseBs+=baseBs;sumIgtfUsd+=igtfUsd;sumIgtfBs+=igtfBs;

      return '<tr>'+
        '<td class="mono c"><b>'+pad(s.no)+'</b></td>'+
        '<td class="c">'+fmtDT(s.ts)+'</td>'+
        '<td class="mono">'+esc(s.client.rif)+'</td>'+
        '<td>'+esc(s.client.name)+'</td>'+
        '<td>'+esc(usdPays.map(p=>p.name).join(' + '))+'</td>'+
        '<td class="r">'+nf(baseUsd)+'</td>'+
        '<td class="r">'+nf(rate)+'</td>'+
        '<td class="r">'+nf(baseBs)+'</td>'+
        '<td class="c"><span class="fiscal-tag warn">3,00 %</span></td>'+
        '<td class="r" style="color:#945D08"><b>'+nf(igtfUsd)+'</b></td>'+
        '<td class="r" style="color:#945D08"><b>'+nf(igtfBs)+'</b></td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="11">No hay cobros en moneda extranjera sujetos a IGTF en este período.</td></tr>';

    return '<div class="semaforo-bar" style="background:#FFF6E5;border-color:#F5DEB0">'+
      '<div class="semaforo-dot" style="background:#945D08;box-shadow:0 0 0 3px rgba(148,93,8,.2)"></div>'+
      '<div class="semaforo-text" style="color:#945D08"><b>RÉGIMEN IGTF (Ley Impuesto Grandes Transacciones Financieras &middot; Gaceta Oficial Nº 6.687)</b>: Se percibe el 3% exclusivamente sobre pagos en efectivo en divisas y medios extranjeros. Los pagos en moneda nacional (Biopago, Pago Móvil, Punto de Venta) están exentos (0%).</div>'+
    '</div>'+
    '<div class="gridwrap fiscal-wrap"><table class="grid" style="min-width:980px">'+
      '<thead><tr>'+
        '<th class="c">Factura</th><th>Fecha/Hora</th><th>RIF</th><th>Cliente</th><th>Forma Pago Divisa</th>'+
        '<th class="r">Base Divisa US$</th><th class="r">Tasa BCV</th><th class="r">Base Imponible Bs.</th><th class="c">Alícuota</th>'+
        '<th class="r">IGTF US$</th><th class="r">IGTF Percibido Bs.</th>'+
      '</tr></thead>'+
      '<tbody>'+rowsHtml+'</tbody>'+
      '<tfoot><tr style="background:#EEF3FA;font-weight:700">'+
        '<td colspan="5" class="r">TOTALES DE PERCEPCIÓN IGTF:</td>'+
        '<td class="r">'+nf(sumBaseUsd)+'</td>'+
        '<td></td>'+
        '<td class="r">'+nf(sumBaseBs)+'</td>'+
        '<td></td>'+
        '<td class="r" style="color:#945D08">'+nf(sumIgtfUsd)+'</td>'+
        '<td class="r" style="color:#945D08">'+nf(sumIgtfBs)+'</td>'+
      '</tr></tfoot>'+
    '</table></div>'+
    '<div class="cierre" style="margin-top:8px">'+
      '<table class="sumt"><thead><tr><th>Resumen de Enteramiento Quincenal al SENIAT (IGTF)</th><th class="r">Monto</th></tr></thead><tbody>'+
        '<tr><td>Total Operaciones Sujetas a IGTF</td><td class="r">'+igtfSales.length+' operaciones</td></tr>'+
        '<tr><td>Base Imponible en Divisas</td><td class="r">'+usd(sumBaseUsd)+'</td></tr>'+
        '<tr><td>Base Imponible Convertida a Tasa BCV</td><td class="r">'+bsf(sumBaseBs)+'</td></tr>'+
        '<tr class="tot"><td><b>Total IGTF 3% a Enterar al Tesoro Nacional</b></td><td class="r" style="color:#945D08"><b>'+bsf(sumIgtfBs)+'</b> ('+usd(sumIgtfUsd)+')</td></tr>'+
      '</tbody></table>'+
    '</div>';
  };

  const drawAuditoria=()=>{
    const sales=getFilteredSales();
    const ok=sales.filter(s=>!s.void);

    const rowsHtml=sales.length?sales.map(s=>{
      const rate=s.rate||S.cfg.rate;
      const dueUsd=r2(s.total+(s.igtf||0));
      const dueBs=r2(dueUsd*rate);
      return '<tr class="'+(s.void?'void':'')+'">'+
        '<td class="mono c"><b>'+pad(s.no)+'</b></td>'+
        '<td class="c">'+fmtDT(s.ts)+'</td>'+
        '<td class="mono c">'+esc(s.ctrlNo||('00-'+pad(s.no,8)))+'</td>'+
        '<td><b>'+esc(s.client.name)+'</b> ('+esc(s.client.rif)+')</td>'+
        '<td class="r">'+nf(dueUsd)+'</td>'+
        '<td class="r" style="font-weight:700;color:#1842B8">'+nf(rate)+'</td>'+
        '<td class="r"><b>'+nf(dueBs)+'</b></td>'+
        '<td class="c">'+esc(S.cfg.cajero)+'</td>'+
        '<td class="c">'+(s.void?'<span class="fiscal-tag bad">ANULADA</span>':'<span class="fiscal-tag ok">100% CONFORME BCV</span>')+'</td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="9">No hay registros de ventas auditadas.</td></tr>';

    return '<div class="semaforo-bar">'+
      '<div class="semaforo-dot"></div>'+
      '<div class="semaforo-text"><b>AUDITORÍA DE PRECIOS Y TASA OFICIAL CAMBIARIA (SUNDDE / BCV)</b>: Certificación de cálculo a la tasa fijada por el Banco Central de Venezuela sin sobreprecios ni uso de marcadores paralelos no autorizados.</div>'+
    '</div>'+
    '<div class="gridwrap fiscal-wrap"><table class="grid" style="min-width:960px">'+
      '<thead><tr>'+
        '<th class="c">Factura</th><th>Fecha y Hora</th><th class="c">Nº Control</th><th>Cliente y RIF</th>'+
        '<th class="r">Total US$</th><th class="r">Tasa Oficial BCV</th><th class="r">Total Facturado Bs.</th><th class="c">Cajero</th><th class="c">Auditoría</th>'+
      '</tr></thead>'+
      '<tbody>'+rowsHtml+'</tbody>'+
    '</table></div>';
  };

  const drawSudeban=()=>{
    const sales=getFilteredSales().filter(s=>!s.void);
    const byM={punto:0,biopago:0,pmovil:0,transf:0,efBs:0,efUSD:0,zelle:0};
    const countM={punto:0,biopago:0,pmovil:0,transf:0,efBs:0,efUSD:0,zelle:0};

    sales.forEach(s=>s.pays.forEach(p=>{
      if(byM[p.id]!==undefined){byM[p.id]+=p.amount;countM[p.id]++;}
    }));

    const lotes=S.lotesSudeban||[];
    const lotesRows=lotes.length?lotes.map(l=>'<tr>'+
      '<td class="mono c"><b>'+esc(l.id)+'</b></td>'+
      '<td><b>'+esc(l.banco)+'</b></td>'+
      '<td class="mono c">'+esc(l.tid)+'</td>'+
      '<td class="mono c">'+esc(l.refLote)+'</td>'+
      '<td>'+fmtDT(l.ts)+'</td>'+
      '<td class="c">'+l.ops+' ops</td>'+
      '<td class="r"><b>'+nf(l.totalBs)+'</b></td>'+
      '<td class="r" style="color:#945D08">'+nf(l.comisionBs)+'</td>'+
      '<td class="r" style="color:#1D6F39"><b>'+nf(l.netoBs)+'</b></td>'+
      '<td class="c"><span class="fiscal-tag ok">'+esc(l.estado)+'</span></td>'+
      '<td class="c" style="white-space:nowrap">'+
        '<button class="btn mini2" data-voucher-lote="'+esc(l.id)+'">Voucher</button> '+
        '<button class="btn mini2" style="color:var(--bad)" data-del-lote="'+esc(l.id)+'" title="Eliminar lote">✕</button>'+
      '</td>'+
    '</tr>').join(''):'<tr class="empty"><td colspan="11">No hay lotes bancarios registrados.</td></tr>';

    /* Detección de operaciones de prevención LC/FT (Umbral > 1000 USD en efectivo) */
    const largeOps=sales.filter(s=>(s.pays||[]).some(p=>p.id==='efUSD'&&p.amount>=1000));

    return '<div class="fiscal-grid">'+
      '<div class="fiscal-card"><span>Punto de Venta POS</span><b>'+bsf(byM.punto)+'</b><small>'+countM.punto+' transacciones</small></div>'+
      '<div class="fiscal-card"><span>Biopago BDV (Biometría)</span><b style="color:#1842B8">'+bsf(byM.biopago)+'</b><small>'+countM.biopago+' transacciones</small></div>'+
      '<div class="fiscal-card"><span>Pago Móvil C2P / P2P</span><b>'+bsf(byM.pmovil)+'</b><small>'+countM.pmovil+' transacciones</small></div>'+
      '<div class="fiscal-card"><span>Transferencias en Bs.</span><b>'+bsf(byM.transf)+'</b><small>'+countM.transf+' transacciones</small></div>'+
    '</div>'+
    '<div class="row" style="margin-top:6px;align-items:center;justify-content:space-between">'+
      '<b>Lotes de Cierre Bancario y Conciliación (SUDEBAN):</b>'+
      '<button class="btn mini2 primary" id="btnOpenNewLote">+ Registrar Cierre de Lote</button>'+
    '</div>'+
    '<div class="gridwrap" style="max-height:160px;margin-top:4px"><table class="grid">'+
      '<thead><tr><th class="c">ID Lote</th><th>Banco Adquirente</th><th class="c">Terminal (TID)</th><th class="c">Nº Lote Voucher</th><th>Fecha/Hora</th><th class="c">Ops</th><th class="r">Total Voucher Bs.</th><th class="r">Comisión Bancaria</th><th class="r">Neto Liquidado Bs.</th><th class="c">Estado</th><th class="c">Acciones</th></tr></thead>'+
      '<tbody>'+lotesRows+'</tbody>'+
    '</table></div>'+
    '<div class="group" style="margin-top:8px;padding:8px 10px">'+
      '<div class="gtitle" style="font-size:13px;display:flex;align-items:center;gap:8px">Prevención de Legitimación de Capitales (LC/FT/FPADM &middot; SUDEBAN) <span class="fiscal-tag info">Umbral: &ge; US$ 1.000</span></div>'+
      (largeOps.length?
        '<p class="hint" style="color:var(--warn)">Se detectaron '+largeOps.length+' operaciones en efectivo que superan el umbral regulatorio:</p>'+
        '<div style="font-size:11.5px">'+largeOps.map(s=>'<div>&bull; Factura '+pad(s.no)+' &middot; Cliente: '+esc(s.client.name)+' ('+esc(s.client.rif)+') &middot; Monto: '+usd(s.total)+' (Ficha KYC Verificada).</div>').join('')+'</div>'
        :'<p class="hint">No se han registrado operaciones en efectivo atípicas que superen el umbral regulatorio en este período.</p>')+
    '</div>';
  };

  const drawRetenciones=()=>{
    const list=S.retencionesIva||[];
    const rowsHtml=list.length?list.map(r=>{
      const rate=r.rate||S.cfg.rate;
      const retBs=r.retainedBs||r2(r.iva*0.75*rate);
      return '<tr>'+
        '<td class="mono c"><b>'+esc(r.id)+'</b></td>'+
        '<td class="c">'+fmtD(new Date(r.ts))+'</td>'+
        '<td class="mono">'+esc(r.supplier.rif)+'</td>'+
        '<td><b>'+esc(r.supplier.name)+'</b></td>'+
        '<td class="mono c">'+esc(r.docProv)+'</td>'+
        '<td class="mono c">'+esc(r.ctrlProv)+'</td>'+
        '<td class="r">'+nf(r.base*rate)+'</td>'+
        '<td class="r">'+nf(r.iva*rate)+'</td>'+
        '<td class="c"><span class="fiscal-tag ok">'+fq(r.pct||75)+'%</span></td>'+
        '<td class="r" style="color:#1842B8"><b>'+nf(retBs)+'</b></td>'+
        '<td class="c" style="white-space:nowrap">'+
          '<button class="btn mini2" data-print-ret="'+esc(r.id)+'">Imprimir borrador</button> '+
          '<button class="btn mini2" style="color:var(--bad)" data-del-ret="'+esc(r.id)+'" title="Eliminar retención">✕</button>'+
        '</td>'+
      '</tr>';
    }).join(''):'<tr class="empty"><td colspan="12">No hay registros de retención.</td></tr>';

    return '<div class="semaforo-bar">'+
      '<div class="semaforo-dot"></div>'+
      '<div class="semaforo-text"><b>CONTROL Y TRAZABILIDAD DE RETENCIONES IVA</b> &middot; Reporte interno de apoyo al contador bajo referencia SNAT/2025/000054. El POS no declara ni paga; valide la normativa, las excepciones y el formato vigente antes de usar cualquier archivo.</div>'+ 
      '<button class="btn mini2 primary" id="btnNewManualRet" style="margin-left:auto;flex:none">+ Emitir Retención de IVA</button>'+
    '</div>'+
    '<div class="gridwrap fiscal-wrap"><table class="grid" style="min-width:1050px">'+
      '<thead><tr>'+
        '<th class="c">Nº / ID interno</th><th>Fecha</th><th>RIF Proveedor</th><th>Nombre Proveedor</th>'+ 
        '<th class="c">Factura Proveedor</th><th class="c">Nº Control</th><th class="r">Base Imponible Bs.</th><th class="r">IVA Facturado Bs.</th><th class="c">% Ret.</th><th class="r">Monto Retenido Bs.</th><th>Seguimiento contable</th><th class="c" style="width:170px">Acciones</th>'+ 
      '</tr></thead>'+
      '<tbody>'+rowsHtml+'</tbody>'+
    '</table></div>';
  };

  const drawPagoSeniat=()=>{
    const fecha=new Date();
    const mesActual=String(fecha.getFullYear())+'-'+String(fecha.getMonth()+1).padStart(2,'0');
    const [anioPeriodo,mesPeriodo]=mesActual.split('-').map(Number);
    const enPeriodoSeniat=ts=>{const d=new Date(ts);return d.getFullYear()===anioPeriodo&&d.getMonth()+1===mesPeriodo;};
    // El IVA se declara por mes calendario. Este cálculo ignora el filtro de búsqueda y las quincenas de otras pestañas.
    const sales=(S.sales||[]).filter(x=>!x.void&&enPeriodoSeniat(x.ts));
    const purchases=(S.purchases||[]).filter(x=>!x.void&&enPeriodoSeniat(x.ts));
    const retenciones=(S.retencionesIva||[]).filter(r=>enPeriodoSeniat(r.ts));
    const debito=r2(sales.reduce((a,x)=>a+(x.iva||0)*(x.rate||S.cfg.rate),0));
    const credito=r2(purchases.reduce((a,x)=>a+(x.iva||0)*(x.rate||S.cfg.rate),0));
    const retenido=r2(retenciones.reduce((a,r)=>a+(r.retainedBs!==undefined?r.retainedBs:r2((r.iva||0)*(r.pct||S.cfg.retIvaPct||75)/100*(r.rate||S.cfg.rate))),0));
    const saldo=r2(debito-credito);
    const periodo=fecha.toLocaleDateString('es-VE',{month:'long',year:'numeric'});
    const warnings=[];
    if(!S.cfg.empresa||!S.cfg.rif||!S.cfg.dir)warnings.push('Completar razón social, RIF y domicilio fiscal en Parámetros Fiscales.');
    if(!sales.length&&!purchases.length)warnings.push('No hay ventas ni compras registradas para el mes calendario actual.');
    if(sales.some(x=>!x.client||!x.client.rif||!x.no))warnings.push('Hay ventas con datos fiscales incompletos; revisar documentos fuente.');
    if(purchases.some(x=>!x.supplier||!x.supplier.rif||!x.docProv))warnings.push('Hay compras con datos de proveedor incompletos; revisar facturas originales.');
    if(S.cfg.empresa==='Autopartes El Pistón, C.A.'&&S.cfg.rif==='J-40123456-8')warnings.push('El perfil coincide con los datos iniciales de ejemplo. Confirme y sustituya por los datos reales del contribuyente antes de usar el informe.');
    return '<div class="semaforo-bar" style="background:#FFF6E5;border-color:#F5DEB0">'+
      '<div class="semaforo-dot" style="background:#945D08;box-shadow:0 0 0 3px rgba(148,93,8,.2)"></div>'+
      '<div class="semaforo-text" style="color:#744600"><b>PREPARACIÓN PRELIMINAR — NO ES UNA PLANILLA OFICIAL DE PAGO.</b> El compromiso/planilla oficial se genera en el portal del SENIAT después de registrar la declaración. Este módulo no se conecta al SENIAT ni registra declaraciones ni pagos.</div>'+
    '</div>'+
    '<div class="khead"><div><span>Contribuyente registrado en el POS</span><b>'+esc(S.cfg.empresa||'Falta razón social')+'</b></div><div><span>RIF configurado</span><b>'+esc(S.cfg.rif||'Falta RIF')+'</b></div><div><span>Período mensual calculado</span><b>'+esc(periodo)+'</b></div><div><span>Generado</span><b>'+esc(fmtDT(fecha.getTime()))+'</b></div></div>'+
    (warnings.length?'<div class="group" style="border-color:#E7B85C;background:#FFF9E9"><div class="gtitle">Verificaciones pendientes</div><ul style="margin:0;padding-left:20px">'+warnings.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>':'')+
    '<div class="cierre"><table class="sumt"><thead><tr><th>Resumen de cifras registradas en el POS</th><th class="r">Monto (Bs.)</th></tr></thead><tbody>'+
      '<tr><td>Débito fiscal calculado desde ventas no anuladas</td><td class="r">'+nf(debito)+'</td></tr>'+
      '<tr><td>Crédito fiscal registrado en compras no anuladas</td><td class="r">'+nf(credito)+'</td></tr>'+
      '<tr><td>IVA retenido a proveedores (enteramiento separado)</td><td class="r">'+nf(retenido)+'</td></tr>'+
      '<tr class="tot"><td>Saldo aritmético preliminar débito menos crédito (no liquidación oficial)</td><td class="r">'+nf(saldo)+'</td></tr>'+
    '</tbody></table><table class="sumt"><thead><tr><th>Documentos de soporte</th><th class="r">Cantidad</th></tr></thead><tbody>'+
      '<tr><td>Ventas no anuladas</td><td class="r">'+sales.length+'</td></tr>'+
      '<tr><td>Compras no anuladas</td><td class="r">'+purchases.length+'</td></tr>'+
      '<tr><td>Comprobantes de retención registrados</td><td class="r">'+retenciones.length+'</td></tr>'+
      '<tr><td>IGTF percibido registrado en ventas (referencial)</td><td class="r">'+nf(r2(sales.reduce((a,x)=>a+(x.igtf||0)*(x.rate||S.cfg.rate),0)))+'</td></tr>'+
    '</tbody></table></div>'+
    '<div class="group"><div class="gtitle">Antes de declarar y pagar</div><ol style="margin:0;padding-left:20px"><li>Verifique que el RIF, la condición tributaria y el período sean correctos.</li><li>Concilie cada cifra con los libros fiscales, facturas, notas de crédito y comprobantes de retención originales.</li><li>Ingrese al portal oficial, presente la declaración y revise los importes calculados por el SENIAT.</li><li>Tramite por separado las retenciones de IVA practicadas a proveedores y descargue del portal la planilla oficial correspondiente, si aplica.</li><li>Después de registrar la declaración, descargue desde el portal la planilla/compromiso de pago oficial que corresponda. No use este borrador como comprobante de pago.</li></ol><p class="hint" style="margin-top:8px">Las cifras anteriores son sumas de los registros disponibles en este POS. No sustituyen el Formulario/Declaración del SENIAT, la determinación profesional del tributo ni la validación de obligaciones vigentes.</p></div>'+
    '<div class="row" style="flex-wrap:wrap"><button class="btn primary" id="btnPreviewPagoSeniat">Vista previa / Guardar borrador PDF</button><button class="btn" id="btnOpenSeniatPortal">Abrir portal de declaraciones SENIAT</button></div>';
  };

  const drawConfig=()=>{
    const c=S.cfg;
    return '<div class="newgrid">'+
      '<div class="f wide"><label for="fEmp">Razón Social</label><input class="fld" id="fEmp" value="'+esc(c.empresa)+'"></div>'+
      '<div class="f"><label for="fRif">RIF de la Empresa</label><input class="fld" id="fRif" value="'+esc(c.rif)+'"></div>'+
      '<div class="f wide"><label for="fDir">Domicilio Fiscal</label><input class="fld" id="fDir" value="'+esc(c.dir)+'"></div>'+
      '<div class="f"><label for="fTipo">Modalidad de Facturación</label><select class="fld" id="fTipo"><option value="FORMA_LIBRE" '+(c.fiscalTipo==='FORMA_LIBRE'?'selected':'')+'>Formas Libres por Computador</option><option value="MAQUINA_FISCAL" '+(c.fiscalTipo==='MAQUINA_FISCAL'?'selected':'')+'>Impresora Fiscal Homologada</option></select></div>'+
      '<div class="f"><label for="fEsp">Calificación Tributaria</label><select class="fld" id="fEsp"><option value="1" '+(c.contribEspecial?'selected':'')+'>Sujeto Pasivo Especial (Agente Retención)</option><option value="0" '+(!c.contribEspecial?'selected':'')+'>Contribuyente Ordinario</option></select></div>'+
      '<div class="f"><label for="fPctRet">Retención ordinaria de referencia</label><select class="fld" id="fPctRet"><option value="75" selected>75 % del IVA (referencia general; verificar excepciones)</option></select></div>'+
      '<div class="f wide"><label><input type="checkbox" id="fRetConfirm" '+(c.retencionHabilitadaConfirmada===true?'checked':'')+'> Confirmo que el negocio fue designado como Sujeto Pasivo Especial/agente de retención y verifiqué su notificación vigente.</label><p class="muted">Sin esta confirmación, el POS no calculará retenciones automáticamente. El contador debe verificar la designación, la operación y las excepciones aplicables.</p></div>'+ 
      '<div class="f"><label for="fProvEsp">Nº Providencia Notificación</label><input class="fld" id="fProvEsp" value="'+esc(c.provEspecial||'SNAT/2023/000412')+'"></div>'+
      '<div class="f"><label for="fCtrlPref">Prefijo Nº Control Fiscal</label><input class="fld mono" id="fCtrlPref" value="'+esc(c.ctrlPrefix||'00-')+'"></div>'+
      '<div class="f"><label for="fCtrlNext">Próximo Nº de Control</label><input class="fld mono r" id="fCtrlNext" value="'+(c.ctrlNext||1043)+'"></div>'+
      '<div class="f"><label for="fRangoD">Rango Autorizado (Desde)</label><input class="fld mono" id="fRangoD" value="'+esc(c.ctrlRangoDesde||'00-00000001')+'"></div>'+
      '<div class="f"><label for="fRangoH">Rango Autorizado (Hasta)</label><input class="fld mono" id="fRangoH" value="'+esc(c.ctrlRangoHasta||'00-00050000')+'"></div>'+
      '<div class="f"><label for="fImpRif">RIF Imprenta Digital Autorizada</label><input class="fld" id="fImpRif" value="'+esc(c.imprentaRif||'J-31009988-4')+'"></div>'+
      '<div class="f"><label for="fImpAut">Nº Providencia Imprenta</label><input class="fld" id="fImpAut" value="'+esc(c.imprentaAut||'SENIAT/DAF/2022/981')+'"></div>'+
      '<div class="f"><label for="fSerial">Serial Máquina / Memoria Fiscal</label><input class="fld mono" id="fSerial" value="'+esc(c.serialFiscal||'Z4A7719204')+'"></div>'+
    '</div><p class="hint">Los números de control asignados son correlativos y consecutivos conforme a la Providencia SENIAT 0071 sobre emisión de facturas y otros documentos.</p>';
  };

  const renderTabContent=()=>{
    const content=$('#snContent',el);
    if(activeTab==='resumen')content.innerHTML=drawResumen();
    else if(activeTab==='ventas')content.innerHTML=drawVentas();
    else if(activeTab==='compras')content.innerHTML=drawCompras();
    else if(activeTab==='igtf')content.innerHTML=drawIgtf();
    else if(activeTab==='auditoria')content.innerHTML=drawAuditoria();
    else if(activeTab==='sudeban')content.innerHTML=drawSudeban();
    else if(activeTab==='retenciones')content.innerHTML=drawRetenciones();
    else if(activeTab==='pagoSeniat')content.innerHTML=drawPagoSeniat();
    else if(activeTab==='config')content.innerHTML=drawConfig();
    updateFoot();
  };

  const updateFoot=()=>{
    if(!W)return;
    const footL=$('.foot-l',W.el);
    if(!footL)return;
    if(activeTab==='ventas'){
      footL.innerHTML='<button class="btn mini2" id="btnExpV">Exportar Libro CSV</button><button class="btn mini2" id="btnPrintV">Imprimir Libro SENIAT</button>';
    }else if(activeTab==='compras'){
      footL.innerHTML='<button class="btn mini2" id="btnExpC">Exportar Libro CSV</button>';
    }else if(activeTab==='igtf'){
      footL.innerHTML='<button class="btn mini2" id="btnExpIgtf">Exportar IGTF CSV</button>';
    }else if(activeTab==='auditoria'){
      footL.innerHTML='<button class="btn mini2" id="btnPrintActaBcv">Imprimir Acta de Tasa BCV</button>';
    }else if(activeTab==='sudeban'){
      footL.innerHTML='<button class="btn mini2 primary" id="btnQuickLote">+ Cierre de Lote POS</button>';
    }else if(activeTab==='retenciones'){
      footL.innerHTML='<button class="btn mini2 primary" id="btnTxtSeniat">Descargar TXT para SENIAT</button>';
    }else if(activeTab==='pagoSeniat'){
      footL.innerHTML='<span class="hint">Borrador informativo; la planilla oficial se obtiene en el SENIAT.</span>';
    }else if(activeTab==='config'){
      footL.innerHTML='<button class="btn mini2 primary" id="btnSaveF">Guardar Parámetros Fiscales</button>';
    }else{
      footL.innerHTML='<button class="btn mini2" id="btnGotoVentas">Ver Libro de Ventas</button><button class="btn mini2" id="btnGotoIgtf">Ver IGTF 3%</button>';
    }
  };

  el.addEventListener('click',e=>{
    const tabBtn=e.target.closest('.tab[data-tab]');
    if(tabBtn){
      $('.tab.active',el)?.classList.remove('active');
      tabBtn.classList.add('active');
      activeTab=tabBtn.dataset.tab;
      renderTabContent();
      return;
    }
    if(e.target.id==='btnOpenNewLote'){
      registerLoteSudebanDlg(()=>{seniatSudebanDlg('sudeban');});
      return;
    }
    if(e.target.id==='btnNewManualRet'){
      newRetencionIvaDlg(()=>{renderTabContent();});
      return;
    }
    const voucherBtn=e.target.closest('[data-voucher-lote]');
    if(voucherBtn){
      const l=(S.lotesSudeban||[]).find(x=>x.id===voucherBtn.dataset.voucherLote);
      if(l)printVoucherLoteSudeban(l);
      return;
    }
    const delLoteBtn=e.target.closest('[data-del-lote]');
    if(delLoteBtn){
      const id=delLoteBtn.dataset.delLote;
      ask('Eliminar lote bancario','¿Confirma eliminar el registro de lote '+id+'?','Eliminar',()=>{
        S.lotesSudeban=(S.lotesSudeban||[]).filter(x=>x.id!==id);
        save();renderTabContent();msg('Lote bancario eliminado.');
      });
      return;
    }
    const retBtn=e.target.closest('[data-print-ret]');
    if(retBtn){
      const comp=(S.retencionesIva||[]).find(x=>x.id===retBtn.dataset.printRet);
      if(comp)printComprobanteRetencion(comp);
      return;
    }
    const delRetBtn=e.target.closest('[data-del-ret]');
    if(delRetBtn){
      const id=delRetBtn.dataset.delRet;
      ask('Eliminar comprobante de retención','¿Confirma anular/eliminar la retención '+id+'?','Eliminar',()=>{
        S.retencionesIva=(S.retencionesIva||[]).filter(x=>x.id!==id);
        save();renderTabContent();msg('Comprobante de retención eliminado.');
      });
      return;
    }
    const showSaleBtn=e.target.closest('[data-show-sale]');
    if(showSaleBtn){
      const no=+showSaleBtn.dataset.showSale;
      const s=(S.sales||[]).find(x=>x.no===no);
      if(s)showTicket(s);
      return;
    }
  });

  el.addEventListener('change',e=>{
    if(e.target.id==='snPeriod'){
      curPeriod=e.target.value;
      renderTabContent();
    }
  });

  el.addEventListener('input',e=>{
    if(e.target.id==='snQ'){
      qText=e.target.value;
      renderTabContent();
    }
  });

  openWin({
    title:'Control SENIAT / SUDEBAN — Cumplimiento Fiscal, IGTF y Conciliación Bancaria',
    w:1120,
    body:el,
    foot:[{label:'Cerrar',primary:true}],
    onOpen:bd=>{
      renderTabContent();
      bd.addEventListener('click',ev=>{
        if(ev.target.id==='btnExpV')exportLibroVentasCsv(getFilteredSales());
        if(ev.target.id==='btnPrintV')printFiscalReport('Libro de Ventas Fiscal Oficial (SENIAT)',drawVentas());
        if(ev.target.id==='btnExpC')exportLibroComprasCsv(getFilteredPurchases());
        if(ev.target.id==='btnExpIgtf')exportIgtfCsv(getFilteredSales());
        if(ev.target.id==='btnPrintActaBcv')printActaBcv(getFilteredSales());
        if(ev.target.id==='btnTxtSeniat')exportSeniatTxt('202610');
        if(ev.target.id==='btnPreviewPagoSeniat'){
          const fechaPeriodo=new Date();
          const mesPeriodo=String(fechaPeriodo.getFullYear())+'-'+String(fechaPeriodo.getMonth()+1).padStart(2,'0');
          const [anioFiscal,mesFiscal]=mesPeriodo.split('-').map(Number);
          const enPeriodoFiscal=ts=>{const d=new Date(ts);return d.getFullYear()===anioFiscal&&d.getMonth()+1===mesFiscal;};
          // Totales mensuales sin depender del filtro de búsqueda ni de la vista quincenal de otras pestañas.
          const sales=(S.sales||[]).filter(x=>!x.void&&enPeriodoFiscal(x.ts));
          const purchases=(S.purchases||[]).filter(x=>!x.void&&enPeriodoFiscal(x.ts));
          const retenciones=(S.retencionesIva||[]).filter(r=>enPeriodoFiscal(r.ts));
          const debito=r2(sales.reduce((a,x)=>a+(x.iva||0)*(x.rate||S.cfg.rate),0));
          const credito=r2(purchases.reduce((a,x)=>a+(x.iva||0)*(x.rate||S.cfg.rate),0));
          const retenido=r2(retenciones.reduce((a,r)=>a+(r.retainedBs!==undefined?r.retainedBs:r2((r.iva||0)*(r.pct||S.cfg.retIvaPct||75)/100*(r.rate||S.cfg.rate))),0));
          const saldo=r2(debito-credito);
          const periodo=fechaPeriodo.toLocaleDateString('es-VE',{month:'long',year:'numeric'});
          const html='<div style="border:2px solid #945D08;padding:10px;margin-bottom:12px;text-align:center"><b>DOCUMENTO PRELIMINAR — NO ES PLANILLA OFICIAL SENIAT NI COMPROBANTE DE PAGO</b></div>'+
            '<h3>Preparación de declaración tributaria</h3><p><b>Contribuyente:</b> '+esc(S.cfg.empresa)+' &nbsp; <b>RIF:</b> '+esc(S.cfg.rif)+'</p><p><b>Domicilio fiscal:</b> '+esc(S.cfg.dir||'No especificado')+'</p><p><b>Período seleccionado:</b> '+esc(periodo)+' &nbsp; <b>Fecha de emisión:</b> '+esc(fmtDT(Date.now()))+'</p>'+
            '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;border-bottom:1px solid #777;padding:6px">Concepto calculado desde registros POS</th><th style="text-align:right;border-bottom:1px solid #777;padding:6px">Monto Bs.</th></tr></thead><tbody>'+
            [['Débito fiscal de ventas no anuladas',debito],['Crédito fiscal de compras no anuladas',credito],['IVA retenido a proveedores (obligación separada)',retenido],['Saldo aritmético preliminar débito menos crédito; requiere conciliación',saldo]].map(r=>'<tr><td style="padding:6px;border-bottom:1px solid #ddd">'+esc(r[0])+'</td><td style="padding:6px;text-align:right;border-bottom:1px solid #ddd">'+nf(r[1])+'</td></tr>').join('')+
            '</tbody></table><p><b>Soporte:</b> '+sales.length+' ventas no anuladas, '+purchases.length+' compras no anuladas y '+retenciones.length+' comprobantes de retención.</p>'+
            '<p>Este informe no reproduce una planilla oficial ni genera un compromiso de pago. El IVA retenido a proveedores es una obligación de enteramiento separada y no se resta automáticamente del saldo propio de IVA en este cálculo. La declaración debe revisarse y registrarse en el portal oficial del SENIAT; la planilla/compromiso oficial se obtiene allí después de registrar la declaración cuando corresponda.</p>'+
            '<p><b>Validación:</b> Confirmar datos del contribuyente, período, documentos originales, alícuotas, créditos, retenciones y reglas tributarias vigentes antes de declarar.</p>';
          printFiscalReport('BORRADOR NO OFICIAL — Preparación de Pago SENIAT',html);
        }
        if(ev.target.id==='btnOpenSeniatPortal')window.open('https://declaraciones.seniat.gob.ve/','_blank','noopener');
        if(ev.target.id==='btnQuickLote')registerLoteSudebanDlg(()=>{seniatSudebanDlg('sudeban');});
        if(ev.target.id==='btnGotoVentas'){activeTab='ventas';$('.tab[data-tab="ventas"]',el)?.click();}
        if(ev.target.id==='btnGotoIgtf'){activeTab='igtf';$('.tab[data-tab="igtf"]',el)?.click();}
        if(ev.target.id==='btnSaveF'){
          S.cfg.empresa=$('#fEmp',el).value.trim()||S.cfg.empresa;
          S.cfg.rif=$('#fRif',el).value.trim()||S.cfg.rif;
          S.cfg.dir=$('#fDir',el).value.trim();
          S.cfg.fiscalTipo=$('#fTipo',el).value;
          S.cfg.contribEspecial=$('#fEsp',el).value==='1';
          S.cfg.retIvaPct=75;
          S.cfg.retencionHabilitadaConfirmada=$('#fRetConfirm',el).checked===true;
          if(!S.cfg.contribEspecial)S.cfg.retencionHabilitadaConfirmada=false;
          S.cfg.provEspecial=$('#fProvEsp',el).value.trim();
          S.cfg.ctrlPrefix=$('#fCtrlPref',el).value.trim()||'00-';
          S.cfg.ctrlNext=parseInt($('#fCtrlNext',el).value)||1043;
          S.cfg.ctrlRangoDesde=$('#fRangoD',el).value.trim();
          S.cfg.ctrlRangoHasta=$('#fRangoH',el).value.trim();
          S.cfg.imprentaRif=$('#fImpRif',el).value.trim();
          S.cfg.imprentaAut=$('#fImpAut',el).value.trim();
          S.cfg.serialFiscal=$('#fSerial',el).value.trim();
          save();renderAll();msg('Parámetros fiscales guardados con éxito.');
        }
      });
    }
  });
}

/* ---------- configuración y ayuda ---------- */
function cfgDlg(focusId){
  const c=S.cfg;
  if(!c.ticketFont)c.ticketFont='ibm';
  if(!c.ticketSize)c.ticketSize='12';
  const fontOpts=TICKET_FONTS.map(f=>'<option value="'+f.id+'"'+(c.ticketFont===f.id?' selected':'')+'>'+esc(f.name)+'</option>').join('');
  const el=h('<div class="form"><div class="newgrid"><div class="f wide"><label for="cEmp">Nombre del negocio</label><input class="fld" id="cEmp" value="'+esc(c.empresa)+'"></div><div class="f"><label for="cRif">RIF</label><input class="fld" id="cRif" value="'+esc(c.rif)+'"></div><div class="f wide"><label for="cDir">Dirección (ticket)</label><input class="fld" id="cDir" value="'+esc(c.dir)+'"></div><div class="f"><label for="cCaj">Cajero</label><input class="fld" id="cCaj" value="'+esc(c.cajero)+'"></div><div class="f"><label for="cCaja">Caja Nº</label><input class="fld" id="cCaja" value="'+esc(c.caja)+'"></div><div class="f"><label for="cRate">Tasa de cambio (Bs. por US$)</label><input class="fld r" id="cRate" inputmode="decimal" value="'+nf(c.rate)+'"></div><div class="f wide"><label for="cTkFont">Tipo de letra en Ticket Térmico 80mm</label><select class="fld" id="cTkFont">'+fontOpts+'</select></div><div class="f"><label for="cTkSize">Tamaño letra Ticket 80mm</label><select class="fld" id="cTkSize"><option value="11"'+(c.ticketSize==='11'?' selected':'')+'>11 px (Compacta)</option><option value="12"'+(c.ticketSize==='12'?' selected':'')+'>12 px (Estándar 80mm)</option><option value="13"'+(c.ticketSize==='13'?' selected':'')+'>13 px (Grande)</option></select></div></div><p class="hint">Cambiar la tasa recalcula al instante los precios en bolívares de la venta en curso. También puede elegir aquí el tipo de letra predeterminado para los recibos de impresora térmica de 80mm.</p></div>');
  openWin({title:'Datos del negocio, tasa y ticket 80mm',w:620,body:el,foot:[{label:'Cancelar'},{label:'Guardar',primary:true,fn:()=>{
    const rate=pn($('#cRate',el).value);
    if(!rate){msg('Escriba una tasa de cambio válida.','bad');return false;}
    c.empresa=$('#cEmp',el).value.trim()||c.empresa;c.rif=$('#cRif',el).value.trim();c.dir=$('#cDir',el).value.trim();
    c.cajero=$('#cCaj',el).value.trim()||c.cajero;c.caja=$('#cCaja',el).value.trim()||c.caja;c.rate=rate;
    c.ticketFont=$('#cTkFont',el).value;c.ticketSize=$('#cTkSize',el).value;
    save();renderAll();msg('Configuración guardada. Tasa: '+nf(rate)+' Bs. por US$.');
  }}],onOpen:()=>{const f=$('#'+(focusId||'cEmp'),el);f.focus();if(f.select)f.select();}});
}
function helpDlg(){
  const rows=[
    ['F1','Control SENIAT/SUDEBAN'],['F2','Nueva venta'],['F3','Ir a código / búsqueda'],['F4','Seleccionar cliente'],['F5','Suspender venta'],['F6','Recuperar venta en espera'],
    ['F7','Descuento'],['F8','Maestro de Inventario'],['F9','Ventas del día y cierre'],['F10','Módulo de Compras'],['F11','Conteo físico masivo'],['F12','Cobrar'],
    ['↑ ↓','Moverse por el catálogo (en la caja de búsqueda) o por la venta'],['+ / −','Sumar o restar una unidad al renglón seleccionado'],
    ['Supr','Quitar el renglón seleccionado'],['3*texto','Agregar 3 unidades del producto buscado'],['Esc','Cerrar ventana o limpiar la búsqueda']
  ];
  openWin({title:'Atajos de teclado',w:540,body:h('<div class="gridwrap" style="flex:none"><table class="grid"><thead><tr><th style="width:90px">Tecla</th><th>Acción</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><b>'+esc(r[0])+'</b></td><td>'+esc(r[1])+'</td></tr>').join('')+'</tbody></table></div>'),foot:[{label:'Cerrar',primary:true}]});
}
function aboutDlg(){
  openWin({title:'Acerca del POS',w:480,body:h('<div class="form"><p style="margin:0"><b>SIFER 360 — Sistema Integral Administrativo y Punto de Venta</b></p><p class="hint">Punto de venta para repuestos, aceites y lubricantes. Incluye facturación multimoneda (US$ / Bs.), IVA 16 %, IGTF 3 %, Módulo de Control SENIAT/SUDEBAN (Libros de Ventas y Compras oficiales, Liquidación Forma 30 IVA, Percepción IGTF, Auditoría cambiaria BCV, Conciliación bancaria POS/Biopago y Generador de TXT de Retenciones), Compras a proveedores, Cuentas por Cobrar (CxC), Cuentas por Pagar (CxP), Ficha Kardex Profesional (CPP) y Conteo Físico de Inventario.</p><p class="hint">Los datos se guardan localmente en este navegador.</p></div>'),foot:[{label:'Cerrar',primary:true}]});
}
function resetAll(){
  ask('Restablecer datos de ejemplo','Se borrarán ventas, compras, CxC, CxP, Kardex, inventario y configuración guardados en este navegador y volverá el ejemplo inicial.','Restablecer',()=>{
    try{localStorage.removeItem(KEY);}catch(e){}
    draftConteo={};seed();saved=false;renderAll();renderCatOptions();msg('Datos de ejemplo restablecidos.');
  });
}


/* ---------- dashboard administrativo + gestión de usuarios/cajas ---------- */
const USERS_STORAGE_KEY='sifer360_access_v1', BOXES_STORAGE_KEY='sifer360_cashboxes';
function activeUser(){
  try{return JSON.parse(sessionStorage.getItem('sifer360_session_v1')||'null')||{};}catch(e){return {};}
}
function cashboxList(){
  let boxes=[];
  try{boxes=JSON.parse(localStorage.getItem(BOXES_STORAGE_KEY)||'[]')||[];}catch(e){}
  const users=window.SIFERAccess&&window.SIFERAccess.getUsers?window.SIFERAccess.getUsers():[];
  const legacy=[String(S.cfg.caja||'01'),...users.map(u=>String(u.cashbox||''))].filter(x=>x&&x!=='—'&&x!=='Todas'&&x!=='SIN-ASIGNAR');
  legacy.forEach(id=>{if(!boxes.some(b=>String(b.id)===id))boxes.push({id,name:/^Caja\s/i.test(id)?id:'Caja '+id,active:true,createdAt:Date.now()});});
  if(!boxes.length)boxes=[{id:'01',name:'Caja 01',active:true,createdAt:Date.now()}];
  boxes=boxes.map(b=>Object.assign({name:'Caja '+b.id,active:true},b));
  localStorage.setItem(BOXES_STORAGE_KEY,JSON.stringify(boxes));
  return boxes;
}
function persistCashboxes(boxes){localStorage.setItem(BOXES_STORAGE_KEY,JSON.stringify(boxes));}
function showPosScreen(){
  const d=$('#adminDashboard'),main=$('.main'),left=$('.left');
  if(d)d.hidden=true;if(left)left.hidden=false;
  if(main)main.classList.remove('dashboard-mode');
  const b=$('#btnDashboard');if(b)b.setAttribute('aria-pressed','false');
  renderHeader();renderAll();
}
function showDashboardScreen(){
  const d=$('#adminDashboard'),main=$('.main'),left=$('.left');
  if(!d||!main)return;
  if(left)left.hidden=true; // Ocultar toda el área de venta; la cabecera y la toolbar están fuera de .main y permanecen visibles.
  d.hidden=false;main.classList.add('dashboard-mode');
  const b=$('#btnDashboard');if(b){b.hidden=activeUser().role!=='admin';b.setAttribute('aria-pressed','true');}
  renderHeader();
  const now=new Date(),today=new Date(now);today.setHours(0,0,0,0);
  const tomorrow=new Date(today.getTime()+86400000),monthStart=new Date(now.getFullYear(),now.getMonth(),1),nextMonth=new Date(now.getFullYear(),now.getMonth()+1,1);
  const sales=(S.sales||[]).filter(x=>!x.void);
  const purchases=(S.purchases||[]).filter(x=>!x.void);
  const stamp=x=>{const n=Number(x.ts||x.timestamp||0);if(n)return n;const parsed=Date.parse(x.date||x.fecha||'');return Number.isFinite(parsed)?parsed:0;};
  const value=x=>Number(x.total||x.totalUsd||x.amount||0);
  const sum=list=>r2(list.reduce((a,x)=>a+value(x),0));
  const todaySales=sales.filter(x=>stamp(x)>=today.getTime()&&stamp(x)<tomorrow.getTime());
  const monthSales=sales.filter(x=>stamp(x)>=monthStart.getTime()&&stamp(x)<nextMonth.getTime());
  const previousDay=sales.filter(x=>stamp(x)>=today.getTime()-86400000&&stamp(x)<today.getTime());
  const todayTotal=sum(todaySales),monthTotal=sum(monthSales),yesterdayTotal=sum(previousDay);
  const change=yesterdayTotal?((todayTotal-yesterdayTotal)/yesterdayTotal)*100:(todayTotal?100:0);
  const fmtPct=n=>(n>0?'+':'')+n.toFixed(1).replace('.',',')+'%';
  const fmtMoney=n=>usd(n);
  const outstanding=list=>r2(list.reduce((a,x)=>a+Math.max(0,Number(x.total||0)-Number(x.paid||0)),0));
  const cxc=(S.cxc||[]).filter(x=>Math.max(0,Number(x.total||0)-Number(x.paid||0))>0.009);
  const cxp=(S.cxp||[]).filter(x=>Math.max(0,Number(x.total||0)-Number(x.paid||0))>0.009);
  const totalCxc=outstanding(cxc),totalCxp=outstanding(cxp);
  const products=S.products||[],low=products.filter(p=>Number(p.stock||0)<=Number(p.min||0)).length;
  const fmtDate=x=>{const t=stamp(x);return t?new Date(t).toLocaleString('es-VE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';};
  const escMoney=x=>esc(fmtMoney(value(x)));
  const latestSales=sales.slice().sort((a,b)=>stamp(b)-stamp(a)).slice(0,5);
  const latestPurchases=purchases.slice().sort((a,b)=>stamp(b)-stamp(a)).slice(0,5);
  const methodTotals={};
  todaySales.forEach(sale=>(sale.pays||[]).forEach(p=>{const name=p.name||p.method||p.id||'Otros';let amount=Number(p.amountUsd??p.amount??p.amountBs??0);if(p.cur==='VES'&&!p.amountUsd&&!p.amountBs)amount=amount/Math.max(1,Number(sale.rate||S.cfg.rate||1));methodTotals[name]=(methodTotals[name]||0)+Math.max(0,amount);}));
  const paymentSlices=Object.entries(methodTotals).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const palette=['#2563eb','#10b981','#f59e0b','#8b5cf6','#ef4444'];
  const grand=paymentSlices.reduce((a,x)=>a+x[1],0);
  let offset=0;
  const gradient=grand?paymentSlices.map(([name,v],i)=>{const start=offset;offset+=v/grand*100;return palette[i%palette.length]+' '+start.toFixed(2)+'% '+offset.toFixed(2)+'%';}).join(', '):'#dbe3ea 0% 100%';
  const pieLegend=paymentSlices.length?paymentSlices.map(([name,v],i)=>'<div class="dash-legend-row"><span class="dash-legend-dot" style="background:'+palette[i%palette.length]+'"></span><span>'+esc(name)+'</span><b>'+fmtMoney(v)+'</b><small>'+((v/grand)*100).toFixed(1).replace('.',',')+'%</small></div>').join(''):'<div class="dash-empty">No hay ventas con métodos de pago registrados hoy.</div>';
  const salesRows=latestSales.length?latestSales.map(x=>'<tr><td>'+esc(fmtDate(x))+'</td><td><b>'+esc(x.ctrlNo||('Venta #'+String(x.no??'—')) )+'</b></td><td>'+esc(x.client?.name||x.clientName||'Cliente general')+'</td><td class="r">'+escMoney(x)+'</td></tr>').join(''):'<tr><td colspan="4" class="dash-empty">Todavía no hay ventas registradas.</td></tr>';
  const purchaseRows=latestPurchases.length?latestPurchases.map(x=>'<tr><td>'+esc(fmtDate(x))+'</td><td><b>'+esc(x.docProv||('Compra #'+String(x.no??'—')) )+'</b></td><td>'+esc(x.supplier?.name||x.supplierName||'Proveedor')+'</td><td class="r">'+escMoney(x)+'</td></tr>').join(''):'<tr><td colspan="4" class="dash-empty">Todavía no hay compras registradas.</td></tr>';
  d.innerHTML='<div class="admin-dash-head"><div><div class="dash-eyebrow">PANEL DE CONTROL · SIFER 360</div><h1>Resumen del negocio</h1><p>Indicadores comerciales y financieros · '+esc(fmtDate({ts:Date.now()}))+'</p></div></div>'+
  '<div class="dash-kpis">'+
  '<article class="dash-kpi"><span class="dash-kpi-icon blue">↗</span><div class="dash-kpi-label">Ventas del día</div><div class="dash-kpi-value">'+fmtMoney(todayTotal)+'</div><div class="dash-kpi-foot '+(change>=0?'positive':'negative')+'">'+fmtPct(change)+' <span>vs. día anterior</span></div></article>'+
  '<article class="dash-kpi"><span class="dash-kpi-icon green">▤</span><div class="dash-kpi-label">Ventas del mes</div><div class="dash-kpi-value">'+fmtMoney(monthTotal)+'</div><div class="dash-kpi-foot">'+monthSales.length+' operaciones este mes</div></article>'+
  '<article class="dash-kpi"><span class="dash-kpi-icon amber">◷</span><div class="dash-kpi-label">Total CxC pendiente</div><div class="dash-kpi-value">'+fmtMoney(totalCxc)+'</div><div class="dash-kpi-foot">'+cxc.length+' documentos con saldo</div></article>'+
  '<article class="dash-kpi"><span class="dash-kpi-icon red">▤</span><div class="dash-kpi-label">Total CxP pendiente</div><div class="dash-kpi-value">'+fmtMoney(totalCxp)+'</div><div class="dash-kpi-foot">'+cxp.length+' obligaciones con saldo</div></article>'+
  '<article class="dash-kpi"><span class="dash-kpi-icon violet">▦</span><div class="dash-kpi-label">Artículos en inventario</div><div class="dash-kpi-value">'+products.length.toLocaleString('es-VE')+'</div><div class="dash-kpi-foot">'+low+' <span>en mínimo o agotados</span></div></article>'+
  '<article class="dash-kpi"><span class="dash-kpi-icon teal">▧</span><div class="dash-kpi-label">Unidades en existencia</div><div class="dash-kpi-value">'+products.reduce((a,p)=>a+Number(p.stock||0),0).toLocaleString('es-VE')+'</div><div class="dash-kpi-foot">Inventario registrado</div></article>'+
  '</div><div class="dash-analytics-grid"><section class="dash-panel"><div class="dash-panel-head"><div><h2>Últimas 5 ventas</h2><p>Operaciones más recientes · montos en US$</p></div><strong>'+sales.length+'</strong></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Fecha</th><th>Documento</th><th>Cliente</th><th class="r">Total</th></tr></thead><tbody>'+salesRows+'</tbody></table></div></section>'+
  '<section class="dash-panel"><div class="dash-panel-head"><div><h2>Últimas 5 compras</h2><p>Entradas más recientes · montos en US$</p></div><strong>'+purchases.length+'</strong></div><div class="dash-table-wrap"><table class="dash-table"><thead><tr><th>Fecha</th><th>Documento</th><th>Proveedor</th><th class="r">Total</th></tr></thead><tbody>'+purchaseRows+'</tbody></table></div></section>'+
  '<section class="dash-panel dash-chart-panel"><div class="dash-panel-head"><div><h2>Ventas de hoy por método de pago</h2><p>Distribución porcentual · vista tipo dona 3D</p></div></div><div class="dash-pie-layout"><div class="dash-pie-3d" style="--pie-gradient:conic-gradient('+gradient+')"><div class="dash-pie-hole"><b>'+fmtMoney(grand)+'</b><small>Total procesado</small></div></div><div class="dash-pie-legend">'+pieLegend+'</div></div></section>'+
  '<section class="dash-panel dash-chart-panel"><div class="dash-panel-head"><div><h2>Resumen financiero</h2><p>Saldos pendientes y actividad</p></div><span class="dash-live-dot">ACTUAL</span></div><div class="dash-status-row"><span>Operaciones del día</span><b>'+todaySales.length+'</b></div><div class="dash-status-row"><span>Ticket promedio</span><b>'+fmtMoney(todaySales.length?todayTotal/todaySales.length:0)+'</b></div><div class="dash-status-row"><span>Ventas de ayer</span><b>'+fmtMoney(yesterdayTotal)+'</b></div><div class="dash-status-row"><span>Saldo total por cobrar</span><b>'+fmtMoney(totalCxc)+'</b></div><div class="dash-status-row"><span>Saldo total por pagar</span><b>'+fmtMoney(totalCxp)+'</b></div></section></div>';
}
function usersManagementDlg(editUsername){
  if(!window.SIFERAccess||!window.SIFERAccess.getUsers){msg('El servicio de usuarios no está disponible.','bad');return;}
  let users=window.SIFERAccess.getUsers(),boxes=cashboxList(),editing=editUsername||'';
  const roleOptions=[['admin','Administrador'],['cajero','Cajero'],['contador','Contador']];
  const el=h('<div class="form user-admin-form"><div class="hint">Cada usuario tiene un perfil y una caja asignada. El administrador puede quedarse sin caja asignada para operar solo desde el dashboard; para vender debe tener una caja creada y asignada.</div><input id="uaOriginal" type="hidden"><div class="newgrid"><div class="f"><label for="uaName">Nombre completo</label><input class="fld" id="uaName" required></div><div class="f"><label for="uaUsername">Usuario</label><input class="fld" id="uaUsername" required autocomplete="off"></div><div class="f"><label for="uaCode">Contraseña / código</label><input class="fld" id="uaCode" type="password" autocomplete="new-password" placeholder="Obligatorio para usuario nuevo"></div><div class="f"><label for="uaRole">Rol</label><select class="fld" id="uaRole">'+roleOptions.map(r=>'<option value="'+r[0]+'">'+r[1]+'</option>').join('')+'</select></div><div class="f"><label for="uaBox">Caja asignada</label><select class="fld" id="uaBox"><option value="">Sin caja asignada</option>'+boxes.filter(b=>b.active!==false).map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+' ('+esc(b.id)+')</option>').join('')+'</select></div></div><div class="row" style="flex-wrap:wrap"><button class="btn primary" id="uaSave">Guardar usuario</button><button class="btn" id="uaClear" type="button">Limpiar</button><span class="hint" id="uaMsg"></span></div><div class="gridwrap" style="max-height:360px;flex:none"><table class="grid"><thead><tr><th>Nombre / usuario</th><th>Rol</th><th>Caja asignada</th><th>Acciones</th></tr></thead><tbody id="uaRows"></tbody></table></div></div>');
  const clear=()=>{editing='';$('#uaOriginal',el).value='';$('#uaName',el).value='';$('#uaUsername',el).value='';$('#uaUsername',el).disabled=false;$('#uaCode',el).value='';$('#uaCode',el).placeholder='Obligatorio para usuario nuevo';$('#uaRole',el).value='cajero';$('#uaBox',el).value=boxes.find(b=>b.active!==false)?.id||'';$('#uaMsg',el).textContent='';};
  const draw=()=>{users=window.SIFERAccess.getUsers();$('#uaRows',el).innerHTML=users.map(u=>'<tr><td><b>'+esc(u.name)+'</b><div class="sub">'+esc(u.username)+'</div></td><td>'+esc((roleOptions.find(r=>r[0]===u.role)||[u.role,u.role])[1])+'</td><td>'+esc(u.cashbox||'—')+'</td><td><button class="btn mini2" data-ua-edit="'+esc(u.username)+'">Editar</button> <button class="btn mini2" data-ua-delete="'+esc(u.username)+'" '+(u.username===activeUser().username||users.filter(x=>x.role==='admin').length<=1&&u.role==='admin'?'disabled':'')+'>Desactivar/eliminar</button></td></tr>').join('');};
  const edit=u=>{editing=u.username;$('#uaOriginal',el).value=u.username;$('#uaName',el).value=u.name||'';$('#uaUsername',el).value=u.username;$('#uaUsername',el).disabled=true;$('#uaCode',el).value='';$('#uaCode',el).placeholder='Vacío = conservar contraseña actual';$('#uaRole',el).value=u.role;$('#uaBox',el).value=u.cashbox&&u.cashbox!=='Todas'?u.cashbox:'';$('#uaMsg',el).textContent='Editando '+u.username;};
  $('#uaSave',el).addEventListener('click',()=>{const name=$('#uaName',el).value.trim(),username=$('#uaUsername',el).value.trim(),code=$('#uaCode',el).value,role=$('#uaRole',el).value,cashbox=$('#uaBox',el).value||'—';if(!name||!username){$('#uaMsg',el).textContent='Nombre y usuario son obligatorios.';return;}users=window.SIFERAccess.getUsers();const idx=users.findIndex(u=>u.username===editing);if(idx<0&&!code){$('#uaMsg',el).textContent='La contraseña/código es obligatorio para crear el usuario.';return;}if(idx<0&&users.some(u=>u.username.toLowerCase()===username.toLowerCase())){$('#uaMsg',el).textContent='Ese nombre de usuario ya existe.';return;}if(role==='cajero'&&cashbox==='—'){$('#uaMsg',el).textContent='Asigne una caja a todo cajero.';return;}if(cashbox!=='—'&&users.some(u=>u.username!==editing&&String(u.cashbox)===String(cashbox))){$('#uaMsg',el).textContent='La caja '+cashbox+' ya está asignada a otro usuario. Cree otra caja o reasigne la existente.';return;}if(idx>=0){users[idx]=Object.assign({},users[idx],{name,role,cashbox});if(code)users[idx].code=code;}else users.push({username,code,name,role,cashbox});if(!window.SIFERAccess.setUsers(users)){$('#uaMsg',el).textContent='No se pudo guardar la lista de usuarios.';return;}if(activeUser().username===username){const sess=Object.assign({},activeUser(),{name,role,cashbox});sessionStorage.setItem('sifer360_session_v1',JSON.stringify(sess));if(role==='admin'&&!cashbox||cashbox==='—'){sessionStorage.removeItem('sifer360_active_box');localStorage.removeItem('sifer360_active_box');}else{const ctx=Object.assign({},JSON.parse(localStorage.getItem('sifer360_active_box')||'{}'),{username,name,role,cashbox});sessionStorage.setItem('sifer360_active_box',JSON.stringify(ctx));localStorage.setItem('sifer360_active_box',JSON.stringify(ctx));}}$('#uaMsg',el).textContent='Usuario guardado correctamente.';clear();draw();showDashboardScreen();});
  $('#uaClear',el).addEventListener('click',clear);
  el.addEventListener('click',e=>{const eb=e.target.closest('[data-ua-edit]'),db=e.target.closest('[data-ua-delete]');if(eb){const u=window.SIFERAccess.getUsers().find(x=>x.username===eb.dataset.uaEdit);if(u)edit(u);}if(db){const u=db.dataset.uaDelete;if(u===activeUser().username){$('#uaMsg',el).textContent='No puedes eliminar el usuario de la sesión actual.';return;}if(!confirm('¿Eliminar el usuario '+u+'?'))return;users=window.SIFERAccess.getUsers();if(users.filter(x=>x.role==='admin').length===1&&users.find(x=>x.username===u)?.role==='admin'){msg('Debe conservarse al menos un administrador.','bad');return;}window.SIFERAccess.setUsers(users.filter(x=>x.username!==u));draw();}});
  clear();draw();
  openWin({title:'Gestión de Usuarios',w:820,body:el,foot:[{label:'Cerrar',primary:true}],onOpen:()=>{if(editing){const u=users.find(x=>x.username===editing);if(u)edit(u);}}});
}
function cashboxesManagementDlg(){
  let boxes=cashboxList();
  const users=()=>window.SIFERAccess&&window.SIFERAccess.getUsers?window.SIFERAccess.getUsers():[];
  const el=h('<div class="form"><div class="hint">Cree cajas independientes y luego asígnelas a los usuarios desde Gestión de Usuarios. No se puede eliminar una caja que tenga usuarios asignados o historial de aperturas; puede deshabilitarla.</div><div class="newgrid"><div class="f"><label for="cbxId">Código de caja</label><input class="fld" id="cbxId" placeholder="02" maxlength="12"></div><div class="f"><label for="cbxName">Nombre visible</label><input class="fld" id="cbxName" placeholder="Caja 02"></div><div class="f"><label>&nbsp;</label><button class="btn primary" id="cbxCreate">Crear caja</button></div></div><div id="cbxMsg" class="hint"></div><div class="gridwrap" style="max-height:420px;flex:none"><table class="grid"><thead><tr><th>Código</th><th>Nombre</th><th>Usuarios asignados</th><th>Estado</th><th>Acción</th></tr></thead><tbody id="cbxRows"></tbody></table></div></div>');
  const draw=()=>{boxes=cashboxList();const us=users();$('#cbxRows',el).innerHTML=boxes.map(b=>{const assigned=us.filter(u=>String(u.cashbox)===String(b.id));const isOpen=(()=>{const a=readActiveOpening();return !!(a&&String(a.cashbox)===String(b.id)&&a.status==='abierta');})();return '<tr><td><b>'+esc(b.id)+'</b></td><td>'+esc(b.name)+'</td><td>'+assigned.map(u=>esc(u.name)).join(', ')+' ('+assigned.length+')</td><td><span class="'+(b.active===false?'dash-warn':'dash-ok')+'">'+(b.active===false?'Deshabilitada':isOpen?'Turno abierto':'Activa')+'</span></td><td><button class="btn mini2" data-cbx-toggle="'+esc(b.id)+'">'+(b.active===false?'Habilitar':'Deshabilitar')+'</button></td></tr>';}).join('');};
  $('#cbxCreate',el).addEventListener('click',()=>{const id=$('#cbxId',el).value.trim(),name=$('#cbxName',el).value.trim()||('Caja '+id);if(!id||! /^[A-Za-z0-9_-]{1,12}$/.test(id)){$('#cbxMsg',el).textContent='Use un código de 1 a 12 caracteres: letras, números, guion o guion bajo.';return;}if(cashboxList().some(b=>String(b.id).toLowerCase()===id.toLowerCase())){$('#cbxMsg',el).textContent='Ya existe una caja con ese código.';return;}boxes=cashboxList();boxes.push({id,name,active:true,createdAt:Date.now()});persistCashboxes(boxes);$('#cbxId',el).value='';$('#cbxName',el).value='';$('#cbxMsg',el).textContent='Caja creada. Ahora puede asignarla en Gestión de Usuarios.';draw();});
  el.addEventListener('click',e=>{const b=e.target.closest('[data-cbx-toggle]');if(!b)return;boxes=cashboxList();const box=boxes.find(x=>String(x.id)===b.dataset.cbxToggle);if(!box)return;const assigned=users().filter(u=>String(u.cashbox)===String(box.id));const active=readActiveOpening();if(box.active!==false&&assigned.length){$('#cbxMsg',el).textContent='No se puede deshabilitar: está asignada a '+assigned.map(u=>u.name).join(', ')+'. Reasigne primero esos usuarios.';return;}if(box.active!==false&&active&&String(active.cashbox)===String(box.id)&&active.status==='abierta'){ $('#cbxMsg',el).textContent='No se puede deshabilitar una caja con turno abierto. Cierre primero el Corte Z.';return;}box.active=box.active===false;persistCashboxes(boxes);draw();});
  draw();openWin({title:'Gestión de Cajas',w:760,body:el,foot:[{label:'Cerrar',primary:true}]});
}

function adminCajaRequiredDlg(moduleName){
  const user=activeUser(),box=currentCaja(),assigned=box!=='SIN-ASIGNAR',active=readActiveOpening();
  const opened=!!(active&&active.status==='abierta'&&String(active.cashbox)===box);
  const body=h('<div class="form"><div style="font-size:34px;margin-bottom:8px">▣</div><h3 style="margin:0 0 8px">Para acceder a '+esc(moduleName)+' debes tener una caja abierta</h3><p class="hint">El flujo obligatorio es: crear una caja si aún no existe, asignártela en Gestión de Usuarios y abrir el turno desde el botón POS de la barra superior. El módulo Corte Z ya no abre turnos.</p><div class="gridwrap"><table class="grid"><tbody><tr><td>Usuario</td><td><b>'+esc(user.name||user.username||'Administrador')+'</b></td></tr><tr><td>Caja asignada</td><td><b>'+esc(assigned?box:'Ninguna')+'</b></td></tr><tr><td>Estado del turno</td><td><b>'+esc(opened?'Abierto':'No abierto')+'</b></td></tr></tbody></table></div><p class="hint">'+(assigned?(opened?'La caja ya está abierta; puedes volver al POS y continuar.':'Pulsa “Abrir caja (POS)” para registrar el fondo inicial.'):'Primero crea una caja en Gestión de Cajas y asígnatela en Gestión de Usuarios. Después abre la caja desde POS.')+'</p></div>');
  const foot=[];
  if(!assigned){foot.push({label:'Gestión de Cajas',fn:()=>{cashboxesManagementDlg();return false;}});foot.push({label:'Gestión de Usuarios',fn:()=>{usersManagementDlg(user.username);return false;}});}
  foot.push({label:'Abrir caja (POS)',primary:true,fn:()=>{closeWin();openCashboxDlg();return false;}});
  foot.push({label:'Cerrar'});
  openWin({title:'Apertura obligatoria de caja',w:540,body,foot});
}
function openCashboxDlg(){
  const user=activeUser();
  if(!user||user.role!=='admin'){showPosScreen();return;}
  if(currentCaja()==='SIN-ASIGNAR'){adminCajaRequiredDlg('Punto de venta');return;}
  const box=currentCaja(),boxes=cashboxList(),boxMeta=boxes.find(b=>String(b.id)===box);
  if(!boxMeta||boxMeta.active===false){msg('La caja asignada no existe o está deshabilitada. Revise Gestión de Cajas y Gestión de Usuarios.','bad');return;}
  const existing=readActiveOpening();
  if(existing&&existing.status==='abierta'&&String(existing.cashbox)===box){
    openWin({title:'Caja ya abierta · '+box,w:430,body:h('<div class="form"><h3>El turno ya está abierto</h3><p class="hint">Caja '+esc(box)+' · Apertura '+esc(fmtDT(existing.openedAt))+'</p><p>Para hacer el arqueo y cerrar la jornada, entra a Corte Z.</p></div>'),foot:[{label:'Ir al POS',primary:true,fn:()=>{showPosScreen();return true;}},{label:'Cerrar'}]});return;
  }
  const body=h('<div class="form"><div class="hint">Registra y confirma los fondos físicos reales antes de vender. La apertura se asociará exclusivamente al usuario y a la caja asignada.</div><div class="newgrid"><div class="f"><label>Administrador</label><input class="fld" value="'+esc(user.name||user.username)+'" readonly></div><div class="f"><label>Caja asignada</label><input class="fld" value="'+esc(boxMeta.name+' ('+box+')')+'" readonly></div><div class="f"><label for="posOpenBs">Fondo inicial en Bs.</label><input class="fld r" id="posOpenBs" value="0,00" inputmode="decimal"></div><div class="f"><label for="posOpenUsd">Fondo inicial en US$</label><input class="fld r" id="posOpenUsd" value="0,00" inputmode="decimal"></div><div class="f"><label for="posOpenRate">Tasa BCV (Bs./US$)</label><input class="fld r" id="posOpenRate" value="'+esc(nf(Number(S.cfg.rate)||0))+'" inputmode="decimal"></div></div><div class="hint" id="posOpenError" role="status"></div></div>');
  openWin({title:'POS · Apertura de caja '+box,w:560,body,foot:[{label:'Cancelar'},{label:'Confirmar apertura e ingresar al POS',primary:true,fn:()=>{
    const parse=v=>{const raw=String(v||'').trim().replace(/\s/g,'').replace(/\./g,'').replace(',','.');const n=Number(raw);return Number.isFinite(n)&&n>=0?n:null;};
    const bs=parse($('#posOpenBs',body).value),usd=parse($('#posOpenUsd',body).value),rate=parse($('#posOpenRate',body).value);
    if(bs===null||usd===null||rate===null||rate<=0){$('#posOpenError',body).textContent='Ingrese fondos válidos y una tasa BCV mayor que cero.';return false;}
    const all=(()=>{try{return JSON.parse(localStorage.getItem('sifer360_openings')||'[]')||[];}catch(e){return [];}})();
    const openedAt=new Date().toISOString(),op={id:'OPEN-'+Date.now(),invoiceStart:'FAC-'+String(currentCajaInvoice()).padStart(8,'0'),cashier:user.name||user.username,username:user.username,cashbox:box,bs,usd,rate,openedAt,status:'abierta'};
    all.push(op);localStorage.setItem('sifer360_openings',JSON.stringify(all));localStorage.setItem('sifer360_bcv_rate',String(rate));
    const context={username:user.username,name:user.name||user.username,role:user.role,cashbox:box,openingId:op.id,openedAt,bs,usd,rate,status:'abierta'};
    sessionStorage.setItem('sifer360_active_box',JSON.stringify(context));localStorage.setItem('sifer360_active_box',JSON.stringify(context));sessionStorage.setItem('sifer360_active_opening',JSON.stringify(op));localStorage.setItem('sifer360_active_opening',JSON.stringify(op));S.cfg.rate=rate;save();
    showPosScreen();msg('Apertura de caja '+box+' registrada. Ya puedes operar en el POS.','ok');return true;
  }}]});
}

function addAdminToolbarItems(){
  if(!TB.some(t=>Array.isArray(t)&&t[0]==='pos')){const idx=TB.findIndex(t=>Array.isArray(t)&&t[0]==='usuarios');TB.splice(idx<0?TB.length:idx,0,['pos','POS','',openCashboxDlg],['usuarios','Usuarios','',usersManagementDlg],['cajas','Gestión cajas','',cashboxesManagementDlg],'-');}
}
window.SIFERDashboard={show:showDashboardScreen,showPos:showPosScreen,refresh:showDashboardScreen};

/* ---------- menús y barra de herramientas ---------- */
const focusEntry=()=>$('#entry').focus();
const MENUS={
 'Archivo':[['Dashboard','',showDashboardScreen],['Abrir caja (POS)','',openCashboxDlg],['Nueva venta','F2',newSale],['Suspender venta','F5',suspend],['Recuperar venta','F6',recoverDlg],'-',['Ventas del día y cierre…','F9',salesDlg],'-',['Gestión de usuarios','',usersManagementDlg],['Gestión de cajas','',cashboxesManagementDlg],['Cerrar sesión','',()=>window.SIFERAccess&&window.SIFERAccess.logout()],'-',['Restablecer datos de ejemplo…','',resetAll]],
 'Ventas':[['Cobrar','F12',payDlg],['Módulo de Pagos CASHEA (BNPL)…','',()=>casheaDlg()],['Descuento…','F7',discountDlg],['Quitar renglón','Supr',removeSel],['Vaciar venta…','',clearCart],'-',['Cuentas por Cobrar (CxC)…','',()=>cxcDlg()]],
 'Compras':[['Registrar compra de mercancía…','F10',()=>comprasDlg('new')],['Historial de compras…','',()=>comprasDlg('hist')],['Directorio de proveedores…','',()=>comprasDlg('sup')],'-',['Cuentas por Pagar (CxP)…','',()=>cxpDlg()]],
  'Inventario':[['Maestro de inventario…','F8',inventoryDlg],['Nuevo producto (Ficha avanzada)…','',()=>productFormDlg(null)],['Generador de etiquetas / Hablador SKU (US$)…','',()=>labelGeneratorDlg()],'-',['Conteo físico de inventario (masivo)…','F11',()=>conteoDlg()],['Ficha / Tarjeta Kardex Profesional…','',()=>kardexDlg()],'-',['Buscar producto','F3',focusEntry]],
 'Finanzas':[['Cuentas por Cobrar (CxC)…','',()=>cxcDlg()],['Cuentas por Pagar (CxP)…','',()=>cxpDlg()],['Operaciones Cambiarias (Compra USD / Zelle)…','',()=>divisasDlg()],['Conciliación CASHEA (BNPL y Cuotas)…','',()=>casheaDlg()],'-',['Ventas del día y cierre de caja…','F9',salesDlg]],
 'Control SENIAT/SUDEBAN':[
   ['Módulo Fiscal Integral…','',()=>seniatSudebanDlg()],
   ['Libro de Ventas Fiscal (SENIAT)…','',()=>seniatSudebanDlg('ventas')],
   ['Libro de Compras Fiscal (Forma 30)…','',()=>seniatSudebanDlg('compras')],
   ['Percepción y Retenciones de IGTF (3%)…','',()=>seniatSudebanDlg('igtf')],
   ['Auditoría de Ventas y Tasa BCV…','',()=>seniatSudebanDlg('auditoria')],
   ['Conciliación Puntos de Venta (SUDEBAN)…','',()=>seniatSudebanDlg('sudeban')],
   ['Retenciones IVA y Archivo TXT SENIAT…','',()=>seniatSudebanDlg('retenciones')],
   ['Trazabilidad Cambiaria (Compra USD / Zelle)…','',()=>divisasDlg()],
   '-',
   ['Parámetros Fiscales y Talonarios…','',()=>seniatSudebanDlg('config')]
 ],
 'Clientes':[['Seleccionar cliente…','F4',clientDlg],['Estado de cuentas por cobrar…','',()=>cxcDlg()]],
 'Configuración':[['Datos del negocio y tasa…','',()=>cfgDlg()]],
 'Ayuda':[['Atajos de teclado…','',helpDlg],['Acerca del POS…','',aboutDlg]]
};
let menuEl=null;
function closeMenu(){if(menuEl){menuEl.remove();menuEl=null;}const b=$('#btnMenu');if(b){b.classList.remove('open');b.setAttribute('aria-expanded','false');}}
function openMenu(){
  const btn=$('#btnMenu');if(!btn)return;
  closeMenu();btn.classList.add('open');btn.setAttribute('aria-expanded','true');
  const m=document.createElement('div');m.className='menu';m.setAttribute('role','menu');
  Object.keys(MENUS).forEach(name=>{
    const g=document.createElement('div');g.className='mhead';g.textContent=name;m.appendChild(g);
    MENUS[name].forEach(it=>{
      if(it==='-')return;
      const b=h('<button class="mi" role="menuitem"><span>'+esc(it[0])+'</span><kbd>'+esc(it[1])+'</kbd></button>');
      b.addEventListener('click',()=>{closeMenu();it[2]();});
      m.appendChild(b);
    });
  });
  document.body.appendChild(m);
  const r=btn.getBoundingClientRect();
  m.style.left=Math.max(8,Math.min(r.right-m.offsetWidth,window.innerWidth-m.offsetWidth-8))+'px';
  m.style.top=(r.bottom+6)+'px';
  menuEl=m;
  const first=$('.mi',m);if(first)first.focus();
}

/* ---------- control de caja por sesión y corte Z persistente ---------- */
function cajaContext(){
  try{return JSON.parse(sessionStorage.getItem('sifer360_active_box')||localStorage.getItem('sifer360_active_box')||'null')||{};}catch(e){return {};}
}
function currentCaja(){
  const c=cajaContext(),session=activeUser();
  if((c.role==='admin'||session.role==='admin')&&(!c.cashbox||c.cashbox==='Todas'||c.cashbox==='—'||c.cashbox==='SIN-ASIGNAR'))return 'SIN-ASIGNAR';
  return String(!c.cashbox||c.cashbox==='Todas'?(S.cfg.caja||'01'):c.cashbox);
}
function currentCajero(){
  const c=cajaContext();
  return String(c.name||S.cfg.cajero||'Cajero');
}
function cajaSeqs(){
  try{return JSON.parse(localStorage.getItem('sifer360_box_sequences')||'{}')||{};}catch(e){return {};}
}
function currentCajaInvoice(){const box=currentCaja(),seqs=cajaSeqs();if(!seqs[box])seqs[box]={invoice:1,void:1,refund:1,cxc:1,movement:1,z:1};return Number(seqs[box].invoice)||1;}
function nextCajaInvoice(){
  const box=currentCaja(),seqs=cajaSeqs();
  if(!seqs[box])seqs[box]={invoice:1,void:1,refund:1,cxc:1,movement:1};
  const no=Number(seqs[box].invoice)||1;
  seqs[box].invoice=no+1;localStorage.setItem('sifer360_box_sequences',JSON.stringify(seqs));
  return no;
}
function getZHistory(){
  if(!Array.isArray(S.cortesZ))S.cortesZ=[];
  return S.cortesZ;
}
function moneyTotal(rows,fn){
  return r2(rows.reduce((a,x)=>a+fn(x),0));
}
function zPayTotals(sales){
  const out={};
  sales.forEach(s=>(s.pays||[]).forEach(p=>{
    const k=(p.name||p.id||'Otro')+' ('+(p.cur||'USD')+')';
    out[k]=(out[k]||0)+Number(p.amount||0);
  }));
  return out;
}
function zOperationalTotals(sales,start,end,box){
  const inPeriod=ts=>Number(ts)>=Number(start)&&Number(ts)<=Number(end);
  const out={cxcUsd:0,cxcBs:0,casheaUsd:0,creditSalesUsd:0,cashInUsd:0,cashOutUsd:0,cashInBs:0,cashOutBs:0,movementCount:0};
  (S.cxc||[]).forEach(item=>{
    if(item.cashbox&&String(item.cashbox)!==String(box))return;
    (item.payments||[]).forEach(p=>{if(inPeriod(p.ts)){out.cxcUsd=r2(out.cxcUsd+Number(p.amountUsd||0));out.cxcBs=r2(out.cxcBs+Number(p.amountBs||0));}});
  });
  sales.filter(s=>!s.void).forEach(s=>(s.pays||[]).forEach(p=>{if(p.id==='credito')out.creditSalesUsd=r2(out.creditSalesUsd+Number(p.amount||0));}));
  const saleNos=new Set(sales.filter(s=>!s.void&&String(s.cashbox||box)===String(box)).map(s=>String(s.no)));
  (S.casheaLiquidaciones||[]).forEach(lot=>{
    if(lot.tipo==='REVERSIÓN'||lot.estado==='Revertido'||!inPeriod(lot.fecha))return;
    const ops=Array.isArray(lot.operaciones)?lot.operaciones:[];
    if((S.casheaMovimientos||[]).some(m=>ops.includes(m.id)&&saleNos.has(String(m.ventaNo))))out.casheaUsd=r2(out.casheaUsd+Number(lot.depositadoUsd||0));
  });
  (S.movimientosCaja||[]).forEach(m=>{
    if(String(m.cashbox||box)!==String(box)||!inPeriod(m.ts))return;
    const currency=m.currency==='USD'?'Usd':'Bs',direction=m.direction==='IN'?'In':'Out',key='cash'+direction+currency;
    out[key]=r2(out[key]+Math.max(0,Number(m.amount||0)));out.movementCount++;
  });
  return out;
}
function readActiveOpening(){
  try{
    const sessionValue=JSON.parse(sessionStorage.getItem('sifer360_active_opening')||'null');
    if(sessionValue&&sessionValue.status==='abierta')return sessionValue;
    const localValue=JSON.parse(localStorage.getItem('sifer360_active_opening')||'null');
    return localValue||sessionValue||null;
  }catch(e){return null;}
}
function writeActiveOpening(opening){
  const value=JSON.stringify(opening);
  localStorage.setItem('sifer360_active_opening',value);
  sessionStorage.setItem('sifer360_active_opening',value);
}
function zExpectedByMethod(sales,opening){
  const out={};
  METHODS.forEach(m=>out[m.id]=0);
  out.efBs=Number(opening&&opening.bs||0);
  out.efUSD=Number(opening&&opening.usd||0);
  sales.forEach(s=>{
    (s.pays||[]).forEach(p=>{
      if(Object.prototype.hasOwnProperty.call(out,p.id))out[p.id]+=Number(p.amount||0);
    });
    const change=Math.max(0,Number(s.change||0));
    if(change>0){
      const rate=Number(s.rate||S.cfg.rate||1)||1;
      const cashUsd=(s.pays||[]).filter(p=>p.id==='efUSD').reduce((a,p)=>a+Number(p.amount||0),0);
      const cashBs=(s.pays||[]).filter(p=>p.id==='efBs').reduce((a,p)=>a+Number(p.amount||0),0);
      const usdEquivalent=cashUsd+cashBs/rate;
      if(usdEquivalent>0){
        const usdChange=change*(cashUsd/usdEquivalent);
        const bsChange=change*(cashBs/rate/usdEquivalent)*rate;
        out.efUSD-=usdChange;
        out.efBs-=bsChange;
      }
    }
  });
  (S.movimientosCaja||[]).forEach(m=>{
    if(String(m.cashbox||opening.cashbox||'')!==String(opening.cashbox||m.cashbox||'')||Number(m.ts)<Number(opening.openedAt||0))return;
    const key=m.currency==='USD'?'efUSD':(m.currency==='BS'?'efBs':null);
    if(!key)return;
    const amount=Math.max(0,Number(m.amount||0));
    out[key]+=m.direction==='IN'?amount:-amount;
  });
  Object.keys(out).forEach(k=>out[k]=r2(k==='efBs'||k==='efUSD'?out[k]:Math.max(0,out[k])));
  return out;
}
function zDiffStatus(rows){
  const diffs=rows.map(r=>Number(r.diff||0));
  const hasShort=diffs.some(d=>d<-.009);
  const hasOver=diffs.some(d=>d>.009);
  if(!hasShort&&!hasOver)return 'CONCILIADO · CUADRA';
  if(hasShort&&hasOver)return 'CON DIFERENCIAS · FALTANTES Y SOBRANTES';
  return hasShort?'FALTANTE':'SOBRANTE';
}
function printCorteZ(z,autoPrint){
  const w=window.open('','_blank','width=420,height=800');
  if(!w){msg('Permite ventanas emergentes para mostrar o imprimir el Corte Z.','bad');return;}
  const line=(a,b)=>'<div class="zr"><span>'+esc(a)+'</span><b>'+esc(b==null?'—':String(b))+'</b></div>';
  const reconciliation=Array.isArray(z.reconciliation)?z.reconciliation:[];
  const recHtml=reconciliation.map(r=>'<div class="zrec"><b>'+esc(r.name)+' ('+esc(r.cur)+')</b><div class="zrecvals"><span>Sist. '+esc(nf(r.system))+'</span><span>Real '+esc(r.real==null?'—':nf(r.real))+'</span><b>Dif. '+esc(r.diff==null?'—':(r.diff>0?'+':'')+nf(r.diff))+'</b></div></div>').join('');
  const notes=z.observations?line('Observaciones',z.observations):'';
  const html='<div class="zpaper"><center><b>'+esc(S.cfg.empresa||'SIFER 360')+'</b><br>REPORTE Z · CIERRE DE CAJA<br><small>REPORTE DE CONTROL INTERNO · NO FISCAL</small></center><hr>'+
    line('Corte Z',z.id)+line('Fecha',fmtDT(z.closedAt))+line('Caja',z.cashbox)+line('Cajero',z.cashier)+line('Desde',z.openedAt?fmtDT(z.openedAt):'—')+line('Desde factura',z.invoiceFrom||'—')+line('Hasta factura',z.invoiceTo||'—')+
    '<hr><b>RESUMEN DE VENTAS</b>'+line('Facturas válidas',String(z.salesCount))+line('Anulaciones',String(z.voidCount))+line('Ventas netas USD',usd(z.netUsd))+line('Ventas netas Bs.',bsf(z.netBs))+line('IVA USD',usd(z.ivaUsd))+line('IGTF USD',usd(z.igtfUsd))+
    '<hr><b>RESUMEN DE COBROS Y CRÉDITOS</b>'+line('Cobros de CxC recibidos',usd(z.detailTotals&&z.detailTotals.cxcUsd||0)+' / '+bsf(z.detailTotals&&z.detailTotals.cxcBs||0))+line('Depósitos Cashea recibidos',usd(z.detailTotals&&z.detailTotals.casheaUsd||0))+line('Ventas a crédito generadas (CxC)',usd(z.detailTotals&&z.detailTotals.creditSalesUsd||0))+
    '<hr><b>TOTALES COBRADOS · POR MÉTODO</b>'+(Object.keys(z.payments||{}).length?Object.entries(z.payments).map(([name,amount])=>line(name,name.includes('(VES)')?bsf(amount):usd(amount))).join(''):'<div class="zrec">No hay cobros registrados por método en este corte.</div>')+'<hr><b>ARQUEO DE CAJA · POR MÉTODO</b><div class="zrec-head"><b>SISTEMA</b> / <b>REAL CONTADO O CONCILIADO</b> / <b>DIFERENCIA</b></div>'+(recHtml||'<div class="zrec">Este Corte Z no contiene detalle de arqueo por método.</div>')+
    '<hr><b>RESULTADO DEL ARQUEO</b>'+line('Estado de conciliación',z.reconciliationStatus||(reconciliation.length?zDiffStatus(reconciliation):'SIN ARQUEO DETALLADO · CORTE ANTERIOR'))+line('Faltante USD',usd(z.shortageUsd||0))+line('Sobrante USD',usd(z.surplusUsd||0))+line('Faltante Bs.',bsf(z.shortageBs||0))+line('Sobrante Bs.',bsf(z.surplusBs||0))+
    '<hr><b>MOVIMIENTOS DE EFECTIVO FÍSICO</b>'+line('Entradas efectivo USD (+)',usd(z.detailTotals&&z.detailTotals.cashInUsd||0))+line('Salidas efectivo USD (−)',usd(z.detailTotals&&z.detailTotals.cashOutUsd||0))+line('Entradas efectivo Bs. (+)',bsf(z.detailTotals&&z.detailTotals.cashInBs||0))+line('Salidas efectivo Bs. (−)',bsf(z.detailTotals&&z.detailTotals.cashOutBs||0))+line('Cantidad de movimientos',String(z.detailTotals&&z.detailTotals.movementCount||0))+notes+
    '<hr>'+line('Operador',z.cashier)+line('Generado',new Date(z.closedAt).toLocaleString('es-VE'))+'<hr><center>Conserve este reporte para auditoría interna.<br>La impresión no sustituye una factura fiscal ni registra una operación directamente en una impresora fiscal.</center></div>';
  const printScript=autoPrint?'window.onload=()=>{window.focus();window.print()}':'window.onload=()=>window.focus()';
  const previewToolbar='<div class="zpreview-tools"><b>Vista previa de impresión · Térmica 80 mm</b><button type="button" onclick="window.print()">Imprimir 80 mm</button><button type="button" onclick="window.close()">Cerrar vista previa</button></div>';
  const previewCss='.zpreview-tools{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:10px;background:#f1f5f9;border-bottom:1px solid #cbd5e1;font:13px Arial,sans-serif}.zpreview-tools button{padding:8px 12px;cursor:pointer;border:1px solid #64748b;border-radius:5px;background:#fff;font-weight:600}';
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+esc(z.id)+'</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>@page{size:80mm auto;margin:3mm}*{box-sizing:border-box}body{margin:0;color:#000;font:10px/1.3 "Courier New",monospace}.zpaper{width:74mm;margin:auto}.zr{display:flex;justify-content:space-between;align-items:flex-start;gap:5px;margin:3px 0}.zr span{max-width:48mm;overflow-wrap:anywhere}.zr b{text-align:right;overflow-wrap:anywhere}.zrec{margin:5px 0;border-bottom:1px dotted #777;padding-bottom:4px}.zrecvals{display:flex;justify-content:space-between;gap:3px;font-size:9px;flex-wrap:wrap}.zrec-head{font-size:9px;margin:4px 0}hr{border:0;border-top:1px dashed #333;margin:7px 0}center{line-height:1.5}small{font-size:8px}'+previewCss+'@media print{body{width:74mm}.zpreview-tools{display:none!important}}</style></head><body>'+(autoPrint?'':previewToolbar)+html+'<script>'+printScript+'<\/script></body></html>');
  w.document.close();
}
function corteZDlg(){
  const login=activeUser(),openingNow=readActiveOpening();
  if(login.role==='admin'&&currentCaja()==='SIN-ASIGNAR'){adminCajaRequiredDlg('Corte Z');return;}
  if(!openingNow||openingNow.status!=='abierta'||String(openingNow.cashbox)!==currentCaja()){adminCajaRequiredDlg('Corte Z');return;}
  let active=readActiveOpening();
  const box=currentCaja();
  const boxOpen=()=>!!(active&&String(active.cashbox)===box&&active.status==='abierta');
  const shiftStart=()=>active&&active.openedAt?new Date(active.openedAt).getTime():Date.now();
  const el=h('<div class="form"><div class="hint" id="zIntro">Arqueo previo obligatorio: compare el saldo que registra el sistema con el importe real de cada método. La diferencia se calcula como Real − Sistema. El cierre guarda una fotografía inalterable del turno y después permite imprimir el reporte térmico de 80 mm.</div>'+
    '<section id="zOpenPanel" hidden style="border:1px solid var(--lo);padding:10px;margin:8px 0;border-radius:6px"><b>Apertura de turno / fondo inicial</b><p class="hint">Si esta caja todavía no tiene un turno abierto, registre el fondo inicial antes de realizar el arqueo.</p><div class="row"><label>Fondo inicial Bs. <input class="fld r" id="zOpeningBs" value="0,00" inputmode="decimal" style="width:125px"></label><label>Fondo inicial US$ <input class="fld r" id="zOpeningUsd" value="0,00" inputmode="decimal" style="width:125px"></label><button class="btn primary" id="zOpenShift">Abrir turno</button></div><div class="hint" id="zOpenStatus"></div></section>'+
    '<div class="gridwrap"><table class="grid"><thead><tr><th>Resumen del turno</th><th class="r">Total</th></tr></thead><tbody id="zSummary"></tbody></table></div>'+
    '<section id="zArqueoPanel" style="border:2px solid var(--ac);padding:12px;margin:10px 0;border-radius:8px"><h3 style="margin:0 0 6px">ARQUEO PREVIO POR MÉTODO DE PAGO</h3><p class="hint" style="margin:4px 0 10px">Este formulario es obligatorio para el Corte Z. Abra el turno primero; luego escriba el monto real contado o conciliado en cada método. Si no tuvo movimientos, escriba 0,00. La diferencia se calcula automáticamente.</p><div class="gridwrap"><table class="grid" style="min-width:660px"><thead><tr><th>Método de pago</th><th>Moneda</th><th class="r">Saldo en sistema</th><th class="r">Monto real contado / conciliado</th><th class="r">Dif. (+/−)</th></tr></thead><tbody id="zReconcile"></tbody><tfoot id="zReconcileFoot"></tfoot></table></div><div class="gridwrap"><table class="grid"><thead><tr><th>Totales de arqueo</th><th class="r">US$</th><th class="r">Bs.</th></tr></thead><tbody id="zTotals"></tbody></table></div></section>'+
    '<section style="border:1px solid var(--lo);padding:10px;margin:8px 0;border-radius:6px"><b>Movimientos de efectivo físico (+ / −)</b><div class="row" style="flex-wrap:wrap"><label>Tipo <select class="fld" id="zMovDir"><option value="IN">Entrada (+)</option><option value="OUT">Salida (−)</option></select></label><label>Moneda <select class="fld" id="zMovCur"><option value="BS">Efectivo Bs.</option><option value="USD">Efectivo USD</option></select></label><label>Monto <input class="fld r" id="zMovAmount" inputmode="decimal" placeholder="0,00" style="width:110px"></label><label>Motivo <input class="fld" id="zMovReason" maxlength="160" placeholder="Ej. retiro para sencillo" style="min-width:190px"></label><button class="btn" id="zMovAdd">Registrar movimiento</button></div><div class="hint" id="zMovStatus">Registre entradas o salidas de efectivo físico para que aparezcan en el cierre.</div><div id="zMovRows"></div></section>'+
    '<label for="zObservations">Observaciones del cierre</label><textarea class="fld" id="zObservations" rows="2" placeholder="Explique faltantes, sobrantes, depósitos pendientes o incidencias."></textarea>'+
    '<div class="row" style="margin:10px 0;gap:8px;flex-wrap:wrap"><button class="btn" id="zPreview">Vista previa del reporte Z · 80 mm</button><button class="btn primary" id="zClose">Confirmar cierre e imprimir</button></div><div class="hint" id="zActionStatus" role="status" aria-live="polite">Abra el turno y complete el arqueo para habilitar el cierre.</div>'+
    '<p class="hint">El botón de impresión abre el diálogo del sistema para seleccionar una impresora térmica de 80 mm. Este reporte es no fiscal; una impresora fiscal requiere su integración/controlador homologado para emitir documentos fiscales.</p>'+
    '<h3>Historial de Cortes Z</h3><div class="gridwrap"><table class="grid" style="min-width:560px"><thead><tr><th>Corte</th><th>Fecha</th><th>Cajero</th><th class="r">Ventas USD</th><th>Resultado</th><th>Acciones</th></tr></thead><tbody id="zHistory"></tbody></table></div></div>');
  const getPeriodSales=()=>S.sales.filter(s=>String(s.cashbox||box)===box&&Number(s.ts)>=shiftStart());
  const getRows=()=>{
    const sales=getPeriodSales().filter(s=>!s.void);
    const expected=zExpectedByMethod(sales,active||{});
    return METHODS.map(m=>({id:m.id,name:m.name,cur:m.cur,system:r2(expected[m.id]||0)}));
  };
  const readReal=()=>{
    const out={};
    $$('#zReconcile [data-z-real]',el).forEach(input=>{out[input.dataset.zReal]=pnZero(input.value);});
    return out;
  };
  const calculate=()=>{
    const rows=getRows(),real=readReal();
    const rec=rows.map(r=>Object.assign({},r,{real:real[r.id],diff:real[r.id]===null||real[r.id]===undefined?null:r2(real[r.id]-r.system)}));
    const total={shortageUsd:0,surplusUsd:0,shortageBs:0,surplusBs:0,complete:rec.every(r=>r.diff!==null)};
    rec.forEach(r=>{
      if(r.diff===null)return;
      const short=Math.max(0,-r.diff),over=Math.max(0,r.diff);
      if(r.cur==='USD'){total.shortageUsd=r2(total.shortageUsd+short);total.surplusUsd=r2(total.surplusUsd+over);}
      else{total.shortageBs=r2(total.shortageBs+short);total.surplusBs=r2(total.surplusBs+over);}
    });
    total.status=!total.complete?'PENDIENTE DE COMPLETAR ARQUEO':zDiffStatus(rec);
    return {rec,total};
  };
  const updateTotals=()=>{
    const result=calculate(),t=result.total;
    $('#zReconcileFoot',el).innerHTML='<tr><th colspan="2">Balance</th><th class="r">—</th><th class="r">Montos reales</th><th class="r">'+(t.complete?esc(t.status):'Pendiente')+'</th></tr>';
    $('#zTotals',el).innerHTML=[
      ['Faltante',usd(t.shortageUsd),bsf(t.shortageBs)],
      ['Sobrante',usd(t.surplusUsd),bsf(t.surplusBs)],
      ['Estado',t.status,'']
    ].map(r=>'<tr><td>'+esc(r[0])+'</td><td class="r"><b>'+esc(r[1])+'</b></td><td class="r"><b>'+esc(r[2])+'</b></td></tr>').join('');
    return result;
  };
  const draw=()=>{
    active=readActiveOpening();
    const opened=boxOpen();
    $('#zOpenStatus',el).textContent=opened?'Turno abierto desde '+fmtDT(active.openedAt)+' · Caja '+box+' · '+String(active.cashier||currentCajero()):'No hay un turno abierto para esta caja. Registre el fondo inicial y pulse Abrir turno.';
    $('#zOpenPanel',el).hidden=opened;
    $('#zIntro',el).textContent=opened?'La apertura de caja ya está registrada. Se reutiliza el turno iniciado al entrar al POS; no debe abrir otro turno aquí. Complete el arqueo real de los 8 métodos, revise la vista previa de 80 mm y luego confirme el cierre.':'No se detectó una apertura válida para esta caja. Registre el fondo inicial aquí solo si no se hizo al iniciar sesión. El arqueo por los 8 métodos seguirá siendo obligatorio antes del cierre.';
    $('#zOpenPanel',el).style.opacity='1';
    $('#zOpenShift',el).disabled=opened;
    $('#zOpeningBs',el).disabled=opened;
    $('#zOpeningUsd',el).disabled=opened;
    const period=getPeriodSales(),validSales=period.filter(s=>!s.void),voidSales=period.filter(s=>s.void);
    $('#zSummary',el).innerHTML=[['Facturas válidas',String(validSales.length)],['Anulaciones',String(voidSales.length)],['Ventas netas USD',usd(moneyTotal(validSales,s=>Number(s.total||0)))],['Ventas netas Bs.',bsf(moneyTotal(validSales,s=>Number(s.total||0)*Number(s.rate||S.cfg.rate||0)))],['IVA USD',usd(moneyTotal(validSales,s=>Number(s.iva||0)))],['IGTF USD',usd(moneyTotal(validSales,s=>Number(s.igtf||0)))]] .map(r=>'<tr><td>'+esc(r[0])+'</td><td class="r"><b>'+esc(r[1])+'</b></td></tr>').join('');
    const oldReal=readReal();
    const movements=(S.movimientosCaja||[]).filter(m=>String(m.cashbox||box)===String(box)&&Number(m.ts)>=shiftStart()&&Number(m.ts)<=Date.now()).sort((a,b)=>Number(b.ts)-Number(a.ts));
    $('#zMovRows',el).innerHTML=movements.length?'<div class="gridwrap"><table class="grid"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Motivo</th><th class="r">Monto</th><th>Usuario</th></tr></thead><tbody>'+movements.map(m=>'<tr><td>'+esc(fmtDT(m.ts))+'</td><td>'+esc((m.direction==='IN'?'Entrada (+)':'Salida (−)')+' · '+(m.currency==='USD'?'Efectivo USD':'Efectivo Bs.'))+'</td><td>'+esc(m.reason||'—')+'</td><td class="r">'+esc(m.currency==='USD'?usd(m.amount):bsf(m.amount))+'</td><td>'+esc(m.user||'—')+'</td></tr>').join('')+'</tbody></table></div>':'<div class="hint">Sin movimientos de efectivo registrados en este turno.</div>';
    const rows=getRows();
    $('#zReconcile',el).innerHTML=rows.map(r=>{
      const existing=oldReal[r.id];
      const value=existing===null||existing===undefined?'':nf(existing);
      return '<tr><td>'+esc(r.name)+'</td><td>'+esc(r.cur)+'</td><td class="r">'+esc(nf(r.system))+'</td><td><input class="fld r" style="min-width:115px;width:100%" data-z-real="'+esc(r.id)+'" aria-label="Monto real '+esc(r.name)+'" inputmode="decimal" placeholder="Ingrese importe real" value="'+esc(value)+'" '+(!opened?'disabled':'')+'></td><td class="r" data-z-diff="'+esc(r.id)+'">—</td></tr>';
    }).join('');
    const hs=getZHistory().filter(z=>String(z.cashbox)===box).slice().sort((a,b)=>Number(b.closedAt)-Number(a.closedAt));
    $('#zHistory',el).innerHTML=hs.length?hs.map(z=>'<tr><td>'+esc(z.id)+'</td><td>'+esc(fmtDT(z.closedAt))+'</td><td>'+esc(z.cashier||'—')+'</td><td class="r">'+esc(usd(z.netUsd||0))+'</td><td>'+esc(z.reconciliationStatus||'Histórico anterior')+'</td><td><button class="btn mini2" data-z-view="'+esc(z.id)+'">Mostrar</button> <button class="btn mini2" data-z-print="'+esc(z.id)+'">Reimprimir</button></td></tr>').join(''):'<tr class="empty"><td colspan="6">Todavía no hay cortes Z guardados para esta caja.</td></tr>';
    const result=updateTotals();
    $('#zClose',el).disabled=!opened||!result.total.complete;
    $('#zActionStatus',el).textContent=!opened?'El cierre está bloqueado: primero abra el turno de esta caja.':(!result.total.complete?'Arqueo incompleto: ingrese el monto real de los 8 métodos de pago; use 0,00 en los métodos sin movimientos.':'Arqueo completo. Puede revisar la vista previa de 80 mm y confirmar el cierre.');
    result.rec.forEach(r=>{
      const cell=$('[data-z-diff="'+r.id+'"]',el);
      if(cell)cell.textContent=r.diff===null?'—':(r.diff>0?'+':'')+nf(r.diff);
    });
    $('#zPreview',el).disabled=!opened;
  };
  el.addEventListener('input',e=>{
    if(e.target.matches('[data-z-real]')){
      const result=updateTotals();
      result.rec.forEach(r=>{
        const cell=$('[data-z-diff="'+r.id+'"]',el);
        if(cell)cell.textContent=r.diff===null?'—':(r.diff>0?'+':'')+nf(r.diff);
      });
      const opened=boxOpen();
      $('#zClose',el).disabled=!opened||!result.total.complete;
      $('#zActionStatus',el).textContent=!opened?'El cierre está bloqueado: primero abra el turno de esta caja.':(!result.total.complete?'Arqueo incompleto: ingrese el monto real de los 8 métodos de pago; use 0,00 en los métodos sin movimientos.':'Arqueo completo. Puede revisar la vista previa de 80 mm y confirmar el cierre.');
    }
  });
  el.addEventListener('click',e=>{
    const view=e.target.closest('[data-z-view]');
    if(view){const z=getZHistory().find(item=>item.id===view.dataset.zView&&String(item.cashbox)===box);if(z)printCorteZ(z,false);return;}
    const reprint=e.target.closest('[data-z-print]');
    if(reprint){const z=getZHistory().find(item=>item.id===reprint.dataset.zPrint&&String(item.cashbox)===box);if(z)printCorteZ(z,true);return;}
    if(e.target.id==='zMovAdd'){
      active=readActiveOpening();
      if(!boxOpen()){msg('Debe abrir el turno antes de registrar movimientos.','bad');return;}
      const amount=pn($('#zMovAmount',el).value),reason=$('#zMovReason',el).value.trim();
      if(!amount||!reason){msg('Indique un monto mayor que cero y el motivo del movimiento.','bad');return;}
      if(!Array.isArray(S.movimientosCaja))S.movimientosCaja=[];
      S.movimientosCaja.push({id:'MOV-'+box.replace(/\W/g,'')+'-'+Date.now(),cashbox:box,ts:Date.now(),direction:$('#zMovDir',el).value,currency:$('#zMovCur',el).value,amount:r2(amount),reason,user:currentCajero(),openingId:active.id||''});
      save();$('#zMovAmount',el).value='';$('#zMovReason',el).value='';$('#zMovStatus',el).textContent='Movimiento registrado y guardado en el historial del turno.';draw();return;
    }
    if(e.target.id==='zOpenShift'){
      active=readActiveOpening();
      if(boxOpen()){msg('Ya existe un turno abierto para esta caja.','bad');draw();return;}
      const bs=pnZero($('#zOpeningBs',el).value),usdOpening=pnZero($('#zOpeningUsd',el).value);
      if(bs===null||usdOpening===null){msg('Indique el fondo inicial de Bs. y US$, aunque sea cero.','bad');return;}
      const now=Date.now();
      active={id:'OPEN-'+box.replace(/\W/g,'')+'-'+now,cashbox:box,cashier:currentCajero(),openedAt:now,bs:r2(bs),usd:r2(usdOpening),status:'abierta'};
      writeActiveOpening(active);
      const ctx=Object.assign(cajaContext(),{cashbox:box,name:currentCajero(),status:'abierta',openedAt:now});
      sessionStorage.setItem('sifer360_active_box',JSON.stringify(ctx));localStorage.setItem('sifer360_active_box',JSON.stringify(ctx));
      msg('Turno abierto para la caja '+box+'. Registre el arqueo real antes de cerrar.');
      draw();return;
    }
    if(e.target.id==='zPreview'){
      active=readActiveOpening();
      if(!boxOpen()){msg('Abra el turno y registre el fondo inicial antes de previsualizar el Corte Z.','bad');draw();return;}
      const result=calculate();
      const all=getPeriodSales(),sales=all.filter(s=>!s.void),voids=all.filter(s=>s.void);
      const now=Date.now();
      const rec=result.rec.map(r=>Object.assign({},r,{real:r.real==null?null:Number(r.real),diff:r.diff==null?null:Number(r.diff)}));
      const draft={id:'VISTA PREVIA · Z-'+box,cashbox:box,cashier:currentCajero(),openedAt:active.openedAt,closedAt:now,openingId:active.id||'',invoiceFrom:all.length?pad(Math.min(...all.map(s=>Number(s.no)||0))):'—',invoiceTo:all.length?pad(Math.max(...all.map(s=>Number(s.no)||0))):'—',salesCount:sales.length,voidCount:voids.length,netUsd:moneyTotal(sales,s=>Number(s.total||0)),netBs:moneyTotal(sales,s=>Number(s.total||0)*Number(s.rate||S.cfg.rate||0)),ivaUsd:moneyTotal(sales,s=>Number(s.iva||0)),igtfUsd:moneyTotal(sales,s=>Number(s.igtf||0)),payments:zPayTotals(sales),detailTotals:zOperationalTotals(all,shiftStart(),now,box),openingBs:Number(active.bs||0),openingUsd:Number(active.usd||0),reconciliation:rec,reconciliationStatus:result.total.status,shortageUsd:result.total.shortageUsd,surplusUsd:result.total.surplusUsd,shortageBs:result.total.shortageBs,surplusBs:result.total.surplusBs,observations:$('#zObservations',el).value.trim(),saleIds:all.map(s=>s.no),status:'previa'};
      printCorteZ(draft,false);return;
    }
    if(e.target.id==='zClose'){
      active=readActiveOpening();
      if(!boxOpen()){msg('Abra el turno y registre el fondo inicial antes del cierre Z.','bad');draw();return;}
      const result=calculate();
      if(!result.total.complete){msg('Complete el importe real de todos los métodos de pago; use 0,00 si no hubo movimientos.','bad');return;}
      if(window.SIFERAccess&&typeof window.SIFERAccess.requestPin==='function'&&!window.SIFERAccess.requestPin('Cerrar caja y generar Corte Z '+box))return;
      const status=result.total.status;
      if(!confirm('¿Confirmar el cierre definitivo de la caja '+box+'?\\nResultado: '+status+'\\nFaltante: '+usd(result.total.shortageUsd)+' / '+bsf(result.total.shortageBs)+'\\nSobrante: '+usd(result.total.surplusUsd)+' / '+bsf(result.total.surplusBs)+'\\nEl corte quedará guardado en el historial.'))return;
      const all=getPeriodSales(),sales=all.filter(s=>!s.void),voids=all.filter(s=>s.void);
      const rec=result.rec.map(r=>Object.assign({},r,{real:Number(r.real),diff:Number(r.diff)}));
      const seqs=cajaSeqs(),seq=seqs[box]||{z:1};const zSeq=Number(seq.z)||1;seq.z=zSeq+1;seqs[box]=seq;localStorage.setItem('sifer360_box_sequences',JSON.stringify(seqs));
      const t=Object.assign({},result.total);
      const z={id:'Z-'+box.replace(/\W/g,'')+'-'+new Date().getFullYear()+two(new Date().getMonth()+1)+two(new Date().getDate())+'-'+pad(zSeq,4),cashbox:box,cashier:currentCajero(),openedAt:active.openedAt,closedAt:Date.now(),openingId:active.id||'',invoiceFrom:all.length?pad(Math.min(...all.map(s=>Number(s.no)||0))):'—',invoiceTo:all.length?pad(Math.max(...all.map(s=>Number(s.no)||0))):'—',salesCount:sales.length,voidCount:voids.length,netUsd:moneyTotal(sales,s=>Number(s.total||0)),netBs:moneyTotal(sales,s=>Number(s.total||0)*Number(s.rate||S.cfg.rate||0)),ivaUsd:moneyTotal(sales,s=>Number(s.iva||0)),igtfUsd:moneyTotal(sales,s=>Number(s.igtf||0)),payments:zPayTotals(sales),detailTotals:zOperationalTotals(all,shiftStart(),Date.now(),box),openingBs:Number(active.bs||0),openingUsd:Number(active.usd||0),reconciliation:rec,reconciliationStatus:status,shortageUsd:t.shortageUsd,surplusUsd:t.surplusUsd,shortageBs:t.shortageBs,surplusBs:t.surplusBs,observations:$('#zObservations',el).value.trim(),saleIds:all.map(s=>s.no),status:'cerrada'};
      getZHistory().push(z);
      save();
      const closedOpening=Object.assign({},active,{status:'cerrada',closedAt:z.closedAt,cutId:z.id});
      writeActiveOpening(closedOpening);
      const closedBox=Object.assign(cajaContext(),{cashbox:box,status:'cerrada',closedAt:z.closedAt,cutId:z.id});
      sessionStorage.setItem('sifer360_active_box',JSON.stringify(closedBox));localStorage.setItem('sifer360_active_box',JSON.stringify(closedBox));
      msg('Corte Z '+z.id+' guardado. Resultado: '+status+'. Se abrirá la vista previa de 80 mm para imprimir.');
      printCorteZ(z,false);draw();
    }
  });
  openWin({title:'Corte Z · '+box,w:900,body:el,foot:[{label:'Cerrar',primary:true}],onOpen:draw});
}

const TB=[
 ['nueva','Nueva','F2',newSale],['buscar','Buscar','F3',searchCatalogDlg],['cliente','Cliente','F4',clientDlg],
 ['suspender','Suspender','F5',suspend],['recuperar','Recuperar','F6',recoverDlg],['descuento','Descuento','F7',discountDlg],['quitar','Quitar','Supr',removeSel],
 '-',['inventario','Inventario','F8',inventoryDlg],['conteo','Conteo','F11',()=>conteoDlg()],['kardex','Kardex','',()=>kardexDlg()],
 '-',['compras','Compras','F10',()=>comprasDlg('new')],['cxc','CxC','',()=>cxcDlg()],['cxp','CxP','',()=>cxpDlg()],['divisas','USD/Zelle','',()=>divisasDlg()],['cashea','Cashea','',()=>casheaDlg()],
 '-',['ventas','Ventas día','F9',salesDlg],['cortez','Corte Z','',corteZDlg],['seniat','Fiscal','',()=>seniatSudebanDlg()],['documentos','Documentos','',()=>fiscalDocumentsDlg()],['basedatos','Base de datos','',()=>databaseSettingsDlg()],['tasa','Tasa','',()=>cfgDlg('cRate')]
];
function buildChrome(){
  addAdminToolbarItems();
  $('#toolbar').innerHTML=TB.map(t=>t==='-'?'<span class="tsep"></span>':'<button class="tb" data-tb="'+t[0]+'" title="'+esc(t[1])+(t[2]?' ('+t[2]+')':'')+'">'+ico(t[0])+'<b>'+esc(t[1])+'</b><kbd>'+esc(t[2]||' ')+'</kbd>'+(t[0]==='recuperar'?'<span class="badge" id="heldBadge" hidden></span>':'')+(t[0]==='conteo'?'<span class="badge warn" id="conteoBadge" hidden></span>':'')+'</button>').join('');
  if(window.SIFERAccess&&window.SIFERAccess.applyPermissions)window.SIFERAccess.applyPermissions(activeUser());
}

/* ---------- render ---------- */
function ensureVisible(tr,wrap){
  if(!tr||!wrap)return;
  const th=wrap.querySelector('thead'),hh=th?th.offsetHeight:0;
  const top=tr.offsetTop-hh,bot=tr.offsetTop+tr.offsetHeight;
  if(top<wrap.scrollTop)wrap.scrollTop=top;else if(bot>wrap.scrollTop+wrap.clientHeight)wrap.scrollTop=bot-wrap.clientHeight;
}
function renderHeader(){
  const c=S.cfg;
  const session=activeUser();
  const dashboardButton=$('#btnDashboard');if(dashboardButton)dashboardButton.hidden=session.role!=='admin';
  $('#winTitle').textContent=c.empresa;
  if($('#winSub'))$('#winSub').textContent=currentCaja()==='SIN-ASIGNAR'?'Dashboard administrativo · Sin caja asignada':'Punto de venta · Caja '+currentCaja();
  document.title='POS '+c.empresa;
  $('#fNo').value=pad(currentCajaInvoice());
  $('#fDate').value=fmtDT(Date.now());
  $('#fClient').value=S.client.name;
  $('#fRif').value=S.client.rif;
  $('#fCajero').value=c.cajero;
  if($('#whoUser'))$('#whoUser').textContent=(session.name||c.cajero)+(session.role==='admin'?' · Administrador':'')+(session.cashbox&&session.cashbox!=='—'&&session.cashbox!=='Todas'?' · Caja '+session.cashbox:'');
}
function renderCatOptions(){}
function renderCart(){
  const tb=$('#cartBody'),rate=S.cfg.rate;
  if(!S.cart.length){
    tb.innerHTML='<tr class="empty"><td colspan="10">Venta vacía. Escanee un código de barras o escriba la descripción del producto en la caja de arriba.</td></tr>';
  }else{
    tb.innerHTML=S.cart.map((l,i)=>{
      const x=lineInfo(l),p=x.p;
      const u=esc(p.unit||'und').toUpperCase();
      const taxCls=prodTaxCls(p);
      return '<tr data-i="'+i+'" class="'+(i===S.sel?'sel':'')+'">'+
        '<td class="c">'+(i+1)+'</td>'+
        '<td class="mono">'+esc(p.code)+'</td>'+
        '<td><div class="desc">'+esc(p.desc)+'</div><div class="sub">'+esc(p.brand)+' · '+(p.sku?esc(p.sku)+' · ':'')+'pasillo '+esc(p.loc)+'</div></td>'+
        '<td class="c"><span class="um-tag">'+u+'</span></td>'+
        '<td class="c"><span class="qty"><button class="mini" data-act="dec" aria-label="Restar una unidad">&minus;</button><span class="qv">'+fq(l.qty)+' '+(p.unit||'und')+'</span><button class="mini" data-act="inc" aria-label="Sumar una unidad">+</button></span></td>'+
        '<td class="r">'+nf(p.price)+'</td>'+
        '<td class="r">'+(l.disc?fq(l.disc)+' %':'')+'</td>'+
        '<td class="c"><span class="iva-tag '+taxCls+'">'+esc(prodTaxTag(p))+'</span></td>'+
        '<td class="r">'+nf(x.net)+'</td>'+
        '<td class="r">'+nf(r2(x.net*rate))+'</td>'+
      '</tr>';
    }).join('');
  }
  renderTotals();renderStatus();
}
function renderTotals(){
  const t=totals(),r=S.cfg.rate;
  const row=(c,a,cls)=>'<tr class="'+(cls||'')+'"><td>'+c+'</td><td class="r">'+nf(a)+'</td><td class="r">'+nf(a*r)+'</td></tr>';
  let html=row('Subtotal',t.sub);
  if(t.disc>0)html+=row('Descuento',-t.disc);
  if(t.baseEx>0&&t.baseG16>0){
    html+=row('Base gravada (16 %)',t.baseG16);
    if(t.baseR8>0)html+=row('Base reducida (8 %)',t.baseR8);
    if(t.baseA31>0)html+=row('Base suntuaria (31 %)',t.baseA31);
    html+=row('Ventas exentas (0 %)',t.baseEx);
  }else if(t.baseEx>0){
    html+=row('Ventas exentas (0 %)',t.baseEx);
  }else{
    html+=row('Base imponible',t.base);
  }
  html+=row('Total I.V.A.',t.iva);
  html+=row('Total',t.total,'tot');
  $('#sumBody').innerHTML=html;
  $('#lcdBs').textContent=bsf(t.total*r);
  $('#lcdUsd').textContent=usd(t.total);
  $('#btnPay').disabled=!S.cart.length;
}
function renderCatalog(){}
function renderDetail(){}
function renderStatus(){
  const units=S.cart.reduce((a,l)=>a+l.qty,0);
  $('#sbCajero').textContent='Cajero: '+S.cfg.cajero+' · Caja '+S.cfg.caja;
  $('#sbRate').textContent='Tasa: '+nf(S.cfg.rate)+' Bs./US$';
  $('#sbCount').textContent='Renglones: '+S.cart.length+' · Unidades: '+fq(r2(units));
  $('#sbClock').textContent=fmtDT(Date.now());
  const b=$('#heldBadge');if(b){b.hidden=!S.held.length;b.textContent=S.held.length;}
  const cb=$('#conteoBadge');
  if(cb){
    const modCount=Object.keys(draftConteo).filter(c=>{const p=prod(c),d=draftConteo[c];return p&&d&&d.newStock!==null&&Math.abs(d.newStock-p.stock)>1e-9;}).length;
    cb.hidden=!modCount;cb.textContent=modCount;
  }
}
function renderAll(){renderHeader();renderCart();}

/* ---------- entrada de productos ---------- */
function parseEntry(v){
  const m=v.trim().match(/^(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/);
  if(m)return{qty:parseFloat(m[1].replace(',','.')),text:m[2].trim(),hasQty:true};
  return{qty:1,text:v.trim(),hasQty:false};
}
function quickPickDlg(matches,qty,queryText){
  let selIdx=0;
  const el=h('<div class="form"><div class="hint">Se encontraron <b>'+matches.length+'</b> coincidencias para "<b>'+esc(queryText)+'</b>". Seleccione el producto a agregar (Cantidad: <b>'+fq(qty)+'</b>):</div>'+
    '<div class="gridwrap invwrap"><table class="grid"><thead><tr><th>Código</th><th>SKU</th><th>Descripción</th><th>Marca</th><th class="c" style="width:54px">U.M.</th><th class="c" style="width:72px">I.V.A.</th><th>Pasillo</th><th class="r">Exist.</th><th class="r">Precio US$</th><th class="r">Precio Bs.</th></tr></thead><tbody id="qpBody"></tbody></table></div></div>');
  const draw=()=>{
    $('#qpBody',el).innerHTML=matches.map((p,i)=>'<tr data-idx="'+i+'" class="'+(i===selIdx?'sel':'')+'"><td class="mono">'+esc(p.code)+'</td><td class="mono">'+esc(p.sku||'-')+'</td><td><b>'+esc(p.desc)+'</b></td><td>'+esc(p.brand)+'</td><td class="c"><span class="um-tag">'+esc((p.unit||'und').toUpperCase())+'</span></td><td class="c"><span class="iva-tag '+prodTaxCls(p)+'">'+esc(prodTaxTag(p))+'</span></td><td class="c">'+esc(p.loc)+'</td><td class="r '+stockCls(p)+'">'+fq(p.stock)+'</td><td class="r">'+nf(p.price)+'</td><td class="r">'+nf(p.price*S.cfg.rate)+'</td></tr>').join('');
  };
  const pick=()=>{
    const p=matches[selIdx];
    if(p&&addItem(p.code,qty)){
      const entry=$('#entry');entry.value='';S.query='';
    }
  };
  el.addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-idx]');
    if(tr){selIdx=+tr.dataset.idx;draw();}
  });
  el.addEventListener('dblclick',e=>{
    const tr=e.target.closest('tr[data-idx]');
    if(tr){selIdx=+tr.dataset.idx;pick();closeWin();}
  });
  openWin({title:'Seleccionar producto ('+matches.length+' coincidencias)',w:760,body:el,foot:[{label:'Cancelar'},{label:'Agregar a la venta',primary:true,fn:pick}],onOpen:()=>draw()});
}
function submitEntry(){
  const entry=$('#entry'),pe=parseEntry(entry.value);
  if(!pe.text){msg('Escriba un código, SKU o una descripción.','bad');return;}
  const qUp=pe.text.toUpperCase();
  let p=S.products.find(x=>x.code===pe.text||(x.sku&&x.sku.toUpperCase()===qUp)||(x.assocSuppliers||[]).some(s=>s.barcode&&s.barcode.toUpperCase()===qUp));
  if(!p){
    const m=searchProducts(pe.text,'Todas');
    if(m.length===1)p=m[0];
    else if(!m.length){msg('No se encontró "'+pe.text+'".','bad');return;}
    else{quickPickDlg(m,pe.qty,pe.text);return;}
  }
  if(addItem(p.code,pe.qty)){entry.value='';S.query='';navigated=false;}
}

/* ---------- eventos ---------- */
function wire(){
  const entry=$('#entry');
  entry.addEventListener('input',()=>{S.query=parseEntry(entry.value).text;navigated=false;});
  entry.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      if(S.cart.length){
        e.preventDefault();
        S.sel=e.key==='ArrowDown'?Math.min(S.cart.length-1,S.sel+1):Math.max(0,S.sel-1);
        renderCart();ensureVisible($('#cartBody tr.sel'),$('#cartWrap'));
      }
    }else if(e.key==='Enter'){e.preventDefault();submitEntry();}
    else if(e.key==='Escape'){entry.value='';S.query='';navigated=false;}
  });
  $('#btnAdd').addEventListener('click',()=>{submitEntry();if(!W)entry.focus();});
  $('#btnPay').addEventListener('click',payDlg);
  $('#btnClient').addEventListener('click',clientDlg);
  $('#sbRate').addEventListener('click',()=>cfgDlg('cRate'));

  $('#cartBody').addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-i]');if(!tr)return;
    const i=+tr.dataset.i,btn=e.target.closest('[data-act]');
    S.sel=i;
    if(btn)changeQty(i,btn.dataset.act==='inc'?1:-1);else renderCart();
  });

  const btnMenu=$('#btnMenu');
  if(btnMenu)btnMenu.addEventListener('click',()=>{if(menuEl)closeMenu();else openMenu();});
  const btnCasheaTop=$('#btnCasheaTop');
  if(btnCasheaTop)btnCasheaTop.addEventListener('click',()=>casheaDlg());
  const btnDivisasTop=$('#btnDivisasTop');
  if(btnDivisasTop)btnDivisasTop.addEventListener('click',()=>divisasDlg());
  const btnSeniatTop=$('#btnSeniatTop');
  if(btnSeniatTop)btnSeniatTop.addEventListener('click',()=>seniatSudebanDlg());
  const sbDivisas=$('#sbDivisas');
  if(sbDivisas)sbDivisas.addEventListener('click',()=>divisasDlg());
  const sbSeniat=$('#sbSeniat');
  if(sbSeniat)sbSeniat.addEventListener('click',()=>seniatSudebanDlg());

  const dashboardButton=$('#btnDashboard');if(dashboardButton)dashboardButton.addEventListener('click',()=>showDashboardScreen());
  const logoutButton=$('#btnLogout');if(logoutButton)logoutButton.addEventListener('click',()=>{if(confirm('¿Desea cerrar la sesión actual?')){if(window.SIFERAccess&&window.SIFERAccess.logout)window.SIFERAccess.logout();}});
  $('#toolbar').addEventListener('click',e=>{
    const b=e.target.closest('[data-tb]');if(!b)return;
    const t=TB.find(x=>x[0]===b.dataset.tb);if(t){if($('#adminDashboard')&&!$('#adminDashboard').hidden)showPosScreen();t[3]();}
  });
  document.addEventListener('pointerdown',e=>{
    if(menuEl&&!e.target.closest('.menu')&&!e.target.closest('#btnMenu'))closeMenu();
  });

  const fk={F1:()=>seniatSudebanDlg(),F2:newSale,F3:focusEntry,F4:clientDlg,F5:suspend,F6:recoverDlg,F7:discountDlg,F8:inventoryDlg,F9:salesDlg,F10:()=>comprasDlg('new'),F11:()=>conteoDlg(),F12:payDlg};
  document.addEventListener('keydown',e=>{
    if(W){if(e.key==='Escape'){e.preventDefault();closeWin();}return;}
    if(e.key==='Escape'&&menuEl){closeMenu();if($('#btnMenu'))$('#btnMenu').focus();return;}
    if(fk[e.key]){e.preventDefault();closeMenu();fk[e.key]();return;}
    const tag=document.activeElement?document.activeElement.tagName:'';
    if(/INPUT|SELECT|TEXTAREA/.test(tag))return;
    if(e.key==='Delete'){e.preventDefault();removeSel();}
    else if(e.key==='ArrowDown'&&S.cart.length){e.preventDefault();S.sel=Math.min(S.cart.length-1,S.sel+1);renderCart();ensureVisible($('#cartBody tr.sel'),$('#cartWrap'));}
    else if(e.key==='ArrowUp'&&S.cart.length){e.preventDefault();S.sel=Math.max(0,S.sel-1);renderCart();ensureVisible($('#cartBody tr.sel'),$('#cartWrap'));}
    else if((e.key==='+'||e.key==='-')&&S.sel>=0){e.preventDefault();changeQty(S.sel,e.key==='+'?1:-1);}
  });
  setInterval(()=>{$('#fDate').value=fmtDT(Date.now());$('#sbClock').textContent=fmtDT(Date.now());},15000);
}


/* ---------- Adjuntos fiscales y base de datos local SQLite ---------- */
function formatDocSize(n){return n<1024? n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(2)+' MB';}
function docDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(new Error('No se pudo leer el archivo.'));r.readAsDataURL(file);});}
async function docSha256(dataUrl){try{const bytes=Uint8Array.from(atob(dataUrl.split(',')[1]||''),c=>c.charCodeAt(0));const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');}catch{return '';}}

async function documentRows(filter = {}){
  if (window.posDesktop) return await window.posDesktop.listDocuments(filter);
  return await posSqliteDriver.listDocuments(filter);
}

async function fiscalDocumentsDlg(){
  if(S && !Array.isArray(S.documents)) S.documents=[];
  const el=h('<div class="form" style="gap:10px"><div class="hint">Adjunte el documento digital original de una operación en la base de datos local SQLite. En móviles, use <b>Tomar foto</b> para abrir la cámara si el navegador lo permite. Los archivos se vinculan al número de venta o compra seleccionado.</div><div class="f"><label>Operación fiscal</label><select class="fld" id="fdTx"><option value="">Seleccione una venta o compra</option></select></div><div class="row" style="flex-wrap:wrap"><button class="btn primary" id="fdUpload">Subir documento desde el dispositivo</button><button class="btn" id="fdCamera">Tomar foto con la cámara</button><input id="fdFile" type="file" accept="application/pdf,image/*" hidden><input id="fdCameraFile" type="file" accept="image/*" capture="environment" hidden></div><div class="f"><label>Nota de revisión (opcional)</label><input class="fld" id="fdNote" maxlength="300" placeholder="Ej. Factura original del proveedor"></div><div class="hint">Formatos: PDF, JPG, PNG, WEBP. Máximo 3 MB por archivo. Almacenado localmente en SQLite.</div><div id="fdStatus" class="hint">Seleccione una operación para ver sus documentos.</div><div class="gridwrap" style="max-height:240px"><table class="grid"><thead><tr><th>Documento</th><th>Tipo</th><th>Fecha</th><th></th></tr></thead><tbody id="fdRows"><tr class="empty"><td colspan="4">Sin documentos cargados.</td></tr></tbody></table></div></div>');
  const tx=$('#fdTx',el),status=$('#fdStatus',el),rows=$('#fdRows',el),upload=$('#fdFile',el),camera=$('#fdCameraFile',el);
  const sales=(S.sales||[]).filter(x=>!x.void).slice().sort((a,b)=>b.ts-a.ts);
  const purchases=(S.purchases||[]).filter(x=>!x.void).slice().sort((a,b)=>b.ts-a.ts);
  tx.innerHTML='<option value="">Seleccione una venta o compra</option><optgroup label="Ventas">'+sales.map(x=>'<option value="sale:'+esc(String(x.no))+'">Venta #'+esc(String(x.no))+' · '+esc(fmtDT(x.ts))+' · '+esc(usd(x.total))+'</option>').join('')+'</optgroup><optgroup label="Compras">'+purchases.map(x=>'<option value="purchase:'+esc(String(x.no))+'">Compra #'+esc(String(x.no))+' · '+esc(fmtDT(x.ts))+' · '+esc(usd(x.total))+'</option>').join('')+'</optgroup>';
  const selected=()=>{const a=tx.value.split(':');return a.length===2?{transactionType:a[0],transactionId:a[1]}:null;};
  const render=async()=>{
    const sel=selected(); if(!sel){rows.innerHTML='<tr class="empty"><td colspan="4">Seleccione una venta o compra.</td></tr>';return;}
    try{
      const docs=await documentRows(sel);const filtered=docs.filter(d=>d.transactionType===sel.transactionType&&String(d.transactionId)===sel.transactionId);
      rows.innerHTML=filtered.length?filtered.map(d=>'<tr><td><b>'+esc(d.fileName||'Documento')+'</b><div class="sub">'+esc(formatDocSize(Number(d.fileSize||0)))+'</div></td><td>'+esc(d.transactionType==='sale'?'Venta':'Compra')+'</td><td>'+esc(String(d.createdAt||'').slice(0,10))+'</td><td><button class="btn mini2" data-doc-open="'+esc(d.id)+'">Ver</button> <button class="btn mini2" data-doc-delete="'+esc(d.id)+'">Eliminar</button></td></tr>').join(''):'<tr class="empty"><td colspan="4">Esta operación no tiene documentos adjuntos.</td></tr>';
    }catch(e){rows.innerHTML='<tr class="empty"><td colspan="4">'+esc(e.message||'No se pudieron cargar los documentos.')+'</td></tr>';status.textContent='Error al consultar documentos.';}
  };
  const processFile=async file=>{
    const sel=selected();if(!sel){status.textContent='Primero seleccione una venta o compra.';return;}
    if(!file)return;
    if(file.size>3*1024*1024){status.textContent='El archivo supera el límite de 3 MB.';return;}
    if(!(file.type==='application/pdf'||file.type.startsWith('image/'))){status.textContent='Solo se permiten PDF e imágenes.';return;}
    status.textContent='Leyendo y guardando documento en SQLite…';
    try{
      const dataUrl=await docDataUrl(file);
      const doc={id:'DOC-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),transactionType:sel.transactionType,transactionId:sel.transactionId,fileName:file.name||('captura-'+Date.now()+'.jpg'),mimeType:file.type||'application/octet-stream',fileSize:file.size,sha256:await docSha256(dataUrl),dataUrl,createdAt:new Date().toISOString(),notes:$('#fdNote',el).value.trim()};
      await posSqliteDriver.saveDocument(doc);
      if(!Array.isArray(S.documents))S.documents=[];
      S.documents=S.documents.filter(d=>d.id!==doc.id);
      S.documents.push({id:doc.id,transactionType:doc.transactionType,transactionId:doc.transactionId,fileName:doc.fileName,mimeType:doc.mimeType,fileSize:doc.fileSize,sha256:doc.sha256,createdAt:doc.createdAt,notes:doc.notes});
      save();status.textContent='Documento guardado localmente en SQLite para '+(sel.transactionType==='sale'?'la venta #':'la compra #')+sel.transactionId+'.';await render();
    }catch(e){status.textContent='No se guardó el documento: '+(e.message||e);persistenceError(e);}
  };
  $('#fdUpload',el).addEventListener('click',()=>upload.click());
  $('#fdCamera',el).addEventListener('click',()=>camera.click());
  upload.addEventListener('change',()=>{processFile(upload.files&&upload.files[0]);upload.value='';});
  camera.addEventListener('change',()=>{processFile(camera.files&&camera.files[0]);camera.value='';});
  tx.addEventListener('change',render);
  rows.addEventListener('click',async e=>{
    const del=e.target.closest('[data-doc-delete]'),open=e.target.closest('[data-doc-open]');
    if(del){
      if(!confirm('¿Eliminar este documento adjunto?'))return;
      try{
        await posSqliteDriver.deleteDocument(del.dataset.docDelete);
        if(Array.isArray(S.documents)) S.documents=S.documents.filter(d=>d.id!==del.dataset.docDelete);
        save();await render();
      }catch(err){status.textContent='No se pudo eliminar: '+err.message;}
      return;
    }
    if(open){
      try{
        let d = await posSqliteDriver.getDocument(open.dataset.docOpen);
        if(!d||!d.dataUrl) d=(S.documents||[]).find(x=>x.id===open.dataset.docOpen);
        if(!d||!d.dataUrl) throw new Error('No se encontró el contenido del archivo.');
        const w=window.open();
        if(w){
          w.document.write('<title>'+esc(d.fileName)+'</title><iframe style="border:0;width:100%;height:100vh" src="'+d.dataUrl+'"></iframe>');
        } else {
          const a=document.createElement('a');a.href=d.dataUrl;a.download=d.fileName;a.click();
        }
      }catch(err){status.textContent='No se pudo abrir el archivo: '+err.message;}
    }
  });
  openWin({title:'Documentos fiscales originales (SQLite Local)',w:820,body:el,foot:[{label:'Cerrar',primary:true}],onOpen:()=>{render();}});
}

async function databaseSettingsDlg(){
  const isDesktop = !!window.posDesktop;
  const salesCount = S.sales ? S.sales.length : 0;
  const prodCount = S.products ? S.products.length : 0;
  const cshCount = S.casheaMovimientos ? S.casheaMovimientos.length : 0;
  const krdxCount = S.kardex ? S.kardex.length : 0;

  const el = h('<div class="form" style="gap:14px">' +
    '<div style="background:#0F172A;border:1px solid #1E293B;border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:8px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<b style="color:#38BDF8;font-size:15px;display:inline-flex;align-items:center;gap:6px">' +
          '<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>' +
          'Base de Datos Local SQLite (100% Offline)' +
        '</b>' +
        '<span style="background:#065F46;color:#6EE7B7;font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px">CONECTADO LOCAL</span>' +
      '</div>' +
      '<div class="hint" style="margin:0;color:#94A3B8;line-height:1.5">' +
        'Este software opera <b>exclusivamente con SQLite local</b> (<code>elpiston.sqlite</code>). No depende de Turso, Vercel ni conexiones a internet. Todas las ventas, clientes, compras, inventario, libro fiscal SENIAT y pagos CASHEA residen permanentemente en este equipo.' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:4px">' +
        '<div style="background:#1E293B;padding:8px 10px;border-radius:6px"><span style="font-size:10px;color:#94A3B8;display:block">MOTOR SQL</span><b style="color:#F1F5F9;font-size:12px">' + (isDesktop ? 'SQLite3 Nativo (Electron)' : 'SQLite3 WebAssembly (sql.js)') + '</b></div>' +
        '<div style="background:#1E293B;padding:8px 10px;border-radius:6px"><span style="font-size:10px;color:#94A3B8;display:block">ARCHIVO / IDB</span><b style="color:#F1F5F9;font-size:12px">elpiston.sqlite</b></div>' +
        '<div style="background:#1E293B;padding:8px 10px;border-radius:6px"><span style="font-size:10px;color:#94A3B8;display:block">VENTAS REGISTRADAS</span><b style="color:#38BDF8;font-size:13px">' + salesCount + '</b></div>' +
        '<div style="background:#1E293B;padding:8px 10px;border-radius:6px"><span style="font-size:10px;color:#94A3B8;display:block">OPERACIONES CASHEA</span><b style="color:#A78BFA;font-size:13px">' + cshCount + '</b></div>' +
      '</div>' +
    '</div>' +

    '<div style="background:#131C2E;border:1px solid #1E293B;border-radius:8px;padding:12px">' +
      '<b style="color:#F8FAFC;font-size:13px;display:block;margin-bottom:8px">Copias de Seguridad y Restauración de SQLite</b>' +
      '<div class="row" style="flex-wrap:wrap;gap:8px">' +
        '<button class="btn primary" id="dbExportSqlite" type="button" style="display:inline-flex;align-items:center;gap:6px">' +
          '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
          'Descargar copia (.sqlite)' +
        '</button>' +
        '<button class="btn" id="dbImportSqliteBtn" type="button" style="display:inline-flex;align-items:center;gap:6px">' +
          '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
          'Restaurar copia (.sqlite)' +
        '</button>' +
        '<input type="file" id="dbImportSqliteFile" accept=".sqlite,.db" hidden>' +
        '<button class="btn" id="dbExportJson" type="button" title="Respaldo completo de datos en formato JSON">Respaldo JSON</button>' +
        '<button class="btn" id="dbResetAll" type="button" style="color:#F87171;border-color:#7F1D1D" title="Reiniciar a datos iniciales de fábrica">Reiniciar base</button>' +
      '</div>' +
      '<div id="dbMsg" class="hint" style="margin-top:10px;min-height:18px"></div>' +
    '</div>' +
  '</div>');

  const note = $('#dbMsg', el);

  $('#dbExportSqlite', el).addEventListener('click', () => {
    try {
      const bytes = posSqliteDriver.exportSqlite();
      if (!bytes) {
        /* Export JSON snapshot if raw sqlite bytes not loaded in memory */
        const blob = new Blob([JSON.stringify(stateSnapshot(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'elpiston-estado-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        note.textContent = 'Respaldo de datos exportado correctamente.';
        return;
      }
      const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'elpiston-backup-' + new Date().toISOString().slice(0, 10) + '.sqlite';
      a.click();
      note.textContent = 'Archivo elpiston.sqlite descargado exitosamente.';
    } catch (e) {
      note.textContent = 'Error al exportar SQLite: ' + e.message;
    }
  });

  const fileInput = $('#dbImportSqliteFile', el);
  $('#dbImportSqliteBtn', el).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    note.textContent = 'Importando base de datos SQLite…';
    try {
      const buf = await file.arrayBuffer();
      await posSqliteDriver.importSqlite(buf);
      note.textContent = 'Base de datos SQLite restaurada correctamente. Recargando…';
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      note.textContent = 'Error restaurando SQLite: ' + e.message;
    }
  });

  $('#dbExportJson', el).addEventListener('click', () => {
    try {
      const blob = new Blob([JSON.stringify(stateSnapshot(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'elpiston-snapshot-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      note.textContent = 'Respaldo JSON descargado con éxito.';
    } catch (e) {
      note.textContent = 'Error al exportar: ' + e.message;
    }
  });

  $('#dbResetAll', el).addEventListener('click', () => {
    resetAll();
  });

  openWin({
    title: 'Base de Datos Local SQLite',
    w: 620,
    body: el,
    foot: [{ label: 'Cerrar', primary: true }]
  });
}

async function prepareDatabaseBeforeStartup(){
  window.__POS_DB_MODE = 'sqlite';
  try {
    await posSqliteDriver.init();
    const st = await posSqliteDriver.loadState();
    window.__POS_BOOT_STATE = st;
  } catch (e) {
    console.warn('Advertencia al iniciar SQLite local:', e);
  }
}

/* ---------- arranque ---------- */
prepareDatabaseBeforeStartup().catch(e=>console.error('No se pudo inicializar la base de datos:',e)).finally(()=>{
  init();
  buildChrome();
  renderCatOptions();
  renderAll();
  wire();
  primeOperationBaseline();
  msg(saved?'Base de datos local SQLite (elpiston.sqlite) cargada con éxito. Sistema POS y módulos Cashea listos.':'Base de datos local SQLite inicializada. Listo para operar.');
});
})();