import { describe, expect } from "bun:test"
import { Signature } from "@ren/hand-api/signature"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Effect, Layer, Ref, Schema } from "effect"
import { Access } from "../src/access.js"
import { Environments } from "../src/environments.js"
import { HandProvider } from "../src/hand-provider.js"
import { Hands } from "../src/hands.js"
import { Space } from "../src/space.js"
import { SpaceEnvironment } from "../src/space/environment.js"
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/hand-provider.js"
import { Seed } from "./lib/seed.js"

const probe = await Effect.runPromise(TestProvider.make())

const key = await Effect.runPromise(Signature.generate("environments"))

const it = testEffect(
  Layer.mergeAll(Environments.layer, SpaceEnvironment.layer, Hands.layer, Space.layer, SpaceProvisioning.layer).pipe(
    Layer.provideMerge(HandProvider.layer([Effect.succeed(probe.provider)])),
    Layer.provideMerge(Access.layer),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          HAND_KEYS: JSON.stringify([
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
  provider: HandProvider.ID.make("test"),
  config: { label: "python" },
  sessionsPerHand: 2,
}

describe("Environments", () => {
  it.live("an admin makes an org environment; the provider checks the config and keeps its own form", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const setup = yield* team()
      const made = yield* environments.create(setup.admin, { ...input, config: { label: "python", extra: "dropped" } })
      expect(made).toMatchObject({
        name: "Python",
        provider: "test",
        config: { label: "python" },
        sessionsPerHand: 2,
        archivedAt: null,
      })
      expect(yield* environments.get(setup.admin, made.id)).toEqual(made)
      expect((yield* environments.list(setup.admin, page)).items).toEqual([made])
    }),
  )

  it.live("an unknown provider or a config the provider refuses is Invalid, and names the field", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const setup = yield* team()
      const unknown = yield* environments
        .create(setup.admin, { ...input, provider: HandProvider.ID.make("e2b") })
        .pipe(Effect.flip)
      expect(unknown).toMatchObject({ _tag: "Primitive.Invalid", field: "provider" })
      const refused = yield* environments.create(setup.admin, { ...input, config: { label: "" } }).pipe(Effect.flip)
      expect(refused).toMatchObject({ _tag: "Primitive.Invalid", field: "config" })
      const made = yield* environments.create(setup.admin, input)
      const update = yield* environments.update(setup.admin, made.id, { config: { label: 3 } }).pipe(Effect.flip)
      expect(update).toMatchObject({ _tag: "Primitive.Invalid", field: "config" })
      expect((yield* environments.update(setup.admin, made.id, { config: { label: "new" } })).config).toEqual({
        label: "new",
      })
    }),
  )

  it.live("every member sees the org's environments; only admins change them; another org sees none", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const setup = yield* team()
      const made = yield* environments.create(setup.admin, input)
      expect(yield* environments.get(setup.ada, made.id)).toEqual(made)
      expect((yield* environments.create(setup.ada, input).pipe(Effect.flip))._tag).toBe("Primitive.Forbidden")
      expect((yield* environments.update(setup.ada, made.id, { name: "Mine" }).pipe(Effect.flip))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* environments.archive(setup.ada, made.id).pipe(Effect.flip))._tag).toBe("Primitive.Forbidden")
      expect((yield* environments.list(yield* user(yield* Seed.organization()), page)).items).toEqual([])
    }),
  )

  it.live("a member of a space links an org environment to it; archiving the link ends its sessions' access", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const links = yield* SpaceEnvironment.Service
      const hands = yield* Hands.Service
      const setup = yield* team()
      const grace = yield* user(setup.organizationId)
      const made = yield* environments.create(setup.admin, input)
      const link = { spaceId: setup.space.id, environmentId: made.id }
      expect((yield* links.create(grace, link).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      const linked = yield* links.create(setup.ada, link)
      expect((yield* links.create(setup.ada, link).pipe(Effect.flip))._tag).toBe("Primitive.Conflict")
      expect((yield* links.list(setup.ada, { ...page, spaceId: setup.space.id })).items).toEqual([linked])
      expect((yield* links.list(grace, { ...page, spaceId: setup.space.id })).items).toEqual([])
      const session = { sessionId: Session.ID.create(), organizationId: setup.organizationId, spaceId: setup.space.id }
      yield* hands.bind(session, made.id)
      yield* hands.access(session)
      expect((yield* links.archive(setup.ada, linked.id)).archivedAt).not.toBeNull()
      expect((yield* links.list(setup.ada, { ...page, spaceId: setup.space.id })).items).toEqual([])
      expect((yield* hands.access(session).pipe(Effect.flip))._tag).toBe("Hands.NotFound")
    }),
  )

  it.live("a space cannot link another organization's environment", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const links = yield* SpaceEnvironment.Service
      const setup = yield* team()
      const elsewhere = yield* team()
      const foreign = yield* environments.create(elsewhere.admin, input)
      expect(
        (yield* links.create(setup.admin, { spaceId: setup.space.id, environmentId: foreign.id }).pipe(Effect.flip))
          ._tag,
      ).toBe("Primitive.NotFound")
      expect(
        (yield* links.create(elsewhere.admin, { spaceId: setup.space.id, environmentId: foreign.id }).pipe(Effect.flip))
          ._tag,
      ).toBe("Primitive.NotFound")
    }),
  )

  it.live("archiving hides an environment, ends its sessions' access and destroys its hands", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const links = yield* SpaceEnvironment.Service
      const hands = yield* Hands.Service
      const setup = yield* team()
      const made = yield* environments.create(setup.admin, input)
      yield* links.create(setup.ada, { spaceId: setup.space.id, environmentId: made.id })
      const session = { sessionId: Session.ID.create(), organizationId: setup.organizationId, spaceId: setup.space.id }
      yield* hands.bind(session, made.id)
      yield* hands.access(session)
      const handId = (yield* Ref.get(probe.provisions)).at(-1)
      const archived = yield* environments.archive(setup.admin, made.id)
      expect(archived.archivedAt).not.toBeNull()
      expect(yield* environments.archive(setup.admin, made.id)).toEqual(archived)
      expect((yield* environments.get(setup.admin, made.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      expect((yield* hands.access(session).pipe(Effect.flip))._tag).toBe("Hands.NotFound")
      expect((yield* Ref.get(probe.destroyed)).at(-1)).toBe(handId)
    }),
  )

  it.live("lists each provider with a JSON Schema of its config, for the form", () =>
    Effect.gen(function* () {
      const registry = yield* HandProvider.Registry
      expect(registry.providers.map((provider) => provider.info)).toEqual([
        {
          id: HandProvider.ID.make("test"),
          title: "Test",
          description: "Hands that live in the test’s memory.",
          configSchema: {
            dialect: "draft-2020-12",
            schema: {
              type: "object",
              title: "Test",
              properties: {
                label: { type: "string", minLength: 1, title: "Label", description: "A name for the test hands." },
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
