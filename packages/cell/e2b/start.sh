#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ] && id user >/dev/null 2>&1; then exec su user -s /bin/sh -c "$0"; fi
home="${HOME:-/home/user}"
mkdir -p "$home/.ren" "$home/workspace"
while [ ! -s "$home/.ren/brain.env" ]; do sleep 0.2; done
set -a
. "$home/.ren/brain.env"
set +a
export REN_HOME="$home" PORT="${BRAIN_PORT:-4800}"
cd "$home/workspace"
while true; do
  bun /opt/ren/packages/cell/src/bun.ts >>"$home/.ren/brain.log" 2>&1 || true
  sleep 1
done
