# Hoja técnica: subsistema contable VEN-NIF

## Alcance de esta entrega
Se incorpora una base técnica aislada y comprobable. No activa aún la contabilización automática en producción ni declara cumplimiento fiscal o VEN-NIF. Los módulos operativos existentes del POS no se modifican.

## Decisiones
- Marco inicial configurable VEN-NIF PYME; opción VEN-NIF GE cuando la clasificación de la entidad lo exija.
- Automatización supervisada: los eventos generan borradores; un usuario contador o super-admin aprueba y contabiliza.
- Dinero en unidades menores enteras, moneda explícita y sin coma flotante binaria.
- Tasas tributarias no embebidas: requieren regla, versión, vigencia, autoridad y referencia normativa.
- Asientos contabilizados inmutables; correcciones mediante reversos relacionados.
- Eventos idempotentes para evitar asientos duplicados.
- Los períodos cerrados bloquean contabilizaciones.

## Integración prevista
La aplicación de escritorio usa SQLite mediante sql.js en Electron y mantiene parte del estado operativo en app_state. El esquema se aplica al iniciar Electron como migración aditiva e idempotente, dentro de una transacción SQLite en la misma base local. El empaquetado Windows incluye expresamente el archivo SQL; no se crea una base contable desconectada.

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
