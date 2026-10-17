import { afterAll, describe, expect, test } from "bun:test"
import { makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()
const secureApp = makeApp(undefined, { baseURL: "https://localhost:4000" })

afterAll(async () => {
  await app.dispose()
  await secureApp.dispose()
})

const me = (headers: HeadersInit = {}) => app.handler(new Request("http://localhost:4000/me", { headers }))

describe("Authentication", () => {
  test.each([
    { name: "without credentials", headers: {} },
    { name: "for an unknown bearer token", headers: { authorization: "Bearer not-a-session" } },
  ])("returns 401 $name", async (row) => {
    const response = await me(row.headers)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: "UnauthorizedError" })
  })

  test("provides the user from a bearer token", async () => {
    const response = await signUp(app, "grace@example.com")
    const user = await me({ authorization: `Bearer ${response.headers.get("set-auth-token")}` })
    expect(user.status).toBe(200)
    expect(await user.json()).toMatchObject({ user: { email: "grace@example.com" } })
  })

  test("authenticates the secure-prefixed session cookie over HTTPS", async () => {
    const cookie = sessionCookie(await signUp(secureApp, "ivy@example.com", "Ivy", "https://localhost:4000"))
    expect(cookie.startsWith("__Secure-")).toBe(true)
    const user = await secureApp.handler(new Request("https://localhost:4000/me", { headers: { cookie } }))
    expect(user.status).toBe(200)
    expect(await user.json()).toMatchObject({ user: { email: "ivy@example.com" } })
  })
})
