FROM node:25-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8765 \
    DATA_DIR=/app/data

# Dependencias primero (mejor caché de capas)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && apk add --no-cache su-exec

COPY . .

# El punto de entrada ajusta el propietario del volumen y ejecuta como usuario node
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /app/data && chown -R node:node /app

EXPOSE 8765
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8765/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
