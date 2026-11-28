FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8765 \
    DATA_DIR=/app/data

# Dependencias primero (mejor caché de capas y versiones del lockfile)
COPY package.json package-lock.json ./
# --include=dev: NODE_ENV=production haría que npm omitiera Vite y no habría build.
RUN npm ci --include=dev --no-audit --no-fund \
 && npm cache clean --force \
 && apk add --no-cache su-exec

COPY . .

# Build del front con Vite. Si falla, el despliegue falla: no se sirve un dist viejo.
RUN npm run build:web \
 && npm prune --omit=dev

# El punto de entrada ajusta el propietario del volumen y ejecuta como usuario node
RUN chmod +x /app/docker-entrypoint.sh && chmod -R a+rX /app \
 && mkdir -p /app/data && chown -R node:node /app/data

EXPOSE 8765
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8765/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
