# AGENTS.md — SIFER360-LICORERIA

## Alcance y prioridad

Estas instrucciones son permanentes para cualquier agente que inspeccione, audite, corrija o amplíe este repositorio. Aplican exclusivamente a **SIFER360-LICORERIA**. No mezclar requisitos, código, datos ni decisiones de otros proyectos.

Antes de actuar, confirmar repositorio, rama, entorno y alcance solicitado. No asumir que una instrucción para otro SIFER, SICOVEN u otro sistema aplica aquí.

## 1. Arquitectura obligatoria

- La base operativa es **SQLite local exclusivamente**.
- No incorporar nube, bases de datos remotas, servidores externos ni sincronización por Internet. La única comunicación entre equipos permitida es dentro de la red local (LAN) del establecimiento.
- En una instalación multi-PC, una computadora se designa como servidor y conserva la única SQLite operativa. Las demás son clientes y acceden a los datos exclusivamente mediante la API LAN autenticada del servidor; nunca abren ni modifican directamente el archivo SQLite.
- El servidor LAN no es una base remota ni un servicio externo: permanece dentro de la red local y puede operar sin Internet. Si un cliente pierde conexión con el servidor, no debe confirmar ni registrar localmente operaciones como si fueran definitivas; debe informar que la operación no fue confirmada y permitir reconectar/recargar.
- No almacenar la autoridad operativa de datos en cada cliente ni habilitar sincronización diferida que pueda mezclar o sobrescribir operaciones concurrentes.
- No convertir LocalStorage, IndexedDB, cachés ni archivos temporales en una segunda fuente de verdad. Solo pueden apoyar persistencia local, recuperación y funcionamiento offline según la arquitectura existente.
- Los respaldos y restauraciones son locales y quedan bajo control del cliente: pendrives, discos externos u otros medios que el cliente administre.
- No proponer ni implementar copias de seguridad en nube o remotas.
- Proteger los datos existentes. Nunca reinicializar, borrar, sustituir o migrar destructivamente información sin autorización expresa, respaldo verificable y plan de reversión.
- Mantener compatibilidad con instalaciones y datos existentes; toda migración debe ser incremental, idempotente y comprobable.

## 1.1. Red local y aislamiento por caja

- La PC designada como servidor muestra su IP local, puerto y clave de emparejamiento. Los clientes pueden descubrir el servidor automáticamente en la LAN o introducir la IP manualmente.
- Autenticar las conexiones LAN; no exponer la API a Internet ni abrir túneles o dependencias externas.
- El servidor conserva la única SQLite central. Las lecturas y escrituras de los clientes pasan por el servidor y solo se confirman después de la persistencia central.
- Proteger escrituras concurrentes: una modificación basada en una versión obsoleta del estado central debe rechazarse y solicitar recarga, nunca sobrescribir silenciosamente cambios de otra PC.
- Cada caja tiene su propia numeración correlativa por tipo de operación. Ventas, números de control, cortes Z, devoluciones, anulaciones, compras, CxC, CxP, conteos, retenciones, movimientos y cualquier otro documento numerado no deben compartir secuencias entre cajas.
- Las secuencias se reservan de forma atómica en SQLite central, con claves que distingan caja y tipo de operación; cuando la norma exija reinicio por período, incluir también el período.
- Los registros operativos numerados deben identificar la caja de origen. Los historiales y consultas de una caja no deben incluir operaciones de otra. Los reportes fiscales o financieros consolidados de la entidad sí pueden sumar todas las cajas cuando su finalidad contable lo requiera.
- Nunca cambiar la rama main ni publicar una versión sin autorización expresa del usuario.
## 2. Principio rector del módulo fiscal y contable

SIFER debe ser una herramienta práctica para el contador público independiente que lleva la contabilidad de varias pequeñas y medianas empresas en Venezuela. Priorizar facilidad de uso, flexibilidad profesional, eficiencia e integridad contable.

