export * as Egress from "./egress.js"

import type { Auth } from "@ren/schema/auth"
import { Workload } from "@ren/schema/workload"
import { Context, DateTime, Effect, Layer, Option, Result } from "effect"
import { CredentialCallers } from "./credential-callers.js"
import { CredentialSource } from "./credential-source.js"
import { Credentials } from "./credentials.js"
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

export interface Interface {
  readonly resolve: (principal: Principal, request: Request) => Effect.Effect<Injection.Reply>
  readonly authenticate: (principal: Principal, proof: CredentialCallers.Proof) => Effect.Effect<Authenticated>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Egress") {}

export const ttlSeconds = 30

const deny = (reason: Injection.DenyReason, label?: string): Injection.Reply =>
  label ? { allow: false, reason, label } : { allow: false, reason }

// oxlint-disable-next-line ren/no-comments -- README §6.3 and C36: who (CredentialCallers), which (Credentials.match), value (CredentialSource), where (Injection.plan). Logs hold labels, never values (C31, C50).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const callers = yield* CredentialCallers.Service
    const credentials = yield* Credentials.Service
    const sources = yield* CredentialSource.Service

    const caller = Effect.fnUntraced(function* (principal: Principal, proof: CredentialCallers.Proof) {
      if (proof.kind === "Login" && principal.kind !== "ren") return Result.fail("unknown_workload" as const)
      const verified = yield* callers.verify(proof)
      if (!verified.ok) return Result.fail(verified.reason)
      if (principal.orgs !== "all" && !principal.orgs.includes(verified.caller.organizationId))
        return Result.fail("principal_scope" as const)
      return Result.succeed(verified.caller)
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
        const matched = Credentials.match(yield* sources.candidates(scope.value), request)
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
        }
      }),
    })
  }),
)
