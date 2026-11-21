# Ventas híbridas, inventario dual y presentaciones del POS

## Estado de implementación
Integración de ventas híbridas y presentaciones para SIFER360 1.1.3. Ya están integrados el selector de presentaciones, los tres modos de impresión, la primera venta híbrida, el importador universal CSV/XLSX/JSON y la auditoría de apertura fiscal inicial. La división fiscal por cantidad y renglón conserva importes de presentación, pagos e IVA a precisión monetaria. Continúa la validación automatizada; no se publica Release ni instalador hasta cerrar todas las verificaciones.

## Principios obligatorios
- SQLite local del servidor LAN sigue siendo la única fuente de verdad.
- El inventario operativo representa todas las unidades físicas. El libro de inventario con respaldo fiscal conserva movimientos y cantidades sustentados documentalmente. Si una venta por ticket consume físicamente unidades con respaldo fiscal, el sistema registra una salida de inventario fiscal no facturada para que el saldo documental no supere las existencias reales; esto no convierte el ticket en factura fiscal.
- No se presume respaldo fiscal por importar un producto ni por tenerlo en catálogo.
- El comprobante de venta y la impresora seleccionada no cambian la obligación tributaria que corresponda a la operación. Los tickets internos se conservan en ventas y auditoría; nunca se ocultan operaciones ni se eliminan de registros exigibles.
- Los envíos a impresoras se hacen con idempotencia y reconciliación: una respuesta incierta no autoriza repetir cobros ni documentos.
- Cantidades de presentaciones se convierten a unidades base antes de validar o modificar inventario.

## Opciones del POS
1. **Ticket no fiscal:** comprobante interno por impresora térmica genérica. No se presenta como factura fiscal.
2. **Factura fiscal:** emisión por la máquina fiscal habilitada para la caja. Se valida la disponibilidad y trazabilidad fiscal de las cantidades.
3. **Impresión híbrida:** una venta comercial padre con un identificador común y dos documentos hijos cuando existan cantidades respaldadas y no respaldadas. La factura fiscal contiene la cantidad respaldada que pueda asignarse en presentaciones completas; el ticket térmico contiene el remanente. Un mismo renglón puede dividirse entre ambos documentos, sin fraccionar arbitrariamente una presentación indivisible (por ejemplo, un pack de 6). Los documentos conservan sus importes, impuestos, pagos distribuidos y relación con la venta padre. Si todos los renglones pertenecen a un solo grupo, solo se genera el documento que corresponda.

La primera implementación de modo híbrido no permite una venta mixta cuando se usa Cashea como medio de pago, porque falta una distribución contractual por documento. En ese caso el POS bloquea la confirmación y pide usar un solo tipo de comprobante o separar la operación. Los pagos, vuelto e IGTF restantes se distribuyen proporcionalmente entre documentos hijos y se reconcilian contra la venta padre. Las devoluciones internas de ventas híbridas que ya emitieron factura fiscal quedan bloqueadas hasta disponer del flujo de nota de crédito fiscal; las ventas internas sin factura pueden devolverse y restauran el saldo fiscal de las unidades respaldadas que se consumieron. Los libros fiscales y el cálculo mensual de débito IVA toman solo la porción fiscal; IGTF, caja y conciliación bancaria conservan la venta comercial completa, incluidos los tickets internos.

La emisión fiscal debe finalizar antes de considerar confirmada la venta. Si la máquina fiscal queda en estado pendiente o incierto, la operación queda bloqueada para reintento hasta reconciliar el trabajo. El ticket complementario se envía automáticamente a la impresora térmica después de guardar la venta. Se registra su estado como pendiente, enviado o incierto; si la impresora térmica falla, no se repite el cobro ni la factura fiscal y se exige consultar el equipo antes de reimprimir.

## Presentaciones de productos
- Cada producto conserva una presentación base y puede registrar otras (botella, lata, six-pack, caja, etc.).
- Cada presentación incluye nombre, unidad mostrada, factor de conversión a unidad base, código de barras opcional y precio de venta propio.
- Cuando el cajero selecciona un producto con varias presentaciones, el POS ofrece elegir la presentación. Si escanea un código de barras único asociado a una presentación, se agrega directamente esa presentación.
- El carrito conserva la cantidad de presentaciones y su factor; los importes se calculan con el precio de esa presentación.
- Stock, Kardex, inventario fiscal, ventas y devoluciones se registran en unidades base. Los documentos muestran cantidad y unidad de presentación.
- La validación de existencias agrega todas las presentaciones del mismo SKU; no permite vender cajas y unidades por encima de la existencia física.
- Las presentaciones históricas de ventas no se recalculan si posteriormente cambia el precio o el factor del catálogo.

## Importador universal e inicialización
- El botón **Cargar inventario maestro** acepta CSV, XLSX y JSON, detecta colecciones de productos en respaldos completos y permite mapear columnas.
- Si el respaldo contiene varias entidades, importar solo productos; ignorar clientes, proveedores, pagos, ventas, compras y demás colecciones en este asistente.
- Mostrar previsualización, conteo de filas, columnas mapeadas, errores, duplicados y resumen antes de escribir. Los duplicados por código o SKU se omiten sin sobrescribir.
- La primera importación aumenta únicamente inventario operativo y registra la apertura en Kardex; no crea movimientos fiscales.
- El botón **Auditoría fiscal inicial** permite seleccionar cantidades por producto y registrar la fecha y referencia exacta de la factura de compra. La cantidad validada no puede superar el stock físico menos el saldo fiscal ya existente. La inicialización fiscal no aumenta stock operativo.
- Las compras futuras con documento fiscal válido alimentan inventario operativo y libro fiscal en la misma transacción SQLite; compras sin respaldo solo alimentan inventario operativo.

## Criterios de aceptación
- Venta ticket, factura fiscal e híbrida se registran una sola vez y mantienen una sola relación de cobro.
- El modo híbrido asigna cantidades respaldadas a factura fiscal y el remanente al ticket. Cuando hay varias presentaciones, la separación conserva presentaciones completas y nunca duplica cantidades entre documentos.
- Fallos de impresora, timeout, reinicio o pérdida de LAN no duplican venta, cobro, número fiscal ni movimiento de inventario.
- Los totales de documentos hijos reconcilian con la venta padre, incluyendo IVA, IGTF, descuentos, pagos, crédito y vuelto. Cashea mixto permanece bloqueado explícitamente hasta su conciliación.
- El stock operativo final coincide con las unidades base vendidas; los movimientos del libro fiscal coinciden con las cantidades asignadas y sustentadas.
- Una venta con varias presentaciones descuenta el factor correcto y se refleja correctamente en Kardex, reportes, devoluciones y anulaciones.
- Los tickets no fiscales también quedan registrados en ventas, caja, IGTF y conciliación bancaria. Cuando consumen unidades con respaldo, el libro de inventario registra la salida correspondiente; una devolución interna restaura la porción respaldada.
- Pruebas automatizadas y de integración con SQLite temporal, impresora simulada y LAN antes de generar el instalador.
