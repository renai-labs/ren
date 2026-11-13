import { afterAll, describe, expect, test } from "bun:test"
import { makeApp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

describe("GET /favicons/:host", () => {
  test("answers 401 to a signed-out caller", async () => {
    expect((await app.handler(new Request("http://localhost:4000/favicons/stripe.com"))).status).toBe(401)
  })
})
