export * as RenVcs from "./vcs.js"

import { Location } from "@opencode/core/location"
import { Vcs } from "@opencode/core/vcs"
import { VcsPatch } from "@opencode/core/vcs/patch"
import type { FileDiff } from "@opencode/schema/file-diff"
import type { Workspace } from "@opencode/schema/workspace"
import { tags } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer, Option } from "effect"
import { ChildProcess, type ChildProcessSpawner } from "effect/process"

// oxlint-disable-next-line ren/no-comments -- One run on the hand answers both the branches and the diff. Output: "git" (or "error" and a message, or nothing outside a repository), the current branch, the default branch, each ended by NUL, then the patch. A copy of the index takes the untracked files as intent-to-add, so a diff against the working tree shows them as added and the chat's own index stays as it is.
const script = `
[ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || exit 0
current=$(git symbolic-ref --quiet --short HEAD 2>/dev/null)
remote=$(git remote | grep -x origin || git remote | head -n 1)
head=$([ -n "$remote" ] && git symbolic-ref --quiet "refs/remotes/$remote/HEAD" 2>/dev/null)
ref=\${head#refs/remotes/}
default=\${ref#"$remote"/}
if [ -z "$head" ]; then
  ref=
  default=
  for name in "$(git config init.defaultBranch)" main master; do
    if [ -n "$name" ] && git show-ref --verify --quiet "refs/heads/$name"; then ref=$name; default=$name; break; fi
  done
fi
fail() { printf 'error\\0%s\\0' "$1"; exit 0; }
[ "$1" = info ] && { printf 'git\\0%s\\0%s\\0' "$current" "$default"; exit 0; }
from=$(git rev-parse --verify --quiet HEAD || git hash-object -t tree /dev/null)
to=
if [ "$1" != working ] && git rev-parse --verify --quiet HEAD >/dev/null; then
  [ -n "$ref" ] || fail "No review base available"
  from=$(git merge-base "$ref" HEAD 2>/dev/null) || fail "No merge base available for $ref"
  [ "$1" = committed ] && to=HEAD
elif [ "$1" = committed ]; then
  exit 0
fi
index=$(mktemp)
trap 'rm -f "$index" "$index.lock"' EXIT
cp -p "$(git rev-parse --git-path index)" "$index" 2>/dev/null || rm -f "$index"
[ -n "$to" ] || GIT_INDEX_FILE="$index" git add --intent-to-add -- . 2>/dev/null
printf 'git\\0%s\\0%s\\0' "$current" "$default"
GIT_INDEX_FILE="$index" git -c core.quotepath=false diff --no-ext-diff --no-renames --unified="$2" "$from" $to -- . | head -c "$3"
`

const statusOf = (chunk: string): FileDiff.Info["status"] => {
  if (/^new file mode /m.test(chunk)) return "added"
  if (/^deleted file mode /m.test(chunk)) return "deleted"
  return "modified"
}

export const diffsOf = (text: string) =>
  VcsPatch.splitGitPatch({
    text,
    truncated: new TextEncoder().encode(text).length > VcsPatch.MAX_TOTAL_PATCH_BYTES,
  }).flatMap((chunk): ReadonlyArray<FileDiff.Info> => {
    const file = VcsPatch.fileFromPatchChunk(chunk)
    if (!file) return []
    const counts = VcsPatch.countPatch(chunk)
    return [{ file, patch: chunk, additions: counts.additions, deletions: counts.deletions, status: statusOf(chunk) }]
  })

// oxlint-disable-next-line ren/no-comments -- OpenCode's git provider runs git on the brain's machine (`vcs.ts:261`). With a remote hand, the workspace panel's branch and diff come from git on the hand (EN13). Plugins add no providers here, so `transform` keeps nothing, as in OpenCode's workerd profile.
const layer = (spawnerOf: (workspaceId: Workspace.ID) => ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  Layer.effect(
    Vcs.Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const spawner = Option.map(Option.fromNullishOr(location.workspaceID), spawnerOf)
      const run = (mode: "info" | Vcs.Mode, context: number) =>
        Option.isNone(spawner)
          ? Effect.succeed([])
          : spawner.value
              .string(
                ChildProcess.make(
                  "sh",
                  ["-c", script, "ren-vcs", mode, String(context), String(VcsPatch.MAX_TOTAL_PATCH_BYTES + 1)],
                  { cwd: location.directory },
                ),
              )
              .pipe(
                Effect.map((output) => output.split("\u0000")),
                Effect.catchCause((cause) =>
                  Effect.logWarning("git on the hand failed", cause).pipe(Effect.as(["error", "git did not run"])),
                ),
              )
      const info = Effect.fn("RenVcs.info")(function* () {
        const fields = yield* run("info", 0)
        const current = fields.at(1)
        const named = fields.at(2)
        return fields.at(0) === "git"
          ? { provider: "git", branch: { ...(current ? { current } : {}), ...(named ? { default: named } : {}) } }
          : { branch: {} }
      })
      return Vcs.Service.of({
        transform: () => Effect.succeed({ dispose: Effect.void }),
        reload: () => Effect.void,
        initialize: () => Effect.fail(new Vcs.InitializeError({ kind: "unsupported" })),
        base: () => Effect.succeed(null),
        branches: () => Effect.succeed([]),
        status: () => Effect.succeed([]),
        info,
        diff: Effect.fn("RenVcs.diff")(function* (mode, options) {
          const fields = yield* run(mode, options?.context ?? VcsPatch.PATCH_CONTEXT_LINES)
          if (fields.at(0) === "error") return yield* new Vcs.DiffError({ message: fields.at(1) ?? "git failed" })
          if (fields.at(0) !== "git") return []
          return diffsOf(fields.slice(3).join("\u0000"))
        }),
      })
    }),
  )

export const node = (spawnerOf: (workspaceId: Workspace.ID) => ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  LayerNode.make({
    service: Vcs.Service,
    tag: tags.values.location,
    layer: layer(spawnerOf),
    deps: [Location.node],
  })
