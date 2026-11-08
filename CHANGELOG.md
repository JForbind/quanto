# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El proyecto sigue [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido

- Columna **«Invertido»** por moneda en las tablas de Monedas y de Posiciones.
- **Modo privacidad**: botón en la barra superior que difumina todos los importes
  (tablas, KPIs, gráficos y leyendas) para enseñar la app o hacer capturas. Se recuerda
  entre sesiones.

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
