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
  }
}
