# Seguridad

## Cómo reportar una vulnerabilidad

Si encuentras un fallo de seguridad, **no abras un issue público**. Usa
[Security Advisories](https://github.com/JForbind/quanto/security/advisories/new).

Incluye, si puedes: versión (`/api/status`), cómo está desplegado, pasos para reproducirlo
e impacto que crees que tiene.

## Modelo de seguridad

Quanto es **multi-usuario**:

- Cada cuenta tiene su propia carpeta (`data/users/<id>/`) con su cartera, claves de
  Bitvavo, alertas, planes, apariencia y datos fiscales. **Nada se comparte.**
- Hay dos roles:
  - **Administrador**: crea y gestiona cuentas. No tiene acceso a datos financieros
    (salvo que se marque «usar también para mi cartera» al crearla).
  - **Usuario**: acceso completo a su propio espacio.
- Los usuarios solo se crean **por invitación**: enlace de un solo uso que caduca en 72 h.

## Protecciones

- Contraseñas con **scrypt + sal por usuario**; nunca en claro.
- Política obligatoria: **12 caracteres** con mayúscula, minúscula, número y símbolo.
- Sesión con cookie `HttpOnly`, `SameSite=Lax`, `Secure` bajo HTTPS, firmada con HMAC e
  identificada por usuario y `sessionVersion` (resetear o desactivar expulsa al instante).
- Tokens de invitación de 24 bytes, **guardados hasheados** y con caducidad.
- Límite de intentos de login por IP y de peticiones en endpoints caros.
- Cabeceras: CSP estricta (sin scripts inline), `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`.
- Los datos sensibles se guardan con permisos **600**.
- La imagen Docker corre como usuario `node` (no root).

## Recomendaciones de despliegue

- No expongas el puerto directamente a Internet: usa VPN (Tailscale) o un proxy con HTTPS.
- Protege `data/` (contiene claves de Bitvavo y la contraseña SMTP) y no lo subas a Git.
- Usa una clave de API de Bitvavo **de solo lectura**.
- Cambia la contraseña temporal del administrador en el primer acceso.
