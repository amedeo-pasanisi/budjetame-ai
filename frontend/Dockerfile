# Budjetame frontend — Vite build served by Caddy. Multi-arch (amd64/arm64).
# Caddy terminates TLS (Let's Encrypt, automatic renewal) and redirects
# HTTP → HTTPS; see Caddyfile and ADR-0017.
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/dist /usr/share/caddy
