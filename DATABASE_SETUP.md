# Base de datos de POS El Pistón

## Base de datos local SQLite (100% Offline y Confiable)

El sistema utiliza **exclusivamente base de datos local SQLite** (`elpiston.sqlite`), eliminando dependencias externas o de servidores en la nube como Turso o Vercel.

### Características del motor SQLite:
- **Almacenamiento local directo:** En la aplicación de escritorio Windows (.exe) los datos se guardan en el archivo `elpiston.sqlite` dentro de la carpeta de datos de usuario (`AppData/Roaming/elpiston`).
- **Compatibilidad web:** En el navegador web el sistema ejecuta SQLite WebAssembly (`sql.js`) con almacenamiento persistente en el dispositivo a través de IndexedDB.
- **Rendimiento inmediato y privacidad:** Las operaciones de inventario, ventas, clientes, kardex y documentos fiscales se procesan instantáneamente en milisegundos sin requerir internet.
- **Respaldos y Portabilidad:** Desde el menú **Base de datos**, puede descargar una copia de seguridad en formato `.sqlite` estándar para abrir en cualquier visor (como DB Browser for SQLite o DBeaver) o transferirla entre equipos.

### Esquema de tablas SQLite:
1. `app_state`: Registro único con el payload JSON completo del estado del sistema, inventario, catálogos, ventas, kardex y configuración.
2. `fiscal_documents`: Registro de archivos digitales adjuntos (facturas escaneadas, comprobantes de retención, fotos de compras) vinculados por clave foránea lógica a cada venta o compra.
3. `cashea_movimientos`: Registro de auditoría y conciliación de pagos con Cashea (financiamientos BNPL, tokens de compra y liquidaciones bancarias).

### Copias de seguridad:
Para respaldar la base de datos:
1. Vaya a **Menú → Base de datos (SQLite)**.
2. Haga clic en **Descargar respaldo .sqlite**.
3. Guarde el archivo en una unidad USB, disco externo o almacenamiento seguro.
