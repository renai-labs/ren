export * as Stage from "./stage.js"

import { Signature } from "@ren/schema/signature"
import { Sandbox, Template, defaultBuildLogger } from "e2b"
import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"

export const root = join(import.meta.dir, "../../..")

// oxlint-disable-next-line ren/no-comments -- A deployment builds its own template: its own name, a bigger sandbox, and the full toolset its hands need. CPU and memory are fixed when E2B builds a template, so they are build options. The defaults are the development template.
const Options = Schema.Struct({
  E2B_TEMPLATE_NAME: Schema.optionalKey(Schema.String),
  E2B_TEMPLATE_CPU: Schema.optionalKey(Schema.NumberFromString),
  E2B_TEMPLATE_MEMORY_MB: Schema.optionalKey(Schema.NumberFromString),
  E2B_TEMPLATE_TOOLS: Schema.optionalKey(Schema.Literals(["base", "full"])),
  E2B_TEMPLATE_OWNER: Schema.optionalKey(Schema.String),
})

const options = Schema.decodeUnknownSync(Options)(Bun.env)

const name = options.E2B_TEMPLATE_NAME ?? "ren-brain-dev"

const owner = options.E2B_TEMPLATE_OWNER ?? "ren-v2-dev"

const size = { cpuCount: options.E2B_TEMPLATE_CPU ?? 2, memoryMB: options.E2B_TEMPLATE_MEMORY_MB ?? 2048 }

const dockerfiles =
  options.E2B_TEMPLATE_TOOLS === "full" ? ["e2b.Dockerfile", "e2b.tools.Dockerfile"] : ["e2b.Dockerfile"]

// oxlint-disable-next-line ren/no-comments -- The fields of a workspace manifest that Bun reads to load the package's files. Its dependencies count through the installed links.
const Manifest = Schema.Struct({
  name: Schema.String,
  type: Schema.optionalKey(Schema.String),
  exports: Schema.optionalKey(Schema.Unknown),
  imports: Schema.optionalKey(Schema.Unknown),
})

const Root = Schema.Struct({ packageManager: Schema.String })

// oxlint-disable-next-line ren/no-comments -- Follows imports at any depth (ren-v1 INV-105). A file that no entry point imports never reaches the image, so its change never rebuilds the template.
export const sources = async (repository: string) => {
  const build = await Bun.build({
    entrypoints: ["packages/cell/src/bun.ts", "packages/executor/src/main.ts"].map((file) => join(repository, file)),
    target: "bun",
    metafile: true,
    plugins: [
      {
        name: "npm",
        setup: (builder) => {
          builder.onResolve({ filter: /^(?!@ren\/)[^./]/ }, (args) => ({ path: args.path, external: true }))
        },
      },
    ],
  })
  return Object.keys(build.metafile?.inputs ?? {})
    .map((file) => relative(repository, resolve(file)))
    .filter((file) => /^packages\/[^/]+\/src\//.test(file))
    .toSorted()
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
  const imported = await sources(root)
  // oxlint-disable-next-line ren/no-comments -- Every workspace manifest, because `--frozen-lockfile` checks the whole lockfile.
  const staged = [
    ...(await Bun.$`git ls-files --cached --others --exclude-standard`.cwd(root).text())
      .split("\n")
      .filter(
        (file) =>
          ["package.json", "bun.lock", "bunfig.toml"].includes(file) || /^packages\/[^/]+\/package\.json$/.test(file),
      ),
    ...imported,
  ]
  const context = await mkdtemp(join(tmpdir(), "ren-brain-"))
  const tree = join(context, "ren")
  await Promise.all(
    staged.map(async (file) => {
      await mkdir(dirname(join(tree, file)), { recursive: true })
      await Bun.write(join(tree, file), Bun.file(join(root, file)))
    }),
  )
  // oxlint-disable-next-line ren/no-comments -- The install of e2b.Dockerfile, for the sandbox's platform. Each link names the version and peers a package resolves to, so the links change exactly when the image's dependencies do, whatever else changes in bun.lock.
  await Bun.$`bun install --frozen-lockfile --production --filter @ren/cell --filter @ren/executor --ignore-scripts --os linux --cpu x64`
    .cwd(tree)
    .quiet()
  const links = await Promise.all(
    (await Bun.$`find node_modules packages -type l`.cwd(tree).text())
      .split("\n")
      .filter((link) => link.length > 0)
      .map(async (link) => `${link} -> ${await readlink(join(tree, link))}\n`),
  )
  const manifests = await Promise.all(
    [...new Set(imported.map((file) => file.slice(0, file.indexOf("/src/"))))].map(async (directory) => ({
      path: `${directory}/package.json`,
      content: new TextEncoder().encode(
        JSON.stringify(
          Schema.decodeUnknownSync(Manifest)(await Bun.file(join(root, directory, "package.json")).json()),
        ),
      ),
    })),
  )
  const entries = await Promise.all(
    [
      ...imported.map((file) => join(root, file)),
      ...dockerfiles.map((file) => join(import.meta.dir, file)),
      join(import.meta.dir, "start.sh"),
    ].map(async (path) => ({ path: path.slice(root.length + 1), content: await Bun.file(path).bytes() })),
  )
  const bun = Schema.decodeUnknownSync(Root)(await Bun.file(join(root, "package.json")).json()).packageManager.replace(
    /^bun@/,
    "",
  )
  const version = hash([
    ...entries,
    ...manifests,
    { path: "node_modules", content: new TextEncoder().encode(links.toSorted().join("")) },
    { path: "bun", content: new TextEncoder().encode(bun) },
    { path: "size", content: new TextEncoder().encode(`${size.cpuCount}/${size.memoryMB}`) },
  ])
  const tag = `${name}:${version}`
  const dirty = (await Bun.$`git status --porcelain`.cwd(root).text()).trim().length > 0
  const tags = await Template.getTags(name).catch(() => [])
  if (tags.some((each) => each.tag === version)) {
    await rm(context, { recursive: true, force: true })
    process.stdout.write(`${tag} exists; nothing to build\n`)
    process.exit(0)
  }
  await Bun.$`tar -czf ${join(context, "ren.tar.gz")} --exclude=node_modules -C ${tree} .`
  await rm(tree, { recursive: true, force: true })
  await Bun.write(join(context, "start.sh"), Bun.file(join(import.meta.dir, "start.sh")))
  const parts = await Promise.all(dockerfiles.map((file) => Bun.file(join(import.meta.dir, file)).text()))
  const dockerfile = `${parts.join("\n").replace(/^FROM oven\/bun:.*$/m, `FROM oven/bun:${bun}`)}\nENV REN_BRAIN_VERSION=${version}\n`
  await Template.build(
    Template({ fileContextPath: context })
      .fromDockerfile(dockerfile)
      .setStartCmd("/opt/ren/start.sh", "pgrep -f /opt/ren/start.sh"),
    tag,
    { ...size, onBuildLogs: defaultBuildLogger() },
  )
  await rm(context, { recursive: true, force: true })
  if (!(await smoke(tag))) {
    process.stderr.write(`The smoke sandbox of ${tag} did not answer /ren/state within 120 s; do not use this tag\n`)
    process.exit(1)
  }
  process.stdout.write(`E2B_TEMPLATE=${tag}${dirty ? " (built from a tree with uncommitted files)" : ""}\n`)
}
