export * as WorkspaceProject from "./workspace-project.js"

import { useState } from "react"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { SessionVcs } from "@ren/schema/session/vcs"
import { AsyncResult } from "effect/reactivity"
import { editedPaths } from "./workspace-edits.js"

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

// oxlint-disable-next-line ren/no-comments -- Files and Changes start in the repository Ren edited last, or in the only one the chat's folder holds, so a clone shows as the project and not as a folder of the chat's folder.
export function useProjects(root: Session.ID, messages: ReadonlyArray<SessionMessage.Info>): Projects {
  const projects = ChatReact.useVcsProjects(root)
  const list = AsyncResult.isSuccess(projects.result) ? projects.result.value : []
  const [chosen, setChosen] = useState<{ readonly project: string } | { readonly file: string }>()
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
    choose: (path) => setChosen({ project: path }),
    reveal: (path) => setChosen({ file: path }),
    refresh: projects.refresh,
  }
}
