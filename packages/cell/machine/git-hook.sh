#!/bin/sh
# Every git hook name in /opt/ren/git-hooks links to this file; Ren's image sets core.hooksPath there.
# prepare-commit-msg adds a Co-authored-by trailer for each line of REN_CO_AUTHORS except the author,
# when the repository has no remote or one on GITHUB_URL. Then every hook runs the repository's own.
name=$(basename "$0")

if [ "$name" = prepare-commit-msg ] && [ -n "$REN_CO_AUTHORS" ]; then
  host=${GITHUB_URL:-https://github.com}
  host=${host#*://}
  remotes=$(git remote -v)
  if [ -z "$remotes" ] || printf '%s\n' "$remotes" | grep -q -F "$host"; then
    author=$(git var GIT_AUTHOR_IDENT | sed 's/^[^<]*<\([^>]*\)>.*/\1/')
    printf '%s\n' "$REN_CO_AUTHORS" | while IFS= read -r who; do
      case "$who" in
        "" | *"<$author>"*) ;;
        *) git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Co-authored-by: $who" "$1" ;;
      esac
    done
  fi
fi

own=$(git config --type=path --show-scope --get-all core.hooksPath | awk -F '\t' '$1 != "command" { path = $2 } END { print path }')
[ -n "$own" ] || own="$(git rev-parse --git-common-dir)/hooks"
[ "$own" != "$(dirname "$0")" ] && [ -x "$own/$name" ] && exec "$own/$name" "$@"
exit 0
