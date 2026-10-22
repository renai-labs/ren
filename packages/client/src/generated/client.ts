import type {
  HealthGetOutput,
  MeGetOutput,
  InvitationPreviewInput,
  InvitationPreviewOutput,
  SpaceListInput,
  SpaceListOutput,
  SpaceGetInput,
  SpaceGetOutput,
  SpaceCreateInput,
  SpaceCreateOutput,
  SpaceUpdateInput,
  SpaceUpdateOutput,
  SpaceArchiveInput,
  SpaceArchiveOutput,
  SpaceMemberListInput,
  SpaceMemberListOutput,
  SpaceMemberCreateInput,
  SpaceMemberCreateOutput,
  SpaceMemberArchiveInput,
  SpaceMemberArchiveOutput,
  EnvironmentTemplateListInput,
  EnvironmentTemplateListOutput,
  EnvironmentTemplateGetInput,
  EnvironmentTemplateGetOutput,
  EnvironmentTemplateCreateInput,
  EnvironmentTemplateCreateOutput,
  EnvironmentTemplateUpdateInput,
  EnvironmentTemplateUpdateOutput,
  EnvironmentTemplateArchiveInput,
  EnvironmentTemplateArchiveOutput,
  EnvironmentProviderListOutput,
  SpaceEnvironmentTemplateListInput,
  SpaceEnvironmentTemplateListOutput,
  SpaceEnvironmentTemplateCreateInput,
  SpaceEnvironmentTemplateCreateOutput,
  SpaceEnvironmentTemplateArchiveInput,
  SpaceEnvironmentTemplateArchiveOutput,
  SpaceSettingsGetInput,
  SpaceSettingsGetOutput,
  SpaceSettingsUpdateInput,
  SpaceSettingsUpdateOutput,
  OrganizationSettingsGetInput,
  OrganizationSettingsGetOutput,
  OrganizationSettingsUpdateInput,
  OrganizationSettingsUpdateOutput,
  AgentListInput,
  AgentListOutput,
  AgentGetInput,
  AgentGetOutput,
  AgentCreateInput,
  AgentCreateOutput,
  AgentUpdateInput,
  AgentUpdateOutput,
  AgentArchiveInput,
  AgentArchiveOutput,
  AgentTransferOwnershipInput,
  AgentTransferOwnershipOutput,
  AgentMembershipListInput,
  AgentMembershipListOutput,
  AgentMembershipCreateInput,
  AgentMembershipCreateOutput,
  AgentMembershipArchiveInput,
  AgentMembershipArchiveOutput,
  SessionListInput,
  SessionListOutput,
  SessionGetInput,
  SessionGetOutput,
  SessionCreateInput,
  SessionCreateOutput,
  SessionArchiveInput,
  SessionArchiveOutput,
  ChatAccessInput,
  ChatAccessOutput,
  ChatModelsInput,
  ChatModelsOutput,
  TaskListInput,
  TaskListOutput,
  TaskGetInput,
  TaskGetOutput,
  TaskCreateInput,
  TaskCreateOutput,
  TaskUpdateInput,
  TaskUpdateOutput,
  TaskArchiveInput,
  TaskArchiveOutput,
  TaskAssignInput,
  TaskAssignOutput,
  TaskStartInput,
  TaskStartOutput,
  TaskReviewInput,
  TaskReviewOutput,
  TaskCommentCreateInput,
  TaskCommentCreateOutput,
  TaskCommentUpdateInput,
  TaskCommentUpdateOutput,
  TaskCommentArchiveInput,
  TaskCommentArchiveOutput,
  TaskActivityListInput,
  TaskActivityListOutput,
  LabelListInput,
  LabelListOutput,
  LabelCreateInput,
  LabelCreateOutput,
  LabelUpdateInput,
  LabelUpdateOutput,
  LabelArchiveInput,
  LabelArchiveOutput,
} from "./types.js"
import { ClientError } from "./client-error.js"

export interface ClientOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch | undefined
  readonly headers?: RequestInit["headers"]
}

export interface RequestOptions {
  readonly signal?: AbortSignal
  readonly headers?: RequestInit["headers"]
  /** Reports every chunk a streaming response receives, including keepalive comments that yield no event. */
  readonly onActivity?: () => void
}

interface RequestDescriptor {
  readonly method: string
  readonly path: string
  readonly query?: Record<string, unknown>
  readonly headers?: Record<string, unknown>
  readonly body?: unknown
  readonly successStatus: number
  readonly declaredStatuses: ReadonlyArray<number>
  readonly empty: boolean
}

