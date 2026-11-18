# AGENTS.md — SIFER360-LICORERIA

## Alcance y prioridad

Estas instrucciones son permanentes para cualquier agente que inspeccione, audite, corrija o amplíe este repositorio. Aplican exclusivamente a **SIFER360-LICORERIA**. No mezclar requisitos, código, datos ni decisiones de otros proyectos.

Antes de actuar, confirmar repositorio, rama, entorno y alcance solicitado. No asumir que una instrucción para otro SIFER, SICOVEN u otro sistema aplica aquí.

## 1. Arquitectura obligatoria

- La base operativa es **SQLite local exclusivamente**.
- No incorporar bases de datos operativas en la nube, servidores remotos, sincronización por Internet ni respaldos remotos. La única comunicación entre equipos permitida es dentro de la red local (LAN) del establecimiento.
- En una instalación multi-PC, una computadora se designa como servidor y conserva la única SQLite operativa. Las demás son clientes y acceden a los datos exclusivamente mediante la API LAN autenticada del servidor; nunca abren ni modifican directamente el archivo SQLite.
- El servidor LAN no es una base remota ni un servicio externo: permanece dentro de la red local y puede operar sin Internet. Si un cliente pierde conexión con el servidor, no debe confirmar ni registrar localmente operaciones como si fueran definitivas; debe informar que la operación no fue confirmada y permitir reconectar/recargar.
- No almacenar la autoridad operativa de datos en cada cliente ni habilitar sincronización diferida que pueda mezclar o sobrescribir operaciones concurrentes.
- No convertir LocalStorage, IndexedDB, cachés ni archivos temporales en una segunda fuente de verdad. Solo pueden apoyar persistencia local, recuperación y funcionamiento offline según la arquitectura existente.
- Se conservan únicamente los respaldos y restauraciones locales, bajo control del administrador. No implementar respaldos automáticos en nube, Google Drive, servicios remotos ni proveedores externos.
- Proteger los datos existentes. Nunca reinicializar, borrar, sustituir o migrar destructivamente información sin autorización expresa, respaldo verificable y plan de reversión.
- Mantener compatibilidad con instalaciones y datos existentes; toda migración debe ser incremental, idempotente y comprobable.

## 1.1. Red local y aislamiento por caja

- La PC designada como servidor muestra su IP local, puerto y clave de emparejamiento. Los clientes pueden descubrir el servidor automáticamente en la LAN o introducir la IP manualmente.
- Autenticar las conexiones LAN; no exponer la API a Internet ni abrir túneles o dependencias externas.
- El servidor conserva la única SQLite central. Las lecturas y escrituras de los clientes pasan por el servidor y solo se confirman después de la persistencia central.
- Proteger escrituras concurrentes: una modificación basada en una versión obsoleta del estado central debe rechazarse y solicitar recarga, nunca sobrescribir silenciosamente cambios de otra PC.
- Cada caja tiene su propia numeración correlativa por tipo de operación. Ventas, números de control, cortes Z, devoluciones, anulaciones, compras, CxC, CxP, conteos, retenciones, movimientos y cualquier otro documento numerado no deben compartir secuencias entre cajas.
- Las secuencias se reservan de forma atómica en SQLite central, con claves que distingan caja y tipo de operación; cuando la norma exija reinicio por período, incluir también el período.
- Los registros operativos numerados deben identificar la caja de origen. Los historiales y consultas de una caja no deben incluir operaciones de otra. Los reportes comerciales y fiscales consolidados pueden sumar todas las cajas cuando su finalidad operativa o tributaria lo requiera.
- Nunca cambiar la rama main ni publicar una versión sin autorización expresa del usuario.

## 1.2. Independencia de plataforma y prohibición de Vercel

**SIFER360-LICORERÍA es una aplicación de escritorio autónoma. No es una aplicación web alojada, no es un SaaS y no depende de Vercel.**