El contador es el único responsable y usuario operativo del módulo fiscal y contable. No crear roles adicionales ni flujos burocráticos de solicitante, revisor, aprobador, autorizador o ejecutor. No exigir expedientes, hojas de trabajo, adjuntos, autorizaciones de terceros ni justificaciones extensas como condición general para operar.

No modificar el flujo de acceso inicial para introducir estos controles.

## 3. Autonomía profesional del contador

El contador debe poder actuar directamente, dentro de los permisos que ya tenga el sistema, para:

- Consultar y revisar operaciones, documentos, asientos, libros, reportes y períodos.
- Registrar, editar, ajustar, reclasificar y corregir información contable.
- Crear, ampliar, modificar y desactivar cuentas contables, preservando la integridad y los históricos.
- Configurar las cuentas de integración y criterios contables.
- Cerrar períodos y, cuando sea necesario, reabrirlos directamente con trazabilidad.
- Corregir errores detectados durante la revisión sin depender de una cadena de aprobaciones.

La aplicación debe facilitar el criterio profesional, no sustituirlo mediante bloqueos preventivos excesivos.

## 4. Integridad: advertir primero, bloquear solo cuando sea indispensable

Usar advertencias claras y acciones de resolución para las situaciones que admiten criterio profesional. Bloquear únicamente cuando continuar comprometa la integridad de los datos, produzca una contabilización matemáticamente inválida o infrinja una obligación legal indispensable.

Ejemplos obligatorios:

- **Asiento descuadrado:** impedir su contabilización definitiva; mostrar debe, haber y diferencia, y permitir corregir el asiento.
- **Posible duplicado:** advertir, mostrar las coincidencias relevantes y permitir que el contador determine si se trata de una operación distinta.
- **Cuenta inexistente:** facilitar crearla o seleccionar una cuenta válida; no dejar al contador sin salida.
- **Período cerrado:** permitir al contador reabrirlo directamente, dejando registro automático de la reapertura y de las operaciones posteriores.
- **Diferencia o inconsistencia no crítica:** advertir y explicar; no bloquear automáticamente.
- **Dato obligatorio para integridad:** solicitar solo el dato indispensable, explicando por qué se necesita y ofreciendo una vía directa para completarlo.

No convertir recomendaciones, preferencias de configuración ni controles internos opcionales en prohibiciones legales ficticias.

## 5. Trazabilidad y conservación de la historia

Las correcciones deben conservar automáticamente una pista de auditoría suficiente, sin crear expedientes manuales. Cuando estén disponibles, registrar:

- Valor o documento original.
- Valor o documento corregido.
- Fecha y hora.
- Usuario/contador que ejecutó el cambio, según la identidad existente.
- Operación, documento o registro relacionado.
- Motivo breve, cuando sea necesario o el usuario lo indique.

No sobrescribir silenciosamente historia contable ni eliminar evidencia de operaciones contabilizadas. Preferir reversos, ajustes o mecanismos de corrección que mantengan el rastro original. Evitar exigir adjuntos o textos extensos salvo que exista una obligación real.

## 6. Criterios contables y normativa venezolana

- Distinguir el marco aplicable a entidades VEN-NIF GE y VEN-NIF PYME; no asumir que todas las entidades usan el mismo marco.
- Antes de emitir conclusiones normativas o implementar reglas basadas en VEN-NIF, verificar los boletines, normas y pronunciamientos vigentes en fuentes oficiales de la FCCPV.
- Identificar claramente qué es requisito legal/normativo, qué es política contable elegida por la entidad y qué es recomendación del sistema.
- No presentar como vigente una norma, boletín, versión, tasa o criterio sin verificar su vigencia y aplicabilidad.
- Cuando falte información para determinar el marco aplicable, advertirlo y permitir que el contador configure el criterio correspondiente.

## 7. Alcance mínimo de una auditoría contable integral

