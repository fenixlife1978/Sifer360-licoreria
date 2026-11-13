import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const access=readFileSync(new URL('../public/access.js',import.meta.url),'utf8');
const main=readFileSync(new URL('../public/main.js',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../public/accountant-dashboard.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/accountant-dashboard.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('contador inicia directamente en su dashboard fiscal-contable',()=>{
 assert.match(access,/if\(u\.role==='contador'\)[\s\S]{0,400}SIFERAccountantDashboard\.show\(\)/);
 assert.match(access,/function renderDashboard\(u\)/);
 assert.match(html,/id="adminDashboard"/);
 assert.match(html,/accountant-dashboard\.js/);
});
test('la toolbar del contador autoriza exclusivamente Fiscal y Contabilidad',()=>{
 assert.match(access,/contador:\['seniat','contabilidad'\]/);
 assert.match(access,/function canAccess\(module,u\)/);
 assert.match(access,/accountant-toolbar/);
 assert.match(access,/#toolbar \.tsep/);
 assert.match(access,/separator\.hidden=accountant/);
 assert.match(main,/SIFERAccess\.canAccess\(b\.dataset\.tb,user\)/);
 assert.match(main,/session\.role==='contador'\)\{window\.SIFERAccountantDashboard\.show\(\);return;\}/);
});
test('los accesos superiores ajenos al contador se ocultan y el dashboard permanece visible al abrir módulos',()=>{
 assert.match(access,/btnDashboard','btnCasheaTop','btnDivisasTop','btnAccountingTop','btnSeniatTop','btnMenu/);
 assert.match(main,/user\.role!=='contador'\)showPosScreen\(\)/);
 assert.match(main,/session\.role==='contador'&&e\.key!=='F1'/);
 assert.match(main,/function openAccountingModule\(\)[\s\S]{0,180}contador/);
 assert.match(main,/function seniatSudebanDlg\(initialTab\)\{\s*if\(/);
});
test('el dashboard calcula IVA, retenciones, IGTF, CxC y CxP desde el estado operativo',()=>{
 for(const term of ['state.sales','state.purchases','state.retencionesIva','retainedUsd','retainedBs','ivaDebitBs','ivaCreditBs','igtfBs','state.cxc','state.cxp','accounting.entries'])assert.ok(dashboard.includes(term),term);
 assert.match(dashboard,/SIFERAccountantDashboard/);
 assert.match(dashboard,/estimación informativa/);
 assert.match(dashboard,/Soportes fiscales adjuntos/i);
});
test('dashboard y toolbar del contador se adaptan a pantallas pequeñas',()=>{
 assert.match(css,/accountant-toolbar\{justify-content:center/);
 assert.match(css,/@media\(max-width:620px\)/);
 assert.match(css,/@media\(max-width:390px\)/);
 assert.match(dashboard,/dashboard-mode/);
});
test('los nuevos scripts y estilos cargan sin alterar el orden del POS y contabilidad',()=>{
 assert.ok(html.indexOf('/main.js')<html.indexOf('/accountant-dashboard.js'));
 assert.ok(html.indexOf('/accountant-dashboard.js')<html.indexOf('/accounting.js'));
 assert.match(html,/accountant-dashboard\.css/);
 assert.doesNotThrow(()=>new vm.Script(dashboard));
});
