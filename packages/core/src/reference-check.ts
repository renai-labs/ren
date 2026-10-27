export * as ReferenceCheck from "./reference-check.js"

import type { Auth } from "@ren/schema/auth"
import { GitHost } from "@ren/schema/git-host"
import type { Reference } from "@ren/schema/reference"
import { Context, Effect, Layer, Option } from "effect"
import { Primitive } from "./primitive.js"
import { RepositoryHosts } from "./repository-hosts.js"

export interface Interface {
  readonly check: (
    organizationId: Auth.OrganizationID,
    previous: Reference.List,
    next: Reference.List,
  ) => Effect.Effect<void, Primitive.Invalid>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ReferenceCheck") {}

export const layerNone = Layer.succeed(Service, Service.of({ check: () => Effect.void }))

// oxlint-disable-next-line ren/no-comments -- R13, R26, R58: a save asks the host of each new reference whether the org can read it. A URL that no host owns is refused.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hosts = yield* RepositoryHosts.Service
    return Service.of({
      check: Effect.fn("ReferenceCheck.check")(function* (
        organizationId: Auth.OrganizationID,
        previous: Reference.List,
        next: Reference.List,
      ) {
        const known = new Set(previous.map((reference) => reference.repository))
        yield* Effect.forEach(
          next.filter((reference) => !known.has(reference.repository)),
          Effect.fnUntraced(function* (reference) {
            const url = new URL(reference.repository)
            const unavailable = yield* Option.match(hosts.hostOf(url), {
              onNone: () =>
                Effect.succeed(
                  Option.some<GitHost.Unavailable>({
                    reason: "other_host",
                    name: reference.repository,
                    detail: hosts.hosts.map((host) => host.host).join(" or "),
                  }),
                ),
              onSome: (host) => host.check(organizationId, url),
            })
            if (Option.isSome(unavailable))
              return yield* new Primitive.Invalid({
                message: GitHost.message(unavailable.value),
                field: `references.${reference.alias}`,
              })
          }),
          { concurrency: 4, discard: true },
        )
      }),
    })
  }),
)
