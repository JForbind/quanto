# Instalar Quanto en ZimaOS

Guía paso a paso para tu servidor ZimaOS. Al terminar tendrás la app en
`http://IP-DE-TU-ZIMAOS:8766` y accesible desde el móvil.

> Si ya tenías la versión anterior (`crypto-portfolio`), **no pierdes nada**:
> al final hay un apartado para reutilizar la carpeta `data/`.

---

## 0. Antes de empezar

- ZimaOS encendido y con Docker funcionando (lo está si ya usabas la otra app).
- Acceso por **SSH** o la terminal de ZimaOS.
- El archivo `quanto.zip` que te he preparado.
- 5 minutos.

Rutas de referencia en ZimaOS: los datos de las apps suelen vivir en
`/DATA/AppData/`. Usaremos `/DATA/AppData/quanto`.

---

## 1. Copiar la carpeta al servidor

Desde tu ordenador (PowerShell):

```powershell
scp quanto.zip root@IP-DE-TU-ZIMAOS:/DATA/AppData/
```

O desde la interfaz de ZimaOS: **Archivos** → subir `quanto.zip` a `/DATA/AppData/`.

Después, por SSH:

```bash
cd /DATA/AppData
unzip -o quanto.zip
cd quanto
ls
```

Deberías ver `server.js`, `public/`, `Dockerfile`, `docker-compose.yml`, `data/`…

---

## 2. Crear el archivo de configuración

```bash
cp .env.example .env
nano .env
```

Lo mínimo es poner una contraseña (8 caracteres o más). El puerto por defecto es
**8766**, para que la app nueva pueda convivir con la anterior en el 8765:

```ini
APP_PASSWORD=mi-clave-larga
QUANTO_PORT=8766
```

Guarda con `Ctrl+O`, `Enter` y sal con `Ctrl+X`.

> Si dejas `APP_PASSWORD` vacía, Quanto genera una y la escribe en el log
> (`docker compose logs`). Pero es mejor ponerla tú.

---

## 3. Arrancar

```bash
cd /DATA/AppData/quanto
HOME=/tmp docker compose up -d --build
```

El `HOME=/tmp` es necesario en ZimaOS y en muchos NAS (evita el error de
`docker compose` con el directorio home de root).

La primera vez tarda 1–2 minutos: descarga Node y compila la imagen.

Comprueba que está viva:

```bash
docker compose ps
docker compose logs -f          # Ctrl+C para salir
```

Deberías ver algo como:

```
Quanto 2.0.0 en http://0.0.0.0:8765 · modo demo
Cartera: 0 EUR · 0 monedas
```

---

## 4. Abrir la app

En el navegador:

```
http://IP-DE-TU-ZIMAOS:8766
```

Entra con la contraseña del `.env`. La primera vez verás el **modo DEMO** con datos
de ejemplo: es normal, todavía no has conectado nada.

### Instalarla en el móvil (opcional)
- **Android/Chrome**: menú ⋮ → *Añadir a pantalla de inicio*.
- **iPhone/Safari**: compartir → *Añadir a pantalla de inicio*.

Se abre a pantalla completa, como una app.

---

## 5. Conectar tu Bitvavo

### 5.1 Crear la clave de solo lectura

1. Entra en bitvavo.com → **Ajustes → Claves API → Nueva clave**.
2. Permisos: marca **solo** «Ver saldos y transacciones».
   **No** marques operar ni retirar.
3. (Recomendado) limita la clave a la IP pública de tu casa.
4. Copia la **API Key** y el **Secret** (el secret solo se muestra una vez).

### 5.2 Pegarlas en Quanto

**Ajustes → Bitvavo** → pega ambas → *Guardar claves*.

Quanto comprueba las claves y empieza a sincronizar. El chip de la barra lateral
pasa a `LIVE`.

### 5.3 Importar el historial (una sola vez)

La API de Bitvavo solo devuelve las últimas 100 operaciones, así que el histórico
antiguo se importa desde el CSV:

1. En Bitvavo: **Historial → Historial completo → Descargar CSV**.
2. En Quanto: **Ajustes → Historial completo** → arrastra el archivo → *Importar historial*.

Verás un resumen: operaciones, monedas, ventas, fechas y total comprado/vendido.

A partir de aquí:
- la cartera usa tus cantidades y costes reales,
- la pestaña **Fiscal** ya calcula,
- y la sincronización automática irá añadiendo las operaciones nuevas **sin duplicar**
  las que ya estaban en el CSV.

> Si algún día compras mucho sin abrir la app, entra y pulsa *Sincronizar ahora*
> (o vuelve a importar un CSV actualizado). La app avisa si detecta operaciones
> nuevas cuyo coste aún es estimado.

---

## 6. Migrar desde la app anterior (crypto-portfolio)

La nueva app usa **los mismos ficheros** dentro de `data/`:

| Fichero | Se reutiliza |
|---|---|
| `bitvavo-history.json` | sí (historial importado) |
| `history.json` | sí (histórico de valor) |
| `holdings.json` | sí (wallet fría) |
| `overrides.json` | sí (inversiones manuales) |
| `settings.json` | sí (tema, claves; la contraseña antigua se convierte a hash) |
| `trades-cache.json` | no hace falta, se puede borrar |

