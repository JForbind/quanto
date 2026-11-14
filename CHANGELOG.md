# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El proyecto sigue [Versionado Semántico](https://semver.org/lang/es/).

## [3.2.0] — 2026-11-14

### Seguridad

- **Guardia global de acceso**: todo `/api` exige sesión salvo la lista pública
  (health, status, setup, login, forgot, invitación). Una ruta nueva ya no puede
  quedarse sin proteger por orden de registro.
- **Límite de intentos por usuario** además de por IP.
- `/appearance-public` deja de leer datos y responde siempre sin foto.
- Limpieza de código heredado del modo de un solo usuario.

### Añadido

- **Tests de autenticación**: política de contraseñas, hash, sesiones (falsificación y
  caducidad), invitaciones, desactivación y borrado de usuarios. `npm test`.

## [3.1.4] — 2026-11-14

### Seguridad (auditoría completa)

- `/api/status` y `/api/settings` calculan el estado de la contraseña desde `users.json`.
- `/api/settings` ya no expone la ruta del servidor.
- El cambio de contraseña heredado en `/api/settings` devuelve 400 (se usa `/api/password`).
- Límite de 240 peticiones/minuto en exportaciones, copias, importación e iconos.
- Los JSON con datos sensibles se guardan con permisos **600**.
- Cerrojo en el alta inicial para evitar dos administradores simultáneos.

## [3.1.3] — 2026-11-14

### Corregido

- **Los planes habían desaparecido**: sus rutas estaban registradas antes del middleware de
  sesión, así que se ejecutaban sin el contexto del usuario y leían una carpeta vacía.
  Ahora vuelven a mostrarse con sus tramos.
- El mismo fallo afectaba a **radar, velas y sparklines**, que además quedaban accesibles
  **sin sesión**. Ahora exigen login (401) y respetan la regla del admin sin datos.

## [3.1.2] — 2026-11-14

### Añadido

- **Iconos reales de monedas** en el radar y en cualquier sitio donde aparezca una moneda
  que no tenga icono propio: se descargan una vez y se guardan en `data/icons/` (caché).
  Si no hay icono disponible, se mantiene la insignia con las iniciales.

## [3.1.1] — 2026-11-14

### Corregido

- Al cambiar de usuario sin recargar, la interfaz conservaba el modo administrador.
  Ahora se reinicia la vista y se aterriza en Resumen.
- El campo «Usuario» del correo usaba una dirección de ejemplo que parecía un valor real.
- El correo de ejemplo del repositorio se ha sustituido por un texto genérico.

## [3.1.0] — 2026-11-14

### Añadido

- **Primera puesta en marcha**: en una instalación nueva, Quanto pide crear la cuenta de
  administrador (usuario, email y contraseña) antes de nada. Con la opción de usar esa misma
  cuenta también para la cartera.
- **Correo de avisos** en Ajustes (solo admin): servidor SMTP, puerto, usuario, contraseña de
  aplicación y remitente. Sirve Gmail o cualquier otro proveedor. Botón **Probar envío**.
- Las **invitaciones** se envían por correo automáticamente cuando hay SMTP configurado.
- **Aviso al administrador** cuando alguien pulsa «he olvidado mi contraseña».
- Variables de entorno `SMTP_*` para configurar el correo desde docker-compose.

## [3.0.0] — 2026-11-14

### Añadido

- **Multi-usuario**: cada cuenta tiene su propia cartera, claves de Bitvavo, alertas,
  planes, apariencia y datos fiscales. Nada se mezcla.
- **Registro solo por invitación**: el administrador crea la cuenta y comparte un enlace
  de un solo uso (caduca en 72 h) donde el invitado elige su contraseña.
- **Cuenta de administración** (`adminquanto20`) sin datos financieros: solo gestiona usuarios.
- **Panel de usuarios** en Ajustes: crear, resetear, desactivar, borrar y copiar enlaces.
- **«He olvidado mi contraseña»**: avisa al administrador para que genere un enlace nuevo,
  sin perder ningún dato.
