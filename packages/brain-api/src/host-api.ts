import type { Auth } from "@ren/schema/auth"
import { Hand } from "@ren/schema/hand"
import type { Session } from "@ren/schema/session"
import { Context, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { ModelsBody } from "./brain-api.js"
import { HandNotFoundError, HandUnavailableError, ForbiddenError, ModelsUnavailableError } from "./errors.js"

export class CurrentHost extends Context.Service<
  CurrentHost,
  { readonly sessionId: Session.ID; readonly organizationId: Auth.OrganizationID }
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

export const HostTokenBody = Schema.Struct({ hostToken: Schema.NonEmptyString }).annotate({
  identifier: "Host.HostTokenBody",
})
export type HostTokenBody = typeof HostTokenBody.Type

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

const HandsGroup = HttpApiGroup.make("hands")
  .add(
    HttpApiEndpoint.post("hands.access", "/brain/hand/access", {
      success: Hand.Access,
      error: [HandNotFoundError, HandUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "hands.access",
        summary: "Get access to a session’s hand",
        description:
          "Name the hand and directory of the session named by a host token, with a fresh hand token. The request has no session field: the session comes only from the host token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("hands.release", "/brain/hand/release").annotateMerge(
      OpenApi.annotations({
        identifier: "hands.release",
        summary: "Release a session’s seat on its hand",
        description:
          "Say that the session named by a host token is idle. Its seat stops counting toward its hand’s sessions per hand until its next access; the session keeps its hand.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "hands" }))

const HostGroup = HttpApiGroup.make("host")
  .add(
    HttpApiEndpoint.post("host.refresh", "/brain/host/refresh", { success: HostTokenBody }).annotateMerge(
      OpenApi.annotations({
        identifier: "host.refresh",
        summary: "Refresh a host token",
        description: "Sign a fresh host token for the brain named by a valid host token, without the model flow.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "host" }))

export const HostApi = HttpApi.make("host")
  .add(ModelsGroup)
  .add(HandsGroup)
  .add(HostGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Host API",
      version: "0.0.0",
      description:
        "Internal API a session host calls with its host token: to refresh its brain’s models, to get access to its session’s hand and to refresh the host token.",
    }),
  )
