import { describe, expect, spyOn } from "bun:test"
import { Mailer } from "@ren/core/mailer"
import { SignupGuard } from "@ren/core/signup-guard"
import { AuthDatabase } from "@ren/db/auth-database"
import { Testing } from "@ren/db/testing"
import { getAuthTables } from "better-auth/db"
import { Cause, ConfigProvider, Deferred, Effect, Exit, Fiber, Layer, Option, Schedule } from "effect"
import { HttpClient } from "effect/http"
import { SqlClient } from "effect/sql"
import { TestClock, TestConsole } from "effect/testing"
import { testEffect } from "../../core/test/lib/effect.js"
import { Postmark } from "../../core/test/lib/postmark.js"
import { auth } from "../script/auth-config.js"
import { Auth } from "../src/auth.js"
import { BetterAuth } from "../src/better-auth.js"

const dns: SignupGuard.Resolver = {
  resolveMx: (domain) =>
    domain.includes("nowhere")
      ? Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }))
      : Promise.resolve([{ exchange: `mx.${domain}` }]),
  resolve4: () => Promise.resolve([]),
  resolve6: () => Promise.resolve([]),
}

const stalledMail = Layer.mergeAll(
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.never),
  ),
  Layer.succeed(Postmark.Outbox, Postmark.Outbox.of({ next: Effect.never })),
)

const layer = (config: Record<string, string>, mail: ReturnType<typeof Postmark.layer> = Postmark.layer()) =>
  Auth.layer.pipe(
    Layer.provideMerge(Layer.effect(SignupGuard.Service, SignupGuard.make(dns))),
    Layer.provideMerge(Testing.layer),
    Layer.provideMerge(Mailer.layer),
    Layer.provideMerge(mail),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({
          BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
          BETTER_AUTH_URL: "http://localhost:4000",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          APP_URL: "http://localhost:5173",
          POSTMARK_SERVER_TOKEN: "postmark-token",
          EMAIL_FROM: "Ren <hello@ren.ai>",
          EMAIL_INVITE_FROM: "Ren <invites@ren.ai>",
          ...config,
        }),
        { asPrimary: true },
      ),
    ),
  )

const it = testEffect(layer({ SKIP_EMAIL_VERIFICATION: "true" }))
const verifying = testEffect(layer({}))

const post = (path: string, body: unknown, cookie = "") =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    return yield* Effect.promise(() =>
      auth.handler(
        new Request(`http://localhost:4000/api/auth${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:4000", cookie },
          body: JSON.stringify(body),
        }),
      ),
    )
  })

const get = (path: string, cookie: string) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const response = yield* Effect.promise(() =>
      auth.handler(new Request(`http://localhost:4000/api/auth${path}`, { headers: { cookie } })),
    )
    return yield* Effect.promise(() => response.json())
  })

const json = (response: Response) => Effect.promise(() => response.json())

const signUp = (email: string, name = "Ada") =>
  post("/sign-up/email", { email, password: "correct horse battery staple", name })

const cookie = (response: Response) => response.headers.getSetCookie().join("; ")

const defaultOrganization = Effect.fnUntraced(function* (email: string, name?: string) {
  return yield* get("/organization/get-full-organization", cookie(yield* signUp(email, name)))
})