No limitar una auditoría a revisar pantallas, botones, nombres de módulos, configuraciones o pruebas unitarias aisladas. Inspeccionar el código real y verificar, según el alcance del sistema:

1. Plan de cuentas: estructura jerárquica, niveles, cuentas imputables, naturaleza, clasificación y consistencia de padres/hijos.
2. Asientos: partida doble, validaciones, fechas, períodos, estados, edición, reversos y trazabilidad.
3. Integración real de operaciones POS: ventas, devoluciones, compras, pagos, cobros, caja e inventario, además de CxC y CxP cuando corresponda.
4. Libros: diario y mayor, con movimientos y saldos conciliables.
5. Balance de comprobación y estados financieros construidos a partir de los movimientos contables reales.
6. Estado de situación financiera y estado de resultados; resultados acumulados y cambios patrimoniales cuando correspondan.
7. Flujo de efectivo real, por método directo o indirecto según corresponda. No llamar “flujo de efectivo” a una simple lista de saldos de caja o bancos.
8. Activos fijos: altas, costo, vida útil, valor residual, depreciación, deterioro, bajas, ventas, retiros y cambios de estimaciones, distinguiendo efectos contables y fiscales cuando aplique.
9. Ciclo contable: saldos iniciales/apertura, ajustes, cierres mensuales y anuales, traslado de resultados, reapertura y revisión de cierre.
10. Moneda extranjera, tasas de conversión, impuestos y retenciones según el alcance funcional y normativa vigente.
11. Persistencia y recuperación: comprobar que las operaciones sobreviven recargas y reinicios y que SQLite conserva datos coherentes.

Comprobar relaciones entre módulos y evitar declarar una integración funcional solo porque exista una opción de configuración o un campo de referencia.

## 8. Pruebas contables de extremo a extremo

Cuando el entorno y los datos de prueba lo permitan, seguir al menos un caso completo desde el documento/operación fuente hasta:

**operación POS o documento → asiento → diario → mayor → balance de comprobación → estado financiero correspondiente.**

Conciliar importes, fechas, cuentas, impuestos, saldos y referencias. Incluir pruebas de corrección/reverso y persistencia cuando sean relevantes.

No insertar datos demostrativos en producción. Usar fixtures, bases temporales o entornos de prueba aislados. Si no es posible ejecutar una prueba E2E, declararlo expresamente y no presentar la funcionalidad como verificada.

## 9. Método obligatorio de trabajo

1. Confirmar repositorio, rama, entorno y alcance. En este proyecto, no mezclar trabajo de otros repositorios.
2. Inspeccionar los archivos, flujos y pruebas reales antes de concluir o modificar.
3. Separar hechos comprobados, defectos reproducidos, riesgos y posibles hipótesis.
4. Aplicar cambios mínimos y coherentes con la arquitectura existente. Evitar refactorizaciones amplias no solicitadas.
5. Preservar datos, compatibilidad, controles de seguridad y comportamiento ya correcto.
6. Ejecutar pruebas pertinentes: unitarias, integración, persistencia y E2E cuando sea posible.
7. Revisar el diff y confirmar que no se introdujeron datos demo, dependencias remotas ni cambios fuera del alcance.
8. No desplegar a producción salvo que el usuario lo solicite o autorice expresamente.
9. Informar con precisión qué se inspeccionó, qué se cambió, pruebas ejecutadas y resultados, limitaciones, pendientes y estado real del despliegue. Nunca afirmar que algo está guardado, probado o desplegado sin evidencia.

## 10. Regla de diseño

Ante cada control, validación o bloqueo, preguntar:

**¿Este control protege una obligación real o la integridad de los datos, o simplemente le pone obstáculos al contador?**

Si no protege una obligación real ni la integridad, debe preferirse una advertencia clara, una opción configurable o eliminarse el obstáculo.

---

Estas reglas deben leerse antes de cada auditoría o modificación relevante de SIFER360-LICORERIA y prevalecen sobre convenciones genéricas que contradigan las decisiones expresas del proyecto.