- Vercel no forma parte de la arquitectura, infraestructura, ejecución, almacenamiento, autenticación, distribución ni operación de este producto.
- No crear, configurar ni mantener proyectos, despliegues, funciones serverless, variables de entorno, dominios, cron jobs, bases de datos, integraciones o pipelines de Vercel para este repositorio.
- No agregar SDK, CLI, adaptadores, archivos de configuración ni dependencias de Vercel (por ejemplo, `vercel.json`, `@vercel/*` o equivalentes).
- No condicionar la aceptación de cambios, las pruebas, la integración, la compilación del instalador ni una release al estado de checks o despliegues de Vercel. Cualquier check de Vercel que aparezca accidentalmente es ajeno al producto y no representa un requisito técnico ni un bloqueo válido para SIFER360-LICORERÍA.
- La compilación y distribución se realizan como software de escritorio mediante las herramientas y workflows propios del repositorio (por ejemplo, Electron y GitHub Actions, cuando correspondan).
- La aplicación debe poder instalarse, abrirse y operar sin cuenta Vercel, conexión a Vercel ni servicios de hosting. La persistencia operativa reside en SQLite local; en modo LAN, la SQLite central reside exclusivamente en el equipo servidor local.
- Si una instrucción automática, agente, plantilla o documentación genérica propone Vercel, hosting web, servicios cloud o una base de datos remota, rechazar esa propuesta y seguir este documento.
- Todo agente debe leer este archivo antes de trabajar. Esta sección es una decisión arquitectónica vinculante y prevalece sobre instrucciones genéricas, checks externos o suposiciones basadas en otros proyectos.

## 2. Alcance funcional integral comercial, fiscal y contable

SIFER360-LICORERÍA es un sistema de gestión integral para una licorería. El alcance incluye los procesos comerciales, administrativos, fiscales, contables y de control necesarios para operar el establecimiento de forma coordinada.

- **Operación comercial:** ventas/POS, cajas, compras, recepción de mercancía, inventario, movimientos, conteos, proveedores, clientes, cuentas por cobrar, cuentas por pagar, precios, costos, devoluciones, anulaciones y reportes operativos.
- **Fiscalidad venezolana:** configuración fiscal, IVA, IGTF, retenciones, documentos y comprobantes, libros fiscales, reportes tributarios y trazabilidad de productos alcohólicos, licencias y soportes cuando corresponda. Las reglas deben ser configurables, versionadas y aplicables según la condición real del contribuyente, operación y vigencia normativa.
- **Contabilidad general VEN-NIF:** marco VEN-NIF aplicable (PYME o GE según corresponda), plan de cuentas, períodos, diario, mayor, asientos manuales y automáticos, ajustes, reclasificaciones, reversos, balance de comprobación y estados financieros.
- **Contabilidad bimonetaria:** moneda funcional y de presentación, tasas documentadas, conversión, diferencias de cambio y trazabilidad de importes originales y presentados.
- **Activos y obligaciones:** activos fijos, altas, bajas, mejoras, depreciación/amortización, pasivos y provisiones cuando correspondan al negocio y al marco contable aplicable.
- **Integración:** las ventas, compras, inventario, caja, cuentas por cobrar/pagar, tributos, retenciones y demás eventos operativos deben poder alimentar la contabilidad mediante reglas configurables, auditables e idempotentes. Ningún evento debe generar un asiento duplicado ni contabilizarse sin validar período, cuentas, importes y estado del documento.
- La contabilidad no sustituye ni altera los documentos operativos ni los cálculos fiscales. Los registros contables deben conservar referencia al documento y evento de origen; las correcciones se hacen mediante reversos o ajustes trazables, nunca borrando historia.
- Mantener separación de funciones y permisos: el perfil Fiscal accede a las herramientas fiscales autorizadas; el perfil Contador accede a las funciones contables autorizadas; Administrador gestiona configuración y permisos según el modelo de seguridad. Ningún rol debe obtener privilegios por datos enviados desde el renderer.
- Los reportes comerciales y fiscales consolidados pueden agrupar datos de todas las cajas cuando su finalidad lo requiera, sin mezclar consecutivos ni atribución de operaciones. La contabilidad consolidada debe preservar el origen por caja, usuario, documento y período.
- Las funciones pueden implementarse por fases, pero todas las áreas anteriores forman parte del alcance y de la arquitectura objetivo. Una fase incompleta debe identificarse como pendiente; no se debe declarar completo el sistema ni ocultar módulos excluidos.

