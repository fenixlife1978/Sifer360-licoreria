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
