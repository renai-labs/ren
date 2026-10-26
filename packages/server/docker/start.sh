#!/bin/sh
# Starts the server in a container: certificate files, migrations, then the server.
set -eu

# The server reads its egress certificates, and Bun reads extra trusted CAs (for example the
# database's), from files. A container platform passes secrets as environment values, so a value
# that holds a PEM is written to a file and the variable then names that file.
mkdir -p /run/ren
chmod 700 /run/ren
for name in EGRESS_TLS_CERT EGRESS_TLS_KEY EGRESS_TLS_CA EGRESS_CONTROL_TLS_CERT EGRESS_CONTROL_TLS_KEY EGRESS_CONTROL_TLS_CA EGRESS_CA_FILE NODE_EXTRA_CA_CERTS; do
  value=$(printenv "$name" || true)
  case "$value" in
    -----BEGIN*)
      printf '%s\n' "$value" >"/run/ren/$name.pem"
      chmod 600 "/run/ren/$name.pem"
      export "$name=/run/ren/$name.pem"
      ;;
  esac
done

(cd /repo/packages/db && bun --bun drizzle-kit migrate)

# A one-off task (for example `bun /repo/packages/core/script/ren-settings.ts`) runs with the same
# environment instead of the server.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec bun run src/main.ts
