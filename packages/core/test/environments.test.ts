import { describe, expect } from "bun:test"
import { EnvironmentToken } from "@ren/hand-api/environment-token"
import { Signature } from "@ren/hand-api/signature"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Cause, ConfigProvider, Context, DateTime, Effect, Exit, Layer, Option, Schema } from "effect"
import { Environments } from "../src/environments.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const keys = await Effect.runPromise(Effect.all([Signature.generate("new"), Signature.generate("old")]))

const environmentId = Environment.ID.create()

const sandboxes = [
  { id: "sandbox-a", url: "http://127.0.0.1:7001", generation: 1 },
  { id: "sandbox-b", url: "http://127.0.0.1:7002", generation: 3 },
]

const configOf = (overrides: Readonly<Record<string, string>> = {}) => ({
  ENVIRONMENTS: JSON.stringify([{ id: environmentId, capacity: 2, sandboxes }]),
  ENVIRONMENT_KEYS: JSON.stringify(
    keys.map((pair) => ({
      id: pair.privateKey.id,
      key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(pair.privateKey.key),
    })),
  ),
  ...overrides,
})

const environmentsWith = (config: Readonly<Record<string, string>> = configOf()) =>
  Layer.build(
    Layer.fresh(Environments.layer).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config)))),
  ).pipe(Effect.map((context) => Context.get(context, Environments.Service)))

const subjectIn = Effect.fnUntraced(function* () {
  return { brainId: Session.ID.create(), organizationId: yield* Seed.organization() }
})

