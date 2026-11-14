import { expect } from "bun:test"
import type { App as AppSchema } from "@ren/schema/app"
import { Effect, Schema } from "effect"
import { App } from "../src/app.js"
import { AppProfiles } from "../src/app/profiles.js"
import { AppRegistry } from "../src/app/registry.js"
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
  webhooks: app.webhooks,
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

it.live("an app cannot have the name of its owner space, on create, edit or transfer", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* ProfilesFixture.user(organizationId, "Ana")
    const design = yield* ProfilesFixture.space(actor, "Design")
    const refused = (space: string) => ({
      _tag: "Primitive.Conflict",
      message: `An app cannot have the name of its space, “${space}”.`,
    })
    expect(yield* Effect.flip(ProfilesFixture.app(actor, design, "design", { name: "design" }))).toMatchObject(
      refused("Design"),
    )
    const app = yield* ProfilesFixture.app(actor, design, "design-kit", { name: "Design Kit" })
    const edit = { ...definition(app), name: "DESIGN", expectedRevision: app.revision }
    expect(yield* Effect.flip(apps.update(actor, app.id, edit))).toMatchObject(refused("Design"))
    const kit = yield* ProfilesFixture.space(actor, "design kit")
    expect(yield* Effect.flip(apps.transferOwnership(actor, app.id, { spaceId: kit }))).toMatchObject(
      refused("design kit"),
    )
  }),
)

it.live("connected lists every app with a profile the actor sees, registry apps too", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const registry = yield* AppRegistry.Service
    const members = yield* SpaceMember.Service
    const organizationId = yield* Seed.organization()
    const admin = yield* ProfilesFixture.user(organizationId, "Root", "admin")
    const member = yield* ProfilesFixture.user(organizationId, "Bob")
    const shared = yield* ProfilesFixture.space(admin, "Shared")
    yield* ProfilesFixture.app(admin, admin.personal, "hidden")
    const published = yield* registry.publish({
      apps: ["linear", "notion"].map((slug) =>
        Schema.decodeUnknownSync(AppRegistry.Publication)({ slug, name: slug, description: slug, listing: {} }),
      ),
    })
    const notion = published.apps.find((app) => app.slug === "notion")
    if (!notion) return yield* Effect.die(new Error("Publication returned no notion app"))
    yield* ProfilesFixture.profile(admin, { appId: notion.appId, slug: "team", kind: "shared", spaceIds: [shared] })
    const slugs = (actor: typeof admin, input: { readonly connected?: boolean }) =>
      Effect.map(apps.list(actor, { page: 1, pageSize: 50, ...input }), (page) => page.items.map((app) => app.slug))
    expect(yield* slugs(member, {})).toEqual([])
    expect(yield* slugs(member, { connected: true })).toEqual([])
    yield* members.create(admin, { spaceId: shared, userId: member.userId })
    expect(yield* slugs(member, { connected: true })).toEqual(["notion"])
    expect(yield* slugs(admin, { connected: true })).toEqual(["hidden", "notion"])
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

it.live("an org's own app cannot declare a managed MCP, on create or on edit", () =>
  Effect.gen(function* () {
    const apps = yield* App.Service
    const organizationId = yield* Seed.organization()
    const actor = yield* ProfilesFixture.user(organizationId, "Root", "admin")
    const mcps = {
      kernel: ProfilesFixture.remote("Kernel"),
      "kernel-managed": ProfilesFixture.managed("Kernel", "kernel"),
    }
    expect((yield* Effect.flip(ProfilesFixture.app(actor, actor.personal, "kernel", { mcps })))._tag).toBe(
      "Primitive.Invalid",
    )
    const app = yield* ProfilesFixture.app(actor, actor.personal, "kernel", { mcps: { kernel: mcps.kernel } })
    expect(
      (yield* Effect.flip(apps.update(actor, app.id, { ...definition(app), mcps, expectedRevision: app.revision })))
        ._tag,
    ).toBe("Primitive.Invalid")
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
