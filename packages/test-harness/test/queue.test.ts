import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directories: string[] = []
afterEach(() => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

test("a command queued inside a queued command runs under the outer reservation", async () => {
  const home = await mkdtemp(join(tmpdir(), "ren-queue-"))
  directories.push(home)
  const queue = [
    process.execPath,
    new URL("../../../script/memory.ts", import.meta.url).pathname,
    "queue",
    "--mib=1",
    "--",
  ]
  const child = Bun.spawn([...queue, ...queue, process.execPath, "-e", "console.log('inner')"], {
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((entry) => entry[0] !== "REN_MEMORY_LEASE")),
      HOME: home,
      REN_MEMORY_BUDGET_MIB: "1",
      REN_MEMORY_FLOOR_MIB: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(await child.exited, output[1]).toBe(0)
  expect(output[0]).toBe("inner\n")
})
