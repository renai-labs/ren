import { afterAll, describe, expect, test } from "bun:test"
import { Celld } from "./lib/celld.js"
import { Shared } from "./lib/shared.js"

const shared = await Shared.celld()
const own = await Celld.make(Shared.vars())
afterAll(own.dispose)

describe("test celld", () => {
  test("answers 401 to a request without a token", async () => {
    expect((await fetch(shared.url)).status).toBe(401)
    expect((await fetch(`${shared.url}/api/session`, { method: "POST" })).status).toBe(401)
  })

  test("a per-file celld stops when killed and serves on the same url when started again", async () => {
    expect((await fetch(own.url)).status).toBe(401)
    await own.kill()
    await expect(fetch(own.url)).rejects.toThrow()
    await own.start()
    expect((await fetch(own.url)).status).toBe(401)
  })
})
