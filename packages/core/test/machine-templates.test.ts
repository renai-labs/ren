import { HandProvider } from "../src/hand-provider.js"
import { HttpClient } from "effect/http"
import { SandboxEgress } from "../src/sandbox-egress.js"
import { MachineNetwork } from "../src/machine-network.js"
import { Bundles } from "../src/bundles.js"
import { describe, expect } from "bun:test"
import { Signature } from "@ren/schema/signature"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { eq } from "drizzle-orm"
import type { Auth } from "@ren/schema/auth"
import { MachineTemplate } from "@ren/schema/machine-template"
import { Brain } from "@ren/schema/brain"
import type { Actor } from "../src/actor.js"
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Queue, Ref, Schedule, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { MachineTemplates } from "../src/machine-templates.js"
import { Hands } from "../src/hands.js"
import { DurableRunner } from "../src/durable-runner.js"
import { MachineProvider } from "../src/machine-provider.js"
import { Space } from "../src/space.js"
import { BrainProvider } from "../src/brain-provider.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/hand-provider.js"
import { Seed } from "./lib/seed.js"
import { Signer } from "../src/signer.js"

const probe = await Effect.runPromise(TestProvider.make())

// oxlint-disable-next-line ren/no-comments -- A build of the "built" provider runs until the test opens the gate of its label; a label that starts with "broken" fails.
const started = await Effect.runPromise(Queue.unbounded<string>())
const checked = await Effect.runPromise(Queue.unbounded<string>())
const starting = new Map<string, Deferred.Deferred<void>>()
const gates = new Map<string, Deferred.Deferred<void>>()
const gate = (label: string) => {
  const found = gates.get(label) ?? Deferred.makeUnsafe<void>()
  gates.set(label, found)
  return found
}
const built = await Effect.runPromise(
  TestProvider.make({
    id: "built",
    canLimitHosts: true,
    systemImage: "ren-brain:sys2",
    build: {
      start: (config) =>
        Queue.offer(started, config.label).pipe(
          Effect.andThen(() => {
            const held = starting.get(config.label)
            return held ? Deferred.await(held) : Effect.void
          }),
          Effect.as({ _tag: "Building", id: config.label } as const),
        ),
      status: (label) =>
        Queue.offer(checked, label).pipe(
          Effect.andThen(Deferred.isDone(gate(label))),
          Effect.map((isDone): MachineProvider.BuildState => {
            if (!isDone) return { _tag: "Building", id: label }
            if (label.startsWith("broken")) return { _tag: "Failed", reason: `${label} does not build` }
            return { _tag: "Ready", image: `image-${label}` }
          }),
        ),
    },
  }),
)

const brains = [Effect.map(TestProvider.make({ canColocate: true }), (each) => each.provider)] as const

const key = await Effect.runPromise(Signature.generate("environments"))

const builds = MachineTemplates.layer.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ENVIRONMENT_TEMPLATE_BUILD_CHECK: "20 millis" }))),
)

const it = testEffect(
  Layer.mergeAll(
    builds,
    Hands.layer.pipe(
      Layer.provide(DurableRunner.layerMemory),
      Layer.provide([SandboxEgress.layerNone, MachineNetwork.layerNone]),
      Layer.provide(Bundles.layer),
      Layer.provide([Signer.layerLocal, Layer.succeed(HttpClient.HttpClient, TestProvider.executors([probe, built]))]),
    ),
    Space.layer,
    SpaceProvisioning.layer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        HandProvider.layer([Effect.succeed(probe.provider), Effect.succeed(built.provider)]),
        BrainProvider.layer(brains),
        DurableRunner.layerMemory,
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ENVIRONMENT_TEMPLATE_BUILD_CHECK: "20 millis",
          ENVIRONMENT_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
        }),
      ),
    ),
  ),
)

const page = { page: 1, pageSize: 50 }

