import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Label } from "@ren/schema/label"
import type { Session } from "@ren/schema/session"
import { SessionSettings } from "@ren/schema/session/settings"
import { Task } from "@ren/schema/task"
import { TaskComment } from "@ren/schema/task-comment"
import { Context } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import {
  EnvironmentNotFoundError,
  EnvironmentUnavailableError,
  ForbiddenError,
  ModelsUnavailableError,
  TaskConflictError,
  TaskInvalidError,
  TaskNotFoundError,
} from "./errors.js"
import { Host } from "./host.js"
import { HostTasks } from "./tasks.js"

export class CurrentHost extends Context.Service<
  CurrentHost,
  { readonly sessionId: Session.ID; readonly organizationId: Auth.OrganizationID }
>()("@ren/host-api/CurrentHost") {}

export class HostAuthentication extends HttpApiMiddleware.Service<HostAuthentication, { provides: CurrentHost }>()(
  "@ren/host-api/HostAuthentication",
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
    HttpApiEndpoint.post("models.refresh", "/host/models/refresh", {
      success: Brain.ModelGrant,
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

const EnvironmentsGroup = HttpApiGroup.make("environments")
  .add(
    HttpApiEndpoint.post("environments.access", "/host/environment/access", {
      success: Environment.Access,
      error: [EnvironmentNotFoundError, EnvironmentUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "environments.access",
        summary: "Get access to a session’s environment",
        description:
          "Name the environment and directory of the session named by a host token, with a fresh environment token. The request has no session field: the session comes only from the host token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("environments.release", "/host/environment/release").annotateMerge(
      OpenApi.annotations({
        identifier: "environments.release",
        summary: "Release a session’s seat on its environment",
        description:
          "Say that the session named by a host token is idle. Its seat stops counting toward its environment’s sessions per environment until its next access; the session keeps its environment.",
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
        description: "Sign a fresh host token for the brain named by a valid host token, without the model flow.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "host" }))

const SettingsGroup = HttpApiGroup.make("settings")
  .add(
    HttpApiEndpoint.post("settings.read", "/host/settings", {
      payload: SessionSettings.Known,
      success: SessionSettings.Layers,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "settings.read",
        summary: "Read a session’s settings layers",
        description:
          "Return the hash of each settings layer of the session named by a host token: Ren, its organization, its space and its agents. A layer comes with its settings only when its hash differs from the one the brain sent.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "settings" }))

const taskErrors = [TaskNotFoundError, TaskConflictError, TaskInvalidError, ForbiddenError] as const

const TasksGroup = HttpApiGroup.make("tasks")
  .add(
    HttpApiEndpoint.post("task_list", "/host/tasks/list", {
      payload: HostTasks.ListInput,
      success: Task.definition.list.page,
      error: taskErrors,
    }),
    HttpApiEndpoint.post("task_get", "/host/tasks/get", {
      payload: HostTasks.GetInput,
      success: HostTasks.GetResult,
      error: taskErrors,
    }),
    HttpApiEndpoint.post("task_create", "/host/tasks/create", {
      payload: HostTasks.CreateInput,
      success: Task.Info,
      error: taskErrors,
    }),
    HttpApiEndpoint.post("task_update", "/host/tasks/update", {
      payload: HostTasks.UpdateInput,
      success: Task.Info,
      error: taskErrors,
    }),
    HttpApiEndpoint.post("task_assign", "/host/tasks/assign", {
      payload: HostTasks.AssignInput,
      success: HostTasks.AssignResult,
      error: taskErrors,
    }),
    HttpApiEndpoint.post("task_review", "/host/tasks/review", {
      payload: HostTasks.ReviewInput,
      success: Task.Info,
      error: taskErrors,
    }),
    HttpApiEndpoint.post("task_comment", "/host/tasks/comment", {
      payload: TaskComment.CreateInput,
      success: TaskComment.Info,
      error: taskErrors,
    }),
    HttpApiEndpoint.post("label_list", "/host/tasks/labels", {
      payload: Label.ListInput,
      success: Label.definition.list.page,
      error: taskErrors,
    }),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "tasks" }))
  .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error" })

export const RenHostApi = HttpApi.make("host")
  .add(TasksGroup)
  .add(ModelsGroup)
  .add(EnvironmentsGroup)
  .add(HostGroup)
  .add(SettingsGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Host API",
      version: "0.0.0",
      description:
        "Internal API a session host calls with its host token: to refresh its brain’s models, to get access to its session’s environment, to read its session’s settings and to refresh the host token.",
    }),
  )
