# SIFER360 1.1.3 — Respaldos cifrados opcionales

## Novedades
- Respaldo opcional de la SQLite central y exportación estructurada JSON a una cuenta Google Drive elegida por el administrador.
- Cifrado local AES-256-GCM antes de transferir los archivos; tokens OAuth y clave local protegidos por Electron safeStorage/DPAPI.
- OAuth Desktop con PKCE y scope mínimo. La función permanece deshabilitada si no se configura un Client ID público válido.
- Programación diaria a las 8:00 p. m. hora Venezuela desde Windows Task Scheduler.
- Respaldo manual disponible aunque la programación diaria esté desactivada.
- Clave de recuperación exportable e importable en otra instalación; Windows vuelve a protegerla con safeStorage/DPAPI.
- Listado y descarga de respaldos SQLite desde Drive; la aplicación descifra y valida el archivo antes de guardarlo localmente.
- Restauración exclusivamente manual: requiere selección del archivo, confirmación explícita y copia local previa de la base activa.

## Seguridad e integridad
- SQLite local continúa siendo la única fuente operativa. Google Drive solo recibe copias cifradas.
- Solo el equipo independiente o servidor LAN puede crear respaldos; los clientes LAN no los generan.
- Todos los canales IPC de respaldo requieren una sesión de administrador autenticada por SQLite.
- Se verifica PRAGMA integrity_check antes de generar y enviar una copia.
- La tarea programada procesa la instancia existente si SIFER360 ya está abierto y espera a que SQLite termine de inicializarse cuando la solicitud llega durante el arranque.
- No hay restauración automática desde Drive ni sustitución automática de la base local. La descarga nunca modifica la SQLite activa.

## Validación pendiente para publicar
- Configurar SIFER360_GOOGLE_OAUTH_CLIENT_ID con un Client ID Desktop real del proyecto OAuth oficial.
- Ejecutar una autorización real, carga/descarga de prueba y tarea programada en Windows con una cuenta Google de prueba.
- Verificar los artefactos Windows finales y su instalación limpia antes de publicar la versión.
