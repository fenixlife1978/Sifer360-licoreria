# Paridad funcional de Contabilidad SIFER360 LICORERÍA con SICOVEN

## Alcance y reglas de diseño

Este documento registra la auditoría funcional del módulo `public/accounting.js` y organiza la ampliación solicitada. No declara paridad total con SICOVEN hasta completar la comparación funcional y las pruebas de cada flujo.

- Persistencia operativa: SQLite local de SIFER360; la contabilidad no dependerá de LocalStorage como fuente de verdad.
- Monedas admitidas: bolívares (BS.) y dólares estadounidenses (USD). No incorporar EUR.
- Las cuentas padre son agrupadoras y nunca reciben movimientos directos.
- Todo banco, caja, inversión u otro auxiliar que requiera saldo propio debe tener cuenta imputable individual.
- Los asientos originales son inmutables: las correcciones se realizan con reversión y asiento sustituto, conservando trazabilidad.
- No contabilizar automáticamente operaciones que no tengan reglas contables configuradas y validadas.

## Funciones ya presentes en CONTABILIDAD

| Área | Situación auditada |
|---|---|
| Plan contable VEN-NIF | Catálogo predeterminado de 97 cuentas; jerarquía y distinción entre agrupadoras e imputables. La interfaz actual consulta, pero no ofrece administración completa del catálogo. |
| Libro diario | Asientos manuales en BS. y USD, secuencia, referencia, descripción, balance Debe/Haber y reversión conservando el original. |
| Libro mayor | Consulta de movimientos por cuenta y saldos acumulados. |
| Balance de comprobación | Sumas Debe/Haber en ambas monedas y exportación CSV. |
| Estados financieros | Situación financiera, resultados y flujo de efectivo simplificado, con fecha de corte y exportación CSV. |
| Activos fijos | Alta, vida útil, valor residual y depreciación mensual automática con asiento. |
| Integración POS | Mapeo de medios de pago y cuentas de inventario, costo, ingresos, IVA, IGTF, CxC y CxP. La configuración existe, pero no equivale todavía a una contabilización integral y conciliada de todos los submódulos. |

## Tesorería bancaria incorporada en esta rama

- Crear bancos desde la interfaz de Tesorería.
- Seleccionar únicamente BS. o USD.
- Generar automáticamente una cuenta auxiliar consecutiva y vinculada al banco.
- Usar como cuentas padre SICOVEN:
  - `1.1.1.06` — Bancos Nacionales en Bolívares (BS.).
  - `1.1.1.07` — Bancos en Moneda Extranjera (USD).
- Mantener las cuentas padre como agrupadoras no imputables.
- Guardar banco, tipo de cuenta, titular, identificación opcional, número bancario y referencia; mostrar el número parcialmente enmascarado.
- Activar/desactivar bancos sin borrar su auxiliar ni el historial cuando ya tengan movimientos.
- Las auxiliares quedan disponibles en los selectores de cuentas imputables de la integración POS.

### Compatibilidad con instalaciones existentes

El catálogo SIFER ya distribuido contiene dos agrupadoras bancarias históricas en `1.1.1.03` y `1.1.1.04`. No se renumeran ni se eliminan automáticamente porque podrían existir referencias contables históricas. La rama añade las cuentas padre SICOVEN `.06` y `.07` y crea los nuevos bancos bajo estas. Se debe revisar en una migración posterior la presentación de las agrupadoras históricas para evitar confusión, sin romper asientos existentes.

## Brechas funcionales frente al alcance SICOVEN que deben completarse

### 1. Tesorería y bancos
- Ficha completa de banco y cuentas auxiliares, edición segura y consulta histórica.
- Registrar depósitos, retiros, transferencias entre bancos propios, comisiones, intereses y notas bancarias.
- Transferencias entre monedas con tasa, contrapartida y diferencia cambiaria explícitas; no asumir equivalencia.
- Libro auxiliar de cada banco y saldo disponible por moneda.
- Conciliación bancaria por período: carga CSV, captura manual, emparejamiento, diferencias, partidas pendientes, ajustes y cierre conciliado.
- Impedir que la misma operación se concilie dos veces y conservar evidencia/auditoría de cada emparejamiento.
- Los movimientos deben producir asientos balanceados contra la auxiliar correcta; las transferencias internas no deben inflar los flujos de efectivo.

### 2. Caja y efectivo
- Auxiliares por caja y moneda, vinculados con las cajas operativas del POS.
- Aperturas, cierres, arqueos, diferencias, depósitos a banco y retiros.
- Conciliación del saldo contable de caja con los cierres POS, sin duplicar ventas ni cobros ya contabilizados.

### 3. Cuentas por cobrar
- Auxiliar por cliente y documento; saldos, anticipos y notas de crédito.
- Registro de cobros parciales/totales, aplicación a facturas, retenciones, descuentos y diferencias cambiarias.
- Antigüedad de saldos, vencimientos, estado de cuenta y exportación.
- Integración trazable con ventas POS y notas de crédito.

### 4. Cuentas por pagar
- Auxiliar por proveedor y documento; anticipos, notas de débito/crédito y retenciones.
- Pagos parciales/totales, aplicación a facturas y saldos pendientes.
- Antigüedad, vencimientos y estado de cuenta.
- Integración con compras y pagos, evitando duplicar asientos.

### 5. Inventarios y costo de ventas
- Conciliar inventario auxiliar con existencias y valoración del POS.
- Definir y documentar método de costo y tratamiento de ajustes, mermas, vencimientos y devoluciones.
- Generar asientos por compras, ventas, costo de ventas y ajustes una sola vez, con referencia al documento fuente.
- Reportar diferencias entre existencia física, auxiliar y saldo contable.

