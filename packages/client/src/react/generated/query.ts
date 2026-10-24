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
  AgentListInput,
  AgentGetInput,
  AgentCreateInput,
  AgentUpdateInput,
  AgentArchiveInput,
  AgentTransferOwnershipInput,
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
  CredentialListInput,
  CredentialGetInput,
  CredentialCreateInput,
  CredentialUpdateInput,
  CredentialRotateInput,
  CredentialMoveInput,
  CredentialCopyInput,
  CredentialRemoveInput,
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
  }
}
