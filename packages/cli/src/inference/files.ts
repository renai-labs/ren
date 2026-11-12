export * as HarnessFiles from "./files.js"

import { RenInference } from "@ren/schema/ren-inference"
import { Clock, Effect, FileSystem, Schema } from "effect"
import { homedir } from "node:os"
import { basename, dirname, join, relative } from "node:path"
import { Directories } from "../directories.js"
import { Output } from "../services/output.js"
import { Merge } from "./merge.js"

export const placeholder = "${REN_INFERENCE_KEY}"

const targets: Readonly<
  Record<
    RenInference.HarnessTarget["kind"],
    (profile: string) => { readonly path: string; readonly format: Merge.Format }
  >
> = {
  "claude-user-settings": () => ({ path: ".claude/settings.json", format: "json" }),
  "codex-provider-configuration": () => ({ path: ".codex/config.toml", format: "toml" }),
  "codex-profile": (profile) => ({ path: `.codex/${profile}.config.toml`, format: "toml" }),
  "codex-model-catalog": (profile) => ({ path: `.codex/${profile}-models.json`, format: "json" }),
  "opencode-user-configuration": () => ({ path: ".config/opencode/opencode.jsonc", format: "jsonc" }),
  "pi-model-catalog": () => ({ path: ".pi/agent/models.json", format: "json" }),
  "hermes-provider-configuration": () => ({ path: ".hermes/config.yaml", format: "yaml" }),
  "hermes-environment": () => ({ path: ".hermes/.env", format: "dotenv" }),
}

const profileName = /^[a-z0-9][a-z0-9-]{0,31}$/u

export const home = () => process.env.HOME ?? homedir()

export const backups = () => join(Directories.config(), "inference-backups")

export interface Entry {
  readonly display: string
  readonly path: string
  readonly existed: boolean
  readonly before: string
  readonly after: string | null
  readonly secret: boolean
}

export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}
export const Manifest = Schema.Struct({
  createdAt: Schema.String,
  harness: Schema.String,
  entries: Schema.Array(Schema.Struct({ target: Schema.String, saved: Schema.NullOr(Schema.String) })),
})

const OperationJson = Schema.fromJsonString(RenInference.HarnessOperation)

const fail = (message: string) => new Output.Failure({ message })

const within = (boundary: string, candidate: string) => {
  const step = relative(boundary, candidate)
  return step === "" || (!step.startsWith("..") && !step.startsWith("/"))
}

// oxlint-disable-next-line ren/no-comments -- Every target sits under the home directory; a path, or a link, that leads out of it is refused.
const resolve = Effect.fnUntraced(function* (target: RenInference.HarnessTarget) {
  const fs = yield* FileSystem.FileSystem
  const profile = "profileName" in target ? target.profileName : ""
  if ("profileName" in target && !profileName.test(profile))
    return yield* fail(`Ren sent an unusable profile name: ${profile}`)
  const shape = targets[target.kind](profile)
  const root = yield* fs.realPath(home())
  const path = join(root, shape.path)
  const existing = yield* fs.exists(path)
  const real = existing ? yield* fs.realPath(path) : path
  if (!within(root, real)) return yield* fail(`~/${shape.path} leads outside the home directory.`)
  return { path: real, display: `~/${shape.path}`, format: shape.format }
})

export const withKey = (operation: RenInference.HarnessOperation, key: string) =>
  Schema.encodeEffect(OperationJson)(operation).pipe(
    Effect.flatMap((text) =>
      Schema.decodeEffect(OperationJson)(text.replaceAll(placeholder, JSON.stringify(key).slice(1, -1))),
    ),
  )

