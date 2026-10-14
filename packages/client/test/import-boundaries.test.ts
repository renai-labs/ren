import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

const directory = resolve(import.meta.dir, "..")
const effect = realpathSync(resolve(import.meta.dir, "../node_modules/effect"))
const query = realpathSync(resolve(import.meta.dir, "../node_modules/@tanstack/react-query"))
const schema = resolve(import.meta.dir, "../../schema")
const protocol = resolve(import.meta.dir, "../../protocol")
const core = resolve(import.meta.dir, "../../core")
const db = resolve(import.meta.dir, "../../db")
const server = resolve(import.meta.dir, "../../server")
const brainApi = resolve(import.meta.dir, "../../brain-api")

describe("public import boundaries", () => {
  test("promise entrypoint pulls in no Effect, schema, protocol or server code", async () => {
    const root = await bundleInputs("@ren/client")

    expect(within(root.all, effect)).toEqual([])
    expect(within(root.all, schema)).toEqual([])
    expect(within(root.all, protocol)).toEqual([])
    expect(within(root.all, core)).toEqual([])
    expect(within(root.all, db)).toEqual([])
    expect(within(root.all, server)).toEqual([])
    expect(within(root.all, brainApi)).toEqual([])
  })

  test("react entrypoint adds TanStack Query but no Effect, schema, protocol or server code", async () => {
    const react = await bundleInputs("@ren/client/react")

    expect(within(react.all, query).length).toBeGreaterThan(0)
    expect(within(react.all, effect)).toEqual([])
    expect(within(react.all, schema)).toEqual([])
    expect(within(react.all, protocol)).toEqual([])
    expect(within(react.all, core)).toEqual([])
    expect(within(react.all, db)).toEqual([])
    expect(within(react.all, server)).toEqual([])
    expect(within(react.all, brainApi)).toEqual([])
  })

  test("effect entrypoint uses schema and protocol but never core, db, server or brain-api", async () => {
    const network = await bundleInputs("@ren/client/effect")

    expect(within(network.eager, effect).length).toBeGreaterThan(0)
    expect(within(network.eager, schema).length).toBeGreaterThan(0)
    expect(within(network.eager, protocol).length).toBeGreaterThan(0)
    expect(within(network.all, core)).toEqual([])
    expect(within(network.all, db)).toEqual([])
    expect(within(network.all, server)).toEqual([])
    expect(within(network.all, brainApi)).toEqual([])
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
  return inputs.filter((input) => input === directory || input.startsWith(prefix))
}
