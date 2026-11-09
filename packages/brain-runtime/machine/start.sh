#!/bin/sh
set -eu
home="${HOME:-/home/user}"
code="$home/.ren/code"

# Ren's code comes in bundles from Ren, not in the image (EN26). A bundle is
# "kind:version:sha256:token". The dependencies come first; the brain's and
# the executor's trees are hard-linked copies of them with their sources on
# top, so most deploys download only the sources. A process restarts only when
# its own version changed (EN27).
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

download() {
  mkdir -p "$code/downloads"
  archive="$code/downloads/$1-$2.tar.gz"
  curl -fsS --retry 3 --connect-timeout 10 --max-time 600 -H "Authorization: Bearer $4" "$REN_URL/host/bundles/$1/$2" -o "$archive.part" || return 1
  if [ "$(sha256 "$archive.part")" != "$3" ]; then
    rm -f "$archive.part"
    echo "The bundle $1 $2 does not match its sha256" >&2
    return 1
  fi
  mv "$archive.part" "$archive" || return 1
}

# Called in a condition, where `set -e` does not apply, so each step checks.
unpack() {
  rm -rf "$2.part"
  mkdir -p "$(dirname "$2")" || return 1
  if [ -n "$3" ]; then
    cp -al "$code/dependencies/$3" "$2.part" 2>/dev/null || cp -R "$code/dependencies/$3" "$2.part" || return 1
    rm -f "$2.part/.ready"
  else
    mkdir -p "$2.part" || return 1
  fi
  tar -xzf "$1" -C "$2.part" || return 1
  rm -rf "$2"
  mv "$2.part" "$2" || return 1
  touch "$2/.ready"
  rm -f "$1"
}

prepare() {
  dependencies=""
  for bundle in $1; do
    kind=${bundle%%:*}
    rest=${bundle#*:}
    version=${rest%%:*}
    rest=${rest#*:}
    sum=${rest%%:*}
    token=${rest#*:}
    case $kind in
      dependencies)
        dependencies=$version
        target="$code/dependencies/$version"
        if [ ! -e "$target/.ready" ]; then
          download "$kind" "$version" "$sum" "$token" || return 1
          unpack "$archive" "$target" "" || return 1
        fi
        ;;
      brain | executor)
        if [ -z "$dependencies" ]; then
          echo "The bundle $kind comes before the dependencies" >&2
          return 1
        fi
        tree="$version-$dependencies"
        target="$code/$kind/$tree"
        if [ ! -e "$target/.ready" ]; then
          download "$kind" "$version" "$sum" "$token" || return 1
          unpack "$archive" "$target" "$dependencies" || return 1
        fi
        previous=$(cat "$home/.ren/$kind.version" 2>/dev/null || true)
        echo "$tree" >"$home/.ren/$kind.version.next" || return 1
        mv "$home/.ren/$kind.version.next" "$home/.ren/$kind.version" || return 1
        if [ "$kind" = executor ] && [ -n "$previous" ] && [ "$previous" != "$tree" ] && [ -s "$home/.ren/executor.pid" ]; then
          kill -TERM "$(cat "$home/.ren/executor.pid")" 2>/dev/null || true
        fi
        ;;
    esac
  done
}

# The brain runs `start.sh prepare <bundles>` for an update at a wake. It stops
# itself afterwards when its own version changed.
if [ "${1:-}" = prepare ]; then
  mkdir -p "$home/.ren"
  prepare "$2" || exit 1
  exit 0
fi

if [ "$(id -u)" = "0" ] && id user >/dev/null 2>&1; then exec su user -s /bin/sh -c "$0"; fi
mkdir -p "$home/.ren" "$home/workspace"
while [ ! -s "$home/.ren/brain.env" ]; do sleep 0.2; done
set -a
. "$home/.ren/brain.env"
set +a
if [ -z "${REN_BUNDLES:-}" ]; then
  echo "brain.env names no bundles (REN_BUNDLES)" >&2
  exit 1
fi
# Ren uploads the egress CA before brain.env. Every client trusts the system
# store plus that CA, from a bundle in the user's home, so no root is needed (C44).
# This comes before the bundles: behind the egress, their download needs the CA.
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
until prepare "$REN_BUNDLES"; do
  echo "The bundles are not ready; the next try is in 5 s" >&2
  sleep 5
done
# The tokens are for this download only. An update brings its own, so the
# brain, the executor and the agent's commands do not get them.
unset REN_BUNDLES
tools() { "$@"; }
if sudo -n systemd-run --quiet --scope --slice=ren-tools.slice true >/dev/null 2>&1; then
  export REN_TOOLS_MEMORY_EVENTS=/sys/fs/cgroup/ren.slice/ren-tools.slice/memory.events
  tools() {
    sudo -E env "PATH=$PATH" "HOME=$home" systemd-run --quiet --scope --slice=ren-tools.slice \
      --uid="$(id -u)" --gid="$(id -g)" -- "$@"
  }
fi
# A remote hand (REN_HAND=1) runs the executor only, and answers Ren and the
# brains from outside the machine.
executor_host=127.0.0.1
if [ -n "${REN_HAND:-}" ]; then executor_host=0.0.0.0; fi
(
  export PORT="${EXECUTOR_PORT:-4100}" EXECUTOR_HOST="$executor_host" EXECUTOR_WORKSPACE="$home/workspace"
  while true; do
    tree=$(cat "$home/.ren/executor.version")
    tools bun "$code/executor/$tree/packages/executor/src/main.ts" >>"$home/.ren/executor.log" 2>&1 &
    echo "$!" >"$home/.ren/executor.pid"
    wait "$!" || echo "$?" >"$home/.ren/executor.exit"
    sleep 1
  done
) &
if [ -n "${REN_HAND:-}" ]; then
  wait
  exit 0
fi
export REN_HOME="$home" PORT="${BRAIN_PORT:-4800}"
cd "$home/workspace"
kill_when_stuck() {
  missed=0
  while sleep 5; do
    if curl -s -o /dev/null -m 5 "http://127.0.0.1:$PORT/ren/state"; then
      missed=0
    else
      missed=$((missed + 1))
      if [ "$missed" -ge 12 ]; then
        echo 120 >"$home/.ren/brain.stuck"
        kill -KILL "$1"
        return
      fi
    fi
  done
}
while true; do
  tree=$(cat "$home/.ren/brain.version")
  REN_BRAIN_VERSION="$tree" bun "$code/brain/$tree/packages/brain-runtime/src/bun.ts" >>"$home/.ren/brain.log" 2>&1 &
  brain=$!
  kill_when_stuck "$brain" &
  watchdog=$!
  wait "$brain" || echo "$?" >"$home/.ren/brain.exit"
  kill "$watchdog" 2>/dev/null || true
  sleep 1
done
