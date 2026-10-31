export * as Signoff from "./signoff.js"

import fs from "fs/promises"
import os from "os"
import path from "path"
import { Schema } from "effect"

export const Run = Schema.Struct({
  package: Schema.String,
  script: Schema.String,
  passed: Schema.Boolean,
  tests: Schema.optional(Schema.Number),
  durationMs: Schema.Number,
})
export type Run = typeof Run.Type

export const Pending = Schema.Struct({
  repository: Schema.String,
  statuses: Schema.Array(Schema.Struct({ context: Schema.String, passed: Schema.Boolean, description: Schema.String })),
})
export type Pending = typeof Pending.Type

export const fingerprint = async () => {
  const index = path.join(os.tmpdir(), `ren-signoff-index-${crypto.randomUUID()}`)
  await Bun.write(index, Bun.file((await Bun.$`git rev-parse --path-format=absolute --git-path index`.text()).trim()))
  const environment = { ...process.env, GIT_INDEX_FILE: index }
  const added = await Bun.$`git add -A`.env(environment).quiet().nothrow()
  const tree = added.exitCode === 0 ? (await Bun.$`git write-tree`.env(environment).text()).trim() : undefined
  await fs.rm(index, { force: true })
  return tree
}

export const runsDirectory = async (tree?: string) =>
  path.join(
    (await Bun.$`git rev-parse --path-format=absolute --git-common-dir`.text()).trim(),
    "ren-signoff",
    tree ?? "",
  )
