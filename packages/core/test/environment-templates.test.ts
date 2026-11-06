import { describe, expect } from "bun:test"
import { Signature } from "@ren/schema/signature"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Actor } from "../src/actor.js"
import { ConfigProvider, Deferred, Effect, Layer, Option, Queue, Ref, Schedule, Schema } from "effect"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { EnvironmentTemplates } from "../src/environment-templates.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { DurableRunner } from "../src/durable-runner.js"
import { MachineProvider } from "../src/machine-provider.js"
import { Space } from "../src/space.js"
import { BrainProvider } from "../src/brain-provider.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Seed } from "./lib/seed.js"
import { Signer } from "../src/signer.js"

const probe = await Effect.runPromise(TestProvider.make())

// oxlint-disable-next-line ren/no-comments -- A build of the "built" provider waits until the test opens the gate of its label; a label that starts with "broken" fails.
const started = await Effect.runPromise(Queue.unbounded<string>())
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
    build: (config) =>
      Effect.gen(function* () {
        yield* Queue.offer(started, config.label)
        yield* Deferred.await(gate(config.label))
        if (config.label.startsWith("broken"))
          return yield* new MachineProvider.Failed({ message: `${config.label} does not build` })
        return `image-${config.label}`
      }),
  }),
)

const brains = [
  Effect.map(TestProvider.make({ canColocate: true }), (each) => each.provider),
  Effect.map(TestProvider.make({ id: "remote-only" }), (each) => each.provider),
] as const

const key = await Effect.runPromise(Signature.generate("environments"))

const it = testEffect(
  Layer.mergeAll(
    EnvironmentTemplates.layer,
    Environments.layer.pipe(Layer.provide(Signer.layerLocal)),
    Space.layer,
    SpaceProvisioning.layer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        EnvironmentProvider.layer([Effect.succeed(probe.provider), Effect.succeed(built.provider)]),
        BrainProvider.layer(brains),
        DurableRunner.layerMemory,
      ),
    ),
    Layer.provideMerge(Layer.mergeAll(Access.layer, EgressControl.layerNone)),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
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
  provider: EnvironmentProvider.ID.make("test"),
  config: { label: "python" },
  sessionsPerEnvironment: 2,
  networking: { type: "unrestricted" },
} satisfies EnvironmentTemplate.CreateInput

