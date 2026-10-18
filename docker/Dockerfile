# syntax=docker/dockerfile:1.7
#
# One image for every noergo process: `web`, `mcp`, `worker` and `migrate` are the
# commands (see docker/entrypoint.sh). The same image runs noergo.com and self-hosted
# instances. Build from the repository root:  docker build -f docker/Dockerfile .

# Base images are pinned by digest; Dependabot proposes updates.
FROM node:26-bookworm-slim@sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913 AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/
RUN npm ci --no-fund --no-audit

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @noergo/web --workspace @noergo/mcp --workspace @noergo/worker \
 && node scripts/bundle.mjs packages/core/scripts/migrate.ts packages/core/dist/migrate.mjs

FROM node:26-bookworm-slim@sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913 AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3041 \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3042
RUN groupadd --system --gid 10001 noergo \
 && useradd --system --uid 10001 --gid noergo --no-create-home --shell /usr/sbin/nologin noergo
WORKDIR /app
# Everything is owned by root and read-only to the service user.
COPY --from=build /src/apps/web/.next/standalone ./web
COPY --from=build /src/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build /src/apps/web/public ./web/apps/web/public
COPY --from=build /src/apps/mcp/dist ./mcp
COPY --from=build /src/apps/worker/dist ./worker
COPY --from=build /src/packages/core/dist/migrate.mjs ./migrate/migrate.mjs
COPY --from=build /src/packages/core/migrations ./migrations
COPY --from=build /src/packages/core/sql ./sql
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/noergo
COPY LICENSE ./LICENSE
LABEL org.opencontainers.image.source="https://github.com/nhkameda/noergo" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.title="noergo"
USER 10001:10001
EXPOSE 3041 3042
ENTRYPOINT ["noergo"]
CMD ["web"]
