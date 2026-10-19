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
  EnvironmentListInput,
  EnvironmentGetInput,
  EnvironmentCreateInput,
  EnvironmentUpdateInput,
  EnvironmentArchiveInput,
  SpaceEnvironmentListInput,
  SpaceEnvironmentCreateInput,
  SpaceEnvironmentArchiveInput,
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
    environment: {
      list: {
        queryKey: (input?: EnvironmentListInput) =>
          input === undefined ? (["environment", "list"] as const) : (["environment", "list", input] as const),
        queryOptions: (input: EnvironmentListInput) =>
          queryOptions({
            queryKey: ["environment", "list", input] as const,
            queryFn: (context) => client["environment"]["list"](input, { signal: context.signal }),
          }),
      },
      get: {
        queryKey: (input?: EnvironmentGetInput) =>
          input === undefined ? (["environment", "get"] as const) : (["environment", "get", input] as const),
        queryOptions: (input: EnvironmentGetInput) =>
          queryOptions({
            queryKey: ["environment", "get", input] as const,
            queryFn: (context) => client["environment"]["get"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["environment", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["environment", "create"] as const,
            mutationFn: (input: EnvironmentCreateInput) => client["environment"]["create"](input),
          }),
      },
      update: {
        mutationKey: () => ["environment", "update"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["environment", "update"] as const,
            mutationFn: (input: EnvironmentUpdateInput) => client["environment"]["update"](input),
          }),
      },
      archive: {
        mutationKey: () => ["environment", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["environment", "archive"] as const,
            mutationFn: (input: EnvironmentArchiveInput) => client["environment"]["archive"](input),
          }),
      },
    },
    handProvider: {
      list: {
        queryKey: () => ["handProvider", "list"] as const,
        queryOptions: () =>
          queryOptions({
            queryKey: ["handProvider", "list"] as const,
            queryFn: (context) => client["handProvider"]["list"]({ signal: context.signal }),
          }),
      },
    },
    "space-environment": {
      list: {
        queryKey: (input?: SpaceEnvironmentListInput) =>
          input === undefined
            ? (["space-environment", "list"] as const)
            : (["space-environment", "list", input] as const),
        queryOptions: (input: SpaceEnvironmentListInput) =>
          queryOptions({
            queryKey: ["space-environment", "list", input] as const,
            queryFn: (context) => client["space-environment"]["list"](input, { signal: context.signal }),
          }),
      },
      create: {
        mutationKey: () => ["space-environment", "create"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space-environment", "create"] as const,
            mutationFn: (input: SpaceEnvironmentCreateInput) => client["space-environment"]["create"](input),
          }),
      },
      archive: {
        mutationKey: () => ["space-environment", "archive"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["space-environment", "archive"] as const,
            mutationFn: (input: SpaceEnvironmentArchiveInput) => client["space-environment"]["archive"](input),
          }),
      },
    },
  }
}
