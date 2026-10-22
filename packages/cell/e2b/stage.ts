import { mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

const root = join(import.meta.dir, "../../..")
const target = join(import.meta.dir, "ren")
const sources = ["packages/cell", "packages/brain", "packages/schema", "packages/host-api", "packages/environment-api", "packages/protocol"]
await rm(target, { recursive: true, force: true })
const listed = await Bun.$`git ls-files --cached --others --exclude-standard`.cwd(root).text()
const files = listed
  .split("\n")
  .filter((file) => file.length > 0)
  .filter(
    (file) =>
      ["package.json", "bun.lock", "bunfig.toml", "tsconfig.base.json"].includes(file) ||
      /^packages\/[^/]+\/package\.json$/.test(file) ||
      sources.some((source) => file.startsWith(`${source}/src/`) || file === `${source}/package.json`),
  )
await Promise.all(
  files.map(async (file) => {
    const source = Bun.file(join(root, file))
    if (!(await source.exists())) return
    await mkdir(dirname(join(target, file)), { recursive: true })
    await Bun.write(join(target, file), source)
  }),
)
await Bun.$`tar -czf ${join(import.meta.dir, "ren.tar.gz")} -C ${target} .`
await rm(target, { recursive: true, force: true })
console.log(`Staged ${files.length} files in ren.tar.gz`)
