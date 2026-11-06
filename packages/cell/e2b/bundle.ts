export * as BundleBuild from "./bundle.js"

import { Bundle } from "@ren/schema/bundle"
import { DateTime, Schema } from "effect"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Stage } from "./stage.js"

const Root = Schema.Struct({ packageManager: Schema.String })

const encoder = new TextEncoder()

const copy = (repository: string, tree: string, files: ReadonlyArray<string>) =>
  Promise.all(
    files.map(async (file) => {
      await mkdir(dirname(join(tree, file)), { recursive: true })
      await Bun.write(join(tree, file), Bun.file(join(repository, file)))
    }),
  )

const archive = async (tree: string, out: string, kind: Bundle.Kind, version: string) => {
  const file = join(out, Bundle.fileOf({ kind, version }))
  await Bun.$`tar -czf ${file} -C ${tree} .`.quiet()
  const sha256 = createHash("sha256")
    .update(await Bun.file(file).bytes())
    .digest("hex")
  return { kind, version, sha256 }
}

// oxlint-disable-next-line ren/no-comments -- Builds the three bundles into out, with manifest.json. The dependencies are every workspace manifest, bun.lock and the install for the machines' platform; their version changes only with those files and Bun's version. A machine copies the dependencies' tree and unpacks a source bundle into the copy.
export const build = async (repository: string, out: string) => {
  await mkdir(out, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), "ren-bundles-"))
  // oxlint-disable-next-line ren/no-comments -- Every workspace manifest, because `--frozen-lockfile` checks the whole lockfile. A glob, not git: a Docker build has no .git.
  const manifests = (
    await Promise.all(
      ["package.json", "bun.lock", "bunfig.toml", "packages/*/package.json", "repos/iron-proxy/package.json"].map(
        (pattern) => Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: repository })),
      ),
    )
  )
    .flat()
    .toSorted()
  const bun = Schema.decodeUnknownSync(Root)(
    await Bun.file(join(repository, "package.json")).json(),
  ).packageManager.replace(/^bun@/, "")
  const dependencies = join(work, "dependencies")
  await copy(repository, dependencies, manifests)
  await Bun.$`bun install --frozen-lockfile --production --filter @ren/cell --filter @ren/executor --ignore-scripts --os linux --cpu x64`
    .cwd(dependencies)
    .quiet()
  const sourcesOf = async (kind: "brain" | "executor") => {
    const files = await Stage.sources(repository, [Stage.entrypoints[kind]])
    const tree = join(work, kind)
    await copy(repository, tree, files)
    const entries = await Promise.all(
      files.map(async (path) => ({ path, content: await Bun.file(join(repository, path)).bytes() })),
    )
    return archive(tree, out, kind, Stage.hash(entries))
  }
  const bundles = [
    await archive(
      dependencies,
      out,
      "dependencies",
      Stage.hash([
        ...(await Promise.all(
          manifests.map(async (path) => ({ path, content: await Bun.file(join(repository, path)).bytes() })),
        )),
        { path: "bun", content: encoder.encode(bun) },
      ]),
    ),
    await sourcesOf("brain"),
    await sourcesOf("executor"),
  ]
  await rm(work, { recursive: true, force: true })
  const manifest = Schema.encodeSync(Bundle.Manifest)({ builtAt: DateTime.nowUnsafe(), bundles })
  await Bun.write(join(out, "manifest.json"), JSON.stringify(manifest, null, 2))
  return manifest
}

if (import.meta.main) {
  const out = process.argv[2]
  if (!out) {
    process.stderr.write("usage: bun e2b/bundle.ts <output directory>\n")
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify(await build(Stage.root, out), null, 2)}\n`)
}
