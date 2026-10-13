import { describe, expect, test } from "bun:test"
import { ClientError, Ren } from "../src/index.js"

describe("sdk", () => {
  test("reports transport failures as ClientError", async () => {
    const client = Ren.make({ baseUrl: "http://127.0.0.1:1" })
    await expect(client.health.get()).rejects.toBeInstanceOf(ClientError)
  })
})
