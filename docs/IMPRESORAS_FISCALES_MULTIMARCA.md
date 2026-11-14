# Impresoras fiscales multimarca — SIFER360-LICORERIA

## Objetivo y alcance

El módulo separa la lógica comercial del POS de los protocolos de cada fabricante. La configuración se guarda en el estado operativo SQLite (por caja), mientras que la comunicación con el dispositivo se ejecuta en el equipo Electron al que está conectado físicamente. El flujo de venta en modalidad Máquina Fiscal consulta el adaptador, persiste una intención idempotente antes de enviar la factura y solo confirma la venta después de recibir el número fiscal y serial de la máquina.

Familias contempladas:

| Familia | SDK / archivos de referencia | Observaciones |
|---|---|---|
| The Factory HKA | TfhkaNet.dll, tfhkaif.dll, IntTFHKA.exe | Confirmar DLL, versión, arquitectura y modelo con el soporte oficial. |
| Bematech | BemaFI32.dll, BemaFI64.dll, BemaFI32.ini | Seleccionar el SDK compatible con 32/64 bits y el modelo exacto. |
| Epson Fiscal | EpsonFiscalInterface.dll | La interfaz y los comandos dependen del modelo/país. |
| Quorion | QProg.dll o protocolo del modelo | No asumir que todos los equipos aceptan el mismo protocolo serial. |
| Aclas | AclasSDK.dll | Confirmar versión del SDK y protocolo con el distribuidor. |
| PNP | PnpFiscal.dll | Confirmar SDK correspondiente al equipo homologado; PF-SUNMI dispone de documentación del fabricante. |

La lista de marcas/modelos es un catálogo de integración solicitado, no una certificación de homologación vigente. Antes de activar facturación fiscal, verificar el modelo exacto, serial, representante y autorización aplicable ante SENIAT y el fabricante.

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
  "fiscalSerial": "serial leído de la máquina"
}
~~~

Para emitInvoice, el puente debe ser idempotente por requestId, validar los límites del equipo y devolver el número real asignado por la máquina. Nunca debe simular una emisión exitosa ni imprimir un ticket comercial como sustituto de un documento fiscal.

Los SDK de cada familia tienen APIs distintas. No se debe fabricar un puente genérico que envíe tramas inventadas a todos los modelos. Cada implementación HKA, Bematech, Epson, Quorion, Aclas o PNP debe compilarse y probarse con el SDK/manual original y con equipos físicos.

## Control de emisión y seguridad

- La prueba COM solo abre y cierra el puerto; no ejecuta comandos fiscales ni modifica memoria fiscal.
- Un timeout durante emisión deja el resultado potencialmente incierto. El operador debe consultar la máquina antes de reintentar; no se debe duplicar una factura.
- Una factura emitida por máquina fiscal no puede anularse únicamente en el POS. La anulación/nota de crédito en la máquina debe integrarse con un comando específico del fabricante; hasta entonces, el POS bloquea la anulación local de esa factura.
- La emisión se encuentra conectada al contrato del puente, pero no se incluye un puente binario de ningún fabricante en este repositorio. Sin un puente específico y probado, la modalidad Máquina Fiscal falla de forma segura y no registra la venta.
- La emisión fiscal requiere número de documento y serial confirmados por el adaptador.
- No se degrada automáticamente a impresión térmica común si la máquina fiscal falla.
- No se instalan controladores ni se modifican dispositivos de Windows silenciosamente.
- Los DLL/SDK y drivers propietarios no se incluyen en el instalador hasta verificar permiso de redistribución y firma/procedencia.
- El sistema no descarga ni ejecuta controladores desde URLs configurables.

## Controladores USB-Serial

La capa de configuración contempla los tres controladores mencionados:
- Prolific PL2303
- FTDI Virtual COM Port (VCP)
- Silicon Labs CP210x

El usuario/instalador autorizado debe instalar el paquete firmado que corresponda al chip y a la versión de Windows. La detección COM de SIFER360 confirma que Windows expone un puerto, pero no identifica de forma concluyente el chip ni demuestra que el controlador sea el correcto.

## Fuentes oficiales y soporte

- The Factory HKA Venezuela: https://thefactoryhka.com/ve/
- Wiki técnica oficial The Factory HKA: https://wiki.thefactoryhka.com.ve/doku.php
- Bematech: solicitar el SDK fiscal de la referencia exacta al fabricante o representante autorizado.
- Epson: solicitar Epson Fiscal Driver / Fiscal Interface del modelo y país exactos al soporte Epson.
- Quorion: https://quorion.com/
- Aclas: https://www.aclas.com/
- PNP / PF-SUNMI: https://desarrollospnp.com/archivos/PFSUNMI.pdf
- Prolific: https://www.prolific.com.tw/
- FTDI: https://ftdichip.com/drivers/vcp-drivers/
- Silicon Labs: https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers

## Pendiente para certificar compatibilidad real

1. Recibir SDK/manual original de cada modelo y comprobar sus términos de redistribución.
2. Construir los puentes específicos de fabricante; no basta con que exista el archivo DLL.
3. Probar lectura de estado, papel/tapa, emisión, consulta del último documento, anulaciones/notas de crédito cuando el equipo lo permita y Reporte Z.
4. Ejecutar pruebas físicas por cada modelo, firmware, interfaz (USB/COM/Ethernet) y arquitectura Windows.
5. Integrar y probar anulaciones/notas de crédito, Reporte Z, consulta del último documento y conciliación de trabajos fiscales inciertos.
6. Verificar que la caja asignada utiliza el dispositivo configurado y que el número fiscal de la máquina queda vinculado a la venta SQLite.

Hasta completar estas pruebas, una familia se considera «configurable/preparada para adaptador», no «compatibilidad fiscal certificada».
