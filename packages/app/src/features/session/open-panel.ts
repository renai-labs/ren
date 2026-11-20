import { createContext, use } from "react"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Preference } from "../../lib/preference.js"
import type { PanelTarget } from "./workspace-panel.js"

export const OpenPanel = createContext<((target: PanelTarget) => void) | undefined>(undefined)

export function useOpenActivity() {
  const open = use(OpenPanel)
  return Preference.usePreference(ChatPreferences.steps) === "panel" ? open : undefined
}
