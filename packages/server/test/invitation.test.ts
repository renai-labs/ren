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

const preview = (id: string) => app.handler(new Request(`http://localhost:4000/api/invitations/${id}/preview`))

describe("GET /api/invitations/:id/preview", () => {
  test("previews a pending invitation without signing in", async () => {
    const signUp = await post("/sign-up/email", {
      email: "ingrid@northstar.dev",
      password: "correct horse battery staple",
      name: "Ingrid Inviter",
    })
    const cookie = signUp.headers.getSetCookie().join("; ")
    const invited = await post("/organization/invite-member", { email: "sophie@gmail.com", role: "member" }, cookie)
    const invitation = await invited.json()

    const response = await preview(invitation.id)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      state: "pending",
      organization: { id: invitation.organizationId, name: "Northstar", logo: null },
      inviter: { name: "Ingrid Inviter", email: "ingrid@northstar.dev" },
    })
  })

  test("returns the invalid state for an unknown invitation", async () => {
    const response = await preview("inv_unknown")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: "invalid", organization: null, inviter: null })
  })
})
