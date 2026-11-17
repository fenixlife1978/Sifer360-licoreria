# SIFER360-LICORERIA v1.0.6 — Impresoras duales y fiscal compartida por LAN

## Alcance

Esta guía describe la configuración de una impresora fiscal conectada al equipo servidor y de impresoras térmicas para tickets y documentos no fiscales. La comunicación entre estaciones se limita a la red local del establecimiento. SQLite del servidor es la única base operativa; no se utiliza Vercel, Internet ni una base de datos en la nube para emitir o registrar ventas.

## 1. Preparar el equipo servidor

1. Instale SIFER360 en la PC que conservará la base SQLite operativa.
2. Inicie SIFER360 con una cuenta administradora.
3. Abra **Configuración → Conexión entre PCs**.
4. Pulse **Designar este equipo como SERVIDOR**. El puerto predeterminado es `38760`; puede conservarlo si está disponible.
5. Anote la IP local, la clave de emparejamiento y la huella TLS SHA-256 que muestra la pantalla.
6. Mantenga esta PC encendida y conectada a la LAN mientras operen las estaciones cliente. No cambie ni copie manualmente la base SQLite a los clientes.

El servidor utiliza HTTPS dentro de la LAN, valida el token de emparejamiento y fija la huella TLS. No publique el puerto en Internet ni configure reenvíos del router.

## 2. Conectar cada estación cliente

1. Instale la misma versión de SIFER360 en la PC cliente.
2. Abra **Configuración → Conexión entre PCs**.
3. Pulse **Buscar servidores en la red** o escriba la IP local del servidor.
4. Introduzca el puerto, la clave mostrada en el servidor y la huella TLS SHA-256.
5. Compare la huella con la que aparece en la pantalla física del servidor antes de conectar.
6. Pulse **Conectar como CLIENTE y reiniciar SIFER**.
7. Inicie sesión con el usuario asignado a esa caja.

Un cliente no debe operar con su SQLite local como si fuera la base central. Si pierde conexión, la venta u operación no se confirma: reconecte con el servidor y verifique el estado antes de repetirla.

## 3. Configurar la impresora fiscal compartida

La impresora fiscal se conecta físicamente al equipo servidor. El servidor es el único que ejecuta comandos fiscales.

1. En el servidor, abra **Parámetros Fiscales → Impresora fiscal**.
2. Seleccione la caja que utilizará el dispositivo fiscal y el fabricante/modelo real.
3. Seleccione el puerto COM correcto cuando corresponda.
4. Configure únicamente el adaptador o SDK oficial/autorizado del fabricante. Para adaptadores externos, el protocolo de integración esperado es `sifer-fiscal-bridge/v1`.
5. Use **Detectar puertos**, **Probar puerto**, **Consultar estado fiscal PNP** o **Comprobar adaptador**, según el modelo. La prueba de puerto solo abre y cierra COM; no emite facturas.
6. Habilite y guarde el perfil para esa caja.
7. Repita la configuración para cada caja que deba emitir por la máquina compartida.

La detección USB-Serial identifica puertos y posibles chipsets/controladores; no identifica por sí sola el modelo fiscal ni acredita compatibilidad. No seleccione un fabricante basándose únicamente en VID/PID.

## 4. Configurar la impresora térmica no fiscal

1. En SIFER360, abra **Impresora térmica no fiscal**.
2. Seleccione la caja correspondiente.
3. Elija la impresora Windows instalada en esta estación. El perfil se guarda por estación y caja, de modo que cada PC puede usar su propia cola local aunque compartan la misma SQLite central.
4. Seleccione el ancho correcto: 58 mm (32 columnas) u 80 mm (42 o 48 columnas).
5. Habilite y guarde el perfil.
6. Pulse **Imprimir prueba** y compruebe físicamente el papel, la alineación y el corte.

La impresora térmica recibe trabajos ESC/POS RAW desde la cola de Windows. Se utiliza para tickets, comandas, copias y documentos no fiscales; nunca debe configurarse como sustituto de la impresora fiscal.

La configuración térmica nueva se guarda por identificador de estación y caja. Los perfiles antiguos guardados solo por caja se conservan como compatibilidad para instalaciones independientes. En modo LAN no se reutilizan como alternativa automática, para evitar que una estación envíe tickets a la cola Windows de otra PC.

