import { Schema } from "effect"

const root = new URL("..", import.meta.url).pathname
const lock = Schema.decodeUnknownSync(
  Schema.Struct({ packages: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)) }),
)(Bun.JSONC.parse(await Bun.file(`${root}/bun.lock`).text()))
const versions = new Map<string, Set<string>>()
for (const entry of Object.values(lock.packages)) {
  const spec = entry.at(0)
  if (typeof spec !== "string") continue
  const at = spec.lastIndexOf("@")
  const name = spec.slice(0, at)
  if (name === "effect" || name.startsWith("@effect/") || name.startsWith("@opencode/"))
    versions.set(name, (versions.get(name) ?? new Set()).add(spec.slice(at + 1)))
}
const legacy = versions.get("@opencode/core")?.size === 1 && versions.get("@opencode/core")?.has("2.0.27")
const doubled = [...versions].filter(
  (entry) =>
    entry[1].size > 1 &&
    !(
      legacy &&
      entry[0] === "@effect/platform-node-shared" &&
      entry[1].size === 2 &&
      entry[1].has("4.0.1") &&
      entry[1].has("4.1.0")
    ),
)
if (doubled.length > 0) {
  for (const entry of doubled)
    console.error(`Shared package ${entry[0]} has multiple versions: ${[...entry[1]].join(", ")}`)
  process.exit(1)
}
