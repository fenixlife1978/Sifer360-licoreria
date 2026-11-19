# Respaldo cifrado de SIFER360 en Google Drive

## Alcance y autoridad de datos

- SQLite local continúa siendo la única base operativa.
- Google Drive es un destino opcional de copias cifradas, nunca una base de datos, réplica, sincronizador ni fuente para ventas.
- Solo el equipo independiente o servidor LAN que conserva la SQLite central puede generar respaldos. Los clientes LAN no suben copias.
- No se envía el archivo SQLite en claro. Se crea una instantánea coherente desde sql.js, se valida con `PRAGMA integrity_check` y se cifra con AES-256-GCM antes de transmitirla.
- Se usa OAuth de escritorio con PKCE y el scope mínimo `drive.file` más lectura del correo autorizado. Los tokens de renovación y la clave de cifrado local se protegen con Electron `safeStorage` (Windows DPAPI).
- El usuario debe exportar y conservar fuera del PC la clave de recuperación desde el botón correspondiente. La clave es necesaria para descifrar copias en otro equipo; perderla impide recuperar el contenido cifrado.

## Configuración obligatoria de Google OAuth

La aplicación necesita un OAuth Client ID de tipo **Desktop app** creado en Google Cloud Console, con Google Drive API habilitada y pantalla de consentimiento configurada. No se requiere client secret para este flujo de escritorio con PKCE.

El Client ID público se incorpora en `electron/google-drive-oauth.json` durante el empaquetado. El archivo del repositorio contiene deliberadamente un valor vacío. La canalización de publicación debe inyectar el secreto/repository variable `SIFER360_GOOGLE_OAUTH_CLIENT_ID` (el Client ID no es una contraseña, pero debe pertenecer al proyecto OAuth oficial de SIFER360). Nunca se debe añadir un client secret al repositorio.

Si no hay Client ID, la interfaz informa que la conexión todavía no está configurada y no intenta abrir OAuth.

## Programación

Windows Task Scheduler ejecuta el binario de SIFER360 con `--sifer-google-drive-backup` cada día a las 20:00 en `America/Caracas` (UTC-04:00). La tarea usa el token interactivo del usuario actual; por seguridad no almacena la contraseña de Windows. Windows debe estar encendido y el usuario debe tener una sesión iniciada. `StartWhenAvailable` permite ejecutar una tarea omitida cuando Windows vuelva a estar disponible.

Si SIFER360 ya está abierto, la instancia programada entrega el trabajo a la instancia existente mediante el mecanismo de instancia única. Si está cerrado, se inicia en modo oculto, carga la SQLite, valida, respalda y se cierra sin abrir la ventana POS.

Cada fecha de Venezuela tiene dos archivos dentro de `SIFER360 Respaldos`: `SIFER360-AAAA-MM-DD.sqlite.siferenc` (copia íntegra restaurable) y `SIFER360-AAAA-MM-DD.json.siferenc` (exportación estructurada de todas las tablas). Ambos están cifrados y comparten la clave de recuperación. Un reintento del mismo día reemplaza esa copia diaria, evitando duplicados por reintentos. Los errores se registran localmente; nunca se informa éxito antes de que Google confirme la carga.

## Descarga y restauración manual

- El administrador puede listar copias SQLite de la carpeta privada y descargar una copia descifrada a un archivo local.
- Antes de guardar, la aplicación valida el encabezado SQLite y ejecuta PRAGMA integrity_check sobre una instancia aislada.
- Descargar no restaura ni modifica la base activa. Para restaurar, el administrador debe seleccionar manualmente el archivo local en “Restaurar copia” y aceptar la confirmación explícita.
- Antes de importar, SIFER360 descarga una copia local de la SQLite actual. Si no puede generar esa copia previa, cancela la restauración.
- Nunca se restaura automáticamente al iniciar la aplicación ni se reemplaza la SQLite solo porque exista una copia más reciente en Drive.

## Seguridad de acceso y respaldo manual

- La conexión, activación/desactivación, ejecución manual y exportación de la clave requieren una sesión de administrador autenticada por SQLite en el proceso principal de Electron.
- Los equipos cliente LAN no pueden generar ni administrar respaldos; deben realizarse desde el equipo servidor que conserva la única SQLite.
- El respaldo manual puede ejecutarse aunque la programación diaria esté desactivada. Conectar una cuenta Google sigue siendo obligatorio.
- Si la aplicación ya está abierta cuando se dispara la tarea de Windows, la instancia existente procesa el respaldo; si aún está inicializando, conserva la solicitud hasta que SQLite esté disponible.

## Activación desde SIFER360

1. Introducir el correo de Google.
2. Conectar Google Drive y aprobar el consentimiento de Google para esa misma cuenta.
3. Guardar la clave de recuperación en un medio distinto del PC.
4. Activar el respaldo diario a las 8:00 p. m. o ejecutar una copia manual.

La conexión no se activa solo por escribir el correo; se requiere OAuth. Desactivar la programación no elimina las copias ya almacenadas en Drive.

## Límites

- Requiere Internet al momento de subir la copia.
- No se ejecuta en un PC cliente LAN; el respaldo debe configurarse en el servidor.
- El respaldo diario no sustituye las copias locales externas recomendadas.
- La restauración automatizada desde Drive es una operación separada y debe validar la clave y la integridad SQLite antes de reemplazar datos; esta primera entrega no reemplaza automáticamente la base local.
