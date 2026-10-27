import { RepositoryHosts } from "@ren/core/repository-hosts"
import { UnavailableError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const RepositoryHandler = HttpApiBuilder.group(Api, "repository", (handlers) =>
  Effect.gen(function* () {
    const hosts = yield* RepositoryHosts.Service
    return handlers.handle("repository.list", () =>
      Effect.flatMap(Primitive.currentActor, (actor) => hosts.list(actor.organizationId)).pipe(
        Effect.catchTag("RepositoryHosts.Unavailable", (error) =>
          Effect.logWarning("The repositories of an organization could not be listed", error).pipe(
            Effect.andThen(
              Effect.fail(
                new UnavailableError({ message: "The git host did not answer. Try again.", retryAfterMs: 5000 }),
              ),
            ),
          ),
        ),
      ),
    )
  }),
)
