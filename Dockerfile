# --- Build stage ---
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# --- Runtime stage ---
FROM node:22-alpine

RUN addgroup -S peerlp && adduser -S peerlp -G peerlp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Data directory for SQLite
RUN mkdir -p /app/data && chown -R peerlp:peerlp /app/data

USER peerlp

EXPOSE 3200 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3200/api/status || exit 1

ENTRYPOINT ["node", "dist/index.js"]
