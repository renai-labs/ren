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
  MemoryListInput,
  MemoryListOutput,
  MemoryReadInput,
  MemoryReadOutput,
  MemoryWriteInput,
  MemoryWriteOutput,
  MemoryEditInput,
  MemoryEditOutput,
  MemoryDeleteInput,
  MemoryDeleteOutput,
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
  AppListInput,
  AppListOutput,
  AppGetInput,
  AppGetOutput,
  AppCreateInput,
  AppCreateOutput,
  AppUpdateInput,
  AppUpdateOutput,
  AppArchiveInput,
  AppArchiveOutput,
  AppTransferOwnershipInput,
  AppTransferOwnershipOutput,
  AppProfileListInput,
  AppProfileListOutput,
  AppProfileGetInput,
  AppProfileGetOutput,
  AppProfileCreateInput,
  AppProfileCreateOutput,
  AppProfileUpdateInput,
  AppProfileUpdateOutput,
  AppProfileAccessInput,
  AppProfileAccessOutput,
  AppProfileLinkInput,
  AppProfileLinkOutput,
  AppProfilePromoteInput,
  AppProfilePromoteOutput,
  AppProfileReachAppProfileDeleteInput,
  AppProfileReachAppProfileDeleteOutput,
  AppProfileReachSessionProfilesInput,
  AppProfileReachSessionProfilesOutput,
  AppProfileReachSpaceProfilesInput,
  AppProfileReachSpaceProfilesOutput,
  AppRegistryListInput,
  AppRegistryListOutput,
  AppRegistryGetInput,
  AppRegistryGetOutput,
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
  ChatMessagesInput,
  ChatMessagesOutput,
  ChatRetryInput,
  ChatRetryOutput,
  ChatPrepareInput,
  ChatPrepareOutput,
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
  ScheduleListInput,
  ScheduleListOutput,
  ScheduleGetInput,
  ScheduleGetOutput,
  ScheduleCreateInput,
  ScheduleCreateOutput,
  ScheduleUpdateInput,
  ScheduleUpdateOutput,
  ScheduleArchiveInput,
  ScheduleArchiveOutput,
  SchedulePauseInput,
  SchedulePauseOutput,
  ScheduleResumeInput,
  ScheduleResumeOutput,
  ScheduleRunInput,
  ScheduleRunOutput,
  ScheduleRunListInput,
  ScheduleRunListOutput,
  CredentialListInput,
  CredentialListOutput,
  CredentialGetInput,
  CredentialGetOutput,
  CredentialCreateInput,
  CredentialCreateOutput,
  CredentialUpdateInput,
  CredentialUpdateOutput,
  CredentialRotateInput,
  CredentialRotateOutput,
  CredentialMoveInput,
  CredentialMoveOutput,
  CredentialCopyInput,
  CredentialCopyOutput,
  CredentialRemoveInput,
  CredentialRemoveOutput,
  CredentialConnectCredentialConnectInput,
  CredentialConnectCredentialConnectOutput,
  OauthSessionGetInput,
  OauthSessionGetOutput,
  OauthAppListInput,
  OauthAppListOutput,
  OauthAppGetInput,
  OauthAppGetOutput,
  OauthAppCreateInput,
  OauthAppCreateOutput,
  OauthAppUpdateInput,
  OauthAppUpdateOutput,
  OauthAppArchiveInput,
  OauthAppArchiveOutput,
  RenInferenceConnectInput,
  RenInferenceConnectOutput,
  RenInferenceConnectionListOutput,
  RenInferenceConnectionRenameInput,
  RenInferenceConnectionRenameOutput,
  RenInferenceConnectionRemoveInput,
  RenInferenceConnectionRemoveOutput,
  ChannelInstallListInput,
  ChannelInstallListOutput,
  ChannelInstallUpdateInput,
  ChannelInstallUpdateOutput,
  ChannelInstallRemoveInput,
  ChannelInstallRemoveOutput,
  ChannelMappingListInput,
  ChannelMappingListOutput,
  ChannelMappingCreateInput,
  ChannelMappingCreateOutput,
  ChannelMappingRemoveInput,
  ChannelMappingRemoveOutput,
  ChannelConnectChannelProviderListOutput,
  ChannelConnectChannelInstallStartInput,
  ChannelConnectChannelInstallStartOutput,
  ChannelConnectChannelPlaceListInput,
  ChannelConnectChannelPlaceListOutput,
  RepositoryListOutput,
  SignInSignInProviderListOutput,
  InfraPullOutput,
  InfraPlanInput,
  InfraPlanOutput,
  InfraApplyInput,
  InfraApplyOutput,
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
            body: { name: input["name"], slug: input["slug"], description: input["description"] },
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
            body: {
              factory: input["factory"],
              name: input["name"],
              description: input["description"],
              brainScope: input["brainScope"],
            },
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
    memory: {
      list: (input?: MemoryListInput, requestOptions?: RequestOptions) =>
        request<MemoryListOutput>(
          {
            method: "GET",
            path: `/memory`,
            query: { spaceId: input?.["spaceId"], prefix: input?.["prefix"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      read: (input: MemoryReadInput, requestOptions?: RequestOptions) =>
        request<MemoryReadOutput>(
          {
            method: "GET",
            path: `/memory/file`,
            query: { spaceId: input["spaceId"], path: input["path"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      write: (input: MemoryWriteInput, requestOptions?: RequestOptions) =>
        request<MemoryWriteOutput>(
          {
            method: "PUT",
            path: `/memory/file`,
            body: { spaceId: input["spaceId"], path: input["path"], content: input["content"] },
            successStatus: 204,
            declaredStatuses: [401, 403, 404],
            empty: true,
          },
          requestOptions,
        ),
      edit: (input: MemoryEditInput, requestOptions?: RequestOptions) =>
        request<MemoryEditOutput>(
          {
            method: "PATCH",
            path: `/memory/file`,
            body: {
              spaceId: input["spaceId"],
              path: input["path"],
              oldString: input["oldString"],
              newString: input["newString"],
              replaceAll: input["replaceAll"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      delete: (input: MemoryDeleteInput, requestOptions?: RequestOptions) =>
        request<MemoryDeleteOutput>(
          {
            method: "DELETE",
            path: `/memory/file`,
            query: { spaceId: input["spaceId"], path: input["path"] },
            successStatus: 204,
            declaredStatuses: [401, 403, 404],
            empty: true,
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
    app: {
      list: (input: AppListInput, requestOptions?: RequestOptions) =>
        request<AppListOutput>(
          {
            method: "GET",
            path: `/apps`,
            query: { spaceId: input["spaceId"], page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: AppGetInput, requestOptions?: RequestOptions) =>
        request<AppGetOutput>(
          {
            method: "GET",
            path: `/apps/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: AppCreateInput, requestOptions?: RequestOptions) =>
        request<AppCreateOutput>(
          {
            method: "POST",
            path: `/apps`,
            body: {
              name: input["name"],
              description: input["description"],
              icon: input["icon"],
              requiredCredentials: input["requiredCredentials"],
              environment: input["environment"],
              skills: input["skills"],
              mcps: input["mcps"],
              dependsOn: input["dependsOn"],
              slug: input["slug"],
              ownerSpaceId: input["ownerSpaceId"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: AppUpdateInput, requestOptions?: RequestOptions) =>
        request<AppUpdateOutput>(
          {
            method: "PATCH",
            path: `/apps/${encodeURIComponent(input.id)}`,
            body: {
              requiredCredentials: input["requiredCredentials"],
              environment: input["environment"],
              skills: input["skills"],
              mcps: input["mcps"],
              dependsOn: input["dependsOn"],
              name: input["name"],
              description: input["description"],
              icon: input["icon"],
              expectedRevision: input["expectedRevision"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: AppArchiveInput, requestOptions?: RequestOptions) =>
        request<AppArchiveOutput>(
          {
            method: "DELETE",
            path: `/apps/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      transferOwnership: (input: AppTransferOwnershipInput, requestOptions?: RequestOptions) =>
        request<AppTransferOwnershipOutput>(
          {
            method: "POST",
            path: `/apps/${encodeURIComponent(input.id)}/transferOwnership`,
            body: { spaceId: input["spaceId"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "app-profile": {
      list: (input: AppProfileListInput, requestOptions?: RequestOptions) =>
        request<AppProfileListOutput>(
          {
            method: "GET",
            path: `/app-profiles`,
            query: {
              appId: input["appId"],
              spaceId: input["spaceId"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: AppProfileGetInput, requestOptions?: RequestOptions) =>
        request<AppProfileGetOutput>(
          {
            method: "GET",
            path: `/app-profiles/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: AppProfileCreateInput, requestOptions?: RequestOptions) =>
        request<AppProfileCreateOutput>(
          {
            method: "POST",
            path: `/app-profiles`,
            body: {
              appId: input["appId"],
              name: input["name"],
              slug: input["slug"],
              kind: input["kind"],
              allSpaces: input["allSpaces"],
              spaceIds: input["spaceIds"],
              links: input["links"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: AppProfileUpdateInput, requestOptions?: RequestOptions) =>
        request<AppProfileUpdateOutput>(
          {
            method: "PATCH",
            path: `/app-profiles/${encodeURIComponent(input.id)}`,
            body: { name: input["name"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      access: (input: AppProfileAccessInput, requestOptions?: RequestOptions) =>
        request<AppProfileAccessOutput>(
          {
            method: "POST",
            path: `/app-profiles/${encodeURIComponent(input.id)}/access`,
            body: { add: input["add"], remove: input["remove"], allSpaces: input["allSpaces"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      link: (input: AppProfileLinkInput, requestOptions?: RequestOptions) =>
        request<AppProfileLinkOutput>(
          {
            method: "POST",
            path: `/app-profiles/${encodeURIComponent(input.id)}/link`,
            body: { appId: input["appId"], profileId: input["profileId"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      promote: (input: AppProfilePromoteInput, requestOptions?: RequestOptions) =>
        request<AppProfilePromoteOutput>(
          {
            method: "POST",
            path: `/app-profiles/${encodeURIComponent(input.id)}/promote`,
            body: {},
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "app-profile-reach": {
      "app-profile": {
        delete: (input: AppProfileReachAppProfileDeleteInput, requestOptions?: RequestOptions) =>
          request<AppProfileReachAppProfileDeleteOutput>(
            {
              method: "DELETE",
              path: `/app-profiles/${encodeURIComponent(input.id)}`,
              successStatus: 200,
              declaredStatuses: [401, 403, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
      session: {
        profiles: (input: AppProfileReachSessionProfilesInput, requestOptions?: RequestOptions) =>
          request<AppProfileReachSessionProfilesOutput>(
            {
              method: "GET",
              path: `/sessions/${encodeURIComponent(input.id)}/profiles`,
              successStatus: 200,
              declaredStatuses: [401, 403, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
      space: {
        profiles: (input: AppProfileReachSpaceProfilesInput, requestOptions?: RequestOptions) =>
          request<AppProfileReachSpaceProfilesOutput>(
            {
              method: "GET",
              path: `/spaces/${encodeURIComponent(input.id)}/profiles`,
              successStatus: 200,
              declaredStatuses: [401, 403, 404],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    "app-registry": {
      list: (input: AppRegistryListInput, requestOptions?: RequestOptions) =>
        request<AppRegistryListOutput>(
          {
            method: "GET",
            path: `/app-registry`,
            query: {
              query: input["query"],
              category: input["category"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: AppRegistryGetInput, requestOptions?: RequestOptions) =>
        request<AppRegistryGetOutput>(
          {
            method: "GET",
            path: `/app-registry/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
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
            query: { unreachable: input["unreachable"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      messages: (input: ChatMessagesInput, requestOptions?: RequestOptions) =>
        request<ChatMessagesOutput>(
          {
            method: "GET",
            path: `/sessions/${encodeURIComponent(input.id)}/messages`,
            query: { limit: input["limit"], cursor: input["cursor"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 413, 503],
            empty: false,
          },
          requestOptions,
        ),
      retry: (input: ChatRetryInput, requestOptions?: RequestOptions) =>
        request<ChatRetryOutput>(
          {
            method: "POST",
            path: `/sessions/${encodeURIComponent(input.id)}/chat/retry`,
            body: { message: input["message"] },
            successStatus: 204,
            declaredStatuses: [401, 403, 404],
            empty: true,
          },
          requestOptions,
        ),
      prepare: (input: ChatPrepareInput, requestOptions?: RequestOptions) =>
        request<ChatPrepareOutput>(
          {
            method: "POST",
            path: `/spaces/${encodeURIComponent(input.id)}/chat/prepare`,
            successStatus: 204,
            declaredStatuses: [401, 403, 404],
            empty: true,
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
            query: { spaceId: input["spaceId"], page: input["page"], pageSize: input["pageSize"] },
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
            body: { spaceId: input["spaceId"], name: input["name"], color: input["color"] },
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
    schedule: {
      list: (input: ScheduleListInput, requestOptions?: RequestOptions) =>
        request<ScheduleListOutput>(
          {
            method: "GET",
            path: `/schedules`,
            query: {
              spaceId: input["spaceId"],
              status: input["status"],
              search: input["search"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: ScheduleGetInput, requestOptions?: RequestOptions) =>
        request<ScheduleGetOutput>(
          {
            method: "GET",
            path: `/schedules/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ScheduleCreateInput, requestOptions?: RequestOptions) =>
        request<ScheduleCreateOutput>(
          {
            method: "POST",
            path: `/schedules`,
            body: {
              spaceId: input["spaceId"],
              name: input["name"],
              slug: input["slug"],
              message: input["message"],
              when: input["when"],
              target: input["target"],
              agentId: input["agentId"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ScheduleUpdateInput, requestOptions?: RequestOptions) =>
        request<ScheduleUpdateOutput>(
          {
            method: "PATCH",
            path: `/schedules/${encodeURIComponent(input.id)}`,
            body: {
              name: input["name"],
              message: input["message"],
              when: input["when"],
              target: input["target"],
              agentId: input["agentId"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: ScheduleArchiveInput, requestOptions?: RequestOptions) =>
        request<ScheduleArchiveOutput>(
          {
            method: "DELETE",
            path: `/schedules/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      pause: (input: SchedulePauseInput, requestOptions?: RequestOptions) =>
        request<SchedulePauseOutput>(
          {
            method: "POST",
            path: `/schedules/${encodeURIComponent(input.id)}/pause`,
            body: {},
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      resume: (input: ScheduleResumeInput, requestOptions?: RequestOptions) =>
        request<ScheduleResumeOutput>(
          {
            method: "POST",
            path: `/schedules/${encodeURIComponent(input.id)}/resume`,
            body: {},
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      run: (input: ScheduleRunInput, requestOptions?: RequestOptions) =>
        request<ScheduleRunOutput>(
          {
            method: "POST",
            path: `/schedules/${encodeURIComponent(input.id)}/run`,
            body: {},
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "schedule-run": {
      list: (input: ScheduleRunListInput, requestOptions?: RequestOptions) =>
        request<ScheduleRunListOutput>(
          {
            method: "GET",
            path: `/schedule-runs`,
            query: { scheduleId: input["scheduleId"], page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
    },
    credential: {
      list: (input: CredentialListInput, requestOptions?: RequestOptions) =>
        request<CredentialListOutput>(
          {
            method: "GET",
            path: `/credentials`,
            query: {
              owner: input["owner"],
              spaceId: input["spaceId"],
              type: input["type"],
              search: input["search"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: CredentialGetInput, requestOptions?: RequestOptions) =>
        request<CredentialGetOutput>(
          {
            method: "GET",
            path: `/credentials/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: CredentialCreateInput, requestOptions?: RequestOptions) =>
        request<CredentialCreateOutput>(
          {
            method: "POST",
            path: `/credentials`,
            body: input["payload"],
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: CredentialUpdateInput, requestOptions?: RequestOptions) =>
        request<CredentialUpdateOutput>(
          {
            method: "PATCH",
            path: `/credentials/${encodeURIComponent(input.id)}`,
            body: { name: input["name"], hosts: input["hosts"], delivery: input["delivery"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      rotate: (input: CredentialRotateInput, requestOptions?: RequestOptions) =>
        request<CredentialRotateOutput>(
          {
            method: "POST",
            path: `/credentials/${encodeURIComponent(input.id)}/rotate`,
            body: { value: input["value"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      move: (input: CredentialMoveInput, requestOptions?: RequestOptions) =>
        request<CredentialMoveOutput>(
          {
            method: "POST",
            path: `/credentials/${encodeURIComponent(input.id)}/move`,
            body: { owner: input["owner"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      copy: (input: CredentialCopyInput, requestOptions?: RequestOptions) =>
        request<CredentialCopyOutput>(
          {
            method: "POST",
            path: `/credentials/${encodeURIComponent(input.id)}/copy`,
            body: { owner: input["owner"] },
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: CredentialRemoveInput, requestOptions?: RequestOptions) =>
        request<CredentialRemoveOutput>(
          {
            method: "POST",
            path: `/credentials/${encodeURIComponent(input.id)}/remove`,
            body: {},
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "credential-connect": {
      credential: {
        connect: (input: CredentialConnectCredentialConnectInput, requestOptions?: RequestOptions) =>
          request<CredentialConnectCredentialConnectOutput>(
            {
              method: "POST",
              path: `/credentials/connect`,
              body: { profileId: input["profileId"], item: input["item"], reconnect: input["reconnect"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 404, 409],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    "oauth-session": {
      get: (input: OauthSessionGetInput, requestOptions?: RequestOptions) =>
        request<OauthSessionGetOutput>(
          {
            method: "GET",
            path: `/oauth-sessions/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
    },
    "oauth-app": {
      list: (input: OauthAppListInput, requestOptions?: RequestOptions) =>
        request<OauthAppListOutput>(
          {
            method: "GET",
            path: `/oauth-apps`,
            query: { page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      get: (input: OauthAppGetInput, requestOptions?: RequestOptions) =>
        request<OauthAppGetOutput>(
          {
            method: "GET",
            path: `/oauth-apps/${encodeURIComponent(input.idOrSlug)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: OauthAppCreateInput, requestOptions?: RequestOptions) =>
        request<OauthAppCreateOutput>(
          {
            method: "POST",
            path: `/oauth-apps`,
            body: {
              name: input["name"],
              clientId: input["clientId"],
              clientSecret: input["clientSecret"],
              scopes: input["scopes"],
              discovery: input["discovery"],
              authorizationEndpoint: input["authorizationEndpoint"],
              tokenEndpoint: input["tokenEndpoint"],
              tokenEndpointAuth: input["tokenEndpointAuth"],
              resource: input["resource"],
              authorizeParams: input["authorizeParams"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: OauthAppUpdateInput, requestOptions?: RequestOptions) =>
        request<OauthAppUpdateOutput>(
          {
            method: "PATCH",
            path: `/oauth-apps/${encodeURIComponent(input.id)}`,
            body: {
              name: input["name"],
              clientId: input["clientId"],
              clientSecret: input["clientSecret"],
              scopes: input["scopes"],
              discovery: input["discovery"],
              authorizationEndpoint: input["authorizationEndpoint"],
              tokenEndpoint: input["tokenEndpoint"],
              tokenEndpointAuth: input["tokenEndpointAuth"],
              resource: input["resource"],
              authorizeParams: input["authorizeParams"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      archive: (input: OauthAppArchiveInput, requestOptions?: RequestOptions) =>
        request<OauthAppArchiveOutput>(
          {
            method: "DELETE",
            path: `/oauth-apps/${encodeURIComponent(input.id)}`,
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "ren-inference": {
      connect: (input: RenInferenceConnectInput, requestOptions?: RequestOptions) =>
        request<RenInferenceConnectOutput>(
          {
            method: "POST",
            path: `/ren-inference/connect`,
            body: { returnUrl: input["returnUrl"], connectionId: input["connectionId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 503],
            empty: false,
          },
          requestOptions,
        ),
      connection: {
        list: (requestOptions?: RequestOptions) =>
          request<RenInferenceConnectionListOutput>(
            {
              method: "GET",
              path: `/ren-inference/connections`,
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 404, 503],
              empty: false,
            },
            requestOptions,
          ),
        rename: (input: RenInferenceConnectionRenameInput, requestOptions?: RequestOptions) =>
          request<RenInferenceConnectionRenameOutput>(
            {
              method: "PATCH",
              path: `/ren-inference/connections/${encodeURIComponent(input.id)}`,
              body: { label: input["label"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 404, 503],
              empty: false,
            },
            requestOptions,
          ),
        remove: (input: RenInferenceConnectionRemoveInput, requestOptions?: RequestOptions) =>
          request<RenInferenceConnectionRemoveOutput>(
            {
              method: "DELETE",
              path: `/ren-inference/connections/${encodeURIComponent(input.id)}`,
              successStatus: 204,
              declaredStatuses: [400, 401, 403, 404, 503],
              empty: true,
            },
            requestOptions,
          ),
      },
    },
    "channel-install": {
      list: (input: ChannelInstallListInput, requestOptions?: RequestOptions) =>
        request<ChannelInstallListOutput>(
          {
            method: "GET",
            path: `/channel-installs`,
            query: { page: input["page"], pageSize: input["pageSize"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      update: (input: ChannelInstallUpdateInput, requestOptions?: RequestOptions) =>
        request<ChannelInstallUpdateOutput>(
          {
            method: "PATCH",
            path: `/channel-installs/${encodeURIComponent(input.id)}`,
            body: { defaultSpaceId: input["defaultSpaceId"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ChannelInstallRemoveInput, requestOptions?: RequestOptions) =>
        request<ChannelInstallRemoveOutput>(
          {
            method: "POST",
            path: `/channel-installs/${encodeURIComponent(input.id)}/remove`,
            body: {},
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "channel-mapping": {
      list: (input: ChannelMappingListInput, requestOptions?: RequestOptions) =>
        request<ChannelMappingListOutput>(
          {
            method: "GET",
            path: `/channel-mappings`,
            query: {
              installId: input["installId"],
              spaceId: input["spaceId"],
              page: input["page"],
              pageSize: input["pageSize"],
            },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      create: (input: ChannelMappingCreateInput, requestOptions?: RequestOptions) =>
        request<ChannelMappingCreateOutput>(
          {
            method: "POST",
            path: `/channel-mappings`,
            body: {
              installId: input["installId"],
              place: input["place"],
              spaceId: input["spaceId"],
              agentId: input["agentId"],
              fallback: input["fallback"],
              fallbackUserId: input["fallbackUserId"],
              triggers: input["triggers"],
            },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
      remove: (input: ChannelMappingRemoveInput, requestOptions?: RequestOptions) =>
        request<ChannelMappingRemoveOutput>(
          {
            method: "POST",
            path: `/channel-mappings/${encodeURIComponent(input.id)}/remove`,
            body: {},
            successStatus: 200,
            declaredStatuses: [401, 403, 404, 409],
            empty: false,
          },
          requestOptions,
        ),
    },
    "channel-connect": {
      "channel-provider": {
        list: (requestOptions?: RequestOptions) =>
          request<ChannelConnectChannelProviderListOutput>(
            {
              method: "GET",
              path: `/channel-providers`,
              successStatus: 200,
              declaredStatuses: [401, 403],
              empty: false,
            },
            requestOptions,
          ),
      },
      "channel-install": {
        start: (input: ChannelConnectChannelInstallStartInput, requestOptions?: RequestOptions) =>
          request<ChannelConnectChannelInstallStartOutput>(
            {
              method: "POST",
              path: `/channel-installs/start`,
              body: { provider: input["provider"] },
              successStatus: 200,
              declaredStatuses: [400, 401, 403, 404, 409],
              empty: false,
            },
            requestOptions,
          ),
      },
      "channel-place": {
        list: (input: ChannelConnectChannelPlaceListInput, requestOptions?: RequestOptions) =>
          request<ChannelConnectChannelPlaceListOutput>(
            {
              method: "GET",
              path: `/channel-places`,
              query: { installId: input["installId"], page: input["page"], pageSize: input["pageSize"] },
              successStatus: 200,
              declaredStatuses: [401, 403, 404, 503],
              empty: false,
            },
            requestOptions,
          ),
      },
    },
    repository: {
      list: (requestOptions?: RequestOptions) =>
        request<RepositoryListOutput>(
          { method: "GET", path: `/repositories`, successStatus: 200, declaredStatuses: [401, 403, 503], empty: false },
          requestOptions,
        ),
    },
    "sign-in": {
      "sign-in-provider": {
        list: (requestOptions?: RequestOptions) =>
          request<SignInSignInProviderListOutput>(
            { method: "GET", path: `/sign-in-providers`, successStatus: 200, declaredStatuses: [], empty: false },
            requestOptions,
          ),
      },
    },
    infra: {
      pull: (requestOptions?: RequestOptions) =>
        request<InfraPullOutput>(
          { method: "GET", path: `/infra`, successStatus: 200, declaredStatuses: [401, 403], empty: false },
          requestOptions,
        ),
      plan: (input: InfraPlanInput, requestOptions?: RequestOptions) =>
        request<InfraPlanOutput>(
          {
            method: "POST",
            path: `/infra/plan`,
            body: { spec: input["spec"], bindings: input["bindings"] },
            successStatus: 200,
            declaredStatuses: [401, 403],
            empty: false,
          },
          requestOptions,
        ),
      apply: (input: InfraApplyInput, requestOptions?: RequestOptions) =>
        request<InfraApplyOutput>(
          {
            method: "POST",
            path: `/infra/apply`,
            body: { spec: input["spec"], bindings: input["bindings"], digest: input["digest"] },
            successStatus: 200,
            declaredStatuses: [400, 401, 403, 404, 409],
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
