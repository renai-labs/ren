import { afterAll, describe, expect, test } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Layer } from "effect"
import { HttpRouter } from "effect/http"
import { Routes } from "../src/routes.js"

const app = HttpRouter.toWebHandler(Routes.layer.pipe(Layer.provide(BunHttpServer.layerHttpServices)), {
  disableLogger: true,
})

afterAll(() => app.dispose())

describe("GET /api/health", () => {
  test("returns ok with the server version", async () => {
    const response = await app.handler(new Request("http://localhost/api/health"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok", version: "local" })
  })

  test("serves the OpenAPI document", async () => {
    const response = await app.handler(new Request("http://localhost/openapi.json"))
    expect(response.status).toBe(200)
    expect(Object.keys((await response.json()).paths)).toContain("/api/health")
  })
})
