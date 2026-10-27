import { GitHost } from "@ren/schema/git-host"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const RepositoryGroup = HttpApiGroup.make("repository")
  .add(
    HttpApiEndpoint.get("repository.list", "/repositories", {
      success: Schema.Array(GitHost.Listing),
      error: UnavailableError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "repository.list",
        summary: "List repositories to read",
        description:
          "Return, for each git host, whether the organization connected it and the repositories that it can read there. A person picks references from them. For GitHub, they are the repositories of the organization’s GitHub App installation.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "repository" }))
