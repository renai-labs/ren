import { afterAll, describe, expect, test } from "bun:test"
import { Bundle } from "@ren/schema/bundle"
import { Schema } from "effect"
import { createHash } from "node:crypto"
import { watch } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MachineStart } from "../machine/start.js"

const start = join(import.meta.dir, "../machine/start.ts")

const work = await mkdtemp(join(tmpdir(), "ren-prepare-"))

afterAll(() => rm(work, { recursive: true, force: true }))

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

// oxlint-disable-next-line ren/no-comments -- The bucket, as a signed link reaches it: any path that holds an archive answers it.
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    requests.push(path)
    const hold = held.get(path)
    if (hold) {
      hold.arrived[requests.filter((each) => each === path).length - 1]?.resolve()
      await hold.released
    }
    const body = archives.get(path)
    return body ? new Response(body) : new Response(null, { status: 404 })
  },
})

afterAll(() => server.stop(true))

const versionOf = (name: string) => name.padStart(16, "0")

// oxlint-disable-next-line ren/no-comments -- Packs files into an archive that the fake bucket serves, and gives its bundle with the dependencies it unpacks onto.
const bundle = async (
  kind: Bundle.Kind,
  name: string,
  files: Readonly<Record<string, string>>,
  dependencies = "d1",
) => {
  const tree = join(work, `${kind}-${name}`)
  await Promise.all(
    Object.entries(files).map(async (entry) => {
      await mkdir(join(tree, entry[0], ".."), { recursive: true })
      await Bun.write(join(tree, entry[0]), entry[1])
    }),
  )
  const archive = `${tree}.tar.gz`
  await Bun.$`tar -czf ${archive} -C ${tree} .`.quiet()
  const bytes = await Bun.file(archive).bytes()
  const version = versionOf(name)
  const path = `/bundles/${Bundle.keyOf({ kind, version })}`
  archives.set(path, bytes)
  return {
    kind,
    version,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    url: `${server.url.origin}${path}`,
    tree: kind === "dependencies" ? version : `${version}-${versionOf(dependencies)}`,
  } satisfies Bundle.Download
}

const encoded = (bundles: ReadonlyArray<Bundle.Download>) => Schema.encodeSync(Bundle.Downloads)(bundles)

const prepare = (home: string, bundles: ReadonlyArray<Bundle.Download>) =>
  MachineStart.prepare(home, bundles).then(
    () => true,
    () => false,
  )

const versionIn = (home: string, kind: string) => readFile(join(home, ".ren", `${kind}.version`), "utf8")

const dependencies = await bundle("dependencies", "d1", { "node_modules/shared/index.js": "export const shared = 1" })

const brain = await bundle("brain", "b1", { "packages/cell/src/bun.ts": "export {}" })

const executor = await bundle("executor", "e1", { "packages/executor/src/main.ts": "export {}" })

// oxlint-disable-next-line ren/no-comments -- start.js in its own process group, with a fake bun first on PATH, so the test stops it and everything it started.
const started = async (home: string, env: Readonly<Record<string, string>>, fakeBun: string) => {
  const bin = join(home, "bin")
  await mkdir(join(home, ".ren"), { recursive: true })
  await Bun.write(join(bin, "bun"), fakeBun)
  await Bun.$`chmod +x ${join(bin, "bun")}`
  return Bun.spawn(["perl", "-e", "setpgrp; exec @ARGV", process.execPath, start], {
    env: {
      ...env,
      HOME: home,
      REN_BUNDLES: encoded([dependencies, brain, executor]),
      PATH: `${bin}:${process.env.PATH}`,
    },
    stdout: "ignore",
    stderr: "ignore",
  })
}

// oxlint-disable-next-line ren/no-comments -- Resolves when found gives a value; each write in ~/.ren checks again.
const whenWritten = <A>(home: string, found: () => Promise<A | undefined>) => {
  const written = Promise.withResolvers<A>()
  const check = () => void found().then((value) => value !== undefined && written.resolve(value))
  const watcher = watch(join(home, ".ren"), check)
  check()
  return written.promise.finally(() => watcher.close())
}

const readIn = (home: string, name: string) =>
  readFile(join(home, ".ren", name), "utf8").then(
    (text) => text.trim(),
    () => "",
  )

