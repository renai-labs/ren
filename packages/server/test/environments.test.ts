import { afterAll, describe, expect, test } from "bun:test"
import { SessionToken } from "@ren/brain-api/session-token"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Effect } from "effect"
import { makeApp } from "./lib/app.js"

const app = makeApp()

afterAll(() => app.dispose())

const key = { id: "test", secret: "a-test-cell-key-of-at-least-32-characters" }
const iat = Math.floor(Date.now() / 1000)
const exp = iat + 600

const post = (path: string, authorization?: string) =>
  app.handler(
    new Request(`http://localhost${path}`, { method: "POST", headers: authorization ? { authorization } : {} }),
  )

const hostToken = (sid: Session.ID, org: Auth.OrganizationID) =>
  Effect.runPromise(SessionToken.sign(key, { sid, scope: "host", org, iat, exp }))

describe("Host API: environments.access and host.refresh", () => {
  test("answer 403 without a host token, or with a server, client, expired or foreign-key token", async () => {
    const sid = Session.ID.create()
    const org = Auth.OrganizationID.create()
    const tokens = await Promise.all([
      Effect.runPromise(SessionToken.sign(key, { sid, scope: "server", exp })),
      Effect.runPromise(SessionToken.sign(key, { sid, scope: "client", exp })),
      Effect.runPromise(SessionToken.sign(key, { sid, scope: "host", org, iat, exp: exp - 1200 })),
      Effect.runPromise(
        SessionToken.sign(
          { id: "test", secret: "another-key-of-at-least-32-characters" },
          { sid, scope: "host", org, iat, exp },
        ),
      ),
    ])
    const paths = ["/brain/environment/access", "/brain/host/refresh"]
    const statuses = await Promise.all([
      ...paths.map((path) => post(path).then((response) => response.status)),
      ...paths.flatMap((path) =>
        tokens.map((token) => post(path, `Bearer ${token}`).then((response) => response.status)),
      ),
    ])
    expect(statuses).toEqual(Array.from({ length: 10 }, () => 403))
  })

  test("a session with no environment gets a typed not found, not a forbidden", async () => {
    const response = await post(
      "/brain/environment/access",
      `Bearer ${await hostToken(Session.ID.create(), Auth.OrganizationID.create())}`,
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ _tag: "EnvironmentNotFoundError" })
  })

  test("a valid host token gets a fresh host token for the same brain, without the model flow", async () => {
    const sid = Session.ID.create()
    const org = Auth.OrganizationID.create()
    const response = await post("/brain/host/refresh", `Bearer ${await hostToken(sid, org)}`)
    expect(response.status).toBe(200)
    const body: { readonly hostToken: string } = await response.json()
    const claims = await Effect.runPromise(SessionToken.verify([key], body.hostToken))
    expect(claims._tag === "Some" && claims.value).toEqual(expect.objectContaining({ sid, scope: "host", org }))
  })
})
