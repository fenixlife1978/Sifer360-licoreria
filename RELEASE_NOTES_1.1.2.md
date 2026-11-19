# SIFER360 LICORERÍA v1.1.2

## Esta publicación
- Paquete de escritorio Windows generado desde la rama estable de entrega `release/v1.0.0`.
- Identidad visual actualizada: la palabra **LICORERÍA** aparece en negro en el logotipo horizontal y en la pantalla de acceso.
- Instalador Windows NSIS y ejecutable portable x64.
- Metadatos `latest.yml` y archivos blockmap incluidos para el mecanismo de actualización de escritorio.

## Validación de publicación
Los ejecutables se adjuntan únicamente después de completar las pruebas automatizadas, la validación TypeScript, la compilación de la interfaz y la comprobación de los tres artefactos requeridos.

## Requisitos
- Windows x64.
- Para la integración opcional con Google Drive, el paquete se construye con el Google OAuth Client ID configurado en el secreto de GitHub Actions `SIFER360_GOOGLE_OAUTH_CLIENT_ID`. No se incorpora ningún Client Secret.
- La base operativa permanece local en SQLite. Esta publicación no migra datos ni activa almacenamiento operativo en la nube.
