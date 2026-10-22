import { describe, expect } from "bun:test"
import { Signature } from "@ren/schema/signature"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { ConfigProvider, Effect, Layer, Option, Ref, Schema } from "effect"
import { Access } from "../src/access.js"
import { EnvironmentTemplates } from "../src/environment-templates.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { Space } from "../src/space.js"
import { SpaceEnvironmentTemplate } from "../src/space/environment-template.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Seed } from "./lib/seed.js"

const probe = await Effect.runPromise(TestProvider.make())

const key = await Effect.runPromise(Signature.generate("environments"))

const it = testEffect(
  Layer.mergeAll(
    EnvironmentTemplates.layer,
    SpaceEnvironmentTemplate.layer,
    Environments.layer,
    Space.layer,
    SpaceProvisioning.layer,
  ).pipe(
    Layer.provideMerge(EnvironmentProvider.layer([Effect.succeed(probe.provider)])),
    Layer.provideMerge(Access.layer),
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
}

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
    "a member of a space links an org environment template to it; archiving the link ends its sessions' access",
    () =>
      Effect.gen(function* () {
        const templates = yield* EnvironmentTemplates.Service
        const links = yield* SpaceEnvironmentTemplate.Service
        const environments = yield* Environments.Service
        const setup = yield* team()
        const grace = yield* user(setup.organizationId)
        const made = yield* templates.create(setup.admin, input)
        const link = { spaceId: setup.space.id, environmentTemplateId: made.id }
        expect((yield* links.create(grace, link).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        const linked = yield* links.create(setup.ada, link)
        expect((yield* links.create(setup.ada, link).pipe(Effect.flip))._tag).toBe("Primitive.Conflict")
        expect((yield* links.list(setup.ada, { ...page, spaceId: setup.space.id })).items).toEqual([linked])
        expect((yield* links.list(grace, { ...page, spaceId: setup.space.id })).items).toEqual([])
        const session = yield* Seed.subject(setup.organizationId, setup.space.id)
        yield* environments.bind(session, made.id)
        yield* environments.access(session, Option.none())
        expect((yield* links.archive(setup.ada, linked.id)).archivedAt).not.toBeNull()
        expect((yield* links.list(setup.ada, { ...page, spaceId: setup.space.id })).items).toEqual([])
        expect((yield* environments.access(session, Option.none()).pipe(Effect.flip))._tag).toBe("Environments.NotFound")
      }),
  )

  it.live("a space cannot link another organization's environment template", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
      const links = yield* SpaceEnvironmentTemplate.Service
      const setup = yield* team()
      const elsewhere = yield* team()
      const foreign = yield* templates.create(elsewhere.admin, input)
      expect(
        (yield* links
          .create(setup.admin, { spaceId: setup.space.id, environmentTemplateId: foreign.id })
          .pipe(Effect.flip))._tag,
      ).toBe("Primitive.NotFound")
      expect(
        (yield* links
          .create(elsewhere.admin, { spaceId: setup.space.id, environmentTemplateId: foreign.id })
          .pipe(Effect.flip))._tag,
      ).toBe("Primitive.NotFound")
    }),
  )

  it.live("archiving hides an environment template, ends its sessions' access and destroys its environments", () =>
    Effect.gen(function* () {
      const templates = yield* EnvironmentTemplates.Service
      const links = yield* SpaceEnvironmentTemplate.Service
      const environments = yield* Environments.Service
      const setup = yield* team()
      const made = yield* templates.create(setup.admin, input)
      yield* links.create(setup.ada, { spaceId: setup.space.id, environmentTemplateId: made.id })
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
      expect(registry.providers.map((provider) => provider.info)).toEqual([
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
})
