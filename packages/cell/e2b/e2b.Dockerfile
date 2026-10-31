FROM oven/bun:1.4.2

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ripgrep git procps ca-certificates curl fuse3 unzip \
  && rm -rf /var/lib/apt/lists/*

RUN version=v1.75.2 arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
       amd64) sum=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702 ;; \
       arm64) sum=7e1e8d69654941b7b7df84ee74c5f7fb09cce7d5496947fb7bf16b55ff427d10 ;; \
       *) echo "no rclone for $arch" >&2; exit 1 ;; \
     esac \
  && curl -fsSL -o /tmp/rclone.zip "https://downloads.rclone.org/$version/rclone-$version-linux-$arch.zip" \
  && echo "$sum  /tmp/rclone.zip" | sha256sum -c - \
  && unzip -q -j /tmp/rclone.zip "*/rclone" -d /usr/local/bin \
  && rm /tmp/rclone.zip

COPY ren.tar.gz /tmp/ren.tar.gz
RUN mkdir -p /opt/ren && tar -xzf /tmp/ren.tar.gz -C /opt/ren && rm /tmp/ren.tar.gz \
  && cd /opt/ren && bun install --frozen-lockfile --production --filter @ren/cell --filter @ren/executor --ignore-scripts

COPY start.sh /opt/ren/start.sh
RUN chmod 0755 /opt/ren/start.sh \
  && git config --system url."https://github.com/".insteadOf "git@github.com:"

# Every client trusts the system store, which start.sh extends with the egress CA (C44).
ENV BRAIN_PORT=4800 EXECUTOR_PORT=4100 \
  SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
  REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
  NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
  CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
  GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt \
  AWS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
