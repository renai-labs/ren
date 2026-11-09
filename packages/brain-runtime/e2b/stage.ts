export * as Stage from "./stage.js"

import { Sandbox, Template, defaultBuildLogger } from "e2b"
import { Bundle } from "@ren/schema/bundle"
import { BundleBuild } from "../machine/bundle.js"
import { Option, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = BundleBuild.root

// oxlint-disable-next-line ren/no-comments -- A deployment builds its own template: its own name, a bigger sandbox, and the full toolset its hands need. CPU and memory are fixed when E2B builds a template, so they are build options. The defaults are the development template.
const Options = Schema.Struct({
  E2B_TEMPLATE_NAME: Schema.optionalKey(Schema.String),
  E2B_TEMPLATE_CPU: Schema.optionalKey(Schema.NumberFromString),
  E2B_TEMPLATE_MEMORY_MB: Schema.optionalKey(Schema.NumberFromString),
  E2B_TEMPLATE_TOOLS: Schema.optionalKey(Schema.Literals(["base", "full"])),
  E2B_TEMPLATE_OWNER: Schema.optionalKey(Schema.String),
  E2B_TEMPLATE_SEED: Schema.optionalKey(Schema.String).annotate({
    description:
      "A folder of Ren’s bundles (bun machine/bundle.ts <folder>). The image then holds their dependencies, so a new machine downloads only the sources (EN26).",
  }),
})

const options = Schema.decodeUnknownSync(Options)(Bun.env)

const name = options.E2B_TEMPLATE_NAME ?? "ren-brain-dev"

const owner = options.E2B_TEMPLATE_OWNER ?? "ren-v2-dev"

const size = { cpuCount: options.E2B_TEMPLATE_CPU ?? 2, memoryMB: options.E2B_TEMPLATE_MEMORY_MB ?? 2048 }

const dockerfiles =
  options.E2B_TEMPLATE_TOOLS === "full" ? ["e2b.Dockerfile", "e2b.tools.Dockerfile"] : ["e2b.Dockerfile"]

const Root = Schema.Struct({ packageManager: Schema.String })

// oxlint-disable-next-line ren/no-comments -- The image holds no Ren code, so the smoke run checks the system it gives: start.sh, Bun, and the seeded dependencies.
const smoke = async (tag: string, seeded: Option.Option<string>) => {
  const sandbox = await Sandbox.create(tag, { metadata: { owner, smoke: "true" }, timeoutMs: 300_000 })
  const ready = Option.match(seeded, {
    onNone: () => "",
    onSome: (version) => ` && test -e /home/user/.ren/code/dependencies/${version}/.ready`,
  })
  const checked = await sandbox.commands
    .run(`test -x /opt/ren/start.sh && bun --version${ready}`, { timeoutMs: 60_000 })
    .then(
      (result) => result.exitCode === 0,
      () => false,
    )
  await sandbox.kill()
  return checked
}

if (import.meta.main) {
  const context = await mkdtemp(join(tmpdir(), "ren-image-"))
  const entries = await Promise.all(
    [...dockerfiles.map((file) => join(import.meta.dir, file)), join(import.meta.dir, "../machine/start.sh")].map(
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
  const version = BundleBuild.hash([
    ...entries,
    { path: "bun", content: new TextEncoder().encode(bun) },
    { path: "size", content: new TextEncoder().encode(`${size.cpuCount}/${size.memoryMB}`) },
  ])
  const seed = options.E2B_TEMPLATE_SEED
  const dependencies =
    seed === undefined
      ? Option.none()
      : Option.map(
          Option.fromNullishOr(
            Schema.decodeUnknownSync(Bundle.Manifest)(await Bun.file(join(seed, "manifest.json")).json()).bundles.find(
              (bundle) => bundle.kind === "dependencies",
            ),
          ),
          (bundle) => ({ file: join(seed, Bundle.fileOf(bundle)), version: bundle.version }),
        )
  // oxlint-disable-next-line ren/no-comments -- The dependencies' version ends the tag, after a hyphen; Ren ignores it when it compares a machine's image (machine-lifecycle.ts, systemOf).
  const tagged = Option.match(dependencies, { onNone: () => version, onSome: (found) => `${version}-${found.version}` })
  const tag = `${name}:${tagged}`
  const dirty = (await Bun.$`git status --porcelain`.cwd(root).text()).trim().length > 0
  const tags = await Template.getTags(name).catch(() => [])
  if (tags.some((each) => each.tag === tagged)) {
    await rm(context, { recursive: true, force: true })
    process.stdout.write(`${tag} exists; nothing to build\n`)
    process.exit(0)
  }
  await Bun.write(join(context, "start.sh"), Bun.file(join(import.meta.dir, "../machine/start.sh")))
  const parts = await Promise.all(dockerfiles.map((file) => Bun.file(join(import.meta.dir, file)).text()))
  const seeded = Option.match(dependencies, {
    onNone: () => [],
    onSome: (found) => {
      const target = `/home/user/.ren/code/dependencies/${found.version}`
      return [
        "COPY dependencies.tar.gz /tmp/dependencies.tar.gz",
        `RUN mkdir -p ${target} && tar -xzf /tmp/dependencies.tar.gz -C ${target} && touch ${target}/.ready && rm /tmp/dependencies.tar.gz && chown -R user:user /home/user/.ren`,
      ]
    },
  })
  if (Option.isSome(dependencies))
    await Bun.write(join(context, "dependencies.tar.gz"), Bun.file(dependencies.value.file))
  const dockerfile = `${[...parts, ...seeded].join("\n").replace(/^FROM oven\/bun:.*$/m, `FROM oven/bun:${bun}`)}\n`
  await Template.build(
    Template({ fileContextPath: context })
      .fromDockerfile(dockerfile)
      .setStartCmd("/opt/ren/start.sh", "pgrep -f /opt/ren/start.sh"),
    tag,
    { ...size, onBuildLogs: defaultBuildLogger() },
  )
  await rm(context, { recursive: true, force: true })
  if (
    !(await smoke(
      tag,
      Option.map(dependencies, (found) => found.version),
    ))
  ) {
    process.stderr.write(`The smoke sandbox of ${tag} did not run start.sh and Bun; do not use this tag\n`)
    process.exit(1)
  }
  process.stdout.write(`E2B_TEMPLATE=${tag}${dirty ? " (built from a tree with uncommitted files)" : ""}\n`)
}
