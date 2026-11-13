# Stage 1 — build: chỉ cần root lock (vite/react) để build dist/
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY web ./web
COPY admin ./admin
COPY scripts ./scripts
RUN npm run build            # -> dist/ (flattened: /index.html /user.html /admin/)

# Stage 2 — runtime: chỉ cần server lock (pg/redis/aws) để chạy API
FROM node:22-alpine AS runtime
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production PORT=3001 STATIC_DIR=dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD wget --spider -q http://127.0.0.1:3001/api/health
CMD ["node", "server/server.mjs"]
