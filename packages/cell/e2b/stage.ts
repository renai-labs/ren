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
      "A folder of Ren’s bundles (bun machine/bundle.ts <folder>). The image then holds their dependencies, so a new machine downloads only the sources. They do not name the image: a template with the same system is not built again.",
  }),
})

const options = Schema.decodeUnknownSync(Options)(Bun.env)

const name = options.E2B_TEMPLATE_NAME ?? "ren-brain-dev"

const owner = options.E2B_TEMPLATE_OWNER ?? "ren-v2-dev"

const size = { cpuCount: options.E2B_TEMPLATE_CPU ?? 2, memoryMB: options.E2B_TEMPLATE_MEMORY_MB ?? 2048 }

const dockerfiles =
  options.E2B_TEMPLATE_TOOLS === "full" ? ["e2b.Dockerfile", "e2b.tools.Dockerfile"] : ["e2b.Dockerfile"]

const Root = Schema.Struct({ packageManager: Schema.String })

// oxlint-disable-next-line ren/no-comments -- The image holds no Ren code, so the smoke run checks the system it gives: start.sh, start.js, Bun, and the seeded dependencies.
const smoke = async (tag: string, seeded: Option.Option<string>) => {
  const sandbox = await Sandbox.create(tag, { metadata: { owner, smoke: "true" }, timeoutMs: 300_000 })
  const ready = Option.match(seeded, {
    onNone: () => "",
    onSome: (tree) => ` && test -e /home/user/.ren/code/dependencies/${tree}/.ready`,
  })
  const checked = await sandbox.commands
    .run(`test -x /opt/ren/start.sh && test -s /opt/ren/start.js && bun --version${ready}`, { timeoutMs: 60_000 })
    .then(
      (result) => result.exitCode === 0,
      () => false,
    )
  await sandbox.kill()
  return checked
}

// oxlint-disable-next-line ren/no-comments -- The egress fork's binary, for the forwarder of split mode (egress-split.md §3.1). E2B runs amd64 machines. Without VCS stamps the same code gives the same bytes, so the tag changes only with the code.
export const forwarderProgram = async (out: string) => {
  await Bun.$`bun script/go.ts build -trimpath -buildvcs=false -o ${out} ./cmd/iron-proxy`
    .cwd(join(root, "repos", "iron-proxy"))
    .env({ ...Bun.env, GOOS: "linux", GOARCH: "amd64", CGO_ENABLED: "0" })
    .quiet()
  return Bun.file(out).bytes()
}

// oxlint-disable-next-line ren/no-comments -- start.js is start.ts with everything it imports, in one file: the machine runs it before any of Ren's code is there.
export const startProgram = async () => {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../machine/start.ts")], target: "bun" })
  const output = built.outputs.at(0)
  if (!built.success || !output) throw new AggregateError(built.logs, "start.ts did not build")
  return new Uint8Array(await output.arrayBuffer())
}

if (import.meta.main) {
  const context = await mkdtemp(join(tmpdir(), "ren-image-"))
  const start = await startProgram()
  const forwarder = await forwarderProgram(join(context, "iron-proxy"))
  const entries = [
    ...(await Promise.all(
      [...dockerfiles.map((file) => join(import.meta.dir, file)), join(import.meta.dir, "../machine/start.sh")].map(
        async (path) => ({ path: path.slice(root.length + 1), content: await Bun.file(path).bytes() }),
      ),
    )),
    { path: "start.js", content: start },
    { path: "iron-proxy", content: forwarder },
  ]
  const bun = Schema.decodeUnknownSync(Root)(await Bun.file(join(root, "package.json")).json()).packageManager.replace(
    /^bun@/,
    "",
  )
  const version = BundleBuild.hash([
    ...entries,
    { path: "bun", content: new TextEncoder().encode(bun) },
    { path: "size", content: new TextEncoder().encode(`${size.cpuCount}/${size.memoryMB}`) },
  ])
  const tag = `${name}:${version}`
  const seed = options.E2B_TEMPLATE_SEED
  const dependencies =
    seed === undefined
      ? Option.none()
      : Option.map(
          Option.fromNullishOr(
            Schema.decodeUnknownSync(Bundle.Manifest)(
              await Bun.file(join(seed, Bundle.manifestKey)).json(),
            ).bundles.find((bundle) => bundle.kind === "dependencies"),
          ),
          (bundle) => ({ file: join(seed, Bundle.keyOf(bundle)), tree: Bundle.treeOf([bundle], "dependencies") }),
        )
  const dirty = (await Bun.$`git status --porcelain`.cwd(root).text()).trim().length > 0
  const tags = (await Template.exists(name)) ? await Template.getTags(name) : []
  if (tags.some((each) => each.tag === version)) {
    await rm(context, { recursive: true, force: true })
    process.stdout.write(`${tag} exists; nothing to build\n`)
    process.exit(0)
  }
  await Bun.write(join(context, "start.sh"), Bun.file(join(import.meta.dir, "../machine/start.sh")))
  await Bun.write(join(context, "start.js"), start)
  const parts = await Promise.all(dockerfiles.map((file) => Bun.file(join(import.meta.dir, file)).text()))
  const seeded = Option.match(dependencies, {
    onNone: () => [],
    onSome: (found) => {
      const target = `/home/user/.ren/code/dependencies/${found.tree}`
      return [
        "COPY dependencies.tar.gz /tmp/dependencies.tar.gz",
        `RUN mkdir -p ${target} && tar -xzf /tmp/dependencies.tar.gz -C ${target} && touch ${target}/.ready && rm /tmp/dependencies.tar.gz && chown -R user:user /home/user/.ren`,
      ]
    },
  })
  if (Option.isSome(dependencies))
    await Bun.write(join(context, "dependencies.tar.gz"), Bun.file(dependencies.value.file))
  const dockerfile = `${[`FROM oven/bun:${bun}`, ...parts, ...seeded].join("\n")}\n`
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
      Option.map(dependencies, (found) => found.tree),
    ))
  ) {
    process.stderr.write(`The smoke sandbox of ${tag} did not have start.sh, start.js and Bun; do not use this tag\n`)
    process.exit(1)
  }
  process.stdout.write(`E2B_TEMPLATE=${tag}${dirty ? " (built from a tree with uncommitted files)" : ""}\n`)
}
