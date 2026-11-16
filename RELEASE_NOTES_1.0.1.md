# SIFER360 LICORERÍA 1.0.1

## Cambios de esta versión
- Los consecutivos de operaciones se calculan en el servidor SQLite usando el historial autoritativo por caja; el cliente ya no propone mínimos desde su copia local.
- Se preservan IDs de evento independientes para Kardex, lotes, auditorías de tasa y liquidaciones, evitando colisiones entre equipos LAN.
- Las ventas suspendidas usan identificadores estables y tombstones para propagar recuperaciones/eliminaciones sin resucitar borradores en otra PC.
- Antes de aceptar un snapshot del cliente, el servidor vacía y confirma la outbox durable.
- Al recuperar una conexión, el cliente recarga el estado autoritativo en lugar de reenviar cambios locales no confirmados.
- Si un equipo configurado como servidor LAN no puede reanudar el servidor, la aplicación falla de forma cerrada y no crea una base local paralela.
- Se mantienen las mejoras de Compras, accesos del contador, Inventario, Kardex y Libro Fiscal integradas en la línea de lanzamiento.

## Validación
Esta versión se somete nuevamente a POS checks, verificación de escritorio y compilación del ejecutable Windows sobre la base release/v1.0.0. La compilación previa de la rama LAN etapa 2 no sustituye estas validaciones sobre el código reconciliado.

## Límites conocidos
- La sincronización debe probarse en campo con al menos dos equipos Windows conectados a la misma LAN.
- La compatibilidad física de cada modelo de impresora fiscal debe aceptarse con su equipo, firmware y adaptador específicos.
- Las pruebas automatizadas de protocolo no constituyen certificación SENIAT ni una prueba física de impresora.
