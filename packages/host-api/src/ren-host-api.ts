import { AppCatalog } from "@ren/schema/app-catalog"
import { Artifact } from "@ren/schema/artifact"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Channel } from "@ren/schema/channel"
import { Drive } from "@ren/schema/drive"
import { Hand } from "@ren/schema/hand"
import { Memory } from "@ren/schema/memory"
import { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { SessionSettings } from "@ren/schema/session/settings"
import { Signature } from "@ren/schema/signature"
import { Space } from "@ren/schema/space"
import { Context, Effect, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { Host } from "./host.js"
import {
  ArtifactConflictError,
  ArtifactFailedError,
  ArtifactInvalidError,
  ArtifactNotFoundError,
  EnvironmentNotFoundError,
  EnvironmentStartingError,
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
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "A process that the chat started still runs, such as a background shell. Ren keeps the machine awake for it. An older brain leaves it out.",
  }),
  touched: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "A person asked for the chat’s files or diff since the last pull. Ren keeps the chat’s place on its hand, as for a turn. An older brain leaves it out.",
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
  hasHand: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "False when the brain’s applied hand gives the chat no file and shell tools. It changes only at the brain’s start or wake. Omitted by an older Ren: true.",
  }),
  directory: Schema.optionalKey(Hand.Directory).annotate({
    description:
      "The chat’s folder on its applied hand. A chat with tools and no workspace gets one there. Omitted when the chat has no tools, and by an older Ren.",
  }),
}).annotate({ identifier: "Host.PullChat" })

export interface PullReply extends Schema.Schema.Type<typeof PullReply> {}
export const PullReply = Schema.Struct({
  publicKeys: Schema.Array(Signature.PublicKey),
  providers: Schema.optionalKey(Models.Providers).annotate({
    description:
      "Registered providers without keys. The brain discovers each provider’s catalog and gets its key from `models.refresh`. Omitted when registration is unavailable; the brain keeps its last providers.",
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
  computeRevision: Schema.optionalKey(Schema.Int).annotate({
    description:
      "The space setting that the brain applied at its last start or wake. When it changes, the brain drops its connections to its hands, so no call reaches the hand it used before. Omitted by an older Ren.",
  }),
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
          "Send the state of the brain’s chats. The reply sends each settings layer, env vars, app catalog and provider registrations. The brain applies changes and discovers provider catalogs directly.",
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

const HandsGroup = HttpApiGroup.make("environments")
  .add(
    HttpApiEndpoint.post("environments.access", "/host/sessions/:id/environment/access", {
      params: SessionParams,
      query: Schema.Struct({
        unreachable: Schema.optional(
          Schema.Literals(["true", "false"]).annotate({
            description:
              "`true` when the brain could not reach the session’s environment at its last URL; Ren checks its machine first.",
          }),
        ),
      }),
      success: Hand.Access,
      error: [EnvironmentNotFoundError, EnvironmentUnavailableError, EnvironmentStartingError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "environments.access",
        summary: "Get access to a session's environment",
        description:
          "Name the environment and directory of a session of the brain, with a fresh environment token. Ren checks that the session belongs to the brain of the host token. `EnvironmentStartingError` means the session’s machine is still starting: ask again in 2 s.",
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

const ArtifactParams = { id: Artifact.ID }

const ArtifactsGroup = HttpApiGroup.make("artifacts")
  .add(
    HttpApiEndpoint.post("artifacts.upload", "/host/artifacts/:id/uploads", {
      params: ArtifactParams,
      success: Artifact.Upload,
      error: [ArtifactConflictError, ArtifactFailedError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "artifacts.upload",
        summary: "Start an artifact upload",
        description:
          "Give a short-lived URL that takes one PUT of the artifact’s source archive. The bytes go straight to storage, not through Ren.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("artifacts.deploy", "/host/artifacts/:id", {
      params: ArtifactParams,
      payload: Artifact.DeployInput,
      success: Artifact.Deployment.annotate({ httpApiStatus: 202 }),
      error: [ArtifactConflictError, ArtifactInvalidError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "artifacts.deploy",
        summary: "Publish an artifact",
        description:
          "Queue a durable deployment of an upload and return it as deploying. The deployment checks the upload, keeps a copy and serves it; a bad upload ends it as failed with the reason. Read status before reporting the artifact as live.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("artifacts.status", "/host/artifacts/:id/deployments/:deploymentId", {
      params: { ...ArtifactParams, deploymentId: Artifact.DeploymentID },
      success: Artifact.Deployment,
      error: ArtifactNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "artifacts.status",
        summary: "Read artifact deployment status",
        description:
          "Read one deployment or stop: its deploying, stopping, ready, failed or stopped status, URL and error.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("artifacts.read", "/host/artifacts/:id", {
      params: ArtifactParams,
      success: Artifact.Info,
      error: ArtifactNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "artifacts.read",
        summary: "Read an artifact",
        description:
          "Read an artifact’s title, entry, URL, its deployment in progress and its published deployment. Its files are in the archive that artifacts.download links to.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("artifacts.download", "/host/artifacts/:id/download", {
      params: ArtifactParams,
      success: Artifact.Archive,
      error: [ArtifactNotFoundError, ArtifactFailedError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "artifacts.download",
        summary: "Download an artifact’s source archive",
        description:
          "Give a short-lived URL of the last published source archive, which an environment unpacks into a folder.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("artifacts.stop", "/host/artifacts/:id", {
      params: ArtifactParams,
      success: Artifact.Deployment.annotate({ httpApiStatus: 202 }),
      error: [ArtifactNotFoundError, ArtifactConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "artifacts.stop",
        summary: "Remove an artifact deployment",
        description:
          "Queue a durable stop of an artifact and return it as stopping, or the stop that runs. The stop ends the deployment in progress and stops serving the artifact. Ren keeps its record, source files and application data.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "artifacts" }))

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
  .add(HandsGroup)
  .add(ArtifactsGroup)
  .add(HostGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Host API",
      version: "0.0.0",
      description:
        "Internal API a brain calls with its host token: to pull its settings and models, to refresh its model keys and host token, to get access to a session’s environment, and to publish artifacts.",
    }),
  )
