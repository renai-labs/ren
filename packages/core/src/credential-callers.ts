export * as CredentialCallers from "./credential-callers.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Signature } from "@ren/schema/signature"
import { Workload } from "@ren/schema/workload"
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm"
import { Clock, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Random } from "@ren/util/random"
import { Envelope } from "./envelope.js"
import { Signer } from "./signer.js"

export type ProofKind = "ProxyLogin" | "Token"

export interface Caller {
  readonly workload: Workload.Info
  readonly organizationId: Auth.OrganizationID
}

export type Placement =
  | { readonly kind: "ProxyLogin"; readonly username: string; readonly password: Redacted.Redacted }
  | { readonly kind: "Token"; readonly token: Redacted.Redacted; readonly exp: number }

// oxlint-disable-next-line ren/no-comments -- `Login` is a proxy login that the egress already checked with `ProxyLogin` when the connection opened; the password is not sent again (iron-proxy fork change 2). Only Ren's own egress may send it.
export type Proof =
  | { readonly kind: "ProxyLogin"; readonly username: string; readonly password: Redacted.Redacted }
  | { readonly kind: "Login"; readonly username: string }
  | { readonly kind: "Token"; readonly token: string }

export type Verified =
  | { readonly ok: true; readonly caller: Caller }
  | { readonly ok: false; readonly reason: "unknown_workload" | "generation_retired" }

export interface Interface {
  readonly issue: (caller: Caller, kind: ProofKind) => Effect.Effect<Placement>
  readonly verify: (proof: Proof) => Effect.Effect<Verified>
  readonly placement: (caller: Caller) => Effect.Effect<Option.Option<Placement>>
  readonly revoke: (workload: {
    readonly kind: Workload.Kind
    readonly id: string
  }) => Effect.Effect<{ readonly logins: ReadonlyArray<string> }>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialCallers") {}

export const tokenLifetimeSeconds = 60 * 60

const TokenClaims = Schema.Struct({
  kid: Schema.NonEmptyString,
  scope: Schema.Literal("caller"),
  kind: Workload.Kind,
  id: Schema.String,
  gen: Schema.Int,
  org: Auth.OrganizationID,
  exp: Schema.Int,
})

const table = Database.Schema.credential_caller

const hash = (password: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(password))).pipe(
    Effect.map((digest) => Buffer.from(digest).toString("hex")),
  )

