import { describe, expect } from "bun:test"
import type { Space } from "@ren/schema/space"
import { Effect } from "effect"
import type { Actor } from "../src/actor.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { Webhooks } from "../src/webhooks.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"

const it = testEffect(InfraFixture.layer(ChannelProvider.layer(Effect.succeed([]))))

const listed = Effect.fnUntraced(function* (actor: Actor.Info, spaceId: Space.ID) {
  const webhooks = yield* Webhooks.Service
  const page = yield* webhooks.list(actor, { spaceId, page: 1, pageSize: 50 })
  return new Map(page.items.map((item) => [item.slug, item]))
})

const signups = {
  name: "PostHog signups",
  message: "Research this person’s company.",
  signature: { kind: "header", header: "x-ren-secret" },
  filter: 'body.event.event == "user signed up"',
  threadKey: "body.person.properties.email",
}

describe("InfraSpecs webhooks", () => {
  it.live(
    "apply creates a listening webhook from webhooks.yaml, updates its parser, keeps its mode, and archives it when the spec drops it (W24)",
    () =>
      Effect.gen(function* () {
        const infra = yield* InfraSpecs.Service
        const webhooks = yield* Webhooks.Service
        const o = yield* InfraFixture.org
        const input = (spaces: Record<string, unknown>) => ({ bindings: o.bindings, spec: InfraFixture.spec(spaces) })
        const first = input({ home: { name: "Home", webhooks: { "posthog-signups": signups } } })

        const created = yield* infra.plan(o.admin, first)
        expect(created).toMatchObject({
          changes: [InfraFixture.change("create", "webhook", "spaces/home/webhooks/posthog-signups")],
          problems: [],
        })
        const applied = yield* infra.apply(o.admin, { ...first, digest: created.digest })
        expect(applied.lock).toEqual(InfraFixture.withoutMemory((yield* infra.pull(o.admin, {})).lock))
        const webhook = (yield* listed(o.admin, o.home.id)).get("posthog-signups")
        expect(webhook).toMatchObject({
          name: "PostHog signups",
          mode: "listening",
          ownerId: o.admin.userId,
          parser: { signature: { kind: "header", header: "x-ren-secret" }, threadKey: "body.person.properties.email" },
        })
        expect(yield* infra.plan(o.admin, first)).toMatchObject({ changes: [], problems: [] })

        yield* webhooks.update(o.admin, webhook?.id ?? (yield* Effect.die(new Error("no webhook"))), {
          mode: "listening",
        })
        const second = input({
          home: {
            name: "Home",
            webhooks: { "posthog-signups": { ...signups, title: "body.person.properties.email" } },
          },
        })
        const locked = yield* InfraFixture.current(o.admin, second)
        const updated = yield* infra.plan(o.admin, locked)
        expect(updated.changes).toMatchObject([
          InfraFixture.change("update", "webhook", "spaces/home/webhooks/posthog-signups", { fields: ["parser"] }),
        ])
        yield* infra.apply(o.admin, { ...locked, digest: updated.digest })
        expect((yield* listed(o.admin, o.home.id)).get("posthog-signups")).toMatchObject({
          mode: "listening",
          parser: { title: "body.person.properties.email" },
        })

        const third = yield* InfraFixture.current(o.admin, input({ home: { name: "Home" } }))
        const archived = yield* infra.plan(o.admin, third)
        expect(archived.changes).toMatchObject([
          InfraFixture.change("archive", "webhook", "spaces/home/webhooks/posthog-signups"),
        ])
        yield* infra.apply(o.admin, { ...third, digest: archived.digest })
        expect([...(yield* listed(o.admin, o.home.id)).keys()]).toEqual([])
      }),
  )
})
