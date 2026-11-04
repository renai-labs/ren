import { describe, expect } from "bun:test"
import { Signature } from "@ren/schema/signature"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { ConfigProvider, Effect, Layer, Option, Ref, Schema } from "effect"
import { Access } from "../src/access.js"
import { EgressControl } from "../src/egress-control.js"
import { EnvironmentTemplates } from "../src/environment-templates.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { Space } from "../src/space.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Seed } from "./lib/seed.js"
import { Signer } from "../src/signer.js"

const probe = await Effect.runPromise(TestProvider.make({ canLimitHosts: true }))

const fixed = await Effect.runPromise(TestProvider.make({ id: "fixed" }))

const key = await Effect.runPromise(Signature.generate("environments"))

const it = testEffect(
  Layer.mergeAll(
    EnvironmentTemplates.layer,
    Environments.layer.pipe(Layer.provide(Signer.layerLocal)),
    Space.layer,
    SpaceProvisioning.layer,
  ).pipe(
    Layer.provideMerge(EnvironmentProvider.layer([Effect.succeed(probe.provider), Effect.succeed(fixed.provider)])),
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
} as const

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
        networking: { type: "unrestricted" },
        buildStatus: "ready",
        archivedAt: null,
      })
      expect(yield* templates.get(setup.admin, made.id)).toEqual(made)
      expect((yield* templates.list(setup.admin, page)).items).toEqual([made])
      const networking = {
        type: "limited",
        allowPackageManagers: true,
        allowMcpServers: false,
        allowedHosts: ["api.example.com", "*.example.org"],
      } as const
      expect((yield* templates.update(setup.admin, made.id, { networking })).networking).toEqual(networking)
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

  it.live("limited networking is Invalid for a provider that cannot limit hosts (environments test 10)", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
      const setup = yield* team()
      const networking = {
        type: "limited",
        allowPackageManagers: false,
        allowMcpServers: false,
        allowedHosts: [],
      } as const
      const provider = EnvironmentProvider.ID.make("fixed")
      expect(yield* templates.create(setup.admin, { ...input, provider, networking }).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Invalid",
        field: "networking",
      })
      const made = yield* templates.create(setup.admin, { ...input, provider })
      expect(yield* templates.update(setup.admin, made.id, { networking }).pipe(Effect.flip)).toMatchObject({
        _tag: "Primitive.Invalid",
        field: "networking",
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

  it.live("a member of a space chooses an org environment template for it; a person outside the space cannot", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
      const spaces = yield* Space.Service
      const environments = yield* Environments.Service
      const setup = yield* team()
      const grace = yield* user(setup.organizationId)
      const made = yield* templates.create(setup.admin, input)
      const environment = { kind: "template", environmentTemplateId: made.id } as const
      expect(setup.space.environment).toEqual({ kind: "default" })
      expect((yield* spaces.update(grace, setup.space.id, { environment }).pipe(Effect.flip))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* spaces.update(setup.ada, setup.space.id, { environment })).environment).toEqual(environment)
      expect((yield* spaces.get(setup.ada, setup.space.id)).environment).toEqual(environment)
      const session = yield* Seed.subject(setup.organizationId, setup.space.id)
      yield* environments.bind(session, made.id)
      expect((yield* environments.access(session, Option.none())).generation).toBe(1)
      expect((yield* spaces.update(setup.ada, setup.space.id, { environment: { kind: "none" } })).environment).toEqual({
        kind: "none",
      })
    }),
  )

  it.live("a space cannot choose another organization's environment template or an archived one", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
      const spaces = yield* Space.Service
      const setup = yield* team()
      const elsewhere = yield* team()
      const foreign = yield* templates.create(elsewhere.admin, input)
      const archived = yield* templates.create(setup.admin, input)
      yield* templates.archive(setup.admin, archived.id)
      const choose = (environmentTemplateId: typeof foreign.id) =>
        spaces
          .update(setup.ada, setup.space.id, { environment: { kind: "template", environmentTemplateId } })
          .pipe(Effect.flip)
      expect(yield* choose(foreign.id)).toMatchObject({ _tag: "Primitive.Invalid", field: "environment" })
      expect(yield* choose(archived.id)).toMatchObject({ _tag: "Primitive.Invalid", field: "environment" })
      expect((yield* spaces.get(setup.ada, setup.space.id)).environment).toEqual({ kind: "default" })
    }),
  )

  it.live("archiving hides an environment template, ends its sessions' access and destroys its environments", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
      const spaces = yield* Space.Service
      const environments = yield* Environments.Service
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, input)
      yield* spaces.update(setup.ada, setup.space.id, {
        environment: { kind: "template", environmentTemplateId: made.id },
      })
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
      expect(registry.providers.at(0)?.info).toEqual({
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
      })
    }),
  )
})
