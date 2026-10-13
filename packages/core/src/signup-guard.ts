export * as SignupGuard from "./signup-guard.js"

import { promises } from "node:dns"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { disposableEmailBlocklistSet } from "disposable-email-domains-js"
import { sql } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"

export interface Rejection {
  readonly code: string
  readonly message: string
}

export interface Resolver {
  readonly resolveMx: (domain: string) => Promise<ReadonlyArray<{ readonly exchange: string }>>
  readonly resolve4: (domain: string) => Promise<ReadonlyArray<string>>
  readonly resolve6: (domain: string) => Promise<ReadonlyArray<string>>
}

export interface Interface {
  readonly checkEmailSignUp: (email: string) => Effect.Effect<Option.Option<Rejection>>
  readonly hasVerifiedAlias: (email: string) => Effect.Effect<boolean>
  readonly checkAccountCreation: (email: string) => Effect.Effect<Option.Option<Rejection>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SignupGuard") {}

const rejections = {
  disposable: { code: "DISPOSABLE_EMAIL", message: "Use a permanent email address." },
  undeliverable: {
    code: "UNDELIVERABLE_EMAIL_DOMAIN",
    message: "This email domain can’t receive email. Check the address and try again.",
  },
} satisfies Record<string, Rejection>

const gmailDomains = ["gmail.com", "googlemail.com"]

const missing = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"])

const ErrorCode = Schema.Struct({ code: Schema.Unknown })

const lookup = <A>(resolve: () => Promise<A>) =>
  Effect.tryPromise({
    try: resolve,
    catch: (error) => (Schema.is(ErrorCode)(error) ? String(error.code) : ""),
  })

const parentDomains = (domain: string) => {
  const labels = domain.split(".")
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join("."))
}

export const make = Effect.fnUntraced(function* (resolver: Resolver) {
  const database = yield* Database.Service
  const config = yield* Config.all({
    checkMailServer: Config.Boolean("SIGNUP_MX_CHECK").pipe(Config.withDefault(true)),
    blocked: Config.Array(Schema.String, "SIGNUP_BLOCKED_DOMAINS").pipe(Config.withDefault([])),
    allowed: Config.Array(Schema.String, "SIGNUP_ALLOWED_DOMAINS").pipe(Config.withDefault([])),
  })
  const blocked = new Set(config.blocked.map((domain) => domain.trim().toLowerCase()))
  const allowed = new Set(config.allowed.map((domain) => domain.trim().toLowerCase()))
  const disposable = disposableEmailBlocklistSet()

  const isAllowed = (domain: string) => parentDomains(domain).some((candidate) => allowed.has(candidate))
  const isDisposable = (domain: string) => {
    if (isAllowed(domain)) return false
    const candidates = parentDomains(domain)
    return candidates.some((candidate) => blocked.has(candidate) || disposable.has(candidate))
  }

  const hasAddress = (domain: string) =>
    Effect.forEach([resolver.resolve4, resolver.resolve6], (resolve) =>
      lookup(() => resolve(domain)).pipe(
        Effect.map((addresses) => addresses.length > 0),
        Effect.catch((code) => Effect.succeed(!missing.has(code))),
      ),
    ).pipe(Effect.map((results) => results.some(Boolean)))

  const canReceiveMail = (domain: string) =>
    lookup(() => resolver.resolveMx(domain)).pipe(
      Effect.flatMap((records) =>
        records.length === 0
          ? hasAddress(domain)
          : Effect.succeed(!records.every((record) => record.exchange === "" || record.exchange === ".")),
      ),
      Effect.catch((code) => {
        if (!missing.has(code)) return Effect.succeed(true)
        return code === "ENODATA" ? hasAddress(domain) : Effect.succeed(false)
      }),
      Effect.timeoutOption("1500 millis"),
      Effect.map(Option.getOrElse(() => true)),
    )

  return Service.of({
    checkEmailSignUp: Effect.fn("SignupGuard.checkEmailSignUp")(function* (email: string) {
      const domain = Auth.emailDomain(email)
      if (isDisposable(domain)) return Option.some(rejections.disposable)
      if (!isAllowed(domain) && config.checkMailServer && !(yield* canReceiveMail(domain))) {
        return Option.some(rejections.undeliverable)
      }
      return Option.none()
    }),
    hasVerifiedAlias: Effect.fn("SignupGuard.hasVerifiedAlias")(function* (email: string) {
      const normalized = Auth.normalizeEmail(email)
      const domain = Auth.emailDomain(normalized)
      const local = normalized.slice(0, normalized.lastIndexOf("@")).replace(/\+.*/, "")
      const canonical = gmailDomains.includes(domain) ? `${local.replaceAll(".", "")}@gmail.com` : `${local}@${domain}`
      const gmailDomainList = sql.join(
        gmailDomains.map((gmailDomain) => sql`${gmailDomain}`),
        sql`, `,
      )
      const userLocal = sql`split_part(split_part(lower(${Database.Schema.user.email}), '@', 1), '+', 1)`
      const userDomain = sql`split_part(lower(${Database.Schema.user.email}), '@', 2)`
      const rows = yield* database.db
        .select({ id: Database.Schema.user.id })
        .from(Database.Schema.user)
        .where(
          sql`${Database.Schema.user.emailVerified} = true and
            case when ${userDomain} in (${gmailDomainList})
              then replace(${userLocal}, '.', '') || '@gmail.com'
              else ${userLocal} || '@' || ${userDomain} end = ${canonical}`,
        )
        .limit(1)
      return rows.length > 0
    }, Effect.orDie),
    checkAccountCreation: Effect.fn("SignupGuard.checkAccountCreation")(function* (email: string) {
      return isDisposable(Auth.emailDomain(email)) ? Option.some(rejections.disposable) : Option.none()
    }),
  })
})

export const layer = Layer.effect(Service, make(promises))