Pasos:

```bash
# 1) parar la app antigua
cd /DATA/AppData/crypto-portfolio    # o donde la tuvieras
HOME=/tmp docker compose down

# 2) copiar sus datos a la nueva
cp -a /DATA/AppData/crypto-portfolio/data/. /DATA/AppData/quanto/data/

# 3) arrancar Quanto
cd /DATA/AppData/quanto
HOME=/tmp docker compose up -d
```

Al arrancar, Quanto detecta el historial y entra en modo `HISTORIAL`; en cuanto
pegues las claves pasa a `LIVE` y sincroniza las operaciones que falten.

> Importante: si la app anterior tenía contraseña guardada en `settings.json`, esa
> contraseña sigue valiendo (tiene prioridad sobre `APP_PASSWORD`). Puedes cambiarla
> desde *Ajustes → Seguridad*, o borrar la línea `"password"` de
> `data/settings.json` y reiniciar para volver a la del `.env`.

Si prefieres empezar limpio, borra `data/` y listo.

---

## 7. Actualizar en el futuro

```bash
cd /DATA/AppData/quanto
# sustituye los ficheros nuevos (sin tocar data/ ni .env)
HOME=/tmp docker compose up -d --build
```

Los datos no se tocan: están en el volumen `./data`.

---

## 8. Copias de seguridad

Dos formas:

1. **Desde la app**: *Ajustes → Datos → Descargar copia* (JSON con historial, wallet
   fría y ajustes).
2. **Desde el servidor**:

```bash
cd /DATA/AppData
tar czf quanto-backup-$(date +%F).tar.gz quanto/data
```

Puedes programarlo en ZimaOS (Tareas programadas) una vez por semana.

---

## 9. Publicarla en un dominio propio (Pi-hole + proxy)

Si ya tienes un proxy inverso con HTTPS (Caddy, Nginx Proxy Manager, Traefik) y un
dominio que resuelve por Pi-hole, solo hay que apuntarlo al puerto **8766**.

Ejemplo con Caddy:

```caddyfile
quanto.tudominio.com {
    reverse_proxy 127.0.0.1:8766
}
```

- La app responde en `/`, en `/app.html` (igual que la anterior) y en `/app`.
- El proxy debe reenviar la cabecera `X-Forwarded-Proto` (Caddy y NPM lo hacen solos);
  así la cookie de sesión se marca como `Secure`.
- Pi-hole solo da el nombre: el certificado lo emite el proxy.

### Acceso desde fuera de casa

No expongas el puerto 8766 directamente a Internet. Opciones:

- **VPN** (WireGuard, Tailscale): la más simple y segura.
- **Proxy inverso con HTTPS** (Caddy, Nginx Proxy Manager, Traefik) delante de
  `http://IP-ZIMAOS:8766`.

Con HTTPS, además, la cookie de sesión viaja cifrada.

---

## 10. Problemas frecuentes

**«docker: command not found»**
Docker no está instalado o el usuario no tiene permiso. En ZimaOS usa la terminal
como root.

**Error de `docker compose` con `/root/.docker` o permisos**
Añade `HOME=/tmp` delante del comando.

**El puerto está ocupado**
El 8765 suele ser de la app anterior y Quanto usa el 8766 por defecto. Si el 8766
también estuviera ocupado, cambia `QUANTO_PORT=8767` en `.env` y vuelve a
`docker compose up -d`. (El puerto interno del contenedor sigue siendo 8765.)

**No me carga desde el móvil**
Usa la IP del servidor, no `localhost`, y comprueba que el firewall permite el puerto.

**Se queda en DEMO**
Faltan las claves o Bitvavo las ha rechazado. *Ajustes → Bitvavo*: comprueba que la
clave tiene permiso de lectura y que el secret está completo (sin espacios).

**«Sin coste conocido» en el informe fiscal**
Hay ventas de monedas cuya compra no está en el historial (por ejemplo compradas en
otro exchange). Importa un CSV que las incluya o ajusta la inversión a mano desde
*Monedas → Detalle*.

**La contraseña no funciona**
Se define en `.env` (`APP_PASSWORD`). Si la cambiaste desde la app, manda la de la app.
Para volver a la del `.env`, borra la línea `"password"` de `data/settings.json` y reinicia.

**Quiero empezar de cero**
*Ajustes → Datos → Borrar todos los datos* (guarda antes una copia `.bak`).

---

## 11. Comandos útiles

```bash
docker compose ps                 # estado
docker compose logs -f            # ver log en directo
docker compose restart            # reiniciar
docker compose down               # parar
docker compose up -d --build      # reconstruir tras actualizar

docker exec -it quanto sh         # entrar en el contenedor
curl -s localhost:8766/api/health # healthcheck (puerto publicado)
```

---

## 12. Estructura en el servidor

```
/DATA/AppData/quanto/
├── .env                  tu configuración (contraseña, puerto)
├── docker-compose.yml
├── Dockerfile
├── server.js
├── lib/
├── public/
└── data/                 <- aquí están tus datos (volumen)
    ├── bitvavo-history.json
    ├── history.json
    ├── holdings.json
    ├── overrides.json
    └── settings.json
```
