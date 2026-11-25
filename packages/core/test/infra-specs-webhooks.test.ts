import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import type { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Actor } from "../src/actor.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { InfraVersions } from "../src/infra-specs/versions.js"
import { Webhooks } from "../src/webhooks.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"
import { WebhookFixture } from "./lib/webhook-fixture.js"

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

const alerts = { message: "Triage this alert.", filter: 'body.kind == "alert"' }

describe("InfraSpecs webhooks", () => {
  it.live(
    "apply creates a listening webhook from webhooks.yaml, updates its parser, keeps its mode, and archives it when the spec drops it",
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

  it.live("apply turns on a preset from { app, preset }, and pull writes it back in that short form", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const app = `github-${crypto.randomUUID().slice(0, 8)}`
      yield* WebhookFixture.presetApp(o.organizationId, { "pull-requests": WebhookFixture.pullRequests }, { slug: app })
      const declared = { "pull-requests": { app, preset: "pull-requests" } }
      const input = { bindings: o.bindings, spec: InfraFixture.spec({ home: { name: "Home", webhooks: declared } }) }
      const planned = yield* infra.plan(o.admin, input)
      expect(planned).toMatchObject({
        changes: [InfraFixture.change("create", "webhook", "spaces/home/webhooks/pull-requests")],
        problems: [],
      })
      yield* infra.apply(o.admin, { ...input, digest: planned.digest })
      expect((yield* listed(o.admin, o.home.id)).get("pull-requests")).toMatchObject({
        name: "Pull requests",
        mode: "listening",
        hasSigningSecret: true,
      })
      expect((yield* infra.pull(o.admin, {})).spec.spaces["home"]?.webhooks).toEqual({
        "pull-requests": { ...declared["pull-requests"], mode: "listening" },
      })
      expect(yield* infra.plan(o.admin, input)).toMatchObject({ changes: [], problems: [] })
    }),
  )

  it.live(
    "apply makes a declared-live webhook live as it creates it, pull writes the mode, and listening turns it off",
    () =>
      Effect.gen(function* () {
        const infra = yield* InfraSpecs.Service
        const o = yield* InfraFixture.org
        const input = (mode: string) => ({
          bindings: o.bindings,
          spec: InfraFixture.spec({ home: { name: "Home", webhooks: { alerts: { ...alerts, mode } } } }),
        })

        const created = yield* infra.plan(o.admin, input("live"))
        expect(created).toMatchObject({
          changes: [InfraFixture.change("create", "webhook", "spaces/home/webhooks/alerts")],
          problems: [],
        })
        yield* infra.apply(o.admin, { ...input("live"), digest: created.digest })
        expect((yield* listed(o.admin, o.home.id)).get("alerts")).toMatchObject({
          mode: "live",
          modeReason: null,
          ownerId: o.admin.userId,
        })
        const pulled = yield* infra.pull(o.admin, {})
        expect(pulled.spec.spaces["home"]?.webhooks["alerts"]).toMatchObject({ mode: "live" })
        expect(yield* infra.plan(o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
          changes: [],
          problems: [],
        })

        const off = yield* InfraFixture.current(o.admin, input("listening"))
        const planned = yield* infra.plan(o.admin, off)
        expect(planned.changes).toMatchObject([
          InfraFixture.change("update", "webhook", "spaces/home/webhooks/alerts", {
            fields: ["mode"],
            values: [{ field: "mode", ren: "live" }],
          }),
        ])
        yield* infra.apply(o.admin, { ...off, digest: planned.digest })
        expect((yield* listed(o.admin, o.home.id)).get("alerts")).toMatchObject({ mode: "listening" })
        expect(yield* infra.plan(o.admin, off)).toMatchObject({ changes: [], problems: [] })
      }),
  )

  it.live("a webhook whose signature needs a signing secret it lacks cannot be declared live", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const webhooks = yield* Webhooks.Service
      const o = yield* InfraFixture.org
      const input = (mode: string) => ({
        bindings: o.bindings,
        spec: InfraFixture.spec({ home: { name: "Home", webhooks: { "posthog-signups": { ...signups, mode } } } }),
      })
      const problem = {
        path: "spaces/home/webhooks/posthog-signups",
        message:
          "Its signature needs a signing secret, which apply cannot set. Apply it as listening, set the secret in the app, then declare it live.",
      }

      expect((yield* infra.plan(o.admin, input("live"))).problems).toEqual([problem])
      const listening = yield* infra.plan(o.admin, input("listening"))
      yield* infra.apply(o.admin, { ...input("listening"), digest: listening.digest })
      expect((yield* infra.plan(o.admin, input("live"))).problems).toEqual([problem])

      const webhook = (yield* listed(o.admin, o.home.id)).get("posthog-signups")
      yield* webhooks.setSigningSecret(o.admin, webhook?.id ?? (yield* Effect.die(new Error("no webhook"))), {})
      const live = yield* InfraFixture.current(o.admin, input("live"))
      const planned = yield* infra.plan(o.admin, live)
      expect(planned).toMatchObject({
        changes: [
          InfraFixture.change("update", "webhook", "spaces/home/webhooks/posthog-signups", { fields: ["mode"] }),
        ],
        problems: [],
      })
      yield* infra.apply(o.admin, { ...live, digest: planned.digest })
      expect((yield* listed(o.admin, o.home.id)).get("posthog-signups")).toMatchObject({ mode: "live" })
    }),
  )

  it.live(
    "a preset goes live as apply turns it on when its app makes the secret, and cannot when the app no longer has it",
    () =>
      Effect.gen(function* () {
        const infra = yield* InfraSpecs.Service
        const database = yield* Database.Service
        const o = yield* InfraFixture.org
        const app = `github-${crypto.randomUUID().slice(0, 8)}`
        const appId = yield* WebhookFixture.presetApp(
          o.organizationId,
          {
            "pull-requests": WebhookFixture.pullRequests,
            issues: { ...WebhookFixture.pullRequests, name: "Issues", secret: "provider" },
          },
          { slug: app },
        )
        const input = (modes: { readonly pulls: string; readonly issues: string }) => ({
          bindings: o.bindings,
          spec: InfraFixture.spec({
            home: {
              name: "Home",
              webhooks: {
                "pull-requests": { app, preset: "pull-requests", mode: modes.pulls },
                issues: { app, preset: "issues", mode: modes.issues },
              },
            },
          }),
        })
        const secret = {
          path: "spaces/home/webhooks/issues",
          message:
            "Its signature needs a signing secret, which apply cannot set. Apply it as listening, set the secret in the app, then declare it live.",
        }

        expect((yield* infra.plan(o.admin, input({ pulls: "live", issues: "live" }))).problems).toEqual([secret])
        const first = input({ pulls: "live", issues: "listening" })
        const planned = yield* infra.plan(o.admin, first)
        expect(planned.problems).toEqual([])
        yield* infra.apply(o.admin, { ...first, digest: planned.digest })
        const after = yield* listed(o.admin, o.home.id)
        expect(after.get("pull-requests")).toMatchObject({ mode: "live", hasSigningSecret: true })
        expect(after.get("issues")).toMatchObject({ mode: "listening", hasSigningSecret: false })

        yield* database.db.update(Database.Schema.app).set({ webhooks: {} }).where(eq(Database.Schema.app.id, appId))
        yield* database.db
          .update(Database.Schema.webhook)
          .set({ mode: "listening", mode_reason: "preset_removed" })
          .where(eq(Database.Schema.webhook.space_id, o.home.id))
        expect((yield* infra.plan(o.admin, first)).problems).toEqual([
          {
            path: "spaces/home/webhooks/pull-requests",
            message: "The app no longer has this preset, so the webhook cannot go live. Declare it listening.",
          },
        ])
      }),
  )

  it.live(
    "a mode change in Ren since the last apply plans as changed in Ren, or as a conflict when the folder changed too",
    () =>
      Effect.gen(function* () {
        const infra = yield* InfraSpecs.Service
        const webhooks = yield* Webhooks.Service
        const database = yield* Database.Service
        const o = yield* InfraFixture.org
        const input = (declared: Record<string, unknown>) => ({
          bindings: o.bindings,
          spec: InfraFixture.spec({ home: { name: "Home", webhooks: { alerts: declared } } }),
        })
        const path = "spaces/home/webhooks/alerts"
        const first = input(alerts)
        const created = yield* infra.plan(o.admin, first)
        const applied = yield* infra.apply(o.admin, { ...first, digest: created.digest })
        const webhook = (yield* listed(o.admin, o.home.id)).get("alerts")
        const id = webhook?.id ?? (yield* Effect.die(new Error("no webhook")))

        yield* webhooks.update(o.admin, id, { mode: "live" })
        const locked = { ...first, lock: applied.lock }
        const kept = yield* infra.plan(o.admin, locked)
        expect(kept.changes).toMatchObject([
          InfraFixture.change("update", "webhook", path, { fields: ["mode"], status: "changed" }),
        ])
        yield* infra.apply(o.admin, { ...locked, digest: kept.digest })
        expect((yield* listed(o.admin, o.home.id)).get("alerts")).toMatchObject({ mode: "live" })
        expect(
          (yield* infra.plan(o.admin, { ...input({ ...alerts, message: "Page the on-call." }), lock: applied.lock }))
            .changes,
        ).toMatchObject([
          InfraFixture.change("update", "webhook", path, { fields: ["message", "mode"], status: "conflict" }),
        ])

        const live = yield* InfraFixture.current(o.admin, input({ ...alerts, mode: "live" }))
        yield* database.db
          .update(Database.Schema.webhook)
          .set({ mode: "listening", mode_reason: "parser_broken" })
          .where(eq(Database.Schema.webhook.id, id))
        expect((yield* infra.plan(o.admin, live)).changes).toMatchObject([
          InfraFixture.change("update", "webhook", path, {
            fields: ["mode"],
            values: [{ field: "mode", folder: "live" }],
            status: "changed",
          }),
        ])
      }),
  )

  it.live("a ren.lock written before webhooks had a mode still holds for a listening webhook", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const o = yield* InfraFixture.org
      const input = (declared: Record<string, unknown>) => ({
        bindings: o.bindings,
        spec: InfraFixture.spec({ home: { name: "Home", webhooks: { alerts: declared } } }),
      })
      const first = input(alerts)
      const created = yield* infra.plan(o.admin, first)
      const applied = yield* infra.apply(o.admin, { ...first, digest: created.digest })
      const path = "spaces/home/webhooks/alerts"
      const before = InfraVersions.hash({
        name: "alerts",
        message: alerts.message,
        parser: { signature: { kind: "none" }, filter: alerts.filter },
      })
      const lock = { ...applied.lock, resources: { ...applied.lock.resources, [path]: before } }
      expect(
        (yield* infra.plan(o.admin, { ...input({ ...alerts, message: "Page the on-call." }), lock })).changes,
      ).toEqual([InfraFixture.change("update", "webhook", path, { fields: ["message"], values: expect.any(Array) })])
    }),
  )
})
