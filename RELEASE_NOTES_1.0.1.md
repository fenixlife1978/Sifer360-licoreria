# SIFER360 LICORERÍA 1.0.1

## Cambios incluidos
- Endurecimiento de sincronización LAN, cola durable, recuperación y conciliación de eventos.
- Aislamiento y recuperación de consecutivos por caja, con validaciones adicionales.
- Mejoras de transporte y diagnóstico para impresoras fiscales compatibles.
- Integración de las vistas de Compras, Inventario, Kardex y Libro Fiscal disponibles en la línea de lanzamiento.
- Versión de aplicación incrementada de 1.0.0 a 1.0.1.

## Validación
La rama de integración que sirve de base para esta consolidación ya superó POS checks, Desktop verification y compilación Windows. La PR de consolidación volverá a ejecutar los flujos contra la base actualizada de release/v1.0.0 antes de fusionarse.

## Límites conocidos
- La prueba física de LAN con dos PCs sigue siendo necesaria para aceptación de campo.
- La compatibilidad física de cada modelo de impresora fiscal debe validarse con el equipo y adaptador correspondientes.
- No se declara certificación SENIAT ni compatibilidad física universal.
