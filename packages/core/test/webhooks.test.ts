import { describe, expect } from "bun:test"
import { Session } from "@ren/schema/session"
import { Webhook } from "@ren/schema/webhook"
import { Effect, Schema } from "effect"
import type { Actor } from "../src/actor.js"
import { Webhooks } from "../src/webhooks.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { WebhookFixture } from "./lib/webhook-fixture.js"

const it = testEffect(WebhookFixture.layer)

const decodeCreate = Schema.decodeUnknownSync(Webhook.CreateInput)

const decodeUpdate = Schema.decodeUnknownSync(Webhook.UpdateInput)

const team = Effect.gen(function* () {
  const owner = yield* Seed.owner()
  const ada: Actor.Info = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
  const bob = yield* Seed.actor(owner.organizationId, "member")
  yield* Seed.join(owner.spaceId, bob.userId)
  return { ...owner, ada, bob }
})

const signups = (spaceId: string) =>
  decodeCreate({
    spaceId,
    name: "PostHog signups",
    message: "Research this person’s company.",
    parser: {
      signature: { kind: "header", header: "x-ren-secret" },
      filter: 'body.event.event == "user signed up"',
      eventId: "body.event.uuid",
      threadKey: "body.person.properties.email",
    },
  })

describe("Webhooks", () => {
  it.live("an agent in a chat creates a listening webhook on its own agent, and gets a URL with a token", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* team
      const agentId = yield* Seed.agent(t, "researcher", { isSubagent: false })
      const inChat: Actor.Info = {
        ...t.ada,
        agent: { agentId, sessionId: Session.ID.create(), spaceId: t.spaceId, fence: null },
      }
      const created = yield* webhooks.create(inChat, signups(t.spaceId))
      expect(created).toMatchObject({
        mode: "listening",
        modeReason: null,
        ownerId: t.createdBy,
        agentId,
        slug: "posthog-signups",
        hasSigningSecret: false,
      })
      expect(created.url).toMatch(new RegExp(`^https://ren\\.test/webhooks/${created.id}/[A-Za-z0-9_-]{32,}$`, "u"))
      expect(yield* webhooks.get(t.bob, created.id)).toEqual(created)
    }),
  )

  it.live("a parser expression that does not compile is refused, with its field", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* team
      const refused = yield* Effect.flip(
        webhooks.create(t.ada, { ...signups(t.spaceId), parser: { signature: { kind: "none" }, filter: "body.x ==" } }),
      )
      expect(refused).toMatchObject({ _tag: "Primitive.Invalid", field: "parser.filter" })
      expect((yield* webhooks.list(t.ada, { spaceId: t.spaceId, page: 1, pageSize: 50 })).items).toEqual([])
    }),
  )

  it.live(
    "a webhook whose signature needs a secret goes live only after a secret is set; Ren makes it and reveals it",
    () =>
      Effect.gen(function* () {
        const webhooks = yield* Webhooks.Service
        const t = yield* team
        const created = yield* webhooks.create(t.ada, signups(t.spaceId))
        const live = decodeUpdate({ mode: "live" })
        expect(yield* Effect.flip(webhooks.update(t.ada, created.id, live))).toMatchObject({
          _tag: "Primitive.Invalid",
          field: "mode",
        })
        const set = yield* webhooks.setSigningSecret(t.ada, created.id, {})
        expect(set.record.hasSigningSecret).toBe(true)
        expect(set.secret.length).toBeGreaterThanOrEqual(32)
        expect((yield* webhooks.revealSigningSecret(t.bob, created.id, {})).secret).toBe(set.secret)
        expect(yield* webhooks.update(t.ada, created.id, live)).toMatchObject({ mode: "live", modeReason: null })
      }),
  )

  it.live(
    "a change to the message, parser or agent makes the changer the owner; a name or mode change does not (W10)",
    () =>
      Effect.gen(function* () {
        const webhooks = yield* Webhooks.Service
        const t = yield* team
        const created = yield* webhooks.create(t.ada, {
          ...signups(t.spaceId),
          parser: { signature: { kind: "none" } },
        })
        expect(
          yield* webhooks.update(t.bob, created.id, decodeUpdate({ name: "Signups", mode: "live" })),
        ).toMatchObject({
          ownerId: t.createdBy,
          mode: "live",
        })
        expect(yield* webhooks.update(t.bob, created.id, decodeUpdate({ message: "Say hello." }))).toMatchObject({
          ownerId: t.bob.userId,
        })
      }),
  )

  it.live("rotating the URL replaces its token, and an archived webhook is gone", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* team
      const created = yield* webhooks.create(t.ada, signups(t.spaceId))
      const rotated = yield* webhooks.rotateUrl(t.ada, created.id, {})
      expect(rotated.url).not.toBe(created.url)
      expect(rotated.url.startsWith(`https://ren.test/webhooks/${created.id}/`)).toBe(true)
      yield* webhooks.archive(t.ada, created.id)
      expect(yield* Effect.flip(webhooks.get(t.ada, created.id))).toMatchObject({ _tag: "Primitive.NotFound" })
    }),
  )

  it.live("a member outside the space does not see its webhooks", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* team
      const outsider = yield* Seed.actor(t.organizationId, "member")
      const created = yield* webhooks.create(t.ada, signups(t.spaceId))
      expect(yield* Effect.flip(webhooks.get(outsider, created.id))).toMatchObject({ _tag: "Primitive.NotFound" })
      expect((yield* webhooks.list(outsider, { page: 1, pageSize: 50 })).items).toEqual([])
    }),
  )
})
