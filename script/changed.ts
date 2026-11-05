export * as Changed from "./changed.js"

import { Schema } from "effect"

export const base = async () => {
  const upstream = (
    await Bun.$`git rev-parse --verify --quiet refs/remotes/origin/main`.quiet().nothrow().text()
  ).trim()
  return (await Bun.$`git merge-base HEAD ${upstream === "" ? "main" : upstream}`.text()).trim()
}

const Packages = Schema.Struct({
  packages: Schema.Struct({ items: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })) }),
})

export const packages = async (filter: string) =>
  Schema.decodeUnknownSync(Packages)(await Bun.$`bun turbo ls --filter=${filter} --output=json`.quiet().json()).packages
    .items

if (import.meta.main) {
  const command = process.argv.slice(2)
  if (command.length === 0) {
    console.log(await base())
  } else {
    const child = Bun.spawn({
      cmd: [...command, `--changed=${await base()}`],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    process.once("SIGINT", () => child.kill("SIGINT"))
    process.once("SIGTERM", () => child.kill("SIGTERM"))
    process.exitCode = await child.exited
  }
}
