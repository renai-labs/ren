export * as ProviderConnect from "./connect.js"

import { Database } from "@ren/db/database"
import type { AppProfile } from "@ren/schema/app-profile"
import type { Auth } from "@ren/schema/auth"
import type { Credential } from "@ren/schema/credential"
import { OAuthSession } from "@ren/schema/oauth-session"
import { eq } from "drizzle-orm"
import { Clock, Context, DateTime, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import { CredentialRefresh } from "../credential-refresh.js"
import { SignIn } from "../credential/sign-in.js"
import { Credentials } from "../credentials.js"
import { EgressControl } from "../egress-control.js"
import { Envelope } from "../envelope.js"
import { McpProvider } from "../mcp-provider.js"
import { Primitive } from "../primitive.js"

export interface Start {
  readonly organizationId: Auth.OrganizationID
  readonly initiator: Auth.UserID
  readonly profileId: AppProfile.ID
  readonly credentialId: Credential.ID
  readonly label: string
  readonly name: string
  readonly madeFor: string
  readonly provider: Credential.Provider
  readonly integration: string
  readonly state: string
  readonly callbackUrl: string
}

export interface Interface {
  readonly start: (
    input: Start,
  ) => Effect.Effect<{ readonly redirectUrl: string; readonly expiresAt: DateTime.Utc }, Primitive.Invalid>
  readonly finish: (taken: SignIn.Session) => Effect.Effect<Result.Result<string, string>>
  readonly abandon: (taken: SignIn.Session) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ProviderConnect") {}

const Pending = Schema.Struct({
  kind: Schema.Literal("provider"),
  provider: Schema.String,
  integration: Schema.String,
  account: Schema.String,
})
export const decodePending = Schema.decodeUnknownOption(Pending)

const SealedJson = Schema.fromJsonString(Credentials.Sealed)

const sessions = Database.Schema.oauth_session
const credentials = Database.Schema.credential

// oxlint-disable-next-line ren/no-comments -- connections.md §10 rules 4, 5 and 8 (K22, K23, K26), profiles.md §14: the provider's user is the credential id; its connect link returns to Ren's callback with `state`. At the callback, wait until the account is active, open its state, save on the same row, then clean up what the save replaced. An account that never gets active, or a save that another connect won, is cleaned up too.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const envelope = yield* Envelope.Service
    const control = yield* EgressControl.Service
    const registry = yield* McpProvider.Registry
    const cleanup = yield* McpProvider.Cleanup

    const abandon = (taken: SignIn.Session) =>
      Option.match(decodePending(taken.discovery_state), {
        onNone: () => Effect.void,
        onSome: (pending) => cleanup.start({ provider: pending.provider, account: pending.account }),
      })

    return Service.of({
      start: Effect.fn("ProviderConnect.start")(function* (input: Start) {
        const provider = yield* registry
          .get(input.provider)
          .pipe(
            Effect.mapError(
              (error) => new Primitive.Invalid({ message: `${error.message} (McpProvider.Unavailable).` }),
            ),
          )
        const expiresAt = new Date((yield* Clock.currentTimeMillis) + OAuthSession.lifetimeMinutes * 60_000)
        const link = yield* provider
          .connect({
            credentialId: input.credentialId,
            integration: input.integration,
            callbackUrl: `${input.callbackUrl}?state=${input.state}`,
          })
          .pipe(Effect.mapError((error) => new Primitive.Invalid({ message: error.message })))
        yield* database.db
          .insert(sessions)
          .values({
            id: OAuthSession.ID.create(),
            organization_id: input.organizationId,
            credential_id: input.credentialId,
            profile_id: input.profileId,
            label: input.label,
            name: input.name,
            hosts: [],
            made_for: input.madeFor,
            initiator_user_id: input.initiator,
            state: input.state,
            discovery_state: {
              kind: "provider",
              provider: input.provider,
              integration: input.integration,
              account: link.account,
            } satisfies typeof Pending.Type,
            expires_at: expiresAt,
          })
          .pipe(Effect.orDie)
        return { redirectUrl: link.redirectUrl, expiresAt: DateTime.fromDateUnsafe(expiresAt) }
      }),

      abandon,

      finish: Effect.fn("ProviderConnect.finish")(function* (taken: SignIn.Session) {
        const pending = decodePending(taken.discovery_state)
        if (Option.isNone(pending)) return Result.fail("The sign-in session is damaged.")
        const found = yield* registry.get(pending.value.provider).pipe(Effect.option)
        if (Option.isNone(found))
          return Result.fail(`The provider ${pending.value.provider} is not set up on this Ren.`)
        const provider = found.value
        const finished = yield* Effect.gen(function* () {
          if (!(yield* McpProvider.waitActive(provider, pending.value.account)))
            return Result.fail("The provider did not finish the connection.")
          const state = yield* provider.open({
            credentialId: taken.credential_id,
            integration: pending.value.integration,
            account: pending.value.account,
          })
          const before = (yield* database.db
            .select({ value: credentials.value, account: credentials.provider_account_id })
            .from(credentials)
            .where(eq(credentials.id, taken.credential_id))
            .pipe(Effect.orDie)).at(0)
          const previous = before
            ? Schema.decodeUnknownOption(SealedJson)(
                Redacted.value(
                  yield* envelope
                    .open(before.value, {
                      organizationId: taken.organization_id,
                      kind: "credential",
                      id: taken.credential_id,
                    })
                    .pipe(Effect.orDie),
                ),
              )
            : Option.none()
          const route = yield* provider.route(state)
          const sealed = yield* envelope
            .seal(Redacted.make(Schema.encodeSync(SealedJson)({ type: "route", state })), {
              organizationId: taken.organization_id,
              kind: "credential",
              id: taken.credential_id,
            })
            .pipe(Effect.orDie)
          const saved = yield* SignIn.save(database.db, taken, {
            type: "route",
            value: sealed,
            hosts: [new URL(Redacted.value(route.upstream)).hostname],
            inject: { op: "route" },
            provider: provider.id,
            providerAccountId: pending.value.account,
          })
          if (Result.isFailure(saved)) {
            yield* cleanup.start({ provider: provider.id, state, account: pending.value.account })
            return saved
          }
          yield* control.invalidate({ label: taken.label })
          const old = Option.getOrUndefined(
            Option.flatMap(previous, (value) => (value.type === "route" ? Option.some(value.state) : Option.none())),
          )
          yield* cleanup.start({
            provider: provider.id,
            state: old,
            ...(before?.account && before.account !== pending.value.account && { account: before.account }),
          })
          return saved
        }).pipe(Effect.catchTag("McpProvider.Failed", (error) => Effect.succeed(Result.fail(error.message))))
        if (Result.isFailure(finished)) yield* abandon(taken)
        return finished
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- connections.md §10 rule 11 (K29): after a 401, the provider renews the state for the same account, and Ren cleans up the old state after the save. A failed renew is fatal.
export const layerRefresher = Layer.effect(
  CredentialRefresh.Refreshers,
  Effect.gen(function* () {
    const registry = yield* McpProvider.Registry
    const cleanup = yield* McpProvider.Cleanup
    const others = yield* CredentialRefresh.Refreshers
    const route: CredentialRefresh.Refresher = {
      refresh: Effect.fnUntraced(function* (current) {
        const value = current.value
        if (value.type !== "route" || Option.isNone(current.provider)) return Option.none()
        const provider = yield* registry
          .get(current.provider.value)
          .pipe(Effect.mapError((error) => new CredentialRefresh.Transient({ message: error.message })))
        const renewed = yield* provider
          .renew(value.state)
          .pipe(
            Effect.mapError((error) =>
              error.isFatal
                ? new CredentialRefresh.Fatal({ message: error.message })
                : new CredentialRefresh.Transient({ message: error.message }),
            ),
          )
        return Option.some({
          value: { type: "route", state: renewed },
          expiresAt: Option.none(),
          saved: cleanup.start({ provider: provider.id, state: value.state }),
        })
      }),
    }
    return new Map([...others, ["route", route]])
  }),
)
