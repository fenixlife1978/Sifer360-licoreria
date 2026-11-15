# Impresoras fiscales multimarca — SIFER360-LICORERIA

## Objetivo y alcance

El módulo separa la lógica comercial del POS de los protocolos de cada fabricante. La configuración se guarda en el estado operativo SQLite (por caja), mientras que la comunicación con el dispositivo se ejecuta en el equipo Electron al que está conectado físicamente. El flujo de venta en modalidad Máquina Fiscal consulta el adaptador, persiste una intención idempotente antes de enviar la factura y solo confirma la venta después de recibir el número fiscal y serial de la máquina.

Familias contempladas:

| Familia | SDK / archivos de referencia | Observaciones |
|---|---|---|
| The Factory HKA | TfhkaNet.dll, tfhkaif.dll, IntTFHKA.exe | Confirmar DLL, versión, arquitectura y modelo con el soporte oficial. |
| Bematech | BemaFI32.dll, BemaFI64.dll, BemaFI32.ini | Seleccionar el SDK compatible con 32/64 bits y el modelo exacto. |
| Epson Fiscal | EpsonFiscalInterface.dll | La interfaz y los comandos dependen del modelo/país. |
| Quorion | QProg.dll (pendiente de confirmar) o protocolo del modelo | La página pública de Quorion ofrece QMP Programming Software y manuales; no se ha validado que QProg.dll sea un SDK redistribuible. No asumir que todos los equipos aceptan el mismo protocolo serial. |
| Aclas | AclasSDK.dll | Confirmar versión del SDK y protocolo con el distribuidor. |
| PNP | pnpdll.dll / pnpdll64.dll o protocolo serial PNP 0141 | El fabricante publica pnpdll2025a.zip y PROTOCOLO0141.pdf; documenta además una DLL x64 en pnpdll2022.zip. PF-SUNMI usa USB CDC serial, RS232 opcional y Wi-Fi; no todos los modelos usan el mismo cable/controlador. |
| Hasar | SDK/protocolo específico del distribuidor | No se presupone un nombre de DLL; requiere puente específico y manual del modelo. |

La lista de marcas/modelos es un catálogo de integración solicitado, no una certificación de homologación vigente. Las cuotas de mercado indicadas en la solicitud (70/15–20/10 y más de 95% de cobertura) no se consideran cifras verificadas y no se usan para prometer compatibilidad. Antes de activar facturación fiscal, verificar el modelo exacto, serial, representante y autorización aplicable ante SENIAT y el fabricante.

## Adaptadores

El módulo electron/fiscal-printer-manager.cjs proporciona:
- catálogo de fabricantes y SDK esperados;
- validación de puerto COM y parámetros seriales;
- detección de puertos COM en Windows;
- prueba de apertura/cierre del puerto sin enviar comandos;
- verificación de presencia de SDK;
- invocación de un puente externo del fabricante, sin cargar DLL arbitrarias dentro del proceso principal Electron;
- validación de la respuesta de emisión (número fiscal y serial de máquina).

La pantalla de configuración se abre desde Fiscal → Parámetros Fiscales → Configurar impresora fiscal de esta caja. La configuración incluye modelo exacto, COM, baudios, bits, paridad, timeout, SDK, ejecutable puente y prueba de conexión. Los perfiles se guardan por caja en SQLite.

### Contrato del puente externo

El ejecutable configurado como bridgePath debe aceptar por stdin una única línea JSON:

~~~json
{
  "protocol": "sifer-fiscal-bridge/v1",
  "action": "status | test | emitInvoice",
  "requestId": "identificador",
  "config": {
    "provider": "hka",
    "model": "HKA80",
    "port": "COM4",
    "baudRate": 9600,
    "dataBits": 8,
    "parity": "none",
    "stopBits": 1,
    "sdkPaths": {}
  },
  "payload": {}
}
~~~

Debe devolver por stdout una sola línea JSON, con código de salida cero:

