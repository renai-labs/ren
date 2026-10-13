import { afterAll, describe, expect, test } from "bun:test"
import { makeApp, origin } from "./lib/app.js"

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
    expect((await response.json()).paths["/health"].get.operationId).toBe("health.get")
  })

  test("allows credentialed requests from trusted origins", async () => {
    const response = await app.handler(new Request("http://localhost/health", { headers: { origin } }))
    expect(response.headers.get("access-control-allow-origin")).toBe(origin)
    expect(response.headers.get("access-control-allow-credentials")).toBe("true")
  })

  test("answers preflight requests from trusted origins", async () => {
    const response = await app.handler(
      new Request("http://localhost/me", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers": "content-type",
        },
      }),
    )
    expect(response.headers.get("access-control-allow-origin")).toBe(origin)
    expect(response.headers.get("access-control-allow-credentials")).toBe("true")
  })

  test("withholds CORS headers from other origins", async () => {
    const response = await app.handler(
      new Request("http://localhost/health", {
        headers: { origin: "https://evil.example" },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })
})
