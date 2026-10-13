FROM node:24-bookworm-slim AS esbuild
RUN npm install --prefix /opt/esbuild esbuild@0.28.2 \
  && cp /opt/esbuild/node_modules/@esbuild/linux-*/bin/esbuild /usr/local/bin/esbuild

FROM ghcr.io/denoland/celld:0.6.2
COPY --from=esbuild /usr/local/bin/esbuild /usr/local/bin/esbuild
