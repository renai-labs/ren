import { afterAll, describe, expect, test } from "bun:test"
import { makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const favicon = (host: string, cookie?: string) =>
  app.handler(new Request(`http://localhost:4000/favicons/${host}`, cookie ? { headers: { cookie } } : {}))

describe("GET /favicons/:host", () => {
  test("answers 401 to a signed-out caller", async () => {
    expect((await favicon("stripe.com")).status).toBe(401)
  })

  test("answers 404 for a private host without fetching it", async () => {
    const cookie = sessionCookie(await signUp(app, "ada@gmail.com", "Ada Lovelace"))
    for (const host of ["127.0.0.1", "localhost", "wiki.internal"])
      expect((await favicon(host, cookie)).status).toBe(404)
  })
})