~~~json
{
  "protocol": "sifer-fiscal-bridge/v1",
  "ok": true,
  "fiscalDocumentNumber": "número devuelto por la máquina",
  "fiscalSerial": "serial leído de la máquina",
  "deviceConnected": true,
  "fiscalReady": true,
  "canEmitFiscalDocuments": true
}
~~~

Para la acción status, el puente debe consultar el dispositivo físico y devolver `deviceConnected: true`, `fiscalReady: true` y `canEmitFiscalDocuments: true` solo cuando las tres condiciones estén verificadas en el equipo. Estos indicadores son obligatorios para habilitar Contabilidad. Para emitInvoice, el puente debe ser idempotente por requestId, validar los límites del equipo y devolver el número real asignado por la máquina. Nunca debe simular una emisión exitosa ni imprimir un ticket comercial como sustituto de un documento fiscal.

Los SDK de cada familia tienen APIs distintas. No se debe fabricar un puente genérico que envíe tramas inventadas a todos los modelos. Cada implementación HKA, Bematech, Epson, Quorion, Aclas o PNP debe compilarse y probarse con el SDK/manual original y con equipos físicos.

## Control de emisión y seguridad

- La prueba COM solo abre y cierra el puerto; no ejecuta comandos fiscales ni modifica memoria fiscal.
- Un timeout durante emisión deja el resultado potencialmente incierto. El POS conserva la venta propuesta, bloquea nuevas emisiones de esa caja y ofrece conciliación manual al administrador: confirmar número/serial si la factura sí existe o marcarla como no emitida solo después de comprobar físicamente la máquina.
- Una factura emitida por máquina fiscal no puede anularse únicamente en el POS. La anulación/nota de crédito en la máquina debe integrarse con un comando específico del fabricante; hasta entonces, el POS bloquea la anulación local de esa factura.
- La emisión se encuentra conectada al contrato del puente, pero no se incluye un puente binario de ningún fabricante en este repositorio. Sin un puente específico y probado, la modalidad Máquina Fiscal falla de forma segura y no registra la venta.
- La emisión fiscal requiere número de documento y serial confirmados por el adaptador.
- No se degrada automáticamente a impresión térmica común si la máquina fiscal falla.
- No se instalan controladores ni se modifican dispositivos de Windows silenciosamente.
- Los DLL/SDK y drivers gratuitos se obtienen desde los portales públicos del fabricante o su canal técnico. No se presume una prohibición de uso por el simple hecho de que la página no incluya una frase expresa de redistribución.
- La descarga/uso individual y la copia del binario dentro del instalador son acciones distintas. El administrador puede descargar el paquete gratuito y seleccionarlo en la configuración. Solo se empaqueta una copia cuando la publicación o el paquete permita esa redistribución; si no está claro, se mantiene la descarga individual sin impedir el uso del paquete. Se respetan las restricciones que el fabricante indique claramente.
- El sistema no descarga ni ejecuta controladores desde URLs configurables.

## Controladores USB-Serial

La capa de configuración contempla los tres controladores USB-Serial mencionados, pero no presupone que todas las impresoras los utilicen. Por ejemplo, PNP PF-SUNMI declara USB CDC serial, RS232 opcional y Wi-Fi, por lo que Windows puede utilizar su controlador CDC estándar en vez de PL2303/FTDI/CP210x. Los controladores contemplados son:
- Prolific PL2303
- FTDI Virtual COM Port (VCP)
- Silicon Labs CP210x

El usuario/instalador autorizado debe instalar el paquete firmado que corresponda al chip y a la versión de Windows. La detección COM de SIFER360 confirma que Windows expone un puerto, pero no identifica de forma concluyente el chip ni demuestra que el controlador sea el correcto.

## Fuentes oficiales y soporte

