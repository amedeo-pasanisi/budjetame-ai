# Budjetame frontend — Vite build served by Caddy. Multi-arch (amd64/arm64).
# Caddy terminates TLS (Let's Encrypt, automatic renewal) and redirects
# HTTP → HTTPS; see Caddyfile and ADR-0018.
FROM node:22-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Map provider (issue #27): baked at build time. CI passes the Google key as
# a build arg (GOOGLE_MAPS_API_KEY secret); local builds read frontend/.env.
ARG VITE_MAP_PROVIDER=leaflet
ARG VITE_GOOGLE_MAPS_API_KEY=
ENV VITE_MAP_PROVIDER=$VITE_MAP_PROVIDER VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/dist /usr/share/caddy