describe("Environments", () => {
  it.live(
    "gives a bound session its folder, all capabilities by default, its sandbox and a token for its brain, signed with the first key",
    () =>
      Effect.gen(function* () {
        const environments = yield* environmentsWith()
        const subject = yield* subjectIn()
        const binding = yield* environments.bind(subject, environmentId)
        expect(binding).toEqual({
          location: {
            environmentId,
            directory: `/workspace/${subject.brainId}`,
            capabilities: ["files", "processes"],
          },
          isNew: true,
        })
        expect(yield* environments.find(subject)).toEqual(Option.some(binding.location))
        expect(yield* environments.find({ ...subject, organizationId: yield* Seed.organization() })).toEqual(
          Option.none(),
        )
        const before = Date.now()
        const access = yield* environments.access(subject)
        expect([access.environmentId, access.directory, access.url, access.generation]).toEqual([
          environmentId,
          `/workspace/${subject.brainId}`,
          "http://127.0.0.1:7001",
          1,
        ])
        const claims = yield* EnvironmentToken.verify([keys[0].publicKey], access.token)
        expect(Option.map(claims, (found) => [found.kid, found.env, found.brain])).toEqual(
          Option.some(["new", environmentId, Brain.ofSession(subject.brainId)]),
        )
        expect(Option.map(claims, (found) => found.exp * 1000)).toEqual(
          Option.some(DateTime.toEpochMillis(access.expiresAt)),
        )
        expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeGreaterThan(14 * 60_000)
        expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeLessThanOrEqual(15 * 60_000)
        expect(yield* EnvironmentToken.verify([keys[1].publicKey], access.token)).toEqual(Option.none())
      }),
  )

  it.live("a configured token lifetime is the access's lifetime", () =>
    Effect.gen(function* () {
      const environments = yield* environmentsWith(configOf({ ENVIRONMENT_TOKEN_LIFETIME: "20 seconds" }))
      const subject = yield* subjectIn()
      yield* environments.bind(subject, environmentId)
      const before = Date.now()
      const access = yield* environments.access(subject)
      expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeLessThanOrEqual(20_000)
      expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeGreaterThan(18_000)
    }),
  )

  it.live("a session keeps its environment: the same one binds again, another is not supported yet", () =>
    Effect.gen(function* () {
      const other = Environment.ID.create()
      const environments = yield* environmentsWith(
        configOf({
          ENVIRONMENTS: JSON.stringify([
            { id: environmentId, capacity: 2, sandboxes },
            { id: other, capacity: 2, sandboxes },
          ]),
        }),
      )
      const subject = yield* subjectIn()
      yield* environments.bind(subject, environmentId)
      expect((yield* environments.bind(subject, environmentId)).isNew).toBe(false)
      const changed = yield* environments.bind(subject, other).pipe(Effect.flip)
      expect([changed._tag, changed.message]).toEqual([
        "Environments.Changed",
        `Session ${subject.brainId} cannot change its environment: not supported yet`,
      ])
      const stranger = { brainId: subject.brainId, organizationId: yield* Seed.organization() }
      expect((yield* environments.bind(stranger, environmentId).pipe(Effect.flip))._tag).toBe("Environments.Changed")
      expect((yield* environments.access(stranger).pipe(Effect.flip))._tag).toBe("Environments.NotFound")
    }),
  )

  it.live("a session with no binding, an environment Ren does not have, or one Ren no longer has is NotFound", () =>
    Effect.gen(function* () {
      const environments = yield* environmentsWith()
      const subject = yield* subjectIn()
      expect((yield* environments.access(subject).pipe(Effect.flip))._tag).toBe("Environments.NotFound")
      expect((yield* environments.bind(subject, Environment.ID.create()).pipe(Effect.flip))._tag).toBe(
        "Environments.NotFound",
      )
      yield* environments.bind(subject, environmentId)
      const restarted = yield* environmentsWith(configOf({ ENVIRONMENTS: "[]" }))
      const removed = yield* restarted.access(subject).pipe(Effect.flip)
      expect([removed._tag, removed.message]).toEqual([
        "Environments.NotFound",
        `Environment ${environmentId} is not in Ren’s configuration`,
      ])
    }),
  )

  it.live(
    "puts up to N sessions on a sandbox, the next on the next sandbox, keeps them there, and refuses when all are full",
    () =>
      Effect.gen(function* () {
        const environments = yield* environmentsWith()
        const subjects = yield* Effect.forEach(Array.from({ length: 4 }), () => subjectIn())
        const last = yield* subjectIn()
        yield* Effect.forEach([...subjects, last], (subject) => environments.bind(subject, environmentId), {
          discard: true,
        })
        const urls = yield* Effect.forEach(subjects, (subject) => environments.access(subject), {
          concurrency: "unbounded",
        }).pipe(Effect.map((accesses) => accesses.map((access) => access.url).toSorted()))
        expect(urls).toEqual([
          "http://127.0.0.1:7001",
          "http://127.0.0.1:7001",
          "http://127.0.0.1:7002",
          "http://127.0.0.1:7002",
        ])
        const full = yield* environments.access(last).pipe(Effect.flip)
        expect([full._tag, full.message]).toEqual([
          "Environments.Unavailable",
          `Every sandbox of environment ${environmentId} is full; Ren makes no new sandbox yet`,
        ])
        const restarted = yield* environmentsWith()
        const again = yield* Effect.forEach(subjects, (subject) => restarted.access(subject))
        expect(again.map((access) => access.url).toSorted()).toEqual(urls)
      }),
  )

  it.live("gives a replaced sandbox's new address and generation to the sessions on it", () =>
    Effect.gen(function* () {
      const subject = yield* subjectIn()
      const environments = yield* environmentsWith()
      yield* environments.bind(subject, environmentId)
      expect((yield* environments.access(subject)).url).toBe("http://127.0.0.1:7001")
      const replaced = yield* environmentsWith(
        configOf({
          ENVIRONMENTS: JSON.stringify([
            {
              id: environmentId,
              capacity: 2,
              sandboxes: [{ ...sandboxes[0], url: "http://127.0.0.1:7009", generation: 2 }, sandboxes[1]],
            },
          ]),
        }),
      )
      const access = yield* replaced.access(subject)
      expect([access.url, access.generation]).toEqual(["http://127.0.0.1:7009", 2])
    }),
  )

  it.live("50 accesses at once each get a valid token", () =>
    Effect.gen(function* () {
      const environments = yield* environmentsWith()
      const subject = yield* subjectIn()
      yield* environments.bind(subject, environmentId)
      const accesses = yield* Effect.all(
        Array.from({ length: 50 }, () => environments.access(subject)),
        { concurrency: "unbounded" },
      )
      const verified = yield* Effect.forEach(accesses, (access) =>
        EnvironmentToken.verify([keys[0].publicKey], access.token),
      )
      expect(verified.filter(Option.isSome).length).toBe(50)
    }),
  )

  it.live("refuses to start with a configuration that is not valid, and starts with an empty list", () =>
    Effect.gen(function* () {
      const failures = yield* Effect.forEach(
        [
          configOf({ ENVIRONMENTS: "not json" }),
          configOf({
            ENVIRONMENTS: JSON.stringify([
              { id: environmentId, capacity: 1, sandboxes },
              { id: environmentId, capacity: 1, sandboxes },
            ]),
          }),
          configOf({
            ENVIRONMENTS: JSON.stringify([
              { id: environmentId, capacity: 1, sandboxes: [{ id: "a", url: "not a url", generation: 1 }] },
            ]),
          }),
          { ENVIRONMENTS: configOf().ENVIRONMENTS },
        ],
        (config) => environmentsWith(config).pipe(Effect.exit),
      )
      expect(failures.every(Exit.isFailure)).toBe(true)
      expect(failures.map((exit) => (Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""))).toEqual([
        expect.stringContaining("ENVIRONMENTS"),
        expect.stringContaining("environment ids must be unique"),
        expect.stringContaining("a sandbox url must be an absolute URL"),
        expect.stringContaining("ENVIRONMENT_KEYS has no signing key"),
      ])
      const empty = yield* environmentsWith({})
      expect((yield* empty.access(yield* subjectIn()).pipe(Effect.flip))._tag).toBe("Environments.NotFound")
    }),
  )
})
