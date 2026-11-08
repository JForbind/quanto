# Seguridad

## Cómo reportar una vulnerabilidad

Si encuentras un fallo de seguridad, **no abras un issue público**. Usa
[Security Advisories](https://github.com/JorgeHacs/quanto/security/advisories/new)
o escribe a través de un issue privado al mantenedor.

Incluye, si puedes:

- versión de Quanto (`/api/status`),
- cómo está desplegado (Docker, sistema operativo),
- pasos para reproducirlo,
- impacto que crees que tiene.

## Qué hace Quanto para protegerse

- Contraseña guardada como **hash scrypt** con sal; nunca en claro.
- Sesión con cookie `HttpOnly`, `SameSite=Lax` y firma HMAC (`COOKIE_SECRET`).
- Límite de intentos de login por IP.
- Claves de Bitvavo y token de Telegram **solo en tu servidor** (`data/`), nunca enviados a terceros.
- Cabeceras `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- La imagen Docker corre como usuario `node` (no root) tras ajustar el volumen.

## Recomendaciones de despliegue

- No expongas el puerto 8766 directamente a Internet: usa VPN o un proxy inverso con HTTPS.
- Protege `data/` (contiene tus claves) y no lo subas a Git.
- Usa una clave de API de Bitvavo **de solo lectura**.