describe("EnvironmentTemplates", () => {
  it.live("an admin makes an org environment template; the provider checks the config and keeps its own form", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
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
      const templates = yield* EnvironmentTemplates.Service
      const setup = yield* team()
      const unknown = yield* templates
        .create(setup.admin, { ...input, provider: EnvironmentProvider.ID.make("e2b") })
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
      const templates = yield* EnvironmentTemplates.Service
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
    "a member of a space picks an organization's template as its remote hand, or none (space settings rules 1, 5)",
    () =>
      Effect.gen(function* () {
        const templates = yield* EnvironmentTemplates.Service
        const spaces = yield* Space.Service
        const setup = yield* team()
        const grace = yield* user(setup.organizationId)
        const made = yield* templates.create(setup.admin, input)
        expect(setup.space.hand).toEqual({ placement: "colocated", environmentTemplateId: null })
        const remote = { placement: "remote", environmentTemplateId: made.id } as const
        expect((yield* spaces.update(grace, setup.space.id, { hand: remote }).pipe(Effect.flip))._tag).toBe(
          "Primitive.NotFound",
        )
        expect((yield* spaces.update(setup.ada, setup.space.id, { hand: remote })).hand).toEqual(remote)
        expect((yield* spaces.update(setup.ada, setup.space.id, { hand: { placement: "none" } })).hand).toEqual({
          placement: "none",
        })
        const foreign = yield* templates.create((yield* team()).admin, input)
        expect(
          yield* spaces
            .update(setup.ada, setup.space.id, { hand: { placement: "remote", environmentTemplateId: foreign.id } })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Primitive.Invalid", field: "hand" })
      }),
  )

  it.live(
    "co-located needs a brain provider that can co-locate and a template of that provider; a brain provider change that breaks it is refused (EN3, EN24, chaos row 28)",
    () =>
      Effect.gen(function* () {
        const templates = yield* EnvironmentTemplates.Service
        const spaces = yield* Space.Service
        const setup = yield* team()
        const made = yield* templates.create(setup.admin, input)
        const colocated = { placement: "colocated", environmentTemplateId: made.id } as const
        expect((yield* spaces.update(setup.ada, setup.space.id, { hand: colocated })).hand).toEqual(colocated)
        expect(
          yield* spaces.update(setup.ada, setup.space.id, { brainProvider: "remote-only" }).pipe(Effect.flip),
        ).toMatchObject({ _tag: "Primitive.Invalid", field: "brainProvider" })
        const moved = yield* spaces.update(setup.ada, setup.space.id, {
          brainProvider: "remote-only",
          hand: { placement: "remote", environmentTemplateId: made.id },
        })
        expect(moved.brainProvider).toBe("remote-only")
        expect(
          yield* spaces
            .update(setup.ada, setup.space.id, { hand: { placement: "colocated", environmentTemplateId: null } })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Primitive.Invalid", field: "hand" })
        yield* spaces.update(setup.ada, setup.space.id, {
          brainProvider: null,
          hand: { placement: "colocated", environmentTemplateId: null },
        })
        const other = yield* Seed.environmentTemplate(setup.organizationId, { provider: "other" })
        expect(
          yield* spaces
            .update(setup.ada, setup.space.id, { hand: { placement: "colocated", environmentTemplateId: other } })
            .pipe(Effect.flip),
        ).toMatchObject({ _tag: "Primitive.Invalid", field: "hand" })
      }),
  )

  it.live("archiving a template that a space uses is refused, with the spaces (EN24, chaos row 22)", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
      const spaces = yield* Space.Service
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, input)
      yield* spaces.update(setup.ada, setup.space.id, { hand: { placement: "remote", environmentTemplateId: made.id } })
      expect(yield* templates.archive(setup.admin, made.id).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Conflict",
        message: "Spaces use this environment template: Team. Pick another hand for them first.",
      })
      yield* spaces.update(setup.ada, setup.space.id, { hand: { placement: "none" } })
      expect((yield* templates.archive(setup.admin, made.id)).archivedAt).not.toBeNull()
    }),
  )

  it.live("archiving hides an environment template, ends its sessions' access and destroys its environments", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
      const environments = yield* Environments.Service
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, input)
      const session = yield* Seed.subject(setup.organizationId, setup.space.id)
      yield* environments.bind(session, made.id)
      yield* environments.access(session, Option.none())
      const environmentId = (yield* Ref.get(probe.provisions)).at(-1)
      const archived = yield* templates.archive(setup.admin, made.id)
      expect(archived.archivedAt).not.toBeNull()
      expect(yield* templates.archive(setup.admin, made.id)).toEqual(archived)
      expect((yield* templates.get(setup.admin, made.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      expect((yield* environments.access(session, Option.none()).pipe(Effect.flip))._tag).toBe("Environments.NotFound")
      expect((yield* Ref.get(probe.destroyed)).at(-1)).toBe(environmentId)
    }),
  )

  it.live("lists each provider with a JSON Schema of its config, for the form", () =>
    Effect.gen(function* () {
      const registry = yield* EnvironmentProvider.Registry
      expect(registry.providers.map((provider) => provider.info).slice(0, 1)).toEqual([
        {
          id: EnvironmentProvider.ID.make("test"),
          title: "Test",
          description: "Environments that live in the test’s memory.",
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
    provider: EnvironmentProvider.ID.make("built"),
    config: { label },
  })

  const settled = (id: EnvironmentTemplate.ID, actor: Actor.Info) =>
    Effect.flatMap(EnvironmentTemplates.Service, (templates) => templates.get(actor, id)).pipe(
      Effect.repeat({
        until: (template) => template.buildStatus === "ready" || template.buildStatus === "failed",
        schedule: Schedule.spaced("20 millis"),
      }),
    )

  it.live("a save during a build waits for it, and the newest config builds next (EN30, chaos row 18)", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
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

  it.live("save A, then B, then A during A's build: the image is A (EN30, chaos row 19)", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
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

  it.live("a failed build keeps the last image and shows its error; a space cannot pick a template never built", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
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
      })
      yield* Deferred.succeed(gate(broken), undefined)
      expect(yield* settled(made.id, setup.admin)).toMatchObject({
        buildStatus: "failed",
        image: null,
        buildError: `${broken} does not build`,
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

  it.live("limited networking needs a provider that can limit hosts (networking rule 2)", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
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

  it.live("at start, Ren builds again a template left queued without a build (templates rule 3)", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const setup = yield* team()
      const label = `left-${crypto.randomUUID()}`
      const id = EnvironmentTemplate.ID.create()
      yield* database.db.insert(Database.Schema.environment_template).values({
        id,
        organization_id: setup.organizationId,
        name: "Left",
        provider: EnvironmentProvider.ID.make("built"),
        config: { label },
        sessions_per_environment: 8,
        build_status: "queued",
        config_version: 3,
      })
      yield* Deferred.succeed(gate(label), undefined)
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(Layer.fresh(EnvironmentTemplates.layer))
          expect(yield* Queue.take(started)).toBe(label)
          expect(yield* settled(id, setup.admin)).toMatchObject({ buildStatus: "ready", image: `image-${label}` })
        }),
      )
    }),
  )
})
