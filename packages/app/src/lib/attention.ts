export * as Attention from "./attention.js"

import { useEffect, useEffectEvent, useRef } from "react"
import { Platform } from "../platform/platform.js"
import { ChatPreferences } from "./chat-preferences.js"

export type Signal = "finished" | "input"

export interface Activity {
  readonly running: boolean
  readonly asking: number
}

function signal(previous: Activity, next: Activity): Signal | undefined {
  if (next.asking > previous.asking) return "input"
  if (previous.running && !next.running && next.asking === 0) return "finished"
  return undefined
}

const copy: Readonly<Record<Signal, string>> = {
  finished: "Ren finished working",
  input: "Ren needs your input",
}

export function ask(platform: Platform.Info) {
  if (ChatPreferences.notify.read(platform.storage)) void platform.requestNotifications?.()
}

export function useNotify(input: Activity & { readonly title: string }) {
  const platform = Platform.usePlatform()
  const previous = useRef<Activity>({ running: input.running, asking: input.asking })
  const notify = useEffectEvent((next: Activity) => {
    const found = signal(previous.current, next)
    previous.current = next
    if (found && ChatPreferences.notify.read(platform.storage))
      void platform.notify(input.title, copy[found]).catch(() => undefined)
  })
  useEffect(() => notify({ running: input.running, asking: input.asking }), [input.running, input.asking])
}
