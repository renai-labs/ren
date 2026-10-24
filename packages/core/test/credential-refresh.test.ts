import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Credential } from "@ren/schema/credential"
import { eq } from "drizzle-orm"
import { Effect, Layer, Ref } from "effect"
import { CredentialRefresh } from "../src/credential-refresh.js"
import { DurableRunner } from "../src/durable-runner.js"
import { EgressControl } from "../src/egress-control.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const calls = Ref.makeUnsafe<ReadonlyArray<string>>([])
const fatal = Ref.makeUnsafe(false)

const refreshers = Layer.succeed(
  CredentialRefresh.Refreshers,
  new Map([
    [
      "oauth" as const,
      {
        refresh: (id: Credential.ID) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (all) => [...all, id])
            yield* Effect.yieldNow
            if (yield* Ref.get(fatal)) return yield* new CredentialRefresh.Fatal({ message: "invalid_grant" })
          }),
      },
    ],
  ]),
)

const it = testEffect(
  CredentialRefresh.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(refreshers, EgressControl.layerNone, DurableRunner.layerMemory)),
    Layer.provideMerge(Testing.layer),
  ),
)

const expiring = Effect.fnUntraced(function* (minutes: number) {
  const database = yield* Database.Service
  const organizationId = yield* Seed.organization()
  const id = Credential.ID.create()
  yield* database.db.insert(Database.Schema.credential).values({
    id,
    organization_id: organizationId,
    owner: "org",
    label: "MCP_LINEAR",
    type: "oauth",
    value: { v: 1, keyId: "local:test", wrappedKey: "", iv: "", ciphertext: "" },
    hosts: ["mcp.linear.app"],
    inject: { op: "replace", in: ["header"] },
    expires_at: new Date(Date.now() + minutes * 60_000),
  })
  return id
})

describe("CredentialRefresh", () => {
  it.live("two sweeps at once refresh an expiring credential once, and skip one far from its expiry", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      yield* Ref.set(calls, [])
      yield* Ref.set(fatal, false)
      const soon = yield* expiring(3)
      yield* expiring(60)
      yield* Effect.all([refresh.sweep, refresh.sweep], { concurrency: 2 })
      expect(yield* Ref.get(calls)).toEqual([soon])
    }),
  )

  it.live("a fatal refresh deletes the credential", () =>
    Effect.gen(function* () {
      const refresh = yield* CredentialRefresh.Service
      const database = yield* Database.Service
      yield* Ref.set(calls, [])
      yield* Ref.set(fatal, true)
      const soon = yield* expiring(3)
      yield* refresh.sweep
      const left = yield* database.db
        .select({ id: Database.Schema.credential.id })
        .from(Database.Schema.credential)
        .where(eq(Database.Schema.credential.id, soon))
      expect(left).toEqual([])
    }),
  )
})