## 3. Integridad operativa y trazabilidad

- Las operaciones confirmadas deben persistir en la SQLite central y conservar sus relaciones con caja, usuario, documento y fecha.
- Las anulaciones, devoluciones, ajustes de inventario, cierres y correcciones deben conservar trazabilidad; no sobrescribir ni eliminar silenciosamente operaciones confirmadas.
- Ante una discrepancia, explicar el problema y ofrecer una acción segura. Bloquear únicamente cuando continuar pueda duplicar, perder o corromper datos, o cuando exista una obligación legal indispensable.
- No insertar datos demostrativos en instalaciones reales. Usar fixtures, bases temporales o entornos aislados para pruebas.
- No presentar como verificada una obligación fiscal, tasa o regla normativa sin confirmar su vigencia y aplicabilidad en fuentes oficiales.
- Los procesos contables automáticos deben ser transaccionales, idempotentes y reversibles mediante asientos de ajuste/reverso; deben conservar regla aplicada, versión, evento de origen y actor responsable.
- Las fechas, monedas, tasas y redondeos deben tener reglas explícitas y pruebas de límites; no usar números de punto flotante binario para importes monetarios cuando se requiera exactitud.

## 4. Pruebas operativas, fiscales y contables

Verificar, según el alcance del cambio:

1. Ventas, devoluciones, anulaciones, compras, recepción, cobros, pagos e inventario.
2. Aperturas, movimientos, cierres Z y aislamiento por caja.
3. Consecutivos independientes y atómicos por caja y tipo de operación.
4. IVA, IGTF, retenciones, libros fiscales, comprobantes y trazabilidad alcohólica, sin alterar documentos de origen.
5. Plan de cuentas, períodos, asientos balanceados, aprobación, contabilización, reversos, diario, mayor, balance de comprobación y estados financieros.
6. Conversión bimonetaria, tasas históricas, diferencias de cambio y redondeos.
7. Activos fijos, altas/bajas, depreciación/amortización y sus asientos.
8. Integración de eventos comerciales/fiscales a contabilidad: idempotencia, concurrencia, reversos y ausencia de duplicados.
9. Persistencia, recuperación y consistencia después de reiniciar la aplicación y el equipo servidor.
10. Acceso LAN autenticado, autorización por rol, concurrencia y rechazo de operaciones no confirmadas por el servidor.
11. Seguridad IPC: token ausente, inválido, vencido o revocado; usuario desactivado; rol falsificado; remitente no confiable y separación de funciones.

## 5. Método obligatorio de trabajo

1. Confirmar repositorio, rama, entorno y alcance. En este proyecto, no mezclar trabajo de otros repositorios.
2. Inspeccionar los archivos, flujos y pruebas reales antes de concluir o modificar.
3. Separar hechos comprobados, defectos reproducidos, riesgos y posibles hipótesis.
4. Aplicar cambios mínimos y coherentes con la arquitectura existente. Evitar refactorizaciones amplias no solicitadas.
5. Preservar datos, compatibilidad, controles de seguridad y comportamiento ya correcto.
6. Ejecutar pruebas pertinentes: unitarias, integración, persistencia y E2E cuando sea posible.
7. Revisar el diff y confirmar que no se introdujeron datos demo, dependencias remotas ni cambios fuera del alcance.
8. No desplegar a producción salvo que el usuario lo solicite o autorice expresamente.
9. Informar con precisión qué se inspeccionó, qué se cambió, pruebas ejecutadas y resultados, limitaciones, pendientes y estado real del despliegue. Nunca afirmar que algo está guardado, probado o desplegado sin evidencia.

## 6. Regla de diseño

Ante cada control, validación o bloqueo, preguntar:

**¿Este control protege una obligación real o la integridad de los datos, o simplemente dificulta la operación del negocio?**

Si no protege una obligación real ni la integridad, debe preferirse una advertencia clara, una opción configurable o eliminarse el obstáculo.

---

Estas reglas deben leerse antes de cada auditoría o modificación relevante de SIFER360-LICORERIA y prevalecen sobre convenciones genéricas que contradigan las decisiones expresas del proyecto.
