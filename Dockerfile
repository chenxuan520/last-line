FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN VITE_MULTIPLAYER_ENABLED=true VITE_MULTIPLAYER_URL=same-origin npm run build \
  && npm run build:server

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
  SERVER_MODE=standalone \
  SERVER_HOST=0.0.0.0 \
  SERVER_PORT=8787 \
  SERVER_DATA_DIR=/data \
  SERVER_STATIC_DIR=/app/dist
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/node_modules/ws ./node_modules/ws
USER node
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "dist-server/server.js"]
