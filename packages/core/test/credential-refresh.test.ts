import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Credential } from "@ren/schema/credential"
import { eq } from "drizzle-orm"
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Logger, Option, Redacted, Ref, Schema } from "effect"
import { CredentialRefresh } from "../src/credential-refresh.js"
import { Credentials } from "../src/credentials.js"
import { DurableRunner } from "../src/durable-runner.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

type Answer = "renew" | "fatal" | "transient"

const calls = Ref.makeUnsafe<ReadonlyArray<Credential.ID>>([])
const answer = Ref.makeUnsafe<Answer>("renew")
const invalidated = Ref.makeUnsafe<ReadonlyArray<string>>([])
const logged: Array<string> = []
const gate = Ref.makeUnsafe<
  Option.Option<{ readonly started: Deferred.Deferred<void>; readonly go: Deferred.Deferred<void> }>
>(Option.none())

const refreshers = Layer.succeed(
  CredentialRefresh.Refreshers,
  new Map([
    [
      "oauth" as const,
      {
        refresh: (current: CredentialRefresh.Current) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (all) => [...all, current.id])
            const waiting = yield* Ref.get(gate)
            if (Option.isSome(waiting)) {
              yield* Deferred.succeed(waiting.value.started, undefined)
              yield* Deferred.await(waiting.value.go)
            }
            const chosen = yield* Ref.get(answer)
            if (chosen === "fatal") return yield* new CredentialRefresh.Fatal({ message: "invalid_grant" })
            if (chosen === "transient") return yield* new CredentialRefresh.Transient({ message: "503" })
            return Option.some({
              value: { type: "oauth" as const, accessToken: Redacted.make("refreshed") },
              expiresAt: Option.some(new Date(Date.now() + 3_600_000)),
            })
          }),
      },
    ],
  ]),
)

const control = Layer.succeed(
  EgressControl.Service,
  EgressControl.Service.of({
    invalidate: (selector) => Ref.update(invalidated, (all) => [...all, selector.label ?? ""]),
  }),
)

const logs = Logger.layer([Logger.make((options) => logged.push(String(options.message)))], { mergeWithExisting: true })

const it = testEffect(
  CredentialRefresh.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(refreshers, control, DurableRunner.layerMemory, Envelope.layerLocal)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
        }),
      ),
    ),
  ),
)

const encode = Schema.encodeSync(Schema.fromJsonString(Credentials.Sealed))
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Credentials.Sealed))

const expiring = Effect.fnUntraced(function* (minutes: number | null) {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const organizationId = yield* Seed.organization()
  const id = Credential.ID.create()
  const value = yield* envelope.seal(Redacted.make(encode({ type: "oauth", accessToken: Redacted.make("first") })), {
    organizationId,
    kind: "credential",
    id,
  })
  yield* database.db.insert(Database.Schema.credential).values({
    id,
    organization_id: organizationId,
    owner: "org",
    label: "MCP_LINEAR",
    type: "oauth",
    value,
    hosts: ["mcp.linear.app"],
    inject: { op: "setHeader", name: "Authorization", format: "Bearer {value}" },
    expires_at: minutes === null ? null : new Date(Date.now() + minutes * 60_000),
  })
  return id
})

const stored = Effect.fnUntraced(function* (id: Credential.ID) {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const row = (yield* database.db
    .select()
    .from(Database.Schema.credential)
    .where(eq(Database.Schema.credential.id, id))).at(0)
  if (!row) return
  const opened = yield* envelope.open(row.value, { organizationId: row.organization_id, kind: "credential", id })
  return { row, value: decode(Redacted.value(opened)) }
})

const reset = Effect.all([
  Ref.set(calls, []),
  Ref.set(answer, "renew"),
  Ref.set(invalidated, []),
  Effect.sync(() => logged.splice(0)),
  Ref.set(gate, Option.none()),
])

