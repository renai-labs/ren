import { useEffect, useRef, useState } from "react"
import { McpAppBridge, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Option, type Schema } from "effect"
import { Platform } from "../platform/platform.js"
import { errorMessage, errorStatus } from "./errors.js"
import { localTimeZone } from "./schedules.js"

const themeVariables: Readonly<Record<string, string>> = {
  "--color-background-primary": "--background",
  "--color-background-secondary": "--muted",
  "--color-text-primary": "--foreground",
  "--color-text-secondary": "--muted-foreground",
  "--color-border-primary": "--border",
  "--border-radius-md": "--radius",
  "--font-sans": "--font-sans",
  "--font-mono": "--font-mono",
}

const loadTimeout = 10_000

const maxQueued = 5

const granted = new Set<string>()

export type Ask =
  | { readonly kind: "call"; readonly tool: string; readonly input: unknown }
  | { readonly kind: "post"; readonly text: string }

export type Choice = "deny" | "once" | "chat"

export type Check = Ask & { readonly decide: (allowed: boolean) => void }

interface Latest {
  readonly tool: SessionMessage.Tool
  readonly app: SessionMessage.McpAppView["app"]
  readonly onPost: ((text: string) => void) | undefined
  readonly callTool: (call: {
    readonly server: string
    readonly tool: string
    readonly input: { readonly [key: string]: typeof Schema.Json.Type }
  }) => Promise<Parameters<typeof McpAppBridge.callResult>[0]>
  readonly openExternal: (url: string) => void
  readonly key: string
}

interface Host {
  readonly latest: { readonly current: Latest }
  readonly calls: { current: ReadonlyArray<number> }
  readonly post: (message: unknown) => void
  readonly ask: (question: Ask) => Promise<boolean>
  readonly ready: () => void
  readonly resize: (height: number) => void
}

const themeContext = () => {
  const style = getComputedStyle(document.documentElement)
  return {
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    styles: {
      variables: Object.fromEntries(
        Object.entries(themeVariables).map(([name, source]) => [name, style.getPropertyValue(source).trim()]),
      ),
    },
  }
}

const initialize = (host: Host, id: string | number) => {
  const app = host.latest.current.app
  host.post(
    McpAppBridge.reply(id, {
      protocolVersion: McpAppBridge.protocolVersion,
      hostInfo: { name: "Ren", version: "1" },
      hostCapabilities: {
        openLinks: {},
        serverTools: {},
        sandbox: {
          csp: {
            connectDomains: McpAppBridge.domains(app.domains.connect),
            resourceDomains: McpAppBridge.domains(app.domains.resource),
          },
        },
      },
      hostContext: {
        ...themeContext(),
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        containerDimensions: { maxHeight: Math.round(window.innerHeight * 0.7) },
        locale: navigator.language,
        timeZone: localTimeZone,
        platform: "web",
        toolInfo: { tool: { name: app.tool, inputSchema: { type: "object" } } },
      },
    }),
  )
}

const initialized = (host: Host) => {
  const tool = host.latest.current.tool
  host.ready()
  host.post(McpAppBridge.notify("ui/notifications/tool-input", { arguments: ToolState.input(tool) }))
  host.post(McpAppBridge.notify("ui/notifications/tool-result", McpAppBridge.toolResult(tool)))
}

const openLink = (host: Host, id: string | number, params: unknown) => {
  const url = McpAppBridge.link(params)
  if (Option.isNone(url) || !navigator.userActivation.isActive) {
    host.post(McpAppBridge.fail(id, "Only https links that you opened are allowed."))
    return
  }
  host.latest.current.openExternal(url.value)
  host.post(McpAppBridge.reply(id, {}))
}

const post = async (host: Host, id: string | number, params: unknown) => {
  const text = McpAppBridge.postText(params)
  if (Option.isNone(text)) return host.post(McpAppBridge.fail(id, "A message needs text.", -32602))
  const onPost = host.latest.current.onPost
  if (!onPost) return host.post(McpAppBridge.fail(id, "This chat cannot take a message from the view."))
  if (!(await host.ask({ kind: "post", text: text.value })))
    return host.post(McpAppBridge.fail(id, "The person denied this message."))
  onPost(text.value)
  return host.post(McpAppBridge.reply(id, {}))
}

