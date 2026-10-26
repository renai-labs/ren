import { afterAll, describe, expect, test } from "bun:test"
import { authRequest, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const me = (cookie: string) => app.handler(new Request("http://localhost:4000/me", { headers: { cookie } }))

const getSession = async (cookie: string) =>
  (await app.handler(new Request("http://localhost:4000/auth/get-session", { headers: { cookie } }))).json()

describe("GET /me", () => {
  test("returns the user and their active organization", async () => {
    const response = await me(sessionCookie(await signUp(app, "ada@gmail.com", "Ada Lovelace")))
    expect(await response.json()).toEqual({
      user: {
        id: expect.stringMatching(/^usr_/),
        name: "Ada Lovelace",
        email: "ada@gmail.com",
        emailVerified: false,
        image: null,
      },
      organization: {
        id: expect.stringMatching(/^org_/),
        name: expect.any(String),
        slug: expect.any(String),
        logo: null,
      },
    })
  })

  test("returns a null organization while an invitation is pending", async () => {
    const owner = sessionCookie(await signUp(app, "owner@example.com", "Owner"))
    await app.handler(authRequest("/organization/invite-member", { email: "grace@gmail.com", role: "member" }, owner))
    const cookie = sessionCookie(await signUp(app, "grace@gmail.com", "Grace Hopper"))
    expect(await (await me(cookie)).json()).toMatchObject({ user: { email: "grace@gmail.com" }, organization: null })
    expect((await getSession(cookie)).session.activeOrganizationId).toBeNull()
  })

  test("falls back to the oldest remaining membership and persists it when the user is removed from the active organization", async () => {
    const owner = sessionCookie(await signUp(app, "hopper@gmail.com", "Grace Hopper"))
    const joiner = sessionCookie(await signUp(app, "katherine@gmail.com", "Katherine"))
    const personal = (await (await me(joiner)).json()).organization
    const team = await (
      await app.handler(authRequest("/organization/create", { name: "Team", slug: "team" }, owner))
    ).json()
    const invitation = await (
      await app.handler(
        authRequest(
          "/organization/invite-member",
          { email: "katherine@gmail.com", role: "member", organizationId: team.id },
          owner,
        ),
      )
    ).json()
    await app.handler(authRequest("/organization/accept-invitation", { invitationId: invitation.id }, joiner))
    await app.handler(authRequest("/organization/set-active", { organizationId: team.id }, joiner))
    expect((await (await me(joiner)).json()).organization.id).toBe(team.id)

    await app.handler(
      authRequest(
        "/organization/remove-member",
        { memberIdOrEmail: "katherine@gmail.com", organizationId: team.id },
        owner,
      ),
    )
    expect((await (await me(joiner)).json()).organization).toEqual(personal)
    expect((await getSession(joiner)).session.activeOrganizationId).toBe(personal.id)
  })

  test("a person leaves an organization themselves, and the leave archives their private space (access AC2)", async () => {
    const owner = sessionCookie(await signUp(app, "lovelace@gmail.com", "Ada Lovelace"))
    const joiner = sessionCookie(await signUp(app, "turing@gmail.com", "Alan Turing"))
    const team = await (
      await app.handler(authRequest("/organization/create", { name: "Leavers", slug: "leavers" }, owner))
    ).json()
    const invitation = await (
      await app.handler(
        authRequest(
          "/organization/invite-member",
          { email: "turing@gmail.com", role: "member", organizationId: team.id },
          owner,
        ),
      )
    ).json()
    await app.handler(authRequest("/organization/accept-invitation", { invitationId: invitation.id }, joiner))
    await app.handler(authRequest("/organization/set-active", { organizationId: team.id }, owner))
    const joinerId = (await (await me(joiner)).json()).user.id
    const privateSpaces = async () =>
      (
        await (
          await app.handler(
            new Request("http://localhost:4000/spaces?page=1&pageSize=50", { headers: { cookie: owner } }),
          )
        ).json()
      ).items.filter((space: { ownerUserId: string | null }) => space.ownerUserId === joinerId)
    expect(await privateSpaces()).toHaveLength(1)
    const left = await app.handler(authRequest("/organization/leave", { organizationId: team.id }, joiner))
    expect(left.status).toBe(200)
    expect(await privateSpaces()).toHaveLength(0)
  })
})
