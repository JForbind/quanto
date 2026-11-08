# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El proyecto sigue [Versionado Semántico](https://semver.org/lang/es/).

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
