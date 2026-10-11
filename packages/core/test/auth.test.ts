import { describe, expect } from "bun:test"
import { AuthDatabase } from "@ren/db/auth-database"
import { Testing } from "@ren/db/testing"
import { getAuthTables } from "better-auth/db"
import { drizzle } from "drizzle-orm/bun-sql/postgres"
import { ConfigProvider, Effect, Exit, Layer, Option } from "effect"
import { Auth } from "../src/auth.js"
import { Mailer } from "../src/mailer.js"
import { SignupGuard } from "../src/signup-guard.js"
import { testEffect } from "./lib/effect.js"
import { Postmark } from "./lib/postmark.js"

const layer = (config: Record<string, string>) =>
  Auth.layer.pipe(
    Layer.provideMerge(Layer.effect(SignupGuard.Service, SignupGuard.make(dns))),
    Layer.provideMerge(Testing.layer),
    Layer.provideMerge(Mailer.layer),
    Layer.provideMerge(Postmark.layer()),
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
          ...config,
        }),
        { asPrimary: true },
      ),
    ),
  )

const dns: SignupGuard.Resolver = {
  resolveMx: (domain) =>
    domain.includes("nowhere")
      ? Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }))
      : Promise.resolve([{ exchange: `mx.${domain}` }]),
  resolve4: () => Promise.resolve([]),
  resolve6: () => Promise.resolve([]),
}

const it = testEffect(layer({ SKIP_EMAIL_VERIFICATION: "true" }))
const verifying = testEffect(layer({}))

