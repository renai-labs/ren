import { afterAll, describe, expect, test } from "bun:test"
import { authRequest, call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

describe("billing", () => {
  test("every member reads the plan; only admins and owners change it", async () => {
    const owner = sessionCookie(await signUp(app, "billing-owner@gmail.com", "Owner"))
    const member = sessionCookie(await signUp(app, "billing-member@gmail.com", "Member"))
    const team = await (
      await app.handler(authRequest("/organization/create", { name: "Payers", slug: "payers" }, owner))
    ).json()
    const invitation = await (
      await app.handler(
        authRequest(
          "/organization/invite-member",
          { email: "billing-member@gmail.com", role: "member", organizationId: team.id },
          owner,
        ),
      )
    ).json()
    await app.handler(authRequest("/organization/accept-invitation", { invitationId: invitation.id }, member))

    const read = await call(app, member, "GET", "/billing")
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({
      plan: "free",
      planStatus: null,
      renewsAt: null,
      pendingPlan: null,
      availableMicroUsd: 0,
      grantedMicroUsd: 0,
    })
    expect((await call(app, member, "POST", "/billing/subscribe", { plan: "pro" })).status).toBe(403)
    expect((await call(app, owner, "POST", "/billing/subscribe", { plan: "pro" })).status).toBe(200)
  })
})
