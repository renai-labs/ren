import { createContext } from "react"

const workspace = /^.*\/workspace\/[^/]+\//u

export const OpenChanges = createContext<((path: string) => void) | undefined>(undefined)

export const workspacePath = (path: string) => path.replace(workspace, "")
