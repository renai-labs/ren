import { expect, test } from "@playwright/test"
import { Ren } from "@ren/client"
import { serverURL } from "./lib/servers.js"

test("generated client reads server health", async () => {
  const client = Ren.make({ baseUrl: serverURL })
  expect(await client.health.get()).toEqual({ status: "ok", version: "local" })
})

test("server publishes its OpenAPI document", async ({ request }) => {
  const response = await request.get(`${serverURL}/openapi.json`)
  expect(response.ok()).toBe(true)
  expect(Object.keys((await response.json()).paths)).toContain("/health")
})
