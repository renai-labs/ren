import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { McpAppBridge, ToolState } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconAlertTriangle, IconChevronRight, IconApps } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Skeleton } from "@ren/ui/skeleton"
import { cn } from "cn"
import { errorMessage, errorStatus } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"

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

type Ask =
  | { readonly kind: "call"; readonly tool: string; readonly input: unknown }
  | { readonly kind: "post"; readonly text: string }

type Check = Ask & { readonly decide: (allowed: boolean) => void }

const titleOf = (tool: string) => {
  const words = tool.replaceAll(/[_-]+/gu, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const nameOf = (server: string) => server.charAt(0).toUpperCase() + server.slice(1)

function useView(spaceId: string | undefined, path: string) {
  const { api, platform, queryClient } = RouterContext.useRouterContext()
  const driveFetch = platform.fetch
    ? FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, platform.fetch)))
    : FetchHttpClient.layer
  return useQuery({
    // ast-grep-ignore: no-query-key-literal -- reads a stored view from the drive, not the API
    queryKey: ["mcp-app", spaceId, path],
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const found = await queryClient.query({
        ...api.drive.download.queryOptions({ ...(spaceId && { spaceId }), path, disposition: "inline" }),
      })
      const html = await Effect.runPromise(
        HttpClient.get(found.url).pipe(
          Effect.flatMap((response) =>
            response.status >= 400 ? Effect.fail(new Error(`UnexpectedStatus: ${response.status}`)) : response.text,
          ),
          Effect.provide(driveFetch),
        ),
      )
      return html
    },
  })
}

function srcdocOf(html: string, app: SessionMessage.McpAppView["app"]) {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const meta = doc.createElement("meta")
  meta.httpEquiv = "Content-Security-Policy"
  meta.content = McpAppBridge.policy(app.domains)
  doc.head.prepend(meta)
  return `<!doctype html>${doc.documentElement.outerHTML}`
}

function useAppFrame(input: {
  root: Session.ID
  tool: SessionMessage.Tool
  app: SessionMessage.McpAppView["app"]
  onPost: ((text: string) => void) | undefined
  loaded: boolean
}) {
  const platform = Platform.usePlatform()
  const callTool = ChatReact.useAction(input.root, (opened, call: Parameters<typeof opened.callAppTool>[0]) =>
    opened.callAppTool(call),
  )
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading")
  const [height, setHeight] = useState<number>()
  const [checks, setChecks] = useState<ReadonlyArray<Check>>([])
  const calls = useRef<ReadonlyArray<number>>([])
  const key = `${input.root}:${input.app.server}`
  const latest = useRef({ tool: input.tool, app: input.app, onPost: input.onPost, callTool, platform, key })
  useEffect(() => {
    latest.current = { tool: input.tool, app: input.app, onPost: input.onPost, callTool, platform, key }
  })
  const loaded = input.loaded
  useEffect(() => {
    if (!frame || !loaded) return
    const post = (message: unknown) => frame.contentWindow?.postMessage(message, "*")
    const ask = (question: Ask) =>
      new Promise<boolean>((resolve) => {
        if (granted.has(latest.current.key)) return resolve(true)
        setChecks((all) => {
          if (all.length >= maxQueued) {
            resolve(false)
            return all
          }
          return [...all, { ...question, decide: resolve }]
        })
      })
    const context = () => {
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
    const timer = setTimeout(() => setPhase((current) => (current === "ready" ? current : "failed")), loadTimeout)
    const handle = async (id: string | number | undefined, method: string, params: unknown) => {
      const { app, tool, onPost, callTool, platform } = latest.current
      const respond = (message: (id: string | number) => unknown) => (id === undefined ? undefined : post(message(id)))
      if (method === "ui/initialize")
        return respond((reply) =>
          McpAppBridge.reply(reply, {
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
              ...context(),
              displayMode: "inline",
              availableDisplayModes: ["inline"],
              containerDimensions: { maxHeight: Math.round(window.innerHeight * 0.7) },
              locale: navigator.language,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              platform: "web",
              toolInfo: { tool: { name: app.tool, inputSchema: { type: "object" } } },
            },
          }),
        )
      if (method === "ui/notifications/initialized") {
        clearTimeout(timer)
        setPhase("ready")
        post(McpAppBridge.notify("ui/notifications/tool-input", { arguments: ToolState.input(tool) }))
        post(McpAppBridge.notify("ui/notifications/tool-result", McpAppBridge.toolResult(tool)))
        return
      }
      if (method === "ui/notifications/size-changed") {
        const next = McpAppBridge.height(params)
        if (Option.isSome(next)) setHeight(next.value)
        return
      }
      if (method === "ping") return respond((reply) => McpAppBridge.reply(reply, {}))
      if (method === "ui/request-display-mode")
        return respond((reply) => McpAppBridge.reply(reply, { mode: "inline" }))
      if (method === "ui/open-link") {
        const url = McpAppBridge.link(params)
        if (Option.isNone(url) || !navigator.userActivation.isActive)
          return respond((reply) => McpAppBridge.fail(reply, "Only https links that you opened are allowed."))
        platform.openExternal(url.value)
        return respond((reply) => McpAppBridge.reply(reply, {}))
      }
      if (method !== "tools/call" && method !== "ui/message") {
        if (id !== undefined) post(McpAppBridge.fail(id, `Ren does not support ${method}.`, -32601))
        return
      }
      if (id === undefined) return
      const admitted = McpAppBridge.admit(calls.current, Date.now())
      if (!admitted) return post(McpAppBridge.fail(id, "This view sent too many requests. Try again in a minute."))
      calls.current = admitted
      if (method === "ui/message") {
        const text = McpAppBridge.postText(params)
        if (Option.isNone(text)) return post(McpAppBridge.fail(id, "A message needs text.", -32602))
        if (!onPost) return post(McpAppBridge.fail(id, "This chat cannot take a message from the view."))
        if (!(await ask({ kind: "post", text: text.value })))
          return post(McpAppBridge.fail(id, "The person denied this message."))
        onPost(text.value)
        return post(McpAppBridge.reply(id, {}))
      }
      const call = McpAppBridge.toolCall(params)
      if (Option.isNone(call)) return post(McpAppBridge.fail(id, "A tool call needs a tool name.", -32602))
      const args = call.value.arguments ?? {}
      const allowed =
        (app.readOnly && call.value.name === app.tool) ||
        (await ask({ kind: "call", tool: call.value.name, input: args }))
      if (!allowed) return post(McpAppBridge.fail(id, "The person denied this call."))
      return callTool({ server: app.server, tool: call.value.name, input: args }).then(
        (result) => post(McpAppBridge.reply(id, McpAppBridge.callResult(result))),
        (error: unknown) =>
          post(
            errorStatus(error) === 404
              ? McpAppBridge.fail(id, "This app is no longer connected.")
              : McpAppBridge.reply(id, McpAppBridge.failure(errorMessage(error, "The tool failed."))),
          ),
      )
    }
    const received = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return
      const decoded = McpAppBridge.decode(event.data)
      if (Option.isNone(decoded)) return
      void handle(decoded.value.id, decoded.value.method, decoded.value.params)
    }
    const theme = new MutationObserver(() => post(McpAppBridge.notify("ui/notifications/host-context-changed", context())))
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
  const decide = (allowed: boolean, always: boolean) => {
    if (allowed && always) granted.add(key)
    const settled = allowed && always ? checks : checks.slice(0, 1)
    for (const check of settled) check.decide(allowed)
    setChecks(checks.slice(settled.length))
  }
  return { setFrame, phase, height, check: checks.at(0), decide }
}

function CheckCard(props: { name: string; check: Check; onDecide: (allowed: boolean, always: boolean) => void }) {
  const check = props.check
  return (
    <Item variant="outline" size="sm" className="bg-card" role="alert">
      <ItemMedia variant="icon">
        <IconApps />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {check.kind === "call" ? (
            <>
              {props.name} wants to run <code className="font-mono">{check.tool}</code>
            </>
          ) : (
            <>{props.name} wants to post to your message</>
          )}
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-40">
              {check.kind === "call" ? JSON.stringify(check.input, null, 2) : check.text}
            </CodeBlockContent>
          </CodeBlock>
        </ItemDescription>
      </ItemContent>
      <ItemActions className="w-full justify-end">
        <Button size="sm" variant="ghost" onClick={() => props.onDecide(false, false)}>
          Deny
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onDecide(true, true)}>
          Allow for this chat
        </Button>
        <Button size="sm" onClick={() => props.onDecide(true, false)}>
          Allow once
        </Button>
      </ItemActions>
    </Item>
  )
}

