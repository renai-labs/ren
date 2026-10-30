import { describe, expect } from "bun:test"
import { Billing } from "@ren/core/billing"
import { BillingEnrollment } from "@ren/core/billing-enrollment"
import { DurableRunner } from "@ren/core/durable-runner"
import { GitHubAccounts } from "@ren/core/github-accounts"
import { SlackApp } from "@ren/core/slack-app"
import { Mailer } from "@ren/core/mailer"
import { RenInference } from "@ren/core/ren-inference"
import { RenInferenceRemoval } from "@ren/core/ren-inference-removal"
import { SignupGuard } from "@ren/core/signup-guard"
import { Postmark, testEffect } from "@ren/core/testing"
import { AuthDatabase } from "@ren/db/auth-database"
import { Testing } from "@ren/db/testing"
import { Space } from "@ren/schema/space"
import { getAuthTables } from "better-auth/db"
import { ConfigProvider, Deferred, Effect, Fiber, Layer, Option, Queue, Schedule } from "effect"
import { HttpClient } from "effect/http"
import { SqlClient } from "effect/sql"
import { TestClock, TestConsole } from "effect/testing"
import { auth } from "../script/auth-config.js"
import { Auth } from "../src/auth.js"
import { BetterAuth } from "../src/better-auth.js"
import { authRequest, config, sessionCookie, signUp } from "./lib/app.js"
import { EgressControl } from "@ren/core/egress-control"

const dns: SignupGuard.Resolver = {
  resolveMx: (domain) => Promise.resolve([{ exchange: `mx.${domain}` }]),
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

const customers = Effect.runSync(Queue.unbounded<Billing.Customer>())

const billing = Layer.succeed(
  Billing.Service,
  Billing.Service.of({ ensureCustomer: (customer) => Queue.offer(customers, customer).pipe(Effect.asVoid) }),
)

const layer = (overrides: Record<string, string>, mail: ReturnType<typeof Postmark.layer> = Postmark.layer()) =>
  Auth.layer.pipe(
    Layer.provideMerge(Layer.effect(SignupGuard.Service, SignupGuard.make(dns))),
    Layer.provideMerge(EgressControl.layerNone),
    Layer.provideMerge(
      RenInferenceRemoval.layer.pipe(Layer.provide([RenInference.layerNone, DurableRunner.layerMemory])),
    ),
    Layer.provideMerge(BillingEnrollment.layer.pipe(Layer.provide([billing, DurableRunner.layerMemory]))),
    Layer.provideMerge(Layer.mergeAll(GitHubAccounts.layerNone, SlackApp.layerNone)),
    Layer.provideMerge(Testing.layer),
    Layer.provideMerge(Mailer.layer),
    Layer.provideMerge(mail),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({
          ...config,
          POSTMARK_SERVER_TOKEN: "postmark-token",
          EMAIL_FROM: "Ren <hello@ren.ai>",
          EMAIL_INVITE_FROM: "Ren <invites@ren.ai>",
          ...overrides,
        }),
        { asPrimary: true },
      ),
    ),
  )

const it = testEffect(layer({ SKIP_EMAIL_VERIFICATION: "true" }))
const verifying = testEffect(layer({}))

const handle = (request: (service: Auth.Service["Service"]) => Promise<Response>) =>
  Auth.Service.use((service) => Effect.promise(() => request(service)))

const post = (path: string, body: unknown, cookie = "") =>
  handle((service) => service.handler(authRequest(path, body, cookie)))

const json = (response: Response) => Effect.promise(() => response.json())

const get = (path: string, cookie: string) =>
  handle((service) => service.handler(new Request(`http://localhost:4000/auth${path}`, { headers: { cookie } }))).pipe(
    Effect.flatMap(json),
  )

const register = (email: string, name?: string) => handle((service) => signUp(service, email, name))

