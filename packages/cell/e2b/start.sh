#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ] && id user >/dev/null 2>&1; then
  # Ren uploads the egress CA before brain.env; trust it in the system store before the brain starts (C44).
  while [ ! -s /home/user/.ren/brain.env ]; do sleep 0.2; done
  if [ -s /home/user/.ren/egress-ca.pem ]; then
    cp /home/user/.ren/egress-ca.pem /usr/local/share/ca-certificates/ren-egress.crt
    update-ca-certificates >/dev/null
  fi
  exec su user -s /bin/sh -c "$0"
fi
home="${HOME:-/home/user}"
mkdir -p "$home/.ren" "$home/workspace"
while [ ! -s "$home/.ren/brain.env" ]; do sleep 0.2; done
set -a
. "$home/.ren/brain.env"
set +a
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
