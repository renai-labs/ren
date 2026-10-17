FROM oven/bun:1.4.2-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ripgrep procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY executor.js /opt/ren/executor.js
COPY start.sh /opt/ren/start.sh

RUN chmod 0755 /opt/ren/start.sh && mkdir -p /workspace /run/ren && chmod 0777 /workspace /run/ren

ENV EXECUTOR_WORKSPACE=/workspace PORT=4100
WORKDIR /workspace
