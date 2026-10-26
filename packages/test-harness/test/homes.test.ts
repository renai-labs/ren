import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Homes } from "../src/homes.js"

const directories: string[] = []
const children: Bun.Subprocess[] = []
afterEach(async () => {
  for (const child of children) child.kill()
  await Promise.all(children.splice(0).map((child) => child.exited))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("recovery removes a killed run's home but preserves live runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ren-home-recovery-"))
  directories.push(directory)
  const child = Bun.spawn([process.execPath, new URL("./lib/home-holder.ts", import.meta.url).pathname, directory], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })
  children.push(child)
  const reader = child.stdout.getReader()
  const home = new TextDecoder().decode((await reader.read()).value)
  reader.releaseLock()
  const live = await Homes.create(directory)
  await Bun.write(join(live, "marker"), "live")
  expect(await Bun.file(join(home, "marker")).exists()).toBe(true)
  child.kill("SIGKILL")
  await child.exited
  await Homes.create(directory)
  expect(await Bun.file(join(home, "marker")).exists()).toBe(false)
  expect(await Bun.file(join(live, "marker")).exists()).toBe(true)
})
