export * as Egress from "./egress.js"

import type { Auth } from "@ren/schema/auth"
import { Credential } from "@ren/schema/credential"
import { Workload } from "@ren/schema/workload"
import { Context, DateTime, Effect, Layer, Option, Result, Schema } from "effect"
import { AppProfiles } from "./app/profiles.js"
import { CredentialCallers } from "./credential-callers.js"
import { CredentialRefresh } from "./credential-refresh.js"
import { CredentialSource } from "./credential-source.js"
import { Credentials } from "./credentials.js"
import { EgressControl } from "./egress-control.js"
import { Injection } from "./injection.js"

// oxlint-disable-next-line ren/no-comments -- Ren's own egress authenticates with mTLS and may name a connection by the login it checked (`Login` proof). Another proxy is limited to its orgs (README §6.6).
export interface Principal {
  readonly kind: "ren" | "registered"
  readonly orgs: "all" | ReadonlyArray<Auth.OrganizationID>
}

export interface Request {
  readonly proof: CredentialCallers.Proof
  readonly host: string
  readonly port: number
  readonly method: string
  readonly path: string
  readonly placeholders: ReadonlyArray<string>
  readonly ops: ReadonlyArray<Injection.OpName>
}

export type Authenticated =
  | { readonly ok: true; readonly workload: string }
  | { readonly ok: false; readonly reason: "unknown_workload" | "generation_retired" | "principal_scope" }

// oxlint-disable-next-line ren/no-comments -- What an egress reports after an upstream answered 401, or 403 with `insufficient_scope`, to a request with refreshable labels (§6.3, K44).
export interface Report {
  readonly login: string
  readonly host: string
  readonly status: 401 | 403
  readonly scope?: string
  readonly labels: ReadonlyArray<{ readonly label: string; readonly revision: number }>
}

export interface Interface {
  readonly resolve: (principal: Principal, request: Request) => Effect.Effect<Injection.Reply>
  readonly unauthorized: (principal: Principal, report: Report) => Effect.Effect<void>
  readonly authenticate: (principal: Principal, proof: CredentialCallers.Proof) => Effect.Effect<Authenticated>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Egress") {}

export const ttlSeconds = 30

const deny = (reason: Injection.DenyReason, label?: string): Injection.Reply =>
  label ? { allow: false, reason, label } : { allow: false, reason }

// oxlint-disable-next-line ren/no-comments -- README §6.3 and C36: who (CredentialCallers), what it reaches (AppProfiles), which (Credentials.match), value (CredentialSource), where (Injection.plan). Logs hold labels, never values (C31, C50).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const callers = yield* CredentialCallers.Service
    const credentials = yield* Credentials.Service
    const sources = yield* CredentialSource.Service
    const refresh = yield* CredentialRefresh.Service
    const control = yield* EgressControl.Service
    const profiles = yield* AppProfiles.Service

    // oxlint-disable-next-line ren/no-comments -- profiles.md §13 rule 1 (P41): reach decides which profiles' credentials are candidates; Credentials never reads reach.
    const candidatesOf = Effect.fnUntraced(function* (scope: Credentials.Scope) {
      const reached = yield* profiles.reachable(scope)
      return yield* sources.candidates(
        scope,
        reached.map((profile) => profile.id),
      )
    })

    const caller = Effect.fnUntraced(function* (principal: Principal, proof: CredentialCallers.Proof) {
      if (proof.kind === "Login" && principal.kind !== "ren") return Result.fail("unknown_workload" as const)
      const verified = yield* callers.verify(proof)
      if (!verified.ok) return Result.fail(verified.reason)
      if (principal.orgs !== "all" && !principal.orgs.includes(verified.caller.organizationId))
        return Result.fail("principal_scope" as const)
      return Result.succeed(verified.caller)
    })

    const wantScopes = (candidate: Credentials.Candidate, scope: string | undefined) =>
      candidate.type === "oauth" && Schema.is(Credential.ID)(candidate.id) && scope
        ? credentials.addWantedScopes(
            candidate.id,
            scope.split(" ").filter((part) => part.length > 0),
          )
        : Effect.void

    const renew = Effect.fnUntraced(function* (
      candidate: Credentials.Candidate,
      reported: { readonly label: string; readonly revision: number },
      scope: Credentials.Scope,
    ) {
      if (candidate.source === "minted") {
        yield* sources.forget(candidate, scope)
        return yield* control.invalidate({ label: reported.label })
      }
      if (!Schema.is(Credential.ID)(candidate.id)) return
      if (candidate.revision !== reported.revision) return yield* control.invalidate({ label: reported.label })
      if (!(yield* credentials.claimUnauthorized(candidate.id, reported.revision))) {
        yield* Effect.logInfo(`Credential ${reported.label} refreshed after a 401 less than 5 minutes ago`)
        return
      }
      yield* refresh.refresh(candidate.id, { revision: reported.revision })
    })

