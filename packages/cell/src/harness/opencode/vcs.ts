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
GIT_INDEX_FILE="$index" git -c core.quotepath=false diff --no-ext-diff --src-prefix=a/ --dst-prefix=b/ --no-renames --unified="$2" "$from" $to -- . | head -c "$3"
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

type Spawner = ChildProcessSpawner.ChildProcessSpawner["Service"]

const output = (spawner: Spawner, directory: string, command: string, args: ReadonlyArray<string>) =>
  spawner.string(ChildProcess.make("sh", ["-c", command, "ren-vcs", ...args], { cwd: directory })).pipe(
    Effect.map((text) => text.split("\u0000")),
    Effect.catchCause((cause) =>
      Effect.logWarning("git on the hand failed", cause).pipe(Effect.as(["error", "git did not run"])),
    ),
  )

// oxlint-disable-next-line ren/no-comments -- The branch and the diff of the repository in `directory`, from git on the hand. The workspace panel also reads a repository below the session's folder, such as one Ren cloned there.
export const make = (spawner: Spawner, directory: string) => {
  const run = (mode: "info" | Vcs.Mode, context: number) =>
    output(spawner, directory, script, [mode, String(context), String(VcsPatch.MAX_TOTAL_PATCH_BYTES + 1)])
  return {
    info: Effect.fn("RenVcs.info")(function* () {
      const fields = yield* run("info", 0)
      const current = fields.at(1)
      const named = fields.at(2)
      return fields.at(0) === "git"
        ? { provider: "git", branch: { ...(current ? { current } : {}), ...(named ? { default: named } : {}) } }
        : { branch: {} }
    }),
    diff: Effect.fn("RenVcs.diff")(function* (mode: Vcs.Mode, options?: { readonly context?: number | undefined }) {
      const fields = yield* run(mode, options?.context ?? VcsPatch.PATCH_CONTEXT_LINES)
      if (fields.at(0) === "error") return yield* new Vcs.DiffError({ message: fields.at(1) ?? "git failed" })
      if (fields.at(0) !== "git") return []
      return diffsOf(fields.slice(3).join("\u0000"))
    }),
  }
}

// oxlint-disable-next-line ren/no-comments -- Each repository in the session's folder or up to two folders below it, with its branch. Dependencies and Ren's own folder are not searched, and a repository's own .git is not entered.
const projectsScript = `
find . -maxdepth 3 \\( -name node_modules -o -name .ren \\) -prune -o -name .git -prune -print 2>/dev/null | sort | while IFS= read -r git; do
  dir=\${git%/.git}
  dir=\${dir#.}
  dir=\${dir#/}
  printf '%s\\0%s\\0' "\${dir:+$dir/}" "$(git -C "./$dir" symbolic-ref --quiet --short HEAD 2>/dev/null)"
done
`

export const projects = Effect.fn("RenVcs.projects")(function* (spawner: Spawner, directory: string) {
  const fields = yield* output(spawner, directory, projectsScript, [])
  if (fields.at(0) === "error") return []
  return Array.from({ length: Math.floor(fields.length / 2) }, (_, index) => {
    const branch = fields.at(index * 2 + 1)
    return { path: fields.at(index * 2) ?? "", ...(branch && { branch }) }
  })
})

// oxlint-disable-next-line ren/no-comments -- OpenCode's git provider runs git on the brain's machine (`vcs.ts:261`). With a remote hand, the workspace panel's branch and diff come from git on the hand. Plugins add no providers here, so `transform` keeps nothing, as in OpenCode's workerd profile.
const layer = (spawnerOf: (workspaceId: Workspace.ID) => Spawner) =>
  Layer.effect(
    Vcs.Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const repository = Option.map(Option.fromNullishOr(location.workspaceID), (workspaceId) =>
        make(spawnerOf(workspaceId), location.directory),
      )
      return Vcs.Service.of({
        transform: () => Effect.succeed({ dispose: Effect.void }),
        reload: () => Effect.void,
        initialize: () => Effect.fail(new Vcs.InitializeError({ kind: "unsupported" })),
        base: () => Effect.succeed(null),
        branches: () => Effect.succeed([]),
        status: () => Effect.succeed([]),
        info: () => (Option.isNone(repository) ? Effect.succeed({ branch: {} }) : repository.value.info()),
        diff: (mode, options) =>
          Option.isNone(repository) ? Effect.succeed([]) : repository.value.diff(mode, options),
      })
    }),
  )

export const node = (spawnerOf: (workspaceId: Workspace.ID) => Spawner) =>
  LayerNode.make({
    service: Vcs.Service,
    tag: tags.values.location,
    layer: layer(spawnerOf),
    deps: [Location.node],
  })
