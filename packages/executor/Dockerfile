FROM oven/bun:1.4.2-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ripgrep procps ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY executor.js /opt/ren/executor.js

# A hand trusts the system store; the egress CA goes there at provision (C44).
ENV PORT=4100 \
  SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
  REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
  NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
  CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
  GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt \
  AWS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
RUN mkdir /workspace && chown bun:bun /workspace
WORKDIR /workspace
EXPOSE 4100

USER bun
CMD ["bun", "/opt/ren/executor.js"]
