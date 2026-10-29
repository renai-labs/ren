import { queryOptions, mutationOptions } from "@tanstack/react-query"
import type {
  Ren,
  InvitationPreviewInput,
  SpaceListInput,
  SpaceGetInput,
  SpaceCreateInput,
  SpaceUpdateInput,
  SpaceArchiveInput,
  SpaceMemberListInput,
  SpaceMemberCreateInput,
  SpaceMemberArchiveInput,
  EnvironmentTemplateListInput,
  EnvironmentTemplateGetInput,
  EnvironmentTemplateCreateInput,
  EnvironmentTemplateUpdateInput,
  EnvironmentTemplateArchiveInput,
  SpaceEnvironmentTemplateListInput,
  SpaceEnvironmentTemplateCreateInput,
  SpaceEnvironmentTemplateArchiveInput,
  SpaceSettingsGetInput,
  SpaceSettingsUpdateInput,
  OrganizationSettingsGetInput,
  OrganizationSettingsUpdateInput,
  MemoryListInput,
  MemoryReadInput,
  MemoryWriteInput,
  MemoryEditInput,
  MemoryDeleteInput,
  DriveListInput,
  DriveStartUploadInput,
  DriveDownloadInput,
  DriveDeleteInput,
  AgentListInput,
  AgentGetInput,
  AgentCreateInput,
  AgentUpdateInput,
  AgentArchiveInput,
  AgentTransferOwnershipInput,
  AppListInput,
  AppGetInput,
  AppCreateInput,
  AppUpdateInput,
  AppArchiveInput,
  AppTransferOwnershipInput,
  AppProfileListInput,
  AppProfileGetInput,
  AppProfileCreateInput,
  AppProfileUpdateInput,
  AppProfileAccessInput,
  AppProfileLinkInput,
  AppProfilePromoteInput,
  AppProfileReachAppProfileDeleteInput,
  AppProfileReachSessionProfilesInput,
  AppProfileReachSpaceProfilesInput,
  AppRegistryListInput,
  AppRegistryGetInput,
  AgentMembershipListInput,
  AgentMembershipCreateInput,
  AgentMembershipArchiveInput,
  SessionListInput,
  SessionGetInput,
  SessionCreateInput,
  SessionArchiveInput,
  ChatAccessInput,
  ChatMessagesInput,
  ChatRetryInput,
  ChatPrepareInput,
  ChatModelsInput,
  TaskListInput,
  TaskGetInput,
  TaskCreateInput,
  TaskUpdateInput,
  TaskArchiveInput,
  TaskAssignInput,
  TaskStartInput,
  TaskReviewInput,
  TaskCommentCreateInput,
  TaskCommentUpdateInput,
  TaskCommentArchiveInput,
  TaskActivityListInput,
  LabelListInput,
  LabelCreateInput,
  LabelUpdateInput,
  LabelArchiveInput,
  ScheduleListInput,
  ScheduleGetInput,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ScheduleArchiveInput,
  SchedulePauseInput,
  ScheduleResumeInput,
  ScheduleRunInput,
  ScheduleRunListInput,
  CredentialListInput,
  CredentialGetInput,
  CredentialCreateInput,
  CredentialUpdateInput,
  CredentialRotateInput,
  CredentialMoveInput,
  CredentialCopyInput,
  CredentialRemoveInput,
  CredentialConnectCredentialConnectInput,
  OauthSessionGetInput,
  OauthAppListInput,
  OauthAppGetInput,
  OauthAppCreateInput,
  OauthAppUpdateInput,
  OauthAppArchiveInput,
  RenInferenceConnectInput,
  RenInferenceConnectionRenameInput,
  RenInferenceConnectionRemoveInput,
  ChannelInstallListInput,
  ChannelInstallUpdateInput,
  ChannelInstallRemoveInput,
  ChannelMappingListInput,
  ChannelMappingCreateInput,
  ChannelMappingRemoveInput,
  ChannelConnectChannelInstallStartInput,
  ChannelConnectChannelPlaceListInput,
  InfraPlanInput,
  InfraApplyInput,
  InsightsQueryInput,
} from "../../generated/index.js"