- The Factory HKA Venezuela — fabricante, impresoras fiscales y soporte/integración: https://thefactoryhka.com/ve/
- Catálogo oficial de impresoras fiscales The Factory HKA: https://thefactoryhka.com/ve/productos/impresoras
- Wiki The Factory HKA: https://wiki.thefactoryhka.com.ve/doku.php (la documentación pública consultada corresponde a Imprenta Digital REST API; no se debe confundir con el SDK local de impresora fiscal).
- Manual HKA de impresora SRP-350 (referencia de conexión USB Prolific y puerto serial; confirmar aplicabilidad al modelo/país): https://www.thefactoryhka.com/extranet-pa/downloads/MANUAL%20DE%20USUARIO%20SRP-350.pdf
- Bematech / POS Venezuela: portal público de librerías DLL y descargas. Publica librerías DLL y drivers USB para MP-4000 y MP-4200: https://posvenezuela.com/librerias-dll/ y https://posvenezuela.com/descargas-2/. Para MP-4200 existe una página separada https://posvenezuela.com/descargas-mp4200/ con archivos DLL y manual de instalación. El portal de MP-4000 enumera paquetes de DLL de 10 y 13 dígitos y varias versiones BemaFI/BemaMFD; se debe elegir por modelo, firmware y configuración fiscal. El paquete debe corresponder al modelo/firmware; no todos los modelos Bematech usan el mismo SDK.
- Epson Venezuela — portal de desarrolladores: https://epson.com.ve/developers-products (Epson indica que los materiales técnicos para desarrolladores se solicitan directamente; no se asume que la DLL sea de descarga libre).
- Quorion — descargas y manuales: https://quorionus.com/downloads/ (incluye software QMP y manuales; validar API/SDK fiscal con el distribuidor).
- Aclas: https://www.aclas.com/
- PNP — integración oficial y biblioteca pnpdll.dll: https://desarrollospnp.com/pregunta/ (enlace al paquete pnpdll2025a.zip y protocolo serial 0141).
- PNP — archivos oficiales: https://desarrollospnp.com/archivos/
- PNP — ficha PF-SUNMI: https://desarrollospnp.com/pf-sunmi/
- PNP / PF-SUNMI: https://desarrollospnp.com/archivos/PFSUNMI.pdf
- Prolific PL2303 — soporte y controladores oficiales: https://www.prolific.com.tw/en/portfolio-item/pl2303gt/
- FTDI — VCP Drivers oficiales: https://ftdichip.com/drivers/vcp-drivers/
- Silicon Labs — CP210x VCP Drivers oficiales: https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers

## Pendiente para certificar compatibilidad real

1. Recibir SDK/manual original de cada modelo y comprobar sus términos de redistribución. Para PNP, utilizar como referencia inicial pnpdll2025a.zip y PROTOCOLO0141.pdf publicados por el fabricante; la biblioteca x64 pnpdll64.dll aparece documentada en el paquete pnpdll2022.zip. El proyecto incluye ahora un codec comprobado para el framing del protocolo PNP v5.4 y una consulta de estado de solo lectura por COM usando el comando 0x38 con parámetro N. La consulta utiliza un número de secuencia variable, valida la trama y su BCC, y no imprime Reporte X/Z ni modifica la memoria fiscal. La emisión de facturas todavía requiere completar y validar la secuencia de facturación con equipo físico. Se añadieron constructores de tramas para los comandos 0x40 (abrir factura), 0x41 (texto fiscal), 0x42 (renglón), 0x43 (subtotal) y 0x45 (cierre), con límites de campos y validaciones numéricas derivados del manual. La tasa imponible del comando 0x42 se exige en la notación literal `.nnnn` (por ejemplo `.1600`), no como cuatro dígitos sin punto; esta regla se contrasta con el formato de campo del protocolo oficial v5.4. Estos constructores solo generan bytes y tienen pruebas automatizadas sin impresora; todavía no abren el puerto, no traducen los importes del POS ni emiten documentos. La siguiente etapa es implementar el transporte serial comando/respuesta, conciliar los totales del subtotal y validar la conversión monetaria/IGTF antes de conectar el cierre a una venta.
2. Construir los puentes específicos de fabricante; no basta con que exista el archivo DLL.
3. Probar lectura de estado, papel/tapa, emisión, consulta del último documento, anulaciones/notas de crédito cuando el equipo lo permita y Reporte Z.
4. Ejecutar pruebas físicas por cada modelo, firmware, interfaz (USB/COM/Ethernet) y arquitectura Windows.
5. Integrar y probar anulaciones/notas de crédito y Reporte Z. La conciliación manual de emisiones inciertas ya reconstruye la venta y el inventario en SQLite, pero debe probarse con documentos reales de cada familia.
6. Verificar que la caja asignada utiliza el dispositivo configurado y que el número fiscal de la máquina queda vinculado a la venta SQLite.

