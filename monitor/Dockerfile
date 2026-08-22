# career-ops monitor -- deliberately its own small image, not built on the
# root Dockerfile (Playwright/Chromium/Go/LaTeX -- none of that applies
# here). docker-cli is the one real addition: this container talks to
# docker via the host socket (mounted read-only in docker-compose.yml) to
# read container status and exec the scan's lock check, instead of SSH.

FROM node:22-alpine AS base
RUN apk add --no-cache docker-cli
WORKDIR /app

FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && yarn build

FROM base AS run
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
EXPOSE 3000
CMD ["yarn", "start"]
