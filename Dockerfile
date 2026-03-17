# ── Stage 1: Build React app ─────────────────────────────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /app
ARG VITE_DISABLE_WEBSOCKETS=""
ENV VITE_DISABLE_WEBSOCKETS=$VITE_DISABLE_WEBSOCKETS
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# ── Stage 2: Install API dependencies ────────────────────────────────────────
FROM node:20-alpine AS api-builder
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./

# ── Stage 3: Single runtime (API + static web) ──────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=api-builder /app/server /app/server
COPY --from=web-builder /app/dist /app/dist
EXPOSE 3000
CMD ["node", "/app/server/index.js"]
