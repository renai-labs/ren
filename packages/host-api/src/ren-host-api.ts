import { AppCatalog } from "@ren/schema/app-catalog"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Channel } from "@ren/schema/channel"
import { Drive } from "@ren/schema/drive"
import { Environment } from "@ren/schema/environment"
import { Memory } from "@ren/schema/memory"
import { Session } from "@ren/schema/session"
import { SessionSettings } from "@ren/schema/session/settings"
import { Signature } from "@ren/schema/signature"
import { Space } from "@ren/schema/space"
import { Context, Effect, Schema } from "effect"
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
  sessions: Schema.Array(PullSession),
  roots: Schema.optionalKey(Schema.Array(Session.ID)).annotate({
    description: "The root chats the brain’s harness holds. Ren names the ones it deleted in `deleted`.",
  }),
}).annotate({ identifier: "Host.PullRequest" })

export interface PullEnv extends Schema.Schema.Type<typeof PullEnv> {}
export const PullEnv = Schema.Struct({
  variables: Schema.Record(Schema.String, Schema.String).annotate({
    description:
      "Env vars that work anywhere: the value of a delivered secret (C9), the git identity, the GitHub URLs.",
  }),
  placeholders: Schema.Record(Schema.String, Schema.String)
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({})))
    .annotate({
      description:
        "Env vars that hold a ren:<LABEL> placeholder, which only the egress makes work: `LABEL=ren:LABEL` for each key that reaches the brain (A35), and the git header for GitHub. The brain gives them only to an environment behind the egress (R19).",
    }),
}).annotate({ identifier: "Host.PullEnv", description: "The env vars of the brain’s processes." })

export interface PullInference extends Schema.Schema.Type<typeof PullInference> {}
export const PullInference = Schema.Struct({
  baseUrl: Schema.String.annotate({
    description: "The root URL of the inference gateway. The brain reads `/model/info` from it.",
  }),
}).annotate({ identifier: "Host.PullInference" })

export interface PullApps extends Schema.Schema.Type<typeof PullApps> {}
export const PullApps = Schema.Struct({
  fingerprint: Schema.String,
  catalog: AppCatalog.Catalog,
}).annotate({ identifier: "Host.PullApps" })

export interface PullMemory extends Schema.Schema.Type<typeof PullMemory> {}
export const PullMemory = Schema.Struct({
  spaceId: Space.ID,
  organization: Schema.NullOr(Memory.Root).annotate({ description: "Null when the organization has no root file." }),
  space: Schema.NullOr(Memory.Root).annotate({ description: "Null when the brain’s space has no root file." }),
}).annotate({
  identifier: "Host.PullMemory",
  description: "The root files of the organization’s memory and of the brain’s space’s memory (memory M8).",
})

export interface PullChat extends Schema.Schema.Type<typeof PullChat> {}
export const PullChat = Schema.Struct({
  id: Session.ID,
  agent: Schema.NullOr(Schema.String).annotate({ description: "The name of the chat’s primary agent." }),
  archived: Schema.Boolean,
  drives: Schema.optionalKey(Drive.Availability).annotate({
    description: "Omitted for a chat without an environment, and by a Ren without drives.",
  }),
}).annotate({ identifier: "Host.PullChat" })

export interface PullReply extends Schema.Schema.Type<typeof PullReply> {}
export const PullReply = Schema.Struct({
  publicKeys: Schema.Array(Signature.PublicKey),
  inference: Schema.optionalKey(PullInference).annotate({
    description: "Omitted when Ren has no inference service; the brain then has no models.",
  }),
  apps: Schema.optionalKey(PullApps).annotate({
    description: "The resolved app catalog. Omitted when unsupported or unavailable.",
  }),
  channels: Schema.optionalKey(
    Schema.Array(Channel.Provider).annotate({
      description:
        "The channels whose bot MCP server reaches the brain’s space (CH54), at REN_URL/mcp/<provider>. Omitted means none.",
    }),
  ),
  layers: SessionSettings.Layers,
  memory: Schema.optionalKey(PullMemory).annotate({ description: "Omitted by a Ren that has no memory yet." }),
  chats: Schema.Array(PullChat),
  deleted: Schema.Array(Session.ID).annotate({
    description: "Root chats of the request that Ren no longer has. The brain drops them (E109, HR22).",
  }),
  env: PullEnv,
}).annotate({ identifier: "Host.PullReply" })

const SessionParams = { id: Session.ID }

const PullGroup = HttpApiGroup.make("pull")
  .add(
    HttpApiEndpoint.post("pull", "/host/pull", { payload: PullRequest, success: PullReply }).annotateMerge(
      OpenApi.annotations({
        identifier: "pull",
        summary: "Pull a brain’s settings, env vars and app catalog",
        description:
          "Send the state of the brain’s chats. The reply sends the full state: each settings layer, the env vars, the supported app catalog and the inference URL. The brain compares it with what it has and applies only what changed (HR9). It lists the brain’s chats with their primary agent.",
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
