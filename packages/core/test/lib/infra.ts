export * as InfraFixture from "./infra.js"

import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Infra } from "@ren/schema/infra"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schema, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../../src/access.js"
import type { Actor } from "../../src/actor.js"
import { Agent } from "../../src/agent.js"
import { AgentMembership } from "../../src/agent/membership.js"
import { App } from "../../src/app.js"
import { AppProfiles } from "../../src/app/profiles.js"
import { ChannelMappings } from "../../src/channel-mappings.js"
import type { ChannelProvider } from "../../src/channel-provider.js"
import { Credentials } from "../../src/credentials.js"
import { DurableRunner } from "../../src/durable-runner.js"
import { EgressControl } from "../../src/egress-control.js"
import { Envelope } from "../../src/envelope.js"
import { InfraSpecs } from "../../src/infra-specs.js"
import { Memory } from "../../src/memory.js"
import { OAuthFetch } from "../../src/oauth-fetch.js"
import { OrganizationSettings } from "../../src/organization-settings.js"
import { ReferenceCheck } from "../../src/reference-check.js"
import { ScheduleTrigger } from "../../src/schedule-trigger.js"
import { Schedules } from "../../src/schedules.js"
import { SessionRunner } from "../../src/session/runner.js"
import { Space } from "../../src/space.js"
import { SpaceMember } from "../../src/space/member.js"
import { SpaceSettings } from "../../src/space/settings.js"
import { Seed } from "./seed.js"

const runner = Layer.succeed(
  SessionRunner.Service,
  SessionRunner.Service.of({
    create: () => Effect.void,
    send: (input) => Effect.succeed({ messageId: input.messageId }),
    get: () => Effect.fail(new SessionRunner.NotFound({ message: "Session not found." })),
    onStartRejected: () => Effect.void,
  }),
)

export const layer = (channels: Layer.Layer<ChannelProvider.Registry>) =>
  InfraSpecs.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Agent.layer,
        AgentMembership.layer,
        OrganizationSettings.layer,
        SpaceSettings.layer,
        App.layer,
        AppProfiles.layer,
        ChannelMappings.layer,
        Memory.layer,
        Schedules.layer.pipe(Layer.provide(ScheduleTrigger.layerPostgres), Layer.provide(runner)),
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(Space.layer, SpaceMember.layer, Credentials.layer)),
    Layer.provideMerge(
      Layer.mergeAll(
        Access.layer,
        EgressControl.layerNone,
        ReferenceCheck.layerNone,
        Envelope.layerLocal,
        OAuthFetch.layerUnchecked,
        DurableRunner.layerMemory,
        channels,
      ),
    ),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
        }),
      ),
    ),
  )

export const empty = { permissions: [], references: [] }

export const spec = (
  spaces: Record<string, unknown>,
  org: Record<string, unknown> = {},
  memory: Record<string, string> = {},
) => Schema.decodeUnknownSync(Infra.Spec)({ org: { settings: org }, memory, spaces })

export const bindings = (organization: string, spaces: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(Infra.Bindings)({ organization, spaces })

export const org = Effect.gen(function* () {
  const spaces = yield* Space.Service
  const organizationId = yield* Seed.organization()
  const admin = yield* Seed.actor(organizationId, "admin")
  const home = yield* spaces.create(admin, { name: "Home", slug: "home" })
  return { organizationId, admin, home, bindings: bindings(organizationId.toLowerCase()) }
})

export const privateSpace = Effect.fnUntraced(function* (
  o: { readonly organizationId: Auth.OrganizationID },
  slug: string,
) {
  const database = yield* Database.Service
  const owner = yield* Seed.actor(o.organizationId, "member")
  const id = yield* Seed.space(o.organizationId)
  yield* database.db
    .update(Database.Schema.space)
    .set({ slug, kind: "private", owner_user_id: owner.userId })
    .where(eq(Database.Schema.space.id, id))
  yield* Seed.join(id, owner.userId)
  return id
})

export const replan = (pulled: Infra.Pulled) =>
  Schema.encodeEffect(Infra.Pulled)(pulled).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Infra.PlanInput)),
    Effect.orDie,
  )

export const change = (
  action: Infra.Change["action"],
  kind: Infra.Change["kind"],
  path: string,
  more: {
    readonly fields?: ReadonlyArray<string>
    readonly from?: string
    readonly values?: ReadonlyArray<Infra.Value>
    readonly status?: Infra.Change["status"]
  } = {},
) => ({
  action,
  kind,
  path,
  fields: more.fields ?? [],
  ...(more.from && { from: more.from }),
  ...(more.values && { values: more.values }),
  ...(more.status && { status: more.status }),
})

export const withoutValues = (changes: ReadonlyArray<Infra.Change>) =>
  changes.map((change) => Struct.omit(change, ["values"]))

export const withoutMemory = (lock: Infra.Lock) => ({
  organization: lock.organization,
  resources: Object.fromEntries(Object.entries(lock.resources).filter((entry) => !entry[0].includes("memory/"))),
})

export const pulled = Effect.fnUntraced(function* (actor: Actor.Info) {
  const infra = yield* InfraSpecs.Service
  return yield* replan(yield* infra.pull(actor, {}))
})

export const current = Effect.fnUntraced(function* (actor: Actor.Info, input: Infra.PlanInput) {
  const infra = yield* InfraSpecs.Service
  return { spec: input.spec, bindings: input.bindings, lock: (yield* infra.pull(actor, {})).lock }
})