### 6. Inversiones y otras obligaciones
- Auxiliares de inversiones por instrumento, moneda, fecha, vencimiento y rendimiento.
- Registro de colocaciones, rescates, intereses y valoración con asientos asociados.
- Submayores de obligaciones tributarias, laborales, financieras y otras cuentas por pagar.
- Calendario de vencimientos y reportes de saldos, sin imponer aprobaciones burocráticas al contador.

### 7. Plan de cuentas y herramientas del contador
- Crear cuentas hijas/auxiliares, editar denominaciones y activar/desactivar cuentas sin borrar historia.
- Validar código único, padre existente, jerarquía, tipo y naturaleza.
- Reasignar cuentas de integración con vista previa del impacto; no cambiar asientos históricos en silencio.
- Saldos iniciales y asientos de apertura por moneda, con contrapartida y fecha.
- Cierres de período, reapertura controlada y asiento de cierre/apertura.
- Auditoría de usuario, fecha, origen POS/Tesorería/manual, documento vinculado y reversión.
- Reportes imprimibles y exportables (CSV y, en una fase posterior, XLSX/PDF).

## Orden recomendado de ejecución

1. Completar y probar alta/edición de bancos y auxiliares; validar persistencia SQLite, consecutivos y compatibilidad con instalaciones que ya tienen el catálogo cargado.
2. Movimientos de Tesorería y conciliación bancaria.
3. Caja contable vinculada con cierres POS.
4. Submayores de CxC y CxP.
5. Integración de inventario/costo de ventas y reglas de contabilización por evento.
6. Inversiones y obligaciones.
7. Administración completa del plan, saldos iniciales, cierres y auditoría ampliada.
8. Matriz de pruebas de estados financieros y conciliación integral.

## Criterios de aceptación transversales

- No se pierde ni modifica silenciosamente ningún asiento histórico.
- Cada asiento debe cuadrar por moneda y conservar tasa, referencia y origen.
- No se mezclan Bs. y USD ni se inventan conversiones.
- Cuentas agrupadoras no admiten imputación directa.
- Una operación POS/Tesorería solo se contabiliza una vez, incluso ante reintentos.
- SQLite confirma la persistencia antes de informar éxito.
- Los saldos de bancos, cajas, CxC, CxP e inventario se pueden rastrear hasta sus documentos y movimientos auxiliares.


## Dashboard del contador y Libro de Movimientos de Mercancía (nuevo alcance SIFER360-LICORERIA)

### Accesos directos en la toolbar del dashboard del contador
- Añadir accesos directos visibles a Compras, Inventario, Cuentas por Cobrar (CxC), Cuentas por Pagar (CxP) y Libro de Movimientos de Mercancía.
- Los accesos deben abrir los módulos existentes del POS, respetando permisos y sesión del usuario; no duplicar pantallas ni crear rutas paralelas innecesarias.
- Mantener la toolbar usable en resoluciones pequeñas: icono y etiqueta legible, sin desbordamiento horizontal; si no cabe, usar distribución adaptable o menú de más opciones.
- Mostrar el acceso al libro de mercancía como módulo propio del POS, no como un reporte contable aislado.

### Libro de Movimientos de Mercancía dentro del POS
- Crear un libro cronológico consultable de todos los movimientos reales de inventario.
- Incluir entradas por compras/recepciones, salidas por ventas, devoluciones de clientes y a proveedores, ajustes, traslados si existen ubicaciones, mermas/pérdidas, vencimientos y demás tipos que el POS realmente soporte.
- Cada fila debe conservar vínculo navegable al documento u operación de origen, fecha/hora, SKU/código, descripción, cantidad con signo, unidad, tipo, saldo resultante cuando pueda reconstruirse con certeza y usuario/terminal de origen si están disponibles.
- Filtros por período, artículo, código, tipo de movimiento, documento y usuario; búsqueda rápida y exportación CSV imprimible.
- Orden cronológico estable y detalle de movimientos; no presentar saldos reconstruidos si faltan eventos históricos necesarios.
- El libro es estrictamente de consulta/auditoría: no modifica existencias ni crea movimientos. Toda corrección se ejecuta desde la operación funcional correspondiente y queda registrada como nuevo evento, nunca reescribiendo el pasado.
- Cada operación fuente debe generar un solo evento de inventario, con clave de idempotencia o referencia única para impedir duplicados ante reintentos.
- La fuente de verdad es SQLite local. No usar LocalStorage como autoridad ni generar datos de demostración.
- Si una operación antigua no tiene detalle suficiente, identificarla como dato histórico incompleto en vez de inventar cantidad, usuario o documento.

### Pruebas de aceptación del nuevo alcance
- Los cinco accesos del contador abren el módulo correcto y respetan roles/permisos.
- La toolbar se adapta a escritorio y ventanas estrechas sin ocultar accesos ni desbordarse.
- Compras, ventas, devoluciones, ajustes y pérdidas soportados generan el movimiento correcto exactamente una vez.
- Los filtros y exportaciones coinciden con el conjunto consultado y conservan referencias de origen.
- La consulta no altera existencias, documentos, caja ni asientos.
- Se verifica persistencia SQLite, trazabilidad, orden cronológico y conservación del historial tras reinicio.

## Orden de ejecución actualizado

1. Completar y validar movimientos bancarios y conciliación.
2. Implementar toolbar del dashboard del contador con los cinco accesos solicitados.
3. Crear el Libro de Movimientos de Mercancía en el POS y probar su integración con cada operación real de inventario.
4. Continuar caja contable, submayores CxC/CxP, costo de ventas, inversiones y obligaciones, y administración del plan contable.
