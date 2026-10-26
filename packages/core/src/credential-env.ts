export * as CredentialEnv from "./credential-env.js"

import type { Workload } from "@ren/schema/workload"
import { Context, Effect, Layer, Option } from "effect"
import { AppProfiles } from "./app/profiles.js"
import { Credentials } from "./credentials.js"
import { GitHubApp } from "./github-app.js"
import { PersonCredentials } from "./person-credentials.js"

export interface Interface {
  readonly of: (workload: Workload.Info) => Effect.Effect<Readonly<Record<string, string>>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialEnv") {}

export const layerNone = Layer.succeed(Service, Service.of({ of: () => Effect.succeed({}) }))

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
        if (Option.isNone(scope)) return {}
        const reached = yield* profiles.reachable(scope.value)
        const organizationId = scope.value.organizationId
        const person = yield* Option.match(scope.value.person, {
          onNone: () => Effect.succeedNone,
          onSome: (userId) => people.account(organizationId, userId, GitHubApp.label),
        })
        const installed = Option.isSome(yield* github.installationOf(organizationId))
        return {
          ...Option.match(github.client, {
            onNone: () => ({}),
            onSome: (client) =>
              installed || Option.isSome(person) ? GitHubApp.variables(client.settings, person) : {},
          }),
          ...(yield* credentials.environment(
            scope.value,
            reached.map((profile) => profile.id),
          )),
        }
      }),
    })
  }),
)