export function make(client: ReturnType<typeof Ren.make>) {
  return {
    health: {
      get: {
        queryKey: () => ["health", "get"] as const,
        queryOptions: () =>
          queryOptions({
            queryKey: ["health", "get"] as const,
            queryFn: (context) => client["health"]["get"]({ signal: context.signal }),
          }),
      },
    },
    me: {
      get: {
        queryKey: () => ["me", "get"] as const,
        queryOptions: () =>
          queryOptions({
            queryKey: ["me", "get"] as const,
            queryFn: (context) => client["me"]["get"]({ signal: context.signal }),
          }),
      },
    },
    invitation: {
      preview: {
        queryKey: (input?: InvitationPreviewInput) =>
          input === undefined ? (["invitation", "preview"] as const) : (["invitation", "preview", input] as const),
        queryOptions: (input: InvitationPreviewInput) =>
          queryOptions({
            queryKey: ["invitation", "preview", input] as const,
            queryFn: (context) => client["invitation"]["preview"](input, { signal: context.signal }),
          }),
      },
    },
    space: {
      list: {
        queryKey: (input?: SpaceListInput) =>
          input === undefined ? (["space", "list"] as const) : (["space", "list", input] as const),
        queryOptions: (input: SpaceListInput) =>
          queryOptions({
            queryKey: ["space", "list", input] as const,
            queryFn: (context) => client["space"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: SpaceGetInput) =>
          input === undefined ? (["space", "get"] as const) : (["space", "get", input] as const),
        queryOptions: (input: SpaceGetInput) =>
          queryOptions({
            queryKey: ["space", "get", input] as const,
            queryFn: (context) => client["space"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["space", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space", "create"] as const,
            mutationFn: (input: SpaceCreateInput) => client["space"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["space", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space", "update"] as const,
            mutationFn: (input: SpaceUpdateInput) => client["space"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["space", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space", "archive"] as const,
            mutationFn: (input: SpaceArchiveInput) => client["space"]["archive"](input),
          }),
      },
    },
    "space-member": {
      list: {
        queryKey: (input?: SpaceMemberListInput) =>
          input === undefined ? (["space-member", "list"] as const) : (["space-member", "list", input] as const),
        queryOptions: (input: SpaceMemberListInput) =>
          queryOptions({
            queryKey: ["space-member", "list", input] as const,
            queryFn: (context) => client["space-member"]["list"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["space-member", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space-member", "create"] as const,
            mutationFn: (input: SpaceMemberCreateInput) => client["space-member"]["create"](input),
          }),
      },
      archive: {
        mutationKey: () => ["space-member", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space-member", "archive"] as const,
            mutationFn: (input: SpaceMemberArchiveInput) => client["space-member"]["archive"](input),
          }),
      },
    },
    "environment-template": {
      list: {
        queryKey: (input?: EnvironmentTemplateListInput) =>
          input === undefined
            ? (["environment-template", "list"] as const)
            : (["environment-template", "list", input] as const),
        queryOptions: (input: EnvironmentTemplateListInput) =>
          queryOptions({
            queryKey: ["environment-template", "list", input] as const,
            queryFn: (context) => client["environment-template"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: EnvironmentTemplateGetInput) =>
          input === undefined
            ? (["environment-template", "get"] as const)
            : (["environment-template", "get", input] as const),
        queryOptions: (input: EnvironmentTemplateGetInput) =>
          queryOptions({
            queryKey: ["environment-template", "get", input] as const,
            queryFn: (context) => client["environment-template"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["environment-template", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["environment-template", "create"] as const,
            mutationFn: (input: EnvironmentTemplateCreateInput) => client["environment-template"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["environment-template", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["environment-template", "update"] as const,
            mutationFn: (input: EnvironmentTemplateUpdateInput) => client["environment-template"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["environment-template", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["environment-template", "archive"] as const,
            mutationFn: (input: EnvironmentTemplateArchiveInput) => client["environment-template"]["archive"](input),
          }),
      },
    },
    environmentProvider: {
      list: {
        queryKey: () => ["environmentProvider", "list"] as const,
        queryOptions: () =>
          queryOptions({
            queryKey: ["environmentProvider", "list"] as const,
            queryFn: (context) => client["environmentProvider"]["list"]({ signal: context.signal }),
          }),
      },
    },
    "space-environment-template": {
      list: {
        queryKey: (input?: SpaceEnvironmentTemplateListInput) =>
          input === undefined
            ? (["space-environment-template", "list"] as const)
            : (["space-environment-template", "list", input] as const),
        queryOptions: (input: SpaceEnvironmentTemplateListInput) =>
          queryOptions({
            queryKey: ["space-environment-template", "list", input] as const,
            queryFn: (context) => client["space-environment-template"]["list"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["space-environment-template", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space-environment-template", "create"] as const,
            mutationFn: (input: SpaceEnvironmentTemplateCreateInput) =>
              client["space-environment-template"]["create"](input),
          }),
      },
      archive: {
        mutationKey: () => ["space-environment-template", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space-environment-template", "archive"] as const,
            mutationFn: (input: SpaceEnvironmentTemplateArchiveInput) =>
              client["space-environment-template"]["archive"](input),
          }),
      },
    },
    "space-settings": {
      get: {
        queryKey: (input?: SpaceSettingsGetInput) =>
          input === undefined ? (["space-settings", "get"] as const) : (["space-settings", "get", input] as const),
        queryOptions: (input: SpaceSettingsGetInput) =>
          queryOptions({
            queryKey: ["space-settings", "get", input] as const,
            queryFn: (context) => client["space-settings"]["get"](input, { signal: context.signal }),
          }),
      },
      update: {
        mutationKey: () => ["space-settings", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space-settings", "update"] as const,
            mutationFn: (input: SpaceSettingsUpdateInput) => client["space-settings"]["update"](input),
          }),
      },
    },
    "organization-settings": {
      get: {
        queryKey: (input?: OrganizationSettingsGetInput) =>
          input === undefined
            ? (["organization-settings", "get"] as const)
            : (["organization-settings", "get", input] as const),
        queryOptions: (input: OrganizationSettingsGetInput) =>
          queryOptions({
            queryKey: ["organization-settings", "get", input] as const,
            queryFn: (context) => client["organization-settings"]["get"](input, { signal: context.signal }),
          }),
      },
      update: {
        mutationKey: () => ["organization-settings", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["organization-settings", "update"] as const,
            mutationFn: (input: OrganizationSettingsUpdateInput) => client["organization-settings"]["update"](input),
          }),
      },
    },
    memory: {
      list: {
        queryKey: (input?: MemoryListInput) =>
          input === undefined ? (["memory", "list"] as const) : (["memory", "list", input] as const),
        queryOptions: (input?: MemoryListInput) =>
          queryOptions({
            queryKey: ["memory", "list", input] as const,
            queryFn: (context) => client["memory"]["list"](input, { signal: context.signal }),
          }),
      },
      read: {
        queryKey: (input?: MemoryReadInput) =>
          input === undefined ? (["memory", "read"] as const) : (["memory", "read", input] as const),
        queryOptions: (input: MemoryReadInput) =>
          queryOptions({
            queryKey: ["memory", "read", input] as const,
            queryFn: (context) => client["memory"]["read"](input, { signal: context.signal }),
          }),
      },
      write: {
        mutationKey: () => ["memory", "write"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["memory", "write"] as const,
            mutationFn: (input: MemoryWriteInput) => client["memory"]["write"](input),
          }),
      },
      edit: {
        mutationKey: () => ["memory", "edit"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["memory", "edit"] as const,
            mutationFn: (input: MemoryEditInput) => client["memory"]["edit"](input),
          }),
      },
      delete: {
        mutationKey: () => ["memory", "delete"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["memory", "delete"] as const,
            mutationFn: (input: MemoryDeleteInput) => client["memory"]["delete"](input),
          }),
      },
    },
    drive: {
      list: {
        queryKey: (input?: DriveListInput) =>
          input === undefined ? (["drive", "list"] as const) : (["drive", "list", input] as const),
        queryOptions: (input?: DriveListInput) =>
          queryOptions({
            queryKey: ["drive", "list", input] as const,
            queryFn: (context) => client["drive"]["list"](input, { signal: context.signal }),
          }),
      },
      startUpload: {
        mutationKey: () => ["drive", "startUpload"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["drive", "startUpload"] as const,
            mutationFn: (input: DriveStartUploadInput) => client["drive"]["startUpload"](input),
          }),
      },
      download: {
        queryKey: (input?: DriveDownloadInput) =>
          input === undefined ? (["drive", "download"] as const) : (["drive", "download", input] as const),
        queryOptions: (input: DriveDownloadInput) =>
          queryOptions({
            queryKey: ["drive", "download", input] as const,
            queryFn: (context) => client["drive"]["download"](input, { signal: context.signal }),
          }),
      },
      delete: {
        mutationKey: () => ["drive", "delete"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["drive", "delete"] as const,
            mutationFn: (input: DriveDeleteInput) => client["drive"]["delete"](input),
          }),
      },
    },
    agent: {
      list: {
        queryKey: (input?: AgentListInput) =>
          input === undefined ? (["agent", "list"] as const) : (["agent", "list", input] as const),
        queryOptions: (input: AgentListInput) =>
          queryOptions({
            queryKey: ["agent", "list", input] as const,
            queryFn: (context) => client["agent"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: AgentGetInput) =>
          input === undefined ? (["agent", "get"] as const) : (["agent", "get", input] as const),
        queryOptions: (input: AgentGetInput) =>
          queryOptions({
            queryKey: ["agent", "get", input] as const,
            queryFn: (context) => client["agent"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["agent", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["agent", "create"] as const,
            mutationFn: (input: AgentCreateInput) => client["agent"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["agent", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["agent", "update"] as const,
            mutationFn: (input: AgentUpdateInput) => client["agent"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["agent", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["agent", "archive"] as const,
            mutationFn: (input: AgentArchiveInput) => client["agent"]["archive"](input),
          }),
      },
      transferOwnership: {
        mutationKey: () => ["agent", "transferOwnership"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["agent", "transferOwnership"] as const,
            mutationFn: (input: AgentTransferOwnershipInput) => client["agent"]["transferOwnership"](input),
          }),
      },
    },
    app: {
      list: {
        queryKey: (input?: AppListInput) =>
          input === undefined ? (["app", "list"] as const) : (["app", "list", input] as const),
        queryOptions: (input: AppListInput) =>
          queryOptions({
            queryKey: ["app", "list", input] as const,
            queryFn: (context) => client["app"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: AppGetInput) =>
          input === undefined ? (["app", "get"] as const) : (["app", "get", input] as const),
        queryOptions: (input: AppGetInput) =>
          queryOptions({
            queryKey: ["app", "get", input] as const,
            queryFn: (context) => client["app"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["app", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app", "create"] as const,
            mutationFn: (input: AppCreateInput) => client["app"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["app", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app", "update"] as const,
            mutationFn: (input: AppUpdateInput) => client["app"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["app", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app", "archive"] as const,
            mutationFn: (input: AppArchiveInput) => client["app"]["archive"](input),
          }),
      },
      transferOwnership: {
        mutationKey: () => ["app", "transferOwnership"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app", "transferOwnership"] as const,
            mutationFn: (input: AppTransferOwnershipInput) => client["app"]["transferOwnership"](input),
          }),
      },
    },
    "app-profile": {
      list: {
        queryKey: (input?: AppProfileListInput) =>
          input === undefined ? (["app-profile", "list"] as const) : (["app-profile", "list", input] as const),
        queryOptions: (input: AppProfileListInput) =>
          queryOptions({
            queryKey: ["app-profile", "list", input] as const,
            queryFn: (context) => client["app-profile"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: AppProfileGetInput) =>
          input === undefined ? (["app-profile", "get"] as const) : (["app-profile", "get", input] as const),
        queryOptions: (input: AppProfileGetInput) =>
          queryOptions({
            queryKey: ["app-profile", "get", input] as const,
            queryFn: (context) => client["app-profile"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["app-profile", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app-profile", "create"] as const,
            mutationFn: (input: AppProfileCreateInput) => client["app-profile"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["app-profile", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app-profile", "update"] as const,
            mutationFn: (input: AppProfileUpdateInput) => client["app-profile"]["update"](input),
          }),
      },
      access: {
        mutationKey: () => ["app-profile", "access"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app-profile", "access"] as const,
            mutationFn: (input: AppProfileAccessInput) => client["app-profile"]["access"](input),
          }),
      },
      link: {
        mutationKey: () => ["app-profile", "link"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app-profile", "link"] as const,
            mutationFn: (input: AppProfileLinkInput) => client["app-profile"]["link"](input),
          }),
      },
      promote: {
        mutationKey: () => ["app-profile", "promote"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["app-profile", "promote"] as const,
            mutationFn: (input: AppProfilePromoteInput) => client["app-profile"]["promote"](input),
          }),
      },
    },
    "app-profile-reach": {
      "app-profile": {
        delete: {
          mutationKey: () => ["app-profile-reach", "app-profile", "delete"] as const,
          mutationOptions: () =>
            mutationOptions({
              mutationKey: ["app-profile-reach", "app-profile", "delete"] as const,
              mutationFn: (input: AppProfileReachAppProfileDeleteInput) =>
                client["app-profile-reach"]["app-profile"]["delete"](input),
            }),
        },
      },
      session: {
        profiles: {
          queryKey: (input?: AppProfileReachSessionProfilesInput) =>
            input === undefined
              ? (["app-profile-reach", "session", "profiles"] as const)
              : (["app-profile-reach", "session", "profiles", input] as const),
          queryOptions: (input: AppProfileReachSessionProfilesInput) =>
            queryOptions({
              queryKey: ["app-profile-reach", "session", "profiles", input] as const,
              queryFn: (context) =>
                client["app-profile-reach"]["session"]["profiles"](input, { signal: context.signal }),
            }),
        },
      },
      space: {
        profiles: {
          queryKey: (input?: AppProfileReachSpaceProfilesInput) =>
            input === undefined
              ? (["app-profile-reach", "space", "profiles"] as const)
              : (["app-profile-reach", "space", "profiles", input] as const),
          queryOptions: (input: AppProfileReachSpaceProfilesInput) =>
            queryOptions({
              queryKey: ["app-profile-reach", "space", "profiles", input] as const,
              queryFn: (context) => client["app-profile-reach"]["space"]["profiles"](input, { signal: context.signal }),
            }),
        },
      },
    },
    "app-registry": {
      list: {
        queryKey: (input?: AppRegistryListInput) =>
          input === undefined ? (["app-registry", "list"] as const) : (["app-registry", "list", input] as const),
        queryOptions: (input: AppRegistryListInput) =>
          queryOptions({
            queryKey: ["app-registry", "list", input] as const,
            queryFn: (context) => client["app-registry"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: AppRegistryGetInput) =>
          input === undefined ? (["app-registry", "get"] as const) : (["app-registry", "get", input] as const),
        queryOptions: (input: AppRegistryGetInput) =>
          queryOptions({
            queryKey: ["app-registry", "get", input] as const,
            queryFn: (context) => client["app-registry"]["get"](input, { signal: context.signal }),
          }),
      },
    },
    "agent-membership": {
      list: {
        queryKey: (input?: AgentMembershipListInput) =>
          input === undefined
            ? (["agent-membership", "list"] as const)
            : (["agent-membership", "list", input] as const),
        queryOptions: (input: AgentMembershipListInput) =>
          queryOptions({
            queryKey: ["agent-membership", "list", input] as const,
            queryFn: (context) => client["agent-membership"]["list"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["agent-membership", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["agent-membership", "create"] as const,
            mutationFn: (input: AgentMembershipCreateInput) => client["agent-membership"]["create"](input),
          }),
      },
      archive: {
        mutationKey: () => ["agent-membership", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["agent-membership", "archive"] as const,
            mutationFn: (input: AgentMembershipArchiveInput) => client["agent-membership"]["archive"](input),
          }),
      },
    },
    session: {
      list: {
        queryKey: (input?: SessionListInput) =>
          input === undefined ? (["session", "list"] as const) : (["session", "list", input] as const),
        queryOptions: (input: SessionListInput) =>
          queryOptions({
            queryKey: ["session", "list", input] as const,
            queryFn: (context) => client["session"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: SessionGetInput) =>
          input === undefined ? (["session", "get"] as const) : (["session", "get", input] as const),
        queryOptions: (input: SessionGetInput) =>
          queryOptions({
            queryKey: ["session", "get", input] as const,
            queryFn: (context) => client["session"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["session", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["session", "create"] as const,
            mutationFn: (input: SessionCreateInput) => client["session"]["create"](input),
          }),
      },
      archive: {
        mutationKey: () => ["session", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["session", "archive"] as const,
            mutationFn: (input: SessionArchiveInput) => client["session"]["archive"](input),
          }),
      },
    },
    chat: {
      access: {
        mutationKey: () => ["chat", "access"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["chat", "access"] as const,
            mutationFn: (input: ChatAccessInput) => client["chat"]["access"](input),
          }),
      },
      messages: {
        queryKey: (input?: ChatMessagesInput) =>
          input === undefined ? (["chat", "messages"] as const) : (["chat", "messages", input] as const),
        queryOptions: (input: ChatMessagesInput) =>
          queryOptions({
            queryKey: ["chat", "messages", input] as const,
            queryFn: (context) => client["chat"]["messages"](input, { signal: context.signal }),
          }),
      },
      retry: {
        mutationKey: () => ["chat", "retry"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["chat", "retry"] as const,
            mutationFn: (input: ChatRetryInput) => client["chat"]["retry"](input),
          }),
      },
      prepare: {
        mutationKey: () => ["chat", "prepare"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["chat", "prepare"] as const,
            mutationFn: (input: ChatPrepareInput) => client["chat"]["prepare"](input),
          }),
      },
      models: {
        queryKey: (input?: ChatModelsInput) =>
          input === undefined ? (["chat", "models"] as const) : (["chat", "models", input] as const),
        queryOptions: (input: ChatModelsInput) =>
          queryOptions({
            queryKey: ["chat", "models", input] as const,
            queryFn: (context) => client["chat"]["models"](input, { signal: context.signal }),
          }),
      },
    },
    task: {
      list: {
        queryKey: (input?: TaskListInput) =>
          input === undefined ? (["task", "list"] as const) : (["task", "list", input] as const),
        queryOptions: (input: TaskListInput) =>
          queryOptions({
            queryKey: ["task", "list", input] as const,
            queryFn: (context) => client["task"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: TaskGetInput) =>
          input === undefined ? (["task", "get"] as const) : (["task", "get", input] as const),
        queryOptions: (input: TaskGetInput) =>
          queryOptions({
            queryKey: ["task", "get", input] as const,
            queryFn: (context) => client["task"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["task", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task", "create"] as const,
            mutationFn: (input: TaskCreateInput) => client["task"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["task", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task", "update"] as const,
            mutationFn: (input: TaskUpdateInput) => client["task"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["task", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task", "archive"] as const,
            mutationFn: (input: TaskArchiveInput) => client["task"]["archive"](input),
          }),
      },
      assign: {
        mutationKey: () => ["task", "assign"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task", "assign"] as const,
            mutationFn: (input: TaskAssignInput) => client["task"]["assign"](input),
          }),
      },
      start: {
        mutationKey: () => ["task", "start"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task", "start"] as const,
            mutationFn: (input: TaskStartInput) => client["task"]["start"](input),
          }),
      },
      review: {
        mutationKey: () => ["task", "review"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task", "review"] as const,
            mutationFn: (input: TaskReviewInput) => client["task"]["review"](input),
          }),
      },
    },
    "task-comment": {
      create: {
        mutationKey: () => ["task-comment", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task-comment", "create"] as const,
            mutationFn: (input: TaskCommentCreateInput) => client["task-comment"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["task-comment", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task-comment", "update"] as const,
            mutationFn: (input: TaskCommentUpdateInput) => client["task-comment"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["task-comment", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["task-comment", "archive"] as const,
            mutationFn: (input: TaskCommentArchiveInput) => client["task-comment"]["archive"](input),
          }),
      },
    },
    "task-activity": {
      list: {
        queryKey: (input?: TaskActivityListInput) =>
          input === undefined ? (["task-activity", "list"] as const) : (["task-activity", "list", input] as const),
        queryOptions: (input: TaskActivityListInput) =>
          queryOptions({
            queryKey: ["task-activity", "list", input] as const,
            queryFn: (context) => client["task-activity"]["list"](input, { signal: context.signal }),
          }),
      },
    },
    label: {
      list: {
        queryKey: (input?: LabelListInput) =>
          input === undefined ? (["label", "list"] as const) : (["label", "list", input] as const),
        queryOptions: (input: LabelListInput) =>
          queryOptions({
            queryKey: ["label", "list", input] as const,
            queryFn: (context) => client["label"]["list"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["label", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["label", "create"] as const,
            mutationFn: (input: LabelCreateInput) => client["label"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["label", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["label", "update"] as const,
            mutationFn: (input: LabelUpdateInput) => client["label"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["label", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["label", "archive"] as const,
            mutationFn: (input: LabelArchiveInput) => client["label"]["archive"](input),
          }),
      },
    },
    schedule: {
      list: {
        queryKey: (input?: ScheduleListInput) =>
          input === undefined ? (["schedule", "list"] as const) : (["schedule", "list", input] as const),
        queryOptions: (input: ScheduleListInput) =>
          queryOptions({
            queryKey: ["schedule", "list", input] as const,
            queryFn: (context) => client["schedule"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: ScheduleGetInput) =>
          input === undefined ? (["schedule", "get"] as const) : (["schedule", "get", input] as const),
        queryOptions: (input: ScheduleGetInput) =>
          queryOptions({
            queryKey: ["schedule", "get", input] as const,
            queryFn: (context) => client["schedule"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["schedule", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["schedule", "create"] as const,
            mutationFn: (input: ScheduleCreateInput) => client["schedule"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["schedule", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["schedule", "update"] as const,
            mutationFn: (input: ScheduleUpdateInput) => client["schedule"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["schedule", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["schedule", "archive"] as const,
            mutationFn: (input: ScheduleArchiveInput) => client["schedule"]["archive"](input),
          }),
      },
      pause: {
        mutationKey: () => ["schedule", "pause"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["schedule", "pause"] as const,
            mutationFn: (input: SchedulePauseInput) => client["schedule"]["pause"](input),
          }),
      },
      resume: {
        mutationKey: () => ["schedule", "resume"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["schedule", "resume"] as const,
            mutationFn: (input: ScheduleResumeInput) => client["schedule"]["resume"](input),
          }),
      },
      run: {
        mutationKey: () => ["schedule", "run"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["schedule", "run"] as const,
            mutationFn: (input: ScheduleRunInput) => client["schedule"]["run"](input),
          }),
      },
    },
    "schedule-run": {
      list: {
        queryKey: (input?: ScheduleRunListInput) =>
          input === undefined ? (["schedule-run", "list"] as const) : (["schedule-run", "list", input] as const),
        queryOptions: (input: ScheduleRunListInput) =>
          queryOptions({
            queryKey: ["schedule-run", "list", input] as const,
            queryFn: (context) => client["schedule-run"]["list"](input, { signal: context.signal }),
          }),
      },
    },
    credential: {
      list: {
        queryKey: (input?: CredentialListInput) =>
          input === undefined ? (["credential", "list"] as const) : (["credential", "list", input] as const),
        queryOptions: (input: CredentialListInput) =>
          queryOptions({
            queryKey: ["credential", "list", input] as const,
            queryFn: (context) => client["credential"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: CredentialGetInput) =>
          input === undefined ? (["credential", "get"] as const) : (["credential", "get", input] as const),
        queryOptions: (input: CredentialGetInput) =>
          queryOptions({
            queryKey: ["credential", "get", input] as const,
            queryFn: (context) => client["credential"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["credential", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["credential", "create"] as const,
            mutationFn: (input: CredentialCreateInput) => client["credential"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["credential", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["credential", "update"] as const,
            mutationFn: (input: CredentialUpdateInput) => client["credential"]["update"](input),
          }),
      },
      rotate: {
        mutationKey: () => ["credential", "rotate"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["credential", "rotate"] as const,
            mutationFn: (input: CredentialRotateInput) => client["credential"]["rotate"](input),
          }),
      },
      move: {
        mutationKey: () => ["credential", "move"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["credential", "move"] as const,
            mutationFn: (input: CredentialMoveInput) => client["credential"]["move"](input),
          }),
      },
      copy: {
        mutationKey: () => ["credential", "copy"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["credential", "copy"] as const,
            mutationFn: (input: CredentialCopyInput) => client["credential"]["copy"](input),
          }),
      },
      remove: {
        mutationKey: () => ["credential", "remove"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["credential", "remove"] as const,
            mutationFn: (input: CredentialRemoveInput) => client["credential"]["remove"](input),
          }),
      },
    },
    "credential-connect": {
      credential: {
        connect: {
          mutationKey: () => ["credential-connect", "credential", "connect"] as const,
          mutationOptions: () =>
            mutationOptions({
              mutationKey: ["credential-connect", "credential", "connect"] as const,
              mutationFn: (input: CredentialConnectCredentialConnectInput) =>
                client["credential-connect"]["credential"]["connect"](input),
            }),
        },
      },
    },
    "oauth-session": {
      get: {
        queryKey: (input?: OauthSessionGetInput) =>
          input === undefined ? (["oauth-session", "get"] as const) : (["oauth-session", "get", input] as const),
        queryOptions: (input: OauthSessionGetInput) =>
          queryOptions({
            queryKey: ["oauth-session", "get", input] as const,
            queryFn: (context) => client["oauth-session"]["get"](input, { signal: context.signal }),
          }),
      },
    },
    "oauth-app": {
      list: {
        queryKey: (input?: OauthAppListInput) =>
          input === undefined ? (["oauth-app", "list"] as const) : (["oauth-app", "list", input] as const),
        queryOptions: (input: OauthAppListInput) =>
          queryOptions({
            queryKey: ["oauth-app", "list", input] as const,
            queryFn: (context) => client["oauth-app"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: OauthAppGetInput) =>
          input === undefined ? (["oauth-app", "get"] as const) : (["oauth-app", "get", input] as const),
        queryOptions: (input: OauthAppGetInput) =>
          queryOptions({
            queryKey: ["oauth-app", "get", input] as const,
            queryFn: (context) => client["oauth-app"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["oauth-app", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["oauth-app", "create"] as const,
            mutationFn: (input: OauthAppCreateInput) => client["oauth-app"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["oauth-app", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["oauth-app", "update"] as const,
            mutationFn: (input: OauthAppUpdateInput) => client["oauth-app"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["oauth-app", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["oauth-app", "archive"] as const,
            mutationFn: (input: OauthAppArchiveInput) => client["oauth-app"]["archive"](input),
          }),
      },
    },
    "ren-inference": {
      connect: {
        mutationKey: () => ["ren-inference", "connect"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["ren-inference", "connect"] as const,
            mutationFn: (input: RenInferenceConnectInput) => client["ren-inference"]["connect"](input),
          }),
      },
      connection: {
        list: {
          queryKey: () => ["ren-inference", "connection", "list"] as const,
          queryOptions: () =>
            queryOptions({
              queryKey: ["ren-inference", "connection", "list"] as const,
              queryFn: (context) => client["ren-inference"]["connection"]["list"]({ signal: context.signal }),
            }),
        },
        rename: {
          mutationKey: () => ["ren-inference", "connection", "rename"] as const,
          mutationOptions: () =>
            mutationOptions({
              mutationKey: ["ren-inference", "connection", "rename"] as const,
              mutationFn: (input: RenInferenceConnectionRenameInput) =>
                client["ren-inference"]["connection"]["rename"](input),
            }),
        },
        remove: {
          mutationKey: () => ["ren-inference", "connection", "remove"] as const,
          mutationOptions: () =>
            mutationOptions({
              mutationKey: ["ren-inference", "connection", "remove"] as const,
              mutationFn: (input: RenInferenceConnectionRemoveInput) =>
                client["ren-inference"]["connection"]["remove"](input),
            }),
        },
      },
    },
    "channel-install": {
      list: {
        queryKey: (input?: ChannelInstallListInput) =>
          input === undefined ? (["channel-install", "list"] as const) : (["channel-install", "list", input] as const),
        queryOptions: (input: ChannelInstallListInput) =>
          queryOptions({
            queryKey: ["channel-install", "list", input] as const,
            queryFn: (context) => client["channel-install"]["list"](input, { signal: context.signal }),
          }),
      },
      update: {
        mutationKey: () => ["channel-install", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["channel-install", "update"] as const,
            mutationFn: (input: ChannelInstallUpdateInput) => client["channel-install"]["update"](input),
          }),
      },
      remove: {
        mutationKey: () => ["channel-install", "remove"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["channel-install", "remove"] as const,
            mutationFn: (input: ChannelInstallRemoveInput) => client["channel-install"]["remove"](input),
          }),
      },
    },
    "channel-mapping": {
      list: {
        queryKey: (input?: ChannelMappingListInput) =>
          input === undefined ? (["channel-mapping", "list"] as const) : (["channel-mapping", "list", input] as const),
        queryOptions: (input: ChannelMappingListInput) =>
          queryOptions({
            queryKey: ["channel-mapping", "list", input] as const,
            queryFn: (context) => client["channel-mapping"]["list"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["channel-mapping", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["channel-mapping", "create"] as const,
            mutationFn: (input: ChannelMappingCreateInput) => client["channel-mapping"]["create"](input),
          }),
      },
      remove: {
        mutationKey: () => ["channel-mapping", "remove"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["channel-mapping", "remove"] as const,
            mutationFn: (input: ChannelMappingRemoveInput) => client["channel-mapping"]["remove"](input),
          }),
      },
    },
    "channel-connect": {
      "channel-provider": {
        list: {
          queryKey: () => ["channel-connect", "channel-provider", "list"] as const,
          queryOptions: () =>
            queryOptions({
              queryKey: ["channel-connect", "channel-provider", "list"] as const,
              queryFn: (context) => client["channel-connect"]["channel-provider"]["list"]({ signal: context.signal }),
            }),
        },
      },
      "channel-install": {
        start: {
          mutationKey: () => ["channel-connect", "channel-install", "start"] as const,
          mutationOptions: () =>
            mutationOptions({
              mutationKey: ["channel-connect", "channel-install", "start"] as const,
              mutationFn: (input: ChannelConnectChannelInstallStartInput) =>
                client["channel-connect"]["channel-install"]["start"](input),
            }),
        },
      },
      "channel-place": {
        list: {
          queryKey: (input?: ChannelConnectChannelPlaceListInput) =>
            input === undefined
              ? (["channel-connect", "channel-place", "list"] as const)
              : (["channel-connect", "channel-place", "list", input] as const),
          queryOptions: (input: ChannelConnectChannelPlaceListInput) =>
            queryOptions({
              queryKey: ["channel-connect", "channel-place", "list", input] as const,
              queryFn: (context) =>
                client["channel-connect"]["channel-place"]["list"](input, { signal: context.signal }),
            }),
        },
      },
    },
    repository: {
      list: {
        queryKey: () => ["repository", "list"] as const,
        queryOptions: () =>
          queryOptions({
            queryKey: ["repository", "list"] as const,
            queryFn: (context) => client["repository"]["list"]({ signal: context.signal }),
          }),
      },
    },
    "sign-in": {
      "sign-in-provider": {
        list: {
          queryKey: () => ["sign-in", "sign-in-provider", "list"] as const,
          queryOptions: () =>
            queryOptions({
              queryKey: ["sign-in", "sign-in-provider", "list"] as const,
              queryFn: (context) => client["sign-in"]["sign-in-provider"]["list"]({ signal: context.signal }),
            }),
        },
      },
    },
    infra: {
      pull: {
        queryKey: () => ["infra", "pull"] as const,
        queryOptions: () =>
          queryOptions({
            queryKey: ["infra", "pull"] as const,
            queryFn: (context) => client["infra"]["pull"]({ signal: context.signal }),
          }),
      },
      plan: {
        mutationKey: () => ["infra", "plan"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["infra", "plan"] as const,
            mutationFn: (input: InfraPlanInput) => client["infra"]["plan"](input),
          }),
      },
      apply: {
        mutationKey: () => ["infra", "apply"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["infra", "apply"] as const,
            mutationFn: (input: InfraApplyInput) => client["infra"]["apply"](input),
          }),
      },
    },
    insights: {
      query: {
        queryKey: (input?: InsightsQueryInput) =>
          input === undefined ? (["insights", "query"] as const) : (["insights", "query", input] as const),
        queryOptions: (input: InsightsQueryInput) =>
          queryOptions({
            queryKey: ["insights", "query", input] as const,
            queryFn: (context) => client["insights"]["query"](input, { signal: context.signal }),
          }),
      },
    },
  }
}
