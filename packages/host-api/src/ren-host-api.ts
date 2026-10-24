import { AppCatalog } from "@ren/schema/app-catalog"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { SessionSettings } from "@ren/schema/session/settings"
import { Signature } from "@ren/schema/signature"
import type { Space } from "@ren/schema/space"
import { Context, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { Host } from "./host.js"
import {
  EnvironmentNotFoundError,
  EnvironmentUnavailableError,
  ForbiddenError,
  GenerationRetiredError,
  ModelsUnavailableError,
  UnauthorizedError,
} from "./errors.js"

export class CurrentHost extends Context.Service<
  CurrentHost,
  {
    readonly brainId: Brain.ID
    readonly organizationId: Auth.OrganizationID
    readonly spaceId: Space.ID
    readonly generation: number
  }
>()("@ren/host-api/CurrentHost") {}

export class HostAuthentication extends HttpApiMiddleware.Service<HostAuthentication, { provides: CurrentHost }>()(
  "@ren/host-api/HostAuthentication",
  {
    error: [UnauthorizedError, ForbiddenError, GenerationRetiredError],
    security: {
      bearer: HttpApiSecurity.bearer.pipe(
        HttpApiSecurity.annotate(OpenApi.Description, "The brain's host token, signed by Ren."),
      ),
    },
  },
) {}

export interface PullSession extends Schema.Schema.Type<typeof PullSession> {}
export const PullSession = Schema.Struct({
  id: Session.ID,
  busy: Schema.Boolean,
  progress: Schema.String.annotate({
    description: "An opaque counter from the harness. It changes when a turn makes progress.",
  }),
}).annotate({ identifier: "Host.PullSession" })

export interface PullRequest extends Schema.Schema.Type<typeof PullRequest> {}
export const PullRequest = Schema.Struct({
  version: Schema.String.annotate({ description: "The brain’s version." }),
  keyIds: Schema.Array(Schema.String).annotate({ description: "The ids of the public keys the brain holds." }),
  models: Schema.NullOr(Schema.String).annotate({ description: "The models hash the brain has." }),
  apps: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: "The app catalog fingerprint the brain has; null requests the catalog. Absent for legacy brains.",
  }),
  layers: SessionSettings.Known,
  sessions: Schema.Array(PullSession),
  roots: Schema.optionalKey(Schema.Array(Session.ID)).annotate({
    description: "The root chats the brain’s harness holds. Ren names the ones it deleted in `deleted`.",
  }),
  env: Schema.optionalKey(Schema.String).annotate({
    description: "The hash of the credential env vars the brain has.",
  }),
}).annotate({ identifier: "Host.PullRequest" })

export interface PullEnv extends Schema.Schema.Type<typeof PullEnv> {}
export const PullEnv = Schema.Struct({
  hash: Schema.String,
  variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}).annotate({
  identifier: "Host.PullEnv",
  description:
    "The credential env vars of the brain: `LABEL=ren:LABEL` for each key that reaches it (A35), and the value of a delivered secret (C9). A body comes only when the hash changed.",
})

export interface PullModels extends Schema.Schema.Type<typeof PullModels> {}
export const PullModels = Schema.Struct({
  hash: Schema.String,
  access: Schema.optionalKey(Models.Access),
}).annotate({ identifier: "Host.PullModels" })

export interface PullApps extends Schema.Schema.Type<typeof PullApps> {}
export const PullApps = Schema.Struct({
  fingerprint: Schema.String,
  catalog: Schema.optionalKey(AppCatalog.Catalog),
}).annotate({ identifier: "Host.PullApps" })

export interface PullChat extends Schema.Schema.Type<typeof PullChat> {}
export const PullChat = Schema.Struct({
  id: Session.ID,
  agent: Schema.NullOr(Schema.String).annotate({ description: "The name of the chat’s primary agent." }),
  archived: Schema.Boolean,
}).annotate({ identifier: "Host.PullChat" })

export interface PullReply extends Schema.Schema.Type<typeof PullReply> {}
export const PullReply = Schema.Struct({
  publicKeys: Schema.Array(Signature.PublicKey),
  models: PullModels,
  apps: Schema.optionalKey(PullApps).annotate({
    description: "The resolved app catalog, with a body only when changed. Omitted when unsupported or unavailable.",
  }),
  layers: SessionSettings.Layers,
  chats: Schema.Array(PullChat),
  deleted: Schema.Array(Session.ID).annotate({
    description: "Root chats of the request that Ren no longer has. The brain drops them (E109).",
  }),
  env: Schema.optionalKey(PullEnv),
}).annotate({ identifier: "Host.PullReply" })

const SessionParams = { id: Session.ID }

const PullGroup = HttpApiGroup.make("pull")
  .add(
    HttpApiEndpoint.post("pull", "/host/pull", { payload: PullRequest, success: PullReply }).annotateMerge(
      OpenApi.annotations({
        identifier: "pull",
        summary: "Pull a brain's settings, models and app catalog",
        description:
          "Send the hashes the brain has and the state of its chats. The reply sends each settings layer, the models and the supported app catalog; a body comes only when its hash changed. It lists the brain’s chats with their primary agent.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "pull" }))

const ModelsGroup = HttpApiGroup.make("models")
  .add(
    HttpApiEndpoint.post("models.refresh", "/host/models/refresh", {
      success: Brain.ModelGrant,
      error: ModelsUnavailableError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "models.refresh",
        summary: "Refresh a brain's models",
        description: "Grant fresh model access for the brain named by a host token.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "models" }))

const EnvironmentsGroup = HttpApiGroup.make("environments")
  .add(
    HttpApiEndpoint.post("environments.access", "/host/sessions/:id/environment/access", {
      params: SessionParams,
      success: Environment.Access,
      error: [EnvironmentNotFoundError, EnvironmentUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "environments.access",
        summary: "Get access to a session's environment",
        description:
          "Name the environment and directory of a session of the brain, with a fresh environment token. Ren checks that the session belongs to the brain of the host token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("environments.release", "/host/sessions/:id/environment/release", {
      params: SessionParams,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "environments.release",
        summary: "Release a session's seat on its environment",
        description:
          "Say that a session of the brain is idle. Its seat stops counting toward its environment’s sessions per environment until its next access.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "environments" }))

const HostGroup = HttpApiGroup.make("host")
  .add(
    HttpApiEndpoint.post("host.refresh", "/host/token/refresh", { success: Host.Refreshed }).annotateMerge(
      OpenApi.annotations({
        identifier: "host.refresh",
        summary: "Refresh a host token",
        description: "Sign a fresh host token for the brain named by a valid host token.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "host" }))

export const RenHostApi = HttpApi.make("host")
  .add(PullGroup)
  .add(ModelsGroup)
  .add(EnvironmentsGroup)
  .add(HostGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Host API",
      version: "0.0.0",
      description:
        "Internal API a brain calls with its host token: to pull its settings and models, to refresh its model keys and host token, and to get access to a session’s environment.",
    }),
  )
