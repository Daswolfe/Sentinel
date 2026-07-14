# ARGUS frontend — vite build served by nginx, which also proxies /api + /ws
# to the backend container (same-origin, mirroring the dev-server proxy).
FROM node:22-slim AS build
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web .
RUN npm run build

FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
