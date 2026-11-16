# Impresión dual y fiscal compartida por LAN

## Alcance

SIFER360 mantiene dos rutas separadas:

- **Ticket no fiscal:** impresora térmica local de Windows, envío ESC/POS RAW y configuración por caja. No emite una factura fiscal.
- **Factura fiscal:** adaptador del fabricante (SDK/puente/COM) y cola fiscal central cuando la instalación está conectada en modo LAN.

La selección del documento se hace en el cobro cuando el modo dual está activo. La caja, el cajero, los pagos, el inventario y los consecutivos operativos continúan siendo independientes por caja. La impresora fiscal compartida no combina cajas ni administra sus consecutivos POS.

## Topología fiscal LAN

1. Designar una PC como **servidor fiscal**. Debe permanecer encendida y conectada a la red local.
2. Conectar la impresora fiscal al servidor por el puerto admitido por el fabricante (COM/USB/serial o red).
3. Instalar en ese servidor el controlador, runtime, SDK y archivos del fabricante compatibles con la arquitectura de Windows/Electron.
4. Iniciar SIFER360 en modo servidor LAN y completar el emparejamiento seguro de cada terminal cliente usando la clave LAN y la huella TLS del servidor.
5. En el servidor, abrir Configuración fiscal y asociar el modelo, puerto y archivos SDK a cada caja que vaya a emitir documentos.
6. En cada terminal, elegir Factura fiscal al cobrar. El cliente envía la factura al servidor por HTTPS con TLS fijado y autenticación Bearer de la sesión LAN.

No se debe configurar la misma impresora fiscal como dispositivo local en cada terminal cliente. La comunicación física y el SDK se ejecutan exclusivamente en el servidor.

## Cola persistente

La cola se guarda en SQLite del servidor (tabla fiscal_network_jobs) y utiliza una clave idempotente única. El servidor registra el trabajo antes de ejecutar el SDK y procesa un único trabajo a la vez.

Estados:

- `pending`: persistido y en espera.
- `processing`: el servidor reservó el único turno y comenzó el intento.
- `issued`: el adaptador confirmó número de documento y serial fiscal.
- `rejected`: no se envió un comando por falta de configuración, o un administrador verificó físicamente que no se emitió.
- `uncertain`: se perdió la confirmación o el servidor se reinició durante el intento.

Un trabajo `processing` encontrado al reiniciar se convierte en `uncertain`. La cola queda bloqueada mientras exista una emisión incierta. No se reenvía automáticamente. El administrador debe consultar físicamente el último documento de la máquina y usar **Ver cola fiscal compartida LAN** para conciliar: confirmar documento emitido con número y serial, o confirmar que no se emitió. La segunda opción cierra el trabajo anterior como rechazado; si se requiere emitir, se registra una nueva operación con una nueva clave.

Si se confirma que la factura sí fue emitida, la terminal que conserva la intención local debe abrir la configuración fiscal y completar la conciliación local para reconstruir la venta, el kardex y el inventario en SQLite. No se debe repetir el cobro.

## Seguridad y límites

- La API de cola solo está disponible en el servidor LAN, protegida por el control de acceso de red, TLS y el token Bearer de emparejamiento.
- La conciliación requiere volver a introducir credenciales de un usuario administrador; el servidor valida el hash de contraseña.
- El token Bearer autentica el terminal emparejado; caja, cajero, terminal y venta se registran como metadatos de origen enviados por el POS. La administración local de usuarios y cajas sigue aplicando sus controles en cada terminal.
- La cola conserva terminal, caja, cajero y venta de origen como datos de auditoría. Los usuarios del servidor se sincronizan con SQLite para volver a validar las credenciales de administrador durante la conciliación.
- No se debe exponer el puerto LAN a Internet ni reenviarlo desde el router.
- El envío ESC/POS solo confirma que Windows recibió los bytes en su cola; no prueba que el papel haya salido.
- La emisión fiscal real requiere el modelo exacto, SDK y hardware del fabricante. Los tests simulados no sustituyen la certificación ni una prueba física.
