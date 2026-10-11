import { afterAll, describe, expect, test } from "bun:test"
import { makeApp, origin } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const signUp = (email: string, headers?: HeadersInit) =>
  app.handler(
    new Request("http://localhost:4000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email, password: "correct horse battery staple", name: "Ada" }),
    }),
  )

describe("/api/auth", () => {
  test("signs up and reads the session back with its cookie", async () => {
    const response = await signUp("ada@example.com")
    expect(response.status).toBe(200)

    const session = await app.handler(
      new Request("http://localhost:4000/api/auth/get-session", {
        headers: { cookie: response.headers.getSetCookie().join("; ") },
      }),
    )
    expect(session.status).toBe(200)
    expect((await session.json()).user).toMatchObject({ email: "ada@example.com", id: expect.stringMatching(/^usr_/) })
  })

  test("returns no session without a cookie", async () => {
    const response = await app.handler(new Request("http://localhost:4000/api/auth/get-session"))
    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  test("allows credentialed requests from trusted origins", async () => {
    const response = await signUp("grace@example.com", { origin })
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe(origin)
    expect(response.headers.get("access-control-allow-credentials")).toBe("true")
  })

  test("answers preflight requests from trusted origins", async () => {
    const response = await app.handler(
      new Request("http://localhost:4000/api/auth/sign-in/email", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST" },
      }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(origin)
  })

  test("rejects cookie-bearing requests from untrusted origins", async () => {
    const response = await signUp("mallory@example.com", {
      origin: "https://evil.example",
      cookie: "better-auth.session_token=stolen",
    })
    expect(response.status).toBe(403)
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })
})