Hasta completar estas pruebas, una familia se considera «configurable/preparada para adaptador», no «compatibilidad fiscal certificada».


## Instalación inicial: fiscal, térmica genérica o sin impresora

SIFER360-LICORERIA ofrece tres modos de trabajo configurables y persistidos en SQLite:

- `FISCAL_PRINTER`: máquina fiscal homologada. La emisión permanece bloqueada hasta que el SDK, el adaptador y la respuesta del modelo estén validados.
- `INTERNAL_THERMAL`: impresora térmica genérica seleccionada desde el diálogo de impresión de Windows. Los documentos son tickets internos con la leyenda **“TICKET DE VENTA — NO VÁLIDO COMO FACTURA FISCAL”**. No se generan números fiscales, seriales fiscales ni cierres fiscales.
- `NO_PRINTER`: el POS registra ventas normalmente en SQLite, no intenta imprimir ni enviar comandos fiscales. El ticket puede consultarse y copiarse, pero la acción de impresión informa que no hay impresora configurada. En ambas modalidades internas, la configuración tributaria se identifica como `NO_FISCAL_INTERNAL` para que no se confunda con Formas Libres o máquina fiscal.

En instalaciones nuevas, el asistente aparece para el administrador en el primer inicio de su espacio de trabajo. La selección puede modificarse posteriormente desde Parámetros Fiscales. Las bases existentes sin esta preferencia conservan su comportamiento anterior.

### Búsqueda automática COM1–COM10

La configuración fiscal enumera los puertos de Windows y filtra COM1 a COM10. Para PNP, prueba la consulta de estado de solo lectura y solo selecciona un puerto si la trama, secuencia, comando y respuesta son válidos. Para otros fabricantes, la detección automática exige que el adaptador específico esté instalado y que su acción de estado responda correctamente. Sin adaptador, los puertos se muestran como candidatos, nunca como impresoras fiscales confirmadas.

### Controladores USB-Serial gratuitos: fuentes oficiales

Los controladores pueden descargarse sin costo desde sus fabricantes. Que sean gratuitos para descarga no implica permiso automático para redistribuirlos dentro de un instalador comercial. SIFER no debe copiar, modificar ni ejecutar instaladores de terceros hasta comprobar los términos de redistribución, firma digital, arquitectura y compatibilidad del dispositivo:

- Prolific PL2303: https://prolificusa.com/product/pl2303gd-usb-cdc-serial-bridge-controller/ y https://prolificusa.com/product/pl2303ge-usb-full-uart-ic-integrated-system-level-esd-protection/
- FTDI Virtual COM Port (VCP) / D2XX: https://ftdichip.com/drivers/
- Silicon Labs CP210x VCP: https://www.silabs.com/software-and-tools/usb-to-uart-bridge-vcp-drivers

Preferir el controlador firmado que corresponda al identificador VID/PID y a la versión de Windows del cable. No instalar PL2303, FTDI o CP210x si el dispositivo no contiene ese chipset. Algunos dispositivos USB CDC usan controladores incluidos en Windows.

### Política de SDK y DLL fiscales

SIFER facilita el acceso y uso de los SDK/DLL que los fabricantes o sus canales técnicos publican gratuitamente para usuarios e integradores. No se presume una prohibición de uso por ausencia de una frase expresa de redistribución. Se distingue entre (1) descarga y uso individual desde la fuente pública y (2) copiar el binario dentro del instalador de SIFER. El administrador puede descargar el paquete gratuito, seleccionarlo en la configuración y utilizarlo con el adaptador correspondiente. Solo se copia al instalador cuando la publicación o el paquete permita esa redistribución; si no está claro, se conserva el flujo de descarga individual sin impedir su uso. Se respetan las restricciones expresas del fabricante. No se ejecutan instaladores ni se modifican archivos sin confirmación del administrador.

