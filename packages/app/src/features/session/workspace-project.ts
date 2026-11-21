export * as WorkspaceProject from "./workspace-project.js"

import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { SessionVcs } from "@ren/schema/session/vcs"
import { AsyncResult } from "effect/reactivity"
import { editedPaths } from "./workspace-edits.js"

export type Chosen = { readonly project: string } | { readonly file: string }

export interface Projects {
  readonly list: ReadonlyArray<SessionVcs.Project>
  readonly current: string
  readonly choose: (path: string) => void
  readonly reveal: (path: string) => void
  readonly refresh: () => void
}

const chatFolder = "Chat folder"

export const projectName = (path: string) => path.replace(/\/$/u, "") || chatFolder

const containing = (list: ReadonlyArray<SessionVcs.Project>, path: string) =>
  list.reduce(
    (found, project) => (project.path.length > found.length && path.startsWith(project.path) ? project.path : found),
    "",
  )

export function useProjects(
  root: Session.ID,
  messages: ReadonlyArray<SessionMessage.Info>,
  choice: { readonly chosen: Chosen | undefined; readonly onChosen: (next: Chosen) => void },
): Projects {
  const projects = ChatReact.useVcsProjects(root)
  const list = AsyncResult.isSuccess(projects.result) ? projects.result.value : []
  const chosen = choice.chosen
  const last = editedPaths(messages).at(-1)
  const repositories = list.filter((project) => project.path)
  const only =
    repositories.length === 1 && !list.some((project) => !project.path) ? repositories.at(0)?.path : undefined
  const fallback = last === undefined ? (only ?? "") : containing(list, last)
  const current = (() => {
    if (chosen === undefined) return fallback
    if ("file" in chosen) return containing(list, chosen.file)
    return chosen.project === "" || list.some((project) => project.path === chosen.project) ? chosen.project : fallback
  })()
  return {
    list,
    current,
    choose: (path) => choice.onChosen({ project: path }),
    reveal: (path) => choice.onChosen({ file: path }),
    refresh: projects.refresh,
  }
}
