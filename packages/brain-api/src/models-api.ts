import type { Auth } from "@ren/schema/auth"
import type { Session } from "@ren/schema/session"
import { Context } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { ModelsBody } from "./brain-api.js"
import { ForbiddenError, ModelsUnavailableError } from "./errors.js"

export class CurrentHost extends Context.Service<
  CurrentHost,
  { readonly brainId: Session.ID; readonly organizationId: Auth.OrganizationID }
>()("@ren/brain-api/CurrentHost") {}

export class HostAuthentication extends HttpApiMiddleware.Service<HostAuthentication, { provides: CurrentHost }>()(
  "@ren/brain-api/HostAuthentication",
  {
    error: ForbiddenError,
    security: {
      bearer: HttpApiSecurity.bearer.pipe(
        HttpApiSecurity.annotate(OpenApi.Description, "The host token that came with the brain's model access."),
      ),
    },
  },
) {}

const ModelsGroup = HttpApiGroup.make("models")
  .add(
    HttpApiEndpoint.post("models.refresh", "/brain/models/refresh", {
      success: ModelsBody,
      error: ModelsUnavailableError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "models.refresh",
        summary: "Refresh a brain’s models",
        description: "Grant fresh model access for the brain named by a host token, with a fresh host token.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "models" }))

export const ModelsApi = HttpApi.make("models")
  .add(ModelsGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Models API",
      version: "0.0.0",
      description: "Internal API a session host calls to refresh its brain’s model access.",
    }),
  )
