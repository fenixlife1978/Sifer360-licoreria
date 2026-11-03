# Hoja técnica: subsistema contable VEN-NIF

## Alcance de esta entrega
Se incorpora una base técnica aislada y comprobable. No activa aún la contabilización automática en producción ni declara cumplimiento fiscal o VEN-NIF. Los módulos operativos existentes del POS no se modifican.

## Decisiones
- Marco inicial configurable VEN-NIF PYME; opción VEN-NIF GE cuando la clasificación de la entidad lo exija.
- Automatización supervisada: los eventos generan borradores; un usuario contador o super-admin aprueba y contabiliza.
- Dinero en unidades menores enteras, moneda explícita y sin coma flotante binaria. La moneda funcional y de presentación no se presuponen: deben configurarse tras análisis del contador.
- El perfil fiscal conserva clasificación del contribuyente, designaciones de agente, actividad económica (incluida la actividad de bebidas alcohólicas), licencias y medio autorizado de emisión.
- Las series de documentos fiscales exigen rango, autorización, vigencia y proveedor o máquina autorizada; no se generan números de control ficticios.
- Tasas tributarias no embebidas: requieren regla, versión, vigencia, autoridad y referencia normativa.
- Asientos contabilizados inmutables; correcciones mediante reversos relacionados.
- Eventos idempotentes para evitar asientos duplicados.
- Los períodos cerrados bloquean contabilizaciones.

## Integración prevista
La aplicación de escritorio usa SQLite mediante sql.js en Electron y mantiene parte del estado operativo en app_state. El esquema se aplica al iniciar Electron como migración aditiva e idempotente, dentro de una transacción SQLite en la misma base local. El empaquetado Windows incluye expresamente el archivo SQL; no se crea una base contable desconectada. El perfil fiscal y las series autorizadas quedan separados de los datos operativos y no se activan por valores de demostración.

Antes de activar el puente operativo deben definirse IDs estables de operaciones POS, reglas por evento, moneda funcional, tasas de cambio con fecha/fuente, mapeo de productos y costos, y manejo de reintentos/reversos en LAN multi-caja.

## Límites
- Este núcleo no certifica cumplimiento SENIAT.
- Un ticket térmico o PDF ordinario no es automáticamente una factura fiscal autorizada.
- No se fijan aquí alícuotas IVA, IGTF, retenciones ni tributos de bebidas alcohólicas.
- Un archivo exportado solo se denominará oficial tras validar la especificación SENIAT aplicable.
- No se deben emitir estados financieros definitivos sin catálogo aprobado, saldos de apertura y políticas documentadas.

## Siguientes fases
1. Migración idempotente del esquema a SQLite local.
2. Catálogo contable parametrizable y períodos.
3. Mapeo de eventos reales POS y cola idempotente.
4. Mayor, auxiliares, balance de comprobación y cierres.
5. Reglas fiscales versionadas y exportaciones contrastadas con especificaciones oficiales.
6. Estados financieros y asistente guiado del contador.
7. Pruebas de LAN multi-caja, restauración, integridad y cierre abrupto.

## Emisión de documentos fiscales

Hasta que se configure y valide el medio autorizado de emisión de esta empresa (portal oficial, proveedor tecnológico autorizado, máquina fiscal o contingencia aplicable), las ventas nuevas se conservan como documentos internos auxiliares. El POS no inventa números de control ni afirma que un ticket sea factura fiscal. Los borradores de retención tampoco son comprobantes oficiales y la exportación TXT permanece deshabilitada mientras no se valide la especificación SENIAT aplicable.

## Particularidad del ramo de licores

La Ley de Impuesto sobre Alcohol y Especies Alcohólicas no debe traducirse en un recargo genérico por cada venta minorista. Su texto distingue impuestos ligados a producción, importación y expedición desde establecimientos productores/aduanas, y asigna a productores o importadores el pago de determinados gravámenes; además impone deberes de libros y documentos a comerciantes y exige licencia de expendio y patente. Por ello el sistema debe distinguir comercio minorista, mayorista, importador, productor o actividad mixta y conservar factura del proveedor, guías, origen, especie, volumen, graduación alcohólica, bandas y licencias. La aplicación de un impuesto nacional específico a una operación minorista requiere verificar el hecho imponible y la obligación concreta antes de contabilizarlo.

Las licencias, tasas y obligaciones municipales dependen de la ordenanza del municipio donde opera el establecimiento. No se deben programar importes municipales universales ni presumir que una licencia de otro municipio sea aplicable.

## Transición de facturación 2026–2027

La Providencia SNAT/2026/00093 fue publicada en la Gaceta Oficial N.º 43.484 del 21 de octubre de 2026 y establece una vacatio de 180 días continuos. La fecha de entrada en vigencia resultante es el 19 de abril de 2027. Hasta entonces el sistema debe respetar el régimen vigente aplicable; después deberá soportar portal/aplicación oficial, proveedor tecnológico autorizado o máquina fiscal autorizada, con contingencia y series documentales controladas. La opción de proveedor autorizado se registra como modalidad futura, pero no se considera activa antes de la vigencia ni sin autorización real.

