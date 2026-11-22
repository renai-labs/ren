import { Composer, Mentions, SessionTitle } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { pickerPageSize } from "../../lib/pagination.js"
import { Preference } from "../../lib/preference.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"
import { Platform } from "../../platform/platform.js"

export const categories = [
  { prefix: "tasks", label: "Tasks" },
  { prefix: "chats", label: "Chats" },
  { prefix: "apps", label: "Apps", description: "Apps the agent can use" },
  { prefix: "agents", label: "Agents", description: "Agents in this space" },
  { prefix: "files", label: "Files", description: "Files on this chat’s computer and in the space’s drive" },
  { prefix: "repos", label: "Repositories", description: "Repositories the agent can read" },
] as const

export type Category = (typeof categories)[number]

type Prefix = Category["prefix"]

export interface Scope {
  readonly category: Category | undefined
  readonly query: string
}

export const searchDelay = 200
const searchSize = 20
const recentSize = 20

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  item: Schema.Struct({
    kind: Schema.Literals(["agent", "skill", "file", "app", "repository", "task", "chat", "ren-agent"]),
    id: Schema.String,
    label: Schema.String,
    handle: Schema.String,
    description: Schema.optional(Schema.String),
    sent: Schema.optional(Schema.String),
  }),
  app: Schema.optional(Composer.MentionedApp),
  file: Schema.optional(SessionMessage.DriveFile),
  root: Schema.optional(Schema.String),
})

const Recent = Schema.Array(Entry)

export const key = (entry: Entry) =>
  entry.root ? `${entry.root}:${Mentions.key(entry.item)}` : Mentions.key(entry.item)

export function useRecent(spaceId: string | undefined, root: Session.ID | undefined) {
  const storage = Platform.usePlatform().storage
  const recent = Preference.make(`mentions.recent.${useMe().user.id}.${spaceId ?? "none"}.v1`, Recent, [])
  const entries = Preference.usePreference(recent)
  return {
    entries: entries.filter((entry) => entry.root === undefined || entry.root === root),
    add: (entry: Entry) =>
      recent.write(storage, [entry, ...entries.filter((each) => key(each) !== key(entry))].slice(0, recentSize)),
  }
}

const wants = (scope: Scope | undefined, prefix: Prefix) =>
  scope !== undefined && (scope.category?.prefix === prefix || (!scope.category && scope.query !== ""))

const named = (entries: ReadonlyArray<Entry>, filter: string) =>
  entries.filter((entry) => Mentions.named(entry.item, filter))

const escaped = (title: string) => title.replaceAll(/[[\]\\]/gu, "\\$&")

const offered = Session.Origin.literals.filter((origin) => origin !== "task")

const nameOf = (path: string) => path.replace(/\/$/u, "").split("/").at(-1) ?? path

function useTasks(input: { readonly enabled: boolean; readonly search: string }) {
  const { api } = RouterContext.useRouterContext()
  const appUrl = Platform.usePlatform().appUrl
  const tasks = useQuery({
    ...api.task.list.queryOptions({
      includeDone: true,
      page: 1,
      pageSize: searchSize,
      ...(input.search && { search: input.search }),
    }),
    enabled: input.enabled,
    placeholderData: keepPreviousData,
  })
  return {
    searching: tasks.isFetching && (tasks.isPlaceholderData || tasks.isPending),
    entries: (tasks.data?.items ?? []).map((task): Entry => ({
      item: {
        kind: "task",
        id: task.id,
        label: `${task.identifier} ${task.title}`,
        handle: task.identifier,
        sent: `[${task.identifier} ${escaped(task.title)}](${appUrl}/tasks/${task.id})`,
      },
    })),
  }
}

function useChats(input: {
  readonly enabled: boolean
  readonly search: string
  readonly root: Session.ID | undefined
}) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useQuery({
    ...api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }),
    enabled: input.enabled,
  })
  const spaceId = (spaces.data?.items ?? []).map((space) => space.id)
  const chats = useQuery({
    ...api.session.list.queryOptions({
      spaceId,
      origin: offered,
      orderBy: "updated",
      page: 1,
      pageSize: searchSize,
      ...(input.search && { search: input.search }),
    }),
    enabled: input.enabled && spaceId.length > 0,
    placeholderData: keepPreviousData,
  })
  return {
    searching: chats.isFetching && (chats.isPlaceholderData || chats.isPending),
    entries: (chats.data?.items ?? [])
      .filter((chat) => chat.id !== input.root)
      .map((chat): Entry => ({
        item: { kind: "chat", id: chat.id, label: SessionTitle.display(chat.title), handle: chat.id, sent: chat.id },
      })),
  }
}

