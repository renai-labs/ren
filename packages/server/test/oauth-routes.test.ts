import { expect } from "bun:test"
import { testEffect } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { AppProfile } from "@ren/schema/app-profile"
import { Credential } from "@ren/schema/credential"
import { OAuthSession } from "@ren/schema/oauth-session"
import { Effect } from "effect"
import { ApiFixture } from "@ren/server/testing/api"

const it = testEffect(ApiFixture.layer)

const expired = Effect.fnUntraced(function* (returnTo?: string) {
  const api = yield* ApiFixture.Service
  const database = yield* Database.Service
  const owner = yield* ApiFixture.owner()
  const made = yield* owner.request("POST", "/apps", {
    slug: "notes",
    ownerSpaceId: owner.spaceId,
    name: "Notes",
    description: "Write notes",
  })
  const app = yield* Effect.promise<{ readonly id: string }>(() => made.json())
  const listed = yield* owner.request("GET", `/app-profiles?appId=${app.id}`)
  const profiles = yield* Effect.promise<{ readonly items: ReadonlyArray<{ readonly id: AppProfile.ID }> }>(() =>
    listed.json(),
  )
  const state = crypto.randomUUID()
  yield* database.db.insert(Database.Schema.oauth_session).values({
    id: OAuthSession.ID.create(),
    organization_id: owner.organizationId,
    credential_id: Credential.ID.create(),
    profile_id: profiles.items.at(0)?.id ?? null,
    label: "MCP_NOTES",
    name: "Notes",
    hosts: [],
    made_for: "everyone",
    initiator_user_id: owner.createdBy,
    state,
    expires_at: new Date(Date.now() - 60_000),
    ...(returnTo && { return_to: returnTo }),
  })
  return yield* Effect.promise(() =>
    api.handler(new Request(`http://localhost:4000/oauth/callback?state=${state}`, { redirect: "manual" })),
  )
})

it.live("a sign-in that began in the mobile app sends the browser back to the app, saying how it ended", () =>
  Effect.gen(function* () {
    const response = yield* expired("ren-dev://192.168.1.6:8081/connected")
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.protocol).toBe("ren-dev:")
    expect(location.host).toBe("192.168.1.6:8081")
    expect(location.pathname).toBe("/connected")
    expect(Object.fromEntries(location.searchParams)).toEqual({
      status: "failed",
      reason: "The sign-in expired.",
      app: "Notes",
    })
  }),
)

it.live("a sign-in from the web still ends on the page", () =>
  Effect.gen(function* () {
    const response = yield* expired()
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(yield* Effect.promise(() => response.text())).toContain("The sign-in expired.")
  }),
)

it.live("an address with no known sign-in state ends on the page, even for a browser coming from the app", () =>
  Effect.gen(function* () {
    const api = yield* ApiFixture.Service
    const response = yield* Effect.promise(() =>
      api.handler(new Request("http://localhost:4000/oauth/callback?state=unknown", { redirect: "manual" })),
    )
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.text())).toContain("Ren does not know this sign-in.")
  }),
)

it.live("a connect that names a return address outside the mobile app is refused", () =>
  Effect.gen(function* () {
    const owner = yield* ApiFixture.owner()
    const base = { profileId: AppProfile.ID.create(), item: { mcp: "notes" } }
    expect(
      (yield* owner.request("POST", "/credentials/connect", { ...base, returnTo: "https://evil.test/connected" }))
        .status,
    ).toBe(400)
    expect(
      (yield* owner.request("POST", "/credentials/connect", { ...base, returnTo: "ren:///connected" })).status,
    ).toBe(404)
  }),
)
