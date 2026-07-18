# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV APP_BASE_URL="http://localhost:3500"
ENV BETTER_AUTH_SECRET="docker-build-only-secret-with-at-least-32-characters"
ENV REGISTRATION_MODE="closed"
RUN pnpm build

FROM node:22-alpine AS runtime
ENV NODE_ENV="production"
ENV HOSTNAME="0.0.0.0"
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json /app/next.config.ts ./
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src ./src
USER node
EXPOSE 3500
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3500"]
