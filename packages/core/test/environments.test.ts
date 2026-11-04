import { describe, expect } from "bun:test"
import { EnvironmentNetwork } from "../src/environment-network.js"
import { SandboxEgress } from "../src/sandbox-egress.js"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { Signature } from "@ren/schema/signature"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Session } from "@ren/schema/session"
import { eq, sql } from "drizzle-orm"
import { ConfigProvider, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Seed } from "./lib/seed.js"
import { Signer } from "../src/signer.js"

const it = testEffect(Testing.layer)

const keys = await Effect.runPromise(Effect.all([Signature.generate("new"), Signature.generate("old")]))

const signingKeys = JSON.stringify(
  keys.map((pair) => ({
    id: pair.privateKey.id,
    key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(pair.privateKey.key),
  })),
)

const environmentsWith = Effect.fnUntraced(function* (
  config: Readonly<Record<string, string>> = {},
  options: Parameters<typeof TestProvider.make>[0] = {},
) {
  const probe = yield* TestProvider.make(options)
  const context = yield* Layer.build(
    Layer.fresh(
      Environments.layer.pipe(
        Layer.provide([Signer.layerLocal, EnvironmentNetwork.layerNone, SandboxEgress.layerNone]),
      ),
    ).pipe(
      Layer.provide(EnvironmentProvider.layer([Effect.succeed(probe.provider)])),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ENVIRONMENT_KEYS: signingKeys, ...config }))),
    ),
  )
  return { environments: Context.get(context, Environments.Service), probe }
})

const subjectIn = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
  return yield* Seed.subject(organizationId, yield* Seed.team(organizationId))
})

const handOf = (session: { readonly sessionId: Session.ID }) =>
  Option.some({
    brainId: Brain.ofSession(session.sessionId),
    generation: 1,
    url: "http://hand.test",
    workspace: "/home/user/workspace",
    egress: true,
    canMount: true,
  })

const environmentsOf = Effect.fnUntraced(function* (environmentTemplateId: EnvironmentTemplate.ID) {
  const database = yield* Database.Service
  return yield* database.db
    .select({
      environmentId: Database.Schema.environment.id,
      sessions: sql<number>`(select count(*)::int from ${Database.Schema.session_environment} where ${Database.Schema.session_environment.environment_id} = ${Database.Schema.environment.id})`,
    })
    .from(Database.Schema.environment)
    .where(eq(Database.Schema.environment.environment_template_id, environmentTemplateId))
})