// oxlint-disable-next-line ren/no-comments -- One row per workload and generation. Issuing a generation revokes the older ones of that workload, so a replaced machine's proof fails at once with generation_retired (§8 Replace).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const signer = yield* Signer.Service
    const envelope = yield* Envelope.Service
    const contextOf = (caller: Caller): Envelope.Context => ({
      organizationId: caller.organizationId,
      kind: "credential_caller",
      id: Workload.key(caller.workload),
    })
    const decodeWorkload = Schema.decodeUnknownOption(Workload.Info)

    const retired = Effect.fnUntraced(function* (workload: Workload.Info) {
      const rows = yield* database.db
        .select({ generation: table.generation, revokedAt: table.revoked_at })
        .from(table)
        .where(and(eq(table.workload_kind, workload.kind), eq(table.workload_id, workload.id)))
        .orderBy(desc(table.generation))
        .limit(1)
        .pipe(Effect.orDie)
      const newest = rows.at(0)
      return !newest || newest.generation > workload.generation || Boolean(newest.revokedAt)
    })

    return Service.of({
      issue: Effect.fn("CredentialCallers.issue")(function* (caller: Caller, kind: ProofKind) {
        const login =
          kind === "ProxyLogin" ? { username: `ren-${Random.token(12)}`, password: Random.token(32) } : undefined
        const passwordHash = login ? yield* hash(login.password) : null
        // oxlint-disable-next-line ren/no-comments -- The provider needs the login again on every resume and network update (C38); Ren keeps it sealed, and checks proofs against the hash.
        const passwordSealed = login
          ? yield* envelope.seal(Redacted.make(login.password), contextOf(caller)).pipe(Effect.orDie)
          : null
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction
              .update(table)
              .set({ revoked_at: sql`now()` })
              .where(
                and(
                  eq(table.workload_kind, caller.workload.kind),
                  eq(table.workload_id, caller.workload.id),
                  lt(table.generation, caller.workload.generation),
                  isNull(table.revoked_at),
                ),
              )
            yield* transaction
              .insert(table)
              .values({
                workload_kind: caller.workload.kind,
                workload_id: caller.workload.id,
                generation: caller.workload.generation,
                organization_id: caller.organizationId,
                proof_kind: kind,
                username: login?.username ?? null,
                password_hash: passwordHash,
                password_sealed: passwordSealed,
              })
              .onConflictDoUpdate({
                target: [table.workload_kind, table.workload_id, table.generation],
                set: {
                  proof_kind: kind,
                  username: login?.username ?? null,
                  password_hash: passwordHash,
                  password_sealed: passwordSealed,
                  revoked_at: null,
                },
              })
          }),
        )
        if (login) return { kind: "ProxyLogin", username: login.username, password: Redacted.make(login.password) }
        const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + tokenLifetimeSeconds
        const token = yield* signer
          .sign("brain", {
            scope: "caller",
            kind: caller.workload.kind,
            id: caller.workload.id,
            gen: caller.workload.generation,
            org: caller.organizationId,
            exp,
          })
          .pipe(Effect.orDie)
        return { kind: "Token", token: Redacted.make(token), exp }
      }),

      verify: Effect.fn("CredentialCallers.verify")(function* (proof: Proof) {
        const unknown = { ok: false, reason: "unknown_workload" } as const
        if (proof.kind === "Token") {
          const keys = yield* signer.publicKeys("brain").pipe(Effect.orDie)
          const claims = yield* Signature.verify(keys, TokenClaims, proof.token)
          if (Option.isNone(claims)) return unknown
          const workload = decodeWorkload({
            kind: claims.value.kind,
            id: claims.value.id,
            generation: claims.value.gen,
          })
          if (Option.isNone(workload)) return unknown
          if (yield* retired(workload.value)) return { ok: false, reason: "generation_retired" } as const
          return { ok: true, caller: { workload: workload.value, organizationId: claims.value.org } } as const
        }
        const rows = yield* database.db
          .select()
          .from(table)
          .where(eq(table.username, proof.username))
          .pipe(Effect.orDie)
        const row = rows.at(0)
        if (!row) return unknown
        if (proof.kind === "ProxyLogin" && row.password_hash !== (yield* hash(Redacted.value(proof.password))))
          return unknown
        const workload = decodeWorkload({ kind: row.workload_kind, id: row.workload_id, generation: row.generation })
        if (Option.isNone(workload)) return unknown
        if (yield* retired(workload.value)) return { ok: false, reason: "generation_retired" } as const
        return { ok: true, caller: { workload: workload.value, organizationId: row.organization_id } } as const
      }),

      placement: Effect.fn("CredentialCallers.placement")(function* (caller: Caller) {
        const rows = yield* database.db
          .select()
          .from(table)
          .where(
            and(
              eq(table.workload_kind, caller.workload.kind),
              eq(table.workload_id, caller.workload.id),
              eq(table.generation, caller.workload.generation),
              isNull(table.revoked_at),
            ),
          )
          .pipe(Effect.orDie)
        const row = rows.at(0)
        if (!row?.username || !row.password_sealed) return Option.none()
        const password = yield* envelope.open(row.password_sealed, contextOf(caller)).pipe(Effect.orDie)
        return Option.some({ kind: "ProxyLogin", username: row.username, password } satisfies Placement)
      }),

      revoke: Effect.fn("CredentialCallers.revoke")(function* (workload) {
        const rows = yield* database.db
          .update(table)
          .set({ revoked_at: sql`now()`, address: null })
          .where(
            and(eq(table.workload_kind, workload.kind), eq(table.workload_id, workload.id), isNull(table.revoked_at)),
          )
          .returning({ username: table.username })
          .pipe(Effect.orDie)
        return { logins: rows.flatMap((row) => (row.username ? [row.username] : [])) }
      }),
    })
  }),
)