describe("Auth", () => {
  it.effect("gives every model a prefixed ID", () =>
    Effect.sync(() => {
      const models = Object.keys(getAuthTables(auth.options))
      const ids = models.map((model) => auth.options.advanced.database.generateId({ model }))
      expect(ids.filter((id) => !/^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toEqual([])
      expect(new Set(ids.map((id) => id.split("_")[0])).size).toBe(models.length)
    }),
  )

  it.live("names default organizations after the user or their company domain", () =>
    Effect.gen(function* () {
      const personal = yield* defaultOrganization("barbara@gmail.com", "Barbara Liskov")
      expect([personal.name, personal.slug]).toEqual(["Barbara's Org", "barbara-s-org"])
      expect(personal.members.map((member: { role: string }) => member.role)).toEqual(["owner"])
      expect((yield* defaultOrganization("nameless@hey.com", " ")).name).toBe("Personal Org")

      const company = yield* defaultOrganization("ken@bell-labs.co.uk")
      expect([company.name, company.slug]).toEqual(["Bell Labs", "bell-labs"])
    }),
  )

  it.live("gives colleagues from the same domain their own default organizations", () =>
    Effect.gen(function* () {
      const slugs = yield* Effect.forEach(["ada", "grace", "joan"], (name) =>
        defaultOrganization(`${name}@northwind.io`).pipe(Effect.map((organization) => organization.slug)),
      )
      expect(slugs).toEqual(["northwind", "northwind-2", "northwind-3"])
    }),
  )

  it.live("keeps sign-up working and logs the failure when the default organization cannot be provisioned", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`alter table organization add constraint reject_bell_labs check (slug not like 'bell-labs%')`

      const log = spyOn(console, "log")
      const response = yield* signUp("dennis@mail.bell-labs.co.uk")
      const logged = log.mock.calls.flat().join(" ")
      log.mockRestore()
      yield* sql`alter table organization drop constraint reject_bell_labs`
      expect(response.status).toBe(200)
      const session = yield* get("/get-session", cookie(response))
      expect(session.user.email).toBe("dennis@mail.bell-labs.co.uk")
      expect(session.session.activeOrganizationId).toBeNull()

      expect(logged).toContain("Default organization provisioning failed")
      const memberships = yield* sql<{
        n: number
      }>`select count(*)::int as n from member where user_id = ${session.user.id}`
      const orphans = yield* sql<{ n: number }>`
        select count(*)::int as n from organization o
        where not exists (select 1 from member m where m.organization_id = o.id)`
      expect([...memberships, ...orphans]).toEqual([{ n: 0 }, { n: 0 }])
    }),
  )

  it.live("signs back in to the oldest organization", () =>
    Effect.gen(function* () {
      const session = cookie(yield* signUp("frances@example.org"))
      const first = (yield* get("/get-session", session)).session.activeOrganizationId
      expect((yield* post("/organization/create", { name: "Side Project", slug: "side" }, session)).status).toBe(200)

      const signIn = yield* post("/sign-in/email", {
        email: "frances@example.org",
        password: "correct horse battery staple",
      })
      expect((yield* get("/get-session", cookie(signIn))).session.activeOrganizationId).toBe(first)
    }),
  )

  it.live("normalizes explicit organization slugs before the duplicate check", () =>
    Effect.gen(function* () {
      const session = cookie(yield* signUp("linus@example.com"))
      const created = yield* post("/organization/create", { name: "Acme Inc", slug: "Acme Inc!" }, session)
      expect((yield* json(created)).slug).toBe("acme-inc")
      expect((yield* post("/organization/create", { name: "Acme", slug: "acme-inc" }, session)).status).toBe(400)
      expect((yield* post("/organization/create", { name: "Acme", slug: "Acme Inc!" }, session)).status).toBe(400)
      expect((yield* post("/organization/create", { name: "Symbols", slug: "!!!" }, session)).status).toBe(400)
    }),
  )

  it.live("lets one of two concurrent creates with the same normalized slug win and handles the conflict", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const ada = cookie(yield* signUp("ada@gmail.com", "Ada"))
      const grace = cookie(yield* signUp("grace@gmail.com", "Grace"))

      const locked = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const holder = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`lock table organization in share row exclusive mode`
            yield* Deferred.succeed(locked, undefined)
            yield* Deferred.await(release)
          }),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(locked)

      const creates = yield* Effect.all(
        [
          post("/organization/create", { name: "Acme", slug: "Acme Inc!" }, ada),
          post("/organization/create", { name: "Acme", slug: "acme-inc" }, grace),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild)
      yield* sql<{ waiting: number }>`
        select count(*)::int as waiting from pg_locks l join pg_class c on c.oid = l.relation
        where c.relname = 'organization' and not l.granted`.pipe(
        Effect.map((rows) => rows[0]?.waiting ?? 0),
        Effect.repeat({ until: (waiting) => waiting >= 2, schedule: Schedule.spaced("10 millis"), times: 500 }),
      )
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(holder)

      const statuses = (yield* Fiber.join(creates))
        .map((response) => response.status)
        .toSorted((left, right) => left - right)
      expect(statuses[0]).toBe(200)
      expect(statuses[1]).toBeGreaterThanOrEqual(400)
      expect(statuses[1]).toBeLessThan(500)
      const rows = yield* sql<{ n: number }>`select count(*)::int as n from organization where slug = 'acme-inc'`
      expect(rows).toEqual([{ n: 1 }])
    }),
  )

  testEffect(layer({ SKIP_EMAIL_VERIFICATION: "true", APP_URL: "http://localhost:5173/app/" })).live(
    "emails the invitation from the invite address and preserves the app path prefix",
    () =>
      Effect.gen(function* () {
        const outbox = yield* Postmark.Outbox
        const owner = cookie(yield* signUp("radia@example.org"))
        const invited = yield* post("/organization/invite-member", { email: "sophie@gmail.com", role: "member" }, owner)
        expect((yield* outbox.next).message).toEqual({
          From: "Ren <invites@ren.ai>",
          To: "sophie@gmail.com",
          Subject: "You have been invited to join a Ren organization",
          TextBody: `You have been invited to join a Ren organization. Please click on the link below to accept the invitation. http://localhost:5173/app/signup?invitationId=${(yield* json(invited)).id}`,
          MessageStream: "outbound",
        })
      }),
  )

  testEffect(layer({ SKIP_EMAIL_VERIFICATION: "true", APP_URL: "http://localhost:5173/app" })).live(
    "emails a password reset link and preserves the app path prefix",
    () =>
      Effect.gen(function* () {
        const outbox = yield* Postmark.Outbox
        yield* signUp("katherine@example.org")
        expect((yield* post("/request-password-reset", { email: "katherine@example.org" })).status).toBe(200)
        const email = (yield* outbox.next).message
        expect(email).toMatchObject({ To: "katherine@example.org", Subject: "Reset your Ren password" })
        const link = new URL(email.TextBody.slice(email.TextBody.indexOf("http")))
        expect(link.origin + link.pathname).toBe("http://localhost:5173/app/reset-password")
        expect(link.searchParams.get("token")).toBeTruthy()
      }),
  )

  testEffect(layer({ SKIP_EMAIL_VERIFICATION: "true" }, Postmark.layer(422))).live(
    "keeps sign-up working and logs the failure when the email is rejected",
    () =>
      Effect.gen(function* () {
        const outbox = yield* Postmark.Outbox
        yield* signUp("hedy@example.org")
        expect((yield* post("/request-password-reset", { email: "hedy@example.org" })).status).toBe(200)
        yield* outbox.next
        const logs = yield* TestConsole.logLines.pipe(
          Effect.repeat({
            until: (lines) => lines.join(" ").includes("Failed to send email"),
            schedule: Schedule.spaced("10 millis"),
            times: 100,
          }),
        )
        expect(logs.join(" ")).toContain("Failed to send email")
      }),
  )

  testEffect(layer({ SKIP_EMAIL_VERIFICATION: "true" }, stalledMail)).effect(
    "keeps the response successful and logs the failure when email delivery times out",
    () =>
      Effect.gen(function* () {
        yield* signUp("margaret@example.org")
        expect((yield* post("/request-password-reset", { email: "margaret@example.org" })).status).toBe(200)
        const logs = yield* TestClock.adjust("10 seconds").pipe(
          Effect.andThen(TestConsole.logLines),
          Effect.repeat({ until: (lines) => lines.join(" ").includes("Failed to send email"), times: 1000 }),
        )
        expect(logs.join(" ")).toContain("Failed to send email")
      }),
  )

  describe("email verification", () => {
    verifying.live("sends a code on sign-up and signs in once it is verified", () =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const outbox = yield* Postmark.Outbox
        const response = yield* signUp("mary@example.org")
        expect(response.status).toBe(200)
        expect(cookie(response)).toBe("")

        const email = (yield* outbox.next).message
        const otp = email.Subject.split(" ")[0]
        expect(email).toEqual({
          From: "Ren <hello@ren.ai>",
          To: "mary@example.org",
          Subject: `${otp} is your Ren verification code`,
          TextBody: `Use ${otp} to verify your email on Ren. The code expires in 10 minutes. If you didn't request it, you can ignore this email.`,
          MessageStream: "outbound",
        })
        expect(otp).toMatch(/^\d{6}$/)

        const verified = yield* post("/email-otp/verify-email", { email: "mary@example.org", otp })
        expect(verified.status).toBe(200)
        const session = Option.getOrThrow(yield* auth.getSession(new Headers({ cookie: cookie(verified) })))
        expect(session.user).toMatchObject({ email: "mary@example.org", emailVerified: true })
      }),
    )

    verifying.live("emails a sign-in code to an existing user", () =>
      Effect.gen(function* () {
        const outbox = yield* Postmark.Outbox
        yield* signUp("hedy@example.org")
        yield* outbox.next

        expect(
          (yield* post("/email-otp/send-verification-otp", { email: "hedy@example.org", type: "sign-in" })).status,
        ).toBe(200)
        const email = (yield* outbox.next).message
        const otp = email.Subject.split(" ")[0]
        expect(email.Subject).toBe(`${otp} is your Ren sign-in code`)
        expect(email.TextBody).toStartWith(`Use ${otp} to sign in on Ren.`)
      }),
    )

    verifying.live("rejects other code types", () =>
      Effect.gen(function* () {
        const response = yield* post("/email-otp/send-verification-otp", {
          email: "ada@example.org",
          type: "forget-password",
        })
        expect(response.status).toBe(400)
      }),
    )

    verifying.live("does not email a verification code to a verified address", () =>
      Effect.gen(function* () {
        const outbox = yield* Postmark.Outbox
        yield* signUp("annie@example.org")
        const otp = (yield* outbox.next).message.Subject.split(" ")[0]
        expect((yield* post("/email-otp/verify-email", { email: "annie@example.org", otp })).status).toBe(200)

        yield* post("/email-otp/send-verification-otp", { email: "annie@example.org", type: "email-verification" })
        yield* post("/request-password-reset", { email: "annie@example.org" })
        expect((yield* outbox.next).message.Subject).toBe("Reset your Ren password")
      }),
    )

    testEffect(Layer.empty).live("refuses to skip verification outside development and test", () =>
      Effect.gen(function* () {
        const exit = yield* Layer.build(layer({ SKIP_EMAIL_VERIFICATION: "true", NODE_ENV: "production" })).pipe(
          Effect.exit,
        )
        expect(Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "").toContain(
          "SKIP_EMAIL_VERIFICATION requires NODE_ENV=development or test",
        )
      }),
    )
  })

  describe("signup guard", () => {
    const rejection = Effect.fnUntraced(function* (response: Response) {
      expect(response.status).toBe(400)
      return (yield* json(response)).code
    })

    it.live("rejects email sign-ups the guard refuses, before creating the user", () =>
      Effect.gen(function* () {
        const database = yield* AuthDatabase.Service
        expect(yield* rejection(yield* signUp("spam@mailinator.com"))).toBe("DISPOSABLE_EMAIL")
        expect(yield* rejection(yield* signUp("lost@nowhere.dev"))).toBe("UNDELIVERABLE_EMAIL_DOMAIN")
        const users = yield* Effect.promise(() => database.db.query.user.findMany({ columns: { email: true } }))
        expect(users.map((user) => user.email)).not.toContain("spam@mailinator.com")
      }),
    )

    it.live("rejects disposable domains for accounts created outside email sign-up", () =>
      Effect.gen(function* () {
        const database = yield* AuthDatabase.Service
        const guard = yield* SignupGuard.Service
        const instance = BetterAuth.make({
          database: database.db,
          secret: "test-secret-at-least-32-characters-long",
          baseURL: "http://localhost:4000",
          trustedOrigins: [],
          google: { clientId: "unused", clientSecret: "unused" },
          appURL: "http://localhost:5173",
          requireEmailVerification: true,
          sendEmail: () => {},
          signupGuard: {
            checkEmailSignUp: (email) => Effect.runPromise(guard.checkEmailSignUp(email)),
            checkAccountCreation: (email) => Effect.runPromise(guard.checkAccountCreation(email)),
            hasVerifiedAlias: (email) => Effect.runPromise(guard.hasVerifiedAlias(email)),
          },
          lifecycle: {
            join: () => Promise.resolve(),
            activate: () => Promise.resolve(),
            leave: () => Promise.resolve(),
          },
        })
        const context = yield* Effect.promise(() => instance.$context)
        const created = yield* Effect.promise(() =>
          context.internalAdapter
            .createUser(
              { email: "oauth@mailinator.com", name: "OAuth", emailVerified: true },
              { method: "oauth", oauth: { providerId: "google" } },
            )
            .then(
              () => "created",
              (error: unknown) => String(error),
            ),
        )
        expect(created).toContain("permanent email")
      }),
    )
    describe("email aliases", () => {
      const verified = Effect.fnUntraced(function* (email: string) {
        const outbox = yield* Postmark.Outbox
        yield* signUp(email)
        const otp = (yield* outbox.next).message.Subject.split(" ")[0]
        expect((yield* post("/email-otp/verify-email", { email, otp })).status).toBe(200)
      })

      const emails = Effect.fnUntraced(function* () {
        const database = yield* AuthDatabase.Service
        const users = yield* Effect.promise(() => database.db.query.user.findMany({ columns: { email: true } }))
        return users.map((user) => user.email).toSorted()
      })

      const publicShape = Effect.fnUntraced(function* (response: Response) {
        const body = yield* json(response)
        return {
          status: response.status,
          cookie: cookie(response),
          body: {
            ...body,
            user: { ...body.user, id: undefined, email: undefined, createdAt: undefined, updatedAt: undefined },
          },
        }
      })

      verifying.live("answers a verified alias like a duplicate sign-up and creates no account", () =>
        Effect.gen(function* () {
          yield* verified("grace@example.org")
          const duplicate = yield* publicShape(yield* signUp("grace@example.org"))
          expect(duplicate.status).toBe(200)
          expect(duplicate.body.token).toBeNull()

          expect(yield* publicShape(yield* signUp("grace+news@example.org"))).toEqual(duplicate)
          expect(yield* emails()).toEqual(["grace@example.org"])
        }),
      )

      verifying.live("allows an alias of an unverified account", () =>
        Effect.gen(function* () {
          const outbox = yield* Postmark.Outbox
          yield* signUp("lin@example.org")
          yield* outbox.next

          expect((yield* signUp("lin+2@example.org")).status).toBe(200)
          expect((yield* outbox.next).message.To).toBe("lin+2@example.org")
          expect(yield* emails()).toEqual(["lin+2@example.org", "lin@example.org"])
        }),
      )

      verifying.live("keeps exact duplicates on the normal path, even next to a verified alias", () =>
        Effect.gen(function* () {
          const outbox = yield* Postmark.Outbox
          yield* signUp("kay+a@example.org")
          yield* outbox.next
          yield* verified("kay@example.org")

          const exactVerified = yield* publicShape(yield* signUp("kay@example.org"))
          expect(yield* publicShape(yield* signUp("kay+a@example.org"))).toEqual(exactVerified)
          expect(exactVerified.status).toBe(200)
          expect(yield* emails()).toEqual(["kay+a@example.org", "kay@example.org"])

          yield* post("/request-password-reset", { email: "kay@example.org" })
          expect((yield* outbox.next).message.Subject).toBe("Reset your Ren password")
        }),
      )
    })
  })
})
