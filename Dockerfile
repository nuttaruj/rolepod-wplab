# Multi-stage build for @rolepod/wplab MCP server.
# Publishes to ghcr.io/nuttaruj/rolepod-wplab:<tag>.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache wp-cli || true
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
ENV NODE_ENV=production
ENTRYPOINT ["node", "/app/dist/bin/rolepod-wplab.js"]
CMD ["serve"]