describe("CredentialRefresh", () => {
  it.live("two sweeps at once refresh an expiring credential once, and skip one far from its expiry", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      yield* reset
      const soon = yield* expiring(3)
      yield* expiring(60)
      yield* Effect.all([refresh.sweep, refresh.sweep], { concurrency: 2 })
      expect(yield* Ref.get(calls)).toEqual([soon])
    }),
  )

  it.live(
    "a token that expires in 19 minutes is refreshed and one in 21 is not; the save raises the revision and clears the egress caches",
    () =>
      Effect.gen(function* () {
        const refresh = yield* CredentialRefresh.Service
        yield* reset
        const nineteen = yield* expiring(19)
        const twentyOne = yield* expiring(21)
        const never = yield* expiring(null)
        yield* refresh.sweep
        expect(yield* Ref.get(calls)).toEqual([nineteen])
        const saved = yield* stored(nineteen)
        expect(saved?.row.revision).toBe(2)
        expect(saved?.value.type === "oauth" && Redacted.value(saved.value.accessToken)).toBe("refreshed")
        expect(saved?.row.refresh_lease_at).toBeNull()
        expect(yield* Ref.get(invalidated)).toEqual(["MCP_LINEAR"])
        expect((yield* stored(twentyOne))?.row.revision).toBe(1)
        expect((yield* stored(never))?.row.revision).toBe(1)
      }),
  )

  it.live("a reconnect that saves while a refresh runs wins; the refresh result is dropped", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      const database = yield* Database.Service
      yield* reset
      const started = yield* Deferred.make<void>()
      const go = yield* Deferred.make<void>()
      yield* Ref.set(gate, Option.some({ started, go }))
      const soon = yield* expiring(3)
      const running = yield* Effect.forkChild(refresh.sweep)
      yield* Deferred.await(started)
      const envelope = yield* Envelope.Service
      const organizationId = (yield* stored(soon))?.row.organization_id
      if (!organizationId) return yield* Effect.die(new Error("The credential is missing"))
      const reconnected = yield* envelope.seal(
        Redacted.make(encode({ type: "oauth", accessToken: Redacted.make("reconnected") })),
        { organizationId, kind: "credential", id: soon },
      )
      yield* database.db
        .update(Database.Schema.credential)
        .set({ revision: 2, value: reconnected })
        .where(eq(Database.Schema.credential.id, soon))
      yield* Deferred.succeed(go, undefined)
      yield* Fiber.join(running)
      const after = yield* stored(soon)
      expect(after?.row.revision).toBe(2)
      expect(after?.value.type === "oauth" && Redacted.value(after.value.accessToken)).toBe("reconnected")
    }),
  )

  it.live("a fatal refresh sets reconnect, clears the value and keeps the row", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      yield* reset
      yield* Ref.set(answer, "fatal")
      const soon = yield* expiring(3)
      yield* refresh.sweep
      const saved = yield* stored(soon)
      expect(saved?.row).toMatchObject({ status: "reconnect", revision: 2, label: "MCP_LINEAR" })
      expect(saved?.value).toEqual({ type: "cleared" })
      expect(yield* Ref.get(invalidated)).toEqual(["MCP_LINEAR"])
      yield* refresh.sweep
      expect((yield* Ref.get(calls)).length).toBe(1)
    }),
  )

  it.live("three temporary failures in a row send an alert; the status stays ok", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      yield* reset
      yield* Ref.set(answer, "transient")
      const soon = yield* expiring(3)
      yield* refresh.sweep
      yield* refresh.sweep
      expect(logged.some((message) => message.includes("alert"))).toBe(false)
      yield* refresh.sweep
      const saved = yield* stored(soon)
      expect(saved?.row).toMatchObject({ status: "ok", refresh_failures: 3, revision: 1 })
      expect(logged.filter((message) => message.includes("alert")).length).toBe(1)
    }).pipe(Effect.provide(logs)),
  )
})