- Política de contraseñas: **12 caracteres con mayúscula, minúscula, número y símbolo**.
- Sesiones firmadas con el usuario y su versión: resetear o desactivar expulsa al instante.

### Cambiado

- El login ahora pide **usuario y contraseña**.
- La migración conserva el usuario actual como `jorge` con su contraseña de siempre.
- Los datos de ejemplo quedan detrás de `DEMO=1`; una cuenta nueva empieza vacía.

## [2.2.5] — 2026-11-13

### Cambiado

- **Alertas en escritorio**: la primera columna pasa a ancho fijo, así la condición, el precio
  fijado y tu precio medio quedan pegados al logo en lugar de flotar en el centro.
- **Alertas en móvil**: cada alerta se muestra como tarjeta apilada (logo, rejilla 2×2, estado
  y botones), sin salirse de la pantalla.
- **Menú inferior del móvil**: de 9 pestañas a **5** (Resumen, Monedas, Índice, Alertas, Más) y
  una hoja **«Más»** con Operaciones, Fiscal, Planes, Trading y Ajustes.

## [2.2.4] — 2026-11-11

### Añadido

- Crear un plan **genera solo los avisos de Telegram** de cada tramo pendiente.
- Al marcar un tramo como ejecutado o cancelado, su aviso **se retira**; si se reabre, vuelve.
- Borrar un plan borra sus avisos.
- Las alertas muestran un chip **«plan»** para distinguirlas de las creadas a mano.

## [2.2.3] — 2026-11-11

### Añadido

- Los **tramos de un plan se marcan solos** cuando Quanto detecta una compra de esa moneda
  cuyo precio encaja con el del tramo (margen del 3 %). Cada compra se usa una sola vez.
- Si un tramo se marcó a mano, la compra que lo justifica queda registrada para no reutilizarla.

## [2.2.2] — 2026-11-11

### Añadido

- **Tablero de Planes**: crea planes de compra por moneda con varios tramos
  (precio + importe), objetivos escritos y seguimiento del presupuesto gastado.
- Cada tramo muestra **cuánto falta** para su precio (o «ya está en precio») y se puede
  marcar como **ejecutado**, **cancelar** o **reabrir**.
- El plan guarda el precio al que se ejecutó cada tramo.

## [2.2.1] — 2026-11-11

### Añadido

- **Simulador de venta** en Fiscal: elige moneda y cantidad (25 %, 50 % o todo) y ves
  el precio, el ingreso, la ganancia con FIFO y con coste medio, la cuota estimada y el neto.
- Ahora indica **qué queda en cartera** y el **peso de esa moneda antes y después** de la venta.
- Columna **«Si vendes todo»** en el Inventario FIFO: cuota estimada por moneda.

## [2.2.0] — 2026-11-11

### Añadido

- **Panel de Trading**: velas de Bitvavo (15m, 1h, 4h, 1D) con volumen, zoom y tooltip.
- Indicadores calculados en el navegador: **MA20/50**, **Bollinger**, **RSI** y **MACD**.
- **Fibonacci automático** que se recalcula con el tramo visible del gráfico.
- **Ondas de Wolfe**: detección automática por pivotes y modo **manual** (5 clics) con línea EPA.
- **Radar del mercado** en Resumen: mayores subidas y bajadas del día en Bitvavo.
- **Minigráfico de 7 días** en la tabla de Monedas.
- **Iconos de moneda** en las alertas y filas en columnas.
- **KPIs** de resumen arriba en Monedas, Miedo y codicia y Operaciones.
- Efecto **tragaperras** en los KPIs al abrir la app.
- Transiciones animadas entre paneles (fundido + cascada de tarjetas + título).

### Cambiado

- El **tooltip del rosco** lleva el color de la porción.
- Fuera la **tarjeta lateral** de resumen (sustituida por los KPIs de cada pestaña).
- Fuera las columnas **Tend.** y **Detalle** de Monedas (la fila ya abre el detalle).

## [2.1.1] — 2026-11-09

### Cambiado

