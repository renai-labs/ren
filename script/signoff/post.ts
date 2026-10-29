import fs from "fs/promises"
import path from "path"
import { Schema } from "effect"
import { Signoff } from "./signoff.js"

const file = process.argv[2]
if (file === undefined) throw new Error("Usage: post.ts <pending signoff>")
const commit = path.basename(file, ".json")
const pending = Schema.decodeUnknownSync(Schema.fromJsonString(Signoff.Pending))(await Bun.file(file).text())
await fs.rm(file, { force: true })

const results = await Promise.all(
  pending.statuses.map((status) =>
    Bun.$`gh api --silent repos/${pending.repository}/statuses/${commit} -f state=${status.passed ? "success" : "failure"} -f context=${status.context} -f description=${status.description.slice(0, 140)}`
      .quiet()
      .nothrow(),
  ),
)
const failure = results.find((result) => result.exitCode !== 0)
console.error(
  failure === undefined
    ? `signoff ${commit.slice(0, 7)}: posted to ${pending.repository}`
    : `signoff ${commit.slice(0, 7)}: could not post to GitHub: ${failure.stderr.toString().trim()}`,
)
