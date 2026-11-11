import { MachineProvider } from "../src/machine-provider.js"
import { HandProvider } from "../src/hand-provider.js"
import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import type { MachineTemplate } from "@ren/schema/machine-template"
import type { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Context, Effect, Equal, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { BrainProvider } from "../src/brain-provider.js"
import { Bundles } from "../src/bundles.js"
import { MachineNetwork } from "../src/machine-network.js"
import { Hands } from "../src/hands.js"
import { DurableRunner } from "../src/durable-runner.js"
import { SandboxEgress } from "../src/sandbox-egress.js"
import { Signer } from "../src/signer.js"
import { SpaceCompute } from "../src/space-compute.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/hand-provider.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const compute = Effect.gen(function* () {
  const probe = yield* TestProvider.make()
  const context = yield* Layer.build(
    Layer.fresh(SpaceCompute.layer).pipe(
      Layer.provide(
        Hands.layer.pipe(
          Layer.provide(DurableRunner.layerMemory),
          Layer.provide([SandboxEgress.layerNone, MachineNetwork.layerNone, Bundles.layer]),
          Layer.provide([Signer.layerLocal, FetchHttpClient.layer]),
          Layer.provide(HandProvider.layer([Effect.succeed(probe.provider)])),
        ),
      ),
      Layer.provide(BrainProvider.layer([])),
    ),
  )
  return Context.get(context, SpaceCompute.Service)
})

const remoteOn = (environmentTemplateId: MachineTemplate.ID): Space.AppliedHand => ({
  placement: "remote",
  version: { environmentTemplateId, image: null, config: {}, system: null },
})

// oxlint-disable-next-line ren/no-comments -- A space with one brain and two top chats on it, bound to `bound`. The brain's machine was made for a remote hand or not, and the brain applied `applied`.
const seeded = Effect.fnUntraced(function* (options: {
  readonly provider?: string
  readonly isRemote: boolean
  readonly applied: (template: MachineTemplate.ID) => Space.AppliedHand
}) {
  const database = yield* Database.Service
  const owner = yield* Seed.owner()
  const first = yield* Seed.environmentTemplate(owner.organizationId)
  const second = yield* Seed.environmentTemplate(owner.organizationId)
  const brainId = Brain.ID.create()
  const chats = [yield* Seed.session({ ...owner, brainId }), yield* Seed.session({ ...owner, brainId })]
  const applied = options.applied(first)
  yield* database.db
    .update(Database.Schema.brain)
    .set({
      provider: options.provider ? MachineProvider.ID.make(options.provider) : null,
      hand_placement: options.isRemote ? "remote" : "colocated",
      hand: applied,
    })
    .where(eq(Database.Schema.brain.id, brainId))
  if (applied.placement === "remote")
    yield* database.db.insert(Database.Schema.session_environment).values(
      chats.map((sessionId) => ({
        session_id: sessionId,
        space_id: owner.spaceId,
        environment_template_id: first,
        target: Seed.version(first),
      })),
    )
  const desire = (hand: Space.Hand, provider?: string) =>
    database.db
      .update(Database.Schema.space)
      .set({
        hand_placement: hand.placement,
        environment_template_id: hand.placement === "remote" ? hand.environmentTemplateId : null,
        brain_provider: provider ? MachineProvider.ID.make(provider) : null,
        compute_revision: 1,
      })
      .where(eq(Database.Schema.space.id, owner.spaceId))
  const state = Effect.gen(function* () {
    const brain = (yield* database.db
      .select({ hand: Database.Schema.brain.hand, revision: Database.Schema.brain.compute_revision })
      .from(Database.Schema.brain)
      .where(eq(Database.Schema.brain.id, brainId))).at(0)
    const bound = yield* Effect.forEach(chats, (sessionId) =>
      database.db
        .select({ template: Database.Schema.session_environment.environment_template_id })
        .from(Database.Schema.session_environment)
        .where(eq(Database.Schema.session_environment.session_id, sessionId))
        .pipe(Effect.map((rows) => rows.at(0)?.template ?? null)),
    )
    const template = brain?.hand?.placement === "remote" ? brain.hand.version.environmentTemplateId : null
    return { placement: brain?.hand?.placement, template, revision: brain?.revision, bound }
  })
  return { brainId, first, second, desire, state }
})

describe("SpaceCompute", () => {
  it.live("a woken remote brain applies another remote template: its chats move to it, with the revision", () =>
    Effect.gen(function* () {
      const service = yield* compute
      const subject = yield* seeded({ isRemote: true, applied: remoteOn })
      yield* subject.desire({ placement: "remote", environmentTemplateId: subject.second })
      const plan = yield* service.applySettings(subject.brainId, { machine: "running" })
      expect([plan._tag, yield* subject.state]).toEqual([
        "Apply",
        { placement: "remote", template: subject.second, revision: 1, bound: [subject.second, subject.second] },
      ])
    }),
  )

  it.live("a woken brain applies no tools in place: its chats lose their remote bindings", () =>
    Effect.gen(function* () {
      const service = yield* compute
      const subject = yield* seeded({ isRemote: true, applied: remoteOn })
      yield* subject.desire({ placement: "none" })
      const plan = yield* service.applySettings(subject.brainId, { machine: "running" })
      expect([plan._tag, yield* subject.state]).toEqual([
        "Apply",
        { placement: "none", template: null, revision: 1, bound: [null, null] },
      ])
    }),
  )

  it.live("a woken brain whose machine cannot run the space's settings is replaced, and keeps what it applied", () =>
    Effect.gen(function* () {
      const service = yield* compute
      const colocated = (): Space.AppliedHand => ({ placement: "colocated" })
      const cases: ReadonlyArray<{
        readonly name: string
        readonly isRemote: boolean
        readonly applied: (template: MachineTemplate.ID) => Space.AppliedHand
        readonly to: "colocated" | "remote"
        readonly provider?: string
        readonly desiredProvider?: string
      }> = [
        { name: "remote to co-located", isRemote: true, applied: remoteOn, to: "colocated" },
        { name: "co-located to remote", isRemote: false, applied: colocated, to: "remote" },
        { name: "no tools to remote", isRemote: true, applied: () => ({ placement: "none" }), to: "remote" },
        {
          name: "another brain provider",
          isRemote: false,
          applied: colocated,
          to: "colocated",
          provider: "e2b",
          desiredProvider: "local",
        },
      ]
      const outcomes = yield* Effect.forEach(cases, (each) =>
        Effect.gen(function* () {
          const subject = yield* seeded({
            isRemote: each.isRemote,
            applied: each.applied,
            ...(each.provider && { provider: each.provider }),
          })
          const before = yield* subject.state
          yield* subject.desire(
            each.to === "remote"
              ? { placement: "remote", environmentTemplateId: subject.second }
              : { placement: each.to },
            each.desiredProvider,
          )
          const plan = yield* service.applySettings(subject.brainId, { machine: "running" })
          return {
            name: each.name,
            plan: plan._tag,
            isKept: Equal.equals(yield* subject.state, before),
          }
        }),
      )
      expect(outcomes).toEqual(cases.map((each) => ({ name: each.name, plan: "Replace", isKept: true })))
    }),
  )
})
