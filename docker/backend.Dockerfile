# ARGUS backend — AIS relay, analytics, data proxies.
# node:22-slim (glibc) so better-sqlite3's prebuilt binary installs cleanly.
FROM node:22-slim
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY server server
ENV BACKEND_PORT=8787
EXPOSE 8787
CMD ["node", "server/index.js"]
