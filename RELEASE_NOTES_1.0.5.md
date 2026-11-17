# SIFER360 LICORERÍA 1.0.5 — licenciamiento CRM y telemetría

## Licencias y prueba gratuita
- Prueba gratuita local de 24 horas desde el primer inicio de la instalación.
- Aviso no intrusivo con acceso directo a planes, pagos y activación; al vencer la prueba, la aplicación exige una licencia válida.
- Activación online desde CRM-SICOVEN con clave de licencia y código de producto exclusivo `SIFER360_LICORERIA`.
- La clave y el estado local se guardan cifrados con Electron safeStorage/DPAPI.
- Revalidación online al iniciar y al recuperar conectividad. El margen offline lo determina CRM (7 días por defecto, configurable entre 1 y 30 días).
- Una licencia de SICOVEN u otro producto no activa SIFER360 LICORERÍA. Los límites de equipos y revocaciones se respetan desde CRM.

## Planes y catálogo
- Acceso directo a la página independiente de SIFER360 en CRM-SICOVEN para ver planes, reportar Pago Móvil y activar la licencia.
- El catálogo público del CRM sincroniza automáticamente versión e instalador desde la última GitHub Release de SIFER360.
- Los planes y precios de SIFER360 se almacenan por separado de los de SICOVEN y se administran desde el CRM.

## Telemetría
- Envío opcional de estadísticas técnicas anónimas: aperturas, inicio/fin de prueba, activaciones y revalidaciones.
- El usuario puede desactivar la telemetría desde la pantalla de licencia.
- No se envían ventas, inventario, caja, clientes, datos contables ni claves de licencia.
- Los eventos se muestran en la analítica del CRM por producto.

## Arquitectura y seguridad
- SQLite local sigue siendo la única fuente operativa para POS, ventas, inventario, caja y contabilidad.
- CRM-SICOVEN solo administra licencias, planes, pagos y telemetría; no participa en operaciones comerciales locales.
- En modo LAN, la licencia se valida por instalación de SIFER360; no se comparte ni se convierte en una licencia por caja.
- La prueba y el estado de licencia no se guardan dentro de la base operativa SQLite.
