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

const request = { purpose: "test", capacityMiB: 2, floorMiB: 0, availableMiB: 65_536, unitMiB: 1, units: 1 }

test("concurrent reservations cannot exceed the shared budget and release makes room", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ren-budget-"))
  directories.push(directory)
  const results = await Promise.all(Array.from({ length: 4 }, () => Budget.reserve({ ...request, directory })))
  expect(results.filter((result) => result._tag === "Acquired")).toHaveLength(2)
  expect(results.filter((result) => result._tag === "Waiting")).toHaveLength(2)
  for (const result of results) {
    if (result._tag === "Acquired") result.release()
  }
  const next = await Budget.reserve({ ...request, directory, units: 2 })
  expect(next).toMatchObject({ _tag: "Acquired", units: 2 })
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
  expect(await Budget.reserve({ ...request, directory, capacityMiB: 1 })).toMatchObject({
    _tag: "Waiting",
    holders: [{ purpose: "holder", mib: 1 }],
  })
  child.kill("SIGKILL")
  await child.exited
  const next = await Budget.reserve({ ...request, directory, capacityMiB: 1 })
  expect(next._tag).toBe("Acquired")
  if (next._tag === "Acquired") next.release()
})

test("an oversized run can proceed alone on a small machine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ren-budget-"))
  directories.push(directory)
  const first = await Budget.reserve({ ...request, directory, capacityMiB: 1, unitMiB: 2, availableMiB: 1 })
  expect(first).toMatchObject({ _tag: "Acquired", units: 1 })
  expect((await Budget.reserve({ ...request, directory, capacityMiB: 1 }))._tag).toBe("Waiting")
  if (first._tag === "Acquired") first.release()
})

test("a run starts only the workers that free memory above the floor can hold", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ren-budget-"))
  directories.push(directory)
  const reservation = { ...request, directory, capacityMiB: 65_536, floorMiB: 768, unitMiB: 1024, units: 4 }
  expect(await Budget.reserve({ ...reservation, availableMiB: 767 })).toMatchObject({ _tag: "Waiting", holders: [] })
  const first = await Budget.reserve({ ...reservation, availableMiB: 768 + 2048 + 512 })
  expect(first).toMatchObject({ _tag: "Acquired", units: 2 })
  expect((await Budget.reserve({ ...reservation, availableMiB: 768 + 512 }))._tag).toBe("Waiting")
  if (first._tag === "Acquired") first.release()
})
