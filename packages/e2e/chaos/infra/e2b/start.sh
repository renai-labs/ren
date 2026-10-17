#!/bin/sh
set -eu
while [ ! -s /run/ren/executor.env ]; do sleep 0.2; done
set -a
. /run/ren/executor.env
set +a
exec bun /opt/ren/executor.js
