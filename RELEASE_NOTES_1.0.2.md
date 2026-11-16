# SIFER360 LICORERÍA 1.0.2

## Corrección del inicio en blanco
- El arranque de la interfaz ahora captura los errores de inicialización que antes podían quedar como promesas rechazadas sin mostrar contenido.
- Si falla la preparación de la interfaz, se muestra un diagnóstico visible con el error y su traza, en vez de dejar una ventana blanca.
- Electron registra errores de consola, fallos de carga, cierres inesperados del renderer y bloqueos en `renderer-startup.log` dentro de la carpeta de datos del usuario.
- Los fallos de carga principal o caída del proceso muestran un aviso con la ubicación del registro.

## Protección de datos
- No se habilita almacenamiento alternativo ni se borran datos SQLite cuando falla el arranque.
- La versión no considera un error de interfaz como autorización para operar.

## Validación
- Se ejecutan POS checks, Desktop verification y compilación Windows sobre esta revisión.
- La causa exacta del fallo original solo podrá confirmarse si el equipo registra el error al reproducirlo; esta versión evita ocultarlo y aporta diagnóstico persistente.
