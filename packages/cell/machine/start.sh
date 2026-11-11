#!/bin/sh
# Runs at a machine's start: it waits for the variables that Ren uploads, drops root
# and hands over to start.js, which unpacks Ren's code and runs the processes.
set -eu
if [ "$(id -u)" = "0" ] && id user >/dev/null 2>&1; then exec su user -s /bin/sh -c "$0"; fi
home="${HOME:-/home/user}"
mkdir -p "$home/.ren"
while [ ! -s "$home/.ren/brain.env" ]; do sleep 0.2; done
set -a
. "$home/.ren/brain.env"
set +a
exec bun /opt/ren/start.js
