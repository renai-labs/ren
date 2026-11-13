import { useRef, useState } from "react"
import { ComposerHistory } from "@ren/chat"
import { Platform } from "../platform/platform.js"
import { ChatPreferences } from "./chat-preferences.js"

export function useShellHistory() {
  const platform = Platform.usePlatform()
  const [entries, setEntries] = useState(() => ChatPreferences.shellHistory.read(platform.storage))
  const browsing = useRef<ComposerHistory.Browsing>(ComposerHistory.idle)
  return {
    add: (command: string) => {
      browsing.current = ComposerHistory.idle
      const next = ComposerHistory.prepend(entries, { text: command, pasted: [] })
      if (next === entries) return
      ChatPreferences.shellHistory.write(platform.storage, next)
      setEntries(next)
    },
    reset: () => {
      browsing.current = ComposerHistory.idle
    },
    step: (direction: "up" | "down", text: string, cursor: number) => {
      const result = ComposerHistory.navigate(browsing.current, direction, entries, { text, pasted: [] }, cursor)
      if (!result) return
      browsing.current = result.browsing
      return { text: result.entry.text, cursor: result.cursor }
    },
  }
}

export type ShellHistory = ReturnType<typeof useShellHistory>
