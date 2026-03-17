# ── Stage 1: Build React app ─────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_DISABLE_WEBSOCKETS=""
ENV VITE_DISABLE_WEBSOCKETS=$VITE_DISABLE_WEBSOCKETS
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# ── Stage 2: Serve via nginx + proxy /api → backend ──────────────────────────
FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