const post = (auth: Auth.Interface, path: string, body: unknown, headers?: Record<string, string>) =>
  Effect.promise(() =>
    auth.handler(
      new Request(`http://localhost:4000/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:4000", ...headers },
        body: JSON.stringify(body),
      }),
    ),
  )

const signUp = (auth: Auth.Interface, email: string, name = "Ada") =>
  post(auth, "/sign-up/email", { email, password: "correct horse battery staple", name })

const get = (auth: Auth.Interface, path: string, cookie: string) =>
  Effect.promise(() =>
    auth
      .handler(new Request(`http://localhost:4000/api/auth${path}`, { headers: { cookie } }))
      .then((response) => response.json()),
  )

const activeOrganization = Effect.fnUntraced(function* (auth: Auth.Interface, email: string, name?: string) {
  const cookie = (yield* signUp(auth, email, name)).headers.getSetCookie().join("; ")
  return yield* get(auth, "/organization/get-full-organization", cookie)
})

describe("Auth", () => {
  it.live("signs up and reads the user back from the session cookie", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* signUp(auth, "ada@example.com")
      expect(response.status).toBe(200)

      const headers = new Headers({ cookie: response.headers.getSetCookie().join("; ") })
      const user = Option.getOrThrow(yield* auth.getUser(headers))
      expect(user).toEqual({
        id: expect.stringMatching(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/),
        name: "Ada",
        email: "ada@example.com",
        emailVerified: false,
        image: null,
      })
    }),
  )

  it.live("reads the user from a bearer token", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* signUp(auth, "grace@example.com")
      const token = response.headers.get("set-auth-token")
      expect(token).not.toBeNull()

      const user = Option.getOrThrow(yield* auth.getUser(new Headers({ authorization: `Bearer ${token}` })))
      expect(user.email).toBe("grace@example.com")
    }),
  )

  it.live("rejects an unknown bearer token", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const user = yield* auth.getUser(new Headers({ authorization: "Bearer not-a-session" }))
      expect(Option.isNone(user)).toBe(true)
    }),
  )

  it.live("starts google sign-in with the configured client and callback", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* post(auth, "/sign-in/social", { provider: "google", callbackURL: "/" })
      expect(response.status).toBe(200)
      const url = new URL((yield* Effect.promise(() => response.json())).url)
      expect(url.origin).toBe("https://accounts.google.com")
      expect(url.searchParams.get("client_id")).toBe("google-client-id")
      expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4000/api/auth/callback/google")
    }),
  )

  it.live("creates organizations with normalized, unique slugs", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const cookie = (yield* signUp(auth, "linus@example.com")).headers.getSetCookie().join("; ")
      const create = Effect.fnUntraced(function* () {
        const response = yield* post(auth, "/organization/create", { name: "Acme Inc", slug: "Acme Inc!" }, { cookie })
        expect(response.status).toBe(200)
        return yield* Effect.promise(() => response.json())
      })

      const first = yield* create()
      const second = yield* create()
      expect(first.id).toMatch(/^org_[0-9A-HJKMNP-TV-Z]{26}$/)
      expect([first.slug, second.slug]).toEqual(["acme-inc", "acme-inc-2"])
    }),
  )

  it.live("creates a personal organization on first sign-in", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const organization = yield* activeOrganization(auth, "barbara@gmail.com", "Barbara Liskov")
      expect(organization.id).toMatch(/^org_[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(organization.name).toBe("Barbara's Org")
      expect(organization.slug).toBe("barbara-s-org")
      expect(organization.members.map((member: { role: string }) => member.role)).toEqual(["owner"])
      expect((yield* activeOrganization(auth, "nameless@hey.com", " ")).name).toBe("Personal Org")
    }),
  )

  it.live("names the organization after a company email domain", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      expect((yield* activeOrganization(auth, "ken@bell-labs.co.uk")).name).toBe("Bell Labs")
      const second = yield* activeOrganization(auth, "dennis@mail.bell-labs.co.uk")
      expect([second.name, second.slug]).toEqual(["Bell Labs", "bell-labs-2"])
    }),
  )

  it.live("signs back in to the oldest organization", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const cookie = (yield* signUp(auth, "frances@example.org")).headers.getSetCookie().join("; ")
      const first = (yield* get(auth, "/get-session", cookie)).session.activeOrganizationId
      const created = yield* post(auth, "/organization/create", { name: "Side Project", slug: "side" }, { cookie })
      expect(created.status).toBe(200)

      const response = yield* post(auth, "/sign-in/email", {
        email: "frances@example.org",
        password: "correct horse battery staple",
      })
      const session = yield* get(auth, "/get-session", response.headers.getSetCookie().join("; "))
      expect(session.session.activeOrganizationId).toBe(first)
    }),
  )

  it.live("waits for a pending invitation instead of creating an organization", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const cookie = (yield* signUp(auth, "admin@inviting.dev")).headers.getSetCookie().join("; ")
      const invite = yield* post(
        auth,
        "/organization/invite-member",
        { email: "Invitee@Gmail.com", role: "member" },
        { cookie },
      )
      expect(invite.status).toBe(200)
      const organization = yield* activeOrganization(auth, "invitee@gmail.com")
      expect(organization).toBeNull()
    }),
  )

  it.live("resolves the session's active organization, falling back to the oldest membership", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const cookie = (yield* signUp(auth, "margaret@hamilton-labs.dev")).headers.getSetCookie().join("; ")
      const headers = new Headers({ cookie })
      const personal = Option.getOrThrow(yield* auth.getActiveOrganization(headers))
      expect(personal).toEqual({
        id: expect.stringMatching(/^org_/),
        name: "Hamilton Labs",
        slug: "hamilton-labs",
        logo: null,
      })

      const response = yield* post(auth, "/organization/create", { name: "Apollo", slug: "apollo" }, { cookie })
      const apollo = (yield* Effect.promise(() => response.json())).id
      expect(Option.getOrThrow(yield* auth.getActiveOrganization(headers)).id).toBe(apollo)

      const deleted = yield* post(auth, "/organization/delete", { organizationId: apollo }, { cookie })
      expect(deleted.status).toBe(200)
      expect(Option.getOrThrow(yield* auth.getActiveOrganization(headers))).toEqual(personal)
    }),
  )

  it.live("has no active organization without a membership", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const cookie = (yield* signUp(auth, "owner@pending.dev")).headers.getSetCookie().join("; ")
      yield* post(auth, "/organization/invite-member", { email: "pending@gmail.com", role: "member" }, { cookie })
      const invited = (yield* signUp(auth, "pending@gmail.com")).headers.getSetCookie().join("; ")
      expect(Option.isNone(yield* auth.getActiveOrganization(new Headers({ cookie: invited })))).toBe(true)
      expect(Option.isNone(yield* auth.getActiveOrganization(new Headers()))).toBe(true)
    }),
  )

  it.live("does not let members leave an organization", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const response = yield* post(auth, "/organization/leave", { organizationId: "org_unknown" })
      expect(response.status).toBe(404)
    }),
  )

  it.live("lets the invited user accept an invitation", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const owner = (yield* signUp(auth, "radia@example.org")).headers.getSetCookie().join("; ")
      const invited = yield* post(
        auth,
        "/organization/invite-member",
        { email: "sophie@gmail.com", role: "member" },
        { cookie: owner },
      )
      const invitation = (yield* Effect.promise(() => invited.json())).id

      const invitee = (yield* signUp(auth, "sophie@gmail.com")).headers.getSetCookie().join("; ")
      const accepted = yield* post(
        auth,
        "/organization/accept-invitation",
        { invitationId: invitation },
        { cookie: invitee },
      )
      expect(accepted.status).toBe(200)
      expect(Option.getOrThrow(yield* auth.getActiveOrganization(new Headers({ cookie: invitee }))).name).toBe(
        "Example",
      )
    }),
  )

  it.live("emails a password reset link to the app and resets the password", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      const outbox = yield* Postmark.Outbox
      yield* signUp(auth, "katherine@example.org")

      const requested = yield* post(auth, "/request-password-reset", { email: "katherine@example.org" })
      expect(requested.status).toBe(200)
      const email = (yield* outbox.next).message
      expect(email).toMatchObject({ To: "katherine@example.org", Subject: "Reset your Ren password" })
      const link = new URL(email.TextBody.slice(email.TextBody.indexOf("http")))
      expect(link.origin + link.pathname).toBe("http://localhost:5173/reset-password")

      const reset = yield* post(auth, "/reset-password", {
        token: link.searchParams.get("token"),
        newPassword: "a brand new password",
      })
      expect(reset.status).toBe(200)
      const signIn = yield* post(auth, "/sign-in/email", {
        email: "katherine@example.org",
        password: "a brand new password",
      })
      expect(signIn.status).toBe(200)
    }),
  )

  it.live("has no user without credentials", () =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service
      expect(Option.isNone(yield* auth.getUser(new Headers()))).toBe(true)
    }),
  )

  it.effect("gives every model a prefixed ID", () =>
    Effect.sync(() => {
      const auth = Auth.make({
        database: drizzle.mock(),
        secret: "unused",
        baseURL: "http://localhost:4000",
        trustedOrigins: [],
        google: { clientId: "unused", clientSecret: "unused" },
        appURL: "http://localhost:5173",
        requireEmailVerification: true,
        sendEmail: () => {},
        signupGuard: {
          checkEmailSignUp: () => Promise.resolve(Option.none()),
          checkAccountCreation: () => Promise.resolve(Option.none()),
        },
      })
      const models = Object.keys(getAuthTables(auth.options))
      const ids = models.map((model) => auth.options.advanced.database.generateId({ model }))
      expect(ids.filter((id) => !/^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toEqual([])
      expect(new Set(ids.map((id) => id.split("_")[0])).size).toBe(models.length)
    }),
  )

  describe("email verification", () => {
    const cookie = (response: Response) => response.headers.getSetCookie().join("; ")

    verifying.live("sends a code on sign-up and signs in once it is verified", () =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const outbox = yield* Postmark.Outbox
        const response = yield* signUp(auth, "mary@example.org")
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

        const verified = yield* post(auth, "/email-otp/verify-email", { email: "mary@example.org", otp })
        expect(verified.status).toBe(200)
        const user = Option.getOrThrow(yield* auth.getUser(new Headers({ cookie: cookie(verified) })))
        expect(user).toMatchObject({ email: "mary@example.org", emailVerified: true })
      }),
    )

    verifying.live("blocks password sign-in until verified and sends a fresh code", () =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const outbox = yield* Postmark.Outbox
        yield* signUp(auth, "dorothy@example.org")
        yield* outbox.next

        const signIn = yield* post(auth, "/sign-in/email", {
          email: "dorothy@example.org",
          password: "correct horse battery staple",
        })
        expect(signIn.status).toBe(403)
        expect((yield* outbox.next).message.Subject).toMatch(/^\d{6} is your Ren verification code$/)
      }),
    )

    verifying.live("signs in an existing user with a one-time code", () =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const outbox = yield* Postmark.Outbox
        yield* signUp(auth, "hedy@example.org")
        yield* outbox.next

        const sent = yield* post(auth, "/email-otp/send-verification-otp", {
          email: "hedy@example.org",
          type: "sign-in",
        })
        expect(sent.status).toBe(200)
        const email = (yield* outbox.next).message
        const otp = email.Subject.split(" ")[0]
        expect(email.Subject).toBe(`${otp} is your Ren sign-in code`)
        expect(email.TextBody).toStartWith(`Use ${otp} to sign in on Ren.`)

        const signIn = yield* post(auth, "/sign-in/email-otp", { email: "hedy@example.org", otp })
        expect(signIn.status).toBe(200)
        expect(Option.isSome(yield* auth.getUser(new Headers({ cookie: cookie(signIn) })))).toBe(true)
      }),
    )

    verifying.live("does not send codes to or create unknown users", () =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const outbox = yield* Postmark.Outbox
        const sent = yield* post(auth, "/email-otp/send-verification-otp", {
          email: "nobody@example.org",
          type: "sign-in",
        })
        expect(sent.status).toBe(200)
        const signIn = yield* post(auth, "/sign-in/email-otp", { email: "nobody@example.org", otp: "123456" })
        expect(signIn.status).toBe(400)

        yield* signUp(auth, "known@example.org")
        expect((yield* outbox.next).message.To).toBe("known@example.org")
      }),
    )

    verifying.live("rejects other code types and the unused code endpoints", () =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const forget = yield* post(auth, "/email-otp/send-verification-otp", {
          email: "ada@example.org",
          type: "forget-password",
        })
        expect(forget.status).toBe(400)
        expect((yield* post(auth, "/email-otp/reset-password", {})).status).toBe(404)
        expect((yield* post(auth, "/forget-password/email-otp", {})).status).toBe(404)
      }),
    )

    it.live("refuses to skip verification in production", () =>
      Effect.gen(function* () {
        const production = layer({ SKIP_EMAIL_VERIFICATION: "true", NODE_ENV: "production" })
        const exit = yield* Effect.gen(function* () {
          return yield* Layer.buildWithMemoMap(production, yield* Layer.makeMemoMap, yield* Effect.scope)
        }).pipe(Effect.scoped, Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )

    verifying.live("does not email a verification code to a verified address", () =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const outbox = yield* Postmark.Outbox
        yield* signUp(auth, "annie@example.org")
        const otp = (yield* outbox.next).message.Subject.split(" ")[0]
        expect((yield* post(auth, "/email-otp/verify-email", { email: "annie@example.org", otp })).status).toBe(200)

        yield* post(auth, "/email-otp/send-verification-otp", {
          email: "annie@example.org",
          type: "email-verification",
        })
        yield* post(auth, "/request-password-reset", { email: "annie@example.org" })
        expect((yield* outbox.next).message.Subject).toBe("Reset your Ren password")
      }),
    )
  })

  describe("signup guard", () => {
    const rejection = Effect.fnUntraced(function* (response: Response) {
      expect(response.status).toBe(400)
      return (yield* Effect.promise(() => response.json())).code
    })

    it.live("rejects email sign-ups the guard refuses, before creating the user", () =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        const database = yield* AuthDatabase.Service
        expect(yield* rejection(yield* signUp(auth, "spam@mailinator.com"))).toBe("DISPOSABLE_EMAIL")
        expect(yield* rejection(yield* signUp(auth, "lost@nowhere.dev"))).toBe("UNDELIVERABLE_EMAIL_DOMAIN")
        expect((yield* signUp(auth, "jdoe@gmail.com")).status).toBe(200)
        expect(yield* rejection(yield* signUp(auth, "j.doe+1@gmail.com"))).toBe("ALIAS_EMAIL")

        const users = yield* Effect.promise(() => database.db.query.user.findMany({ columns: { email: true } }))
        expect(users.map((user) => user.email)).not.toContain("spam@mailinator.com")
      }),
    )

    it.live("rejects disposable domains for accounts created outside email sign-up", () =>
      Effect.gen(function* () {
        const database = yield* AuthDatabase.Service
        const guard = yield* SignupGuard.Service
        const instance = Auth.make({
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
  })
})