La pantalla fiscal ofrece destinos cerrados para PNP (DLL 32/64 bits y protocolo 0141), Bematech/POS Venezuela (DLL y drivers), Prolific, FTDI, Silicon Labs, The Factory HKA (su sitio declara herramientas gratuitas para integradores), Epson, Quorion y Aclas. No acepta URLs arbitrarias. La descarga se realiza desde la página pública del proveedor y el administrador selecciona luego los archivos originales desde el POS. La aplicación no descarga ni instala controladores silenciosamente.

### Separación de documentos internos y fiscales

Los documentos con `docType: TICKET-INTERNO` o `documentMode: INTERNAL_THERMAL/NO_PRINTER` se conservan en el historial de ventas, inventario, caja y reportes comerciales. Se excluyen del Libro de Ventas Fiscal, de los resúmenes de documentos fiscales y del débito mensual de IVA. No reciben número de control fiscal, serial de máquina ni número fiscal simulado. Los documentos heredados sin modalidad explícita conservan el tratamiento anterior para no alterar registros históricos.

## Pendiente funcional: restablecer el módulo de Contabilidad con bloqueo fiscal

El módulo de **Contabilidad debe volver a existir en SIFER360-LICORERIA**, recuperando el módulo y el comportamiento funcional que tenía anteriormente. Su retirada del código actual no representa una decisión funcional definitiva: la reintroducción queda registrada como trabajo pendiente y no debe confundirse con la integración de impresoras fiscales que se está desarrollando ahora.

Reglas obligatorias para su futura implementación:

1. El módulo debe estar presente y visible en la navegación, aunque no haya una impresora fiscal conectada.
2. Si no existe una impresora fiscal conectada, reconocida y operativa, el acceso al módulo estará bloqueado. Al seleccionarlo, el sistema mostrará un aviso claro: **«El módulo de Contabilidad requiere una impresora fiscal conectada y activa. Conecte y active una impresora fiscal para acceder».**
3. El módulo solo se habilitará cuando el adaptador de la impresora fiscal confirme el estado operativo y la capacidad real de generar facturación fiscal. Que exista un perfil guardado, que se haya elegido un puerto COM o que Windows detecte un dispositivo no es suficiente.
4. El estado debe vigilarse durante el uso. Si el equipo se desconecta, falla la comunicación o deja de estar habilitado para emitir documentos fiscales, se bloqueará el acceso y se informará al usuario del motivo.
5. Al reconectar y validar correctamente la impresora fiscal, el acceso podrá habilitarse de nuevo sin reinstalar el sistema ni reconstruir datos.
6. La reintroducción debe recuperar el módulo anterior como referencia, no sustituirlo por una pantalla nueva simplificada. Deben revisarse sus pantallas, operaciones, informes, permisos y relaciones funcionales antes de restaurarlo.
7. La reintroducción no puede borrar ni sobrescribir datos históricos. Debe conservarse la base SQLite local y añadirse cualquier migración de forma compatible y reversible.
8. El módulo debe trabajar con la información fiscal respaldada por documentos realmente emitidos por la impresora. Los tickets internos de una impresora térmica genérica y las ventas en modalidad sin impresora no se deben presentar como facturas fiscales.

Pruebas de aceptación pendientes: módulo visible pero bloqueado sin equipo; mensaje correcto al intentar abrirlo; desbloqueo tras una conexión fiscal válida; bloqueo inmediato o al detectar pérdida de estado; reconexión y recuperación del acceso; rechazo de un simple puerto COM/perfil configurado como prueba de impresora fiscal; conservación de datos contables anteriores durante actualización y migración.

Esta tarea es futura y separada del alcance actual de los constructores de tramas PNP. No se debe activar el módulo ni habilitar facturación fiscal hasta completar las pruebas de integración y validación física del fabricante/modelo correspondiente.