La Providencia SNAT/2025/000054 establece retención ordinaria del 75 % y supuestos específicos del 100 %, además de exclusiones que deben evaluarse por proveedor y operación. Por eso el POS exige porcentaje explícito y confirmación; no presume una tasa al activar la condición de agente.

## Retenciones a proveedores: condición y exclusiones

El perfil del proveedor distingue si está sujeto a retención de IVA, si es agente de percepción y si la operación concreta ha sido revisada como aplicable o excluida. La retención automática exige que estos datos estén confirmados y que exista referencia de soporte; la ausencia de información no equivale a una confirmación negativa. El borrador manual usa la misma validación. Esto es especialmente relevante para compras de bebidas alcohólicas, por las exclusiones previstas en la Providencia SNAT/2025/000054.

## Configuración en la aplicación de escritorio

La pestaña **Contabilidad VEN-NIF** del módulo de control fiscal permite guardar en SQLite local, con bitácora de auditoría:
- marco contable seleccionado (PYME o GE);
- moneda funcional y de presentación indicadas expresamente por el contador;
- decimales y modo de automatización supervisada;
- perfil tributario de la entidad, actividad licorera, designaciones y licencias;
- períodos contables mensuales sin solapamientos.

El esquema no asigna una moneda funcional ni un marco contable por defecto. La pantalla no genera asientos desde ventas, compras o movimientos de inventario. El usuario Administrador o Contador puede registrar la configuración, pero la validación del rol aún depende del modelo de sesión del renderer y no debe considerarse una frontera de seguridad equivalente a autenticación de servidor. El IPC contable valida el origen de la ventana y expone métodos específicos, nunca el objeto `ipcRenderer` completo.

Los períodos se crean inicialmente abiertos; el cierre formal, el plan de cuentas, saldos de apertura, los asientos y los reportes contables se implementarán en fases separadas. No modificar manualmente la base SQLite para simular aprobación o contabilización.

## Captura transaccional de operaciones POS

La persistencia de app_state en Electron compara el estado comercial anterior y el nuevo. Si detecta altas, cambios o eliminaciones en ventas, compras, CxC/CxP, cierres, Kardex, conteos, devoluciones, anulaciones, Cashea, movimientos de divisas o retenciones, genera eventos de origen deterministas e idempotentes en accounting_source_events.

La escritura del estado POS y los eventos contables ocurre dentro de una única transacción BEGIN IMMEDIATE. Cuando se captura al menos un evento, la base SQLite se persiste inmediatamente al archivo para evitar que la ventana de 80 ms de guardado diferido deje una venta sin su evidencia contable después de un cierre abrupto. La recepción de operaciones LAN y la sincronización de snapshots también registran los eventos dentro de la transacción que actualiza el estado del servidor.

La pestaña Contabilidad VEN-NIF muestra el resumen y las últimas operaciones capturadas. Los eventos permanecen en estado pending; todavía no se traducen a asientos, no actualizan balances y no se consideran contabilizados. La selección de cuentas, la clasificación de impuestos, la política de reconocimiento y la aprobación del contador son fases posteriores.

La captura incluye también aperturas de caja, movimientos de inventario heredados y ventas suspendidas. El guardado Electron ya no oculta los errores de IPC: si SQLite no confirma la escritura, el fallo se propaga al manejador de persistencia de la interfaz.

El contador o administrador puede marcar un evento pendiente como **needs_review**, indicando el motivo. La transición se realiza en una transacción y queda registrada en la bitácora de auditoría. Esta marca no equivale a aprobación ni contabilización.

## Plan de cuentas configurable

La interfaz permite registrar y actualizar cuentas sin precargar un plan universal. Exige que el marco VEN-NIF ya esté configurado; valida código, clasificación, saldo normal, alcance PYME/GE y jerarquía. Una cuenta padre debe estar activa y ser de agrupación; no se admiten ciclos ni subcuentas de distinta clasificación. Si una cuenta ya tiene renglones contables, no se permite cambiar su clasificación, saldo normal o jerarquía. Cada alta o cambio se registra en la bitácora. No hay borrado de cuentas desde esta pantalla.

La cola LAN y la notificación de estado guardado se activan únicamente después de que el IPC SQLite confirma la persistencia local. Si la escritura falla, se muestra el error y no se inicia esa replicación desde el flujo de guardado.

La jerarquía impide inactivar una cuenta padre con subcuentas activas y evita que una cuenta hija tenga un alcance normativo más amplio que su padre. Si ya existen movimientos, también se protegen el ámbito normativo y la condición de cuenta agrupadora/contabilizable.
