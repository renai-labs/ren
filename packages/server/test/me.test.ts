import { afterAll, describe, expect, test } from "bun:test"
import { makeApp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const post = (path: string, body: unknown, cookie?: string) =>
  app.handler(
    new Request(`http://localhost:4000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:4000", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  )

const signUp = async (email: string, name: string) => {
  const response = await post("/sign-up/email", { email, password: "correct horse battery staple", name })
  expect(response.status).toBe(200)
  return response
}

const me = (headers?: HeadersInit) => app.handler(new Request("http://localhost:4000/api/me", { headers }))

describe("GET /api/me", () => {
  test("returns 401 without credentials", async () => {
    const response = await me()
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: "UnauthorizedError" })
  })

  test("returns the user and their active organization", async () => {
    const response = await signUp("ada@gmail.com", "Ada Lovelace")
    const body = await (await me({ cookie: response.headers.getSetCookie().join("; ") })).json()
    expect(body).toEqual({
      user: {
        id: expect.stringMatching(/^usr_/),
        name: "Ada Lovelace",
        email: "ada@gmail.com",
        emailVerified: false,
        image: null,
      },
      organization: { id: expect.stringMatching(/^org_/), name: "Ada's Org", slug: "ada-s-org", logo: null },
    })

    const bearer = await me({ authorization: `Bearer ${response.headers.get("set-auth-token")}` })
    expect(await bearer.json()).toEqual(body)
  })

  test("returns a null organization while an invitation is pending", async () => {
    const owner = (await signUp("owner@example.com", "Owner")).headers.getSetCookie().join("; ")
    expect(
      (await post("/organization/invite-member", { email: "grace@gmail.com", role: "member" }, owner)).status,
    ).toBe(200)
    const response = await signUp("grace@gmail.com", "Grace Hopper")
    const body = await (await me({ cookie: response.headers.getSetCookie().join("; ") })).json()
    expect(body).toMatchObject({ user: { email: "grace@gmail.com" }, organization: null })
  })
})
