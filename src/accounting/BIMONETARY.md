# Política de contabilidad bimonetaria

## Conceptos

- **Moneda funcional:** moneda del entorno económico principal en el que opera la entidad. No se presupone que sea VES ni USD; debe documentarse y aprobarse.
- **Moneda de presentación:** moneda en la que la entidad presenta sus estados financieros. Puede coincidir con la funcional.
- **Dirección de la tasa:** unidades de moneda de presentación por cada 1 unidad de moneda funcional. Si la fuente publica la cotización inversa, debe calcularse y documentarse su inversa antes de capturarla.
- **Importes:** se almacenan como unidades menores enteras. La conversión utiliza fracciones racionales y redondeo half-up; no usa coma flotante para el cálculo.

## Evidencia y trazabilidad

Cuando las monedas son distintas, cada borrador de asiento exige:

1. Tasa explícita y positiva.
2. Tipo: oficial, mercado, contractual o ajuste contable.
3. Nombre de la fuente.
4. Referencia documental.
5. Fecha del asiento.

La tasa y sus datos se registran en `accounting_exchange_rates`; el asiento conserva su propio snapshot de tasa e importes de presentación. Los reversos conservan el snapshot del original y revierten los importes en ambas monedas. Una tasa idéntica con la misma fecha, par, tipo y referencia se reutiliza; una referencia repetida con otro valor se rechaza.

## Controles

- El Debe y el Haber deben cuadrar en moneda funcional y de presentación.
- Una diferencia causada por redondeo no se oculta ni se ajusta automáticamente. Debe documentarse un renglón explícito de ajuste antes de aprobar.
- No se inventan tasas para asientos históricos. Los registros históricos sin conversión se identifican como pendientes y no se presentan como si tuvieran importes válidos en moneda de presentación.
- Los asientos aprobados y contabilizados mantienen inmutables las tasas y los importes.

## Alcance actual y trabajo pendiente

La implementación actual cubre la captura bimonetaria de asientos manuales, snapshots, reversos, historial de tasas y balance de comprobación en ambas monedas.

Esto **no equivale todavía a la traducción integral de estados financieros** exigida por el marco contable aplicable cuando la moneda funcional y la de presentación difieren. Antes de declarar esa parte terminada deben aprobarse e implementarse políticas por clase de partida y fecha, incluyendo tasas de cierre, históricas y de transacción, diferencias de conversión y su presentación contable (por ejemplo, el tratamiento correspondiente en otro resultado integral cuando aplique). Tampoco están convertidos automáticamente los eventos POS: primero deben aprobarse las reglas de contabilización y la moneda/tasa de cada operación de origen.

La tasa oficial no se descarga ni se presume automáticamente. El contador debe verificar la fuente, la fecha, la política aplicable y el soporte antes de aprobar el asiento.
