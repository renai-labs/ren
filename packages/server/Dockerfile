# syntax=docker/dockerfile:1-labs
# Build from the repository root: docker build -f packages/server/Dockerfile .
FROM oven/bun:1.4.2 AS deps
WORKDIR /repo

COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
# Every workspace manifest: `--frozen-lockfile` checks the whole graph against bun.lock.
COPY --parents packages/*/package.json repos/iron-proxy/package.json ./
RUN bun install --frozen-lockfile --filter '@ren/server' --filter '@ren/db'

# Ren's code for brains and hands, which machines download from this server at their wake (EN26).
FROM oven/bun:1.4.2 AS bundles
WORKDIR /repo
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY repos/iron-proxy/package.json ./repos/iron-proxy/package.json
RUN bun install --frozen-lockfile --filter '@ren/cell' --filter '@ren/executor' --ignore-scripts \
 && bun packages/cell/e2b/bundle.ts /bundles

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /repo

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /repo ./
COPY packages/server ./packages/server
COPY packages/core ./packages/core
COPY packages/db ./packages/db
COPY packages/host-api ./packages/host-api
COPY packages/egress-api ./packages/egress-api
COPY packages/environment-api ./packages/environment-api
COPY packages/opencode-transcript ./packages/opencode-transcript
COPY packages/protocol ./packages/protocol
COPY packages/schema ./packages/schema
COPY packages/telemetry ./packages/telemetry
COPY packages/util ./packages/util
COPY packages/server/docker/start.sh /usr/local/bin/ren-server
COPY --from=bundles /bundles /bundles
ENV REN_BUNDLES=/bundles

WORKDIR /repo/packages/server
EXPOSE 4100 4443

ARG REN_VERSION=development
ENV REN_VERSION=$REN_VERSION

ENTRYPOINT ["/usr/local/bin/ren-server"]
