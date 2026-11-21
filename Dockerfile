
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/

RUN npm ci

COPY client/ client/
COPY server/ server/
COPY shared/ shared/

RUN npm run build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=3000

WORKDIR /app

COPY package*.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --from=build /app/server/dist/ server/dist/
COPY --from=build /app/shared/dist/ shared/dist/
COPY --from=build /app/client/dist/ client/dist/

RUN mkdir -p /app/data /app/certs \
    && chown -R node:node /app/data

USER node

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
