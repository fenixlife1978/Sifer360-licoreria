# Actualizador y doble inventario — SIFER360 v1.0.7

## Actualizador de escritorio
La distribución oficial utiliza electron-updater con proveedor GitHub Releases. electron-builder debe generar y publicar junto con el instalador NSIS los metadatos `latest.yml` y archivos `.blockmap`; adjuntar solo el EXE no activa el mecanismo de actualización.

La aplicación consulta al iniciar y cada seis horas. La descarga se realiza en segundo plano. Al completarse, se presenta «Instalar ahora» o «Más tarde». La instalación requiere aceptación expresa, ausencia de venta en curso y ausencia de trabajos fiscales pendientes/inciertos. Si el equipo es servidor LAN, primero deben cerrarse las cajas cliente y detenerse el servidor de red; el proceso principal bloquea la instalación mientras el servidor siga activo. Antes de cerrar, el proceso principal verifica y persiste SQLite en el servidor; los clientes LAN no modifican la base central durante la actualización. El instalador debe mantener `app.getPath('userData')`, donde reside `sifer360-licoreria.sqlite`, configuración y estado de licencia.

Las actualizaciones de esquema SQLite futuras deben usar migraciones versionadas y reversibles. No se deben borrar carpetas de usuario ni sobrescribir la base de datos con el paquete de instalación.

## Inventario operativo maestro
El saldo operativo existente (`products[].stock`) es el inventario físico general y contiene mercancía comprada con o sin factura fiscal. Es la existencia que utiliza el POS para disponibilidad y reposición.

## Inventario fiscal
Se mantiene en `fiscalInventory`, separado del saldo operativo. Sus balances y movimientos son persistidos dentro del mismo estado SQLite.

| Evento | Operativo maestro | Fiscal |
|---|---:|---:|
| Compra con factura fiscal | + | + |
| Compra sin factura fiscal / nota no fiscal | + | — |
| Venta con ticket no fiscal | − | — |
| Venta con factura fiscal | − | − |
| Anulación de ticket no fiscal | + | — |
| Reversión de compra fiscal | − | − |

Las aperturas fiscales se registran por artículo, cantidad, costo y soporte documental. No se presume que todo el stock operativo sea fiscal. El saldo fiscal debe derivarse de aperturas conciliadas, compras fiscales y ventas fiscales; por ello una venta fiscal se bloquea cuando el saldo fiscal registrado no cubre la cantidad solicitada.

## Reglas contables y fiscales
El ledger fiscal de cantidades no equivale por sí solo al libro contable VEN-NIF, al Libro de Inventarios mercantil ni a una declaración SENIAT. La integración contable debe contabilizar por separado inventario, costo de ventas, ingresos e impuestos, usando cuentas imputables configuradas y referencias únicas de origen. El libro fiscal debe conciliar con facturas, notas de crédito, compras y soportes. La validación normativa y la determinación tributaria corresponden al contador.

## Migración de datos existentes
El actualizador automático está dirigido al instalador NSIS; la edición portable requiere un procedimiento de sustitución manual del ejecutable y no debe anunciarse como autoactualizable.\n\nLas instalaciones actualizadas reciben un ledger fiscal vacío cuando no existe un saldo fiscal previo documentado. No se reconstruye una apertura legal desde el saldo físico. El administrador/contador debe cargar la apertura respaldada por documentos. Las ventas y compras históricas no se revierten en el ledger nuevo si no tienen un movimiento fiscal original correspondiente.
