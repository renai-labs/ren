import path from "path"
import { Schema } from "effect"
import { Changed } from "./changed.js"

const base = await Changed.base()
const PackageJson = Schema.Struct({ scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)) })
const testable = async (pkg: { name: string; path: string }) =>
  pkg.path.startsWith("packages/") &&
  pkg.name !== "@ren/e2e" &&
  Schema.decodeUnknownSync(PackageJson)(await Bun.file(path.join(pkg.path, "package.json")).json()).scripts?.test !==
    undefined
const select = async (filter: string) =>
  (await Promise.all((await Changed.packages(filter)).map(async (pkg) => ((await testable(pkg)) ? [pkg] : [])))).flat()

const changed = await select(`[${base}]`)
const changedNames = new Set(changed.map((pkg) => pkg.name))
const dependents = (await select(`...[${base}]`)).filter((pkg) => !changedNames.has(pkg.name))

const failed: string[] = []
for (const pkg of changed) {
  console.error(`\n${pkg.name}: bun run test --changed=${base.slice(0, 7)}`)
  // oxlint-disable-next-line eslint/no-await-in-loop -- Test runs share the machine's memory budget.
  const run = await Bun.$`bun run test --changed=${base}`.cwd(pkg.path).nothrow()
  if (run.exitCode !== 0) failed.push(pkg.name)
}
if (dependents.length > 0) {
  console.error(
    `\nDepend on the changes but did not run (cd packages/<name> && bun run test): ${dependents.map((pkg) => pkg.name).join(", ")}`,
  )
}
if (failed.length > 0) {
  console.error(`\nFailed: ${failed.join(", ")}`)
  process.exitCode = 1
}
