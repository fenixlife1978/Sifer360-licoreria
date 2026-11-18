# Actualizaciones seguras y conservación de datos

SIFER360-LICORERÍA debe actualizar el programa sin borrar ni reinicializar información existente del usuario.

## Datos protegidos

Toda actualización debe conservar la base SQLite y sus registros: ventas, compras, inventario, clientes, proveedores, caja, cuentas por cobrar y pagar, documentos fiscales, usuarios, permisos, configuración, auditoría, contabilidad, períodos, asientos, activos y cualquier dato operativo agregado por versiones posteriores.

## Reglas obligatorias

- La base de datos vive en el directorio de datos de usuario de Electron (app.getPath('userData')), nunca dentro del directorio de instalación reemplazable.
- El instalador y el actualizador no deben eliminar ese directorio, crear una base vacía sobre una existente ni cambiar silenciosamente su ubicación.
- Las migraciones deben ser incrementales, transaccionales, idempotentes y versionadas en schema_migrations.
- No se permiten DROP TABLE, DELETE FROM, TRUNCATE, VACUUM ni REPLACE INTO en migraciones de actualización.
- Antes de una migración se conserva una instantánea restaurable; después se valida PRAGMA integrity_check. Si algo falla, se revierte y se conserva la base original.
- Los cambios de estructura deben añadir tablas, índices, columnas o restricciones mediante migraciones explícitas. No reconstruir tablas con pérdida de filas.
- Nunca se debe marcar una migración como aplicada antes de completar y validar su transacción.
- No se debe borrar información al desinstalar/instalar una versión nueva. Una eliminación de datos solo podría existir como función separada, explícita, autenticada y confirmada por el administrador; jamás como efecto secundario de actualizar.

## Aceptación de cada versión

Probar actualización desde una base de una versión anterior con datos representativos y verificar que los conteos, identificadores, saldos, secuencias, usuarios y configuraciones permanecen intactos. Probar también reejecución de migraciones, interrupción/fallo, restauración y apertura posterior de la aplicación. No declarar aceptación si solo se probó una instalación limpia.
