import { createContext } from "react"
import type { PanelTarget } from "./workspace-panel.js"

export const OpenPanel = createContext<((target: PanelTarget) => void) | undefined>(undefined)
