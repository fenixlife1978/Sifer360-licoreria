(()=>{'use strict';
const $=(s,r=document)=>r.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='sifer360_access_v1', SESSION='sifer360_session_v1';
const roles={
 admin:{label:'Administrador',modules:[['▦','Dashboard','Resumen del negocio'],['🧾','Ventas','Facturación y anulaciones'],['▤','Compras','Proveedores y cuentas por pagar'],['▣','Inventario','Productos y Kardex'],['◷','Cajas','Aperturas, cierres y arqueos'],['⌘','Reportes','Indicadores y auditoría'],['⚙','Configuración','Usuarios, roles y parámetros'],['⌁','Red y sincronización','Servidor LAN, clientes y conexión']]},
 cajero:{label:'Cajero',modules:[['▦','Dashboard','Tu jornada de caja'],['🧾','Punto de venta','Facturar y cobrar'],['↔','Consultar precios','Productos y existencias'],['◷','Mi caja','Movimientos y cierre']]},
 contador:{label:'Contador',modules:[['▦','Dashboard','Resumen contable'],['▤','Compras y proveedores','Cuentas por pagar'],['▧','Retenciones IVA','Trazabilidad para revisión'],['▥','Libros fiscales','Ventas, compras e IGTF'],['⌁','Conciliación','Cajas y medios de pago'],['⇩','Exportar reportes','Información para declaraciones']]}
};
function getUsers(){try{return JSON.parse(localStorage.getItem(KEY))||null}catch{return null}}
function initUsers(){let u=getUsers();if(!u){u=[
 {username:'admin',code:'Admin360!',name:'Administrador SIFER',role:'admin',cashbox:'—'},
 {username:'cajero01',code:'Caja360!',name:'Cajero 01',role:'cajero',cashbox:'01'},
 {username:'contador',code:'Conta360!',name:'Contador',role:'contador',cashbox:'—'}
  ];localStorage.setItem(KEY,JSON.stringify(u))}let changed=false;u.forEach(x=>{if(x.role==='admin'&&x.cashbox==='Todas'){x.cashbox='—';changed=true;}});if(changed)localStorage.setItem(KEY,JSON.stringify(u));return u}
function logo(){return '<svg class="sa-logo" viewBox="0 0 500 310" role="img" aria-label="SIFER360 Licorería"><g transform="translate(250 95)" fill="#f58220"><path d="M-17-95H17L20-62 35-59 51-88 80-71 63-41 75-29 105-45 122-16 92 1 96 17 130 20 130 53 96 56 92 72 122 89 105 118 75 102 63 114 80 144 51 161 35 132 20 135 17 168H-17L-20 135-35 132-51 161-80 144-63 114-75 102-105 118-122 89-92 72-96 56-130 53-130 20-96 17-92 1-122-16-105-45-75-29-63-41-80-71-51-88-35-59-20-62Z" transform="scale(.78)"/><circle r="39" fill="#edf3f9"/></g><text x="250" y="218" text-anchor="middle" fill="#173f68" font-family="Segoe UI,Arial,sans-serif" font-size="67" font-weight="800" letter-spacing="-2">SIFER<tspan fill="#f58220">360</tspan></text><text x="250" y="264" text-anchor="middle" fill="#173f68" font-family="Segoe UI,Arial,sans-serif" font-size="27" font-weight="700" letter-spacing="9">LICORERÍA</text></svg>'}

function shell(){
  if($('#sifer-access'))return;
  document.body.classList.add('sa-locked');
  const root=document.createElement('div');
  root.id='sifer-access';
  root.innerHTML=
    '<header class="sa-windowbar">' +
      '<div class="sa-window-title">' +
        '<svg class="sa-window-mark" viewBox="0 0 100 100" fill="none" aria-hidden="true">' +
          '<path fill-rule="evenodd" clip-rule="evenodd" d="M 53.43 19.69 L 55.87 3.87 L 64.72 5.89 L 60.06 21.21 L 66.24 24.18 L 75.31 10.99 L 82.40 16.65 L 71.56 28.42 L 75.83 33.79 L 89.73 25.83 L 93.66 34.01 L 78.78 39.91 L 80.31 46.60 L 96.28 45.46 L 96.28 54.54 L 80.31 53.40 L 78.78 60.09 L 93.66 65.99 L 89.73 74.17 L 75.83 66.21 L 71.56 71.58 L 82.40 83.35 L 75.31 89.01 L 66.24 75.82 L 60.06 78.79 L 64.72 94.11 L 55.87 96.13 L 53.43 80.31 L 46.57 80.31 L 44.13 96.13 L 35.28 94.11 L 39.94 78.79 L 33.76 75.82 L 24.69 89.01 L 17.60 83.35 L 28.44 71.58 L 24.17 66.21 L 10.27 74.17 L 6.34 65.99 L 21.22 60.09 L 19.69 53.40 L 3.72 54.54 L 3.72 45.46 L 19.69 46.60 L 21.22 39.91 L 6.34 34.01 L 10.27 25.83 L 24.17 33.79 L 28.44 28.42 L 17.60 16.65 L 24.69 10.99 L 33.76 24.18 L 39.94 21.21 L 35.28 5.89 L 44.13 3.87 L 46.57 19.69 Z M 36.50 50 A 13.5 13.5 0 1 0 63.50 50 A 13.5 13.5 0 1 0 36.50 50 Z" fill="#F29D12"/>' +
        '</svg>' +
        '<span>SIFER360 - Licorería&nbsp; | &nbsp;Sistema de Punto de Venta y Gestión</span>' +
      '</div>' +
      '<div class="sa-window-controls">' +
        '<button class="sa-win-btn" type="button" aria-label="Minimizar">' +
          '<svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.8"><line x1="2" y1="8" x2="14" y2="8"/></svg>' +
        '</button>' +
        '<button class="sa-win-btn" type="button" aria-label="Maximizar">' +
          '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="11" height="11" rx="1"/></svg>' +
        '</button>' +
        '<button class="sa-win-btn sa-win-close" type="button" aria-label="Cerrar">' +
          '<svg viewBox="0 0 16 16" width="12" height="12" stroke="currentColor" stroke-width="1.8"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>' +
        '</button>' +
      '</div>' +
    '</header>' +
    '<div class="sa-shell">' +
      '<aside class="sa-brand" aria-label="SIFER 360 Licorería">' +
        '<div class="sa-brand-artwork"></div>' +
      '</aside>' +
      '<section class="sa-panel">' +
        '<div id="sa-content" class="sa-content"></div>' +
      '</section>' +
    '</div>' +
    '<footer class="sa-statusbar">' +
      '<div class="sa-sb-left">' +
        '<span class="sa-sb-indicator"><i class="sa-sb-dot"></i> Servidor Local: 192.168.1.100:8080</span>' +
        '<span class="sa-sb-divider">|</span>' +
        '<span class="sa-sb-net">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#34d399" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="5" cy="12" r="3" fill="#34d399"/>' +
            '<circle cx="19" cy="12" r="3" fill="#34d399"/>' +
            '<path d="M8 10h8m-3-3 3 3-3 3"/>' +
            '<path d="M16 14H8m3 3-3-3 3-3"/>' +
          '</svg>' +
          'Conectado' +
        '</span>' +
      '</div>' +
      '<div class="sa-sb-right">' +
        '<span>SIFER360 - Licorería&nbsp; | &nbsp;Sistema de Punto de Venta y Gestión</span>' +
      '</div>' +
    '</footer>';
  document.body.append(root);
  renderLogin();
  const tick=()=>{
    const d=new Date();
    const pad=n=>String(n).padStart(2,'0');
    const day=pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear();
    let hours=d.getHours();
    const ampm=hours>=12?'PM':'AM';
    hours=hours%12||12;
    const time=pad(hours)+':'+pad(d.getMinutes())+' '+ampm;
    const dayEl=$('#sa-login-date-day'), timeEl=$('#sa-login-date-time'), ld=$('#sa-login-date');
    if(dayEl)dayEl.textContent=day;
    if(timeEl)timeEl.textContent=time;
    if(ld)ld.textContent=day+'\n'+time;
  };
  tick();
  if(window.__siferLoginClock)clearInterval(window.__siferLoginClock);
  window.__siferLoginClock=setInterval(tick,1000);
}

function renderLogin(error=''){
  const c=$('#sa-content');
  if(!c)return;
  c.innerHTML=
    '<div class="sa-card sa-login-card" id="sa-login-card">' +
      '<div class="sa-login-title">' +
        '<svg class="sa-user-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
          '<path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2.5c-3.33 0-10 1.67-10 5v2.5h20v-2.5c0-3.33-6.67-5-10-5z"/>' +
        '</svg>' +
        '<span>Inicio de Sesión</span>' +
      '</div>' +
      '<form id="sa-login" novalidate>' +
        '<div class="sa-field">' +
          '<label for="sa-user">Usuario</label>' +
          '<div class="sa-control">' +
            '<span class="sa-control-icon" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 12c2.48 0 4.5-2.02 4.5-4.5S14.48 3 12 3 7.5 5.02 7.5 7.5 9.52 12 12 12zm0 2.25c-3.01 0-9 1.51-9 4.5v2.25h18v-2.25c0-2.99-5.99-4.5-9-4.5z"/></svg>' +
            '</span>' +
            '<input id="sa-user" autocomplete="username" required placeholder="Ingrese su usuario">' +
          '</div>' +
        '</div>' +
        '<div class="sa-field">' +
          '<label for="sa-code">Contraseña</label>' +
          '<div class="sa-control sa-input-wrap">' +
            '<span class="sa-control-icon" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>' +
            '</span>' +
            '<input id="sa-code" type="password" autocomplete="current-password" required placeholder="Ingrese su contraseña">' +
            '<button class="sa-eye" id="sa-eye" type="button" aria-label="Mostrar contraseña" title="Mostrar contraseña">' +
              '<svg class="sa-eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="sa-field">' +
          '<label for="sa-cashbox">Caja</label>' +
          '<div class="sa-control sa-select-wrap">' +
            '<span class="sa-control-icon" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M4 18h16v3H4v-3zm15-9h-3V5a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v4H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2zm-9-3h4v3h-4V6zm-3 7h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z"/></svg>' +
            '</span>' +
            '<select id="sa-cashbox">' +
              '<option value="01">Caja 01 - Principal</option>' +
              '<option value="02">Caja 02</option>' +
              '<option value="03">Caja 03</option>' +
              '<option value="04">Caja 04</option>' +
            '</select>' +
            '<span class="sa-select-arrow" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div class="sa-error" id="sa-error" role="alert">'+esc(error)+'</div>' +
        '<div class="sa-remember">' +
          '<label>' +
            '<input type="checkbox" id="sa-remember" checked>' +
            '<span class="sa-custom-check">' +
              '<svg viewBox="0 0 12 10" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5 5 4.5 8 10.5 2"/></svg>' +
            '</span>' +
            '<span class="sa-remember-label">Recordar usuario</span>' +
          '</label>' +
        '</div>' +
        '<button class="sa-btn" type="submit">' +
          '<svg class="sa-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
          '<span>Iniciar Sesión</span>' +
        '</button>' +
      '</form>' +
      '<div class="sa-card-divider"></div>' +
      '<div class="sa-login-meta">' +
        '<div class="sa-product-meta">' +
          '<svg class="sa-meta-gear" viewBox="0 0 100 65" fill="none" aria-hidden="true">' +
            '<path fill-rule="evenodd" clip-rule="evenodd" d="M 53.43 19.69 L 55.87 3.87 L 64.72 5.89 L 60.06 21.21 L 66.24 24.18 L 75.31 10.99 L 82.40 16.65 L 71.56 28.42 L 75.83 33.79 L 89.73 25.83 L 93.66 34.01 L 78.78 39.91 L 80.31 46.60 L 96.28 45.46 L 96.28 54.54 L 80.31 53.40 L 78.78 60.09 L 93.66 65.99 L 89.73 74.17 L 75.83 66.21 L 71.56 71.58 L 82.40 83.35 L 75.31 89.01 L 66.24 75.82 L 60.06 78.79 L 64.72 94.11 L 55.87 96.13 L 53.43 80.31 L 46.57 80.31 L 44.13 96.13 L 35.28 94.11 L 39.94 78.79 L 33.76 75.82 L 24.69 89.01 L 17.60 83.35 L 28.44 71.58 L 24.17 66.21 L 10.27 74.17 L 6.34 65.99 L 21.22 60.09 L 19.69 53.40 L 3.72 54.54 L 3.72 45.46 L 19.69 46.60 L 21.22 39.91 L 6.34 34.01 L 10.27 25.83 L 24.17 33.79 L 28.44 28.42 L 17.60 16.65 L 24.69 10.99 L 33.76 24.18 L 39.94 21.21 L 35.28 5.89 L 44.13 3.87 L 46.57 19.69 Z M 36.50 50 A 13.5 13.5 0 1 0 63.50 50 A 13.5 13.5 0 1 0 36.50 50 Z" fill="#184672"/>' +
          '</svg>' +
          '<div><strong>SIFER360 - Licorería</strong><span>Versión 1.0.0</span></div>' +
        '</div>' +
        '<div class="sa-date-meta">' +
          '<svg class="sa-meta-cal" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
            '<path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zm-8-9H7v2h4v-2zm6 0h-4v2h4v-2zm-6 4H7v2h4v-2zm6 0h-4v2h4v-2z"/>' +
          '</svg>' +
          '<div><div class="sa-date-day" id="sa-login-date-day">08/10/2026</div><div class="sa-date-time" id="sa-login-date-time">10:24 AM</div></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  const remember=localStorage.getItem('sifer360_remember_user');
  if(remember)$('#sa-user').value=remember;
  const eye=$('#sa-eye');
  eye.onclick=()=>{
    const i=$('#sa-code'),show=i.type==='password';
    i.type=show?'text':'password';
    eye.setAttribute('aria-label',show?'Ocultar contraseña':'Mostrar contraseña');
    eye.title=show?'Ocultar contraseña':'Mostrar contraseña';
    eye.innerHTML=show
      ? '<svg class="sa-eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg class="sa-eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  };
  $('#sa-login').onsubmit=e=>{
    e.preventDefault();
    const username=$('#sa-user').value.trim(),code=$('#sa-code').value,cashbox=$('#sa-cashbox').value;
    const users=initUsers();
    const u=users.find(x=>x.username===username&&x.code===code);
    if(!u){
      $('#sa-error').textContent='Usuario o contraseña incorrectos.';
      $('#sa-code').focus();
      return;
    }
    if($('#sa-remember').checked)localStorage.setItem('sifer360_remember_user',username);
    else localStorage.removeItem('sifer360_remember_user');
    if(u.role==='cajero'&&u.cashbox&&u.cashbox!=='—'&&String(u.cashbox).replace(/^0/,'')!==String(cashbox).replace(/^0/,'')){
      $('#sa-error').textContent='Este usuario no tiene permiso para la caja seleccionada.';
      return;
    }
    u.cashbox=cashbox;
    const active={username:u.username,name:u.name,role:u.role,cashbox,loginAt:Date.now()};
    sessionStorage.setItem(SESSION,JSON.stringify(active));
    if(u.role!=='cajero'){
      sessionStorage.setItem('sifer360_active_box',JSON.stringify(active));
      localStorage.setItem('sifer360_active_box',JSON.stringify(active));
    }
    u.role==='cajero'?renderOpening(u):renderDashboard(u);
  };
}

function applyPermissions(u){const allow={admin:['pos','nueva','buscar','cliente','suspender','recuperar','descuento','quitar','inventario','conteo','kardex','compras','cxc','cxp','divisas','cashea','ventas','cortez','seniat','documentos','basedatos','tasa','usuarios','cajas'],cajero:['nueva','buscar','cliente','suspender','recuperar','descuento','quitar','ventas','cortez'],contador:['ventas','cortez','seniat','documentos','cxc','cxp','compras','basedatos']};document.querySelectorAll('#toolbar [data-tb]').forEach(b=>{b.hidden=!(allow[u.role]||[]).includes(b.dataset.tb)});}
async function renderNetwork(u){
 const c=$('#sa-content');
 c.innerHTML='<div class="sa-top"><div><div class="sa-eyebrow">RED LOCAL · SINCRONIZACIÓN</div><h2 style="margin:8px 0">Servidor y cajas cliente</h2><p class="sa-muted">Las otras cajas pueden encontrar este equipo automáticamente en la misma red. No necesitas configurar una IP fija; si la dirección cambia, pueden buscar el servidor de nuevo.</p></div><button class="sa-btn secondary" id="sa-net-back" style="width:auto;margin:0">Volver</button></div><div class="sa-card" style="margin-top:14px"><h3>Activar esta caja como servidor</h3><p class="sa-muted">El sistema anuncia este servidor en la red local. Las cajas cliente lo detectan automáticamente cuando están conectadas a la misma red.</p><form id="sa-net-server"><div class="sa-field"><label for="sa-net-port">PUERTO TCP</label><input id="sa-net-port" type="number" min="1024" max="65535" value="38760" required></div><button class="sa-btn">Activar servidor en este equipo</button></form><div id="sa-net-server-info" class="sa-warning" style="margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere">Servidor no iniciado.</div></div><div class="sa-card" style="margin-top:14px"><h3>Conectar esta caja como cliente</h3><button class="sa-btn secondary" type="button" id="sa-net-discover" style="margin:0 0 12px">Buscar servidor automáticamente</button><form id="sa-net-client"><div class="sa-field"><label for="sa-net-host">IP DETECTADA (también puedes editarla)</label><input id="sa-net-host" required placeholder="Pulsa «Buscar servidor automáticamente»"></div><div class="sa-field"><label for="sa-net-client-port">PUERTO</label><input id="sa-net-client-port" type="number" min="1024" max="65535" value="38760" required></div><div class="sa-field"><label for="sa-net-token">CLAVE DE EMPAREJAMIENTO</label><input id="sa-net-token" required autocomplete="off" placeholder="Clave mostrada en el servidor"></div><button class="sa-btn">Probar conexión y guardar servidor</button></form><div id="sa-net-client-info" class="sa-warning" style="margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere">Busca el servidor automáticamente y luego introduce la clave que aparece en la caja servidor.</div></div><div class="sa-card" style="margin-top:14px"><h3>Estado y sincronización</h3><p class="sa-muted" id="sa-net-status">Consultando configuración…</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sa-btn" id="sa-net-sync">Sincronizar ahora</button><button class="sa-btn secondary" id="sa-net-stop" style="width:auto;margin:0">Detener servidor local</button></div><div id="sa-net-sync-info" class="sa-small" style="margin-top:10px"></div></div><div class="sa-small" style="margin-top:12px">Seguridad: usa una red privada de confianza. No hace falta configurar IP fija: la búsqueda local descubre la dirección actual del servidor; si cambia, vuelve a buscarlo. La clave de emparejamiento autentica el acceso, pero no cifra el tráfico. No publiques el puerto en Internet. El modo sin conexión conserva los datos locales; las diferencias de inventario por ventas simultáneas requieren conciliación y no deben darse por resueltas automáticamente.</div>';
 $('#sa-net-back').onclick=()=>renderDashboard(u);
 const status=async()=>{try{if(!window.posDesktop){$('#sa-net-status').textContent='Función disponible en la versión de escritorio Electron.';return}const n=await window.posDesktop.networkStatus();$('#sa-net-status').textContent='Modo: '+n.role+' · '+(n.running?'servidor activo':'servidor detenido')+' · Dispositivo: '+n.deviceId; if(n.role==='server'&&n.running)$('#sa-net-server-info').textContent='Servidor activo. Direcciones para clientes:\n'+(n.addresses||[]).map(ip=>'http://'+ip+':'+n.port).join('\n')+'\nPuerto: '+n.port+'\nClave: '+n.token+'\n\nComparte esta clave solo con equipos autorizados.';else if(n.role==='client')$('#sa-net-client-info').textContent='Cliente configurado: '+n.host+':'+n.port}catch(e){$('#sa-net-status').textContent='No se pudo consultar el estado: '+e.message}};
 $('#sa-net-server').onsubmit=async e=>{e.preventDefault();try{const n=await window.posDesktop.networkStartServer({port:Number($('#sa-net-port').value)});$('#sa-net-server-info').textContent='Servidor activo. Direcciones para clientes:\n'+(n.addresses||[]).map(ip=>'http://'+ip+':'+n.port).join('\n')+'\nPuerto: '+n.port+'\nClave: '+n.token+'\n\nReserva esta IP en el router. Comparte la clave solo con equipos autorizados.';$('#sa-net-status').textContent='Servidor activo · '+n.port}catch(err){$('#sa-net-server-info').textContent='No se pudo iniciar el servidor: '+err.message}};
 $('#sa-net-discover').onclick=async()=>{const info=$('#sa-net-client-info');info.textContent='Buscando servidores SIFER360 en la red local…';try{if(!window.posDesktop||!window.posDesktop.networkDiscover)throw new Error('El descubrimiento automático requiere la versión de escritorio Electron.');const servers=await window.posDesktop.networkDiscover();if(!servers.length){info.textContent='No se encontró ningún servidor. Comprueba que la otra caja tenga el servidor iniciado y que ambos equipos estén en la misma red Wi‑Fi/LAN. También puedes introducir la IP manualmente.';return}const server=servers[0];$('#sa-net-host').value=server.host;$('#sa-net-client-port').value=server.port;info.textContent='Servidor detectado: '+(server.name||'SIFER360')+' · '+server.host+':'+server.port+(servers.length>1?' · Se detectaron '+servers.length+' servidores; se seleccionó el primero.':'')+'\nAhora introduce la clave de emparejamiento que aparece en el panel del servidor y pulsa «Probar conexión».'}catch(err){info.textContent='No se pudo buscar automáticamente: '+err.message+'\nPuedes introducir la IP manualmente.'}};
 $('#sa-net-client').onsubmit=async e=>{e.preventDefault();try{const n=await window.posDesktop.networkConfigureClient({host:$('#sa-net-host').value,port:Number($('#sa-net-client-port').value),token:$('#sa-net-token').value});$('#sa-net-client-info').textContent='Conexión autenticada. Servidor: '+n.host+':'+n.port+'. La sincronización automática está activa.';if(window.SIFERNetworkSync)await window.SIFERNetworkSync();await status()}catch(err){$('#sa-net-client-info').textContent='Conexión fallida: '+err.message+'\nLa caja seguirá guardando localmente y volverá a intentar cuando se conecte.'}};
 $('#sa-net-sync').onclick=async()=>{if(window.SIFERNetworkSync)await window.SIFERNetworkSync();$('#sa-net-sync-info').textContent='Intento de sincronización realizado. Revisa el estado en la barra inferior y el mensaje de conexión.';await status()};
 $('#sa-net-stop').onclick=async()=>{try{const n=await window.posDesktop.networkStopServer();$('#sa-net-server-info').textContent='Servidor detenido.';await status()}catch(err){$('#sa-net-server-info').textContent=err.message}};
 await status();
}
function renderDashboard(u){if(u.role==='admin'){document.body.classList.remove('sa-locked');const access=$('#sifer-access');if(access)access.remove();applyPermissions(u);if(window.SIFERDashboard)window.SIFERDashboard.show();return;}const r=roles[u.role];const c=$('#sa-content');c.innerHTML='<div class="sa-top"><div class="sa-user"><div class="sa-avatar">'+esc(u.name.slice(0,1).toUpperCase())+'</div><div><div class="sa-role">'+esc(r.label)+'</div><b>'+esc(u.name)+'</b><div class="sa-muted">Sesión iniciada · '+esc(u.cashbox)+'</div></div></div><button class="sa-btn secondary" id="sa-logout" style="width:auto;margin:0">Salir</button></div><div class="sa-eyebrow">ESPACIO DE TRABAJO</div><h2 style="margin:10px 0 8px">¿Qué necesitas hacer?</h2><p class="sa-muted" style="margin-bottom:22px">Módulos disponibles según tu perfil de acceso.</p><div class="sa-dashgrid">'+r.modules.map((m,i)=>'<button class="sa-module" data-module="'+esc(m[1])+'"><div class="sa-icon">'+m[0]+'</div><b>'+esc(m[1])+'</b><span>'+esc(m[2])+'</span></button>').join('')+'</div><div class="sa-small">Las operaciones críticas deben solicitar autorización PIN. La autorización debe validarse en el servidor para producción.</div>';$('#sa-logout').onclick=logout;applyPermissions(u);c.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>{const m=b.dataset.module;if(m==='Dashboard')return;if(m==='Red y sincronización'){renderNetwork(u);return;}document.body.classList.remove('sa-locked');$('#sifer-access').remove();const map={'Punto de venta':'nueva','Ventas':'ventas','Compras':'compras','Compras y proveedores':'compras','Inventario':'inventario','Cajas':'cortez','Mi caja':'cortez','Reportes':'ventas','Libros fiscales':'seniat','Retenciones IVA':'seniat','Conciliación':'seniat','Exportar reportes':'seniat','Configuración':'basedatos','Consultar precios':'buscar','Dashboard':null};const id=map[m];if(id){document.body.classList.remove('sa-locked');$('#sifer-access').remove();const target=$('#toolbar [data-tb="'+id+'"]');if(target)target.click();else alert('El módulo aún no está conectado en esta pantalla: '+m)}else{applyPermissions(u);document.body.classList.remove('sa-locked');$('#sifer-access').remove();if(m==='Punto de venta'){const entry=$('#entry');if(entry)entry.focus()}}})}
function renderOpening(u){const c=$('#sa-content');const invoice=(()=>{try{const seqs=JSON.parse(localStorage.getItem('sifer360_box_sequences')||'{}');const n=Number((seqs[u.cashbox]||{}).invoice||1);return 'FAC-'+String(n).padStart(8,'0')}catch{return 'FAC-00000001'}})();const rate=localStorage.getItem('sifer360_bcv_rate')||'0,00';c.innerHTML='<div class="sa-opening"><div class="sa-eyebrow">CONTROL DE JORNADA</div><h2>Apertura de caja</h2><p class="sa-muted">Registra los fondos físicos con los que inicia tu jornada. Este paso es obligatorio antes de facturar.</p><div class="sa-summary"><span>👤 Cajero: <b>'+esc(u.name)+'</b></span><span>▣ Caja: <b>'+esc(u.cashbox)+'</b></span><span>🧾 Factura inicial: <b>'+esc(invoice)+'</b></span></div><form id="sa-open"><div class="sa-opening-grid"><div class="sa-field"><label for="sa-bs">FONDO INICIAL EFECTIVO · BS.</label><input id="sa-bs" inputmode="decimal" required value="0,00" placeholder="0,00"></div><div class="sa-field"><label for="sa-usd">FONDO INICIAL USD FÍSICOS</label><input id="sa-usd" inputmode="decimal" required value="0,00" placeholder="0,00"></div><div class="sa-field"><label for="sa-rate">TASA BCV (BS./USD)</label><input id="sa-rate" required value="'+esc(rate)+'" inputmode="decimal"></div><div class="sa-field"><label>FECHA Y HORA</label><input readonly value="'+new Date().toLocaleString('es-VE')+'"></div></div><div class="sa-warning">Verifica los montos físicos y la tasa BCV antes de abrir. Los valores quedarán como registro de apertura para el control y arqueo de caja.</div><button class="sa-btn">Confirmar apertura y entrar al POS →</button><div class="sa-error" id="sa-open-error"></div></form><div class="sa-small">Si algún dato no coincide, solicita apoyo al administrador antes de continuar.</div></div>';$('#sa-open').onsubmit=e=>{e.preventDefault();const bs=num($('#sa-bs').value),usd=num($('#sa-usd').value),rate=num($('#sa-rate').value);if(bs===null||usd===null||rate===null||rate<=0){$('#sa-open-error').textContent='Ingresa montos válidos y una tasa BCV mayor que cero.';return}const opens=JSON.parse(localStorage.getItem('sifer360_openings')||'[]');const op={id:'OPEN-'+Date.now(),invoiceStart:invoice,cashier:u.name,username:u.username,cashbox:u.cashbox,bs,usd,rate,openedAt:new Date().toISOString(),status:'abierta'};opens.push(op);localStorage.setItem('sifer360_openings',JSON.stringify(opens));localStorage.setItem('sifer360_bcv_rate',String(rate));const activeBox={username:u.username,name:u.name,role:u.role,cashbox:u.cashbox,openingId:op.id,openedAt:op.openedAt,bs,usd,rate,status:'abierta'};sessionStorage.setItem('sifer360_active_box',JSON.stringify(activeBox));localStorage.setItem('sifer360_active_box',JSON.stringify(activeBox));sessionStorage.setItem('sifer360_active_opening',JSON.stringify(op));localStorage.setItem('sifer360_active_opening',JSON.stringify(op));renderDashboard(u)}}
function num(s){s=String(s).trim().replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)&&n>=0?n:null}
function logout(){sessionStorage.removeItem(SESSION);sessionStorage.removeItem('sifer360_active_box');const localBox=(()=>{try{return JSON.parse(localStorage.getItem('sifer360_active_box')||'null')}catch{return null}})();if(!localBox||!localBox.username||!sessionStorage.getItem(SESSION))localStorage.removeItem('sifer360_active_box');else if(localBox.username===JSON.parse(sessionStorage.getItem(SESSION)||'{}').username)localStorage.removeItem('sifer360_active_box');const old=$('#sifer-access');if(old)old.remove();shell()}
document.addEventListener('DOMContentLoaded',()=>{initUsers();sessionStorage.removeItem(SESSION);sessionStorage.removeItem('sifer360_active_opening');shell();});
window.SIFERAccess={logout,roles,applyPermissions,getUsers:()=>initUsers(),setUsers:users=>{if(!Array.isArray(users))return false;localStorage.setItem(KEY,JSON.stringify(users));return true;},requestPin:(reason,callback)=>{const pin=prompt('Autorización requerida: '+reason+'\nIngrese PIN de administrador:');if(!pin)return false;const users=initUsers(),admin=users.find(u=>u.role==='admin'&&u.code===pin);if(!admin){alert('PIN no válido. Operación cancelada.');return false}if(typeof callback==='function')callback();return true}};
})();