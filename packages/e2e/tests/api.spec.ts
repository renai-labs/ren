import { expect, test } from "@playwright/test"
import { Ren } from "@ren/client"

test("generated client reads server health", async ({ baseURL }) => {
  const client = Ren.make({ baseUrl: baseURL ?? "" })
  expect(await client.health.get()).toEqual({ status: "ok", version: "local" })
})

test("server publishes its OpenAPI document", async ({ request }) => {
  const response = await request.get("/openapi.json")
  expect(response.ok()).toBe(true)
  expect(Object.keys((await response.json()).paths)).toContain("/api/health")
})
