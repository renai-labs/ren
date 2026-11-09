import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const start = join(import.meta.dir, "../machine/start.sh")

const work = await mkdtemp(join(tmpdir(), "ren-prepare-"))

afterAll(() => rm(work, { recursive: true, force: true }))

const token = "header.claims.signature"

const archives = new Map<string, Uint8Array>()

const requests: Array<string> = []

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const path = new URL(request.url).pathname
    requests.push(path)
    const body = archives.get(path)
    if (!body || request.headers.get("authorization") !== `Bearer ${token}`) return new Response(null, { status: 404 })
    return new Response(body)
  },
})

afterAll(() => server.stop(true))

// oxlint-disable-next-line ren/no-comments -- Packs files into a bundle archive that the fake Ren serves, and gives its "kind:version:sha256:token".
const bundle = async (kind: string, version: string, files: Readonly<Record<string, string>>) => {
  const tree = join(work, `${kind}-${version}`)
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await mkdir(join(tree, path, ".."), { recursive: true })
      await Bun.write(join(tree, path), content)
    }),
  )
  const archive = `${tree}.tar.gz`
  await Bun.$`tar -czf ${archive} -C ${tree} .`.quiet()
  const bytes = await Bun.file(archive).bytes()
  archives.set(`/host/bundles/${kind}/${version}`, bytes)
  return `${kind}:${version}:${createHash("sha256").update(bytes).digest("hex")}:${token}`
}

const prepare = (home: string, bundles: ReadonlyArray<string>) =>
  Bun.spawn(["sh", start, "prepare", bundles.join(" ")], {
    env: { ...process.env, HOME: home, REN_URL: server.url.origin },
    stdout: "ignore",
    stderr: "pipe",
  }).exited

const dependencies = await bundle("dependencies", "d1", { "node_modules/shared/index.js": "export const shared = 1" })

const brain = await bundle("brain", "b1", { "packages/brain-runtime/src/bun.ts": "export {}" })

const executor = await bundle("executor", "e1", { "packages/executor/src/main.ts": "export {}" })

describe("start.sh prepare", () => {
  test("unpacks each source bundle on a copy of the dependencies and names it current; a second prepare downloads nothing", async () => {
    const home = await mkdtemp(join(work, "home-"))
    expect(await prepare(home, [dependencies, brain, executor])).toBe(0)
    expect(await readFile(join(home, ".ren/brain.version"), "utf8")).toBe("b1-d1\n")
    const tree = join(home, ".ren/code/brain/b1-d1")
    expect(await Bun.file(join(tree, "packages/brain-runtime/src/bun.ts")).text()).toBe("export {}")
    expect(await Bun.file(join(tree, "node_modules/shared/index.js")).text()).toBe("export const shared = 1")
    requests.length = 0
    expect(await prepare(home, [dependencies, brain, executor])).toBe(0)
    expect(requests).toEqual([])
  })

  test("a new executor bundle stops the running executor, and keeps the brain's version", async () => {
    const home = await mkdtemp(join(work, "home-"))
    expect(await prepare(home, [dependencies, brain, executor])).toBe(0)
    const running = Bun.spawn(["sleep", "30"])
    await Bun.write(join(home, ".ren/executor.pid"), String(running.pid))
    const next = await bundle("executor", "e2", { "packages/executor/src/main.ts": "export const next = 2" })
    expect(await prepare(home, [dependencies, brain, next])).toBe(0)
    expect(await running.exited).not.toBe(0)
    expect(await readFile(join(home, ".ren/executor.version"), "utf8")).toBe("e2-d1\n")
    expect(await readFile(join(home, ".ren/brain.version"), "utf8")).toBe("b1-d1\n")
  })

  test("an archive that does not match its sha256 fails the prepare and changes nothing", async () => {
    const home = await mkdtemp(join(work, "home-"))
    expect(await prepare(home, [dependencies, brain, executor])).toBe(0)
    const wrong = (await bundle("brain", "b2", { "packages/brain-runtime/src/bun.ts": "export {}" })).replace(
      /:[0-9a-f]{64}:/,
      `:${"0".repeat(64)}:`,
    )
    expect(await prepare(home, [dependencies, wrong, executor])).toBe(1)
    expect(await readFile(join(home, ".ren/brain.version"), "utf8")).toBe("b1-d1\n")
  })
})