    return Service.of({
      authenticate: Effect.fn("Egress.authenticate")(function* (principal: Principal, proof: CredentialCallers.Proof) {
        const found = yield* caller(principal, proof)
        if (Result.isFailure(found)) return { ok: false, reason: found.failure }
        return { ok: true, workload: Workload.key(found.success.workload) }
      }),

      resolve: Effect.fn("Egress.resolve")(function* (principal: Principal, request: Request) {
        const found = yield* caller(principal, request.proof)
        if (Result.isFailure(found)) return deny(found.failure)
        const scope = yield* credentials.scopeOf(found.success.workload)
        if (Option.isNone(scope)) return deny("unknown_workload")
        const workload = Workload.key(found.success.workload)
        const matched = Credentials.match(yield* candidatesOf(scope.value), request)
        if (!matched.ok) {
          yield* Effect.logInfo("Egress denied a request").pipe(
            Effect.annotateLogs({ workload, host: request.host, reason: matched.reason, label: matched.label ?? "" }),
          )
          return deny(matched.reason, matched.label)
        }
        const planned: Array<Injection.Op> = []
        const expiries: Array<number> = []
        for (const match of matched.matches) {
          const label = match.candidate.label
          if (match.candidate.status === "reconnect") return deny("credential_reconnect", label)
          const value = yield* sources
            .value(match.candidate, scope.value)
            .pipe(Effect.option, Effect.map(Option.flatten))
          if (Option.isNone(value)) return deny("credential_missing", label)
          if (value.value.expiresAt) expiries.push(Math.floor(DateTime.toEpochMillis(value.value.expiresAt) / 1000))
          const ops = Injection.plan(match.candidate, value.value.value, match.placeholder)
          if (Result.isFailure(ops)) {
            yield* Effect.logWarning(`Credential ${label} holds a value that cannot go into a header`).pipe(
              Effect.annotateLogs({ workload, host: request.host, label }),
            )
            return deny("credential_missing", label)
          }
          if (ops.success.some((op) => !request.ops.includes(op.op))) return deny("egress_outdated", label)
          planned.push(...ops.success)
        }
        yield* Effect.logInfo("Egress injected credentials").pipe(
          Effect.annotateLogs({
            workload,
            host: request.host,
            labels: matched.matches.map((match) => match.candidate.label).join(","),
          }),
        )
        return {
          allow: true,
          workload,
          ttl: ttlSeconds,
          ...(expiries.length > 0 && { expiresAt: Math.min(...expiries) }),
          labels: [...new Set(matched.matches.map((match) => match.candidate.label))],
          inject: planned,
          refreshable: [
            ...new Map(
              matched.matches.flatMap((match) =>
                typeof match.candidate.revision !== "number"
                  ? []
                  : [[match.candidate.label, { label: match.candidate.label, revision: match.candidate.revision }]],
              ),
            ).values(),
          ],
        }
      }),

      // oxlint-disable-next-line ren/no-comments -- §9: Ren finds each label as a resolve would. A newer stored revision means the 401 belongs to a value that is gone, so only the caches clear (U1). The same revision refreshes once per 5 minutes; a 401 never changes the status (K18). A 403 on a sign-in records the wanted scopes (K47).
      unauthorized: Effect.fn("Egress.unauthorized")(function* (principal: Principal, report: Report) {
        const found = yield* caller(principal, { kind: "Login", username: report.login })
        if (Result.isFailure(found)) {
          yield* Effect.logInfo("Egress reported a 401 for an unknown login").pipe(
            Effect.annotateLogs({ reason: found.failure }),
          )
          return
        }
        const scope = yield* credentials.scopeOf(found.success.workload)
        if (Option.isNone(scope)) return
        const candidates = yield* candidatesOf(scope.value)
        yield* Effect.forEach(
          report.labels,
          (reported) => {
            const matched = Credentials.match(candidates, {
              host: report.host,
              placeholders: [Credential.placeholder(reported.label)],
            })
            const candidate = matched.ok ? matched.matches.at(0)?.candidate : undefined
            if (typeof candidate?.revision !== "number") return Effect.void
            return Effect.logInfo(`Upstream ${report.host} answered ${report.status} for ${reported.label}`).pipe(
              Effect.andThen(
                report.status === 403
                  ? wantScopes(candidate, report.scope)
                  : renew(candidate, { label: reported.label, revision: reported.revision }, scope.value),
              ),
            )
          },
          { discard: true },
        )
      }),
    })
  }),
)
