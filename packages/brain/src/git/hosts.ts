export * as GitHosts from "./hosts.js"

import { GitHost } from "@ren/schema/git-host"
import { Duration, Effect, Option, Schema } from "effect"
import type { LsRefs } from "./ls-refs.js"

export interface Repository {
  readonly kind: GitHost.Kind
  readonly host: string
  readonly path: ReadonlyArray<string>
}

export const nameOf = (repository: Repository) => repository.path.join("/")

export interface Archive {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export interface Lookup {
  readonly repository: Repository
  readonly commit: string
  readonly access: LsRefs.Access
  readonly archive: Archive
}

export class Failed extends Schema.TaggedError<Failed>()("GitHosts.Failed", {
  reason: GitHost.Reason,
  name: Schema.String,
  detail: Schema.optionalKey(Schema.String),
  message: Schema.String,
}) {}

export const failed = (unavailable: GitHost.Unavailable) =>
  new Failed({ ...unavailable, message: GitHost.message(unavailable) })

export const answerWithin = Duration.seconds(15)

// oxlint-disable-next-line ren/no-comments -- R35: the limit is inside each read, so a slow host fails the read and a cache keeps its last good result (a caller that stops waiting would remove the cache entry).
export const within = (name: string) =>
  Effect.timeoutOrElse({
    duration: answerWithin,
    orElse: () => Effect.fail(failed({ reason: "timeout", name, detail: Duration.format(answerWithin) })),
  })

// oxlint-disable-next-line ren/no-comments -- R51: one git host, such as GitHub. A second host is a new implementation of this interface.
export interface Host {
  readonly kind: GitHost.Kind
  readonly name: Effect.Effect<string>
  readonly repositoryOf: (url: string) => Effect.Effect<Option.Option<Repository>>
  readonly lookup: (repository: Repository, url: string, ref?: string) => Effect.Effect<Lookup, Failed>
  readonly read: (lookup: Lookup, file: string) => Effect.Effect<Option.Option<string>, Failed>
}

export interface Interface {
  readonly lookup: (url: string, ref?: string) => Effect.Effect<Lookup, Failed>
  readonly read: (lookup: Lookup, file: string) => Effect.Effect<Option.Option<string>, Failed>
}

export const make = (hosts: ReadonlyArray<Host>): Interface => {
  const byKind = new Map(hosts.map((host) => [host.kind, host]))
  return {
    lookup: Effect.fn("GitHosts.lookup")(function* (url: string, ref?: string) {
      for (const host of hosts) {
        const repository = yield* host.repositoryOf(url)
        if (Option.isSome(repository)) return yield* host.lookup(repository.value, url, ref)
      }
      const names = yield* Effect.forEach(hosts, (host) => host.name)
      return yield* failed({ reason: "other_host", name: url, detail: names.join(" or ") })
    }),
    read: (lookup, file) => {
      const host = byKind.get(lookup.repository.kind)
      return host
        ? host.read(lookup, file)
        : Effect.fail(failed({ reason: "other_host", name: nameOf(lookup.repository), detail: lookup.repository.host }))
    },
  }
}
