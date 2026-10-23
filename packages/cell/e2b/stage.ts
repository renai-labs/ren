export * as Stage from "./stage.js"

import { Signature } from "@ren/schema/signature"
import { Sandbox, Template, defaultBuildLogger } from "e2b"
import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export const root = join(import.meta.dir, "../../..")

const name = "ren-brain-dev"

const owner = "ren-v2-dev"

const Manifest = Schema.Struct({
  name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

const Root = Schema.Struct({ packageManager: Schema.String })

const listed = async (repository: string) =>
  (await Bun.$`git ls-files --cached --others --exclude-standard`.cwd(repository).text())
    .split("\n")
    .filter((file) => file.length > 0)

// oxlint-disable-next-line ren/no-comments -- The packages the image runs, with every workspace dependency they need at run time, at any depth (ren-v1 INV-105).
export const closure = async (repository: string, start: ReadonlyArray<string>) => {
  const manifests = await Promise.all(
    (await listed(repository))
      .filter((file) => /^packages\/[^/]+\/package\.json$/.test(file))
      .map(async (file) => ({
        directory: dirname(file),
        manifest: Schema.decodeUnknownSync(Manifest)(await Bun.file(join(repository, file)).json()),
      })),
  )
  const byName = new Map(manifests.map((each) => [each.manifest.name, each]))
  const visit = (names: ReadonlyArray<string>, seen: ReadonlySet<string>): ReadonlySet<string> => {
    const next = names.filter((each) => !seen.has(each) && byName.has(each))
    if (next.length === 0) return seen
    const deeper = next.flatMap((each) =>
      Object.entries(byName.get(each)?.manifest.dependencies ?? {})
        .filter((dependency) => dependency[1].startsWith("workspace:"))
        .map((dependency) => dependency[0]),
    )
    return visit(deeper, new Set([...seen, ...next]))
  }
  return [...visit(start, new Set())].flatMap((each) => {
    const found = byName.get(each)
    return found ? [found.directory] : []
  })
}

export const files = async (repository: string) => {
  const directories = await closure(repository, ["@ren/cell", "@ren/executor"])
  return (await listed(repository)).filter(
    (file) =>
      ["package.json", "bun.lock", "bunfig.toml", "tsconfig.base.json"].includes(file) ||
      /^packages\/[^/]+\/package\.json$/.test(file) ||
      directories.some((directory) => file.startsWith(`${directory}/src/`)),
  )
}

export const hash = (entries: ReadonlyArray<{ readonly path: string; readonly content: Uint8Array }>) =>
  entries
    .toSorted((left, right) => (left.path < right.path ? -1 : 1))
    .reduce(
      (digest, entry) => digest.update(entry.path).update("\0").update(entry.content).update("\0"),
      createHash("sha256"),
    )
    .digest("hex")
    .slice(0, 16)

const smoke = async (tag: string) => {
  const keys = await Effect.runPromise(Signature.generate("smoke"))
  const sandbox = await Sandbox.create(tag, { metadata: { owner, smoke: "true" }, timeoutMs: 300_000 })
  const env = [
    "REN_URL=http://127.0.0.1:9",
    "REN_BRAIN_ID=brn_00000000000000000000000000",
    "REN_BRAIN_GENERATION=1",
    `BRAIN_PUBLIC_KEYS='${Schema.encodeSync(Signature.PublicKeys)([keys.publicKey])}'`,
  ].join("\n")
  const url = `https://${sandbox.getHost(4800)}/ren/state`
  const deadline = Date.now() + 120_000
  const poll = async (): Promise<boolean> => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => undefined)
    if (response && response.status !== 502 && response.status !== 503) return true
    if (Date.now() > deadline) return false
    await Bun.sleep(1_000)
    return poll()
  }
  const answered = await sandbox.files
    .write("/home/user/.ren/brain.env", `${env}\n`, { user: "user" })
    .then(poll, () => false)
  await sandbox.kill()
  return answered
}

if (import.meta.main) {
  const staged = await files(root)
  const entries = await Promise.all(
    [
      ...staged.map((file) => join(root, file)),
      join(import.meta.dir, "e2b.Dockerfile"),
      join(import.meta.dir, "start.sh"),
    ].map(async (path) => ({ path: path.slice(root.length + 1), content: await Bun.file(path).bytes() })),
  )
  const bun = Schema.decodeUnknownSync(Root)(await Bun.file(join(root, "package.json")).json()).packageManager.replace(
    /^bun@/,
    "",
  )
  const version = hash([...entries, { path: "bun", content: new TextEncoder().encode(bun) }])
  const tag = `${name}:${version}`
  const dirty = (await Bun.$`git status --porcelain`.cwd(root).text()).trim().length > 0
  const tags = await Template.getTags(name).catch(() => [])
  if (tags.some((each) => each.tag === version)) {
    process.stdout.write(`${tag} exists; nothing to build\n`)
    process.exit(0)
  }
  const context = await mkdtemp(join(tmpdir(), "ren-brain-"))
  const tree = join(context, "ren")
  await Promise.all(
    staged.map(async (file) => {
      await mkdir(dirname(join(tree, file)), { recursive: true })
      await Bun.write(join(tree, file), Bun.file(join(root, file)))
    }),
  )
  await Bun.$`tar -czf ${join(context, "ren.tar.gz")} -C ${tree} .`
  await rm(tree, { recursive: true, force: true })
  await Bun.write(join(context, "start.sh"), Bun.file(join(import.meta.dir, "start.sh")))
  const dockerfile = `${(await Bun.file(join(import.meta.dir, "e2b.Dockerfile")).text()).replace(
    /^FROM oven\/bun:.*$/m,
    `FROM oven/bun:${bun}`,
  )}\nENV REN_BRAIN_VERSION=${version}\n`
  await Template.build(
    Template({ fileContextPath: context })
      .fromDockerfile(dockerfile)
      .setStartCmd("/opt/ren/start.sh", "pgrep -f /opt/ren/start.sh"),
    tag,
    { cpuCount: 2, memoryMB: 2048, onBuildLogs: defaultBuildLogger() },
  )
  await rm(context, { recursive: true, force: true })
  if (!(await smoke(tag))) {
    process.stderr.write(`The smoke sandbox of ${tag} did not answer /ren/state within 120 s; do not use this tag\n`)
    process.exit(1)
  }
  process.stdout.write(`E2B_TEMPLATE=${tag}${dirty ? " (built from a tree with uncommitted files)" : ""}\n`)
}
