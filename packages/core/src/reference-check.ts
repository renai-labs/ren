export * as ReferenceCheck from "./reference-check.js"

import type { Auth } from "@ren/schema/auth"
import type { Reference } from "@ren/schema/reference"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient } from "effect/http"
import { GitHubApp } from "./github-app.js"
import { Primitive } from "./primitive.js"

export interface Interface {
  readonly check: (
    organizationId: Auth.OrganizationID,
    previous: Reference.List,
    next: Reference.List,
  ) => Effect.Effect<void, Primitive.Invalid>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ReferenceCheck") {}

export const layerNone = Layer.succeed(Service, Service.of({ check: () => Effect.void }))

const answerWithin = "10 seconds"

// oxlint-disable-next-line ren/no-comments -- R13, R26: a save reads each new reference from GitHub with the org's installation, or with no token when the org has none. Only a 404 or another host refuses it; a GitHub that does not answer does not block a save.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const github = yield* GitHubApp.Service
    const http = yield* HttpClient.HttpClient
    const web = Option.match(github.client, {
      onNone: () => "https://github.com",
      onSome: (found) => found.settings.web,
    })
    const api = Option.match(github.client, {
      onNone: () => "https://api.github.com",
      onSome: (found) => found.settings.api,
    })
    const host = new URL(web).hostname
    return Service.of({
      check: Effect.fn("ReferenceCheck.check")(function* (
        organizationId: Auth.OrganizationID,
        previous: Reference.List,
        next: Reference.List,
      ) {
        const known = new Set(previous.map((reference) => reference.repository))
        const added = next.filter((reference) => !known.has(reference.repository))
        if (added.length === 0) return
        const installation = yield* github.installationOf(organizationId)
        yield* Effect.forEach(
          added,
          Effect.fnUntraced(function* (reference) {
            const field = `references.${reference.alias}`
            const url = new URL(reference.repository)
            if (url.hostname !== host)
              return yield* new Primitive.Invalid({
                message: `Ren reads only repositories on ${host}, not ${reference.repository}.`,
                field,
              })
            const name = url.pathname.slice(1).replace(/\.git$/u, "")
            const status = yield* Option.match(installation, {
              onSome: (found) =>
                found.client.read(found.installation, `/repos/${name}`, Schema.Unknown).pipe(
                  Effect.as(200),
                  Effect.catch((error) => Effect.succeed(error.status ?? 0)),
                ),
              onNone: () =>
                http.get(`${api}/repos/${name}`).pipe(
                  Effect.map((response) => response.status),
                  Effect.orElseSucceed(() => 0),
                ),
            }).pipe(
              Effect.timeout(answerWithin),
              Effect.orElseSucceed(() => 0),
            )
            if (status === 404)
              return yield* new Primitive.Invalid({
                message: Option.isSome(installation)
                  ? `the GitHub App cannot read ${name}: add the repository to the installation, or ${name} does not exist`
                  : `this space has no GitHub credential: install the GitHub App or sign in with GitHub, or ${name} does not exist`,
                field,
              })
            if (status !== 200)
              yield* Effect.logWarning(
                `Saved the reference ${reference.repository} without a check: ${status === 0 ? "GitHub did not answer" : `GitHub answered ${status}`}`,
              )
          }),
          { concurrency: 4, discard: true },
        )
      }),
    })
  }),
)
