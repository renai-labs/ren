import { expect, test } from "bun:test"
import { Brain } from "@ren/schema/brain"
import { tmpdir } from "node:os"
import { BunBrain } from "./lib/bun-brain.js"
import { Shared } from "./lib/shared.js"

test("a failed brain startup removes its temporary home", async () => {
  const before = [...new Bun.Glob("ren-bun-brain-*").scanSync({ cwd: tmpdir(), onlyFiles: false })].toSorted()
  await expect(BunBrain.make({ REN_BRAIN_ID: "" }, { brain: Brain.ID.create() })).rejects.toThrow("exited")
  expect([...new Bun.Glob("ren-bun-brain-*").scanSync({ cwd: tmpdir(), onlyFiles: false })].toSorted()).toEqual(before)
})

test("the brain startup signal means its HTTP handler is ready", async () => {
  const instance = await Shared.make()
  const response = await fetch(`${instance.url}/ren/state`)
  await instance.dispose()
  expect(response.status).toBe(401)
})
