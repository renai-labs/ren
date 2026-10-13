import { afterAll, describe, expect, test } from "bun:test"
import { makeApp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

describe("GET /health", () => {
  test("returns ok with the server version", async () => {
    const response = await app.handler(new Request("http://localhost/health"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok", version: "local" })
  })

  test("serves the OpenAPI document", async () => {
    const response = await app.handler(new Request("http://localhost/openapi.json"))
    expect(response.status).toBe(200)
    expect(Object.keys((await response.json()).paths)).toContain("/health")
  })
})