export function McpAppView(props: {
  root: Session.ID
  spaceId: string | undefined
  tool: SessionMessage.Tool
  app: SessionMessage.McpAppView["app"]
  onPost: ((text: string) => void) | undefined
  row: ReactNode
}) {
  const name = nameOf(props.app.server)
  const view = useView(props.spaceId, props.app.path)
  const frame = useAppFrame({
    root: props.root,
    tool: props.tool,
    app: props.app,
    onPost: props.onPost,
    loaded: view.isSuccess,
  })
  const [call, setCall] = useState(false)
  const srcdoc = useMemo(() => (view.data === undefined ? "" : srcdocOf(view.data, props.app)), [view.data, props.app])
  const failed = view.isError || frame.phase === "failed"
  const ready = frame.phase === "ready"
  const title = `${name} · ${titleOf(props.app.tool)}`
  if (failed)
    return (
      <div className="flex flex-col gap-2">
        {props.row}
        <Alert>
          <IconAlertTriangle />
          <AlertTitle>Couldn’t load {name}’s view</AlertTitle>
          <AlertDescription>The tool call above has its result.</AlertDescription>
        </Alert>
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      {ready ? null : props.row}
      {view.data === undefined ? null : (
        <div className={cn(!ready && "h-0 overflow-hidden")}>
          <Card size="sm" className="gap-0 rounded-lg py-0">
            <div className="flex h-10 shrink-0 items-center border-b bg-muted/50 px-3">
              <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
            </div>
            <div className="relative bg-background">
              {ready ? null : <Skeleton className="absolute inset-0 rounded-none" />}
              <iframe
                ref={frame.setFrame}
                title={title}
                srcDoc={srcdoc}
                sandbox="allow-scripts allow-forms"
                referrerPolicy="no-referrer"
                allow=""
                style={frame.height === undefined ? undefined : { height: frame.height }}
                className="block h-60 max-h-[70vh] min-h-30 w-full border-0"
              />
            </div>
          </Card>
        </div>
      )}
      {frame.check ? <CheckCard name={name} check={frame.check} onDecide={frame.decide} /> : null}
      {ready ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="self-start text-muted-foreground"
            aria-expanded={call}
            onClick={() => setCall(!call)}
          >
            <IconChevronRight className={cn("transition-transform", call && "rotate-90")} data-icon="inline-start" />
            Show call
          </Button>
          {call ? props.row : null}
        </>
      ) : null}
    </div>
  )
}
