import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Budget } from "../src/budget.js"

const directories: string[] = []
const children: Bun.Subprocess[] = []

afterEach(async () => {
  for (const child of children) child.kill()
  await Promise.all(children.splice(0).map((child) => child.exited))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("concurrent reservations cannot exceed the shared budget and release makes room", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ren-budget-"))
  directories.push(directory)
  const results = await Promise.all(
    Array.from({ length: 4 }, () => Budget.reserve({ directory, capacityMiB: 2, costMiB: 1 })),
  )
  expect(results.filter((result) => result._tag === "Acquired")).toHaveLength(2)
  expect(results.filter((result) => result._tag === "Waiting")).toHaveLength(2)
  for (const result of results) {
    if (result._tag === "Acquired") result.release()
  }
  const next = await Budget.reserve({ directory, capacityMiB: 2, costMiB: 2 })
  expect(next._tag).toBe("Acquired")
  if (next._tag === "Acquired") next.release()
})

test("a killed owner releases its reservation on the next attempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ren-budget-"))
  directories.push(directory)
  const child = Bun.spawn([process.execPath, new URL("./lib/holder.ts", import.meta.url).pathname, directory], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })
  children.push(child)
  const reader = child.stdout.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready")
  reader.releaseLock()
  expect((await Budget.reserve({ directory, capacityMiB: 1, costMiB: 1 }))._tag).toBe("Waiting")
  child.kill("SIGKILL")
  await child.exited
  const next = await Budget.reserve({ directory, capacityMiB: 1, costMiB: 1 })
  expect(next._tag).toBe("Acquired")
  if (next._tag === "Acquired") next.release()
})

test("an oversized run can proceed alone on a small machine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ren-budget-"))
  directories.push(directory)
  const first = await Budget.reserve({ directory, capacityMiB: 1, costMiB: 2 })
  expect(first._tag).toBe("Acquired")
  expect((await Budget.reserve({ directory, capacityMiB: 1, costMiB: 1 }))._tag).toBe("Waiting")
  if (first._tag === "Acquired") first.release()
})
