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
import { SpaceProvisioning } from "../src/space/provisioning.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/hand-provider.js"
import { Seed } from "./lib/seed.js"

const probe = await Effect.runPromise(TestProvider.make())

const key = await Effect.runPromise(Signature.generate("environments"))

const it = testEffect(
  Layer.mergeAll(Environments.layer, Hands.layer, Space.layer, SpaceProvisioning.layer).pipe(
    Layer.provideMerge(HandProvider.layer([Effect.succeed(probe.provider)])),
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
  const space = yield* spaces.create(ada, { name: "Team" })
  return { organizationId, ada, space }
})

const input = { name: "Python", provider: "test", config: { label: "python" }, sessionsPerHand: 2 }

describe("Environments", () => {
  it.live("a member makes an environment in their space; the provider checks the config and keeps its own form", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const setup = yield* team()
      const made = yield* environments.create(setup.ada, {
        ...input,
        spaceId: setup.space.id,
        config: { label: "python", extra: "dropped" },
      })
      expect(made).toMatchObject({
        spaceId: setup.space.id,
        name: "Python",
        provider: "test",
        config: { label: "python" },
        sessionsPerHand: 2,
        canUpdate: true,
        canArchive: true,
        archivedAt: null,
      })
      expect(yield* environments.get(setup.ada, made.id)).toEqual(made)
      expect((yield* environments.list(setup.ada, { ...page, spaceId: setup.space.id })).items).toEqual([made])
    }),
  )

  it.live("an unknown provider or a config the provider refuses is Invalid, and names the field", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const setup = yield* team()
      const unknown = yield* environments
        .create(setup.ada, { ...input, spaceId: setup.space.id, provider: "e2b" })
        .pipe(Effect.flip)
      expect(unknown).toMatchObject({ _tag: "Primitive.Invalid", field: "provider" })
      const refused = yield* environments
        .create(setup.ada, { ...input, spaceId: setup.space.id, config: { label: "" } })
        .pipe(Effect.flip)
      expect(refused).toMatchObject({ _tag: "Primitive.Invalid", field: "config" })
      const made = yield* environments.create(setup.ada, { ...input, spaceId: setup.space.id })
      const update = yield* environments.update(setup.ada, made.id, { config: { label: 3 } }).pipe(Effect.flip)
      expect(update).toMatchObject({ _tag: "Primitive.Invalid", field: "config" })
      expect((yield* environments.update(setup.ada, made.id, { config: { label: "new" } })).config).toEqual({
        label: "new",
      })
    }),
  )

  it.live("someone outside the space cannot see or make its environments; an admin can, without joining", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const setup = yield* team()
      const grace = yield* user(setup.organizationId)
      const admin = yield* user(setup.organizationId, "admin")
      const made = yield* environments.create(setup.ada, { ...input, spaceId: setup.space.id })
      expect((yield* environments.get(grace, made.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      expect((yield* environments.list(grace, page)).items).toEqual([])
      expect((yield* environments.create(grace, { ...input, spaceId: setup.space.id }).pipe(Effect.flip))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* environments.get(admin, made.id)).canUpdate).toBe(true)
      expect((yield* environments.list(yield* user(yield* Seed.organization()), page)).items).toEqual([])
    }),
  )

  it.live("archiving hides an environment, ends its sessions' access and destroys its hands", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      const hands = yield* Hands.Service
      const setup = yield* team()
      const made = yield* environments.create(setup.ada, { ...input, spaceId: setup.space.id })
      const session = { brainId: Session.ID.create(), organizationId: setup.organizationId }
      yield* hands.bind(session, made.id)
      yield* hands.access(session)
      const handId = (yield* Ref.get(probe.provisions)).at(-1)
      const archived = yield* environments.archive(setup.ada, made.id)
      expect(archived.archivedAt).not.toBeNull()
      expect(yield* environments.archive(setup.ada, made.id)).toEqual(archived)
      expect((yield* environments.get(setup.ada, made.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
      expect((yield* hands.access(session).pipe(Effect.flip))._tag).toBe("Hands.NotFound")
      expect((yield* Ref.get(probe.destroyed)).at(-1)).toBe(handId)
    }),
  )

  it.live("lists each provider with a JSON Schema of its config, for the form", () =>
    Effect.gen(function* () {
      const environments = yield* Environments.Service
      expect(yield* environments.providers).toEqual([
        {
          id: "test",
          title: "Test",
          description: "Hands that live in the test’s memory.",
          capabilities: ["files", "processes"],
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