const defaultOrganization = Effect.fnUntraced(function* (email: string, name?: string) {
  return yield* get("/organization/get-full-organization", sessionCookie(yield* register(email, name)))
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

      const response = yield* register("dennis@mail.bell-labs.co.uk")
      const logged = (yield* TestConsole.logLines).join(" ")
      yield* sql`alter table organization drop constraint reject_bell_labs`
      expect(response.status).toBe(200)
      const session = yield* get("/get-session", sessionCookie(response))
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

  it.live("applies pending space assignments when the invitation is accepted", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const owner = sessionCookie(yield* register("lynn@example.org", "Lynn"))
      const organizationId = (yield* get("/get-session", owner)).session.activeOrganizationId
      const invitation = yield* json(
        yield* post("/organization/invite-member", { email: "alan@example.org", role: "member" }, owner),
      )
      const spaces = yield* sql<{ id: string }>`
        select id from space where organization_id = ${organizationId} and name = 'General Space'`
      const spaceId = spaces.at(0)?.id
      if (!spaceId) return yield* Effect.die(new Error("Expected a general space"))
      yield* sql`
        insert into space_pending_member (id, space_id, email)
        values (${Space.AssignmentID.create()}, ${spaceId}, 'alan@example.org')`

      const invitee = yield* register("alan@example.org", "Alan")
      const session = yield* get("/get-session", sessionCookie(invitee))
      const accepted = yield* post(
        "/organization/accept-invitation",
        { invitationId: invitation.id },
        sessionCookie(invitee),
      )
      expect(accepted.status).toBe(200)

      const memberships = yield* sql<{ n: number }>`
        select count(*)::int as n from space_member
        where space_id = ${spaceId} and user_id = ${session.user.id} and archived_at is null`
      const pending = yield* sql<{ n: number }>`
        select count(*)::int as n from space_pending_member
        where space_id = ${spaceId} and archived_at is null`
      expect([...memberships, ...pending]).toEqual([{ n: 1 }, { n: 0 }])
    }),
  )

  it.live("refuses organization management to members and deletion to admins", () =>
    Effect.gen(function* () {
      const owner = sessionCookie(yield* register("olga@example.org", "Olga"))
      const organizationId = (yield* get("/get-session", owner)).session.activeOrganizationId
      const join = Effect.fnUntraced(function* (email: string, role: string) {
        const invitation = yield* json(yield* post("/organization/invite-member", { email, role }, owner))
        const session = sessionCookie(yield* register(email))
        yield* post("/organization/accept-invitation", { invitationId: invitation.id }, session)
        yield* post("/organization/set-active", { organizationId }, session)
        return session
      })
      const admin = yield* join("adam@example.org", "admin")
      const member = yield* join("mia@example.org", "member")
      const members = (yield* get(`/organization/list-members?organizationId=${organizationId}`, owner)).members
      const memberId = members.find((each: { role: string }) => each.role === "member").id
      const statuses = yield* Effect.forEach(
        [
          { path: "/organization/update", body: { organizationId, data: { name: "Renamed" } }, session: member },
          {
            path: "/organization/invite-member",
            body: { organizationId, email: "x@example.org", role: "member" },
            session: member,
          },
          {
            path: "/organization/update-member-role",
            body: { organizationId, memberId, role: "admin" },
            session: member,
          },
          { path: "/organization/delete", body: { organizationId }, session: admin },
        ],
        (row) => post(row.path, row.body, row.session).pipe(Effect.map((response) => response.status)),
      )
      expect(statuses).toEqual([403, 403, 403, 403])
    }),
  )

  it.live("signs back in to the oldest organization", () =>
    Effect.gen(function* () {
      const session = sessionCookie(yield* register("frances@example.org"))
      const first = (yield* get("/get-session", session)).session.activeOrganizationId
      expect((yield* post("/organization/create", { name: "Side Project", slug: "side" }, session)).status).toBe(200)

      const signIn = yield* post("/sign-in/email", {
        email: "frances@example.org",
        password: "correct horse battery staple",
      })
      expect((yield* get("/get-session", sessionCookie(signIn))).session.activeOrganizationId).toBe(first)
    }),
  )

  it.live(
    "makes a billing customer for the default organization and for each created one, with the owner's email",
    () =>
      Effect.gen(function* () {
        yield* Queue.clear(customers)
        const session = sessionCookie(yield* register("hedy@gmail.com", "Hedy Lamarr"))
        const first = (yield* get("/get-session", session)).session.activeOrganizationId
        const created = yield* post("/organization/create", { name: "Side Project", slug: "hedy-side" }, session).pipe(
          Effect.flatMap(json),
        )

        expect(yield* Queue.takeN(customers, 2)).toEqual([
          { organizationId: first, name: "Hedy's Org", ownerEmail: "hedy@gmail.com" },
          { organizationId: created.id, name: "Side Project", ownerEmail: "hedy@gmail.com" },
        ])
      }),
  )

  it.live("normalizes explicit organization slugs before the duplicate check", () =>
    Effect.gen(function* () {
      const session = sessionCookie(yield* register("linus@example.com"))
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
      const ada = sessionCookie(yield* register("ada@gmail.com", "Ada"))
      const grace = sessionCookie(yield* register("grace@gmail.com", "Grace"))

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
    "emails the invitation link and preserves the app path prefix",
    () =>
      Effect.gen(function* () {
        const outbox = yield* Postmark.Outbox
        const owner = sessionCookie(yield* register("radia@example.org"))
        const invited = yield* post("/organization/invite-member", { email: "sophie@gmail.com", role: "member" }, owner)
        expect((yield* outbox.next).message.TextBody).toEndWith(
          ` http://localhost:5173/app/signup?invitationId=${(yield* json(invited)).id}`,
        )
      }),
  )

  it.live("emails a password reset link and preserves the app path prefix", () =>
    Effect.gen(function* () {
      const outbox = yield* Postmark.Outbox
      yield* register("katherine@example.org")
      expect((yield* post("/request-password-reset", { email: "katherine@example.org" })).status).toBe(200)
      const email = (yield* outbox.next).message
      expect(email).toMatchObject({ To: "katherine@example.org", Subject: "Reset your Ren password" })
      const link = new URL(email.TextBody.slice(email.TextBody.indexOf("http")))
      expect(link.origin + link.pathname).toBe("http://localhost:5173/app/reset-password")
      expect(link.searchParams.get("token")).toBeTruthy()
    }),
  )

  testEffect(layer({ SKIP_EMAIL_VERIFICATION: "true" }, stalledMail)).effect(
    "keeps the response successful and logs the failure when email delivery times out",
    () =>
      Effect.gen(function* () {
        yield* register("margaret@example.org")
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
        const response = yield* register("mary@example.org")
        expect(response.status).toBe(200)
        expect(sessionCookie(response)).toBe("")

        const email = (yield* outbox.next).message
        const otp = email.Subject.split(" ")[0]
        expect(email.To).toBe("mary@example.org")
        expect(otp).toMatch(/^\d{6}$/)

        const verified = yield* post("/email-otp/verify-email", { email: "mary@example.org", otp })
        expect(verified.status).toBe(200)
        const session = Option.getOrThrow(yield* auth.getSession(new Headers({ cookie: sessionCookie(verified) })))
        expect(session.user).toMatchObject({ email: "mary@example.org", emailVerified: true })
      }),
    )

    verifying.live("does not email a verification code to a verified address", () =>
      Effect.gen(function* () {
        const outbox = yield* Postmark.Outbox
        yield* register("annie@example.org")
        const otp = (yield* outbox.next).message.Subject.split(" ")[0]
        expect((yield* post("/email-otp/verify-email", { email: "annie@example.org", otp })).status).toBe(200)

        yield* post("/email-otp/send-verification-otp", { email: "annie@example.org", type: "email-verification" })
        yield* post("/request-password-reset", { email: "annie@example.org" })
        expect((yield* outbox.next).message.Subject).toBe("Reset your Ren password")
      }),
    )
  })

  describe("signup guard", () => {
    it.live("rejects email sign-ups the guard refuses, before creating the user", () =>
      Effect.gen(function* () {
        const database = yield* AuthDatabase.Service
        const response = yield* register("spam@mailinator.com")
        expect([response.status, (yield* json(response)).code]).toEqual([400, "DISPOSABLE_EMAIL"])
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
          mcpResource: "http://localhost:4000/mcp",
          fetchClientMetadataResource: () => Promise.resolve(new Response(null, { status: 404 })),
          requireEmailVerification: true,
          sendEmail: () => {},
          logFailure: () => Promise.resolve(),
          signupGuard: {
            checkEmailSignUp: (email) => Effect.runPromise(guard.checkEmailSignUp(email)),
            checkAccountCreation: (email) => Effect.runPromise(guard.checkAccountCreation(email)),
            hasVerifiedAlias: (email) => Effect.runPromise(guard.hasVerifiedAlias(email)),
          },
          provisioning: {
            createInitialMemberships: () => Promise.resolve(),
            activatePendingMemberships: () => Promise.resolve(),
            archiveMemberships: () => Promise.resolve(),
            forgetInferenceMember: () => Promise.resolve(),
            enrollInBilling: () => Promise.resolve(),
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
      const publicShape = Effect.fnUntraced(function* (response: Response) {
        const body = yield* json(response)
        return {
          status: response.status,
          cookie: sessionCookie(response),
          body: {
            ...body,
            user: { ...body.user, id: undefined, email: undefined, createdAt: undefined, updatedAt: undefined },
          },
        }
      })

      verifying.live("answers a verified alias like a duplicate sign-up and creates no account", () =>
        Effect.gen(function* () {
          const database = yield* AuthDatabase.Service
          const outbox = yield* Postmark.Outbox
          yield* register("grace@example.org")
          const otp = (yield* outbox.next).message.Subject.split(" ")[0]
          expect((yield* post("/email-otp/verify-email", { email: "grace@example.org", otp })).status).toBe(200)
          const duplicate = yield* publicShape(yield* register("grace@example.org"))
          expect(duplicate.status).toBe(200)
          expect(duplicate.body.token).toBeNull()

          expect(yield* publicShape(yield* register("grace+news@example.org"))).toEqual(duplicate)
          const users = yield* Effect.promise(() => database.db.query.user.findMany({ columns: { email: true } }))
          expect(users.map((user) => user.email)).toEqual(["grace@example.org"])
        }),
      )
    })
  })
})
