# Arquitectura de impresión dual — SIFER360-LICORERÍA

## Alcance
SIFER360 puede mantener dos dispositivos distintos por caja:
- **Térmica no fiscal:** impresora Windows instalada, seleccionada por nombre de cola. Se envía un trabajo RAW ESC/POS (inicialización, texto, avance y corte).
- **Fiscal:** configuración independiente ya existente por fabricante/modelo, COM, SDK y adaptador. La emisión sigue pasando por el administrador fiscal, sus validaciones y la conciliación de operaciones inciertas.

## Selección al cobrar
Cuando el modo de impresión está en `DUAL_PRINTER`, el cajero selecciona:
- `TICKET`: crea un documento `TICKET-INTERNO`, sin numeración de factura fiscal, y permite imprimirlo en la térmica no fiscal.
- `FISCAL`: conserva el flujo fiscal existente, registra primero la intención durable, emite por el adaptador fiscal y solo confirma el documento cuando el equipo devuelve el resultado esperado.

El modo dual se bloquea si la caja no tiene ambos dispositivos configurados y habilitados. Una emisión fiscal pendiente o incierta mantiene el bloqueo de seguridad existente hasta reconciliarla.

## Configuración
La impresora térmica se guarda en `S.cfg.thermalPrinters[caja]` (cola de Windows, ancho 32/42/48 columnas y habilitación). La impresora fiscal se mantiene en `S.cfg.fiscalPrinters[caja]`. Ambas configuraciones forman parte del estado persistido en SQLite; no se usa nube ni almacenamiento operativo alternativo.

## Seguridad y límites
- ESC/POS RAW se envía únicamente a la cola de Windows elegida; no se usa para emitir facturas fiscales.
- El resultado de `WritePrinter` confirma que Windows aceptó el trabajo completo, no que el papel haya salido. Se requiere prueba física de papel, ancho y corte.
- La detección de una cola Windows no identifica el modelo ni certifica compatibilidad ESC/POS.
- No se incluye una DLL propietaria de fabricantes ni se inventa un protocolo fiscal. Cada familia fiscal continúa requiriendo su adaptador oficial/autorizado.
- No se afirma compatibilidad física SENIAT ni emisión fiscal real sin hardware y pruebas del modelo exacto.
- No se modifica `main`, no se fusiona esta rama y no se publica una Release como parte de esta implementación.

## Validación
Las pruebas automatizadas cubren construcción del flujo ESC/POS, saneamiento de texto, detección simulada de colas y confirmación/rechazo del envío RAW. La validación física de una térmica y de una impresora fiscal queda fuera de CI; el usuario no dispone de impresora fiscal física para esa prueba.
