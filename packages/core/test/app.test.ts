import { expect } from "bun:test"
import type { App as AppSchema } from "@ren/schema/app"
import { Effect } from "effect"
import { App } from "../src/app.js"
import { AppProfiles } from "../src/app/profiles.js"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { testEffect } from "./lib/effect.js"
import { ProfilesFixture } from "./lib/profiles.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(ProfilesFixture.layer)

const definition = (app: AppSchema.Info) => ({
  requiredCredentials: app.requiredCredentials,
  mcps: app.mcps,
  skills: app.skills,
  dependsOn: app.dependsOn,
})

it.live("read access follows reach, while edits and transfers keep owner checks", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const members = yield* SpaceMember.Service
    const organizationId = yield* Seed.organization()
    const owner = yield* ProfilesFixture.user(organizationId, "Ana")
    const consumer = yield* ProfilesFixture.user(organizationId, "Bob")
    const admin = yield* ProfilesFixture.user(organizationId, "Root", "admin")
    const source = yield* ProfilesFixture.space(owner, "Source")
    const target = yield* ProfilesFixture.space(consumer, "Target")
    const app = yield* ProfilesFixture.app(owner, source, "private")
    expect((yield* Effect.flip(apps.get(consumer, app.id)))._tag).toBe("Primitive.NotFound")
    expect(
      (yield* Effect.flip(ProfilesFixture.app(consumer, target, "blocked", { dependsOn: ["private"] })))._tag,
    ).toBe("Primitive.NotFound")
    yield* members.create(admin, { spaceId: source, userId: admin.userId })
    yield* members.create(admin, { spaceId: target, userId: admin.userId })
    yield* ProfilesFixture.profile(admin, { appId: app.id, slug: "target", kind: "shared", spaceIds: [target] })
    expect((yield* apps.get(consumer, app.id)).id).toBe(app.id)
    const edit = { ...definition(app), name: "Changed", expectedRevision: app.revision }
    expect((yield* Effect.flip(apps.update(consumer, app.id, edit)))._tag).toBe("Primitive.Forbidden")
    expect((yield* Effect.flip(apps.transferOwnership(consumer, app.id, { spaceId: target })))._tag).toBe(
      "Primitive.Forbidden",
    )
    yield* members.create(admin, { spaceId: target, userId: owner.userId })
    yield* apps.transferOwnership(owner, app.id, { spaceId: target })
    expect((yield* apps.update(consumer, app.id, edit)).name).toBe("Changed")
  }),
)

it.live("self-dependency during creation reports the authored slug", () =>
  Effect.gen(function* () {
    const organizationId = yield* Seed.organization()
    const actor = yield* ProfilesFixture.user(organizationId, "Root", "admin")
    const error = yield* Effect.flip(ProfilesFixture.app(actor, actor.personal, "self", { dependsOn: ["self"] }))
    expect(error._tag).toBe("Primitive.Conflict")
    expect(error.message).toContain("cannot depend on itself")
  }),
)

it.live("a space cannot archive while it owns an app; an app archive is never refused for use (P11)", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const spaces = yield* Space.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* ProfilesFixture.user(organizationId, "Root", "admin")
    const owner = yield* ProfilesFixture.space(actor, "Owner")
    const app = yield* ProfilesFixture.app(actor, owner, "archive-space")
    expect((yield* Effect.flip(spaces.archive(actor, owner)))._tag).toBe("Primitive.Conflict")
    yield* ProfilesFixture.profile(actor, { appId: app.id, slug: "everyone", kind: "shared", allSpaces: true })
    expect((yield* apps.archive(actor, app.id)).archivedAt).not.toBeNull()
    yield* spaces.archive(actor, owner)
  }),
)

it.live("two apps with MCP gmail or env key SHOPIFY_TOKEN cannot both get profiles; a stale revision gives 409", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const profiles = yield* AppProfiles.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* ProfilesFixture.user(organizationId, "Root", "admin")
    const first = yield* ProfilesFixture.app(actor, actor.personal, "mail", {
      mcps: { gmail: ProfilesFixture.remote("Gmail") },
      requiredCredentials: [Seed.env("SHOPIFY_TOKEN")],
    })
    const gmail = yield* Effect.flip(
      ProfilesFixture.app(actor, actor.personal, "mail-kit", { mcps: { gmail: ProfilesFixture.remote("Gmail") } }),
    )
    expect(gmail.message).toContain("MCP “gmail” is in apps “mail” and “mail-kit”")
    const shop = yield* Effect.flip(
      ProfilesFixture.app(actor, actor.personal, "shop", { requiredCredentials: [Seed.env("SHOPIFY_TOKEN")] }),
    )
    expect(shop.message).toContain("Env key “SHOPIFY_TOKEN”")
    const other = yield* ProfilesFixture.app(actor, actor.personal, "other")
    yield* Effect.forEach((yield* profiles.list(actor, { appId: other.id, page: 1, pageSize: 50 })).items, (found) =>
      profiles.delete(actor, found.id),
    )
    const edit = { ...definition(other), mcps: { gmail: ProfilesFixture.remote("Gmail") } }
    const updated = yield* apps.update(actor, other.id, { ...edit, expectedRevision: other.revision })
    expect(updated.revision).toBe(other.revision + 1)
    expect(
      (yield* Effect.flip(ProfilesFixture.profile(actor, { appId: other.id, slug: "x", kind: "shared", spaceIds: [] })))
        .message,
    ).toContain("MCP “gmail”")
    const stale = yield* Effect.flip(apps.update(actor, first.id, { ...definition(first), expectedRevision: 0 }))
    expect(stale).toMatchObject({ _tag: "Primitive.Conflict", message: "The app changed. Reload before saving." })
  }),
)
