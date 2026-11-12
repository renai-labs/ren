import { createContext } from "react"

export const WorkspaceFile = createContext<((target: { path: string; line?: number | undefined }) => void) | undefined>(
  undefined,
)
