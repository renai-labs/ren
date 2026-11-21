export * as Browser from "./browser.js"

import { useEffect, useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Option, Schema } from "effect"

export const Info = Schema.Struct({
  id: Schema.String,
  liveView: Schema.String,
  closed: Schema.Boolean,
  url: Schema.String,
  title: Schema.String,
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
})
export type Info = typeof Info.Type

export type Navigate = { readonly url: string } | { readonly history: "back" | "forward" | "reload" }

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.NullOr(Info)))

const service = `${(import.meta.env.VITE_REN_INTEGRATIONS_URL ?? "https://mcp.useren.ai").replace(/\/+$/u, "")}/browser`

const sessionId = /"session_id"\s*:\s*"([a-z0-9]{8,64})"/gu

const textsOf = (state: SessionMessage.ToolState) => [
  typeof state.input === "string" ? state.input : JSON.stringify(state.input),
  "metadata" in state ? JSON.stringify(state.metadata ?? {}) : "",
  ...("content" in state
    ? (state.content ?? []).flatMap((content) => (content.type === "text" ? [content.text] : []))
    : []),
]

// oxlint-disable-next-line ren/no-comments -- The Kernel browser ids that the chat's tool calls name, in their input, progress or result. A running Code Mode call shows the calls it makes, so a browser that it uses shows before the call ends. The service opens a browser by its id only.
export const idsOf = (messages: ReadonlyArray<SessionMessage.Info>) => [
  ...new Set(
    messages.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) =>
            part.type === "tool"
              ? textsOf(part.state).flatMap((text) => [...text.matchAll(sessionId)].map((match) => match[1] ?? ""))
              : [],
          )
        : [],
    ),
  ),
]

const keys = {
  latest: (root: Session.ID, input: { ids: ReadonlyArray<string>; running: boolean }) =>
    ["browser", root, input.ids, input.running] as const,
}

const post = (path: string, body: object, signal?: AbortSignal) =>
  globalThis.fetch(`${service}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    ...(signal && { signal }),
  })

// oxlint-disable-next-line ren/no-comments -- One read when the chat names a new browser, or starts or ends a turn.
export function useLatest(root: Session.ID, input: { ids: ReadonlyArray<string>; running: boolean }) {
  return useQuery({
    queryKey: keys.latest(root, input),
    enabled: input.ids.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const response = await post("/", { ids: input.ids }, signal)
      if (!response.ok) throw new Error("Ren couldn’t read the browser.")
      return Option.getOrNull(decode(await response.text()))
    },
  }).data
}

// oxlint-disable-next-line ren/no-comments -- Reads the `data:` lines of a server-sent event stream as they arrive.
const events = async (body: ReadableStream<Uint8Array>, receive: (data: string) => void) => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const read = async (buffer: string): Promise<void> => {
    const chunk = await reader.read()
    if (chunk.done) return
    const lines = (buffer + decoder.decode(chunk.value, { stream: true })).split("\n")
    const rest = lines.pop() ?? ""
    for (const line of lines) if (line.startsWith("data:")) receive(line.slice(5).trim())
    return read(rest)
  }
  return read("")
}

// oxlint-disable-next-line ren/no-comments -- Follows the browser while the Browser tab shows it. The service keeps a CDP connection only while someone watches, because it keeps the browser running and billed.
export function useWatch(root: Session.ID, ids: ReadonlyArray<string>) {
  const [state, setState] = useState<{ root: Session.ID; info: Info | null; failed: boolean }>()
  const joined = ids.join()
  useEffect(() => {
    if (!joined) return
    const controller = new AbortController()
    const follow = async (): Promise<void> => {
      const response = await post("/watch", { ids: joined.split(",") }, controller.signal).catch(() => undefined)
      const followed =
        response?.ok && response.body
          ? await events(response.body, (data) =>
              Option.map(decode(data), (info) => setState({ root, info, failed: false })),
            ).then(
              () => true,
              () => false,
            )
          : false
      if (controller.signal.aborted) return
      if (!followed) setState((current) => current && { ...current, failed: true })
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      return follow()
    }
    void follow()
    return () => controller.abort()
  }, [root, joined])
  const current = state?.root === root ? state : undefined
  return {
    info: current?.info,
    failed: current?.failed === true,
    navigate: async (to: Navigate) => {
      const response = await post("/navigate", { ids, to })
      if (!response.ok) throw new Error("The browser couldn’t open that page.")
    },
  }
}
