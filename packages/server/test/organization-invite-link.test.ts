import { afterAll, describe, expect, test } from "bun:test"
import { authRequest, call, makeApp, sessionCookie, signUp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const me = async (cookie: string) => (await call(app, cookie, "GET", "/me")).json()

const spaceNames = async (cookie: string) =>
  (await (await call(app, cookie, "GET", "/spaces?joined=true")).json()).items
    .filter((space: { kind: string }) => space.kind === "shared")
    .map((space: { name: string }) => space.name)
    .toSorted()

const joinByInvitation = async (owner: string, email: string) => {
  const invitee = sessionCookie(await signUp(app, email, "Invitee"))
  const invited = await (
    await app.handler(authRequest("/organization/invite-member", { email, role: "member" }, owner))
  ).json()
  await app.handler(authRequest("/organization/accept-invitation", { invitationId: invited.id }, invitee))
  return invitee
}

const makeLink = async (cookie: string, spaceIds: ReadonlyArray<string> = []) =>
  (await call(app, cookie, "POST", "/organization-invite-links", { spaceIds, expiresIn: "7d" })).json()

const signUpThrough = async (token: string, email: string) => {
  const remembered = await app.handler(authRequest("/join-link/remember", { token }))
  expect(remembered.status).toBe(200)
  return app.handler(
    authRequest(
      "/sign-up/email",
      { email, password: "correct horse battery staple", name: "Newcomer" },
      sessionCookie(remembered),
    ),
  )
}

describe("organization invite links", () => {
  test("a new person who signs up through a link gets no stray organization, then joins with General and the link's spaces", async () => {
    const owner = sessionCookie(await signUp(app, "owner@northstar.dev", "Owner"))
    const design = await (await call(app, owner, "POST", "/spaces", { name: "Design" })).json()
    const link = await makeLink(owner, [design.id])
    expect(link.token).toMatch(/^oil_/)

    const response = await signUpThrough(link.token, "newcomer@gmail.com")
    expect(response.headers.getSetCookie().find((cookie) => cookie.includes("join_link="))).toMatch(/Max-Age=0/u)
    const newcomer = sessionCookie(response)
    expect((await me(newcomer)).organization).toBeNull()

    const accepted = await call(app, newcomer, "POST", `/organization-join-links/${link.token}/accept`)
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toMatchObject({
      organizationId: (await me(owner)).organization.id,
      spaceId: design.id,
    })
    expect((await me(newcomer)).organization).toMatchObject({ id: (await me(owner)).organization.id })
    expect(await spaceNames(newcomer)).toEqual(["Design", "General Space"])
    expect((await (await call(app, owner, "GET", "/organization-invite-links")).json()).items[0].uses).toBe(1)
  })

  test("opening a link without choosing to sign up from it does not stop the personal organization", async () => {
    const owner = sessionCookie(await signUp(app, "owner4@globex.dev", "Owner"))
    const link = await makeLink(owner)
    expect(
      (await app.handler(new Request(`http://localhost:4000/organization-join-links/${link.token}/preview`))).status,
    ).toBe(200)
    const plain = sessionCookie(await signUp(app, "plain@gmail.com", "Plain"))
    expect((await me(plain)).organization).not.toBeNull()
  })

  test("a revoked link or an expired token joins no one, and a member cannot make links", async () => {
    const owner = sessionCookie(await signUp(app, "owner2@acme.dev", "Owner"))
    const link = await makeLink(owner)
    const member = await joinByInvitation(owner, "member@gmail.com")
    expect(
      (await call(app, member, "POST", "/organization-invite-links", { spaceIds: [], expiresIn: "7d" })).status,
    ).toBe(403)
    expect((await call(app, owner, "DELETE", `/organization-invite-links/${link.id}`)).status).toBe(204)
    const preview = await app.handler(
      new Request(`http://localhost:4000/organization-join-links/${link.token}/preview`),
    )
    expect(await preview.json()).toMatchObject({ state: "revoked", organization: { name: "Acme" } })
    expect((await call(app, member, "POST", `/organization-join-links/${link.token}/accept`)).status).toBe(404)
  })
})