export function make(options: ClientOptions) {
  const fetch = options.fetch ?? globalThis.fetch

  const prepare = (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    // A leading slash would replace any path prefix on baseUrl, so join relative to it.
    const baseUrl = new URL(options.baseUrl)
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/"
    const url = new URL(descriptor.path.slice(1), baseUrl)
    for (const [key, value] of Object.entries(descriptor.query ?? {})) appendQuery(url.searchParams, key, value)
    const headers = new Headers(options.headers)
    for (const [key, value] of Object.entries(descriptor.headers ?? {})) {
      if (value !== undefined && value !== null) headers.set(key, String(value))
    }
    for (const [key, value] of new Headers(requestOptions?.headers)) headers.set(key, value)
    if (descriptor.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json")
    return {
      url,
      init: {
        method: descriptor.method,
        headers,
        ...(requestOptions?.signal !== undefined && { signal: requestOptions.signal }),
        ...(descriptor.body !== undefined && { body: JSON.stringify(descriptor.body) }),
      } satisfies RequestInit,
    }
  }

  const execute = async (descriptor: RequestDescriptor, requestOptions?: RequestOptions) => {
    try {
      const prepared = prepare(descriptor, requestOptions)
      return await fetch(prepared.url, prepared.init)
    } catch (cause) {
      throw new ClientError("Transport", { cause })
    }
  }

  const responseError = async (response: Response, descriptor: RequestDescriptor): Promise<never> => {
    if (descriptor.declaredStatuses.includes(response.status))
      throw declared((await json(response)) as DeclaredErrorBody)
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnexpectedStatus", { cause: { status: response.status }, detail: String(response.status) })
  }

  const request = async <A>(descriptor: RequestDescriptor, requestOptions?: RequestOptions): Promise<A> => {
    const response = await execute(descriptor, requestOptions)
    if (response.status !== descriptor.successStatus) return responseError(response, descriptor)
    if (descriptor.empty) {
      try {
        await response.body?.cancel()
      } catch {}
      return undefined as A
    }
    return (await json(response)) as A
  }

  return {
    health: {
      get: (requestOptions?: RequestOptions) =>
        request<HealthGetOutput>(
          { method: "GET", path: `/health`, successStatus: 200, declaredStatuses: [], empty: false },
          requestOptions,
        ),
    },
    me: {
      get: (requestOptions?: RequestOptions) =>
        request<MeGetOutput>(
          { method: "GET", path: `/me`, successStatus: 200, declaredStatuses: [401], empty: false },
          requestOptions,
        ),
    },
    invitation: {
      preview: (input: InvitationPreviewInput, requestOptions?: RequestOptions) =>
        request<InvitationPreviewOutput>(
          {
            method: "GET",
            path: `/invitations/${encodeURIComponent(input.id)}/preview`,
            successStatus: 200,
            declaredStatuses: [],
            empty: false,
          },
          requestOptions,
        ),
    },
    space: {
      list: (input: SpaceListInput, requestOptions?: RequestOptions) =>
        request<SpaceListOutput>(
          {
            method: "GET",
            path: `/spaces`,
            query: { joined: input["joined"], page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: SpaceGetInput, requestOptions?: RequestOptions) =>
        request<SpaceGetOutput>(
          {
            method: "GET",
            path: `/spaces/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: SpaceCreateInput, requestOptions?: RequestOptions) =>
        request<SpaceCreateOutput>(
          {
            method: "POST",
            path: `/spaces`,
            body: { name: input["name"], description: input["description"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: SpaceUpdateInput, requestOptions?: RequestOptions) =>
        request<SpaceUpdateOutput>(
          {
            method: "PATCH",
            path: `/spaces/${encodeURIComponent(input.id)}`,
            body: { name: input["name"], description: input["description"], agentOrder: input["agentOrder"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: SpaceArchiveInput, requestOptions?: RequestOptions) =>
        request<SpaceArchiveOutput>(
          {
            method: "DELETE",
            path: `/spaces/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "space-member": {
      list: (input: SpaceMemberListInput, requestOptions?: RequestOptions) =>
        request<SpaceMemberListOutput>(
          {
            method: "GET",
            path: `/space-members`,
            query: {
              spaceId: input["spaceId"],
              status: input["status"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: SpaceMemberCreateInput, requestOptions?: RequestOptions) =>
        request<SpaceMemberCreateOutput>(
          {
            method: "POST",
            path: `/space-members`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: SpaceMemberArchiveInput, requestOptions?: RequestOptions) =>
        request<SpaceMemberArchiveOutput>(
          {
            method: "DELETE",
            path: `/space-members/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "environment-template": {
      list: (input: EnvironmentTemplateListInput, requestOptions?: RequestOptions) =>
        request<EnvironmentTemplateListOutput>(
          {
            method: "GET",
            path: `/environment-templates`,
            query: { page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: EnvironmentTemplateGetInput, requestOptions?: RequestOptions) =>
        request<EnvironmentTemplateGetOutput>(
          {
            method: "GET",
            path: `/environment-templates/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: EnvironmentTemplateCreateInput, requestOptions?: RequestOptions) =>
        request<EnvironmentTemplateCreateOutput>(
          {
            method: "POST",
            path: `/environment-templates`,
            body: {
              name: input["name"],
              description: input["description"],
              provider: input["provider"],
              config: input["config"],
              sessionsPerEnvironment: input["sessionsPerEnvironment"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: EnvironmentTemplateUpdateInput, requestOptions?: RequestOptions) =>
        request<EnvironmentTemplateUpdateOutput>(
          {
            method: "PATCH",
            path: `/environment-templates/${encodeURIComponent(input.id)}`,
            body: {
              name: input["name"],
              description: input["description"],
              config: input["config"],
              sessionsPerEnvironment: input["sessionsPerEnvironment"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: EnvironmentTemplateArchiveInput, requestOptions?: RequestOptions) =>
        request<EnvironmentTemplateArchiveOutput>(
          {
            method: "DELETE",
            path: `/environment-templates/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    environmentProvider: {
      list: (requestOptions?: RequestOptions) =>
        request<EnvironmentProviderListOutput>(
          {
            method: "GET",
            path: `/environment-providers`,
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
    },
    "space-environment-template": {
      list: (input: SpaceEnvironmentTemplateListInput, requestOptions?: RequestOptions) =>
        request<SpaceEnvironmentTemplateListOutput>(
          {
            method: "GET",
            path: `/space-environment-templates`,
            query: { spaceId: input["spaceId"], page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: SpaceEnvironmentTemplateCreateInput, requestOptions?: RequestOptions) =>
        request<SpaceEnvironmentTemplateCreateOutput>(
          {
            method: "POST",
            path: `/space-environment-templates`,
            body: { spaceId: input["spaceId"], environmentTemplateId: input["environmentTemplateId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: SpaceEnvironmentTemplateArchiveInput, requestOptions?: RequestOptions) =>
        request<SpaceEnvironmentTemplateArchiveOutput>(
          {
            method: "DELETE",
            path: `/space-environment-templates/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "space-settings": {
      get: (input: SpaceSettingsGetInput, requestOptions?: RequestOptions) =>
        request<SpaceSettingsGetOutput>(
          {
            method: "GET",
            path: `/space-settings/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: SpaceSettingsUpdateInput, requestOptions?: RequestOptions) =>
        request<SpaceSettingsUpdateOutput>(
          {
            method: "PATCH",
            path: `/space-settings/${encodeURIComponent(input.id)}`,
            body: { settings: input["settings"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "organization-settings": {
      get: (input: OrganizationSettingsGetInput, requestOptions?: RequestOptions) =>
        request<OrganizationSettingsGetOutput>(
          {
            method: "GET",
            path: `/organization-settings/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: OrganizationSettingsUpdateInput, requestOptions?: RequestOptions) =>
        request<OrganizationSettingsUpdateOutput>(
          {
            method: "PATCH",
            path: `/organization-settings/${encodeURIComponent(input.id)}`,
            body: { settings: input["settings"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    agent: {
      list: (input: AgentListInput, requestOptions?: RequestOptions) =>
        request<AgentListOutput>(
          {
            method: "GET",
            path: `/agents`,
            query: {
              spaceId: input["spaceId"],
              isSubagent: input["isSubagent"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: AgentGetInput, requestOptions?: RequestOptions) =>
        request<AgentGetOutput>(
          {
            method: "GET",
            path: `/agents/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: AgentCreateInput, requestOptions?: RequestOptions) =>
        request<AgentCreateOutput>(
          {
            method: "POST",
            path: `/agents`,
            body: {
              ownerSpaceId: input["ownerSpaceId"],
              name: input["name"],
              description: input["description"],
              isSubagent: input["isSubagent"],
              settings: input["settings"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: AgentUpdateInput, requestOptions?: RequestOptions) =>
        request<AgentUpdateOutput>(
          {
            method: "PATCH",
            path: `/agents/${encodeURIComponent(input.id)}`,
            body: {
              name: input["name"],
              description: input["description"],
              isSubagent: input["isSubagent"],
              settings: input["settings"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: AgentArchiveInput, requestOptions?: RequestOptions) =>
        request<AgentArchiveOutput>(
          {
            method: "DELETE",
            path: `/agents/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      transferOwnership: (input: AgentTransferOwnershipInput, requestOptions?: RequestOptions) =>
        request<AgentTransferOwnershipOutput>(
          {
            method: "POST",
            path: `/agents/${encodeURIComponent(input.id)}/transferOwnership`,
            body: { spaceId: input["spaceId"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "agent-membership": {
      list: (input: AgentMembershipListInput, requestOptions?: RequestOptions) =>
        request<AgentMembershipListOutput>(
          {
            method: "GET",
            path: `/agent-memberships`,
            query: {
              spaceId: input["spaceId"],
              agentId: input["agentId"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: AgentMembershipCreateInput, requestOptions?: RequestOptions) =>
        request<AgentMembershipCreateOutput>(
          {
            method: "POST",
            path: `/agent-memberships`,
            body: { spaceId: input["spaceId"], agentId: input["agentId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: AgentMembershipArchiveInput, requestOptions?: RequestOptions) =>
        request<AgentMembershipArchiveOutput>(
          {
            method: "DELETE",
            path: `/agent-memberships/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    session: {
      list: (input: SessionListInput, requestOptions?: RequestOptions) =>
        request<SessionListOutput>(
          {
            method: "GET",
            path: `/sessions`,
            query: { spaceId: input["spaceId"], page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: SessionGetInput, requestOptions?: RequestOptions) =>
        request<SessionGetOutput>(
          {
            method: "GET",
            path: `/sessions/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: SessionCreateInput, requestOptions?: RequestOptions) =>
        request<SessionCreateOutput>(
          {
            method: "POST",
            path: `/sessions`,
            body: { id: input["id"], spaceId: input["spaceId"], message: input["message"], model: input["model"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: SessionArchiveInput, requestOptions?: RequestOptions) =>
        request<SessionArchiveOutput>(
          {
            method: "DELETE",
            path: `/sessions/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    chat: {
      access: (input: ChatAccessInput, requestOptions?: RequestOptions) =>
        request<ChatAccessOutput>(
          {
            method: "POST",
            path: `/sessions/${encodeURIComponent(input.id)}/chat`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      models: (input: ChatModelsInput, requestOptions?: RequestOptions) =>
        request<ChatModelsOutput>(
          {
            method: "GET",
            path: `/sessions/${encodeURIComponent(input.id)}/models`,
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
    },
    task: {
      list: (input: TaskListInput, requestOptions?: RequestOptions) =>
        request<TaskListOutput>(
          {
            method: "GET",
            path: `/tasks`,
            query: {
              spaceId: input["spaceId"],
              status: input["status"],
              includeDone: input["includeDone"],
              priority: input["priority"],
              agentId: input["agentId"],
              ownerId: input["ownerId"],
              label: input["label"],
              humanReview: input["humanReview"],
              linkedTo: input["linkedTo"],
              parentId: input["parentId"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: TaskGetInput, requestOptions?: RequestOptions) =>
        request<TaskGetOutput>(
          {
            method: "GET",
            path: `/tasks/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: TaskCreateInput, requestOptions?: RequestOptions) =>
        request<TaskCreateOutput>(
          {
            method: "POST",
            path: `/tasks`,
            body: {
              spaceId: input["spaceId"],
              title: input["title"],
              description: input["description"],
              status: input["status"],
              priority: input["priority"],
              labels: input["labels"],
              links: input["links"],
              dueAt: input["dueAt"],
              agentId: input["agentId"],
              ownerId: input["ownerId"],
              parentId: input["parentId"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: TaskUpdateInput, requestOptions?: RequestOptions) =>
        request<TaskUpdateOutput>(
          {
            method: "PATCH",
            path: `/tasks/${encodeURIComponent(input.id)}`,
            body: {
              title: input["title"],
              description: input["description"],
              status: input["status"],
              priority: input["priority"],
              labels: input["labels"],
              dueAt: input["dueAt"],
              addLinks: input["addLinks"],
              removeLinks: input["removeLinks"],
              parentId: input["parentId"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: TaskArchiveInput, requestOptions?: RequestOptions) =>
        request<TaskArchiveOutput>(
          {
            method: "DELETE",
            path: `/tasks/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      assign: (input: TaskAssignInput, requestOptions?: RequestOptions) =>
        request<TaskAssignOutput>(
          {
            method: "POST",
            path: `/tasks/${encodeURIComponent(input.id)}/assign`,
            body: {
              agentId: input["agentId"],
              ownerId: input["ownerId"],
              spaceId: input["spaceId"],
              note: input["note"],
              start: input["start"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      start: (input: TaskStartInput, requestOptions?: RequestOptions) =>
        request<TaskStartOutput>(
          {
            method: "POST",
            path: `/tasks/${encodeURIComponent(input.id)}/start`,
            body: { mode: input["mode"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      review: (input: TaskReviewInput, requestOptions?: RequestOptions) =>
        request<TaskReviewOutput>(
          {
            method: "POST",
            path: `/tasks/${encodeURIComponent(input.id)}/review`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "task-comment": {
      create: (input: TaskCommentCreateInput, requestOptions?: RequestOptions) =>
        request<TaskCommentCreateOutput>(
          {
            method: "POST",
            path: `/task-comments`,
            body: { taskId: input["taskId"], body: input["body"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: TaskCommentUpdateInput, requestOptions?: RequestOptions) =>
        request<TaskCommentUpdateOutput>(
          {
            method: "PATCH",
            path: `/task-comments/${encodeURIComponent(input.id)}`,
            body: { body: input["body"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: TaskCommentArchiveInput, requestOptions?: RequestOptions) =>
        request<TaskCommentArchiveOutput>(
          {
            method: "DELETE",
            path: `/task-comments/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "task-activity": {
      list: (input: TaskActivityListInput, requestOptions?: RequestOptions) =>
        request<TaskActivityListOutput>(
          {
            method: "GET",
            path: `/task-activities`,
            query: { taskId: input["taskId"], page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
    },
    label: {
      list: (input: LabelListInput, requestOptions?: RequestOptions) =>
        request<LabelListOutput>(
          {
            method: "GET",
            path: `/labels`,
            query: { page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: LabelCreateInput, requestOptions?: RequestOptions) =>
        request<LabelCreateOutput>(
          {
            method: "POST",
            path: `/labels`,
            body: { name: input["name"], color: input["color"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: LabelUpdateInput, requestOptions?: RequestOptions) =>
        request<LabelUpdateOutput>(
          {
            method: "PATCH",
            path: `/labels/${encodeURIComponent(input.id)}`,
            body: { name: input["name"], color: input["color"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: LabelArchiveInput, requestOptions?: RequestOptions) =>
        request<LabelArchiveOutput>(
          {
            method: "DELETE",
            path: `/labels/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) return
  if (value === null) {
    params.append(key, "null")
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) appendQuery(params, key, item)
    return
  }
  if (typeof value === "object") {
    for (const [child, item] of Object.entries(value)) appendQuery(params, `${key}[${child}]`, item)
    return
  }
  params.append(key, String(value))
}

async function json(response: Response): Promise<unknown> {
  if (!isContentType(response, "application/json") && !response.headers.get("content-type")?.includes("+json")) {
    try {
      await response.body?.cancel()
    } catch {}
    throw new ClientError("UnsupportedContentType", { detail: response.headers.get("content-type") })
  }
  let text: string
  try {
    text = await response.text()
  } catch (cause) {
    throw new ClientError("Transport", { cause })
  }
  if (text === "") throw new ClientError("MalformedResponse")
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ClientError("MalformedResponse", { cause })
  }
}

type DeclaredErrorBody = {
  readonly _tag?: string
  readonly message?: string
  readonly data?: { readonly message?: string }
}

/** Throw declared error bodies as Errors. The body's fields stay on the error, so narrowing on `_tag` or `name` still works. */
function declared(body: DeclaredErrorBody) {
  const error = Object.assign(new Error(body.message ?? body.data?.message), body)
  if (body._tag) error.name = body._tag
  return error
}

function isContentType(response: Response, expected: string) {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === expected
}
