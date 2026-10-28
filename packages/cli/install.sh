#!/usr/bin/env bash
set -euo pipefail

default_host='__REN2_HOST_URL__'
host=${REN2_HOST_URL:-$default_host}
host=${host%/}
version=
modify_path=true
init=true

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      cat <<'EOF'
Install ren2

  --version <version>  Install a specific release
  --no-modify-path     Leave PATH and shell config alone
  --no-init            Skip onboarding
  --help              Show help

REN2_HOST_URL selects the release host.
EOF
      exit 0
      ;;
    -v|--version)
      [ "$#" -gt 1 ] && [ -n "$2" ] || fail '--version needs a value'
      version=${2#v}
      shift 2
      ;;
    --no-modify-path) modify_path=false; shift ;;
    --no-init) init=false; shift ;;
    *) fail "Unknown option: $1" ;;
  esac
done

case "$host" in
  https://*|http://*) ;;
  *) fail 'REN2_HOST_URL must be an HTTP or HTTPS URL' ;;
esac
command -v curl >/dev/null || fail 'curl is required'

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin)
    os=darwin
    if [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
    ;;
  Linux)
    os=linux
    getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail 'Linux requires glibc'
    ;;
  *) fail "Unsupported OS: $os" ;;
esac
case "$arch" in
  x86_64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) fail "Unsupported architecture: $arch" ;;
esac

download() {
  curl -fsSL --retry 2 --connect-timeout 15 --max-time 300 "$@"
}

if [ -z "$version" ]; then
  version=$(download "$host/ren2/latest.txt") || fail 'Could not find the latest release'
fi
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$ ]] || fail "Invalid version: $version"

asset="ren2-$os-$arch"
directory="$HOME/.ren2/bin"
mkdir -p "$directory"
temporary=$(mktemp -d "$directory/.install.XXXXXX")
trap 'rm -rf "$temporary"' EXIT
url="$host/ren2/releases/$version/$asset"
printf 'Downloading ren2 v%s (%s-%s)\n' "$version" "$os" "$arch"
if [ -t 2 ]; then
  download --no-silent --progress-bar "$url" -o "$temporary/ren2" || fail "Could not download ren2 $version"
else
  download "$url" -o "$temporary/ren2" || fail "Could not download ren2 $version"
fi
download "$url.sha256" -o "$temporary/checksum" || fail 'Could not download the checksum'
read -r expected filename extra < "$temporary/checksum" || fail 'Invalid checksum file'
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] && [ "$filename" = "$asset" ] && [ -z "$extra" ] || fail 'Invalid checksum file'
if command -v sha256sum >/dev/null; then
  actual=$(sha256sum "$temporary/ren2")
elif command -v shasum >/dev/null; then
  actual=$(shasum -a 256 "$temporary/ren2")
else
  fail 'sha256sum or shasum is required'
fi
[ "${actual%% *}" = "$expected" ] || fail 'Checksum mismatch'
chmod 755 "$temporary/ren2"
installed=$("$temporary/ren2" --version) || fail 'The downloaded executable could not start'
[ "$installed" = "ren2 v$version" ] || fail 'The downloaded executable has the wrong version'
mv -f "$temporary/ren2" "$directory/ren2"
printf 'Installed %s at %s/ren2\n' "$installed" "$directory"

on_path() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

linked=
if [ "$modify_path" = true ] && ! on_path "$directory"; then
  for bin in "$HOME/.local/bin" "$HOME/bin"; do
    if on_path "$bin" && [ -d "$bin" ] && [ -w "$bin" ] &&
      { [ ! -e "$bin/ren2" ] || [ "$(readlink "$bin/ren2")" = "$directory/ren2" ]; }; then
      ln -sf "$directory/ren2" "$bin/ren2"
      linked="$bin/ren2"
      printf 'Linked %s\n' "$linked"
      break
    fi
  done
fi

profile=
line="export PATH=\"\$HOME/.ren2/bin:\$PATH\""
if [ "$modify_path" = true ]; then
  shell=${SHELL:-}
  case "${shell##*/}" in
    zsh) profile="${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [ "$os" = darwin ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; fi
      ;;
    fish)
      profile="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
      line="fish_add_path \"\$HOME/.ren2/bin\""
      ;;
  esac
fi
if [ -n "$profile" ]; then
  mkdir -p "$(dirname "$profile")"
  if ! grep -Fqx "$line" "$profile" 2>/dev/null; then
    printf '\n%s\n' "$line" >> "$profile"
    printf 'Added %s to PATH in %s\n' "$directory" "$profile"
  fi
fi

# The installer runs in a child shell, so it cannot change the PATH of the terminal that started it.
path_hint() {
  if on_path "$directory" || [ -n "$linked" ]; then return; fi
  if [ -n "$profile" ]; then
    printf 'To use ren2 in this terminal, run:\n  source %q\n' "$profile"
  else
    printf 'Add %s to PATH.\n' "$directory"
  fi
}

if [ "$init" = true ] && [ -t 1 ]; then
  "$directory/ren2" login </dev/tty || printf 'Run ren2 login to sign in.\n'
  path_hint
else
  path_hint
  if [ "$init" = true ]; then printf 'Next: ren2 login\n'; fi
fi
