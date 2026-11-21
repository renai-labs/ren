export * as TaskScopeContext from "./task-scope-context.js"

import { createContext, use } from "react"
import { useNavigate } from "@tanstack/react-router"

export const SpaceId = createContext<string | undefined>(undefined)

export const useSpaceId = () => use(SpaceId)

export function useOpen() {
  const spaceId = useSpaceId()
  const navigate = useNavigate()
  return {
    task: (taskId: string, session?: string) =>
      void (spaceId
        ? navigate({
            to: "/spaces/$spaceId/tasks/$taskId",
            params: { spaceId, taskId },
            search: session ? { session } : {},
          })
        : navigate({ to: "/tasks/$taskId", params: { taskId }, search: session ? { session } : {} })),
    tasks: () =>
      void (spaceId ? navigate({ to: "/spaces/$spaceId/tasks", params: { spaceId } }) : navigate({ to: "/tasks" })),
  }
}
