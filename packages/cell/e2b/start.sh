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
  # Docker reads only the system store and Chromium only its NSS store. The full template has both.
  if sudo -n true 2>/dev/null; then
    sudo cp "$home/.ren/egress-ca.pem" /usr/local/share/ca-certificates/ren-egress.crt || true
    sudo update-ca-certificates >/dev/null 2>&1 || true
    if sudo systemctl is-active --quiet docker 2>/dev/null; then sudo systemctl restart docker || true; fi
  fi
  if command -v certutil >/dev/null 2>&1; then
    nssdb="sql:$home/.pki/nssdb"
    mkdir -p "$home/.pki/nssdb"
    [ -f "$home/.pki/nssdb/cert9.db" ] || certutil -d "$nssdb" -N --empty-password || true
    certutil -d "$nssdb" -D -n ren-egress >/dev/null 2>&1 || true
    certutil -d "$nssdb" -A -t "C,," -n ren-egress -i "$home/.ren/egress-ca.pem" || true
  fi
fi
tools() { "$@"; }
if sudo -n systemd-run --quiet --scope --slice=ren-tools.slice true >/dev/null 2>&1; then
  export REN_TOOLS_MEMORY_EVENTS=/sys/fs/cgroup/ren.slice/ren-tools.slice/memory.events
  tools() {
    sudo -E env "PATH=$PATH" "HOME=$home" systemd-run --quiet --scope --slice=ren-tools.slice \
      --uid="$(id -u)" --gid="$(id -g)" -- "$@"
  }
fi
(
  export PORT="${EXECUTOR_PORT:-4100}" EXECUTOR_HOST=127.0.0.1 EXECUTOR_WORKSPACE="$home/workspace"
  while true; do
    tools bun /opt/ren/packages/executor/src/main.ts >>"$home/.ren/executor.log" 2>&1 || echo "$?" >"$home/.ren/executor.exit"
    sleep 1
  done
) &
export REN_HOME="$home" PORT="${BRAIN_PORT:-4800}"
cd "$home/workspace"
while true; do
  bun /opt/ren/packages/cell/src/bun.ts >>"$home/.ren/brain.log" 2>&1 || echo "$?" >"$home/.ren/brain.exit"
  sleep 1
done
