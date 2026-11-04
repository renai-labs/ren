# ren-environment-base: Ren's executor and its start script, with no brain. Every E2B environment
# template builds FROM it and adds its packages and build commands (specs/runtime/environments §3 Build).
FROM oven/bun:1.4.2

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ripgrep git procps ca-certificates curl sudo unzip jq build-essential \
    python3 python3-pip python3-venv nodejs npm golang-go \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/bin/python3 /usr/local/bin/python

# Build commands run as the sandbox user; sudo covers the rest.
RUN (id -u user >/dev/null 2>&1 || useradd --create-home --shell /bin/bash user) \
  && echo 'user ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/user \
  && chmod 0440 /etc/sudoers.d/user

COPY ren.tar.gz /tmp/ren.tar.gz
RUN mkdir -p /opt/ren && tar -xzf /tmp/ren.tar.gz -C /opt/ren && rm /tmp/ren.tar.gz \
  && cd /opt/ren && bun install --frozen-lockfile --production --filter @ren/executor --ignore-scripts

COPY environment-start.sh /opt/ren/environment-start.sh
RUN chmod 0755 /opt/ren/environment-start.sh \
  && git config --system url."https://github.com/".insteadOf "git@github.com:"

# Every client trusts the system store, which the start script extends with the egress CA (C44).
ENV EXECUTOR_PORT=4100 \
  SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
  REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
  NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
  CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
  GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt \
  AWS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
