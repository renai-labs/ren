import { Schema } from "effect"

const root = new URL("..", import.meta.url).pathname
const version = process.argv.at(2)
if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) {
  console.error("Usage: bun run opencode:bump <version>")
  process.exit(1)
}

const packageFile = Bun.file(`${root}/package.json`)
const text = await packageFile.text()
const catalog = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      workspaces: Schema.Struct({ catalog: Schema.Record(Schema.String, Schema.String) }),
    }),
  ),
)(text).workspaces.catalog
await Bun.write(
  packageFile,
  Object.keys(catalog)
    .filter((name) => name.startsWith("@opencode/"))
    .reduce((text, name) => text.replace(`"${name}": "${catalog[name] ?? ""}"`, `"${name}": "${version}"`), text),
)

await Bun.$`bun install`.cwd(root)
await Bun.$`bun run check`.cwd(root)
await Bun.$`bun run test:opencode`.cwd(root)
console.log(
  `OpenCode ${version} passes the existing recordings. Review upstream patches and storage changes, then run bun run opencode:record explicitly. Deploy the server before brains.`,
)