## 5. Cómo se enrutan los documentos

- **Factura fiscal:** desde cualquier cliente se envía al servidor LAN; el servidor la transmite a la impresora fiscal configurada para la caja de origen.
- **Ticket o nota no fiscal:** se envía a la impresora térmica configurada; no ejecuta comandos fiscales.
- **Copia de una venta:** permanece identificada como copia interna y no se presenta como original fiscal.
- La selección del documento se realiza antes de confirmar el cobro. La ruta fiscal y la térmica son independientes.

## 6. Cola fiscal compartida y estados

El servidor conserva la cola en SQLite y procesa un solo comando fiscal a la vez. La clave idempotente evita registrar dos trabajos distintos para la misma solicitud. Una clave repetida con una factura diferente se rechaza.

| Estado | Significado | Acción segura |
|---|---|---|
| Pendiente | Trabajo durable en espera | Actualizar la cola; no volver a cobrar ni reenviar |
| Procesando | El servidor está transmitiendo | Esperar y consultar el estado |
| Emitida | El adaptador confirmó número fiscal y serial | Verificar que la venta local quedó conciliada |
| Incierta | No se pudo determinar si la máquina emitió | Detener nuevos envíos y consultar físicamente la máquina |
| Rechazada | El servidor rechazó el trabajo antes de emitir | Corregir la causa antes de iniciar una nueva operación |

Si el cliente agota su tiempo de consulta mientras el servidor sigue procesando, el trabajo local permanece pendiente. No repita el cobro. Actualice la cola y espere el resultado.

Si un envío queda **incierto**, el servidor bloquea nuevos envíos para evitar duplicados. Un administrador debe consultar físicamente el último documento de la máquina y conciliar la operación:
- **Confirmar emitida:** introducir el número exacto de documento y serial fiscal; SIFER reconstruye/actualiza la venta y el inventario desde la intención durable.
- **Confirmar no emitida:** solo después de verificar que no existe documento en la máquina; se libera la cola y se permite iniciar una nueva operación.

Si el servidor se reinicia durante una transmisión, el trabajo pasa a incierto y no se reenvía automáticamente.

## 7. Pruebas antes de operar

### Pruebas automatizadas

La compilación CI ejecuta `npm test`, validaciones sintácticas y empaquetado Windows. Las pruebas de la cola verifican serialización, idempotencia, bloqueo ante incertidumbre, recuperación tras reinicio y conciliación manual.

### Pruebas físicas obligatorias en el establecimiento

1. Conectar la térmica a una estación y verificar ticket, ancho, caracteres, avance y corte.
2. Conectar la fiscal al servidor y verificar el estado físico sin emitir.
3. Conectar dos clientes simultáneamente y confirmar que ambos llegan al mismo servidor.
4. En un entorno autorizado, ejecutar operaciones reales controladas desde ambas estaciones y verificar que la fiscal nunca recibe dos comandos simultáneos.
5. Confirmar número de documento, serial, caja, cajero y terminal en el papel y en SQLite.
6. Interrumpir la conexión de un cliente antes de confirmar una operación y verificar que no se presenta como venta confirmada.
7. Simular pérdida de respuesta durante una emisión solo con un procedimiento de prueba autorizado; verificar que no hay reenvío automático y que la conciliación funciona.
8. Reiniciar el servidor con una operación pendiente/incierta de prueba y comprobar la recuperación de la cola.
9. Comprobar que los consecutivos de ventas y demás operaciones permanecen independientes por caja.

No utilice facturas ficticias ni emita documentos de prueba en una máquina fiscal productiva sin autorización y procedimiento fiscal válido. Registre las pruebas físicas realizadas, el modelo/serial de cada equipo y el resultado observado.

## 8. Límites de esta entrega

La aprobación de CI y la generación de instalador/portable no sustituyen la prueba física con los modelos de impresora del establecimiento. La compatibilidad final depende del modelo fiscal, firmware, puerto, controlador y adaptador autorizado disponibles. Hasta completar la prueba con dos PCs y ambos dispositivos reales, la instalación debe considerarse pendiente de validación operativa.
