import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directories: string[] = []
afterEach(() => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

test("parallel files get separate homes before package preloads and all homes are removed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ren-runner-"))
  directories.push(directory)
  await Bun.write(join(directory, "a.test.ts"), Bun.file(new URL("./lib/probe.ts", import.meta.url)))
  await Bun.write(join(directory, "b.test.ts"), Bun.file(new URL("./lib/probe.ts", import.meta.url)))
  await Bun.write(
    join(directory, "bunfig.toml"),
    `[test]\npreload = [${JSON.stringify(new URL("../src/isolate.ts", import.meta.url).pathname)}, "./preload.ts"]\n`,
  )
  await Bun.write(join(directory, "preload.ts"), Bun.file(new URL("./lib/probe-preload.ts", import.meta.url)))
  const child = Bun.spawn([process.execPath, new URL("../../../script/test.ts", import.meta.url).pathname], {
    cwd: directory,
    env: { ...process.env, REN_TEST_WORKERS: "2", REN_TEST_MEMORY_MIB: "1", REN_TEST_BUDGET_MIB: "65536" },
    stdout: "ignore",
    stderr: "pipe",
  })
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
  const homes = await Promise.all(["a", "b"].map((name) => Bun.file(join(directory, `${name}.test.ts.home`)).text()))
  expect(new Set(homes).size).toBe(2)
  expect(await Promise.all(homes.map((home) => Bun.file(join(home, "marker")).exists()))).toEqual([false, false])
  expect(await Bun.file(join(directory, ".cache/test-timings.json")).exists()).toBe(true)
})
