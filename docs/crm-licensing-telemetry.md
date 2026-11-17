# Integración de licencias y telemetría con CRM-SICOVEN

## Identidad de producto
- CRM: `https://crm-sicoven.vercel.app`
- Producto: `SIFER360 Licorería`
- Product ID: `prod-sifer360-licoreria`
- Product code: `SIFER360_LICORERIA`
- Planes: `/comprar?productId=prod-sifer360-licoreria`

El CRM mantiene productos, planes, pagos y licencias separados. El endpoint de activación exige el código de producto exacto, por lo que una clave emitida para SICOVEN u otro producto no sirve para SIFER360.

## Prueba y activación
1. Al primer inicio se crea una prueba local de 24 horas.
2. El usuario puede abrir planes y pagos en CRM-SICOVEN o introducir una clave recibida después de la aprobación del pago.
3. La activación requiere Internet y usa `POST /api/activations` con `licenseKey`, `productCode`, `installationId` y `deviceLabel`.
4. La clave y el resultado se guardan cifrados con Electron safeStorage/DPAPI en el perfil local del usuario, nunca en SQLite.
5. Al iniciar y recuperar conexión se revalida la misma clave. CRM devuelve `offlineDays` y un token offline firmado con Ed25519. El token vincula product code, licencia, instalación, vencimiento y fecha límite offline; el cliente verifica la firma con una clave pública embebida. SIFER permite operación offline hasta ese límite. El valor predeterminado es 7 días.
6. Una respuesta de licencia revocada, vencida o sin equipos disponibles bloquea el acceso. Una caída de red no revoca por sí sola una licencia aún dentro del margen offline.

## Telemetría
Endpoint: `POST /api/analytics/events`.

Eventos admitidos para SIFER360 Desktop:
- `app_launch`
- `trial_started`
- `trial_expired`
- `license_activated`
- `license_check`
- `app_error`

Se envía un identificador de instalación hasheado, versión, plataforma y tipo de evento. No se transmiten nombres, correos, claves, ventas, caja, inventario, clientes ni datos contables. El usuario puede desactivar el envío desde la pantalla Licencia, prueba y planes.

## Catálogo automático
La página pública del CRM consulta `/repos/fenixlife1978/Sifer360-licoreria/releases/latest` al renderizar el catálogo. Si encuentra un activo cuyo nombre coincide con `SIFER360-*-Instalador.exe`, actualiza en pantalla la versión y el enlace de descarga. Si GitHub no está disponible, conserva el enlace guardado en el registro del producto.

## Fuente de datos
SQLite local continúa siendo la única fuente operativa de SIFER360. El CRM no recibe ni almacena operaciones POS; solo licencias, pagos y telemetría técnica mínima.