// oxlint-disable-next-line ren/no-comments -- Two edits of one file stack: each applies to the text the one before it made.
export const build = Effect.fnUntraced(function* (operations: ReadonlyArray<RenInference.HarnessOperation>) {
  const fs = yield* FileSystem.FileSystem
  const entries = new Map<string, Entry>()
  for (const operation of operations) {
    const target = yield* resolve(operation.target)
    const previous = entries.get(target.path)
    const existed = previous?.existed ?? (yield* fs.exists(target.path))
    const before = previous?.before ?? (existed ? yield* fs.readFileString(target.path) : "")
    const current = previous ? (previous.after ?? "") : before
    const after = yield* Effect.try({
      try: () => Merge.apply(current, operation, target.format),
      catch: (cause) => fail(`${target.display}: ${cause instanceof Error ? cause.message : String(cause)}`),
    })
    entries.set(target.path, {
      display: target.display,
      path: target.path,
      existed,
      before,
      after,
      secret: operation.containsSecret || (previous?.secret ?? false),
    })
  }
  return [...entries.values()].filter(
    (entry) => entry.after !== entry.before && (typeof entry.after === "string" || entry.existed),
  )
})

const writeAtomic = Effect.fnUntraced(function* (path: string, text: string, options: { readonly secret: boolean }) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(dirname(path), { recursive: true })
  const existing = (yield* fs.exists(path)) ? (yield* fs.stat(path)).mode & 0o777 : null
  // ast-grep-ignore: no-nullish-comparison, -- a mode of 0 is a mode.
  const mode = existing === null || options.secret ? 0o600 : existing
  const temp = join(dirname(path), `.ren2-${process.pid}-${yield* Clock.currentTimeMillis}.tmp`)
  yield* fs.writeFileString(temp, text, { mode })
  yield* fs.chmod(temp, mode)
  yield* fs.rename(temp, path)
})

const restore = Effect.fnUntraced(function* (manifest: Manifest) {
  const fs = yield* FileSystem.FileSystem
  for (const entry of manifest.entries) {
    if (!entry.saved) yield* fs.remove(entry.target, { force: true })
    else yield* writeAtomic(entry.target, yield* fs.readFileString(entry.saved), { secret: true })
  }
  return manifest.entries.map((entry) => entry.target)
})

// oxlint-disable-next-line ren/no-comments -- Backs up each file first, in ren2's config folder and never beside the original, then writes. A failed write restores the backup.
export const write = Effect.fnUntraced(function* (harness: string, entries: ReadonlyArray<Entry>) {
  const fs = yield* FileSystem.FileSystem
  const createdAt = new Date(yield* Clock.currentTimeMillis).toISOString()
  const dir = join(backups(), createdAt.replaceAll(/[:.]/gu, "-"))
  yield* fs.makeDirectory(dir, { recursive: true })
  const saved = entries.map((entry, index) => ({
    target: entry.path,
    saved: entry.existed ? join(dir, `${index}-${basename(entry.path)}`) : null,
  }))
  yield* Effect.forEach(entries, (entry, index) => {
    const copy = saved[index]?.saved
    return copy ? fs.writeFileString(copy, entry.before, { mode: 0o600 }) : Effect.void
  })
  const manifest = { createdAt, harness, entries: saved }
  yield* fs.writeFileString(
    join(dir, "manifest.json"),
    `${yield* Schema.encodeEffect(Schema.fromJsonString(Manifest))(manifest)}\n`,
    { mode: 0o600 },
  )
  yield* Effect.forEach(entries, (entry) =>
    // ast-grep-ignore: no-nullish-comparison, -- null removes a file; "" writes an empty one.
    entry.after === null ? fs.remove(entry.path, { force: true }) : writeAtomic(entry.path, entry.after, entry),
  ).pipe(
    Effect.catch((cause) =>
      restore(manifest).pipe(
        Effect.ignore,
        Effect.andThen(Effect.fail(fail(`Could not write the files, so nothing changed: ${cause.message}`))),
      ),
    ),
  )
  return dir
})

export const undo = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem
  const root = backups()
  const names = (yield* fs.exists(root)) ? yield* fs.readDirectory(root) : []
  const newest = names.reduce<string | undefined>((found, name) => (!found || name > found ? name : found), undefined)
  if (!newest) return yield* fail("There is no backup to restore.")
  const dir = join(root, newest)
  const manifest = yield* fs
    .readFileString(join(dir, "manifest.json"))
    .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Manifest))))
  return { dir, harness: manifest.harness, restored: yield* restore(manifest) }
})
