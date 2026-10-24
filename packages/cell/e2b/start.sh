#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ] && id user >/dev/null 2>&1; then exec su user -s /bin/sh -c "$0"; fi
home="${HOME:-/home/user}"
mkdir -p "$home/.ren" "$home/workspace"
while [ ! -s "$home/.ren/brain.env" ]; do sleep 0.2; done
set -a
. "$home/.ren/brain.env"
set +a
# Ren uploads the egress CA before brain.env. Every client trusts the system
# store plus that CA, from a bundle in the user's home, so no root is needed (C44).
if [ -s "$home/.ren/egress-ca.pem" ]; then
  bundle="$home/.ren/ca-bundle.pem"
  cat /etc/ssl/certs/ca-certificates.crt "$home/.ren/egress-ca.pem" >"$bundle"
  export SSL_CERT_FILE="$bundle" REQUESTS_CA_BUNDLE="$bundle" NODE_EXTRA_CA_CERTS="$bundle" \
    CURL_CA_BUNDLE="$bundle" GIT_SSL_CAINFO="$bundle" AWS_CA_BUNDLE="$bundle"
fi
(
  export PORT="${EXECUTOR_PORT:-4100}" EXECUTOR_HOST=127.0.0.1 EXECUTOR_WORKSPACE="$home/workspace"
  while true; do
    bun /opt/ren/packages/executor/src/main.ts >>"$home/.ren/executor.log" 2>&1 || true
    sleep 1
  done
) &
export REN_HOME="$home" PORT="${BRAIN_PORT:-4800}"
cd "$home/workspace"
while true; do
  bun /opt/ren/packages/cell/src/bun.ts >>"$home/.ren/brain.log" 2>&1 || true
  sleep 1
done
