# SIFER360 LICORERÍA v1.1.3 — VEN-NIF, ventas híbridas y respaldos cifrados opcionales

## Novedades
- Respaldo opcional de la SQLite central y exportación estructurada JSON a una cuenta Google Drive elegida por el administrador.
- Cifrado local AES-256-GCM antes de transferir los archivos; tokens OAuth y clave local protegidos por Electron safeStorage/DPAPI.
- OAuth Desktop con PKCE y scope mínimo. Google Drive permanece deshabilitado si no se configura un Client ID público válido.
- Programación diaria a las 8:00 p. m. hora Venezuela desde Windows Task Scheduler.
- Respaldo manual disponible aunque la programación diaria esté desactivada.
- Clave de recuperación exportable e importable en otra instalación; Windows vuelve a protegerla con safeStorage/DPAPI.
- Listado y descarga de respaldos SQLite desde Drive; la aplicación descifra y valida el archivo antes de guardarlo localmente.
- Restauración exclusivamente manual: requiere selección del archivo, confirmación explícita y copia local previa de la base activa.
- Contabilidad VEN-NIF con asientos en borrador vinculados a sus operaciones de origen, conversión bimonetaria y controles de autorización.
- Ventas híbridas por renglón y presentación, con distribución exacta de cantidades e importes entre factura fiscal y ticket.

## Seguridad e integridad
- SQLite local continúa siendo la única fuente operativa. Google Drive solo recibe copias cifradas.
- En LAN, la SQLite del servidor es la autoridad; los clientes envían operaciones autenticadas al servidor.
- Solo el equipo independiente o servidor LAN puede crear respaldos; los clientes LAN no los generan.
- Todos los canales IPC contables y de respaldo requieren una sesión administrativa autenticada por SQLite.
- Se verifica PRAGMA integrity_check antes de generar y enviar una copia.
- No hay restauración automática desde Drive ni sustitución automática de la base local. La descarga nunca modifica la SQLite activa.
- Las operaciones contables generadas automáticamente permanecen en borrador; requieren revisión y autorización profesional.

## Verificación de esta publicación
- HEAD integrado: 5e2fdc0e194a25343bae244f3246e01c76642c18.
- 615/615 pruebas automatizadas aprobadas.
- POS checks, validación TypeScript, sintaxis Electron, compilación web y validación local SQLite: correctos.
- Empaquetado Windows de instalador y portable completado correctamente desde el HEAD 1.1.3.
- El workflow de publicación vuelve a ejecutar pruebas, compilación y empaquetado sobre la rama estable y adjunta únicamente los artefactos que superen sus verificaciones.

## Funciones opcionales y validaciones operativas
- Google Drive requiere configurar SIFER360_GOOGLE_OAUTH_CLIENT_ID con un Client ID Desktop real y completar una autorización de prueba. Mientras eso no se haga, la función permanece deshabilitada; el POS local y SQLite siguen operativos.
- Las pruebas físicas multi-PC LAN, actualización sobre una instalación con datos reales, impresoras/periféricos y restauración en una segunda PC deben completarse en el entorno del establecimiento como validación operativa complementaria.
- Requisitos: Windows x64. La base operativa permanece local en SQLite; esta publicación no activa almacenamiento operativo en la nube.
