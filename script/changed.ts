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
