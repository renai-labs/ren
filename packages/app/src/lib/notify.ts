export * as Notify from "./notify.js"

import { useEffect, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Platform } from "../platform/platform.js"
import { ChatPreferences } from "./chat-preferences.js"

const titles = {
  finished: "Ren finished",
  permissions: "Ren needs a permission",
  questions: "Ren has a question",
  errors: "Ren couldn’t finish",
} as const satisfies Record<ChatPreferences.NotificationKind, string>

export interface Request {
  readonly kind: "permissions" | "questions"
  readonly id: string
  readonly sessionID: string
}

interface Target {
  readonly root: string
  readonly title: string
  readonly platform: Platform.Info
  readonly navigate: ReturnType<typeof useNavigate>
}

function deliver(
  target: Target,
  kind: ChatPreferences.NotificationKind,
  event: { readonly id: string; readonly sessionID: string; readonly active?: () => boolean },
) {
  const settings = ChatPreferences.notifications.read(target.platform.storage)
  if (!settings[kind]) return
  void target.platform.notify(titles[kind], target.title, {
    id: `${target.root}:${kind}:${event.id}`,
    silent: !settings.sound,
    ...(event.active && { active: event.active }),
    onClick: () =>
      void target.navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: target.root },
        search: event.sessionID === target.root ? {} : { child: event.sessionID },
      }),
  })
}

export function useChatNotifications(input: {
  readonly root: string
  readonly title: string
  readonly running: boolean
  readonly delegated: boolean
  readonly outcome: { readonly id: string; readonly failed: boolean } | undefined
  readonly requests: ReadonlyArray<Request>
}) {
  const platform = Platform.usePlatform()
  const navigate = useNavigate()
  const open = useRef(input.requests)
  const seen = useRef(new Set<string>())
  const wasRunning = useRef(input.running)

  useEffect(() => {
    open.current = input.requests
    const target = { root: input.root, title: input.title, platform, navigate }
    for (const request of input.requests.filter((item) => !seen.current.has(item.id))) {
      seen.current.add(request.id)
      deliver(target, request.kind, {
        id: request.id,
        sessionID: request.sessionID,
        active: () => open.current.some((current) => current.id === request.id),
      })
    }
  }, [input.requests, input.root, input.title, platform, navigate])

  useEffect(() => {
    const before = wasRunning.current
    wasRunning.current = input.running
    if (!before || input.running || input.delegated || !input.outcome) return
    deliver(
      { root: input.root, title: input.title, platform, navigate },
      input.outcome.failed ? "errors" : "finished",
      {
        id: input.outcome.id,
        sessionID: input.root,
      },
    )
  }, [input.running, input.delegated, input.outcome, input.root, input.title, platform, navigate])
}
