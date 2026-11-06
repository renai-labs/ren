export * as Stage from "./stage.js"

import { Sandbox, Template, defaultBuildLogger } from "e2b"
import { Schema } from "effect"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

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

const Root = Schema.Struct({ packageManager: Schema.String })

// oxlint-disable-next-line ren/no-comments -- Follows imports at any depth (ren-v1 INV-105). A file that no entry point imports never reaches the image, so its change never rebuilds the template.
export const entrypoints = { brain: "packages/cell/src/bun.ts", executor: "packages/executor/src/main.ts" } as const

export const sources = async (
  repository: string,
  files: ReadonlyArray<string> = [entrypoints.brain, entrypoints.executor],
) => {
  const build = await Bun.build({
    entrypoints: files.map((file) => join(repository, file)),
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

// oxlint-disable-next-line ren/no-comments -- The image holds no Ren code, so the smoke run checks the system it gives: start.sh and Bun.
const smoke = async (tag: string) => {
  const sandbox = await Sandbox.create(tag, { metadata: { owner, smoke: "true" }, timeoutMs: 300_000 })
  const checked = await sandbox.commands.run("test -x /opt/ren/start.sh && bun --version", { timeoutMs: 60_000 }).then(
    (result) => result.exitCode === 0,
    () => false,
  )
  await sandbox.kill()
  return checked
}

if (import.meta.main) {
  const context = await mkdtemp(join(tmpdir(), "ren-image-"))
  const entries = await Promise.all(
    [...dockerfiles.map((file) => join(import.meta.dir, file)), join(import.meta.dir, "start.sh")].map(
      async (path) => ({
        path: path.slice(root.length + 1),
        content: await Bun.file(path).bytes(),
      }),
    ),
  )
  const bun = Schema.decodeUnknownSync(Root)(await Bun.file(join(root, "package.json")).json()).packageManager.replace(
    /^bun@/,
    "",
  )
  const version = hash([
    ...entries,
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
  await Bun.write(join(context, "start.sh"), Bun.file(join(import.meta.dir, "start.sh")))
  const parts = await Promise.all(dockerfiles.map((file) => Bun.file(join(import.meta.dir, file)).text()))
  const dockerfile = `${parts.join("\n").replace(/^FROM oven\/bun:.*$/m, `FROM oven/bun:${bun}`)}\n`
  await Template.build(
    Template({ fileContextPath: context })
      .fromDockerfile(dockerfile)
      .setStartCmd("/opt/ren/start.sh", "pgrep -f /opt/ren/start.sh"),
    tag,
    { ...size, onBuildLogs: defaultBuildLogger() },
  )
  await rm(context, { recursive: true, force: true })
  if (!(await smoke(tag))) {
    process.stderr.write(`The smoke sandbox of ${tag} did not run start.sh and Bun; do not use this tag\n`)
    process.exit(1)
  }
  process.stdout.write(`E2B_TEMPLATE=${tag}${dirty ? " (built from a tree with uncommitted files)" : ""}\n`)
}
