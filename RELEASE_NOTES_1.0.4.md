# SIFER360 LICORERÍA 1.0.4 — respaldos cifrados opcionales en Google Drive

## Novedades
- Se añade una opción de respaldo externo, voluntaria y desactivada hasta que el administrador conecte su propia cuenta Google mediante OAuth.
- El sistema genera una copia SQLite íntegra y una exportación JSON de todas las tablas de la base local.
- Ambas copias se cifran localmente con AES-256-GCM antes de transmitirse a Google Drive.
- El usuario debe guardar una clave de recuperación fuera del equipo antes de activar la programación diaria.
- Windows Task Scheduler ejecuta el respaldo todos los días a las 20:00 hora de Venezuela (America/Caracas, UTC-04:00), incluso si la ventana de SIFER360 está cerrada. Si el equipo no estaba disponible, Windows intenta ejecutar la tarea cuando vuelva a estarlo.
- Se puede ejecutar una copia manual, consultar el último resultado y desactivar la programación.
- En una instalación LAN, solo el equipo servidor que conserva la única SQLite puede configurar y enviar el respaldo. Los clientes no transmiten bases de datos.

## Configuración de Google OAuth
- Crear un cliente OAuth 2.0 de tipo **Desktop app** en Google Cloud.
- Guardar su Client ID como secreto de GitHub Actions llamado `SIFER360_GOOGLE_OAUTH_CLIENT_ID`.
- Después de crear o modificar ese secreto, ejecutar nuevamente los flujos de compilación de Windows para que el Client ID quede incluido en el instalador y el portable nuevos.
- El Client ID identifica la aplicación y no es una contraseña. No introducir ni distribuir un Client Secret en el ejecutable de escritorio.
- Si el secreto no está configurado al momento de compilar, la integración debe permanecer deshabilitada y mostrar que falta la configuración.

## Seguridad y límites
- SQLite local continúa siendo la única fuente operativa. No hay nube para ventas, inventario, sincronización ni consultas POS.
- OAuth usa PKCE y el scope Drive limitado a archivos creados por SIFER360.
- Los tokens y la clave local se protegen mediante Electron safeStorage/DPAPI.
- La clave de recuperación permite descifrar las copias fuera del equipo original; debe guardarse separada.
- Requiere registrar un OAuth Client ID de tipo Desktop app en Google Cloud y configurarlo como secreto de Actions `SIFER360_GOOGLE_OAUTH_CLIENT_ID`.
- La restauración automática desde Drive no forma parte de esta entrega; la base local no se reemplaza automáticamente.
