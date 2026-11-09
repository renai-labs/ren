import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const start = join(import.meta.dir, "../machine/start.sh")

const work = await mkdtemp(join(tmpdir(), "ren-prepare-"))

afterAll(() => rm(work, { recursive: true, force: true }))

const token = "header.claims.signature"

const archives = new Map<string, Uint8Array>()

const requests: Array<string> = []

// oxlint-disable-next-line ren/no-comments -- A download of a held path waits until the test releases it; `arrived` has one promise per request, which resolves when that request arrives.
const held = new Map<
  string,
  {
    readonly arrived: readonly [PromiseWithResolvers<void>, PromiseWithResolvers<void>]
    readonly released: Promise<void>
  }
>()

// oxlint-disable-next-line ren/no-comments -- Paths that answer 404 once, as a Ren server without the bundle does during a deploy.
const missingOnce = new Set<string>()

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    requests.push(path)
    if (missingOnce.delete(path)) return new Response(null, { status: 404 })
    const hold = held.get(path)
    if (hold) {
      hold.arrived[requests.filter((each) => each === path).length - 1]?.resolve()
      await hold.released
    }
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

  test("keeps only the code that the brain and the executor run now or ran before", async () => {
    const home = await mkdtemp(join(work, "home-"))
    const release = async (number: number) => [
      await bundle("dependencies", `d${number}`, { "node_modules/shared/index.js": `export const shared = ${number}` }),
      await bundle("brain", `b${number}`, { "packages/brain-runtime/src/bun.ts": "export {}" }),
      await bundle("executor", `e${number}`, { "packages/executor/src/main.ts": "export {}" }),
    ]
    expect(await prepare(home, await release(7))).toBe(0)
    expect(await prepare(home, await release(8))).toBe(0)
    expect(await prepare(home, await release(9))).toBe(0)
    const code = join(home, ".ren/code")
    expect((await readdir(join(code, "dependencies"))).toSorted()).toEqual(["d8", "d9"])
    expect((await readdir(join(code, "brain"))).toSorted()).toEqual(["b8-d8", "b9-d9"])
    expect((await readdir(join(code, "executor"))).toSorted()).toEqual(["e8-d8", "e9-d9"])
  })

  test("the executor and the agent's commands do not get the bundle tokens", async () => {
    const home = await mkdtemp(join(work, "home-"))
    const bin = join(home, "bin")
    await mkdir(join(home, ".ren"), { recursive: true })
    await Bun.write(
      join(home, ".ren/brain.env"),
      `REN_URL=${server.url.origin}\nREN_BUNDLES='${[dependencies, brain, executor].join(" ")}'\n`,
    )
    // oxlint-disable-next-line ren/no-comments -- A fake bun records the executor's environment and removes its version, so the executor loop ends and start.sh of a hand exits.
    await Bun.write(join(bin, "bun"), `#!/bin/sh\nenv >"$HOME/.ren/executor.env"\nrm "$HOME/.ren/executor.version"\n`)
    await Bun.$`chmod +x ${join(bin, "bun")}`
    const started = Bun.spawn(["sh", start], {
      env: { HOME: home, REN_HAND: "1", PATH: `${bin}:${process.env.PATH}` },
      stdout: "ignore",
      stderr: "ignore",
    })
    await started.exited
    const seen = await readFile(join(home, ".ren/executor.env"), "utf8")
    expect(seen).toContain(`REN_URL=${server.url.origin}`)
    expect(seen).not.toContain("REN_BUNDLES")
  })

  test("a second prepare waits until the first one ends, and downloads nothing", async () => {
    const home = await mkdtemp(join(work, "home-"))
    expect(await prepare(home, [dependencies, brain, executor])).toBe(0)
    const slow = await bundle("brain", "b5", { "packages/brain-runtime/src/bun.ts": "export const slow = 5" })
    const released = Promise.withResolvers<void>()
    const arrived = [Promise.withResolvers<void>(), Promise.withResolvers<void>()] as const
    held.set("/host/bundles/brain/b5", { arrived, released: released.promise })
    const first = prepare(home, [dependencies, slow, executor])
    await arrived[0].promise
    const second = Bun.spawn(["sh", start, "prepare", [dependencies, slow, executor].join(" ")], {
      env: { HOME: home, REN_URL: server.url.origin, PATH: process.env.PATH },
      stdout: "ignore",
      stderr: "pipe",
    })
    const reader = second.stderr.getReader()
    const decoder = new TextDecoder()
    // oxlint-disable-next-line ren/no-comments -- Ends when the second prepare says that it waits, or when it ends.
    const waits = async (text: string): Promise<void> => {
      if (text.includes("waits")) return
      const chunk = await reader.read()
      if (!chunk.done) return waits(text + decoder.decode(chunk.value))
    }
    await Promise.race([waits(""), arrived[1].promise])
    released.resolve()
    expect(await first).toBe(0)
    expect(await second.exited).toBe(0)
    expect(requests.filter((path) => path === "/host/bundles/brain/b5")).toEqual(["/host/bundles/brain/b5"])
    expect(await readFile(join(home, ".ren/brain.version"), "utf8")).toBe("b5-d1\n")
  })

  test("a download that reaches a server without the bundle asks again", async () => {
    const home = await mkdtemp(join(work, "home-"))
    const next = await bundle("brain", "b6", { "packages/brain-runtime/src/bun.ts": "export const next = 6" })
    missingOnce.add("/host/bundles/brain/b6")
    expect(await prepare(home, [dependencies, next, executor])).toBe(0)
    expect(await readFile(join(home, ".ren/brain.version"), "utf8")).toBe("b6-d1\n")
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
