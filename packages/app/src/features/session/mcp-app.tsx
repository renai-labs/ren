import { useState, type ReactNode } from "react"
import { McpAppBridge } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconAlertTriangle, IconChevronRight, IconApps } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Alert, AlertDescription, AlertTitle } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { CodeBlock, CodeBlockContent } from "@ren/ui/code-block"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Skeleton } from "@ren/ui/skeleton"
import { cn } from "cn"
import { RouterContext } from "../../lib/router-context.js"
import { useMcpAppFrame, type Check, type Choice } from "../../lib/use-mcp-app-frame.js"

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

function srcdocOf(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const meta = doc.createElement("meta")
  meta.httpEquiv = "Content-Security-Policy"
  meta.content = McpAppBridge.policy
  doc.head.prepend(meta)
  return `<!doctype html>${doc.documentElement.outerHTML}`
}

function CheckCard(props: { name: string; check: Check; onDecide: (choice: Choice) => void }) {
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
        <Button size="sm" variant="ghost" onClick={() => props.onDecide("deny")}>
          Deny
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onDecide("chat")}>
          Allow for this chat
        </Button>
        <Button size="sm" onClick={() => props.onDecide("once")}>
          Allow once
        </Button>
      </ItemActions>
    </Item>
  )
}

function ShowCall(props: { row: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconChevronRight className={cn("transition-transform", open && "rotate-90")} data-icon="inline-start" />
        Show call
      </Button>
      {open ? props.row : null}
    </>
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
  const [setFrame, frame] = useMcpAppFrame({
    root: props.root,
    tool: props.tool,
    app: props.app,
    onPost: props.onPost,
    loaded: view.isSuccess,
  })
  const srcdoc = view.data === undefined ? "" : srcdocOf(view.data)
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
                ref={setFrame}
                title={title}
                srcDoc={srcdoc}
                sandbox="allow-scripts allow-forms"
                referrerPolicy="no-referrer"
                allow=""
                className="block h-60 max-h-[70vh] min-h-30 w-full border-0"
              />
            </div>
          </Card>
        </div>
      )}
      {frame.check ? <CheckCard name={name} check={frame.check} onDecide={frame.decide} /> : null}
      {ready ? <ShowCall row={props.row} /> : null}
    </div>
  )
}