export function useRenAgents(spaceId: string | undefined) {
  const { api } = RouterContext.useRouterContext()
  const agents = useQuery(
    api.agent.list.queryOptions({ page: 1, pageSize: pickerPageSize, isSubagent: false, ...(spaceId && { spaceId }) }),
  )
  return (agents.data?.items ?? []).map((agent): Entry => ({
    item: {
      kind: "ren-agent",
      id: agent.id,
      label: agent.name,
      handle: agent.name,
      ...(agent.description && { description: agent.description }),
      sent: `@${agent.name} (agent)`,
    },
  }))
}

function useDrive(input: { readonly enabled: boolean; readonly spaceId: string | undefined; readonly folder: string }) {
  const { api } = RouterContext.useRouterContext()
  const drive = useQuery({
    ...api.files.list.queryOptions({
      source: "drive",
      spaceId: input.spaceId ?? "",
      ...(input.folder && { folder: input.folder }),
    }),
    enabled: input.enabled && input.spaceId !== undefined,
    placeholderData: keepPreviousData,
  })
  const entries = drive.data?.entries ?? []
  return {
    searching: drive.isFetching && (drive.isPlaceholderData || drive.isPending),
    folders: entries.flatMap((entry): ReadonlyArray<Entry> =>
      entry.type === "directory"
        ? [{ item: { kind: "file", id: entry.path, label: `${nameOf(entry.path)}/`, handle: entry.path } }]
        : [],
    ),
    files: entries.flatMap((entry): ReadonlyArray<Entry> =>
      entry.type === "file"
        ? [
            {
              item: {
                kind: "file",
                id: entry.path,
                label: nameOf(entry.path),
                handle: entry.path,
                description: "Drive",
              },
              file: {
                path: entry.path,
                name: nameOf(entry.path),
                mime: entry.mime ?? "application/octet-stream",
                size: entry.size ?? 0,
              },
            },
          ]
        : [],
    ),
  }
}

const noChat = Session.ID.create()

function useComputerFiles(input: {
  readonly enabled: boolean
  readonly root: Session.ID | undefined
  readonly search: string
}) {
  const found = ChatReact.useFiles({
    root: input.root ?? noChat,
    query: input.enabled && input.root ? input.search : "",
    type: "file",
  })
  const root = input.root
  return {
    searching: AsyncResult.isWaiting(found),
    files:
      root && AsyncResult.isSuccess(found)
        ? found.value.slice(0, searchSize).map((entry): Entry => ({
            item: Mentions.fromFile(entry, "Chat’s computer"),
            root,
          }))
        : [],
  }
}

export function useMentionSources(input: {
  readonly root: Session.ID | undefined
  readonly spaceId: string | undefined
  readonly scope: Scope | undefined
  readonly apps: ReadonlyArray<Entry>
  readonly repositories: ReadonlyArray<Entry>
}) {
  const query = input.scope?.query ?? ""
  const folder = input.scope?.category?.prefix === "files" ? query.slice(0, query.lastIndexOf("/") + 1) : ""
  const filter = query.slice(folder.length)
  const tasks = useTasks({ enabled: wants(input.scope, "tasks"), search: query })
  const chats = useChats({ enabled: wants(input.scope, "chats"), search: query, root: input.root })
  const agents = useRenAgents(input.spaceId)
  const drive = useDrive({ enabled: wants(input.scope, "files"), spaceId: input.spaceId, folder })
  const computer = useComputerFiles({ enabled: wants(input.scope, "files"), root: input.root, search: query })
  const lists: Record<Prefix, ReadonlyArray<Entry>> = {
    tasks: tasks.entries,
    chats: chats.entries,
    apps: named(input.apps, filter),
    agents: named(agents, filter),
    files: [...named(drive.files, filter), ...computer.files],
    repos: named(input.repositories, filter),
  }
  return {
    // oxlint-disable-next-line ren/no-comments -- The chat's computer can take seconds to search, so the menu does not wait for it: its files join the end of the list when they come.
    searching: tasks.searching || chats.searching || drive.searching,
    lists,
    agents,
    folders: named(drive.folders, filter),
  }
}
