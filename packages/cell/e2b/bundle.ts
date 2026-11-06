export * as BundleBuild from "./bundle.js"

import { Bundle } from "@ren/schema/bundle"
import { DateTime, Schema } from "effect"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Stage } from "./stage.js"

const Runtime = Schema.Struct({ name: Schema.String, private: Schema.Boolean, type: Schema.String })

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

// oxlint-disable-next-line ren/no-comments -- The version of a tree is the hash of every path in it with the hash of its bytes, or a link's target. One file at a time: the tree has about 47,000 files.
const versionOf = async (tree: string) =>
  Stage.hash(
    await Array.fromAsync(
      (await readdir(tree, { recursive: true, withFileTypes: true })).filter((entry) => !entry.isDirectory()),
      async (entry) => {
        const path = join(entry.parentPath, entry.name)
        return {
          path: path.slice(tree.length + 1),
          content: new TextEncoder().encode(
            entry.isSymbolicLink()
              ? await readlink(path)
              : new Bun.CryptoHasher("sha256").update(await Bun.file(path).bytes()).digest("hex"),
          ),
        }
      },
    ),
  )

// oxlint-disable-next-line ren/no-comments -- Builds the three bundles into out, with manifest.json. The dependencies are the install for the machines' platform, with the manifests that the brain and the executor read at run time only, so their version changes only when what the machines run changes, not with each lockfile change (bun.lock changed 92 times in 30 days). A machine copies the dependencies' tree and unpacks a source bundle into the copy.
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
  const dependencies = join(work, "dependencies")
  await copy(repository, dependencies, manifests)
  await Bun.$`bun install --frozen-lockfile --production --filter @ren/cell --filter @ren/executor --ignore-scripts --os linux --cpu x64`
    .cwd(dependencies)
    .quiet()
  const sources = {
    brain: await Stage.sources(repository, [Stage.entrypoints.brain]),
    executor: await Stage.sources(repository, [Stage.entrypoints.executor]),
  }
  const used = new Set([...sources.brain, ...sources.executor].map((file) => file.split("/").slice(0, 2).join("/")))
  await Promise.all(
    manifests
      .filter((path) => path !== "package.json" && path !== "bunfig.toml" && !used.has(dirname(path)))
      .map((path) => rm(join(dependencies, path))),
  )
  const root = Schema.decodeUnknownSync(Runtime)(await Bun.file(join(repository, "package.json")).json())
  await Bun.write(
    join(dependencies, "package.json"),
    `${JSON.stringify({ name: root.name, private: root.private, type: root.type }, null, 2)}\n`,
  )
  const sourcesOf = async (kind: "brain" | "executor") => {
    const files = sources[kind]
    const tree = join(work, kind)
    await copy(repository, tree, files)
    const entries = await Promise.all(
      files.map(async (path) => ({ path, content: await Bun.file(join(repository, path)).bytes() })),
    )
    return archive(tree, out, kind, Stage.hash(entries))
  }
  const bundles = [
    await archive(dependencies, out, "dependencies", await versionOf(dependencies)),
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
