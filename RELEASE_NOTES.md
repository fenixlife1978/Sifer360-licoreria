# SIFER360 LICORERÍA 1.0.0

Primera versión pública del sistema de punto de venta y gestión comercial de escritorio.

## Plataforma
- Aplicación portable para Windows x64.
- Base de datos SQLite local como almacenamiento operativo.
- No requiere Vercel, hosting, nube ni servicios remotos para operar.
- La información de la instalación permanece en el equipo local; el usuario debe conservar copias de seguridad externas.

## Módulos y mejoras incluidas
- Punto de venta, ventas, caja, inventario y reportes comerciales.
- Registro de compras de mercancía con separación de documentos fiscales y no fiscales.
- Retenciones visibles y cálculo del saldo real de Cuentas por Pagar.
- Actualización de precios sugeridos mediante el motor de precios configurado en cada producto.
- Contabilidad VEN-NIF restaurada, con persistencia SQLite y acceso por roles Administrador/Contador.
- Contabilidad disponible aunque no haya impresora fiscal conectada.
- Endurecimiento de operaciones LAN, cola durable y secuencias independientes por caja.
- Transporte fiscal PNP nativo con pruebas automatizadas de protocolo y conciliación.

## Alcance fiscal
La emisión de documentos fiscales requiere una impresora compatible conectada y validada por el adaptador correspondiente. No se declara certificada la compatibilidad física de todos los modelos ni se realizó una prueba física PNP para esta publicación, porque no se dispone de impresora fiscal. La simulación automatizada verifica el protocolo y sus salvaguardas, pero no sustituye la aceptación física del equipo.

Los tickets internos y operaciones comerciales no deben confundirse con documentos fiscales.

## Distribución
- Archivo: `sifer360-licoreria-portable.exe`
- Arquitectura: Windows x64
- Versión: 1.0.0
