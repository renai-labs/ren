import fs from "fs/promises"
import os from "os"
import path from "path"
import { Option, Schema } from "effect"
import { Signoff } from "./signoff.js"

const remote = process.argv[2]
if (remote === undefined) throw new Error("Usage: push.ts <remote>, with git's pre-push lines on stdin")

const commits = [
  ...new Set(
    (await Bun.stdin.text()).split("\n").flatMap((line) => {
      const commit = /^\S+ ([0-9a-f]+) refs\/heads\/\S+ [0-9a-f]+$/.exec(line)?.[1]
      return commit === undefined || /^0+$/.test(commit) ? [] : [commit]
    }),
  ),
]
if (commits.length === 0) process.exit(0)

const root = "ren"
const blocking = ["lint", "typecheck"] as const
const PackageJson = Schema.Struct({
  name: Schema.String,
  scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const tested = (
  await Promise.all(
    (await Array.fromAsync(new Bun.Glob("packages/*/package.json").scan())).map(async (file) =>
      Schema.decodeUnknownSync(PackageJson)(await Bun.file(file).json()),
    ),
  )
)
  .filter((manifest) => manifest.scripts?.test !== undefined && manifest.name !== "@ren/e2e")
  .map((manifest) => manifest.name)
  .toSorted()

const Affected = Schema.Struct({
  data: Schema.Struct({
    affectedPackages: Schema.Struct({ items: Schema.Array(Schema.Struct({ name: Schema.String })) }),
  }),
})
const pushed = await Promise.all(
  commits.map(async (commit) => {
    const tree = (await Bun.$`git rev-parse ${commit}^{tree}`.text()).trim()
    const base = (await Bun.$`git merge-base ${commit} refs/remotes/${remote}/main`.quiet().nothrow().text()).trim()
    if (base === "") return { commit, tree, packages: tested }
    const affected = new Set(
      Schema.decodeUnknownSync(Affected)(
        await Bun.$`bun turbo query affected --packages --base ${base} --head ${commit}`.quiet().json(),
      ).data.affectedPackages.items.map((item) => item.name),
    )
    return { commit, tree, packages: tested.filter((name) => affected.has(name)) }
  }),
)

const runs = async (tree: string) => {
  const directory = await Signoff.runsDirectory(tree)
  const decoded = await Promise.all(
    (await fs.readdir(directory).catch(() => [])).map(async (file) =>
      Schema.decodeUnknownOption(Schema.fromJsonString(Signoff.Run))(await Bun.file(path.join(directory, file)).text()),
    ),
  )
  return decoded.filter(Option.isSome).map((run) => run.value)
}
const find = (found: ReadonlyArray<Signoff.Run>, name: string, script: string) =>
  found.find((run) => run.package === name && run.script === script)

const working = await Signoff.fingerprint()
const current = pushed.find((entry) => entry.tree === working)
const recorded = current === undefined ? [] : await runs(current.tree)
if (
  blocking.some((script) => find(recorded, root, script)?.passed !== true) &&
  (await Bun.$`bun run check`.nothrow()).exitCode !== 0
) {
  console.error("signoff: lint or typecheck failed. Fix it and push again.")
  process.exit(1)
}

const repository = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(process.argv[3] ?? "")?.[1]
const machine = `${os.platform() === "darwin" ? "macOS" : os.platform()} ${os.arch()}`
const duration = (ms: number) =>
  ms < 60_000
    ? `${Math.max(1, Math.round(ms / 1000))}s`
    : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
await Promise.all(
  pushed.map(async (entry) => {
    const found = await runs(entry.tree)
    const tests = entry.packages.map((name) => ({ name, run: find(found, name, "test") }))
    const failed = tests.filter((test) => test.run?.passed === false).map((test) => test.name)
    const missing = tests.filter((test) => test.run === undefined).map((test) => test.name)
    const passed = tests.reduce((total, test) => total + (test.run?.tests ?? 0), 0)
    const statuses = [
      ...blocking.map((name) => {
        const run = find(found, root, name)
        return {
          context: `signoff/${name}`,
          passed: run?.passed === true,
          description:
            run === undefined
              ? "Not run"
              : `${run.passed ? "Passed" : "Failed"} in ${duration(run.durationMs)} on ${machine}`,
        }
      }),
      {
        context: "signoff/test",
        passed: failed.length === 0 && missing.length === 0,
        description: (() => {
          if (failed.length > 0) return `Failed in ${failed.join(", ")}`
          if (missing.length > 0) return `Not run for ${missing.join(", ")}`
          if (tests.length === 0) return "No affected package has tests"
          return `${passed} passed in ${tests.length} affected ${tests.length === 1 ? "package" : "packages"} on ${machine}`
        })(),
      },
    ]
    if (repository !== undefined) {
      const pending: Signoff.Pending = { repository, statuses }
      await Bun.write(
        path.join(await Signoff.runsDirectory("pending"), `${entry.commit}.json`),
        JSON.stringify(pending),
      )
    }
    console.error(
      `signoff ${entry.commit.slice(0, 7)}: ${statuses
        .map((status) => `${status.context.replace("signoff/", "")} ${status.passed ? "✓" : `✗ ${status.description}`}`)
        .join(" · ")}`,
    )
  }),
)

const directory = await Signoff.runsDirectory()
const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
await Promise.all(
  (await fs.readdir(directory).catch(() => [])).map(async (name) =>
    (await fs.stat(path.join(directory, name))).mtimeMs < cutoff
      ? fs.rm(path.join(directory, name), { recursive: true, force: true })
      : undefined,
  ),
)
