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
  SessionListInput,
  SessionGetInput,
  SessionCreateInput,
  SessionArchiveInput,
  ChatAccessInput,
  ChatForkInput,
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
      fork: {
        mutationKey: () => ["chat", "fork"] as const,
        mutationOptions: () =>
          mutationOptions({
            mutationKey: ["chat", "fork"] as const,
            mutationFn: (input: ChatForkInput) => client["chat"]["fork"](input),
          }),
      },
    },
  }
}