describe("start.js prepare", () => {
  test("unpacks each source bundle on a copy of the dependencies and names it current; a second prepare downloads nothing", async () => {
    const home = await mkdtemp(join(work, "home-"))
    expect(await prepare(home, [dependencies, brain, executor])).toBe(true)
    expect(await versionIn(home, "brain")).toBe(brain.tree)
    const tree = join(home, ".ren/code/brain", brain.tree)
    expect(await Bun.file(join(tree, "packages/cell/src/bun.ts")).text()).toBe("export {}")
    expect(await Bun.file(join(tree, "node_modules/shared/index.js")).text()).toBe("export const shared = 1")
    requests.length = 0
    expect(await prepare(home, [dependencies, brain, executor])).toBe(true)
    expect(requests).toEqual([])
  })

  test("a new executor bundle stops the running executor, and keeps the brain's version", async () => {
    const home = await mkdtemp(join(work, "home-"))
    expect(await prepare(home, [dependencies, brain, executor])).toBe(true)
    const running = Bun.spawn(["sleep", "30"])
    await Bun.write(join(home, ".ren/executor.pid"), String(running.pid))
    const next = await bundle("executor", "e2", { "packages/executor/src/main.ts": "export const next = 2" })
    expect(await prepare(home, [dependencies, brain, next])).toBe(true)
    expect(await running.exited).not.toBe(0)
    expect(await versionIn(home, "executor")).toBe(next.tree)
    expect(await versionIn(home, "brain")).toBe(brain.tree)
  })

  test("keeps only the code that the brain and the executor run now or ran before", async () => {
    const home = await mkdtemp(join(work, "home-"))
    const release = async (number: number) => [
      await bundle("dependencies", `d${number}`, { "node_modules/shared/index.js": `export const shared = ${number}` }),
      await bundle("brain", `b${number}`, { "packages/cell/src/bun.ts": "export {}" }, `d${number}`),
      await bundle("executor", `e${number}`, { "packages/executor/src/main.ts": "export {}" }, `d${number}`),
    ]
    expect(await prepare(home, await release(7))).toBe(true)
    expect(await prepare(home, await release(8))).toBe(true)
    expect(await prepare(home, await release(9))).toBe(true)
    const code = join(home, ".ren/code")
    const both = (kind: string) => [8, 9].map((number) => `${versionOf(`${kind}${number}`)}-${versionOf(`d${number}`)}`)
    expect((await readdir(join(code, "dependencies"))).toSorted()).toEqual([versionOf("d8"), versionOf("d9")])
    expect((await readdir(join(code, "brain"))).toSorted()).toEqual(both("b"))
    expect((await readdir(join(code, "executor"))).toSorted()).toEqual(both("e"))
  })

  test("a second prepare waits until the first one ends, and downloads nothing", async () => {
    const home = await mkdtemp(join(work, "home-"))
    expect(await prepare(home, [dependencies, brain, executor])).toBe(true)
    const slow = await bundle("brain", "b5", { "packages/cell/src/bun.ts": "export const slow = 5" })
    const path = new URL(slow.url).pathname
    const released = Promise.withResolvers<void>()
    const arrived = [Promise.withResolvers<void>(), Promise.withResolvers<void>()] as const
    held.set(path, { arrived, released: released.promise })
    const first = prepare(home, [dependencies, slow, executor])
    await arrived[0].promise
    const second = Bun.spawn([process.execPath, start, "prepare", encoded([dependencies, slow, executor])], {
      env: { HOME: home, PATH: process.env.PATH },
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
    expect(await first).toBe(true)
    expect(await second.exited).toBe(0)
    expect(requests.filter((each) => each === path)).toEqual([path])
    expect(await versionIn(home, "brain")).toBe(slow.tree)
  })

  test("an archive that does not match its sha256 fails the prepare and changes nothing", async () => {
    const home = await mkdtemp(join(work, "home-"))
    expect(await prepare(home, [dependencies, brain, executor])).toBe(true)
    const wrong = {
      ...(await bundle("brain", "b2", { "packages/cell/src/bun.ts": "export {}" })),
      sha256: "0".repeat(64),
    }
    expect(await prepare(home, [dependencies, wrong, executor])).toBe(false)
    expect(await versionIn(home, "brain")).toBe(brain.tree)
  })
})

describe("start.js", () => {
  test("the executor and the agent's commands do not get the bundle links", async () => {
    const home = await mkdtemp(join(work, "home-"))
    const machine = await started(
      home,
      { REN_HAND: "1", REN_URL: "http://ren.test" },
      `#!/bin/sh\nenv >"$HOME/.ren/executor.env"\nexec sleep 30\n`,
    )
    const seen = await whenWritten(home, async () => (await readIn(home, "executor.env")) || undefined)
    process.kill(-machine.pid, "SIGKILL")
    expect(seen).toContain("REN_URL=http://ren.test")
    expect(seen).not.toContain("REN_BUNDLES")
  })

  test("the executor's pid file names the executor process, so a new executor bundle stops it", async () => {
    const home = await mkdtemp(join(work, "home-"))
    const machine = await started(home, { REN_HAND: "1" }, `#!/bin/sh\necho $$ >"$HOME/.ren/fake.pid"\nexec sleep 30\n`)
    const found = await whenWritten(home, async () => {
      const pids = [await readIn(home, "executor.pid"), await readIn(home, "fake.pid")] as const
      return pids[0] && pids[1] ? pids : undefined
    })
    process.kill(-machine.pid, "SIGKILL")
    expect(found[0]).toBe(found[1])
  })

  test("a brain made for remote hands starts no executor of its own", async () => {
    const home = await mkdtemp(join(work, "home-"))
    const machine = await started(
      home,
      { REN_HAND_PLACEMENT: "remote" },
      `#!/bin/sh\necho "$1" >>"$HOME/.ren/started"\nexec sleep 30\n`,
    )
    const seen = await whenWritten(home, async () => {
      const lines = await readIn(home, "started")
      return lines.includes("cell/src/bun.ts") ? lines : undefined
    })
    process.kill(-machine.pid, "SIGKILL")
    expect(seen.includes("executor/src/main.ts")).toBe(false)
  })
})
