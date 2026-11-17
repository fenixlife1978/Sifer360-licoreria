# SIFER360 LICORERÍA v1.0.7

## Actualizador de escritorio
- Comprueba actualizaciones oficiales al iniciar y cada seis horas.
- Descarga automáticamente en segundo plano las versiones publicadas en GitHub Releases.
- Notifica cuando hay una nueva versión y cuando la descarga termina.
- Permite instalar ahora o posponer la instalación.
- Antes de instalar, comprueba la integridad de SQLite en el servidor y fuerza la persistencia.
- No inicia la instalación si hay una venta abierta o trabajos fiscales pendientes/inciertos en el POS.
- La instalación se realiza al cerrar la aplicación; los datos se mantienen en la carpeta de usuario de Electron, fuera de los archivos del programa.

## Inventario operativo y fiscal separados
- El inventario operativo existente (campo de stock del producto) representa todas las unidades físicas, fiscales y no fiscales.
- Las compras fiscales alimentan el inventario operativo y el fiscal.
- Las compras no fiscales alimentan solo el inventario operativo.
- Los tickets no fiscales descuentan solo el inventario operativo.
- Las ventas fiscales descuentan el inventario operativo y el fiscal.
- Se incorpora un libro fiscal separado con movimientos idempotentes y apertura fiscal documentada.
- No se infiere ni se copia automáticamente una existencia fiscal inicial desde el inventario operativo.
- Las ventas fiscales se bloquean si el saldo fiscal documentado es insuficiente.

## Integridad y compatibilidad
- El inventario fiscal conserva documento fuente, caja, operador, costo y saldo posterior.
- Las anulaciones solo revierten movimientos fiscales que realmente existen en el ledger.
- SQLite continúa siendo la fuente de verdad; no se introduce una base de datos en la nube.
- Los reportes fiscales/contables deben conciliarse con los documentos originales y ser revisados por el contador antes de usarse en declaraciones.