describe("Environments", () => {
  it.live("binds a session to its organization's environment template, with no environment yet", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
      const session = yield* subjectIn(organizationId)
      const binding = yield* subject.environments.bind(session, environmentTemplateId)
      expect(binding).toEqual({ directory: `/home/user/workspace/${session.sessionId}`, isNew: true })
      expect(yield* subject.environments.findDirectory(session, Option.none())).toEqual(Option.some(binding.directory))
      expect(
        yield* subject.environments.findDirectory(
          { ...session, organizationId: yield* Seed.organization() },
          Option.none(),
        ),
      ).toEqual(Option.none())
      expect(yield* Ref.get(subject.probe.provisions)).toEqual([])
    }),
  )

  it.live(
    "a start of a bound session keeps its row, and another organization's environment template is not found",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
        const foreign = yield* Seed.environmentTemplate(yield* Seed.organization())
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, environmentTemplateId)
        expect((yield* subject.environments.bind(session, environmentTemplateId)).isNew).toBe(false)
        const other = yield* Seed.environmentTemplate(organizationId)
        expect(yield* subject.environments.bind(session, other)).toEqual({
          directory: `/home/user/workspace/${session.sessionId}`,
          isNew: false,
        })
        expect(
          (yield* subject.environments.bind(yield* subjectIn(organizationId), foreign).pipe(Effect.flip))._tag,
        ).toBe("Environments.NotFound")
        expect(
          (yield* subject.environments.access(yield* subjectIn(organizationId), Option.none()).pipe(Effect.flip))._tag,
        ).toBe("Environments.NotFound")
      }),
  )

  it.live(
    "the first access makes an environment and a token for the session's brain, signed with the first key; the next reuses it",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, environmentTemplateId)
        const before = Date.now()
        const access = yield* subject.environments.access(session, Option.none())
        const again = yield* subject.environments.access(session, Option.none())
        const provisions = yield* Ref.get(subject.probe.provisions)
        expect(provisions.length).toBe(1)
        expect([access.directory, access.generation]).toEqual([`/home/user/workspace/${session.sessionId}`, 1])
        expect(again.url.href).toBe(access.url.href)
        const claims = yield* EnvironmentToken.verify([keys[0].publicKey], Redacted.value(access.token))
        expect(Option.map(claims, (found) => [found.kid, found.environment, found.brain])).toEqual(
          Option.some(["new", ...provisions, Brain.ofSession(session.sessionId)]),
        )
        expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeGreaterThan(14 * 60_000)
        expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeLessThanOrEqual(15 * 60_000)
      }),
  )

  it.live("the first access provisions an environment of the template's last ready image (environments test 1)", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId, { image: "ffmpeg:1" }))
      yield* subject.environments.access(session, Option.none())
      expect((yield* Ref.get(subject.probe.provisioned)).map((made) => made.image)).toEqual([Option.some("ffmpeg:1")])
    }),
  )

  it.live("an access names the folder that the environment's sessions share and the egress of its provider", () =>
    Effect.gen(function* () {
      const egressOf = Effect.fnUntraced(function* (egress: boolean) {
        const subject = yield* environmentsWith({}, { egress })
        const organizationId = yield* Seed.organization()
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
        const access = yield* subject.environments.access(session, Option.none())
        return [access.sharedDirectory, access.egress]
      })
      expect(yield* egressOf(false)).toEqual(["/home/user/workspace/.ren", false])
      expect(yield* egressOf(true)).toEqual(["/home/user/workspace/.ren", true])
    }),
  )

  it.live("a configured token lifetime is the access's lifetime", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith({ ENVIRONMENT_TOKEN_LIFETIME: "20 seconds" })
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
      const before = Date.now()
      const access = yield* subject.environments.access(session, Option.none())
      expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeLessThanOrEqual(20_000)
      expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeGreaterThan(18_000)
    }),
  )

  it.live("sessions that ask at once share environments, never more than sessionsPerEnvironment on one", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const environmentTemplateId = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 2 })
      const spaceId = yield* Seed.team(organizationId)
      const sessions = yield* Effect.all(Array.from({ length: 5 }, () => Seed.subject(organizationId, spaceId)))
      yield* Effect.forEach(sessions, (session) => subject.environments.bind(session, environmentTemplateId), {
        discard: true,
      })
      yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()), {
        concurrency: "unbounded",
      })
      const made = yield* environmentsOf(environmentTemplateId)
      expect(made.map((environment) => environment.sessions).toSorted((left, right) => left - right)).toEqual([1, 2, 2])
      expect((yield* Ref.get(subject.probe.provisions)).length).toBe(3)
    }),
  )

  it.live(
    "one template that two spaces chose never puts their sessions in one environment (private-spaces test 10)",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 4 })
        const shared = yield* subjectIn(organizationId)
        const otherSpace = yield* Seed.space(organizationId)
        yield* Seed.chooseEnvironment(otherSpace, { kind: "template", environmentTemplateId })
        const other = yield* Seed.subject(organizationId, otherSpace)
        yield* Effect.forEach([shared, other], (session) => subject.environments.bind(session, environmentTemplateId), {
          discard: true,
        })
        yield* Effect.forEach([shared, other], (session) => subject.environments.access(session, Option.none()), {
          discard: true,
        })
        expect((yield* environmentsOf(environmentTemplateId)).map((environment) => environment.sessions)).toEqual([
          1, 1,
        ])
      }),
  )

  it.live("an environment that is gone is replaced once; the sessions on it get the next generation", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
      const sessions = yield* Effect.all([subjectIn(organizationId), subjectIn(organizationId)])
      yield* Effect.forEach(sessions, (session) => subject.environments.bind(session, environmentTemplateId), {
        discard: true,
      })
      const first = yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()))
      const lost = (yield* Ref.get(subject.probe.provisions))[0]
      if (!lost) return yield* Effect.die(new Error("no environment was made"))
      yield* Ref.set(subject.probe.gone, new Set([lost]))
      const replaced = yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()))
      expect(replaced.map((access) => access.generation)).toEqual([2, 2])
      expect(replaced.at(0)?.url.href).not.toBe(first.at(0)?.url.href)
      expect(replaced.at(1)?.url.href).toBe(replaced.at(0)?.url.href)
      expect((yield* environmentsOf(environmentTemplateId)).length).toBe(1)
    }),
  )

  it.live("a provider that fails gives Unavailable, and the next access tries again", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
      yield* Ref.set(subject.probe.failing, true)
      const failed = yield* subject.environments.access(session, Option.none()).pipe(Effect.flip)
      expect([failed._tag, failed.message]).toEqual([
        "Environments.Unavailable",
        `The environment of session ${session.sessionId} is unavailable: the test provider fails`,
      ])
      yield* Ref.set(subject.probe.failing, false)
      expect((yield* subject.environments.access(session, Option.none())).generation).toBe(1)
    }),
  )

  it.live(
    "an archived environment template gives no access, and a provider this deployment lacks gives no binding",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, environmentTemplateId)
        yield* database.db
          .update(Database.Schema.environment_template)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.environment_template.id, environmentTemplateId))
        expect((yield* subject.environments.access(session, Option.none()).pipe(Effect.flip))._tag).toBe(
          "Environments.NotFound",
        )
        const elsewhere = yield* Seed.environmentTemplate(organizationId, { provider: "e2b" })
        expect(
          (yield* subject.environments.bind(yield* subjectIn(organizationId), elsewhere).pipe(Effect.flip))._tag,
        ).toBe("Environments.NotFound")
      }),
  )

  it.live("an idle chat moves from template A to B at its next access, and the environment of A is destroyed", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const first = yield* Seed.environmentTemplate(organizationId)
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, first)
      const before = yield* subject.environments.access(session, Option.none())
      yield* subject.environments.release(session)
      yield* Seed.environmentTemplate(organizationId)
      const after = yield* subject.environments.access(session, Option.none())
      expect(after.url.href).not.toBe(before.url.href)
      expect(after.generation).toBe(2)
      expect(yield* Ref.get(subject.probe.destroyed)).toEqual((yield* Ref.get(subject.probe.provisions)).slice(0, 1))
      expect(yield* environmentsOf(first)).toEqual([])
    }),
  )

  it.live("an outdated environment with a busy seat is kept for every chat on it until the last seat is idle", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const first = yield* Seed.environmentTemplate(organizationId)
      const spaceId = yield* Seed.team(organizationId)
      const busy = yield* Seed.subject(organizationId, spaceId)
      const idle = yield* Seed.subject(organizationId, spaceId)
      yield* Effect.forEach([busy, idle], (session) => subject.environments.bind(session, first), { discard: true })
      const before = yield* Effect.forEach([busy, idle], (session) =>
        subject.environments.access(session, Option.none()),
      )
      yield* subject.environments.release(idle)
      yield* Seed.environmentTemplate(organizationId)
      expect(before.at(0)?.url.href).toBe((yield* subject.environments.access(idle, Option.none())).url.href)
      expect(yield* Ref.get(subject.probe.destroyed)).toEqual([])
      yield* Effect.forEach([busy, idle], (session) => subject.environments.release(session), { discard: true })
      const moved = yield* subject.environments.access(idle, Option.none())
      expect(before.at(0)?.url.href).not.toBe(moved.url.href)
      expect((yield* subject.environments.access(busy, Option.none())).url.href).toBe(moved.url.href)
    }),
  )

  it.live("an idle chat on the brain's own sandbox moves to a template, and back when the space chooses default", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const spaceId = yield* Seed.team(organizationId)
      const session = yield* Seed.subject(organizationId, spaceId)
      const hand = handOf(session)
      expect((yield* subject.environments.access(session, hand)).url.href).toBe("http://hand.test/")
      yield* subject.environments.release(session)
      yield* Seed.environmentTemplate(organizationId)
      const template = yield* subject.environments.access(session, hand)
      expect(template.url.href).not.toBe("http://hand.test/")
      expect(template.directory).toBe(`/home/user/workspace/${session.sessionId}`)
      yield* subject.environments.release(session)
      yield* Seed.chooseEnvironment(spaceId, { kind: "default" })
      expect((yield* subject.environments.access(session, hand)).url.href).toBe("http://hand.test/")
      expect(yield* Ref.get(subject.probe.destroyed)).toEqual(yield* Ref.get(subject.probe.provisions))
    }),
  )

  it.live("a busy chat on the brain's own sandbox stays there when its space chooses a template", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      const hand = handOf(session)
      yield* subject.environments.access(session, hand)
      yield* Seed.environmentTemplate(organizationId)
      expect((yield* subject.environments.access(session, hand)).url.href).toBe("http://hand.test/")
      expect(yield* Ref.get(subject.probe.provisions)).toEqual([])
    }),
  )

  it.live("a space that chooses none keeps the environment of its existing chats", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const spaceId = yield* Seed.team(organizationId)
      const session = yield* Seed.subject(organizationId, spaceId)
      yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
      const before = yield* subject.environments.access(session, Option.none())
      yield* subject.environments.release(session)
      yield* Seed.chooseEnvironment(spaceId, { kind: "none" })
      expect((yield* subject.environments.access(session, Option.none())).url.href).toBe(before.url.href)
    }),
  )

  it.live(
    "an environment whose template has a new image is replaced when every seat is idle (environments test 5)",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const database = yield* Database.Service
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId, { image: "base:1" })
        const spaceId = yield* Seed.team(organizationId)
        const sessions = yield* Effect.all([
          Seed.subject(organizationId, spaceId),
          Seed.subject(organizationId, spaceId),
        ])
        yield* Effect.forEach(sessions, (session) => subject.environments.bind(session, environmentTemplateId), {
          discard: true,
        })
        const before = yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()))
        yield* database.db
          .update(Database.Schema.environment_template)
          .set({ image: "base:2" })
          .where(eq(Database.Schema.environment_template.id, environmentTemplateId))
        yield* subject.environments.release(sessions[1])
        expect(before.at(0)?.url.href).toBe((yield* subject.environments.access(sessions[1], Option.none())).url.href)
        yield* Effect.forEach(sessions, (session) => subject.environments.release(session), { discard: true })
        const after = yield* subject.environments.access(sessions[0], Option.none())
        expect(before.at(0)?.url.href).not.toBe(after.url.href)
        expect(after.generation).toBe(2)
        expect((yield* Ref.get(subject.probe.provisioned)).map((made) => made.image)).toEqual([
          Option.some("base:1"),
          Option.some("base:2"),
        ])
        expect((yield* Ref.get(subject.probe.destroyed)).length).toBe(1)
      }),
  )

  it.live(
    "an access keeps the environment awake for 30 minutes; a release shortens it to 10 only when no seat is busy (environments test 6)",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
        const spaceId = yield* Seed.team(organizationId)
        const sessions = yield* Effect.all([
          Seed.subject(organizationId, spaceId),
          Seed.subject(organizationId, spaceId),
        ])
        yield* Effect.forEach(sessions, (session) => subject.environments.bind(session, environmentTemplateId), {
          discard: true,
        })
        yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()), {
          discard: true,
        })
        const minutes = Effect.map(Ref.get(subject.probe.keptAlive), (all) =>
          all.map((kept) => Duration.toMinutes(kept.duration)),
        )
        expect(yield* minutes).toEqual([30, 30])
        yield* subject.environments.release(sessions[0])
        expect(yield* minutes).toEqual([30, 30])
        yield* subject.environments.release(sessions[1])
        expect(yield* minutes).toEqual([30, 30, 10])
      }),
  )

  it.live("archiving the last live chat on an environment destroys it (environments test 7)", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const database = yield* Database.Service
      const organizationId = yield* Seed.organization()
      const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
      const spaceId = yield* Seed.team(organizationId)
      const sessions = yield* Effect.all([Seed.subject(organizationId, spaceId), Seed.subject(organizationId, spaceId)])
      yield* Effect.forEach(sessions, (session) => subject.environments.bind(session, environmentTemplateId), {
        discard: true,
      })
      yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()), {
        discard: true,
      })
      const archive = (session: (typeof sessions)[number]) =>
        database.db
          .update(Database.Schema.agent_session)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.agent_session.id, session.sessionId))
          .pipe(Effect.andThen(subject.environments.archive(session)))
      yield* archive(sessions[0])
      expect(yield* Ref.get(subject.probe.destroyed)).toEqual([])
      yield* archive(sessions[1])
      expect(yield* Ref.get(subject.probe.destroyed)).toEqual(yield* Ref.get(subject.probe.provisions))
      expect(yield* environmentsOf(environmentTemplateId)).toEqual([])
    }),
  )

  it.live(
    "a limited template gives the provider its hosts and the package managers; an unrestricted one gives none (environments test 9)",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const networking = {
          type: "limited",
          allowPackageManagers: true,
          allowMcpServers: false,
          allowedHosts: ["api.example.com"],
        } as const
        const limited = yield* subjectIn(organizationId)
        yield* subject.environments.bind(limited, yield* Seed.environmentTemplate(organizationId, { networking }))
        yield* subject.environments.access(limited, Option.none())
        const open = yield* Seed.subject(organizationId, yield* Seed.space(organizationId))
        const chosen = yield* Seed.environmentTemplate(organizationId)
        yield* Seed.chooseEnvironment(open.spaceId, { kind: "template", environmentTemplateId: chosen })
        yield* subject.environments.bind(open, chosen)
        yield* subject.environments.access(open, Option.none())
        expect((yield* Ref.get(subject.probe.provisioned)).map((made) => made.hosts)).toEqual([
          Option.some(["api.example.com", ...EnvironmentNetwork.packageManagerHosts]),
          Option.none(),
        ])
      }),
  )
})
