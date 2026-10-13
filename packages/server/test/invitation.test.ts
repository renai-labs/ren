import { afterAll, expect, test } from "bun:test"
import { authRequest, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

test("previews a pending invitation without signing in or exposing the invitee", async () => {
  const cookie = sessionCookie(await signUp(app, "ingrid@northstar.dev", "Ingrid Inviter"))
  const invited = await app.handler(
    authRequest("/organization/invite-member", { email: "sophie@gmail.com", role: "member" }, cookie),
  )
  const invitation = await invited.json()

  const response = await app.handler(new Request(`http://localhost:4000/invitations/${invitation.id}/preview`))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    state: "pending",
    organization: { id: invitation.organizationId, name: "Northstar", logo: null },
    inviter: { name: "Ingrid Inviter", email: "ingrid@northstar.dev" },
  })
})
