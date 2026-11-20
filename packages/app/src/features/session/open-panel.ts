import { createContext, use } from "react"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Preference } from "../../lib/preference.js"
import type { PanelTarget } from "./workspace-panel.js"

export const OpenPanel = createContext<((target: PanelTarget) => void) | undefined>(undefined)

// oxlint-disable-next-line ren/no-comments -- A turn's steps open in the Activity panel, or expand in the chat when the person chose the chat.
export function useOpenActivity() {
  const open = use(OpenPanel)
  return Preference.usePreference(ChatPreferences.steps) === "panel" ? open : undefined
}
