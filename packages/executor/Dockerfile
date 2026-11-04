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
# Every environment and the brain's own sandbox use one folder, so a chat keeps its folder when it moves (environments EN24).
RUN mkdir -p /home/user/workspace && chown -R bun:bun /home/user
WORKDIR /home/user/workspace
EXPOSE 4100

USER bun
CMD ["bun", "/opt/ren/executor.js"]
