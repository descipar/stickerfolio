# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV APP_BASE_URL="http://localhost:3500"
ENV BETTER_AUTH_SECRET="docker-build-only-secret-with-at-least-32-characters"
ENV REGISTRATION_MODE="closed"
RUN mkdir -p public
RUN pnpm build

FROM dependencies AS production-dependencies
RUN pnpm prune --prod

FROM node:26-alpine AS operations
ENV NODE_ENV="production"
# The runtime needs only node. Removing the bundled npm and corepack drops
# their vulnerable transitive packages from the image (#134).
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src ./src
USER node

FROM node:26-alpine AS runtime
ENV NODE_ENV="production"
# The runtime needs only node. Removing the bundled npm and corepack drops
# their vulnerable transitive packages from the image (#134).
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV HOSTNAME="0.0.0.0"
ENV PORT="3500"
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/scripts/client-address-preload.mjs ./client-address-preload.mjs
USER node
EXPOSE 3500
# The preload records each connection's socket address for per-client rate limits (#124).
CMD ["node", "--import", "./client-address-preload.mjs", "server.js"]
