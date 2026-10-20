import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

const directory = resolve(import.meta.dir, "..")
const packages = {
  effect: realpathSync(resolve(import.meta.dir, "../node_modules/effect")),
  "@tanstack/react-query": realpathSync(resolve(import.meta.dir, "../node_modules/@tanstack/react-query")),
  "@ren/schema": resolve(import.meta.dir, "../../schema"),
  "@ren/protocol": resolve(import.meta.dir, "../../protocol"),
  "@ren/core": resolve(import.meta.dir, "../../core"),
  "@ren/db": resolve(import.meta.dir, "../../db"),
  "@ren/server": resolve(import.meta.dir, "../../server"),
  "@ren/host-api": resolve(import.meta.dir, "../../host-api"),
  "@ren/environment-api": resolve(import.meta.dir, "../../environment-api"),
}
type Package = keyof typeof packages
const serverSide: ReadonlyArray<Package> = [
  "@ren/core",
  "@ren/db",
  "@ren/server",
  "@ren/host-api",
  "@ren/environment-api",
]

describe("public import boundaries", () => {
  test.each<{
    readonly entrypoint: string
    readonly uses: ReadonlyArray<Package>
    readonly never: ReadonlyArray<Package>
  }>([
    { entrypoint: "@ren/client", uses: [], never: ["effect", "@ren/schema", "@ren/protocol", ...serverSide] },
    {
      entrypoint: "@ren/client/react",
      uses: ["@tanstack/react-query"],
      never: ["effect", "@ren/schema", "@ren/protocol", ...serverSide],
    },
    { entrypoint: "@ren/client/effect", uses: ["effect", "@ren/schema", "@ren/protocol"], never: serverSide },
    { entrypoint: "@ren/client/chat", uses: [], never: ["effect", "@ren/schema", "@ren/protocol", ...serverSide] },
    { entrypoint: "@ren/client/chat/effect", uses: ["effect", "@ren/schema", "@ren/protocol"], never: serverSide },
  ])("$entrypoint imports only what it may", async (row) => {
    const bundle = await bundleInputs(row.entrypoint)

    expect(row.uses.filter((name) => !within(bundle.eager, packages[name]))).toEqual([])
    expect(row.never.filter((name) => within(bundle.all, packages[name]))).toEqual([])
  })
})

async function bundleInputs(specifier: string) {
  const temporary = await mkdtemp(join(import.meta.dir, ".import-boundary-"))
  const entrypoint = join(temporary, "index.ts")
  const metafile = join(temporary, "meta.json")
  try {
    await Bun.write(entrypoint, `export * from ${JSON.stringify(specifier)}`)
    const child = Bun.spawn(
      [
        process.execPath,
        "build",
        entrypoint,
        "--target=browser",
        "--format=esm",
        "--packages=bundle",
        `--metafile=${metafile}`,
        `--outdir=${join(temporary, "out")}`,
      ],
      { cwd: directory, stdout: "pipe", stderr: "pipe" },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(stdout + stderr)
    const metadata: {
      inputs: Record<string, { imports: Array<{ path: string; kind: string; external?: boolean }> }>
    } = await Bun.file(metafile).json()
    const inputs = new Map(Object.entries(metadata.inputs).map(([file, input]) => [resolve(directory, file), input]))
    const eager = new Set<string>()
    const visit = (file: string) => {
      if (eager.has(file)) return
      eager.add(file)
      for (const input of inputs.get(file)?.imports ?? []) {
        if (!input.external && input.kind !== "dynamic-import") visit(resolve(directory, input.path))
      }
    }
    visit(entrypoint)
    return { all: [...inputs.keys()], eager: [...eager] }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function within(inputs: ReadonlyArray<string>, directory: string) {
  const prefix = directory.endsWith(sep) ? directory : directory + sep
  return inputs.some((input) => input === directory || input.startsWith(prefix))
}
