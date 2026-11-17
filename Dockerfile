# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV UPLOADS_DIR=/app/uploads

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Las imágenes subidas viven en un volumen (ver docker-compose); el proceso no corre como root.
RUN mkdir -p /app/uploads/listings && chown -R node:node /app/uploads
USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" > /dev/null || exit 1

CMD ["node", "dist/main"]