- **Barra lateral**: *Ajustes* pasa a la fila de iconos del pie y el resumen rápido
  (valor total, invertido, P/L y hoy) se convierte en un **panel vertical único** que se
  muestra en Monedas, Miedo y codicia, Operaciones, Fiscal y Alertas, y se oculta en
  Resumen y Ajustes.

## [2.1.0] — 2026-11-09

### Añadido

- Columna **«Invertido»** por moneda en las tablas de Monedas y de Posiciones.
- **Modo privacidad**: botón en la barra superior que difumina todos los importes
  (tablas, KPIs, gráficos y leyendas) para enseñar la app o hacer capturas. Se recuerda
  entre sesiones.
- **Alertas múltiples por moneda**: sin límite práctico (hasta 200), con **editor** en la lista
  (`Editar`, `Pausar`, `Borrar`) y botón **Probar** para enviar ese aviso concreto a Telegram.
- **Apariencia**: fondo de pantalla personalizado (con velo para mantener la legibilidad) y
  **foto de perfil**, que se muestra en la barra superior y en la **pantalla de acceso**.
  Botones para restablecer ambas.
- Aviso de **venta con beneficio** en las alertas de máximo: importe bruto, impuestos
  estimados y neto.

### Cambiado

- **Cooldown de las alertas: de 60 a 15 minutos** entre avisos de la misma alerta
  (configurable por alerta con `cooldownMin`).
- Mensaje de Telegram de las alertas, ahora corto y con emojis: incluye el precio fijado,
  el precio actual y **tu precio medio de compra** con la diferencia porcentual.
- La línea del índice **Miedo y Codicia** se colorea por tramos.
- La tarjeta del resumen aprovecha el alto disponible: gráfico ampliado, cifras de 7/30 días
  y media de 30 días.

### Corregido

- La **evolución de la cartera** usaba solo las capturas de las últimas horas en lugar de la
  serie reconstruida, así que los rangos mostraban lo mismo.
- Subida de imágenes bloqueada por la CSP (`blob:` → `data:`).
- Texto de la lista de alertas: en las de bajada decía «pasado por» cuando **faltan** X %.
- Test de tokens de sesión que fallaba de forma aleatoria.

## [2.0.0] — 2026-11-08

Primera versión pública de Quanto.

### Añadido

- Panel lateral con tema oscuro/claro y diseño responsive (PWA instalable).
- Sincronización con Bitvavo (API de solo lectura) **sin duplicar** operaciones del CSV.
- Importación del *Historial completo* de Bitvavo en CSV (separador `;`, `,` o tabulador,
  cabeceras en español o inglés, decimales con coma).
- Informe fiscal **FIFO** por lotes: transmisiones, resultado por ejercicio, cuota estimada
  por tramos (19/21/23/27/30 %), inventario y exportación a Excel para el Modelo 100.
- Simulador de venta comparando FIFO y coste medio.
- Wallet fría calculada a partir de retiradas + ajustes manuales.
- Índice Miedo y Codicia con histórico.
- **Alertas de precio** por debajo/por encima de un umbral, con aviso a **Telegram**
  (precio, precio medio, P/L, coste FIFO e impuestos estimados).
- Iconos de 487 monedas servidos en local y precio medio de compra en el resumen.
- Dockerfile multi-stage ligero (`node:22-alpine`), `docker-compose.yml`, healthcheck
  y script `instalar-zimaos.sh` para ZimaOS/NAS.
- Guía de instalación paso a paso (`INSTALAR-ZIMAOS.md`).

### Seguridad

- Contraseña con scrypt, sesión firmada (HMAC) y límite de intentos por IP.
- Contenedor ejecutado como usuario `node`.

### Corregido

- La gráfica de **Evolución de la cartera** usaba solo las capturas cada 5 minutos
  (unas horas) en lugar de la serie reconstruida desde el historial, así que los rangos
  1M/3M/6M/1A/Todo mostraban lo mismo y la línea salía plana. Ahora usa la serie
  reconstruida (desde la primera compra) y le enlaza las capturas del día.
- Test de tokens de sesión: era **flaky** si el token terminaba en `0`.
