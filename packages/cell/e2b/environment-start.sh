#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ] && id user >/dev/null 2>&1; then exec su user -s /bin/sh -c "$0"; fi
home="${HOME:-/home/user}"
mkdir -p "$home/.ren" "$home/workspace"
# Ren uploads environment.env when it makes the sandbox: the executor's variables (EXECUTOR_ENVIRONMENT_ID, ENVIRONMENT_PUBLIC_KEYS).
while [ ! -s "$home/.ren/environment.env" ]; do sleep 0.2; done
set -a
. "$home/.ren/environment.env"
set +a
# Ren uploads the egress CA before environment.env. Every client trusts the system store plus that CA (C44).
if [ -s "$home/.ren/egress-ca.pem" ]; then
  bundle="$home/.ren/ca-bundle.pem"
  cat /etc/ssl/certs/ca-certificates.crt "$home/.ren/egress-ca.pem" >"$bundle"
  export SSL_CERT_FILE="$bundle" REQUESTS_CA_BUNDLE="$bundle" NODE_EXTRA_CA_CERTS="$bundle" \
    CURL_CA_BUNDLE="$bundle" GIT_SSL_CAINFO="$bundle" AWS_CA_BUNDLE="$bundle"
  if sudo -n true 2>/dev/null; then
    sudo cp "$home/.ren/egress-ca.pem" /usr/local/share/ca-certificates/ren-egress.crt || true
    sudo update-ca-certificates >/dev/null 2>&1 || true
  fi
fi
export PORT="${EXECUTOR_PORT:-4100}" EXECUTOR_WORKSPACE="$home/workspace"
cd "$home/workspace"
while true; do
  bun /opt/ren/packages/executor/src/main.ts >>"$home/.ren/executor.log" 2>&1 || echo "$?" >"$home/.ren/executor.exit"
  sleep 1
done