const user = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, role = "member") {
  const provisioning = yield* SpaceProvisioning.Service
  const seeded = yield* Seed.user()
  yield* Seed.member(organizationId, seeded.id, role)
  yield* provisioning.createInitialMemberships(organizationId, seeded)
  return { userId: seeded.id, organizationId, roles: [role] }
})

const team = Effect.fnUntraced(function* () {
  const spaces = yield* Space.Service
  const organizationId = yield* Seed.organization()
  const ada = yield* user(organizationId)
  const admin = yield* user(organizationId, "admin")
  const space = yield* spaces.create(ada, { name: "Team" })
  return { organizationId, ada, admin, space }
})

const input = {
  name: "Python",
  provider: MachineProvider.ID.make("test"),
  config: { label: "python" },
  sessionsPerEnvironment: 2,
  networking: { type: "unrestricted" },
} satisfies MachineTemplate.CreateInput

describe("MachineTemplates", () => {
  it.live("an admin makes an org environment template; the provider checks the config and keeps its own form", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, { ...input, config: { label: "python", extra: "dropped" } })
      expect(made).toMatchObject({
        name: "Python",
        provider: "test",
        config: { label: "python" },
        sessionsPerEnvironment: 2,
        archivedAt: null,
      })
      expect(yield* templates.get(setup.admin, made.id)).toEqual(made)
      expect((yield* templates.list(setup.admin, page)).items).toEqual([made])
    }),
  )

  it.live("an unknown provider or a config the provider refuses is Invalid, and names the field", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const unknown = yield* templates
        .create(setup.admin, { ...input, provider: MachineProvider.ID.make("e2b") })
        .pipe(Effect.flip)
      expect(unknown).toMatchObject({ _tag: "Primitive.Invalid", field: "provider" })
      const refused = yield* templates.create(setup.admin, { ...input, config: { label: "" } }).pipe(Effect.flip)
      expect(refused).toMatchObject({ _tag: "Primitive.Invalid", field: "config" })
      const made = yield* templates.create(setup.admin, input)
      const update = yield* templates.update(setup.admin, made.id, { config: { label: 3 } }).pipe(Effect.flip)
      expect(update).toMatchObject({ _tag: "Primitive.Invalid", field: "config" })
      expect((yield* templates.update(setup.admin, made.id, { config: { label: "new" } })).config).toEqual({
        label: "new",
      })
    }),
  )

  it.live("every member sees the org's environment templates; only admins change them; another org sees none", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, input)
      expect(yield* templates.get(setup.ada, made.id)).toEqual(made)
      expect((yield* templates.create(setup.ada, input).pipe(Effect.flip))._tag).toBe("Primitive.Forbidden")
      expect((yield* templates.update(setup.ada, made.id, { name: "Mine" }).pipe(Effect.flip))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* templates.archive(setup.ada, made.id).pipe(Effect.flip))._tag).toBe("Primitive.Forbidden")
      expect((yield* templates.list(yield* user(yield* Seed.organization()), page)).items).toEqual([])
    }),
  )

  it.live(
    "a member of a space picks an organization's template as its remote hand, or none, and each change takes the next compute revision (space settings rules 1, 5)",
    () =>
      Effect.gen(function* () {
        const templates = yield* MachineTemplates.Service
        const spaces = yield* Space.Service
        const setup = yield* team()
        const grace = yield* user(setup.organizationId)
        const made = yield* templates.create(setup.admin, input)
        expect(setup.space.hand).toEqual({ placement: "colocated" })
        const remote = { placement: "remote", environmentTemplateId: made.id } as const
        expect((yield* spaces.update(grace, setup.space.id, { hand: remote }).pipe(Effect.flip))._tag).toBe(
          "Primitive.NotFound",
        )
        const database = yield* Database.Service
        const revision = database.db
          .select({ revision: Database.Schema.space.compute_revision })
          .from(Database.Schema.space)
          .where(eq(Database.Schema.space.id, setup.space.id))
          .pipe(Effect.map((rows) => rows.at(0)?.revision))
        expect((yield* spaces.update(setup.ada, setup.space.id, { hand: remote })).hand).toEqual(remote)
        const afterRemote = yield* revision
        yield* spaces.update(setup.ada, setup.space.id, { hand: remote, name: "Same hand" })
        const afterSame = yield* revision
        expect((yield* spaces.update(setup.ada, setup.space.id, { hand: { placement: "none" } })).hand).toEqual({
          placement: "none",
        })
        expect([afterRemote, afterSame, yield* revision]).toEqual([1, 1, 2])
        const foreign = yield* templates.create((yield* team()).admin, input)
        expect(
          yield* spaces
            .update(setup.ada, setup.space.id, { hand: { placement: "remote", environmentTemplateId: foreign.id } })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Primitive.Invalid", field: "hand" })
      }),
  )

  it.live(
    "a space's brain runs a built template of its brain provider with any hand; an unknown provider or another provider's template is refused",
    () =>
      Effect.gen(function* () {
        const templates = yield* MachineTemplates.Service
        const spaces = yield* Space.Service
        const setup = yield* team()
        const made = yield* templates.create(setup.admin, input)
        const provider = MachineProvider.ID.make("test")
        expect(setup.space.brain).toEqual({ provider, environmentTemplateId: null })
        const brain = { provider, environmentTemplateId: made.id }
        const remote = { placement: "remote", environmentTemplateId: made.id } as const
        const updated = yield* spaces.update(setup.ada, setup.space.id, { brain, hand: remote })
        expect([updated.brain, updated.hand]).toEqual([brain, remote])
        const other = yield* Seed.environmentTemplate(setup.organizationId, { provider: "other" })
        const refused = (change: Parameters<typeof spaces.update>[2]) =>
          spaces.update(setup.ada, setup.space.id, change).pipe(Effect.flip)
        expect(yield* refused({ brain: { provider, environmentTemplateId: other } })).toMatchObject({
          _tag: "Primitive.Invalid",
          field: "brain",
        })
        expect(
          yield* refused({ brain: { provider: MachineProvider.ID.make("nope"), environmentTemplateId: null } }),
        ).toMatchObject({ _tag: "Primitive.Invalid", field: "brain" })
      }),
  )

  it.live("archiving a template that a space uses is refused, with the spaces", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const spaces = yield* Space.Service
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, input)
      yield* spaces.update(setup.ada, setup.space.id, { hand: { placement: "remote", environmentTemplateId: made.id } })
      expect(yield* templates.archive(setup.admin, made.id).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Conflict",
        message: "Spaces use this environment template: Team. Pick another brain or hand for them first.",
      })
      yield* spaces.update(setup.ada, setup.space.id, {
        brain: { provider: MachineProvider.ID.make("test"), environmentTemplateId: made.id },
        hand: { placement: "none" },
      })
      expect((yield* templates.archive(setup.admin, made.id).pipe(Effect.flip))._tag).toBe("Primitive.Conflict")
      yield* spaces.update(setup.ada, setup.space.id, {
        brain: { provider: MachineProvider.ID.make("test"), environmentTemplateId: null },
      })
      expect((yield* templates.archive(setup.admin, made.id)).archivedAt).not.toBeNull()
    }),
  )

  it.live("archiving refuses a template still applied to a brain after the space selects another", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const old = yield* templates.create(setup.admin, input)
      const next = yield* templates.create(setup.admin, { ...input, name: "Next" })
      yield* database.db.insert(Database.Schema.brain).values({
        id: Brain.ID.create(),
        organization_id: setup.organizationId,
        space_id: setup.space.id,
        scope: "session",
        image_template: { environmentTemplateId: old.id, config: {}, system: null },
      })
      yield* database.db
        .update(Database.Schema.space)
        .set({ brain_template_id: next.id })
        .where(eq(Database.Schema.space.id, setup.space.id))
      expect(yield* templates.archive(setup.admin, old.id).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Conflict",
        message: "Spaces use this environment template: Team. Pick another brain or hand for them first.",
      })
    }),
  )

  it.live("archiving refuses a template still applied to a remote hand after the space selects another", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const templates = yield* MachineTemplates.Service
      const environments = yield* Hands.Service
      const setup = yield* team()
      const old = yield* templates.create(setup.admin, input)
      const next = yield* templates.create(setup.admin, { ...input, name: "Next" })
      const session = yield* Seed.subject(setup.organizationId, setup.space.id)
      yield* environments.bind(session, Seed.version(old.id))
      const applied = yield* environments.access(session, { _tag: "Remote" })
      yield* database.db
        .update(Database.Schema.space)
        .set({ hand_placement: "remote", environment_template_id: next.id })
        .where(eq(Database.Schema.space.id, setup.space.id))
      expect(yield* templates.archive(setup.admin, old.id).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Conflict",
        message: "Spaces use this environment template: Team. Pick another brain or hand for them first.",
      })
      expect((yield* environments.access(session, { _tag: "Remote" })).url.href).toBe(applied.url.href)
    }),
  )

  it.live("archiving hides an unused environment template and destroys its unbound machines", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const environments = yield* Hands.Service
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, input)
      const session = yield* Seed.subject(setup.organizationId, setup.space.id)
      yield* environments.bind(session, Seed.version(made.id))
      yield* environments.access(session, { _tag: "Remote" })
      const environmentId = (yield* Ref.get(probe.provisions)).at(-1)
      yield* environments.unbind(session)
      const archived = yield* templates.archive(setup.admin, made.id)
      expect(archived.archivedAt).not.toBeNull()
      expect(yield* templates.archive(setup.admin, made.id)).toEqual(archived)
      expect((yield* templates.get(setup.admin, made.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      expect((yield* environments.access(session, { _tag: "Remote" }).pipe(Effect.flip))._tag).toBe("Hands.NotFound")
      expect((yield* Ref.get(probe.destroyed)).at(-1)).toBe(environmentId)
    }),
  )

  it.live("archival waits for a concurrent hand binding and then refuses the applied template", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const environments = yield* Hands.Service
      const sql = yield* SqlClient.SqlClient
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, input)
      const session = yield* Seed.subject(setup.organizationId, setup.space.id)
      const locked = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const holder = yield* sql
        .withTransaction(
          sql`lock table session_environment in share mode`.pipe(
            Effect.andThen(Deferred.succeed(locked, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(locked)
      const binding = yield* environments.bind(session, Seed.version(made.id)).pipe(Effect.forkChild)
      const waiting = (count: number) =>
        sql<{ readonly waiting: number }>`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
      `.pipe(
          Effect.repeat({
            until: (rows) => (rows.at(0)?.waiting ?? 0) >= count,
            schedule: Schedule.spaced("5 millis"),
          }),
        )
      yield* waiting(1)
      const archival = yield* templates.archive(setup.admin, made.id).pipe(Effect.flip, Effect.forkChild)
      const observed = yield* Effect.raceFirst(
        waiting(2).pipe(Effect.as("waiting")),
        Fiber.await(archival).pipe(Effect.as("finished")),
      )
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(holder)
      yield* Fiber.join(binding)
      expect(observed).toBe("waiting")
      expect(yield* Fiber.join(archival)).toMatchObject({ _tag: "Primitive.Conflict" })
    }),
  )

  it.live("lists each provider with a JSON Schema of its config, for the form", () =>
    Effect.gen(function* () {
      const registry = yield* HandProvider.Registry
      expect(registry.providers.map((provider) => provider.info).slice(0, 1)).toEqual([
        {
          id: MachineProvider.ID.make("test"),
          title: "Test",
          description: "Environments that live in the test’s memory.",
          canLimitHosts: false,
          canColocate: false,
          configSchema: {
            dialect: "draft-2020-12",
            schema: {
              type: "object",
              title: "Test",
              properties: {
                label: {
                  type: "string",
                  minLength: 1,
                  title: "Label",
                  description: "A name for the test environments.",
                },
              },
              required: ["label"],
              additionalProperties: true,
            },
            definitions: {},
          },
        },
      ])
    }),
  )

  const builtInput = (label: string) => ({
    ...input,
    provider: MachineProvider.ID.make("built"),
    config: { label },
  })

  const settled = (id: MachineTemplate.ID, actor: Actor.Info) =>
    Effect.flatMap(MachineTemplates.Service, (templates) => templates.get(actor, id)).pipe(
      Effect.repeat({
        until: (template) => template.buildStatus === "ready" || template.buildStatus === "failed",
        schedule: Schedule.spaced("20 millis"),
      }),
    )

  it.live("a save during a build waits for it, and the newest config builds next", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const a = `a-${crypto.randomUUID()}`
      const b = `b-${crypto.randomUUID()}`
      const made = yield* templates.create(setup.admin, builtInput(a))
      expect(made).toMatchObject({ buildStatus: "queued", image: null })
      expect(yield* Queue.take(started)).toBe(a)
      expect((yield* templates.update(setup.admin, made.id, { config: { label: b } })).buildStatus).toBe("queued")
      yield* Deferred.succeed(gate(a), undefined)
      expect(yield* Queue.take(started)).toBe(b)
      yield* Deferred.succeed(gate(b), undefined)
      expect(yield* settled(made.id, setup.admin)).toMatchObject({ buildStatus: "ready", image: `image-${b}` })
    }),
  )

  it.live("save A, then B, then A during A's build: the image is A", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const a = `a-${crypto.randomUUID()}`
      const b = `b-${crypto.randomUUID()}`
      const made = yield* templates.create(setup.admin, builtInput(a))
      expect(yield* Queue.take(started)).toBe(a)
      yield* templates.update(setup.admin, made.id, { config: { label: b } })
      yield* templates.update(setup.admin, made.id, { config: { label: a } })
      yield* Deferred.succeed(gate(b), undefined)
      yield* Deferred.succeed(gate(a), undefined)
      expect(yield* Queue.take(started)).toBe(a)
      expect(yield* settled(made.id, setup.admin)).toMatchObject({ buildStatus: "ready", image: `image-${a}` })
    }),
  )

  it.live("two build owners and a save during build start wait for that build before starting the new config", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const a = `starting-${crypto.randomUUID()}`
      const b = `next-${crypto.randomUUID()}`
      const held = yield* Deferred.make<void>()
      starting.set(a, held)
      yield* Queue.clear(checked)
      const made = yield* templates.create(setup.admin, builtInput(a))
      expect(yield* Queue.take(started)).toBe(a)
      yield* Layer.build(Layer.fresh(builds))
      yield* templates.update(setup.admin, made.id, { config: { label: b } })
      yield* Deferred.succeed(held, undefined)
      const next = yield* Effect.raceFirst(
        Queue.take(started).pipe(Effect.map((label) => ({ type: "start", label }))),
        Queue.take(checked).pipe(Effect.map((label) => ({ type: "status", label }))),
      )
      expect(next).toEqual({ type: "status", label: a })
      yield* Deferred.succeed(gate(a), undefined)
      expect(yield* Queue.take(started)).toBe(b)
      yield* Deferred.succeed(gate(b), undefined)
      expect((yield* settled(made.id, setup.admin)).image).toBe(`image-${b}`)
    }),
  )

  it.live("a failed build keeps the last image and shows its error; a space cannot pick a template never built", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const spaces = yield* Space.Service
      const setup = yield* team()
      const broken = `broken-${crypto.randomUUID()}`
      const good = `good-${crypto.randomUUID()}`
      const made = yield* templates.create(setup.admin, builtInput(broken))
      expect(yield* Queue.take(started)).toBe(broken)
      const remote = { placement: "remote", environmentTemplateId: made.id } as const
      expect(yield* spaces.update(setup.ada, setup.space.id, { hand: remote }).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Invalid",
        field: "hand",
        message: `The environment template ${made.id} has no image yet; wait until its build is ready`,
      })
      yield* Deferred.succeed(gate(broken), undefined)
      expect(yield* settled(made.id, setup.admin)).toMatchObject({
        buildStatus: "failed",
        image: null,
        buildError: `${broken} does not build`,
      })
      expect(yield* spaces.update(setup.ada, setup.space.id, { hand: remote }).pipe(Effect.flip)).toMatchObject({
        message: `The environment template ${made.id} has no image: its build failed. Fix the template and save it again.`,
      })
      yield* templates.update(setup.admin, made.id, { config: { label: good } })
      expect(yield* Queue.take(started)).toBe(good)
      yield* Deferred.succeed(gate(good), undefined)
      expect((yield* settled(made.id, setup.admin)).image).toBe(`image-${good}`)
      expect((yield* spaces.update(setup.ada, setup.space.id, { hand: remote })).hand).toEqual(remote)
      const later = `broken-${crypto.randomUUID()}`
      yield* templates.update(setup.admin, made.id, { config: { label: later } })
      expect(yield* Queue.take(started)).toBe(later)
      yield* Deferred.succeed(gate(later), undefined)
      expect(yield* settled(made.id, setup.admin)).toMatchObject({
        buildStatus: "failed",
        image: `image-${good}`,
        buildError: `${later} does not build`,
      })
    }),
  )

  it.live("limited networking needs a provider that can limit hosts", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const limited = {
        type: "limited",
        allowPackageManagers: true,
        allowMcpServers: false,
        allowedHosts: ["api.example.com"],
      } as const
      expect(yield* templates.create(setup.admin, { ...input, networking: limited }).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Invalid",
        field: "networking",
      })
      const label = `n-${crypto.randomUUID()}`
      yield* Deferred.succeed(gate(label), undefined)
      const made = yield* templates.create(setup.admin, { ...builtInput(label), networking: limited })
      expect(made.networking).toEqual(limited)
      expect(yield* Queue.take(started)).toBe(label)
    }),
  )

  it.live("Retry build uses unchanged config, preserves the ready image and coalesces duplicate requests", () =>
    Effect.gen(function* () {
      const templates = yield* MachineTemplates.Service
      const setup = yield* team()
      const good = `good-${crypto.randomUUID()}`
      const broken = `broken-${crypto.randomUUID()}`
      const made = yield* templates.create(setup.admin, builtInput(good))
      expect(yield* Queue.take(started)).toBe(good)
      yield* Deferred.succeed(gate(good), undefined)
      yield* settled(made.id, setup.admin)
      yield* templates.update(setup.admin, made.id, { config: { label: broken } })
      expect(yield* Queue.take(started)).toBe(broken)
      yield* Deferred.succeed(gate(broken), undefined)
      yield* settled(made.id, setup.admin)
      gates.set(broken, Deferred.makeUnsafe<void>())
      expect(yield* templates.retryBuild(setup.ada, made.id, {}).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Forbidden",
      })
      const retried = yield* Effect.all(
        Array.from({ length: 4 }, () => templates.retryBuild(setup.admin, made.id, {})),
        { concurrency: "unbounded" },
      )
      expect(retried.every((template) => template.image === `image-${good}`)).toBe(true)
      expect(yield* Queue.take(started)).toBe(broken)
      yield* Deferred.succeed(gate(broken), undefined)
      expect(yield* settled(made.id, setup.admin)).toMatchObject({
        config: { label: broken },
        buildStatus: "failed",
        image: `image-${good}`,
      })
      expect(yield* Queue.clear(started)).not.toContain(broken)
    }),
  )

  it.live("a Ren restart during a build asks about that build, and starts no second one", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const setup = yield* team()
      const label = `running-${crypto.randomUUID()}`
      const id = MachineTemplate.ID.create()
      yield* database.db.insert(Database.Schema.environment_template).values({
        id,
        organization_id: setup.organizationId,
        name: "Running",
        provider: MachineProvider.ID.make("built"),
        config: { label },
        sessions_per_environment: 8,
        build_status: "building",
        config_version: 3,
        build_id: label,
        build_version: 3,
      })
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(Layer.fresh(builds))
          yield* Deferred.succeed(gate(label), undefined)
          expect(yield* settled(id, setup.admin)).toMatchObject({ buildStatus: "ready", image: `image-${label}` })
        }),
      )
      expect(yield* Queue.clear(started)).not.toContain(label)
    }),
  )

  it.live(
    "at start, a template built on another system image builds again on the provider's, and keeps its old image until then",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const setup = yield* team()
        const label = `system-${crypto.randomUUID()}`
        const id = MachineTemplate.ID.create()
        yield* database.db.insert(Database.Schema.environment_template).values({
          id,
          organization_id: setup.organizationId,
          name: "Old system",
          provider: MachineProvider.ID.make("built"),
          config: { label },
          sessions_per_environment: 8,
          build_status: "ready",
          image: "image-old",
          image_config: { label },
          image_system: "ren-brain:sys1",
        })
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Layer.build(Layer.fresh(builds))
            expect(yield* Queue.take(started)).toBe(label)
            yield* Deferred.succeed(gate(label), undefined)
            expect(yield* settled(id, setup.admin)).toMatchObject({ buildStatus: "ready", image: `image-${label}` })
          }),
        )
        const row = (yield* database.db
          .select({ system: Database.Schema.environment_template.image_system })
          .from(Database.Schema.environment_template)
          .where(eq(Database.Schema.environment_template.id, id))).at(0)
        expect(row?.system).toBe("ren-brain:sys2")
      }),
  )

  it.live(
    "a running Ren builds again a template that an older Ren marked ready on another system image (rolling deploy)",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const setup = yield* team()
        const label = `overlap-${crypto.randomUUID()}`
        const id = MachineTemplate.ID.create()
        yield* database.db.insert(Database.Schema.environment_template).values({
          id,
          organization_id: setup.organizationId,
          name: "Older Ren",
          provider: MachineProvider.ID.make("built"),
          config: { label },
          sessions_per_environment: 8,
          build_status: "ready",
          image: "image-old",
          image_config: { label },
          image_system: "ren-brain:sys1",
        })
        expect(yield* Queue.take(started)).toBe(label)
        yield* Deferred.succeed(gate(label), undefined)
        expect(yield* settled(id, setup.admin)).toMatchObject({ buildStatus: "ready", image: `image-${label}` })
        const row = (yield* database.db
          .select({ system: Database.Schema.environment_template.image_system })
          .from(Database.Schema.environment_template)
          .where(eq(Database.Schema.environment_template.id, id))).at(0)
        expect(row?.system).toBe("ren-brain:sys2")
      }),
  )

  it.live("at start, Ren builds again a template left queued without a build", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const setup = yield* team()
      const label = `left-${crypto.randomUUID()}`
      const id = MachineTemplate.ID.create()
      yield* database.db.insert(Database.Schema.environment_template).values({
        id,
        organization_id: setup.organizationId,
        name: "Left",
        provider: MachineProvider.ID.make("built"),
        config: { label },
        sessions_per_environment: 8,
        build_status: "queued",
        config_version: 3,
      })
      yield* Deferred.succeed(gate(label), undefined)
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(Layer.fresh(builds))
          expect(yield* Queue.take(started)).toBe(label)
          expect(yield* settled(id, setup.admin)).toMatchObject({ buildStatus: "ready", image: `image-${label}` })
        }),
      )
    }),
  )
})
