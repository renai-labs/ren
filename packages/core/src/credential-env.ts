export * as CredentialEnv from "./credential-env.js"

import type { PullEnv } from "@ren/host-api/ren-host-api"
import type { Workload } from "@ren/schema/workload"
import { Context, Effect, Layer, Option, Record } from "effect"
import { AppProfiles } from "./app/profiles.js"
import { Credentials } from "./credentials.js"
import { GitHubApp } from "./github-app.js"
import { PersonCredentials } from "./person-credentials.js"

export interface Interface {
  readonly of: (workload: Workload.Info) => Effect.Effect<PullEnv>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialEnv") {}

const none: PullEnv = { variables: {}, placeholders: {} }

export const layerNone = Layer.succeed(Service, Service.of({ of: () => Effect.succeed(none) }))

// oxlint-disable-next-line ren/no-comments -- A name in the later env wins over the same name in the earlier one, in either list.
const merged = (earlier: PullEnv, later: PullEnv): PullEnv => ({
  variables: { ...Record.filter(earlier.variables, (_, name) => !(name in later.placeholders)), ...later.variables },
  placeholders: {
    ...Record.filter(earlier.placeholders, (_, name) => !(name in later.variables)),
    ...later.placeholders,
  },
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const credentials = yield* Credentials.Service
    const profiles = yield* AppProfiles.Service
    const github = yield* GitHubApp.Service
    const people = yield* PersonCredentials.Service
    return Service.of({
      of: Effect.fn("CredentialEnv.of")(function* (workload: Workload.Info) {
        const scope = yield* credentials.scopeOf(workload)
        if (Option.isNone(scope)) return none
        const reached = yield* profiles.reachable(scope.value)
        const organizationId = scope.value.organizationId
        const person = yield* Option.match(scope.value.person, {
          onNone: () => Effect.succeedNone,
          onSome: (userId) => people.account(organizationId, userId, GitHubApp.label),
        })
        const installed = Option.isSome(yield* github.installationOf(organizationId))
        return merged(
          Option.match(github.client, {
            onNone: () => none,
            onSome: (client) =>
              installed || Option.isSome(person) ? GitHubApp.variables(client.settings, person) : none,
          }),
          yield* credentials.environment(
            scope.value,
            reached.map((profile) => profile.id),
          ),
        )
      }),
    })
  }),
)
