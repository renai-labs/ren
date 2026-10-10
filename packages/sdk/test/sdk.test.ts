import { describe, expect, test } from "bun:test"
import { ClientError, Ren } from "../src/index.js"

describe("sdk", () => {
  test("exposes the generated client", () => {
    const client = Ren.make({ baseUrl: "http://127.0.0.1:1" })
    expect(typeof client.health.get).toBe("function")
  })

  test("reports transport failures as ClientError", async () => {
    const client = Ren.make({ baseUrl: "http://127.0.0.1:1" })
    await expect(client.health.get()).rejects.toBeInstanceOf(ClientError)
  })
})
