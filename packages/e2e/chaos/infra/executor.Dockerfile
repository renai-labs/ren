FROM oven/bun:1.4.2-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ripgrep procps \
  && rm -rf /var/lib/apt/lists/*

COPY executor.js /opt/ren/executor.js

ENV PORT=4100 EXECUTOR_WORKSPACE=/workspace
WORKDIR /workspace
EXPOSE 4100

USER bun
CMD ["bun", "/opt/ren/executor.js"]
