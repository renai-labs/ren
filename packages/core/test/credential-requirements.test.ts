import { describe, expect } from "bun:test"
import type { App as AppSchema } from "@ren/schema/app"
import type { Mcp } from "@ren/schema/mcp"
import { Effect } from "effect"
import { App } from "../src/app.js"
import { AppProfiles } from "../src/app/profiles.js"
import { ProfileItems } from "../src/app/profile-items.js"
import { CredentialRequirements } from "../src/credential-requirements.js"
import { testEffect } from "./lib/effect.js"
import { ProfilesFixture } from "./lib/profiles.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(ProfilesFixture.layer)

const page = { page: 1, pageSize: 50 }

const calendar = (
  url: string,
  scopes?: ReadonlyArray<string>,
  requiredCredentials: Mcp.Declaration["requiredCredentials"] = [],
): Mcp.Declaration => ({
  name: "Calendar",
  description: "Calendar",
  transport: { type: "remote", url },
  auth: { type: "oauth", tokenEndpointAuth: "none", ...(scopes && { scopes }) },
  requiredCredentials,
})

const crm = (header: string): Mcp.Declaration => ({
  name: "CRM",
  description: "CRM",
  transport: { type: "remote", url: "https://crm.example.com/mcp" },
  auth: { type: "header", name: header, credential: "apiKey" },
  requiredCredentials: [{ kind: "secret", name: "apiKey", optional: false }],
})

const single = Effect.fnUntraced(function* (definition: Parameters<typeof Seed.appInput>[2]) {
  const profiles = yield* AppProfiles.Service
  const organizationId = yield* Seed.organization()
  const ana = yield* ProfilesFixture.user(organizationId, "Ana", "admin")
  const app = yield* ProfilesFixture.app(ana, ana.personal, "work", definition)
  const profile = (yield* profiles.list(ana, { ...page, appId: app.id })).items.at(0)
  if (!profile) return yield* Effect.die(new Error("expected the owner-space profile"))
  return { organizationId, ana, app, profile }
})

describe("profile items (§9 rule 4, §12)", () => {
  it.live(
    "binding hash: a URL path change and a new scope give reconnect; a header rename and a dropped scope do not",
    () =>
      Effect.gen(function* () {
        const apps = yield* App.Service
        const profiles = yield* AppProfiles.Service
        const first = { calendar: calendar("https://cal.example.com/mcp", ["read", "write"]), crm: crm("X-Key") }
        const found = yield* single({ mcps: first })
        const slug = found.profile.slug.toUpperCase().replaceAll("-", "_")
        yield* ProfilesFixture.connect(found.organizationId, found.profile.id, `MCP_CALENDAR__${slug}`, {
          madeFor: ProfileItems.madeFor(first.calendar),
          scopes: ["read", "write"],
        })
        yield* ProfilesFixture.connect(found.organizationId, found.profile.id, `MCP_CRM__${slug}`, {
          madeFor: ProfileItems.madeFor(first.crm),
          fieldNames: ["apiKey"],
        })
        let app: AppSchema.Info = found.app
        const edit = Effect.fnUntraced(function* (mcps: Record<string, Mcp.Declaration>) {
          app = yield* apps.update(found.ana, app.id, {
            requiredCredentials: [],
            skills: {},
            dependsOn: [],
            mcps,
            expectedRevision: app.revision,
          })
          return Object.fromEntries(
            (yield* profiles.get(found.ana, found.profile.id)).items.map((item) => [item.name, item.status]),
          )
        })
        expect(
          yield* edit({ calendar: calendar("https://cal.example.com/mcp", ["read"]), crm: crm("X-Api-Key") }),
        ).toEqual({ Calendar: "ok", CRM: "ok" })
        expect(
          yield* edit({ calendar: calendar("https://cal.example.com/mcp", ["read", "admin"]), crm: crm("X-Key") }),
        ).toEqual({ Calendar: "reconnect", CRM: "ok" })
        expect(
          yield* edit({ calendar: calendar("https://cal.example.com/v2/mcp", ["read"]), crm: crm("X-Key") }),
        ).toEqual({ Calendar: "reconnect", CRM: "ok" })
      }),
  )

  it.live(
    "items merge the env keys of the app, its skills and its local MCPs; an oauth_app requirement is one app gate",
    () =>
      Effect.gen(function* () {
        const found = yield* single({
          requiredCredentials: [Seed.env("PROJECT_ID"), { kind: "oauth_app", name: "Google", optional: false }],
          skills: {
            report: {
              type: "content",
              description: "Report",
              instructions: "Report",
              files: {},
              requiredCredentials: [Seed.env("PROJECT_ID"), Seed.env("REGION", true)],
            },
          },
          mcps: {
            calendar: calendar("https://cal.example.com/mcp", undefined, [
              { kind: "oauth_app", name: "Google", optional: false },
            ]),
            sheets: {
              name: "Sheets",
              description: "Sheets",
              transport: { type: "local", command: ["sheets"] },
              auth: { type: "none" },
              requiredCredentials: [Seed.env("SHEETS_KEY")],
            },
          },
        })
        const slug = found.profile.slug.toUpperCase().replaceAll("-", "_")
        expect(
          found.profile.items.map((item) => ({ item: item.item, label: item.label, optional: item.optional })),
        ).toEqual([
          { item: { mcp: "calendar" }, label: `MCP_CALENDAR__${slug}`, optional: false },
          { item: { env: "PROJECT_ID" }, label: `PROJECT_ID__${slug}`, optional: false },
          { item: { env: "REGION" }, label: `REGION__${slug}`, optional: true },
          { item: { env: "SHEETS_KEY" }, label: `SHEETS_KEY__${slug}`, optional: false },
        ])
        expect(found.profile.oauthApps).toEqual([{ name: "Google", isConfigured: false }])
      }),
  )
})

describe("the composer pill (P15)", () => {
  it.live(
    "a space lists the profiles it reaches with their gaps to its members; a private space's reach is its owner's only (AC14); a connect clears one",
    () =>
      Effect.gen(function* () {
        const requirements = yield* CredentialRequirements.Service
        const found = yield* single({ mcps: { calendar: calendar("https://cal.example.com/mcp") } })
        const gaps = Effect.map(requirements.forSpace(found.ana, found.ana.personal), (reach) =>
          reach.profiles.flatMap((profile) =>
            profile.items.filter((item) => item.status !== "ok").map((item) => item.label),
          ),
        )
        const slug = found.profile.slug.toUpperCase().replaceAll("-", "_")
        expect(yield* gaps).toEqual([`MCP_CALENDAR__${slug}`])
        yield* ProfilesFixture.connect(found.organizationId, found.profile.id, `MCP_CALENDAR__${slug}`, {
          madeFor: ProfileItems.madeFor(calendar("https://cal.example.com/mcp")),
        })
        expect(yield* gaps).toEqual([])
        const stranger = yield* ProfilesFixture.user(found.organizationId, "Bob")
        expect((yield* Effect.flip(requirements.forSpace(stranger, found.ana.personal)))._tag).toBe(
          "Primitive.NotFound",
        )
        const admin = yield* ProfilesFixture.user(found.organizationId, "Cy", "admin")
        expect((yield* Effect.flip(requirements.forSpace(admin, found.ana.personal)))._tag).toBe("Primitive.NotFound")
      }),
  )
})
