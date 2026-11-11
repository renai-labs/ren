export * as RenSnapshot from "./snapshot.js"

import { Location } from "@opencode/core/location"
import { RelativePath } from "@opencode/core/schema"
import { Snapshot } from "@opencode/core/snapshot"
import { State } from "@opencode/core/state"
import { VcsPatch } from "@opencode/core/vcs/patch"
import type { Workspace } from "@opencode/schema/workspace"
import { tags } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, Option } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"
import { posix } from "node:path"
import { RenVcs } from "./vcs.js"

// oxlint-disable-next-line ren/no-comments -- One run on the hand per call. As OpenCode's snapshots (`snapshot.ts`, `git.ts` capture and restore): a git store of its own per repository, which borrows the repository's objects and first index, takes the repository's ignore rules and skips untracked files over 2 MB. Each run writes a copy of the store's index, so two runs never share a lock. Output: "git" and the answer, "error" when a step failed, or nothing outside a repository.
const script = `
set -e
trap '[ $? = 0 ] || printf "error\\0"' EXIT
[ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || exit 0
top=$(git rev-parse --show-toplevel)
scope=$(git rev-parse --show-prefix)
objects=$(git rev-parse --path-format=absolute --git-path objects)
exclude=$(git rev-parse --path-format=absolute --git-path info/exclude)
seed=$(git rev-parse --path-format=absolute --git-path index)
GIT_DIR=\${XDG_DATA_HOME:-$HOME/.local/share}/ren/snapshot/$(printf %s "$top" | git hash-object --stdin)
GIT_WORK_TREE=$top
export GIT_DIR GIT_WORK_TREE
cd "$top"
if [ ! -f "$GIT_DIR/HEAD" ]; then
  mkdir -p "$GIT_DIR"
  git init -q
  git config core.autocrlf false
  git config gc.auto 0
  echo "$objects" > "$GIT_DIR/objects/info/alternates"
  cp -p "$seed" "$GIT_DIR/index" 2>/dev/null || true
fi
index=$(mktemp "$GIT_DIR/index.XXXXXX")
trap 'code=$?; rm -f "$index" "$index".*; [ "$code" = 0 ] || printf "error\\0"' EXIT
cp -p "$GIT_DIR/index" "$index" 2>/dev/null || rm -f "$index"
export GIT_INDEX_FILE="$index"
case $1 in
capture)
  cp "$exclude" "$GIT_DIR/info/exclude" 2>/dev/null || true
  git --literal-pathspecs ls-files -z --others --exclude-standard -- "./$scope" |
    xargs -0 sh -c 'for file do [ -f "$file" ] && [ "$(wc -c < "$file")" -gt 2097152 ] && printf ":(exclude,literal)%s\\0" "$file"; done; true' sh > "$index.skip"
  { printf './%s\\0' "$scope"; cat "$index.skip"; } | git add --all --pathspec-from-file=- --pathspec-file-nul
  tree=$(git write-tree)
  mv -f "$index" "$GIT_DIR/index"
  printf 'git\\0%s\\0' "$tree"
  ;;
files)
  git diff --name-only --no-renames -z "$2" "$3" > "$index.out"
  printf 'git\\0'
  cat "$index.out"
  ;;
diff)
  from=$2 to=$3 context=$4 limit=$5
  shift 5
  git --literal-pathspecs -c core.quotepath=false diff --no-ext-diff --no-renames --unified="$context" "$from" "$to" -- "$@" > "$index.out"
  printf 'git\\0'
  head -c "$limit" "$index.out"
  ;;
restore)
  shift
  while [ $# -gt 1 ]; do
    entry=$(git --literal-pathspecs ls-tree "$2" -- "$1")
    if [ -n "$entry" ]; then
      git --literal-pathspecs checkout "$2" -- "$1"
    else
      rm -rf -- "$1"
    fi
    shift 2
  done
  printf 'git\\0'
  ;;
esac
`

// oxlint-disable-next-line ren/no-comments -- OpenCode's snapshots run git on the brain's machine (`snapshot.ts:77-96`). With a remote hand, a revert reads and restores the chat's files on the hand (EN13). The config's "snapshots" switch still turns them off.
const layer = (spawnerOf: (workspaceId: Workspace.ID) => ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  Layer.effect(
    Snapshot.Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const state = State.create<{ enabled: boolean }, Snapshot.Editor>({
        name: "snapshot",
        initial: () => ({ enabled: true }),
        editor: (editor) => ({
          configure: (enabled) => {
            editor.enabled = enabled
          },
        }),
      })
      const spawner = Option.map(Option.fromNullishOr(location.workspaceID), spawnerOf)
      const run = (operation: Snapshot.Error["operation"], args: ReadonlyArray<string>) =>
        Option.isNone(spawner)
          ? Effect.succeed([])
          : spawner.value
              .string(ChildProcess.make("sh", ["-c", script, "ren-snapshot", ...args], { cwd: location.directory }))
              .pipe(
                Effect.map((output) => output.split("\u0000")),
                Effect.mapError(
                  (cause) => new Snapshot.Error({ operation, message: "git did not run on the hand", cause }),
                ),
              )
      const answer = Effect.fnUntraced(function* (operation: Snapshot.Error["operation"], args: ReadonlyArray<string>) {
        const fields = yield* run(operation, [operation, ...args])
        if (fields.at(0) !== "git") return yield* new Snapshot.Error({ operation, message: "git failed on the hand" })
        return fields.slice(1)
      })
      return Snapshot.Service.of({
        transform: state.transform,
        reload: state.reload,
        capture: Effect.fn("RenSnapshot.capture")(function* () {
          if (!state.get().enabled) return
          const fields = yield* run("capture", ["capture"]).pipe(
            Effect.catch((error) => Effect.logWarning("failed to capture snapshot", error).pipe(Effect.as([]))),
          )
          if (fields.at(0) === "error") yield* Effect.logWarning("failed to capture snapshot on the hand")
          const tree = fields.at(1)
          return fields.at(0) === "git" && tree ? Snapshot.ID.make(tree) : undefined
        }),
        files: Effect.fn("RenSnapshot.files")(function* (input) {
          return (yield* answer("files", [input.from, input.to]))
            .filter((file) => file !== "")
            .map((file) => RelativePath.make(file))
        }),
        diff: Effect.fn("RenSnapshot.diff")(function* (input) {
          if (input.paths?.length === 0) return []
          const fields = yield* answer("diff", [
            input.from,
            input.to,
            String(input.context ?? 3),
            String(VcsPatch.MAX_TOTAL_PATCH_BYTES + 1),
            ...(input.paths ?? []),
          ])
          return RenVcs.diffsOf(fields.join("\u0000"))
        }),
        restore: Effect.fn("RenSnapshot.restore")(function* (input) {
          if (!state.get().enabled)
            return yield* new Snapshot.Error({ operation: "restore", message: "Snapshots are disabled" })
          const escaped = [...input.files.keys()].find(
            (file) => posix.isAbsolute(file) || posix.normalize(file).split("/").at(0) === "..",
          )
          if (escaped)
            return yield* new Snapshot.Error({ operation: "restore", message: `Path escapes the project: ${escaped}` })
          if (input.files.size === 0) return
          yield* answer("restore", [...input.files].flat())
        }),
      })
    }),
  )

export const node = (spawnerOf: (workspaceId: Workspace.ID) => ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  LayerNode.make({
    service: Snapshot.Service,
    tag: tags.values.location,
    layer: layer(spawnerOf),
    deps: [Location.node],
  })
