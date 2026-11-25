import { expect } from "bun:test"
import { testEffect } from "@ren/core/testing"
import { ApiFixture } from "@ren/server/testing/api"
import { Effect, Schema } from "effect"

const it = testEffect(ApiFixture.layer)

const Record = Schema.Struct({ id: Schema.String })

const Task = Schema.Struct({ id: Schema.String, identifier: Schema.String, spaceId: Schema.String })

it.live("a slug or task number names a resource wherever its ID does: in the path, the query and the body", () =>
  Effect.gen(function* () {
    const owner = yield* ApiFixture.owner()
    const json = (response: Response) => Effect.promise<unknown>(() => response.json())
    const space = Schema.decodeUnknownSync(Record)(
      yield* json(yield* owner.request("POST", "/spaces", { name: "Docs", slug: "docs" })),
    )

    const renamed = yield* owner.request("PATCH", "/spaces/docs", { name: "Docs team" })
    expect(renamed.status).toBe(200)
    expect(yield* json(renamed)).toMatchObject({ id: space.id, name: "Docs team" })
    const created = yield* owner.request("POST", "/tasks", { spaceId: "docs", title: "Write the guide" })
    expect(created.status).toBe(200)
    const task = Schema.decodeUnknownSync(Task)(yield* json(created))
    expect(task.spaceId).toBe(space.id)
    expect(yield* json(yield* owner.request("GET", "/tasks?spaceId=docs"))).toMatchObject({ items: [{ id: task.id }] })
    const retitled = yield* owner.request("PATCH", `/tasks/${task.identifier}`, { title: "Write the CLI guide" })
    expect(yield* json(retitled)).toMatchObject({ id: task.id, title: "Write the CLI guide" })
    const webhook = yield* owner.request("POST", "/webhooks", {
      spaceId: "docs",
      slug: "signups",
      source: { _tag: "custom", name: "Signups", message: "Research this person." },
    })
    expect(webhook.status).toBe(200)
    expect((yield* owner.request("POST", "/webhooks/signups/rotateUrl", {})).status).toBe(200)

    const missing = yield* owner.request("PATCH", "/spaces/nope", { name: "Nope" })
    expect(missing.status).toBe(404)
    expect(yield* json(missing)).toMatchObject({ _tag: "NotFoundError", message: "Space not found." })
    expect(yield* json(yield* owner.request("DELETE", "/spaces/docs"))).toMatchObject({ id: space.id })
  }),
)

it.live("a profile's slug names it, written app/slug when two apps have a profile with that slug", () =>
  Effect.gen(function* () {
    const owner = yield* ApiFixture.owner()
    const json = (response: Response) => Effect.promise<unknown>(() => response.json())
    yield* owner.request("POST", "/spaces", { name: "Docs", slug: "docs" })
    const app = (slug: string) =>
      owner.request("POST", "/apps", { slug, ownerSpaceId: "docs", name: slug, description: "Writes." })
    yield* app("mail")
    yield* app("notes")
    const profiles = Schema.decodeUnknownSync(Schema.Struct({ items: Schema.Array(Record) }))(
      yield* json(yield* owner.request("GET", "/app-profiles?appId=mail")),
    )

    const found = yield* owner.request("GET", "/app-profiles/mail%2Fdocs")
    expect(yield* json(found)).toMatchObject({ id: profiles.items.at(0)?.id, appSlug: "mail", slug: "docs" })
    const renamed = yield* owner.request("PATCH", "/app-profiles/mail%2Fdocs", { name: "Docs mail" })
    expect(yield* json(renamed)).toMatchObject({ id: profiles.items.at(0)?.id, name: "Docs mail" })
    const ambiguous = yield* owner.request("PATCH", "/app-profiles/docs", { name: "Docs" })
    expect(ambiguous.status).toBe(404)
    expect(yield* json(ambiguous)).toMatchObject({
      message: "More than one app has a profile “docs”. Write it as <app>/docs, or use its ID.",
    })
  }),
)