const callTool = async (host: Host, id: string | number, params: unknown) => {
  const call = McpAppBridge.toolCall(params)
  if (Option.isNone(call)) return host.post(McpAppBridge.fail(id, "A tool call needs a tool name.", -32602))
  const current = host.latest.current
  const input = call.value.arguments ?? {}
  const allowed =
    (current.app.readOnly && call.value.name === current.app.tool) ||
    (await host.ask({ kind: "call", tool: call.value.name, input }))
  if (!allowed) return host.post(McpAppBridge.fail(id, "The person denied this call."))
  return current.callTool({ server: current.app.server, tool: call.value.name, input }).then(
    (result) => host.post(McpAppBridge.reply(id, McpAppBridge.callResult(result))),
    (error: unknown) =>
      host.post(
        errorStatus(error) === 404
          ? McpAppBridge.fail(id, "This app is no longer connected.")
          : McpAppBridge.reply(id, McpAppBridge.failure(errorMessage(error, "The tool failed."))),
      ),
  )
}

const limited = async (host: Host, id: string | number, run: () => Promise<unknown>) => {
  const admitted = McpAppBridge.admit(host.calls.current, Date.now())
  if (!admitted) return host.post(McpAppBridge.fail(id, "This view sent too many requests. Try again in a minute."))
  host.calls.current = admitted
  return run()
}

const handle = async (host: Host, message: McpAppBridge.Message) => {
  const id = message.id
  if (message.method === "ui/notifications/initialized") return initialized(host)
  if (message.method === "ui/notifications/size-changed") {
    const height = McpAppBridge.height(message.params)
    if (Option.isSome(height)) host.resize(height.value)
    return
  }
  if (id === undefined) return
  if (message.method === "ui/initialize") return initialize(host, id)
  if (message.method === "ping") return host.post(McpAppBridge.reply(id, {}))
  if (message.method === "ui/request-display-mode") return host.post(McpAppBridge.reply(id, { mode: "inline" }))
  if (message.method === "ui/open-link") return openLink(host, id, message.params)
  if (message.method === "ui/message") return limited(host, id, () => post(host, id, message.params))
  if (message.method === "tools/call") return limited(host, id, () => callTool(host, id, message.params))
  return host.post(McpAppBridge.fail(id, `Ren does not support ${message.method}.`, -32601))
}

export function useMcpAppFrame(input: {
  root: Session.ID
  tool: SessionMessage.Tool
  app: SessionMessage.McpAppView["app"]
  onPost: ((text: string) => void) | undefined
  loaded: boolean
}) {
  const platform = Platform.usePlatform()
  const callApp = ChatReact.useAction(input.root, (opened, call: Parameters<typeof opened.callAppTool>[0]) =>
    opened.callAppTool(call),
  )
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading")
  const [checks, setChecks] = useState<ReadonlyArray<Check>>([])
  const calls = useRef<ReadonlyArray<number>>([])
  const key = `${input.root}:${input.app.server}`
  const current: Latest = {
    tool: input.tool,
    app: input.app,
    onPost: input.onPost,
    callTool: callApp,
    openExternal: platform.openExternal,
    key,
  }
  const latest = useRef(current)
  useEffect(() => {
    latest.current = current
  })
  const loaded = input.loaded
  useEffect(() => {
    if (!frame || !loaded) return
    const timer = setTimeout(() => setPhase((now) => (now === "ready" ? now : "failed")), loadTimeout)
    const send = (message: unknown) => frame.contentWindow?.postMessage(message, "*")
    const host: Host = {
      latest,
      calls,
      post: send,
      ask: (question) =>
        new Promise<boolean>((resolve) => {
          if (granted.has(latest.current.key)) return resolve(true)
          setChecks((all) => {
            if (all.length < maxQueued) return [...all, { ...question, decide: resolve }]
            resolve(false)
            return all
          })
        }),
      ready: () => {
        clearTimeout(timer)
        setPhase("ready")
      },
      resize: (height) => {
        frame.style.height = `${height}px`
      },
    }
    const received = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return
      const decoded = McpAppBridge.decode(event.data)
      if (Option.isSome(decoded)) void handle(host, decoded.value)
    }
    const theme = new MutationObserver(() =>
      send(McpAppBridge.notify("ui/notifications/host-context-changed", themeContext())),
    )
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    window.addEventListener("message", received)
    return () => {
      clearTimeout(timer)
      theme.disconnect()
      window.removeEventListener("message", received)
      setChecks((all) => {
        for (const check of all) check.decide(false)
        return []
      })
    }
  }, [frame, loaded])
  const decide = (choice: Choice) => {
    if (choice === "chat") granted.add(key)
    const settled = choice === "chat" ? checks : checks.slice(0, 1)
    for (const check of settled) check.decide(choice !== "deny")
    setChecks(checks.slice(settled.length))
  }
  return [setFrame, { phase, check: checks.at(0), decide }] as const
}
