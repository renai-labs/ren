FROM oven/bun:1.4.2

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ripgrep git procps ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY ren.tar.gz /tmp/ren.tar.gz
RUN mkdir -p /opt/ren && tar -xzf /tmp/ren.tar.gz -C /opt/ren && rm /tmp/ren.tar.gz \
  && cd /opt/ren && bun install --frozen-lockfile --production --filter @ren/cell --filter @ren/executor --ignore-scripts

COPY start.sh /opt/ren/start.sh
RUN chmod 0755 /opt/ren/start.sh

ENV BRAIN_PORT=4800 EXECUTOR_PORT=4100
